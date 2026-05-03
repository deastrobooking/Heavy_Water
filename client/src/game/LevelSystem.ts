import { EventBus, GameEvents } from "./EventBus";
import { BossVariantId } from "./BossVariants";

/** All world-level ids the campaign supports. Persisted as a number — older
 *  saves stored only `1 | 2`, those still load (anything > 3 is clamped to 3,
 *  anything < 1 is clamped to 1). */
export type WorldLevel = 1 | 2 | 3;

/** Persisted shape used by ProgressSync. */
export interface LevelSnapshot {
  worldLevel: WorldLevel;
}

interface LevelDef {
  level: WorldLevel;
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
  /** Subtitle shown on the LEVEL COMPLETE overlay when this level falls. */
  completeSubtitle: string;
}

const LEVEL_DEFS: Record<WorldLevel, LevelDef> = {
  1: {
    level: 1,
    banner: "LEVEL 1 — RESCUE THE ALLY",
    objective: "Breach the enemy fortress and rescue the captured ally.",
    difficultyMultiplier: 1.0,
    skyTint: { r: 1.0, g: 1.0, b: 1.0 },
    bossVariantId: "inferno",
    fortressCenter: { x: 380, z: -120 },
    completeSubtitle: "Stand by — the war isn't over.",
  },
  2: {
    level: 2,
    banner: "LEVEL 2 — HOLD THE LINE",
    objective: "The captains have invaded. Crush the next fortress and survive.",
    difficultyMultiplier: 1.5,
    skyTint: { r: 1.25, g: 0.55, b: 0.45 },
    bossVariantId: "plague",
    fortressCenter: { x: -360, z: -360 },
    completeSubtitle: "The plague clears. One stronghold left.",
  },
  3: {
    level: 3,
    banner: "LEVEL 3 — PURGE THE VOID",
    objective: "Storm the final command tower. End the invasion.",
    difficultyMultiplier: 2.0,
    skyTint: { r: 0.55, g: 0.55, b: 1.05 },
    bossVariantId: "void",
    fortressCenter: { x: -120, z: 420 },
    completeSubtitle: "DETROIT IS FREE. The hybrids are broken.",
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
    });
  }

  /** Manual jump used by debug + level-N boot. Idempotent. */
  forceStart(level: WorldLevel): void {
    if (this.currentLevel === level && !this.transitioning) {
      // Re-emit so consumers can re-apply tint/spawns after a re-mount.
      this.advanceTo(level);
      return;
    }
    // Mark every prior level as cleared (you can't start L3 without having
    // beaten L1 + L2 in the canonical flow).
    for (let l = 1; l < level; l++) this.clearedLevels.add(l as WorldLevel);
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

  /** Persisted snapshot for ProgressSync. */
  getSnapshot(): LevelSnapshot {
    return { worldLevel: this.currentLevel };
  }

  /** Restore from a saved snapshot. The saved level's `LEVEL_STARTED` is
   *  re-fired so listeners (sky, spawner, HUD) reapply their state. */
  applyLoadedState(snap: Partial<LevelSnapshot> | null | undefined): void {
    let lvl: WorldLevel = 1;
    const raw = snap && typeof snap.worldLevel === "number" ? snap.worldLevel : 1;
    if (raw >= 3) lvl = 3;
    else if (raw === 2) lvl = 2;
    else lvl = 1;

    if (lvl === 1) {
      this.currentLevel = 1;
      this.clearedLevels.clear();
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
