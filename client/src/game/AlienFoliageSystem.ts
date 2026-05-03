import * as BABYLON from "@babylonjs/core";
import { LSystem } from "./lsystem/LSystem";
import { LSystemRenderer } from "./lsystem/LSystemRenderer";
import { LSystemPresets, LSystemPresetKey } from "./lsystem/LSystemPresets";
import {
  KEEPOUT_ANCHORS,
  KEEPOUT_RADIUS,
  FoliageOccupancy,
} from "./lsystem/FoliagePlacement";

/**
 * AlienFoliageSystem
 *
 * Scatters L-system-generated alien plants across the wilderness ring
 * between the city and the mountain ring. Each plant is built once at
 * world init, merged into at most two draw calls (trunk + leaves), and
 * distance-culled per frame so far plants vanish from rendering AND
 * picking with no per-frame cost beyond a squared-distance check.
 *
 * Plants are purely decorative — no collision, no damageable, no pickup.
 * Their mesh names are prefixed `alien_plant_` so they're explicitly NOT
 * matched by PlayerController's ground ray-pick predicate (you can't
 * stand on an alien tree).
 *
 * Placement strategy:
 *   - Polar scatter in the radius band [INNER_RADIUS, OUTER_RADIUS] from
 *     world origin so plants populate the area between the city and the
 *     mountain ring at 560m.
 *   - Reject candidates within KEEPOUT_RADIUS of fortress / temple anchors
 *     so we don't clutter level capstones.
 *   - Reject candidates within MIN_PLANT_SPACING of an already-placed plant
 *     so the scatter looks distributed instead of clumped.
 *   - Deterministic seeded RNG so the same seed yields the same world
 *     layout — useful for reproducible testing.
 */
export class AlienFoliageSystem {
  private scene: BABYLON.Scene;
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  /** Per-plant root + cached squared distance threshold. */
  private plants: Array<{ root: BABYLON.TransformNode; pos: BABYLON.Vector3 }> = [];
  /** Materials shared across every plant of a given preset. */
  private materials: Map<string, BABYLON.StandardMaterial> = new Map();

  /** Wilderness band — well outside the spawn zone, well inside the ring. */
  private static readonly INNER_RADIUS = 90;
  private static readonly OUTER_RADIUS = 540;
  /** Min XZ spacing between two plants. Cross-system overlap is also
   *  guarded by the shared FoliageOccupancy registry. */
  private static readonly MIN_PLANT_SPACING = 12;
  /** Plants past this distance are setEnabled(false) (squared). */
  private static readonly CULL_DISTANCE_SQ = 220 * 220;
  /** Re-enable threshold (hysteresis to avoid per-frame flicker). */
  private static readonly SHOW_DISTANCE_SQ = 215 * 215;
  /** Total plants to attempt to place. Final count may be lower if many
   *  candidates are rejected by keep-out / spacing constraints. */
  private static readonly TARGET_COUNT = 90;
  /** Hard upper bound on placement attempts so we never spin the loop. */
  private static readonly MAX_ATTEMPTS = 600;

