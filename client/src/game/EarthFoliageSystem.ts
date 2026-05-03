import * as BABYLON from "@babylonjs/core";
import { LSystem } from "./lsystem/LSystem";
import { LSystemRenderer } from "./lsystem/LSystemRenderer";
import {
  EarthLSystemPresets,
  EarthLSystemPresetKey,
} from "./lsystem/EarthLSystemPresets";
import {
  KEEPOUT_ANCHORS,
  KEEPOUT_RADIUS,
  FoliageOccupancy,
} from "./lsystem/FoliagePlacement";

/**
 * EarthFoliageSystem
 *
 * Sister of AlienFoliageSystem. Scatters realistic terrestrial trees and
 * shrubs (oak, pine, birch, willow, shrub, fern) across the wilderness
 * band so the world has a believable mix of organic life rather than only
 * the bio-luminescent alien presets.
 *
 * Same draw-call discipline as the alien system:
 *   - Each plant is built with the shared LSystemRenderer (one merged
 *     trunk mesh + one merged leaf mesh per plant).
 *   - Materials are shared per-preset (oak trunk, oak leaf, pine trunk,
 *     pine leaf, ...) so 60+ plants only ever push 12 unique materials.
 *   - A per-frame distance culler with hysteresis flips far plants to
 *     `setEnabled(false)` to skip rendering AND picking.
 *
 * Decoration only — no collision, no damage, no pickup. Mesh names are
 * prefixed `earth_plant_` so the player's ground ray-pick predicate
 * doesn't try to stand on them. Hidden wholesale by `setVisible(false)`
 * for side-zone level swaps, mirroring the alien system's contract.
 */
export class EarthFoliageSystem {
  private scene: BABYLON.Scene;
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private plants: Array<{ root: BABYLON.TransformNode; pos: BABYLON.Vector3 }> = [];
  /** Materials keyed by preset (`trunk_oakTree`, `leaf_oakTree`, ...).
   *  Shared across every plant of the matching preset so total material
   *  count stays at 2 × preset-count regardless of plant count. */
  private materials: Map<string, BABYLON.StandardMaterial> = new Map();

  /** Wilderness band — same range AlienFoliageSystem uses, so earth and
   *  alien plants intermingle naturally without leaving a hole near the
   *  city or piling up against the mountain ring. */
  private static readonly INNER_RADIUS = 90;
  private static readonly OUTER_RADIUS = 540;
  /** Min XZ spacing between two earth plants. Slightly tighter than the
   *  alien spacing so earth foliage feels denser (real woodland reads as
   *  packed even at low plant counts). Cross-system overlap is also
   *  guarded by the shared FoliageOccupancy registry. */
  private static readonly MIN_PLANT_SPACING = 10;
  private static readonly CULL_DISTANCE_SQ = 220 * 220;
  private static readonly SHOW_DISTANCE_SQ = 215 * 215;
  /** Earth target — slightly fewer than alien (which is at 90) so the
   *  total wilderness density doesn't double when both systems run. */
  private static readonly TARGET_COUNT = 70;
  private static readonly MAX_ATTEMPTS = 600;

