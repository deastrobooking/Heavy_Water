import * as BABYLON from "@babylonjs/core";

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

  private onAmmoChange: ((ammo: number, maxAmmo: number) => void) | null = null;
  private onWeaponChange: ((weapon: Weapon) => void) | null = null;

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.initializeWeapons();
    this.setupControls();
  }

  private initializeWeapons(): void {
    this.weapons.set("pistol", {
      type: "pistol",
      name: "Plasma Pistol",
      damage: 15,
      fireRate: 300,
      ammo: 50,
      maxAmmo: 50,
      range: 100,
      projectileSpeed: 2,
      spread: 0.02,
      isAutomatic: false,
    });

    this.weapons.set("rifle", {
      type: "rifle",
      name: "Pulse Rifle",
      damage: 25,
      fireRate: 100,
      ammo: 120,
      maxAmmo: 120,
      range: 150,
      projectileSpeed: 3,
      spread: 0.03,
      isAutomatic: true,
    });

    this.weapons.set("shotgun", {
      type: "shotgun",
      name: "Scatter Blaster",
      damage: 8,
      fireRate: 800,
      ammo: 24,
      maxAmmo: 24,
      range: 30,
      projectileSpeed: 2.5,
      spread: 0.15,
      isAutomatic: false,
    });

    this.weapons.set("rocket", {
      type: "rocket",
      name: "Nova Launcher",
      damage: 100,
      fireRate: 1500,
      ammo: 8,
      maxAmmo: 8,
      range: 200,
      projectileSpeed: 1,
      spread: 0,
      isAutomatic: false,
    });

    this.weapons.set("laser", {
      type: "laser",
      name: "Photon Beam",
      damage: 40,
      fireRate: 50,
      ammo: 200,
      maxAmmo: 200,
      range: 300,
      projectileSpeed: 10,
      spread: 0,
      isAutomatic: true,
    });

    this.weapons.set("grenade", {
      type: "grenade",
      name: "Fusion Grenades",
      damage: 80,
      fireRate: 1000,
      ammo: 6,
      maxAmmo: 6,
      range: 50,
      projectileSpeed: 0.5,
      spread: 0,
      isAutomatic: false,
    });
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
    if (!weapon || weapon.ammo <= 0) return;

    const now = Date.now();
    if (now - this.lastFireTime < weapon.fireRate) return;

    this.lastFireTime = now;
    weapon.ammo--;

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

    projectileMesh.position = this.camera.position.add(forward.scale(1));

    const projectile: Projectile = {
      mesh: projectileMesh,
      direction,
      speed: weapon.projectileSpeed,
      damage: weapon.damage,
      lifetime: 3000,
      type: weapon.type,
      isExplosive: weapon.type === "rocket" || weapon.type === "grenade",
      explosionRadius: weapon.type === "rocket" ? 5 : weapon.type === "grenade" ? 4 : 0,
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
        if (distance < 1.5) {
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
}
