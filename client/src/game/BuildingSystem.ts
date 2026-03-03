import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { InventorySystem, ItemType, ItemRarity } from "./InventorySystem";
import { CRAFTING_MATERIALS } from "./CraftingSystem";

export enum BlockType {
  MetalWall = "metal_wall",
  Glass = "glass",
  Platform = "platform",
  Ramp = "ramp",
  Door = "door",
  Light = "light",
}

export interface BlockDefinition {
  type: BlockType;
  name: string;
  size: { width: number; height: number; depth: number };
  color: BABYLON.Color3;
  alpha: number;
  materialCost: Array<{ materialId: string; quantity: number }>;
  health: number;
  emissive?: BABYLON.Color3;
}

export interface PlacedBlock {
  id: string;
  type: BlockType;
  mesh: BABYLON.Mesh;
  health: number;
  maxHealth: number;
  position: BABYLON.Vector3;
  rotation: number;
}

export interface MinedChunk {
  mesh: BABYLON.Mesh;
  velocity: BABYLON.Vector3;
  lifetime: number;
}

const BLOCK_DEFINITIONS: Record<BlockType, BlockDefinition> = {
  [BlockType.MetalWall]: {
    type: BlockType.MetalWall,
    name: "Metal Wall",
    size: { width: 4, height: 3, depth: 0.5 },
    color: new BABYLON.Color3(0.4, 0.45, 0.5),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 4 }],
    health: 200,
  },
  [BlockType.Glass]: {
    type: BlockType.Glass,
    name: "Glass Panel",
    size: { width: 4, height: 3, depth: 0.15 },
    color: new BABYLON.Color3(0.5, 0.8, 1.0),
    alpha: 0.35,
    materialCost: [{ materialId: "crystal_shard", quantity: 2 }],
    health: 80,
  },
  [BlockType.Platform]: {
    type: BlockType.Platform,
    name: "Platform",
    size: { width: 4, height: 0.3, depth: 4 },
    color: new BABYLON.Color3(0.5, 0.5, 0.55),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 3 }],
    health: 150,
  },
  [BlockType.Ramp]: {
    type: BlockType.Ramp,
    name: "Ramp",
    size: { width: 4, height: 3, depth: 4 },
    color: new BABYLON.Color3(0.45, 0.45, 0.5),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 5 }],
    health: 180,
  },
  [BlockType.Door]: {
    type: BlockType.Door,
    name: "Door",
    size: { width: 2, height: 3, depth: 0.3 },
    color: new BABYLON.Color3(0.3, 0.35, 0.4),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 3 }, { materialId: "circuit_board", quantity: 1 }],
    health: 120,
  },
  [BlockType.Light]: {
    type: BlockType.Light,
    name: "Light Block",
    size: { width: 1, height: 1, depth: 1 },
    color: new BABYLON.Color3(0.9, 0.95, 1.0),
    alpha: 0.9,
    materialCost: [{ materialId: "energy_core", quantity: 1 }],
    health: 60,
    emissive: new BABYLON.Color3(0.8, 0.9, 1.0),
  },
};

const GRID_SIZE = 2;

