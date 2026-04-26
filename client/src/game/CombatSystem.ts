import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { DamageInfo, DamageType, IDamageable, applyDamage } from "./DamageSystem";

export interface AttackData {
  name: string;
  damage: number;
  knockback: number;
  attackDuration: number;
  comboWindow: number;
  hitRadius: number;
  hitOffset: number;
  damageType: DamageType;
}

export interface ComboChain {
  name: string;
  attacks: AttackData[];
  resetTime: number;
  currentIndex: number;
  lastAttackTime: number;
  canCombo: boolean;
}

export class CombatSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private aimOriginProvider: (() => BABYLON.Vector3) | null = null;

  setAimOriginProvider(fn: () => BABYLON.Vector3): void {
    this.aimOriginProvider = fn;
  }

  private getAimOrigin(): BABYLON.Vector3 {
    return this.aimOriginProvider ? this.aimOriginProvider() : this.camera.position;
  }

  private isAttacking: boolean = false;
  private inputBuffered: boolean = false;
  private inputBufferTimer: number = 0;
  private readonly INPUT_BUFFER_TIME = 0.2;
  private currentCombo: ComboChain | null = null;
  private lightCombo: ComboChain;
  private heavyCombo: ComboChain;
  private damageMultiplier: number = 1.0;
  private bus: EventBus;
  private attackTimers: number[] = [];

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.bus = EventBus.getInstance();

    this.lightCombo = {
      name: "Light Combo",
      attacks: [
        { name: "Jab", damage: 15, knockback: 3, attackDuration: 0.4, comboWindow: 0.2, hitRadius: 3, hitOffset: 2, damageType: DamageType.Melee },
        { name: "Cross", damage: 20, knockback: 4, attackDuration: 0.45, comboWindow: 0.2, hitRadius: 3, hitOffset: 2, damageType: DamageType.Melee },
        { name: "Uppercut", damage: 30, knockback: 6, attackDuration: 0.6, comboWindow: 0, hitRadius: 3.5, hitOffset: 2, damageType: DamageType.Melee },
      ],
      resetTime: 1.5,
      currentIndex: 0,
      lastAttackTime: 0,
      canCombo: false,
    };

    this.heavyCombo = {
      name: "Heavy Combo",
      attacks: [
        { name: "Slam", damage: 35, knockback: 8, attackDuration: 0.7, comboWindow: 0.3, hitRadius: 4, hitOffset: 2.5, damageType: DamageType.Melee },
        { name: "Sweep", damage: 45, knockback: 10, attackDuration: 0.8, comboWindow: 0, hitRadius: 5, hitOffset: 2, damageType: DamageType.Melee },
      ],
      resetTime: 2.0,
      currentIndex: 0,
      lastAttackTime: 0,
      canCombo: false,
    };
  }

  update(dt: number): void {
    if (this.currentCombo) {
      const elapsed = (performance.now() / 1000) - this.currentCombo.lastAttackTime;
      if (elapsed > this.currentCombo.resetTime) {
        this.resetCombo();
      }
    }

    if (this.inputBufferTimer > 0) {
      this.inputBufferTimer -= dt;
      if (this.inputBufferTimer <= 0) this.inputBuffered = false;
    }

    if (this.inputBuffered && !this.isAttacking) {
      this.inputBuffered = false;
      this.onLightAttack();
    }
  }

  onLightAttack(): boolean {
    if (!this.isAttacking) {
      this.startCombo(this.lightCombo);
      return true;
    } else if (this.currentCombo?.canCombo) {
      this.continueCombo();
      return true;
    } else {
      this.inputBuffered = true;
      this.inputBufferTimer = this.INPUT_BUFFER_TIME;
      return false;
    }
  }

  onHeavyAttack(): boolean {
    if (!this.isAttacking) {
      this.startCombo(this.heavyCombo);
      return true;
    }
    return false;
  }

  private startCombo(combo: ComboChain): void {
    this.currentCombo = combo;
    combo.currentIndex = 0;
    combo.lastAttackTime = performance.now() / 1000;
    this.executeAttack(combo.attacks[0]);
  }

  private continueCombo(): void {
    if (!this.currentCombo) return;
    this.currentCombo.currentIndex =
      (this.currentCombo.currentIndex + 1) % this.currentCombo.attacks.length;
    this.currentCombo.lastAttackTime = performance.now() / 1000;
    this.executeAttack(this.currentCombo.attacks[this.currentCombo.currentIndex]);
  }

  private executeAttack(attack: AttackData): void {
    this.isAttacking = true;

    const hitDelay = window.setTimeout(() => {
      this.performHitDetection(attack);
    }, 150);
    this.attackTimers.push(hitDelay);

    const comboDelay = window.setTimeout(() => {
      if (this.currentCombo) this.currentCombo.canCombo = true;
    }, attack.comboWindow * 1000);
    this.attackTimers.push(comboDelay);

    const endDelay = window.setTimeout(() => {
      this.isAttacking = false;
      if (this.currentCombo) this.currentCombo.canCombo = false;
    }, attack.attackDuration * 1000);
    this.attackTimers.push(endDelay);

    this.bus.emit(GameEvents.COMBO_HIT, {
      comboName: this.currentCombo?.name,
      attackName: attack.name,
      comboIndex: this.currentCombo?.currentIndex ?? 0,
    });
  }

  private performHitDetection(attack: AttackData): void {
    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const origin = this.getAimOrigin().add(forward.scale(attack.hitOffset));

    const meshes = this.scene.meshes;
    for (const mesh of meshes) {
      if (!mesh.metadata?.isEnemy || !mesh.metadata?.damageable) continue;

      const dist = BABYLON.Vector3.Distance(origin, mesh.position);
      if (dist < attack.hitRadius) {
        const damageable = mesh.metadata.damageable as IDamageable;
        const info: DamageInfo = {
          amount: attack.damage * this.damageMultiplier,
          hitPoint: mesh.position.clone(),
          hitDirection: mesh.position.subtract(this.getAimOrigin()).normalize(),
          damageType: attack.damageType,
          knockbackForce: attack.knockback,
        };
        const result = applyDamage(damageable, info);

        this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
          position: mesh.position.clone(),
          damage: result.damageAmount,
          isCritical: false,
        });
      }
    }
  }

  private resetCombo(): void {
    if (this.currentCombo) {
      this.currentCombo.currentIndex = 0;
      this.currentCombo.canCombo = false;
      this.bus.emit(GameEvents.COMBO_FINISHED, { comboName: this.currentCombo.name });
    }
    this.currentCombo = null;
  }

  isInAttack(): boolean {
    return this.isAttacking;
  }

  setDamageMultiplier(mult: number): void {
    this.damageMultiplier = mult;
  }

  dispose(): void {
    for (const t of this.attackTimers) {
      clearTimeout(t);
    }
    this.attackTimers = [];
  }
}
