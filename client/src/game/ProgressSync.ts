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
  /** Auto-Target Module — bends primary fire toward the nearest enemy
   *  inside an aim cone. Premium SPECIALS unlock so it must persist
   *  across death/restart like the other one-time purchases. */
  autoTarget?: boolean;
  /** Superman Flight — Space + KeyL airborne combo enters a free-flight
   *  mode that re-uses the existing weapons stack with no energy drain
   *  and a held-Space speed boost. Premium SPECIALS unlock; persists. */
  supermanFlight?: boolean;
  /** Final-tier Beam Sabre (gold). Restyles the blade with inner blue /
   *  middle red / outer gold layers and replaces the energy-wave launch
   *  with three stacked waves (blue → red → largest gold). Premium
   *  SPECIALS unlock; persists across death/restart. */
  sabreGold?: boolean;
  // ---- Melee Arsenal — alternate melee weapons that swap in for the
  // ---- Beam Sabre via KeyB. Each weapon has three SPECIALS-tab tiers:
  // ---- own (unlock the weapon + base primary attack), combo (extra
  // ---- chain hits / pull-in / upper-swing depending on weapon), and
  // ---- special (signature super-move). All optional for back-compat.
  glaiveOwn?: boolean;
  glaiveCombo?: boolean;
  glaiveSpecial?: boolean;
  daggersOwn?: boolean;
  daggersCombo?: boolean;
  daggersSpecial?: boolean;
  axeOwn?: boolean;
  axeCombo?: boolean;
  axeSpecial?: boolean;
  whipOwn?: boolean;
  whipCombo?: boolean;
  whipSpecial?: boolean;
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
  /** Persistent dex history — every species id ever caught. Survives
   *  DEPLOY (which removes the creature from the live roster) so dex
   *  completion only ever grows. Optional for backward compat with
   *  pre-dex saves. */
  bioDexCaughtIds?: string[];
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
  /** Active world level. Persisted so logging out mid-campaign or inside
   *  a side-zone returns the player to the same destination with matching
   *  sky tint, world swap, and spawn placement. Older saves wrote only
   *  `1 | 2`; LevelSystem still clamps safely on load. */
  worldLevel?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  /** Hidden-temple ids the player has already raided across all levels.
   *  Each id is namespaced by level (e.g. "L1_temple_ne") so re-entering
   *  an earlier level keeps that level's loot history intact. Optional
   *  for backward compat with pre-temple saves. */
  lootedTempleIds?: string[];
  /** Power-Jewel mounts: WeaponType → JewelTier ("rough" | "cut" |
   *  "flawless"). Stored separately from inventoryCounts because mounted
   *  jewels are NOT in the inventory — they were consumed when mounted.
   *  Optional for backward compat with pre-jewel saves. */
  jewelMounts?: Record<string, string>;
  /** Ids of humanoid synthetics the player has already freed from their
   *  containment cages. Persisted across runs so re-entering a level never
   *  respawns a rescuee whose story moment has already played. Optional
   *  for backward compat with pre-rescue saves. */
  rescuedSyntheticIds?: string[];
  /** Ids of caged lab animals the player has already freed inside the
   *  Pontiac Secret Lab. Counts toward the legendary-companion grant
   *  alongside `rescuedSyntheticIds` and `swarmsGeneralDefeated`.
   *  Optional for backward compat. */
  freedLabAnimalIds?: string[];
  /** True once the player has slain the General Voidcrown at the bottom
   *  of the Swarms Lair (Level 7). Persists across runs so re-loading
   *  doesn't reset the legendary-companion grant condition. */
  swarmsGeneralDefeated?: boolean;
  /** True once the player has been awarded the legendary mini-General
   *  humanoid companion. Guards `tryGrantLegendaryCompanion` from
   *  re-issuing the same companion if all conditions are still met on
   *  load. Optional for backward compat. */
  legendaryCompanionGranted?: boolean;
  /** Ids of one-time `ArmorCapsuleSystem` upgrades the player has
   *  already purchased (`flight_armor`, `speed_boost`, `titan_defense`,
   *  `fire_infusion`, `electric_infusion`, `quantum_armor`). Without
   *  this the shop re-offered them on every reload and the player
   *  could be charged repeatedly — most painfully for the 5000-credit
   *  Quantum Exo-Suit. Optional for backward compat. */
  appliedCapsuleUpgradeIds?: string[];
  /** Per-kind base-structure upgrade levels (currently `lab` and
   *  `garden`). Each is a number in `[1, MAX_BASE_LEVEL]`. The level
   *  governs companion cap (lab) and garden capture cap + bonus —
   *  without persisting them, a player who spent gears/scrap/energy
   *  cores upgrading would silently watch their structures reset to
   *  level 1 on every reload. Optional for backward compat. */
  baseStructureLevels?: { lab?: number; garden?: number };
  /** Full equipped-armor loadout (every slot) + the active elemental
   *  attunement. Captures BOTH capsule-bought pieces (Aero-Flight
   *  Chestplate, Kinetic Boots, Titan Chestplate, Quantum Exo-Suit)
   *  and any rare/loot armor the player picked up in the world.
   *  Without this the equipped armor map silently emptied on every
   *  reload, dropping defense / health / stamina bonuses + the
   *  elemental aura back to zero. Optional for backward compat. */
  equippedArmor?: {
    pieces: Array<{
      id: string;
      name: string;
      type: "helmet" | "chest" | "legs" | "boots";
      element: string | null;
      defense: number;
      healthBonus: number;
      staminaBonus: number;
      level: number;
      rarity: number;
    }>;
    element: string | null;
  };
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
