import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import type { CityGenerator } from "./CityGenerator";
import type { EnemySystem, EnemyType } from "./EnemySystem";
import type { BossVariantId } from "./BossVariants";

export interface ZugIslandHandles {
  city?: CityGenerator | null;
  worldVisibles?: Array<{ setVisible(visible: boolean): void } | null | undefined>;
  lodCull?: { setSuppressed(b: boolean): void } | null;
}

/**
 * ZugIslandSystem
 * ===============
 * Owns the Zug Island Legion side-zone (Level 9) — the absolute hardest
 * combat zone in the game. An open industrial wasteland (slag heaps,
 * blast furnaces, smokestacks) where the Legion fields hundreds of
 * elites in continuous waves.
 *
 * Combat:
 *   - Initial garrison spawns immediately (titans + captains + spider
 *     tanks ringing the player).
 *   - A wave director maintains a high enemy population indefinitely:
 *     when the count drops below LIVE_TARGET, more elites are dripped
 *     in around the arena edge until LIFETIME_CAP enemies have been
 *     spawned (hundreds, by design).
 *   - Spawn weights are heavily biased toward titans, captains, and
 *     spider tanks — no soldiers, no swarm minions, no drones.
 *
 * Lifecycle: mounted by Game.tsx when LEVEL_STARTED fires for level 9
 * (`isZugIsland`); disposed when the player fast-travels out.
 */
