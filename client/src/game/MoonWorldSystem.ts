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
  /** True after the player's very first mission clear — gates the richer
   *  first-clear reward table and the Crimson Blade unlock. */
  firstClearDone: boolean;
  /** Ids of captain weapon skins unlocked via progression milestones.
   *  "crimson_blade" → mission 1, "plasma_claw" → 3+, "full_captain_kit" → 5+. */
  captainWeaponsUnlocked: string[];
}

/** Normalize a possibly-missing / partial saved slice into safe defaults. */
export function normalizeVillainProgress(raw?: {
  missionsCompleted?: number; championDefeated?: boolean; bestWave?: number;
  firstClearDone?: boolean; captainWeaponsUnlocked?: string[];
} | null): VillainProgress {
  return {
    missionsCompleted: Math.max(0, Math.floor(raw?.missionsCompleted ?? 0)),
    championDefeated: raw?.championDefeated === true,
    bestWave: Math.max(0, Math.floor(raw?.bestWave ?? 0)),
    firstClearDone: raw?.firstClearDone === true,
    captainWeaponsUnlocked: Array.isArray(raw?.captainWeaponsUnlocked)
      ? raw!.captainWeaponsUnlocked.filter(s => typeof s === "string")
      : [],
  };
}

// ---------------------------------------------------------------------------
// Mission table
// ---------------------------------------------------------------------------

export type MoonModifier = "reinforced_knights" | "dual_champion";

export interface MoonMissionDef {
  /** Short display label used in the TRAVEL subtitle and UI messages. */
  label: string;
  /** Knight count per wave. Length determines total wave count. */
  waves: number[];
  /**
   * Base health multiplier applied to every knight before wave-index scaling.
   * Stacks multiplicatively with the per-wave index bonus (+0.25 per wave).
   */
  knightHpBase: number;
  /** Health multiplier for the primary champion. */
  championHpMult: number;
  creditReward: number;
  xpReward: number;
  modifiers: MoonModifier[];
}

/** Five escalating missions. Mission 4 loops with HP/reward scaling. */
export const MOON_MISSIONS: MoonMissionDef[] = [
  {
    label: "The Vanguard",
    waves: [4, 6, 8],
    knightHpBase: 1.0,
    championHpMult: 8.0,
    creditReward: 2500,
    xpReward: 4000,
    modifiers: [],
  },
  {
    label: "The Advance",
    waves: [5, 7, 10],
    knightHpBase: 1.1,
    championHpMult: 10.0,
    creditReward: 3000,
    xpReward: 5000,
    modifiers: [],
  },
  {
    label: "The Siege",
    waves: [6, 8, 10, 6],
    knightHpBase: 1.2,
    championHpMult: 13.0,
    creditReward: 3500,
    xpReward: 6500,
    modifiers: ["reinforced_knights"],
  },
  {
    label: "The Fortress",
    waves: [7, 9, 12, 8],
    knightHpBase: 1.3,
    championHpMult: 16.0,
    creditReward: 4000,
    xpReward: 8000,
    modifiers: ["dual_champion"],
  },
  {
    label: "The Final Storm",
    waves: [8, 10, 14, 10, 6],
    knightHpBase: 1.4,
    championHpMult: 20.0,
    creditReward: 5000,
    xpReward: 10000,
    modifiers: ["reinforced_knights", "dual_champion"],
  },
];

/**
 * Derive the active mission definition and loop-scaling factor from a raw
 * `missionsCompleted` count.  The last mission (index 4) repeats indefinitely
 * with +20% HP/reward per additional loop, capped at 3×.
 */
export function resolveMission(missionsCompleted: number): {
  def: MoonMissionDef;
  missionIndex: number;
  loopCount: number;
  loopScale: number;
} {
  const missionIndex = Math.min(missionsCompleted, MOON_MISSIONS.length - 1);
  const loopCount = Math.max(0, missionsCompleted - (MOON_MISSIONS.length - 1));
  const loopScale = Math.min(3.0, 1 + loopCount * 0.2);
  return { def: MOON_MISSIONS[missionIndex], missionIndex, loopCount, loopScale };
}

// ---------------------------------------------------------------------------
// Loot / reward constants
// ---------------------------------------------------------------------------

