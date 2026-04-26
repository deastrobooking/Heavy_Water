import * as BABYLON from "@babylonjs/core";
import { WeaponType } from "./WeaponsSystem";
import { EventBus } from "./EventBus";

export type LootType = "credits" | "health" | "armor" | "ammo" | "weapon_upgrade";

export interface Loot {
  type: LootType;
  amount: number;
  weaponType?: WeaponType;
}

export interface Chest {
  mesh: BABYLON.Mesh;
  isOpen: boolean;
  loot: Loot;
  glowLight: BABYLON.PointLight;
}

export class ChestSystem {
  private scene: BABYLON.Scene;
  private chests: Chest[] = [];
  private onLootCollected: ((loot: Loot) => void) | null = null;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
  }

  spawnChests(count: number): void {
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 400;
      const z = (Math.random() - 0.5) * 300;
      
      if (Math.abs(z + 200) < 40) continue;
      
      this.createChest(new BABYLON.Vector3(x, 0.5, z));
    }
  }

  private createChest(position: BABYLON.Vector3): void {
    const chest = BABYLON.MeshBuilder.CreateBox("chest", { width: 1.5, height: 1, depth: 1 }, this.scene);
    chest.position = position;

    const chestMat = new BABYLON.StandardMaterial("chestMat", this.scene);
    chestMat.diffuseColor = new BABYLON.Color3(0.6, 0.4, 0.1);
    chestMat.specularColor = new BABYLON.Color3(0.8, 0.6, 0.2);
    chestMat.emissiveColor = new BABYLON.Color3(0.1, 0.05, 0);
    chest.material = chestMat;

    const lid = BABYLON.MeshBuilder.CreateBox("lid", { width: 1.6, height: 0.3, depth: 1.1 }, this.scene);
    lid.position = new BABYLON.Vector3(0, 0.65, 0);
    lid.material = chestMat;
    lid.parent = chest;

    const glowLight = new BABYLON.PointLight("chestGlow", position.add(new BABYLON.Vector3(0, 1.5, 0)), this.scene);
    glowLight.diffuse = new BABYLON.Color3(1, 0.8, 0.3);
    glowLight.intensity = 0.5;
    glowLight.range = 5;

    const loot = this.generateLoot();

    this.chests.push({
      mesh: chest,
      isOpen: false,
      loot,
      glowLight,
    });
  }

  private generateLoot(): Loot {
    const random = Math.random();
    
    if (random < 0.35) {
      return { type: "credits", amount: 50 + Math.floor(Math.random() * 150) };
    } else if (random < 0.55) {
      return { type: "health", amount: 25 + Math.floor(Math.random() * 50) };
    } else if (random < 0.70) {
      return { type: "armor", amount: 20 + Math.floor(Math.random() * 40) };
    } else if (random < 0.90) {
      const weaponTypes: WeaponType[] = ["pistol", "rifle", "shotgun", "rocket", "laser", "grenade"];
      return {
        type: "ammo",
        amount: 20 + Math.floor(Math.random() * 30),
        weaponType: weaponTypes[Math.floor(Math.random() * weaponTypes.length)],
      };
    } else {
      return { type: "weapon_upgrade", amount: 1 };
    }
  }

  update(playerPosition: BABYLON.Vector3): void {
    for (const chest of this.chests) {
      if (chest.isOpen) continue;

      const distance = BABYLON.Vector3.Distance(playerPosition, chest.mesh.position);
      
      chest.glowLight.intensity = 0.3 + Math.sin(Date.now() * 0.005) * 0.2;
      
      if (distance < 2) {
        this.openChest(chest);
      }
    }
  }

  private openChest(chest: Chest): void {
    chest.isOpen = true;

    const lid = chest.mesh.getChildren()[0] as BABYLON.Mesh;
    if (lid) {
      let angle = 0;
      const animateLid = () => {
        angle += 0.1;
        lid.rotation.x = -angle;
        if (angle < Math.PI / 2) {
          requestAnimationFrame(animateLid);
        }
      };
      animateLid();
    }

    this.createLootEffect(chest);
    EventBus.getInstance().emit("effect:capture", {
      position: chest.mesh.position.clone(),
      color: new BABYLON.Color3(1.0, 0.85, 0.3),
    });
    this.onLootCollected?.(chest.loot);

    setTimeout(() => {
      chest.glowLight.dispose();
      chest.mesh.dispose();
      this.chests = this.chests.filter((c) => c !== chest);
    }, 2000);
  }

  private createLootEffect(chest: Chest): void {
    const colors: Record<LootType, BABYLON.Color3> = {
      credits: new BABYLON.Color3(1, 0.8, 0),
      health: new BABYLON.Color3(0, 1, 0),
      armor: new BABYLON.Color3(0, 0.5, 1),
      ammo: new BABYLON.Color3(1, 0.5, 0),
      weapon_upgrade: new BABYLON.Color3(1, 0, 1),
    };

    const color = colors[chest.loot.type];

    for (let i = 0; i < 20; i++) {
      const particle = BABYLON.MeshBuilder.CreateSphere("lootParticle", { diameter: 0.15 }, this.scene);
      particle.position = chest.mesh.position.clone();
      
      const mat = new BABYLON.StandardMaterial("lootParticleMat", this.scene);
      mat.emissiveColor = color;
      particle.material = mat;

      const velocity = new BABYLON.Vector3(
        (Math.random() - 0.5) * 0.2,
        0.1 + Math.random() * 0.2,
        (Math.random() - 0.5) * 0.2
      );

      let frame = 0;
      const animate = () => {
        frame++;
        particle.position.addInPlace(velocity);
        velocity.y -= 0.005;
        mat.alpha = Math.max(0, 1 - frame * 0.03);
        
        if (frame < 30) {
          requestAnimationFrame(animate);
        } else {
          particle.dispose();
        }
      };
      animate();
    }

    const burstLight = new BABYLON.PointLight("burstLight", chest.mesh.position, this.scene);
    burstLight.diffuse = color;
    burstLight.intensity = 3;
    burstLight.range = 10;

    let lightFrame = 0;
    const animateLight = () => {
      lightFrame++;
      burstLight.intensity = Math.max(0, 3 - lightFrame * 0.15);
      if (lightFrame < 20) {
        requestAnimationFrame(animateLight);
      } else {
        burstLight.dispose();
      }
    };
    animateLight();
  }

  setOnLootCollected(callback: (loot: Loot) => void): void {
    this.onLootCollected = callback;
  }

  getChestCount(): number {
    return this.chests.filter((c) => !c.isOpen).length;
  }
}
