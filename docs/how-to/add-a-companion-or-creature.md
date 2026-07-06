# How to add a companion or bio-creature

Two related but distinct systems:

| System | File | Purpose |
|---|---|---|
| **Companions** (allies + pets) | [`CompanionSystem.ts`](../../client/src/game/CompanionSystem.ts) | Persistent allies that fight beside the player |
| **Bio-Creatures** | [`BioCreatureSystem.ts`](../../client/src/game/BioCreatureSystem.ts) + [`BioSpecies.ts`](../../client/src/game/BioSpecies.ts) | 125+ collectible robotic creatures (the "Dex") |

## A. Add a companion (ally or pet)

Companions are spawned from named **presets** in the `ALLY_PRESETS`
table inside `CompanionSystem.ts`. The legendary
`MiniGeneralVoidcrown` companion granted at the end of L7 is a worked
example.

### 1. Add the preset

File: [`client/src/game/CompanionSystem.ts`](../../client/src/game/CompanionSystem.ts)

```ts
ALLY_PRESETS.MiniGeneralVoidcrown = {
  type: "ally",
  body: "humanoid",
  height: 4.0,
  bodyTint:  { r: 0.10, g: 0.05, b: 0.20 },
  armorTint: { r: 0.45, g: 0.05, b: 0.10 },
  weapon:    "beamSabre",
  baseDamage: 60,
  baseHp:    400,
  // …
};
```

### 2. Grant it

```ts
companionSystem.addCompanion("MiniGeneralVoidcrown", { allowDuplicate: false });
```

If you grant unconditionally, gate the call so it can't double-grant.
The legendary grant in `Game.tsx` shows the canonical idempotency
pattern: a `legendaryCompanionGrantedRef` boolean latch + a
`ProgressSnapshot.legendaryCompanionGranted` field.

### 3. Persist

Companions persist automatically — `ProgressSync` snapshots the active
roster and `CompanionSystem` rehydrates from it on load.

### 4. (Optional) Auto-bump roster cap

If the grant should always succeed even when the roster is full, bump
`stats.maxCompanions` first. Example:

```ts
if (stats.companions.length >= stats.maxCompanions) {
  stats.maxCompanions += 1;
}
```

## B. Add a bio-creature to the Dex

Bio-creatures are pure data + a shared rendering pipeline. You almost
never touch the rendering code: adding a species is a data-only change.

### 1. Add a species

File: [`client/src/game/BioSpecies.ts`](../../client/src/game/BioSpecies.ts)

Add an entry with:

- `id` (unique string).
- `archetype` (e.g. `"crawler"`, `"floater"`, `"swarmer"`, `"brute"`).
- `elementalType` (flame / ice / water / electric / psychic / grass /
  dragon / steel / evil / crystal / normal).
- `rarity` tier (`"common" | "uncommon" | "rare" | "legendary"`).
- `primary` / `secondary` / `emissive` colours + `scale`.
- Combat stats + `baseCaptureChance`.

### 2. It renders automatically

You do **not** write any mesh code. Both the wild spawn and the captured
follower call `buildCreatureDescriptor` in
[`CreatureMechaDesigner.ts`](../../client/src/game/CreatureMechaDesigner.ts),
which derives the full look from the species data: chibi chassis →
archetype silhouette → elemental accents → rarity flair → face →
evolution stage. New `archetype`/`elementalType` values only need a case
added in that one file — every consumer (wild, follower, Dex) picks it up.

`BioCreatureSystem.spawnSpecies(id, position)` instantiates a wild one and
registers it for capture and loot.

### 3. Capture flow

Throwing a capture orb triggers `CAPTURE_ORB_THROWN` → the orb arcs to
the target with a sparkle trail while it shudders → on impact
`BioCreatureSystem` rolls `captureChance()` (species base + garden
bonus). Success fires a celebratory burst + `CREATURE_CAPTURED`; failure
shows a red flash + smoke puff and the creature resumes wandering. The
HUD and Bio Garden pick up the event.

Captured creatures evolve over time: `deriveEvolutionStage(level, bond)`
(gated on both level AND bond) upgrades their look through Prototype →
Enhanced → Advanced → Prime, and the top-3 by level auto-become animated
robot followers via `ActivePetSystem` — no separate assignment UI.

### 4. Garden integration

If the creature can be reared in the player's garden, add it to the
species accepted by [`GardenSystem.ts`](../../client/src/game/GardenSystem.ts).

## Tips

- Keep companion HP/damage **balanced against the player**, not against
  enemies. A companion that out-damages the player breaks core combat.
- For bio-creatures, the rarity tier drives drop chance from defeated
  enemies. Add the new id to the per-enemy rarity table inside
  `EnemySystem.ts` if you want it findable in the wild.
- `BIO_DEX_COUNT` in `BioSpecies.ts` is auto-derived; you don't need
  to update a counter manually.

## Verification

- Spawn the companion via dev call; confirm it follows + fights.
- Reload — confirm it's still there.
- For a bio-creature, defeat an enemy that should drop it; confirm the
  capture orb appears and the Dex updates.
