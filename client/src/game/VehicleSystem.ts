import * as BABYLON from "@babylonjs/core";
import { VehicleFactory, VehicleMeshes, clearVehicleMaterialCache } from "./VehicleFactory";
import { VehicleDescriptor, VehicleKind, VEHICLE_PRESETS } from "./VehicleDesigner";
import { EventBus } from "./EventBus";
import { DamageType } from "./DamageSystem";
import type { WallCollider } from "./CityGenerator";

/**
 * Internal record for an unmanned vehicle currently barreling forward
 * after the player triggered Ghost Ride. Forward direction + speed are
 * frozen at eject; the vehicle ignores all input until impact / TTL.
 */
interface GhostRider {
  vehicle: VehicleInstance;
  /** Locked horizontal forward heading vector (unit length on XZ plane). */
  forward: BABYLON.Vector3;
  /** Locked forward speed in m/s. */
  speed: number;
  /** Seconds remaining before the auto-detonate fuse trips. */
  ttl: number;
}

export interface VehicleInstance {
  id: string;
  kind: VehicleKind;
  descriptor: VehicleDescriptor;
  meshes: VehicleMeshes;
  position: BABYLON.Vector3;
  velocity: BABYLON.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  hp: number;
  maxHp: number;
}

export interface VehicleInputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  boost: boolean;
}

/**
 * Hooks the host (Game.tsx) wires for Ghost Ride collision damage.
 * Each getter returns the live active list at impact-check time so the
 * ghost rider always picks up enemies/bases spawned mid-ride.
 */
export interface GhostRideTargets {
  /** Alive ground enemy meshes — each mesh.metadata.damageable.takeDamage handles the hit. */
  getGroundEnemyMeshes: () => BABYLON.Mesh[];
  /** Alive aerial enemies — { hitbox, takeDamage(amount, hitPoint) }. */
  getAerialUnits: () => Array<{ hitbox: BABYLON.Mesh; isAlive: boolean; takeDamage: (n: number, hp?: BABYLON.Vector3) => boolean }>;
  /** Damageable enemy-base structure meshes (turrets, vaults, spires). */
  getBaseStructureMeshes: () => BABYLON.Mesh[];
  /** Apply N damage to a single base structure mesh. Returns true if the
   *  mesh was a known structure and damage was applied. */
  damageBaseStructure: (mesh: BABYLON.AbstractMesh, amount: number) => boolean;
  /** Player position so the ride doesn't immediately damage the player
   *  who just ejected (we apply a no-damage radius around them for one tick). */
  getPlayerPosition: () => BABYLON.Vector3;
}

const ATV_GROUND_HEIGHT = 0.0;
const FIGHTER_MIN_ALTITUDE = 1.0;
const FIGHTER_MAX_ALTITUDE = 600.0;

export class VehicleSystem {
  private scene: BABYLON.Scene;
  private factory: VehicleFactory;
  private vehicles: VehicleInstance[] = [];
  private active: VehicleInstance | null = null;
  private getCameraYaw: () => number;
  private getCameraPitch: () => number;
  private getGroundHeight: ((x: number, z: number, currentY?: number) => number) | null = null;
  private input: VehicleInputState = { forward: false, back: false, left: false, right: false, up: false, down: false, boost: false };
  private nextId: number = 0;
  // Jump-press turbo. While `turboTimer > 0` the active vehicle's max-speed
  // cap is overridden upward (and accel bumped) to deliver a punchy burst.
  // `turboCooldown` blocks rapid re-triggers so the player can't sit on the
  // jump key for permanent overdrive.
  private turboTimer: number = 0;
  private turboCooldown: number = 0;
  private static readonly TURBO_DURATION = 0.7;
  private static readonly TURBO_COOLDOWN = 1.6;
  private wallColliders: WallCollider[] = [];
  // ----------------------------- Ghost Ride -----------------------------
  // Vehicles that have been "ghost-ridden": the player has bailed out of
  // the active vehicle while boosting, and the unmanned vehicle now barrels
  // forward at locked heading + speed until it hits something or its TTL
  // expires. On impact (or timeout) we fire a massive "large"-tier
  // explosion, AoE-damage every target inside the blast radius, and
  // despawn the vehicle. Kept on the system (rather than a free-floating
  // singleton) so dispose() cleans them up on level swap / restart.
  private ghostRiders: GhostRider[] = [];
  private ghostTargets: GhostRideTargets | null = null;
  // Lock the ghost-ride forward speed past the regular cruise cap — the
  // ride's whole point is to send the vehicle screaming into a target,
  // and the ATV/fighter caps would feel sluggish for that. Tuned per kind
  // so the ATV still tracks the ground and the fighter doesn't tunnel
  // through the entire arena in two frames.
  private static readonly GHOST_RIDE_SPEED_ATV = 60;
  private static readonly GHOST_RIDE_SPEED_FIGHTER = 110;
  // Soft fuse: if the ghost vehicle hits nothing for this long, detonate
  // anyway so it doesn't loiter forever past the play area.
  private static readonly GHOST_RIDE_TTL_SECONDS = 6.0;
  // Hit-detection radius around the ghost vehicle. Comparable to the
  // smash AoE so the impact reads as a meaningful slam, not a pixel-perfect
  // collide. The detonation blast is bigger than this trigger.
  private static readonly GHOST_RIDE_HIT_RADIUS = 4.5;
  private static readonly GHOST_RIDE_BLAST_RADIUS = 18.0;
  private static readonly GHOST_RIDE_DAMAGE = 420;
  /** When true, fighter throttle is locked — the ship cruises at full
   *  speed regardless of player input. Used by SpaceLevelSystem so the
   *  player can never stop in vacuum (orbital combat = always moving). */
  private forceForward: boolean = false;
  /** Cruise speed used when forceForward is on. Defaults to 55 (the
   *  original ground-level fighter cruise) but SpaceLevelSystem overrides
   *  it to ~28 on warp-in so the orbital fighter doesn't blow past every
   *  asteroid and dogfight target before the player can react. */
  private static readonly DEFAULT_FORCED_CRUISE_SPEED = 55;
  private forcedCruiseSpeed: number = VehicleSystem.DEFAULT_FORCED_CRUISE_SPEED;

