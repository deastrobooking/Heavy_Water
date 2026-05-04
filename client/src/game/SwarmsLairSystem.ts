import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import type { CityGenerator } from "./CityGenerator";
import type { EnemySystem } from "./EnemySystem";

/** Optional handles SwarmsLairSystem hides on mount + restores on dispose
 *  so Level 7 reads as a *truly distinct* indoor cave world. Identical
 *  shape to PontiacLabHandles / SanctuaryHandles — passing the same
 *  visibility bag keeps the four side-zones structurally consistent. */
export interface SwarmsLairHandles {
  city?: CityGenerator | null;
  worldVisibles?: Array<{ setVisible(visible: boolean): void } | null | undefined>;
  /** Optional LOD culler. Suppressed while the lair is mounted so hidden
   *  city meshes can't pop back in if the player wanders far enough that
   *  the analytical falloff would otherwise un-cull them. */
  lodCull?: { setSuppressed(b: boolean): void } | null;
}

/**
 * SwarmsLairSystem
 * ================
 * Owns the entire Swarms Lair side-zone (Level 7) — the underground cave
 * arena reachable from the Pontiac Lab cave hatch (or from the TRAVEL
 * tab once Level 7 is unlocked).
 *
 * Geometry:
 *   - Dark rocky floor + low jagged ceiling (hides the world above).
 *   - Octagonal arena ringed by 8 tall stone pillars + ~24 stalactite
 *     spikes hanging from the ceiling.
 *   - Glowing red cave crystals scattered around the perimeter for
 *     ambient lighting.
 *   - A short entry chamber south of the arena (where the player warps
 *     in) connected to the main arena by a wide tunnel.
 *
 * Combat:
 *   - Spawns ~10 insectoid swarm minions ringing the arena edges on
 *     mount. Standard EnemySystem AI takes over from there.
 *   - Spawns the unique General Voidcrown captain at the back of the
 *     arena (north). Uses `enemySystem.spawnCaptain` with the
 *     `humanoidPreset: "HumanoidGeneralVoidcrown"` override so the
 *     player sees the dedicated General silhouette rather than one of
 *     the four standard captain presets.
 *   - Listens for ENEMY_KILLED. When the dead enemy is the General we
 *     spawned (matched by `isBossCaptain` and proximity to our spawn
 *     point), fires SWARMS_GENERAL_DEFEATED — Game.tsx persists the
 *     defeat flag and re-checks the legendary-companion grant.
 *
 * Lifecycle: mounted by Game.tsx when LEVEL_STARTED fires for level 7
 * (`isLair`); disposed when the player fast-travels out. The mount is
 * idempotent — re-entering the lair doesn't clone meshes.
 */
