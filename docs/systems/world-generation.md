# World generation

The open world is **1200×1200** with a central city and four biomes
ringed by mountains. Everything is procedural and built once per
session.

## Components

| File | Role |
|---|---|
| [`CityGenerator.ts`](../../client/src/game/CityGenerator.ts) | Builds the central city: blocks, buildings, streets, accessible interiors, sky racetrack, neon. Re-tinted per-level via `cityTheme`. |
| [`MountainRingSystem.ts`](../../client/src/game/MountainRingSystem.ts) | Ring of mountains at the world's edge, blocks egress. |
| [`AlienFoliageSystem.ts`](../../client/src/game/AlienFoliageSystem.ts) | L-system alien plants in the corrupted biomes. |
| [`EarthFoliageSystem.ts`](../../client/src/game/EarthFoliageSystem.ts) | L-system Earth plants for the sanctuary biome. |
| [`EnvironmentPropSystem.ts`](../../client/src/game/EnvironmentPropSystem.ts) | Scattered environment props (rocks, debris, lampposts). |
| [`LODCullSystem.ts`](../../client/src/game/LODCullSystem.ts) | Per-frame distance culling for environment meshes. |
| [`SkySystem.ts`](../../client/src/game/SkySystem.ts) | Custom-shader gradient skybox, day/night cycle, weather, per-level `skyTint`. |
| [`MiningSystem.ts`](../../client/src/game/MiningSystem.ts) | Glowing destructible resource nodes. |
| [`lsystem/`](../../client/src/game/lsystem) | L-system grammar + renderer + plant presets. |

## Build order (in `Game.tsx#initializeGame`)

1. `BabylonEngine` — engine + scene + camera + post-FX pipeline.
2. `SkySystem` — sky + lighting + day/night cycle.
3. `CityGenerator` — buildings, streets, interiors.
4. `MountainRingSystem` — mountain ring.
5. `AlienFoliageSystem` + `EarthFoliageSystem` — L-system plants.
6. `EnvironmentPropSystem` — scattered props.
7. `LODCullSystem` — registers all of the above for distance culling.
8. `MiningSystem` — places resource nodes.

## Per-level theming

Each `LevelDef` (in `LevelSystem.ts`) supplies:

- `skyTint` — multiplied into the sky shader.
- `timeOfDay` — sets the day/night cycle on level start.
- `cityTheme.tint` / `glowTint` / `ground` — multiplied into the city
  shaders so the same geometry reads as a completely different city
  per level.

These re-apply when `LEVEL_STARTED` fires, without rebuilding meshes.

## Side-zone hide/restore

Side-zones (sanctuary, lab, lair, space) hide all of the above on
mount via `setEnabled(false)` on the relevant root nodes, plus
`lodCull?.setSuppressed(true)`. They restore everything on dispose.
See [`systems/levels-and-zones.md`](levels-and-zones.md) and
[`how-to/add-a-side-zone.md`](../how-to/add-a-side-zone.md).

## L-system foliage

`LSystem.ts` evaluates a grammar string (axiom + rules + iterations).
`LSystemRenderer.ts` turns the result into Babylon meshes with shared
materials. `LSystemPresets.ts` and `EarthLSystemPresets.ts` define the
plant species; `FoliagePlacement.ts` decides where they go in the
world.

Adding a plant species is a one-file change: add a preset and add it
to the placement weight table.
