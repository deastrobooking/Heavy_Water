import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";
import { CRAFTING_MATERIALS } from "./CraftingSystem";

export type PickupType =
  | "gear"
  | "weapon_part"
  | "scrap_metal"
  | "energy_core"
  | "circuit_board"
  | "nano_fiber"
  | "bio_essence"
  | "health_kit";

export interface PickupSpawnRequest {
  type: PickupType;
  amount: number;
  weaponId?: string;
}

interface ActivePickup {
  id: number;
  mesh: BABYLON.Mesh;
  halo: BABYLON.Mesh;
  type: PickupType;
  amount: number;
  weaponId?: string;
  bobOffset: number;
  bobBase: number;
  age: number;
  collected: boolean;
}

const PICKUP_COLORS: Record<PickupType, BABYLON.Color3> = {
  gear: new BABYLON.Color3(0.95, 0.78, 0.25),
  weapon_part: new BABYLON.Color3(1.0, 0.35, 0.85),
  scrap_metal: new BABYLON.Color3(0.7, 0.7, 0.75),
  energy_core: new BABYLON.Color3(0.2, 0.95, 1.0),
  circuit_board: new BABYLON.Color3(0.2, 1.0, 0.5),
  nano_fiber: new BABYLON.Color3(0.95, 0.95, 1.0),
  bio_essence: new BABYLON.Color3(0.6, 1.0, 0.4),
  health_kit: new BABYLON.Color3(1.0, 0.3, 0.4),
};

const PICKUP_LABELS: Record<PickupType, string> = {
  gear: "GEAR",
  weapon_part: "WEAPON PART",
  scrap_metal: "SCRAP",
  energy_core: "ENERGY CORE",
  circuit_board: "CIRCUIT",
  nano_fiber: "NANO FIBER",
  bio_essence: "BIO ESSENCE",
  health_kit: "HEALTH",
};

const ENEMY_DROP_TABLE: Record<string, PickupSpawnRequest[]> = {
  drone: [
    { type: "gear", amount: 1 },
    { type: "scrap_metal", amount: 1 },
  ],
  soldier: [
    { type: "gear", amount: 2 },
    { type: "scrap_metal", amount: 2 },
  ],
  heavy: [
    { type: "gear", amount: 4 },
    { type: "scrap_metal", amount: 3 },
    { type: "energy_core", amount: 1 },
  ],
  insectoid: [
    { type: "gear", amount: 2 },
    { type: "bio_essence", amount: 1 },
  ],
  hybrid: [
    { type: "gear", amount: 6 },
    { type: "circuit_board", amount: 2 },
    { type: "bio_essence", amount: 1 },
  ],
  commander: [
    { type: "gear", amount: 10 },
    { type: "energy_core", amount: 2 },
    { type: "circuit_board", amount: 3 },
    { type: "nano_fiber", amount: 2 },
  ],
};

const WEAPON_PART_BY_ENEMY: Record<string, string[]> = {
  drone: ["pistol"],
  soldier: ["rifle", "shotgun"],
  heavy: ["rocket"],
  insectoid: ["laser"],
  hybrid: ["laser", "grenade", "rifle"],
  commander: ["pistol", "rifle", "shotgun", "rocket", "laser", "grenade"],
};

const HEALTH_DROP_CHANCE = 0.18;

export class PickupSystem {
  private scene: BABYLON.Scene;
  private inventory: InventorySystem;
  private bus: EventBus;
  private active: ActivePickup[] = [];
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private idCounter: number = 0;
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private enemyKilledHandler: (data: any) => void;
  private spawnHandler: (data: any) => void;

  private static readonly MAGNET_RANGE = 6;
  private static readonly COLLECT_RANGE = 1.4;
  private static readonly MAGNET_SPEED = 14;
  private static readonly LIFETIME = 35;

