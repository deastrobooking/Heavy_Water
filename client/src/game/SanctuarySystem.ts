import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { FriendlyNPCSystem } from "./FriendlyNPCSystem";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";
import type { BaseSystem } from "./BaseSystem";

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

  /** Sanctuary footprint center (matches LevelSystem.spawnPoint for L4). */
  private static readonly CENTER = new BABYLON.Vector3(-480, 0, -480);

  constructor(
    scene: BABYLON.Scene,
    camera: BABYLON.Camera,
    inventory: InventorySystem,
    playerPosProvider: () => BABYLON.Vector3,
    inputBlockedProvider: () => boolean,
    baseSystem?: BaseSystem,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.bus = EventBus.getInstance();
    this.inventory = inventory;
    this.playerPos = playerPosProvider;
    this.base = baseSystem ?? null;

    this.root = new BABYLON.TransformNode("sanctuaryRoot", scene);

    this.buildSign();
    this.buildPerimeter();
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
    try { this.root.dispose(); } catch {}
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

  /** Five plots in a tidy 5-wide row south of the sanctuary sign. */
  private spawnPlots(): void {
    const c = SanctuarySystem["CENTER"] as BABYLON.Vector3;
    const startX = c.x - 8;
    const z = c.z + 12;
    const spacing = 4;

    for (let i = 0; i < 5; i++) {
      const pos = new BABYLON.Vector3(startX + i * spacing, 0, z);
      const soil = BABYLON.MeshBuilder.CreateBox(
        `farmPlot_${i}`,
        { width: 3, height: 0.2, depth: 3 },
        this.scene,
      );
      soil.position.set(pos.x, 0.1, pos.z);
      soil.parent = this.parent;
      const mat = new BABYLON.StandardMaterial(`farmPlotMat_${i}`, this.scene);
      mat.diffuseColor = new BABYLON.Color3(0.32, 0.18, 0.10);
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      soil.material = mat;

      this.plots.push({
        index: i,
        position: pos.clone(),
        stage: 0,
        stageStart: 0,
        soil,
        crop: null,
      });
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