  constructor(scene: BABYLON.Scene, seed: number = 0xEA471C) {
    this.scene = scene;
    this.buildMaterials();
    this.scatter(seed);
    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());
    console.log(
      `[EarthFoliageSystem] Initialized — placed ${this.plants.length} earth plants`,
    );
  }

  setPlayerPosition(pos: BABYLON.Vector3): void {
    this.playerPos.copyFrom(pos);
  }

  getPlantCount(): number {
    return this.plants.length;
  }

  // --- materials ---

  /** Per-preset trunk + leaf materials. Birch in particular needs its own
   *  near-white bark to read correctly; oak/pine/willow share a similar
   *  brown family but with subtle hue shifts so a stand of mixed trees
   *  doesn't look like clones in a row. Leaves use only diffuse colour
   *  (no emissive) so realistic foliage doesn't compete with the alien
   *  glow plants for visual attention. */
  private buildMaterials(): void {
    const trunkColors: Record<EarthLSystemPresetKey, BABYLON.Color3> = {
      oakTree:    new BABYLON.Color3(0.30, 0.18, 0.10), // dark brown
      pineTree:   new BABYLON.Color3(0.25, 0.14, 0.08), // very dark brown
      birchTree:  new BABYLON.Color3(0.86, 0.84, 0.78), // pale white-grey
      willowTree: new BABYLON.Color3(0.32, 0.22, 0.14), // grey-brown
      shrub:      new BABYLON.Color3(0.28, 0.18, 0.10), // matches oak
      fernShrub:  new BABYLON.Color3(0.20, 0.30, 0.10), // green stem
    };
    const leafColors: Record<EarthLSystemPresetKey, BABYLON.Color3> = {
      oakTree:    new BABYLON.Color3(0.18, 0.42, 0.16), // deep forest green
      pineTree:   new BABYLON.Color3(0.10, 0.28, 0.18), // dark blue-green
      birchTree:  new BABYLON.Color3(0.55, 0.70, 0.28), // yellow-green
      willowTree: new BABYLON.Color3(0.45, 0.62, 0.32), // pale sage
      shrub:      new BABYLON.Color3(0.25, 0.50, 0.22), // medium green
      fernShrub:  new BABYLON.Color3(0.30, 0.55, 0.22), // fresh fern green
    };

    for (const key of Object.keys(EarthLSystemPresets) as EarthLSystemPresetKey[]) {
      const trunk = new BABYLON.StandardMaterial(`earthFoliageTrunk_${key}`, this.scene);
      trunk.diffuseColor = trunkColors[key];
      // Faint self-lit so trunks aren't pitch black at night.
      trunk.emissiveColor = trunkColors[key].scale(0.08);
      trunk.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
      this.materials.set(`trunk_${key}`, trunk);

      const leaf = new BABYLON.StandardMaterial(`earthFoliageLeaf_${key}`, this.scene);
      leaf.diffuseColor = leafColors[key];
      // A small emissive component keeps the canopy readable through fog
      // and at dusk, but stays well below the alien-leaf glow level so
      // these still read as ordinary plants.
      leaf.emissiveColor = leafColors[key].scale(0.18);
      leaf.specularColor = new BABYLON.Color3(0, 0, 0);
      this.materials.set(`leaf_${key}`, leaf);
    }
  }

  // --- placement ---

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
    const rng = EarthFoliageSystem.makeRng(seed);
    const presetKeys = Object.keys(EarthLSystemPresets) as EarthLSystemPresetKey[];

    let placed = 0;
    let attempts = 0;
    while (
      placed < EarthFoliageSystem.TARGET_COUNT &&
      attempts < EarthFoliageSystem.MAX_ATTEMPTS
    ) {
      attempts++;
      const angle = rng() * Math.PI * 2;
      const r = EarthFoliageSystem.INNER_RADIUS +
        rng() * (EarthFoliageSystem.OUTER_RADIUS - EarthFoliageSystem.INNER_RADIUS);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      if (!this.isCandidateValid(x, z)) continue;

      const presetKey = presetKeys[Math.floor(rng() * presetKeys.length)];
      this.spawnPlant(presetKey, new BABYLON.Vector3(x, 0, z), rng);
      placed++;
    }
  }

  private isCandidateValid(x: number, z: number): boolean {
    for (const anchor of KEEPOUT_ANCHORS) {
      const dx = x - anchor.x;
      const dz = z - anchor.z;
      if (dx * dx + dz * dz < KEEPOUT_RADIUS * KEEPOUT_RADIUS) return false;
    }
    // Cross-system anti-overlap: rejects collisions with both alien and
    // earth plants placed earlier in the same scene.
    if (FoliageOccupancy.tooCloseTo(x, z, EarthFoliageSystem.MIN_PLANT_SPACING)) {
      return false;
    }
    return true;
  }

  private spawnPlant(
    presetKey: EarthLSystemPresetKey,
    origin: BABYLON.Vector3,
    rng: () => number,
  ): void {
    const config = EarthLSystemPresets[presetKey];
    const lsystem = new LSystem(config);
    const instructions = lsystem.generateString();

    const renderer = new LSystemRenderer(this.scene, config);
    const trunkMat = this.materials.get(`trunk_${presetKey}`)!;
    const leafMat = this.materials.get(`leaf_${presetKey}`)!;
    const namePrefix = `earth_plant_${this.plants.length}`;

    const result = renderer.render(instructions, origin, {
      trunkMaterial: trunkMat,
      leafMaterial: leafMat,
      namePrefix,
      rng,
      // Real trees twist a bit at every joint — slightly more jitter than
      // the alien plants reads as natural rather than algorithmic.
      angleJitter: 0.25,
      // Bigger leaf clumps so the canopy reads as foliage at distance
      // (not as a single sphere on a stick).
      leafRadiusScale: 2.2,
    });

    result.root.rotation.y = rng() * Math.PI * 2;
    // Per-preset scale variation: trees get a wider scale band so a
    // mature oak reads as bigger than a sapling shrub.
    const isTree = presetKey === "oakTree" || presetKey === "pineTree"
      || presetKey === "birchTree" || presetKey === "willowTree";
    const s = isTree ? (1.0 + rng() * 0.8) : (0.7 + rng() * 0.5);
    result.root.scaling.setAll(s);

    this.plants.push({ root: result.root, pos: origin.clone() });
    // Register with the shared occupancy so AlienFoliageSystem (or a
    // later scatter pass) sees this point as already claimed.
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
      if (enabled && dSq > EarthFoliageSystem.CULL_DISTANCE_SQ) {
        plant.root.setEnabled(false);
      } else if (!enabled && dSq < EarthFoliageSystem.SHOW_DISTANCE_SQ) {
        plant.root.setEnabled(true);
      }
    }
  }

  /** Show/hide every earth plant in one call — bypasses the per-frame
   *  distance culler so side-zones (sanctuary, space, lab) can guarantee
   *  none render in their distinct worlds. The culler resumes normal
   *  per-frame work once setVisible(true) is called again. */
  setVisible(visible: boolean): void {
    for (const plant of this.plants) {
      try { plant.root.setEnabled(visible); } catch {}
    }
  }

  /**
   * Densely scatter realistic plants inside a circular zone (used by the
   * Sanctuary or any future biome that wants a Terran-style stand of
   * trees / shrubs around a focal point). Bypasses the global wilderness
   * band restriction and uses a tighter spacing so the area actually
   * reads as woodland rather than wilderness scatter.
   *
   * Returns a disposer that removes only the plants this call placed —
   * mirrors AlienFoliageSystem.scatterZone so the caller can wipe its
   * added foliage cleanly when warping out of a side-zone.
   */
  scatterZone(
    center: BABYLON.Vector3,
    radius: number,
    count: number,
    spacing: number = 5,
    seed: number = 0xBEEF42,
  ): () => void {
    const rng = EarthFoliageSystem.makeRng(seed);
    const presetKeys = Object.keys(EarthLSystemPresets) as EarthLSystemPresetKey[];
    const localPlants: Array<{ root: BABYLON.TransformNode; pos: BABYLON.Vector3 }> = [];
    const sp2 = spacing * spacing;

    let placed = 0;
    let attempts = 0;
    const maxAttempts = count * 6;
    while (placed < count && attempts < maxAttempts) {
      attempts++;
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * radius; // sqrt → uniform area distribution
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;

      let ok = true;
      for (const p of localPlants) {
        const dx = x - p.pos.x;
        const dz = z - p.pos.z;
        if (dx * dx + dz * dz < sp2) { ok = false; break; }
      }
      if (!ok) continue;

      const presetKey = presetKeys[Math.floor(rng() * presetKeys.length)];
      const before = this.plants.length;
      this.spawnPlant(presetKey, new BABYLON.Vector3(x, 0, z), rng);
      const after = this.plants.length;
      if (after > before) {
        localPlants.push(this.plants[after - 1]);
      }
      placed++;
    }

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
      // disposeMaterialAndTextures=false (materials are shared and disposed
      // exactly once below — passing true would re-dispose them N times).
      plant.root.dispose(false, false);
    }
    // Shared occupancy is module-level; both foliage systems clear it on
    // dispose so a hot-restart starts clean. The second clear() is a
    // no-op.
    FoliageOccupancy.clear();
    this.plants = [];
    this.materials.forEach(m => { if (!(m as any).isDisposed) m.dispose(); });
    this.materials.clear();
    console.log("[EarthFoliageSystem] Disposed");
  }
}
