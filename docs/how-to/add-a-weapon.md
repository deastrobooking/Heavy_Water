# How to add a new weapon

Weapons split into two families:

| Family | Owned by |
|---|---|
| **Ranged** (pistol, rifle, shotgun, rocket, laser, grenade, tracking missile) | [`CombatSystem.ts`](../../client/src/game/CombatSystem.ts) + [`SpecialWeaponsSystem.ts`](../../client/src/game/SpecialWeaponsSystem.ts) |
| **Melee** (Beam Sabre + four alternates) | [`BeamSabreSystem.ts`](../../client/src/game/BeamSabreSystem.ts) + [`MeleeArsenalSystem.ts`](../../client/src/game/MeleeArsenalSystem.ts) |

## A. Ranged weapon

### 1. Define the weapon

The seven default ranged weapons are declared inline in
[`CombatSystem.ts`](../../client/src/game/CombatSystem.ts) as a typed
table. Add a new entry with:

- Display name + slot index (1–8).
- Damage, fire rate, range, projectile speed.
- Mag size + reload duration (visual only — ammo is unlimited).
- VFX hooks (muzzle flash colour, projectile mesh / colour).

If your weapon has unusual behaviour (homing, area-of-effect, beam),
implement it in `SpecialWeaponsSystem.ts` and have `CombatSystem`
delegate to it on `WEAPON_FIRED`.

### 2. Wire the input

`CombatSystem` listens for `1`–`8` to switch weapons and emits
`WEAPON_SWITCHED`. Bump any slot upper bound if you cross 8.

### 3. Hook the Power Jewel system

If the weapon should accept a Power Jewel mount (almost certainly yes —
parity with other weapons), add it to the per-weapon jewel slot map in
[`JewelSystem.ts`](../../client/src/game/JewelSystem.ts). The
`UpgradeMenu`'s WEAPONS tab automatically picks it up.

### 4. Persist its level

`ProgressSnapshot.weaponLevels` is a `Record<string, number>`. Add your
new weapon key to the per-weapon leveling logic in
`ProgressSync.ts` so the upgrade menu can level it independently.

## B. Melee weapon

The four alternate melees (Beam Glaive, Twin Beam Daggers, Plasma War
Axe, Spiked Chain Whip) live in
[`MeleeArsenalSystem.ts`](../../client/src/game/MeleeArsenalSystem.ts).
Each one exposes three tiers and scaled damage / reach.

### 1. Add the weapon definition

In `MeleeArsenalSystem.ts`, add a new entry to the arsenal table:

- Display name, key, mesh builder.
- Three-tier ability list with cooldowns and effects.
- Damage / reach / swing arc per tier.

### 2. Add a swing animation

If the weapon needs a unique swing animation, add it to
[`AnimationSystem.ts`](../../client/src/game/AnimationSystem.ts). The
existing system supports keyframed transforms on the player's right hand
node.

### 3. UI surface

Melee weapon selection lives in
[`UpgradeMenu.tsx`](../../client/src/game/UpgradeMenu.tsx) under the
MELEE tab. Add an entry to the rendered list — it reads the arsenal
table directly so most of the work is in step 1.

### 4. Persist + restore

Selected melee weapon and its tier are stored in `ProgressSnapshot`
under `meleeArsenal` (see existing fields). Add your key as a valid
value.

## Cell-shading and VFX

- Projectile materials should use the cell-shaded shader pipeline in
  [`BabylonEngine.ts`](../../client/src/game/BabylonEngine.ts). Reuse an
  existing material from `CombatSystem` — don't roll a new shader.
- Hit FX go through [`EffectsSystem.ts`](../../client/src/game/EffectsSystem.ts).
  Fire `EFFECT_*` events rather than calling Babylon directly so
  multiplayer can mirror them later.

## Verification

- New weapon appears in the HUD weapon strip.
- Slot key (`1`–`N`) selects it.
- Damage numbers + hit FX render.
- Level up via XP — verify the weapon level persists across reloads.
- Mount a jewel — verify the multiplier applies.
