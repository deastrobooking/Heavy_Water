import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { FriendlyNPCSystem } from "./FriendlyNPCSystem";
import type { CityGenerator } from "./CityGenerator";

/** Optional handles PontiacLabSystem hides on mount + restores on dispose so
 *  Level 6 reads as a *truly distinct* indoor lab world. Mirrors the
 *  identical-shape bag in SanctuarySystem / SpaceLevelSystem; passing the
 *  same array of `setVisible` handles keeps the three side-zones structurally
 *  consistent. Each entry is null-tolerant. */
export interface PontiacLabHandles {
  city?: CityGenerator | null;
  worldVisibles?: Array<{ setVisible(visible: boolean): void } | null | undefined>;
}

/**
 * PontiacLabSystem
 * ================
 * Owns the entire Pontiac Secret Lab side-zone (Level 6):
 *
 *   - A dark metallic floor plate large enough to mask the hidden city.
 *   - 4 perimeter walls forming a 60×60 m room around the spawn.
 *   - 6 cryo-pod cylinders with cyan emissive coolant glow.
 *   - 4 server racks with blinking diagnostic LEDs.
 *   - 3 holographic command terminals.
 *   - A central command desk + welcome sign.
 *   - 2 lab NPCs (Dr. Cynthia You, Research-AI ZIRCON).
 *
 * Mounted by Game.tsx when LEVEL_STARTED fires for level 6 (`isLab`),
 * disposed when the player fast-travels back. The mount is idempotent —
 * re-entering the lab doesn't clone meshes.
 *
 * Lore: Pontiac is a former GM proving-grounds town just north of Detroit.
 * In Heavy Water continuity it hid a covert pre-war research wing where
 * Dr. Cynthia You first prototyped the Animaton-bonding work that
 * eventually leaked into Char's Swarm program. The lab is "secret" because
 * even Star City's command structure thinks it was demolished.
 */
