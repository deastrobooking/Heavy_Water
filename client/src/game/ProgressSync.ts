import type { PlayerStats } from "./PlayerController";

/**
 * One companion's persisted shape. Enough to fully rebuild it on load
 * (preset + type) and restore the upgrade investment (level + weaponLevel).
 */
export interface CompanionSaveEntry {
  presetName: string;
  type: "ally" | "pet";
  level: number;
  weaponLevel: number;
}

/**
 * One-time SPECIALS-tab unlocks. These are premium upgrades the player
 * paid for and must survive death/restart no matter what.
 */
export interface SpecialsOwnedSnapshot {
  sabreSpin: boolean;
  sabreTwin: boolean;
  sabreGiant: boolean;
  autoLoot: boolean;
  roboDragon: boolean;
}

export interface ProgressSnapshot {
  stats: PlayerStats;
  weaponLevels: Record<string, number>;
  playerUpgrades?: Record<string, number>;
  inventoryCounts: Record<string, number>;
  hasFlightArmor: boolean;
  totalKills: number;
  highestWave: number;
  capturedCreatures: any[];
  savedAt: number;

  // ---- Added so resource gains, helper-bot upgrades and SPECIALS unlocks
  // ---- actually persist across death + restart (the prior shape was missing
  // ---- everything below, so any hard restart wiped them out).
  /** Helper-bot roster, including per-companion level + weaponLevel. */
  companions?: CompanionSaveEntry[];
  /** Effective companion cap (raised by the Robot Dragon unlock). */
  maxCompanions?: number;
  /** SPECIALS-tab one-time unlocks. */
  specialsOwned?: SpecialsOwnedSnapshot;
  /** Beam sabre upgrade level (1..5). */
  beamSabreLevel?: number;
  /** Per-element elemental specials levels. */
  elementalLevels?: Record<string, number>;
  /** Active world level (1 = "RESCUE THE ALLY", 2 = "HOLD THE LINE",
   *  3 = "PURGE THE VOID"). Persisted so logging out mid-campaign returns
   *  the player to the same level with matching sky tint, captain variant,
   *  and fortress placement. Older saves wrote only `1 | 2` — those still
   *  load (LevelSystem clamps unknown values to 1). */
  worldLevel?: 1 | 2 | 3;
}

export async function loadProgress(): Promise<ProgressSnapshot | null> {
  try {
    const res = await fetch("/api/progress/load", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.saveData) return null;
    const snap = data.saveData as ProgressSnapshot;
    if (!snap.stats) return null;
    return snap;
  } catch (err) {
    console.warn("[ProgressSync] loadProgress failed:", err);
    return null;
  }
}

export async function saveProgress(snapshot: ProgressSnapshot): Promise<boolean> {
  try {
    const res = await fetch("/api/progress/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ saveData: snapshot }),
    });
    if (!res.ok) return false;

    void fetch("/api/progress/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        level: snapshot.stats.level,
        credits: snapshot.stats.credits,
        experience: snapshot.stats.experience,
        highestWave: snapshot.highestWave,
        totalKills: snapshot.totalKills,
        hasFlightArmor: snapshot.hasFlightArmor,
      }),
    }).catch(() => {});

    return true;
  } catch (err) {
    console.warn("[ProgressSync] saveProgress failed:", err);
    return false;
  }
}
