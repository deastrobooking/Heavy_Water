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

  private static readonly CENTER = new BABYLON.Vector3(0, 0, 0);
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

    const heapCount = 16;
    for (let i = 0; i < heapCount; i++) {
      const ang = (i / heapCount) * Math.PI * 2 + 0.13;
      const r = ZugIslandSystem.ARENA_R + 8 + (i % 3) * 6;
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

    const positions: Array<[number, number]> = [
      [-70, -55], [70, -55], [-70, 55], [70, 55],
      [-95, 0], [95, 0],
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

    const stackCount = 10;
    for (let i = 0; i < stackCount; i++) {
      const ang = (i / stackCount) * Math.PI * 2 + 0.27;
      const r = ZugIslandSystem.ARENA_R + 35;
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
