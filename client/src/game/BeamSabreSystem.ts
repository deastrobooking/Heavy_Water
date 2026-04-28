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
const LEVEL_CONFIGS: Omit<BeamSabre, "isActive">[] = [
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

  private sabreMesh: BABYLON.Mesh | null = null;
  private energyWaves: EnergyWave[] = [];
  private bus: EventBus;
  private sabre: BeamSabre;
  private currentSlash: number = 0;
  private isSlashing: boolean = false;
  private cooldownTimer: number = 0;
  private slashTimers: number[] = [];
  private bladeMaterial: BABYLON.StandardMaterial | null = null;

  // Optional external router. When set, the sabre delegates damage to the
  // game's central routeHit (so it correctly hurts aerial fortresses, enemy
  // bases, mining nodes, props, etc.). When null, falls back to the local
  // metadata.damageable handler that only works on ground enemies.
  private damageRouter: ((mesh: BABYLON.AbstractMesh, dmg: number) => void) | null = null;
  setDamageRouter(fn: (mesh: BABYLON.AbstractMesh, dmg: number) => void): void {
    this.damageRouter = fn;
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

  private dealDamage(mesh: BABYLON.AbstractMesh, amount: number, info: DamageInfo): number {
    if (this.damageRouter) {
      this.damageRouter(mesh, amount);
      return amount;
    }
    const damageable = (mesh.metadata as any).damageable as IDamageable;
    const result = applyDamage(damageable, info);
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
      isActive: false,
      cooldown: LEVEL_CONFIGS[0].cooldown,
    };

    this.createBladeMesh();
  }

  private createBladeMesh(): void {
    this.sabreMesh = BABYLON.MeshBuilder.CreateBox("beamSabreBlade", {
      height: 1.8,
      width: 0.06,
      depth: 0.06,
    }, this.scene);

    this.bladeMaterial = new BABYLON.StandardMaterial("beamSabreMat", this.scene);
    this.bladeMaterial.emissiveColor = new BABYLON.Color3(0, 0.9, 1);
    this.bladeMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.8, 1);
    this.bladeMaterial.specularColor = new BABYLON.Color3(1, 1, 1);
    this.bladeMaterial.alpha = 0.85;

    this.sabreMesh.material = this.bladeMaterial;
    this.sabreMesh.isPickable = false;
    this.sabreMesh.setEnabled(false);

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
    if (!this.sabreMesh || !this.sabre.isActive) return;

    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const right = this.camera.getDirection(BABYLON.Vector3.Right());
    const up = this.camera.getDirection(BABYLON.Vector3.Up());

    const pos = this.getAimOrigin()
      .add(forward.scale(1.2))
      .add(right.scale(0.5))
      .add(up.scale(-0.3));

    this.sabreMesh.position.copyFrom(pos);

    const lookDir = forward.clone();
    const bladeUp = up.clone();
    const rotQuat = BABYLON.Quaternion.FromLookDirectionLH(lookDir, bladeUp);
    const extraRot = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Forward(), Math.PI / 6);

    if (!this.sabreMesh.rotationQuaternion) {
      this.sabreMesh.rotationQuaternion = BABYLON.Quaternion.Identity();
    }
    this.sabreMesh.rotationQuaternion = rotQuat.multiply(extraRot);
  }

  toggle(): void {
    this.sabre.isActive = !this.sabre.isActive;
    if (this.sabreMesh) {
      this.sabreMesh.setEnabled(this.sabre.isActive);
    }
    this.currentSlash = 0;
    this.isSlashing = false;

    this.bus.emit(GameEvents.UI_MESSAGE, {
      text: this.sabre.isActive ? "Beam Sabre Activated" : "Beam Sabre Deactivated",
      duration: 1.5,
    });
  }

  attack(): void {
    if (!this.sabre.isActive || this.isSlashing || this.cooldownTimer > 0) return;

    this.isSlashing = true;
    this.currentSlash = 0;
    this.performSlashSequence();
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
    const origin = this.getAimOrigin().add(forward.scale(2.5));
    // Slightly larger reach so the sword feels satisfying.
    const hitRadius = 5;

    const list = targets && targets.length ? targets : this.scene.meshes;
    for (const mesh of list) {
      if (!this.isHittable(mesh)) continue;

      const dist = BABYLON.Vector3.Distance(origin, mesh.position);
      const meshHitR = (mesh.metadata as any)?.hitRadius ?? 1.5;
      if (dist < hitRadius + meshHitR) {
        const info: DamageInfo = {
          amount: this.sabre.damage,
          hitPoint: mesh.position.clone(),
          hitDirection: mesh.position.subtract(this.getAimOrigin()).normalize(),
          damageType: DamageType.Melee,
          knockbackForce: 5,
        };
        const dealt = this.dealDamage(mesh, this.sabre.damage, info);

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

    const startAngle = this.currentSlash % 2 === 0 ? -Math.PI / 3 : Math.PI / 3;
    const endAngle = this.currentSlash % 2 === 0 ? Math.PI / 3 : -Math.PI / 3;

    const anim = new BABYLON.Animation(
      "sabreSlash",
      "rotation.z",
      60,
      BABYLON.Animation.ANIMATIONTYPE_FLOAT,
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
    );

    anim.setKeys([
      { frame: 0, value: startAngle },
      { frame: 6, value: endAngle },
      { frame: 10, value: 0 },
    ]);

    this.sabreMesh.animations = [anim];
    this.scene.beginAnimation(this.sabreMesh, 0, 10, false, 2);
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

      const waveMesh = BABYLON.MeshBuilder.CreateBox(`energyWave_${Date.now()}_${i}`, {
        height: 0.3,
        width: this.sabre.energyWaveWidth,
        depth: 0.5,
      }, this.scene);

      const waveMat = new BABYLON.StandardMaterial(`energyWaveMat_${Date.now()}_${i}`, this.scene);
      waveMat.emissiveColor = new BABYLON.Color3(0, 1, 1);
      waveMat.diffuseColor = new BABYLON.Color3(0, 0.8, 1);
      waveMat.alpha = 0.75;
      waveMesh.material = waveMat;
      waveMesh.isPickable = false;

      const spawnPos = this.getAimOrigin().add(forward.scale(2));
      waveMesh.position.copyFrom(spawnPos);

      const lookDir = forward.clone();
      const upDir = BABYLON.Vector3.Up();
      waveMesh.rotationQuaternion = BABYLON.Quaternion.FromLookDirectionLH(lookDir, upDir);

      const hitRadius = this.sabre.level >= 5 ? this.sabre.energyWaveWidth * 0.8 : this.sabre.energyWaveWidth * 0.5;

      const wave: EnergyWave = {
        mesh: waveMesh,
        direction: forward.clone(),
        speed: this.sabre.energyWaveSpeed,
        damage: this.sabre.energyWaveDamage,
        lifetime: 2,
        elapsed: 0,
        hitRadius,
        piercing,
        hitEnemies: new Set(),
      };

      this.energyWaves.push(wave);
    }

    this.bus.emit(GameEvents.UI_MESSAGE, {
      text: "Energy Wave!",
      duration: 1,
    });
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
        : this.scene.meshes.filter(m => this.isHittable(m));

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
