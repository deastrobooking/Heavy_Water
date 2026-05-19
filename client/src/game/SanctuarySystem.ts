import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { FriendlyNPCSystem } from "./FriendlyNPCSystem";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";
import type { BaseSystem } from "./BaseSystem";
import type { CityGenerator } from "./CityGenerator";
import type { AlienFoliageSystem } from "./AlienFoliageSystem";
import type { BioCreatureSystem } from "./BioCreatureSystem";
import type { WeaponsSystem, WeaponType } from "./WeaponsSystem";

/** Optional handles SanctuarySystem hides on mount + restores on dispose so
 *  Level 4 reads as a *truly distinct* world (rolling green plains village)
 *  rather than a corner of Detroit with cottages dropped on top. Mirrors
 *  the same "worldVisibles" pattern SpaceLevelSystem uses for the orbital
 *  zone — both levels share the city + mountain + foliage + props bag.
 *  `foliage` is also passed in directly (not just hidden) so the sanctuary
 *  can densely scatter L-system plants of its own around the village. */
export interface SanctuaryHandles {
  city?: CityGenerator | null;
  worldVisibles?: Array<{ setVisible(visible: boolean): void } | null | undefined>;
  foliage?: AlienFoliageSystem | null;
  /** Live world bio-creature roster. Sanctuary spawns a small huntable
   *  population through it on mount (so the Capture Net actually has
   *  targets) and despawns those exact ids on warp-out. Captured creatures
   *  are persisted by BioCreatureSystem itself and are NOT touched. */
  bio?: BioCreatureSystem | null;
  /** Optional weapons system. When provided, the sanctuary auto-selects
   *  the Capture Net on mount and restores the previously-equipped weapon
   *  on dispose so warping out doesn't leave the player holding a net. */
  weapons?: WeaponsSystem | null;
  /** Optional LOD culler. The sanctuary suppresses it on mount so the
   *  hidden city/platforms can't pop back into view when the player walks
   *  near a previously-culled sector; restored on dispose. */
  lodCull?: { setSuppressed(b: boolean): void } | null;
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
  /** Removes only the alien plants this sanctuary placed (set by
   *  AlienFoliageSystem.scatterZone). null when foliage handle is missing. */
  private foliageDisposer: (() => void) | null = null;
  /** Per-frame creature wander observer — disposed with the sanctuary. */
  private wildlifeObserver: BABYLON.Observer<BABYLON.Scene> | null = null;
  /** Live bio-creature ids spawned by this sanctuary; despawned on
   *  dispose. Kept separate from `wildlife` (which is the cosmetic
   *  parametric herd) so each is torn down through its proper owner. */
  private spawnedBioIds: string[] = [];
  /** Weapon the player held when entering the sanctuary, restored on
   *  warp-out. Null when sanctuary didn't override the weapon (no
   *  WeaponsSystem handle, or the player was already holding the net). */
  private prevWeaponType: WeaponType | null = null;
  /** Wildlife critters; their root meshes are children of `this.root` and
   *  therefore disposed automatically when the sanctuary tears down. The
   *  state lives here so the observer can advance their wander phase. */
  private wildlife: Array<{
    root: BABYLON.TransformNode;
    home: BABYLON.Vector3;
    radius: number;
    speed: number;
    phase: number;
    bobPhase: number;
  }> = [];

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
    // Freeze the LOD culler so it can't re-show the city/platforms we
    // just hid as the player walks within their cull radii. Restored in
    // dispose() so the open world resumes normal LOD behaviour.
    try { this.handles.lodCull?.setSuppressed(true); } catch {}
    this.buildSign();
    this.buildPerimeter();
    this.buildVillage();
    this.buildPetClinic();
    // Wilder additions — mountains ring the valley, an alien cave sits on
    // its eastern edge as an adventure pocket, and dense L-system foliage
    // + wandering bio-critters bring the place to life. Order matters
    // only for visual layering; none of these are colliders.
    this.buildMountainRing();
    this.buildCave();
    this.scatterAlienFoliage();
    this.buildWildlife();
    // Spawn a small huntable population of REAL bio-creatures through the
    // shared BioCreatureSystem so the Capture Net has live targets in
    // range. The cosmetic `wildlife` herd above is decorative-only and
    // never registered with the bio system, which is why pressing H
    // here used to fail with "no creature in range".
    this.spawnHuntableBioCreatures();
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

    // Top up Bio Essence so the Capture Net is immediately usable. Each
    // capture costs 1 Essence; a starter pack of 10 gets the player
    // through several attempts. Re-entries also top up to a floor of 5
    // so a returning player who burned all their essence elsewhere can
    // still use the net here.
    const essenceFloor = 5;
    const haveEssence = this.inventory.getItemCount("bio_essence");
    if (haveEssence < essenceFloor) {
      this.inventory.addItem(ITEM_DEFINITIONS.bio_essence, essenceFloor - haveEssence);
    }

