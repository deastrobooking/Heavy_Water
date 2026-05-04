# Characters, robots, and armor

Heavy Water has two parallel "body" pipelines:

- **Humanoids** (player, captains, friendly NPCs, rescuees, lab animals)
  built from `HumanoidCharacter` with bolt-on armor pieces.
- **Robots** (most enemies, companions, bio-creatures) built parametrically
  by `RobotFactory` from a `RobotStyle` blueprint.

Both pipelines feed into the same cell-shaded material conventions and
can wear armor produced by `ArmorMaterialFactory`.

## Components

| File | Role |
|---|---|
| [`HumanoidCharacter.ts`](../../client/src/game/HumanoidCharacter.ts) | Builds a humanoid skeleton (root + head + torso + arms + legs) at a given `visualScale`. |
| [`HumanoidPresets.ts`](../../client/src/game/HumanoidPresets.ts) | Named humanoid blueprints (`HUMANOID`, `TITAN`, `DREAD`, plus rescuee and NPC presets). |
| [`HumanoidArmorParts.ts`](../../client/src/game/HumanoidArmorParts.ts) | Per-slot mesh constructors for humanoid armor. |
| [`RobotDesigner.ts`](../../client/src/game/RobotDesigner.ts) | The `RobotStyle` schema: archetype, body proportions, options (wings, cannons, visor, antennae, …) and `ROBOT_THEMES` tints. |
| [`RobotFactory.ts`](../../client/src/game/RobotFactory.ts) | Reads a `RobotStyle`, emits a TransformNode hierarchy of cell-shaded primitives, caches materials per style key. |
| [`RobotPresets.ts`](../../client/src/game/RobotPresets.ts) | Named enemy/companion blueprints (`ScoutPrime`, `BruteAlpha`, …). |
| [`BossVariants.ts`](../../client/src/game/BossVariants.ts) | Boss preset overrides chosen per-level via `LevelDef.bossVariantId`. |
| [`RobotArmorSystem.ts`](../../client/src/game/RobotArmorSystem.ts) | Slot-based armor configurator (helmet/chest/back/shoulders/arms/legs/weapons). Loads parts from `RobotArmorParts*.ts`. |
| [`RobotArmorParts.ts`](../../client/src/game/RobotArmorParts.ts) and `RobotArmorPartsExtra.ts`, `RobotArmorPartsEvil.ts` | Concrete part meshes, indexed by slot id. |
| [`ArmorMaterialFactory.ts`](../../client/src/game/ArmorMaterialFactory.ts) | Per-palette material cache (`metal`, `black`, `ceramic`, `gold`, `neon`, `trim`). Salted so factions can't accidentally share a cached material. |
| [`ArmorSystem.ts`](../../client/src/game/ArmorSystem.ts) | Player armor inventory: pieces (`helmet`/`chest`/`legs`/`boots`), elemental affinity, defense rolls, `ELEMENTAL_RESISTANCES`. |
| [`ArmorCapsuleSystem.ts`](../../client/src/game/ArmorCapsuleSystem.ts) | Tiered "capsule upgrades" the player applies in-world (flight armor, defense bonuses, special abilities). |
| [`CharacterEditor.tsx`](../../client/src/game/CharacterEditor.tsx) | Main-menu UI: Body / Armor / Colors / Boss Style tabs. Persists to `ProgressSnapshot.characterCustomization`. |

## How an enemy is built (end-to-end)

```
EnemySystem.spawn(...)  → looks up a RobotPreset (RobotPresets.ts)
                        → applies BossVariant if it's a boss
                        → calls RobotFactory.createRobot(descriptor, position)
                          ├── validateStyle() clamps numeric fields
                          ├── allocates one TransformNode per limb
                          ├── builds primitives per `archetype` + options
                          └── reuses cached cell-shaded materials per (key,color)
                        → CombatSystem registers the resulting root with DamageSystem
```

The rendered body **is** the collider — there are no separate hitboxes.
`DamageSystem` raycasts against the picked mesh and walks up to the
registered root.

## How the player is built

```
HumanoidPresets.HUMANOID  →  HumanoidCharacter(definition)
                             ├── allocates a `root` TransformNode
                             ├── allocates a `visualRoot` child, scaled by definition.visualScale
                             └── builds head/torso/arms/legs on visualRoot
HumanoidArmorParts                ├── adds armor meshes per slot (helmet, chest, …)
ArmorMaterialFactory              └── colors them from the active palette
PlayerController                  → owns root.position, drives all motion
```

The `visualScale` indirection exists because the original presets were
authored at ~18-unit "mech" scale but the player's collision capsule
assumes a 2 m humanoid. Setting `visualScale: 0.12` shrinks the body to
~2.16 m without rewriting every preset.

## Cell-shading & materials

`ArmorMaterialFactory` is the canonical place to ask for a cell-shaded
material. Six keys cover the entire art direction:

| Key | Look |
|---|---|
| `metal` | banded brushed steel — armor plates |
| `black` | matte black — visors, joints, faction trim |
| `ceramic` | flat eggshell — civilian / sanctuary chrome |
| `gold` | hi-bias emissive yellow — Gold-tier upgrades, jewels |
| `neon` | high-emissive primary tint — energy weapons, jewels |
| `trim` | secondary tint, low spec — accents |

The factory takes an `ArmorPalette` (`{primary, secondary, trim, glow}`)
plus a `salt` string. The salt prevents two factions from sharing a
single cached `StandardMaterial` — sanctuary NPCs and Detroit cops can
both ask for `metal()` and get visually identical but separately-
disposable instances.

`RobotFactory` keeps its own per-`RobotStyle` material cache keyed by
`(matKey, color.rgb)` so the 200 robots in a wave reuse three materials
total per faction instead of 600.

## Customization persistence

`CharacterEditor.tsx` writes to two `ProgressSnapshot` slots:

- `characterCustomization` — body / armor / color choices (player).
- `bossStyleOverrides` — keyed by `bossVariantId`, lets the player retint
  the boss for the level they're playing.

Both round-trip through `ProgressSync.save()` so the look survives
restarts.

## Adding a body or armor variation

- **New humanoid preset:** add an entry to `HumanoidPresets.ts`, give
  it a unique key, and pick a `bodyType`. If it's an enemy, expose it
  via the same place enemies look up presets (`EnemySystem` /
  `BossVariants`).
- **New robot preset:** add to `RobotPresets.ts`. Pick an `archetype`
  the factory already supports — adding a new archetype is a
  `RobotFactory` change, not just a preset.
- **New armor slot:** add the slot id to `RobotArmorSystem.ArmorSetConfig`
  and `ArmorSetSerialized`, expose a part for it in `RobotArmorParts*.ts`,
  then surface the slot in `CharacterEditor.tsx`.
- **New material variant:** add a method to `ArmorMaterialFactory` and
  wire any callers that want it. Keep the six existing keys intact —
  several systems hardcode them.

## Related docs

- [`systems/rendering-and-cell-shading.md`](rendering-and-cell-shading.md) — the post-processing pipeline these materials feed into.
- [`systems/enemies-and-bosses.md`](enemies-and-bosses.md) — how presets become live enemies.
- [`how-to/add-an-enemy.md`](../how-to/add-an-enemy.md) — recipe.
