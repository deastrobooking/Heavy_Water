# Detroit 3026: The First Attack

## Overview
A 3D futuristic sci-fi action game set in Detroit in the year 3026. Built with Babylon.js featuring anime-style cell-shaded graphics with ink outline post-processing, immersive combat, DBZ-style flight, open world biomes, and an explorable cityscape.

## Story
In 3026, humanity has colonized the Moon, Mars, and Venus alongside AI partners. But in Detroit, hybrid organoids - AI fused with human and tardigrade DNA - have gone insane. Their secret experiments on insects and mammals threaten civilization. Defend Detroit against the first wave of the invasion!

## Project Structure
```
Docs/
  DEVELOPERS_GUIDE.md     - Comprehensive developer documentation
client/
  src/
    game/
      BabylonEngine.ts        - Core 3D engine with ink outline post-processing
      CityGenerator.ts        - Open world with city + 4 biomes (mountains, jungle, desert, junkyard)
      PlayerController.ts     - First-person player with triple-jump flight, dodge, parry, sprint, jetpack
      AnimationSystem.ts      - Procedural character animations (run, jump, fight, fly, dodge)
      WeaponsSystem.ts        - 6 primary weapon types with projectile physics
      SpecialWeaponsSystem.ts - 4 special weapons (keys 7-0): Missile, Energy Burst, Bomb, Drone
      BeamSabreSystem.ts      - Toggle melee weapon with slash combos and energy wave attacks
      ArmorSystem.ts          - 5 elemental armor types with strength/defense/poison effects
      ArmorCapsuleSystem.ts   - Laboratory capsule for armor upgrades and flight armor
      CraftingSystem.ts       - Recipe-based crafting for weapons, armor, and bases
      BuildingSystem.ts       - Minecraft-style mining and block building system
      ShopSystem.ts           - Shop buildings with buy/sell for weapons, armor, materials
      EnemySystem.ts          - 6 enemy types including commanders with FSM AI
      ChestSystem.ts          - Loot chests with upgrades
      CombatSystem.ts         - Melee combo system with input buffering and hitbox detection
      CompanionSystem.ts      - Companion allies and pets
      EventBus.ts             - Global event system for decoupled communication
      StateMachine.ts         - Generic finite state machine with transition validation
      DamageSystem.ts         - Unified damage pipeline with resistances, types, area damage
      InventorySystem.ts      - Slot-based inventory with item stacking and definitions
      RobotFactory.ts         - Procedural robot mesh generation
      RobotPresets.ts         - Robot archetype presets including CommanderOmega
      RobotDesigner.ts        - Robot descriptor interface
      MultiplayerSystem.ts    - WebSocket multiplayer client with room/lobby/chat/sync
      AuthUI.tsx              - Login/register authentication screen
      GameUI.tsx              - HUD with all system displays, shop UI, capsule UI, multiplayer lobby
      MainMenu.tsx            - Game start menu
      Game.tsx                - Main game orchestration integrating all systems
server/
  index.ts                    - Express server entry point
  auth.ts                     - Passport.js authentication with session management
  multiplayer.ts              - WebSocket multiplayer server with rooms and state sync
  db.ts                       - PostgreSQL database connection pool (Drizzle ORM)
  storage.ts                  - Database storage layer (CRUD operations)
  routes.ts                   - API route registration
shared/
  schema.ts                   - Drizzle ORM schema (users, player_progress, game_sessions)
```

## Architecture

### Core Systems
- **EventBus**: Singleton event system for decoupled communication between game systems
- **StateMachine**: Generic FSM with state configs, transition validation, timers
- **DamageSystem**: Unified damage pipeline with DamageType enum, resistances, IDamageable interface, area damage

