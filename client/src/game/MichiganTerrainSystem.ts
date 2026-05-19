import * as BABYLON from "@babylonjs/core";
import { TerrainMaterial } from "@babylonjs/materials/terrain/terrainMaterial";
import { EventBus, GameEvents } from "./EventBus";
import { ITEM_DEFINITIONS, type InventorySystem } from "./InventorySystem";
import type { CityGenerator } from "./CityGenerator";
import type { BioCreatureSystem } from "./BioCreatureSystem";
import { BIO_SPECIES } from "./BioSpecies";
import type { EnemySystem, EnemyType, EnemyUnit } from "./EnemySystem";
import type { AerialEnemySystem, AerialUnit } from "./AerialEnemySystem";

export interface MichiganTerrainHandles {
  city?: CityGenerator | null;
  worldVisibles?: Array<{ setVisible(visible: boolean): void } | null | undefined>;
  lodCull?: { setSuppressed(b: boolean): void } | null;
  bio?: BioCreatureSystem | null;
  inventory?: InventorySystem | null;
  playerPos?: (() => BABYLON.Vector3) | null;
  enemy?: EnemySystem | null;
  aerial?: AerialEnemySystem | null;
}

interface HeightData {
  width: number;
  height: number;
  values: Float32Array;
}

export interface MichiganWarpPoint {
  id: string;
  name: string;
  description: string;
  kind: "base" | "tower" | "lab";
  x: number;
  z: number;
}

interface MichiganWarpPointDef {
  id: string;
  name: string;
  description: string;
  kind: "base" | "tower" | "lab";
  fx: number;
  fz: number;
}

/**
 * Heightmap side-zone for the Michigan Wilds level.
 *
 * This level intentionally owns its terrain material instead of retinting
 * CityGenerator ground, so the existing Detroit/city levels keep their
 * current asphalt and neon look.
 */