  constructor(scene: BABYLON.Scene, seed: number = 0xC0FFEE) {
    this.scene = scene;
    this.buildMaterials();
    this.scatter(seed);
    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());
    console.log(
      `[AlienFoliageSystem] Initialized — placed ${this.plants.length} alien plants`,
    );
  }

  setPlayerPosition(pos: BABYLON.Vector3): void {
    this.playerPos.copyFrom(pos);
  }

  getPlantCount(): number {
    return this.plants.length;
  }

  // --- placement ---

  private buildMaterials(): void {
    // Trunks share one organic-bark material across all preset variants —
    // alien tints (deep teal-purple) keep them distinct from city props.
    const trunk = new BABYLON.StandardMaterial("alienFoliageTrunk", this.scene);
    trunk.diffuseColor = new BABYLON.Color3(0.16, 0.12, 0.22);
    trunk.emissiveColor = new BABYLON.Color3(0.04, 0.02, 0.06);
    trunk.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    this.materials.set("trunk", trunk);

    // Per-preset glow tint so the three plant types feel different at a
    // distance even when their trunk is identical.
    const tints: Record<LSystemPresetKey, BABYLON.Color3> = {
      alienTree: new BABYLON.Color3(0.25, 1.0, 0.55),   // bio-green
      alienBush: new BABYLON.Color3(1.0, 0.45, 0.85),   // pink/magenta
      alienCoral: new BABYLON.Color3(0.35, 0.7, 1.0),   // cyan
    };
    for (const [key, tint] of Object.entries(tints)) {
      const m = new BABYLON.StandardMaterial(`alienFoliageLeaf_${key}`, this.scene);
      m.diffuseColor = new BABYLON.Color3(0, 0, 0);
      m.emissiveColor = tint;
      m.specularColor = new BABYLON.Color3(0, 0, 0);
      m.disableLighting = true;
      this.materials.set(`leaf_${key}`, m);
    }
  }

  /** Mulberry32 PRNG — small, fast, deterministic for the same seed. */
  private static makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private scatter(seed: number): void {
    const rng = AlienFoliageSystem.makeRng(seed);
    const presetKeys = Object.keys(LSystemPresets) as LSystemPresetKey[];

    let placed = 0;
    let attempts = 0;
    while (
      placed < AlienFoliageSystem.TARGET_COUNT &&
      attempts < AlienFoliageSystem.MAX_ATTEMPTS
    ) {
      attempts++;
      // Polar candidate inside the wilderness band
      const angle = rng() * Math.PI * 2;
      const r = AlienFoliageSystem.INNER_RADIUS +
        rng() * (AlienFoliageSystem.OUTER_RADIUS - AlienFoliageSystem.INNER_RADIUS);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      if (!this.isCandidateValid(x, z)) continue;

      const presetKey = presetKeys[Math.floor(rng() * presetKeys.length)];
      this.spawnPlant(presetKey, new BABYLON.Vector3(x, 0, z), rng);
      placed++;
    }
  }

  private isCandidateValid(x: number, z: number): boolean {
    // 1) Reject near big anchors (centralised list shared with EarthFoliageSystem).
    for (const anchor of KEEPOUT_ANCHORS) {
      const dx = x - anchor.x;
      const dz = z - anchor.z;
      if (dx * dx + dz * dz < KEEPOUT_RADIUS * KEEPOUT_RADIUS) return false;
    }
    // 2) Reject too close to ANY foliage already placed (own + earth).
    if (FoliageOccupancy.tooCloseTo(x, z, AlienFoliageSystem.MIN_PLANT_SPACING)) {
      return false;
    }
    return true;
  }

  private spawnPlant(
    presetKey: LSystemPresetKey,
    origin: BABYLON.Vector3,
    rng: () => number,
  ): void {
    const config = LSystemPresets[presetKey];
    const lsystem = new LSystem(config);
    const instructions = lsystem.generateString();

    const renderer = new LSystemRenderer(this.scene, config);
    const trunkMat = this.materials.get("trunk")!;
    const leafMat = this.materials.get(`leaf_${presetKey}`)!;
    const namePrefix = `alien_plant_${this.plants.length}`;

    const result = renderer.render(instructions, origin, {
      trunkMaterial: trunkMat,
      leafMaterial: leafMat,
      namePrefix,
      rng,
      angleJitter: 0.2,
    });

    // Random yaw so identical configs don't read as obvious clones in a row.
    result.root.rotation.y = rng() * Math.PI * 2;
    // Mild scale variation so each plant feels handmade (0.85 .. 1.25).
    const s = 0.85 + rng() * 0.4;
    result.root.scaling.setAll(s);

    this.plants.push({ root: result.root, pos: origin.clone() });
    // Register with the shared occupancy so EarthFoliageSystem's scatter
    // pass sees this point and avoids spawning on top of it.
    FoliageOccupancy.register(origin.x, origin.z);
  }

  // --- per-frame culling ---

  private tick(): void {
    for (const plant of this.plants) {
      const dx = this.playerPos.x - plant.pos.x;
      const dy = this.playerPos.y - plant.pos.y;
      const dz = this.playerPos.z - plant.pos.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      const enabled = plant.root.isEnabled(false);
      if (enabled && dSq > AlienFoliageSystem.CULL_DISTANCE_SQ) {
        plant.root.setEnabled(false);
      } else if (!enabled && dSq < AlienFoliageSystem.SHOW_DISTANCE_SQ) {
        plant.root.setEnabled(true);
      }
    }
  }

  /** Show/hide every alien plant in one go — bypasses the per-frame
   *  distance culler so SpaceLevelSystem can guarantee none render in
   *  the orbital scene. The culler still operates as normal once the
   *  plants are re-enabled (it'll re-cull anything outside its radius). */
  setVisible(visible: boolean): void {
    for (const plant of this.plants) {
      try { plant.root.setEnabled(visible); } catch {}
    }
  }

  /**
   * Densely scatter plants inside a circular zone (used by the Sanctuary
   * to crank up organic life around the village). Bypasses the global
   * wilderness-band restriction and uses a tighter spacing so the area
   * actually feels like an alien biome.
   *
   * Returns a disposer that removes only the plants this call placed —
   * so the Sanctuary can wipe its added foliage when the player warps
   * out without nuking the world's regular plants.
   *
   * @param center   World position to scatter around (XZ; y is ignored).
   * @param radius   Cluster radius in metres.
   * @param count    Target number of plants to place.
   * @param spacing  Minimum XZ distance between plants in this cluster.
   * @param seed     PRNG seed (deterministic for the same input).
   */
  scatterZone(
    center: BABYLON.Vector3,
    radius: number,
    count: number,
    spacing: number = 6,
    seed: number = 0xA5A5A5,
  ): () => void {
    const rng = AlienFoliageSystem.makeRng(seed);
    const presetKeys = Object.keys(LSystemPresets) as LSystemPresetKey[];
    const localPlants: Array<{ root: BABYLON.TransformNode; pos: BABYLON.Vector3 }> = [];
    const sp2 = spacing * spacing;

    let placed = 0;
    let attempts = 0;
    const maxAttempts = count * 6;
    while (placed < count && attempts < maxAttempts) {
      attempts++;
      // Polar in the local zone.
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * radius; // sqrt → uniform area distribution
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;

      // Local spacing only against this cluster — global plants are far
      // enough away that they won't conflict with sanctuary plants.
      let ok = true;
      for (const p of localPlants) {
        const dx = x - p.pos.x;
        const dz = z - p.pos.z;
        if (dx * dx + dz * dz < sp2) { ok = false; break; }
      }
      if (!ok) continue;

      const presetKey = presetKeys[Math.floor(rng() * presetKeys.length)];
      // Snapshot length so we know which entries we just appended.
      const before = this.plants.length;
      this.spawnPlant(presetKey, new BABYLON.Vector3(x, 0, z), rng);
      const after = this.plants.length;
      if (after > before) {
        localPlants.push(this.plants[after - 1]);
      }
      placed++;
    }

    // Disposer: removes only the entries we appended, in reverse order.
    return () => {
      for (const p of localPlants) {
        const idx = this.plants.indexOf(p);
        if (idx !== -1) this.plants.splice(idx, 1);
        FoliageOccupancy.unregister(p.pos.x, p.pos.z);
        try { p.root.dispose(false, false); } catch {}
      }
      localPlants.length = 0;
    };
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    for (const plant of this.plants) {
      // doNotRecurse=false (cascade to merged trunk + leaves child meshes),
      // disposeMaterialAndTextures=false (materials are shared across all
      // plants and disposed exactly once below — passing true would
      // dispose each shared material N times).
      plant.root.dispose(false, false);
    }
    // Drop our points from the shared registry so a hot-restart doesn't
    // carry stale occupancy into the next scene. Earth foliage shares
    // the same module-level registry — both call clear() on dispose so
    // whichever runs second is the no-op.
    FoliageOccupancy.clear();
    this.plants = [];
    this.materials.forEach(m => { if (!(m as any).isDisposed) m.dispose(); });
    this.materials.clear();
    console.log("[AlienFoliageSystem] Disposed");
  }
}
