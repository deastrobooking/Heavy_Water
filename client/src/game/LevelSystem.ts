import { EventBus, GameEvents } from "./EventBus";
import { BossVariantId } from "./BossVariants";

/** All world-level ids the campaign supports. Persisted as a number — older
 *  saves stored only `1 | 2`, those still load (anything > 4 is clamped to 4,
 *  anything < 1 is clamped to 1).
 *
 *  Levels 1–3 are the linear combat campaign (Detroit liberation). Level 4
 *  is **Ashur Sanctuary** — a peaceful side-zone where the player rehabilitates
 *  rescued Animatons (Char's animal-DNA synthetic mechanoids), grows special
 *  bio-crops, and runs errands for the nearby Village of Earth. It does not
 *  appear in the L1→L2→L3 progression chain; it's reached from the new TRAVEL
 *  tab on the upgrade menu and acts as the player's home base. */
export type WorldLevel = 1 | 2 | 3 | 4;

/** Persisted shape used by ProgressSync. */
export interface LevelSnapshot {
  worldLevel: WorldLevel;
}

interface LevelDef {
  level: WorldLevel;
  /** Display name shown in the TRAVEL tab. */
  displayName: string;
  /** Top-of-screen banner text. */
  banner: string;
  /** Long-form objective shown in the HUD. */
  objective: string;
  /** Wave/spawn intensity multiplier applied by Game.tsx. */
  difficultyMultiplier: number;
  /** Tint colour applied to the sky on this level. (Level 1 = neutral.) */
  skyTint: { r: number; g: number; b: number };
  /** Boss-captain variant assigned to this level's fortress. */
  bossVariantId: BossVariantId;
  /** World coordinate where this level's fortress is seeded. */
  fortressCenter: { x: number; z: number };
  /** World coordinate where the player is teleported on fast-travel-in. */
  spawnPoint: { x: number; z: number };
  /** Subtitle shown on the LEVEL COMPLETE overlay when this level falls. */
  completeSubtitle: string;
  /** When true, this level skips boss-fortress spawn, suppresses wave
   *  spawner intensity, and triggers SanctuarySystem mount. Used by Level 4
   *  (Ashur Sanctuary). */
  peaceful?: boolean;
}

const LEVEL_DEFS: Record<WorldLevel, LevelDef> = {
  1: {
    level: 1,
    displayName: "DETROIT — Star City Front",
    banner: "LEVEL 1 — RESCUE THE ALLY",
    objective: "Breach the enemy fortress and rescue the captured ally.",
    difficultyMultiplier: 1.0,
    skyTint: { r: 1.0, g: 1.0, b: 1.0 },
    bossVariantId: "inferno",
    fortressCenter: { x: 380, z: -120 },
    spawnPoint: { x: 0, z: 0 },
    completeSubtitle: "Stand by — the war isn't over.",
  },
  2: {
    level: 2,
    displayName: "DETROIT — Hold the Line",
    banner: "LEVEL 2 — HOLD THE LINE",
    objective: "The captains have invaded. Crush the next fortress and survive.",
    difficultyMultiplier: 1.5,
    skyTint: { r: 1.25, g: 0.55, b: 0.45 },
    bossVariantId: "plague",
    fortressCenter: { x: -360, z: -360 },
    spawnPoint: { x: -200, z: -200 },
    completeSubtitle: "The plague clears. One stronghold left.",
  },
  3: {
    level: 3,
    displayName: "DETROIT — Purge the Void",
    banner: "LEVEL 3 — PURGE THE VOID",
    objective: "Storm the final command tower. End the invasion.",
    difficultyMultiplier: 2.0,
    skyTint: { r: 0.55, g: 0.55, b: 1.05 },
    bossVariantId: "void",
    fortressCenter: { x: -120, z: 420 },
    spawnPoint: { x: -60, z: 240 },
    completeSubtitle: "DETROIT IS FREE. The hybrids are broken.",
  },
  4: {
    level: 4,
    displayName: "ASHUR SANCTUARY",
    banner: "ASHUR SANCTUARY — A QUIET PLACE TO HEAL",
    // Two intertwined loops: rehab Animatons rescued from Char/Swarm labs, and
    // run errands for the Village of Earth at the sanctuary's edge.
    objective: "Tend the bio-crops, rehabilitate rescued Animatons, and help the Village of Earth.",
    // Spawner intensity is gated to ~0 by the `peaceful` flag in Game.tsx; the
    // multiplier here only matters if anything reads it bypassing that check.
    difficultyMultiplier: 0.0,
    // Warm dawn over the sanctuary fields.
    skyTint: { r: 1.15, g: 1.0, b: 0.85 },
    // No boss for this level — value is unused while peaceful=true but a
    // real BossVariantId is required by the type. Pick anything stable.
    bossVariantId: "inferno",
    // Far off-map so even if any stale fortress-spawn slipped through, it
    // wouldn't land in the sanctuary itself.
    fortressCenter: { x: 9999, z: 9999 },
    // Top-left corner of the world (-480, -480) — past the city, against the
    // mountain ring at radius 560 from origin so the sanctuary sits in a
    // sheltered pocket of the wilderness.
    spawnPoint: { x: -480, z: -480 },
    completeSubtitle: "The sanctuary endures.",
    peaceful: true,
  },
};

