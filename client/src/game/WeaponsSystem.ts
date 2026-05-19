import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";

export type WeaponType = "pistol" | "rifle" | "shotgun" | "rocket" | "laser" | "grenade" | "tracking_missile" | "capture_net";

export interface Weapon {
  type: WeaponType;
  name: string;
  damage: number;
  fireRate: number;
  ammo: number;
  maxAmmo: number;
  range: number;
  projectileSpeed: number;
  spread: number;
  isAutomatic: boolean;
  level: number;
  baseDamage: number;
  baseFireRate: number;
  baseSpread: number;
  baseExplosionRadius: number;
  explosionRadiusBonus: number;
  knockbackBonus: number;
}

export const MAX_WEAPON_LEVEL = 5;

export interface WeaponUpgradeCost {
  gears: number;
  parts: number;
  partItemId: string;
}

export interface WeaponUpgradeInfo {
  type: WeaponType;
  name: string;
  level: number;
  maxLevel: number;
  damage: number;
  fireRate: number;
  spread: number;
  explosionRadius: number;
  knockback: number;
  nextDamage?: number;
  nextFireRate?: number;
  nextSpread?: number;
  nextExplosionRadius?: number;
  nextKnockback?: number;
  cost: WeaponUpgradeCost | null;
  affordable: boolean;
}

const WEAPON_PART_ID: Record<WeaponType, string> = {
  pistol: "weapon_part_pistol",
  rifle: "weapon_part_rifle",
  shotgun: "weapon_part_shotgun",
  rocket: "weapon_part_rocket",
  laser: "weapon_part_laser",
  grenade: "weapon_part_grenade",
  tracking_missile: "weapon_part_rocket",
  // Capture Net is a tool, not a damage weapon — it has no upgrade path.
  // Mapped to a benign id so the Record type is satisfied; the upgrade UI
  // filters it out so the player never sees an upgrade card for it.
  capture_net: "weapon_part_pistol",
};

/** Weapons that aren't really projectile weapons — they're tool-style hooks
 *  that route the primary fire to a special handler instead of spawning a
 *  projectile. The upgrade UI / shop hide these. */
export const TOOL_WEAPONS: ReadonlyArray<WeaponType> = ["capture_net"];

function levelStats(base: { damage: number; fireRate: number; spread: number; explosionRadius: number }, level: number) {
  const lvl = Math.max(1, Math.min(MAX_WEAPON_LEVEL, level));
  const tier = lvl - 1;
  const damage = base.damage * (1 + 0.22 * tier);
  const fireRate = base.fireRate * Math.pow(0.88, tier);
  const spread = Math.max(0, base.spread * Math.pow(0.85, tier));
  const explosionBonus = lvl >= 3 ? base.explosionRadius * 0.15 * (lvl - 2) : 0;
  const knockback = lvl >= 3 ? 1 + 0.25 * (lvl - 2) : 0;
  return { damage, fireRate, spread, explosionBonus, knockback };
}

function upgradeCostFor(type: WeaponType, nextLevel: number): WeaponUpgradeCost {
  const tier = Math.max(2, nextLevel) - 1;
  return {
    gears: 6 * tier,
    parts: 2 * tier,
    partItemId: WEAPON_PART_ID[type],
  };
}

export interface Projectile {
  mesh: BABYLON.Mesh;
  direction: BABYLON.Vector3;
  speed: number;
  damage: number;
  lifetime: number;
  type: WeaponType;
  isExplosive: boolean;
  explosionRadius: number;
}

const TARGET_FRAME_SECONDS = 1 / 60;

