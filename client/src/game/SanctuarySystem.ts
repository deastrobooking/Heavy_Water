import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { FriendlyNPCSystem } from "./FriendlyNPCSystem";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";
import type { BaseSystem } from "./BaseSystem";
import type { CityGenerator } from "./CityGenerator";

/** Optional handles SanctuarySystem hides on mount + restores on dispose so
 *  Level 4 reads as a *truly distinct* world (rolling green plains village)
 *  rather than a corner of Detroit with cottages dropped on top. Mirrors
 *  the same "worldVisibles" pattern SpaceLevelSystem uses for the orbital
 *  zone — both levels share the city + mountain + foliage + props bag. */
export interface SanctuaryHandles {
  city?: CityGenerator | null;
  worldVisibles?: Array<{ setVisible(visible: boolean): void } | null | undefined>;
}

/**
 * SanctuarySystem
 * ===============
 * Owns the entire Ashur Sanctuary side-zone (Level 4):
 *
 *   - A wooden welcome signpost at the spawn-point.
 *   - 5 farmable plots (FarmingSystem, internal class below).
 *   - 3 sanctuary NPCs (Theta, Sergio, Ion-flavoured) wired through
 *     FriendlyNPCSystem. They give flavor/quest dialogue tied to Heavy
 *     Water lore (Cynthia You, Sergio Wolfrim, Mechanoid healing).
 *
 * Mounted by Game.tsx when LEVEL_STARTED fires for level 4 with
 * `peaceful: true`, disposed when the player fast-travels back. The
 * mount is idempotent — re-entering the sanctuary doesn't clone meshes.
 *
 * It deliberately re-uses the existing FriendlyNPCSystem rather than
 * inventing a new dialogue layer; sanctuary NPCs feel identical to the
 * city NPCs the player has already met, just clustered in the sanctuary.
 */

