# Heavy Water

## Overview
Heavy Water is a 3D futuristic sci-fi action game developed with Babylon.js, set in a far-future Detroit. It features anime-style cell-shaded graphics, offering immersive ground and aerial combat, DBZ-style flight mechanics, and open-world exploration. The game's core purpose is to defend the city from an invasion of insane hybrid organoids, encompassing both ground swarms and hostile aerial forces. Key capabilities include deep exploration, dynamic combat, character customization, crafting, and base building, aiming to deliver a rich and engaging player experience. The business vision is to target the niche market of anime-style sci-fi game enthusiasts.

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground
- Communication: Concise updates; documentation must always reflect changes.

## System Architecture
The game uses an EventBus for decoupled communication and a generic StateMachine for entity behaviors. A unified DamageSystem handles combat calculations. Babylon.js v8.x provides WebGL rendering with a cell-shaded anime aesthetic, including ink outlines, bloom, chromatic aberration, and FXAA. The frontend is built with React, TypeScript, and Vite.

A unified `ExplosionSystem` (subscribes to `effect:explosion` and `enemy:killed`) replaces all per-system one-off explosion code that used to live in WeaponsSystem, SpecialWeaponsSystem and MegaBeamCannonSystem. It uses pooled meshes/lights (16 cores, 16 glows, 12 rings, 96 debris boxes, 6 lights), tiered presets (small/medium/large with auto-pick from radius), debris ballistics with gravity, optional ground shockwave ring, and routes camera-shake + lingering smoke through the existing EffectsSystem. All callers emit the event; nothing else allocates explosion meshes per detonation.

`BabylonEngine.create(canvas)` is an async factory that picks the best supported renderer. WebGPU is opt-in via `localStorage["heavywater:webgpu"] = "1"`; on success it spins up `BABYLON.WebGPUEngine` (with `await initAsync()`), otherwise — and on any WebGPU failure — it transparently falls back to the classic WebGL2 `BABYLON.Engine`. The engine field is typed `BABYLON.AbstractEngine` so both backends share the same call sites. The custom GLSL-ES-1.0 cell-shading outline post-process is skipped on WebGPU until it's ported to WGSL; bloom, FXAA, chromatic aberration, sharpen and the rest of the DefaultRenderingPipeline work on both backends. The selected backend is logged at startup. A `GameplayGuide` modal (opened from the main-menu `GUIDE` button next to `CUSTOMIZE`) documents controls, combos, elemental keys, capture, music, and the WebGPU toggle. The same content lives in `GAMEPLAY_GUIDE.md` at the project root.

Player characters feature complex state machines for movement, combat, and a triple-jump flight system, including Rocket Skates and a Boost Dash. Character customization includes procedural generation, modular body parts, and a HumanoidCharacter system with specific armor pipeline (e.g., tapered frustum chest plate, wedge boot, Humanoid Blaster).

Combat features melee combo chains, input buffering, elemental casting with 6 elements (Tracking Strikes, Dome Explosions), and a Beam Sabre with wide slashes and special unlocks. Beam-sabre combos: LT+RT fires the Mega Beam Cannon (homing missiles + Kamehameha laser), LT+Y triggers Fury Slash (5 rapid large slashes), and LT+X triggers Smash Lash (single heavy smash + 12 energy waves radiating omnidirectionally). Keyboard equivalents: `;` (Semicolon) = Fury, `'` (Quote) = Smash. Both specials preempt any in-flight regular slash triggered by the LT key one frame earlier so LT-then-face-button input order works reliably. Ranged weapons have unlimited ammo. The InventorySystem offers a 24-slot grid, and the CraftingSystem supports recipe-based crafting.

Vehicles (ATVs and space fighters) are generated parametrically, with a VehicleFactory and VehicleSystem managing instances and physics. Loot and Pickups are handled by a PickupSystem with enemy-specific drop tables. Progression includes per-weapon leveling, companion upgrades, and a comprehensive UpgradeMenu.

The BaseSystem and BuildingSystem enable player-placed, multi-level structures with grid-snapped placement, supporting serialization via a PrefabSystem. A ShopSystem manages commerce, while the GardenSystem and CompanionSystem manage digital companions (including MedicDrones and a premium Robot Dragon ally). A MapSystem provides a real-time minimap.

The Bio-Creature Dex defines 125+ collectible robotic-Pokemon-style creatures with archetypes, elemental types, and rarity tiers, spawning rarity-weighted across the world.

Enemy systems include a wave spawner, Commander enemies, aerial enemies, Hostile Enemy Bases with turrets, and Boss Fortresses with unique boss variants. The LevelSystem defines four world levels: three combat fronts (Star City, Hold the Line, Purge the Void) plus Level 4 "Ashur Sanctuary" — a peaceful side-zone (`peaceful: true`, spawnPoint -480/-480, fortressCenter parked at 9999/9999) that suppresses fortress seeding and wave bumps in the LEVEL_STARTED handler. Players warp between any of the four zones from the new TRAVEL tab on the TAB upgrade-menu (calls `LevelSystem.forceStart` and teleports to the destination's `spawnPoint`); the menu shows current/locked badges and a single WARP button per row. Destructible glowing resource nodes are scattered by the MiningSystem.

The Ashur Sanctuary itself is owned by `SanctuarySystem`, mounted on entering level 4 and disposed on leaving. It builds a wooden signpost (DynamicTexture-painted lore text), a perimeter ring, three sanctuary NPCs (Theta, Sergio Wolfrim, Ion) spawned through reflection on `FriendlyNPCSystem.spawnNPC`, and an internal 5-plot `FarmingSystem` (4 stages, 30s per stage). Pressing E within range plants a `bio_seed` from the player inventory; harvesting a fully-grown plot yields a `bio_crop`. New inventory items `bio_seed`, `bio_crop`, `animaton_feed` live in InventorySystem; the player is gifted 5 starter `bio_seed`s on first sanctuary entry.

Procedural alien foliage is generated using an L-system, scattering decorative plants across the wilderness. A MountainRingSystem builds a ring of 9 mountain ranges, while four stepped-pyramid hidden temples offer level-scaled rare-item bundles and spawn guardian creatures upon interaction.

Player progress and persistence (stats, inventory, upgrades) are handled by ProgressSync.ts with auto-save functionality.

The game world is a 1200x1200 open world with a central city and four biomes, generated by a CityGenerator. A SkySystem renders a custom-shader gradient skybox, day/night cycle, and weather. Buildings have accessible interiors, and a sky racetrack is integrated.

A MultiplayerSystem provides client-side WebSocket integration for up to 16 players per room, supporting room management, synchronization, chat, and enemy damage syncing. The cap is set in `server/multiplayer.ts` (room.maxPlayers) — 16 keeps the naive broadcast (every player's 50 ms position update fanned out to every other player) at ~4 800 msgs/sec/room, the safe ceiling before spatial culling / delta encoding would be needed. FriendlyNPCSystem scatters NPCs that introduce game systems via interactive dialogue.

GamepadInput provides seamless controller integration with context-aware triggers. The EffectsSystem drives visual effects. The UI includes a redesigned HUD, AuthUI, GameUI, shop interfaces, upgrade interfaces, multiplayer lobby, contextual build hotbar, MainMenu with character customization, and an EnemyHealthBarSystem for HTML overlays.

## External Dependencies
- **PostgreSQL**: Primary database with Drizzle ORM.
- **Passport.js**: User authentication with local strategy and scrypt hashing.
- **Express-session with connect-pg-simple**: Persistent session management.
- **ws library**: WebSocket server for multiplayer.