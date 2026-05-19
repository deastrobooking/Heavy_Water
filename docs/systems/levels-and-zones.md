# Levels & zones

Heavy Water has **eleven** world levels. Three are open-world combat
fronts (L1/L2/L3), with side-zones for the sanctuary, orbit, Pontiac
Lab, Swarms Lair, Saginaw, Zug Island, Ann Arbor, and Michigan Wilds.

## Components

| File | Role |
|---|---|
| [`LevelSystem.ts`](../../client/src/game/LevelSystem.ts) | Owns `WorldLevel`, `LEVEL_DEFS`, `forceStart`, helpers (`isPeaceful`, `isSpacelike`, `isLair`). Emits `LEVEL_STARTED` / `LEVEL_COMPLETED`. |
| [`SanctuarySystem.ts`](../../client/src/game/SanctuarySystem.ts) | L4 — peaceful village, rolling terrain, pet clinic, farm, and NPCs. |
| [`SpaceLevelSystem.ts`](../../client/src/game/SpaceLevelSystem.ts) | L5 — orbital combat. |
| [`PontiacLabSystem.ts`](../../client/src/game/PontiacLabSystem.ts) | L6 — secret lab interior + caged animals + cave hatch. |
| [`SwarmsLairSystem.ts`](../../client/src/game/SwarmsLairSystem.ts) | L7 — underground arena + General Voidcrown boss. |
| [`SaginawLabSystem.ts`](../../client/src/game/SaginawLabSystem.ts) | L8 — flooded combat lab. |
| [`ZugIslandSystem.ts`](../../client/src/game/ZugIslandSystem.ts) | L9 — industrial Legion arena. |
| [`AnnArborSystem.ts`](../../client/src/game/AnnArborSystem.ts) | L10 — city combat zone with mothership crash site. |
| [`MichiganTerrainSystem.ts`](../../client/src/game/MichiganTerrainSystem.ts) | L11 — MIHEIGHTMAP terrain, water/grass/rock tiers, rare pets, power blooms, giant walkers, labs, rescue pockets, and mothership patrol landmarks. |
| [`Game.tsx`](../../client/src/game/Game.tsx) | Mounts/disposes the right side-zone system on each `LEVEL_STARTED`. |
| [`LevelSerializer.ts`](../../client/src/game/LevelSerializer.ts) | Serializes editor-built levels for prefab export. |

## Lifecycle

```
TRAVEL menu choose level (or in-world trigger like LAB_CAVE_ENTERED)
        │
        ▼
Game.tsx — handleFastTravel(N)
        │
        ▼
levelSystem.forceStart(N)  ──emit──►  LEVEL_STARTED { level, isPeaceful, isSpacelike, isLair }
        │
        ▼
Game.tsx LEVEL_STARTED handler:
  • dispose previous side-zone system (if any)
  • mount new side-zone system (if isPeaceful/isSpacelike/isLair)
  • gate enemy spawner on peacefulness
  • seed per-zone rescues and side-zone encounter layers
  • set sky theme, time-of-day, city tint per LEVEL_DEFS
  • set wave intensity by difficultyMultiplier
```

## `LevelDef` shape

See `LEVEL_DEFS` in `LevelSystem.ts`. Every level supplies:

| Field | Purpose |
|---|---|
| `displayName`, `banner`, `objective`, `completeSubtitle` | UI strings |
| `difficultyMultiplier` | wave spawner intensity scalar |
| `skyTint` | shader uniform passed to `SkySystem` |
| `cityTheme.{tint, glowTint, ground}` | per-level city recoloring |
| `bossVariantId` | boss preset for the level's boss |
| `fortressCenter`, `spawnPoint` | world coordinates |
| `timeOfDay` | hour of day (0–24) for the day/night cycle |
| `peaceful`, `spacelike`, `lair` (optional) | side-zone flags |

## Persistence interactions

`ProgressSnapshot` (in `ProgressSync.ts`) carries:

- `currentLevel` — last level the player was on.
- `clearedLevels` — set of completed combat levels.
- Per-level milestones (`swarmsGeneralDefeated`,
  `freedLabAnimalIds`, `rescuedSyntheticIds`,
  `legendaryCompanionGranted`, …).

Side-zone systems read these on construction so revisits don't respawn
already-defeated bosses or already-rescued NPCs.

## Level serialization (LevelSerializer)

`LevelSerializer` round-trips a base-built / editor-built layout to a
single JSON file. It only covers the **player-placed** content — base
buildings (`BuildingSystem`) and structures (`PrefabSystem`) — not
city geometry, foliage, or NPCs.

### Format

```jsonc
{
  "version": 1,                       // bump if the shape changes
  "name": "Detroit Build",
  "saved": 1730000000000,             // epoch ms
  "blocks":  [SerializedBlock,  …],   // from BuildingSystem.exportPlaced()
  "prefabs": [SerializedPrefab, …]    // from PrefabSystem.exportPlaced()
}
```

Each `SerializedBlock` is `{ type: BlockType, pos: [x, y, z], rot: number }`
and each `SerializedPrefab` is `{ defId: string, pos: [x, y, z], rot: number }`.

### API surface

```ts
serializer.serialize(name?)        // → SerializedLevel
serializer.toJson(name?)           // → pretty JSON string
serializer.download(filename?)     // → triggers a browser download (auto-named by epoch)
serializer.restore(data)           // → clears + re-applies; throws on bad version
serializer.loadFromFile(File)      // → reads a user-selected file
```

### Restore semantics

- Validates `version === 1`. Anything else throws — bump the version
  and write a migrator before changing the shape.
- Clears `BuildingSystem` and `PrefabSystem` first (`clearAll()` on
  each), so restore is destructive.
- Per-entry validation is loose-and-skippy: malformed entries are
  logged and skipped, not fatal. The final summary `{ blocks, prefabs }`
  is the count of entries that successfully placed.
- Emits a `UI_MESSAGE` toast on save and load.

### Adding a new persisted layer

If you add a new player-placed system that should round-trip:

1. Give it `exportPlaced()` and `clearAll()` methods analogous to
   `BuildingSystem`'s.
2. Add the new array to `SerializedLevel`.
3. **Bump `version` to 2** and add a migration that defaults the new
   field to `[]` when loading a v1 save.
4. Update this section.

## Wiring rules (Game.tsx)

Every side-zone system must be disposed at **all three** shutdown sites:

1. The `LEVEL_STARTED` handler when leaving the zone.
2. The init-failure `catch` block in `initializeGame`.
3. The React `useEffect` cleanup return.

Plus: emit `EventBus.clear()` in the init-failure path so a retry
doesn't fan stale listeners onto fresh systems. The legendary-grant
helper (`tryGrantLegendaryCompanion`) and force-save closure
(`forceSaveRef`) must also be nulled in the catch block.

This pattern is enforced by code review — see
[`how-to/add-a-level.md`](../how-to/add-a-level.md) for the checklist.

## Common operations

| Operation | API |
|---|---|
| Read current level | `levelSystem.getCurrentLevel()` |
| Force-start a level | `levelSystem.forceStart(level)` (Game.tsx wraps this in `handleFastTravel`) |
| Read objective text | `levelSystem.getObjectiveText()` |
| Check peacefulness | `LevelSystem.isPeaceful(level)` (static) |
| Listen for level start | `bus.on(GameEvents.LEVEL_STARTED, …)` |
