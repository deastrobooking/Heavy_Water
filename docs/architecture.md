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
| **Enemies** | `EnemySystem`, `AerialEnemySystem`, `EnemyBaseSystem`, `BioCreatureSystem`, `CreatureMechaDesigner` |
| **World** | `CityGenerator`, `MountainRingSystem`, `AlienFoliageSystem`, `EarthFoliageSystem`, `EnvironmentPropSystem`, `LODCullSystem`, `SkySystem` |
| **Levels & zones** | `LevelSystem`, `SanctuarySystem`, `PontiacLabSystem`, `SpaceLevelSystem`, `SwarmsLairSystem` |
| **Progression** | `ProgressSync`, `InventorySystem`, `CraftingSystem`, `ShopSystem`, `JewelSystem`, `CompanionSystem`, `ActivePetSystem` |
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

## Engine roadmap

Heavy Water has quietly grown from "a game" into most of "a reusable
action-RPG world-building engine": ~80 self-contained systems, a
data-driven robot/creature factory, a level/side-zone state machine, and
a save pipeline that snapshots every system. This section records the
recommended path to finish that transition. **Nothing here is built yet —
it is the agreed direction and sequencing, not a description of current
behavior.** Each phase is independently shippable and ordered so that
earlier phases de-risk the later ones.

### Baseline (what exists today)

- **One orchestrator.** [`Game.tsx`](../client/src/game/Game.tsx) is
  ~4,500 lines. It instantiates ~60 systems into `useRef` slots and drives
  them from a single render loop — ~25–30 systems get an explicit
  `.update(dt)` each frame, the rest self-register
  `onBeforeRenderObservable` callbacks.
- **Registry for visuals, hardcoded for ownership.** Meshes are
  data-driven (`RobotPresets` → `RobotFactory`, `CreatureMechaDesigner`),
  but which *system* owns spawn/update/dispose is hardcoded, and hits are
  dispatched through a `routeHit` chain in `Game.tsx` — `mesh.metadata`
  checks for remote-player / prop targets plus a sequential system-trial
  chain (mining → base → aerial → enemy).
- **No spatial index.** LOD culling, hit detection, and enemy targeting
  are linear scans over per-frame scratch arrays / `scene.meshes`.
- **No GPU instancing.** Repeated meshes (foliage, swarms, city blocks)
  are individual meshes optimized with `freezeWorldMatrix()` + shared
  materials, not `ThinInstances` / `InstancedMesh`.
- **Partial entity contract.** `IDamageable` + `mesh.metadata` is the only
  cross-system contract; each system otherwise defines its own entity
  shape. No formal component model.

### Phase 1 — Extract orchestration out of `Game.tsx`

**Problem.** A 4,500-line component is the single biggest source of merge
risk and onboarding cost, and it couples the React lifecycle to game-loop
wiring.

**Target.** Group system construction into composition modules
(`setupWorldSystems`, `setupCombatSystems`, `setupProgressionSystems`,
`setupMultiplayerSystems`) that each return `{ update?, dispose }` handles.
`Game.tsx` becomes a thin lifecycle coordinator that owns one ordered
`SystemRegistry` and calls `registry.update(dt)` / `registry.dispose()`.
(This matches README "Suggested Improvements #1".)

**Why first.** Everything below is easier once systems are uniformly
registered and disposed. It is also the lowest-risk change — a pure
refactor with no behavior change — so it can land incrementally.

### Phase 2 — Registry-based entity dispatch

**Problem.** Adding an entity family today means touching spawn code, the
per-frame loop, and the `routeHit` switch by hand.

**Target.** A single `EntityRegistry` keyed by an `entityType` string.
Each type registers a descriptor — `{ build(def, pos), update(entity, dt),
onHit(entity, dmg), dispose(entity) }`. Spawns become
`registry.spawn(type, def, pos)`; the frame loop and hit router iterate the
registry instead of hardcoded system lists. `RobotPresets` /
`CreatureMechaDesigner` become the `build` step for their types.

**Why second.** It depends on Phase 1's uniform registration, and it turns
"add a new enemy/prop/creature" into a data + one-descriptor change — the
core promise of a reusable engine.

### Phase 3 — Spatial partitioning + GPU instancing

**Problem.** Linear scans and one-mesh-per-object cap the entity count.
O(n) queries and draw calls are the two ceilings.

**Target.**

- A uniform-grid broad phase (cell size ≈ the largest query radius) that
  LOD culling, hit detection, targeting, and AOE all query instead of
  scanning every entity. Rebuilt from entity positions each frame (cheap
  for a grid).
- `ThinInstances` for high-count identical meshes — foliage first (biggest
  win), then city blocks and swarm robots that share a `RobotStyle`
  material key.

**Why third.** It needs the Phase 2 registry to know every entity's
position/type in one place, and it is where the "world-building" scale
(large open worlds, dense swarms) becomes affordable.

### Phase 4 — Unified entity/component contract

**Problem.** Each system still defines its own entity struct, so
cross-cutting features (status effects, AI steering, save/load) get
re-implemented per system.

**Target.** Formalize the metadata pattern into a small component contract
— e.g. `Transform`, `Damageable`, `Steerable`, `Persistable` components
attached to a lightweight entity id: an "ECS-lite" that keeps the current
class-based systems as the "systems" layer but standardizes the data they
read/write. `ProgressSync` then snapshots any `Persistable` component
generically instead of per-system.

**Why last.** It is the largest conceptual change and only pays off once
Phases 1–3 have made entity ownership, dispatch, and iteration uniform.
Doing it first would be a speculative rewrite; doing it last makes it a
consolidation of patterns already proven by the earlier phases.

### Recommended order

`Phase 1 → 2 → 3 → 4`. Each phase is shippable on its own and leaves the
game fully playable; each removes a specific ceiling (merge risk →
extensibility → scale → cross-cutting features) and creates the
precondition the next phase needs. Resist reordering: instancing before a
registry (jumping to Phase 3) tends to hardcode instance buffers per
system, which Phase 2 would then have to unwind.

## Where to look next

- [`systems/event-bus-and-state-machine.md`](systems/event-bus-and-state-machine.md)
  — the comms layer is the most important thing to understand before
  touching anything else.
- [`systems/levels-and-zones.md`](systems/levels-and-zones.md) — the
  world-state machine.
- [`how-to/add-a-level.md`](how-to/add-a-level.md) — the most opinionated
  end-to-end walkthrough; following it teaches you the wiring patterns.
