# Combat & damage

Combat in Heavy Water spans ranged weapons, melee combos, the Beam
Sabre and four alternate melees, elemental specials, the Mega Beam
Cannon, and the Smash Attack. Every hit ultimately routes through one
unified `DamageSystem`.

## Components

| File | Role |
|---|---|
| [`DamageSystem.ts`](../../client/src/game/DamageSystem.ts) | Single entry point for **every** damage event. Computes resistances, applies VFX, fires `PLAYER_DAMAGED` / `ENEMY_DAMAGED` / `ENEMY_KILLED`. |
| [`CombatSystem.ts`](../../client/src/game/CombatSystem.ts) | Ranged weapon firing, projectile lifetime, mag/reload state, weapon switching. |
| [`SpecialWeaponsSystem.ts`](../../client/src/game/SpecialWeaponsSystem.ts) | Homing missiles, AOE rockets, beam weapons. |
| [`BeamSabreSystem.ts`](../../client/src/game/BeamSabreSystem.ts) | Beam Sabre swings, combo chains, Gold-tier upgrade visuals. |
| [`MeleeArsenalSystem.ts`](../../client/src/game/MeleeArsenalSystem.ts) | Four optional alternate melees, each with three ability tiers. |
| [`ElementalSpecialsSystem.ts`](../../client/src/game/ElementalSpecialsSystem.ts) | Fire/water/void/nature elemental casts. |
| [`MegaBeamCannonSystem.ts`](../../client/src/game/MegaBeamCannonSystem.ts) | Charge-up super weapon. |
| [`SmashAttackSystem.ts`](../../client/src/game/SmashAttackSystem.ts) | Spinning downward smash from flight. |
| [`ExplosionSystem.ts`](../../client/src/game/ExplosionSystem.ts) | Spawns + ticks all explosion FX + AOE damage. |
| [`JewelSystem.ts`](../../client/src/game/JewelSystem.ts) | Power Jewels: per-weapon damage multipliers (rough/cut/flawless). |

## Damage flow

```
Source (CombatSystem / MeleeArsenalSystem / ExplosionSystem / …)
    │
    ▼
DamageSystem.applyDamage(targetId, amount, { source, element, … })
    │
    ├── resistances + jewel multipliers
    ├── HP -= damage
    ├── EnemyHealthBarSystem updates the HUD bar
    └── if HP <= 0 → emit ENEMY_KILLED { enemyId, position, isBossCaptain, … }
```

Every damageable mesh — player, enemy, prop, vehicle — registers with
`DamageSystem` on creation so hits resolve through one place.

## Adding a new damage source

1. Compute the base damage in your system (factor in player level,
   weapon level, jewel multiplier from `JewelSystem`).
2. Call `damageSystem.applyDamage(targetId, amount, { source: "myWeapon" })`.
3. Don't emit `ENEMY_DAMAGED` / `ENEMY_KILLED` yourself — `DamageSystem`
   owns those.

## Power Jewels

Jewels are weapon-mount drops with three tiers:

- Rough  → +15% weapon damage
- Cut    → +30% weapon damage
- Flawless → +50% weapon damage

Mounted via the **WEAPONS** tab of the Upgrade Menu. `JewelSystem`
exposes `getMultiplierFor(weaponKey)` which `CombatSystem` and
`SpecialWeaponsSystem` query before they call `damageSystem.applyDamage`.

Mounted jewels persist via `ProgressSync.jewelMounts`.

## Combos

Melee combo chains are owned by `CombatSystem` (for unarmed/punch combos)
and `MeleeArsenalSystem` (for the alternate melee weapons). Each fires
`COMBO_HIT` per hit and `COMBO_FINISHED` at the end of a chain. The HUD
listens for both.

## Auto-Target Module

A toggleable upgrade. When active, `CombatSystem`'s `aimProvider`
switches from "screen-center raycast" to "nearest enemy in cone". Lives
inline in `CombatSystem.ts` — search for `autoTargetEnabled`.

## Gotchas

- **Don't bypass `DamageSystem`.** Direct HP mutation will skip
  resistances and jewel multipliers and miss the HUD update.
- **Boss captains.** `spawnCaptain({ isBossCaptain: true, … })` flags
  the captain so the death payload carries `isBossCaptain: true`. Side-
  zone systems use this to detect campaign-ending kills (see
  `SwarmsLairSystem.handleEnemyKilled`).
- **Cell-shading materials.** Reuse the materials in `CombatSystem` /
  `SpecialWeaponsSystem` rather than rolling your own — outline + tint
  consistency across weapons matters for the art direction.
