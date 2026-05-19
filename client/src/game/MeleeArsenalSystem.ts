import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { DamageInfo, DamageType, IDamageable, applyDamage } from "./DamageSystem";

export type ArsenalWeaponId = "glaive" | "daggers" | "axe" | "whip";

export interface ArsenalWeaponSnapshot {
  unlocked: boolean;
  comboUnlocked: boolean;
  specialUnlocked: boolean;
}

export interface ArsenalSnapshot {
  glaive: ArsenalWeaponSnapshot;
  daggers: ArsenalWeaponSnapshot;
  axe: ArsenalWeaponSnapshot;
  whip: ArsenalWeaponSnapshot;
  equipped: ArsenalWeaponId | null;
}

interface WeaponConfig {
  name: string;
  primaryName: string;
  comboName: string;
  specialName: string;
  baseDamage: number;
  reach: number;
  cone: number;
  primaryRadius: number;
  baseCooldown: number;
  knockback: number;
  emissive: BABYLON.Color3;
  diffuse: BABYLON.Color3;
}

const WEAPON_CONFIGS: Record<ArsenalWeaponId, WeaponConfig> = {
  glaive: {
    name: "Beam Glaive",
    primaryName: "Sweep",
    comboName: "Triple Sweep",
    specialName: "Comet Spin",
    baseDamage: 200,
    reach: 4.6,
    cone: Math.PI * 0.78,
    primaryRadius: 8.0,
    baseCooldown: 0.55,
    knockback: 9,
    emissive: new BABYLON.Color3(0.18, 1.0, 0.42),
    diffuse: new BABYLON.Color3(0.20, 0.85, 0.50),
  },
  daggers: {
    name: "Twin Beam Daggers",
    primaryName: "Rapid Stab",
    comboName: "Phantom Step",
    specialName: "Phantom Storm",
    baseDamage: 95,
    reach: 3.4,
    cone: Math.PI * 0.34,
    primaryRadius: 4.5,
    baseCooldown: 0.18,
    knockback: 4,
    emissive: new BABYLON.Color3(1.0, 0.30, 0.95),
    diffuse: new BABYLON.Color3(0.95, 0.40, 1.00),
  },
  axe: {
    name: "Plasma War Axe",
    primaryName: "Heavy Cleave",
    comboName: "Cleave + Upper",
    specialName: "Ground Slam",
    baseDamage: 380,
    reach: 4.2,
    cone: Math.PI * 0.5,
    primaryRadius: 6.5,
    baseCooldown: 0.95,
    knockback: 18,
    emissive: new BABYLON.Color3(1.0, 0.55, 0.08),
    diffuse: new BABYLON.Color3(0.75, 0.40, 0.10),
  },
  whip: {
    name: "Spiked Chain Whip",
    primaryName: "Long Lash",
    comboName: "Pull-In Lash",
    specialName: "Flail Spin",
    baseDamage: 140,
    reach: 7.5,
    cone: Math.PI * 0.18,
    primaryRadius: 16.0,
    baseCooldown: 0.50,
    knockback: 7,
    emissive: new BABYLON.Color3(1.0, 0.18, 0.18),
    diffuse: new BABYLON.Color3(0.65, 0.10, 0.12),
  },
};

interface WeaponInstance {
  id: ArsenalWeaponId;
  config: WeaponConfig;
  state: ArsenalWeaponSnapshot;
  mesh: BABYLON.TransformNode | null;
  material: BABYLON.StandardMaterial | null;
  /** Visible swing animation timer (s remaining). */
  swingTimer: number;
  swingDir: number;
  /** Per-weapon cooldown clock. */
  cooldownTimer: number;
  /** True while a multi-hit combo or special is mid-execution. */
  busy: boolean;
  /** Pending setTimeout handles so dispose() can cancel. */
  timers: number[];
  /** Comet Spin orbiting crescent (glaive special). */
  cometMesh: BABYLON.Mesh | null;
  cometTimer: number;
  cometHits: Map<BABYLON.AbstractMesh, number>;
  /** Ground Slam expanding ring (axe special). */
  shockRingMesh: BABYLON.Mesh | null;
  shockRingTimer: number;
  shockRingOrigin: BABYLON.Vector3 | null;
  shockRingHits: Set<BABYLON.AbstractMesh>;
  /** Flail Spin tick-in-progress (whip special). */
  flailTimer: number;
}

/** Top-shelf "alternate melee" arsenal — sits alongside the always-on
 *  Beam Sabre. Each weapon has a primary attack, a combo-unlock that
 *  enhances the primary, and a signature special. Cycled with KeyB,
 *  primary fires on the regular slash key (Y / J), special on KeyN. */