export class PontiacLabSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.Camera;
  private bus: EventBus;
  private playerPos: () => BABYLON.Vector3;

  /** Top-level transform — disposing this kills every mesh we spawned. */
  private root: BABYLON.TransformNode;
  private npcs: FriendlyNPCSystem | null = null;
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  /** Pulsing emissive props (cryo pods, server LEDs) animated by the
   *  per-frame observer. Stored as references + base values so dispose
   *  doesn't have to walk the scene. */
  private pulsers: { mat: BABYLON.StandardMaterial; base: BABYLON.Color3; phase: number; speed: number }[] = [];
  /** Bag of world systems hidden on mount; restored on dispose. */
  private handles: PontiacLabHandles;
  private hiddenVisibles: Array<{ setVisible(v: boolean): void }> = [];
  private cityHidden: boolean = false;

  /** Lab footprint center (matches LevelSystem.spawnPoint for L6). */
  private static readonly CENTER = new BABYLON.Vector3(480, 0, 480);
  /** Inner room half-extent — walls sit at ±ROOM. */
  private static readonly ROOM = 30;

  constructor(
    scene: BABYLON.Scene,
    camera: BABYLON.Camera,
    playerPosProvider: () => BABYLON.Vector3,
    inputBlockedProvider: () => boolean,
    handles: PontiacLabHandles = {},
  ) {
    this.scene = scene;
    this.camera = camera;
    this.bus = EventBus.getInstance();
    this.playerPos = playerPosProvider;
    this.handles = handles;

    this.root = new BABYLON.TransformNode("pontiacLabRoot", scene);

    // Build OUR floor first, then hide the city + mountains + foliage so
    // Level 6 reads as a self-contained lab interior rather than a corner
    // of Detroit. PlayerController falls back to its analytical groundY=1
    // floor while the city ground is hidden, so physics keeps working.
    this.buildFloorAndCeiling();
    this.hideOuterWorld();
    this.buildWalls();
    this.buildSign();
    this.buildPerimeterRing();
    this.buildCryoPods();
    this.buildServerRacks();
    this.buildHoloTerminals();
    this.buildCommandDesk();
    this.buildLighting();
    this.spawnNPCs(inputBlockedProvider);

    // Per-frame observer drives the cryo-pod + server-LED pulse so the
    // room reads as "live equipment". Cheap — six sinf calls a frame.
    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());

    this.bus.emit(GameEvents.UI_MESSAGE, "PONTIAC SECRET LAB — pre-war research recovered.");
    console.log("[PontiacLabSystem] Pontiac Secret Lab mounted");
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    if (this.npcs) {
      try { this.npcs.dispose(); } catch {}
      this.npcs = null;
    }
    this.pulsers = [];
    // Restore the outer world we hid on mount BEFORE root.dispose so any
    // mistake here doesn't strand the player on a black void.
    this.restoreOuterWorld();
    try { this.root.dispose(); } catch {}
    console.log("[PontiacLabSystem] Pontiac Secret Lab disposed");
  }

  // -------------------------------------------------------- world swap

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

  // ------------------------------------------------------------ visuals

  /** Wide dark-metal floor + a low ceiling box overhead so the player
   *  reads the room as enclosed even with the city hidden. The ceiling
   *  is a flat panel rather than a true sealed roof so peripheral skybox
   *  noise (asteroid silhouettes, sun glow) can still show through the
   *  edges and sell the "covert basement bunker" vibe. */
  private buildFloorAndCeiling(): void {
    const c = PontiacLabSystem.CENTER;

    const floor = BABYLON.MeshBuilder.CreateGround(
      "labFloor",
      { width: 1500, height: 1500, subdivisions: 1 },
      this.scene,
    );
    floor.position.set(c.x, 0.02, c.z);
    floor.parent = this.root;
    floor.isPickable = false;
    floor.receiveShadows = false;
    const floorMat = new BABYLON.StandardMaterial("labFloorMat", this.scene);
    floorMat.diffuseColor = new BABYLON.Color3(0.10, 0.13, 0.18);
    floorMat.emissiveColor = new BABYLON.Color3(0.02, 0.04, 0.07);
    floorMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.08);
    floor.material = floorMat;

    // Cyan grid lines painted onto a thin overlay disc inside the room so
    // the floor reads as a tech-lab grid rather than a flat plate.
    const grid = BABYLON.MeshBuilder.CreateDisc(
      "labFloorGrid",
      { radius: 28, tessellation: 6 },
      this.scene,
    );
    grid.position.set(c.x, 0.04, c.z);
    grid.rotation.x = Math.PI / 2;
    grid.parent = this.root;
    grid.isPickable = false;
    const gridMat = new BABYLON.StandardMaterial("labFloorGridMat", this.scene);
    gridMat.diffuseColor = new BABYLON.Color3(0.05, 0.18, 0.28);
    gridMat.emissiveColor = new BABYLON.Color3(0.10, 0.55, 0.90);
    gridMat.alpha = 0.45;
    gridMat.specularColor = new BABYLON.Color3(0, 0, 0);
    grid.material = gridMat;
  }

  /** Four solid walls boxing in the central play area. Tall enough that
   *  the player can't easily jump over them and see the empty world
   *  beyond, short enough that aerial movement still feels viable. */
  private buildWalls(): void {
    const c = PontiacLabSystem.CENTER;
    const R = PontiacLabSystem.ROOM;
    const H = 14;

    const wallMat = new BABYLON.StandardMaterial("labWallMat", this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.14, 0.18, 0.24);
    wallMat.emissiveColor = new BABYLON.Color3(0.03, 0.05, 0.09);
    wallMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.08);

    const trimMat = new BABYLON.StandardMaterial("labWallTrimMat", this.scene);
    trimMat.diffuseColor = new BABYLON.Color3(0.12, 0.55, 0.95);
    trimMat.emissiveColor = new BABYLON.Color3(0.10, 0.50, 0.95);
    trimMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const sides: Array<{ x: number; z: number; w: number; d: number }> = [
      { x: c.x,         z: c.z + R,   w: R * 2 + 2, d: 2 }, // +Z (north)
      { x: c.x,         z: c.z - R,   w: R * 2 + 2, d: 2 }, // -Z (south)
      { x: c.x + R,     z: c.z,       w: 2,         d: R * 2 + 2 }, // +X (east)
      { x: c.x - R,     z: c.z,       w: 2,         d: R * 2 + 2 }, // -X (west)
    ];
    sides.forEach((s, i) => {
      const wall = BABYLON.MeshBuilder.CreateBox(`labWall_${i}`,
        { width: s.w, height: H, depth: s.d }, this.scene);
      wall.position.set(s.x, H / 2, s.z);
      wall.parent = this.root;
      wall.isPickable = false;
      wall.material = wallMat;

      // Glowing trim line along the top of each wall — pure decoration.
      const trim = BABYLON.MeshBuilder.CreateBox(`labWallTrim_${i}`,
        { width: s.w + 0.1, height: 0.2, depth: s.d + 0.1 }, this.scene);
      trim.position.set(s.x, H - 0.4, s.z);
      trim.parent = this.root;
      trim.isPickable = false;
      trim.material = trimMat;
    });
  }

  /** Sanctuary-style cyan ring on the floor so the player can read the
   *  room boundary. Decorative, not a collider. */
  private buildPerimeterRing(): void {
    const c = PontiacLabSystem.CENTER;
    const R = PontiacLabSystem.ROOM - 1;
    const segs = 64;
    const points: BABYLON.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      points.push(new BABYLON.Vector3(c.x + Math.cos(t) * R, 0.05, c.z + Math.sin(t) * R));
    }
    const ring = BABYLON.MeshBuilder.CreateLines("labPerimeter", { points }, this.scene);
    ring.color = new BABYLON.Color3(0.30, 0.85, 1.0);
    ring.parent = this.root;
    ring.isPickable = false;
  }

  /** Welcome plaque at the south side of the room. Same DynamicTexture
   *  trick the sanctuary uses so we don't need an external image asset. */
  private buildSign(): void {
    const c = PontiacLabSystem.CENTER;

    const post = BABYLON.MeshBuilder.CreateBox(
      "labSignPost",
      { width: 0.3, height: 3.0, depth: 0.3 },
      this.scene,
    );
    post.position.set(c.x, 1.5, c.z - PontiacLabSystem.ROOM + 4);
    post.parent = this.root;
    const postMat = new BABYLON.StandardMaterial("labSignPostMat", this.scene);
    postMat.diffuseColor = new BABYLON.Color3(0.20, 0.22, 0.28);
    postMat.specularColor = new BABYLON.Color3(0, 0, 0);
    post.material = postMat;

    const board = BABYLON.MeshBuilder.CreateBox(
      "labSignBoard",
      { width: 5.0, height: 1.6, depth: 0.18 },
      this.scene,
    );
    board.position.set(c.x, 2.8, c.z - PontiacLabSystem.ROOM + 4);
    board.parent = this.root;
    const boardMat = new BABYLON.StandardMaterial("labSignBoardMat", this.scene);
    boardMat.diffuseColor = new BABYLON.Color3(0.08, 0.10, 0.18);
    boardMat.emissiveColor = new BABYLON.Color3(0.10, 0.40, 0.85);
    boardMat.specularColor = new BABYLON.Color3(0, 0, 0);
    board.material = boardMat;

    const tex = new BABYLON.DynamicTexture(
      "labSignTex",
      { width: 512, height: 180 },
      this.scene,
      false,
    );
    tex.drawText("PONTIAC  SECRET  LAB", null, 80, "bold 44px Arial", "#9be1ff", "#06121e", true);
    tex.drawText("authorised personnel only", null, 130, "italic 26px Arial", "#69aaff", null as any, true);
    tex.drawText("est. 2049 — Dr. Cynthia You", null, 160, "20px Arial", "#3a78d8", null as any, true);
    boardMat.emissiveTexture = tex;
    boardMat.diffuseTexture = tex;
  }

  /** Six cryo-pod cylinders arranged along the east wall. Each pod has
   *  a coolant cylinder, a base plinth, and a faintly-visible silhouette
   *  of a captured Animaton inside (tiny dark sphere). The coolant
   *  pulses cyan via the per-frame `tick()`. */
  private buildCryoPods(): void {
    const c = PontiacLabSystem.CENTER;
    const baseMat = new BABYLON.StandardMaterial("cryoBaseMat", this.scene);
    baseMat.diffuseColor = new BABYLON.Color3(0.16, 0.20, 0.26);
    baseMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const occupantMat = new BABYLON.StandardMaterial("cryoOccupantMat", this.scene);
    occupantMat.diffuseColor = new BABYLON.Color3(0.18, 0.22, 0.30);
    occupantMat.emissiveColor = new BABYLON.Color3(0.05, 0.10, 0.18);
    occupantMat.specularColor = new BABYLON.Color3(0, 0, 0);

    for (let i = 0; i < 6; i++) {
      const x = c.x + 18; // along east wall
      const z = c.z - 18 + i * 7.2;

      const plinth = BABYLON.MeshBuilder.CreateBox(`cryoBase_${i}`,
        { width: 2.0, height: 0.8, depth: 2.0 }, this.scene);
      plinth.position.set(x, 0.4, z);
      plinth.parent = this.root;
      plinth.isPickable = false;
      plinth.material = baseMat;

      const tube = BABYLON.MeshBuilder.CreateCylinder(`cryoTube_${i}`,
        { height: 3.4, diameter: 1.4, tessellation: 18 }, this.scene);
      tube.position.set(x, 0.8 + 1.7, z);
      tube.parent = this.root;
      tube.isPickable = false;
      const tubeMat = new BABYLON.StandardMaterial(`cryoTubeMat_${i}`, this.scene);
      tubeMat.diffuseColor = new BABYLON.Color3(0.20, 0.55, 0.85);
      tubeMat.emissiveColor = new BABYLON.Color3(0.20, 0.85, 1.0);
      tubeMat.alpha = 0.55;
      tubeMat.specularColor = new BABYLON.Color3(0, 0, 0);
      tube.material = tubeMat;
      this.pulsers.push({
        mat: tubeMat,
        base: tubeMat.emissiveColor.clone(),
        phase: i * 0.7,
        speed: 1.6,
      });

      // Occupant silhouette — a small dim sphere suspended in the tube.
      const occ = BABYLON.MeshBuilder.CreateSphere(`cryoOcc_${i}`,
        { diameter: 0.9 }, this.scene);
      occ.position.set(x, 0.8 + 1.4, z);
      occ.parent = this.root;
      occ.isPickable = false;
      occ.material = occupantMat;

      const cap = BABYLON.MeshBuilder.CreateCylinder(`cryoCap_${i}`,
        { height: 0.3, diameter: 1.6, tessellation: 18 }, this.scene);
      cap.position.set(x, 0.8 + 3.55, z);
      cap.parent = this.root;
      cap.isPickable = false;
      cap.material = baseMat;
    }
  }

  /** Four server racks along the west wall — tall thin slabs with rows of
   *  blinking diagnostic LEDs. Pulses are added to `this.pulsers` so the
   *  per-frame observer animates them. */
  private buildServerRacks(): void {
    const c = PontiacLabSystem.CENTER;

    const rackMat = new BABYLON.StandardMaterial("serverRackMat", this.scene);
    rackMat.diffuseColor = new BABYLON.Color3(0.10, 0.12, 0.16);
    rackMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.08);

    for (let i = 0; i < 4; i++) {
      const x = c.x - 18;
      const z = c.z - 14 + i * 9;

      const rack = BABYLON.MeshBuilder.CreateBox(`serverRack_${i}`,
        { width: 3.0, height: 4.5, depth: 1.4 }, this.scene);
      rack.position.set(x, 2.25, z);
      rack.parent = this.root;
      rack.isPickable = false;
      rack.material = rackMat;

      // 5 stacked LED bars per rack — alternate red / green / amber so
      // each rack reads as "many indicators".
      for (let j = 0; j < 5; j++) {
        const bar = BABYLON.MeshBuilder.CreateBox(`serverLed_${i}_${j}`,
          { width: 2.4, height: 0.18, depth: 0.05 }, this.scene);
        bar.position.set(x, 0.7 + j * 0.85, z + 0.71);
        bar.parent = this.root;
        bar.isPickable = false;
        const ledMat = new BABYLON.StandardMaterial(`serverLedMat_${i}_${j}`, this.scene);
        const palette = [
          new BABYLON.Color3(0.10, 1.0, 0.30),  // green
          new BABYLON.Color3(1.0, 0.30, 0.10),  // red
          new BABYLON.Color3(1.0, 0.80, 0.10),  // amber
          new BABYLON.Color3(0.20, 0.85, 1.0),  // cyan
          new BABYLON.Color3(1.0, 0.20, 0.65),  // magenta
        ];
        const c0 = palette[(i * 5 + j) % palette.length];
        ledMat.diffuseColor = c0.scale(0.4);
        ledMat.emissiveColor = c0;
        ledMat.specularColor = new BABYLON.Color3(0, 0, 0);
        bar.material = ledMat;
        this.pulsers.push({
          mat: ledMat,
          base: c0.clone(),
          phase: (i * 5 + j) * 0.4,
          speed: 3.0 + ((i + j) % 3) * 0.7,
        });
      }
    }
  }

  /** Three holographic command terminals across the north of the room.
   *  Each is a low plinth with a glowing emissive disc on top — purely
   *  decorative, but reads strongly as "research console" at a glance. */
  private buildHoloTerminals(): void {
    const c = PontiacLabSystem.CENTER;

    const baseMat = new BABYLON.StandardMaterial("holoBaseMat", this.scene);
    baseMat.diffuseColor = new BABYLON.Color3(0.15, 0.18, 0.22);
    baseMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const beamMat = new BABYLON.StandardMaterial("holoBeamMat", this.scene);
    beamMat.diffuseColor = new BABYLON.Color3(0.20, 0.85, 1.0);
    beamMat.emissiveColor = new BABYLON.Color3(0.30, 0.90, 1.0);
    beamMat.alpha = 0.30;
    beamMat.specularColor = new BABYLON.Color3(0, 0, 0);

    for (let i = 0; i < 3; i++) {
      const x = c.x - 8 + i * 8;
      const z = c.z + 18;

      const plinth = BABYLON.MeshBuilder.CreateBox(`holoBase_${i}`,
        { width: 2.4, height: 1.2, depth: 1.6 }, this.scene);
      plinth.position.set(x, 0.6, z);
      plinth.parent = this.root;
      plinth.isPickable = false;
      plinth.material = baseMat;

      // Holo column rising 2.4 m above the console.
      const beam = BABYLON.MeshBuilder.CreateCylinder(`holoBeam_${i}`,
        { height: 2.4, diameterTop: 1.2, diameterBottom: 0.4, tessellation: 14 },
        this.scene);
      beam.position.set(x, 1.2 + 1.2, z);
      beam.parent = this.root;
      beam.isPickable = false;
      beam.material = beamMat;
      this.pulsers.push({
        mat: beamMat,
        base: beamMat.emissiveColor.clone(),
        phase: i * 1.1,
        speed: 0.9,
      });

      // Glowing disc on top of the plinth — the actual "screen".
      const disc = BABYLON.MeshBuilder.CreateDisc(`holoDisc_${i}`,
        { radius: 0.9, tessellation: 32 }, this.scene);
      disc.position.set(x, 1.21, z);
      disc.rotation.x = Math.PI / 2;
      disc.parent = this.root;
      disc.isPickable = false;
      const discMat = new BABYLON.StandardMaterial(`holoDiscMat_${i}`, this.scene);
      discMat.diffuseColor = new BABYLON.Color3(0.10, 0.30, 0.55);
      discMat.emissiveColor = new BABYLON.Color3(0.20, 0.85, 1.0);
      discMat.specularColor = new BABYLON.Color3(0, 0, 0);
      disc.material = discMat;
    }
  }

  /** Central command desk — a wider plinth at the room centre with a
   *  row of three small monitor-screens facing south so the player sees
   *  them on entry. */
  private buildCommandDesk(): void {
    const c = PontiacLabSystem.CENTER;

    const deskMat = new BABYLON.StandardMaterial("labDeskMat", this.scene);
    deskMat.diffuseColor = new BABYLON.Color3(0.18, 0.22, 0.28);
    deskMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.08);

    const desk = BABYLON.MeshBuilder.CreateBox("labCommandDesk",
      { width: 6.0, height: 1.0, depth: 2.0 }, this.scene);
    desk.position.set(c.x, 0.5, c.z + 3);
    desk.parent = this.root;
    desk.isPickable = false;
    desk.material = deskMat;

    const screenMat = new BABYLON.StandardMaterial("labScreenMat", this.scene);
    screenMat.diffuseColor = new BABYLON.Color3(0.05, 0.10, 0.20);
    screenMat.emissiveColor = new BABYLON.Color3(0.10, 0.55, 1.0);
    screenMat.specularColor = new BABYLON.Color3(0, 0, 0);

    for (let i = 0; i < 3; i++) {
      const screen = BABYLON.MeshBuilder.CreateBox(`labScreen_${i}`,
        { width: 1.6, height: 1.0, depth: 0.1 }, this.scene);
      screen.position.set(c.x - 1.8 + i * 1.8, 1.6, c.z + 2.05);
      screen.parent = this.root;
      screen.isPickable = false;
      screen.material = screenMat;
    }
  }

  /** Two PointLights inside the room so the cyan trim, cryo glow, and
   *  hologram beams actually catch on the dark wall material. Without
   *  them the room looks flat-shaded. */
  private buildLighting(): void {
    const c = PontiacLabSystem.CENTER;

    const left = new BABYLON.PointLight("labLightLeft",
      new BABYLON.Vector3(c.x - 12, 8, c.z), this.scene);
    left.diffuse = new BABYLON.Color3(0.30, 0.65, 1.0);
    left.intensity = 0.6;
    left.range = 60;
    left.parent = this.root;

    const right = new BABYLON.PointLight("labLightRight",
      new BABYLON.Vector3(c.x + 12, 8, c.z), this.scene);
    right.diffuse = new BABYLON.Color3(0.85, 0.30, 1.0);
    right.intensity = 0.5;
    right.range = 60;
    right.parent = this.root;

    const center = new BABYLON.HemisphericLight("labLightCenter",
      new BABYLON.Vector3(0, 1, 0), this.scene);
    center.diffuse = new BABYLON.Color3(0.40, 0.55, 0.80);
    center.intensity = 0.35;
    center.parent = this.root;
  }

  /** Spawn lab NPCs through a dedicated FriendlyNPCSystem so they share the
   *  player's existing dialogue UI and proximity prompt. Same private-API
   *  cast trick the sanctuary uses to bypass FriendlyNPCSystem's hard-coded
   *  spawnDefaults() city cast. */
  private spawnNPCs(inputBlocked: () => boolean): void {
    const c = PontiacLabSystem.CENTER;
    const npcs = new FriendlyNPCSystem(this.scene, this.camera);
    npcs.setPlayerPositionProvider(this.playerPos);
    npcs.setInputBlockedProvider(inputBlocked);

    const cast = [
      {
        id: "lab_cynthia",
        position: new BABYLON.Vector3(c.x - 4, 0, c.z + 4),
        dialogue: {
          name: "DR. CYNTHIA YOU",
          lines: [
            "You found Pontiac. Most of Star City still thinks this lab was demolished.",
            "Everything Char weaponised in his Swarm started here, in pre-war research.",
            "The cryo pods on the east wall hold the originals — Animatons we couldn't save.",
            "Read the holo terminals to the north when you're ready. The truth is in there.",
            "And tell Sergio I'm alive. He'd want to know.",
          ],
        },
        primary: new BABYLON.Color3(0.55, 0.85, 1.0),
        secondary: new BABYLON.Color3(0.20, 0.40, 0.85),
        hair: new BABYLON.Color3(0.85, 0.95, 1.0),
      },
      {
        id: "lab_zircon",
        position: new BABYLON.Vector3(c.x + 4, 0, c.z + 4),
        dialogue: {
          name: "ZIRCON · RESEARCH AI",
          lines: [
            "Greetings, pilot. I am ZIRCON — node-locked to this facility.",
            "Diagnostics nominal. Six cryo-subjects in stasis. Twenty server cabinets online.",
            "I have prepared schematics for an experimental Pontiac-class energy core.",
            "Return to Star City when ready. I will keep watch over the doctor.",
          ],
        },
        primary: new BABYLON.Color3(0.85, 0.40, 1.0),
        secondary: new BABYLON.Color3(0.40, 0.20, 0.85),
        hair: new BABYLON.Color3(1.0, 0.65, 1.0),
      },
    ];

    const sysAny = npcs as unknown as { spawnNPC: (def: any, idx: number) => void };
    cast.forEach((def, i) => sysAny.spawnNPC(def, i));

    this.npcs = npcs;
  }

  /** Per-frame pulse for cryo glow + server LEDs. Keeps the lab visually
   *  "alive" without pulling FX-system overhead. */
  private tick(): void {
    const t = performance.now() * 0.001;
    for (const p of this.pulsers) {
      const k = 0.65 + 0.35 * Math.sin(t * p.speed + p.phase);
      p.mat.emissiveColor.copyFromFloats(p.base.r * k, p.base.g * k, p.base.b * k);
    }
  }
}
