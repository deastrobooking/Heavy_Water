# Controls reference

Player-facing version: [`GAMEPLAY_GUIDE.md`](../../GAMEPLAY_GUIDE.md).
This page is the **developer** reference — which file owns each input.

| Action | Keys | Owned by |
|---|---|---|
| Move | `W A S D` | [`PlayerController.ts`](../../client/src/game/PlayerController.ts) |
| Sprint | `SHIFT` | `PlayerController` |
| Jump / Triple-Jump → flight | `SPACE` | `PlayerController` |
| Boost Dash (mid-air) | `SHIFT + SPACE` | `PlayerController` |
| Look | Mouse | `PlayerController` |
| Climb (in flight) | `SPACE` | `PlayerController` |
| Dive (in flight) | `CTRL` | `PlayerController` |
| Smash (in flight) | mouse + downward | [`SmashAttackSystem.ts`](../../client/src/game/SmashAttackSystem.ts) |
| Fire ranged | Left mouse | [`CombatSystem.ts`](../../client/src/game/CombatSystem.ts) |
| Reload | `R` | `CombatSystem` |
| Cycle weapon | Mouse wheel | `CombatSystem` |
| Switch weapon directly | `1`–`8` | `CombatSystem` |
| Beam Sabre swing | Right mouse | [`BeamSabreSystem.ts`](../../client/src/game/BeamSabreSystem.ts) |
| Alternate melee | (configurable) | [`MeleeArsenalSystem.ts`](../../client/src/game/MeleeArsenalSystem.ts) |
| Elemental special | (configurable) | [`ElementalSpecialsSystem.ts`](../../client/src/game/ElementalSpecialsSystem.ts) |
| Mega Beam Cannon (charge) | hold + release | [`MegaBeamCannonSystem.ts`](../../client/src/game/MegaBeamCannonSystem.ts) |
| Interact (talk / cage / hatch) | `E` | various — see `Game.tsx` `useEffect` keylisteners |
| Open inventory | `I` | [`GameUI.tsx`](../../client/src/game/GameUI.tsx) |
| Open upgrade menu | `U` | [`UpgradeMenu.tsx`](../../client/src/game/UpgradeMenu.tsx) |
| Open map | `M` | [`MapSystem.ts`](../../client/src/game/MapSystem.ts) |
| Toggle build mode | `B` | [`BuildingSystem.ts`](../../client/src/game/BuildingSystem.ts) |
| Pause | `ESC` | `GameUI` |

## Mouse

- Pointer lock is requested on click into the canvas (standard FPS
  pattern).
- Sensitivity is currently fixed; expose it in `useGame` if needed.

## Gamepad

[`GamepadInput.ts`](../../client/src/game/GamepadInput.ts) maps the
standard Gamepad API to the same intents:

| Stick / button | Intent |
|---|---|
| Left stick | Move |
| Right stick | Look |
| A / South | Jump |
| B / East | Reload |
| X / West | Beam Sabre |
| Y / North | Interact |
| RT / R2 | Fire |
| LT / L2 | Special |
| LB/RB | Cycle weapon |
| Start | Pause |

## Adding a new keybind

1. Add the binding in the owning system's `useEffect` / window listener
   (the systems own their own input — there's no central key table).
2. Update [`GAMEPLAY_GUIDE.md`](../../GAMEPLAY_GUIDE.md) and this file.
3. If it's a global UI key (menu open / pause), wire it through
   `GameUI.tsx` instead.
