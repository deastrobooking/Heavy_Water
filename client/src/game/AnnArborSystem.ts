import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import type { CityGenerator } from "./CityGenerator";
import type { EnemySystem, EnemyType, EnemyUnit } from "./EnemySystem";
import type { BossVariantId } from "./BossVariants";

export interface AnnArborHandles {
  city?: CityGenerator | null;
  worldVisibles?: Array<{ setVisible(visible: boolean): void } | null | undefined>;
  lodCull?: { setSuppressed(b: boolean): void } | null;
}

/**
 * AnnArborSystem
 * ==============
 * Owns the Ann Arbor Apocalypse side-zone (Level 10) — a medium-sized
 * city WEST of every other map section, in the middle of being crushed
 * by a giant alien mothership that has touched down on top of its
 * skyline. The downtown towers are visibly broken under the saucer's
 * weight; lit windows still glow on intact peripheral buildings.
 *
 * Combat:
 *   - Initial garrison: 10 maxed-out captains ringing the saucer's
 *     upper deck (HP/damage multipliers higher than even the Zug
 *     Legion captains), plus a swarm of every robot type pouring
 *     through the streets at ground level.
 *   - Wave director maintains a live count via the ground swarm
 *     (drones / soldiers / heavies / insectoids / hybrids / commanders /
 *     tanks / spider tanks) — captains are NOT respawned (the 10
 *     "throne" captains on the UFO are the elite tier).
 *
 * Lifecycle: mounted by Game.tsx when LEVEL_STARTED fires for level 10
 * (`isAnnArbor`); disposed when the player fast-travels out.
 */