/** Tracks the player's world-level progression and drives transitions when
 *  the boss fortress falls.
 *
 *  Rules:
 *  - Starts at Level 1.
 *  - Each `BOSS_FORTRESS_CLEARED` advances by one until Level 3 is cleared.
 *  - Each transition fires `LEVEL_COMPLETED` (with the level we just beat),
 *    then after a short cinematic pause fires `LEVEL_STARTED` (with the next
 *    level's banner / objective / sky tint / fortress center / boss variant).
 *  - Clearing Level 3 fires `LEVEL_COMPLETED` with `final: true` and does
 *    not advance — the campaign is over.
 *  - `applyLoadedState` rehydrates a saved snapshot. If we resume mid-campaign
 *    we re-fire `LEVEL_STARTED` so the listeners (sky tint, spawner, HUD)
 *    re-apply their state.
 */
export class LevelSystem {
  private bus: EventBus;
  private currentLevel: WorldLevel = 1;
  private transitioning = false;
  /** Levels whose fortress has already been cleared. Prevents double-fire
   *  if `BOSS_FORTRESS_CLEARED` is replayed (e.g. corrupted save reload). */
  private clearedLevels = new Set<WorldLevel>();
  /** Active transition setTimeout id (so dispose() can cancel it and a stale
   *  callback can't emit `LEVEL_STARTED` into a fresh game session). */
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Position-tolerance for matching a `BOSS_FORTRESS_CLEARED` payload to
   *  the current level's fortress. World coords are integers; 8 m gives
   *  some slack for any future floor-snapping without bleeding into a
   *  neighbouring level's fortress (closest pair is L1↔L3 ~570 m apart). */
  private static readonly FORTRESS_MATCH_RADIUS = 8;
  /** Public hook so callers (e.g. progress save) can know when a transition
   *  is mid-flight — they should defer non-critical work until it's over. */
  get isTransitioning(): boolean { return this.transitioning; }

  constructor() {
    this.bus = EventBus.getInstance();
    this.bus.on(GameEvents.BOSS_FORTRESS_CLEARED, this.onFortressCleared);
  }

