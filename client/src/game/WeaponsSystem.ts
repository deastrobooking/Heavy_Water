import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";

export type WeaponType = "pistol" | "rifle" | "shotgun" | "rocket" | "laser" | "grenade";

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
};

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

export class WeaponsSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private weapons: Map<WeaponType, Weapon> = new Map();
  private currentWeapon: WeaponType = "pistol";
  private projectiles: Projectile[] = [];
  private lastFireTime: number = 0;
  private isFiring: boolean = false;
  private inventory: InventorySystem | null = null;
  private bus: EventBus = EventBus.getInstance();

  private onAmmoChange: ((ammo: number, maxAmmo: number) => void) | null = null;
  private onWeaponChange: ((weapon: Weapon) => void) | null = null;
  private aimOriginProvider: (() => BABYLON.Vector3) | null = null;

  setInventory(inv: InventorySystem): void {
    this.inventory = inv;
  }

  setAimOriginProvider(fn: () => BABYLON.Vector3): void {
    this.aimOriginProvider = fn;
  }

  private getAimOrigin(): BABYLON.Vector3 {
    return this.aimOriginProvider ? this.aimOriginProvider() : this.camera.position;
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
  }

  private setupControls(): void {
    window.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        this.isFiring = true;
        this.fire();
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) {
        this.isFiring = false;
      }
    });

    window.addEventListener("wheel", (e) => {
      this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    });

    window.addEventListener("keydown", (e) => {
      switch (e.code) {
        case "Digit1": this.selectWeapon("pistol"); break;
        case "Digit2": this.selectWeapon("rifle"); break;
        case "Digit3": this.selectWeapon("shotgun"); break;
        case "Digit4": this.selectWeapon("rocket"); break;
        case "Digit5": this.selectWeapon("laser"); break;
        case "Digit6": this.selectWeapon("grenade"); break;
        case "KeyR": this.reload(); break;
      }
    });
  }

  private fire(): void {
    const weapon = this.weapons.get(this.currentWeapon);
    if (!weapon) return;

    const now = Date.now();
    if (now - this.lastFireTime < weapon.fireRate) return;

    this.lastFireTime = now;
    weapon.ammo = weapon.maxAmmo;

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
    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    
    const spreadX = (Math.random() - 0.5) * weapon.spread;
    const spreadY = (Math.random() - 0.5) * weapon.spread;
    const direction = forward.add(new BABYLON.Vector3(spreadX, spreadY, 0)).normalize();

    let projectileMesh: BABYLON.Mesh;
    let color: BABYLON.Color3;

    switch (weapon.type) {
      case "pistol":
        projectileMesh = BABYLON.MeshBuilder.CreateSphere("projectile", { diameter: 0.1 }, this.scene);
        color = new BABYLON.Color3(0, 1, 1);
        break;
      case "rifle":
        projectileMesh = BABYLON.MeshBuilder.CreateCylinder("projectile", { height: 0.3, diameter: 0.05 }, this.scene);
        projectileMesh.rotation.x = Math.PI / 2;
        color = new BABYLON.Color3(1, 0.5, 0);
        break;
      case "shotgun":
        projectileMesh = BABYLON.MeshBuilder.CreateSphere("projectile", { diameter: 0.08 }, this.scene);
        color = new BABYLON.Color3(1, 1, 0);
        break;
      case "rocket":
        projectileMesh = BABYLON.MeshBuilder.CreateCylinder("projectile", { height: 0.5, diameter: 0.15 }, this.scene);
        projectileMesh.rotation.x = Math.PI / 2;
        color = new BABYLON.Color3(1, 0.2, 0);
        break;
      case "laser":
        projectileMesh = BABYLON.MeshBuilder.CreateCylinder("projectile", { height: 2, diameter: 0.03 }, this.scene);
        projectileMesh.rotation.x = Math.PI / 2;
        color = new BABYLON.Color3(1, 0, 0);
        break;
      case "grenade":
        projectileMesh = BABYLON.MeshBuilder.CreateSphere("projectile", { diameter: 0.2 }, this.scene);
        color = new BABYLON.Color3(0.5, 1, 0);
        break;
      default:
        projectileMesh = BABYLON.MeshBuilder.CreateSphere("projectile", { diameter: 0.1 }, this.scene);
        color = new BABYLON.Color3(1, 1, 1);
    }

    const material = new BABYLON.StandardMaterial("projectileMat", this.scene);
    material.emissiveColor = color;
    material.diffuseColor = color;
    projectileMesh.material = material;

    projectileMesh.position = this.getAimOrigin().add(forward.scale(1));

    const baseR = weapon.type === "rocket" ? 5 : weapon.type === "grenade" ? 4 : 0;
    const projectile: Projectile = {
      mesh: projectileMesh,
      direction,
      speed: weapon.projectileSpeed,
      damage: weapon.damage,
      lifetime: 3000,
      type: weapon.type,
      isExplosive: weapon.type === "rocket" || weapon.type === "grenade",
      explosionRadius: baseR + (weapon.explosionRadiusBonus || 0),
    };

    this.projectiles.push(projectile);
  }

  update(enemies: BABYLON.Mesh[]): { hitEnemy: BABYLON.Mesh; damage: number }[] {
    const weapon = this.weapons.get(this.currentWeapon);
    if (weapon?.isAutomatic && this.isFiring) {
      this.fire();
    }

    const hits: { hitEnemy: BABYLON.Mesh; damage: number }[] = [];
    const now = Date.now();

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      
      projectile.mesh.position.addInPlace(projectile.direction.scale(projectile.speed));
      projectile.lifetime -= 16;

      if (projectile.type === "grenade") {
        projectile.direction.y -= 0.01;
      }

      for (const enemy of enemies) {
        const distance = BABYLON.Vector3.Distance(projectile.mesh.position, enemy.position);
        const hitRadius = (enemy.metadata && typeof enemy.metadata.hitRadius === "number") ? enemy.metadata.hitRadius : 1.5;
        if (distance < hitRadius) {
          if (projectile.isExplosive) {
            this.createExplosion(projectile.mesh.position, projectile.explosionRadius);
            for (const e of enemies) {
              const expDist = BABYLON.Vector3.Distance(projectile.mesh.position, e.position);
              if (expDist < projectile.explosionRadius) {
                const falloff = 1 - (expDist / projectile.explosionRadius);
                hits.push({ hitEnemy: e, damage: projectile.damage * falloff });
              }
            }
          } else {
            hits.push({ hitEnemy: enemy, damage: projectile.damage });
          }
          projectile.mesh.dispose();
          this.projectiles.splice(i, 1);
          break;
        }
      }

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
    const explosion = BABYLON.MeshBuilder.CreateSphere("explosion", { diameter: radius * 2 }, this.scene);
    explosion.position = position.clone();
    
    const material = new BABYLON.StandardMaterial("explosionMat", this.scene);
    material.emissiveColor = new BABYLON.Color3(1, 0.5, 0);
    material.alpha = 0.8;
    explosion.material = material;

    const explosionLight = new BABYLON.PointLight("explosionLight", position, this.scene);
    explosionLight.diffuse = new BABYLON.Color3(1, 0.5, 0);
    explosionLight.intensity = 5;
    explosionLight.range = radius * 3;

    let frame = 0;
    const animateExplosion = () => {
      frame++;
      const scale = 1 + frame * 0.1;
      explosion.scaling = new BABYLON.Vector3(scale, scale, scale);
      material.alpha = Math.max(0, 0.8 - frame * 0.08);
      explosionLight.intensity = Math.max(0, 5 - frame * 0.5);

      if (frame < 10) {
        requestAnimationFrame(animateExplosion);
      } else {
        explosion.dispose();
        explosionLight.dispose();
      }
    };
    animateExplosion();
  }

  selectWeapon(type: WeaponType): void {
    if (this.weapons.has(type)) {
      this.currentWeapon = type;
      const weapon = this.weapons.get(type)!;
      this.onWeaponChange?.(weapon);
      this.onAmmoChange?.(weapon.ammo, weapon.maxAmmo);
    }
  }

  private cycleWeapon(direction: number): void {
    const types: WeaponType[] = ["pistol", "rifle", "shotgun", "rocket", "laser", "grenade"];
    const currentIndex = types.indexOf(this.currentWeapon);
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
    return Array.from(this.weapons.keys()).map(t => this.getUpgradeInfo(t)!).filter(x => !!x);
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
}
