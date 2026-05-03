import * as BABYLON from "@babylonjs/core";
import { SkySystem } from "./SkySystem";
import { AerialEnemySystem } from "./AerialEnemySystem";

/**
 * SpaceLevelSystem — Level 5 "Orbital Front"
 * ==========================================
 * Off-canon side-zone reachable from the TRAVEL tab. Mounted by Game.tsx
 * on `LEVEL_STARTED` for level 5 (`LevelSystem.isSpacelike`) and disposed
 * when the player warps back to a non-space level.
 *
 * Visual layer:
 *   - SkySystem switched to spaceMode (starfield against vacuum, no sun
 *     disc, no horizon gradient). The shader's hemisphere gate was relaxed
 *     so stars wrap a full 360° around the player.
 *   - Giant emissive Earth sphere parked far on the horizon. It slowly
 *     orbits the player so it doesn't always sit at the same +Z angle.
 *   - 32 procedurally-sized asteroids drifting and tumbling in a band
 *     around the spawn — they're decorative props, not colliders.
 *
 * Combat layer:
 *   - Re-uses AerialEnemySystem.engage() so the existing fighter / battleship
 *     / fortress squadron spawns immediately on warp-in.
 *   - Pre-seeds two fighters and a battleship near the player so the
 *     orbital scene reads as a dogfight from frame 1, instead of waiting
 *     6–10s for the natural drip-spawn cycle.
 *   - "Drones orbiting motherships" emerges naturally: AerialEnemySystem
 *     fighters orbit whatever target they're locked to, and battleships
 *     hold a steady altitude — flying near a battleship puts the player
 *     between a slow capital ship and its escorting fighters.
 */
export class SpaceLevelSystem {
  private scene: BABYLON.Scene;
  private sky: SkySystem;
  private aerial: AerialEnemySystem;
  private playerPos: () => BABYLON.Vector3;

  /** Top-level transform — disposing it kills every mesh we spawned. */
  private root: BABYLON.TransformNode;
  private earth: BABYLON.Mesh | null = null;
  private asteroids: { mesh: BABYLON.Mesh; spin: BABYLON.Vector3; drift: BABYLON.Vector3 }[] = [];
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;

  /** Number of decorative asteroids — enough to read as a field without
   *  flooding the GPU with separate draw calls. */
  private static readonly ASTEROID_COUNT = 32;
  /** Outer radius of the asteroid band around the player spawn. */
  private static readonly ASTEROID_RADIUS = 220;
  /** Distance from the player at which Earth is parked. Far enough to feel
   *  planetary, close enough that the 600 m sphere still subtends ~30°. */
  private static readonly EARTH_DIST = 1200;

