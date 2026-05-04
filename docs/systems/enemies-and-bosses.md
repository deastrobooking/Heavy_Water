# Enemies & bosses

## Components

| File | Role |
|---|---|
| [`EnemySystem.ts`](../../client/src/game/EnemySystem.ts) | Wave spawner, captain spawning, per-enemy update loop, death handling. |
| [`AerialEnemySystem.ts`](../../client/src/game/AerialEnemySystem.ts) | Airborne hostiles (battleships, drones). |
| [`EnemyBaseSystem.ts`](../../client/src/game/EnemyBaseSystem.ts) | Hostile enemy bases with turrets and a vault. |
| [`BossVariants.ts`](../../client/src/game/BossVariants.ts) | Boss preset definitions referenced by levels. |
| [`RobotFactory.ts`](../../client/src/game/RobotFactory.ts) | Builds robot meshes from `RobotPresets`. |
| [`RobotDesigner.ts`](../../client/src/game/RobotDesigner.ts) | In-game editor for building custom robot allies. |
| [`RobotPresets.ts`](../../client/src/game/RobotPresets.ts) | Robot preset table — silhouette + parts + base stats. |
| [`HumanoidCharacter.ts`](../../client/src/game/HumanoidCharacter.ts) + [`HumanoidPresets.ts`](../../client/src/game/HumanoidPresets.ts) | Humanoid rig (player and captains share it). |
| [`HumanoidArmorParts.ts`](../../client/src/game/HumanoidArmorParts.ts) | Modular armor piece library for humanoids. |
| [`EnemyHealthBarSystem.ts`](../../client/src/game/EnemyHealthBarSystem.ts) | HTML overlay HP bars positioned in screen space. |

## Spawn paths

```
Wave spawner (EnemySystem)
    ├── pulls preset key from WAVE_POOL by weight
    └── spawnEnemyAt(preset, position) → factory builds mesh, FSM starts

Boss spawn (EnemySystem.spawnCaptain)
    ├── { isBossCaptain: true, variantId, humanoidPreset, healthMultiplier }
    └── stronger captain with named preset rig

Side-zone direct spawn
    └── side-zone systems call spawnEnemyAt / spawnCaptain explicitly
```

## Wave intensity

Per-level `difficultyMultiplier` (in `LEVEL_DEFS`) scales spawn count
and HP per wave. Peaceful zones gate the spawner to ~0 via the
`peaceful` flag in `Game.tsx`.

## Death

Every enemy registers with `DamageSystem`. On HP ≤ 0, `DamageSystem`
fires `ENEMY_KILLED` with `{ enemyId, position, isBossCaptain, … }`.
Listeners include:

- `PickupSystem` — rolls drop tables.
- HUD — kill count, XP popup.
- Side-zone systems — boss-defeat detection (see `SwarmsLairSystem`).
- `ProgressSync` — increments `totalKills`.

## Boss Fortresses

`EnemyBaseSystem` builds a defensive base with turrets around each
combat-level fortress. Clearing turrets emits
`BOSS_FORTRESS_TURRETS_CLEARED`; cracking the vault emits
`BOSS_FORTRESS_CLEARED`. Boss-fortress vaults guarantee a Power Jewel
drop (see `JewelSystem`).

## Boss-style customization

The Character Editor's **Boss Style** tab lets the player override
enemy appearance globally. The override is stored in `ProgressSnapshot`
and re-applied on load.

## Bio-Creature Dex

A separate, larger family — see
[`systems/companions-and-bio-creatures.md`](companions-and-bio-creatures.md).
