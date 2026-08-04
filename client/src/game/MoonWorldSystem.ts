import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import type { CityGenerator } from "./CityGenerator";
import type { EnemySystem, EnemyUnit } from "./EnemySystem";
import type { SkySystem } from "./SkySystem";
import type { PlayerController } from "./PlayerController";

export interface MoonWorldHandles {
  city?: CityGenerator | null;
  worldVisibles?: Array<{ setVisible(visible: boolean): void } | null | undefined>;
  lodCull?: { setSuppressed(b: boolean): void } | null;
}

/** Persisted villain-campaign progress slice (see ProgressSync). */
export interface VillainProgress {
  missionsCompleted: number;
  championDefeated: boolean;
  bestWave: number;
}

/** Normalize a possibly-missing / partial saved slice into safe defaults. */
export function normalizeVillainProgress(raw?: {
  missionsCompleted?: number; championDefeated?: boolean; bestWave?: number;
} | null): VillainProgress {
  return {
    missionsCompleted: Math.max(0, Math.floor(raw?.missionsCompleted ?? 0)),
    championDefeated: raw?.championDefeated === true,
    bestWave: Math.max(0, Math.floor(raw?.bestWave ?? 0)),
  };
}

/**
 * MoonWorldSystem — Level 12 "Luna Bastion" (VILLAIN CAMPAIGN)
 * ============================================================
 * The player fights AS a Captain. Mounted by Game.tsx on LEVEL_STARTED
 * for level 12 (`LevelSystem.isMoon`); disposed on warp-out.
 *
 * World layer:
 *   - Space-mode sky (starfield, no sun/horizon) + a big blue Earthrise
 *     parked over the horizon.
 *   - Grey cratered moon plain: ground disc, raised crater rims, scattered
 *     regolith boulders, and the heroes' white/gold bastion at arena north.
 *   - Low gravity via PlayerController.setMoonPhysics (reverted on dispose).
 *
 * Villain layer:
 *   - PlayerController.setVillainBody(true) swaps the player's rendered
 *     body into the crimson Captain kit for the duration of the visit.
 *   - A loyal sky-drone escorts the player: it orbits overhead and zaps
 *     the nearest hero knight with plasma bolts.
 *
 * Mission loop:
 *   - 3 waves of hero-faction knights (captain chassis wearing the hero's
 *     blue/gold PlayerDefault look + storm variant tint), then the HERO
 *     CHAMPION (high-HP hero knight). Kill it → credits + XP rewards and
 *     a progress callback so villain progress persists separately.
 */
