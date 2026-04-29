import { EventBus, GameEvents } from "./EventBus";

/** Persisted shape used by ProgressSync. */
export interface LevelSnapshot {
  worldLevel: 1 | 2;
}

interface LevelDef {
  level: 1 | 2;
  /** Top-of-screen banner text. */
  banner: string;
  /** Long-form objective shown in the HUD. */
  objective: string;
  /** Wave/spawn intensity multiplier applied by Game.tsx. */
  difficultyMultiplier: number;
  /** Tint colour applied to the sky on this level. (Level 1 = neutral.) */
  skyTint: { r: number; g: number; b: number };
}

const LEVEL_DEFS: Record<1 | 2, LevelDef> = {
  1: {
    level: 1,
    banner: "LEVEL 1 — RESCUE THE ALLY",
    objective: "Breach the enemy fortress and rescue the captured ally.",
    difficultyMultiplier: 1.0,
    skyTint: { r: 1.0, g: 1.0, b: 1.0 },
  },
  2: {
    level: 2,
    banner: "LEVEL 2 — HOLD THE LINE",
    objective: "The captains have invaded. Crush the new fortress and survive.",
    difficultyMultiplier: 1.5,
    skyTint: { r: 1.25, g: 0.55, b: 0.45 },
  },
};

/** Tracks the player's world-level progression (Level 1 → Level 2) and
 *  drives transitions when the boss fortress falls.
 *
 *  Rules:
 *  - Starts at Level 1.
 *  - On the first `BOSS_FORTRESS_CLEARED`, fires `LEVEL_COMPLETED` (1),
 *    then after a short cinematic pause (default 3 s) fires `LEVEL_STARTED` (2).
 *  - Subsequent fortress clears at Level 2 are ignored (terminal level).
 *  - `applyLoadedState` is used by ProgressSync on load — a snapshot of
 *    Level 2 immediately re-fires LEVEL_STARTED so listeners can re-apply
 *    sky tint, spawn buffs, etc., without waiting for a clear.
 */
export class LevelSystem {
  private bus: EventBus;
  private currentLevel: 1 | 2 = 1;
  private transitioning = false;
  /** `true` once the player clears the Level-1 fortress; prevents double-fire. */
  private level1Completed = false;
  /** Public hook so callers (e.g. progress save) can know when a transition
   *  is mid-flight — they should defer non-critical work until it's over. */
  get isTransitioning(): boolean { return this.transitioning; }

  constructor() {
    this.bus = EventBus.getInstance();
    this.bus.on(GameEvents.BOSS_FORTRESS_CLEARED, this.onFortressCleared);
  }

  /** Listener for the boss fortress clear event. */
  private onFortressCleared = (): void => {
    if (this.currentLevel !== 1 || this.level1Completed) return;
    this.level1Completed = true;
    this.transitioning = true;

    const completed = LEVEL_DEFS[1];
    this.bus.emit(GameEvents.LEVEL_COMPLETED, {
      level: 1,
      banner: completed.banner,
    });
    // Cinematic pause before Level 2 begins.
    setTimeout(() => this.advanceTo(2), 3000);
  };

  /** Internal: switch to the given level + emit `LEVEL_STARTED`. */
  private advanceTo(level: 1 | 2): void {
    this.currentLevel = level;
    this.transitioning = false;
    const def = LEVEL_DEFS[level];
    this.bus.emit(GameEvents.LEVEL_STARTED, {
      level,
      banner: def.banner,
      objective: def.objective,
      difficultyMultiplier: def.difficultyMultiplier,
      skyTint: def.skyTint,
    });
  }

  /** Manual jump used by debug + level-2 boot. Idempotent. */
  forceStart(level: 1 | 2): void {
    if (this.currentLevel === level && !this.transitioning) {
      // Re-emit so consumers can re-apply tint/spawns after a re-mount.
      this.advanceTo(level);
      return;
    }
    if (level === 2) this.level1Completed = true;
    this.advanceTo(level);
  }

  getCurrentLevel(): 1 | 2 { return this.currentLevel; }

  getObjectiveText(): string { return LEVEL_DEFS[this.currentLevel].objective; }

  getBannerText(): string { return LEVEL_DEFS[this.currentLevel].banner; }

  getDifficultyMultiplier(): number {
    return LEVEL_DEFS[this.currentLevel].difficultyMultiplier;
  }

  getSkyTint(): { r: number; g: number; b: number } {
    return { ...LEVEL_DEFS[this.currentLevel].skyTint };
  }

  /** Persisted snapshot for ProgressSync. */
  getSnapshot(): LevelSnapshot {
    return { worldLevel: this.currentLevel };
  }

  /** Restore from a saved snapshot. If the saved level is 2 we re-fire
   *  LEVEL_STARTED so listeners (sky, spawner, HUD) re-apply their state. */
  applyLoadedState(snap: Partial<LevelSnapshot> | null | undefined): void {
    const lvl = snap && snap.worldLevel === 2 ? 2 : 1;
    if (lvl === 2) {
      this.level1Completed = true;
      this.advanceTo(2);
    } else {
      this.currentLevel = 1;
      this.level1Completed = false;
    }
  }

  dispose(): void {
    this.bus.off(GameEvents.BOSS_FORTRESS_CLEARED, this.onFortressCleared);
  }
}
