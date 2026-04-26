import * as BABYLON from "@babylonjs/core";
import { GridMaterial } from "@babylonjs/materials/grid";
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
  Cube = "cube",
  Sphere = "sphere",
  Pyramid = "pyramid",
  Pillar = "pillar",
  Foundation = "foundation",
  Fence = "fence",
  NeonStrip = "neon_strip",
  Brick = "brick",
  Stairs = "stairs",
  Window = "window",
  Tower = "tower",
  ConeRoof = "cone_roof",
  Turret = "turret",
}

export interface SerializedBlock {
  type: BlockType;
  pos: [number, number, number];
  rot: number;
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
  light?: BABYLON.PointLight;
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
  [BlockType.Cube]: {
    type: BlockType.Cube,
    name: "Cube",
    size: { width: 2, height: 2, depth: 2 },
    color: new BABYLON.Color3(0.55, 0.55, 0.6),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 2 }],
    health: 120,
  },
  [BlockType.Sphere]: {
    type: BlockType.Sphere,
    name: "Sphere",
    size: { width: 2, height: 2, depth: 2 },
    color: new BABYLON.Color3(0.6, 0.7, 0.8),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 2 }, { materialId: "nano_fiber", quantity: 1 }],
    health: 110,
  },
  [BlockType.Pyramid]: {
    type: BlockType.Pyramid,
    name: "Pyramid",
    size: { width: 3, height: 3, depth: 3 },
    color: new BABYLON.Color3(0.7, 0.5, 0.3),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 4 }],
    health: 200,
  },
  [BlockType.Pillar]: {
    type: BlockType.Pillar,
    name: "Pillar",
    size: { width: 1, height: 4, depth: 1 },
    color: new BABYLON.Color3(0.5, 0.5, 0.55),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 3 }],
    health: 180,
  },
  [BlockType.Foundation]: {
    type: BlockType.Foundation,
    name: "Foundation",
    size: { width: 6, height: 0.6, depth: 6 },
    color: new BABYLON.Color3(0.35, 0.35, 0.4),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 6 }],
    health: 300,
  },
  [BlockType.Fence]: {
    type: BlockType.Fence,
    name: "Fence",
    size: { width: 4, height: 1.5, depth: 0.2 },
    color: new BABYLON.Color3(0.3, 0.3, 0.35),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 1 }],
    health: 60,
  },
  [BlockType.NeonStrip]: {
    type: BlockType.NeonStrip,
    name: "Neon Strip",
    size: { width: 4, height: 0.3, depth: 0.3 },
    color: new BABYLON.Color3(1.0, 0.2, 0.8),
    alpha: 0.95,
    materialCost: [{ materialId: "energy_core", quantity: 1 }, { materialId: "circuit_board", quantity: 1 }],
    health: 40,
    emissive: new BABYLON.Color3(1.0, 0.1, 0.6),
  },
  [BlockType.Brick]: {
    type: BlockType.Brick,
    name: "Brick",
    size: { width: 1, height: 0.6, depth: 0.5 },
    color: new BABYLON.Color3(0.55, 0.28, 0.22),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 1 }],
    health: 90,
  },
  [BlockType.Stairs]: {
    type: BlockType.Stairs,
    name: "Stairs",
    size: { width: 4, height: 3, depth: 4 },
    color: new BABYLON.Color3(0.5, 0.5, 0.55),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 6 }],
    health: 200,
  },
  [BlockType.Window]: {
    type: BlockType.Window,
    name: "Window",
    size: { width: 4, height: 3, depth: 0.3 },
    color: new BABYLON.Color3(0.45, 0.75, 1.0),
    alpha: 1,
    materialCost: [{ materialId: "crystal_shard", quantity: 1 }, { materialId: "scrap_metal", quantity: 2 }],
    health: 90,
  },
  [BlockType.Tower]: {
    type: BlockType.Tower,
    name: "Tower",
    size: { width: 1.8, height: 8, depth: 1.8 },
    color: new BABYLON.Color3(0.45, 0.45, 0.5),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 8 }],
    health: 320,
  },
  [BlockType.ConeRoof]: {
    type: BlockType.ConeRoof,
    name: "Cone Roof",
    size: { width: 4, height: 3, depth: 4 },
    color: new BABYLON.Color3(0.55, 0.18, 0.2),
    alpha: 1,
    materialCost: [{ materialId: "scrap_metal", quantity: 4 }],
    health: 140,
  },
  [BlockType.Turret]: {
    type: BlockType.Turret,
    name: "Turret",
    size: { width: 2.4, height: 2.6, depth: 2.4 },
    color: new BABYLON.Color3(0.4, 0.45, 0.5),
    alpha: 1,
    materialCost: [
      { materialId: "scrap_metal", quantity: 6 },
      { materialId: "circuit_board", quantity: 1 },
      { materialId: "energy_core", quantity: 1 },
    ],
    health: 240,
    emissive: new BABYLON.Color3(0.3, 0.05, 0.05),
  },
};

