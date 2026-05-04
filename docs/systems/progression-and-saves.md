# Progression & saves

The single source of truth for player state is the **`ProgressSnapshot`**
type defined at the top of
[`ProgressSync.ts`](../../client/src/game/ProgressSync.ts).

## What's in a snapshot

Roughly:

| Field | Owned by |
|---|---|
| `stats` (level, credits, XP, …) | `PlayerController` / various |
| `weaponLevels` | `CombatSystem`, `MeleeArsenalSystem` |
| `inventoryCounts` | `InventorySystem` |
| `companions[]` + `maxCompanions` | `CompanionSystem` |
| `capturedCreatures[]` | `BioCreatureSystem` |
| `base` (structures + prefabs) | `BaseSystem`, `PrefabSystem` |
| `jewelMounts` | `JewelSystem` |
| `clearedLevels`, `currentLevel` | `LevelSystem` |
| Per-zone milestones (`swarmsGeneralDefeated`, `freedLabAnimalIds`, `rescuedSyntheticIds`, `legendaryCompanionGranted`, …) | side-zone systems |
| `hasFlightArmor`, `totalKills`, `highestWave` | various |
| `savedAt` (timestamp) | `ProgressSync` |

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
