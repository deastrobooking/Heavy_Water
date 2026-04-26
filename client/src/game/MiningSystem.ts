import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import type { PickupSpawnRequest } from "./PickupSystem";

export type MiningNodeKind = "scrap_pile" | "crystal_cluster" | "bio_pod" | "gear_cache";

interface NodeConfig {
  kind: MiningNodeKind;
  hp: number;
  hitRadius: number;
  baseColor: BABYLON.Color3;
  glowColor: BABYLON.Color3;
  drops: PickupSpawnRequest[];
  respawnSec: number;
  label: string;
}

const NODE_CONFIGS: Record<MiningNodeKind, NodeConfig> = {
  scrap_pile: {
    kind: "scrap_pile",
    hp: 30,
    hitRadius: 1.6,
    baseColor: new BABYLON.Color3(0.4, 0.4, 0.45),
    glowColor: new BABYLON.Color3(0.7, 0.7, 0.8),
    drops: [
      { type: "scrap_metal", amount: 4 },
      { type: "gear", amount: 1 },
    ],
    respawnSec: 35,
    label: "SCRAP",
  },
  crystal_cluster: {
    kind: "crystal_cluster",
    hp: 50,
    hitRadius: 1.8,
    baseColor: new BABYLON.Color3(0.15, 0.5, 0.6),
    glowColor: new BABYLON.Color3(0.2, 0.95, 1.0),
    drops: [
      { type: "energy_core", amount: 2 },
      { type: "scrap_metal", amount: 2 },
      { type: "circuit_board", amount: 1 },
    ],
    respawnSec: 50,
    label: "CRYSTAL",
  },
  bio_pod: {
    kind: "bio_pod",
    hp: 40,
    hitRadius: 1.6,
    baseColor: new BABYLON.Color3(0.25, 0.45, 0.2),
    glowColor: new BABYLON.Color3(0.5, 1.0, 0.4),
    drops: [
      { type: "bio_essence", amount: 3 },
      { type: "nano_fiber", amount: 1 },
    ],
    respawnSec: 45,
    label: "BIO POD",
  },
  gear_cache: {
    kind: "gear_cache",
    hp: 70,
    hitRadius: 2.0,
    baseColor: new BABYLON.Color3(0.5, 0.4, 0.15),
    glowColor: new BABYLON.Color3(1.0, 0.78, 0.25),
    drops: [
      { type: "gear", amount: 6 },
      { type: "circuit_board", amount: 2 },
      { type: "weapon_part", amount: 1, weaponId: "rifle" },
    ],
    respawnSec: 60,
    label: "GEAR CACHE",
  },
};

interface MiningNode {
  config: NodeConfig;
  hitbox: BABYLON.Mesh;
  visual: BABYLON.TransformNode;
  hp: number;
  alive: boolean;
  respawnAt: number;
  position: BABYLON.Vector3;
  glowMaterials: BABYLON.StandardMaterial[];
  ownedMaterials: BABYLON.Material[];
  shakeTimer: number;
  lastHitFxAt: number;
}