/** Weapon unlock milestones: [missionsCompleted threshold, weaponId]. */
const CAPTAIN_WEAPON_MILESTONES: Array<[number, string]> = [
  [1, "crimson_blade"],
  [3, "plasma_claw"],
  [5, "full_captain_kit"],
];

/** Reward items for the first ever mission clear. */
const FIRST_CLEAR_ITEMS: Array<{ itemId: string; quantity: number }> = [
  { itemId: "lunar_regolith", quantity: 3 },
  { itemId: "void_crystal",   quantity: 2 },
  { itemId: "champion_sigil", quantity: 1 },
];

/** Compute repeat-clear item drops. Uses Math.random for sigil / core rolls. */
function computeRepeatItems(missionsCompleted: number): Array<{ itemId: string; quantity: number }> {
  const drops: Array<{ itemId: string; quantity: number }> = [];
  drops.push({ itemId: "lunar_regolith", quantity: Math.min(6, 2 + Math.floor(missionsCompleted / 2)) });
  if (missionsCompleted >= 3) {
    drops.push({ itemId: "void_crystal", quantity: Math.min(4, 1 + Math.floor(missionsCompleted / 3)) });
  }
  if (Math.random() < 0.25) drops.push({ itemId: "champion_sigil", quantity: 1 });
  if (Math.random() < 0.07) drops.push({ itemId: "captain_core",   quantity: 1 });
  return drops;
}

