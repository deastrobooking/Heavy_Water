# Progression & saves

The single source of truth for player state is the **`ProgressSnapshot`**
type defined at the top of
[`ProgressSync.ts`](../../client/src/game/ProgressSync.ts).

## What's in a snapshot

Roughly:

| Field | Owned by |
|---|---|
| `stats` (level, credits, XP, …) | `PlayerController` / various |
| `playerUpgrades` (per-upgrade levels) | `PlayerController` |
| `weaponLevels` | `WeaponsSystem` |
| `beamSabreLevel`, sabre tier flags | `BeamSabreSystem` |
| `elementalLevels` | `ElementalSpecialsSystem` |
| `specialsOwned` (sabre tiers, melee arsenal own/combo/special, autoLoot, robo-dragon, autoTarget, supermanFlight, gold sabre) | `BeamSabreSystem`, `MeleeArsenalSystem`, `WeaponsSystem`, `PickupSystem`, `PlayerController` |
| `appliedCapsuleUpgradeIds` | `ArmorCapsuleSystem` |
| `equippedArmor` (every slot + active element) | `ArmorSystem` |
| `baseStructureLevels` (per-kind lab/garden tier) | `BaseSystem` |
| `inventoryCounts` (items + crafting materials) | `InventorySystem` |
| `companions[]` + `maxCompanions` | `CompanionSystem` |
| `capturedCreatures[]`, `bioDexCaughtIds[]` | `BioCreatureSystem` |
| `jewelMounts` | `JewelSystem` |
| `worldLevel`, `lootedTempleIds[]` | `LevelSystem`, `MountainRingSystem` |
| Per-zone milestones (`swarmsGeneralDefeated`, `freedLabAnimalIds`, `rescuedSyntheticIds`, `legendaryCompanionGranted`, …) | side-zone systems |
| `hasFlightArmor`, `totalKills`, `highestWave` | various |
| `savedAt` (timestamp) | `ProgressSync` |

> **Persistence audit (May 2026):** A complete audit confirmed every
> in-game upgrade now round-trips through this snapshot. Three latent
> bugs were fixed at the same time:
>
> - **`ArmorCapsuleSystem.applied`** wasn't being saved, so the shop
>   re-offered (and could re-charge for) every previously-bought
>   capsule upgrade — including the 5000-credit Quantum Exo-Suit. Now
>   persisted via `appliedCapsuleUpgradeIds`.
> - **`ArmorSystem.equippedArmor`** Map wasn't being saved, so every
>   armor piece (capsule and loot) plus the active elemental aura
>   silently reset to nothing on every reload. Now persisted via
>   `equippedArmor`.
> - **`BaseSystem` structure levels** weren't being saved, so the
>   gears/scrap/energy cores spent upgrading the lab and garden were
>   silently refunded into a tier-1 downgrade on every reload. Now
>   persisted via `baseStructureLevels`; `BaseSystem.registerStructure`
>   pre-bumps newly-mounted structures to the saved tier.

## Save lifecycle

```
Autosave timer  (every N seconds in Game.tsx)
        │
        ▼
ProgressSync.buildSnapshot() → ProgressSnapshot
        │
        ▼
POST /api/progress/save  { saveData: snapshot }   (server/auth.ts)
        │
        ▼
DatabaseStorage.savePlayerProgress(userId, snapshot)
        │
        ▼
player_progress.saveData (JSONB column)   (shared/schema.ts)
```

Plus `POST /api/progress/stats` mirrors the headline numbers
(level / credits / XP / highest wave / total kills / has flight armor)
to the `users` table for the leaderboard.

## Load lifecycle

```
GET /api/progress/load  →  ProgressSnapshot
        │
        ▼
Game.tsx load handler:
  • restore stats, inventory, weapons, companions, base, jewels
  • set levelSystem.forceStart(snapshot.currentLevel)
  • restore per-zone milestone refs (swarmsGeneralDefeatedRef, …)
  • mount the right side-zone system if currentLevel is one
```

## Force-save on milestones

Long autosave intervals would lose milestone progress on a crash. The
established pattern is:

1. Side-zone system fires the milestone event (e.g. `SWARMS_GENERAL_DEFEATED`).
2. Game.tsx's listener updates the persisted ref and calls
   `forceSaveRef.current?.()`.
3. `forceSaveRef` is bound in `initializeGame` and **must be nulled in
   the init-failure catch** so a retry doesn't call into a disposed
   system.

`handleCapsuleUpgrade` and `handleUnlockSpecial` follow the same
pattern — any one-time premium purchase calls `forceSaveRef.current?.()`
on success so a crash within the 30-second autosave window can never
cost the player a 5000-credit upgrade.

## Adding a persisted field

1. Add to `ProgressSnapshot` in `ProgressSync.ts`.
2. Add a default in `buildSnapshot` (the snapshot must always serialize
   cleanly even if the game state isn't fully initialized).
3. Restore it in the load handler (`snapshot.myField ?? defaultValue`
   — older saves may not have the field).
4. If it's a milestone, force-save on change.

No DB migration is required — the entire snapshot rides in a single
`jsonb` column.

## Schema mirror to `users`

Headline progression (level, credits, XP, highest wave, total kills,
has flight armor) is duplicated to the `users` table on every save via
`/api/progress/stats`. This is what the leaderboard reads. If you add a
new "headline" stat, add it to the `users` table, the stats endpoint,
and the leaderboard query.