export class AnnArborSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private playerPos: () => BABYLON.Vector3;
  private enemySystem: EnemySystem;

  private root: BABYLON.TransformNode;
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private handles: AnnArborHandles;
  private hiddenVisibles: Array<{ setVisible(v: boolean): void }> = [];
  private cityHidden: boolean = false;
  /** Materials whose emissive should pulse (UFO underlights, window
   *  glow) — kept SEPARATE from Zug's "decay" pattern: we just lerp
   *  between two intensities, never multiplicatively shrink. */
  private pulseMats: Array<{ mat: BABYLON.StandardMaterial; baseR: number; baseG: number; baseB: number; phase: number }> = [];

  private spawnedTotal: number = 0;
  private waveTimer: number = 0;
  private lastTickMs: number = performance.now();
  /** UFO saucer body — slowly rotates around Y for menace. */
  private saucerRoot: BABYLON.TransformNode | null = null;
  /** The 10 throne captains pinned to the saucer deck. We hold the
   *  references so the per-frame tick can re-anchor their Y if anything
   *  outside updateChase displaces them, and so countLive() can exclude
   *  them from the ground-swarm budget. */
  private throneCaptains: EnemyUnit[] = [];
  /** Ground-swarm minions spawned by THIS zone. countLive() filters on
   *  this list so captains/titans/legacy enemies don't inflate the wave
   *  director's live-target accounting. */
  private minions: EnemyUnit[] = [];
  /** Snapshot of EnemySystem.maxEnemies at construction so dispose() can
   *  restore the prior cap. We bump the cap up so the ~70 LIVE_TARGET is
   *  actually reachable past the default 50 cap. */
  private prevMaxEnemies: number = 0;

  /** Pure WEST corner of the expanded open world — west of Zug Island
   *  (-1500,-1500), Saginaw (1500,-1500), and the original city at
   *  origin. Must match LevelSystem.LEVEL_DEFS[10].spawnPoint so
   *  fast-travel lands the player on the city street under the UFO. */
  private static readonly CENTER = new BABYLON.Vector3(-3000, 0, 0);
  private static readonly ARENA_R = 220; // wider than Zug — this is a city
  /** Saucer hovers this high above the ground. */
  private static readonly SAUCER_Y = 130;
  private static readonly SAUCER_RADIUS = 160;

  /** Target live ground-swarm count maintained by the director. The
   *  10 throne captains on the UFO are NOT counted toward this — they
   *  are the elite tier and don't respawn. */
  private static readonly LIVE_TARGET = 70;
  private static readonly LIFETIME_CAP = 700;
  private static readonly WAVE_INTERVAL = 1.4;
  private static readonly SPAWNS_PER_TICK = 5;

  constructor(
    scene: BABYLON.Scene,
    enemySystem: EnemySystem,
    playerPosProvider: () => BABYLON.Vector3,
    handles: AnnArborHandles = {},
  ) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.playerPos = playerPosProvider;
    this.enemySystem = enemySystem;
    this.handles = handles;

    this.root = new BABYLON.TransformNode("annArborRoot", scene);

    this.buildGround();
    this.hideOuterWorld();
    try { this.handles.lodCull?.setSuppressed(true); } catch {}
    this.buildCityBuildings();
    this.buildCrushedTowers();
    this.buildMothership();
    this.buildLighting();

    // Bump the live-enemy cap so the director can actually maintain
    // ~70 ground enemies + 10 throne captains. Default is 50, which
    // would clamp the swarm and starve the wave director.
    try {
      this.prevMaxEnemies = this.enemySystem.getMaxEnemies();
      this.enemySystem.setMaxEnemies(120);
    } catch {}

    try { this.spawnInitialGarrison(); } catch (e) {
      console.warn("[AnnArborSystem] initial garrison failed", e);
    }

    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());

    this.bus.emit(
      GameEvents.UI_MESSAGE,
      "ANN ARBOR APOCALYPSE — A mothership has landed. Bring it down.",
    );
    console.log("[AnnArborSystem] Ann Arbor mounted");
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
    this.pulseMats = [];
    this.saucerRoot = null;
    this.throneCaptains = [];
    this.minions = [];
    if (this.prevMaxEnemies > 0) {
      try { this.enemySystem.setMaxEnemies(this.prevMaxEnemies); } catch {}
      this.prevMaxEnemies = 0;
    }
    this.restoreOuterWorld();
    try { this.root.dispose(); } catch {}
    console.log("[AnnArborSystem] Ann Arbor disposed");
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
    const c = AnnArborSystem.CENTER;
    const ground = BABYLON.MeshBuilder.CreateGround("annArborGround",
      { width: 1500, height: 1500, subdivisions: 1 }, this.scene);
    ground.position.set(c.x, 0, c.z);
    ground.parent = this.root;
    ground.isPickable = false;

    const groundMat = new BABYLON.StandardMaterial("annArborGroundMat", this.scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.14);
    groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
    groundMat.emissiveColor = new BABYLON.Color3(0.04, 0.04, 0.06);
    ground.material = groundMat;

    // Cracked-asphalt accent disc under the UFO landing zone — dark
    // ring of debris where the saucer's downwash has scorched the
    // pavement.
    const scorch = BABYLON.MeshBuilder.CreateDisc("annArborScorch",
      { radius: 180, tessellation: 32 }, this.scene);
    scorch.position.set(c.x, 0.04, c.z);
    scorch.rotation.x = Math.PI / 2;
    scorch.parent = this.root;
    scorch.isPickable = false;
    const scorchMat = new BABYLON.StandardMaterial("annArborScorchMat", this.scene);
    scorchMat.diffuseColor = new BABYLON.Color3(0.06, 0.05, 0.05);
    scorchMat.emissiveColor = new BABYLON.Color3(0.10, 0.04, 0.02);
    scorchMat.specularColor = new BABYLON.Color3(0, 0, 0);
    scorch.material = scorchMat;
  }

  /** Medium-sized city — ~28 buildings forming a partially-intact
   *  skyline around the central crater. Buildings are arranged in a
   *  loose grid pattern offset from the city center, with windows
   *  still glowing on the intact peripheral structures. */
  private buildCityBuildings(): void {
    const c = AnnArborSystem.CENTER;

    const wallMat = new BABYLON.StandardMaterial("annArborBldgWallMat", this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.22, 0.22, 0.26);
    wallMat.specularColor = new BABYLON.Color3(0.08, 0.08, 0.10);

    const wallMatB = new BABYLON.StandardMaterial("annArborBldgWallMatB", this.scene);
    wallMatB.diffuseColor = new BABYLON.Color3(0.28, 0.24, 0.22);
    wallMatB.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);

    const windowMat = new BABYLON.StandardMaterial("annArborWindowMat", this.scene);
    windowMat.diffuseColor = new BABYLON.Color3(0.40, 0.55, 0.70);
    windowMat.emissiveColor = new BABYLON.Color3(0.55, 0.75, 1.10);
    windowMat.specularColor = new BABYLON.Color3(0, 0, 0);

    // Pre-baked layout — buildings at radii 200–340 from center, in a
    // ring with 4 obvious gaps (the "streets" the player fights along).
    // Each entry: [angle_rad, radius, width, height, depth, matKey].
    const layouts: Array<[number, number, number, number, number, "A" | "B"]> = [
      // Outer ring — taller, more intact
      [0.10 * Math.PI * 2, 320, 38, 64, 32, "A"],
      [0.18 * Math.PI * 2, 300, 28, 52, 24, "B"],
      [0.27 * Math.PI * 2, 330, 42, 76, 36, "A"],
      [0.34 * Math.PI * 2, 290, 30, 48, 28, "B"],
      [0.42 * Math.PI * 2, 320, 36, 60, 30, "A"],
      [0.55 * Math.PI * 2, 310, 32, 56, 28, "B"],
      [0.62 * Math.PI * 2, 300, 28, 44, 24, "A"],
      [0.69 * Math.PI * 2, 330, 40, 70, 34, "B"],
      [0.78 * Math.PI * 2, 320, 34, 58, 30, "A"],
      [0.84 * Math.PI * 2, 290, 26, 42, 22, "B"],
      [0.92 * Math.PI * 2, 310, 38, 66, 32, "A"],
      [0.97 * Math.PI * 2, 330, 30, 50, 26, "B"],
      // Inner ring — shorter, more damaged
      [0.06 * Math.PI * 2, 230, 24, 36, 22, "B"],
      [0.22 * Math.PI * 2, 220, 28, 40, 26, "A"],
      [0.38 * Math.PI * 2, 240, 22, 32, 20, "B"],
      [0.51 * Math.PI * 2, 230, 26, 38, 24, "A"],
      [0.66 * Math.PI * 2, 240, 24, 34, 22, "B"],
      [0.81 * Math.PI * 2, 220, 28, 42, 26, "A"],
    ];

    for (let i = 0; i < layouts.length; i++) {
      const [ang, r, w, h, d, matKey] = layouts[i];
      const bx = c.x + Math.cos(ang) * r;
      const bz = c.z + Math.sin(ang) * r;

      const bldg = BABYLON.MeshBuilder.CreateBox(`annArborBldg_${i}`,
        { width: w, height: h, depth: d }, this.scene);
      bldg.position.set(bx, h / 2, bz);
      // Face buildings toward the city center.
      bldg.rotation.y = -ang + Math.PI / 2;
      bldg.parent = this.root;
      bldg.material = matKey === "A" ? wallMat : wallMatB;
      bldg.isPickable = false;

      // Window grid on the front face (facing center). 4 columns x N
      // rows — purely visual, no per-window collision.
      const cols = 4;
      const rows = Math.max(2, Math.floor(h / 9));
      const winW = w * 0.12;
      const winH = 2.0;
      const colSpacing = w / (cols + 1);
      const rowSpacing = (h - 6) / (rows + 1);
      for (let cI = 0; cI < cols; cI++) {
        for (let rI = 0; rI < rows; rI++) {
          // Keep ~1 in 4 windows dark for variety.
          if ((cI * 7 + rI * 3 + i) % 4 === 0) continue;
          const win = BABYLON.MeshBuilder.CreateBox(`annArborWin_${i}_${cI}_${rI}`,
            { width: winW, height: winH, depth: 0.3 }, this.scene);
          win.position.set(
            -w / 2 + colSpacing * (cI + 1),
            -h / 2 + 4 + rowSpacing * (rI + 1),
            -d / 2 - 0.16,
          );
          win.parent = bldg;
          win.material = windowMat;
          win.isPickable = false;
        }
      }
    }
  }

  /** The DOWNTOWN towers — 5 tall buildings at the dead center of the
   *  city, visibly crushed and leaning under the mothership's weight.
   *  Each is tilted toward the saucer center, with broken/jagged tops
   *  where the hull punched through. */
  private buildCrushedTowers(): void {
    const c = AnnArborSystem.CENTER;

    const towerMat = new BABYLON.StandardMaterial("annArborTowerMat", this.scene);
    towerMat.diffuseColor = new BABYLON.Color3(0.32, 0.30, 0.32);
    towerMat.specularColor = new BABYLON.Color3(0.10, 0.10, 0.10);

    const brokenMat = new BABYLON.StandardMaterial("annArborTowerBrokenMat", this.scene);
    brokenMat.diffuseColor = new BABYLON.Color3(0.18, 0.14, 0.12);
    brokenMat.emissiveColor = new BABYLON.Color3(0.30, 0.10, 0.04);
    brokenMat.specularColor = new BABYLON.Color3(0, 0, 0);

    // 5 towers around the saucer landing zone. Each tower's TOP is
    // crushed into the saucer above (saucer Y=130). Tilt angles are
    // slight (~6°) — enough to read "broken" without floating.
    const towers: Array<{ ang: number; r: number; w: number; h: number; tilt: number }> = [
      { ang: 0.00 * Math.PI * 2, r: 70, w: 24, h: 96, tilt: 0.10 },
      { ang: 0.20 * Math.PI * 2, r: 90, w: 20, h: 110, tilt: 0.08 },
      { ang: 0.45 * Math.PI * 2, r: 75, w: 26, h: 100, tilt: 0.11 },
      { ang: 0.65 * Math.PI * 2, r: 95, w: 22, h: 116, tilt: 0.07 },
      { ang: 0.85 * Math.PI * 2, r: 80, w: 20, h: 104, tilt: 0.09 },
    ];

    for (let i = 0; i < towers.length; i++) {
      const { ang, r, w, h, tilt } = towers[i];
      const bx = c.x + Math.cos(ang) * r;
      const bz = c.z + Math.sin(ang) * r;

      // Anchor at base — we tilt around the base so the top leans toward center.
      const anchor = new BABYLON.TransformNode(`annArborTowerAnchor_${i}`, this.scene);
      anchor.parent = this.root;
      anchor.position.set(bx, 0, bz);
      // Tilt the tower's TOP toward the city center (i.e. toward c).
      // Lean axis is perpendicular to the radial direction.
      const radial = new BABYLON.Vector3(Math.cos(ang), 0, Math.sin(ang));
      const leanAxis = BABYLON.Vector3.Cross(radial, BABYLON.Vector3.Up()).normalize();
      anchor.rotationQuaternion = BABYLON.Quaternion.RotationAxis(leanAxis, tilt);

      // Main shaft.
      const shaft = BABYLON.MeshBuilder.CreateBox(`annArborTowerShaft_${i}`,
        { width: w, height: h, depth: w }, this.scene);
      shaft.position.set(0, h / 2, 0);
      shaft.parent = anchor;
      shaft.material = towerMat;
      shaft.isPickable = false;

      // Jagged "broken" cap — wider, glowing ember underneath where the
      // saucer punched through.
      const cap = BABYLON.MeshBuilder.CreateBox(`annArborTowerCap_${i}`,
        { width: w * 1.3, height: 6, depth: w * 1.3 }, this.scene);
      cap.position.set(0, h - 1, 0);
      cap.parent = anchor;
      cap.material = brokenMat;
      cap.isPickable = false;
      cap.rotation.y = i * 0.31;

      // A sliver of "exposed structural beam" stub poking up off-center
      // sells the "snapped" look.
      const beam = BABYLON.MeshBuilder.CreateBox(`annArborTowerBeam_${i}`,
        { width: 1.4, height: 8, depth: 1.4 }, this.scene);
      beam.position.set(w * 0.25 * (i % 2 === 0 ? 1 : -1), h + 4, w * 0.15);
      beam.parent = anchor;
      beam.material = brokenMat;
      beam.isPickable = false;
    }
  }

  /** The giant alien mothership — a flying saucer ~320 m diameter
   *  hovering at y=130, embedded into the broken tower tops. Two
   *  flattened ellipsoids form the upper + lower hull, a central dome
   *  on top, a ring of glowing under-lights, and antenna spires for
   *  silhouette. The saucer slowly rotates around Y for menace. */
  private buildMothership(): void {
    const c = AnnArborSystem.CENTER;
    const Y = AnnArborSystem.SAUCER_Y;
    const R = AnnArborSystem.SAUCER_RADIUS;

    const saucerRoot = new BABYLON.TransformNode("annArborSaucerRoot", this.scene);
    saucerRoot.parent = this.root;
    saucerRoot.position.set(c.x, Y, c.z);
    this.saucerRoot = saucerRoot;

    const hullMat = new BABYLON.StandardMaterial("annArborHullMat", this.scene);
    hullMat.diffuseColor = new BABYLON.Color3(0.18, 0.20, 0.24);
    hullMat.specularColor = new BABYLON.Color3(0.50, 0.55, 0.60);
    hullMat.emissiveColor = new BABYLON.Color3(0.05, 0.06, 0.08);

    const underlightMat = new BABYLON.StandardMaterial("annArborUnderlightMat", this.scene);
    underlightMat.diffuseColor = new BABYLON.Color3(0.50, 0.10, 0.50);
    underlightMat.emissiveColor = new BABYLON.Color3(1.4, 0.20, 1.6);
    underlightMat.specularColor = new BABYLON.Color3(0, 0, 0);
    this.pulseMats.push({
      mat: underlightMat,
      baseR: 1.4, baseG: 0.20, baseB: 1.6,
      phase: 0,
    });

    const domeMat = new BABYLON.StandardMaterial("annArborDomeMat", this.scene);
    domeMat.diffuseColor = new BABYLON.Color3(0.40, 0.60, 0.90);
    domeMat.emissiveColor = new BABYLON.Color3(0.30, 0.55, 1.00);
    domeMat.alpha = 0.85;
    domeMat.specularColor = new BABYLON.Color3(0.80, 0.90, 1.00);
    this.pulseMats.push({
      mat: domeMat,
      baseR: 0.30, baseG: 0.55, baseB: 1.00,
      phase: Math.PI / 2,
    });

    // --- Lower hull (squashed ellipsoid forming the saucer's underside).
    const lower = BABYLON.MeshBuilder.CreateSphere("annArborSaucerLower",
      { diameter: R * 2, segments: 32 }, this.scene);
    lower.scaling.set(1, 0.18, 1); // very flat
    lower.position.set(0, -2, 0);
    lower.parent = saucerRoot;
    lower.material = hullMat;
    lower.isPickable = false;

    // --- Upper hull (slightly smaller, sits on top).
    const upper = BABYLON.MeshBuilder.CreateSphere("annArborSaucerUpper",
      { diameter: R * 2 * 0.78, segments: 32 }, this.scene);
    upper.scaling.set(1, 0.32, 1);
    upper.position.set(0, 12, 0);
    upper.parent = saucerRoot;
    upper.material = hullMat;
    upper.isPickable = false;

    // --- Central dome on top — the ship's "command bubble".
    const dome = BABYLON.MeshBuilder.CreateSphere("annArborSaucerDome",
      { diameter: 50, segments: 24 }, this.scene);
    dome.scaling.set(1, 0.60, 1);
    dome.position.set(0, 28, 0);
    dome.parent = saucerRoot;
    dome.material = domeMat;
    dome.isPickable = false;

    // --- Captains stand on the upper deck — give them a flat
    // "platform" disc around the dome so they look anchored.
    const deck = BABYLON.MeshBuilder.CreateCylinder("annArborSaucerDeck",
      { height: 0.6, diameter: 100, tessellation: 32 }, this.scene);
    deck.position.set(0, 21.5, 0);
    deck.parent = saucerRoot;
    deck.material = hullMat;
    deck.isPickable = false;

    // --- Underside ring of glowing lights (24 spheres around the rim).
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const lightR = R * 0.94;
      const orb = BABYLON.MeshBuilder.CreateSphere(`annArborSaucerOrb_${i}`,
        { diameter: 6, segments: 10 }, this.scene);
      orb.position.set(Math.cos(a) * lightR, -10, Math.sin(a) * lightR);
      orb.parent = saucerRoot;
      orb.material = underlightMat;
      orb.isPickable = false;
    }

    // --- 4 antenna spires off the top (silhouette character).
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const sx = Math.cos(a) * 18;
      const sz = Math.sin(a) * 18;
      const spire = BABYLON.MeshBuilder.CreateCylinder(`annArborSaucerSpire_${i}`,
        { height: 22, diameterTop: 0.4, diameterBottom: 1.2, tessellation: 8 }, this.scene);
      spire.position.set(sx, 38, sz);
      spire.parent = saucerRoot;
      spire.material = hullMat;
      spire.isPickable = false;
    }

    // --- Single large pointlight from the saucer's underside, lighting
    // the city floor with a sickly purple cast.
    const downlight = new BABYLON.PointLight("annArborSaucerDownlight",
      new BABYLON.Vector3(c.x, Y - 30, c.z), this.scene);
    downlight.diffuse = new BABYLON.Color3(0.85, 0.30, 1.10);
    downlight.intensity = 1.0;
    downlight.range = 280;
    downlight.parent = this.root;
  }

  private buildLighting(): void {
    const c = AnnArborSystem.CENTER;

    const ambient = new BABYLON.HemisphericLight("annArborAmbient",
      new BABYLON.Vector3(0, 1, 0), this.scene);
    ambient.diffuse = new BABYLON.Color3(0.32, 0.28, 0.40);
    ambient.intensity = 0.32;
    ambient.parent = this.root;

    // A cool key-light from the east (bleeds along the streets).
    const key = new BABYLON.DirectionalLight("annArborKey",
      new BABYLON.Vector3(-0.6, -0.7, -0.3), this.scene);
    key.diffuse = new BABYLON.Color3(0.55, 0.60, 0.85);
    key.intensity = 0.5;
    key.parent = this.root;
    void c;
  }

  // ------------------------------------------------------------ combat

  /** Initial garrison — 10 maxed-out captains on the saucer's upper
   *  deck (around the dome) + a thick ground swarm with one of EVERY
   *  robot type so the player drops into chaos. */
  private spawnInitialGarrison(): void {
    const c = AnnArborSystem.CENTER;
    const variants: BossVariantId[] = ["frost", "void", "plague", "inferno", "storm"];

    // 10 maxed captains on top of the UFO, ringing the dome at deck Y.
    const deckY = AnnArborSystem.SAUCER_Y + 22;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = 38; // just outside the dome
      const pos = new BABYLON.Vector3(c.x + Math.cos(a) * r, deckY, c.z + Math.sin(a) * r);
      try {
        const cap = this.enemySystem.spawnCaptain(pos, {
          variantId: variants[i % variants.length],
          // Maxed out — well beyond Zug's 1.4× captains.
          healthMultiplier: 2.6,
        });
        // Pin to the saucer deck — overrides updateChase's y=1.5 ground
        // snap so the player must fly up to engage them.
        if (cap) {
          cap.keepAirborneY = deckY;
          this.throneCaptains.push(cap);
        }
        this.spawnedTotal += 1;
      } catch (e) {
        console.warn("[AnnArborSystem] throne captain spawn failed", e);
      }
    }

    // Ground swarm — one of every robot type, ringing the player.
    // EnemyType: drone | soldier | heavy | insectoid | hybrid |
    // commander | captain | tank | titan | spider_tank.
    const groundTypes: EnemyType[] = [
      "drone", "drone", "drone",
      "soldier", "soldier", "soldier",
      "heavy", "heavy",
      "insectoid", "insectoid",
      "hybrid",
      "commander",
      "tank",
      "titan",
      "spider_tank",
    ];
    for (let i = 0; i < groundTypes.length; i++) {
      const type = groundTypes[i];
      const a = (i / groundTypes.length) * Math.PI * 2 + Math.PI / 9;
      const r = AnnArborSystem.ARENA_R - 60 - (i % 4) * 20;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      const y = type === "spider_tank" ? 3.5 : type === "drone" ? 14 : 1.5;
      this.trySpawn(type, new BABYLON.Vector3(x, y, z));
    }
  }

  /** Wave director — drips ground-swarm reinforcements (every robot
   *  type EXCEPT captain/titan, which would trivialize density). The
   *  10 throne captains on the UFO never respawn. */
  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTickMs) / 1000);
    this.lastTickMs = now;

    // Saucer slow Y-rotation (1 full turn per ~120s).
    if (this.saucerRoot) {
      this.saucerRoot.rotation.y += dt * (Math.PI * 2 / 120);
    }

    // Re-assert the raised population cap every tick. EnemySystem.nextWave()
    // clamps maxEnemies back down to ≤50 every 60s, which would otherwise
    // re-introduce the "~70 LIVE_TARGET unreachable" regression.
    try {
      if (this.enemySystem.getMaxEnemies() < 120) {
        this.enemySystem.setMaxEnemies(120);
      }
    } catch {}

    // Defense in depth: re-anchor any throne captain that drifts off the
    // deck altitude (knockback / dodging / FX displacement). updateChase
    // already respects keepAirborneY, but other state branches might not.
    const deckY = AnnArborSystem.SAUCER_Y + 22;
    for (const cap of this.throneCaptains) {
      if (!cap || !cap.isAlive) continue;
      const m = cap.mesh;
      if (!m || m.isDisposed()) continue;
      if (Math.abs(m.position.y - deckY) > 0.5) {
        m.position.y = deckY;
      }
    }

    // Pulse UFO underlights / dome glow between 60% and 130% of base —
    // additive lerp, NOT multiplicative decay (avoids the Zug emberMats
    // shrinking-toward-zero quirk).
    const t = now * 0.001;
    for (const p of this.pulseMats) {
      const k = 0.95 + 0.35 * Math.sin(t * 1.1 + p.phase);
      p.mat.emissiveColor.copyFromFloats(p.baseR * k, p.baseG * k, p.baseB * k);
    }

    if (this.spawnedTotal >= AnnArborSystem.LIFETIME_CAP) return;

    this.waveTimer += dt;
    if (this.waveTimer < AnnArborSystem.WAVE_INTERVAL) return;
    this.waveTimer = 0;

    const live = this.countLive();
    if (live >= AnnArborSystem.LIVE_TARGET) return;

    const c = AnnArborSystem.CENTER;
    const want = Math.min(
      AnnArborSystem.SPAWNS_PER_TICK,
      AnnArborSystem.LIVE_TARGET - live,
      AnnArborSystem.LIFETIME_CAP - this.spawnedTotal,
    );

    // Weighted ground-swarm roll: mostly drones/soldiers/heavies with
    // occasional insectoids/hybrids/commanders/tanks/spider tanks.
    for (let i = 0; i < want; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = AnnArborSystem.ARENA_R - 18 - Math.random() * 30;
      const x = c.x + Math.cos(ang) * r;
      const z = c.z + Math.sin(ang) * r;

      const roll = Math.random();
      let type: EnemyType;
      let y = 1.5;
      if (roll < 0.30) { type = "drone"; y = 14; }
      else if (roll < 0.55) type = "soldier";
      else if (roll < 0.72) type = "heavy";
      else if (roll < 0.82) type = "insectoid";
      else if (roll < 0.90) type = "hybrid";
      else if (roll < 0.95) { type = "commander"; }
      else if (roll < 0.98) type = "tank";
      else { type = "spider_tank"; y = 3.5; }

      this.trySpawn(type, new BABYLON.Vector3(x, y, z));
    }
  }

  private trySpawn(type: EnemyType, pos: BABYLON.Vector3): void {
    try {
      const u = this.enemySystem.spawnEnemyAt(type, pos);
      if (u) {
        this.spawnedTotal += 1;
        this.minions.push(u);
      }
    } catch (e) {
      console.warn(`[AnnArborSystem] spawnEnemyAt(${type}) failed`, e);
    }
  }

  /** Live count of THIS zone's ground swarm only — captains, titans, and
   *  any unrelated global enemies are excluded so the wave director's
   *  ~70 LIVE_TARGET is measured against the same pool it spawns into. */
  private countLive(): number {
    let live = 0;
    for (const m of this.minions) {
      if (!m || !m.isAlive) continue;
      // Defensively exclude captains/titans — the design intent is to
      // measure the swarm pool only. The initial garrison includes one
      // titan and one spider tank we still WANT to count toward swarm
      // density (so the director doesn't double-spawn at warp-in), but
      // we exclude titan from the recurring pool so the wave director
      // refills with the lighter ground roster instead.
      if (m.type === "captain" || m.type === "titan") continue;
      live += 1;
    }
    // Compact occasionally so the array doesn't grow unbounded over the
    // lifetime of the level.
    if (this.minions.length > 256) {
      this.minions = this.minions.filter(m => m && m.isAlive);
    }
    return live;
  }
}