  setBuildingColliders(colliders: WallCollider[]): void {
    this.wallColliders = colliders;
  }

  /** Lock the active fighter to perpetual forward cruise — see field doc.
   *  Optional `speed` overrides the cruise constant; passing nothing
   *  resets to the default ground-level cruise speed. */
  setForceForward(active: boolean, speed?: number): void {
    this.forceForward = active;
    this.forcedCruiseSpeed = (typeof speed === "number" && speed > 0)
      ? speed
      : VehicleSystem.DEFAULT_FORCED_CRUISE_SPEED;
    if (active && this.active && this.active.kind !== "atv") {
      this.active.speed = this.forcedCruiseSpeed;
    }
  }

  /**
   * Resolve horizontal AABB collisions between a vehicle and the city wall
   * colliders. Uses velocity direction to push the vehicle back along the
   * incoming axis (prevents tunnelling through thin walls at high speed).
   */
  private resolveVehicleWallCollisions(v: VehicleInstance, radius: number): void {
    if (this.wallColliders.length === 0) return;
    const headroom = 2.5;
    const px0 = v.position.x;
    const pz0 = v.position.z;
    const py = v.position.y;
    let px = px0;
    let pz = pz0;
    const vx = v.velocity.x;
    const vz = v.velocity.z;

    for (let i = 0; i < this.wallColliders.length; i++) {
      const w = this.wallColliders[i];
      // Vertical overlap check — vehicle ignores walls it's flying high above
      if (py + headroom < w.minY || py - 0.5 > w.maxY) continue;
      const minX = w.minX - radius;
      const maxX = w.maxX + radius;
      const minZ = w.minZ - radius;
      const maxZ = w.maxZ + radius;
      if (px < minX || px > maxX || pz < minZ || pz > maxZ) continue;

      const dxL = px - minX;
      const dxR = maxX - px;
      const dzB = pz - minZ;
      const dzF = maxZ - pz;
      const ax = Math.abs(vx);
      const az = Math.abs(vz);
      const useX = ax > az + 0.001;
      const useZ = az > ax + 0.001;
      if (useX) {
        if (vx > 0) px = minX - 0.001; else px = maxX + 0.001;
        v.velocity.x = 0;
      } else if (useZ) {
        if (vz > 0) pz = minZ - 0.001; else pz = maxZ + 0.001;
        v.velocity.z = 0;
      } else {
        const m = Math.min(dxL, dxR, dzB, dzF);
        if (m === dxL) { px = minX - 0.001; v.velocity.x = 0; }
        else if (m === dxR) { px = maxX + 0.001; v.velocity.x = 0; }
        else if (m === dzB) { pz = minZ - 0.001; v.velocity.z = 0; }
        else { pz = maxZ + 0.001; v.velocity.z = 0; }
      }
    }

    if (px !== px0) v.position.x = px;
    if (pz !== pz0) v.position.z = pz;
    if (px !== px0 || pz !== pz0) {
      // Bleed off forward speed when bumping into a wall so the ATV doesn't
      // grind helplessly into it.
      v.speed *= 0.4;
    }
  }

