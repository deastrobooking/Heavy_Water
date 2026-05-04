# Architecture

A 30,000-foot view of how Heavy Water is wired together.

## Process model

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Browser (single page)                          │
│                                                                      │
│  React shell (client/src/App.tsx)                                    │
│   └── <Game/> (client/src/game/Game.tsx)                             │
│         ├── BabylonEngine — 3D scene + render loop                   │
│         ├── ~80 *System.ts modules — gameplay logic                  │
│         ├── EventBus singleton — decoupled comms                     │
│         ├── React HUD components (GameUI, MainMenu, UpgradeMenu, …)  │
│         └── MultiplayerSystem — WebSocket client                     │
└──────────────────▲──────────────────────────────────▲────────────────┘
                   │ HTTPS / fetch (auth, save)       │ wss:// /ws
                   ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Express server (server/index.ts)                    │
│                                                                      │
│  Auth + REST  (server/auth.ts, server/routes.ts)                     │
│   └── Passport Local + express-session + connect-pg-simple           │
│                                                                      │
│  Persistence  (server/storage.ts → server/db.ts)                     │
│   └── Drizzle ORM (shared/schema.ts) → PostgreSQL                    │
│                                                                      │
│  Multiplayer  (server/multiplayer.ts)                                │
│   └── ws WebSocketServer in noServer mode, routed at /ws             │
│                                                                      │
│  Dev only:    Vite middleware (server/vite.ts) + HMR at /vite-hmr    │
└─────────────────────────────────────────────────────────────────────┘
```

## Client architecture

The client is a single React app whose only meaningful component is
[`<Game/>`](../client/src/game/Game.tsx). Everything else is a Babylon.js
scene driven by ~80 system classes.

### Render & engine layer

- [`BabylonEngine.ts`](../client/src/game/BabylonEngine.ts) — wraps the
  Babylon engine, attempts WebGPU, falls back to WebGL2, and configures
  cell-shading, bloom, FXAA, chromatic aberration, ink outlines.
- Custom GLSL shaders live alongside the systems that use them
  (compiled with `vite-plugin-glsl`).

### Game systems

Each `XxxSystem.ts` under `client/src/game/` owns a single concern and
exposes a small public API. Systems are instantiated once from
`Game.tsx`'s `initializeGame` function and stored in `useRef` slots so
they survive re-renders. Most communicate via the EventBus (see below)
rather than holding direct refs to each other.

Major system families:

| Family | Examples |
|---|---|
| **Player** | `PlayerController`, `CombatSystem`, `BeamSabreSystem`, `MeleeArsenalSystem`, `SmashAttackSystem` |
| **Enemies** | `EnemySystem`, `AerialEnemySystem`, `EnemyBaseSystem`, `BioCreatureSystem` |
| **World** | `CityGenerator`, `MountainRingSystem`, `AlienFoliageSystem`, `EarthFoliageSystem`, `EnvironmentPropSystem`, `LODCullSystem`, `SkySystem` |
| **Levels & zones** | `LevelSystem`, `SanctuarySystem`, `PontiacLabSystem`, `SpaceLevelSystem`, `SwarmsLairSystem` |
| **Progression** | `ProgressSync`, `InventorySystem`, `CraftingSystem`, `ShopSystem`, `JewelSystem`, `CompanionSystem` |
| **Building** | `BaseSystem`, `BuildingSystem`, `PrefabSystem` |
| **Effects & audio** | `EffectsSystem`, `ExplosionSystem`, `SoundSystem`, `MusicSystem`, `PropAudioSystem` |
| **UI overlays** | `EnemyHealthBarSystem`, `MapSystem` (HTML in canvas-relative space) |
| **Networking** | `MultiplayerSystem` |

Class-based React components in the same folder render the actual HTML
HUD: `MainMenu.tsx`, `GameUI.tsx`, `UpgradeMenu.tsx`, `CharacterEditor.tsx`,
`AuthUI.tsx`, etc.

### Glue: EventBus + StateMachine

- [`EventBus.ts`](../client/src/game/EventBus.ts) is a typed pub/sub
  singleton. Every cross-system message goes through it. The full event
  catalog is in [`reference/game-events.md`](reference/game-events.md).
- [`StateMachine.ts`](../client/src/game/StateMachine.ts) is a generic
  finite-state-machine reused by enemies, the player, vehicles, and
  bosses for behavior transitions.

### Persistence on the client

- [`ProgressSync.ts`](../client/src/game/ProgressSync.ts) builds a
  `ProgressSnapshot` from every relevant system and POSTs it to
  `/api/progress/save` on a timer + on key events. On load it re-applies
  the snapshot to the same systems. See
  [`systems/progression-and-saves.md`](systems/progression-and-saves.md).

## Server architecture

The server is small and intentionally boring — it exists to authenticate
users, persist saves and stats, and broker multiplayer messages.

| File | Responsibility |
|---|---|
| [`server/index.ts`](../server/index.ts) | Boots Express + http.Server, mounts auth + routes + multiplayer + (dev-only) Vite middleware. |
| [`server/auth.ts`](../server/auth.ts) | Passport Local (scrypt), `express-session` with PG store, all `/api/auth/*` and `/api/progress/*` and `/api/leaderboard` routes. |
| [`server/routes.ts`](../server/routes.ts) | Wires auth + multiplayer setup. Add new HTTP routes here or in `auth.ts`. |
| [`server/storage.ts`](../server/storage.ts) | `IStorage` interface + `DatabaseStorage` impl. Every DB read/write goes through this. |
| [`server/db.ts`](../server/db.ts) | Drizzle pg pool. |
| [`server/multiplayer.ts`](../server/multiplayer.ts) | `ws` WebSocketServer in `noServer` mode; manual upgrade routing on `/ws` so it does not conflict with Vite HMR. |
| [`server/vite.ts`](../server/vite.ts) | Dev-only Vite middleware mode + HMR on `/vite-hmr`. |
| [`server/static.ts`](../server/static.ts) | Production static asset serving from `dist/public`. |

## Shared types

[`shared/schema.ts`](../shared/schema.ts) is the **only** file imported
by both client and server. It defines Drizzle tables and Zod insert
schemas. Anything you need on both sides goes here.

## Build pipeline

- **Dev**: `tsx server/index.ts` runs the server directly. Vite middleware
  serves the client and HMRs over WS.
- **Prod**: `script/build.ts` (run via `npm run build`) builds the Vite
  client into `dist/public` and bundles the server into `dist/index.cjs`.

See [`deployment.md`](deployment.md) for the full pipeline + Replit
deploy specifics.

## Where to look next

- [`systems/event-bus-and-state-machine.md`](systems/event-bus-and-state-machine.md)
  — the comms layer is the most important thing to understand before
  touching anything else.
- [`systems/levels-and-zones.md`](systems/levels-and-zones.md) — the
  world-state machine.
- [`how-to/add-a-level.md`](how-to/add-a-level.md) — the most opinionated
  end-to-end walkthrough; following it teaches you the wiring patterns.