### Player Systems
- **PlayerController**: Implements IDamageable, full state machine (idle/moving/sprinting/dodging/attacking/stunned/dead/jetpack/flying/hovering). Triple-jump flight system: 1st jump = normal, 2nd = double jump, 3rd = sky launch into flight mode. Air momentum system preserves horizontal velocity.
- **AnimationSystem**: Procedural multi-part character animations. States: idle, running, sprinting, jumping, doubleJump, tripleJumpLaunch, flyingHover, lightPunch, heavySlam, dodgeRoll, edgeGrab, landing, dead. Smooth blending between states.
- **CombatSystem**: Light/heavy melee combo chains with input buffering, hitbox detection, damage multipliers
- **InventorySystem**: 24-slot grid inventory with item stacking, item definitions catalog

### Weapon Systems
- **WeaponsSystem**: 6 primary weapons (keys 1-6) with projectile physics
- **SpecialWeaponsSystem**: 4 special weapons (keys 7-0) with unique mechanics
- **BeamSabreSystem**: Toggle melee weapon (T key) with slash combos and energy wave projectiles

### Armor & Upgrade Systems
- **ArmorSystem**: 4 armor slots (helmet, chest, legs, boots) with 5 elemental types
- **ArmorCapsuleSystem**: Laboratory building with interactive upgrade capsule
  - 6 upgrade tiers: Aero-Flight Module (free), Kinetic Accelerator, Titan Defense, Inferno Core, Storm Conductor, Quantum Exo-Suit
  - First upgrade grants flight armor (enables triple-jump flight)
  - Glowing capsule with rotating energy rings and holographic displays
- **CraftingSystem**: Recipe-based system using InventorySystem materials
- **BuildingSystem**: Minecraft-style mining and building
  - Mine/destroy terrain and structures with weapons (large chunk destruction)
  - Build blocks: Metal Wall, Glass, Platform, Ramp, Door, Light
  - Toggle build mode (G key), rotate placement (R), grid-snapped preview
  - Debris chunks with physics, material drops on mining

### Shop System
- **ShopSystem**: 3 shop types (weapon, armor, general) placed in city/villages
  - Buy items with credits, sell items back
  - Visual shop buildings with colored beacons
  - Press E to interact, browse items, purchase

### Enemy Systems
- **EnemyUnit**: Implements IDamageable, FSM-driven AI
- **EnemySystem**: Wave spawner with 6 enemy types
  - Drone, Soldier, Heavy, Insectoid, Hybrid, Commander
  - Commanders: 1500 HP, flight/hover AI, dodge attacks (40% chance), rooftop spawning
  - Commander aura, beam attacks, rare loot drops with upgrade modules
  - Appear at wave 7+ with larger hitbox and unique CommanderOmega preset

### City & Environment
- **CityGenerator**: Massive open world 1200x1200 with city center + 4 biomes
  - City: Downtown, Industrial, Residential, Spaceport, Highway, Outer Districts
  - Mountains Biome (North): 9 peaks, caves, winding paths, mountain temple, village
  - Jungle Biome (East): Dense cyber-trees, canopy platforms, bioluminescent plants, ancient ruins, treehouse village
  - Desert Biome (South): Sand dunes, rock formations, oasis spots, buried structures, pyramid temple, hidden underground chamber
  - Junkyard Robot City (West): Scrap piles, broken robot parts, trash buildings, free robot NPCs, salvage zones, junkyard temple
  - Each biome has temples, villages, and secrets
  - Sky Cities, Sky Bridges, Stairways, Apex Platform
  - Cell-shaded shader materials with rim lighting, outlines, panel lines
  - Animated water shader river, neon lights, street lights

### Database & Auth
- **PostgreSQL**: Drizzle ORM with pg driver, schema in shared/schema.ts
  - Tables: users, player_progress, game_sessions, user_sessions
  - Push schema: `npm run db:push`
- **Authentication**: Passport.js local strategy with scrypt password hashing
  - Express-session with connect-pg-simple for persistent sessions
  - Routes: POST /api/auth/register, /api/auth/login, /api/auth/logout, GET /api/auth/me
  - Progress save/load: POST /api/progress/save, GET /api/progress/load
  - Leaderboard: GET /api/leaderboard