  constructor(scene: BABYLON.Scene, getCameraYaw: () => number, getCameraPitch: () => number) {
    this.scene = scene;
    this.factory = new VehicleFactory(scene);
    this.getCameraYaw = getCameraYaw;
    this.getCameraPitch = getCameraPitch;
    console.log("[VehicleSystem] Initialized");
  }

  setGroundHeightFn(fn: (x: number, z: number, currentY?: number) => number): void {
    this.getGroundHeight = fn;
  }

  setInput(state: Partial<VehicleInputState>): void {
    Object.assign(this.input, state);
  }

  /** Tap-jump turbo. Press Space (or the gamepad jump button) while
   *  driving for a punchy speed kick + temporary cap override. Returns
   *  true if the turbo actually fired so callers can play SFX / show
   *  a HUD ping; returns false when on cooldown or no vehicle is active. */
  triggerTurbo(): boolean {
    if (!this.active) return false;
    if (this.turboCooldown > 0 || this.turboTimer > 0) return false;
    // No-op in orbital forceForward mode. The fighter's cruise branch
    // clamps speed to its forced cruise band on every tick, so a turbo
    // kick would be erased the same frame and the cooldown would burn
    // for nothing — better to refuse the trigger and keep the HUD ping
    // honest. Hold-Shift boost is still the right tool there.
    if (this.forceForward && this.active.kind !== "atv") return false;
    this.turboTimer = VehicleSystem.TURBO_DURATION;
    this.turboCooldown = VehicleSystem.TURBO_COOLDOWN;
    // Immediate forward kick along the vehicle's current heading. ATVs
    // get a smaller bump because they're capped much lower than fighters.
    const v = this.active;
    if (v.kind === "atv") {
      v.speed = Math.max(v.speed, 24) + 16; // base ≈ cruise + 16 m/s
    } else {
      v.speed = Math.max(v.speed, 55) + 28; // fighter cruise + 28 m/s
    }
    EventBus.getInstance().emit("vehicle:turbo", { id: v.id, kind: v.kind });
    return true;
  }

  /** True while the jump-press turbo is still ramping the vehicle past
   *  its normal max-speed cap. Useful for HUD / camera FX. */
  isTurboActive(): boolean {
    return this.turboTimer > 0;
  }

  spawnPreset(presetName: string, position: BABYLON.Vector3): VehicleInstance | null {
    const desc = VEHICLE_PRESETS[presetName];
    if (!desc) return null;
    return this.spawn(desc, position);
  }

