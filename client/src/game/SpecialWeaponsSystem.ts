import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";

export interface SpecialWeapon {
  name: string;
  damage: number;
  cooldown: number;
  ammo: number;
  maxAmmo: number;
  level: number;
  upgradesCost: number[];
}

interface ActiveProjectile {
  mesh: BABYLON.Mesh;
  type: "missile" | "energy" | "bomb" | "droneProjectile";
  velocity: BABYLON.Vector3;
  lifetime: number;
  damage: number;
  explosionRadius: number;
  trackingSpeed: number;
  timer: number;
  target: BABYLON.Mesh | null;
}

interface ActiveDrone {
  mesh: BABYLON.Mesh;
  lifetime: number;
  fireCooldown: number;
  fireTimer: number;
  damage: number;
  range: number;
  isShieldDrone: boolean;
  shieldMesh: BABYLON.Mesh | null;
}

export class SpecialWeaponsSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private weapons: Map<number, SpecialWeapon> = new Map();
  private cooldownTimers: Map<number, number> = new Map();
  private activeProjectiles: ActiveProjectile[] = [];
  private activeDrones: ActiveDrone[] = [];
  private onSpecialWeaponChange: ((weapons: ReturnType<SpecialWeaponsSystem["getActiveSpecialWeapons"]>) => void) | null = null;
  private aimOriginProvider: (() => BABYLON.Vector3) | null = null;

  setAimOriginProvider(fn: () => BABYLON.Vector3): void {
    this.aimOriginProvider = fn;
  }

  private getAimOrigin(): BABYLON.Vector3 {
    return this.aimOriginProvider ? this.aimOriginProvider() : this.camera.position;
  }
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.initializeWeapons();
    this.setupControls();
  }

  private initializeWeapons(): void {
    this.weapons.set(7, {
      name: "Homing Missile",
      damage: 60,
      cooldown: 2000,
      ammo: 10,
      maxAmmo: 10,
      level: 1,
      upgradesCost: [500, 1500, 4000],
    });

    this.weapons.set(8, {
      name: "Tracking Energy Burst",
      damage: 45,
      cooldown: 1500,
      ammo: 15,
      maxAmmo: 15,
      level: 1,
      upgradesCost: [400, 1200, 3500],
    });

    this.weapons.set(9, {
      name: "Bomb",
      damage: 120,
      cooldown: 4000,
      ammo: 5,
      maxAmmo: 5,
      level: 1,
      upgradesCost: [600, 1800, 5000],
    });

    this.weapons.set(0, {
      name: "Combat Drone",
      damage: 20,
      cooldown: 10000,
      ammo: 3,
      maxAmmo: 3,
      level: 1,
      upgradesCost: [800, 2000, 6000],
    });

    for (const slot of [7, 8, 9, 0]) {
      this.cooldownTimers.set(slot, 0);
    }
  }

  private setupControls(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      switch (e.code) {
        case "Digit7": this.fireSpecialWeapon(7); break;
        case "Digit8": this.fireSpecialWeapon(8); break;
        case "Digit9": this.fireSpecialWeapon(9); break;
        case "Digit0": this.fireSpecialWeapon(0); break;
      }
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  /** Master enable gate — flipped off by SpaceLevelSystem so elemental
   *  specials can't fire while the player is piloting in vacuum. */
  private firingEnabled: boolean = true;
  setFiringEnabled(enabled: boolean): void {
    this.firingEnabled = enabled;
  }

  fireSpecialWeapon(slot: number): void {
    if (!this.firingEnabled) return;
    const weapon = this.weapons.get(slot);
    if (!weapon || weapon.ammo <= 0) return;

    const remaining = this.cooldownTimers.get(slot) ?? 0;
    if (remaining > 0) return;

    weapon.ammo--;
    this.cooldownTimers.set(slot, weapon.cooldown);

    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const spawnPos = this.getAimOrigin().add(forward.scale(2));

    switch (slot) {
      case 7: this.spawnHomingMissile(weapon, spawnPos, forward); break;
      case 8: this.spawnEnergyBurst(weapon, spawnPos, forward); break;
      case 9: this.spawnBomb(weapon, spawnPos, forward); break;
      case 0: this.spawnCombatDrone(weapon, spawnPos); break;
    }

    EventBus.getInstance().emit(GameEvents.WEAPON_FIRED);
    this.notifyChange();
  }

  private spawnHomingMissile(weapon: SpecialWeapon, pos: BABYLON.Vector3, dir: BABYLON.Vector3): void {
    const count = weapon.level >= 3 ? 3 : 1;
    const trackingSpeed = 0.03 + weapon.level * 0.02;
    const damage = weapon.damage * (1 + (weapon.level - 1) * 0.4);

    for (let i = 0; i < count; i++) {
      const mesh = BABYLON.MeshBuilder.CreateCylinder("homingMissile", { height: 0.6, diameter: 0.15 }, this.scene);
      const mat = new BABYLON.StandardMaterial("missileMat", this.scene);
      mat.emissiveColor = new BABYLON.Color3(1, 0.1, 0.4);
      mat.diffuseColor = new BABYLON.Color3(1, 0.1, 0.4);
      mesh.material = mat;

      const offset = new BABYLON.Vector3(
        (i - Math.floor(count / 2)) * 0.5,
        0,
        0
      );
      mesh.position = pos.add(offset);
      mesh.rotation.x = Math.PI / 2;

      const velocity = dir.clone().scale(0.8);
      if (count > 1) {
        velocity.addInPlace(new BABYLON.Vector3(
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.3
        ));
      }

      this.activeProjectiles.push({
        mesh,
        type: "missile",
        velocity,
        lifetime: 6000,
        damage,
        explosionRadius: 4 + weapon.level,
        trackingSpeed,
        timer: 0,
        target: null,
      });
    }
  }

  private spawnEnergyBurst(weapon: SpecialWeapon, pos: BABYLON.Vector3, dir: BABYLON.Vector3): void {
    const mesh = BABYLON.MeshBuilder.CreateSphere("energyBurst", { diameter: 0.4 + weapon.level * 0.1 }, this.scene);
    const mat = new BABYLON.StandardMaterial("energyMat", this.scene);
    mat.emissiveColor = new BABYLON.Color3(0.2, 0.6, 1);
    mat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 1);
    mat.alpha = 0.9;
    mesh.material = mat;
    mesh.position = pos.clone();

    const speed = 0.6 + weapon.level * 0.3;
    const damage = weapon.damage * (1 + (weapon.level - 1) * 0.35);
    const radius = 3 + weapon.level * 1.5;

    this.activeProjectiles.push({
      mesh,
      type: "energy",
      velocity: dir.clone().scale(speed),
      lifetime: 5000,
      damage,
      explosionRadius: radius,
      trackingSpeed: 0.04 + weapon.level * 0.015,
      timer: 0,
      target: null,
    });
  }

  private spawnBomb(weapon: SpecialWeapon, pos: BABYLON.Vector3, dir: BABYLON.Vector3): void {
    const mesh = BABYLON.MeshBuilder.CreateSphere("bomb", { diameter: 0.35 }, this.scene);
    const mat = new BABYLON.StandardMaterial("bombMat", this.scene);
    mat.emissiveColor = new BABYLON.Color3(1, 0.8, 0);
    mat.diffuseColor = new BABYLON.Color3(0.8, 0.6, 0);
    mesh.material = mat;
    mesh.position = pos.clone();

    const fuseTime = weapon.level >= 3 ? 1500 : 3000 - weapon.level * 500;
    const damage = weapon.damage * (1 + (weapon.level - 1) * 0.5);
    const radius = 6 + weapon.level * 2;

    this.activeProjectiles.push({
      mesh,
      type: "bomb",
      velocity: dir.clone().scale(0.3).add(new BABYLON.Vector3(0, 0.2, 0)),
      lifetime: fuseTime + 500,
      damage,
      explosionRadius: radius,
      trackingSpeed: 0,
      timer: fuseTime,
      target: null,
    });
  }

  private spawnCombatDrone(weapon: SpecialWeapon, pos: BABYLON.Vector3): void {
    const mesh = BABYLON.MeshBuilder.CreateSphere("combatDrone", { diameter: 0.8 }, this.scene);
    const mat = new BABYLON.StandardMaterial("droneMat", this.scene);
    mat.emissiveColor = new BABYLON.Color3(0, 1, 0.7);
    mat.diffuseColor = new BABYLON.Color3(0, 1, 0.7);
    mesh.material = mat;
    mesh.position = pos.add(new BABYLON.Vector3(0, 3, 0));

    const duration = (30 + (weapon.level - 1) * 15) * 1000;
    const damage = weapon.damage * (1 + (weapon.level - 1) * 0.5);
    const isShieldDrone = weapon.level >= 3;

    let shieldMesh: BABYLON.Mesh | null = null;
    if (isShieldDrone) {
      shieldMesh = BABYLON.MeshBuilder.CreateSphere("droneShield", { diameter: 3 }, this.scene);
      const shieldMat = new BABYLON.StandardMaterial("shieldMat", this.scene);
      shieldMat.emissiveColor = new BABYLON.Color3(0.3, 0.8, 1);
      shieldMat.alpha = 0.2;
      shieldMat.wireframe = true;
      shieldMesh.material = shieldMat;
      shieldMesh.position = mesh.position.clone();
    }

    this.activeDrones.push({
      mesh,
      lifetime: duration,
      fireCooldown: 500 - weapon.level * 50,
      fireTimer: 0,
      damage,
      range: 25,
      isShieldDrone,
      shieldMesh,
    });
  }

  update(dt: number, enemies: BABYLON.Mesh[], playerPos: BABYLON.Vector3): { hitEnemy: BABYLON.Mesh; damage: number }[] {
    const hits: { hitEnemy: BABYLON.Mesh; damage: number }[] = [];

    this.cooldownTimers.forEach((remaining, slot) => {
      if (remaining > 0) {
        this.cooldownTimers.set(slot, Math.max(0, remaining - dt));
      }
    });

    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const proj = this.activeProjectiles[i];
      proj.lifetime -= dt;
      proj.timer -= dt;

      if (proj.type === "missile") {
        const nearest = this.findNearestEnemy(proj.mesh.position, enemies);
        if (nearest) {
          const toTarget = nearest.position.subtract(proj.mesh.position).normalize();
          proj.velocity = BABYLON.Vector3.Lerp(proj.velocity.normalize(), toTarget, proj.trackingSpeed).normalize().scale(
            proj.velocity.length() + 0.02
          );
          const lookDir = proj.velocity.normalize();
          const yaw = Math.atan2(lookDir.x, lookDir.z);
          const pitch = -Math.asin(lookDir.y);
          proj.mesh.rotation = new BABYLON.Vector3(pitch + Math.PI / 2, yaw, 0);
        }
        proj.mesh.position.addInPlace(proj.velocity.scale(dt / 16));

        for (const enemy of enemies) {
          if (BABYLON.Vector3.Distance(proj.mesh.position, enemy.position) < 1.5) {
            this.createExplosion(proj.mesh.position, proj.explosionRadius, new BABYLON.Color3(1, 0.2, 0.5));
            hits.push(...this.aoeHits(proj.mesh.position, proj.explosionRadius, proj.damage, enemies));
            proj.mesh.dispose();
            this.activeProjectiles.splice(i, 1);
            break;
          }
        }
      } else if (proj.type === "energy") {
        const nearest = this.findNearestEnemy(proj.mesh.position, enemies);
        if (nearest) {
          const toTarget = nearest.position.subtract(proj.mesh.position).normalize();
          proj.velocity.addInPlace(toTarget.scale(proj.trackingSpeed * dt));
        }
        proj.mesh.position.addInPlace(proj.velocity.scale(dt / 16));

        for (const enemy of enemies) {
          if (BABYLON.Vector3.Distance(proj.mesh.position, enemy.position) < 2) {
            this.createExplosion(proj.mesh.position, proj.explosionRadius, new BABYLON.Color3(0.2, 0.6, 1));
            hits.push(...this.aoeHits(proj.mesh.position, proj.explosionRadius, proj.damage, enemies));

            const weapon = this.weapons.get(8);
            if (weapon && weapon.level >= 2) {
              const chainTargets = enemies.filter(
                e => e !== enemy && BABYLON.Vector3.Distance(e.position, proj.mesh.position) < proj.explosionRadius * 1.5
              );
              for (const ct of chainTargets.slice(0, 3)) {
                hits.push({ hitEnemy: ct, damage: proj.damage * 0.4 });
                this.createChainEffect(proj.mesh.position, ct.position);
              }
            }

            proj.mesh.dispose();
            this.activeProjectiles.splice(i, 1);
            break;
          }
        }
      } else if (proj.type === "bomb") {
        proj.velocity.y -= 0.005 * (dt / 16);
        proj.mesh.position.addInPlace(proj.velocity.scale(dt / 16));

        if (proj.mesh.position.y <= 0.2) {
          proj.mesh.position.y = 0.2;
          proj.velocity = BABYLON.Vector3.Zero();
        }

        if (proj.timer <= 0) {
          this.createExplosion(proj.mesh.position, proj.explosionRadius, new BABYLON.Color3(1, 0.8, 0));
          hits.push(...this.aoeHits(proj.mesh.position, proj.explosionRadius, proj.damage, enemies));

          const weapon = this.weapons.get(9);
          if (weapon && weapon.level >= 2) {
            const clusterCount = 4;
            for (let c = 0; c < clusterCount; c++) {
              const angle = (c / clusterCount) * Math.PI * 2;
              const clusterPos = proj.mesh.position.add(
                new BABYLON.Vector3(Math.cos(angle) * 3, 1, Math.sin(angle) * 3)
              );
              const clusterMesh = BABYLON.MeshBuilder.CreateSphere("cluster", { diameter: 0.2 }, this.scene);
              const cmat = new BABYLON.StandardMaterial("clusterMat", this.scene);
              cmat.emissiveColor = new BABYLON.Color3(1, 0.5, 0);
              clusterMesh.material = cmat;
              clusterMesh.position = clusterPos.clone();

              this.activeProjectiles.push({
                mesh: clusterMesh,
                type: "bomb",
                velocity: new BABYLON.Vector3(Math.cos(angle) * 0.2, 0.3, Math.sin(angle) * 0.2),
                lifetime: 1500,
                damage: proj.damage * 0.4,
                explosionRadius: proj.explosionRadius * 0.5,
                trackingSpeed: 0,
                timer: 800,
                target: null,
              });
            }
          }

          proj.mesh.dispose();
          this.activeProjectiles.splice(i, 1);
          continue;
        }

        if (proj.timer > 0 && proj.timer < 1000) {
          const mat = proj.mesh.material as BABYLON.StandardMaterial;
          if (mat) {
            const flash = Math.sin(Date.now() * 0.02) * 0.5 + 0.5;
            mat.emissiveColor = new BABYLON.Color3(1, flash, 0);
          }
        }
      } else if (proj.type === "droneProjectile") {
        proj.mesh.position.addInPlace(proj.velocity.scale(dt / 16));
        for (const enemy of enemies) {
          if (BABYLON.Vector3.Distance(proj.mesh.position, enemy.position) < 1.5) {
            hits.push({ hitEnemy: enemy, damage: proj.damage });
            proj.mesh.dispose();
            this.activeProjectiles.splice(i, 1);
            break;
          }
        }
      }

      if (i < this.activeProjectiles.length && this.activeProjectiles[i] === proj) {
        if (proj.lifetime <= 0) {
          proj.mesh.dispose();
          this.activeProjectiles.splice(i, 1);
        }
      }
    }

    for (let i = this.activeDrones.length - 1; i >= 0; i--) {
      const drone = this.activeDrones[i];
      drone.lifetime -= dt;
      drone.fireTimer -= dt;

      if (drone.lifetime <= 0) {
        drone.mesh.dispose();
        drone.shieldMesh?.dispose();
        this.activeDrones.splice(i, 1);
        continue;
      }

      const hoverTarget = playerPos.add(new BABYLON.Vector3(
        Math.sin(Date.now() * 0.001) * 4,
        3 + Math.sin(Date.now() * 0.002) * 0.5,
        Math.cos(Date.now() * 0.001) * 4
      ));
      drone.mesh.position = BABYLON.Vector3.Lerp(drone.mesh.position, hoverTarget, 0.02);

      if (drone.shieldMesh) {
        drone.shieldMesh.position = playerPos.clone();
        drone.shieldMesh.position.y += 1;
        drone.shieldMesh.rotation.y += 0.01;
      }

      const nearest = this.findNearestEnemy(drone.mesh.position, enemies);
      if (nearest && drone.fireTimer <= 0) {
        const dist = BABYLON.Vector3.Distance(drone.mesh.position, nearest.position);
        if (dist < drone.range) {
          drone.fireTimer = drone.fireCooldown;
          this.spawnDroneProjectile(drone, nearest);
        }
      }
    }

    return hits;
  }

  private spawnDroneProjectile(drone: ActiveDrone, target: BABYLON.Mesh): void {
    const mesh = BABYLON.MeshBuilder.CreateSphere("droneShot", { diameter: 0.12 }, this.scene);
    const mat = new BABYLON.StandardMaterial("droneShotMat", this.scene);
    mat.emissiveColor = new BABYLON.Color3(0, 1, 0.5);
    mat.diffuseColor = new BABYLON.Color3(0, 1, 0.5);
    mesh.material = mat;
    mesh.position = drone.mesh.position.clone();

    const dir = target.position.subtract(drone.mesh.position).normalize();

    this.activeProjectiles.push({
      mesh,
      type: "droneProjectile",
      velocity: dir.scale(2),
      lifetime: 2000,
      damage: drone.damage,
      explosionRadius: 0,
      trackingSpeed: 0,
      timer: 0,
      target: null,
    });
  }

  private findNearestEnemy(pos: BABYLON.Vector3, enemies: BABYLON.Mesh[]): BABYLON.Mesh | null {
    let nearest: BABYLON.Mesh | null = null;
    let minDist = Infinity;
    for (const e of enemies) {
      const d = BABYLON.Vector3.Distance(pos, e.position);
      if (d < minDist) {
        minDist = d;
        nearest = e;
      }
    }
    return nearest;
  }

  private aoeHits(center: BABYLON.Vector3, radius: number, damage: number, enemies: BABYLON.Mesh[]): { hitEnemy: BABYLON.Mesh; damage: number }[] {
    const results: { hitEnemy: BABYLON.Mesh; damage: number }[] = [];
    for (const enemy of enemies) {
      const dist = BABYLON.Vector3.Distance(center, enemy.position);
      if (dist < radius) {
        const falloff = 1 - dist / radius;
        results.push({ hitEnemy: enemy, damage: damage * falloff });
      }
    }
    return results;
  }

  private createExplosion(position: BABYLON.Vector3, radius: number, color: BABYLON.Color3): void {
    // Routed through the unified ExplosionSystem so every special weapon
    // detonation gets pooled meshes, debris, shockwave, and camera shake.
    const tier: "small" | "medium" | "large" =
      radius >= 5 ? "large" : radius >= 2.5 ? "medium" : "small";
    EventBus.getInstance().emit("effect:explosion", {
      position: position.clone(),
      radius,
      tier,
      color,
    });
  }

  private createChainEffect(from: BABYLON.Vector3, to: BABYLON.Vector3): void {
    const points = [from.clone(), to.clone()];
    const line = BABYLON.MeshBuilder.CreateLines("chainEffect", { points }, this.scene);
    line.color = new BABYLON.Color3(0.3, 0.7, 1);

    let frame = 0;
    const animate = () => {
      frame++;
      line.visibility = Math.max(0, 1 - frame * 0.15);
      if (frame < 8) {
        requestAnimationFrame(animate);
      } else {
        line.dispose();
      }
    };
    animate();
  }

  upgradeWeapon(slot: number): boolean {
    const weapon = this.weapons.get(slot);
    if (!weapon || weapon.level >= 3) return false;

    const cost = weapon.upgradesCost[weapon.level];
    weapon.level++;

    switch (slot) {
      case 7:
        weapon.damage = 60 * (1 + (weapon.level - 1) * 0.4);
        weapon.cooldown = Math.max(1000, 2000 - (weapon.level - 1) * 300);
        break;
      case 8:
        weapon.damage = 45 * (1 + (weapon.level - 1) * 0.35);
        weapon.cooldown = Math.max(800, 1500 - (weapon.level - 1) * 200);
        break;
      case 9:
        weapon.damage = 120 * (1 + (weapon.level - 1) * 0.5);
        weapon.cooldown = Math.max(2000, 4000 - (weapon.level - 1) * 500);
        break;
      case 0:
        weapon.damage = 20 * (1 + (weapon.level - 1) * 0.5);
        weapon.cooldown = Math.max(6000, 10000 - (weapon.level - 1) * 1500);
        break;
    }

    this.notifyChange();
    return true;
  }

  getSpecialWeapon(slot: number): SpecialWeapon | undefined {
    return this.weapons.get(slot);
  }

  getActiveSpecialWeapons(): { slot: number; name: string; ammo: number; maxAmmo: number; cooldownRemaining: number; level: number }[] {
    const result: { slot: number; name: string; ammo: number; maxAmmo: number; cooldownRemaining: number; level: number }[] = [];
    this.weapons.forEach((weapon, slot) => {
      result.push({
        slot,
        name: weapon.name,
        ammo: weapon.ammo,
        maxAmmo: weapon.maxAmmo,
        cooldownRemaining: this.cooldownTimers.get(slot) ?? 0,
        level: weapon.level,
      });
    });
    return result;
  }

  setOnSpecialWeaponChange(callback: (weapons: ReturnType<SpecialWeaponsSystem["getActiveSpecialWeapons"]>) => void): void {
    this.onSpecialWeaponChange = callback;
  }

  private notifyChange(): void {
    this.onSpecialWeaponChange?.(this.getActiveSpecialWeapons());
  }

  dispose(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }

    for (const proj of this.activeProjectiles) {
      proj.mesh.dispose();
    }
    this.activeProjectiles = [];

    for (const drone of this.activeDrones) {
      drone.mesh.dispose();
      drone.shieldMesh?.dispose();
    }
    this.activeDrones = [];
  }
}