export class SanctuarySystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.Camera;
  private bus: EventBus;
  private inventory: InventorySystem;
  private playerPos: () => BABYLON.Vector3;

  /** Top-level transform — disposing this kills every mesh we spawned. */
  private root: BABYLON.TransformNode;
  private npcs: FriendlyNPCSystem | null = null;
  private farming: FarmingSystem | null = null;
  private base: BaseSystem | null = null;
  /** Position where the synthetic garden plinth was registered with the
   *  BaseSystem — kept so dispose() can remove it on fast-travel out. */
  private gardenPlinthPos: BABYLON.Vector3 | null = null;
  /** Bag of world systems hidden on mount; restored on dispose. */
  private handles: SanctuaryHandles;
  private hiddenVisibles: Array<{ setVisible(v: boolean): void }> = [];
  private cityHidden: boolean = false;

  /** Sanctuary footprint center (matches LevelSystem.spawnPoint for L4). */
  private static readonly CENTER = new BABYLON.Vector3(-480, 0, -480);

  constructor(
    scene: BABYLON.Scene,
    camera: BABYLON.Camera,
    inventory: InventorySystem,
    playerPosProvider: () => BABYLON.Vector3,
    inputBlockedProvider: () => boolean,
    baseSystem?: BaseSystem,
    handles: SanctuaryHandles = {},
  ) {
    this.scene = scene;
    this.camera = camera;
    this.bus = EventBus.getInstance();
    this.inventory = inventory;
    this.playerPos = playerPosProvider;
    this.base = baseSystem ?? null;
    this.handles = handles;

    this.root = new BABYLON.TransformNode("sanctuaryRoot", scene);

    // Build OUR ground first, then hide the city + mountains + foliage so
    // Level 4 reads as a self-contained green-plains village instead of a
    // corner of Detroit. Order matters: the player's ray-down still needs
    // SOMETHING to land on once the city ground is hidden, and the
    // PlayerController already falls back to its analytical groundY=1
    // floor — but the grass plane gives a clean visual surface.
    this.buildGrassPlains();
    this.hideOuterWorld();
    this.buildSign();
    this.buildPerimeter();
    this.buildVillage();
    this.spawnNPCs(inputBlockedProvider);
    if (this.base) this.buildGardenPlinth(this.base);
    this.farming = new FarmingSystem(
      scene,
      camera,
      inventory,
      playerPosProvider,
      inputBlockedProvider,
      this.root,
    );

    // Starter kit — first time entering the sanctuary the player gets 5
    // bio_seeds so the farming loop is immediately approachable. Subsequent
    // entries do nothing (we check current count to avoid spamming gifts).
    if (this.inventory.getItemCount("bio_seed") < 1) {
      this.inventory.addItem(ITEM_DEFINITIONS.bio_seed, 5);
      this.bus.emit(
        GameEvents.UI_MESSAGE,
        "ASHUR SANCTUARY: 5 Bio Seeds added — plant them at any farm plot.",
      );
    } else {
      this.bus.emit(GameEvents.UI_MESSAGE, "Welcome back to Ashur Sanctuary.");
    }
  }

  /** Nothing per-frame — FriendlyNPCSystem and FarmingSystem run their own
   *  observers. SanctuarySystem is a coordinator. */
  dispose(): void {
    if (this.npcs) {
      try { this.npcs.dispose(); } catch {}
      this.npcs = null;
    }
    if (this.farming) {
      try { this.farming.dispose(); } catch {}
      this.farming = null;
    }
    // Tear down the synthetic garden so it doesn't linger in BaseSystem's
    // structure list after the player warps out of the sanctuary.
    if (this.base && this.gardenPlinthPos) {
      try { this.base.removeStructureAt(this.gardenPlinthPos, 1.5); } catch {}
      this.gardenPlinthPos = null;
    }
    // Restore the outer world (city, mountains, foliage, props) we hid
    // when this level mounted. Done BEFORE root.dispose so any mistake
    // here doesn't strand the player on a black void if dispose throws.
    this.restoreOuterWorld();
    try { this.root.dispose(); } catch {}
  }

  // -------------------------------------------------------- world swap

  /** Hide everything outside the sanctuary so Level 4 is its own world.
   *  Mirrors `SpaceLevelSystem.hideWorldGeometry` — same handles bag,
   *  same null-checks, same restore-on-dispose contract. */
  private hideOuterWorld(): void {
    if (this.handles.city) {
      try {
        this.handles.city.setVisible(false);
        // Only mark hidden AFTER setVisible(false) actually returned, so a
        // throw upstream doesn't leave us trying to restore a city we
        // never successfully hid (which could double-toggle visibility on
        // warp-out).
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

  /** Build a large green-grass disc centred on the sanctuary so the player
   *  visually stands on rolling plains rather than the city's hidden
   *  ground. 1500 m diameter is wider than the camera's far-cull at this
   *  altitude, so the player never sees a hard edge — even when wandering
   *  outside the perimeter ring to look at the surrounding sky. */
  private buildGrassPlains(): void {
    const c = SanctuarySystem.CENTER;
    const ground = BABYLON.MeshBuilder.CreateGround(
      "sanctuaryGrass",
      { width: 1500, height: 1500, subdivisions: 1 },
      this.scene,
    );
    ground.position.set(c.x, 0.02, c.z);
    ground.parent = this.root;
    ground.isPickable = false;
    ground.receiveShadows = false;
    const mat = new BABYLON.StandardMaterial("sanctuaryGrassMat", this.scene);
    // Warm-meadow green: lifted from a reference frontier-village palette
    // so it reads "cozy farm" rather than "alien biome".
    mat.diffuseColor = new BABYLON.Color3(0.34, 0.58, 0.28);
    mat.emissiveColor = new BABYLON.Color3(0.05, 0.10, 0.04);
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material = mat;
  }

  // -------------------------------------------------------------- visuals

  /** A weathered wooden welcome sign at the entrance to the sanctuary. */
  private buildSign(): void {
    const c = SanctuarySystem.CENTER;

    const post = BABYLON.MeshBuilder.CreateBox(
      "sanctuarySignPost",
      { width: 0.3, height: 3.0, depth: 0.3 },
      this.scene,
    );
    post.position.set(c.x + 6, 1.5, c.z);
    post.parent = this.root;
    const woodMat = new BABYLON.StandardMaterial("sanctuaryWoodMat", this.scene);
    woodMat.diffuseColor = new BABYLON.Color3(0.45, 0.28, 0.15);
    woodMat.specularColor = new BABYLON.Color3(0, 0, 0);
    post.material = woodMat;

    const board = BABYLON.MeshBuilder.CreateBox(
      "sanctuarySignBoard",
      { width: 4.5, height: 1.4, depth: 0.18 },
      this.scene,
    );
    board.position.set(c.x + 6, 2.6, c.z);
    board.parent = this.root;
    const boardMat = new BABYLON.StandardMaterial("sanctuaryBoardMat", this.scene);
    boardMat.diffuseColor = new BABYLON.Color3(0.78, 0.6, 0.35);
    boardMat.emissiveColor = new BABYLON.Color3(0.18, 0.12, 0.05);
    boardMat.specularColor = new BABYLON.Color3(0, 0, 0);
    board.material = boardMat;

    // A glowing painted text glyph — DynamicTexture so we don't need an asset.
    const tex = new BABYLON.DynamicTexture(
      "sanctuarySignTex",
      { width: 512, height: 160 },
      this.scene,
      false,
    );
    tex.drawText("ASHUR  SANCTUARY", null, 100, "bold 56px Arial", "#1a0e04", "#d6a96b", true);
    tex.drawText("a quiet place to heal", null, 145, "italic 28px Arial", "#3a2410", null as any, true);
    boardMat.emissiveTexture = tex;
    boardMat.diffuseTexture = tex;
  }

  /** Faintly-glowing fence-line ring around the sanctuary footprint so the
   *  player can read the boundary at a glance. Thin, decorative, not a
   *  collider — building/exploration both pass through it. */
  private buildPerimeter(): void {
    const c = SanctuarySystem.CENTER;
    const r = 32;
    const segs = 64;
    const points: BABYLON.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      points.push(new BABYLON.Vector3(c.x + Math.cos(t) * r, 0.05, c.z + Math.sin(t) * r));
    }
    const ring = BABYLON.MeshBuilder.CreateLines("sanctuaryRing", { points }, this.scene);
    ring.color = new BABYLON.Color3(1.0, 0.85, 0.4);
    ring.parent = this.root;
    ring.isPickable = false;
  }

  /** Spawn the sanctuary cast through a dedicated FriendlyNPCSystem so they
   *  feel native to the existing dialogue UI but live entirely under the
   *  sanctuary's lifecycle (disposed on fast-travel out). */
  private spawnNPCs(inputBlocked: () => boolean): void {
    const c = SanctuarySystem.CENTER;
    const npcs = new FriendlyNPCSystem(this.scene, this.camera);
    npcs.setPlayerPositionProvider(this.playerPos);
    npcs.setInputBlockedProvider(inputBlocked);

    // Manually inject our cast — FriendlyNPCSystem.spawnDefaults() places
    // the city introducers, which we don't want here. We call the public
    // spawnNPC by going through the system's own `spawnDefaults` shape.
    // Easiest path: assign three custom defs via the public API by
    // monkey-patching the cast. The system exposes only spawnDefaults, so
    // we add a private convention: write our cast with positions in the
    // sanctuary frame and call its spawnDefaults equivalent inline.
    //
    // (FriendlyNPCSystem already supports per-NPC dialogue + colour kits.
    //  We mimic its loop here.)
    const cast = [
      {
        id: "sanctuary_theta",
        position: new BABYLON.Vector3(c.x - 2, 0, c.z - 6),
        dialogue: {
          name: "THETA",
          lines: [
            "You found the sanctuary. Cynthia would be proud.",
            "Every Animaton we save here is one less weapon for the Swarm.",
            "Plant the bio-seeds on the plots. They grow into food my healing can refine.",
            "Bring me the harvest and I'll teach you to feed the rescued ones.",
          ],
        },
        primary: new BABYLON.Color3(0.55, 0.95, 0.85),
        secondary: new BABYLON.Color3(0.25, 0.6, 0.7),
        hair: new BABYLON.Color3(0.75, 1.0, 0.95),
      },
      {
        id: "sanctuary_sergio",
        position: new BABYLON.Vector3(c.x + 4, 0, c.z + 5),
        dialogue: {
          name: "SERGIO WOLFRIM",
          lines: [
            "Welcome, pilot. Star City sent word you'd be coming.",
            "The wilderness around us is full of escaped Animatons — Char's old experiments.",
            "Use your capture orbs out there. Bring them home. We'll rehabilitate them together.",
            "And don't forget to drop by the Village of Earth — the neighbours always need hands.",
          ],
        },
        primary: new BABYLON.Color3(0.85, 0.7, 0.35),
        secondary: new BABYLON.Color3(0.5, 0.35, 0.2),
        hair: new BABYLON.Color3(0.6, 0.4, 0.25),
      },
      {
        id: "sanctuary_ion",
        position: new BABYLON.Vector3(c.x + 8, 0, c.z - 3),
        dialogue: {
          name: "ION",
          lines: [
            "I was born here, you know. Theta's healing made me.",
            "The more animals we save, the stronger the sanctuary's bond grows.",
            "If you want to build, drop a foundation — the build system works inside the ring.",
            "And if you ever miss the fight, the wilderness keeps escapees coming.",
          ],
        },
        primary: new BABYLON.Color3(0.4, 0.85, 1.0),
        secondary: new BABYLON.Color3(0.7, 0.95, 1.0),
        hair: new BABYLON.Color3(0.85, 0.95, 1.0),
      },
    ];

    // Use the system's public spawnDefaults pathway by overriding its cast
    // through TypeScript's structural-typing escape hatch. FriendlyNPCSystem
    // has spawnDefaults() hard-coded, so we instead re-create our own NPC
    // spawn loop using its public getter pattern. The cleanest approach is
    // simply to call the private spawnNPC for each — TypeScript blocks
    // private access, so we cast.
    const sysAny = npcs as unknown as {
      spawnNPC: (def: any, idx: number) => void;
    };
    cast.forEach((def, i) => sysAny.spawnNPC(def, i));

    this.npcs = npcs;
  }

  /** Cozy farming-village dressing: 4 wooden cottages with peaked roofs,
   *  a central stone well, 4 lantern posts with point lights, a fence
   *  around the farm, hay bales, and scattered conifer trees. None of
   *  these are colliders — they're pure decoration to give Level 4 a
   *  radically different "village farming" silhouette from the combat
   *  fronts. Everything parents to `this.root` so dispose cleans up. */
  private buildVillage(): void {
    const c = SanctuarySystem.CENTER;
    const scene = this.scene;

    // ---- shared materials (each parented mesh references one) ----
    const wallMat = new BABYLON.StandardMaterial("villageWallMat", scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.82, 0.66, 0.42);
    wallMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const roofMat = new BABYLON.StandardMaterial("villageRoofMat", scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.45, 0.18, 0.14);
    roofMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const beamMat = new BABYLON.StandardMaterial("villageBeamMat", scene);
    beamMat.diffuseColor = new BABYLON.Color3(0.30, 0.20, 0.12);
    beamMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const stoneMat = new BABYLON.StandardMaterial("villageStoneMat", scene);
    stoneMat.diffuseColor = new BABYLON.Color3(0.62, 0.60, 0.55);
    stoneMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

    const leafMat = new BABYLON.StandardMaterial("villageLeafMat", scene);
    leafMat.diffuseColor = new BABYLON.Color3(0.18, 0.55, 0.25);
    leafMat.emissiveColor = new BABYLON.Color3(0.04, 0.12, 0.06);
    leafMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const trunkMat = new BABYLON.StandardMaterial("villageTrunkMat", scene);
    trunkMat.diffuseColor = new BABYLON.Color3(0.32, 0.20, 0.10);
    trunkMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const lanternMat = new BABYLON.StandardMaterial("villageLanternMat", scene);
    lanternMat.diffuseColor = new BABYLON.Color3(1.0, 0.75, 0.35);
    lanternMat.emissiveColor = new BABYLON.Color3(1.0, 0.7, 0.25);
    lanternMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const hayMat = new BABYLON.StandardMaterial("villageHayMat", scene);
    hayMat.diffuseColor = new BABYLON.Color3(0.92, 0.78, 0.32);
    hayMat.specularColor = new BABYLON.Color3(0, 0, 0);

    // ---- helper: build one cottage at (x,z) with a yaw rotation ----
    const buildCottage = (x: number, z: number, yaw: number, idx: number) => {
      const W = 6, D = 5, H = 3;
      const wall = BABYLON.MeshBuilder.CreateBox(`cottageWall_${idx}`,
        { width: W, height: H, depth: D }, scene);
      wall.position.set(x, H / 2, z);
      wall.rotation.y = yaw;
      wall.parent = this.root;
      wall.material = wallMat;
      wall.isPickable = false;

      // Peaked roof — a thin box rotated 45° on Z, scaled long.
      const roof = BABYLON.MeshBuilder.CreateCylinder(`cottageRoof_${idx}`, {
        diameter: 0,
        diameterTop: W * 1.15,
        diameterBottom: 0.1,
        height: D * 1.05,
        tessellation: 4,
      }, scene);
      // Cylinder w/ tessellation 4 is a square prism; lay it on its side
      // so the "peak" runs along the cottage's depth axis.
      roof.rotation.x = Math.PI / 2;
      roof.rotation.y = yaw;
      roof.position.set(x, H + 0.6, z);
      roof.parent = this.root;
      roof.material = roofMat;
      roof.isPickable = false;

      // Door beam — dark plank centered on the front face.
      const door = BABYLON.MeshBuilder.CreateBox(`cottageDoor_${idx}`,
        { width: 1.2, height: 2.0, depth: 0.15 }, scene);
      const fwd = new BABYLON.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).scale(D / 2 + 0.08);
      door.position.set(x + fwd.x, 1.0, z + fwd.z);
      door.rotation.y = yaw;
      door.parent = this.root;
      door.material = beamMat;
      door.isPickable = false;

      // Two warm windows that read at night/dawn.
      const winMat = new BABYLON.StandardMaterial(`cottageWinMat_${idx}`, scene);
      winMat.diffuseColor = new BABYLON.Color3(1.0, 0.85, 0.4);
      winMat.emissiveColor = new BABYLON.Color3(1.0, 0.75, 0.3);
      winMat.specularColor = new BABYLON.Color3(0, 0, 0);
      const right = new BABYLON.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      for (const sgn of [-1, 1]) {
        const win = BABYLON.MeshBuilder.CreateBox(`cottageWin_${idx}_${sgn}`,
          { width: 0.9, height: 0.9, depth: 0.12 }, scene);
        const off = right.scale(sgn * (W / 2 - 1.2)).add(fwd.scale(1.005));
        win.position.set(x + off.x, 1.6, z + off.z);
        win.rotation.y = yaw;
        win.parent = this.root;
        win.material = winMat;
        win.isPickable = false;
      }
    };

    // Four cottages around the sanctuary plaza, doors facing the plinth.
    // West cottage faces east, east cottage faces west, two north cottages
    // face south back toward the central well + farm.
    buildCottage(c.x - 20, c.z + 2,  Math.PI / 2,  0);
    buildCottage(c.x + 18, c.z + 2, -Math.PI / 2, 1);
    buildCottage(c.x + 4,  c.z - 18, Math.PI,     2);
    buildCottage(c.x - 12, c.z - 16, Math.PI,     3);

    // ---- central stone well, between plinth and sign ----
    const wellBase = BABYLON.MeshBuilder.CreateCylinder("villageWellBase",
      { diameter: 2.6, height: 1.2, tessellation: 18 }, scene);
    wellBase.position.set(c.x, 0.6, c.z + 4);
    wellBase.parent = this.root;
    wellBase.material = stoneMat;
    wellBase.isPickable = false;

    const wellInner = BABYLON.MeshBuilder.CreateCylinder("villageWellInner",
      { diameter: 1.6, height: 1.0, tessellation: 18 }, scene);
    wellInner.position.set(c.x, 0.7, c.z + 4);
    wellInner.parent = this.root;
    const waterMat = new BABYLON.StandardMaterial("villageWaterMat", scene);
    waterMat.diffuseColor = new BABYLON.Color3(0.10, 0.30, 0.50);
    waterMat.emissiveColor = new BABYLON.Color3(0.05, 0.18, 0.30);
    waterMat.specularColor = new BABYLON.Color3(0.4, 0.5, 0.6);
    wellInner.material = waterMat;
    wellInner.isPickable = false;

    // Two posts + a crossbeam over the well.
    for (const sgn of [-1, 1]) {
      const post = BABYLON.MeshBuilder.CreateBox(`villageWellPost_${sgn}`,
        { width: 0.18, height: 2.6, depth: 0.18 }, scene);
      post.position.set(c.x + sgn * 1.3, 1.3, c.z + 4);
      post.parent = this.root;
      post.material = beamMat;
      post.isPickable = false;
    }
    const cross = BABYLON.MeshBuilder.CreateBox("villageWellBeam",
      { width: 3.2, height: 0.18, depth: 0.18 }, scene);
    cross.position.set(c.x, 2.5, c.z + 4);
    cross.parent = this.root;
    cross.material = beamMat;
    cross.isPickable = false;

    // ---- 4 lantern posts ringing the plaza ----
    const lanternSpots = [
      { x: c.x - 10, z: c.z - 4 },
      { x: c.x + 10, z: c.z - 4 },
      { x: c.x - 10, z: c.z + 8 },
      { x: c.x + 10, z: c.z + 8 },
    ];
    lanternSpots.forEach((s, i) => {
      const post = BABYLON.MeshBuilder.CreateBox(`villageLantPost_${i}`,
        { width: 0.18, height: 3.2, depth: 0.18 }, scene);
      post.position.set(s.x, 1.6, s.z);
      post.parent = this.root;
      post.material = beamMat;
      post.isPickable = false;

      const head = BABYLON.MeshBuilder.CreateBox(`villageLantHead_${i}`,
        { width: 0.55, height: 0.55, depth: 0.55 }, scene);
      head.position.set(s.x, 3.1, s.z);
      head.parent = this.root;
      head.material = lanternMat;
      head.isPickable = false;

      const lt = new BABYLON.PointLight(`villageLantLight_${i}`,
        new BABYLON.Vector3(s.x, 3.1, s.z), scene);
      lt.diffuse = new BABYLON.Color3(1.0, 0.75, 0.35);
      lt.intensity = 0.55;
      lt.range = 12;
      lt.parent = this.root;
    });

    // ---- conifer trees scattered around the sanctuary ring ----
    const treeOffsets = [
      [-22, -12], [-26, 6], [-18, 22], [-2, 26], [14, 22],
      [22, 8], [22, -10], [12, -22], [-8, -24], [-24, -24],
    ];
    treeOffsets.forEach(([dx, dz], i) => {
      const trunk = BABYLON.MeshBuilder.CreateCylinder(`villageTrunk_${i}`,
        { diameter: 0.5, height: 1.6, tessellation: 8 }, scene);
      trunk.position.set(c.x + dx, 0.8, c.z + dz);
      trunk.parent = this.root;
      trunk.material = trunkMat;
      trunk.isPickable = false;

      const canopy = BABYLON.MeshBuilder.CreateCylinder(`villageCanopy_${i}`,
        { diameterTop: 0.05, diameterBottom: 2.2, height: 3.6, tessellation: 10 }, scene);
      canopy.position.set(c.x + dx, 3.4, c.z + dz);
      canopy.parent = this.root;
      canopy.material = leafMat;
      canopy.isPickable = false;
    });

    // ---- wooden fence ringing the farm patch (south of sign) ----
    // Farm sits at startX=c.x-8, z=c.z+12, 4 wide × 2 deep with spacing 4.
    // Fence box: x in [c.x-11, c.x+9], z in [c.z+9, c.z+21].
    const fenceX0 = c.x - 11, fenceX1 = c.x + 9;
    const fenceZ0 = c.z + 9,  fenceZ1 = c.z + 21;
    const buildFenceRail = (x0: number, z0: number, x1: number, z1: number, idx: number) => {
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.sqrt(dx * dx + dz * dz);
      const yaw = Math.atan2(dx, dz);
      const rail = BABYLON.MeshBuilder.CreateBox(`villageFence_${idx}`,
        { width: 0.12, height: 0.7, depth: len }, scene);
      rail.position.set((x0 + x1) / 2, 0.45, (z0 + z1) / 2);
      rail.rotation.y = yaw;
      rail.parent = this.root;
      rail.material = beamMat;
      rail.isPickable = false;
    };
    // 4 sides; leave a gap on the north side facing the plinth (player walks in).
    buildFenceRail(fenceX0, fenceZ0, c.x - 4,  fenceZ0, 0); // north-left
    buildFenceRail(c.x + 2,  fenceZ0, fenceX1, fenceZ0, 1); // north-right
    buildFenceRail(fenceX0, fenceZ1, fenceX1, fenceZ1, 2); // south
    buildFenceRail(fenceX0, fenceZ0, fenceX0, fenceZ1, 3); // west
    buildFenceRail(fenceX1, fenceZ0, fenceX1, fenceZ1, 4); // east

    // ---- two hay bales by the fence gate ----
    for (let i = 0; i < 2; i++) {
      const hay = BABYLON.MeshBuilder.CreateCylinder(`villageHay_${i}`,
        { diameter: 1.4, height: 1.4, tessellation: 14 }, scene);
      hay.rotation.x = Math.PI / 2;
      hay.position.set(c.x - 6 + i * 12, 0.7, c.z + 7.5);
      hay.parent = this.root;
      hay.material = hayMat;
      hay.isPickable = false;
    }

    // ---- soft ambient light over the plaza so the village reads warmly
    // even when the time-of-day cycle drifts away from dawn ----
    const plazaLight = new BABYLON.HemisphericLight("villagePlazaLight",
      new BABYLON.Vector3(0, 1, 0), scene);
    plazaLight.diffuse = new BABYLON.Color3(1.0, 0.85, 0.6);
    plazaLight.groundColor = new BABYLON.Color3(0.25, 0.20, 0.12);
    plazaLight.intensity = 0.35;
    plazaLight.includeOnlyWithLayerMask = 0xFFFFFFFF;
    plazaLight.parent = this.root;
  }

  /** Stone pedestal + glowing cyan orb that registers as a synthetic
   *  "garden" structure with BaseSystem. The existing E-key handler in
   *  Game.tsx already calls `BaseSystem.getNearestStructure(pos, "garden", 6)`
   *  and opens the deploy / capture UI when one is found — the plinth lets
   *  sanctuary visitors send up to 3 captured Animatons into battle without
   *  having to build a Garden first. Disposed via removeStructureAt on
   *  warp-out. */
  private buildGardenPlinth(base: BaseSystem): void {
    const c = SanctuarySystem.CENTER;
    const px = c.x - 6;
    const pz = c.z;

    const plinth = BABYLON.MeshBuilder.CreateCylinder(
      "sanctuaryGardenPlinth",
      { diameterTop: 2.0, diameterBottom: 2.6, height: 1.2, tessellation: 16 },
      this.scene,
    );
    plinth.position.set(px, 0.6, pz);
    plinth.parent = this.root;
    plinth.isPickable = false;
    const stoneMat = new BABYLON.StandardMaterial("sanctuaryPlinthMat", this.scene);
    stoneMat.diffuseColor = new BABYLON.Color3(0.55, 0.55, 0.6);
    stoneMat.specularColor = new BABYLON.Color3(0.18, 0.18, 0.22);
    plinth.material = stoneMat;

    const orb = BABYLON.MeshBuilder.CreateSphere(
      "sanctuaryGardenOrb",
      { diameter: 0.9 },
      this.scene,
    );
    orb.position.set(px, 1.7, pz);
    orb.parent = this.root;
    orb.isPickable = false;
    const orbMat = new BABYLON.StandardMaterial("sanctuaryOrbMat", this.scene);
    orbMat.diffuseColor = new BABYLON.Color3(0.10, 0.70, 0.90);
    orbMat.emissiveColor = new BABYLON.Color3(0.30, 0.85, 1.00);
    orbMat.specularColor = new BABYLON.Color3(0, 0, 0);
    orb.material = orbMat;

    // A subtle point light so the plinth reads against the dawn lighting.
    const light = new BABYLON.PointLight(
      "sanctuaryPlinthLight",
      new BABYLON.Vector3(px, 2.0, pz),
      this.scene,
    );
    light.diffuse = new BABYLON.Color3(0.3, 0.85, 1.0);
    light.intensity = 0.6;
    light.range = 8;
    light.parent = this.root;

    const pos = new BABYLON.Vector3(px, 0, pz);
    base.registerStructure("garden", pos);
    this.gardenPlinthPos = pos.clone();
  }
}