  /** Listener for the boss fortress clear event. We validate the cleared
   *  fortress's position against the current level's fortress so that on
   *  a loaded L2/L3 session, *also* clearing the seeded-at-startup L1
   *  fortress can't accidentally advance the level (the L1 fortress is
   *  always spawned at world init, but only the level's own fortress
   *  should advance progression). */
  private onFortressCleared = (payload: any): void => {
    if (this.clearedLevels.has(this.currentLevel)) return;

    // Verify the cleared fortress matches the current level's coordinate.
    const expected = LEVEL_DEFS[this.currentLevel].fortressCenter;
    const pos = payload?.position;
    if (pos && typeof pos.x === "number" && typeof pos.z === "number") {
      const dx = pos.x - expected.x;
      const dz = pos.z - expected.z;
      if (Math.hypot(dx, dz) > LevelSystem.FORTRESS_MATCH_RADIUS) {
        // A stale fortress (e.g. the L1 fortress on a loaded L2 session)
        // was cleared. Don't advance — that capstone belongs to a
        // different level.
        return;
      }
    }

    const cleared = this.currentLevel;
    this.clearedLevels.add(cleared);

    const def = LEVEL_DEFS[cleared];
    const isFinal = cleared === 3;
    this.transitioning = !isFinal;

    this.bus.emit(GameEvents.LEVEL_COMPLETED, {
      level: cleared,
      banner: def.banner,
      subtitle: def.completeSubtitle,
      final: isFinal,
    });

    if (isFinal) {
      // Campaign over — stay on Level 3 visuals; no advance.
      return;
    }

    const next = (cleared + 1) as WorldLevel;
    if (this.transitionTimer !== null) clearTimeout(this.transitionTimer);
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      this.advanceTo(next);
    }, 3000);
  };

  /** Internal: switch to the given level + emit `LEVEL_STARTED`. */
  private advanceTo(level: WorldLevel): void {
    this.currentLevel = level;
    this.transitioning = false;
    const def = LEVEL_DEFS[level];
    this.bus.emit(GameEvents.LEVEL_STARTED, {
      level,
      banner: def.banner,
      objective: def.objective,
      difficultyMultiplier: def.difficultyMultiplier,
      skyTint: def.skyTint,
      bossVariantId: def.bossVariantId,
      fortressCenter: { ...def.fortressCenter },
      // New fields for the sanctuary + fast-travel feature. Listeners
      // (Game.tsx LEVEL_STARTED handler) read `peaceful` to mount/dispose
      // SanctuarySystem and skip wave bumps + fortress seeding.
      spawnPoint: { ...def.spawnPoint },
      peaceful: def.peaceful === true,
    });
  }

  /** Manual jump used by fast-travel and the level-N boot path.
   *  Idempotent; **does not** auto-mark prior levels as cleared, because
   *  fast-travel is non-linear (especially traveling to the peaceful Level
   *  4 from mid-campaign). The save/load path goes through
   *  `applyLoadedState` which still marks 1..lvl-1 cleared for the linear
   *  combat chain (lvl 2 or 3). */
  forceStart(level: WorldLevel): void {
    // Always re-emit LEVEL_STARTED so consumers (sky tint, sanctuary mount,
    // HUD banner) re-apply their state — even when fast-travelling to the
    // level the player is already on.
    this.advanceTo(level);
  }

  getCurrentLevel(): WorldLevel { return this.currentLevel; }

  getObjectiveText(): string { return LEVEL_DEFS[this.currentLevel].objective; }

  getBannerText(): string { return LEVEL_DEFS[this.currentLevel].banner; }

  getDifficultyMultiplier(): number {
    return LEVEL_DEFS[this.currentLevel].difficultyMultiplier;
  }

  getSkyTint(): { r: number; g: number; b: number } {
    return { ...LEVEL_DEFS[this.currentLevel].skyTint };
  }

  /** Boss-captain variant for the *current* level's fortress. Used by
   *  Game.tsx when the BossFortress turret-clear handler spawns the captain. */
  getBossVariantId(): BossVariantId {
    return LEVEL_DEFS[this.currentLevel].bossVariantId;
  }

  /** World coordinate of the *current* level's fortress. Used by Game.tsx
   *  to seed the fortress mesh on level entry. */
  getFortressCenter(): { x: number; z: number } {
    return { ...LEVEL_DEFS[this.currentLevel].fortressCenter };
  }

  /** Static lookup — returns the fortress center for any level (used at
   *  initial world load to seed Level 1 before any LEVEL_STARTED fires). */
  static getFortressCenterFor(level: WorldLevel): { x: number; z: number } {
    return { ...LEVEL_DEFS[level].fortressCenter };
  }

  /** Static lookup — fast-travel teleport target for any level. */
  static getSpawnPointFor(level: WorldLevel): { x: number; z: number } {
    return { ...LEVEL_DEFS[level].spawnPoint };
  }

  /** Static lookup — display name for the TRAVEL tab. */
  static getDisplayNameFor(level: WorldLevel): string {
    return LEVEL_DEFS[level].displayName;
  }

  /** Static lookup — `true` if this level should suppress combat (no boss
   *  fortress, no wave spawning, sanctuary content active). */
  static isPeaceful(level: WorldLevel): boolean {
    return LEVEL_DEFS[level].peaceful === true;
  }

  /** Instance check — whether the *current* level is peaceful. */
  isPeaceful(): boolean {
    return LEVEL_DEFS[this.currentLevel].peaceful === true;
  }

  /** All known levels — used by the TRAVEL tab. */
  static getAllLevels(): WorldLevel[] {
    return [1, 2, 3, 4];
  }

  /** Persisted snapshot for ProgressSync. */
  getSnapshot(): LevelSnapshot {
    return { worldLevel: this.currentLevel };
  }

  /** Restore from a saved snapshot. The saved level's `LEVEL_STARTED` is
   *  re-fired so listeners (sky, spawner, HUD) reapply their state. */
  applyLoadedState(snap: Partial<LevelSnapshot> | null | undefined): void {
    let lvl: WorldLevel = 1;
    const raw = snap && typeof snap.worldLevel === "number" ? snap.worldLevel : 1;
    if (raw >= 4) lvl = 4;
    else if (raw === 3) lvl = 3;
    else if (raw === 2) lvl = 2;
    else lvl = 1;

    if (lvl === 1) {
      this.currentLevel = 1;
      this.clearedLevels.clear();
      return;
    }
    // Level 4 (sanctuary) is side-content — don't auto-mark L1/L2/L3 as
    // cleared just because the player saved while in the sanctuary; that
    // would let them skip the campaign on re-entry. Only treat the chain
    // (1→2→3) as cleared-on-load.
    if (lvl === 4) {
      this.advanceTo(4);
      return;
    }
    for (let l = 1; l < lvl; l++) this.clearedLevels.add(l as WorldLevel);
    this.advanceTo(lvl);
  }

  dispose(): void {
    this.bus.off(GameEvents.BOSS_FORTRESS_CLEARED, this.onFortressCleared);
    if (this.transitionTimer !== null) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
  }
}
