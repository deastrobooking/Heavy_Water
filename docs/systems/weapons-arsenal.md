# Weapons arsenal

Heavy Water has seven ranged weapons, the Beam Sabre, four optional
alternate melees, the Mega Beam Cannon, elemental specials, and the
Smash Attack.

## Ranged

| Weapon | File |
|---|---|
| Pistol, Rifle, Shotgun | [`CombatSystem.ts`](../../client/src/game/CombatSystem.ts) |
| Rocket, Tracking Missile | [`SpecialWeaponsSystem.ts`](../../client/src/game/SpecialWeaponsSystem.ts) |
| Laser, Grenade | both |

All ranged weapons have **unlimited ammo**. Reload is a visual reset.
Switching is mouse-wheel or `1`–`8` (slot index). Weapon levels are
tracked per-weapon in `ProgressSnapshot.weaponLevels`.

### Aim providers

`CombatSystem.aimProvider` is a strategy:

- **Crosshair** — screen-center raycast (default).
- **Auto-target** — nearest enemy in cone (toggleable upgrade).
- **Vehicle gunner** — when in an ATV / fighter, the vehicle drives
  the aim.

## Melee

### Beam Sabre

[`BeamSabreSystem.ts`](../../client/src/game/BeamSabreSystem.ts) —
default melee. Combo chain on left-click. Three sub-upgrades:

- **Spin** (`sabreSpin`) — area swing
- **Twin** (`sabreTwin`) — second sabre in off-hand
- **Giant** (`sabreGiant`) — oversized blade
- **Gold tier** — visual upgrade with extra damage and bloom

### Alternate melees

Four optional weapons in [`MeleeArsenalSystem.ts`](../../client/src/game/MeleeArsenalSystem.ts):

- Beam Glaive — long reach, sweeping arcs
- Twin Beam Daggers — fast, low per-hit
- Plasma War Axe — slow, high per-hit
- Spiked Chain Whip — extra-long reach, knockback

Each has three ability tiers and scaled damage / reach. Selection
persists in `ProgressSnapshot`.

## Specials & supers

| System | Trigger |
|---|---|
| `ElementalSpecialsSystem` | Element-key + click; consumes a charge |
| `MegaBeamCannonSystem` | Hold to charge, release to fire |
| `SmashAttackSystem` | Mid-flight downward smash |

## Power Jewels

[`JewelSystem.ts`](../../client/src/game/JewelSystem.ts) — see
[`systems/combat-and-damage.md`](combat-and-damage.md#power-jewels).
Each ranged weapon (pistol, rifle, shotgun, rocket, laser, grenade,
tracking missile) has its own jewel slot. Mounted jewels persist via
`ProgressSync.jewelMounts`.

## Adding a weapon

See [`how-to/add-a-weapon.md`](../how-to/add-a-weapon.md).