### Multiplayer
- **WebSocket Server**: Real-time multiplayer on /ws path
  - Room system: create, join, leave, list rooms (max 4 players)
  - Position sync at 20Hz with interpolated rendering
  - Chat messaging within rooms
  - Enemy damage sync across players
  - Graceful disconnect handling with stale player cleanup
- **MultiplayerSystem** (client): WebSocket client with event-driven architecture
  - Remote player rendering with name labels and state-based coloring
  - Smooth position interpolation for remote players
  - Lobby UI with room creation, joining, and browsing

### Rendering
- **BabylonEngine**: Ink outline post-processing via Sobel edge detection on depth+normal buffers
  - Configurable outline thickness, color, enabled state
  - Brightness boost on all materials for cell-shaded look
  - Bloom, chromatic aberration, FXAA, sharpen post-processing

## Controls
- WASD - Move
- SHIFT - Sprint
- Mouse - Look around
- Left Click - Fire weapon / Place block (build mode)
- Right Click - Mine/destroy (build mode)
- 1-6 - Switch primary weapons / Select block type (build mode)
- 7-0 - Fire special weapons
- T - Toggle Beam Sabre
- R - Reload / Rotate block (build mode)
- Space - Jump (x3 = Flight) / Ascend (flight mode)
- CTRL - Descend (flight mode)
- X - Toggle flight mode (requires flight armor)
- G - Toggle build mode
- E - Interact (shops, capsule)
- Q - Dodge roll
- F - Parry
- V - Light melee attack
- B - Heavy melee attack
- ESC - Close UI panels
- Click canvas to enable pointer lock

## Technical Details
- Engine: Babylon.js v8.x
- Rendering: WebGL with ink outline post-processing, bloom, chromatic aberration, FXAA
- Graphics Style: Cell-shaded anime aesthetic with ink outlines, neon accents, rim lighting, panel lines
- Frontend: React + TypeScript + Vite
- Backend: Express.js with Passport.js authentication
- Database: PostgreSQL with Drizzle ORM (schema push via `npm run db:push`)
- Multiplayer: WebSocket server (ws library) on /ws path
- Custom shaders: Cell-shading with outlines, animated water, Sobel edge detection
- Architecture: Event-driven with FSM-based entity states

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground

## Recent Changes
- March 2026: Database, Auth & Multiplayer
  - Added PostgreSQL database with Drizzle ORM (users, player_progress, game_sessions tables)
  - Added user authentication (register/login/logout) with Passport.js and scrypt hashing
  - Added session persistence with connect-pg-simple
  - Added WebSocket multiplayer server with room/lobby system (max 4 players per room)
  - Added real-time player position sync, chat, and enemy damage sync
  - Added AuthUI login/register screen with offline play option
  - Added MultiplayerSystem client with remote player rendering and interpolation
  - Added multiplayer lobby UI with room creation, joining, browsing, and chat
  - Added leaderboard and progress save/load API endpoints
- March 2026: Massive feature expansion
  - Added cell-shading ink outline post-processing (Sobel edge detection on depth+normals)
  - Added DBZ Kakarot-style triple-jump flight system (3 jumps = sky launch, then free flight)
  - Added ArmorCapsuleSystem with laboratory building and 6 upgrade tiers
  - Added ShopSystem with 3 shop types and buy/sell mechanics
  - Added AnimationSystem with procedural character animations for all states
  - Added BuildingSystem with Minecraft-style mining and building
  - Added 4 new biomes: Mountains (N), Jungle (E), Desert (S), Junkyard Robot City (W)
  - Each biome has temples, villages, and hidden secrets
  - Added Commander enemy type with flight, dodge, and rooftop spawning
  - Added CommanderOmega robot preset
  - Enhanced GameUI with flight mode, armor energy, shop UI, capsule UI, build mode indicators
  - Created Docs/DEVELOPERS_GUIDE.md comprehensive developer documentation
  - Brightness boost on materials for enhanced cell-shading look
- February 2026: New combat & progression systems
- February 2026: Environment expansion
- February 2026: Major systems upgrade
- December 2024: Initial implementation