  constructor(
    scene: BABYLON.Scene,
    sky: SkySystem,
    aerial: AerialEnemySystem,
    playerPosProvider: () => BABYLON.Vector3,
  ) {
    this.scene = scene;
    this.sky = sky;
    this.aerial = aerial;
    this.playerPos = playerPosProvider;

    this.root = new BABYLON.TransformNode("spaceLevelRoot", scene);

    sky.setSpaceMode(true);
    this.buildEarth();
    this.spawnAsteroids();
    this.engageCombat();

    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());
    console.log("[SpaceLevelSystem] Orbital Front mounted");
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    this.sky.setSpaceMode(false);
    // The earth (and its halo child) and every asteroid are parented to
    // `root` — letting root.dispose() cascade is the cleanest teardown.
    // Don't double-dispose; just clear our own references first.
    this.earth = null;
    this.asteroids = [];
    try { this.root.dispose(); } catch {}
    console.log("[SpaceLevelSystem] Orbital Front disposed");
  }

  // ----------------------------------------------------------------- visuals

  /** Giant blue-marble sphere parked on the horizon. We don't bother with a
   *  textured Earth — the cell-shaded aesthetic looks better with a flat
   *  emissive blue + subtle green continents-by-noise from the diffuse fade. */
  private buildEarth(): void {
    const earth = BABYLON.MeshBuilder.CreateSphere(
      "spaceEarth",
      { diameter: 600, segments: 32 },
      this.scene,
    );
    const c = this.playerPos();
    earth.position.set(c.x, 80, c.z + SpaceLevelSystem.EARTH_DIST);
    earth.parent = this.root;
    earth.isPickable = false;
    earth.applyFog = false;
    // Render before everything else so it sits "behind" the gameplay.
    earth.renderingGroupId = 0;

    const mat = new BABYLON.StandardMaterial("spaceEarthMat", this.scene);
    mat.diffuseColor = new BABYLON.Color3(0.20, 0.50, 0.95);
    mat.emissiveColor = new BABYLON.Color3(0.10, 0.28, 0.60);
    mat.specularColor = new BABYLON.Color3(0.10, 0.20, 0.40);
    earth.material = mat;
    this.earth = earth;

    // A faint cyan halo ring suggests an atmosphere without needing a
    // dedicated atmosphere shader.
    const halo = BABYLON.MeshBuilder.CreateSphere(
      "spaceEarthHalo",
      { diameter: 660, segments: 24 },
      this.scene,
    );
    halo.position.copyFrom(earth.position);
    halo.parent = earth;
    halo.isPickable = false;
    halo.applyFog = false;
    halo.position.set(0, 0, 0); // parented; sit on top of earth
    const haloMat = new BABYLON.StandardMaterial("spaceEarthHaloMat", this.scene);
    haloMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    haloMat.emissiveColor = new BABYLON.Color3(0.25, 0.55, 0.95);
    haloMat.alpha = 0.18;
    haloMat.backFaceCulling = false;
    halo.material = haloMat;
  }

  /** Random asteroids in a band around the player spawn. Each gets its own
   *  spin axis + slight horizontal drift so the field never feels static. */
  private spawnAsteroids(): void {
    const center = this.playerPos();
    for (let i = 0; i < SpaceLevelSystem.ASTEROID_COUNT; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 80 + Math.random() * SpaceLevelSystem.ASTEROID_RADIUS;
      const y = 25 + Math.random() * 80;
      const size = 4 + Math.random() * 14;

      const mesh = BABYLON.MeshBuilder.CreateBox(
        `spaceAsteroid_${i}`,
        {
          width: size,
          height: size * (0.6 + Math.random() * 0.6),
          depth: size * (0.7 + Math.random() * 0.6),
        },
        this.scene,
      );
      mesh.position.set(
        center.x + Math.cos(ang) * r,
        y,
        center.z + Math.sin(ang) * r,
      );
      mesh.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      );
      mesh.parent = this.root;
      mesh.isPickable = false;

      const mat = new BABYLON.StandardMaterial(`spaceAsteroidMat_${i}`, this.scene);
      const grey = 0.25 + Math.random() * 0.2;
      mat.diffuseColor = new BABYLON.Color3(grey, grey * 0.95, grey * 0.85);
      mat.emissiveColor = new BABYLON.Color3(0.04, 0.04, 0.08);
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mesh.material = mat;

      this.asteroids.push({
        mesh,
        spin: new BABYLON.Vector3(
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.4,
        ),
        drift: new BABYLON.Vector3(
          (Math.random() - 0.5) * 1.5,
          0,
          (Math.random() - 0.5) * 1.5,
        ),
      });
    }
  }

  /** Engage AerialEnemySystem and seed a couple of close-range targets so
   *  the player has immediate enemies on warp-in instead of the 6–10 s
   *  drip-spawn delay. */
  private engageCombat(): void {
    this.aerial.engage();
    const p = this.playerPos();
    try { this.aerial.spawnFighter(p); } catch {}
    try { this.aerial.spawnFighter(p); } catch {}
    try { this.aerial.spawnBattleship(p); } catch {}
  }

  // ------------------------------------------------------------------- frame

  private tick(): void {
    const dt = this.scene.getEngine().getDeltaTime() / 1000;

    for (const a of this.asteroids) {
      a.mesh.rotation.x += a.spin.x * dt;
      a.mesh.rotation.y += a.spin.y * dt;
      a.mesh.rotation.z += a.spin.z * dt;
      a.mesh.position.addInPlace(a.drift.scale(dt));
    }

    // Slow-orbit Earth around the player so it doesn't always sit at +Z and
    // the level reads as "we're in motion through orbit". One revolution
    // every ~90 s — slow enough to feel atmospheric, fast enough to be
    // visible inside a single combat encounter.
    if (this.earth) {
      const t = performance.now() / 90_000 * Math.PI * 2;
      const c = this.playerPos();
      this.earth.position.x = c.x + Math.cos(t) * SpaceLevelSystem.EARTH_DIST;
      this.earth.position.z = c.z + Math.sin(t) * SpaceLevelSystem.EARTH_DIST;
    }
  }
}
