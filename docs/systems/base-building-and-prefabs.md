# Base building & prefabs

| File | Role |
|---|---|
| [`BaseSystem.ts`](../../client/src/game/BaseSystem.ts) | The player's base — placement origin, structure roster, multi-level support. |
| [`BuildingSystem.ts`](../../client/src/game/BuildingSystem.ts) | Grid-snap placement, rotation, removal. |
| [`PrefabSystem.ts`](../../client/src/game/PrefabSystem.ts) | Save / load named prefabs (groups of structures). |

## Player flow

1. Open the Build mode hotbar (HUD).
2. Pick a structure or prefab.
3. Ghost-mesh follows the cursor with grid snapping (`BuildingSystem`).
4. Click to place — fires `BASE_STRUCTURE_PLACED`.
5. Right-click placed structure to upgrade (multi-level) — fires
   `BASE_STRUCTURE_UPGRADED`.
6. Interact with any structure — fires `BASE_INTERACT { structureId }`.

## Persistence

`ProgressSnapshot.base` carries:

- The base origin.
- Every placed structure (`{ id, kind, position, rotation, level }`).
- Saved prefab definitions.

`PrefabSystem.serialize` / `deserialize` round-trip prefabs through the
snapshot.

## Adding a structure type

1. Declare the structure in `BaseSystem.ts`'s structure table
   (display name, mesh builder, footprint, max level, upgrade costs).
2. Add the buildable to the build hotbar registration.
3. Add an icon to the HUD if needed.

## Tips

- Mesh height/2 rule applies. Use `BuildingSystem.snapToGrid(pos)` then
  add `height/2` to the y component.
- Multi-level upgrades should reuse the same root TransformNode; only
  swap the visual mesh. That keeps placement state stable across
  upgrades.