// ---------------------------------------------------------------------------
/**
 * MoonWorldSystem — Level 12 "Luna Bastion" (VILLAIN CAMPAIGN)
 * ------------------------------------------------------------
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
 *   - Per-mission wave definitions drive knight counts and HP. After all
 *     waves clear, the HERO CHAMPION spawns (dual_champion missions spawn
 *     a reinforcement when the primary drops below 50% HP). Kill all
 *     champions → credits + XP rewards scaled to mission + loop count.
 *   - missionsCompleted advances through the 5-mission table; the last
 *     mission loops indefinitely with 20%-per-loop HP and reward scaling
 *     (capped at 3×).
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
  /** Resolved once in the constructor for the duration of this visit. */
  private activeMission: MoonMissionDef;
  private activeLoopScale: number;

  private waveIndex = 0; // 0 = not started, 1..waves.length = active, waves.length+1 = champion phase
  private waveUnits: EnemyUnit[] = [];
  /** Live champion units. Normally one; dual_champion adds a reinforcement
   *  when the primary falls below 50 % HP (or on primary death if that
   *  threshold check is missed). */
  private champions: EnemyUnit[] = [];
  /** True once the dual_champion reinforcement has been triggered for this
   *  mission visit — prevents a second spawn on a missed threshold tick. */
  private reinforcementSpawned = false;
  private missionDone = false;
  private nextWaveDelay = 3;
  private lastTickMs = performance.now();
  /** Materials created by this system — node dispose doesn't cascade into
   *  materials, so track + dispose explicitly (WebGL-leak discipline). */
  private mats: BABYLON.Material[] = [];
  /** Pending drone-beam cleanup timers, cleared on dispose. */
  private beamTimers: Array<ReturnType<typeof setTimeout>> = [];
  /** Captain weapon skin meshes parented to the villain body's right arm.
   *  Rebuilt by refreshWeaponSkins() whenever unlocks change; disposed
   *  explicitly (not via root) since they are parented to player limbs. */
  private weaponSkinMeshes: BABYLON.Mesh[] = [];

  // ---- Lunar Forge kiosk
  /** World position of the Lunar Forge kiosk placed south of the arena.
   *  Updated once in buildForgeKiosk; used for proximity checks. */
  private forgeKioskPos: BABYLON.Vector3 | null = null;
  private playerNearForge = false;
  private forgeHintShown = false;
  /** External predicate: returns true if any game modal is already open,
   *  preventing the forge from stacking on top. Wired by Game.tsx after
   *  construction via setInputBlockedProvider(). */
  private isInputBlocked: () => boolean = () => false;
  /** keydown handler ref so dispose() can detach the exact same function. */
  private forgeKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Must match LevelSystem LEVEL_DEFS[12].spawnPoint. */
  private static readonly CENTER = new BABYLON.Vector3(0, 0, 3000);
  private static readonly ARENA_R = 110;

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

    // Resolve the mission for this visit once — doesn't change mid-run.
    const { def, loopScale } = resolveMission(this.progress.missionsCompleted);
    this.activeMission = def;
    this.activeLoopScale = loopScale;

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

    // Apply any already-unlocked captain weapon skins to the fresh villain body.
    this.refreshWeaponSkins();

    this.spawnDrone();
    this.buildForgeKiosk();
    this.setupForgeInteraction();

    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());

    const missionNum = Math.min(this.progress.missionsCompleted + 1, MOON_MISSIONS.length);
    const loopSuffix = this.activeLoopScale > 1.0
      ? ` (×${this.activeLoopScale.toFixed(1)} scaling)`
      : "";
    this.bus.emit(
      GameEvents.UI_MESSAGE,
      `LUNA BASTION — Mission ${missionNum}: ${this.activeMission.label}${loopSuffix}. Crush the hero knights.`,
    );
    console.log(
      `[MoonWorldSystem] Luna Bastion mounted — mission "${this.activeMission.label}" loopScale=${this.activeLoopScale}`,
    );
  }

  /**
   * Wire an external predicate so MoonWorldSystem can avoid opening the forge
   * while any other game modal (upgrade menu, shop, capsule…) is open.
   * Called by Game.tsx right after construction.
   */
  setInputBlockedProvider(fn: () => boolean): void {
    this.isInputBlocked = fn;
  }

  dispose(): void {
    try { this._disposeInner(); }
    finally { try { this.handles.lodCull?.setSuppressed(false); } catch {} }
  }

  /**
   * Idempotent re-assertion of moon world state — called by Game.tsx after
   * every LEVEL_STARTED for level 12, including same-level respawns.
   *
   * Pattern mirrors AnnArborSystem.reassertWorldState and
   * MichiganTerrainSystem.reassertWorldState: the outer world may have been
   * partially or fully un-hidden (e.g. a stale sky-tint re-application or
   * an edge-case restore during the forceStart path), so we re-run all
   * visibility, sky-mode, and player-state assertions here without resetting
   * any mission progress.  Safe to call when already in the correct state.
   */
  reassertWorldState(): void {
    // Re-hide the outer world in case any forceStart path re-showed it.
    this.hideOuterWorld();
    try { this.handles.lodCull?.setSuppressed(true); } catch {}
    // Re-assert space sky — LEVEL_STARTED's setLevelTint / setTimeOfDay
    // calls happen *before* this reassert fires, so we win the last write.
    try { this.sky.setSpaceMode(true); } catch {}
    // Re-assert villain embodiment + lunar gravity (idempotent in
    // PlayerController — double-setting does not compound the effect).
    try { this.player.setVillainBody(true); } catch (e) {
      console.warn("[MoonWorldSystem] reassertWorldState: villain body failed", e);
    }
    try { this.player.setMoonPhysics(true); } catch {}
  }

  private _disposeInner(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    // Remove forge keydown listener.
    if (this.forgeKeyHandler) {
      window.removeEventListener("keydown", this.forgeKeyHandler);
      this.forgeKeyHandler = null;
    }
    // Revert the villain embodiment BEFORE restoring the world so the
    // player never walks Detroit in moon physics.
    try { this.player.setMoonPhysics(false); } catch {}
    try { this.player.setVillainBody(false); } catch {}
    this.sky.setSpaceMode(false);
    this.restoreOuterWorld();
    this.waveUnits = [];
    this.champions = [];
    this.earth = null;
    this.drone = null;
    this.forgeKioskPos = null;
    for (const t of this.beamTimers) clearTimeout(t);
    this.beamTimers = [];
    this.clearWeaponSkinMeshes();
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

  // --------------------------------------------------------- Lunar Forge kiosk

  /**
   * Crimson forge terminal placed south-west of the arena entrance — a compact
   * villain-tech fabrication station where the player can spend moon resources
   * on consumables and dark-matter transmutation.
   *
   * Visual: a squat black octagonal plinth with red emission stripes and a
   * glowing forge core hovering above the top face.
   */
  private buildForgeKiosk(): void {
    const c = MoonWorldSystem.CENTER;
    // Position: south of arena entrance, offset so it doesn't block wave spawns.
    const kx = c.x - 22;
    const kz = c.z - MoonWorldSystem.ARENA_R - 8;
    this.forgeKioskPos = new BABYLON.Vector3(kx, 0, kz);

    const baseMat = this.trackMat(new BABYLON.StandardMaterial("forgePlinthMat", this.scene));
    baseMat.diffuseColor  = new BABYLON.Color3(0.08, 0.04, 0.06);
    baseMat.emissiveColor = new BABYLON.Color3(0.30, 0.04, 0.08);
    baseMat.specularColor = new BABYLON.Color3(0.05, 0.02, 0.03);

    const coreMat = this.trackMat(new BABYLON.StandardMaterial("forgeCoreGlow", this.scene));
    coreMat.diffuseColor  = new BABYLON.Color3(0.9, 0.25, 0.40);
    coreMat.emissiveColor = new BABYLON.Color3(1.0, 0.20, 0.35);
    coreMat.specularColor = new BABYLON.Color3(0.5, 0.10, 0.15);

    // Plinth body.
    const plinth = BABYLON.MeshBuilder.CreateCylinder(
      "forgePlinth", { diameter: 3.2, height: 2.4, tessellation: 8 }, this.scene,
    );
    plinth.position.set(kx, 1.2, kz);
    plinth.parent = this.root;
    plinth.isPickable = false;
    plinth.material = baseMat;

    // Rim accent ring.
    const rim = BABYLON.MeshBuilder.CreateTorus(
      "forgeRim", { diameter: 3.4, thickness: 0.15, tessellation: 24 }, this.scene,
    );
    rim.position.set(kx, 2.35, kz);
    rim.parent = this.root;
    rim.isPickable = false;
    rim.material = coreMat;

    // Hovering forge core sphere.
    const core = BABYLON.MeshBuilder.CreateSphere(
      "forgeCore", { diameter: 0.9, segments: 12 }, this.scene,
    );
    core.position.set(kx, 3.3, kz);
    core.parent = this.root;
    core.isPickable = false;
    core.material = coreMat;

    // Point light to sell the forge glow.
    const glow = new BABYLON.PointLight(
      "forgeCoreLight", new BABYLON.Vector3(kx, 3.4, kz), this.scene,
    );
    glow.diffuse   = new BABYLON.Color3(1.0, 0.25, 0.35);
    glow.intensity = 0.8;
    glow.range     = 16;
    glow.parent    = this.root;

    // Label disc above the core so the player can identify it.
    const disc = BABYLON.MeshBuilder.CreatePlane(
      "forgeLabel", { width: 4, height: 1 }, this.scene,
    );
    disc.position.set(kx, 5.0, kz);
    disc.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    disc.parent = this.root;
    disc.isPickable = false;
    const labelMat = this.trackMat(new BABYLON.StandardMaterial("forgeLabelMat", this.scene));
    labelMat.diffuseColor  = new BABYLON.Color3(0, 0, 0);
    labelMat.emissiveColor = new BABYLON.Color3(1.0, 0.30, 0.45);
    labelMat.backFaceCulling = false;
    disc.material = labelMat;

    console.log("[MoonWorldSystem] Lunar Forge kiosk placed at", kx, kz);
  }

  /**
   * Register the E-key handler that opens the Lunar Forge when the player is
   * within 7 m of the kiosk and no other modal is blocking input.
   * Also sets up a gamepad-menu close listener so a controller can dismiss
   * the forge overlay using B/Circle.
   */
  private setupForgeInteraction(): void {
    this.forgeKeyHandler = (e: KeyboardEvent) => {
      if (e.code !== "KeyE") return;
      if (!this.playerNearForge) return;
      if (this.isInputBlocked()) return;
      e.stopImmediatePropagation();
      this.bus.emit(GameEvents.LUNAR_FORGE_OPEN);
    };
    window.addEventListener("keydown", this.forgeKeyHandler);
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
    const mission = this.activeMission;
    const c = MoonWorldSystem.CENTER;
    const count = mission.waves[index - 1];

    // reinforced_knights: +0.3 to the base HP multiplier for every wave.
    const reinforceBonus = mission.modifiers.includes("reinforced_knights") ? 0.3 : 0;
    // Per-wave scaling on top of the mission base and reinforce bonus.
    const waveHpMult = (mission.knightHpBase + reinforceBonus) * (1.0 + index * 0.25);

    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = MoonWorldSystem.ARENA_R - 15 - Math.random() * 20;
      const pos = new BABYLON.Vector3(c.x + Math.cos(ang) * r, 1.5, c.z + Math.sin(ang) * r);
      const u = this.spawnHeroKnight(pos, waveHpMult);
      if (u) this.waveUnits.push(u);
    }
    if (index > this.progress.bestWave) {
      this.progress.bestWave = index;
      this.emitProgress();
    }
    this.bus.emit(
      GameEvents.UI_MESSAGE,
      `HERO KNIGHTS — WAVE ${index}/${mission.waves.length}. Cut them down.`,
    );
  }

  /** Spawn the primary champion. On dual_champion missions a reinforcement
   *  arrives as a "reinforcement call" when the primary falls below 50 % HP
   *  (checked in tick; falls back to spawning on primary death if the
   *  threshold tick is missed). */
  private spawnPrimaryChampion(): void {
    const c = MoonWorldSystem.CENTER;
    const pos = new BABYLON.Vector3(c.x, 1.5, c.z + MoonWorldSystem.ARENA_R - 25);
    const hpMult = this.activeMission.championHpMult * this.activeLoopScale;
    const primary = this.spawnHeroKnight(pos, hpMult);
    if (!primary) {
      // Spawn failed (e.g. enemy cap) — fall back to pre-champion state so
      // the tick loop retries after the standard breather.
      this.waveIndex = this.activeMission.waves.length;
      this.nextWaveDelay = 3;
      return;
    }
    this.champions = [primary];
    this.reinforcementSpawned = false;
    this.bus.emit(
      GameEvents.UI_MESSAGE,
      "THE HERO CHAMPION descends from the bastion. Slay them.",
    );
  }

  /**
   * Spawn the dual_champion reinforcement offset from the primary so they
   * don't clump. Called when the primary drops below 50 % HP (tick-driven)
   * or falls back to primary death if the threshold tick is missed.
   */
  private spawnReinforcement(): void {
    if (this.reinforcementSpawned) return;
    this.reinforcementSpawned = true;
    const c = MoonWorldSystem.CENTER;
    // Offset +12 on X so the two champions don't overlap.
    const pos = new BABYLON.Vector3(c.x + 12, 1.5, c.z + MoonWorldSystem.ARENA_R - 35);
    const hpMult = this.activeMission.championHpMult * this.activeLoopScale * 0.8; // reinforcement is slightly softer
    const unit = this.spawnHeroKnight(pos, hpMult);
    if (unit) {
      this.champions.push(unit);
      this.bus.emit(
        GameEvents.UI_MESSAGE,
        "A SECOND CHAMPION answers the call! Destroy them both.",
      );
    }
  }

  private completeMission(): void {
    this.missionDone = true;
    const isFirstClear = !this.progress.firstClearDone;

    this.progress.missionsCompleted += 1;
    this.progress.championDefeated = true;
    if (isFirstClear) this.progress.firstClearDone = true;

    // ---- Compute reward items ----
    const items = isFirstClear
      ? FIRST_CLEAR_ITEMS.map(e => ({ ...e }))
      : computeRepeatItems(this.progress.missionsCompleted);

    // ---- Credits + XP: first clear gets a fixed floor; repeats use the
    //      mission table scaled by the loop factor (infinite-replay incentive).
    const baseCr = Math.round(this.activeMission.creditReward * this.activeLoopScale);
    const baseXp = Math.round(this.activeMission.xpReward  * this.activeLoopScale);
    const credits = isFirstClear ? Math.max(3500, baseCr) : baseCr;
    const xp      = isFirstClear ? Math.max(5000, baseXp)  : baseXp;

    // ---- Captain weapon progression unlocks ----
    const newUnlocks: string[] = [];
    for (const [threshold, weaponId] of CAPTAIN_WEAPON_MILESTONES) {
      if (
        this.progress.missionsCompleted >= threshold &&
        !this.progress.captainWeaponsUnlocked.includes(weaponId)
      ) {
        this.progress.captainWeaponsUnlocked.push(weaponId);
        newUnlocks.push(weaponId);
      }
    }

    this.emitProgress();

    // Apply newly-unlocked weapon skins to the live villain body immediately.
    if (newUnlocks.length > 0) this.refreshWeaponSkins();

    // Grant credits + XP.
    try { this.player.addCredits(credits); } catch {}
    try { this.player.addExperience(xp); } catch {}

    // missionNum + loopSuffix used in UI messages below.
    const missionNum = this.progress.missionsCompleted; // already incremented
    const loopSuffix = this.activeLoopScale > 1.0
      ? ` (×${this.activeLoopScale.toFixed(1)} scaling)`
      : "";

    // Emit the full reward payload for Game.tsx to handle inventory + overlay.
    this.bus.emit(GameEvents.MOON_MISSION_COMPLETE, {
      isFirstClear,
      items,
      credits,
      xp,
      newUnlocks,
    });
    this.bus.emit(
      GameEvents.UI_MESSAGE,
      `THE CHAMPION FALLS — LUNA BASTION IS YOURS. +${credits}cr +${xp}xp${loopSuffix}`,
    );

    // Post-completion prompt telling the player what awaits on the next visit.
    const nextResolved = resolveMission(this.progress.missionsCompleted);
    const nextLabel = nextResolved.loopCount > 0
      ? `${MOON_MISSIONS[MOON_MISSIONS.length - 1].label} (loop ${nextResolved.loopCount + 1})`
      : `Mission ${missionNum + 1}: ${nextResolved.def.label}`;
    setTimeout(() => {
      this.bus.emit(
        GameEvents.UI_MESSAGE,
        `MISSION ${missionNum} COMPLETE — Warp back to Luna Bastion for ${nextLabel}.`,
      );
    }, 4000);
  }

  // --------------------------------------------------- captain weapon skins

  private clearWeaponSkinMeshes(): void {
    for (const m of this.weaponSkinMeshes) {
      try { if (!m.isDisposed()) m.dispose(); } catch {}
    }
    this.weaponSkinMeshes = [];
  }

  /**
   * Build / rebuild captain weapon skin meshes on the villain body's right arm.
   * Called after setVillainBody(true) and whenever new weapon unlocks land.
   * Meshes are tracked separately from `root` since they are parented to the
   * player limb hierarchy rather than the moon world root.
   *
   * Skin tiers (additive):
   *   crimson_blade     — glowing crimson energy blade extending from buster
   *   plasma_claw       — secondary blue plasma arc alongside the blade
   *   full_captain_kit  — gold trim ring at the guard
   */
  private refreshWeaponSkins(): void {
    this.clearWeaponSkinMeshes();

    const unlocked = this.progress.captainWeaponsUnlocked;
    if (unlocked.length === 0) return;

    const rightArm = this.player.getVillainRightArm();
    if (!rightArm) return;

    const hasCrimson = unlocked.includes("crimson_blade");
    const hasPlasma  = unlocked.includes("plasma_claw");
    const hasFull    = unlocked.includes("full_captain_kit");

    if (!hasCrimson) return;

    // ---- Crimson energy blade (primary, always first unlock) ----
    // Positioned just past the buster muzzle (al≈9, muzzle at -9.81).
    const blade = BABYLON.MeshBuilder.CreateCylinder(
      "captainSkinBlade",
      { diameterTop: 0.18, diameterBottom: 0.55, height: 5.5, tessellation: 10 },
      this.scene,
    );
    blade.position.set(0, -12.8, 0.06);
    blade.parent = rightArm;
    blade.isPickable = false;
    const bladeMat = this.trackMat(new BABYLON.StandardMaterial("captainSkinBladeMat", this.scene));
    bladeMat.diffuseColor  = new BABYLON.Color3(0.95, 0.06, 0.14);
    bladeMat.emissiveColor = new BABYLON.Color3(1.0,  0.12, 0.22);
    bladeMat.alpha = 0.88;
    blade.material = bladeMat;
    this.weaponSkinMeshes.push(blade);

    // Hilt guard ring at base of blade.
    const guard = BABYLON.MeshBuilder.CreateCylinder(
      "captainSkinGuard",
      { diameterTop: 0.65, diameterBottom: 0.60, height: 0.3, tessellation: 10 },
      this.scene,
    );
    guard.position.set(0, -10.2, 0.06);
    guard.parent = rightArm;
    guard.isPickable = false;
    const guardMat = this.trackMat(new BABYLON.StandardMaterial("captainSkinGuardMat", this.scene));
    guardMat.diffuseColor  = new BABYLON.Color3(0.12, 0.12, 0.18);
    guardMat.emissiveColor = new BABYLON.Color3(0.35, 0.04, 0.08);
    guard.material = guardMat;
    this.weaponSkinMeshes.push(guard);

    if (hasPlasma) {
      // Secondary blue plasma arc alongside the main blade.
      const arc = BABYLON.MeshBuilder.CreateCylinder(
        "captainSkinArc",
        { diameterTop: 0.08, diameterBottom: 0.28, height: 4.0, tessellation: 7 },
        this.scene,
      );
      arc.position.set(0.55, -12.5, 0.06);
      arc.rotation.z = 0.18;
      arc.parent = rightArm;
      arc.isPickable = false;
      const arcMat = this.trackMat(new BABYLON.StandardMaterial("captainSkinArcMat", this.scene));
      arcMat.diffuseColor  = new BABYLON.Color3(0.20, 0.55, 1.0);
      arcMat.emissiveColor = new BABYLON.Color3(0.25, 0.70, 1.4);
      arcMat.alpha = 0.80;
      arc.material = arcMat;
      this.weaponSkinMeshes.push(arc);
    }

    if (hasFull) {
      // Gold trim torus around the guard.
      const trim = BABYLON.MeshBuilder.CreateTorus(
        "captainSkinGoldTrim",
        { diameter: 0.80, thickness: 0.055, tessellation: 14 },
        this.scene,
      );
      trim.position.set(0, -10.2, 0.06);
      trim.parent = rightArm;
      trim.isPickable = false;
      const trimMat = this.trackMat(new BABYLON.StandardMaterial("captainSkinTrimMat", this.scene));
      trimMat.diffuseColor  = new BABYLON.Color3(0.85, 0.70, 0.22);
      trimMat.emissiveColor = new BABYLON.Color3(0.95, 0.78, 0.12);
      trim.material = trimMat;
      this.weaponSkinMeshes.push(trim);
    }

    console.log("[MoonWorldSystem] Weapon skins applied:", unlocked.join(", "));
  }

  /**
   * Check player distance to the forge kiosk each frame. Shows a one-time
   * approach hint and flips `playerNearForge` so the key handler fires only
   * while the player is within interaction range.
   */
  private updateForgeProximity(): void {
    if (!this.forgeKioskPos) return;
    const p = this.playerPos();
    const dx = p.x - this.forgeKioskPos.x;
    const dz = p.z - this.forgeKioskPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const near = dist < 7;
    if (near && !this.playerNearForge && !this.forgeHintShown) {
      this.forgeHintShown = true;
      this.bus.emit(
        GameEvents.UI_MESSAGE,
        "LUNAR FORGE — Press [E] to craft villain upgrades from moon resources.",
      );
    }
    this.playerNearForge = near;
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
    this.updateForgeProximity();

    // Slow Earthrise drift so the sky reads as alive.
    if (this.earth) {
      this.earth.rotation.y += dt * 0.02;
    }

    if (this.missionDone) return;

    const mission = this.activeMission;
    const waveAlive = this.waveUnits.some(u => u.isAlive);
    const inChampPhase = this.waveIndex === mission.waves.length + 1;

    // ---- Wave transition / champion spawn phase ----------------------------
    if (this.waveIndex === 0 || (!waveAlive && this.champions.length === 0 && !inChampPhase)) {
      if (this.waveIndex > 0 && this.waveIndex >= mission.waves.length) {
        // All waves cleared → wait, then spawn champion.
        this.nextWaveDelay -= dt;
        if (this.nextWaveDelay <= 0) {
          this.nextWaveDelay = 3;
          this.waveIndex = mission.waves.length + 1;
          this.spawnPrimaryChampion();
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

    // ---- Champion phase ----------------------------------------------------
    if (inChampPhase && this.champions.length > 0) {
      const primary = this.champions[0];

      // dual_champion reinforcement call: trigger when primary drops below 50 %
      // HP. Falls back to triggering on primary death if threshold is missed.
      if (
        mission.modifiers.includes("dual_champion") &&
        !this.reinforcementSpawned
      ) {
        const primaryLow =
          primary.isAlive &&
          primary.health <= primary.maxHealth * 0.5;
        const primaryDead = !primary.isAlive;
        if (primaryLow || primaryDead) {
          this.spawnReinforcement();
        }
      }

      // Mission complete when every champion is dead.
      if (this.champions.every(c => !c.isAlive)) {
        this.champions = [];
        this.completeMission();
      }
    }
  }
}