const BLOCK_HOTBAR: BlockType[] = [
  BlockType.MetalWall, BlockType.Glass, BlockType.Platform, BlockType.Ramp,
  BlockType.Door, BlockType.Light, BlockType.Cube, BlockType.Sphere,
  BlockType.Pyramid, BlockType.Pillar, BlockType.Foundation, BlockType.Fence,
  BlockType.NeonStrip, BlockType.Brick, BlockType.Stairs, BlockType.Window,
  BlockType.Tower, BlockType.ConeRoof, BlockType.Turret,
];

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
  private gridGround: BABYLON.Mesh | null = null;

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

  private wheelHandler: ((e: WheelEvent) => void) | null = null;

  private setupControls(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.code === "KeyG") {
        this.toggleBuildMode();
      }

      if (this.buildMode) {
        if (e.code === "KeyR") {
          this.rotatePlacement();
        }
        const digitMap: Record<string, number> = {
          Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4,
          Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9,
        };
        if (e.code in digitMap) {
          const idx = digitMap[e.code];
          if (idx < BLOCK_HOTBAR.length) {
            this.selectBlock(BLOCK_HOTBAR[idx]);
          }
        }
        if (e.code === "Minus" && BLOCK_HOTBAR.length > 10) {
          this.selectBlock(BLOCK_HOTBAR[10]);
        }
        if (e.code === "Equal" && BLOCK_HOTBAR.length > 11) {
          this.selectBlock(BLOCK_HOTBAR[11]);
        }
      }
    };

    this.wheelHandler = (e: WheelEvent) => {
      if (!this.buildMode) return;
      e.preventDefault();
      const currentIdx = BLOCK_HOTBAR.indexOf(this.selectedBlockType);
      const dir = e.deltaY > 0 ? 1 : -1;
      const nextIdx = (currentIdx + dir + BLOCK_HOTBAR.length) % BLOCK_HOTBAR.length;
      this.selectBlock(BLOCK_HOTBAR[nextIdx]);
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
    window.addEventListener("wheel", this.wheelHandler, { passive: false });
  }

  getHotbar(): BlockType[] {
    return [...BLOCK_HOTBAR];
  }

  toggleBuildMode(): void {
    this.buildMode = !this.buildMode;

    if (this.buildMode) {
      this.createPreviewMesh();
      this.showGridOverlay(true);
      this.bus.emit(GameEvents.UI_MESSAGE, "Build Mode ON — 1-9/0/-/=: select, R: rotate, LMB: place, RMB: mine");
      console.log("[BuildingSystem] Build mode enabled");
    } else {
      this.destroyPreviewMesh();
      this.showGridOverlay(false);
      this.bus.emit(GameEvents.UI_MESSAGE, "Build Mode OFF");
      console.log("[BuildingSystem] Build mode disabled");
    }

    this.bus.emit("building:modeChanged", this.buildMode);
  }

  private showGridOverlay(on: boolean): void {
    if (on) {
      if (!this.gridGround) {
        this.gridGround = BABYLON.MeshBuilder.CreateGround("buildGridGround", {
          width: 400, height: 400, subdivisions: 1,
        }, this.scene);
        const gm = new GridMaterial("buildGridMat", this.scene);
        gm.majorUnitFrequency = 5;
        gm.minorUnitVisibility = 0.4;
        gm.gridRatio = GRID_SIZE;
        gm.mainColor = new BABYLON.Color3(0, 0, 0);
        gm.lineColor = new BABYLON.Color3(0.2, 1.0, 0.5);
        gm.opacity = 0.55;
        gm.backFaceCulling = false;
        this.gridGround.material = gm;
        this.gridGround.isPickable = false;
        this.gridGround.position.y = 0.04;
      }
      this.gridGround.setEnabled(true);
    } else if (this.gridGround) {
      this.gridGround.setEnabled(false);
    }
  }

  private updateGridOverlayPosition(): void {
    if (!this.gridGround || !this.gridGround.isEnabled()) return;
    this.gridGround.position.x = Math.round(this.camera.position.x / GRID_SIZE) * GRID_SIZE;
    this.gridGround.position.z = Math.round(this.camera.position.z / GRID_SIZE) * GRID_SIZE;
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

  private buildShapeMesh(name: string, type: BlockType, def: BlockDefinition): BABYLON.Mesh {
    switch (type) {
      case BlockType.Ramp:
        return this.createRampMesh(name, def);
      case BlockType.Sphere:
        return BABYLON.MeshBuilder.CreateSphere(name, {
          diameter: def.size.width, segments: 16,
        }, this.scene);
      case BlockType.Pyramid:
        return BABYLON.MeshBuilder.CreateCylinder(name, {
          height: def.size.height, diameterTop: 0, diameterBottom: def.size.width, tessellation: 4,
        }, this.scene);
      case BlockType.Pillar:
        return BABYLON.MeshBuilder.CreateCylinder(name, {
          height: def.size.height, diameter: def.size.width, tessellation: 16,
        }, this.scene);
      case BlockType.Fence:
        return this.createFenceMesh(name, def);
      case BlockType.Stairs:
        return this.createStairsMesh(name, def);
      case BlockType.Window:
        return this.createWindowMesh(name, def);
      case BlockType.Tower:
        return BABYLON.MeshBuilder.CreateCylinder(name, {
          height: def.size.height, diameter: def.size.width, tessellation: 16,
        }, this.scene);
      case BlockType.ConeRoof:
        return BABYLON.MeshBuilder.CreateCylinder(name, {
          height: def.size.height, diameterTop: 0, diameterBottom: def.size.width, tessellation: 16,
        }, this.scene);
      case BlockType.Turret:
        return this.createTurretMesh(name, def);
      default:
        return BABYLON.MeshBuilder.CreateBox(name,
          { width: def.size.width, height: def.size.height, depth: def.size.depth },
          this.scene
        );
    }
  }

  private createStairsMesh(name: string, def: BlockDefinition): BABYLON.Mesh {
    const steps = 6;
    const stepH = def.size.height / steps;
    const stepD = def.size.depth / steps;
    const parts: BABYLON.Mesh[] = [];
    for (let i = 0; i < steps; i++) {
      const s = BABYLON.MeshBuilder.CreateBox(`${name}_step_${i}`, {
        width: def.size.width,
        height: stepH * (i + 1),
        depth: stepD,
      }, this.scene);
      s.position.set(0, (stepH * (i + 1)) / 2, -def.size.depth / 2 + stepD * (i + 0.5));
      parts.push(s);
    }
    const merged = BABYLON.Mesh.MergeMeshes(parts, true, true);
    if (merged) { merged.name = name; return merged; }
    return parts[0];
  }

  private createWindowMesh(name: string, def: BlockDefinition): BABYLON.Mesh {
    const frameThick = 0.18;
    const w = def.size.width, h = def.size.height, d = def.size.depth;
    const top = BABYLON.MeshBuilder.CreateBox(`${name}_top`, { width: w, height: frameThick, depth: d }, this.scene);
    top.position.y = h / 2 - frameThick / 2;
    const bot = BABYLON.MeshBuilder.CreateBox(`${name}_bot`, { width: w, height: frameThick, depth: d }, this.scene);
    bot.position.y = -h / 2 + frameThick / 2;
    const left = BABYLON.MeshBuilder.CreateBox(`${name}_left`, { width: frameThick, height: h, depth: d }, this.scene);
    left.position.x = -w / 2 + frameThick / 2;
    const right = BABYLON.MeshBuilder.CreateBox(`${name}_right`, { width: frameThick, height: h, depth: d }, this.scene);
    right.position.x = w / 2 - frameThick / 2;
    const cross = BABYLON.MeshBuilder.CreateBox(`${name}_cross`, { width: w, height: frameThick * 0.6, depth: d }, this.scene);
    cross.position.y = 0;
    const merged = BABYLON.Mesh.MergeMeshes([top, bot, left, right, cross], true, true);
    if (merged) { merged.name = name; return merged; }
    return top;
  }

  private createTurretMesh(name: string, def: BlockDefinition): BABYLON.Mesh {
    const baseR = def.size.width / 2;
    const base = BABYLON.MeshBuilder.CreateCylinder(`${name}_base`, {
      height: 0.6, diameter: def.size.width, tessellation: 16,
    }, this.scene);
    base.position.y = 0.3;
    const dome = BABYLON.MeshBuilder.CreateSphere(`${name}_dome`, {
      diameter: def.size.width * 0.85, segments: 16, slice: 0.55,
    }, this.scene);
    dome.position.y = 0.6;
    const turretBody = BABYLON.MeshBuilder.CreateCylinder(`${name}_body`, {
      height: 0.8, diameter: def.size.width * 0.7, tessellation: 16,
    }, this.scene);
    turretBody.position.y = 1.2;
    const barrel = BABYLON.MeshBuilder.CreateCylinder(`${name}_barrel`, {
      height: def.size.depth * 1.2, diameter: 0.35, tessellation: 12,
    }, this.scene);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 1.3, def.size.depth * 0.55);
    const merged = BABYLON.Mesh.MergeMeshes([base, dome, turretBody, barrel], true, true);
    if (merged) { merged.name = name; return merged; }
    return base;
  }

  private createFenceMesh(name: string, def: BlockDefinition): BABYLON.Mesh {
    const top = BABYLON.MeshBuilder.CreateBox(name + "_top", {
      width: def.size.width, height: 0.2, depth: def.size.depth,
    }, this.scene);
    top.position.y = def.size.height - 0.1;
    const bot = BABYLON.MeshBuilder.CreateBox(name + "_bot", {
      width: def.size.width, height: 0.2, depth: def.size.depth,
    }, this.scene);
    bot.position.y = 0.1;
    const slats: BABYLON.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const slat = BABYLON.MeshBuilder.CreateBox(name + "_slat" + i, {
        width: 0.15, height: def.size.height, depth: def.size.depth,
      }, this.scene);
      slat.position.x = -def.size.width / 2 + (i + 0.5) * (def.size.width / 5);
      slat.position.y = def.size.height / 2;
      slats.push(slat);
    }
    const merged = BABYLON.Mesh.MergeMeshes([top, bot, ...slats], true, true);
    if (merged) {
      merged.name = name;
      return merged;
    }
    return top;
  }

  private createPreviewMesh(): void {
    this.destroyPreviewMesh();
    const def = BLOCK_DEFINITIONS[this.selectedBlockType];

    this.previewMesh = this.buildShapeMesh("buildPreview", this.selectedBlockType, def);

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

    const mesh: BABYLON.Mesh = this.buildShapeMesh(
      `block_${this.blockIdCounter}`, this.selectedBlockType, def
    );

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

    let blockLight: BABYLON.PointLight | undefined;
    if (this.selectedBlockType === BlockType.Light) {
      blockLight = new BABYLON.PointLight(
        `blockLight_${this.blockIdCounter}`,
        pos.clone().add(new BABYLON.Vector3(0, 0.5, 0)),
        this.scene
      );
      blockLight.diffuse = new BABYLON.Color3(0.8, 0.9, 1.0);
      blockLight.intensity = 0.6;
      blockLight.range = 15;
    }

    const block: PlacedBlock = {
      id: `block_${this.blockIdCounter}`,
      type: this.selectedBlockType,
      mesh,
      health: def.health,
      maxHealth: def.health,
      position: pos.clone(),
      rotation: this.placementRotation,
      light: blockLight,
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
    if (block.light) {
      block.light.dispose();
    }
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
    if (this.buildMode) {
      this.updateGridOverlayPosition();
    }
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

  exportPlaced(): SerializedBlock[] {
    return this.placedBlocks.map((b) => ({
      type: b.type,
      pos: [b.position.x, b.position.y, b.position.z] as [number, number, number],
      rot: b.rotation,
    }));
  }

  clearAll(): void {
    for (const block of this.placedBlocks) {
      if (!block.mesh.isDisposed()) block.mesh.dispose();
      if (block.light) block.light.dispose();
    }
    this.placedBlocks = [];
    this.bus.emit(GameEvents.UI_MESSAGE, "Level cleared");
  }

  placeAt(type: BlockType, pos: BABYLON.Vector3, rotationDeg: number): boolean {
    const def = BLOCK_DEFINITIONS[type];
    if (!def) {
      console.warn(`[BuildingSystem] Unknown block type: ${type}`);
      return false;
    }
    const id = `block_${this.blockIdCounter++}`;
    const mesh = this.buildShapeMesh(id, type, def);
    mesh.position = pos.clone();
    mesh.rotation.y = BABYLON.Tools.ToRadians(rotationDeg);
    const mat = new BABYLON.StandardMaterial(`blockMat_${id}`, this.scene);
    mat.diffuseColor = def.color.clone();
    mat.alpha = def.alpha;
    if (def.emissive) mat.emissiveColor = def.emissive.clone();
    mat.specularPower = 32;
    mesh.material = mat;
    mesh.checkCollisions = true;
    mesh.metadata = { tag: "PlacedBlock", blockId: id };
    let blockLight: BABYLON.PointLight | undefined;
    if (type === BlockType.Light) {
      blockLight = new BABYLON.PointLight(
        `blockLight_${id}`,
        pos.clone().add(new BABYLON.Vector3(0, 0.5, 0)),
        this.scene
      );
      blockLight.diffuse = new BABYLON.Color3(0.8, 0.9, 1.0);
      blockLight.intensity = 0.6;
      blockLight.range = 15;
    }
    this.placedBlocks.push({
      id, type, mesh,
      health: def.health, maxHealth: def.health,
      position: pos.clone(),
      rotation: rotationDeg,
      light: blockLight,
    });
    return true;
  }

  dispose(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
    }
    if (this.clickHandler) {
      window.removeEventListener("pointerdown", this.clickHandler);
    }
    if (this.wheelHandler) {
      window.removeEventListener("wheel", this.wheelHandler);
    }

    this.destroyPreviewMesh();

    if (this.gridGround) {
      this.gridGround.material?.dispose();
      this.gridGround.dispose();
      this.gridGround = null;
    }

    for (const block of this.placedBlocks) {
      block.mesh.dispose();
      if (block.light) block.light.dispose();
    }
    this.placedBlocks = [];

    for (const chunk of this.minedChunks) {
      if (!chunk.mesh.isDisposed()) chunk.mesh.dispose();
    }
    this.minedChunks = [];

    console.log("[BuildingSystem] Disposed");
  }
}