    // Auto-equip the Capture Net so the right trigger / left mouse fires
    // captures while in the sanctuary. Remember the previous weapon so we
    // can restore it on warp-out.
    if (this.handles.weapons) {
      try {
        const cur = this.handles.weapons.getCurrentWeaponType();
        if (cur !== "capture_net") this.prevWeaponType = cur;
        this.handles.weapons.selectWeapon("capture_net");
        this.bus.emit(
          GameEvents.UI_MESSAGE,
          "CAPTURE NET equipped — fire (LMB / RT) to capture nearby creatures.",
        );
      } catch (err) {
        console.warn("[SanctuarySystem] Failed to auto-equip capture net", err);
      }
    }
  }

  /** Nothing per-frame — FriendlyNPCSystem and FarmingSystem run their own
   *  observers. SanctuarySystem is a coordinator. */
  dispose(): void {
    // Outer try/finally guarantees the LOD culler is un-suppressed even if
    // any intermediate teardown step throws — otherwise a mid-dispose
    // exception could leave the open world's distance culling permanently
    // frozen the next time the player warps out.
    try { this._disposeInner(); }
    finally { try { this.handles.lodCull?.setSuppressed(false); } catch {} }
  }

  private _disposeInner(): void {
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
    // Tear down the per-frame wildlife wander loop BEFORE root.dispose
    // so the observer never references disposed transforms.
    if (this.wildlifeObserver) {
      try { this.scene.onBeforeRenderObservable.remove(this.wildlifeObserver); } catch {}
      this.wildlifeObserver = null;
    }
    this.wildlife = [];

    // Despawn any uncaptured sanctuary bio-creatures so they don't linger
    // in the world after the player warps out. Captured creatures are not
    // in `creatures[]` anymore (they migrated to `captured[]`), so
    // despawnCreature is a no-op for them — exactly the behavior we want.
    if (this.handles.bio && this.spawnedBioIds.length) {
      for (const id of this.spawnedBioIds) {
        try { this.handles.bio.despawnCreature(id); } catch {}
      }
    }
    this.spawnedBioIds = [];

    // Restore the player's previously-equipped weapon (best-effort —
    // ignore failures so a missing weapons handle on dispose can't strand
    // the rest of teardown).
    if (this.handles.weapons && this.prevWeaponType) {
      try { this.handles.weapons.selectWeapon(this.prevWeaponType); } catch {}
    }
    this.prevWeaponType = null;
    // Strip the alien plants we appended to the world's AlienFoliageSystem
    // — they live in the shared array, not under our root, so root.dispose
    // wouldn't catch them.
    if (this.foliageDisposer) {
      try { this.foliageDisposer(); } catch {}
      this.foliageDisposer = null;
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

  /** Build a real rolling terrain patch centred on the sanctuary so the
   *  player walks on a shaped valley instead of a flat hidden-city stand-in.
   *  The inner village/farm circle is flattened for readable props while
   *  the outer terrain rolls upward into foothills before the mountain ring. */
  private buildGrassPlains(): void {
    const c = SanctuarySystem.CENTER;
    const ground = BABYLON.MeshBuilder.CreateGround(
      "sanctuaryTerrain",
      { width: 1500, height: 1500, subdivisions: 96, updatable: true },
      this.scene,
    );
    ground.position.set(c.x, -0.08, c.z);
    ground.parent = this.root;
    ground.isPickable = true;
    ground.receiveShadows = true;

    const positions = ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const indices = ground.getIndices();
    if (positions && indices) {
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const z = positions[i + 2];
        const dist = Math.sqrt(x * x + z * z);
        const villageFlatten = BABYLON.Scalar.Clamp((dist - 30) / 95, 0, 1);
        const ripple =
          Math.sin(x * 0.020) * 0.85 +
          Math.cos(z * 0.016) * 0.65 +
          Math.sin((x + z) * 0.011) * 0.50 +
          (SanctuarySystem.noise2(Math.floor(x / 18), Math.floor(z / 18), 91) - 0.5) * 0.55;
        const foothill = SanctuarySystem.smoothstep(230, 690, dist) * 10.5;
        const dip = (1 - SanctuarySystem.smoothstep(0, 150, dist)) * -0.18;
        positions[i + 1] = ripple * villageFlatten + foothill + dip;
      }
      const normals: number[] = [];
      BABYLON.VertexData.ComputeNormals(positions, indices, normals);
      ground.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
      ground.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
      ground.refreshBoundingInfo();
    }

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

    const trimMat = new BABYLON.StandardMaterial("villageTrimMat", scene);
    trimMat.diffuseColor = new BABYLON.Color3(0.92, 0.82, 0.60);
    trimMat.emissiveColor = new BABYLON.Color3(0.08, 0.06, 0.03);
    trimMat.specularColor = new BABYLON.Color3(0, 0, 0);

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

    const bloomMat = new BABYLON.StandardMaterial("villageFlowerMat", scene);
    bloomMat.diffuseColor = new BABYLON.Color3(0.95, 0.35, 0.58);
    bloomMat.emissiveColor = new BABYLON.Color3(0.22, 0.04, 0.10);
    bloomMat.specularColor = new BABYLON.Color3(0, 0, 0);

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

        const box = BABYLON.MeshBuilder.CreateBox(`cottageFlowerBox_${idx}_${sgn}`,
          { width: 1.05, height: 0.22, depth: 0.24 }, scene);
        const boxOff = right.scale(sgn * (W / 2 - 1.2)).add(fwd.scale(1.10));
        box.position.set(x + boxOff.x, 1.02, z + boxOff.z);
        box.rotation.y = yaw;
        box.parent = this.root;
        box.material = beamMat;
        box.isPickable = false;

        for (let b = 0; b < 3; b++) {
          const bloom = BABYLON.MeshBuilder.CreateSphere(`cottageBloom_${idx}_${sgn}_${b}`,
            { diameter: 0.18, segments: 8 }, scene);
          const bloomOff = right.scale(sgn * (W / 2 - 1.2) + (b - 1) * 0.24).add(fwd.scale(1.18));
          bloom.position.set(x + bloomOff.x, 1.18, z + bloomOff.z);
          bloom.parent = this.root;
          bloom.material = bloomMat;
          bloom.isPickable = false;
        }
      }

      const foundation = BABYLON.MeshBuilder.CreateBox(`cottageFoundation_${idx}`,
        { width: W + 0.45, height: 0.35, depth: D + 0.45 }, scene);
      foundation.position.set(x, 0.18, z);
      foundation.rotation.y = yaw;
      foundation.parent = this.root;
      foundation.material = stoneMat;
      foundation.isPickable = false;

      const porch = BABYLON.MeshBuilder.CreateBox(`cottagePorch_${idx}`,
        { width: 2.2, height: 0.22, depth: 1.25 }, scene);
      const porchOff = fwd.scale(1.20);
      porch.position.set(x + porchOff.x, 0.30, z + porchOff.z);
      porch.rotation.y = yaw;
      porch.parent = this.root;
      porch.material = beamMat;
      porch.isPickable = false;

      const awning = BABYLON.MeshBuilder.CreateBox(`cottageAwning_${idx}`,
        { width: 2.4, height: 0.18, depth: 0.95 }, scene);
      const awningOff = fwd.scale(1.15);
      awning.position.set(x + awningOff.x, 2.25, z + awningOff.z);
      awning.rotation.y = yaw;
      awning.rotation.x = -0.18;
      awning.parent = this.root;
      awning.material = roofMat;
      awning.isPickable = false;

      for (const sgn of [-1, 1]) {
        const trim = BABYLON.MeshBuilder.CreateBox(`cottageRoofTrim_${idx}_${sgn}`,
          { width: W * 0.82, height: 0.16, depth: 0.16 }, scene);
        const trimOff = new BABYLON.Vector3(0, 0, 0)
          .add(right.scale(0))
          .add(fwd.scale(sgn * (D / 2 + 0.08)));
        trim.position.set(x + trimOff.x, H + 0.38, z + trimOff.z);
        trim.rotation.y = yaw;
        trim.rotation.z = sgn * 0.52;
        trim.parent = this.root;
        trim.material = trimMat;
        trim.isPickable = false;
      }

      const chimneySide = right.scale((idx % 2 === 0 ? 1 : -1) * (W / 2 - 1.1));
      const chimneyBack = fwd.scale(-0.55);
      const chimney = BABYLON.MeshBuilder.CreateBox(`cottageChimney_${idx}`,
        { width: 0.7, height: 1.7, depth: 0.7 }, scene);
      chimney.position.set(x + chimneySide.x + chimneyBack.x, H + 1.45, z + chimneySide.z + chimneyBack.z);
      chimney.rotation.y = yaw;
      chimney.parent = this.root;
      chimney.material = stoneMat;
      chimney.isPickable = false;
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

  /** Sanctuary pet hospital: a visible mini-game anchor for feeding,
   *  bonding, and recovering captured Animatons. The interaction itself
   *  is still the Garden UI, but the world now shows where care happens. */
  private buildPetClinic(): void {
    const c = SanctuarySystem.CENTER;
    const scene = this.scene;
    const x = c.x + 23;
    const z = c.z - 18;
    const yaw = -0.28;

    const wallMat = new BABYLON.StandardMaterial("clinicWallMat", scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.86, 0.92, 0.90);
    wallMat.emissiveColor = new BABYLON.Color3(0.08, 0.10, 0.10);
    wallMat.specularColor = new BABYLON.Color3(0.1, 0.12, 0.12);

    const roofMat = new BABYLON.StandardMaterial("clinicRoofMat", scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.14, 0.55, 0.62);
    roofMat.emissiveColor = new BABYLON.Color3(0.02, 0.13, 0.16);
    roofMat.specularColor = new BABYLON.Color3(0.05, 0.12, 0.14);

    const glowMat = new BABYLON.StandardMaterial("clinicGlowMat", scene);
    glowMat.diffuseColor = new BABYLON.Color3(0.25, 0.95, 1.0);
    glowMat.emissiveColor = new BABYLON.Color3(0.15, 0.75, 0.95);
    glowMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const bedMat = new BABYLON.StandardMaterial("clinicBedMat", scene);
    bedMat.diffuseColor = new BABYLON.Color3(0.42, 0.70, 0.55);
    bedMat.emissiveColor = new BABYLON.Color3(0.04, 0.12, 0.08);
    bedMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const body = BABYLON.MeshBuilder.CreateBox("sanctuaryPetClinic",
      { width: 9, height: 3.8, depth: 6.4 }, scene);
    body.position.set(x, 1.9, z);
    body.rotation.y = yaw;
    body.parent = this.root;
    body.material = wallMat;
    body.isPickable = false;

    const roof = BABYLON.MeshBuilder.CreateCylinder("sanctuaryClinicRoof", {
      diameter: 0,
      diameterTop: 9.8,
      diameterBottom: 0.1,
      height: 7.2,
      tessellation: 4,
    }, scene);
    roof.rotation.x = Math.PI / 2;
    roof.rotation.y = yaw;
    roof.position.set(x, 4.45, z);
    roof.parent = this.root;
    roof.material = roofMat;
    roof.isPickable = false;

    const fwd = new BABYLON.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new BABYLON.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const door = BABYLON.MeshBuilder.CreateBox("sanctuaryClinicDoor",
      { width: 1.45, height: 2.35, depth: 0.18 }, scene);
    const doorPos = fwd.scale(3.31);
    door.position.set(x + doorPos.x, 1.17, z + doorPos.z);
    door.rotation.y = yaw;
    door.parent = this.root;
    door.material = glowMat;
    door.isPickable = false;

    const signBase = BABYLON.MeshBuilder.CreateBox("sanctuaryClinicSign",
      { width: 2.6, height: 1.25, depth: 0.16 }, scene);
    const signPos = fwd.scale(3.43).add(right.scale(-2.2));
    signBase.position.set(x + signPos.x, 3.0, z + signPos.z);
    signBase.rotation.y = yaw;
    signBase.parent = this.root;
    signBase.material = wallMat;
    signBase.isPickable = false;

    const crossH = BABYLON.MeshBuilder.CreateBox("sanctuaryClinicCrossH",
      { width: 1.55, height: 0.32, depth: 0.20 }, scene);
    crossH.position.copyFrom(signBase.position);
    crossH.position.y += 0.02;
    crossH.rotation.y = yaw;
    crossH.parent = this.root;
    crossH.material = glowMat;
    crossH.isPickable = false;

    const crossV = BABYLON.MeshBuilder.CreateBox("sanctuaryClinicCrossV",
      { width: 0.34, height: 1.05, depth: 0.22 }, scene);
    crossV.position.copyFrom(signBase.position);
    crossV.rotation.y = yaw;
    crossV.parent = this.root;
    crossV.material = glowMat;
    crossV.isPickable = false;

    for (const side of [-1, 1]) {
      const wingPos = fwd.scale(-0.6).add(right.scale(side * 4.15));
      const pod = BABYLON.MeshBuilder.CreateCylinder(`sanctuaryHealPod_${side}`,
        { diameter: 1.15, height: 2.6, tessellation: 18 }, scene);
      pod.position.set(x + wingPos.x, 1.35, z + wingPos.z);
      pod.rotation.z = Math.PI / 2;
      pod.rotation.y = yaw;
      pod.parent = this.root;
      pod.material = glowMat;
      pod.isPickable = false;

      const bedPos = fwd.scale(4.4).add(right.scale(side * 3.3));
      const bed = BABYLON.MeshBuilder.CreateBox(`sanctuaryPetBed_${side}`,
        { width: 2.3, height: 0.35, depth: 1.4 }, scene);
      bed.position.set(x + bedPos.x, 0.28, z + bedPos.z);
      bed.rotation.y = yaw;
      bed.parent = this.root;
      bed.material = bedMat;
      bed.isPickable = false;
    }

    const clinicLight = new BABYLON.PointLight(
      "sanctuaryClinicLight",
      new BABYLON.Vector3(x, 3.3, z),
      scene,
    );
    clinicLight.diffuse = new BABYLON.Color3(0.35, 0.95, 1.0);
    clinicLight.intensity = 0.85;
    clinicLight.range = 16;
    clinicLight.parent = this.root;
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

  // ----------------------------------------------------- mountains / cave

  /** Ring the sanctuary valley with a circle of stylized mountain peaks so
   *  the world reads as a hidden basin instead of an open prairie. Twelve
   *  cones at radius 95 m — well beyond the 32 m perimeter ring — keep the
   *  gameplay area unobstructed while giving the horizon real depth. The
   *  cones use a simple 4-side tessellation so each peak reads angular and
   *  faceted (anime-cell-shaded silhouette). All meshes parent to root. */
  private buildMountainRing(): void {
    const c = SanctuarySystem.CENTER;
    const scene = this.scene;

    const rockMat = new BABYLON.StandardMaterial("sanctuaryMountainMat", scene);
    rockMat.diffuseColor = new BABYLON.Color3(0.32, 0.30, 0.40);
    rockMat.emissiveColor = new BABYLON.Color3(0.06, 0.05, 0.10);
    rockMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const snowMat = new BABYLON.StandardMaterial("sanctuarySnowMat", scene);
    snowMat.diffuseColor = new BABYLON.Color3(0.92, 0.95, 1.00);
    snowMat.emissiveColor = new BABYLON.Color3(0.20, 0.22, 0.28);
    snowMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const RING_R = 95;
    const PEAKS = 12;
    // Mulberry32 — local deterministic so the layout is stable across mounts.
    let s = 0x5A1C2A;
    const rand = () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let i = 0; i < PEAKS; i++) {
      const a = (i / PEAKS) * Math.PI * 2 + (rand() - 0.5) * 0.18;
      const r = RING_R + (rand() - 0.5) * 18;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const height = 28 + rand() * 22;            // 28..50 m
      const baseDiam = 22 + rand() * 14;          // 22..36 m

      const peak = BABYLON.MeshBuilder.CreateCylinder(
        `sanctuaryPeak_${i}`,
        { diameterTop: 0.4, diameterBottom: baseDiam, height, tessellation: 5 },
        scene,
      );
      // Height/2 so the cone rests flush on the grass plane (y=0.02).
      peak.position.set(x, height / 2, z);
      peak.rotation.y = rand() * Math.PI * 2;
      peak.material = rockMat;
      peak.parent = this.root;
      peak.isPickable = false;
      peak.freezeWorldMatrix();

      // A snow cap on the upper third — visually anchors the peak as a
      // mountain rather than a generic spike.
      const capH = height * 0.32;
      const cap = BABYLON.MeshBuilder.CreateCylinder(
        `sanctuaryCap_${i}`,
        { diameterTop: 0.4, diameterBottom: baseDiam * 0.45, height: capH, tessellation: 5 },
        scene,
      );
      cap.position.set(x, height - capH / 2 + 0.05, z);
      cap.rotation.y = peak.rotation.y;
      cap.material = snowMat;
      cap.parent = this.root;
      cap.isPickable = false;
      cap.freezeWorldMatrix();
    }
  }

  /** A small mouth-and-chamber cave on the eastern edge of the valley.
   *  Built entirely from primitives — torus arch + a rocky shell + a
   *  pulsing crystal cluster + stalagmites. Not collision-bound (you walk
   *  through it), but reads visually as an explorable pocket. The
   *  crystal's glow doubles as ambient lighting inside the chamber. */
  private buildCave(): void {
    const c = SanctuarySystem.CENTER;
    const scene = this.scene;

    // Cave anchor: 60 m east of the village center, just outside the
    // perimeter ring but inside the mountain ring (RING_R=95).
    const cx = c.x + 60;
    const cz = c.z + 4;

    const rockMat = new BABYLON.StandardMaterial("sanctuaryCaveRockMat", scene);
    rockMat.diffuseColor = new BABYLON.Color3(0.22, 0.20, 0.26);
    rockMat.emissiveColor = new BABYLON.Color3(0.04, 0.03, 0.06);
    rockMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const crystalMat = new BABYLON.StandardMaterial("sanctuaryCrystalMat", scene);
    crystalMat.diffuseColor = new BABYLON.Color3(0.20, 0.85, 1.00);
    crystalMat.emissiveColor = new BABYLON.Color3(0.30, 0.95, 1.00);
    crystalMat.specularColor = new BABYLON.Color3(0, 0, 0);
    crystalMat.alpha = 0.85;

    // ---- Outer rocky shell (slightly flattened sphere, half-buried) ----
    const shell = BABYLON.MeshBuilder.CreateSphere(
      "sanctuaryCaveShell",
      { diameter: 18, segments: 12 },
      scene,
    );
    shell.scaling.set(1.0, 0.85, 1.1);
    shell.position.set(cx, 7.0, cz);
    shell.material = rockMat;
    shell.parent = this.root;
    shell.isPickable = false;
    shell.freezeWorldMatrix();

    // ---- Cave mouth: a torus standing upright as a stone arch ----
    const arch = BABYLON.MeshBuilder.CreateTorus(
      "sanctuaryCaveArch",
      { diameter: 7.5, thickness: 1.4, tessellation: 24 },
      scene,
    );
    arch.rotation.x = Math.PI / 2;
    // Face the village (-x direction).
    arch.position.set(cx - 8.0, 3.6, cz);
    arch.material = rockMat;
    arch.parent = this.root;
    arch.isPickable = false;
    arch.freezeWorldMatrix();

    // ---- Floor disc inside the mouth so it reads as a "doorway" ----
    const floor = BABYLON.MeshBuilder.CreateDisc(
      "sanctuaryCaveFloor",
      { radius: 5.5, tessellation: 24 },
      scene,
    );
    floor.rotation.x = Math.PI / 2;
    floor.position.set(cx - 1.0, 0.05, cz);
    floor.material = rockMat;
    floor.parent = this.root;
    floor.isPickable = false;
    floor.freezeWorldMatrix();

    // ---- Crystal cluster at the chamber center ----
    const crystalAnchor = new BABYLON.TransformNode("sanctuaryCrystalAnchor", scene);
    crystalAnchor.parent = this.root;
    crystalAnchor.position.set(cx + 1.0, 0, cz);
    for (let i = 0; i < 5; i++) {
      const h = 1.4 + (i % 3) * 0.5; // 1.4..2.4
      const crystal = BABYLON.MeshBuilder.CreateCylinder(
        `sanctuaryCrystal_${i}`,
        { diameterTop: 0.05, diameterBottom: 0.7, height: h, tessellation: 6 },
        scene,
      );
      const ang = (i / 5) * Math.PI * 2;
      const r = 0.6 + (i * 0.15);
      crystal.position.set(
        Math.cos(ang) * r,
        h / 2,
        Math.sin(ang) * r,
      );
      crystal.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.18;
      crystal.material = crystalMat;
      crystal.parent = crystalAnchor;
      crystal.isPickable = false;
    }

    // Pulsing crystal light — gives the chamber its blue glow.
    const crystalLight = new BABYLON.PointLight(
      "sanctuaryCrystalLight",
      new BABYLON.Vector3(cx + 1.0, 1.6, cz),
      scene,
    );
    crystalLight.diffuse = new BABYLON.Color3(0.3, 0.85, 1.0);
    crystalLight.intensity = 0.9;
    crystalLight.range = 18;
    crystalLight.parent = this.root;

    // ---- Stalagmites scattered around the floor ----
    const stalCount = 8;
    for (let i = 0; i < stalCount; i++) {
      const ang = (i / stalCount) * Math.PI * 2 + 0.3;
      const r = 2.6 + (i % 3) * 0.6;
      const sx = cx + Math.cos(ang) * r;
      const sz = cz + Math.sin(ang) * r;
      const sh = 0.7 + ((i * 13) % 7) * 0.18; // 0.7..1.86
      const stal = BABYLON.MeshBuilder.CreateCylinder(
        `sanctuaryStal_${i}`,
        { diameterTop: 0.08, diameterBottom: 0.55, height: sh, tessellation: 6 },
        scene,
      );
      stal.position.set(sx, sh / 2, sz);
      stal.material = rockMat;
      stal.parent = this.root;
      stal.isPickable = false;
      stal.freezeWorldMatrix();
    }
  }

  // ----------------------------------------------------- foliage scatter

  /** Crank the L-system organic life up around the village by piggy-backing
   *  on the world's AlienFoliageSystem. Plants are added in two clusters:
   *  one tight ring just outside the perimeter so the village feels nestled
   *  in jungle, and one looser scatter farther out so the eye reads density
   *  without choking the playable area. The disposer this returns is what
   *  the sanctuary uses on warp-out so we don't leave alien plants stranded
   *  at (-480,-480) when the player is back in Detroit. */
  private scatterAlienFoliage(): void {
    const foliage = this.handles.foliage;
    if (!foliage) return;
    const c = SanctuarySystem.CENTER;

    // Inner band: dense alien thicket hugging the perimeter (40..80 m).
    // Center the cluster slightly offset so it doesn't perfectly mirror the
    // mountain ring behind it.
    const innerCenter = new BABYLON.Vector3(c.x, 0, c.z);
    const innerDispose = foliage.scatterZone(innerCenter, 80, 70, 4.5, 0xA51C2A);

    // Outer band: looser scatter filling the gap toward the mountains
    // (75..120 m), thinned out so the silhouette of the peaks still reads.
    const outerCenter = new BABYLON.Vector3(c.x + 5, 0, c.z - 5);
    const outerDispose = foliage.scatterZone(outerCenter, 110, 50, 7.0, 0xC0FFEE);

    this.foliageDisposer = () => {
      try { innerDispose(); } catch {}
      try { outerDispose(); } catch {}
    };
  }

  // ------------------------------------------- huntable bio-creature population

  /** Spawn a small population of real bio-creatures inside the sanctuary
   *  through the shared BioCreatureSystem. These are the actual targets
   *  the Capture Net (and the H-key fallback) reach for — without them,
   *  attemptCaptureNearest finds nothing in range because the cosmetic
   *  herd from buildWildlife isn't registered with the bio system.
   *
   *  Positions live within the sanctuary perimeter (r≈26m), spaced
   *  enough that no two creatures stack on the same plot. Ids are tracked
   *  so dispose can despawn the uncaptured remainder cleanly. */
  private spawnHuntableBioCreatures(): void {
    const bio = this.handles.bio;
    if (!bio) return;
    const c = SanctuarySystem.CENTER;
    // Eight spawn points laid out around the village footprint, avoiding
    // the centre (NPC + plinth) and the cave mouth (east edge).
    const offsets: Array<[number, number]> = [
      [-18,  -4], [-14,  14], [ -4,  20], [ 12,  18],
      [ 18,   2], [ 14, -16], [  2, -20], [-12, -18],
    ];
    for (const [dx, dz] of offsets) {
      const pos = new BABYLON.Vector3(c.x + dx, 1, c.z + dz);
      try {
        const id = bio.spawnRandomAt(pos);
        if (id) this.spawnedBioIds.push(id);
      } catch (err) {
        console.warn("[SanctuarySystem] failed to spawn sanctuary creature", err);
      }
    }
  }

  // ------------------------------------------------------------ wildlife

  /** Populate the sanctuary with wandering bio-critters. These are *peaceful*
   *  on purpose: Level 4 contracts as `peaceful: true` (wave spawner is off),
   *  so giving the player aggressive enemies here would break that promise.
   *  Instead we lean into the "rehabilitated Animatons roam free" lore — the
   *  critters are decorative passive wildlife that wander inside their home
   *  radius, bobbing as they walk. Each is a small parametric mech: a body
   *  sphere, four leg cylinders, a head pod, and two glowing eyes. */
  private buildWildlife(): void {
    const c = SanctuarySystem.CENTER;
    const scene = this.scene;

    // Three palettes so the herd doesn't read as clones.
    const palettes = [
      { body: new BABYLON.Color3(0.45, 0.85, 0.55), eye: new BABYLON.Color3(1.0, 1.0, 0.4) },
      { body: new BABYLON.Color3(0.85, 0.55, 0.85), eye: new BABYLON.Color3(0.4, 1.0, 1.0) },
      { body: new BABYLON.Color3(0.55, 0.75, 0.95), eye: new BABYLON.Color3(1.0, 0.6, 0.4) },
    ];
    const bodyMats = palettes.map((p, i) => {
      const m = new BABYLON.StandardMaterial(`sanctuaryCritterBody_${i}`, scene);
      m.diffuseColor = p.body;
      m.emissiveColor = p.body.scale(0.25);
      m.specularColor = new BABYLON.Color3(0, 0, 0);
      return m;
    });
    const eyeMats = palettes.map((p, i) => {
      const m = new BABYLON.StandardMaterial(`sanctuaryCritterEye_${i}`, scene);
      m.diffuseColor = new BABYLON.Color3(0, 0, 0);
      m.emissiveColor = p.eye;
      m.specularColor = new BABYLON.Color3(0, 0, 0);
      m.disableLighting = true;
      return m;
    });
    const legMat = new BABYLON.StandardMaterial("sanctuaryCritterLeg", scene);
    legMat.diffuseColor = new BABYLON.Color3(0.18, 0.16, 0.22);
    legMat.specularColor = new BABYLON.Color3(0, 0, 0);

    // 9 critters scattered around the village + 3 living near the cave.
    // Coords are (offsetX, offsetZ) relative to CENTER, plus a wander radius.
    type Spawn = { dx: number; dz: number; radius: number };
    const spawns: Spawn[] = [
      { dx: -16, dz: 6,   radius: 6 },
      { dx: -22, dz: -8,  radius: 7 },
      { dx: -8,  dz: 22,  radius: 6 },
      { dx: 10,  dz: 24,  radius: 6 },
      { dx: 22,  dz: 12,  radius: 7 },
      { dx: 25,  dz: -6,  radius: 6 },
      { dx: 14,  dz: -22, radius: 7 },
      { dx: -6,  dz: -24, radius: 6 },
      { dx: -24, dz: -22, radius: 7 },
      // Cave-side trio (cave is at +60,+4 with 5.5 m floor radius).
      { dx: 50,  dz: 8,   radius: 5 },
      { dx: 55,  dz: -4,  radius: 5 },
      { dx: 48,  dz: -10, radius: 5 },
    ];

    spawns.forEach((s, i) => {
      const palIdx = i % palettes.length;
      const home = new BABYLON.Vector3(c.x + s.dx, 0, c.z + s.dz);
      const root = new BABYLON.TransformNode(`sanctuaryCritter_${i}`, scene);
      root.parent = this.root;
      root.position.copyFrom(home);

      // Body — squashed sphere ~0.7 m wide.
      const body = BABYLON.MeshBuilder.CreateSphere(
        `sanctuaryCritterBody_${i}`,
        { diameter: 1.0, segments: 10 },
        scene,
      );
      body.scaling.set(1.1, 0.7, 1.4);
      body.position.set(0, 0.85, 0);
      body.material = bodyMats[palIdx];
      body.parent = root;
      body.isPickable = false;

      // Head pod — smaller sphere forward of body.
      const head = BABYLON.MeshBuilder.CreateSphere(
        `sanctuaryCritterHead_${i}`,
        { diameter: 0.55, segments: 8 },
        scene,
      );
      head.position.set(0, 1.05, 0.65);
      head.material = bodyMats[palIdx];
      head.parent = root;
      head.isPickable = false;

      // Two glowing eyes on the head.
      for (const sx of [-0.13, 0.13]) {
        const eye = BABYLON.MeshBuilder.CreateSphere(
          `sanctuaryCritterEye_${i}_${sx}`,
          { diameter: 0.16, segments: 6 },
          scene,
        );
        eye.position.set(sx, 1.12, 0.92);
        eye.material = eyeMats[palIdx];
        eye.parent = root;
        eye.isPickable = false;
      }

      // Four legs — short cylinders at the corners.
      const legY = 0.32;
      const legPositions = [
        [-0.32, legY,  0.45], [ 0.32, legY,  0.45],
        [-0.32, legY, -0.45], [ 0.32, legY, -0.45],
      ];
      legPositions.forEach((p, li) => {
        const leg = BABYLON.MeshBuilder.CreateCylinder(
          `sanctuaryCritterLeg_${i}_${li}`,
          { diameter: 0.18, height: 0.64, tessellation: 6 },
          scene,
        );
        leg.position.set(p[0], p[1], p[2]);
        leg.material = legMat;
        leg.parent = root;
        leg.isPickable = false;
      });

      this.wildlife.push({
        root,
        home,
        radius: s.radius,
        speed: 0.35 + (i % 4) * 0.08,    // 0.35..0.59 m/s
        phase: (i * 0.7) % (Math.PI * 2),
        bobPhase: (i * 1.3) % (Math.PI * 2),
      });
    });

    // Per-frame wander: each critter walks a slow Lissajous around its
    // home, bobs vertically, and faces its motion direction. Pure cosmetic —
    // no AI, no targeting, no damage.
    let lastT = performance.now();
    // Slow trickle of Bio Essence so a hunting player can't run dry
    // mid-session. The first throw worked but subsequent throws were
    // silently failing because Essence ran out and the user had no UI
    // hint why. +1 every 6 s, capped at 10. Only fires inside the
    // sanctuary because this observer is owned by the sanctuary and
    // disposed on warp-out.
    let essenceTrickle = 0;
    const ESSENCE_TRICKLE_S = 6;
    const ESSENCE_TRICKLE_CAP = 10;
    this.wildlifeObserver = scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      essenceTrickle += dt;
      if (essenceTrickle >= ESSENCE_TRICKLE_S) {
        essenceTrickle = 0;
        const have = this.inventory.getItemCount("bio_essence");
        if (have < ESSENCE_TRICKLE_CAP) {
          this.inventory.addItem(ITEM_DEFINITIONS.bio_essence, 1);
        }
      }
      for (const w of this.wildlife) {
        w.phase += dt * w.speed;
        w.bobPhase += dt * 2.4;
        const px = w.home.x + Math.cos(w.phase) * w.radius;
        const pz = w.home.z + Math.sin(w.phase * 0.7) * w.radius * 0.6;
        // Velocity direction for facing.
        const vx = -Math.sin(w.phase) * w.radius * w.speed;
        const vz =  Math.cos(w.phase * 0.7) * w.radius * 0.6 * w.speed * 0.7;
        w.root.position.x = px;
        w.root.position.z = pz;
        w.root.position.y = Math.abs(Math.sin(w.bobPhase)) * 0.06;
        if (vx * vx + vz * vz > 1e-4) {
          w.root.rotation.y = Math.atan2(vx, vz);
        }
      }
    });
  }

  private static noise2(x: number, y: number, seed: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
    return n - Math.floor(n);
  }

  private static smoothstep(edge0: number, edge1: number, x: number): number {
    const t = BABYLON.Scalar.Clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
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
      // Each grown plot yields 2 bio-crops, with a clinic-feed bonus so the
      // farming loop plugs directly into pet bonding instead of feeling like
      // a disconnected resource drip. Harvest resets the plot.
      this.inventory.addItem(ITEM_DEFINITIONS.bio_crop, 2);
      const feedBonus = Math.random() < 0.45;
      if (feedBonus) this.inventory.addItem(ITEM_DEFINITIONS.animaton_feed, 1);
      this.setStage(plot, 0);
      this.bus.emit(
        GameEvents.UI_MESSAGE,
        feedBonus
          ? "Harvested 2x Bio Crop + 1 Animaton Feed."
          : "Harvested 2x Bio Crop.",
      );
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
