# Friendly NPCs & rescue

Three systems put non-hostile humanoids in the world: `FriendlyNPCSystem`
(scattered story NPCs), `RescueSystem` (caged synthetics across combat
levels), and the cage logic inside `PontiacLabSystem` (the lab animals).
All three share a "walk close, press **E**" interaction pattern and all
three persist their state through `ProgressSync`.

## Components

| File | Role |
|---|---|
| [`FriendlyNPCSystem.ts`](../../client/src/game/FriendlyNPCSystem.ts) | Drops a small cast of brightly-coloured friendly humanoids around the world. Each carries multi-line dialogue. |
| [`RescueSystem.ts`](../../client/src/game/RescueSystem.ts) | Scatters captured humanoid synthetics in glowing red containment cages on combat levels. Press **E** to break a cage and free the rescuee. |
| [`PontiacLabSystem.ts`](../../client/src/game/PontiacLabSystem.ts) | Hosts 4 caged lab animals (KIT, GLIM, MOSSBACK, RIVET) and the cave hatch that warps the player into the Swarms Lair. |
| [`HumanoidCharacter.ts`](../../client/src/game/HumanoidCharacter.ts) | Underlying body builder — see [`character-and-armor.md`](character-and-armor.md). |

## Interaction pattern

```
Player walks within 4.5 m of NPC / cage / hatch (5 m for friendly NPCs)
        │
        ▼
HTML "Press E" prompt floats above the target
        │
        ▼ (player presses E)
        │
        ▼
NPC dialogue → speech bubble cycles through lines
RescueSystem  → cage breaks, story bubble plays, rescuee waves and fades,
                fires SYNTHETIC_RESCUED { id, name }
PontiacLab cage → fires ANIMAL_FREED { id }
PontiacLab hatch → fires LAB_CAVE_ENTERED → handleFastTravel(7)
```

The "Press E" prompts are HTML overlays positioned each frame from the
3D point's screen projection (same pattern as `EnemyHealthBarSystem` —
see [`ui-and-input.md`](ui-and-input.md)).

## Friendly NPCs

`FriendlyNPCSystem` exposes a small named cast with deliberately
cheerful palettes (sunshine yellow, pink, cyan, lime, magenta, orange)
so they read instantly as non-hostile against the gritty Detroit
backdrop. Each NPC has:

```ts
interface NPCDialogue {
  name: string;
  lines: string[];   // cycles from the start once exhausted
}
```

**Conflict avoidance:**
- NPCs are placed >12 m from any shop building.
- The `E` keydown handler skips when a shop dialog is open
  (`shopOpenProvider`).

NPCs are presence-only — they don't move, fight, or react beyond
dialogue. They're flavor and signposting.

## Rescue (caged synthetics)

`RescueSystem` places 3 cages per combat level on L1, L2, L3, and L5
(skipped on peaceful zones — those are the destinations the rescued are
headed to). Each cage holds a humanoid synthetic with:

- A unique id (`level + index` form, stable across runs).
- A `name` and 3-4 backstory lines.
- A glowing red containment mesh.

Pressing **E** inside the cage:

1. Removes the cage mesh and plays a break SFX.
2. Pops a centered story bubble with the name and backstory.
3. Plays a wave animation, then fades the rescuee out.
4. Fires `SYNTHETIC_RESCUED { id, name }`.
5. Adds the id to `ProgressSnapshot.rescuedSyntheticIds`.

On level (re)entry, `RescueSystem` reads `rescuedSyntheticIds` and
**skips** any cage whose id is already in the set, so freed rescuees
never respawn.

## Lab animals (Pontiac Lab)

`PontiacLabSystem` adds 4 mini red cages along the south wall of the
lab interior. Each holds a named lab animal (KIT, GLIM, MOSSBACK,
RIVET). Pressing **E** inside a cage:

1. Removes the cage.
2. Fires `ANIMAL_FREED { id }`.
3. Adds the id to `ProgressSnapshot.freedLabAnimalIds`.

The lab also has a glowing hexagonal cave hatch in the floor. Pressing
**E** on the hatch fires `LAB_CAVE_ENTERED`, and `Game.tsx` routes that
through `handleFastTravel(7)` to warp the player into the Swarms Lair.

## Legendary companion grant

When **all** of the following are true:

- General Voidcrown is defeated (`swarmsGeneralDefeated`)
- All 12 caged synthetics across L1/L2/L3/L5 are freed
- All 4 lab animals are freed

…`Game.tsx` grants the legendary `MiniGeneralVoidcrown` ally companion.
The grant is **idempotent** (`legendaryCompanionGranted` flag), routes
through the standard `companionSystem.addCompanion` path, auto-bumps
`maxCompanions` if the roster is full, and fires
`LEGENDARY_COMPANION_GRANTED`.

The grant logic re-evaluates on every `SYNTHETIC_RESCUED`,
`ANIMAL_FREED`, and `SWARMS_GENERAL_DEFEATED` event so whichever
condition closes last triggers the unlock.

## Adding a new rescue-style interactable

1. Add a system file or extend an existing one (`RescueSystem` for
   combat-level cages, `PontiacLabSystem` for lab interior).
2. Define the per-instance shape (id, name, dialogue/backstory).
3. Allocate a `ProgressSnapshot` field for the persisted ids — see
   [`how-to/modify-the-database.md`](../how-to/modify-the-database.md)
   (no schema migration needed; `saveData` is JSONB).
4. On `LEVEL_STARTED`, skip any instance whose id is already persisted.
5. On interaction, fire a new event in `EventBus.GameEvents` and persist
   the id. Add the event to [`reference/game-events.md`](../reference/game-events.md).
6. If it should count toward an unlock condition, wire it into the
   `tryGrantLegendaryCompanion()` helper in `Game.tsx`.
