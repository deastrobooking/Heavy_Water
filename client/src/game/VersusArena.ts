import * as BABYLON from "@babylonjs/core";
import type { WallCollider, FloorPlatform } from "./CityGenerator";

/**
 * VersusArena — compact player-vs-player melee map for the VERSUS game mode.
 *
 * Mounted by Game.tsx when `gameMode === "versus"` INSTEAD of the full
 * 1200×1200 open-world city. Designed for super-smooth 8v8 melee fights:
 *
 *   - 320×320 walled square (perimeter forcefield) — small enough that
 *     players find each other in seconds, big enough for jet-pack maneuvers.
 *   - ~28 packed cube buildings of varied heights for parkour cover.
 *   - 4 corner spires with rooftop sightlines.
 *   - Central plaza spawn ring (16 evenly-spaced spawns).
 *   - No enemies, no foliage, no bases — pure PvP.
 *
 * Exposes the same collider/floor/spawn surface the city does so the
 * existing PlayerController/VehicleSystem plumbing works unchanged.
 */
export class VersusArena {
  static readonly ARENA_HALF = 160;          // 320×320 perimeter
  static readonly WALL_HEIGHT = 80;
  static readonly WALL_THICKNESS = 4;

  private scene: BABYLON.Scene;
  private root: BABYLON.TransformNode;
  private wallColliders: WallCollider[] = [];
  private floorPlatforms: FloorPlatform[] = [];
  private spawnPoints: BABYLON.Vector3[] = [];
  private cullables: BABYLON.Mesh[] = [];

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.root = new BABYLON.TransformNode("versusArena", scene);
    this.build();
  }

  private build(): void {
    const HALF = VersusArena.ARENA_HALF;

    // ---- Ground -------------------------------------------------------
    const ground = BABYLON.MeshBuilder.CreateGround(
      "versusGround",
      { width: HALF * 2, height: HALF * 2, subdivisions: 4 },
      this.scene,
    );
    ground.position.y = 0;
    const groundMat = new BABYLON.StandardMaterial("versusGroundMat", this.scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.10, 0.10, 0.16);
    groundMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.10);
    groundMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.04);
    ground.material = groundMat;
    ground.parent = this.root;
    ground.checkCollisions = false;
    // Grid as floor platform so getFloorYAt() returns 0 throughout.
    this.floorPlatforms.push({
      minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF, y: 0,
    });

    // ---- Neon plaza decal (center) ------------------------------------
    const plaza = BABYLON.MeshBuilder.CreateDisc(
      "versusPlaza",
      { radius: 28, tessellation: 48 },
      this.scene,
    );
    plaza.rotation.x = Math.PI / 2;
    plaza.position.y = 0.05;
    plaza.parent = this.root;
    const plazaMat = new BABYLON.StandardMaterial("versusPlazaMat", this.scene);
    plazaMat.emissiveColor = new BABYLON.Color3(0.0, 0.7, 1.0);
    plazaMat.diffuseColor = new BABYLON.Color3(0.0, 0.3, 0.5);
    plazaMat.specularColor = new BABYLON.Color3(0, 0, 0);
    plaza.material = plazaMat;
    plaza.isPickable = false;

    // ---- Perimeter walls (4) — forcefield-style cyan glow -------------
    const wallMat = new BABYLON.StandardMaterial("versusWallMat", this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.05, 0.20, 0.35);
    wallMat.emissiveColor = new BABYLON.Color3(0.0, 0.5, 0.9);
    wallMat.alpha = 0.55;
    wallMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const wt = VersusArena.WALL_THICKNESS;
    const wh = VersusArena.WALL_HEIGHT;
    const walls: Array<[number, number, number, number]> = [
      // [centerX, centerZ, width(X), depth(Z)]
      [0,  HALF + wt / 2, HALF * 2 + wt * 2, wt],   // north
      [0, -HALF - wt / 2, HALF * 2 + wt * 2, wt],   // south
      [ HALF + wt / 2, 0, wt, HALF * 2],            // east
      [-HALF - wt / 2, 0, wt, HALF * 2],            // west
    ];
    for (const [cx, cz, w, d] of walls) {
      const wall = BABYLON.MeshBuilder.CreateBox(
        "versusWall",
        { width: w, height: wh, depth: d },
        this.scene,
      );
      wall.position.set(cx, wh / 2, cz);
      wall.material = wallMat;
      wall.parent = this.root;
      wall.isPickable = false;
      this.wallColliders.push({
        minX: cx - w / 2, maxX: cx + w / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
        minY: 0, maxY: wh,
      });
    }

    // ---- Packed buildings (parkour cover) -----------------------------
    // Deterministic layout via index-seeded random so every join sees the
    // same arena.
    // NOTE: the cell-shading post-FX uses depth + normal Sobel + a final
    // `mix(baseColor, outlineColor, edge)`. If the building diffuse is too
    // close to black the ink line lands on near-black pixels and disappears
    // visually. We brighten diffuse + emissive so every box gets a clearly
    // legible silhouette.
    const buildingMat = new BABYLON.StandardMaterial("versusBuildingMat", this.scene);
    buildingMat.diffuseColor = new BABYLON.Color3(0.45, 0.50, 0.62);
    buildingMat.emissiveColor = new BABYLON.Color3(0.10, 0.12, 0.18);
    buildingMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.25);

    const buildingMatGlow = new BABYLON.StandardMaterial("versusBuildingMatGlow", this.scene);
    buildingMatGlow.diffuseColor = new BABYLON.Color3(0.55, 0.30, 0.70);
    buildingMatGlow.emissiveColor = new BABYLON.Color3(0.70, 0.20, 0.65);
    buildingMatGlow.specularColor = new BABYLON.Color3(0.10, 0.05, 0.15);

    const seeded = (i: number) => {
      const x = Math.sin(i * 73.219 + 11.31) * 43758.5453;
      return x - Math.floor(x);
    };

    // Grid-ish layout with jitter — keep a 40-unit ring around the center
    // free for the spawn plaza.
    const cells: Array<[number, number]> = [];
    const stride = 38;
    for (let gx = -3; gx <= 3; gx++) {
      for (let gz = -3; gz <= 3; gz++) {
        if (Math.abs(gx) <= 1 && Math.abs(gz) <= 1) continue; // keep plaza clear
        cells.push([gx * stride, gz * stride]);
      }
    }

    let bIdx = 0;
    for (const [cx, cz] of cells) {
      const r1 = seeded(bIdx);
      const r2 = seeded(bIdx + 7);
      const r3 = seeded(bIdx + 13);
      bIdx++;
      const w = 10 + r1 * 14;
      const d = 10 + r2 * 14;
      const h = 8 + r3 * 28;
      const jx = (seeded(bIdx + 91) - 0.5) * 8;
      const jz = (seeded(bIdx + 137) - 0.5) * 8;
      const px = cx + jx;
      const pz = cz + jz;

      const box = BABYLON.MeshBuilder.CreateBox(
        "versusBld",
        { width: w, height: h, depth: d },
        this.scene,
      );
      box.position.set(px, h / 2, pz);
      box.material = r3 > 0.78 ? buildingMatGlow : buildingMat;
      box.parent = this.root;
      this.cullables.push(box);
      this.wallColliders.push({
        minX: px - w / 2, maxX: px + w / 2,
        minZ: pz - d / 2, maxZ: pz + d / 2,
        minY: 0, maxY: h,
      });
      // Roof as a stand-on platform.
      this.floorPlatforms.push({
        minX: px - w / 2, maxX: px + w / 2,
        minZ: pz - d / 2, maxZ: pz + d / 2,
        y: h,
      });
    }

    // ---- Corner spires ------------------------------------------------
    const spireMat = new BABYLON.StandardMaterial("versusSpireMat", this.scene);
    spireMat.diffuseColor = new BABYLON.Color3(0.55, 0.20, 0.50);
    spireMat.emissiveColor = new BABYLON.Color3(0.75, 0.15, 0.60);
    spireMat.specularColor = new BABYLON.Color3(0.10, 0.05, 0.10);
    const corners: Array<[number, number]> = [
      [-HALF + 22, -HALF + 22],
      [ HALF - 22, -HALF + 22],
      [-HALF + 22,  HALF - 22],
      [ HALF - 22,  HALF - 22],
    ];
    for (const [cx, cz] of corners) {
      const sh = 60;
      const sw = 14;
      const spire = BABYLON.MeshBuilder.CreateBox(
        "versusSpire",
        { width: sw, height: sh, depth: sw },
        this.scene,
      );
      spire.position.set(cx, sh / 2, cz);
      spire.material = spireMat;
      spire.parent = this.root;
      this.cullables.push(spire);
      this.wallColliders.push({
        minX: cx - sw / 2, maxX: cx + sw / 2,
        minZ: cz - sw / 2, maxZ: cz + sw / 2,
        minY: 0, maxY: sh,
      });
      this.floorPlatforms.push({
        minX: cx - sw / 2, maxX: cx + sw / 2,
        minZ: cz - sw / 2, maxZ: cz + sw / 2,
        y: sh,
      });
    }

    // ---- 16 evenly-spaced spawn points around the plaza ---------------
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = 22;
      this.spawnPoints.push(new BABYLON.Vector3(
        Math.cos(a) * r,
        2,
        Math.sin(a) * r,
      ));
    }

    // ---- Soft top-down arena light ------------------------------------
    const arenaLight = new BABYLON.HemisphericLight(
      "versusArenaLight",
      new BABYLON.Vector3(0, 1, 0),
      this.scene,
    );
    arenaLight.intensity = 0.55;
    arenaLight.diffuse = new BABYLON.Color3(0.7, 0.85, 1.0);
    arenaLight.groundColor = new BABYLON.Color3(0.15, 0.10, 0.30);
    arenaLight.parent = this.root;
  }

  /** Return a spawn point selected by player slot (0–15). Wraps modulo. */
  getSpawnPoint(slot: number): BABYLON.Vector3 {
    return this.spawnPoints[slot % this.spawnPoints.length].clone();
  }

  getRandomSpawn(): BABYLON.Vector3 {
    const i = Math.floor(Math.random() * this.spawnPoints.length);
    return this.spawnPoints[i].clone();
  }

  getWallColliders(): WallCollider[] { return this.wallColliders; }
  getFloorPlatforms(): FloorPlatform[] { return this.floorPlatforms; }
  getCullables(): BABYLON.Mesh[] { return this.cullables; }

  setVisible(visible: boolean): void {
    this.root.setEnabled(visible);
  }

  dispose(): void {
    this.root.dispose(false, true);
    this.wallColliders = [];
    this.floorPlatforms = [];
    this.spawnPoints = [];
    this.cullables = [];
  }
}