export class WeaponsSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private weapons: Map<WeaponType, Weapon> = new Map();
  private currentWeapon: WeaponType = "pistol";
  private vehicleMode: boolean = false;
  // Player armor-mod boosts. Updated by Game.tsx whenever PLAYER_UPGRADED
  // fires (and once on initial load). Stack multiplicatively with the
  // vehicle bonuses inside fire() / createProjectile().
  private playerDamageMul: number = 1;
  private playerFireRateMul: number = 1;
  /** Per-level damage multiplier from the player's character level
   *  (PlayerController.getLevelDamageMul). Updated by Game.tsx on
   *  PLAYER_LEVEL_UP and on initial load. Stacks multiplicatively with
   *  vehicleMode, playerDamageMul, and jewel mounts. */
  private playerLevelMul: number = 1;
  /** Per-weapon damage multiplier from any mounted Power Jewel. Updated by
   *  JewelSystem via setWeaponJewelMul() whenever the player mounts /
   *  unmounts a jewel. Stacks multiplicatively with vehicleMode and
   *  playerDamageMul inside createProjectile(). 1.0 means no jewel. */
  private weaponJewelMul: Map<WeaponType, number> = new Map();
  private projectiles: Projectile[] = [];
  private lastFireTime: number = 0;
  private isFiring: boolean = false;
  /** One StandardMaterial per WeaponType, lazily built on first shot and
   *  shared by every projectile of that weapon thereafter. The original
   *  code allocated a fresh StandardMaterial per shot — at rifle / shotgun
   *  fire rates that's hundreds of materials a minute, all of which the
   *  GC eventually has to reclaim and which caused visible stutter. */
  private projectileMatCache: Map<WeaponType, BABYLON.StandardMaterial> = new Map();
  /** Shared black material for the tracking-missile nosecone. Lazy-built
   *  the first time a tracking missile is fired so unrelated sessions never
   *  pay for it. Frozen once created — its color never changes. */
  private trackingMissileNoseMat: BABYLON.StandardMaterial | null = null;
  /** Reusable scratch vectors so createProjectile / getAimForward don't
   *  allocate two-three Vector3s per shot. */
  private scratchSpread: BABYLON.Vector3 = new BABYLON.Vector3();
  private scratchDir: BABYLON.Vector3 = new BABYLON.Vector3();
  private scratchOrigin: BABYLON.Vector3 = new BABYLON.Vector3();
  private inventory: InventorySystem | null = null;
  private bus: EventBus = EventBus.getInstance();
  private mouseDownHandler: ((e: MouseEvent) => void) | null = null;
  private mouseUpHandler: ((e: MouseEvent) => void) | null = null;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  private onAmmoChange: ((ammo: number, maxAmmo: number) => void) | null = null;
  private onWeaponChange: ((weapon: Weapon) => void) | null = null;
  private aimOriginProvider: (() => BABYLON.Vector3) | null = null;
  /** Optional override that is consulted only while `vehicleMode` is true.
   *  Returning a non-null `{origin, forward}` makes the next fire ignore the
   *  camera entirely and shoot from the vehicle's nose along its own forward
   *  vector — i.e. the orbital fighter's "nose gun". When this returns null
   *  (e.g. the player is on foot or in an ATV) the fire path falls back to
   *  the player camera as before. */
  private vehicleAimProvider:
    | (() => { origin: BABYLON.Vector3; forward: BABYLON.Vector3 } | null)
    | null = null;

  /** Auto-Target Module (premium SPECIALS unlock). When enabled AND a
   *  target provider has been registered, getAimForward() bends the shot
   *  toward the nearest enemy that lies inside an aim cone in front of
   *  the firing origin. Off by default so the assist never silently turns
   *  itself on for players who haven't paid for it. */
  private autoTargetEnabled: boolean = false;
  private enemyTargetProvider: (() => BABYLON.Vector3[]) | null = null;
  /** Cone half-angle (cos of) the auto-target will pull within. cos(25°). */
  private static readonly AUTO_TARGET_CONE_COS = Math.cos(25 * Math.PI / 180);
  /** Maximum range squared the auto-target will consider a target valid. */
  private static readonly AUTO_TARGET_RANGE_SQ = 140 * 140;
  /** How aggressively the aim is bent toward the target (0 = none, 1 =
   *  hard snap). 0.55 reads as "the gun gently magnetizes toward the
   *  enemy" instead of yanking the camera. */
  private static readonly AUTO_TARGET_PULL = 0.55;
  /** Scratch vector reused by the auto-aim path so the per-shot adjust
   *  doesn't allocate. */
  private autoAimScratch: BABYLON.Vector3 = new BABYLON.Vector3();

  /** Toggle the Auto-Target Module on/off. Owned by Game.tsx — flipped on
   *  when the player buys the SPECIALS unlock or when a save with the
   *  unlock loads. */
  setAutoTargetEnabled(enabled: boolean): void {
    this.autoTargetEnabled = enabled;
  }

  /** Returns true if the player currently owns + has the Auto-Target
   *  Module enabled. Lets the HUD show a "LOCK" indicator. */
  isAutoTargetEnabled(): boolean {
    return this.autoTargetEnabled;
  }

  /** Wire a callback that returns the world-space positions of every live
   *  enemy in the scene (ground + aerial). Called once per shot — keep it
   *  cheap; do NOT allocate a new array per call (return a cached scratch
   *  if possible). */
  setEnemyTargetProvider(fn: (() => BABYLON.Vector3[]) | null): void {
    this.enemyTargetProvider = fn;
  }

  setInventory(inv: InventorySystem): void {
    this.inventory = inv;
  }

  setAimOriginProvider(fn: () => BABYLON.Vector3): void {
    this.aimOriginProvider = fn;
  }

  /** Wire a vehicle-aim source. While `vehicleMode` is active and the
   *  provider returns a payload, weapons fire from the vehicle's nose
   *  along its forward vector instead of the player's shoulder. */
  setVehicleAimProvider(
    fn: (() => { origin: BABYLON.Vector3; forward: BABYLON.Vector3 } | null) | null,
  ): void {
    this.vehicleAimProvider = fn;
  }

  private getVehicleAim(): { origin: BABYLON.Vector3; forward: BABYLON.Vector3 } | null {
    if (!this.vehicleMode || !this.vehicleAimProvider) return null;
    return this.vehicleAimProvider();
  }

  private getAimOrigin(): BABYLON.Vector3 {
    const va = this.getVehicleAim();
    if (va) return va.origin;
    return this.aimOriginProvider ? this.aimOriginProvider() : this.camera.position;
  }

  private getAimForward(): BABYLON.Vector3 {
    const va = this.getVehicleAim();
    const baseFwd = va ? va.forward.clone() : this.camera.getDirection(BABYLON.Vector3.Forward());
    // Auto-target gates: only bend aim for offensive weapons (skip the
    // capture net + grenade arc — those need their raw camera direction
    // for the player's intent to read correctly).
    if (!this.autoTargetEnabled || !this.enemyTargetProvider) return baseFwd;
    if (this.currentWeapon === "capture_net" || this.currentWeapon === "grenade") return baseFwd;
    const origin = va ? va.origin : (this.aimOriginProvider ? this.aimOriginProvider() : this.camera.position);
    const targets = this.enemyTargetProvider();
    if (!targets || targets.length === 0) return baseFwd;
    // First pass: pick the NEAREST target (smallest squared distance) that
    // also lies inside the aim cone. Squared distance is the comparison
    // key so we skip a per-target sqrt; the single sqrt for the winner is
    // computed below once we know which one we picked.
    const coneCos = WeaponsSystem.AUTO_TARGET_CONE_COS;
    const rangeSq = WeaponsSystem.AUTO_TARGET_RANGE_SQ;
    let bestDSq = Infinity;
    let bestDx = 0, bestDy = 0, bestDz = 0;
    let found = false;
    const fx = baseFwd.x, fy = baseFwd.y, fz = baseFwd.z;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const dx = t.x - origin.x;
      const dy = t.y - origin.y;
      const dz = t.z - origin.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > rangeSq || dSq < 1 || dSq >= bestDSq) continue;
      // Cone test without sqrt: (d·f)^2 >= cos²(theta) * |d|², AND the
      // sign of d·f must be positive (target in front, not behind).
      const dotRaw = dx * fx + dy * fy + dz * fz;
      if (dotRaw <= 0) continue;
      if (dotRaw * dotRaw < coneCos * coneCos * dSq) continue;
      bestDSq = dSq; bestDx = dx; bestDy = dy; bestDz = dz; found = true;
    }
    if (!found) return baseFwd;
    // Slerp-ish blend: linearly interpolate then renormalise into the
    // already-allocated scratch vector. Returning the scratch directly
    // (no .clone()) keeps the auto-target path allocation-free; the only
    // reader, createProjectile(), copies the value into its own scratch
    // before mutating, so handing out a shared reference is safe.
    const inv = 1 / Math.sqrt(bestDSq);
    const nx = bestDx * inv, ny = bestDy * inv, nz = bestDz * inv;
    const pull = WeaponsSystem.AUTO_TARGET_PULL;
    const inv1 = 1 - pull;
    const bx = fx * inv1 + nx * pull;
    const by = fy * inv1 + ny * pull;
    const bz = fz * inv1 + nz * pull;
    const blen = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
    this.autoAimScratch.set(bx / blen, by / blen, bz / blen);
    return this.autoAimScratch;
  }

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.initializeWeapons();
    this.setupControls();
  }

  private initializeWeapons(): void {
    const define = (
      type: WeaponType,
      name: string,
      damage: number,
      fireRate: number,
      ammo: number,
      range: number,
      projectileSpeed: number,
      spread: number,
      isAutomatic: boolean,
      explosionRadius: number = 0,
    ) => {
      this.weapons.set(type, {
        type,
        name,
        damage,
        fireRate,
        ammo,
        maxAmmo: ammo,
        range,
        projectileSpeed,
        spread,
        isAutomatic,
        level: 1,
        baseDamage: damage,
        baseFireRate: fireRate,
        baseSpread: spread,
        baseExplosionRadius: explosionRadius,
        explosionRadiusBonus: 0,
        knockbackBonus: 0,
      });
    };

    define("pistol", "Plasma Pistol", 15, 300, 50, 100, 2, 0.02, false, 0);
    define("rifle", "Pulse Rifle", 25, 100, 120, 150, 3, 0.03, true, 0);
    define("shotgun", "Scatter Blaster", 8, 800, 24, 30, 2.5, 0.15, false, 0);
    define("rocket", "Nova Launcher", 100, 1500, 8, 200, 1, 0, false, 5);
    define("laser", "Photon Beam", 40, 50, 200, 300, 10, 0, true, 0);
    define("grenade", "Fusion Grenades", 80, 1000, 6, 50, 0.5, 0, false, 4);
    // Tracking Missile: launcher that fires a smart projectile that locks
    // onto the nearest target in the camera frustum and aggressively homes
    // in on it. Powerful, slower fire rate, big AoE.
    define("tracking_missile", "Hunter Missile", 120, 1300, 6, 220, 0.9, 0, false, 6);
    // Capture Net — a tool weapon. Its primary fire is intercepted by the
    // special-fire handler (see setSpecialFireHandler) and routed to
    // BioCreatureSystem.attemptCaptureNearest. The numeric stats below are
    // cosmetic (HUD shows "Capture Net" + the cooldown), the weapon never
    // actually creates a projectile and never deals damage.
    define("capture_net", "Capture Net", 0, 600, 1, 22, 0, 0, false, 0);
  }

  private setupControls(): void {
    this.mouseDownHandler = (e: MouseEvent) => {
      if (e.button === 0) {
        this.isFiring = true;
        this.fire();
      }
    };
    window.addEventListener("mousedown", this.mouseDownHandler);

    this.mouseUpHandler = (e: MouseEvent) => {
      if (e.button === 0) {
        this.isFiring = false;
      }
    };
    window.addEventListener("mouseup", this.mouseUpHandler);

    this.wheelHandler = (e: WheelEvent) => {
      this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    };
    window.addEventListener("wheel", this.wheelHandler);

    this.keyHandler = (e: KeyboardEvent) => {
      switch (e.code) {
        case "Digit1": this.selectWeapon("pistol"); break;
        case "Digit2": this.selectWeapon("rifle"); break;
        case "Digit3": this.selectWeapon("shotgun"); break;
        case "Digit4": this.selectWeapon("rocket"); break;
        case "Digit5": this.selectWeapon("laser"); break;
        case "Digit6": this.selectWeapon("grenade"); break;
        // Hunter Missile uses KeyP because Digit7-Digit0 are taken by the
        // Special Arsenal (elemental) bindings.
        case "KeyP": this.selectWeapon("tracking_missile"); break;
        // Capture Net — selectable from Digit8 (or the wheel) when the
        // player is in a zone that grants it. selectWeapon silently
        // bails for any weapon the player hasn't been granted yet, so
        // pressing 8 outside the sanctuary is a no-op.
        case "Digit8": this.selectWeapon("capture_net"); break;
        case "KeyR": this.reload(); break;
      }
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  setVehicleMode(active: boolean): void {
    this.vehicleMode = active;
  }

  /** Master gate: when false, fire() short-circuits regardless of input
   *  state. SpaceLevelSystem flips this off on warp-in so the player can't
   *  shoot from the orbital fighter, and back on when warping to a ground
   *  level. */
  private firingEnabled: boolean = true;
  setFiringEnabled(enabled: boolean): void {
    this.firingEnabled = enabled;
    if (!enabled) this.isFiring = false;
  }

  /** Receives the player's armor-mod boosts. damageMul / fireRateMul are
   *  >= 1; values <= 0 are ignored to avoid division-by-zero / negative
   *  damage bugs. Called by Game.tsx whenever the player buys a Power Core
   *  or Pulse Driver upgrade (and once on initial load). */
  setPlayerBoosts(boosts: { damageMul: number; fireRateMul: number }): void {
    if (boosts.damageMul > 0) this.playerDamageMul = boosts.damageMul;
    if (boosts.fireRateMul > 0) this.playerFireRateMul = boosts.fireRateMul;
  }

  /** Receives the per-level damage multiplier (1.0 at level 1, ramping
   *  to 1.99 at the level-100 cap). Called by Game.tsx on PLAYER_LEVEL_UP
   *  and once after the initial save loads. */
  setPlayerLevelMul(mul: number): void {
    if (mul > 0) this.playerLevelMul = mul;
  }

  /** Set the Power-Jewel damage multiplier for a specific weapon. Owned by
   *  JewelSystem — called whenever the player mounts / unmounts a jewel and
   *  on initial save load. mul should be >= 1; values <= 0 are ignored to
   *  guard against bad inputs. */
  setWeaponJewelMul(type: WeaponType, mul: number): void {
    if (mul > 0) this.weaponJewelMul.set(type, mul);
  }

  /** Tool-weapon hooks. When the active weapon's type has a registered
   *  handler, fire() calls the handler instead of spawning a projectile —
   *  this is how the Capture Net routes its primary fire to the
   *  BioCreatureSystem without WeaponsSystem having to know what a
   *  bio-creature is. Cooldown still applies normally. */
  private specialFireHandlers: Map<WeaponType, () => void> = new Map();
  setSpecialFireHandler(type: WeaponType, handler: (() => void) | null): void {
    if (handler) this.specialFireHandlers.set(type, handler);
    else this.specialFireHandlers.delete(type);
  }

  private fire(): void {
    if (!this.firingEnabled) return;
    const weapon = this.weapons.get(this.currentWeapon);
    if (!weapon) return;

    // Effective cooldown shrinks with both vehicle mode AND the player's
    // Pulse-Driver armor mod. Both are applied as DIVISORS so the cycle
    // gets faster as either grows.
    const fireRateMul = (this.vehicleMode ? 1 / 1.25 : 1) / Math.max(0.1, this.playerFireRateMul);
    const now = Date.now();
    if (now - this.lastFireTime < weapon.fireRate * fireRateMul) return;

    this.lastFireTime = now;
    weapon.ammo = weapon.maxAmmo;

    // Tool-weapon path: route fire to the special handler and skip
    // projectile creation entirely. The handler decides whether the action
    // succeeded (capture in range, has bio_essence, etc.) and emits its
    // own UI feedback.
    const special = this.specialFireHandlers.get(this.currentWeapon);
    if (special) {
      try { special(); } catch (err) { console.warn("[WeaponsSystem] special fire handler threw", err); }
      this.onAmmoChange?.(weapon.ammo, weapon.maxAmmo);
      return;
    }

    if (this.currentWeapon === "shotgun") {
      for (let i = 0; i < 8; i++) {
        this.createProjectile(weapon);
      }
    } else {
      this.createProjectile(weapon);
    }

    this.onAmmoChange?.(weapon.ammo, weapon.maxAmmo);
  }

  private createProjectile(weapon: Weapon): void {
    const forward = this.getAimForward();

    const spreadX = (Math.random() - 0.5) * weapon.spread;
    const spreadY = (Math.random() - 0.5) * weapon.spread;
    // Compute direction in-place to avoid the per-shot Vector3 allocation
    // that was firing dozens of times per second with auto weapons.
    this.scratchDir.copyFrom(forward);
    this.scratchDir.x += spreadX;
    this.scratchDir.y += spreadY;
    const direction = this.scratchDir.normalize().clone();

    // Vehicle amplification: 1.5x size, damage, explosion, 2.5x projectile
    // speed and 2x lifetime (range) — the orbital fighter cruises at 55 m/s
    // and engages targets 80–150 m out, so the on-foot speeds left bullets
    // crawling and timing out before they reached anything.
    // Player Power-Core armor mod multiplies damage on top of the vehicle
    // bonus so a fully-modded player in a vehicle hits hardest.
    const sizeMul = this.vehicleMode ? 1.5 : 1;
    // Power-Jewel mount stacks multiplicatively on top of vehicle + Power
    // Core boosts so a fully-modded player firing from an orbital fighter
    // with a flawless jewel mounted hits hardest.
    const jewelMul = this.weaponJewelMul.get(weapon.type) ?? 1;
    const dmgMul = (this.vehicleMode ? 1.5 : 1) * this.playerDamageMul * jewelMul * this.playerLevelMul;
    const speedMul = this.vehicleMode ? 2.5 : 1;
    const lifetimeMul = this.vehicleMode ? 2.0 : 1;

    let projectileMesh: BABYLON.Mesh;
    let color: BABYLON.Color3;

    switch (weapon.type) {
      case "pistol":
        projectileMesh = BABYLON.MeshBuilder.CreateSphere("projectile", { diameter: 0.1 * sizeMul }, this.scene);
        color = new BABYLON.Color3(0, 1, 1);
        break;
      case "rifle":
        projectileMesh = BABYLON.MeshBuilder.CreateCylinder("projectile", { height: 0.3 * sizeMul, diameter: 0.05 * sizeMul }, this.scene);
        projectileMesh.rotation.x = Math.PI / 2;
        color = new BABYLON.Color3(1, 0.5, 0);
        break;
      case "shotgun":
        projectileMesh = BABYLON.MeshBuilder.CreateSphere("projectile", { diameter: 0.08 * sizeMul }, this.scene);
        color = new BABYLON.Color3(1, 1, 0);
        break;
      case "rocket":
        projectileMesh = BABYLON.MeshBuilder.CreateCylinder("projectile", { height: 0.5 * sizeMul, diameter: 0.15 * sizeMul }, this.scene);
        projectileMesh.rotation.x = Math.PI / 2;
        color = new BABYLON.Color3(1, 0.2, 0);
        break;
      case "laser":
        projectileMesh = BABYLON.MeshBuilder.CreateCylinder("projectile", { height: 2 * sizeMul, diameter: 0.03 * sizeMul }, this.scene);
        projectileMesh.rotation.x = Math.PI / 2;
        color = new BABYLON.Color3(1, 0, 0);
        break;
      case "grenade":
        projectileMesh = BABYLON.MeshBuilder.CreateSphere("projectile", { diameter: 0.2 * sizeMul }, this.scene);
        color = new BABYLON.Color3(0.5, 1, 0);
        break;
      case "tracking_missile": {
        const tmHeight = 0.7 * sizeMul;
        const tmDiameter = 0.18 * sizeMul;
        projectileMesh = BABYLON.MeshBuilder.CreateCylinder("projectile", {
          height: tmHeight,
          diameter: tmDiameter,
          tessellation: 10,
        }, this.scene);
        projectileMesh.rotation.x = Math.PI / 2;
        color = new BABYLON.Color3(1, 0.3, 0.7);

        // Black nosecone bolted to the missile's tip. Slightly narrower
        // than the body so the glowing pink cylinder rims the seam where
        // the cone meets the shaft. Parented to the cylinder so a single
        // mesh.dispose() recursively cleans both, and the per-frame
        // position/orientation update on the parent carries the cone too.
        const noseHeight = 0.28 * sizeMul;
        const nose = BABYLON.MeshBuilder.CreateCylinder("trackingNose", {
          height: noseHeight,
          diameterTop: 0,
          diameterBottom: tmDiameter * 0.92,
          tessellation: 10,
        }, this.scene);
        nose.parent = projectileMesh;
        // Cylinder local Y is its long axis; the +Y end is the nose
        // direction once the parent's `rotation.x = π/2` puts +Y → +Z
        // (world-forward). Stack the cone so its base sits flush with
        // the cylinder's top and the point extends ahead.
        nose.position.y = tmHeight / 2 + noseHeight / 2;
        nose.isPickable = false;

        if (!this.trackingMissileNoseMat) {
          const m = new BABYLON.StandardMaterial("projectileMat_trackingNose", this.scene);
          m.diffuseColor = new BABYLON.Color3(0.04, 0.04, 0.05);
          m.emissiveColor = new BABYLON.Color3(0, 0, 0);
          m.specularColor = new BABYLON.Color3(0.45, 0.45, 0.5);
          m.specularPower = 64;
          m.freeze();
          this.trackingMissileNoseMat = m;
        }
        nose.material = this.trackingMissileNoseMat;
        break;
      }
      default:
        projectileMesh = BABYLON.MeshBuilder.CreateSphere("projectile", { diameter: 0.1 * sizeMul }, this.scene);
        color = new BABYLON.Color3(1, 1, 1);
    }

    // Reuse one shared StandardMaterial per weapon type. Babylon happily
    // shares a single material instance across hundreds of meshes, so this
    // collapses N material allocations per second down to one per weapon
    // for the entire session.
    let material = this.projectileMatCache.get(weapon.type);
    if (!material) {
      material = new BABYLON.StandardMaterial(`projectileMat_${weapon.type}`, this.scene);
      material.emissiveColor = color;
      material.diffuseColor = color;
      material.disableLighting = true;
      material.freeze();
      this.projectileMatCache.set(weapon.type, material);
    }
    projectileMesh.material = material;

    // Set spawn position in-place to avoid the .add(.scale(1)) allocation
    // pair (one Vector3 from scale(), another from add()).
    const aimOrigin = this.getAimOrigin();
    this.scratchOrigin.set(
      aimOrigin.x + forward.x,
      aimOrigin.y + forward.y,
      aimOrigin.z + forward.z,
    );
    projectileMesh.position.copyFrom(this.scratchOrigin);

    const baseR = weapon.type === "rocket" ? 5 : weapon.type === "grenade" ? 4 : weapon.type === "tracking_missile" ? 6 : 0;
    const projectile: Projectile = {
      mesh: projectileMesh,
      direction,
      speed: weapon.projectileSpeed * speedMul,
      damage: weapon.damage * dmgMul,
      lifetime: (weapon.type === "tracking_missile" ? 6000 : 3000) * lifetimeMul,
      type: weapon.type,
      isExplosive: weapon.type === "rocket" || weapon.type === "grenade" || weapon.type === "tracking_missile",
      explosionRadius: (baseR + (weapon.explosionRadiusBonus || 0)) * sizeMul,
    };

    this.projectiles.push(projectile);
  }

  update(enemies: BABYLON.Mesh[], dt: number = TARGET_FRAME_SECONDS): { hitEnemy: BABYLON.Mesh; damage: number }[] {
    const weapon = this.weapons.get(this.currentWeapon);
    if (weapon?.isAutomatic && this.isFiring) {
      this.fire();
    }

    const hits: { hitEnemy: BABYLON.Mesh; damage: number }[] = [];
    const frameScale = Math.max(0, dt / TARGET_FRAME_SECONDS);
    const elapsedMs = Math.max(0, dt * 1000);

    // Homing-missile lock-on range. Beyond this distance the missile cannot
    // see / steer toward an enemy. Squared form so we can avoid the sqrt
    // inside the per-enemy hot loop.
    const HOMING_RANGE_SQ = 120 * 120;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      const px = projectile.mesh.position.x;
      const py = projectile.mesh.position.y;
      const pz = projectile.mesh.position.z;

      // Tracking Missile: aggressively home onto the nearest live target
      // within HOMING_RANGE. Use squared-distance comparison to skip the sqrt
      // call per enemy — at high enemy counts this was the single biggest
      // cost when the missile was equipped.
      if (projectile.type === "tracking_missile") {
        let nearest: BABYLON.Mesh | null = null;
        let nearestDistSq = HOMING_RANGE_SQ;
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (e.isDisposed()) continue;
          const dx = e.position.x - px;
          const dy = e.position.y - py;
          const dz = e.position.z - pz;
          const dSq = dx * dx + dy * dy + dz * dz;
          if (dSq < nearestDistSq) { nearestDistSq = dSq; nearest = e; }
        }
        if (nearest) {
          const desired = nearest.position.subtract(projectile.mesh.position).normalize();
          const steer = 1 - Math.pow(1 - 0.18, frameScale);
          projectile.direction = BABYLON.Vector3.Lerp(projectile.direction, desired, steer).normalize();
          // Orient the cylinder mesh along the direction of travel.
          const dir = projectile.direction;
          const yaw = Math.atan2(dir.x, dir.z);
          const pitch = -Math.asin(dir.y);
          projectile.mesh.rotation = new BABYLON.Vector3(pitch + Math.PI / 2, yaw, 0);
        }
      }

      const step = projectile.speed * frameScale;
      projectile.mesh.position.x += projectile.direction.x * step;
      projectile.mesh.position.y += projectile.direction.y * step;
      projectile.mesh.position.z += projectile.direction.z * step;
      projectile.lifetime -= elapsedMs;

      if (projectile.type === "grenade") {
        projectile.direction.y -= 0.01 * frameScale;
      }

      // Re-read after movement.
      const px2 = projectile.mesh.position.x;
      const py2 = projectile.mesh.position.y;
      const pz2 = projectile.mesh.position.z;

      let hitDetected = false;
      for (let k = 0; k < enemies.length; k++) {
        const enemy = enemies[k];
        const dx = enemy.position.x - px2;
        const dy = enemy.position.y - py2;
        const dz = enemy.position.z - pz2;
        const distSq = dx * dx + dy * dy + dz * dz;
        const hitRadius = (enemy.metadata && typeof enemy.metadata.hitRadius === "number") ? enemy.metadata.hitRadius : 1.5;
        if (distSq < hitRadius * hitRadius) {
          if (projectile.isExplosive) {
            this.createExplosion(projectile.mesh.position, projectile.explosionRadius);
            const radSq = projectile.explosionRadius * projectile.explosionRadius;
            const radius = projectile.explosionRadius;
            for (let m = 0; m < enemies.length; m++) {
              const e = enemies[m];
              const ex = e.position.x - px2;
              const ey = e.position.y - py2;
              const ez = e.position.z - pz2;
              const eSq = ex * ex + ey * ey + ez * ez;
              if (eSq < radSq) {
                const falloff = 1 - (Math.sqrt(eSq) / radius);
                hits.push({ hitEnemy: e, damage: projectile.damage * falloff });
              }
            }
          } else {
            hits.push({ hitEnemy: enemy, damage: projectile.damage });
          }
          projectile.mesh.dispose();
          this.projectiles.splice(i, 1);
          hitDetected = true;
          break;
        }
      }
      if (hitDetected) continue;

      if (projectile.lifetime <= 0 || projectile.mesh.position.y < 0) {
        if (projectile.isExplosive && projectile.mesh.position.y < 0.5) {
          this.createExplosion(projectile.mesh.position, projectile.explosionRadius);
        }
        projectile.mesh.dispose();
        this.projectiles.splice(i, 1);
      }
    }

    return hits;
  }

  private createExplosion(position: BABYLON.Vector3, radius: number): void {
    // Routed through the unified ExplosionSystem (subscribes to
    // "effect:explosion"). Tier is picked from the radius the caller asked
    // for so rocket vs grenade vs cluster all read visually distinct.
    const tier: "small" | "medium" | "large" =
      radius >= 5 ? "large" : radius >= 2.5 ? "medium" : "small";
    EventBus.getInstance().emit("effect:explosion", {
      position: position.clone(),
      radius,
      tier,
      color: new BABYLON.Color3(1.0, 0.5, 0.1),
    });
  }

  selectWeapon(type: WeaponType): void {
    if (this.weapons.has(type)) {
      this.currentWeapon = type;
      const weapon = this.weapons.get(type)!;
      this.onWeaponChange?.(weapon);
      this.onAmmoChange?.(weapon.ammo, weapon.maxAmmo);
    }
  }

  cycleWeapon(direction: number): void {
    // Tool weapons (Capture Net) live at the END of the cycle so the
    // gamepad's D-pad L/R can reach them — there's no Digit8 equivalent
    // on a controller. Damage weapons come first, the net comes last,
    // so a player walking the wheel forward from the pistol passes
    // through every gun before landing on the net.
    const types: WeaponType[] = ["pistol", "rifle", "shotgun", "rocket", "laser", "grenade", "tracking_missile", "capture_net"];
    const currentIndex = types.indexOf(this.currentWeapon);
    if (currentIndex < 0) {
      this.selectWeapon(types[0]);
      return;
    }
    const newIndex = (currentIndex + direction + types.length) % types.length;
    this.selectWeapon(types[newIndex]);
  }

  private reload(): void {
    const weapon = this.weapons.get(this.currentWeapon);
    if (weapon) {
      weapon.ammo = weapon.maxAmmo;
      this.onAmmoChange?.(weapon.ammo, weapon.maxAmmo);
    }
  }

  addAmmo(type: WeaponType, amount: number): void {
    const weapon = this.weapons.get(type);
    if (weapon) {
      weapon.ammo = Math.min(weapon.maxAmmo, weapon.ammo + amount);
      if (type === this.currentWeapon) {
        this.onAmmoChange?.(weapon.ammo, weapon.maxAmmo);
      }
    }
  }

  getCurrentWeapon(): Weapon | undefined {
    return this.weapons.get(this.currentWeapon);
  }

  setOnAmmoChange(callback: (ammo: number, maxAmmo: number) => void): void {
    this.onAmmoChange = callback;
  }

  setOnWeaponChange(callback: (weapon: Weapon) => void): void {
    this.onWeaponChange = callback;
  }

  getAllWeapons(): Weapon[] {
    return Array.from(this.weapons.values());
  }

  getCurrentWeaponType(): WeaponType {
    return this.currentWeapon;
  }

  getUpgradeInfo(type: WeaponType): WeaponUpgradeInfo | null {
    const w = this.weapons.get(type);
    if (!w) return null;
    const lvl = w.level;
    const cur = levelStats(
      { damage: w.baseDamage, fireRate: w.baseFireRate, spread: w.baseSpread, explosionRadius: w.baseExplosionRadius },
      lvl,
    );
    const isMax = lvl >= MAX_WEAPON_LEVEL;
    const next = isMax ? null : levelStats(
      { damage: w.baseDamage, fireRate: w.baseFireRate, spread: w.baseSpread, explosionRadius: w.baseExplosionRadius },
      lvl + 1,
    );
    const cost = isMax ? null : upgradeCostFor(type, lvl + 1);
    let affordable = false;
    if (cost && this.inventory) {
      affordable = this.inventory.getItemCount("gear") >= cost.gears && this.inventory.getItemCount(cost.partItemId) >= cost.parts;
    }
    return {
      type,
      name: w.name,
      level: lvl,
      maxLevel: MAX_WEAPON_LEVEL,
      damage: w.damage,
      fireRate: w.fireRate,
      spread: w.spread,
      explosionRadius: w.baseExplosionRadius + w.explosionRadiusBonus,
      knockback: w.knockbackBonus,
      nextDamage: next?.damage,
      nextFireRate: next?.fireRate,
      nextSpread: next?.spread,
      nextExplosionRadius: next ? w.baseExplosionRadius + next.explosionBonus : undefined,
      nextKnockback: next?.knockback,
      cost,
      affordable,
    };
  }

  getAllUpgradeInfo(): WeaponUpgradeInfo[] {
    // Tool weapons (Capture Net) deliberately have no upgrade path — they
    // deal no damage and don't fit the gears/parts economy. Filter them
    // out at the source so the upgrade menu and shop never surface them.
    return Array.from(this.weapons.keys())
      .filter(t => !TOOL_WEAPONS.includes(t))
      .map(t => this.getUpgradeInfo(t)!)
      .filter(x => !!x);
  }

  /** Snapshot weapon levels for persistence */
  getWeaponLevels(): Record<string, number> {
    const out: Record<string, number> = {};
    this.weapons.forEach((w, type) => { out[type] = w.level; });
    return out;
  }

  /** Restore weapon levels from a saved snapshot (recomputes derived stats) */
  setWeaponLevels(levels: Record<string, number>): void {
    for (const [typeKey, lvl] of Object.entries(levels || {})) {
      const w = this.weapons.get(typeKey as WeaponType);
      if (!w) continue;
      const clamped = Math.max(1, Math.min(MAX_WEAPON_LEVEL, lvl));
      w.level = clamped;
      const stats = levelStats(
        { damage: w.baseDamage, fireRate: w.baseFireRate, spread: w.baseSpread, explosionRadius: w.baseExplosionRadius },
        w.level,
      );
      w.damage = stats.damage;
      w.fireRate = stats.fireRate;
      w.spread = stats.spread;
      w.explosionRadiusBonus = stats.explosionBonus;
      w.knockbackBonus = stats.knockback;
    }
    const cur = this.weapons.get(this.currentWeapon);
    if (cur) this.onWeaponChange?.(cur);
  }

  upgradeWeapon(type: WeaponType): boolean {
    // Defensive: tool weapons can't be upgraded even if a UI somewhere
    // tries to spend gears on one. Mirrors the getAllUpgradeInfo filter.
    if (TOOL_WEAPONS.includes(type)) return false;
    const w = this.weapons.get(type);
    if (!w) return false;
    if (w.level >= MAX_WEAPON_LEVEL) return false;
    const cost = upgradeCostFor(type, w.level + 1);
    if (!this.inventory) return false;
    if (this.inventory.getItemCount("gear") < cost.gears) return false;
    if (this.inventory.getItemCount(cost.partItemId) < cost.parts) return false;
    const gearDef = ITEM_DEFINITIONS["gear"];
    const partDef = ITEM_DEFINITIONS[cost.partItemId];
    if (!gearDef || !partDef) return false;
    this.inventory.removeItem(gearDef.id, cost.gears);
    this.inventory.removeItem(partDef.id, cost.parts);
    w.level += 1;
    const stats = levelStats(
      { damage: w.baseDamage, fireRate: w.baseFireRate, spread: w.baseSpread, explosionRadius: w.baseExplosionRadius },
      w.level,
    );
    w.damage = stats.damage;
    w.fireRate = stats.fireRate;
    w.spread = stats.spread;
    w.explosionRadiusBonus = stats.explosionBonus;
    w.knockbackBonus = stats.knockback;
    if (type === this.currentWeapon) {
      this.onWeaponChange?.(w);
    }
    this.bus.emit(GameEvents.WEAPON_UPGRADED, { type, level: w.level, damage: w.damage });
    return true;
  }

  dispose(): void {
    if (this.mouseDownHandler) window.removeEventListener("mousedown", this.mouseDownHandler);
    if (this.mouseUpHandler) window.removeEventListener("mouseup", this.mouseUpHandler);
    if (this.wheelHandler) window.removeEventListener("wheel", this.wheelHandler);
    if (this.keyHandler) window.removeEventListener("keydown", this.keyHandler);
    this.mouseDownHandler = null;
    this.mouseUpHandler = null;
    this.wheelHandler = null;
    this.keyHandler = null;
    this.isFiring = false;

    for (const projectile of this.projectiles) {
      try { projectile.mesh.dispose(); } catch {}
    }
    this.projectiles = [];
    for (const mat of Array.from(this.projectileMatCache.values())) {
      try { mat.dispose(); } catch {}
    }
    this.projectileMatCache.clear();
    if (this.trackingMissileNoseMat) {
      try { this.trackingMissileNoseMat.dispose(); } catch {}
      this.trackingMissileNoseMat = null;
    }
    this.onAmmoChange = null;
    this.onWeaponChange = null;
    this.aimOriginProvider = null;
    this.vehicleAimProvider = null;
    this.enemyTargetProvider = null;
    this.specialFireHandlers.clear();
  }
}
