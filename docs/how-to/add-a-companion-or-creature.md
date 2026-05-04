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

Bio-creatures are pure data + a shared rendering pipeline.

### 1. Add a species

File: [`client/src/game/BioSpecies.ts`](../../client/src/game/BioSpecies.ts)

Add an entry with:

- `id` (unique string).
- `archetype` (e.g. `"crawler"`, `"floater"`, `"swarmer"`).
- `element` (fire / water / void / nature / …).
- `rarity` tier (`"common" | "rare" | "legendary" | …`).
- Visual params (colours, body parts, scale).
- Combat stats.

### 2. Spawn it

`BioCreatureSystem.spawnSpecies(id, position)` will instantiate it and
register it for capture and loot.

### 3. Capture flow

Capture orbs throw triggers `CAPTURE_ORB_THROWN` →
`BioCreatureSystem` rolls capture chance based on rarity → emits
`CREATURE_CAPTURED` on success. The HUD picks up the event.

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
