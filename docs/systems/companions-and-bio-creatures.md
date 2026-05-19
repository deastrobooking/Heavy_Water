# Companions & Bio-Creatures

Two related systems often confused with each other.

## Companions (allies + pets)

File: [`CompanionSystem.ts`](../../client/src/game/CompanionSystem.ts)

Persistent allies that fight beside the player. Each companion is one
of two types:

- **Ally** — humanoid follower, deals damage, takes hits.
- **Pet** — small creature, support / scout / utility.

### Presets

`ALLY_PRESETS` (in `CompanionSystem.ts`) maps preset names to body /
weapon / stat configurations. Spawning by preset name is the canonical
path:

```ts
companionSystem.addCompanion("MiniGeneralVoidcrown", { allowDuplicate: false });
```

Preset names are also referenced from `Game.tsx`'s legendary-grant
flow.

### Persistence

- Active roster is snapshotted by `ProgressSync` and rehydrated on
  load.
- `stats.maxCompanions` caps the roster; the legendary-grant flow
  auto-bumps it if needed.
- Per-companion levels are tracked in the snapshot too.

### Upgrades

The Upgrade Menu's **COMPANIONS** tab lets the player upgrade per-
companion damage/HP, swap weapons, and recolor armor.

## Bio-Creatures (the Dex)

Files: [`BioCreatureSystem.ts`](../../client/src/game/BioCreatureSystem.ts)
+ [`BioSpecies.ts`](../../client/src/game/BioSpecies.ts)

A 125+ entry collectible roster — robotic creatures with archetypes,
elemental types, and rarity tiers.

### Capture loop

```
Player throws capture orb (CombatSystem) → CAPTURE_ORB_THROWN
    → BioCreatureSystem rolls capture chance by rarity
    → on success: CREATURE_CAPTURED { speciesId }
    → ProgressSync persists captured ids
    → HUD updates Dex
```

### Garden integration

[`GardenSystem.ts`](../../client/src/game/GardenSystem.ts) lets players
plant and rear captured species. Garden output ties into
`CraftingSystem`.

Captured bio-creatures now also carry `bondLevel` and `care`. The Bio
Garden roster can feed a captured pet with `animaton_feed` or `bio_crop`;
every three care points raises its bond, level, HP, attack, and speed.
`BioCreatureSystem.getPetBondBonuses()` converts the captured roster into
passive player bonuses: offensive pets boost damage, electric/psychic/
crystal pets boost fire rate, and water/grass/ice/steel pets reduce
incoming damage. `Game.tsx` pushes those bonuses into
`PlayerController` and `WeaponsSystem`.

Ashur Sanctuary is the primary care loop: its farm yields Bio Crop and
sometimes Animaton Feed, and the visible pet clinic marks the in-world
hospital for rescued Animatons. Michigan Wilds is the rare-pet hunting
loop, seeding rare/legendary species plus power blooms.

### Adding a species or companion

See [`how-to/add-a-companion-or-creature.md`](../how-to/add-a-companion-or-creature.md).
