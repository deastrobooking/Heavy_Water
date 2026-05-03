import * as BABYLON from "@babylonjs/core";
import { SkySystem } from "./SkySystem";
import { AerialEnemySystem } from "./AerialEnemySystem";
import { VehicleSystem, VehicleInstance } from "./VehicleSystem";
import type { CityGenerator } from "./CityGenerator";
import type { WeaponsSystem } from "./WeaponsSystem";
import type { SpecialWeaponsSystem } from "./SpecialWeaponsSystem";
import type { MegaBeamCannonSystem } from "./MegaBeamCannonSystem";
import type { PlayerController } from "./PlayerController";
import type { GamepadInput } from "./GamepadInput";

/** Bag of optional system handles SpaceLevelSystem can hide / disable for
 *  the duration of an orbital warp. Each one is null-checked individually
 *  so the caller can pass only the ones that exist at mount time. */
export interface SpaceLevelHandles {
  city?: CityGenerator | null;
  weapons?: WeaponsSystem | null;
  specialWeapons?: SpecialWeaponsSystem | null;
  megaCannon?: MegaBeamCannonSystem | null;
  /** Anything else exposing `setVisible(bool)`. Passed as a flat array so
   *  SpaceLevelSystem doesn't need to know each system's type — mountains,
   *  foliage, environment props, etc. all expose the same method. */
  worldVisibles?: Array<{ setVisible(visible: boolean): void } | null | undefined>;
  /** Player controller — needed so SpaceLevelSystem can sync the mounted
   *  state when it auto-enters / -exits the orbital fighter (otherwise the
   *  player camera/physics stays in on-foot mode while the vehicle drives
   *  around). */
  player?: PlayerController | null;
  /** Optional LOD culler. Suppressed for the duration of the orbital warp
   *  so the hidden city can't flip back on as the player flies around
   *  near previously-culled sectors. */
  lodCull?: { setSuppressed(b: boolean): void } | null;
  /** Optional gamepad input. Flipped into spacecraft mode on warp-in so
   *  RT/LT both fire weapons (LT also triggers the Mega Beam Cannon combo)
   *  instead of throttle/brake — the orbital fighter has its throttle
   *  locked by VehicleSystem.setForceForward, so the vehicle KeyW/KeyS
   *  mapping is useless and the player would otherwise have no way to
   *  shoot from a controller. */
  gamepad?: GamepadInput | null;
}

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
  private vehicles: VehicleSystem | null;
  private handles: SpaceLevelHandles;
  /** Visibles we hid on mount; restored on dispose. */
  private hiddenVisibles: Array<{ setVisible(v: boolean): void }> = [];

  /** Top-level transform — disposing it kills every mesh we spawned. */
  private root: BABYLON.TransformNode;
  private earth: BABYLON.Mesh | null = null;
  private asteroids: { mesh: BABYLON.Mesh; spin: BABYLON.Vector3; drift: BABYLON.Vector3 }[] = [];
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  /** The fighter we spawned + entered the player into on warp-in. Tracked
   *  so dispose() can remove it cleanly when the player warps back to a
   *  ground level. */
  private spawnedFighter: VehicleInstance | null = null;

  /** Number of decorative asteroids — enough to read as a field without
   *  flooding the GPU with separate draw calls. Bumped from 32 → 64 when
   *  the field switched from a flat horizontal band to a full spherical
   *  shell around the player so coverage stayed dense at every angle. */
  private static readonly ASTEROID_COUNT = 64;
  /** Outer radius of the asteroid shell around the player spawn. */
  private static readonly ASTEROID_RADIUS = 260;
  /** Distance from the player at which Earth is parked. Far enough to feel
   *  planetary, close enough that the 600 m sphere still subtends ~30°. */
  private static readonly EARTH_DIST = 1200;
  /** Altitude the orbital fighter spawns at — high enough above the
   *  hidden ground plane that even the few obstructions that aren't
   *  toggled off (chests/props/enemy bases) read as tiny dots far below
   *  rather than visible obstacles in the player's flight path. */
  private static readonly SPAWN_ALTITUDE = 300;

  constructor(
    scene: BABYLON.Scene,
    sky: SkySystem,
    aerial: AerialEnemySystem,
    playerPosProvider: () => BABYLON.Vector3,
    vehicles: VehicleSystem | null = null,
    handles: SpaceLevelHandles = {},
  ) {
    this.scene = scene;
    this.sky = sky;
    this.aerial = aerial;
    this.playerPos = playerPosProvider;
    this.vehicles = vehicles;
    this.handles = handles;

    this.root = new BABYLON.TransformNode("spaceLevelRoot", scene);

    sky.setSpaceMode(true);
    this.hideWorldGeometry();
    // Freeze the LOD culler so the orbital scene can't accidentally
    // re-show city/platform meshes when the player flies near them.
    try { this.handles.lodCull?.setSuppressed(true); } catch {}
    // NOTE: weapons stay ENABLED in vacuum — orbital combat is the whole
    // point of L5, so the player needs to be able to shoot. The
    // setFiringEnabled gates on WeaponsSystem / SpecialWeaponsSystem /
    // MegaBeamCannonSystem are kept available (they still default to
    // true) for any future use case that does want to silence fire.
    // Re-route gamepad triggers so a controller player can actually shoot
    // in space (RT + LT both fire; LT also drives the Mega Beam Cannon).
    try { this.handles.gamepad?.setSpacecraftMode(true); } catch {}
    this.buildEarth();
    this.spawnAsteroids();
    this.spawnAndEnterFighter();
    this.engageCombat();

    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());
    console.log("[SpaceLevelSystem] Orbital Front mounted");
  }

  dispose(): void {
    // Outer try/finally guarantees LOD un-suppression even if teardown
    // throws — otherwise the open world's distance culling could stay
    // permanently frozen after a single mid-dispose exception.
    try { this._disposeInner(); }
    finally { try { this.handles.lodCull?.setSuppressed(false); } catch {} }
  }

  private _disposeInner(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    this.sky.setSpaceMode(false);
    this.restoreWorldGeometry();
    // Clear the orbital aerial squadron (the 2 fighters + 1 battleship we
    // force-seeded on mount, plus any drip-spawned reinforcements). Without
    // this, repeated L5 visits stack extra aerial enemies that follow the
    // player back to ground levels, breaking difficulty pacing.
    try { this.aerial.disengageAndClear(); } catch {}
    // Drop the orbital altitude anchor so any future ground-level aerial
    // spawns return to their normal y=28/55/75 patrol altitudes.
    try { this.aerial.setSpaceCombat(false); } catch {}
    // Defensive re-enable — even though we no longer disable on mount,
    // anything else that flipped these off would otherwise leak across
    // the warp.
    this.enablePlayerWeapons();
    // Restore standard gamepad trigger mapping (vehicle = throttle/brake,
    // foot = LMB/KeyJ). Important: do this before player.setMounted(null)
    // so any held trigger is released under the spacecraft binding.
    try { this.handles.gamepad?.setSpacecraftMode(false); } catch {}
    // Release the perpetual-cruise lock on the way out so warping back to
    // a ground level lets the player throttle/brake their ATV normally.
    if (this.vehicles) {
      try { this.vehicles.setForceForward(false); } catch {}
    }
    // Sync the on-foot transition on the player controller — mirror of the
    // setMounted call we made on entry.
    try { this.handles.player?.setMounted(null); } catch {}
    // Eject the player from the orbital fighter and despawn the vehicle so
    // we don't leak it across warps. exit() is a no-op if the player has
    // already manually exited (e.g. tapped F mid-fight). We then call
    // despawn() (added to VehicleSystem) to also splice the instance out
    // of the internal `vehicles` array so it doesn't accumulate.
    if (this.vehicles && this.spawnedFighter) {
      try { this.vehicles.despawn(this.spawnedFighter); } catch {}
      this.spawnedFighter = null;
    }
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
    // Anchor Earth at the orbital altitude so it sits on the player's
    // horizon instead of below it.
    earth.position.set(c.x, SpaceLevelSystem.SPAWN_ALTITUDE, c.z + SpaceLevelSystem.EARTH_DIST);
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

  /** Random asteroids distributed in a SPHERICAL shell around the player
   *  spawn so the field reads as proper zero-g space — earlier the field
   *  was a flat horizontal band at y=25–105, which left the upper / lower
   *  hemispheres empty and broke the illusion of orbit once the player
   *  pitched up or down. Each rock gets its own spin axis + slight drift
   *  so the field never feels static. */
  private spawnAsteroids(): void {
    const center = this.playerPos();
    const baseY = SpaceLevelSystem.SPAWN_ALTITUDE;
    for (let i = 0; i < SpaceLevelSystem.ASTEROID_COUNT; i++) {
      // Uniform direction on the unit sphere (Marsaglia method) so the
      // field has even angular density instead of clustering at the poles.
      let dx: number, dy: number, dz: number, ml: number;
      do {
        dx = Math.random() * 2 - 1;
        dy = Math.random() * 2 - 1;
        dz = Math.random() * 2 - 1;
        ml = dx * dx + dy * dy + dz * dz;
      } while (ml > 1 || ml < 0.0001);
      const norm = 1 / Math.sqrt(ml);
      dx *= norm; dy *= norm; dz *= norm;
      const r = 90 + Math.random() * SpaceLevelSystem.ASTEROID_RADIUS;
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
        center.x + dx * r,
        baseY + dy * r,
        center.z + dz * r,
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

  /** Hide every piece of the ground world (city buildings, ground plane,
   *  walkable platforms, mountains, foliage, environment props, etc.) so
   *  the orbital scene shows only the void backdrop + asteroids + Earth.
   *  We use `setEnabled(false)` so render-culling skips them entirely. */
  private hideWorldGeometry(): void {
    if (this.handles.city) {
      try { this.handles.city.setVisible(false); } catch {}
    }
    if (this.handles.worldVisibles) {
      for (const sys of this.handles.worldVisibles) {
        if (!sys) continue;
        try { sys.setVisible(false); } catch {}
        this.hiddenVisibles.push(sys);
      }
    }
  }

  private restoreWorldGeometry(): void {
    if (this.handles.city) {
      try { this.handles.city.setVisible(true); } catch {}
    }
    for (const sys of this.hiddenVisibles) {
      try { sys.setVisible(true); } catch {}
    }
    this.hiddenVisibles = [];
  }

  /** Suppress all player firing in vacuum — primary weapons, elemental
   *  specials, and the Mega Beam Cannon all check their `firingEnabled`
   *  master gate before discharging. */
  private disablePlayerWeapons(): void {
    try { this.handles.weapons?.setFiringEnabled(false); } catch {}
    try { this.handles.specialWeapons?.setFiringEnabled(false); } catch {}
    try { this.handles.megaCannon?.setFiringEnabled(false); } catch {}
  }

  private enablePlayerWeapons(): void {
    try { this.handles.weapons?.setFiringEnabled(true); } catch {}
    try { this.handles.specialWeapons?.setFiringEnabled(true); } catch {}
    try { this.handles.megaCannon?.setFiringEnabled(true); } catch {}
  }

  /** Spawn a CometFighter at the player's spawn altitude and have the
   *  vehicle system "enter" it so the player wakes up already piloting a
   *  spacecraft. Ground levels get an ATV/fighter sitting on the tarmac
   *  for the player to walk up to and press F — orbital combat skips that
   *  step because the player is in vacuum from frame one. */
  private spawnAndEnterFighter(): void {
    if (!this.vehicles) return;
    const p = this.playerPos();
    // Spawn a few metres ahead of the player, parked WAY up at the
    // orbital altitude so the player drops into vacuum well above any
    // residual ground-level props rather than skimming along the
    // (now-hidden) ground plane.
    const spawnPos = new BABYLON.Vector3(p.x, SpaceLevelSystem.SPAWN_ALTITUDE, p.z + 4);
    const fighter = this.vehicles.spawnPreset("CometFighter", spawnPos);
    if (!fighter) {
      console.warn("[SpaceLevelSystem] Failed to spawn CometFighter — preset missing?");
      return;
    }
    this.spawnedFighter = fighter;
    try { this.vehicles.enter(fighter); } catch (err) {
      console.warn("[SpaceLevelSystem] vehicles.enter threw:", err);
    }
    // Mirror Game.tsx's KeyE-vehicle flow: tell the player controller it's
    // mounted so the camera/physics swap to vehicle mode. Without this the
    // player would still be in on-foot state while the fighter cruises.
    try { this.handles.player?.setMounted(fighter.meshes.root); } catch {}
    // Lock the throttle so the ship can never come to a stop in space —
    // exiting / warping out is the only way to disengage. Set after enter()
    // so the cruise speed kick takes effect on the now-active vehicle.
    // Use a slower cruise speed (28 m/s) than the ground default (55) so
    // dogfighting in vacuum is readable instead of a blur.
    try { this.vehicles.setForceForward(true, 28); } catch {}
  }

  /** Engage AerialEnemySystem and seed a couple of close-range targets so
   *  the player has immediate enemies on warp-in instead of the 6–10 s
   *  drip-spawn delay. Also flips the squadron into "orbital" altitude
   *  mode so units orbit at the player's altitude (~60 m) instead of the
   *  ground-level defaults that left bullets sailing way over their
   *  heads — the actual root cause of "weapons don't work in space". */
  private engageCombat(): void {
    // Anchor altitudes to the live player Y so units track up/down with
    // the orbital fighter as it climbs and dives.
    try { this.aerial.setSpaceCombat(true, () => this.playerPos().y); } catch {}
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