export class SwarmsLairSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private playerPos: () => BABYLON.Vector3;
  private enemySystem: EnemySystem;

  /** Top-level transform — disposing this kills every mesh we spawned. */
  private root: BABYLON.TransformNode;
  /** Pulsing crystal materials. Animated by the per-frame observer for
   *  cheap "live cave" ambience. */
  private pulsers: { mat: BABYLON.StandardMaterial; base: BABYLON.Color3; phase: number; speed: number }[] = [];
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  /** Bag of world systems hidden on mount; restored on dispose. */
  private handles: SwarmsLairHandles;
  private hiddenVisibles: Array<{ setVisible(v: boolean): void }> = [];
  private cityHidden: boolean = false;

  /** Subscribed to ENEMY_KILLED. Held as a field so dispose() can
   *  detach it cleanly even if the General never died. */
  private onEnemyKilled: ((data: any) => void) | null = null;
  /** True once SWARMS_GENERAL_DEFEATED has fired in this mount — guards
   *  against any double-fire from the kill listener. */
  private generalSlain: boolean = false;
  /** World-space spot we placed the General at — used by the kill
   *  listener to verify a captain death is the General (not some other
   *  captain that wandered in from a stale reference). */
  private generalSpawnPos: BABYLON.Vector3 | null = null;

  /** Lair footprint center — matches LevelSystem.spawnPoint for L7. */
  private static readonly CENTER = new BABYLON.Vector3(0, 0, 0);
  /** Half-extent of the main arena (octagon outer radius). */
  private static readonly ARENA_R = 40;
  /** Cave ceiling height — low enough that the player reads "underground"
   *  but tall enough that triple-jump + flight still feel viable. */
  private static readonly CEILING_Y = 22;
  /** General spawn offset along +Z (back of the arena from the player's
   *  south-side warp-in point). Matches the kill-detection radius below. */
  private static readonly GENERAL_OFFSET = 28;
  /** How close a captain death must be to `generalSpawnPos` to count as
   *  the General. Generous because the General is highly mobile in combat. */
  private static readonly GENERAL_KILL_RADIUS = 200;

  constructor(
    scene: BABYLON.Scene,
    enemySystem: EnemySystem,
    playerPosProvider: () => BABYLON.Vector3,
    handles: SwarmsLairHandles = {},
    /** When true, skip spawning General Voidcrown (and the kill-listener
     *  that would re-fire SWARMS_GENERAL_DEFEATED). The arena's swarm
     *  minions still spawn so the cave isn't empty on revisit. Persisted
     *  via ProgressSnapshot.swarmsGeneralDefeated. */
    alreadyDefeated: boolean = false,
  ) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.playerPos = playerPosProvider;
    this.enemySystem = enemySystem;
    this.handles = handles;

    this.root = new BABYLON.TransformNode("swarmsLairRoot", scene);

    // Build OUR floor/ceiling first, then hide the city + mountains +
    // foliage so Level 7 reads as a self-contained cave system rather
    // than a corner of Detroit.
    this.buildFloorAndCeiling();
    this.hideOuterWorld();
    try { this.handles.lodCull?.setSuppressed(true); } catch {}
    this.buildArenaPillars();
    this.buildStalactites();
    this.buildCrystals();
    this.buildEntryTunnel();
    this.buildLighting();

    // Spawn the General + the swarm. Captured into a try/catch so a
    // bad enemy spawn can't strand the player on a half-built cave.
    // When `alreadyDefeated` is true (re-entry after a prior kill) we
    // skip the General entirely and only spawn the swarm, then never
    // attach the kill-listener so we don't re-fire DEFEATED twice.
    try { this.spawnGeneralAndSwarm(alreadyDefeated); } catch (e) {
      console.warn("[SwarmsLairSystem] swarm spawn failed", e);
    }

    // Only listen for ENEMY_KILLED while the General is in play. After a
    // prior kill, the listener is unnecessary (no General to detect) AND
    // dangerous (a future captain death anywhere in the arena could
    // re-fire DEFEATED on top of an already-granted legendary).
    if (!alreadyDefeated) {
      this.onEnemyKilled = (data: any) => this.handleEnemyKilled(data);
      this.bus.on(GameEvents.ENEMY_KILLED, this.onEnemyKilled);
    }

    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());

    this.bus.emit(
      GameEvents.UI_MESSAGE,
      alreadyDefeated
        ? "SWARMS LAIR — the General is dead. Stragglers remain."
        : "SWARMS LAIR — find the General. End this.",
    );
    console.log("[SwarmsLairSystem] Swarms Lair mounted (alreadyDefeated=", alreadyDefeated, ")");
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
    if (this.onEnemyKilled) {
      try { this.bus.off(GameEvents.ENEMY_KILLED, this.onEnemyKilled); } catch {}
      this.onEnemyKilled = null;
    }
    this.pulsers = [];
    this.generalSpawnPos = null;
    // Restore the outer world we hid on mount BEFORE root.dispose so any
    // mistake here doesn't strand the player on a black void.
    this.restoreOuterWorld();
    try { this.root.dispose(); } catch {}
    console.log("[SwarmsLairSystem] Swarms Lair disposed");
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

  /** Wide rocky floor + a low jagged ceiling. The floor is a single big
   *  ground mesh tinted a dark cave brown; the ceiling is a flat box
   *  positioned at CEILING_Y so the player reads the room as enclosed. */
  private buildFloorAndCeiling(): void {
    const c = SwarmsLairSystem.CENTER;

    const floor = BABYLON.MeshBuilder.CreateGround(
      "lairFloor",
      { width: 1500, height: 1500, subdivisions: 1 },
      this.scene,
    );
    floor.position.set(c.x, 0.02, c.z);
    floor.parent = this.root;
    floor.isPickable = false;
    floor.receiveShadows = false;
    const floorMat = new BABYLON.StandardMaterial("lairFloorMat", this.scene);
    floorMat.diffuseColor = new BABYLON.Color3(0.18, 0.10, 0.10);
    floorMat.emissiveColor = new BABYLON.Color3(0.05, 0.02, 0.02);
    floorMat.specularColor = new BABYLON.Color3(0.04, 0.02, 0.02);
    floor.material = floorMat;

    // Inner combat disc — slightly raised so the arena footprint reads
    // distinct from the surrounding cave floor.
    const disc = BABYLON.MeshBuilder.CreateDisc(
      "lairArenaDisc",
      { radius: SwarmsLairSystem.ARENA_R, tessellation: 8 },
      this.scene,
    );
    disc.position.set(c.x, 0.04, c.z);
    disc.rotation.x = Math.PI / 2;
    disc.parent = this.root;
    disc.isPickable = false;
    const discMat = new BABYLON.StandardMaterial("lairArenaDiscMat", this.scene);
    discMat.diffuseColor = new BABYLON.Color3(0.22, 0.10, 0.12);
    discMat.emissiveColor = new BABYLON.Color3(0.18, 0.05, 0.08);
    discMat.specularColor = new BABYLON.Color3(0, 0, 0);
    disc.material = discMat;

    // Low jagged ceiling — a flat slab tinted the same cave-brown as the
    // floor. CEILING_Y sits well above triple-jump apex so flight still
    // works inside the arena.
    const ceiling = BABYLON.MeshBuilder.CreateBox(
      "lairCeiling",
      { width: 240, height: 2, depth: 240 },
      this.scene,
    );
    ceiling.position.set(c.x, SwarmsLairSystem.CEILING_Y, c.z);
    ceiling.parent = this.root;
    ceiling.isPickable = false;
    const ceilMat = new BABYLON.StandardMaterial("lairCeilingMat", this.scene);
    ceilMat.diffuseColor = new BABYLON.Color3(0.08, 0.05, 0.05);
    ceilMat.specularColor = new BABYLON.Color3(0, 0, 0);
    ceiling.material = ceilMat;
  }

  /** Eight tall stone pillars arranged around the arena edge so the
   *  player reads the boundary at a glance. Each pillar is a parametric
   *  stack of three boxes — wide base, narrower middle, tall top — to
   *  break up the silhouette without spending real geometry on it. */
  private buildArenaPillars(): void {
    const c = SwarmsLairSystem.CENTER;
    const R = SwarmsLairSystem.ARENA_R;

    const stoneMat = new BABYLON.StandardMaterial("lairStoneMat", this.scene);
    stoneMat.diffuseColor = new BABYLON.Color3(0.30, 0.20, 0.20);
    stoneMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

    const stoneDarkMat = new BABYLON.StandardMaterial("lairStoneDarkMat", this.scene);
    stoneDarkMat.diffuseColor = new BABYLON.Color3(0.18, 0.12, 0.12);
    stoneDarkMat.specularColor = new BABYLON.Color3(0, 0, 0);

    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const x = c.x + Math.cos(ang) * R;
      const z = c.z + Math.sin(ang) * R;

      const baseBlock = BABYLON.MeshBuilder.CreateBox(`lairPillarBase_${i}`,
        { width: 5, height: 4, depth: 5 }, this.scene);
      baseBlock.position.set(x, 2, z);
      baseBlock.parent = this.root;
      baseBlock.isPickable = false;
      baseBlock.material = stoneMat;

      const midBlock = BABYLON.MeshBuilder.CreateBox(`lairPillarMid_${i}`,
        { width: 4, height: 8, depth: 4 }, this.scene);
      midBlock.position.set(x, 8, z);
      midBlock.parent = this.root;
      midBlock.isPickable = false;
      midBlock.material = stoneDarkMat;

      const topBlock = BABYLON.MeshBuilder.CreateBox(`lairPillarTop_${i}`,
        { width: 3, height: 10, depth: 3 }, this.scene);
      topBlock.position.set(x, 17, z);
      topBlock.parent = this.root;
      topBlock.isPickable = false;
      topBlock.material = stoneMat;
    }

    // A wider outer wall ring (24 segments of jagged rock) so the eye
    // doesn't see straight off into the void past the pillars.
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const x = c.x + Math.cos(ang) * (R + 12);
      const z = c.z + Math.sin(ang) * (R + 12);
      const wallChunk = BABYLON.MeshBuilder.CreateBox(`lairWallChunk_${i}`,
        { width: 6 + Math.random() * 4, height: 14 + Math.random() * 6, depth: 6 + Math.random() * 4 },
        this.scene);
      wallChunk.position.set(x, 7 + Math.random() * 3, z);
      wallChunk.rotation.y = Math.random() * Math.PI;
      wallChunk.parent = this.root;
      wallChunk.isPickable = false;
      wallChunk.material = stoneDarkMat;
    }
  }

  /** ~24 stalactite spikes hanging from the ceiling at varying heights.
   *  Pure decoration — they help sell the underground feel and break up
   *  the otherwise flat ceiling slab. */
  private buildStalactites(): void {
    const c = SwarmsLairSystem.CENTER;
    const stalMat = new BABYLON.StandardMaterial("lairStalMat", this.scene);
    stalMat.diffuseColor = new BABYLON.Color3(0.22, 0.14, 0.14);
    stalMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const count = 24;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      // Random radius inside the arena footprint, biased toward the edge
      // so the player's combat space stays clear.
      const r = 12 + Math.random() * (SwarmsLairSystem.ARENA_R - 6);
      const x = c.x + Math.cos(ang) * r;
      const z = c.z + Math.sin(ang) * r;
      const len = 3 + Math.random() * 4;
      const cone = BABYLON.MeshBuilder.CreateCylinder(`lairStal_${i}`,
        { height: len, diameterTop: 1.4, diameterBottom: 0.2, tessellation: 8 },
        this.scene);
      cone.position.set(x, SwarmsLairSystem.CEILING_Y - len / 2 - 1, z);
      cone.parent = this.root;
      cone.isPickable = false;
      cone.material = stalMat;
    }
  }

  /** Glowing red cave crystals scattered around the arena perimeter for
   *  ambient lighting + visual interest. Each crystal is registered as
   *  a pulser so its emissive throbs over time. */
  private buildCrystals(): void {
    const c = SwarmsLairSystem.CENTER;
    const count = 12;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.PI / count;
      const r = SwarmsLairSystem.ARENA_R - 4;
      const x = c.x + Math.cos(ang) * r;
      const z = c.z + Math.sin(ang) * r;

      const mat = new BABYLON.StandardMaterial(`lairCrystalMat_${i}`, this.scene);
      mat.diffuseColor = new BABYLON.Color3(0.85, 0.20, 0.30);
      mat.emissiveColor = new BABYLON.Color3(1.0, 0.30, 0.35);
      mat.specularColor = new BABYLON.Color3(0, 0, 0);

      const crystal = BABYLON.MeshBuilder.CreatePolyhedron(`lairCrystal_${i}`,
        { type: 1, size: 0.9 + Math.random() * 0.6 }, this.scene);
      crystal.position.set(x, 1.2, z);
      crystal.rotation.y = Math.random() * Math.PI;
      crystal.parent = this.root;
      crystal.isPickable = false;
      crystal.material = mat;

      this.pulsers.push({
        mat,
        base: mat.emissiveColor.clone(),
        phase: i * 0.7,
        speed: 1.4 + (i % 3) * 0.4,
      });
    }
  }

  /** Short entry chamber south of the arena. Built as two short walls
   *  flanking a 12 m wide tunnel so the warp-in spot reads as "you
   *  arrived through this passage". */
  private buildEntryTunnel(): void {
    const c = SwarmsLairSystem.CENTER;
    const wallMat = new BABYLON.StandardMaterial("lairTunnelWallMat", this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.16, 0.10, 0.10);
    wallMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const tunnelLen = 30;
    const tunnelHalfWidth = 7;
    const tunnelZ0 = c.z - SwarmsLairSystem.ARENA_R - 4;

    for (const sx of [-1, 1]) {
      const wall = BABYLON.MeshBuilder.CreateBox(`lairTunnelWall_${sx}`,
        { width: 2, height: 14, depth: tunnelLen }, this.scene);
      wall.position.set(c.x + sx * tunnelHalfWidth, 7, tunnelZ0 - tunnelLen / 2);
      wall.parent = this.root;
      wall.isPickable = false;
      wall.material = wallMat;
    }

    // Tunnel ceiling — same low slab as the main arena so the player
    // can't fly straight up out of the entry chamber.
    const ceil = BABYLON.MeshBuilder.CreateBox("lairTunnelCeil",
      { width: tunnelHalfWidth * 2 + 4, height: 1.5, depth: tunnelLen + 2 }, this.scene);
    ceil.position.set(c.x, SwarmsLairSystem.CEILING_Y - 4, tunnelZ0 - tunnelLen / 2);
    ceil.parent = this.root;
    ceil.isPickable = false;
    ceil.material = wallMat;
  }

  /** Two PointLights inside the arena so the crystal red catches on the
   *  dark stone walls + the General's void-armor reads from across the
   *  room. Without them the cave looks flat-shaded. */
  private buildLighting(): void {
    const c = SwarmsLairSystem.CENTER;

    const front = new BABYLON.PointLight("lairLightFront",
      new BABYLON.Vector3(c.x, SwarmsLairSystem.CEILING_Y - 6, c.z - 12), this.scene);
    front.diffuse = new BABYLON.Color3(1.0, 0.30, 0.35);
    front.intensity = 0.7;
    front.range = 80;
    front.parent = this.root;

    const back = new BABYLON.PointLight("lairLightBack",
      new BABYLON.Vector3(c.x, SwarmsLairSystem.CEILING_Y - 6, c.z + 18), this.scene);
    back.diffuse = new BABYLON.Color3(0.85, 0.10, 0.45);
    back.intensity = 0.6;
    back.range = 80;
    back.parent = this.root;

    const ambient = new BABYLON.HemisphericLight("lairLightAmbient",
      new BABYLON.Vector3(0, 1, 0), this.scene);
    ambient.diffuse = new BABYLON.Color3(0.30, 0.18, 0.22);
    ambient.intensity = 0.30;
    ambient.parent = this.root;
  }

  // -------------------------------------------------------- combat

  /** Place the General at the back of the arena and ring the perimeter
   *  with insectoid swarm minions. Called once on mount — subsequent
   *  re-spawns are owned by the EnemySystem wave spawner if/when it's
   *  re-engaged later. */
  private spawnGeneralAndSwarm(alreadyDefeated: boolean): void {
    const c = SwarmsLairSystem.CENTER;

    // General Voidcrown — back of the arena (north). Skipped on revisit
    // (alreadyDefeated) so the boss stays dead across reloads. The swarm
    // minions still spawn so the cave doesn't read as empty.
    if (!alreadyDefeated) {
      // isBossCaptain so the death payload has the flag we listen for
      // in handleEnemyKilled, and humanoidPreset locks the visual to
      // the dedicated General rig.
      const generalPos = new BABYLON.Vector3(c.x, 1.5, c.z + SwarmsLairSystem.GENERAL_OFFSET);
      this.generalSpawnPos = generalPos.clone();
      this.enemySystem.spawnCaptain(generalPos, {
        isBossCaptain: true,
        variantId: "void",
        humanoidPreset: "HumanoidGeneralVoidcrown",
        // 2.5x captain HP — the General is a post-campaign challenge boss.
        healthMultiplier: 2.5,
      });
    } else {
      // Mark slain so even a future ENEMY_KILLED fan never re-fires the
      // grant — defense-in-depth alongside the constructor's listener
      // skip when alreadyDefeated is true.
      this.generalSlain = true;
    }

    // ~10 insectoid swarmers ringed around the arena edge so the player
    // reads "the swarm" the moment they enter. Spread evenly so combat
    // doesn't bunch on one side.
    const swarmCount = 10;
    for (let i = 0; i < swarmCount; i++) {
      const ang = (i / swarmCount) * Math.PI * 2;
      const r = SwarmsLairSystem.ARENA_R - 8;
      const x = c.x + Math.cos(ang) * r;
      const z = c.z + Math.sin(ang) * r;
      // Stagger spawn altitude slightly so the bugs don't overlap-Z fight.
      this.enemySystem.spawnEnemyAt("insectoid", new BABYLON.Vector3(x, 1.5, z));
    }
  }

  /** ENEMY_KILLED listener. Fires SWARMS_GENERAL_DEFEATED exactly once
   *  per mount when the dead enemy was the General we spawned. */
  private handleEnemyKilled(data: any): void {
    if (this.generalSlain) return;
    if (!data) return;
    if (data.isBossCaptain !== true) return;
    if (!this.generalSpawnPos) return;

    // Verify the kill happened reasonably near our General spawn — keeps
    // an unrelated boss-captain death (e.g. a stale boss-fortress chain
    // that somehow fires while L7 is mounted) from triggering the grant.
    const pos = data.position;
    if (pos && typeof pos.x === "number" && typeof pos.z === "number") {
      const dx = pos.x - this.generalSpawnPos.x;
      const dz = pos.z - this.generalSpawnPos.z;
      if (dx * dx + dz * dz > SwarmsLairSystem.GENERAL_KILL_RADIUS * SwarmsLairSystem.GENERAL_KILL_RADIUS) {
        return;
      }
    }

    this.generalSlain = true;
    this.bus.emit(GameEvents.SWARMS_GENERAL_DEFEATED, {
      position: pos ?? { x: this.generalSpawnPos.x, y: this.generalSpawnPos.y, z: this.generalSpawnPos.z },
    });
    this.bus.emit(GameEvents.UI_MESSAGE, "GENERAL VOIDCROWN — DOWN");
    console.log("[SwarmsLairSystem] General Voidcrown defeated");
  }

  /** Per-frame pulse for the cave crystals. Cheap — twelve sinf calls. */
  private tick(): void {
    const t = performance.now() * 0.001;
    for (const p of this.pulsers) {
      const k = 0.65 + 0.35 * Math.sin(t * p.speed + p.phase);
      p.mat.emissiveColor.copyFromFloats(p.base.r * k, p.base.g * k, p.base.b * k);
    }
  }
}