  constructor(scene: BABYLON.Scene, inventory: InventorySystem) {
    this.scene = scene;
    this.inventory = inventory;
    this.bus = EventBus.getInstance();

    this.enemyKilledHandler = (data: any) => this.onEnemyKilled(data);
    this.spawnHandler = (data: any) => {
      if (data && data.position) this.spawn(data.position, data.requests || [], data.spread);
    };

    this.bus.on(GameEvents.ENEMY_KILLED, this.enemyKilledHandler);
    this.bus.on(GameEvents.PICKUP_SPAWNED, this.spawnHandler);

    this.observer = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      this.tick(dt);
    });

    console.log("[PickupSystem] Initialized");
  }

  setPlayerPosition(pos: BABYLON.Vector3): void {
    this.playerPos.copyFrom(pos);
  }

  private onEnemyKilled(data: any): void {
    if (!data || !data.position) return;
    const drops: PickupSpawnRequest[] = [...(ENEMY_DROP_TABLE[data.type] || ENEMY_DROP_TABLE.drone)];
    const partTable = WEAPON_PART_BY_ENEMY[data.type] || ["pistol"];
    const dropChance = data.type === "commander" ? 1.0 : data.type === "hybrid" ? 0.6 : 0.35;
    if (Math.random() < dropChance) {
      const wid = partTable[Math.floor(Math.random() * partTable.length)];
      const amount = data.type === "commander" ? 2 + Math.floor(Math.random() * 2) : 1;
      drops.push({ type: "weapon_part", amount, weaponId: wid });
    }
    if (Math.random() < HEALTH_DROP_CHANCE) {
      drops.push({ type: "health_kit", amount: 25 });
    }
    this.spawn(data.position, drops, 0.8);
  }

  spawn(origin: BABYLON.Vector3, requests: PickupSpawnRequest[], spread: number = 1.2): void {
    for (const req of requests) {
      if (!req || !req.type) continue;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      const pos = origin.add(new BABYLON.Vector3(Math.cos(angle) * r, 0.5, Math.sin(angle) * r));
      this.createPickupMesh(pos, req);
    }
  }

  private createPickupMesh(pos: BABYLON.Vector3, req: PickupSpawnRequest): void {
    const id = this.idCounter++;
    const color = PICKUP_COLORS[req.type] || new BABYLON.Color3(1, 1, 1);

    let mesh: BABYLON.Mesh;
    switch (req.type) {
      case "gear":
        mesh = BABYLON.MeshBuilder.CreateTorus(`pickup_${id}`, { diameter: 0.55, thickness: 0.18, tessellation: 10 }, this.scene);
        break;
      case "weapon_part":
        mesh = BABYLON.MeshBuilder.CreateBox(`pickup_${id}`, { width: 0.5, height: 0.18, depth: 0.5 }, this.scene);
        break;
      case "energy_core":
        mesh = BABYLON.MeshBuilder.CreateSphere(`pickup_${id}`, { diameter: 0.55, segments: 12 }, this.scene);
        break;
      case "scrap_metal":
        mesh = BABYLON.MeshBuilder.CreateBox(`pickup_${id}`, { width: 0.45, height: 0.45, depth: 0.45 }, this.scene);
        break;
      case "circuit_board":
        mesh = BABYLON.MeshBuilder.CreateBox(`pickup_${id}`, { width: 0.55, height: 0.05, depth: 0.4 }, this.scene);
        break;
      case "nano_fiber":
        mesh = BABYLON.MeshBuilder.CreateCylinder(`pickup_${id}`, { height: 0.6, diameter: 0.15, tessellation: 8 }, this.scene);
        break;
      case "bio_essence":
        mesh = BABYLON.MeshBuilder.CreateSphere(`pickup_${id}`, { diameter: 0.5, segments: 10 }, this.scene);
        break;
      case "health_kit":
        mesh = BABYLON.MeshBuilder.CreateBox(`pickup_${id}`, { width: 0.45, height: 0.3, depth: 0.45 }, this.scene);
        break;
      default:
        mesh = BABYLON.MeshBuilder.CreateSphere(`pickup_${id}`, { diameter: 0.4 }, this.scene);
    }

    const mat = new BABYLON.StandardMaterial(`pickupMat_${id}`, this.scene);
    mat.emissiveColor = color;
    mat.diffuseColor = color.scale(0.6);
    mat.disableLighting = false;
    mesh.material = mat;
    mesh.position.copyFrom(pos);
    mesh.isPickable = false;

    const halo = BABYLON.MeshBuilder.CreateSphere(`pickup_halo_${id}`, { diameter: 0.95, segments: 8 }, this.scene);
    const haloMat = new BABYLON.StandardMaterial(`pickupHaloMat_${id}`, this.scene);
    haloMat.emissiveColor = color;
    haloMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    haloMat.alpha = 0.18;
    haloMat.disableLighting = true;
    halo.material = haloMat;
    halo.position.copyFrom(pos);
    halo.isPickable = false;
    halo.parent = mesh;
    halo.position.set(0, 0, 0);

    const bobBase = pos.y;
    const item: ActivePickup = {
      id,
      mesh,
      halo,
      type: req.type,
      amount: req.amount,
      weaponId: req.weaponId,
      bobOffset: Math.random() * Math.PI * 2,
      bobBase,
      age: 0,
      collected: false,
    };
    this.active.push(item);
  }

  private tick(dt: number): void {
    if (this.active.length === 0) return;
    const ppos = this.playerPos;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.age += dt;

      if (p.age > PickupSystem.LIFETIME) {
        this.disposePickup(p);
        this.active.splice(i, 1);
        continue;
      }

      p.mesh.rotation.y += dt * 2.2;
      const bob = Math.sin(p.age * 3 + p.bobOffset) * 0.18;

      const dx = ppos.x - p.mesh.position.x;
      const dy = ppos.y + 1 - p.mesh.position.y;
      const dz = ppos.z - p.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < PickupSystem.COLLECT_RANGE) {
        this.collect(p);
        this.disposePickup(p);
        this.active.splice(i, 1);
        continue;
      }

      if (dist < PickupSystem.MAGNET_RANGE) {
        const speed = PickupSystem.MAGNET_SPEED * (1 - dist / PickupSystem.MAGNET_RANGE) + 4;
        const inv = 1 / Math.max(0.001, dist);
        p.mesh.position.x += dx * inv * speed * dt;
        p.mesh.position.y += dy * inv * speed * dt;
        p.mesh.position.z += dz * inv * speed * dt;
      } else {
        p.mesh.position.y = p.bobBase + bob;
      }
    }
  }

  private collect(p: ActivePickup): void {
    let itemId: string | null = null;
    let payloadAmount = p.amount;
    let healthHeal = 0;

    switch (p.type) {
      case "gear":
        itemId = "gear";
        break;
      case "bio_essence":
        itemId = "bio_essence";
        break;
      case "weapon_part":
        itemId = `weapon_part_${p.weaponId || "pistol"}`;
        break;
      case "scrap_metal":
      case "energy_core":
      case "circuit_board":
      case "nano_fiber":
        itemId = p.type;
        break;
      case "health_kit":
        healthHeal = p.amount;
        break;
    }

    if (itemId) {
      const def = ITEM_DEFINITIONS[itemId] || CRAFTING_MATERIALS[itemId];
      if (def) {
        this.inventory.addItem(def, payloadAmount);
      }
    }

    this.bus.emit("effect:pickup", {
      position: p.mesh.position.clone(),
      color: PICKUP_COLORS[p.type],
    });

    this.bus.emit(GameEvents.PICKUP_COLLECTED, {
      type: p.type,
      itemId,
      amount: payloadAmount,
      weaponId: p.weaponId,
      healAmount: healthHeal,
      label: PICKUP_LABELS[p.type],
    });
  }

  private disposePickup(p: ActivePickup): void {
    if (!p.collected) {
      p.collected = true;
    }
    if (p.halo && !p.halo.isDisposed()) p.halo.dispose();
    if (p.mesh && !p.mesh.isDisposed()) p.mesh.dispose();
  }

  getActiveCount(): number {
    return this.active.length;
  }

  dispose(): void {
    this.bus.off(GameEvents.ENEMY_KILLED, this.enemyKilledHandler);
    this.bus.off(GameEvents.PICKUP_SPAWNED, this.spawnHandler);
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    for (const p of this.active) this.disposePickup(p);
    this.active = [];
    console.log("[PickupSystem] Disposed");
  }
}
