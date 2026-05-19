import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { DamageInfo, DamageType, IDamageable, applyDamage } from "./DamageSystem";

export interface BeamSabre {
  level: number;
  damage: number;
  energyWaveDamage: number;
  slashCount: number;
  energyWaveWidth: number;
  energyWaveSpeed: number;
  isActive: boolean;
  cooldown: number;
  // Optional one-shot specials, unlocked from the Upgrade Bay > Specials tab.
  hasSpinAttack: boolean;  // Hold attack ≥0.5s, release for 360° spin slash.
  hasTwinWave: boolean;    // Each launch also fires a much larger red wave behind.
  hasGiantBlade: boolean;  // 1.6× blade, +50% damage / hit-radius, deeper red glow.
  hasGoldSabre: boolean;   // Final tier — inner blue / middle red / outer gold blade,
                           // every energy-wave launch fires 3 stacked waves
                           // (blue → red → largest gold).
}

interface EnergyWave {
  mesh: BABYLON.Mesh;
  direction: BABYLON.Vector3;
  speed: number;
  damage: number;
  lifetime: number;
  elapsed: number;
  hitRadius: number;
  piercing: boolean;
  hitEnemies: Set<BABYLON.AbstractMesh>;
}

// Beam Sabre is the on-foot signature weapon — damage is intentionally
// massive so foot combat feels every bit as exciting as flying or driving.
// `hasSpinAttack`/`hasTwinWave`/`hasGiantBlade` are orthogonal one-time SPECIALS
// unlocks, not per-level stats, so they're omitted from the per-level table.
const LEVEL_CONFIGS: Omit<BeamSabre, "isActive" | "hasSpinAttack" | "hasTwinWave" | "hasGiantBlade" | "hasGoldSabre">[] = [
  { level: 1, damage: 120, energyWaveDamage: 220, slashCount: 2, energyWaveWidth: 3, energyWaveSpeed: 35, cooldown: 0.7 },
  { level: 2, damage: 170, energyWaveDamage: 320, slashCount: 2, energyWaveWidth: 4, energyWaveSpeed: 40, cooldown: 0.6 },
  { level: 3, damage: 240, energyWaveDamage: 460, slashCount: 3, energyWaveWidth: 5, energyWaveSpeed: 45, cooldown: 0.55 },
  { level: 4, damage: 320, energyWaveDamage: 620, slashCount: 4, energyWaveWidth: 6, energyWaveSpeed: 50, cooldown: 0.5 },
  { level: 5, damage: 450, energyWaveDamage: 900, slashCount: 5, energyWaveWidth: 8, energyWaveSpeed: 55, cooldown: 0.4 },
];