export class MiningSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private nodes: MiningNode[] = [];
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private idCounter = 0;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.bus = EventBus.getInstance();

    this.observer = this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      this.tick(dt);
    });

    console.log("[MiningSystem] Initialized");
  }

  private tick(dt: number): void {
    const now = performance.now();
    for (const node of this.nodes) {
      if (!node.alive) {
        if (now >= node.respawnAt) this.respawnNode(node);
        continue;
      }
      if (node.shakeTimer > 0) {
        node.shakeTimer -= dt;
        const k = Math.max(0, node.shakeTimer / 0.18);
        const j = (Math.random() - 0.5) * 0.18 * k;
        node.visual.position.x = node.position.x + j;
        node.visual.position.z = node.position.z + (Math.random() - 0.5) * 0.18 * k;
      } else {
        node.visual.position.x = node.position.x;
        node.visual.position.z = node.position.z;
      }
    }
  }

  spawnNode(kind: MiningNodeKind, position: BABYLON.Vector3): MiningNode {
    const config = NODE_CONFIGS[kind];
    const id = this.idCounter++;

    const visual = new BABYLON.TransformNode(`mineNodeVisual_${id}`, this.scene);
    visual.position.copyFrom(position);

    const baseMat = new BABYLON.StandardMaterial(`mineBase_${id}`, this.scene);
    baseMat.diffuseColor = config.baseColor;
    baseMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.08);

    const glowMat = new BABYLON.StandardMaterial(`mineGlow_${id}`, this.scene);
    glowMat.diffuseColor = config.glowColor;
    glowMat.emissiveColor = config.glowColor;
    glowMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const glowMaterials: BABYLON.StandardMaterial[] = [glowMat];

    const rock = BABYLON.MeshBuilder.CreatePolyhedron(`mineRock_${id}`, { type: 1, size: 0.9 }, this.scene);
    rock.material = baseMat;
    rock.position.y = 0.45;
    rock.parent = visual;

    if (kind === "crystal_cluster" || kind === "gear_cache") {
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        const crystal = BABYLON.MeshBuilder.CreatePolyhedron(`mineCrystal_${id}_${i}`, { type: 0, size: 0.32 }, this.scene);
        crystal.material = glowMat;
        crystal.position.set(Math.cos(ang) * 0.42, 0.85 + i * 0.08, Math.sin(ang) * 0.42);
        crystal.rotation.x = (Math.random() - 0.5) * 0.6;
        crystal.rotation.z = (Math.random() - 0.5) * 0.6;
        crystal.parent = visual;
      }
      const top = BABYLON.MeshBuilder.CreatePolyhedron(`mineCrystalTop_${id}`, { type: 0, size: 0.5 }, this.scene);
      top.material = glowMat;
      top.position.y = 1.5;
      top.parent = visual;
    } else if (kind === "bio_pod") {
      const orb = BABYLON.MeshBuilder.CreateSphere(`mineOrb_${id}`, { diameter: 0.85, segments: 12 }, this.scene);
      orb.material = glowMat;
      orb.position.y = 1.1;
      orb.parent = visual;
      const orb2 = BABYLON.MeshBuilder.CreateSphere(`mineOrb_${id}_b`, { diameter: 0.55, segments: 10 }, this.scene);
      orb2.material = glowMat;
      orb2.position.set(0.45, 0.7, 0.2);
      orb2.parent = visual;
    } else {
      // scrap_pile: extra rock chunks
      for (let i = 0; i < 3; i++) {
        const chunk = BABYLON.MeshBuilder.CreateBox(`mineChunk_${id}_${i}`, { size: 0.45 }, this.scene);
        chunk.material = baseMat;
        chunk.position.set((Math.random() - 0.5) * 0.8, 0.25 + i * 0.25, (Math.random() - 0.5) * 0.8);
        chunk.rotation.y = Math.random() * Math.PI;
        chunk.parent = visual;
      }
      const wire = BABYLON.MeshBuilder.CreateTorus(`mineWire_${id}`, { diameter: 0.7, thickness: 0.07, tessellation: 12 }, this.scene);
      wire.material = glowMat;
      wire.position.y = 1.0;
      wire.parent = visual;
    }

    const hitbox = BABYLON.MeshBuilder.CreateBox(`mineHitbox_${id}`, { size: 1.8 }, this.scene);
    hitbox.position.copyFrom(position);
    hitbox.position.y += 0.9;
    hitbox.isVisible = false;
    hitbox.isPickable = true;
    hitbox.checkCollisions = false;
    hitbox.metadata = { hitRadius: config.hitRadius, miningNodeId: id };

    const node: MiningNode = {
      config,
      hitbox,
      visual,
      hp: config.hp,
      alive: true,
      respawnAt: 0,
      position: position.clone(),
      glowMaterials,
      ownedMaterials: [baseMat, glowMat],
      shakeTimer: 0,
      lastHitFxAt: 0,
    };
    this.nodes.push(node);
    return node;
  }

  // Returns true if mesh was a mining node and damage was applied (or absorbed because already dead).
  damageNode(mesh: BABYLON.AbstractMesh, damage: number): boolean {
    const id = mesh.metadata?.miningNodeId;
    if (typeof id !== "number") return false;
    const node = this.nodes.find(n => n.hitbox === mesh);
    if (!node) return true;
    if (!node.alive) return true;

    node.hp -= damage;
    node.shakeTimer = 0.18;

    // Throttle hit-impact effect like enemies
    const now = performance.now();
    if (now - node.lastHitFxAt > 80) {
      node.lastHitFxAt = now;
      this.bus.emit("effect:hitImpact", {
        position: node.position.clone().add(new BABYLON.Vector3(0, 0.9, 0)),
        color: node.config.glowColor,
        scale: 0.9,
      });
    }
    // Brief emissive flash on glow materials
    const orig = node.glowMaterials.map(m => m.emissiveColor.clone());
    for (const m of node.glowMaterials) m.emissiveColor = new BABYLON.Color3(1, 0.3, 0.3);
    setTimeout(() => {
      for (let i = 0; i < node.glowMaterials.length; i++) {
        if (node.glowMaterials[i]) node.glowMaterials[i].emissiveColor = orig[i];
      }
    }, 140);

    if (node.hp <= 0) this.shatterNode(node);
    return true;
  }

  private shatterNode(node: MiningNode): void {
    node.alive = false;
    node.respawnAt = performance.now() + node.config.respawnSec * 1000;

    // Big impact effect
    this.bus.emit("effect:hitImpact", {
      position: node.position.clone().add(new BABYLON.Vector3(0, 0.9, 0)),
      color: node.config.glowColor,
      scale: 2.4,
    });

    // Drop loot via existing pickup pipeline
    this.bus.emit(GameEvents.PICKUP_SPAWNED, {
      position: node.position.clone().add(new BABYLON.Vector3(0, 0.6, 0)),
      requests: node.config.drops,
      spread: 1.4,
    });

    node.visual.setEnabled(false);
    node.hitbox.setEnabled(false);
  }

  private respawnNode(node: MiningNode): void {
    node.hp = node.config.hp;
    node.alive = true;
    node.visual.setEnabled(true);
    node.hitbox.setEnabled(true);
    // Sparkle to show respawn
    this.bus.emit("effect:hitImpact", {
      position: node.position.clone().add(new BABYLON.Vector3(0, 0.9, 0)),
      color: node.config.glowColor,
      scale: 1.6,
    });
  }

  /** Returns array of hitbox meshes for routing through WeaponsSystem.update */
  getActiveMeshes(): BABYLON.Mesh[] {
    const out: BABYLON.Mesh[] = [];
    for (const n of this.nodes) {
      if (n.alive) out.push(n.hitbox);
    }
    return out;
  }

  seedWorld(count: number = 28): void {
    const kinds: MiningNodeKind[] = ["scrap_pile", "scrap_pile", "crystal_cluster", "bio_pod", "gear_cache"];
    for (let i = 0; i < count; i++) {
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const angle = Math.random() * Math.PI * 2;
      const radius = 80 + Math.random() * 360;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      this.spawnNode(kind, new BABYLON.Vector3(x, 0, z));
    }
  }

  spawnNodesAt(positions: { kind: MiningNodeKind; pos: BABYLON.Vector3 }[]): void {
    for (const p of positions) this.spawnNode(p.kind, p.pos);
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    for (const n of this.nodes) {
      // dispose all child meshes first
      const children = n.visual.getChildMeshes(false);
      for (const c of children) c.dispose();
      n.hitbox.dispose();
      n.visual.dispose();
      for (const m of n.ownedMaterials) {
        try { m.dispose(); } catch {}
      }
    }
    this.nodes = [];
  }
}
