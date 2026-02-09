import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";

export enum DamageType {
  Plasma = "Plasma",
  Kinetic = "Kinetic",
  Explosive = "Explosive",
  Laser = "Laser",
  Melee = "Melee",
  Fire = "Fire",
  Collision = "Collision",
  Drowning = "Drowning",
}

export interface DamageInfo {
  amount: number;
  hitPoint?: BABYLON.Vector3;
  hitDirection?: BABYLON.Vector3;
  hitNormal?: BABYLON.Vector3;
  attacker?: any;
  damageType: DamageType;
  isCritical?: boolean;
  knockbackForce?: number;
}

export interface DamageResult {
  damageAmount: number;
  wasKilled: boolean;
  wasBlocked: boolean;
  wasParried: boolean;
}

export interface DamageResistance {
  damageType: DamageType;
  resistancePercent: number;
}

export interface IDamageable {
  health: number;
  maxHealth: number;
  isAlive: boolean;
  isInvulnerable: boolean;
  resistances: DamageResistance[];
  takeDamage(info: DamageInfo): DamageResult;
  heal(amount: number): void;
  getPosition(): BABYLON.Vector3;
}

export function applyDamage(target: IDamageable, info: DamageInfo): DamageResult {
  if (!target.isAlive || target.isInvulnerable) {
    return { damageAmount: 0, wasKilled: false, wasBlocked: false, wasParried: false };
  }

  let finalDamage = info.amount;
  const resistance = target.resistances.find(r => r.damageType === info.damageType);
  if (resistance) {
    finalDamage *= (1 - resistance.resistancePercent);
  }

  finalDamage = Math.max(1, finalDamage);
  target.health = Math.max(0, target.health - finalDamage);

  const result: DamageResult = {
    damageAmount: finalDamage,
    wasKilled: target.health <= 0,
    wasBlocked: false,
    wasParried: false,
  };

  const bus = EventBus.getInstance();

  if (result.wasKilled) {
    target.isAlive = false;
  }

  return result;
}

export function damageInArea(
  center: BABYLON.Vector3,
  radius: number,
  baseDamage: number,
  damageType: DamageType,
  attacker: any,
  targets: IDamageable[]
): DamageResult[] {
  const results: DamageResult[] = [];
  for (const target of targets) {
    const pos = target.getPosition();
    const distance = BABYLON.Vector3.Distance(pos, center);
    const falloff = 1 - (distance / radius);
    if (falloff > 0) {
      const info: DamageInfo = {
        amount: baseDamage * falloff,
        hitPoint: center,
        hitDirection: pos.subtract(center).normalize(),
        damageType,
        attacker,
        knockbackForce: 500 * falloff,
      };
      results.push(applyDamage(target, info));
    }
  }
  return results;
}