export class BuildingSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private inventory: InventorySystem;
  private bus: EventBus;

  private buildMode: boolean = false;
  private selectedBlockType: BlockType = BlockType.MetalWall;
  private placementRotation: number = 0;
  private previewMesh: BABYLON.Mesh | null = null;

  private placedBlocks: PlacedBlock[] = [];
  private minedChunks: MinedChunk[] = [];
  private blockIdCounter: number = 0;

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private clickHandler: ((e: PointerEvent) => void) | null = null;

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera, inventory: InventorySystem) {
    this.scene = scene;
    this.camera = camera;
    this.inventory = inventory;
    this.bus = EventBus.getInstance();

    this.setupControls();
    console.log("[BuildingSystem] Initialized");
  }

  private setupControls(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.code === "KeyG") {
        this.toggleBuildMode();
      }

      if (this.buildMode) {
        if (e.code === "KeyR") {
          this.rotatePlacement();
        }
        if (e.code === "Digit1") this.selectBlock(BlockType.MetalWall);
        if (e.code === "Digit2") this.selectBlock(BlockType.Glass);
        if (e.code === "Digit3") this.selectBlock(BlockType.Platform);
        if (e.code === "Digit4") this.selectBlock(BlockType.Ramp);
        if (e.code === "Digit5") this.selectBlock(BlockType.Door);
        if (e.code === "Digit6") this.selectBlock(BlockType.Light);
      }
    };

    this.clickHandler = (e: PointerEvent) => {
      if (!this.buildMode) return;

      if (e.button === 0) {
        this.placeBlock();
      } else if (e.button === 2) {
        this.mineAtCrosshair();
      }
    };

    window.addEventListener("keydown", this.keyHandler);
    window.addEventListener("pointerdown", this.clickHandler);
  }

  toggleBuildMode(): void {
    this.buildMode = !this.buildMode;

    if (this.buildMode) {
      this.createPreviewMesh();
      this.bus.emit(GameEvents.UI_MESSAGE, "Build Mode ON — 1-6: select block, R: rotate, LMB: place, RMB: mine");
      console.log("[BuildingSystem] Build mode enabled");
    } else {
      this.destroyPreviewMesh();
      this.bus.emit(GameEvents.UI_MESSAGE, "Build Mode OFF");
      console.log("[BuildingSystem] Build mode disabled");
    }

    this.bus.emit("building:modeChanged", this.buildMode);
  }

  isBuildMode(): boolean {
    return this.buildMode;
  }

  getSelectedBlockType(): BlockType {
    return this.selectedBlockType;
  }

  getBlockDefinitions(): Record<BlockType, BlockDefinition> {
    return BLOCK_DEFINITIONS;
  }

  getPlacedBlocks(): PlacedBlock[] {
    return this.placedBlocks;
  }

  private selectBlock(type: BlockType): void {
    this.selectedBlockType = type;
    this.destroyPreviewMesh();
    this.createPreviewMesh();
    const def = BLOCK_DEFINITIONS[type];
    this.bus.emit(GameEvents.UI_MESSAGE, `Selected: ${def.name}`);
    console.log(`[BuildingSystem] Selected block: ${def.name}`);
  }

  private rotatePlacement(): void {
    this.placementRotation = (this.placementRotation + 90) % 360;
    console.log(`[BuildingSystem] Rotation: ${this.placementRotation}°`);
  }

  private createPreviewMesh(): void {
    this.destroyPreviewMesh();
    const def = BLOCK_DEFINITIONS[this.selectedBlockType];

    if (this.selectedBlockType === BlockType.Ramp) {
      this.previewMesh = this.createRampMesh("buildPreview", def);
    } else {
      this.previewMesh = BABYLON.MeshBuilder.CreateBox(
        "buildPreview",
        { width: def.size.width, height: def.size.height, depth: def.size.depth },
        this.scene
      );
    }

    const mat = new BABYLON.StandardMaterial("previewMat", this.scene);
    mat.diffuseColor = new BABYLON.Color3(0, 1, 0.5);
    mat.alpha = 0.4;
    mat.wireframe = true;
    this.previewMesh.material = mat;
    this.previewMesh.isPickable = false;
  }

  private destroyPreviewMesh(): void {
    if (this.previewMesh) {
      this.previewMesh.dispose();
      this.previewMesh = null;
    }
  }

  private getPlacementPosition(): BABYLON.Vector3 {
    const forward = this.camera.getForwardRay().direction;
    const origin = this.camera.position.clone();
    const distance = 8;
    const target = origin.add(forward.scale(distance));

    const snappedX = Math.round(target.x / GRID_SIZE) * GRID_SIZE;
    const snappedY = Math.max(0, Math.round(target.y / GRID_SIZE) * GRID_SIZE);
    const snappedZ = Math.round(target.z / GRID_SIZE) * GRID_SIZE;

    return new BABYLON.Vector3(snappedX, snappedY, snappedZ);
  }

  private canAffordBlock(type: BlockType): boolean {
    const def = BLOCK_DEFINITIONS[type];
    return def.materialCost.every(cost =>
      this.inventory.hasItem(cost.materialId, cost.quantity)
    );
  }

  private consumeMaterials(type: BlockType): void {
    const def = BLOCK_DEFINITIONS[type];
    for (const cost of def.materialCost) {
      this.inventory.removeItem(cost.materialId, cost.quantity);
    }
  }

  private placeBlock(): void {
    if (!this.buildMode) return;

    if (!this.canAffordBlock(this.selectedBlockType)) {
      this.bus.emit(GameEvents.UI_MESSAGE, "Not enough materials!");
      return;
    }

    const pos = this.getPlacementPosition();
    const def = BLOCK_DEFINITIONS[this.selectedBlockType];

    const overlapping = this.placedBlocks.some(block => {
      return BABYLON.Vector3.Distance(block.position, pos) < 1.0;
    });

    if (overlapping) {
      this.bus.emit(GameEvents.UI_MESSAGE, "Cannot place here — overlapping block");
      return;
    }

    this.consumeMaterials(this.selectedBlockType);

    let mesh: BABYLON.Mesh;
    if (this.selectedBlockType === BlockType.Ramp) {
      mesh = this.createRampMesh(`block_${this.blockIdCounter}`, def);
    } else {
      mesh = BABYLON.MeshBuilder.CreateBox(
        `block_${this.blockIdCounter}`,
        { width: def.size.width, height: def.size.height, depth: def.size.depth },
        this.scene
      );
    }

    mesh.position = pos.clone();
    mesh.rotation.y = BABYLON.Tools.ToRadians(this.placementRotation);

    const mat = new BABYLON.StandardMaterial(`blockMat_${this.blockIdCounter}`, this.scene);
    mat.diffuseColor = def.color.clone();
    mat.alpha = def.alpha;
    if (def.emissive) {
      mat.emissiveColor = def.emissive.clone();
    }
    mat.specularPower = 32;
    mesh.material = mat;

    mesh.checkCollisions = true;
    mesh.metadata = { tag: "PlacedBlock", blockId: `block_${this.blockIdCounter}` };

    if (this.selectedBlockType === BlockType.Light) {
      const light = new BABYLON.PointLight(
        `blockLight_${this.blockIdCounter}`,
        pos.clone().add(new BABYLON.Vector3(0, 0.5, 0)),
        this.scene
      );
      light.diffuse = new BABYLON.Color3(0.8, 0.9, 1.0);
      light.intensity = 0.6;
      light.range = 15;
    }

    const block: PlacedBlock = {
      id: `block_${this.blockIdCounter}`,
      type: this.selectedBlockType,
      mesh,
      health: def.health,
      maxHealth: def.health,
      position: pos.clone(),
      rotation: this.placementRotation,
    };

    this.placedBlocks.push(block);
    this.blockIdCounter++;

    this.bus.emit(GameEvents.UI_MESSAGE, `Placed ${def.name}`);
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
    console.log(`[BuildingSystem] Placed ${def.name} at ${pos.x}, ${pos.y}, ${pos.z}`);
  }

  private createRampMesh(name: string, def: BlockDefinition): BABYLON.Mesh {
    const positions = [
      -def.size.width / 2, 0, -def.size.depth / 2,
      def.size.width / 2, 0, -def.size.depth / 2,
      -def.size.width / 2, 0, def.size.depth / 2,
      def.size.width / 2, 0, def.size.depth / 2,
      -def.size.width / 2, def.size.height, def.size.depth / 2,
      def.size.width / 2, def.size.height, def.size.depth / 2,
    ];

    const indices = [
      0, 2, 1, 1, 2, 3,
      2, 4, 3, 3, 4, 5,
      0, 1, 5, 0, 5, 4,
      0, 4, 2,
      1, 3, 5,
    ];

    const normals: number[] = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);

    const vertexData = new BABYLON.VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;

    const mesh = new BABYLON.Mesh(name, this.scene);
    vertexData.applyToMesh(mesh);

    return mesh;
  }

  mineAtCrosshair(): void {
    const ray = this.camera.getForwardRay(30);
    const hit = this.scene.pickWithRay(ray, (mesh) => {
      return mesh.metadata?.tag === "PlacedBlock" ||
             mesh.metadata?.tag === "Building" ||
             mesh.metadata?.tag === "Terrain" ||
             (mesh.name.startsWith("building_") || mesh.name.startsWith("platform_"));
    });

    if (hit?.pickedMesh) {
      this.mineMesh(hit.pickedMesh, hit.pickedPoint ?? hit.pickedMesh.position);
    }
  }

  mineAtPosition(position: BABYLON.Vector3, radius: number = 3): void {
    const meshes = this.scene.meshes.filter(mesh => {
      if (!mesh.isVisible || mesh.isDisposed()) return false;
      const dist = BABYLON.Vector3.Distance(mesh.position, position);
      if (dist > radius + 5) return false;

      return mesh.metadata?.tag === "PlacedBlock" ||
             mesh.metadata?.tag === "Building" ||
             mesh.name.startsWith("building_") ||
             mesh.name.startsWith("platform_");
    });

    for (const mesh of meshes) {
      const dist = BABYLON.Vector3.Distance(mesh.position, position);
      if (dist <= radius) {
        this.mineMesh(mesh as BABYLON.Mesh, position);
      }
    }
  }

  private mineMesh(mesh: BABYLON.AbstractMesh, hitPoint: BABYLON.Vector3): void {
    const placedIndex = this.placedBlocks.findIndex(b => b.id === mesh.metadata?.blockId);

    if (placedIndex >= 0) {
      const block = this.placedBlocks[placedIndex];
      block.health -= 50;

      if (block.health <= 0) {
        this.destroyBlock(placedIndex, hitPoint);
      } else {
        this.bus.emit(GameEvents.UI_MESSAGE, `Block damaged (${block.health}/${block.maxHealth})`);
      }
    } else {
      this.destroyWorldMesh(mesh as BABYLON.Mesh, hitPoint);
    }
  }

  private destroyBlock(index: number, hitPoint: BABYLON.Vector3): void {
    const block = this.placedBlocks[index];
    const def = BLOCK_DEFINITIONS[block.type];

    this.spawnDebrisChunks(block.mesh.position, def.color, 4);
    this.dropMaterials(hitPoint);

    block.mesh.dispose();
    this.placedBlocks.splice(index, 1);

    this.bus.emit(GameEvents.UI_MESSAGE, `Destroyed ${def.name}`);
    console.log(`[BuildingSystem] Destroyed block ${block.id}`);
  }

  private destroyWorldMesh(mesh: BABYLON.Mesh, hitPoint: BABYLON.Vector3): void {
    let color = new BABYLON.Color3(0.5, 0.5, 0.5);
    if (mesh.material && mesh.material instanceof BABYLON.StandardMaterial) {
      color = mesh.material.diffuseColor.clone();
    }

    this.spawnDebrisChunks(hitPoint, color, 6);
    this.dropMaterials(hitPoint);

    const boundingInfo = mesh.getBoundingInfo();
    const size = boundingInfo.boundingBox.extendSize;

    if (size.x > 2 || size.y > 2 || size.z > 2) {
      const scaleFactor = 0.7;
      mesh.scaling.scaleInPlace(scaleFactor);
      mesh.position.y -= size.y * (1 - scaleFactor);
      this.bus.emit(GameEvents.UI_MESSAGE, "Chunk blasted from structure");
    } else {
      mesh.dispose();
      this.bus.emit(GameEvents.UI_MESSAGE, "Structure destroyed");
    }

    console.log(`[BuildingSystem] Mined world mesh: ${mesh.name}`);
  }

  private spawnDebrisChunks(origin: BABYLON.Vector3, color: BABYLON.Color3, count: number): void {
    for (let i = 0; i < count; i++) {
      const chunkSize = 0.2 + Math.random() * 0.4;
      const chunk = BABYLON.MeshBuilder.CreateBox(
        `debris_${Date.now()}_${i}`,
        { size: chunkSize },
        this.scene
      );

      chunk.position = origin.clone().add(
        new BABYLON.Vector3(
          (Math.random() - 0.5) * 2,
          Math.random() * 1.5,
          (Math.random() - 0.5) * 2
        )
      );

      const mat = new BABYLON.StandardMaterial(`debrisMat_${Date.now()}_${i}`, this.scene);
      mat.diffuseColor = color.clone();
      mat.emissiveColor = new BABYLON.Color3(0.1, 0.05, 0);
      chunk.material = mat;
      chunk.isPickable = false;

      const vel = new BABYLON.Vector3(
        (Math.random() - 0.5) * 0.3,
        Math.random() * 0.2 + 0.1,
        (Math.random() - 0.5) * 0.3
      );

      this.minedChunks.push({ mesh: chunk, velocity: vel, lifetime: 2.0 });
    }
  }

  private dropMaterials(position: BABYLON.Vector3): void {
    const materialDrops = [
      { id: "scrap_metal", chance: 0.7, min: 1, max: 3 },
      { id: "circuit_board", chance: 0.3, min: 1, max: 1 },
      { id: "energy_core", chance: 0.15, min: 1, max: 1 },
      { id: "nano_fiber", chance: 0.2, min: 1, max: 2 },
      { id: "crystal_shard", chance: 0.1, min: 1, max: 1 },
    ];

    for (const drop of materialDrops) {
      if (Math.random() < drop.chance) {
        const qty = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
        const materialDef = CRAFTING_MATERIALS[drop.id];
        if (materialDef) {
          this.inventory.addItem(materialDef, qty);
          this.bus.emit(GameEvents.UI_MESSAGE, `+${qty} ${materialDef.name}`);
        }
      }
    }

    this.bus.emit(GameEvents.INVENTORY_CHANGED);
  }

  update(deltaTime: number): void {
    if (this.buildMode && this.previewMesh) {
      const pos = this.getPlacementPosition();
      this.previewMesh.position = pos;
      this.previewMesh.rotation.y = BABYLON.Tools.ToRadians(this.placementRotation);

      const canAfford = this.canAffordBlock(this.selectedBlockType);
      const mat = this.previewMesh.material as BABYLON.StandardMaterial;
      if (mat) {
        mat.diffuseColor = canAfford
          ? new BABYLON.Color3(0, 1, 0.5)
          : new BABYLON.Color3(1, 0.2, 0.2);
      }
    }

    for (let i = this.minedChunks.length - 1; i >= 0; i--) {
      const chunk = this.minedChunks[i];
      chunk.lifetime -= deltaTime;

      if (chunk.lifetime <= 0 || chunk.mesh.isDisposed()) {
        if (!chunk.mesh.isDisposed()) chunk.mesh.dispose();
        this.minedChunks.splice(i, 1);
        continue;
      }

      chunk.velocity.y -= 0.01;
      chunk.mesh.position.addInPlace(chunk.velocity);
      chunk.mesh.rotation.x += 0.05;
      chunk.mesh.rotation.z += 0.03;

      if (chunk.lifetime < 0.5) {
        const mat = chunk.mesh.material as BABYLON.StandardMaterial;
        if (mat) {
          mat.alpha = chunk.lifetime / 0.5;
        }
      }
    }
  }

  damageBlocksInRadius(center: BABYLON.Vector3, radius: number, damage: number): void {
    for (let i = this.placedBlocks.length - 1; i >= 0; i--) {
      const block = this.placedBlocks[i];
      const dist = BABYLON.Vector3.Distance(block.position, center);
      if (dist <= radius) {
        const falloff = 1 - (dist / radius);
        block.health -= damage * falloff;
        if (block.health <= 0) {
          this.destroyBlock(i, center);
        }
      }
    }
  }

  getBlockCount(): number {
    return this.placedBlocks.length;
  }

  dispose(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
    }
    if (this.clickHandler) {
      window.removeEventListener("pointerdown", this.clickHandler);
    }

    this.destroyPreviewMesh();

    for (const block of this.placedBlocks) {
      block.mesh.dispose();
    }
    this.placedBlocks = [];

    for (const chunk of this.minedChunks) {
      if (!chunk.mesh.isDisposed()) chunk.mesh.dispose();
    }
    this.minedChunks = [];

    console.log("[BuildingSystem] Disposed");
  }
}
