# How to add a side-zone (peaceful or combat)

A "side-zone" is a self-contained area that swaps out the open-world
meshes for its own geometry — sanctuary, secret lab, cave arena, space
arena. Each is its own world level. The mechanics are:

- The zone hides the city, mountains, and foliage on mount.
- It builds its own floor / walls / props inside a `TransformNode` it
  owns.
- It restores everything it hid on dispose.

Existing examples:

| Zone | File | Type |
|---|---|---|
| Ashur Sanctuary (L4) | [`SanctuarySystem.ts`](../../client/src/game/SanctuarySystem.ts) | Peaceful |
| Pontiac Secret Lab (L6) | [`PontiacLabSystem.ts`](../../client/src/game/PontiacLabSystem.ts) | Peaceful |
| Orbital Front (L5) | [`SpaceLevelSystem.ts`](../../client/src/game/SpaceLevelSystem.ts) | Spacelike combat |
| Swarms Lair (L7) | [`SwarmsLairSystem.ts`](../../client/src/game/SwarmsLairSystem.ts) | Underground combat |

## The pattern

All four files share the same shape. To add a new side-zone, copy the
closest existing one and edit. Pick:

- **Peaceful** → start from `SanctuarySystem.ts`. Set `peaceful: true` in
  `LEVEL_DEFS`. The wave spawner reads this and disables itself.
- **Combat side-zone** → start from `SwarmsLairSystem.ts`. It shows how
  to spawn a boss + minions inside a custom arena and how to gate the
  boss spawn by a persisted flag.
- **Spacelike** → start from `SpaceLevelSystem.ts`. Sets `spacelike: true`
  so the SkySystem switches to a starfield and gravity rules differ.

Then follow [`add-a-level.md`](add-a-level.md) — every step from there
applies. The side-zone-specific bits are:

1. **Hide the world on mount.** Call a `hideOuterWorld()` helper that
   sets `setEnabled(false)` on the city generator's root, foliage
   systems, mountain ring, and prop system; suppress LOD culling via
   `handles.lodCull?.setSuppressed(true)`. Save the originals so you can
   restore them in dispose.

2. **Build the zone under a single root TransformNode.** Disposing the
   root cascades to every child mesh.

3. **Manage your own listeners.** Save observer handles (`scene.onBeforeRenderObservable`)
   and `bus.on(...)` callbacks; remove them all in `_disposeInner`.

4. **Restore on dispose.** Re-enable the world meshes, un-suppress LOD,
   then dispose your root. Order matters — re-enable first so the player
   isn't briefly in an empty world.

5. **Gate the wave spawner.** Inside `Game.tsx`'s `LEVEL_STARTED`
   handler, the `peaceful` / `spacelike` / `lair` flags determine whether
   `enemySystem.spawnWave(...)` runs. Add your flag to the same gate.

## Persisted state for combat side-zones

Combat side-zones often need persistence (boss defeated, items collected).
Add the field to `ProgressSnapshot` (see
[`how-to/modify-the-database.md`](modify-the-database.md) — the Drizzle
schema doesn't change because saves are stored as a single `jsonb`
column), then thread it into your system's constructor so it can
short-circuit the boss spawn on revisit.

## Verification checklist

- [ ] Entering the zone hides the city + mountains + foliage.
- [ ] Leaving the zone restores them, instantly and cleanly.
- [ ] No console warnings about leaked observers or duplicate meshes.
- [ ] Persisted state survives a full reload.
- [ ] Reaching the zone via TRAVEL works.
- [ ] If you added an in-world entrance (like the Pontiac Lab cave
      hatch), the entrance fires the matching event and `Game.tsx`
      routes it through `handleFastTravel`.
- [ ] [`replit.md`](../../replit.md) and
      [`reference/world-levels.md`](../reference/world-levels.md) updated.
