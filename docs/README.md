# Heavy Water — Developer Documentation

This folder is the canonical developer hub for the Heavy Water codebase.
It is written for engineers and designers who want to **read**, **extend**,
or **debug** the game.

> Player-facing documentation lives elsewhere:
> - [`README.md`](../README.md) — project overview, tech stack, quickstart.
> - [`GAMEPLAY_GUIDE.md`](../GAMEPLAY_GUIDE.md) — controls, mechanics, tips.
> - [`Docs/DEVELOPERS_GUIDE.md`](../Docs/DEVELOPERS_GUIDE.md) — older long-form
>   system walkthrough, kept around for deep history.
> - [`replit.md`](../replit.md) — living architectural changelog used by the
>   AI agent. Keep this in sync when you change architecture.

## Start here

| If you want to… | Read |
|---|---|
| Get the project running on your machine | [`getting-started.md`](getting-started.md) |
| Understand the high-level architecture | [`architecture.md`](architecture.md) |
| Find the file for a specific feature | [`repository-structure.md`](repository-structure.md) |
| Add a new feature | the matching how-to in [`how-to/`](how-to/) |
| Look up an event, route, or schema | the matching ref in [`reference/`](reference/) |
| Ship to production | [`deployment.md`](deployment.md) |
| Diagnose a bug | [`troubleshooting.md`](troubleshooting.md) |
| Submit a contribution | [`contributing.md`](contributing.md) |

## How-to guides

Step-by-step recipes. Each one is grounded in real code and ends with the
exact files you need to touch.

- [Add a new world level](how-to/add-a-level.md)
- [Add a peaceful or combat side-zone](how-to/add-a-side-zone.md)
- [Add a new enemy (robot, humanoid, aerial)](how-to/add-an-enemy.md)
- [Add a new weapon (ranged or melee)](how-to/add-a-weapon.md)
- [Add a new companion or bio-creature](how-to/add-a-companion-or-creature.md)
- [Add a new game event](how-to/add-a-game-event.md)
- [Add a new HTTP API route](how-to/add-an-api-route.md)
- [Modify the database schema](how-to/modify-the-database.md)
- [Debug HMR and WebSocket issues](how-to/debug-hmr-and-websockets.md)

## System references

One file per major in-game system. Each explains the responsibilities,
public surface, key collaborators, and where to look for "what runs when".

- [Rendering & cell-shading](systems/rendering-and-cell-shading.md)
- [Characters, robots, and armor](systems/character-and-armor.md)
- [Vehicles](systems/vehicles.md)
- [EventBus & StateMachine](systems/event-bus-and-state-machine.md)
- [Levels & zones](systems/levels-and-zones.md)
- [Combat & damage](systems/combat-and-damage.md)
- [Enemies & bosses](systems/enemies-and-bosses.md)
- [Weapons arsenal](systems/weapons-arsenal.md)
- [Companions & bio-creatures](systems/companions-and-bio-creatures.md)
- [Inventory, crafting, loot](systems/inventory-crafting-loot.md)
- [Friendly NPCs & rescue](systems/npcs-and-rescue.md)
- [Audio & music](systems/audio-and-music.md)
- [Base building & prefabs](systems/base-building-and-prefabs.md)
- [Progression & saves](systems/progression-and-saves.md)
- [Multiplayer](systems/multiplayer.md)
- [World generation](systems/world-generation.md)
- [UI & input](systems/ui-and-input.md)

## Quick references

Lookup tables for things you'll search for often.

- [Game events](reference/game-events.md) — every `GameEvents.*` constant
- [World levels](reference/world-levels.md) — every `WorldLevel`
- [HTTP API](reference/http-api.md) — every Express route
- [WebSocket protocol](reference/websocket-protocol.md) — multiplayer messages
- [Database schema](reference/database-schema.md) — every Drizzle table
- [Controls](reference/controls.md) — keyboard / mouse / gamepad map

## A note on conventions

- All new game systems live under `client/src/game/` as a single
  `XxxSystem.ts` file. Most are class-based, instantiated once from
  `Game.tsx`, and communicate via the `EventBus` rather than direct refs.
- Server-side code lives under `server/`. Shared types live in `shared/`.
- Comments in the codebase err on the side of explaining **why**, not
  **what**. Match that style when you contribute.
- The agent-maintained file [`replit.md`](../replit.md) is the source of
  truth for "what major systems exist". If you add or remove a major
  system, update it in the same PR.