export class MoonWorldSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private playerPos: () => BABYLON.Vector3;
  private enemySystem: EnemySystem;
  private sky: SkySystem;
  private player: PlayerController;
  private handles: MoonWorldHandles;
  private hiddenVisibles: Array<{ setVisible(v: boolean): void }> = [];
  private cityHidden = false;

  private root: BABYLON.TransformNode;
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private earth: BABYLON.Mesh | null = null;

  // ---- escort drone
  private drone: BABYLON.Mesh | null = null;
  private droneCooldown = 0;
  private droneAngle = 0;

  // ---- mission state
  private progress: VillainProgress;
  private onProgress: (p: VillainProgress) => void;
  private waveIndex = 0; // 0 = not started, 1..WAVES.length = active wave
  private waveUnits: EnemyUnit[] = [];
  private champion: EnemyUnit | null = null;
  private missionDone = false;
  private nextWaveDelay = 3;
  private lastTickMs = performance.now();
  /** Materials created by this system — node dispose doesn't cascade into
   *  materials, so track + dispose explicitly (WebGL-leak discipline). */
  private mats: BABYLON.Material[] = [];
  /** Pending drone-beam cleanup timers, cleared on dispose. */
  private beamTimers: Array<ReturnType<typeof setTimeout>> = [];

  /** Must match LevelSystem LEVEL_DEFS[12].spawnPoint. */
  private static readonly CENTER = new BABYLON.Vector3(0, 0, 3000);
  private static readonly ARENA_R = 110;
  /** Knights per wave — hero-faction pressure ramps across the mission. */
  private static readonly WAVES = [4, 6, 8];

  constructor(
    scene: BABYLON.Scene,
    enemySystem: EnemySystem,
    sky: SkySystem,
    player: PlayerController,
    playerPosProvider: () => BABYLON.Vector3,
    handles: MoonWorldHandles,
    savedProgress: VillainProgress,
    onProgress: (p: VillainProgress) => void,
  ) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.enemySystem = enemySystem;
    this.sky = sky;
    this.player = player;
    this.playerPos = playerPosProvider;
    this.handles = handles;
    this.progress = { ...savedProgress };
    this.onProgress = onProgress;

    this.root = new BABYLON.TransformNode("moonWorldRoot", scene);

    this.hideOuterWorld();
    try { this.handles.lodCull?.setSuppressed(true); } catch {}
    this.sky.setSpaceMode(true);

    this.buildGround();
    this.buildCraters();
    this.buildBoulders();
    this.buildBastion();
    this.buildEarthrise();
    this.buildLighting();

    // Villain embodiment + lunar movement.
    try { this.player.setVillainBody(true); } catch (e) {
      console.warn("[MoonWorldSystem] villain body swap failed", e);
    }
    try { this.player.setMoonPhysics(true); } catch {}

    this.spawnDrone();

    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());

    this.bus.emit(
      GameEvents.UI_MESSAGE,
      "LUNA BASTION — You wear the Captain's armor now. Crush the hero knights.",
    );
    console.log("[MoonWorldSystem] Luna Bastion mounted");
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
    // Revert the villain embodiment BEFORE restoring the world so the
    // player never walks Detroit in moon physics.
    try { this.player.setMoonPhysics(false); } catch {}
    try { this.player.setVillainBody(false); } catch {}
    this.sky.setSpaceMode(false);
    this.restoreOuterWorld();
    this.waveUnits = [];
    this.champion = null;
    this.earth = null;
    this.drone = null;
    for (const t of this.beamTimers) clearTimeout(t);
    this.beamTimers = [];
    try { this.root.dispose(); } catch {}
    for (const m of this.mats) { try { m.dispose(); } catch {} }
    this.mats = [];
    console.log("[MoonWorldSystem] Luna Bastion disposed");
  }

  /** Register a material for explicit disposal on teardown. */
  private trackMat<T extends BABYLON.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  // ------------------------------------------------------------- world swap

  private hideOuterWorld(): void {
    if (this.handles.city) {
      try { this.handles.city.setVisible(false); this.cityHidden = true; } catch {}
    }
    if (this.handles.worldVisibles) {
      for (const sys of this.handles.worldVisibles) {
        if (!sys) continue;
        try { sys.setVisible(false); this.hiddenVisibles.push(sys); } catch {}
      }
    }
  }

  private restoreOuterWorld(): void {
    if (this.cityHidden && this.handles.city) {
      try { this.handles.city.setVisible(true); } catch {}
      this.cityHidden = false;
    }
    for (const sys of this.hiddenVisibles) {
      try { sys.setVisible(true); } catch {}
    }
    this.hiddenVisibles = [];
  }

  // ---------------------------------------------------------------- visuals

  private buildGround(): void {
    const c = MoonWorldSystem.CENTER;
    const ground = BABYLON.MeshBuilder.CreateDisc(
      "moonGround", { radius: 720, tessellation: 96 }, this.scene,
    );
    ground.rotation.x = Math.PI / 2;
    ground.position.set(c.x, 0, c.z);
    ground.parent = this.root;
    ground.isPickable = false;
    ground.checkCollisions = false;
    ground.receiveShadows = false;

    const mat = this.trackMat(new BABYLON.StandardMaterial("moonGroundMat", this.scene));
    mat.diffuseColor = new BABYLON.Color3(0.42, 0.42, 0.45);
    mat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
    mat.emissiveColor = new BABYLON.Color3(0.06, 0.06, 0.08);
    ground.material = mat;
  }

  /** Raised crater rims (decorative tori) — depressions would need a
   *  terrain height provider, rims read just as lunar without one. */
  private buildCraters(): void {
    const c = MoonWorldSystem.CENTER;
    const rimMat = this.trackMat(new BABYLON.StandardMaterial("moonRimMat", this.scene));
    rimMat.diffuseColor = new BABYLON.Color3(0.34, 0.34, 0.38);
    rimMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
    rimMat.emissiveColor = new BABYLON.Color3(0.04, 0.04, 0.05);

    for (let i = 0; i < 16; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 60 + Math.random() * 560;
      const diameter = 10 + Math.random() * 42;
      const rim = BABYLON.MeshBuilder.CreateTorus(
        `moonCrater_${i}`,
        { diameter, thickness: diameter * 0.14, tessellation: 24 },
        this.scene,
      );
      rim.position.set(c.x + Math.cos(ang) * r, 0.4, c.z + Math.sin(ang) * r);
      rim.scaling.y = 0.35;
      rim.parent = this.root;
      rim.isPickable = false;
      rim.material = rimMat;
    }
  }

  private buildBoulders(): void {
    const c = MoonWorldSystem.CENTER;
    const mat = this.trackMat(new BABYLON.StandardMaterial("moonBoulderMat", this.scene));
    mat.diffuseColor = new BABYLON.Color3(0.30, 0.30, 0.33);
    mat.specularColor = new BABYLON.Color3(0, 0, 0);

    for (let i = 0; i < 30; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 620;
      const s = 1.2 + Math.random() * 4.5;
      const rock = BABYLON.MeshBuilder.CreatePolyhedron(
        `moonRock_${i}`, { type: 1, size: s }, this.scene,
      );
      rock.position.set(c.x + Math.cos(ang) * r, s * 0.5, c.z + Math.sin(ang) * r);
      rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      rock.parent = this.root;
      rock.isPickable = false;
      rock.material = mat;
    }
  }

  /** The heroes' white/gold bastion at the north edge of the arena — the
   *  set-piece the villain mission is nominally storming. Decorative. */
  private buildBastion(): void {
    const c = MoonWorldSystem.CENTER;
    const bx = c.x;
    const bz = c.z + MoonWorldSystem.ARENA_R + 40;

    const white = this.trackMat(new BABYLON.StandardMaterial("bastionWhiteMat", this.scene));
    white.diffuseColor = new BABYLON.Color3(0.85, 0.86, 0.90);
    white.emissiveColor = new BABYLON.Color3(0.10, 0.10, 0.12);
    white.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    const gold = this.trackMat(new BABYLON.StandardMaterial("bastionGoldMat", this.scene));
    gold.diffuseColor = new BABYLON.Color3(0.85, 0.68, 0.20);
    gold.emissiveColor = new BABYLON.Color3(0.45, 0.33, 0.06);
    gold.specularColor = new BABYLON.Color3(0.2, 0.15, 0.05);

    const keep = BABYLON.MeshBuilder.CreateBox(
      "bastionKeep", { width: 46, height: 34, depth: 30 }, this.scene,
    );
    keep.position.set(bx, 17, bz);
    keep.parent = this.root;
    keep.isPickable = false;
    keep.material = white;

    for (const dx of [-28, 28]) {
      const tower = BABYLON.MeshBuilder.CreateCylinder(
        `bastionTower_${dx}`, { diameter: 12, height: 52, tessellation: 12 }, this.scene,
      );
      tower.position.set(bx + dx, 26, bz);
      tower.parent = this.root;
      tower.isPickable = false;
      tower.material = white;

      const cap = BABYLON.MeshBuilder.CreateCylinder(
        `bastionCap_${dx}`, { diameterTop: 0.5, diameterBottom: 13, height: 10, tessellation: 12 }, this.scene,
      );
      cap.position.set(bx + dx, 57, bz);
      cap.parent = this.root;
      cap.isPickable = false;
      cap.material = gold;
    }

    const gate = BABYLON.MeshBuilder.CreateBox(
      "bastionGate", { width: 12, height: 16, depth: 2 }, this.scene,
    );
    gate.position.set(bx, 8, bz - 16);
    gate.parent = this.root;
    gate.isPickable = false;
    gate.material = gold;
  }

  private buildEarthrise(): void {
    const c = MoonWorldSystem.CENTER;
    const earth = BABYLON.MeshBuilder.CreateSphere(
      "moonEarthrise", { diameter: 420, segments: 32 }, this.scene,
    );
    earth.position.set(c.x - 600, 260, c.z + 1100);
    earth.parent = this.root;
    earth.isPickable = false;
    earth.applyFog = false;
    earth.renderingGroupId = 0;
    const mat = this.trackMat(new BABYLON.StandardMaterial("moonEarthriseMat", this.scene));
    mat.diffuseColor = new BABYLON.Color3(0.20, 0.50, 0.95);
    mat.emissiveColor = new BABYLON.Color3(0.12, 0.30, 0.62);
    mat.specularColor = new BABYLON.Color3(0.05, 0.10, 0.20);
    earth.material = mat;
    this.earth = earth;
  }

  private buildLighting(): void {
    // One cold directional "sunlight in vacuum" fill scoped to our meshes
    // via intensity only — the space-mode sky already darkens ambient.
    const light = new BABYLON.DirectionalLight(
      "moonSun", new BABYLON.Vector3(-0.4, -1, 0.3), this.scene,
    );
    light.intensity = 0.55;
    light.diffuse = new BABYLON.Color3(0.85, 0.87, 1.0);
    light.parent = this.root;
  }

  // ------------------------------------------------------------ escort drone

  private spawnDrone(): void {
    const drone = BABYLON.MeshBuilder.CreateSphere(
      "villainDrone", { diameter: 1.6, segments: 12 }, this.scene,
    );
    const mat = this.trackMat(new BABYLON.StandardMaterial("villainDroneMat", this.scene));
    mat.diffuseColor = new BABYLON.Color3(0.15, 0.05, 0.08);
    mat.emissiveColor = new BABYLON.Color3(0.9, 0.15, 0.25);
    drone.material = mat;
    drone.isPickable = false;
    drone.parent = this.root;
    const p = this.playerPos();
    drone.position.set(p.x + 3, p.y + 6, p.z);
    this.drone = drone;
  }

  /** Orbit overhead; every 1.4 s zap the nearest live enemy within 70 m. */
  private updateDrone(dt: number): void {
    const drone = this.drone;
    if (!drone) return;
    const p = this.playerPos();
    this.droneAngle += dt * 1.2;
    const tx = p.x + Math.cos(this.droneAngle) * 5;
    const ty = p.y + 6 + Math.sin(this.droneAngle * 2.3) * 0.8;
    const tz = p.z + Math.sin(this.droneAngle) * 5;
    drone.position.x += (tx - drone.position.x) * Math.min(1, dt * 4);
    drone.position.y += (ty - drone.position.y) * Math.min(1, dt * 4);
    drone.position.z += (tz - drone.position.z) * Math.min(1, dt * 4);

    this.droneCooldown -= dt;
    if (this.droneCooldown > 0) return;

    // Nearest live hero knight within range.
    let best: BABYLON.Mesh | null = null;
    let bestD = 70;
    for (const m of this.enemySystem.getEnemyMeshes()) {
      const d = BABYLON.Vector3.Distance(m.position, drone.position);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (!best) return;
    this.droneCooldown = 1.4;

    // Damage + a short-lived tracer beam.
    const res = this.enemySystem.damageEnemy(best, 45);
    if (res.killed) {
      this.player.addCredits(res.credits);
      this.player.addExperience(res.experience);
    }
    try {
      const beam = BABYLON.MeshBuilder.CreateLines(
        "villainDroneBeam",
        { points: [drone.position.clone(), best.position.clone()] },
        this.scene,
      );
      beam.color = new BABYLON.Color3(1.0, 0.25, 0.35);
      beam.isPickable = false;
      beam.parent = this.root; // root dispose catches any beam mid-flight
      const t = setTimeout(() => {
        try { beam.dispose(); } catch {}
        const idx = this.beamTimers.indexOf(t);
        if (idx >= 0) this.beamTimers.splice(idx, 1);
      }, 120);
      this.beamTimers.push(t);
    } catch {}
  }

  // ------------------------------------------------------------ mission loop

  /** Spawn one hero-faction knight: captain chassis wearing the hero's
   *  blue/gold PlayerDefault look with the storm variant tint. */
  private spawnHeroKnight(pos: BABYLON.Vector3, healthMultiplier: number): EnemyUnit | null {
    try {
      return this.enemySystem.spawnCaptain(pos, {
        humanoidPreset: "PlayerDefault",
        variantId: "storm",
        healthMultiplier,
      });
    } catch (e) {
      console.warn("[MoonWorldSystem] hero knight spawn failed", e);
      return null;
    }
  }

  private startWave(index: number): void {
    this.waveIndex = index;
    this.waveUnits = [];
    const c = MoonWorldSystem.CENTER;
    const count = MoonWorldSystem.WAVES[index - 1];
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = MoonWorldSystem.ARENA_R - 15 - Math.random() * 20;
      const pos = new BABYLON.Vector3(c.x + Math.cos(ang) * r, 1.5, c.z + Math.sin(ang) * r);
      const u = this.spawnHeroKnight(pos, 1.0 + index * 0.25);
      if (u) this.waveUnits.push(u);
    }
    if (index > this.progress.bestWave) {
      this.progress.bestWave = index;
      this.emitProgress();
    }
    this.bus.emit(
      GameEvents.UI_MESSAGE,
      `HERO KNIGHTS — WAVE ${index}/${MoonWorldSystem.WAVES.length}. Cut them down.`,
    );
  }

  private spawnChampion(): void {
    const c = MoonWorldSystem.CENTER;
    const pos = new BABYLON.Vector3(c.x, 1.5, c.z + MoonWorldSystem.ARENA_R - 25);
    this.champion = this.spawnHeroKnight(pos, 8.0);
    if (!this.champion) {
      // Spawn failed (e.g. enemy cap) — fall back to the pre-champion
      // state so the tick loop retries after the standard breather
      // instead of locking the mission in an unrecoverable phase.
      this.waveIndex = MoonWorldSystem.WAVES.length;
      this.nextWaveDelay = 3;
      return;
    }
    this.bus.emit(
      GameEvents.UI_MESSAGE,
      "THE HERO CHAMPION descends from the bastion. Slay them.",
    );
  }

  private completeMission(): void {
    this.missionDone = true;
    this.progress.missionsCompleted += 1;
    this.progress.championDefeated = true;
    this.emitProgress();

    // Villain spoils — scaled to endgame-zone rewards.
    const credits = 2500;
    const xp = 4000;
    try { this.player.addCredits(credits); } catch {}
    try { this.player.addExperience(xp); } catch {}
    this.bus.emit(
      GameEvents.UI_MESSAGE,
      `THE CHAMPION FALLS — LUNA BASTION IS YOURS. +${credits}cr +${xp}xp`,
    );
  }

  private emitProgress(): void {
    try { this.onProgress({ ...this.progress }); } catch {}
  }

  // ------------------------------------------------------------------- frame

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTickMs) / 1000);
    this.lastTickMs = now;

    this.updateDrone(dt);

    // Slow Earthrise drift so the sky reads as alive.
    if (this.earth) {
      this.earth.rotation.y += dt * 0.02;
    }

    if (this.missionDone) return;

    // Small breather between waves (and before wave 1).
    const waveAlive = this.waveUnits.some(u => u.isAlive);
    if (this.waveIndex === 0 || (!waveAlive && this.champion === null && this.waveIndex < MoonWorldSystem.WAVES.length + 1)) {
      if (this.waveIndex > 0 && this.waveIndex >= MoonWorldSystem.WAVES.length) {
        // All waves cleared → champion phase.
        this.nextWaveDelay -= dt;
        if (this.nextWaveDelay <= 0) {
          this.nextWaveDelay = 3;
          this.waveIndex = MoonWorldSystem.WAVES.length + 1;
          this.spawnChampion();
        }
        return;
      }
      this.nextWaveDelay -= dt;
      if (this.nextWaveDelay <= 0) {
        this.nextWaveDelay = 4;
        this.startWave(this.waveIndex + 1);
      }
      return;
    }

    // Champion phase → mission completion.
    if (this.champion && !this.champion.isAlive) {
      this.champion = null;
      this.completeMission();
    }
  }
}
