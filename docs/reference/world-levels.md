# World levels reference

Source: [`client/src/game/LevelSystem.ts`](../../client/src/game/LevelSystem.ts)
(`LEVEL_DEFS` table)

| # | Display name | Type | Boss | Notes |
|---|---|---|---|---|
| 1 | DETROIT — Star City Front | Combat (open world) | Inferno | Tutorial-tier; fortress at `(380, -120)` |
| 2 | DETROIT — Hold the Line | Combat (open world) | Plague | Burnt-amber re-tint; fortress at `(-360, -360)` |
| 3 | DETROIT — Purge the Void | Combat (open world) | Void | Deep night/violet re-tint; fortress at `(-120, 420)` |
| 4 | ASHUR SANCTUARY | Peaceful side-zone | — | Owned by [`SanctuarySystem.ts`](../../client/src/game/SanctuarySystem.ts); rolling village terrain, farm loop, pet clinic |
| 5 | ORBITAL FRONT | Spacelike combat | Void variant | Owned by [`SpaceLevelSystem.ts`](../../client/src/game/SpaceLevelSystem.ts) |
| 6 | PONTIAC SECRET LAB | Peaceful side-zone | — | Owned by [`PontiacLabSystem.ts`](../../client/src/game/PontiacLabSystem.ts); cave hatch warps to L7 |
| 7 | SWARMS LAIR | Underground combat side-zone | General Voidcrown | Owned by [`SwarmsLairSystem.ts`](../../client/src/game/SwarmsLairSystem.ts) |
| 8 | SAGINAW UNDERWATER LAB | Flooded combat side-zone | Frost variant | Owned by [`SaginawLabSystem.ts`](../../client/src/game/SaginawLabSystem.ts) |
| 9 | ZUG ISLAND — LEGION | Industrial combat side-zone | Inferno variant | Owned by [`ZugIslandSystem.ts`](../../client/src/game/ZugIslandSystem.ts) |
| 10 | ANN ARBOR APOCALYPSE | City combat side-zone | Void variant | Owned by [`AnnArborSystem.ts`](../../client/src/game/AnnArborSystem.ts) |
| 11 | MICHIGAN WILDS | Heightmap terrain side-zone | Wilds walkers | Owned by [`MichiganTerrainSystem.ts`](../../client/src/game/MichiganTerrainSystem.ts); uses `MIHEIGHTMAP.png`; rare pets, power blooms, giant walkers, rogue labs, rescue cages, and mothership patrols |

## Per-level fields (from `LevelDef`)

| Field | Purpose |
|---|---|
| `displayName`, `banner`, `objective`, `completeSubtitle` | UI strings |
| `difficultyMultiplier` | Wave spawn intensity (0 for peaceful zones) |
| `skyTint` | Multiplied into the SkySystem shader |
| `cityTheme.{tint, glowTint, ground}` | Re-color the same city geometry per level |
| `bossVariantId` | Boss preset (see `BossVariants.ts`) |
| `fortressCenter`, `spawnPoint` | World coordinates |
| `timeOfDay` | 0–24 hour of day passed to the day/night cycle |
| `peaceful` (optional) | Disables wave spawner |
| `spacelike` (optional) | Switches sky to starfield, modifies gravity |
| `lair` (optional) | Underground/cave arena flag |

## Helpers

```ts
LevelSystem.isPeaceful(level)   // L4, L6
LevelSystem.isSpacelike(level)  // L5
LevelSystem.isLair(level)       // L7
LevelSystem.isMichiganTerrain(level) // L11
```

`Game.tsx` reads these everywhere it gates by zone type.

## Persistence

`ProgressSnapshot` carries:

- `currentLevel` — last level the player was on
- `clearedLevels` — set of completed combat levels
- Per-level milestones:
  - `swarmsGeneralDefeated` (L7)
  - `freedLabAnimalIds[]` (L6)
  - `rescuedSyntheticIds[]` (L1/L2/L3/L5/L11)
  - `legendaryCompanionGranted` (cross-level)
  - others as added

## Adding a level

See [`how-to/add-a-level.md`](../how-to/add-a-level.md) and
[`how-to/add-a-side-zone.md`](../how-to/add-a-side-zone.md).