// ============================================================================
// FarmingSystem — internal to SanctuarySystem
// ============================================================================

type GrowthStage = 0 | 1 | 2 | 3; // empty / seeded / sprout / grown

interface FarmPlot {
  index: number;
  position: BABYLON.Vector3;
  stage: GrowthStage;
  /** Time (ms) the current stage was entered — drives growth advancement. */
  stageStart: number;
  /** Soil mesh — always visible. */
  soil: BABYLON.Mesh;
  /** Crop mesh — swapped between sprout/grown variants; null when empty. */
  crop: BABYLON.Mesh | null;
}

class FarmingSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.Camera;
  private bus: EventBus;
  private inventory: InventorySystem;
  private playerPos: () => BABYLON.Vector3;
  private inputBlocked: () => boolean;
  private parent: BABYLON.TransformNode;

  private plots: FarmPlot[] = [];
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private prompt: HTMLDivElement;

  /** Time per growth tier — total seed→harvest = 60s, tuned for fun. */
  private static readonly STAGE_MS = 30_000;
  /** How close the player must be to interact (m). */
  private static readonly INTERACT_RANGE = 4.0;

  constructor(
    scene: BABYLON.Scene,
    camera: BABYLON.Camera,
    inventory: InventorySystem,
    playerPosProvider: () => BABYLON.Vector3,
    inputBlockedProvider: () => boolean,
    parent: BABYLON.TransformNode,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.bus = EventBus.getInstance();
    this.inventory = inventory;
    this.playerPos = playerPosProvider;
    this.inputBlocked = inputBlockedProvider;
    this.parent = parent;

    this.prompt = document.createElement("div");
    Object.assign(this.prompt.style, {
      position: "fixed",
      transform: "translate(-50%, -100%)",
      padding: "4px 10px",
      background: "rgba(0,0,0,0.78)",
      border: "1px solid #b3ff7a",
      borderRadius: "4px",
      color: "#b3ff7a",
      fontFamily: "'Press Start 2P', monospace",
      fontSize: "10px",
      letterSpacing: "1px",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      zIndex: "22",
      display: "none",
    } as CSSStyleDeclaration);
    document.body.appendChild(this.prompt);

    this.spawnPlots();

    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());
    this.keyHandler = (e) => {
      if (e.code !== "KeyE") return;
      if (this.inputBlocked()) return;
      const plot = this.findInteractablePlot();
      if (!plot) return;
      this.interact(plot);
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    for (const p of this.plots) {
      try { p.soil.dispose(); } catch {}
      if (p.crop) {
        try { p.crop.dispose(); } catch {}
      }
    }
    this.plots = [];
    try { this.prompt.remove(); } catch {}
  }

  /** Eight plots in two rows of four, fenced to the south of the sign. */
  private spawnPlots(): void {
    const c = SanctuarySystem["CENTER"] as BABYLON.Vector3;
    const startX = c.x - 7.5;
    const startZ = c.z + 12;
    const spacing = 4;
    const cols = 4;
    const rows = 2;

    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const pos = new BABYLON.Vector3(
          startX + col * spacing,
          0,
          startZ + r * spacing,
        );
        const soil = BABYLON.MeshBuilder.CreateBox(
          `farmPlot_${idx}`,
          { width: 3, height: 0.2, depth: 3 },
          this.scene,
        );
        soil.position.set(pos.x, 0.1, pos.z);
        soil.parent = this.parent;
        const mat = new BABYLON.StandardMaterial(`farmPlotMat_${idx}`, this.scene);
        mat.diffuseColor = new BABYLON.Color3(0.32, 0.18, 0.10);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        soil.material = mat;

        this.plots.push({
          index: idx,
          position: pos.clone(),
          stage: 0,
          stageStart: 0,
          soil,
          crop: null,
        });
        idx++;
      }
    }
  }

  /** Closest plot within INTERACT_RANGE, or null. */
  private findInteractablePlot(): FarmPlot | null {
    const p = this.playerPos();
    let nearest: FarmPlot | null = null;
    let nearestDistSq = FarmingSystem.INTERACT_RANGE * FarmingSystem.INTERACT_RANGE;
    for (const plot of this.plots) {
      const dx = plot.position.x - p.x;
      const dz = plot.position.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < nearestDistSq) {
        nearestDistSq = d;
        nearest = plot;
      }
    }
    return nearest;
  }

  /** Advance growth + position the prompt above the closest plot. */
  private tick(): void {
    const now = performance.now();

    // Auto-advance growth: seeded(1) → sprout(2) → grown(3) at fixed intervals.
    for (const plot of this.plots) {
      if (plot.stage === 1 || plot.stage === 2) {
        if (now - plot.stageStart >= FarmingSystem.STAGE_MS) {
          this.setStage(plot, (plot.stage + 1) as GrowthStage);
        }
      }
    }

    // Prompt above the closest interactable plot.
    if (this.inputBlocked()) {
      this.prompt.style.display = "none";
      return;
    }
    const plot = this.findInteractablePlot();
    if (!plot) {
      this.prompt.style.display = "none";
      return;
    }

    const headWorld = new BABYLON.Vector3(plot.position.x, 1.4, plot.position.z);
    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const transform = this.scene.getTransformMatrix();
    const viewport = this.camera.viewport.toGlobal(w, h);
    const screen = BABYLON.Vector3.Project(headWorld, BABYLON.Matrix.Identity(), transform, viewport);
    if (screen.z < 0 || screen.z > 1) {
      this.prompt.style.display = "none";
      return;
    }

    let label = "";
    switch (plot.stage) {
      case 0:
        label = this.inventory.hasItem("bio_seed", 1)
          ? "[E] PLANT BIO SEED"
          : "EMPTY PLOT — need a Bio Seed";
        break;
      case 1: {
        const left = Math.max(0, Math.ceil((FarmingSystem.STAGE_MS - (now - plot.stageStart)) / 1000));
        label = `SEEDED — sprouting in ${left}s`;
        break;
      }
      case 2: {
        const left = Math.max(0, Math.ceil((FarmingSystem.STAGE_MS - (now - plot.stageStart)) / 1000));
        label = `SPROUT — ripens in ${left}s`;
        break;
      }
      case 3:
        label = "[E] HARVEST BIO CROP";
        break;
    }
    this.prompt.textContent = label;
    this.prompt.style.left = `${screen.x}px`;
    this.prompt.style.top = `${screen.y}px`;
    this.prompt.style.display = "block";
  }

  /** Player pressed E with this plot in range. Plant or harvest based on
   *  current stage; mid-growth presses are no-ops with a UI hint. */
  private interact(plot: FarmPlot): void {
    if (plot.stage === 0) {
      if (!this.inventory.hasItem("bio_seed", 1)) {
        this.bus.emit(GameEvents.UI_MESSAGE, "No Bio Seeds. Theta gives 5 on first sanctuary visit.");
        return;
      }
      this.inventory.removeItem("bio_seed", 1);
      this.setStage(plot, 1);
      this.bus.emit(GameEvents.UI_MESSAGE, "Bio seed planted.");
      return;
    }
    if (plot.stage === 3) {
      // Each grown plot yields 2 bio-crops. Harvest resets the plot.
      this.inventory.addItem(ITEM_DEFINITIONS.bio_crop, 2);
      this.setStage(plot, 0);
      this.bus.emit(GameEvents.UI_MESSAGE, "Harvested 2× Bio Crop.");
      return;
    }
    // Stage 1 or 2 — show time remaining via the prompt; nothing to do.
    this.bus.emit(GameEvents.UI_MESSAGE, "The crop is still growing.");
  }

  /** Swap the plot's crop mesh + reset the stage clock. */
  private setStage(plot: FarmPlot, next: GrowthStage): void {
    plot.stage = next;
    plot.stageStart = performance.now();

    // Clear any existing crop mesh.
    if (plot.crop) {
      try { plot.crop.dispose(); } catch {}
      plot.crop = null;
    }

    // Empty stage — nothing to render above the soil.
    if (next === 0) return;

    // Seeded — tiny dark mound. Sprout — short green stalk. Grown — tall
    // glowing bulb that reads from across the sanctuary.
    const sizeByStage: Record<Exclude<GrowthStage, 0>, { d: number; h: number }> = {
      1: { d: 0.5, h: 0.2 },
      2: { d: 0.6, h: 0.9 },
      3: { d: 0.9, h: 1.6 },
    };
    const colorByStage: Record<Exclude<GrowthStage, 0>, BABYLON.Color3> = {
      1: new BABYLON.Color3(0.25, 0.18, 0.08),
      2: new BABYLON.Color3(0.35, 0.85, 0.4),
      3: new BABYLON.Color3(0.7, 1.0, 0.45),
    };
    const { d, h } = sizeByStage[next];

    const crop = next === 1
      ? BABYLON.MeshBuilder.CreateSphere(`farmCrop_${plot.index}`, { diameter: d }, this.scene)
      : BABYLON.MeshBuilder.CreateCylinder(`farmCrop_${plot.index}`, {
          diameterTop: next === 3 ? d * 1.3 : d * 0.4,
          diameterBottom: d * 0.6,
          height: h,
          tessellation: 16,
        }, this.scene);
    crop.position.set(plot.position.x, 0.2 + h / 2, plot.position.z);
    crop.parent = this.parent;
    const mat = new BABYLON.StandardMaterial(`farmCropMat_${plot.index}`, this.scene);
    mat.diffuseColor = colorByStage[next];
    mat.emissiveColor = next === 3
      ? new BABYLON.Color3(0.4, 0.65, 0.25)
      : colorByStage[next].scale(0.25);
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    crop.material = mat;
    plot.crop = crop;
  }
}
