
# Heavy Water
<img width="1512" height="982" alt="Screenshot 2026-05-05 at 10 14 43 PM" src="https://github.com/user-attachments/assets/fe4d8f0e-9037-4b8d-97b3-969ebe91833a" />
Heavy Water is a sci-fi open-world action game built with Babylon.js, React, TypeScript, Express, PostgreSQL, and WebSockets. The game combines fast aerial and ground combat, modular robot systems, crafting and building, companion progression, and optional multiplayer rooms.

Join in the battle against the Swarm. Playing as the humanoid robot creations of Dr. Cynthia and Dr. Sergio. 

This README is a consolidated technical reference for the current codebase.

## Table of Contents

- [Project Snapshot](#project-snapshot)
- [Quickstart (5 Minutes)](#quickstart-5-minutes)
- [Core Tech Stack](#core-tech-stack)
- [Architecture Overview](#architecture-overview)
- [Architecture Diagrams](#architecture-diagrams)
- [Repository Structure](#repository-structure)
- [Gameplay Systems (Codebase Review)](#gameplay-systems-codebase-review)
- [Backend and Data Model](#backend-and-data-model)
- [API Contract (Examples)](#api-contract-examples)
- [WebSocket Multiplayer Protocol](#websocket-multiplayer-protocol)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Build and Production](#build-and-production)
- [Database and Drizzle](#database-and-drizzle)
- [Controls and Input](#controls-and-input)
- [Assets](#assets)
- [Troubleshooting](#troubleshooting)
- [Contributing Notes](#contributing-notes)
- [Suggested Improvements](#suggested-improvements)

## Project Snapshot

- Engine: Babylon.js (native Babylon APIs, not React Three Fiber for game runtime)
- Frontend app shell: React + Vite + TypeScript
- Server: Express + Passport Local Auth + express-session
- Database: PostgreSQL via Drizzle ORM
- Multiplayer: WebSocket server (`ws`) with room-based sync
- Target style: anime/retro-futuristic cell-shaded action combat

## Quickstart (5 Minutes)

For first-time contributors who want to get the project running quickly:

### 1) Install dependencies

```bash
npm install
```

### 2) Set environment variables

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME"
export SESSION_SECRET="change-me"
export PORT="5000"
```

### 3) Push schema to database

```bash
npm run db:push
```

### 4) Start development server

```bash
npm run dev
```

### 5) Open the app

- URL: http://localhost:5000
- Register a user, then enter the game from the main menu

If anything fails, jump to [Troubleshooting](#troubleshooting).

## Core Tech Stack

### Frontend

- React 18
- TypeScript 5
- Vite 5
- Babylon.js 8 (`@babylonjs/core`, loaders, GUI, materials)
- Tailwind CSS + shadcn/radix UI primitives (for non-core game UI)

### Backend

- Node.js + Express
- Passport Local strategy
- express-session + connect-pg-simple
- WebSockets via `ws`

### Data and Tooling

- PostgreSQL
- Drizzle ORM + Drizzle Kit
- esbuild (server bundle in production build)
- tsx (dev runtime)

## Architecture Overview

The game is orchestrated by `client/src/game/Game.tsx`, which creates and wires all runtime systems:

- Rendering/runtime: `BabylonEngine`
- World generation: `CityGenerator`, `SkySystem`, environment props
- Player: `PlayerController`, `CombatSystem`, `ArmorSystem`
- Weapons: `WeaponsSystem`, `SpecialWeaponsSystem`, `ElementalSpecialsSystem`, `BeamSabreSystem`
- Enemies: `EnemySystem`, `AerialEnemySystem`, `EnemyBaseSystem`
- Progression/economy: crafting, inventory, shops, upgrades, pickups, companion growth
- Construction: `BuildingSystem`, `PrefabSystem`, `BaseSystem`, `LevelSerializer`
- Support systems: `EventBus`, `StateMachine`, `DamageSystem`, audio/effects/music
- Multiplayer client sync: `MultiplayerSystem`

### Architectural Patterns Used

- Event-driven communication through a singleton `EventBus`
- Finite-state behavior via reusable `StateMachine<T>`
- System-oriented game architecture (modular feature systems coordinated by `Game.tsx`)
- Persistent account/progress model through auth sessions + DB-backed player data

## Architecture Diagrams

### Runtime System Map

```mermaid
flowchart TD
	G[Game.tsx Orchestrator] --> BE[BabylonEngine]
	G --> CG[CityGenerator]
	G --> SK[SkySystem]
	G --> PC[PlayerController]
	G --> WS[WeaponsSystem]
	G --> SW[SpecialWeaponsSystem]
	G --> ES[ElementalSpecialsSystem]
	G --> BS[BeamSabreSystem]
	G --> EN[EnemySystem]
	G --> AE[AerialEnemySystem]
	G --> EB[EnemyBaseSystem]
	G --> INV[InventorySystem]
	G --> CR[CraftingSystem]
	G --> CO[CompanionSystem]
	G --> BLD[BuildingSystem]
	G --> PF[PrefabSystem]
	G --> VEH[VehicleSystem]
	G --> MP[MultiplayerSystem]
	G --> UI[GameUI / Menus]

	PC --> EV[EventBus]
	EN --> EV
	WS --> EV
	CO --> EV
	EV --> UI

	MP --> WSOCK[WebSocket /ws]
```

### Backend and Multiplayer Flow

```mermaid
sequenceDiagram
	participant C as Client
	participant E as Express Server
	participant P as Passport Session
	participant DB as PostgreSQL
	participant W as WebSocket Server

	C->>E: POST /api/auth/register or /api/auth/login
	E->>P: authenticate + create session
	P->>DB: store/read user_sessions
	E->>DB: users/player_progress queries
	E-->>C: authenticated user JSON

	C->>W: ws connect + auth message
	W-->>C: auth_ok
	C->>W: create_room / join_room
	W-->>C: room_created / room_joined
	C->>W: position_update / action / chat / enemy_damage
	W-->>C: broadcast to room peers
```

## Repository Structure

```text
.
├── client/
│   ├── index.html
│   ├── public/                 # models, textures, sounds, music, fonts
│   └── src/
│       ├── game/               # Babylon runtime and gameplay systems
│       ├── components/ui/      # shared UI primitives
│       ├── hooks/
│       ├── lib/
│       ├── pages/
│       ├── App.tsx
│       └── main.tsx
├── server/                     # Express, auth, websocket multiplayer
├── shared/                     # shared DB schema/types
├── script/build.ts             # production build orchestration
├── scripts/post-merge.sh       # install + optional db push hook
├── drizzle.config.ts
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── replit.md                   # detailed game/system notes
└── Docs/DEVELOPERS_GUIDE.md    # developer-oriented system guide
```

## Gameplay Systems (Codebase Review)

The game code in `client/src/game` is broad and feature-rich. High-level grouped review:

### Player, Combat, and Movement

- `PlayerController`: player movement, physics, stats, stamina/health/armor/shield model
- `CombatSystem`: combo handling and melee logic
- `BeamSabreSystem`: dedicated sabre combat and special slash flows
- `GamepadInput`: controller-to-key/mouse translation for parity with keyboard controls

### Weapons and Abilities

- `WeaponsSystem`: core weapon loadout and ammo/state flows
- `SpecialWeaponsSystem`: special weapon paths
- `ElementalSpecialsSystem`: elemental cast/cooldown/selection model
- `DamageSystem`: shared damage typing/pipeline

### Enemies and World Threats

- `EnemySystem`: spawning/waves/ground threats
- `AerialEnemySystem`: aerial hostiles and related behavior
- `EnemyBaseSystem`: base/turret style threats
- `EnemyHealthBarSystem`: enemy health overlays

### World, Building, and Exploration

- `CityGenerator`: world/biome/city generation
- `BuildingSystem` + `PrefabSystem`: block and prefab placement pipeline
- `BaseSystem`: placeable structure logic and interactions
- `MiningSystem`: resource nodes
- `MapSystem`: map/minimap behavior
- `VehicleSystem` + `VehicleFactory` + `VehicleDesigner`: drivable/flyable units

### Inventory, Crafting, Economy, Progression

- `InventorySystem`: item definitions and inventory state
- `CraftingSystem`: recipe crafting and item conversion
- `ShopSystem`: purchasable resources/items
- `ArmorCapsuleSystem`, `ArmorSystem`: player defense upgrades and stat layers
- `ProgressSync`: progress save/load integration

### Companions, Creatures, and Robotics

- `CompanionSystem`: companion AI/behavior/upgrade stats
- `BioCreatureSystem` + capture UI: capture/companion-style flows
- `RobotDesigner`, `RobotFactory`, `RobotPresets`, armor parts/systems: parametric robot generation

### UI and UX Layers

- `MainMenu`, `GameUI`, `UpgradeMenu`, `AuthUI`, `CharacterEditor`, `MusicPlayerUI`, lab/garden UIs
- Main runtime state machine in `Game.tsx`: auth, menu, playing, paused, gameover

## Backend and Data Model

Server entrypoint: `server/index.ts`

### HTTP API Areas

Auth and player identity:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Progress and profile:

- `POST /api/progress/save`
- `GET /api/progress/load`
- `POST /api/progress/stats`

Leaderboard:

- `GET /api/leaderboard`

### Data Storage

DB wiring:

- `server/db.ts` initializes Drizzle with PostgreSQL pool

Storage implementation:

- `server/storage.ts` provides `DatabaseStorage` methods for users and progress

Shared schema:

- `shared/schema.ts`
- tables: `users`, `player_progress`, `game_sessions`, `user_sessions`

### Authentication

`server/auth.ts` configures:

- Passport Local strategy with scrypt password hashing
- Session persistence with `connect-pg-simple`
- Session cookie defaults for local/dev workflow

## API Contract (Examples)

The routes below are implemented in `server/auth.ts`.

### POST /api/auth/register

Request body:

```json
{
	"username": "pilot01",
	"password": "secret123"
}
```

Success response (201):

```json
{
	"id": 1,
	"username": "pilot01",
	"displayName": null,
	"level": 1,
	"credits": 0,
	"experience": 0,
	"highestWave": 0,
	"totalKills": 0,
	"hasFlightArmor": false,
	"lastLogin": null,
	"createdAt": "2026-04-28T12:00:00.000Z"
}
```

Common errors:

- 400: missing username/password, invalid length
- 409: username already taken

### POST /api/auth/login

Request body:

```json
{
	"username": "pilot01",
	"password": "secret123"
}
```

Success response (200): same safe user shape as register.

Common errors:

- 401: invalid username or password

### POST /api/auth/logout

Request body: none

Success response (200):

```json
{
	"message": "Logged out"
}
```

### GET /api/auth/me

Request: authenticated session cookie required.

Success response (200): safe user shape.

Common errors:

- 401: not authenticated

### GET /api/leaderboard

Request body: none

Success response (200): array of users (password omitted), sorted by highestWave desc then totalKills desc.

```json
[
	{
		"id": 17,
		"username": "ace",
		"displayName": "Ace",
		"level": 14,
		"credits": 9200,
		"experience": 18100,
		"highestWave": 32,
		"totalKills": 740,
		"hasFlightArmor": true,
		"lastLogin": "2026-04-27T19:20:00.000Z",
		"createdAt": "2026-03-01T10:00:00.000Z"
	}
]
```

### POST /api/progress/save

Request: authenticated session required.

Request body:

```json
{
	"saveData": {
		"wave": 8,
		"inventory": [],
		"weaponLevels": {},
		"playerStats": {
			"level": 5,
			"credits": 1500
		}
	}
}
```

Success response (200):

```json
{
	"id": 3,
	"userId": 1,
	"saveData": {
		"wave": 8,
		"inventory": [],
		"weaponLevels": {},
		"playerStats": {
			"level": 5,
			"credits": 1500
		}
	},
	"updatedAt": "2026-04-28T12:40:00.000Z"
}
```

Common errors:

- 401: not authenticated

### GET /api/progress/load

Request: authenticated session required.

Success response (200):

- existing save: player_progress row
- no save yet:

```json
{
	"saveData": null
}
```

### POST /api/progress/stats

Request: authenticated session required.

Request body accepts any subset of:

- level
- credits
- experience
- highestWave
- totalKills
- hasFlightArmor

Example request:

```json
{
	"level": 7,
	"credits": 2100,
	"highestWave": 11
}
```

Success response (200): updated safe user.

Common errors:

- 401: not authenticated
- 404: user not found

## WebSocket Multiplayer Protocol

WebSocket endpoint path:

- `/ws` (configured in `server/multiplayer.ts`)

Key client message types:

- `auth`
- `create_room`
- `join_room`
- `leave_room`
- `list_rooms`
- `position_update`
- `action`
- `chat`
- `enemy_damage`
- `ping`

Representative server event types:

- `auth_ok`
- `room_created`, `room_joined`, `room_left`, `room_list`
- `player_joined`, `player_left`, `host_changed`, `player_update`, `player_action`
- `chat_message`
- `enemy_damage`
- `pong`
- `error`

## Environment Variables

Required:

- `DATABASE_URL`: PostgreSQL connection string used by server and Drizzle config

Recommended:

- `SESSION_SECRET`: session signing secret (falls back to a dev default if missing)

Runtime/infra:

- `NODE_ENV`: development or production behavior
- `PORT`: server listen port (defaults to 5000)

## Local Development

### Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 14+

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment

Create a local `.env` (or equivalent environment export) with at least:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME
SESSION_SECRET=change-me
PORT=5000
```

### 3) Apply database schema

```bash
npm run db:push
```

### 4) Start development server

```bash
npm run dev
```

The Express server and Vite middleware run together. Open the app on port `5000`.

## Build and Production

Create production output:

```bash
npm run build
```

This does:

- Vite client build into `dist/public`
- esbuild bundles server into `dist/index.cjs`

Run production server:

```bash
npm start
```

## Database and Drizzle

Drizzle config is in `drizzle.config.ts` and points to:

- schema source: `shared/schema.ts`
- output directory: `migrations/`
- dialect: PostgreSQL

Primary workflow currently in package scripts:

- `npm run db:push`

## Controls and Input

The project supports keyboard/mouse and gamepad.

Gamepad behavior is defined in `client/src/game/GamepadInput.ts` and maps Xbox-style buttons to existing keyboard/mouse actions. Notable mappings:

- A -> jump/fly
- B -> interact
- X -> capture
- Y -> beam sabre slash
- LB -> boost dash
- RB -> cast current elemental
- Triggers -> attack/sabre trigger actions
- D-pad -> cycle elementals and weapons

For gameplay-level control details, refer to:

- `Docs/DEVELOPERS_GUIDE.md`
- `replit.md`

## Assets

Game assets live under `client/public`:

- `models/`
- `textures/`
- `sounds/`
- `music/`
- `fonts/`
- `geometries/`

Build tooling is configured to include large game assets (`.gltf`, `.glb`, audio formats).

## Troubleshooting

### Error: DATABASE_URL must be set

Set `DATABASE_URL` before starting server or running Drizzle commands.

### Dist folder missing in production

Run:

```bash
npm run build
```

before running:

```bash
npm start
```

### Session/login issues in local dev

- Ensure PostgreSQL is running
- Ensure `user_sessions` table can be created/accessed
- Set a stable `SESSION_SECRET`

### Multiplayer connection issues

- Verify server is reachable on the same origin
- Confirm WebSocket path is `/ws`
- Check browser/devtools network for upgrade failures

## Contributing Notes

- Core game behavior is concentrated in `client/src/game/Game.tsx` and system files under `client/src/game`
- Favor adding new functionality as isolated systems and wiring through the existing orchestration model
- Keep shared contracts (types/schema) in `shared/`
- If a change affects persistence, update `shared/schema.ts` and run `npm run db:push`

## Suggested Improvements

The project is already feature-rich and well modularized. These are high-impact improvements to consider next.

### 1) Split orchestration in Game.tsx into domain composition modules

Why:

- `Game.tsx` currently wires a very large number of systems and UI states, which increases change risk and onboarding time.

Suggestion:

- Introduce composition modules such as `setupCombatSystems`, `setupWorldSystems`, `setupProgressionSystems`, and `setupMultiplayerSystems`.
- Keep `Game.tsx` as a thin lifecycle coordinator while each composition module returns disposal hooks.

Outcome:

- Smaller merge conflicts, easier testing, clearer ownership boundaries.

### 2) Add automated tests for server auth and progress routes

Why:

- Auth/session/progress paths are critical for player data integrity.

Suggestion:

- Add integration tests for `register`, `login`, `auth/me`, `progress/save`, and `progress/load`.
- Validate success and failure cases (401, 409, malformed bodies, unauthorized writes).

Outcome:

- Reduced regression risk when touching auth/session/storage logic.

### 3) Introduce runtime payload validation for API and WebSocket messages

Why:

- The codebase already uses Zod and shared types, but message inputs can be hardened further.

Suggestion:

- Define Zod request schemas for all HTTP bodies and reject invalid payloads early.
- Define schemas for multiplayer message types (`auth`, `position_update`, `action`, `chat`, etc.) and validate incoming WebSocket events before processing.

Outcome:

- Better security posture, clearer client error responses, lower crash surface from malformed data.

### 4) Add lightweight observability for server and multiplayer

Why:

- Room-level multiplayer and persistence flows benefit from structured telemetry during incidents.

Suggestion:

- Add structured logs for room lifecycle events, auth attempts, progress save latency, and websocket disconnect reasons.
- Include request IDs or player IDs in logs to follow cross-system flows.

Outcome:

- Faster debugging in production and easier root-cause analysis.

### 5) Define and enforce performance budgets for the Babylon runtime

Why:

- The game has many concurrent systems (enemies, effects, audio, UI overlays), making frame pacing easy to regress.

Suggestion:

- Add a periodic perf sampler (FPS, draw calls, active meshes, particle counts).
- Set target budgets (for example desktop 60 FPS target, capped max active AI entities by tier).
- Gate expensive effects based on quality tiers.

Outcome:

- Predictable performance on mid-range devices and fewer late-stage optimizations.

### 6) Version and migrate saved progress schemas

Why:

- `saveData` is flexible JSON and can drift as systems evolve.

Suggestion:

- Add a `saveVersion` field and migration functions that upgrade old snapshots on load.
- Add tests for at least one back-version migration path.

Outcome:

- Backward compatibility for returning players after major updates.

### 7) Strengthen security defaults for deployed environments

Why:

- Current cookie/session settings are friendly for local dev; production hardening should be explicit.

Suggestion:

- In production, enable secure cookies, consider stricter same-site policy where possible, and document required proxy/trust settings.
- Ensure a strong `SESSION_SECRET` is mandatory in production mode.

Outcome:

- Safer auth/session behavior in hosted deployments.

### 8) Add a CI pipeline with minimum quality gates

Why:

- Current scripts include type checks and build, but automated pull request enforcement is not documented.

Suggestion:

- Add CI jobs for `npm ci`, `npm run check`, `npm run build`, and route-level tests.
- Block merges when checks fail.

Outcome:

- Higher release confidence and faster review cycles.

### 9) Document extension playbooks for adding new systems

Why:

- The codebase supports many specialized game systems; consistent extension guidance avoids divergence.

Suggestion:

- Add short playbooks for: new weapon type, new enemy archetype, new companion behavior, and new buildable structure.
- Include required wiring points, save-data impacts, and UI touchpoints.

Outcome:

- Faster contributor ramp-up and more consistent implementations.

## Additional Documentation

- `Docs/DEVELOPERS_GUIDE.md`: deep technical breakdown of many game systems
- `replit.md`: project-specific architecture and gameplay notes