export class MichiganTerrainSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private handles: MichiganTerrainHandles;
  private root: BABYLON.TransformNode;
  private terrain: BABYLON.Mesh | null = null;
  private water: BABYLON.Mesh | null = null;
  private terrainMaterial: TerrainMaterial | null = null;
  private heightData: HeightData | null = null;
  private hiddenVisibles: Array<{ setVisible(v: boolean): void }> = [];
  private cityHidden = false;
  private disposed = false;
  private ownedMaterials: BABYLON.Material[] = [];
  private ownedTextures: BABYLON.BaseTexture[] = [];
  private spawnedBioIds: string[] = [];
  private powerBlooms: Array<{ mesh: BABYLON.Mesh; itemId: keyof typeof ITEM_DEFINITIONS; quantity: number; collected: boolean; baseY: number }> = [];
  private spawnedEnemyUnits: EnemyUnit[] = [];
  private spawnedAerialUnits: AerialUnit[] = [];
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private previousEnemyMax: number | null = null;
  private terrainContentSeeded = false;

  private static readonly HEIGHTMAP_URLS = [
    "/textures/miheightmap.png",
    "/textures/MIHEIGHTMAP.PNG",
  ];
  private static readonly GRASS_TEXTURE_URL = "/textures/grass.png";
  private static readonly CENTER = new BABYLON.Vector3(3000, 0, 1500);
  private static readonly HEIGHTMAP_PIXEL_WIDTH = 1448;
  private static readonly HEIGHTMAP_PIXEL_HEIGHT = 1086;
  private static readonly HEIGHTMAP_ASPECT =
    MichiganTerrainSystem.HEIGHTMAP_PIXEL_WIDTH / MichiganTerrainSystem.HEIGHTMAP_PIXEL_HEIGHT;
  private static readonly TERRAIN_DEPTH = 5400;
  private static readonly TERRAIN_WIDTH =
    MichiganTerrainSystem.TERRAIN_DEPTH * MichiganTerrainSystem.HEIGHTMAP_ASPECT;
  private static readonly SUBDIVISIONS = 320;
  private static readonly MIN_HEIGHT = -26;
  private static readonly MAX_HEIGHT = 148;
  private static readonly SEA_LEVEL = 0;
  private static readonly SAFE_SPAWN_Y = MichiganTerrainSystem.SEA_LEVEL + 18;
  private static readonly SWIM_DEPTH = 1.1;
  private static readonly ROCK_START = 34;
  private static readonly ROCK_FULL = 58;
  private static readonly HEIGHT_COLOR_FILTER = new BABYLON.Color3(0.3, 0.59, 0.11);
  private static readonly WARP_POINT_DEFS: MichiganWarpPointDef[] = [
    {
      id: "west-giant-base",
      name: "West Giant Base",
      description: "Enemy giant base in the western forest belt.",
      kind: "base",
      fx: -0.39,
      fz: -0.08,
    },
    {
      id: "north-ridge-base",
      name: "North Ridge Base",
      description: "Highland base with clear lines to the northern towers.",
      kind: "base",
      fx: 0.02,
      fz: 0.39,
    },
    {
      id: "southeast-marsh-base",
      name: "Southeast Marsh Base",
      description: "Floodplain base guarding the lowland approach.",
      kind: "base",
      fx: 0.37,
      fz: -0.31,
    },
    {
      id: "keweenaw-watchtower",
      name: "Keweenaw Watchtower",
      description: "Northern signal tower above the rock country.",
      kind: "tower",
      fx: -0.42,
      fz: 0.43,
    },
    {
      id: "central-firetower",
      name: "Central Firetower",
      description: "Tall scout tower near the open-world midpoint.",
      kind: "tower",
      fx: -0.04,
      fz: -0.02,
    },
    {
      id: "huron-watchtower",
      name: "Huron Watchtower",
      description: "Eastern tower watching the flooded Huron edge.",
      kind: "tower",
      fx: 0.43,
      fz: 0.08,
    },
    {
      id: "southline-watchtower",
      name: "Southline Watchtower",
      description: "Southern signal tower on the final wilds route.",
      kind: "tower",
      fx: -0.08,
      fz: -0.45,
    },
    {
      id: "marquette-rescue-lab",
      name: "Marquette Rescue Lab",
      description: "Remote lab holding rescued Animaton records.",
      kind: "lab",
      fx: -0.31,
      fz: 0.25,
    },
    {
      id: "lansing-field-lab",
      name: "Lansing Field Lab",
      description: "Central field lab for wilds bio-samples.",
      kind: "lab",
      fx: 0.19,
      fz: -0.35,
    },
    {
      id: "thumb-coast-lab",
      name: "Thumb Coast Lab",
      description: "Eastern rescue lab near the lowland waterline.",
      kind: "lab",
      fx: 0.39,
      fz: 0.29,
    },
  ];

  static getWarpPoints(): MichiganWarpPoint[] {
    return MichiganTerrainSystem.WARP_POINT_DEFS.map((def) => {
      const pos = MichiganTerrainSystem.getWarpWorldPosition(def);
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        kind: def.kind,
        x: pos.x,
        z: pos.z,
      };
    });
  }

  static getDefaultSpawnY(): number {
    return MichiganTerrainSystem.SAFE_SPAWN_Y;
  }

  constructor(scene: BABYLON.Scene, handles: MichiganTerrainHandles = {}) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.handles = handles;
    this.root = new BABYLON.TransformNode("michiganTerrainRoot", scene);

    if (this.handles.enemy) {
      try {
        this.previousEnemyMax = this.handles.enemy.getMaxEnemies();
        this.handles.enemy.clearAllEnemies();
        this.handles.enemy.setMaxEnemies(Math.max(this.previousEnemyMax, 56));
      } catch {}
    }
    try { this.handles.aerial?.disengageAndClear(); } catch {}

    this.buildTerrain();
    this.buildWaterPlane();
    this.hideOuterWorld();
    try { this.handles.lodCull?.setSuppressed(true); } catch {}
    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());

    this.bus.emit(
      GameEvents.UI_MESSAGE,
      "MICHIGAN WILDS - heightmap terrain online. Lowlands flood, foothills grass over, peaks turn to rock.",
    );
    console.log("[MichiganTerrainSystem] Michigan Wilds mounted");
  }

  dispose(restoreOuterWorld: boolean = true): void {
    this.disposed = true;
    if (this.observer) {
      try { this.scene.onBeforeRenderObservable.remove(this.observer); } catch {}
      this.observer = null;
    }
    if (this.handles.bio && this.spawnedBioIds.length) {
      for (const id of this.spawnedBioIds) {
        try { this.handles.bio.despawnCreature(id); } catch {}
      }
    }
    this.spawnedBioIds = [];
    if (this.handles.enemy) {
      for (const unit of this.spawnedEnemyUnits) {
        try {
          unit.isAlive = false;
          if (unit.mesh && !unit.mesh.isDisposed()) unit.mesh.dispose();
        } catch {}
      }
      try { this.handles.enemy.clearAllEnemies(); } catch {}
      if (this.previousEnemyMax != null) {
        try { this.handles.enemy.setMaxEnemies(this.previousEnemyMax); } catch {}
      }
    }
    for (const unit of this.spawnedAerialUnits) {
      try { if (unit.isAlive) unit.dispose(); } catch {}
    }
    try { this.handles.aerial?.disengageAndClear(); } catch {}
    this.spawnedEnemyUnits = [];
    this.spawnedAerialUnits = [];
    this.powerBlooms = [];
    if (restoreOuterWorld) {
      try { this.restoreOuterWorld(); } catch {}
    } else {
      this.cityHidden = false;
      this.hiddenVisibles = [];
    }
    try { this.root.dispose(); } catch {}
    for (const mat of this.ownedMaterials) {
      try { mat.dispose(); } catch {}
    }
    this.ownedMaterials = [];
    for (const tex of this.ownedTextures) {
      try { tex.dispose(); } catch {}
    }
    this.ownedTextures = [];
    this.heightData = null;
    this.terrain = null;
    this.water = null;
    this.terrainMaterial = null;
    if (restoreOuterWorld) {
      try { this.handles.lodCull?.setSuppressed(false); } catch {}
    }
    console.log("[MichiganTerrainSystem] Michigan Wilds disposed");
  }

  getDriveableHeight(x: number, z: number): number | null {
    return this.getHeightAt(x, z);
  }

  getWaterSurfaceAt(x: number, z: number): number | null {
    const ground = this.getHeightAt(x, z);
    if (ground == null) return null;
    if (ground > MichiganTerrainSystem.SEA_LEVEL - MichiganTerrainSystem.SWIM_DEPTH) return null;
    return MichiganTerrainSystem.SEA_LEVEL;
  }

  getHeightAt(x: number, z: number): number | null {
    const data = this.heightData;
    if (!data) return null;

    const localX = x - (MichiganTerrainSystem.CENTER.x - MichiganTerrainSystem.TERRAIN_WIDTH / 2);
    const localZ = z - (MichiganTerrainSystem.CENTER.z - MichiganTerrainSystem.TERRAIN_DEPTH / 2);
    if (
      localX < 0 ||
      localX > MichiganTerrainSystem.TERRAIN_WIDTH ||
      localZ < 0 ||
      localZ > MichiganTerrainSystem.TERRAIN_DEPTH
    ) {
      return null;
    }

    const u = localX / MichiganTerrainSystem.TERRAIN_WIDTH;
    const v = 1 - localZ / MichiganTerrainSystem.TERRAIN_DEPTH;
    const px = BABYLON.Scalar.Clamp(u, 0, 1) * (data.width - 1);
    const py = BABYLON.Scalar.Clamp(v, 0, 1) * (data.height - 1);
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = Math.min(data.width - 1, x0 + 1);
    const y1 = Math.min(data.height - 1, y0 + 1);
    const tx = px - x0;
    const ty = py - y0;

    const h00 = data.values[y0 * data.width + x0];
    const h10 = data.values[y0 * data.width + x1];
    const h01 = data.values[y1 * data.width + x0];
    const h11 = data.values[y1 * data.width + x1];
    const hx0 = BABYLON.Scalar.Lerp(h00, h10, tx);
    const hx1 = BABYLON.Scalar.Lerp(h01, h11, tx);
    return BABYLON.Scalar.Lerp(hx0, hx1, ty);
  }

  private buildTerrain(): void {
    const terrainMat = this.createTerrainMaterial();
    this.terrainMaterial = terrainMat;

    const terrain = BABYLON.MeshBuilder.CreateGround(
      "miTerrain",
      {
        width: MichiganTerrainSystem.TERRAIN_WIDTH,
        height: MichiganTerrainSystem.TERRAIN_DEPTH,
        subdivisions: MichiganTerrainSystem.SUBDIVISIONS,
        updatable: true,
      },
      this.scene,
    );
    terrain.position.copyFrom(MichiganTerrainSystem.CENTER);
    terrain.parent = this.root;
    terrain.material = terrainMat;
    terrain.isPickable = true;
    terrain.receiveShadows = true;
    this.terrain = terrain;

    // Start with shaped fallback land immediately so the player never sees
    // a flat blue placeholder while the image request resolves.
    this.useProceduralHeightFallback(terrainMat, false);
    this.loadHeightmapData(terrainMat);
  }

  private createTerrainMaterial(): TerrainMaterial {
    const material = new TerrainMaterial("miTerrainMat", this.scene);
    const tileScale = MichiganTerrainSystem.TERRAIN_WIDTH / 1800;
    material.specularColor = new BABYLON.Color3(0.04, 0.045, 0.05);
    material.mixTexture = this.createFallbackMixTexture();
    material.diffuseTexture1 = this.createNoiseTexture(
      "miWaterbedTex",
      new BABYLON.Color3(0.05, 0.12, 0.16),
      new BABYLON.Color3(0.16, 0.22, 0.18),
      72 * tileScale,
      17,
    );

    const grass = new BABYLON.Texture(MichiganTerrainSystem.GRASS_TEXTURE_URL, this.scene);
    grass.uScale = 95 * tileScale;
    grass.vScale = 95 * tileScale;
    grass.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    grass.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    this.ownedTextures.push(grass);
    material.diffuseTexture2 = grass;

    material.diffuseTexture3 = this.createNoiseTexture(
      "miRockTex",
      new BABYLON.Color3(0.24, 0.25, 0.27),
      new BABYLON.Color3(0.56, 0.55, 0.50),
      84 * tileScale,
      41,
    );

    this.ownedMaterials.push(material);
    return material;
  }

  private buildWaterPlane(): void {
    const water = BABYLON.MeshBuilder.CreateGround(
      "miWaterPlane",
      {
        width: MichiganTerrainSystem.TERRAIN_WIDTH,
        height: MichiganTerrainSystem.TERRAIN_DEPTH,
        subdivisions: 64,
      },
      this.scene,
    );
    water.position.set(
      MichiganTerrainSystem.CENTER.x,
      MichiganTerrainSystem.SEA_LEVEL + 0.04,
      MichiganTerrainSystem.CENTER.z,
    );
    water.parent = this.root;
    water.isPickable = false;
    water.receiveShadows = false;
    this.water = water;

    const mat = new BABYLON.StandardMaterial("miWaterMat", this.scene);
    mat.diffuseColor = new BABYLON.Color3(0.02, 0.26, 0.42);
    mat.emissiveColor = new BABYLON.Color3(0.0, 0.08, 0.14);
    mat.specularColor = new BABYLON.Color3(0.35, 0.55, 0.65);
    mat.alpha = 0.52;
    mat.backFaceCulling = false;
    water.material = mat;
    this.ownedMaterials.push(mat);
  }

  private loadHeightmapData(terrainMat: TerrainMaterial, urlIndex: number = 0): void {
    const url = MichiganTerrainSystem.HEIGHTMAP_URLS[urlIndex];
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (this.disposed) return;
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (width <= 0 || height <= 0) {
        this.useProceduralHeightFallback(terrainMat);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        this.useProceduralHeightFallback(terrainMat);
        return;
      }
      let source: ImageData;
      try {
        ctx.drawImage(img, 0, 0, width, height);
        source = ctx.getImageData(0, 0, width, height);
      } catch (err) {
        console.warn("[MichiganTerrainSystem] Could not sample heightmap pixels; using procedural fallback", err);
        this.useProceduralHeightFallback(terrainMat);
        return;
      }
      const values = new Float32Array(width * height);

      const mix = new BABYLON.DynamicTexture(
        "miTerrainHeightMix",
        { width, height },
        this.scene,
        false,
      );
      const mixCtx = mix.getContext();
      const mixImage = new ImageData(width, height);

      for (let i = 0; i < values.length; i++) {
        const j = i * 4;
        const luminance = this.heightLuminance(
          source.data[j],
          source.data[j + 1],
          source.data[j + 2],
        );
        let worldHeight = MichiganTerrainSystem.MIN_HEIGHT +
          luminance * (MichiganTerrainSystem.MAX_HEIGHT - MichiganTerrainSystem.MIN_HEIGHT);
        const px = i % width;
        const py = Math.floor(i / width);
        const localX = (px / Math.max(1, width - 1) - 0.5) * MichiganTerrainSystem.TERRAIN_WIDTH;
        const localZ = ((1 - py / Math.max(1, height - 1)) - 0.5) * MichiganTerrainSystem.TERRAIN_DEPTH;
        worldHeight = this.applySpawnClearing(localX, localZ, worldHeight);
        values[i] = worldHeight;
        this.writeTierMixPixel(mixImage.data, j, worldHeight);
      }

      mixCtx.putImageData(mixImage, 0, 0);
      mix.update(false);
      this.configureMixTexture(mix);
      terrainMat.mixTexture = mix;
      this.ownedTextures.push(mix);
      this.finishHeightData({ width, height, values }, `heightmap ${url}`);
    };
    img.onerror = () => {
      if (urlIndex + 1 < MichiganTerrainSystem.HEIGHTMAP_URLS.length) {
        this.loadHeightmapData(terrainMat, urlIndex + 1);
        return;
      }
      console.warn("[MichiganTerrainSystem] Could not load heightmap image; using procedural fallback terrain");
      this.useProceduralHeightFallback(terrainMat);
    };
    img.src = url;
  }

  private finishHeightData(data: HeightData, sourceLabel: string): void {
    if (this.disposed) return;
    this.heightData = data;
    this.applyHeightDataToTerrain(data);
    this.seedTerrainContentOnce();
    console.log(`[MichiganTerrainSystem] Terrain ready from ${sourceLabel}`);
    this.bus.emit(GameEvents.UI_MESSAGE, `MI WILDS TERRAIN READY - ${sourceLabel.toUpperCase()}`);
  }

  private seedTerrainContentOnce(): void {
    if (this.terrainContentSeeded) return;
    this.terrainContentSeeded = true;
    this.spawnRareWildlife();
    this.buildPowerBlooms();
    this.buildWildsOutposts();
    this.spawnWildsDangerLayer();
  }

  private applyHeightDataToTerrain(data: HeightData): void {
    const terrain = this.terrain;
    if (!terrain) return;
    const positions = terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const indices = terrain.getIndices();
    if (!positions || !indices) return;

    for (let i = 0; i < positions.length; i += 3) {
      const localX = positions[i];
      const localZ = positions[i + 2];
      const u = (localX + MichiganTerrainSystem.TERRAIN_WIDTH / 2) / MichiganTerrainSystem.TERRAIN_WIDTH;
      const v = 1 - ((localZ + MichiganTerrainSystem.TERRAIN_DEPTH / 2) / MichiganTerrainSystem.TERRAIN_DEPTH);
      positions[i + 1] = MichiganTerrainSystem.sampleHeightData(data, u, v);
    }

    const normals: number[] = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    terrain.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
    terrain.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    terrain.refreshBoundingInfo();
  }

  private useProceduralHeightFallback(terrainMat: TerrainMaterial, seedContent: boolean = true): void {
    const width = 257;
    const height = 193;
    const values = new Float32Array(width * height);
    const mix = new BABYLON.DynamicTexture(
      "miTerrainProceduralMix",
      { width, height },
      this.scene,
      false,
    );
    const mixCtx = mix.getContext();
    const mixImage = new ImageData(width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / Math.max(1, width - 1);
        const v = y / Math.max(1, height - 1);
        const localX = (u - 0.5) * MichiganTerrainSystem.TERRAIN_WIDTH;
        const localZ = ((1 - v) - 0.5) * MichiganTerrainSystem.TERRAIN_DEPTH;
        const h = this.proceduralHeight(localX, localZ);
        const idx = y * width + x;
        values[idx] = h;
        this.writeTierMixPixel(mixImage.data, idx * 4, h);
      }
    }

    mixCtx.putImageData(mixImage, 0, 0);
    mix.update(false);
    this.configureMixTexture(mix);
    terrainMat.mixTexture = mix;
    this.ownedTextures.push(mix);
    const data = { width, height, values };
    if (seedContent) {
      this.finishHeightData(data, "procedural fallback");
    } else {
      this.heightData = data;
      this.applyHeightDataToTerrain(data);
    }
  }

  private applySpawnClearing(localX: number, localZ: number, worldHeight: number): number {
    const dist = Math.sqrt(localX * localX + localZ * localZ);
    const padScale = MichiganTerrainSystem.TERRAIN_WIDTH / 1800;
    const landingPad = 1 - MichiganTerrainSystem.smoothstep(55 * padScale, 165 * padScale, dist);
    if (landingPad <= 0) return worldHeight;
    const dryHeight = MichiganTerrainSystem.SEA_LEVEL + 7.5;
    return Math.max(worldHeight, BABYLON.Scalar.Lerp(worldHeight, dryHeight, landingPad));
  }

  private proceduralHeight(localX: number, localZ: number): number {
    const s = MichiganTerrainSystem.TERRAIN_WIDTH / 1800;
    const nx = localX / (MichiganTerrainSystem.TERRAIN_WIDTH / 2);
    const nz = localZ / (MichiganTerrainSystem.TERRAIN_DEPTH / 2);
    const radial = Math.sqrt(nx * nx + nz * nz);
    const rolling =
      Math.sin((localX * 0.009) / s) * 7.0 +
      Math.cos((localZ * 0.012) / s) * 5.5 +
      Math.sin(((localX - localZ) * 0.006) / s) * 6.0 +
      (MichiganTerrainSystem.noise2(Math.floor(localX / (32 * s)), Math.floor(localZ / (32 * s)), 77) - 0.5) * 7.0;
    const foothills = MichiganTerrainSystem.smoothstep(0.42, 1.0, radial) * 42;
    const westernMarsh = MichiganTerrainSystem.gaussian(localX + 455 * s, localZ - 120 * s, 185 * s) * -28;
    const southernLake = MichiganTerrainSystem.gaussian(localX - 120 * s, localZ + 420 * s, 230 * s) * -24;
    const peakA = MichiganTerrainSystem.gaussian(localX - 520 * s, localZ + 210 * s, 210 * s) * 42;
    const peakB = MichiganTerrainSystem.gaussian(localX + 660 * s, localZ + 350 * s, 190 * s) * 34;
    const raw = 8 + rolling + foothills + westernMarsh + southernLake + peakA + peakB;
    return BABYLON.Scalar.Clamp(
      this.applySpawnClearing(localX, localZ, raw),
      MichiganTerrainSystem.MIN_HEIGHT,
      MichiganTerrainSystem.MAX_HEIGHT,
    );
  }

  private sampleTerrainPosition(dx: number, dz: number, lift: number = 0.6): BABYLON.Vector3 {
    const x = MichiganTerrainSystem.CENTER.x + dx;
    const z = MichiganTerrainSystem.CENTER.z + dz;
    const h = this.getHeightAt(x, z);
    return new BABYLON.Vector3(x, (h ?? MichiganTerrainSystem.SEA_LEVEL) + lift, z);
  }

  private sampleTerrainFraction(fx: number, fz: number, lift: number = 0.6): BABYLON.Vector3 {
    return this.sampleTerrainPosition(
      fx * MichiganTerrainSystem.TERRAIN_WIDTH,
      fz * MichiganTerrainSystem.TERRAIN_DEPTH,
      lift,
    );
  }

  private sampleWarpPoint(def: MichiganWarpPointDef, lift: number = 0.6): BABYLON.Vector3 {
    return this.sampleTerrainFraction(def.fx, def.fz, lift);
  }

  private static getWarpWorldPosition(def: MichiganWarpPointDef): { x: number; z: number } {
    return {
      x: MichiganTerrainSystem.CENTER.x + def.fx * MichiganTerrainSystem.TERRAIN_WIDTH,
      z: MichiganTerrainSystem.CENTER.z + def.fz * MichiganTerrainSystem.TERRAIN_DEPTH,
    };
  }

  private spawnRareWildlife(): void {
    const bio = this.handles.bio;
    if (!bio) return;
    const pool = BIO_SPECIES.filter(sp => sp.rarity === "rare" || sp.rarity === "legendary");
    if (pool.length === 0) return;

    const offsets: Array<[number, number]> = [
      [-0.45, -0.36], [-0.36, 0.31], [-0.25, -0.12], [-0.11, 0.44],
      [ 0.07, -0.39], [ 0.22, 0.16], [ 0.34, -0.22], [ 0.44, 0.33],
      [-0.48, 0.08], [ 0.47, -0.43], [ 0.01, 0.50], [ 0.40, 0.02],
    ];
    offsets.forEach(([fx, fz], i) => {
      const species = pool[(i * 7 + 3) % pool.length];
      const pos = this.sampleTerrainFraction(fx, fz, 0.9);
      if (pos.y < MichiganTerrainSystem.SEA_LEVEL + 0.8) {
        pos.y = MichiganTerrainSystem.SEA_LEVEL + 0.8;
      }
      try {
        const id = bio.spawnCreature(species, pos);
        if (id) this.spawnedBioIds.push(id);
      } catch (err) {
        console.warn("[MichiganTerrainSystem] failed to spawn rare MI wildlife", err);
      }
    });
  }

  private buildPowerBlooms(): void {
    const entries: Array<[number, number, keyof typeof ITEM_DEFINITIONS, number, BABYLON.Color3]> = [
      [-0.38, -0.22, "bio_seed", 4, new BABYLON.Color3(0.35, 1.0, 0.45)],
      [-0.25,  0.34, "bio_essence", 3, new BABYLON.Color3(0.35, 0.9, 1.0)],
      [-0.04, -0.47, "animaton_feed", 2, new BABYLON.Color3(1.0, 0.72, 0.28)],
      [ 0.22,  0.31, "power_jewel_rough", 1, new BABYLON.Color3(1.0, 0.32, 0.72)],
      [ 0.36, -0.16, "bio_essence", 4, new BABYLON.Color3(0.45, 0.85, 1.0)],
      [ 0.47,  0.24, "power_jewel_cut", 1, new BABYLON.Color3(1.0, 0.25, 0.95)],
    ];

    entries.forEach(([fx, fz, itemId, quantity, color], i) => {
      const pos = this.sampleTerrainFraction(fx, fz, 1.35);
      const bloom = BABYLON.MeshBuilder.CreateSphere(`miPowerBloom_${i}`, { diameter: 1.7, segments: 14 }, this.scene);
      bloom.position.copyFrom(pos);
      bloom.parent = this.root;
      bloom.isPickable = false;

      const mat = new BABYLON.StandardMaterial(`miPowerBloomMat_${i}`, this.scene);
      mat.diffuseColor = color.scale(0.45);
      mat.emissiveColor = color;
      mat.specularColor = color.scale(0.25);
      bloom.material = mat;
      this.ownedMaterials.push(mat);

      const ring = BABYLON.MeshBuilder.CreateTorus(`miPowerBloomRing_${i}`, {
        diameter: 2.3,
        thickness: 0.08,
        tessellation: 24,
      }, this.scene);
      ring.position.set(0, 0, 0);
      ring.rotation.x = Math.PI / 2;
      ring.parent = bloom;
      ring.isPickable = false;
      ring.material = mat;

      this.powerBlooms.push({ mesh: bloom, itemId, quantity, collected: false, baseY: pos.y });
    });
  }

  private buildWildsOutposts(): void {
    let baseIndex = 0;
    let labIndex = 0;
    let towerIndex = 0;
    for (const def of MichiganTerrainSystem.WARP_POINT_DEFS) {
      if (def.kind === "base") {
        this.buildGiantBase(this.sampleWarpPoint(def, 0.08), baseIndex++);
      } else if (def.kind === "lab") {
        this.buildRescueLab(this.sampleWarpPoint(def, 0.08), labIndex++);
      } else {
        this.buildWatchTower(this.sampleWarpPoint(def, 0.08), towerIndex++);
      }
    }

    this.buildMothershipWreck(this.sampleTerrainFraction(-0.12, -0.50, 3.0), 0, -0.38);
    this.buildMothershipWreck(this.sampleTerrainFraction(0.46, 0.07, 4.0), 1, 0.55);
  }

  private buildGiantBase(pos: BABYLON.Vector3, idx: number): void {
    const scene = this.scene;
    const wallMat = this.makeMaterial(`miBaseWallMat_${idx}`, new BABYLON.Color3(0.22, 0.20, 0.18), new BABYLON.Color3(0.04, 0.02, 0.02));
    const glowMat = this.makeMaterial(`miBaseGlowMat_${idx}`, new BABYLON.Color3(0.75, 0.08, 0.08), new BABYLON.Color3(0.55, 0.02, 0.02));
    const metalMat = this.makeMaterial(`miBaseMetalMat_${idx}`, new BABYLON.Color3(0.34, 0.34, 0.37), new BABYLON.Color3(0.05, 0.04, 0.05));

    const root = new BABYLON.TransformNode(`miGiantBase_${idx}`, scene);
    root.parent = this.root;
    root.position.copyFrom(pos);
    root.rotation.y = (idx * 0.7) % Math.PI;

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const segment = BABYLON.MeshBuilder.CreateBox(`miBaseWall_${idx}_${i}`, {
        width: 22,
        height: 5.5,
        depth: 1.4,
      }, scene);
      segment.position.set(Math.cos(a) * 27, 2.75, Math.sin(a) * 27);
      segment.rotation.y = -a + Math.PI / 2;
      segment.parent = root;
      segment.material = wallMat;
      segment.isPickable = false;
    }

    const tower = BABYLON.MeshBuilder.CreateCylinder(`miBaseTower_${idx}`, {
      diameterTop: 8,
      diameterBottom: 13,
      height: 18,
      tessellation: 8,
    }, scene);
    tower.position.set(0, 9, 0);
    tower.parent = root;
    tower.material = metalMat;
    tower.isPickable = false;

    const core = BABYLON.MeshBuilder.CreateSphere(`miBaseCore_${idx}`, { diameter: 4.2, segments: 14 }, scene);
    core.position.set(0, 18.8, 0);
    core.parent = root;
    core.material = glowMat;
    core.isPickable = false;

    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.25;
      const pylon = BABYLON.MeshBuilder.CreateCylinder(`miBasePylon_${idx}_${i}`, {
        diameter: 2.3,
        height: 9,
        tessellation: 6,
      }, scene);
      pylon.position.set(Math.cos(a) * 18, 4.5, Math.sin(a) * 18);
      pylon.parent = root;
      pylon.material = glowMat;
      pylon.isPickable = false;
    }
  }

  private buildRescueLab(pos: BABYLON.Vector3, idx: number): void {
    const scene = this.scene;
    const wallMat = this.makeMaterial(`miLabWallMat_${idx}`, new BABYLON.Color3(0.68, 0.72, 0.74), new BABYLON.Color3(0.06, 0.08, 0.09));
    const roofMat = this.makeMaterial(`miLabRoofMat_${idx}`, new BABYLON.Color3(0.22, 0.38, 0.42), new BABYLON.Color3(0.02, 0.10, 0.12));
    const cyanMat = this.makeMaterial(`miLabCyanMat_${idx}`, new BABYLON.Color3(0.20, 0.95, 1.0), new BABYLON.Color3(0.08, 0.60, 0.78));

    const root = new BABYLON.TransformNode(`miRescueLab_${idx}`, scene);
    root.parent = this.root;
    root.position.copyFrom(pos);
    root.rotation.y = idx * 0.9 - 0.4;

    const body = BABYLON.MeshBuilder.CreateBox(`miLabBody_${idx}`, { width: 24, height: 6, depth: 14 }, scene);
    body.position.set(0, 3, 0);
    body.parent = root;
    body.material = wallMat;
    body.isPickable = false;

    const roof = BABYLON.MeshBuilder.CreateBox(`miLabRoof_${idx}`, { width: 26, height: 1.2, depth: 16 }, scene);
    roof.position.set(0, 6.7, 0);
    roof.parent = root;
    roof.material = roofMat;
    roof.isPickable = false;

    const door = BABYLON.MeshBuilder.CreateBox(`miLabDoor_${idx}`, { width: 3, height: 4.2, depth: 0.25 }, scene);
    door.position.set(0, 2.1, 7.13);
    door.parent = root;
    door.material = cyanMat;
    door.isPickable = false;

    for (const sx of [-1, 1]) {
      const antenna = BABYLON.MeshBuilder.CreateCylinder(`miLabAntenna_${idx}_${sx}`, {
        diameter: 0.35,
        height: 8,
        tessellation: 8,
      }, scene);
      antenna.position.set(sx * 8, 11, -4);
      antenna.parent = root;
      antenna.material = cyanMat;
      antenna.isPickable = false;

      const dish = BABYLON.MeshBuilder.CreateTorus(`miLabDish_${idx}_${sx}`, {
        diameter: 2.6,
        thickness: 0.16,
        tessellation: 18,
      }, scene);
      dish.position.set(sx * 8, 15, -4);
      dish.rotation.x = Math.PI / 2.4;
      dish.parent = root;
      dish.material = cyanMat;
      dish.isPickable = false;
    }

    const light = new BABYLON.PointLight(`miLabLight_${idx}`, new BABYLON.Vector3(0, 7, 0), scene);
    light.diffuse = new BABYLON.Color3(0.25, 0.95, 1.0);
    light.intensity = 0.65;
    light.range = 22;
    light.parent = root;
  }

  private buildWatchTower(pos: BABYLON.Vector3, idx: number): void {
    const scene = this.scene;
    const metalMat = this.makeMaterial(`miTowerMetalMat_${idx}`, new BABYLON.Color3(0.28, 0.30, 0.32), new BABYLON.Color3(0.02, 0.04, 0.05));
    const deckMat = this.makeMaterial(`miTowerDeckMat_${idx}`, new BABYLON.Color3(0.38, 0.26, 0.16), new BABYLON.Color3(0.05, 0.03, 0.01));
    const beaconMat = this.makeMaterial(`miTowerBeaconMat_${idx}`, new BABYLON.Color3(0.95, 0.76, 0.28), new BABYLON.Color3(0.9, 0.42, 0.08));

    const root = new BABYLON.TransformNode(`miWatchTower_${idx}`, scene);
    root.parent = this.root;
    root.position.copyFrom(pos);
    root.rotation.y = idx * 0.65;

    for (let i = 0; i < 4; i++) {
      const sx = i < 2 ? -1 : 1;
      const sz = i % 2 === 0 ? -1 : 1;
      const leg = BABYLON.MeshBuilder.CreateCylinder(`miTowerLeg_${idx}_${i}`, {
        diameter: 0.8,
        height: 26,
        tessellation: 6,
      }, scene);
      leg.position.set(sx * 4.2, 13, sz * 4.2);
      leg.rotation.z = sx * 0.08;
      leg.rotation.x = -sz * 0.08;
      leg.parent = root;
      leg.material = metalMat;
      leg.isPickable = false;
    }

    const deck = BABYLON.MeshBuilder.CreateBox(`miTowerDeck_${idx}`, { width: 12, height: 1.4, depth: 12 }, scene);
    deck.position.set(0, 25.5, 0);
    deck.parent = root;
    deck.material = deckMat;
    deck.isPickable = false;

    const cabin = BABYLON.MeshBuilder.CreateBox(`miTowerCabin_${idx}`, { width: 8, height: 5, depth: 8 }, scene);
    cabin.position.set(0, 28.7, 0);
    cabin.parent = root;
    cabin.material = deckMat;
    cabin.isPickable = false;

    const beacon = BABYLON.MeshBuilder.CreateSphere(`miTowerBeacon_${idx}`, { diameter: 2.4, segments: 12 }, scene);
    beacon.position.set(0, 33.4, 0);
    beacon.parent = root;
    beacon.material = beaconMat;
    beacon.isPickable = false;

    const light = new BABYLON.PointLight(`miTowerLight_${idx}`, new BABYLON.Vector3(0, 34, 0), scene);
    light.diffuse = new BABYLON.Color3(1.0, 0.65, 0.20);
    light.intensity = 0.8;
    light.range = 42;
    light.parent = root;
  }

  private buildMothershipWreck(pos: BABYLON.Vector3, idx: number, yaw: number): void {
    const scene = this.scene;
    const hullMat = this.makeMaterial(`miMothershipHullMat_${idx}`, new BABYLON.Color3(0.12, 0.09, 0.18), new BABYLON.Color3(0.04, 0.02, 0.08));
    const glowMat = this.makeMaterial(`miMothershipGlowMat_${idx}`, new BABYLON.Color3(0.90, 0.14, 0.50), new BABYLON.Color3(0.55, 0.04, 0.22));

    const root = new BABYLON.TransformNode(`miMothershipWreck_${idx}`, scene);
    root.parent = this.root;
    root.position.copyFrom(pos);
    root.rotation.set(0.12, yaw, -0.18);

    const hull = BABYLON.MeshBuilder.CreateCylinder(`miMothershipHull_${idx}`, {
      diameter: 48,
      height: 10,
      tessellation: 18,
    }, scene);
    hull.scaling.z = 1.7;
    hull.rotation.x = Math.PI / 2;
    hull.position.y = 8;
    hull.parent = root;
    hull.material = hullMat;
    hull.isPickable = false;

    const spine = BABYLON.MeshBuilder.CreateBox(`miMothershipSpine_${idx}`, { width: 9, height: 9, depth: 72 }, scene);
    spine.position.y = 10;
    spine.parent = root;
    spine.material = hullMat;
    spine.isPickable = false;

    for (let i = 0; i < 6; i++) {
      const node = BABYLON.MeshBuilder.CreateSphere(`miMothershipNode_${idx}_${i}`, { diameter: 3.8, segments: 10 }, scene);
      node.position.set((i - 2.5) * 7.2, 11.5, (i % 2 === 0 ? -1 : 1) * 18);
      node.parent = root;
      node.material = glowMat;
      node.isPickable = false;
    }
  }

  private spawnWildsDangerLayer(): void {
    const enemy = this.handles.enemy;
    if (enemy) {
      const encounters: Array<[EnemyType, number, number]> = [
        ["wilds_titan", -0.40, -0.07],
        ["wilds_transformer", -0.32, 0.24],
        ["titan", -0.23, -0.26],
        ["captain", -0.12, 0.35],
        ["tank", 0.10, -0.38],
        ["wilds_transformer", 0.25, 0.26],
        ["heavy", 0.31, -0.12],
        ["hybrid", 0.39, 0.28],
        ["wilds_titan", 0.39, -0.31],
        ["commander", 0.47, 0.08],
      ];
      for (const [type, fx, fz] of encounters) {
        const pos = this.sampleTerrainFraction(fx, fz, type.startsWith("wilds_") ? 3.2 : 1.6);
        try {
          const unit = enemy.spawnEnemyAt(type, pos);
          if (unit) {
            unit.keepAirborneY = pos.y;
            this.spawnedEnemyUnits.push(unit);
          }
        } catch (err) {
          console.warn("[MichiganTerrainSystem] failed to spawn MI enemy", type, err);
        }
      }
    }

    const aerial = this.handles.aerial;
    if (aerial) {
      const anchors = [
        this.sampleTerrainFraction(-0.16, -0.48, 0),
        this.sampleTerrainFraction(0.43, 0.06, 0),
        this.sampleTerrainFraction(0.16, 0.36, 0),
      ];
      for (const anchor of anchors) {
        try {
          const fort = aerial.spawnFortress(anchor);
          if (fort) {
            fort.patrolCenter = new BABYLON.Vector3(anchor.x, 76, anchor.z);
            this.spawnedAerialUnits.push(fort);
          }
          const ship = aerial.spawnBattleship(anchor);
          if (ship) {
            ship.patrolCenter = new BABYLON.Vector3(anchor.x, 58, anchor.z);
            this.spawnedAerialUnits.push(ship);
          }
          const fighter = aerial.spawnFighter(anchor);
          if (fighter) {
            fighter.patrolCenter = new BABYLON.Vector3(anchor.x, 34, anchor.z);
            this.spawnedAerialUnits.push(fighter);
          }
        } catch (err) {
          console.warn("[MichiganTerrainSystem] failed to seed MI aerial patrol", err);
        }
      }
    }

    this.bus.emit(
      GameEvents.UI_MESSAGE,
      "MI WILDS THREAT LAYER: giant walkers, rogue labs, rescue cages, and mothership patrols detected.",
    );
  }

  private tick(): void {
    if (this.disposed) return;
    const dt = this.scene.getEngine().getDeltaTime() / 1000;
    const player = this.handles.playerPos?.();
    const inventory = this.handles.inventory;

    for (const bloom of this.powerBlooms) {
      if (bloom.collected || !bloom.mesh.isEnabled()) continue;
      bloom.mesh.rotation.y += dt * 1.8;
      bloom.mesh.position.y = bloom.baseY + Math.sin(performance.now() * 0.003 + bloom.mesh.uniqueId) * 0.18;
      if (!player || !inventory) continue;
      if (BABYLON.Vector3.Distance(player, bloom.mesh.position) > 4.5) continue;

      const def = ITEM_DEFINITIONS[bloom.itemId];
      const leftover = inventory.addItem(def, bloom.quantity);
      const collected = bloom.quantity - leftover;
      if (collected <= 0) {
        this.bus.emit(GameEvents.UI_MESSAGE, "INVENTORY FULL - POWER BLOOM WAITING");
        continue;
      }
      bloom.collected = true;
      bloom.mesh.setEnabled(false);
      this.bus.emit(GameEvents.UI_MESSAGE, `MI WILDS POWER BLOOM: ${collected} ${def.name.toUpperCase()}`);
    }
  }

  private makeMaterial(name: string, diffuse: BABYLON.Color3, emissive: BABYLON.Color3): BABYLON.StandardMaterial {
    const mat = new BABYLON.StandardMaterial(name, this.scene);
    mat.diffuseColor = diffuse;
    mat.emissiveColor = emissive;
    mat.specularColor = new BABYLON.Color3(0.04, 0.04, 0.05);
    this.ownedMaterials.push(mat);
    return mat;
  }

  private createFallbackMixTexture(): BABYLON.DynamicTexture {
    const size = 256;
    const texture = new BABYLON.DynamicTexture("miTerrainFallbackMix", { width: size, height: size }, this.scene, false);
    const ctx = texture.getContext();
    const image = new ImageData(size, size);
    for (let y = 0; y < size; y++) {
      const t = 1 - y / (size - 1);
      const worldHeight = MichiganTerrainSystem.MIN_HEIGHT +
        t * (MichiganTerrainSystem.MAX_HEIGHT - MichiganTerrainSystem.MIN_HEIGHT);
      for (let x = 0; x < size; x++) {
        this.writeTierMixPixel(image.data, (y * size + x) * 4, worldHeight);
      }
    }
    ctx.putImageData(image, 0, 0);
    texture.update(false);
    this.configureMixTexture(texture);
    this.ownedTextures.push(texture);
    return texture;
  }

  private createNoiseTexture(
    name: string,
    base: BABYLON.Color3,
    accent: BABYLON.Color3,
    tiling: number,
    seed: number,
  ): BABYLON.DynamicTexture {
    const size = 256;
    const texture = new BABYLON.DynamicTexture(name, { width: size, height: size }, this.scene, false);
    const ctx = texture.getContext();
    const image = new ImageData(size, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const coarse = MichiganTerrainSystem.noise2(Math.floor(x / 8), Math.floor(y / 8), seed);
        const fine = MichiganTerrainSystem.noise2(x, y, seed + 91);
        const amount = BABYLON.Scalar.Clamp(coarse * 0.65 + fine * 0.35, 0, 1);
        const idx = (y * size + x) * 4;
        image.data[idx] = MichiganTerrainSystem.colorByte(BABYLON.Scalar.Lerp(base.r, accent.r, amount));
        image.data[idx + 1] = MichiganTerrainSystem.colorByte(BABYLON.Scalar.Lerp(base.g, accent.g, amount));
        image.data[idx + 2] = MichiganTerrainSystem.colorByte(BABYLON.Scalar.Lerp(base.b, accent.b, amount));
        image.data[idx + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    texture.update(false);
    this.configureTexture(texture, tiling);
    this.ownedTextures.push(texture);
    return texture;
  }

  private configureTexture(texture: BABYLON.Texture, tiling: number): void {
    texture.uScale = tiling;
    texture.vScale = tiling;
    texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  }

  private configureMixTexture(texture: BABYLON.Texture): void {
    texture.uScale = 1;
    texture.vScale = 1;
    texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  }

  private writeTierMixPixel(data: Uint8ClampedArray, idx: number, worldHeight: number): void {
    const waterToGrass = MichiganTerrainSystem.smoothstep(
      MichiganTerrainSystem.SEA_LEVEL - 3,
      MichiganTerrainSystem.SEA_LEVEL + 5,
      worldHeight,
    );
    const rock = MichiganTerrainSystem.smoothstep(
      MichiganTerrainSystem.ROCK_START,
      MichiganTerrainSystem.ROCK_FULL,
      worldHeight,
    );
    const water = 1 - waterToGrass;
    const grass = Math.max(0, 1 - water - rock);
    const total = Math.max(0.0001, water + grass + rock);

    data[idx] = Math.round((water / total) * 255);
    data[idx + 1] = Math.round((grass / total) * 255);
    data[idx + 2] = Math.round((rock / total) * 255);
    data[idx + 3] = 255;
  }

  private heightLuminance(r: number, g: number, b: number): number {
    const f = MichiganTerrainSystem.HEIGHT_COLOR_FILTER;
    return BABYLON.Scalar.Clamp((r * f.r + g * f.g + b * f.b) / 255, 0, 1);
  }

  private hideOuterWorld(): void {
    if (this.handles.city) {
      try {
        this.handles.city.setVisible(false);
        this.cityHidden = true;
      } catch {}
    }
    for (const w of this.handles.worldVisibles ?? []) {
      if (!w) continue;
      try {
        w.setVisible(false);
        this.hiddenVisibles.push(w);
      } catch {}
    }
  }

  private restoreOuterWorld(): void {
    if (this.cityHidden) {
      try { this.handles.city?.setVisible(true); } catch {}
      this.cityHidden = false;
    }
    for (const w of this.hiddenVisibles) {
      try { w.setVisible(true); } catch {}
    }
    this.hiddenVisibles = [];
  }

  private static noise2(x: number, y: number, seed: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
    return n - Math.floor(n);
  }

  private static sampleHeightData(data: HeightData, u: number, v: number): number {
    const px = BABYLON.Scalar.Clamp(u, 0, 1) * (data.width - 1);
    const py = BABYLON.Scalar.Clamp(v, 0, 1) * (data.height - 1);
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = Math.min(data.width - 1, x0 + 1);
    const y1 = Math.min(data.height - 1, y0 + 1);
    const tx = px - x0;
    const ty = py - y0;

    const h00 = data.values[y0 * data.width + x0];
    const h10 = data.values[y0 * data.width + x1];
    const h01 = data.values[y1 * data.width + x0];
    const h11 = data.values[y1 * data.width + x1];
    const hx0 = BABYLON.Scalar.Lerp(h00, h10, tx);
    const hx1 = BABYLON.Scalar.Lerp(h01, h11, tx);
    return BABYLON.Scalar.Lerp(hx0, hx1, ty);
  }

  private static gaussian(x: number, z: number, radius: number): number {
    return Math.exp(-(x * x + z * z) / Math.max(1, radius * radius));
  }

  private static smoothstep(edge0: number, edge1: number, x: number): number {
    const t = BABYLON.Scalar.Clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  private static colorByte(v: number): number {
    return Math.round(BABYLON.Scalar.Clamp(v, 0, 1) * 255);
  }
}
