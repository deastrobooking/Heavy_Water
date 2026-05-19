# How to add a new world level

A "world level" is a campaign or side-zone the player can warp to. Heavy
Water already ships multiple campaign fronts and side-zones. Adding the
next one follows a tight, predictable pattern. This guide uses **Level 7
(Swarms Lair)** as a worked example because it exercises every wiring
point.

## Prereqs

Read first:

- [`systems/levels-and-zones.md`](../systems/levels-and-zones.md) — what
  `LevelSystem` is and how it interacts with the rest of the game.
- [`reference/world-levels.md`](../reference/world-levels.md) — the
  current `LevelDef` table.

## Step 1 — extend the `WorldLevel` type and `LEVEL_DEFS`

File: [`client/src/game/LevelSystem.ts`](../../client/src/game/LevelSystem.ts)

1. Bump the `WorldLevel` union:
   ```ts
   export type WorldLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
   ```
2. Add the new entry to `LEVEL_DEFS` with a unique `displayName`,
   `banner`, `objective`, `difficultyMultiplier`, `skyTint`,
   `bossVariantId`, `fortressCenter`, `spawnPoint`, `completeSubtitle`,
   `timeOfDay`, and `cityTheme`. Copy the closest existing entry and
   tweak.
3. If your level is non-combat, add `peaceful: true`. If it's spacelike,
   `spacelike: true`. If it's an underground/cave arena, `lair: true`.
4. If you added a new flag, add a matching helper:
   ```ts
   static isLair(l: WorldLevel) { return !!LEVEL_DEFS[l].lair; }
   ```
   `Game.tsx` reads these helpers everywhere it gates by zone type.

## Step 2 — declare the persistence shape

File: [`client/src/game/ProgressSync.ts`](../../client/src/game/ProgressSync.ts)

Add fields to `ProgressSnapshot` for anything the level needs to
remember across reloads (e.g. `swarmsGeneralDefeated: boolean`,
`freedLabAnimalIds: string[]`). Save defaults; the load handler must
tolerate older snapshots that lack the new keys.

## Step 3 — add events to the bus

File: [`client/src/game/EventBus.ts`](../../client/src/game/EventBus.ts)

Add typed event constants for every cross-system signal the level
emits:

```ts
SWARMS_GENERAL_DEFEATED: "lair:generalDefeated",
LAB_CAVE_ENTERED:        "lab:caveEntered",
ANIMAL_FREED:            "lab:animalFreed",
```

Document the payload shape in a JSDoc comment above the constant —
that's the only contract the listeners will see.

## Step 4 — implement the level system

Create `client/src/game/MyLevelSystem.ts`. Mirror the pattern of
[`SwarmsLairSystem.ts`](../../client/src/game/SwarmsLairSystem.ts) or
[`PontiacLabSystem.ts`](../../client/src/game/PontiacLabSystem.ts):

- Constructor takes `(scene, enemySystem, playerPosProvider, handles, …)`
  where `handles` is a typed bag (city generator, foliage refs,
  `lodCull`, etc.) it can hide / restore.
- On mount: build your geometry, call `hideOuterWorld()` to suppress
  the city / mountains / foliage if you're a self-contained zone, and
  emit a `UI_MESSAGE`.
- On dispose: restore everything you hid, detach every EventBus
  listener, dispose every observer.

If the level needs persisted boss state, accept an `alreadyDefeated`
constructor arg and short-circuit the boss spawn + kill listener when
true. Rationale and example in
[`SwarmsLairSystem`](../../client/src/game/SwarmsLairSystem.ts).

## Step 5 — wire `Game.tsx`

File: [`client/src/game/Game.tsx`](../../client/src/game/Game.tsx)

This is the only place that touches React + Babylon, so all wiring
collects here. Mirror the existing side-zone patterns:

1. **Refs** — add `myLevelSystemRef = useRef<MyLevelSystem | null>(null)`
   and any persisted state refs (`swarmsGeneralDefeatedRef`, etc.).
2. **`LEVEL_STARTED` listener** — inside `initializeGame`, mount the
   system when the new level is entered and dispose it when leaving.
   Search for the `isLair` block to see the canonical mount/dispose
   shape.
3. **Init failure path (`catch`)** — dispose your new system in the
   `catch` block of `initializeGame` so failed retries don't leak
   listeners. Required.
4. **React effect cleanup** — dispose your system in the `useEffect`
   return so unmounting `<Game/>` is clean.
5. **`saveProgress` + load handler** — copy any persisted refs into
   the snapshot in `buildSnapshot`, restore them in the load handler.
6. **`handleFastTravel`** — bump the cap if your new level is reachable
   via the TRAVEL menu.
7. **`travelDestinations`** — add a row so the new level appears in the
   TRAVEL UI.
8. **Other gating** — exclude your level from any spawner / fortress /
   foliage code that doesn't belong (search for `isLair`, `isPeaceful`,
   `isSpacelike` and add your flag wherever it makes sense).

## Step 6 — update the docs

- Append a section to [`replit.md`](../../replit.md) under
  **Levels & Zones** describing the new level, its trigger, and any
  persistence flags.
- Add a row to
  [`reference/world-levels.md`](../reference/world-levels.md).

## Step 7 — verify

```bash
npm run check        # tsc — must be clean
npm run dev          # smoke-test the new level via TRAVEL
```

Manual test plan:

- Reach the new level via TRAVEL.
- Trigger every persisted state change.
- Save (any progress event auto-saves; or wait for the autosave
  interval).
- Reload. Confirm persisted state restored.
- Leave and re-enter. Confirm the level cleans up (no leaked listeners,
  no doubled meshes, restored city visibility).

## Common mistakes

- Forgetting to clean up in **all three** Game.tsx shutdown sites
  (init catch, restart, React-effect cleanup).
- Forgetting `EventBus.clear()` in the init-failure catch path so a
  retry doesn't fan stale listeners onto fresh systems.
- Hiding world meshes on mount but not restoring on dispose, leaving
  the city invisible after warping back.
- Spawning bosses unconditionally on revisit when the persisted
  defeated flag should suppress them.