  /**
   * Removes any existing vehicle of `kind`, then spawns a fresh one of the
   * given preset at `position`. Used by the in-game "Respawn Vehicle" button.
   */
  respawnVehicle(kind: VehicleKind, presetName: string, position: BABYLON.Vector3): VehicleInstance | null {
    if (this.active && this.active.kind === kind) {
      // Don't kill the vehicle the player is currently driving
      return null;
    }
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.kind !== kind) continue;
      // Drop any pending ghost-ride entry for this vehicle BEFORE we
      // dispose its mesh — otherwise updateGhostRider keeps ticking on
      // a disposed mesh and a later detonation tries to dispose it
      // again (causing a Babylon "already disposed" warning).
      for (let g = this.ghostRiders.length - 1; g >= 0; g--) {
        if (this.ghostRiders[g].vehicle === v) this.ghostRiders.splice(g, 1);
      }
      try { v.meshes.root.dispose(); } catch {}
      this.vehicles.splice(i, 1);
    }
    return this.spawnPreset(presetName, position);
  }

  spawn(desc: VehicleDescriptor, position: BABYLON.Vector3): VehicleInstance {
    const meshes = this.factory.createVehicle(desc, position);
    const inst: VehicleInstance = {
      id: `vehicle_${this.nextId++}`,
      kind: desc.style.kind,
      descriptor: desc,
      meshes,
      position: position.clone(),
      velocity: BABYLON.Vector3.Zero(),
      yaw: 0,
      pitch: 0,
      roll: 0,
      speed: 0,
      hp: 200,
      maxHp: 200,
    };
    this.vehicles.push(inst);
    return inst;
  }

  getVehicles(): VehicleInstance[] {
    return this.vehicles.slice();
  }

  getNearest(position: BABYLON.Vector3, maxRange: number = 5.5): VehicleInstance | null {
    let best: VehicleInstance | null = null;
    let bestDist = maxRange;
    for (const v of this.vehicles) {
      if (this.active === v) continue;
      const d = BABYLON.Vector3.Distance(v.position, position);
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    return best;
  }

  getActive(): VehicleInstance | null {
    return this.active;
  }

  enter(v: VehicleInstance): void {
    this.active = v;
    v.velocity.setAll(0);
    v.speed = 0;
    EventBus.getInstance().emit("vehicle:entered", { id: v.id, kind: v.kind, name: v.descriptor.name });
  }

  /** Remove a spawned vehicle from the world (and the internal registry).
   *  Used by SpaceLevelSystem on warp-out so the orbital fighter doesn't
   *  pile up across repeat L5 visits. If the despawned vehicle is the
   *  active one, we exit() first so player state stays consistent. */
  despawn(v: VehicleInstance): void {
    if (this.active === v) {
      try { this.exit(); } catch {}
    }
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    try { v.meshes.root.dispose(); } catch {}
  }

  exit(): VehicleInstance | null {
    const v = this.active;
    if (!v) return null;
    v.velocity.setAll(0);
    v.speed = 0;
    this.active = null;
    // Clear turbo state on dismount so a re-mount can never inherit a
    // mid-burst boost window (which would otherwise let the player
    // tap-B into a standstill ghost ride immediately on re-entry).
    this.turboTimer = 0;
    this.turboCooldown = 0;
    this.input.boost = false;
    EventBus.getInstance().emit("vehicle:exited", { id: v.id });
    return v;
  }

  // -------------------------- Ghost Ride API --------------------------
  /** Wire the live target getters used by ghost-rider impact detection.
   *  Called once by Game.tsx after enemy / aerial / base systems exist. */
  setGhostRideTargets(targets: GhostRideTargets): void {
    this.ghostTargets = targets;
  }

  /** True iff the active vehicle is currently in a "boosting" state — the
   *  jump-press turbo window is open OR the player is holding the boost
   *  input (Shift / R3 in vehicle context). Used by Game.tsx as the gate
   *  for the ghost-ride hotkey so the player can't dump a parked vehicle
   *  into a base by tapping B from a standstill. */
  isBoosting(): boolean {
    if (!this.active) return false;
    return this.turboTimer > 0 || this.input.boost;
  }

  /**
   * GHOST RIDE THE WHIP. While the player is mounted AND boosting, this
   * detaches the active vehicle from player control, locks it into a
   * forward-only trajectory at high speed, and queues it for impact-
   * detonation in the regular update loop.
   *
   * Returns:
   *  - `vehicle`: the vehicle (now in ghost-ride mode, no longer this.active)
   *  - `ejectVelocity`: a side+up shove vector for the player so they
   *     somersault clear of the moving vehicle (Game.tsx feeds this into
   *     PlayerController.triggerSomersaultEject).
   *  Returns null when the trigger isn't valid (no active vehicle, not
   *  boosting, or already in a ghost ride).
   */
  startGhostRide(): { vehicle: VehicleInstance; ejectVelocity: BABYLON.Vector3 } | null {
    if (!this.active) return null;
    if (!this.isBoosting()) return null;
    const v = this.active;

    // Lock the heading. We use the vehicle's CURRENT yaw (not camera yaw)
    // so the ride goes wherever the vehicle was actually pointed at the
    // moment of eject — important for fighters where camera pitch is
    // already baked into v.pitch and we want the ride to keep that arc.
    const cp = Math.cos(-v.pitch);
    const sp = Math.sin(-v.pitch);
    const heading = v.kind === "atv"
      ? new BABYLON.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw))
      : new BABYLON.Vector3(Math.sin(v.yaw) * cp, sp, Math.cos(v.yaw) * cp);
    heading.normalize();

    // Lock the speed at the higher of (current speed, kind floor). The
    // floor guarantees the ride feels like a slam even if the player
    // tapped boost from a slow roll.
    const floor = v.kind === "atv"
      ? VehicleSystem.GHOST_RIDE_SPEED_ATV
      : VehicleSystem.GHOST_RIDE_SPEED_FIGHTER;
    const lockedSpeed = Math.max(Math.abs(v.speed), floor);

    // Pop the vehicle off the active slot WITHOUT calling exit() (exit
    // zeroes speed; we need the locked speed). Manually fire the same
    // event so MultiplayerSystem / HUD listeners stay in sync.
    this.active = null;
    // Clear the boost-state inputs so the next mount can't re-trigger a
    // ghost ride from latched-true Shift / turbo timers. Without this,
    // a player who exited mid-boost re-mounts and is immediately
    // "boosting" by isBoosting()'s definition (input.boost stays true
    // because the keyup gate in Game.tsx ignores keys while no vehicle
    // is active).
    this.turboTimer = 0;
    this.turboCooldown = 0;
    this.input.boost = false;
    EventBus.getInstance().emit("vehicle:exited", { id: v.id });

    this.ghostRiders.push({
      vehicle: v,
      forward: heading,
      speed: lockedSpeed,
      ttl: VehicleSystem.GHOST_RIDE_TTL_SECONDS,
    });

    // Eject the player perpendicular to the heading + upward — a clean
    // sideways somersault that clears the vehicle's path. We pick the
    // side based on the vehicle's right vector (yaw) so the player
    // always lands clear regardless of camera angle. The vertical
    // component is just enough to clear the ATV roof / fighter spine.
    const right = new BABYLON.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
    const ejectVelocity = right.scale(11).add(new BABYLON.Vector3(0, 8, 0));

    EventBus.getInstance().emit("vehicle:ghostRideStarted", { id: v.id, kind: v.kind });
    return { vehicle: v, ejectVelocity };
  }

  /** Tick a single ghost-ride vehicle. Advances it forward, ground-clamps
   *  ATVs, scans for enemy / aerial / base structure impacts inside the
   *  hit radius, and detonates on first contact OR when TTL hits zero. */
  private updateGhostRider(g: GhostRider, dt: number): boolean {
    const v = g.vehicle;
    g.ttl -= dt;

    // Advance position along the locked heading at the locked speed.
    // No camera/input influence — that's the whole point of ghost ride.
    v.position.x += g.forward.x * g.speed * dt;
    v.position.y += g.forward.y * g.speed * dt;
    v.position.z += g.forward.z * g.speed * dt;
    v.velocity.x = g.forward.x * g.speed;
    v.velocity.y = g.forward.y * g.speed;
    v.velocity.z = g.forward.z * g.speed;
    v.speed = g.speed;

    // ATVs ride the ground; fighters keep their pitched arc. We don't
    // touch yaw/pitch/roll — the locked-in pose is part of the visual.
    if (v.kind === "atv") {
      const groundY = this.getGroundHeight
        ? this.getGroundHeight(v.position.x, v.position.z, v.position.y)
        : 0;
      v.position.y += (groundY + ATV_GROUND_HEIGHT - v.position.y) * Math.min(1, dt * 12);
    } else {
      const groundY = this.getGroundHeight
        ? this.getGroundHeight(v.position.x, v.position.z, v.position.y)
        : 0;
      const minY = groundY + FIGHTER_MIN_ALTITUDE;
      // If the fighter ghost would clip the ground, that itself counts
      // as an impact — detonate on the deck instead of skimming under it.
      if (v.position.y < minY) {
        v.position.y = minY;
        this.detonateGhostRider(g);
        return true;
      }
    }

    // Apply transform to mesh (mirrors the active-vehicle path).
    v.meshes.root.position.copyFrom(v.position);
    v.meshes.root.rotation.x = v.pitch;
    v.meshes.root.rotation.y = v.yaw;
    v.meshes.root.rotation.z = v.roll;
    if (v.kind === "atv") {
      const spin = -g.speed * dt * 1.6;
      for (const w of v.meshes.wheels) w.rotation.x += spin;
    }
    const t = performance.now() * 0.01;
    const pulse = 1.0 + Math.sin(t) * 0.4 + Math.abs(g.speed) * 0.012;
    for (const th of v.meshes.thrusters) {
      th.scaling.set(1 + pulse * 0.3, 1 + pulse * 0.3, 1 + pulse * 0.5);
    }

    // Wall collision = impact.
    if (this.checkGhostWallImpact(v)) {
      this.detonateGhostRider(g);
      return true;
    }

    // Target-list scan. Skip if Game.tsx never wired the targets (e.g.
    // peaceful side-zones where ghost ride is still allowed but there's
    // simply nothing to hit until the TTL trips).
    if (this.ghostTargets) {
      const hitRSq = VehicleSystem.GHOST_RIDE_HIT_RADIUS * VehicleSystem.GHOST_RIDE_HIT_RADIUS;
      const ground = this.ghostTargets.getGroundEnemyMeshes();
      for (let i = 0; i < ground.length; i++) {
        const m = ground[i];
        const dx = m.position.x - v.position.x;
        const dy = m.position.y - v.position.y;
        const dz = m.position.z - v.position.z;
        if (dx * dx + dy * dy + dz * dz <= hitRSq) {
          this.detonateGhostRider(g);
          return true;
        }
      }
      const aerial = this.ghostTargets.getAerialUnits();
      for (let i = 0; i < aerial.length; i++) {
        const u = aerial[i];
        if (!u.isAlive) continue;
        const dx = u.hitbox.position.x - v.position.x;
        const dy = u.hitbox.position.y - v.position.y;
        const dz = u.hitbox.position.z - v.position.z;
        // Aerial hit radius is generous — the ride is pointed at them
        // intentionally and we want the slam to feel reliable.
        if (dx * dx + dy * dy + dz * dz <= hitRSq * 1.8) {
          this.detonateGhostRider(g);
          return true;
        }
      }
      const bases = this.ghostTargets.getBaseStructureMeshes();
      for (let i = 0; i < bases.length; i++) {
        const m = bases[i];
        const dx = m.position.x - v.position.x;
        const dy = m.position.y - v.position.y;
        const dz = m.position.z - v.position.z;
        if (dx * dx + dy * dy + dz * dz <= hitRSq * 1.5) {
          this.detonateGhostRider(g);
          return true;
        }
      }
    }

    if (g.ttl <= 0) {
      this.detonateGhostRider(g);
      return true;
    }
    return false;
  }

  /** Cheap AABB-style wall scan for ghost riders. Mirrors the vertical
   *  + horizontal overlap check inside resolveVehicleWallCollisions but
   *  treats any contact as a hit instead of pushing the vehicle out
   *  (ghost rides explode on walls). */
  private checkGhostWallImpact(v: VehicleInstance): boolean {
    if (this.wallColliders.length === 0) return false;
    const r = 2.5;
    const headroom = 2.5;
    const px = v.position.x;
    const pz = v.position.z;
    const py = v.position.y;
    for (let i = 0; i < this.wallColliders.length; i++) {
      const w = this.wallColliders[i];
      // Vertical overlap — fighters cruising well above the wall don't
      // detonate on it (matches the existing vehicle-vs-wall behavior).
      if (py + headroom < w.minY || py - 0.5 > w.maxY) continue;
      const minX = w.minX - r;
      const maxX = w.maxX + r;
      const minZ = w.minZ - r;
      const maxZ = w.maxZ + r;
      if (px >= minX && px <= maxX && pz >= minZ && pz <= maxZ) return true;
    }
    return false;
  }

  /** Fire the explosion, AoE-damage every ghost-ride target inside the
   *  blast radius, despawn the vehicle mesh, and remove from registry. */
  private detonateGhostRider(g: GhostRider): void {
    const v = g.vehicle;
    const center = v.position.clone();
    const bus = EventBus.getInstance();

    bus.emit("effect:explosion", {
      position: center,
      tier: "large",
      radius: VehicleSystem.GHOST_RIDE_BLAST_RADIUS,
      // Hot orange-red detonation — distinct from the cyan smash shock.
      color: new BABYLON.Color3(1.0, 0.55, 0.18),
      shake: 0.7,
      shockwave: true,
    });
    bus.emit("effect:cameraShake", { intensity: 0.7, duration: 0.45 });
    bus.emit("sound:play", { url: "/sounds/hit.mp3", volume: 1.0, playbackRate: 0.5 });

    // AoE damage with linear falloff to the blast edge.
    const r = VehicleSystem.GHOST_RIDE_BLAST_RADIUS;
    const rSq = r * r;
    if (this.ghostTargets) {
      // Don't friendly-fire the ejected player. We skip damage for any
      // target inside a small radius around the player when the radius
      // also intersects the player. The actual `damage:player` path is
      // never used by ghost ride so the player can't self-kill via the
      // shockwave even at point-blank.

      const ground = this.ghostTargets.getGroundEnemyMeshes();
      for (let i = 0; i < ground.length; i++) {
        const m = ground[i];
        const dx = m.position.x - center.x;
        const dy = m.position.y - center.y;
        const dz = m.position.z - center.z;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > rSq) continue;
        const meta: any = m.metadata;
        if (!(meta && meta.damageable && typeof meta.damageable.takeDamage === "function")) continue;
        const falloff = Math.max(0.4, 1 - Math.sqrt(dSq) / r);
        meta.damageable.takeDamage({
          amount: VehicleSystem.GHOST_RIDE_DAMAGE * falloff,
          damageType: DamageType.Explosive,
          hitPoint: m.position.clone(),
          knockbackForce: 360,
        });
      }

      const aerial = this.ghostTargets.getAerialUnits();
      for (let i = 0; i < aerial.length; i++) {
        const u = aerial[i];
        if (!u.isAlive) continue;
        const dx = u.hitbox.position.x - center.x;
        const dy = u.hitbox.position.y - center.y;
        const dz = u.hitbox.position.z - center.z;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > rSq * 1.6) continue;
        const falloff = Math.max(0.35, 1 - Math.sqrt(dSq) / (r * 1.3));
        u.takeDamage(VehicleSystem.GHOST_RIDE_DAMAGE * 0.85 * falloff, u.hitbox.position.clone());
      }

      const bases = this.ghostTargets.getBaseStructureMeshes();
      for (let i = 0; i < bases.length; i++) {
        const m = bases[i];
        const dx = m.position.x - center.x;
        const dy = m.position.y - center.y;
        const dz = m.position.z - center.z;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > rSq) continue;
        const falloff = Math.max(0.4, 1 - Math.sqrt(dSq) / r);
        this.ghostTargets.damageBaseStructure(m, VehicleSystem.GHOST_RIDE_DAMAGE * falloff);
      }
    }

    bus.emit("vehicle:ghostRideDetonated", { id: v.id, kind: v.kind, position: center });

    // Despawn the vehicle mesh and remove from the registry.
    try { v.meshes.root.dispose(); } catch {}
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  update(dt: number): void {
    // Always tick ghost riders (they live independently of `active`).
    if (this.ghostRiders.length > 0) {
      for (let i = this.ghostRiders.length - 1; i >= 0; i--) {
        const done = this.updateGhostRider(this.ghostRiders[i], dt);
        if (done) this.ghostRiders.splice(i, 1);
      }
    }
    // Tick the jump-turbo timers UNCONDITIONALLY (even when dismounted)
    // so timers can never freeze across an exit + re-mount window. If
    // we gated this behind `this.active`, a player who exited mid-burst
    // would re-mount with the same `turboTimer` value and immediately
    // satisfy `isBoosting()` from a standstill.
    if (this.turboTimer > 0) {
      this.turboTimer -= dt;
      if (this.turboTimer < 0) this.turboTimer = 0;
    }
    if (this.turboCooldown > 0) {
      this.turboCooldown -= dt;
      if (this.turboCooldown < 0) this.turboCooldown = 0;
    }
    if (!this.active) return;
    const v = this.active;
    if (v.kind === "atv") this.updateATV(v, dt);
    else this.updateFighter(v, dt);

    // Apply transform to mesh
    v.meshes.root.position.copyFrom(v.position);
    v.meshes.root.rotation.x = v.pitch;
    v.meshes.root.rotation.y = v.yaw;
    v.meshes.root.rotation.z = v.roll;

    // Spin wheels
    if (v.kind === "atv") {
      const spin = -v.speed * dt * 1.6;
      for (const w of v.meshes.wheels) {
        w.rotation.x += spin;
      }
    }

    // Pulse thrusters
    const t = performance.now() * 0.01;
    const pulse = 0.7 + Math.sin(t) * 0.3 + Math.abs(v.speed) * 0.01;
    for (const th of v.meshes.thrusters) {
      th.scaling.set(1 + pulse * 0.2, 1 + pulse * 0.2, 1 + pulse * 0.4);
    }
  }

  private updateATV(v: VehicleInstance, dt: number): void {
    const camYaw = this.getCameraYaw();
    const targetYaw = camYaw;
    // Smoothly steer toward camera yaw
    const yawDelta = ((targetYaw - v.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    v.yaw += yawDelta * Math.min(1, dt * 6);

    // Throttle. Turbo (Space-tap) raises both the cap and the accel for a
    // short window so the burst feels meaty, not just a number bump.
    const turboOn = this.turboTimer > 0;
    const accel = turboOn ? 38 : 22;
    const maxSpeed = turboOn ? 56 : (this.input.boost ? 38 : 24);
    const drag = 4;
    if (this.input.forward) v.speed += accel * dt;
    if (this.input.back) v.speed -= accel * 0.7 * dt;
    if (!this.input.forward && !this.input.back) {
      if (v.speed > 0) v.speed = Math.max(0, v.speed - drag * dt);
      else if (v.speed < 0) v.speed = Math.min(0, v.speed + drag * dt);
    }
    v.speed = Math.max(-maxSpeed * 0.4, Math.min(maxSpeed, v.speed));

    // Strafe (light)
    let strafe = 0;
    if (this.input.left) strafe -= 1;
    if (this.input.right) strafe += 1;

    const forward = new BABYLON.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    const right = new BABYLON.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));

    v.velocity.x = forward.x * v.speed + right.x * strafe * 6;
    v.velocity.z = forward.z * v.speed + right.z * strafe * 6;

    v.position.x += v.velocity.x * dt;
    v.position.z += v.velocity.z * dt;

    // Bump against building walls
    this.resolveVehicleWallCollisions(v, 2.5);

    // Stick to ground (queries ramps + sky-track + city ground via the
    // closure provided by Game.tsx).
    const groundY = this.getGroundHeight
      ? this.getGroundHeight(v.position.x, v.position.z, v.position.y)
      : 0;
    const targetY = groundY + ATV_GROUND_HEIGHT;
    v.position.y += (targetY - v.position.y) * Math.min(1, dt * 12);

    // Lean roll based on strafe
    v.roll += (-strafe * 0.15 - v.roll) * Math.min(1, dt * 8);
    v.pitch = 0;
  }

  private updateFighter(v: VehicleInstance, dt: number): void {
    const camYaw = this.getCameraYaw();
    const camPitch = this.getCameraPitch();

    // Smoothly orient toward camera
    const yawDelta = ((camYaw - v.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    v.yaw += yawDelta * Math.min(1, dt * 4);
    v.pitch += (camPitch - v.pitch) * Math.min(1, dt * 4);

    // Throttle
    const accel = 30;
    const drag = 3;
    if (this.forceForward) {
      // Orbital cruise — boost still works (overdrive past cruise) but
      // the brake/back input is suppressed so the ship can never stop.
      // The cruise floor AND ceiling both come from forcedCruiseSpeed
      // (with boost adding ~75% headroom) so the orbital cruise speed
      // can be tuned without leaking the ground-level 95 m/s top end.
      const cruise = this.forcedCruiseSpeed;
      const maxSpeed = this.input.boost ? cruise * 1.75 : cruise;
      if (this.input.boost) v.speed += accel * dt;
      v.speed = Math.max(cruise, Math.min(maxSpeed, v.speed));
    } else {
      // Turbo (jump-tap) overrides the normal/boost cap with a higher
      // ceiling and gives a chunkier accel so the burst reads instantly.
      const turboOn = this.turboTimer > 0;
      const maxSpeed = turboOn ? 140 : (this.input.boost ? 95 : 55);
      const fwdAccel = turboOn ? accel * 1.6 : accel;
      if (this.input.forward) v.speed += fwdAccel * dt;
      if (this.input.back) v.speed -= accel * 0.6 * dt;
      if (!this.input.forward && !this.input.back && !turboOn) {
        if (v.speed > 0) v.speed = Math.max(0, v.speed - drag * dt);
        else if (v.speed < 0) v.speed = Math.min(0, v.speed + drag * dt);
      }
      v.speed = Math.max(-maxSpeed * 0.4, Math.min(maxSpeed, v.speed));
    }

    // Direction in 3D from yaw + pitch (negate pitch so look up = nose up)
    const cp = Math.cos(-v.pitch);
    const sp = Math.sin(-v.pitch);
    const forward = new BABYLON.Vector3(Math.sin(v.yaw) * cp, sp, Math.cos(v.yaw) * cp);
    const right = new BABYLON.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));

    v.velocity = forward.scale(v.speed);

    // Strafe + vertical
    let strafe = 0;
    if (this.input.left) strafe -= 1;
    if (this.input.right) strafe += 1;
    v.velocity.addInPlace(right.scale(strafe * 14));
    if (this.input.up) v.velocity.y += 18;
    if (this.input.down) v.velocity.y -= 18;

    v.position.addInPlace(v.velocity.scale(dt));

    // Bump against building walls when flying low
    this.resolveVehicleWallCollisions(v, 3.0);

    // Soft floor & ceiling. Pass the fighter's current Y so the headroom
    // filter inside getDriveableHeight() ignores platforms (notably the
    // sky racetrack at Y=80) the jet is flying well below — without this
    // the fighter would snap up onto the racetrack whenever its (x,z)
    // crossed under the ring, making it feel "stuck to the track".
    const groundY = this.getGroundHeight ? this.getGroundHeight(v.position.x, v.position.z, v.position.y) : 0;
    const minY = groundY + FIGHTER_MIN_ALTITUDE;
    if (v.position.y < minY) v.position.y = minY;
    if (v.position.y > FIGHTER_MAX_ALTITUDE) v.position.y = FIGHTER_MAX_ALTITUDE;

    // Roll into turns
    v.roll += (-strafe * 0.5 - v.roll) * Math.min(1, dt * 6);
  }

  dispose(): void {
    this.active = null;
    // Ghost riders share the vehicles array, so the loop below cleans
    // their meshes too — but drop the registry first so a queued tick
    // can't double-dispose a mesh.
    this.ghostRiders = [];
    this.ghostTargets = null;
    for (const v of this.vehicles) {
      try { v.meshes.root.dispose(); } catch {}
    }
    this.vehicles = [];
    // Drop the per-scene material cache so the next session rebuilds materials
    // fresh — a stale cached material on a disposed scene rendered as fully
    // transparent vehicle meshes after death+restart.
    try { clearVehicleMaterialCache(this.scene); } catch {}
  }
}
