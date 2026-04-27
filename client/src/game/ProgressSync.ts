import type { PlayerStats } from "./PlayerController";

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