export class BeamSabreSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private aimOriginProvider: (() => BABYLON.Vector3) | null = null;

  setAimOriginProvider(fn: () => BABYLON.Vector3): void {
    this.aimOriginProvider = fn;
  }

  private getAimOrigin(): BABYLON.Vector3 {
    return this.aimOriginProvider ? this.aimOriginProvider() : this.camera.position;
  }

  /** Curated list provider — avoids scanning scene.meshes (O(all meshes))
   *  on every slash/spin/wave hit check. Game.tsx wires this to the same
   *  enemyMeshScratch list used by WeaponsSystem. */
  private hittableMeshProvider: (() => BABYLON.AbstractMesh[]) | null = null;
  setHittableMeshProvider(fn: () => BABYLON.AbstractMesh[]): void {
    this.hittableMeshProvider = fn;
  }
  private getTargets(): BABYLON.AbstractMesh[] {
    return this.hittableMeshProvider ? this.hittableMeshProvider() : this.scene.meshes;
  }

  private sabreMesh: BABYLON.Mesh | null = null;
  private energyWaves: EnergyWave[] = [];
  private bus: EventBus;
  private sabre: BeamSabre;
  private currentSlash: number = 0;
  private isSlashing: boolean = false;
  private cooldownTimer: number = 0;
  private slashTimers: number[] = [];
  private bladeMaterial: BABYLON.StandardMaterial | null = null;

  // Screen-sweep slash animation. While `slashAnimTimer > 0` the blade is
  // driven through a horizontal arc across the screen instead of being held
  // in its rest pose.
  private slashAnimTimer: number = 0;
  private slashAnimDuration: number = 0.28;
  private slashSwingDir: number = 1;

  // Spin-blade animation (whole-body 360° sweep around the player). Drives
  // the blade through a continuous yaw rotation while the timer is positive.
  private spinAnimTimer: number = 0;
  private readonly spinAnimDuration: number = 0.55;

  // Charge state for the spin-blade special. `chargeStart` is null when the
  // attack key is not currently held. We only START a charge when the spin
  // upgrade is owned — without it, attack() fires immediately on press as
  // before so the base feel is unchanged.
  private chargeStart: number | null = null;
  private readonly spinChargeMs: number = 500;
  // Owned-as-an-upgrade specials. Defaults match BeamSabre.has* flags.
  // Mirrored so the live mesh can be re-styled when toggled at runtime.
  private giantBladeApplied: boolean = false;
  private goldSabreApplied: boolean = false;
  // Concentric blade halo meshes added by the gold-sabre unlock. Parented
  // to the main sabreMesh so they inherit every transform automatically —
  // no extra updateBladePosition wiring required.
  private bladeHaloRed: BABYLON.Mesh | null = null;
  private bladeHaloGold: BABYLON.Mesh | null = null;

  // Optional external router. When set, the sabre delegates damage to the
  // game's central routeHit (so it correctly hurts aerial fortresses, enemy
  // bases, mining nodes, props, etc.). When null, falls back to the local
  // metadata.damageable handler that only works on ground enemies.
  private damageRouter: ((mesh: BABYLON.AbstractMesh, dmg: number) => void) | null = null;
  setDamageRouter(fn: (mesh: BABYLON.AbstractMesh, dmg: number) => void): void {
    this.damageRouter = fn;
  }

  // Optional checker that returns ms-since-last-boost-dash. When set and
  // the player slashes within the chain window, we instantly fire an energy
  // wave (LB → LT chain) without waiting for a full multi-slash combo.
  private dashChecker: (() => number) | null = null;
  private dashChainWindowMs: number = 600;
  setDashChecker(fn: () => number): void {
    this.dashChecker = fn;
  }

  private isHittable(mesh: BABYLON.AbstractMesh): boolean {
    if (!mesh.metadata) return false;
    const m = mesh.metadata as any;
    if (this.damageRouter) {
      // Match the actual metadata flags used by each system:
      //   EnemySystem      → isEnemy + damageable
      //   AerialEnemySystem → aerialUnit
      //   EnemyBaseSystem  → isTurret / isVault
      //   MiningSystem     → miningNodeId
      //   EnvironmentPropSystem → isProp
      return !!(m.isEnemy || m.aerialUnit || m.isTurret || m.isVault || m.miningNodeId || m.isProp);
    }
    return !!(m.isEnemy && m.damageable);
  }

  /** Per-level player damage scaling (PlayerController.getLevelDamageMul).
   *  Applied uniformly to every sabre melee + energy-wave hit so the
   *  level cap (1.99 at L100) reaches melee combat the same way it
   *  reaches ranged via WeaponsSystem.setPlayerLevelMul. */
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

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.bus = EventBus.getInstance();

    this.sabre = {
      level: 1,
      damage: LEVEL_CONFIGS[0].damage,
      energyWaveDamage: LEVEL_CONFIGS[0].energyWaveDamage,
      slashCount: LEVEL_CONFIGS[0].slashCount,
      energyWaveWidth: LEVEL_CONFIGS[0].energyWaveWidth,
      energyWaveSpeed: LEVEL_CONFIGS[0].energyWaveSpeed,
      // The Beam Sabre is always active — pressing Y or LT just slashes.
      // No more dedicated toggle key.
      isActive: true,
      cooldown: LEVEL_CONFIGS[0].cooldown,
      hasSpinAttack: false,
      hasTwinWave: false,
      hasGiantBlade: false,
      hasGoldSabre: false,
    };

    this.createBladeMesh();
  }

  private createBladeMesh(): void {
    // Bigger blade (was 1.8×0.06×0.06) so the slash reads clearly at any FOV
    // and the longer reach matches the expanded slash hit-radius.
    this.sabreMesh = BABYLON.MeshBuilder.CreateBox("beamSabreBlade", {
      height: 2.6,
      width: 0.12,
      depth: 0.12,
    }, this.scene);

    this.bladeMaterial = new BABYLON.StandardMaterial("beamSabreMat", this.scene);
    this.bladeMaterial.emissiveColor = new BABYLON.Color3(0, 0.9, 1);
    this.bladeMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.8, 1);
    this.bladeMaterial.specularColor = new BABYLON.Color3(1, 1, 1);
    this.bladeMaterial.alpha = 0.9;

    this.sabreMesh.material = this.bladeMaterial;
    this.sabreMesh.isPickable = false;
    // Always shown — the sabre never deactivates.
    this.sabreMesh.setEnabled(true);

    const glowLayer = this.scene.effectLayers?.find(l => l instanceof BABYLON.GlowLayer) as BABYLON.GlowLayer | undefined;
    if (glowLayer) {
      glowLayer.addIncludedOnlyMesh(this.sabreMesh);
    } else {
      const glow = new BABYLON.GlowLayer("sabreGlow", this.scene);
      glow.intensity = 1.5;
      glow.addIncludedOnlyMesh(this.sabreMesh);
    }
  }

  private updateBladePosition(): void {
    // The sabre is always active — only bail if the mesh is gone.
    if (!this.sabreMesh) return;

    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const right = this.camera.getDirection(BABYLON.Vector3.Right());
    const up = this.camera.getDirection(BABYLON.Vector3.Up());

    if (!this.sabreMesh.rotationQuaternion) {
      this.sabreMesh.rotationQuaternion = BABYLON.Quaternion.Identity();
    }

    if (this.spinAnimTimer > 0) {
      // Spin-blade visual: hold the blade out level and yaw it through a
      // continuous 720° sweep around the world-Y axis so it visibly carves a
      // ring around the player.
      const t = 1 - this.spinAnimTimer / this.spinAnimDuration;
      const reach = this.sabre.hasGiantBlade ? 4.2 : 3.4;
      const pos = this.getAimOrigin().add(forward.scale(reach * 0.4)).add(up.scale(-0.2));
      this.sabreMesh.position.copyFrom(pos);
      const yaw = t * Math.PI * 4; // two full rotations across the duration
      const yawQ = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Up(), yaw);
      const tilt = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Forward(), Math.PI / 2);
      this.sabreMesh.rotationQuaternion = yawQ.multiply(tilt);
    } else if (this.slashAnimTimer > 0) {
      // Drive the blade through a wide horizontal arc across the screen.
      // t goes 0 → 1 over the full slash duration.
      const t = 1 - this.slashAnimTimer / this.slashAnimDuration;
      const dir = this.slashSwingDir;
      // Position: start ~1.6m off to one side, arc forward, end on opposite
      // side. The vertical sin curve gives a satisfying "lift then drop" feel.
      const lateralStart = dir * 1.8;
      const lateralEnd = -dir * 1.8;
      const lateral = lateralStart + (lateralEnd - lateralStart) * t;
      const verticalArc = Math.sin(t * Math.PI) * 0.45 - 0.15;
      // Push the blade well in front of the camera — the 2.6m blade is held
      // at its midpoint, so the back tip sits at (forwardOffset − 1.3).
      const forwardOffset = 2.4 + Math.sin(t * Math.PI) * 0.6;

      const pos = this.getAimOrigin()
        .add(forward.scale(forwardOffset))
        .add(right.scale(lateral))
        .add(up.scale(verticalArc));
      this.sabreMesh.position.copyFrom(pos);

      // Rotation: blade swings tangent to its motion. Roll the blade around
      // the camera-forward axis from +90° to -90° (or reverse) so it visibly
      // sweeps across the screen.
      const baseLook = BABYLON.Quaternion.FromLookDirectionLH(forward, up);
      const rollAngle = dir * (Math.PI * 0.55 - Math.PI * 1.1 * t);
      const roll = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Forward(), rollAngle);
      this.sabreMesh.rotationQuaternion = baseLook.multiply(roll);
    } else {
      // Rest pose — blade held forward and to the right, tilted up. The
      // blade is 2.6m centered, so a 2.0m forward offset keeps the hilt
      // ~0.7m in front of the camera (no near-plane clipping).
      const pos = this.getAimOrigin()
        .add(forward.scale(2.0))
        .add(right.scale(0.6))
        .add(up.scale(-0.4));
      this.sabreMesh.position.copyFrom(pos);

      const rotQuat = BABYLON.Quaternion.FromLookDirectionLH(forward, up);
      const extraRot = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Forward(), Math.PI / 6);
      this.sabreMesh.rotationQuaternion = rotQuat.multiply(extraRot);
    }
  }

  /** No-op — kept for API compatibility. The sabre is always active now,
   *  so there's nothing to toggle. */
  toggle(): void {
    this.sabre.isActive = true;
    if (this.sabreMesh) this.sabreMesh.setEnabled(true);
  }

  attack(): void {
    if (!this.sabre.isActive || this.isSlashing || this.cooldownTimer > 0) return;

    // Dash → slash chain: if the player just boost-dashed, fire the energy
    // wave immediately, do a single satisfying slash, and put the sabre on
    // cooldown. This is the LB → LT signature combo.
    if (this.dashChecker) {
      const sinceMs = this.dashChecker();
      if (sinceMs <= this.dashChainWindowMs) {
        this.isSlashing = true;
        this.currentSlash = 0;
        this.performSlashHit();
        this.animateSlash();
        this.launchEnergyWave();
        this.cooldownTimer = this.sabre.cooldown;
        // Release the slash lock after the visual finishes.
        const t = window.setTimeout(() => {
          this.isSlashing = false;
          this.currentSlash = 0;
        }, 220);
        this.slashTimers.push(t);
        return;
      }
    }

    this.isSlashing = true;
    this.currentSlash = 0;
    this.performSlashSequence();
  }

  /** Begin a charge for the spin-blade special. Called on attack-key DOWN.
   *  Without the spin upgrade owned, behaves like a regular attack press so
   *  the existing single-tap feel is preserved. With it owned, holding the
   *  key for ≥ spinChargeMs and then releasing fires the spin attack; a
   *  short tap fires a normal slash on release.
   */
  startCharge(): void {
    if (!this.sabre.hasSpinAttack) {
      this.attack();
      return;
    }
    if (this.isSlashing || this.cooldownTimer > 0) return;
    this.chargeStart = performance.now();
  }

  /** Resolve a held attack. Called on attack-key UP. */
  releaseCharge(): void {
    if (!this.sabre.hasSpinAttack) {
      // Nothing to do — the slash already fired on the press.
      return;
    }
    const start = this.chargeStart;
    this.chargeStart = null;
    if (start === null) return;
    const heldMs = performance.now() - start;
    if (heldMs >= this.spinChargeMs) {
      this.performSpinAttack();
    } else {
      this.attack();
    }
  }

  private performSlashSequence(): void {
    if (this.currentSlash >= this.sabre.slashCount) {
      this.launchEnergyWave();
      this.isSlashing = false;
      this.cooldownTimer = this.sabre.cooldown;
      this.currentSlash = 0;
      return;
    }

    this.performSlashHit();
    this.animateSlash();

    this.currentSlash++;

    const timer = window.setTimeout(() => {
      this.performSlashSequence();
    }, 200);
    this.slashTimers.push(timer);
  }

  private performSlashHit(targets?: BABYLON.AbstractMesh[]): void {
    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    // Reach further into the world so the longer blade actually connects with
    // enemies the player can see at the tip of the sweep.
    const giantMul = this.sabre.hasGiantBlade ? 1.5 : 1.0;
    const origin = this.getAimOrigin().add(forward.scale(3.2 * giantMul));
    const hitRadius = 7 * giantMul;
    const dmg = this.sabre.damage * giantMul;

    const list = targets && targets.length ? targets : this.getTargets();
    for (const mesh of list) {
      if (!this.isHittable(mesh)) continue;

      const dist = BABYLON.Vector3.Distance(origin, mesh.position);
      const meshHitR = (mesh.metadata as any)?.hitRadius ?? 1.5;
      if (dist < hitRadius + meshHitR) {
        const info: DamageInfo = {
          amount: dmg,
          hitPoint: mesh.position.clone(),
          hitDirection: mesh.position.subtract(this.getAimOrigin()).normalize(),
          damageType: DamageType.Melee,
          knockbackForce: 5,
        };
        const dealt = this.dealDamage(mesh, dmg, info);

        this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
          position: mesh.position.clone(),
          damage: dealt,
          isCritical: false,
        });
      }
    }

    this.bus.emit(GameEvents.COMBO_HIT, {
      comboName: "Beam Sabre",
      attackName: `Slash ${this.currentSlash + 1}`,
      comboIndex: this.currentSlash,
    });
  }

  private animateSlash(): void {
    if (!this.sabreMesh) return;
    // Rest of the animation is driven from updateBladePosition() — we just
    // reset the timer here and pick a swing direction that alternates per
    // slash so multi-hit combos visibly cross back and forth.
    this.slashAnimTimer = this.slashAnimDuration;
    this.slashSwingDir = this.currentSlash % 2 === 0 ? 1 : -1;
  }

  private launchEnergyWave(): void {
    const waveCount = this.sabre.level >= 4 ? 2 : 1;
    const piercing = this.sabre.level >= 3;

    for (let i = 0; i < waveCount; i++) {
      const forward = this.camera.getDirection(BABYLON.Vector3.Forward());

      if (waveCount > 1 && i > 0) {
        const right = this.camera.getDirection(BABYLON.Vector3.Right());
        forward.addInPlace(right.scale(0.15));
        forward.normalize();
      }

      this.spawnArcWave(forward, {
        sizeMul: 1.0,
        damageMul: 1.0,
        speedMul: 1.0,
        spawnForwardOffset: 2,
        emissive: new BABYLON.Color3(0, 1, 1),
        diffuse: new BABYLON.Color3(0, 0.8, 1),
        piercing,
        index: i,
      });
    }

    // Twin-wave special: chase every blue wave with one big red trailing
    // wave that does ~60% more damage and is much wider, so it crashes
    // through anything the lead wave didn't kill. Skipped when the gold
    // sabre is owned — gold-mode owns the wave layout (strict three-wave
    // blue→red→gold cascade) and the Twin red would land between them.
    if (this.sabre.hasTwinWave && !this.sabre.hasGoldSabre) {
      const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
      this.spawnArcWave(forward, {
        sizeMul: 1.9,
        damageMul: 1.6,
        speedMul: 0.78,
        spawnForwardOffset: -2.4,
        emissive: new BABYLON.Color3(1.0, 0.18, 0.10),
        diffuse: new BABYLON.Color3(0.85, 0.10, 0.05),
        piercing: true,
        index: 99,
      });
    }

    // Gold-sabre special: chase every launch with a red mid-wave then a
    // huge gold wave behind it. Always piercing, always dramatic. The
    // base cyan wave above already fired, so blue → red → gold reads
    // exactly in that order as they leave the sabre.
    if (this.sabre.hasGoldSabre) {
      const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
      this.spawnArcWave(forward, {
        sizeMul: 1.55,
        damageMul: 1.5,
        speedMul: 0.88,
        spawnForwardOffset: -1.2,
        emissive: new BABYLON.Color3(1.0, 0.20, 0.12),
        diffuse: new BABYLON.Color3(0.9, 0.12, 0.06),
        piercing: true,
        index: 200,
      });
      this.spawnArcWave(forward, {
        sizeMul: 2.2,
        damageMul: 2.0,
        speedMul: 0.72,
        spawnForwardOffset: -2.8,
        emissive: new BABYLON.Color3(1.0, 0.78, 0.18),
        diffuse: new BABYLON.Color3(1.0, 0.62, 0.10),
        piercing: true,
        index: 201,
      });
    }

    this.bus.emit(GameEvents.UI_MESSAGE, {
      text: this.sabre.hasGoldSabre
        ? "GOLD WAVE!"
        : (this.sabre.hasTwinWave ? "Twin Wave!" : "Energy Wave!"),
      duration: 1,
    });
  }

  private spawnArcWave(
    forward: BABYLON.Vector3,
    opts: {
      sizeMul: number;
      damageMul: number;
      speedMul: number;
      spawnForwardOffset: number;
      emissive: BABYLON.Color3;
      diffuse: BABYLON.Color3;
      piercing: boolean;
      index: number;
    },
  ): void {
    const giantMul = this.sabre.hasGiantBlade ? 1.5 : 1.0;
    // Arc-shaped slash wave (crescent), built as a tube along a curved path.
    // The crescent's TIPS lead in +Z and the convex back bulges toward the
    // player at -Z, so from the third-person camera it reads like a proper
    // anime slash wave (")"-shaped) instead of a horseshoe ("(") opening
    // back at the player.
    const arcRadius = Math.max(2, this.sabre.energyWaveWidth * 0.7) * opts.sizeMul * giantMul;
    const arcSpan = Math.PI * 0.85;
    const segments = 18;
    const arcPath: BABYLON.Vector3[] = [];
    for (let s = 0; s <= segments; s++) {
      const u = s / segments;
      const angle = -arcSpan / 2 + arcSpan * u;
      arcPath.push(new BABYLON.Vector3(
        Math.sin(angle) * arcRadius,
        0,
        // Flipped sign vs the original: tips (large |angle|) sit forward
        // at +z, center sits at z=0, so the wave's convex back faces the
        // player as it travels in +Z.
        (arcRadius - Math.cos(angle) * arcRadius),
      ));
    }
    const baseTubeRadius = this.sabre.level >= 4 ? 0.28 : 0.22;
    const tubeRadius = baseTubeRadius * opts.sizeMul * giantMul;
    const id = `${Date.now()}_${opts.index}`;
    const waveMesh = BABYLON.MeshBuilder.CreateTube(`energyWave_${id}`, {
      path: arcPath,
      radius: tubeRadius,
      tessellation: 10,
      cap: BABYLON.Mesh.CAP_ALL,
    }, this.scene);

    const waveMat = new BABYLON.StandardMaterial(`energyWaveMat_${id}`, this.scene);
    waveMat.emissiveColor = opts.emissive;
    waveMat.diffuseColor = opts.diffuse;
    waveMat.alpha = 0.8;
    waveMesh.material = waveMat;
    waveMesh.isPickable = false;

    const spawnPos = this.getAimOrigin().add(forward.scale(opts.spawnForwardOffset));
    waveMesh.position.copyFrom(spawnPos);

    const upDir = BABYLON.Vector3.Up();
    waveMesh.rotationQuaternion = BABYLON.Quaternion.FromLookDirectionLH(forward.clone(), upDir);

    const baseHitR = this.sabre.level >= 5
      ? this.sabre.energyWaveWidth * 0.8
      : this.sabre.energyWaveWidth * 0.5;
    const hitRadius = baseHitR * opts.sizeMul * giantMul;

    const wave: EnergyWave = {
      mesh: waveMesh,
      direction: forward.clone(),
      speed: this.sabre.energyWaveSpeed * opts.speedMul,
      damage: this.sabre.energyWaveDamage * opts.damageMul * giantMul,
      lifetime: 2.2,
      elapsed: 0,
      hitRadius,
      piercing: opts.piercing,
      hitEnemies: new Set(),
    };

    this.energyWaves.push(wave);
  }

  /** Spin-blade special: 360° AoE around the player. Costs 2× cooldown but
   *  hits everything in a generous radius for double slash damage. */
  private performSpinAttack(): void {
    if (this.isSlashing || this.cooldownTimer > 0) return;
    const giantMul = this.sabre.hasGiantBlade ? 1.5 : 1.0;
    const origin = this.getAimOrigin();
    const hitR = 12 * giantMul;
    const dmg = this.sabre.damage * 2.0 * giantMul;

    for (const mesh of this.getTargets()) {
      if (!this.isHittable(mesh)) continue;
      const dist = BABYLON.Vector3.Distance(origin, mesh.position);
      const meshHitR = (mesh.metadata as any)?.hitRadius ?? 1.5;
      if (dist < hitR + meshHitR) {
        const info: DamageInfo = {
          amount: dmg,
          hitPoint: mesh.position.clone(),
          hitDirection: mesh.position.subtract(origin).normalize(),
          damageType: DamageType.Melee,
          knockbackForce: 14,
        };
        const dealt = this.dealDamage(mesh, dmg, info);
        this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
          position: mesh.position.clone(),
          damage: dealt,
          isCritical: true,
        });
      }
    }

    this.spinAnimTimer = this.spinAnimDuration;
    this.cooldownTimer = this.sabre.cooldown * 2;
    this.bus.emit("effect:explosion", {
      position: origin.clone(),
      color: new BABYLON.Color3(0.2, 1, 1),
      radius: hitR,
    });
    this.bus.emit(GameEvents.UI_MESSAGE, {
      text: "SPIN BLADE!",
      duration: 1.2,
    });
  }

  /** Cancel any pending slash chain (timers + state). Used by combo specials
   *  to preempt the regular slash that fires from the LT trigger one frame
   *  before the combo button is processed. Cooldown is intentionally NOT
   *  cleared — the combo's own cooldown check still gates re-entry. */
  private cancelInFlightSlash(): void {
    for (const t of this.slashTimers) clearTimeout(t);
    this.slashTimers = [];
    this.isSlashing = false;
    this.currentSlash = 0;
    this.chargeStart = null;
  }

  // Set while a Fury or Smash combo is mid-execution. The combo's own guard
  // checks this so a re-press of the same combo key cannot cancel and restart
  // an in-flight combo before its cooldown begins.
  private specialComboActive: boolean = false;

  /** Fury Slash special (LT + Y combo): 5 rapid LARGE slashes in front of
   *  the player, each with a wider hit radius and bumped damage. No trailing
   *  energy wave — the slashes are the payload. Locked out by isSlashing /
   *  cooldown like the regular attack so it can't stack with itself. */
  performFurySlash(): boolean {
    if (!this.sabre.isActive || this.cooldownTimer > 0 || this.specialComboActive) return false;
    // Preempt any in-flight regular slash sequence triggered by the LT key
    // dispatch that comes a frame before the combo key — without this, the
    // LT-then-Y order would always fail the isSlashing guard.
    this.cancelInFlightSlash();
    this.specialComboActive = true;
    this.isSlashing = true;
    this.currentSlash = 0;
    const SLASH_COUNT = 5;
    const INTERVAL_MS = 95;
    const radiusMul = 1.6;
    const dmgMul = 1.4;
    const giantMul = this.sabre.hasGiantBlade ? 1.5 : 1.0;

    const doSlash = () => {
      // Inline a beefed-up version of performSlashHit so we don't have to
      // re-plumb optional multipliers through the regular slash path.
      const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
      const origin = this.getAimOrigin().add(forward.scale(3.2 * giantMul));
      const hitRadius = 7 * giantMul * radiusMul;
      const dmg = this.sabre.damage * giantMul * dmgMul;
      for (const mesh of this.getTargets()) {
        if (!this.isHittable(mesh)) continue;
        const dist = BABYLON.Vector3.Distance(origin, mesh.position);
        const meshHitR = (mesh.metadata as any)?.hitRadius ?? 1.5;
        if (dist < hitRadius + meshHitR) {
          const info: DamageInfo = {
            amount: dmg,
            hitPoint: mesh.position.clone(),
            hitDirection: mesh.position.subtract(this.getAimOrigin()).normalize(),
            damageType: DamageType.Melee,
            knockbackForce: 7,
          };
          const dealt = this.dealDamage(mesh, dmg, info);
          this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
            position: mesh.position.clone(),
            damage: dealt,
            isCritical: true,
          });
        }
      }
      this.bus.emit(GameEvents.COMBO_HIT, {
        comboName: "Fury Slash",
        attackName: `Fury ${this.currentSlash + 1}`,
        comboIndex: this.currentSlash,
      });
      // Drive the visible blade swing — alternate direction per slash so the
      // blade visibly criss-crosses across the screen.
      this.slashAnimTimer = this.slashAnimDuration * 0.65;
      this.slashSwingDir = this.currentSlash % 2 === 0 ? 1 : -1;
      this.currentSlash++;
      if (this.currentSlash < SLASH_COUNT) {
        const t = window.setTimeout(doSlash, INTERVAL_MS);
        this.slashTimers.push(t);
      } else {
        this.isSlashing = false;
        this.currentSlash = 0;
        this.cooldownTimer = Math.max(this.sabre.cooldown, 1.8);
        this.specialComboActive = false;
      }
    };

    doSlash();
    this.bus.emit(GameEvents.UI_MESSAGE, { text: "FURY SLASH!", duration: 1.2 });
    return true;
  }

  /** Smash Lash special (LT + X combo): one big overhead smash followed by
   *  a ring of energy waves radiating outward in all directions on the
   *  horizontal plane. Each ring wave reuses the regular wave config so the
   *  range, speed, hit radius and damage match a normal energy wave — there
   *  are just twelve of them, fanning out around the player. */
  performSmashLash(): boolean {
    if (!this.sabre.isActive || this.cooldownTimer > 0 || this.specialComboActive) return false;
    this.cancelInFlightSlash();
    this.specialComboActive = true;
    this.isSlashing = true;
    this.currentSlash = 0;
    const giantMul = this.sabre.hasGiantBlade ? 1.5 : 1.0;

    // ----- The smash: a single beefy hit in front of the player. -----
    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const origin = this.getAimOrigin().add(forward.scale(3.2 * giantMul));
    const hitRadius = 9 * giantMul;
    const dmg = this.sabre.damage * 1.8 * giantMul;
    for (const mesh of this.getTargets()) {
      if (!this.isHittable(mesh)) continue;
      const dist = BABYLON.Vector3.Distance(origin, mesh.position);
      const meshHitR = (mesh.metadata as any)?.hitRadius ?? 1.5;
      if (dist < hitRadius + meshHitR) {
        const info: DamageInfo = {
          amount: dmg,
          hitPoint: mesh.position.clone(),
          hitDirection: mesh.position.subtract(this.getAimOrigin()).normalize(),
          damageType: DamageType.Melee,
          knockbackForce: 16,
        };
        const dealt = this.dealDamage(mesh, dmg, info);
        this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
          position: mesh.position.clone(),
          damage: dealt,
          isCritical: true,
        });
      }
    }
    // Use the regular slash visual — alternate dir gives a downward-cross
    // smash read against the prior slash.
    this.slashAnimTimer = this.slashAnimDuration;
    this.slashSwingDir = -this.slashSwingDir;

    // ----- The omnidirectional shockwave: 12 waves, 30° apart, on the XZ
    // plane. Each is a normal cyan wave so it inherits all wave behavior
    // (lifetime, hit radius, piercing rule, sabre-level scaling). -----
    const RING_COUNT = 12;
    for (let i = 0; i < RING_COUNT; i++) {
      const ang = (i / RING_COUNT) * Math.PI * 2;
      const dir = new BABYLON.Vector3(Math.sin(ang), 0, Math.cos(ang)).normalize();
      this.spawnArcWave(dir, {
        sizeMul: 1.0,
        damageMul: 1.0,
        speedMul: 1.0,
        spawnForwardOffset: 2,
        emissive: new BABYLON.Color3(0.15, 0.95, 1),
        diffuse: new BABYLON.Color3(0.05, 0.7, 1),
        piercing: this.sabre.level >= 3,
        index: 1000 + i,
      });
    }

    this.bus.emit("effect:explosion", {
      position: this.getAimOrigin().clone(),
      color: new BABYLON.Color3(0.4, 1, 1),
      radius: 6,
    });
    this.bus.emit(GameEvents.UI_MESSAGE, { text: "SMASH LASH!", duration: 1.3 });

    // Lock state and start cooldown. Reuse a short timer to release the
    // slash lock once the smash anim finishes so the blade returns to rest.
    this.cooldownTimer = Math.max(this.sabre.cooldown, 2.5);
    const t = window.setTimeout(() => {
      this.isSlashing = false;
      this.currentSlash = 0;
      this.specialComboActive = false;
    }, 280);
    this.slashTimers.push(t);
    return true;
  }

  /** Unlock the spin-blade special. */
  unlockSpinAttack(): void {
    this.sabre.hasSpinAttack = true;
  }

  /** Unlock the twin-wave (red trailing wave) special. */
  unlockTwinWave(): void {
    this.sabre.hasTwinWave = true;
  }

  /** Unlock the giant-blade special. Restyles the live blade mesh and bumps
   *  base damage / hit radius. Idempotent. */
  unlockGiantBlade(): void {
    this.sabre.hasGiantBlade = true;
    if (!this.giantBladeApplied) {
      this.giantBladeApplied = true;
      if (this.sabreMesh) {
        this.sabreMesh.scaling.scaleInPlace(1.6);
      }
      if (this.bladeMaterial) {
        this.bladeMaterial.emissiveColor = new BABYLON.Color3(1.0, 0.15, 0.30);
        this.bladeMaterial.diffuseColor = new BABYLON.Color3(1.0, 0.25, 0.35);
      }
    }
  }

  /** Final-tier unlock. Restyles the blade as three concentric layers
   *  (inner blue / middle red / outer gold) and arms the gold-wave triple
   *  launch. Idempotent. */
  unlockGoldSabre(): void {
    this.sabre.hasGoldSabre = true;
    if (this.goldSabreApplied) return;
    this.goldSabreApplied = true;
    if (!this.sabreMesh) return;

    // Inner core → bright blue. Recolors the existing blade material.
    if (this.bladeMaterial) {
      this.bladeMaterial.emissiveColor = new BABYLON.Color3(0.15, 0.55, 1.0);
      this.bladeMaterial.diffuseColor = new BABYLON.Color3(0.20, 0.70, 1.0);
      this.bladeMaterial.alpha = 1.0;
    }

    const glowLayer = this.scene.effectLayers?.find(l => l instanceof BABYLON.GlowLayer) as BABYLON.GlowLayer | undefined;

    // Middle layer — red sheath, slightly larger than the blue core.
    this.bladeHaloRed = BABYLON.MeshBuilder.CreateBox("beamSabreBladeRed", {
      height: 2.62, width: 0.22, depth: 0.22,
    }, this.scene);
    const matRed = new BABYLON.StandardMaterial("beamSabreMatRed", this.scene);
    matRed.emissiveColor = new BABYLON.Color3(1.0, 0.18, 0.10);
    matRed.diffuseColor = new BABYLON.Color3(0.9, 0.12, 0.05);
    matRed.specularColor = new BABYLON.Color3(1, 0.5, 0.3);
    matRed.alpha = 0.55;
    this.bladeHaloRed.material = matRed;
    this.bladeHaloRed.isPickable = false;
    this.bladeHaloRed.parent = this.sabreMesh;
    this.bladeHaloRed.position = BABYLON.Vector3.Zero();
    if (glowLayer) glowLayer.addIncludedOnlyMesh(this.bladeHaloRed);

    // Outer layer — gold halo, the widest of the three.
    this.bladeHaloGold = BABYLON.MeshBuilder.CreateBox("beamSabreBladeGold", {
      height: 2.66, width: 0.36, depth: 0.36,
    }, this.scene);
    const matGold = new BABYLON.StandardMaterial("beamSabreMatGold", this.scene);
    matGold.emissiveColor = new BABYLON.Color3(1.0, 0.78, 0.18);
    matGold.diffuseColor = new BABYLON.Color3(1.0, 0.62, 0.10);
    matGold.specularColor = new BABYLON.Color3(1, 1, 0.6);
    matGold.alpha = 0.32;
    this.bladeHaloGold.material = matGold;
    this.bladeHaloGold.isPickable = false;
    this.bladeHaloGold.parent = this.sabreMesh;
    this.bladeHaloGold.position = BABYLON.Vector3.Zero();
    if (glowLayer) glowLayer.addIncludedOnlyMesh(this.bladeHaloGold);
  }

  hasSpinAttack(): boolean { return this.sabre.hasSpinAttack; }
  hasTwinWave(): boolean { return this.sabre.hasTwinWave; }
  hasGiantBlade(): boolean { return this.sabre.hasGiantBlade; }
  hasGoldSabre(): boolean { return this.sabre.hasGoldSabre; }

  /** Snapshot of all sabre state worth persisting across death/restart. */
  getSpecialsState(): { level: number; hasSpinAttack: boolean; hasTwinWave: boolean; hasGiantBlade: boolean; hasGoldSabre: boolean } {
    return {
      level: this.sabre.level,
      hasSpinAttack: this.sabre.hasSpinAttack,
      hasTwinWave: this.sabre.hasTwinWave,
      hasGiantBlade: this.sabre.hasGiantBlade,
      hasGoldSabre: this.sabre.hasGoldSabre,
    };
  }

  /**
   * Restore the sabre's persisted state on a fresh load. Sets stats *directly*
   * from `LEVEL_CONFIGS[target-1]` rather than replaying `upgrade()` — the
   * upgrade() path emits a `UI_MESSAGE` toast per step, which would spam
   * "Beam Sabre upgraded to Level N!" during the loading screen on every
   * death/restart cycle. Visual side-effects are routed through the canonical
   * `unlockGiantBlade()` (idempotent) so the mesh-scaling 1.6× is preserved
   * — not just the material color.
   */
  applyLoadedState(state: { level?: number; hasSpinAttack?: boolean; hasTwinWave?: boolean; hasGiantBlade?: boolean; hasGoldSabre?: boolean }): void {
    if (typeof state.level === "number") {
      const target = Math.max(1, Math.min(LEVEL_CONFIGS.length, state.level));
      const config = LEVEL_CONFIGS[target - 1];
      this.sabre.level = config.level;
      this.sabre.damage = config.damage;
      this.sabre.energyWaveDamage = config.energyWaveDamage;
      this.sabre.slashCount = config.slashCount;
      this.sabre.energyWaveWidth = config.energyWaveWidth;
      this.sabre.energyWaveSpeed = config.energyWaveSpeed;
      this.sabre.cooldown = config.cooldown;
      // Mirror the L≥3 blade recolor that upgrade() applies, otherwise a
      // restored level-3+ sabre would render with the level-1/2 cyan blade.
      if (this.bladeMaterial && this.sabre.level >= 3) {
        this.bladeMaterial.emissiveColor = new BABYLON.Color3(0.8, 0.1, 1);
        this.bladeMaterial.diffuseColor = new BABYLON.Color3(0.9, 0.2, 1);
      }
    }
    if (state.hasSpinAttack) this.sabre.hasSpinAttack = true;
    if (state.hasTwinWave) this.sabre.hasTwinWave = true;
    if (state.hasGiantBlade) {
      // Reuse the canonical unlock so the mesh scale (1.6×) and the deep-red
      // material recolor are both applied, idempotently.
      this.unlockGiantBlade();
    }
    if (state.hasGoldSabre) {
      // Canonical unlock — rebuilds the layered blade halos so a restored
      // gold sabre renders with its full inner-blue / middle-red / outer-gold
      // silhouette and the triple-wave launch.
      this.unlockGoldSabre();
    }
  }

  upgrade(): void {
    if (this.sabre.level >= 5) return;

    const nextLevel = this.sabre.level;
    const config = LEVEL_CONFIGS[nextLevel];

    this.sabre.level = config.level;
    this.sabre.damage = config.damage;
    this.sabre.energyWaveDamage = config.energyWaveDamage;
    this.sabre.slashCount = config.slashCount;
    this.sabre.energyWaveWidth = config.energyWaveWidth;
    this.sabre.energyWaveSpeed = config.energyWaveSpeed;
    this.sabre.cooldown = config.cooldown;

    if (this.bladeMaterial && this.sabre.level >= 3) {
      this.bladeMaterial.emissiveColor = new BABYLON.Color3(0.8, 0.1, 1);
      this.bladeMaterial.diffuseColor = new BABYLON.Color3(0.9, 0.2, 1);
    }

    this.bus.emit(GameEvents.UI_MESSAGE, {
      text: `Beam Sabre upgraded to Level ${this.sabre.level}!`,
      duration: 2,
    });
  }

  update(dt: number, enemies?: BABYLON.AbstractMesh[]): void {
    if (this.cooldownTimer > 0) {
      this.cooldownTimer -= dt;
    }
    if (this.slashAnimTimer > 0) {
      this.slashAnimTimer -= dt;
      if (this.slashAnimTimer < 0) this.slashAnimTimer = 0;
    }
    if (this.spinAnimTimer > 0) {
      this.spinAnimTimer -= dt;
      if (this.spinAnimTimer < 0) this.spinAnimTimer = 0;
    }

    this.updateBladePosition();

    for (let i = this.energyWaves.length - 1; i >= 0; i--) {
      const wave = this.energyWaves[i];
      wave.elapsed += dt;

      if (wave.elapsed >= wave.lifetime) {
        wave.mesh.dispose();
        this.energyWaves.splice(i, 1);
        continue;
      }

      wave.mesh.position.addInPlace(wave.direction.scale(wave.speed * dt));

      const targets = enemies && enemies.length
        ? enemies
        : this.getTargets();

      let consumed = false;
      for (const mesh of targets) {
        if (!this.isHittable(mesh)) continue;
        if (wave.hitEnemies.has(mesh)) continue;

        const meshHitR = (mesh.metadata as any)?.hitRadius ?? 1.5;
        const dist = BABYLON.Vector3.Distance(wave.mesh.position, mesh.position);
        if (dist < wave.hitRadius + meshHitR) {
          const isAoE = this.sabre.level >= 5;
          if (isAoE) {
            const aoeDamage = wave.damage * 0.6;
            for (const otherMesh of targets) {
              if (otherMesh === mesh) continue;
              if (!this.isHittable(otherMesh)) continue;
              if (wave.hitEnemies.has(otherMesh)) continue;
              const otherR = (otherMesh.metadata as any)?.hitRadius ?? 1.5;
              const aoeDist = BABYLON.Vector3.Distance(mesh.position, otherMesh.position);
              if (aoeDist < wave.hitRadius * 1.5 + otherR) {
                const aoeInfo: DamageInfo = {
                  amount: aoeDamage,
                  hitPoint: otherMesh.position.clone(),
                  hitDirection: otherMesh.position.subtract(wave.mesh.position).normalize(),
                  damageType: DamageType.Melee,
                  knockbackForce: 8,
                };
                const aoeDealt = this.dealDamage(otherMesh, aoeDamage, aoeInfo);
                wave.hitEnemies.add(otherMesh);

                this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
                  position: otherMesh.position.clone(),
                  damage: aoeDealt,
                  isCritical: false,
                });
              }
            }
          }

          const info: DamageInfo = {
            amount: wave.damage,
            hitPoint: mesh.position.clone(),
            hitDirection: wave.direction.clone(),
            damageType: DamageType.Melee,
            knockbackForce: 10,
          };
          const dealt = this.dealDamage(mesh, wave.damage, info);
          wave.hitEnemies.add(mesh);

          this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
            position: mesh.position.clone(),
            damage: dealt,
            isCritical: false,
          });

          if (!wave.piercing) {
            wave.mesh.dispose();
            this.energyWaves.splice(i, 1);
            consumed = true;
            break;
          }
        }
      }
      if (consumed) continue;
    }
  }

  get active(): boolean {
    return this.sabre.isActive;
  }

  get getLevel(): number {
    return this.sabre.level;
  }

  get getDamage(): number {
    return this.sabre.damage;
  }

  dispose(): void {
    for (const t of this.slashTimers) {
      clearTimeout(t);
    }
    this.slashTimers = [];
    // Reset slash state so a fresh re-init won't be locked out if a chain
    // attack was mid-flight when dispose() ran.
    this.isSlashing = false;
    this.currentSlash = 0;

    if (this.sabreMesh) {
      this.sabreMesh.dispose();
      this.sabreMesh = null;
    }

    if (this.bladeMaterial) {
      this.bladeMaterial.dispose();
      this.bladeMaterial = null;
    }

    for (const wave of this.energyWaves) {
      wave.mesh.material?.dispose();
      wave.mesh.dispose();
    }
    this.energyWaves = [];
  }
}