export class ZugIslandSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private playerPos: () => BABYLON.Vector3;
  private enemySystem: EnemySystem;

  private root: BABYLON.TransformNode;
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private handles: ZugIslandHandles;
  private hiddenVisibles: Array<{ setVisible(v: boolean): void }> = [];
  private cityHidden: boolean = false;
  private emberMats: BABYLON.StandardMaterial[] = [];

  /** Total enemies spawned across the entire mount lifetime — capped so
   *  we don't grind the engine into the dirt after a long siege. */
  private spawnedTotal: number = 0;
  /** Cooldown timer for the wave director (seconds). */
  private waveTimer: number = 0;
  private lastTickMs: number = performance.now();

  /** Far SW corner of the expanded open world — the island now occupies its
   *  own dedicated section of the map (~940 m beyond the mountain ring at
   *  r=560), opposite the SE Saginaw Lab section. Must match
   *  LevelSystem.LEVEL_DEFS[9].spawnPoint so fast-travel lands the player
   *  at arena center. */
  private static readonly CENTER = new BABYLON.Vector3(-1500, 0, -1500);
  private static readonly ARENA_R = 120;
  /** Target live enemy count maintained by the director. */
  private static readonly LIVE_TARGET = 60;
  /** Hard cap on lifetime spawns so the zone naturally winds down after
   *  a sustained battle. ~hundreds of elites total across the fight. */
  private static readonly LIFETIME_CAP = 600;
  /** Seconds between director ticks. */
  private static readonly WAVE_INTERVAL = 1.5;
  /** Spawns dripped per tick when the live count is below target. */
  private static readonly SPAWNS_PER_TICK = 4;

  constructor(
    scene: BABYLON.Scene,
    enemySystem: EnemySystem,
    playerPosProvider: () => BABYLON.Vector3,
    handles: ZugIslandHandles = {},
  ) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.playerPos = playerPosProvider;
    this.enemySystem = enemySystem;
    this.handles = handles;

    this.root = new BABYLON.TransformNode("zugIslandRoot", scene);

    this.buildGround();
    this.hideOuterWorld();
    try { this.handles.lodCull?.setSuppressed(true); } catch {}
    this.buildSlagHeaps();
    this.buildBlastFurnaces();
    this.buildSmokestacks();
    this.buildRiver();
    this.buildBridge();
    this.buildGiantFactories();
    this.buildLighting();

    try { this.spawnInitialGarrison(); } catch (e) {
      console.warn("[ZugIslandSystem] initial garrison failed", e);
    }

    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());

    this.bus.emit(
      GameEvents.UI_MESSAGE,
      "ZUG ISLAND — LEGION DEPLOYED. Hold the line against the horde.",
    );
    console.log("[ZugIslandSystem] Zug Island mounted");
  }

  dispose(): void {
    try { this._disposeInner(); }
    finally { try { this.handles.lodCull?.setSuppressed(false); } catch {} }
  }

  private _disposeInner(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    this.emberMats = [];
    this.restoreOuterWorld();
    try { this.root.dispose(); } catch {}
    console.log("[ZugIslandSystem] Zug Island disposed");
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

  private buildGround(): void {
    const c = ZugIslandSystem.CENTER;

    const ground = BABYLON.MeshBuilder.CreateGround(
      "zugGround",
      { width: 1500, height: 1500, subdivisions: 1 },
      this.scene,
    );
    ground.position.set(c.x, 0.02, c.z);
    ground.parent = this.root;
    ground.isPickable = false;
    ground.receiveShadows = false;
    const groundMat = new BABYLON.StandardMaterial("zugGroundMat", this.scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.10, 0.07, 0.05);
    groundMat.emissiveColor = new BABYLON.Color3(0.04, 0.02, 0.01);
    groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material = groundMat;

    // Inner combat disc — glowing slag/ember tone reads "still-cooling
    // industrial floor" rather than a generic dark plane.
    const disc = BABYLON.MeshBuilder.CreateDisc(
      "zugArenaDisc",
      { radius: ZugIslandSystem.ARENA_R, tessellation: 16 },
      this.scene,
    );
    disc.position.set(c.x, 0.04, c.z);
    disc.rotation.x = Math.PI / 2;
    disc.parent = this.root;
    disc.isPickable = false;
    const discMat = new BABYLON.StandardMaterial("zugArenaDiscMat", this.scene);
    discMat.diffuseColor = new BABYLON.Color3(0.20, 0.10, 0.05);
    discMat.emissiveColor = new BABYLON.Color3(0.35, 0.12, 0.04);
    discMat.specularColor = new BABYLON.Color3(0, 0, 0);
    disc.material = discMat;
    this.emberMats.push(discMat);
  }

  /** Slag heaps ringing the arena — irregular cones of cooled metal
   *  waste so the silhouette reads "industrial wasteland". */
  private buildSlagHeaps(): void {
    const c = ZugIslandSystem.CENTER;
    const slagMat = new BABYLON.StandardMaterial("zugSlagMat", this.scene);
    slagMat.diffuseColor = new BABYLON.Color3(0.12, 0.09, 0.08);
    slagMat.emissiveColor = new BABYLON.Color3(0.18, 0.06, 0.02);
    slagMat.specularColor = new BABYLON.Color3(0, 0, 0);
    this.emberMats.push(slagMat);

    // Heaps live ONLY along the east + west edges — the north is reserved
    // for the river + bridge, the south for the factory skyline. Pushed far
    // out (radius ≥ 230) so the combat ring (ARENA_R = 120) stays open.
    const heapCount = 10;
    for (let i = 0; i < heapCount; i++) {
      const side = i < heapCount / 2 ? 0 : Math.PI; // east cluster vs west cluster
      const t = (i % (heapCount / 2)) / (heapCount / 2 - 1); // 0..1 along that side
      const ang = side + (t - 0.5) * 0.7; // narrow wedge facing E or W
      const r = 240 + (i % 3) * 18;
      const x = c.x + Math.cos(ang) * r;
      const z = c.z + Math.sin(ang) * r;
      const h = 6 + (i % 4) * 2.5;
      const heap = BABYLON.MeshBuilder.CreateCylinder(`zugSlag_${i}`,
        { height: h, diameterTop: 0.4, diameterBottom: 6 + (i % 4) * 1.5, tessellation: 8 }, this.scene);
      heap.position.set(x, h / 2, z);
      heap.parent = this.root;
      heap.material = slagMat;
      heap.isPickable = false;
    }
  }

  /** Blast furnace silhouettes — squat cylinders with glowing tap-holes
   *  at the base. Pure decoration, no collision logic. */
  private buildBlastFurnaces(): void {
    const c = ZugIslandSystem.CENTER;
    const shellMat = new BABYLON.StandardMaterial("zugFurnaceShellMat", this.scene);
    shellMat.diffuseColor = new BABYLON.Color3(0.18, 0.14, 0.12);
    shellMat.specularColor = new BABYLON.Color3(0.10, 0.08, 0.06);

    const tapMat = new BABYLON.StandardMaterial("zugFurnaceTapMat", this.scene);
    tapMat.diffuseColor = new BABYLON.Color3(1.0, 0.45, 0.10);
    tapMat.emissiveColor = new BABYLON.Color3(1.4, 0.55, 0.10);
    tapMat.specularColor = new BABYLON.Color3(0, 0, 0);
    this.emberMats.push(tapMat);

    // Furnaces along the EAST + WEST flanks only — never inside the
    // combat ring (the previous layout placed them at radius 70-95 which
    // was *inside* ARENA_R=120, blocking the player). Pushed out to ~270 m.
    const positions: Array<[number, number]> = [
      [-270, -40], [-270, 40], [-310,   0],
      [ 270, -40], [ 270, 40], [ 310,   0],
    ];
    for (let i = 0; i < positions.length; i++) {
      const [dx, dz] = positions[i];
      const x = c.x + dx;
      const z = c.z + dz;

      const shell = BABYLON.MeshBuilder.CreateCylinder(`zugFurnace_${i}`,
        { height: 16, diameterTop: 6, diameterBottom: 10, tessellation: 16 }, this.scene);
      shell.position.set(x, 8, z);
      shell.parent = this.root;
      shell.material = shellMat;
      shell.isPickable = false;

      const tap = BABYLON.MeshBuilder.CreateBox(`zugFurnaceTap_${i}`,
        { width: 4, height: 1.2, depth: 4 }, this.scene);
      tap.position.set(x, 0.6, z);
      tap.parent = this.root;
      tap.material = tapMat;
      tap.isPickable = false;
    }
  }

  /** Tall smokestacks — narrow cylinders ringing the outer arena. */
  private buildSmokestacks(): void {
    const c = ZugIslandSystem.CENTER;
    const stackMat = new BABYLON.StandardMaterial("zugStackMat", this.scene);
    stackMat.diffuseColor = new BABYLON.Color3(0.16, 0.12, 0.10);
    stackMat.specularColor = new BABYLON.Color3(0.05, 0.04, 0.03);

    // Smokestacks form a wide outer ring (radius 220) — far enough out that
    // the combat zone reads as open space framed by industrial silhouettes,
    // but skipping the north arc so they don't compete with the bridge.
    const stackCount = 10;
    for (let i = 0; i < stackCount; i++) {
      // sweep 0..2π but skip the north quadrant (3π/2 ± π/4 area).
      const ang = (i / stackCount) * Math.PI * 1.5 - Math.PI * 0.25;
      const r = 220;
      const x = c.x + Math.cos(ang) * r;
      const z = c.z + Math.sin(ang) * r;
      const h = 38 + (i % 3) * 6;
      const stack = BABYLON.MeshBuilder.CreateCylinder(`zugStack_${i}`,
        { height: h, diameter: 3.4, tessellation: 12 }, this.scene);
      stack.position.set(x, h / 2, z);
      stack.parent = this.root;
      stack.material = stackMat;
      stack.isPickable = false;
    }
  }

  /** Toxic-green river running E-W along the north edge of the arena. A
   *  recessed channel ~720 m long × 80 m wide with rust-stained walls and
   *  a glowing surface so it reads as an "industrial runoff river". The
   *  bridge crosses it. Sits well outside the active combat ring
   *  (ARENA_R = 120) so the wave director can't drop enemies into the
   *  channel. */
  private buildRiver(): void {
    const c = ZugIslandSystem.CENTER;
    const length = 720;
    const width = 80;
    const z0 = c.z - 360; // far north of arena — well outside combat ring (r=120)

    const channelMat = new BABYLON.StandardMaterial("zugRiverChannelMat", this.scene);
    channelMat.diffuseColor = new BABYLON.Color3(0.04, 0.03, 0.02);
    channelMat.specularColor = new BABYLON.Color3(0, 0, 0);

    // Sunken channel floor (below the arena ground plane).
    const floor = BABYLON.MeshBuilder.CreateBox("zugRiverFloor",
      { width: length, height: 4, depth: width }, this.scene);
    floor.position.set(c.x, -2, z0);
    floor.parent = this.root;
    floor.material = channelMat;
    floor.isPickable = false;

    // Toxic-green/rust river surface — translucent so the channel below
    // bleeds through. Static emissive (NOT pushed into emberMats) so it
    // stays visibly glowing rather than fading with the existing shimmer.
    const surface = BABYLON.MeshBuilder.CreateGround("zugRiverSurface",
      { width: length, height: width, subdivisions: 1 }, this.scene);
    surface.position.set(c.x, 0.05, z0);
    surface.parent = this.root;
    surface.isPickable = false;
    const surfaceMat = new BABYLON.StandardMaterial("zugRiverSurfaceMat", this.scene);
    surfaceMat.diffuseColor = new BABYLON.Color3(0.18, 0.32, 0.10);
    surfaceMat.emissiveColor = new BABYLON.Color3(0.22, 0.40, 0.10);
    surfaceMat.alpha = 0.82;
    surfaceMat.specularColor = new BABYLON.Color3(0.40, 0.60, 0.30);
    surfaceMat.backFaceCulling = false;
    surface.material = surfaceMat;

    // Rust-stained channel walls along both banks.
    const bankMat = new BABYLON.StandardMaterial("zugRiverBankMat", this.scene);
    bankMat.diffuseColor = new BABYLON.Color3(0.20, 0.10, 0.06);
    bankMat.specularColor = new BABYLON.Color3(0.05, 0.04, 0.03);
    for (const sign of [-1, 1] as const) {
      const wall = BABYLON.MeshBuilder.CreateBox(`zugRiverWall_${sign}`,
        { width: length, height: 3, depth: 4 }, this.scene);
      wall.position.set(c.x, 1.0, z0 + sign * (width / 2 + 2));
      wall.parent = this.root;
      wall.material = bankMat;
      wall.isPickable = false;
    }
  }

  /** Big steel truss bridge spanning the toxic river. Deck at y=14, ~140 m
   *  long, with two 50 m pylons at each end carrying suspension cables and
   *  a hellish red beacon on top. Player can fly up to walk the deck (DBZ
   *  flight is enabled in this game). Pure decoration — no collision logic. */
  private buildBridge(): void {
    const c = ZugIslandSystem.CENTER;
    const z0 = c.z - 360; // matches river center (far north of arena)
    const deckY = 14;
    const deckLen = 140; // along Z (crossing the river)
    const deckWidth = 18;
    const x0 = c.x;

    const steelMat = new BABYLON.StandardMaterial("zugBridgeSteelMat", this.scene);
    steelMat.diffuseColor = new BABYLON.Color3(0.18, 0.16, 0.16);
    steelMat.specularColor = new BABYLON.Color3(0.20, 0.20, 0.20);

    const beaconMat = new BABYLON.StandardMaterial("zugBridgeBeaconMat", this.scene);
    beaconMat.diffuseColor = new BABYLON.Color3(0.50, 0.05, 0.05);
    beaconMat.emissiveColor = new BABYLON.Color3(1.6, 0.20, 0.10);
    beaconMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const cableMat = new BABYLON.StandardMaterial("zugBridgeCableMat", this.scene);
    cableMat.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.08);
    cableMat.specularColor = new BABYLON.Color3(0, 0, 0);

    // --- Deck
    const deck = BABYLON.MeshBuilder.CreateBox("zugBridgeDeck",
      { width: deckWidth, height: 1.0, depth: deckLen }, this.scene);
    deck.position.set(x0, deckY, z0);
    deck.parent = this.root;
    deck.material = steelMat;
    deck.isPickable = false;

    // --- Side rails + cross trusses
    for (const sign of [-1, 1] as const) {
      const rail = BABYLON.MeshBuilder.CreateBox(`zugBridgeRail_${sign}`,
        { width: 0.6, height: 3.0, depth: deckLen }, this.scene);
      rail.position.set(x0 + sign * (deckWidth / 2 - 0.3), deckY + 1.5, z0);
      rail.parent = this.root;
      rail.material = steelMat;
      rail.isPickable = false;
    }
    const trussCount = 12;
    for (let i = 0; i < trussCount; i++) {
      const t = i / (trussCount - 1);
      const z = z0 - deckLen / 2 + t * deckLen;
      for (const sign of [-1, 1] as const) {
        const truss = BABYLON.MeshBuilder.CreateBox(`zugBridgeTruss_${sign}_${i}`,
          { width: 0.4, height: 4.0, depth: 0.4 }, this.scene);
        truss.position.set(x0 + sign * (deckWidth / 2), deckY + 2, z);
        truss.parent = this.root;
        truss.material = steelMat;
        truss.isPickable = false;
      }
    }

    // --- Pylons (one at each end of the deck along Z), with crossbar + beacon.
    const pylonH = 50;
    const pylonZ = [z0 - deckLen / 2 + 4, z0 + deckLen / 2 - 4];
    for (let pi = 0; pi < pylonZ.length; pi++) {
      const pz = pylonZ[pi];
      for (const sign of [-1, 1] as const) {
        const pylon = BABYLON.MeshBuilder.CreateBox(`zugBridgePylon_${pi}_${sign}`,
          { width: 4, height: pylonH, depth: 4 }, this.scene);
        pylon.position.set(x0 + sign * (deckWidth / 2 + 1), pylonH / 2, pz);
        pylon.parent = this.root;
        pylon.material = steelMat;
        pylon.isPickable = false;
      }
      const top = BABYLON.MeshBuilder.CreateBox(`zugBridgePylonTop_${pi}`,
        { width: deckWidth + 6, height: 2, depth: 4 }, this.scene);
      top.position.set(x0, pylonH - 1, pz);
      top.parent = this.root;
      top.material = steelMat;
      top.isPickable = false;

      const beacon = BABYLON.MeshBuilder.CreateSphere(`zugBridgeBeacon_${pi}`,
        { diameter: 2.6, segments: 12 }, this.scene);
      beacon.position.set(x0, pylonH + 1.6, pz);
      beacon.parent = this.root;
      beacon.material = beaconMat;
      beacon.isPickable = false;
    }

    // --- Suspension cables (5 per side per pylon, drooping to the deck).
    for (let pi = 0; pi < 2; pi++) {
      const pz = pylonZ[pi];
      const dir = pi === 0 ? 1 : -1;
      for (const sign of [-1, 1] as const) {
        const startTop = new BABYLON.Vector3(x0 + sign * (deckWidth / 2 + 1), pylonH - 1, pz);
        for (let ci = 1; ci <= 5; ci++) {
          const cz = pz + dir * (ci * (deckLen - 8) / 12);
          const end = new BABYLON.Vector3(x0 + sign * (deckWidth / 2), deckY + 0.6, cz);
          const len = BABYLON.Vector3.Distance(startTop, end);
          const cable = BABYLON.MeshBuilder.CreateCylinder(`zugBridgeCable_${pi}_${sign}_${ci}`,
            { height: len, diameter: 0.18, tessellation: 6 }, this.scene);
          const mid = startTop.add(end).scale(0.5);
          cable.position.copyFrom(mid);
          // Orient the cylinder along (end - start).
          const axis = end.subtract(startTop).normalize();
          const up = new BABYLON.Vector3(0, 1, 0);
          const dot = Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(up, axis)));
          const cross = BABYLON.Vector3.Cross(up, axis);
          if (cross.lengthSquared() > 1e-6) {
            cross.normalize();
            cable.rotationQuaternion = BABYLON.Quaternion.RotationAxis(cross, Math.acos(dot));
          }
          cable.parent = this.root;
          cable.material = cableMat;
          cable.isPickable = false;
        }
      }
    }
  }

  /** 4 giant evil-industrial factory complexes ringing the arena (skipping
   *  the north side where the river + bridge live). Each: long warehouse
   *  hall with pitched roof, hellish red emissive slit windows, attached
   *  annex, two roof-stacks with glowing crowns, an elevated conveyor
   *  pipe on supports, and a big red signage panel on the front. Placed
   *  at radius ~340 m from CENTER — well outside the combat ring (r=120)
   *  and outside the smokestack ring (r=155) but inside the 1500x1500
   *  ground extent. */
  private buildGiantFactories(): void {
    const c = ZugIslandSystem.CENTER;

    const wallMat = new BABYLON.StandardMaterial("zugFactoryWallMat", this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.18, 0.14, 0.12);
    wallMat.specularColor = new BABYLON.Color3(0.10, 0.08, 0.06);

    const roofMat = new BABYLON.StandardMaterial("zugFactoryRoofMat", this.scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.14, 0.10, 0.08);
    roofMat.specularColor = new BABYLON.Color3(0.05, 0.04, 0.03);

    const windowMat = new BABYLON.StandardMaterial("zugFactoryWindowMat", this.scene);
    windowMat.diffuseColor = new BABYLON.Color3(0.50, 0.10, 0.04);
    windowMat.emissiveColor = new BABYLON.Color3(1.6, 0.30, 0.10);
    windowMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const pipeMat = new BABYLON.StandardMaterial("zugFactoryPipeMat", this.scene);
    pipeMat.diffuseColor = new BABYLON.Color3(0.20, 0.16, 0.14);
    pipeMat.specularColor = new BABYLON.Color3(0.10, 0.10, 0.10);

    const signMat = new BABYLON.StandardMaterial("zugFactorySignMat", this.scene);
    signMat.diffuseColor = new BABYLON.Color3(0.50, 0.05, 0.05);
    signMat.emissiveColor = new BABYLON.Color3(1.4, 0.15, 0.10);
    signMat.specularColor = new BABYLON.Color3(0, 0, 0);

    // All 4 factories form a SOUTH SKYLINE behind the arena, evenly spaced
    // along z = c.z + 380. Axis-aligned (rot = 0) so their long fronts
    // (with the slit windows + sign panel at local -Z) all face NORTH
    // toward the player. This guarantees the east/west/north sides of the
    // arena stay completely open for combat. Spacing 150 m, factory width
    // 80 m → ~70 m gaps between factories. Combined footprint stays well
    // within the 1500×1500 ground extent.
    const layouts: Array<{ x: number; z: number; rot: number }> = [
      { x: -225, z: 380, rot: 0 },
      { x:  -75, z: 380, rot: 0 },
      { x:   75, z: 380, rot: 0 },
      { x:  225, z: 380, rot: 0 },
    ];

    for (let fi = 0; fi < layouts.length; fi++) {
      const { x: lx, z: lz, rot } = layouts[fi];
      const cx = c.x + lx;
      const cz = c.z + lz;

      const facRoot = new BABYLON.TransformNode(`zugFactory_${fi}`, this.scene);
      facRoot.parent = this.root;
      facRoot.position.set(cx, 0, cz);
      facRoot.rotation.y = rot;

      // Main hall — long warehouse 80×40 footprint, 32 m tall.
      const hall = BABYLON.MeshBuilder.CreateBox(`zugFactoryHall_${fi}`,
        { width: 80, height: 32, depth: 40 }, this.scene);
      hall.position.set(0, 16, 0);
      hall.parent = facRoot;
      hall.material = wallMat;
      hall.isPickable = false;

      // Pitched roof — two angled slabs forming the apex.
      for (const sign of [-1, 1] as const) {
        const slope = BABYLON.MeshBuilder.CreateBox(`zugFactoryRoof_${fi}_${sign}`,
          { width: 80, height: 2, depth: 22 }, this.scene);
        slope.position.set(0, 33, sign * 10);
        slope.rotation.x = sign * 0.45;
        slope.parent = facRoot;
        slope.material = roofMat;
        slope.isPickable = false;
      }

      // Hellish slit windows along the long faces (upper + lower bands).
      for (const zSign of [-1, 1] as const) {
        for (let wi = 0; wi < 6; wi++) {
          const wx = -32.5 + wi * 13;
          const winHi = BABYLON.MeshBuilder.CreateBox(`zugFactoryWinHi_${fi}_${zSign}_${wi}`,
            { width: 8, height: 1.6, depth: 0.4 }, this.scene);
          winHi.position.set(wx, 22, zSign * 20.1);
          winHi.parent = facRoot;
          winHi.material = windowMat;
          winHi.isPickable = false;

          const winLo = BABYLON.MeshBuilder.CreateBox(`zugFactoryWinLo_${fi}_${zSign}_${wi}`,
            { width: 6, height: 1.2, depth: 0.4 }, this.scene);
          winLo.position.set(wx, 8, zSign * 20.1);
          winLo.parent = facRoot;
          winLo.material = windowMat;
          winLo.isPickable = false;
        }
      }

      // Side annex — smaller block tucked against one end.
      const annex = BABYLON.MeshBuilder.CreateBox(`zugFactoryAnnex_${fi}`,
        { width: 26, height: 22, depth: 26 }, this.scene);
      annex.position.set(46, 11, 0);
      annex.parent = facRoot;
      annex.material = wallMat;
      annex.isPickable = false;

      // Two roof-stacks rising from the hall, each crowned with a glowing ring.
      for (let si = 0; si < 2; si++) {
        const sx = -25 + si * 50;
        const stackH = 56;
        const stack = BABYLON.MeshBuilder.CreateCylinder(`zugFactoryStack_${fi}_${si}`,
          { height: stackH, diameterTop: 5, diameterBottom: 6.5, tessellation: 14 }, this.scene);
        stack.position.set(sx, 32 + stackH / 2, 0);
        stack.parent = facRoot;
        stack.material = wallMat;
        stack.isPickable = false;

        const crown = BABYLON.MeshBuilder.CreateTorus(`zugFactoryStackCrown_${fi}_${si}`,
          { diameter: 6.0, thickness: 0.5, tessellation: 16 }, this.scene);
        crown.position.set(sx, 32 + stackH - 0.5, 0);
        crown.parent = facRoot;
        crown.material = windowMat;
        crown.isPickable = false;
      }

      // Elevated conveyor pipe along the side, on support legs.
      const pipe = BABYLON.MeshBuilder.CreateCylinder(`zugFactoryPipe_${fi}`,
        { height: 90, diameter: 2.4, tessellation: 12 }, this.scene);
      pipe.position.set(0, 12, 24);
      pipe.rotation.z = Math.PI / 2;
      pipe.parent = facRoot;
      pipe.material = pipeMat;
      pipe.isPickable = false;
      for (let pi = 0; pi < 4; pi++) {
        const px = -36 + pi * 24;
        const leg = BABYLON.MeshBuilder.CreateBox(`zugFactoryPipeLeg_${fi}_${pi}`,
          { width: 1.2, height: 12, depth: 1.2 }, this.scene);
        leg.position.set(px, 6, 24);
        leg.parent = facRoot;
        leg.material = pipeMat;
        leg.isPickable = false;
      }

      // Big red signage panel on the front face.
      const signPanel = BABYLON.MeshBuilder.CreateBox(`zugFactorySign_${fi}`,
        { width: 30, height: 5, depth: 0.5 }, this.scene);
      signPanel.position.set(0, 28, -20.3);
      signPanel.parent = facRoot;
      signPanel.material = signMat;
      signPanel.isPickable = false;
    }
  }

  private buildLighting(): void {
    const c = ZugIslandSystem.CENTER;

    const front = new BABYLON.PointLight("zugLightFront",
      new BABYLON.Vector3(c.x, 24, c.z - 30), this.scene);
    front.diffuse = new BABYLON.Color3(1.20, 0.55, 0.20);
    front.intensity = 0.8;
    front.range = 140;
    front.parent = this.root;

    const back = new BABYLON.PointLight("zugLightBack",
      new BABYLON.Vector3(c.x, 24, c.z + 30), this.scene);
    back.diffuse = new BABYLON.Color3(1.05, 0.40, 0.15);
    back.intensity = 0.7;
    back.range = 140;
    back.parent = this.root;

    const ambient = new BABYLON.HemisphericLight("zugLightAmbient",
      new BABYLON.Vector3(0, 1, 0), this.scene);
    ambient.diffuse = new BABYLON.Color3(0.30, 0.18, 0.12);
    ambient.intensity = 0.30;
    ambient.parent = this.root;
  }

  // ------------------------------------------------------------ combat

  /** Initial garrison — a thick ring of titans + captains + spider tanks
   *  the moment the player warps in, so the zone reads as "wall-to-wall
   *  legion" before the wave director even ticks once. */
  private spawnInitialGarrison(): void {
    const c = ZugIslandSystem.CENTER;
    const variants: BossVariantId[] = ["frost", "void", "plague", "inferno", "storm"];

    // 12 titans around the arena edge.
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const r = ZugIslandSystem.ARENA_R - 18;
      const pos = new BABYLON.Vector3(c.x + Math.cos(ang) * r, 1.5, c.z + Math.sin(ang) * r);
      this.trySpawn("titan", pos);
    }

    // 8 captains tucked inside the titan ring.
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const r = ZugIslandSystem.ARENA_R - 36;
      const x = c.x + Math.cos(ang) * r;
      const z = c.z + Math.sin(ang) * r;
      const pos = new BABYLON.Vector3(x, 1.5, z);
      try {
        this.enemySystem.spawnCaptain(pos, {
          variantId: variants[i % variants.length],
          healthMultiplier: 1.4,
        });
        this.spawnedTotal += 1;
      } catch (e) {
        console.warn("[ZugIslandSystem] captain spawn failed", e);
      }
    }

    // 4 spider tanks anchored in the four cardinal directions.
    const tankPositions: Array<[number, number]> = [
      [c.x - 60, c.z], [c.x + 60, c.z],
      [c.x, c.z - 60], [c.x, c.z + 60],
    ];
    for (const [x, z] of tankPositions) {
      this.trySpawn("spider_tank", new BABYLON.Vector3(x, 3.5, z));
    }
  }

  /** Wave director — every WAVE_INTERVAL seconds, drip in more elites
   *  around the arena ring until the live count hits LIVE_TARGET or the
   *  lifetime cap is reached. Spawn weights bias toward titans (the
   *  signature unit), with captains + spider tanks rounding out the mix. */
  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTickMs) / 1000);
    this.lastTickMs = now;

    // Cheap ember shimmer across the slag/disc/tap materials so the
    // arena reads as "still-cooling industrial floor".
    const t = now * 0.001;
    const k = 0.85 + 0.15 * Math.sin(t * 1.4);
    for (const mat of this.emberMats) {
      const baseR = mat.emissiveColor.r;
      const baseG = mat.emissiveColor.g;
      const baseB = mat.emissiveColor.b;
      mat.emissiveColor.copyFromFloats(baseR * k, baseG * k, baseB * k);
    }

    if (this.spawnedTotal >= ZugIslandSystem.LIFETIME_CAP) return;

    this.waveTimer += dt;
    if (this.waveTimer < ZugIslandSystem.WAVE_INTERVAL) return;
    this.waveTimer = 0;

    const live = this.countLiveLegion();
    if (live >= ZugIslandSystem.LIVE_TARGET) return;

    const c = ZugIslandSystem.CENTER;
    const variants: BossVariantId[] = ["frost", "void", "plague", "inferno", "storm"];
    const want = Math.min(
      ZugIslandSystem.SPAWNS_PER_TICK,
      ZugIslandSystem.LIVE_TARGET - live,
      ZugIslandSystem.LIFETIME_CAP - this.spawnedTotal,
    );

    for (let i = 0; i < want; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = ZugIslandSystem.ARENA_R - 6 - Math.random() * 12;
      const x = c.x + Math.cos(ang) * r;
      const z = c.z + Math.sin(ang) * r;

      // Weighted roll: 55% titan, 30% captain, 15% spider tank — the
      // legion is overwhelmingly heavy infantry, with elite officers
      // and the occasional siege walker.
      const roll = Math.random();
      if (roll < 0.55) {
        this.trySpawn("titan", new BABYLON.Vector3(x, 1.5, z));
      } else if (roll < 0.85) {
        try {
          this.enemySystem.spawnCaptain(new BABYLON.Vector3(x, 1.5, z), {
            variantId: variants[Math.floor(Math.random() * variants.length)],
            healthMultiplier: 1.3,
          });
          this.spawnedTotal += 1;
        } catch {}
      } else {
        this.trySpawn("spider_tank", new BABYLON.Vector3(x, 3.5, z));
      }
    }
  }

  private trySpawn(type: EnemyType, pos: BABYLON.Vector3): void {
    try {
      const u = this.enemySystem.spawnEnemyAt(type, pos);
      if (u) this.spawnedTotal += 1;
    } catch (e) {
      console.warn(`[ZugIslandSystem] spawnEnemyAt(${type}) failed`, e);
    }
  }

  /** Live legion population — anything the EnemySystem currently tracks
   *  counts. Cheap proxy via the public enemy-count getter. */
  private countLiveLegion(): number {
    const sys = this.enemySystem as any;
    if (typeof sys.getEnemyCount === "function") {
      try { return sys.getEnemyCount() as number; } catch {}
    }
    if (Array.isArray(sys.enemies)) return sys.enemies.length;
    return 0;
  }
}