export class MeleeArsenalSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private bus: EventBus;
  private weapons: Map<ArsenalWeaponId, WeaponInstance> = new Map();
  private equipped: ArsenalWeaponId | null = null;

  private aimOriginProvider: (() => BABYLON.Vector3) | null = null;
  private damageRouter: ((mesh: BABYLON.AbstractMesh, dmg: number) => void) | null = null;

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.bus = EventBus.getInstance();
    for (const id of Object.keys(WEAPON_CONFIGS) as ArsenalWeaponId[]) {
      this.weapons.set(id, {
        id,
        config: WEAPON_CONFIGS[id],
        state: { unlocked: false, comboUnlocked: false, specialUnlocked: false },
        mesh: null,
        material: null,
        swingTimer: 0,
        swingDir: 1,
        cooldownTimer: 0,
        busy: false,
        timers: [],
        cometMesh: null,
        cometTimer: 0,
        cometHits: new Map(),
        shockRingMesh: null,
        shockRingTimer: 0,
        shockRingOrigin: null,
        shockRingHits: new Set(),
        flailTimer: 0,
      });
    }
  }

  setAimOriginProvider(fn: () => BABYLON.Vector3): void { this.aimOriginProvider = fn; }
  setDamageRouter(fn: (mesh: BABYLON.AbstractMesh, dmg: number) => void): void { this.damageRouter = fn; }

  /** Curated list provider — avoids scanning scene.meshes on every swing/special. */
  private hittableMeshProvider: (() => BABYLON.AbstractMesh[]) | null = null;
  setHittableMeshProvider(fn: () => BABYLON.AbstractMesh[]): void {
    this.hittableMeshProvider = fn;
  }
  private getTargets(): BABYLON.AbstractMesh[] {
    return this.hittableMeshProvider ? this.hittableMeshProvider() : this.scene.meshes;
  }

  /** Schedule a deferred callback that auto-prunes its own handle from
   *  `w.timers` when it fires. Replaces the leaky pattern of pushing
   *  every setTimeout handle into the array without ever removing it,
   *  which let a long-running session accumulate hundreds of stale
   *  handles. dispose() still walks the array to cancel anything that
   *  is still pending. */
  private schedule(w: WeaponInstance, fn: () => void, ms: number): void {
    const handle = window.setTimeout(() => {
      const idx = w.timers.indexOf(handle);
      if (idx >= 0) w.timers.splice(idx, 1);
      fn();
    }, ms);
    w.timers.push(handle);
  }

  private getAimOrigin(): BABYLON.Vector3 {
    return this.aimOriginProvider ? this.aimOriginProvider() : this.camera.position;
  }

  private isHittable(mesh: BABYLON.AbstractMesh): boolean {
    if (!mesh.metadata) return false;
    const m = mesh.metadata as any;
    if (this.damageRouter) {
      return !!(m.isEnemy || m.aerialUnit || m.isTurret || m.isVault || m.miningNodeId || m.isProp);
    }
    return !!(m.isEnemy && m.damageable);
  }

  /** Per-level player damage scaling (PlayerController.getLevelDamageMul).
   *  Applied uniformly to every alternate-melee hit so the level cap
   *  reaches the arsenal weapons the same way it reaches the sabre and
   *  ranged weapons. */
  private playerLevelMul: number = 1;
  setPlayerLevelMul(mul: number): void {
    if (mul > 0) this.playerLevelMul = mul;
  }

  private dealDamage(mesh: BABYLON.AbstractMesh, amount: number, info: DamageInfo): number {
    const scaled = amount * this.playerLevelMul;
    if (this.damageRouter) {
      this.damageRouter(mesh, scaled);
      return scaled;
    }
    const damageable = (mesh.metadata as any).damageable as IDamageable;
    const scaledInfo: DamageInfo = { ...info, amount: scaled };
    const result = applyDamage(damageable, scaledInfo);
    return result.damageAmount;
  }

  // ------------------------------------------------------------------
  // Mesh build / destroy. Weapons only build their mesh when first
  // equipped — keeps idle scene-mesh count down for unowned weapons.
  // ------------------------------------------------------------------
  private buildMesh(w: WeaponInstance): void {
    if (w.mesh) return;
    const root = new BABYLON.TransformNode(`arsenal_${w.id}_root`, this.scene);
    const mat = new BABYLON.StandardMaterial(`arsenal_${w.id}_mat`, this.scene);
    mat.emissiveColor = w.config.emissive;
    mat.diffuseColor = w.config.diffuse;
    mat.specularColor = new BABYLON.Color3(1, 1, 1);
    mat.alpha = 0.92;
    w.material = mat;

    const glowLayer = this.scene.effectLayers?.find(l => l instanceof BABYLON.GlowLayer) as BABYLON.GlowLayer | undefined;
    const glow = glowLayer ?? (() => {
      const g = new BABYLON.GlowLayer("arsenalGlow", this.scene);
      g.intensity = 1.4;
      return g;
    })();

    if (w.id === "glaive") {
      // Long polearm — haft + double-edged beam blade at the tip.
      const haft = BABYLON.MeshBuilder.CreateCylinder(`arsenal_${w.id}_haft`, {
        height: 3.2, diameter: 0.10,
      }, this.scene);
      const haftMat = new BABYLON.StandardMaterial(`arsenal_${w.id}_haftMat`, this.scene);
      haftMat.diffuseColor = new BABYLON.Color3(0.18, 0.18, 0.22);
      haftMat.emissiveColor = new BABYLON.Color3(0.05, 0.05, 0.07);
      haft.material = haftMat;
      haft.parent = root;
      haft.position.y = 0;
      haft.isPickable = false;

      const blade = BABYLON.MeshBuilder.CreateBox(`arsenal_${w.id}_blade`, {
        height: 1.6, width: 0.22, depth: 0.06,
      }, this.scene);
      blade.material = mat;
      blade.parent = root;
      blade.position.y = 2.0;
      blade.isPickable = false;
      glow.addIncludedOnlyMesh(blade);
    } else if (w.id === "daggers") {
      // Two short pink beams flanking the camera-forward axis.
      for (let s = -1; s <= 1; s += 2) {
        const blade = BABYLON.MeshBuilder.CreateBox(`arsenal_${w.id}_blade${s}`, {
          height: 1.0, width: 0.10, depth: 0.10,
        }, this.scene);
        blade.material = mat;
        blade.parent = root;
        blade.position = new BABYLON.Vector3(s * 0.35, 0, 0);
        blade.isPickable = false;
        glow.addIncludedOnlyMesh(blade);
      }
    } else if (w.id === "axe") {
      // Heavy haft + chunky orange blade head.
      const haft = BABYLON.MeshBuilder.CreateCylinder(`arsenal_${w.id}_haft`, {
        height: 2.6, diameter: 0.14,
      }, this.scene);
      const haftMat = new BABYLON.StandardMaterial(`arsenal_${w.id}_haftMat`, this.scene);
      haftMat.diffuseColor = new BABYLON.Color3(0.20, 0.14, 0.10);
      haftMat.emissiveColor = new BABYLON.Color3(0.06, 0.04, 0.03);
      haft.material = haftMat;
      haft.parent = root;
      haft.isPickable = false;

      const head = BABYLON.MeshBuilder.CreateBox(`arsenal_${w.id}_head`, {
        height: 0.55, width: 1.10, depth: 0.40,
      }, this.scene);
      head.material = mat;
      head.parent = root;
      head.position = new BABYLON.Vector3(0.45, 1.0, 0);
      head.isPickable = false;
      glow.addIncludedOnlyMesh(head);
    } else if (w.id === "whip") {
      // Eight chained cube links — animated by updateMesh into a lash.
      for (let i = 0; i < 8; i++) {
        const link = BABYLON.MeshBuilder.CreateBox(`arsenal_${w.id}_link${i}`, {
          height: 0.18, width: 0.18, depth: 0.18,
        }, this.scene);
        link.material = mat;
        link.parent = root;
        link.metadata = { whipIndex: i };
        link.isPickable = false;
        glow.addIncludedOnlyMesh(link);
      }
      // Spiked tip — slightly bigger.
      const tip = BABYLON.MeshBuilder.CreateBox(`arsenal_${w.id}_tip`, {
        height: 0.35, width: 0.35, depth: 0.35,
      }, this.scene);
      tip.material = mat;
      tip.parent = root;
      tip.metadata = { whipIndex: 8 };
      tip.isPickable = false;
      glow.addIncludedOnlyMesh(tip);
    }

    root.setEnabled(false);
    w.mesh = root;
  }

  private destroyMesh(w: WeaponInstance): void {
    if (!w.mesh) return;
    w.mesh.dispose(false, true);
    w.mesh = null;
    if (w.material) { w.material.dispose(); w.material = null; }
  }

  // ------------------------------------------------------------------
  // Equip / cycle. Only weapons with `unlocked` true can be equipped.
  // `null` returns control to the Beam Sabre (the default melee).
  // ------------------------------------------------------------------
  isEquipped(): boolean { return this.equipped != null; }
  getEquipped(): ArsenalWeaponId | null { return this.equipped; }
  getEquippedConfig(): WeaponConfig | null {
    return this.equipped ? this.weapons.get(this.equipped)!.config : null;
  }

  setEquipped(id: ArsenalWeaponId | null): void {
    if (id === this.equipped) return;
    if (this.equipped) {
      const cur = this.weapons.get(this.equipped);
      if (cur?.mesh) cur.mesh.setEnabled(false);
    }
    if (id == null) { this.equipped = null; return; }
    const w = this.weapons.get(id);
    if (!w || !w.state.unlocked) return;
    this.buildMesh(w);
    if (w.mesh) w.mesh.setEnabled(true);
    this.equipped = id;
  }

  /** Cycle through SABRE → owned arsenal weapons → SABRE. Returns the
   *  human-readable name of what is now equipped (for HUD). */
  cycle(direction: 1 | -1 = 1): string {
    const order: (ArsenalWeaponId | null)[] = [null];
    for (const id of Object.keys(WEAPON_CONFIGS) as ArsenalWeaponId[]) {
      if (this.weapons.get(id)!.state.unlocked) order.push(id);
    }
    if (order.length === 1) return "Beam Sabre";
    const curIdx = order.indexOf(this.equipped);
    const safeIdx = curIdx < 0 ? 0 : curIdx;
    const next = order[(safeIdx + direction + order.length) % order.length];
    this.setEquipped(next);
    return next == null ? "Beam Sabre" : this.weapons.get(next)!.config.name;
  }

  // ------------------------------------------------------------------
  // Per-weapon level — 1 (unlocked), 2 (combo), 3 (special). Used as a
  // damage / reach scalar so each upgrade tier visibly bumps the weapon.
  // ------------------------------------------------------------------
  private weaponLevel(w: WeaponInstance): number {
    let lvl = 1;
    if (w.state.comboUnlocked) lvl++;
    if (w.state.specialUnlocked) lvl++;
    return lvl;
  }

  private levelDamageMul(w: WeaponInstance): number {
    return 1 + 0.40 * (this.weaponLevel(w) - 1);
  }
  private levelReachMul(w: WeaponInstance): number {
    return 1 + 0.10 * (this.weaponLevel(w) - 1);
  }

  // ------------------------------------------------------------------
  // Mesh pose driven each frame from update(). Rest pose holds the
  // weapon out front + slightly to the right of the camera; swing
  // pose drives a wide arc across the screen for the duration of
  // `swingTimer`. The whip uses a custom per-link layout instead.
  // ------------------------------------------------------------------
  private updateMesh(w: WeaponInstance, dt: number): void {
    if (!w.mesh || w !== this.weapons.get(this.equipped ?? "glaive")) return;
    if (this.equipped !== w.id) return;

    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const right = this.camera.getDirection(BABYLON.Vector3.Right());
    const up = this.camera.getDirection(BABYLON.Vector3.Up());
    const aim = this.getAimOrigin();

    if (w.id === "whip") {
      // Per-link layout: when swinging, the whip lashes out forward with
      // a sinewave undulation; at rest it coils to the player's side.
      const t = w.swingTimer > 0
        ? (1 - w.swingTimer / 0.45)
        : 0;
      const lashLength = w.swingTimer > 0
        ? 6.0 * Math.sin(Math.min(1, t) * Math.PI) + 2.5
        : 1.6;
      const links = w.mesh.getChildren() as BABYLON.AbstractMesh[];
      links.forEach((link) => {
        const idx = (link.metadata as any)?.whipIndex ?? 0;
        const u = idx / 8;
        const offset = right.scale(0.55 - u * 0.2)
          .add(up.scale(-0.35 - u * 0.05))
          .add(forward.scale(2.2 + u * lashLength * 0.55));
        const sway = right.scale(Math.sin((t * 6.0 + u * 2.0)) * (w.swingTimer > 0 ? 0.35 : 0.05));
        const pos = aim.add(offset).add(sway);
        link.position.copyFrom(pos);
      });
      return;
    }

    const root = w.mesh as BABYLON.TransformNode;
    if (!root.rotationQuaternion) {
      root.rotationQuaternion = BABYLON.Quaternion.Identity();
    }
    if (w.swingTimer > 0) {
      const dur = 0.32;
      const t = Math.min(1, 1 - w.swingTimer / dur);
      const dir = w.swingDir;
      const lateral = (dir * 1.7) + (-dir * 1.7 - dir * 1.7) * 0; // start side
      const lateralEnd = -dir * 1.7;
      const lateralPos = (dir * 1.7) + (lateralEnd - dir * 1.7) * t;
      const verticalArc = Math.sin(t * Math.PI) * 0.45 - 0.15;
      const fwdOffset = 2.4 + Math.sin(t * Math.PI) * 0.7;
      void lateral;
      const pos = aim
        .add(forward.scale(fwdOffset))
        .add(right.scale(lateralPos))
        .add(up.scale(verticalArc));
      root.position.copyFrom(pos);
      const baseLook = BABYLON.Quaternion.FromLookDirectionLH(forward, up);
      const rollAngle = dir * (Math.PI * 0.55 - Math.PI * 1.1 * t);
      const roll = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Forward(), rollAngle);
      root.rotationQuaternion = baseLook.multiply(roll);
    } else {
      const pos = aim
        .add(forward.scale(2.0))
        .add(right.scale(0.55))
        .add(up.scale(-0.5));
      root.position.copyFrom(pos);
      const baseLook = BABYLON.Quaternion.FromLookDirectionLH(forward, up);
      const tilt = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Forward(), Math.PI / 6);
      root.rotationQuaternion = baseLook.multiply(tilt);
    }

    void dt;
  }

  // ------------------------------------------------------------------
  // Primary attack — front cone hit. Glaive sweeps wide, daggers stab
  // narrow + fast, axe single heavy hit, whip long narrow line.
  // ------------------------------------------------------------------
  attack(): boolean {
    if (!this.equipped) return false;
    const w = this.weapons.get(this.equipped);
    if (!w || !w.state.unlocked || w.busy || w.cooldownTimer > 0) return false;

    const cfg = w.config;
    const dmgMul = this.levelDamageMul(w);
    const reachMul = this.levelReachMul(w);

    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const aim = this.getAimOrigin();

    // Daggers run a 4-stab chain (6 stabs with combo unlock).
    if (w.id === "daggers") {
      w.busy = true;
      const stabs = w.state.comboUnlocked ? 6 : 4;
      const interval = 70;
      const doStab = (i: number) => {
        if (i >= stabs) {
          w.busy = false;
          w.cooldownTimer = cfg.baseCooldown * 1.6;
          return;
        }
        w.swingTimer = 0.18;
        w.swingDir = i % 2 === 0 ? 1 : -1;
        this.swingHitCone(w, dmgMul * 0.55, reachMul);
        this.bus.emit(GameEvents.COMBO_HIT, {
          comboName: cfg.name,
          attackName: `${cfg.primaryName} ${i + 1}`,
          comboIndex: i,
        });
        this.schedule(w, () => doStab(i + 1), interval);
      };
      // Combo step: brief forward dash before first stab (player teleports
      // 2.5 m forward in the look direction by emitting a movement event).
      if (w.state.comboUnlocked) {
        this.bus.emit("effect:sparkle", { position: aim.add(forward.scale(2.5)) });
      }
      doStab(0);
      return true;
    }

    // Axe: single heavy hit, optional 2nd upper-swing if combo unlocked.
    if (w.id === "axe") {
      w.busy = true;
      w.swingTimer = 0.35;
      w.swingDir = 1;
      this.swingHitCone(w, dmgMul, reachMul);
      this.bus.emit(GameEvents.COMBO_HIT, {
        comboName: cfg.name, attackName: cfg.primaryName, comboIndex: 0,
      });
      this.bus.emit("effect:explosion", {
        position: aim.add(forward.scale(cfg.reach * 0.7 * reachMul)),
        color: cfg.emissive, radius: 1.6,
      });
      if (w.state.comboUnlocked) {
        this.schedule(w, () => {
          w.swingTimer = 0.30; w.swingDir = -1;
          this.swingHitCone(w, dmgMul * 0.85, reachMul * 1.05);
          this.bus.emit(GameEvents.COMBO_HIT, {
            comboName: cfg.name, attackName: "Upper Swing", comboIndex: 1,
          });
          w.busy = false;
          w.cooldownTimer = cfg.baseCooldown;
        }, 280);
      } else {
        this.schedule(w, () => {
          w.busy = false;
          w.cooldownTimer = cfg.baseCooldown;
        }, 320);
      }
      return true;
    }

    // Whip: single long narrow lash. With combo, also pulls a hit enemy
    // ~3 m closer to the player.
    if (w.id === "whip") {
      w.busy = true;
      w.swingTimer = 0.45;
      w.swingDir = 1;
      const hits = this.swingHitCone(w, dmgMul, reachMul);
      if (w.state.comboUnlocked && hits.length > 0) {
        // Pull-in: nudge the closest hit enemy 3 m toward the player.
        const target = hits[0];
        const toPlayer = aim.subtract(target.position).normalize();
        target.position.addInPlace(toPlayer.scale(3));
        this.bus.emit("effect:sparkle", { position: target.position.clone() });
      }
      this.bus.emit(GameEvents.COMBO_HIT, {
        comboName: cfg.name, attackName: cfg.primaryName, comboIndex: 0,
      });
      this.schedule(w, () => {
        w.busy = false;
        w.cooldownTimer = cfg.baseCooldown;
      }, 380);
      return true;
    }

    // Glaive: wide sweep. With combo, a 3-hit chain fans across.
    if (w.id === "glaive") {
      w.busy = true;
      const sweeps = w.state.comboUnlocked ? 3 : 1;
      const interval = 130;
      const doSweep = (i: number) => {
        if (i >= sweeps) {
          w.busy = false;
          w.cooldownTimer = cfg.baseCooldown;
          return;
        }
        w.swingTimer = 0.30;
        w.swingDir = i % 2 === 0 ? 1 : -1;
        this.swingHitCone(w, dmgMul, reachMul);
        this.bus.emit(GameEvents.COMBO_HIT, {
          comboName: cfg.name, attackName: `${cfg.primaryName} ${i + 1}`, comboIndex: i,
        });
        this.schedule(w, () => doSweep(i + 1), interval);
      };
      doSweep(0);
      return true;
    }
    return false;
  }

  /** Apply damage to anything in front of the player inside the weapon's
   *  cone + radius. Returns the list of hit enemy meshes (sorted by
   *  distance) so attack callers can react to the first hit. */
  private swingHitCone(
    w: WeaponInstance,
    dmgMul: number,
    reachMul: number,
  ): BABYLON.AbstractMesh[] {
    const cfg = w.config;
    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const aim = this.getAimOrigin();
    const radius = cfg.primaryRadius * reachMul;
    const halfCone = cfg.cone / 2;
    const dmg = cfg.baseDamage * dmgMul;

    const hits: { mesh: BABYLON.AbstractMesh; dist: number }[] = [];
    for (const mesh of this.getTargets()) {
      if (!this.isHittable(mesh)) continue;
      const toMesh = mesh.position.subtract(aim);
      const dist = toMesh.length();
      const meshHitR = (mesh.metadata as any)?.hitRadius ?? 1.5;
      if (dist > radius + meshHitR) continue;
      if (dist < 0.1) { hits.push({ mesh, dist }); continue; }
      const dir = toMesh.normalize();
      const cosA = BABYLON.Vector3.Dot(dir, forward);
      // Allow a wider hit when extremely close (within 2 m) so point-blank
      // swings don't whiff just because the enemy is partly behind the cone.
      const minCos = dist < 2.0 ? -0.2 : Math.cos(halfCone);
      if (cosA < minCos) continue;
      hits.push({ mesh, dist });
    }
    hits.sort((a, b) => a.dist - b.dist);
    for (const h of hits) {
      const info: DamageInfo = {
        amount: dmg,
        hitPoint: h.mesh.position.clone(),
        hitDirection: h.mesh.position.subtract(aim).normalize(),
        damageType: DamageType.Melee,
        knockbackForce: cfg.knockback,
      };
      const dealt = this.dealDamage(h.mesh, dmg, info);
      this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
        position: h.mesh.position.clone(),
        damage: dealt,
        isCritical: w.id === "axe",
      });
    }
    return hits.map(h => h.mesh);
  }

  // ------------------------------------------------------------------
  // Special attacks — only available when the weapon's `specialUnlocked`
  // flag is set. Each runs to completion and locks the weapon for its
  // animation duration so it can't double-fire.
  // ------------------------------------------------------------------
  fireSpecial(): boolean {
    if (!this.equipped) return false;
    const w = this.weapons.get(this.equipped);
    if (!w || !w.state.specialUnlocked || w.busy) return false;
    if (w.cooldownTimer > 0) return false;
    if (w.id === "glaive") return this.fireCometSpin(w);
    if (w.id === "daggers") return this.firePhantomStorm(w);
    if (w.id === "axe") return this.fireGroundSlam(w);
    if (w.id === "whip") return this.fireFlailSpin(w);
    return false;
  }

  /** Glaive special: spawns a green crescent that orbits the player at
   *  6 m radius for ~1.4 s, damaging anything it passes. */
  private fireCometSpin(w: WeaponInstance): boolean {
    const cfg = w.config;
    const aim = this.getAimOrigin();
    const crescent = BABYLON.MeshBuilder.CreateTorus("arsenal_glaive_comet", {
      diameter: 12, thickness: 0.55, tessellation: 28,
    }, this.scene);
    const mat = new BABYLON.StandardMaterial("arsenal_glaive_cometMat", this.scene);
    mat.emissiveColor = cfg.emissive;
    mat.diffuseColor = cfg.diffuse;
    mat.alpha = 0.55;
    crescent.material = mat;
    crescent.isPickable = false;
    crescent.position.copyFrom(aim);
    const glow = this.scene.effectLayers?.find(l => l instanceof BABYLON.GlowLayer) as BABYLON.GlowLayer | undefined;
    if (glow) glow.addIncludedOnlyMesh(crescent);
    w.cometMesh = crescent;
    w.cometTimer = 1.4;
    w.cometHits = new Map();
    w.cooldownTimer = 4.0;
    this.bus.emit(GameEvents.UI_MESSAGE, { text: "COMET SPIN!", duration: 1.2 });
    return true;
  }

  /** Daggers special: teleport-strikes up to 3 nearest enemies in 18 m,
   *  damaging each with a brief sparkle afterimage. */
  private firePhantomStorm(w: WeaponInstance): boolean {
    const cfg = w.config;
    const aim = this.getAimOrigin();
    const candidates: { mesh: BABYLON.AbstractMesh; dist: number }[] = [];
    for (const mesh of this.getTargets()) {
      if (!this.isHittable(mesh)) continue;
      const dist = BABYLON.Vector3.Distance(aim, mesh.position);
      if (dist < 18) candidates.push({ mesh, dist });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    const targets = candidates.slice(0, 3);
    if (targets.length === 0) {
      this.bus.emit(GameEvents.UI_MESSAGE, { text: "NO TARGET", duration: 0.9 });
      return false;
    }
    w.busy = true;
    const dmg = cfg.baseDamage * this.levelDamageMul(w) * 1.8;
    const strike = (i: number) => {
      if (i >= targets.length) {
        w.busy = false;
        w.cooldownTimer = 3.5;
        return;
      }
      const t = targets[i];
      const info: DamageInfo = {
        amount: dmg,
        hitPoint: t.mesh.position.clone(),
        hitDirection: t.mesh.position.subtract(aim).normalize(),
        damageType: DamageType.Melee,
        knockbackForce: cfg.knockback,
      };
      const dealt = this.dealDamage(t.mesh, dmg, info);
      this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
        position: t.mesh.position.clone(), damage: dealt, isCritical: true,
      });
      this.bus.emit("effect:sparkle", { position: t.mesh.position.clone() });
      this.schedule(w, () => strike(i + 1), 140);
    };
    strike(0);
    this.bus.emit(GameEvents.UI_MESSAGE, { text: "PHANTOM STORM!", duration: 1.2 });
    return true;
  }

  /** Axe special: expanding shockwave ring on the ground that knocks up
   *  and damages every enemy it touches once. */
  private fireGroundSlam(w: WeaponInstance): boolean {
    const cfg = w.config;
    const aim = this.getAimOrigin();
    const groundOrigin = new BABYLON.Vector3(aim.x, Math.max(0, aim.y - 1.2), aim.z);
    const ring = BABYLON.MeshBuilder.CreateTorus("arsenal_axe_shock", {
      diameter: 1.5, thickness: 0.45, tessellation: 32,
    }, this.scene);
    const mat = new BABYLON.StandardMaterial("arsenal_axe_shockMat", this.scene);
    mat.emissiveColor = cfg.emissive;
    mat.diffuseColor = cfg.diffuse;
    mat.alpha = 0.7;
    ring.material = mat;
    ring.isPickable = false;
    ring.position.copyFrom(groundOrigin);
    const glow = this.scene.effectLayers?.find(l => l instanceof BABYLON.GlowLayer) as BABYLON.GlowLayer | undefined;
    if (glow) glow.addIncludedOnlyMesh(ring);
    w.shockRingMesh = ring;
    w.shockRingTimer = 0.85;
    w.shockRingOrigin = groundOrigin;
    w.shockRingHits = new Set();
    w.busy = true;
    w.cooldownTimer = 4.5;
    this.bus.emit("effect:explosion", {
      position: groundOrigin.clone(), color: cfg.emissive, radius: 4,
    });
    this.bus.emit(GameEvents.UI_MESSAGE, { text: "GROUND SLAM!", duration: 1.2 });
    this.schedule(w, () => { w.busy = false; }, 600);
    return true;
  }

  /** Whip special: 360° flail spin around the player — 4 damage ticks
   *  over 1 s inside an expanded radius. */
  private fireFlailSpin(w: WeaponInstance): boolean {
    const cfg = w.config;
    const aim = this.getAimOrigin();
    const radius = 9.0 * this.levelReachMul(w);
    w.busy = true;
    w.flailTimer = 1.0;
    w.cooldownTimer = 4.0;
    const ticks = 4;
    let n = 0;
    const tickFn = () => {
      const here = this.getAimOrigin();
      for (const mesh of this.getTargets()) {
        if (!this.isHittable(mesh)) continue;
        const meshHitR = (mesh.metadata as any)?.hitRadius ?? 1.5;
        const dist = BABYLON.Vector3.Distance(here, mesh.position);
        if (dist < radius + meshHitR) {
          const dmg = cfg.baseDamage * this.levelDamageMul(w) * 0.6;
          const info: DamageInfo = {
            amount: dmg,
            hitPoint: mesh.position.clone(),
            hitDirection: mesh.position.subtract(here).normalize(),
            damageType: DamageType.Melee,
            knockbackForce: cfg.knockback,
          };
          const dealt = this.dealDamage(mesh, dmg, info);
          this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
            position: mesh.position.clone(), damage: dealt, isCritical: false,
          });
        }
      }
      this.bus.emit("effect:sparkle", { position: here.clone() });
      n++;
      if (n < ticks) {
        this.schedule(w, tickFn, 220);
      } else {
        w.busy = false;
      }
      void aim;
    };
    tickFn();
    this.bus.emit(GameEvents.UI_MESSAGE, { text: "FLAIL SPIN!", duration: 1.2 });
    return true;
  }

  // ------------------------------------------------------------------
  // Per-frame update — animates the equipped mesh, drives active
  // specials, ticks per-weapon cooldowns.
  // ------------------------------------------------------------------
  update(dt: number): void {
    const allWeapons = Array.from(this.weapons.values());
    for (const w of allWeapons) {
      if (w.cooldownTimer > 0) {
        w.cooldownTimer -= dt;
        if (w.cooldownTimer < 0) w.cooldownTimer = 0;
      }
      if (w.swingTimer > 0) {
        w.swingTimer -= dt;
        if (w.swingTimer < 0) w.swingTimer = 0;
      }
      // Comet Spin orbit + damage.
      if (w.cometMesh && w.cometTimer > 0) {
        w.cometTimer -= dt;
        const here = this.getAimOrigin();
        w.cometMesh.position.copyFrom(here);
        w.cometMesh.rotation.y += dt * 8.0;
        // Damage anything in the ring (radius 6) once per appearance.
        const RING_R = 6.0;
        const TOL = 1.5;
        const cfg = w.config;
        const dmg = cfg.baseDamage * this.levelDamageMul(w) * 0.7;
        const now = performance.now();
        for (const mesh of this.getTargets()) {
          if (!this.isHittable(mesh)) continue;
          const dist = BABYLON.Vector3.Distance(here, mesh.position);
          if (Math.abs(dist - RING_R) < TOL) {
            const last = w.cometHits.get(mesh) ?? 0;
            if (now - last < 220) continue;
            w.cometHits.set(mesh, now);
            const info: DamageInfo = {
              amount: dmg,
              hitPoint: mesh.position.clone(),
              hitDirection: mesh.position.subtract(here).normalize(),
              damageType: DamageType.Melee,
              knockbackForce: cfg.knockback,
            };
            const dealt = this.dealDamage(mesh, dmg, info);
            this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
              position: mesh.position.clone(), damage: dealt, isCritical: false,
            });
          }
        }
        if (w.cometTimer <= 0) {
          w.cometMesh.material?.dispose();
          w.cometMesh.dispose();
          w.cometMesh = null;
          w.cometHits.clear();
        }
      }
      // Ground Slam ring expand.
      if (w.shockRingMesh && w.shockRingTimer > 0 && w.shockRingOrigin) {
        w.shockRingTimer -= dt;
        const t = 1 - Math.max(0, w.shockRingTimer / 0.85);
        const radius = 1.0 + 14.0 * t;
        w.shockRingMesh.scaling.set(radius, 1, radius);
        const cfg = w.config;
        const dmg = cfg.baseDamage * this.levelDamageMul(w) * 1.4;
        for (const mesh of this.getTargets()) {
          if (!this.isHittable(mesh)) continue;
          if (w.shockRingHits.has(mesh)) continue;
          // Vertical gate so a ground shockwave can't hit aerial targets
          // far above the ring just because they're horizontally aligned.
          // 3 m band covers normal ground enemies (incl. tall heavies)
          // but excludes flying ships / drones cruising at altitude.
          if (Math.abs(mesh.position.y - w.shockRingOrigin.y) > 3.0) continue;
          const meshHitR = (mesh.metadata as any)?.hitRadius ?? 1.5;
          const flatDist = Math.hypot(
            mesh.position.x - w.shockRingOrigin.x,
            mesh.position.z - w.shockRingOrigin.z,
          );
          if (Math.abs(flatDist - radius) < 1.5 + meshHitR) {
            w.shockRingHits.add(mesh);
            const info: DamageInfo = {
              amount: dmg,
              hitPoint: mesh.position.clone(),
              hitDirection: mesh.position.subtract(w.shockRingOrigin).normalize(),
              damageType: DamageType.Melee,
              knockbackForce: cfg.knockback * 1.5,
            };
            const dealt = this.dealDamage(mesh, dmg, info);
            this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
              position: mesh.position.clone(), damage: dealt, isCritical: true,
            });
          }
        }
        if (w.shockRingTimer <= 0) {
          w.shockRingMesh.material?.dispose();
          w.shockRingMesh.dispose();
          w.shockRingMesh = null;
          w.shockRingOrigin = null;
          w.shockRingHits.clear();
        }
      }
      if (w.flailTimer > 0) {
        w.flailTimer -= dt;
        if (w.flailTimer < 0) w.flailTimer = 0;
      }
      this.updateMesh(w, dt);
    }
  }

  // ------------------------------------------------------------------
  // Unlocks (called by Game.tsx handleUnlockSpecial). Idempotent.
  // ------------------------------------------------------------------
  unlockWeapon(id: ArsenalWeaponId): void {
    const w = this.weapons.get(id);
    if (!w) return;
    w.state.unlocked = true;
  }
  unlockCombo(id: ArsenalWeaponId): void {
    const w = this.weapons.get(id);
    if (!w) return;
    w.state.comboUnlocked = true;
    if (!w.state.unlocked) w.state.unlocked = true; // combo implies owned
  }
  unlockSpecial(id: ArsenalWeaponId): void {
    const w = this.weapons.get(id);
    if (!w) return;
    w.state.specialUnlocked = true;
    if (!w.state.unlocked) w.state.unlocked = true;
  }

  isOwned(id: ArsenalWeaponId): boolean {
    return !!this.weapons.get(id)?.state.unlocked;
  }
  hasCombo(id: ArsenalWeaponId): boolean {
    return !!this.weapons.get(id)?.state.comboUnlocked;
  }
  hasSpecial(id: ArsenalWeaponId): boolean {
    return !!this.weapons.get(id)?.state.specialUnlocked;
  }

  // ------------------------------------------------------------------
  // Persistence — match BeamSabreSystem getSpecialsState/applyLoadedState.
  // ------------------------------------------------------------------
  getSnapshot(): ArsenalSnapshot {
    const snap = (id: ArsenalWeaponId): ArsenalWeaponSnapshot => {
      const w = this.weapons.get(id)!;
      return {
        unlocked: w.state.unlocked,
        comboUnlocked: w.state.comboUnlocked,
        specialUnlocked: w.state.specialUnlocked,
      };
    };
    return {
      glaive: snap("glaive"),
      daggers: snap("daggers"),
      axe: snap("axe"),
      whip: snap("whip"),
      equipped: this.equipped,
    };
  }

  applyLoadedState(state: Partial<ArsenalSnapshot>): void {
    const apply = (id: ArsenalWeaponId, s?: Partial<ArsenalWeaponSnapshot>) => {
      if (!s) return;
      const w = this.weapons.get(id)!;
      if (s.unlocked) w.state.unlocked = true;
      if (s.comboUnlocked) w.state.comboUnlocked = true;
      if (s.specialUnlocked) w.state.specialUnlocked = true;
    };
    apply("glaive", state.glaive);
    apply("daggers", state.daggers);
    apply("axe", state.axe);
    apply("whip", state.whip);
    // Don't auto-equip on load — the player picks via KeyB. The mesh is
    // built lazily on first equip so unowned weapons cost nothing.
  }

  dispose(): void {
    const allWeapons = Array.from(this.weapons.values());
    for (const w of allWeapons) {
      for (const t of w.timers) clearTimeout(t);
      w.timers = [];
      this.destroyMesh(w);
      if (w.cometMesh) {
        w.cometMesh.material?.dispose();
        w.cometMesh.dispose();
        w.cometMesh = null;
      }
      if (w.shockRingMesh) {
        w.shockRingMesh.material?.dispose();
        w.shockRingMesh.dispose();
        w.shockRingMesh = null;
      }
    }
    this.weapons.clear();
    this.equipped = null;
  }
}
