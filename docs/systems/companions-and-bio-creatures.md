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
elemental types, and rarity tiers, styled as Pokémon/Digimon-flavored
mecha-monsters (cute chibi battle-bots with expressive faces).

### Visual pipeline — the mecha designer

File: [`CreatureMechaDesigner.ts`](../../client/src/game/CreatureMechaDesigner.ts)

`buildCreatureDescriptor(species, { level, bond, follower })` is the
**single source of truth** for how every creature looks. It layers, in
order:

1. `baseChibiStyle` — the shared chibi chassis (stout torso, oversized
   head, big face).
2. `applyArchetype` — per-archetype silhouette (crawler / floater /
   swarmer / brute / …).
3. `applyTypeAccents` — elemental theming (horns, wings, glow colour).
4. `applyRarityFlair` — rarer species get extra plating / flair.
5. `applyFace` — eyes, brow, mouth, cheek-lights (drives `RobotStyle`'s
   optional face fields, rendered by `RobotFactory.buildFace`).
6. `applyEvolutionStage` — visible growth by stage (see below).

Because **wild creatures and captured followers both call this exact
function**, a follower looks identical to its wild form — just
`follower: true` shrinks it ×0.85 and sets `articulate: true` so
`RobotFactory` parents named limb/glow parts to the root (instead of
merging) for per-frame animation in `ActivePetSystem`.

### Evolution stages

`deriveEvolutionStage(level, bond)` returns 0–3, gated on BOTH level and
bond (`EVOLUTION_THRESHOLDS`): Prototype → Enhanced (lv≥4) → Advanced
(lv≥10 & bond≥6) → Prime (lv≥18 & bond≥12). `EVOLUTION_STAGE_NAMES` holds
the display labels. Higher stages scale the rig up and add plating/flair,
so a well-bonded, high-level creature visibly outgrows a fresh capture.
The Bio Garden roster shows each creature's current stage badge and the
level/bond needed for the next one.

### Capture loop

```
Player throws capture orb (CombatSystem) → CAPTURE_ORB_THROWN
    → orb flies in an arc with a sparkle trail; target shudders
    → on land: hitImpact flash + camera shake
    → BioCreatureSystem rolls capture chance (captureChance())
    → success: capture burst + levelUp burst + "Captured X!" message
    → fail:    red flash + smoke puff + "X broke free!"; creature resumes
    → on success: CREATURE_CAPTURED { speciesId }
    → ProgressSync persists captured ids
    → HUD updates Dex
```

The rolled capture chance (`captureChance()` = species base + garden
bonus) is surfaced to the player as a percentage when the orb is thrown.

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

### Active pet followers

The top-3 captured creatures by level automatically become animated robot
followers via
[`ActivePetSystem.ts`](../../client/src/game/ActivePetSystem.ts)
(`syncFromCaptured`) — there is no separate assignment UI. Followers reuse
`CreatureMechaDesigner` with `follower: true`, so each looks identical to
its wild form (just shrunk and articulated for per-frame animation).

Beyond the passive `getPetBondBonuses()` that *every* captured creature
contributes, the active trio drives three player-facing effects — stat
augments (incl. defense), an imbued weapon element, and a robot armor-set
combo. That augment/element/combo pipeline (and its single
`refreshActivePets` refresh path) is documented in the **Active Pets &
Robot Powers** section of [`replit.md`](../../replit.md); treat that as the
source of truth so it isn't duplicated here.

### Adding a species or companion

See [`how-to/add-a-companion-or-creature.md`](../how-to/add-a-companion-or-creature.md).
