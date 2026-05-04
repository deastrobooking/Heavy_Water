# How to add a new enemy

There are three enemy families. Pick the right one before writing code:

| Family | Use for | Owned by |
|---|---|---|
| **Robot** (insectoid, tank, walker, …) | Standard ground swarmers | [`EnemySystem.ts`](../../client/src/game/EnemySystem.ts) + [`RobotFactory.ts`](../../client/src/game/RobotFactory.ts) |
| **Humanoid** (captain, boss, General) | Story bosses with armor | [`EnemySystem.ts`](../../client/src/game/EnemySystem.ts) + [`HumanoidCharacter.ts`](../../client/src/game/HumanoidCharacter.ts) + [`HumanoidPresets.ts`](../../client/src/game/HumanoidPresets.ts) |
| **Aerial** (battleships, drones) | Airborne hostiles | [`AerialEnemySystem.ts`](../../client/src/game/AerialEnemySystem.ts) |

## A. Robot enemy

Robots are parametrically generated — you describe the silhouette and
parts, the factory builds the mesh and stat block.

### 1. Add a preset

File: [`client/src/game/RobotPresets.ts`](../../client/src/game/RobotPresets.ts)

Add an entry to `ROBOT_PRESETS`. Pick a unique key (e.g. `"crawler"`),
fill in body parts, colors, scale, and base stats (HP, speed, damage,
detection radius).

### 2. (Optional) New armor parts

If your robot needs new visual parts:

- [`RobotArmorParts.ts`](../../client/src/game/RobotArmorParts.ts) — base
  set
- [`RobotArmorPartsExtra.ts`](../../client/src/game/RobotArmorPartsExtra.ts)
  — extras
- [`RobotArmorPartsEvil.ts`](../../client/src/game/RobotArmorPartsEvil.ts)
  — evil/spiky variants

### 3. Spawn it

`EnemySystem` exposes:

```ts
enemySystem.spawnEnemyAt(presetKey, position);
enemySystem.spawnWave(count, level);   // wave spawner
```

If you want your enemy to appear in normal waves, add it to the wave
spawner's pool (search `EnemySystem.ts` for the `WAVE_POOL` table and
add your key with a weight).

### 4. Drops

If the enemy drops loot, add an entry in the drop table inside
[`PickupSystem.ts`](../../client/src/game/PickupSystem.ts) keyed by
preset name.

## B. Humanoid enemy (captain / boss)

Humanoids share the same rig as the player. They support armor
overrides, weapon mounts, and named presets.

### 1. Add a humanoid preset

File: [`client/src/game/HumanoidPresets.ts`](../../client/src/game/HumanoidPresets.ts)

```ts
HumanoidGeneralVoidcrown: {
  height: 23,
  bodyTint:  { r: 0.10, g: 0.05, b: 0.20 },
  armorTint: { r: 0.45, g: 0.05, b: 0.10 },
  helmet:    "crown",
  weapon:    "beamSabre",
  // …
}
```

### 2. Spawn via `spawnCaptain`

```ts
enemySystem.spawnCaptain(position, {
  isBossCaptain: true,
  variantId: "void",
  humanoidPreset: "HumanoidGeneralVoidcrown",
  healthMultiplier: 2.5,
});
```

The `isBossCaptain` flag is what triggers special drop tables and what
side-zone systems listen for in `ENEMY_KILLED` to detect a boss
defeat (see `SwarmsLairSystem.handleEnemyKilled`).

### 3. (Optional) Boss variant

If your humanoid is a campaign boss, add a `BossVariantId` entry in
[`BossVariants.ts`](../../client/src/game/BossVariants.ts) and reference
it from a level's `bossVariantId`.

## C. Aerial enemy

File: [`client/src/game/AerialEnemySystem.ts`](../../client/src/game/AerialEnemySystem.ts)

Aerials have their own spawn/despawn loop and their own AI. To add a
new aerial type:

1. Define the mesh + stats inside `AerialEnemySystem.ts`'s preset table.
2. Add the new key to its spawn-pool weights.
3. If the aerial drops Power Jewels, route through `PickupSystem`'s
   aerial-drop branch.

## Gotchas

- **Mesh height/2 rule.** Per `replit.md`, **all** mesh positions must
  use `height/2` so they rest on the ground rather than sinking. New
  enemies must follow this.
- **Damage takers must register.** Every damageable mesh has to register
  with [`DamageSystem`](../../client/src/game/DamageSystem.ts) so the
  player's hits route correctly. The factories do this for you; if you
  build a mesh manually, call `damageSystem.register(...)`.
- **EnemyHealthBarSystem.** HUD bars are HTML overlays positioned in
  screen space from world-space targets. Newly registered enemies
  inherit a bar automatically; you don't need to do anything.

## Verification

```bash
npm run check
npm run dev
```

Spawn the enemy via the dev console
(`window.__GAME__.enemySystem?.spawnEnemyAt(...)` if you exposed it)
or by triggering a wave. Confirm:

- Mesh sits on the ground.
- HP bar appears on hover/aim.
- Death emits `ENEMY_KILLED` (visible in any listener you add temporarily).
- Drops match expectations.
