# Heavy Water

## Overview
Heavy Water is a 3D futuristic sci-fi action game developed with Babylon.js, set in a far-future Detroit. It features anime-style cell-shaded graphics, offering immersive ground and aerial combat, DBZ-style flight mechanics, and open-world exploration. The game's core purpose is to defend the city from an invasion of insane hybrid organoids, encompassing both ground swarms and hostile aerial forces. Key capabilities include deep exploration, dynamic combat, character customization, crafting, and base building, aiming to deliver a rich and engaging player experience.

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground
- Communication: Concise updates; documentation must always reflect changes.

## System Architecture

### Core Systems
The game uses an EventBus for decoupled communication and a generic StateMachine for entity behaviors. A unified DamageSystem handles combat calculations. Babylon.js v8.x provides WebGL rendering with a cell-shaded anime aesthetic, including ink outlines, bloom, chromatic aberration, and FXAA. The frontend is built with React, TypeScript, and Vite.

### Player and Character Systems
PlayerController manages humanoid characters with complex state machines for movement, combat, and a triple-jump flight system with free-flight. Camera supports first-person and third-person views. The HumanoidCharacter system enables procedural generation, modular body parts, and customization. An AnimationSystem provides procedural, multi-part animations. The CharacterEditor allows player customization. Shield, stamina, and cooldown timers are persistent. A Boost Dash provides i-frames and a short burst of speed, with specific integration for a "dash → slash" combo.

**Rocket Skates**: Holding sprint (ShiftLeft) for ≥2 seconds engages "rocket skate" mode — top speed jumps from 0.55 → 1.0, ground movement uses vehicle-like lerped momentum (lerp 0.14) for a smooth driving feel, and stamina drain is reduced to 40% so the mode can be sustained over long traversal. Releasing sprint (or running out of stamina / stopping) instantly stows the skates. UI_MESSAGE events announce engage/stow.

### Robot and Armor Systems
The ArmorMaterialFactory creates reusable materials. RobotArmorParts provides a data-driven registry of parametric armor parts, equipped to humanoid rigs by the RobotArmorSystem.

### Combat, Inventory, and Crafting
Combat features melee combo chains and input buffering. The InventorySystem offers a 24-slot grid. The CraftingSystem supports recipe-based crafting. Ranged weapons have unlimited ammo. The Hunter Missile (`tracking_missile`) is a homing projectile weapon with AoE damage.

### Elemental Specials
A 6-element casting system operates parallel to weapons:
- **Tracking Strikes**: Lightning Strike, Ice Strike, Fireball (homing).
- **Dome Explosions**: Flame Inferno, Windstorm, Psychic Shockwave (centered on player).
Each elemental has independent cooldowns and levels (1-5), scaling damage, radius, and target count. A `currentIndex` system allows cycling and casting selected elementals via dedicated keys or controller input.

### Beam Sabre
The Beam Sabre is always equipped — pressing Y (keyboard) or controller-Y triggers a wide cross-screen slash with a long blade and extended reach (hit radius 7). It performs multi-hit slash combos and launches arc-shaped (crescent) energy waves forward. Damage scales with level, and level-5 waves pierce and apply AoE splash. The "boost-dash → slash" chain (L → J within 600ms) instantly fires an arc wave for the signature combo.

### Music and Sound
A singleton MusicSystem manages dynamic music loading, playback, and includes an in-game UI.

### Vehicles
A parametric vehicle pipeline generates ATVs and space fighters. VehicleFactory builds meshes, and VehicleSystem manages instances and physics for ground and aerial vehicles, including respawn.

### Loot and Pickups
The PickupSystem spawns physical glowing world meshes from defeated enemies, which magnetize towards the player for collection. Drop tables are enemy-specific.

### Upgrades and Progression
WeaponsSystem implements per-weapon level progression. The CompanionSystem manages companion upgrades. An in-game UpgradeMenu provides the interface.

### Base Structures
The BaseSystem tracks player-placed, multi-level structures like labs (controlling companion roster and blueprints) and gardens (controlling capture roster and bonuses). These have interactive UIs.

### Building and Prefab Systems
The BuildingSystem enables Minecraft-style mining and building with grid-snapped placement. The PrefabSystem allows placing pre-designed structures, with both supporting serialization.

### Commerce and Companions
A ShopSystem manages 5 shop locations with dynamic pricing. The GardenSystem and CompanionSystem manage digital companions with leveling and bonding. A MapSystem provides a real-time minimap. Companions are aggressive assistants — combat allies engage at 32m range with ~0.85s cooldowns and faster, larger projectiles. Even MedicDrones now contribute light support fire while healing.

### Enemy Systems
The EnemySystem features a wave spawner for distinct enemy types, including Commanders. The Robot Shape Engine generates all robots (enemies, allies, pets) using parametric descriptors. Aerial enemies (fighters, battleships, Fortresses) have specialized behaviors and are initially passive, engaging upon player aggression towards any aerial unit or enemy base. Aerial unit shots are line-of-sight tested against city buildings. Hostile Enemy Bases include turrets and destructible loot vaults.

### Resource Nodes
The MiningSystem scatters destructible glowing resource nodes that respawn after a delay.

### Player Progress and Persistence
ProgressSync.ts handles saving and loading player progress to a database, including stats, weapon levels, inventory, and captured creatures. Auto-save occurs periodically and on key game events. A "friendly respawn" mechanism allows revival without progress loss.

### Environment and World
A CityGenerator creates a 1200x1200 open world with a central city and four biomes. The SkySystem renders a custom-shader gradient skybox, a day/night cycle, and weather modes. Buildings are hollow shells with accessible interiors and ramps for tall structures. Wall AABBs are exposed for collision detection. Driveable height data is provided for ground vehicles. A sky racetrack ring (radius 280, y=80) encircles downtown with **four cardinal-direction connection ramps (N/E/S/W)** so players and vehicles can roll onto the track from any approach. Ramp geometry is built by the `addRacetrackRamp` helper using composed yaw + pitch quaternions; `getDriveableHeight` samples each ramp analytically by projecting (x,z) onto the ramp's low→high axis.

### Multiplayer
A MultiplayerSystem provides client-side WebSocket integration for real-time multiplayer, supporting room management, position synchronization, chat, and enemy damage syncing for up to 4 players.

### Input and UI
GamepadInput provides seamless controller integration. The EffectsSystem drives transient visual effects. The UI includes a redesigned HUD, AuthUI, GameUI, shop interfaces, upgrade interfaces, multiplayer lobby, contextual build hotbar, and MainMenu with character customization. An EnemyHealthBarSystem renders HTML overlays for active enemies and objects.

### Controller Mapping
The game features comprehensive Xbox-style controller mapping for all core actions, including movement, interaction, combat, elemental casting, and menu navigation. Specific mappings are provided for boosting, dashing, elemental cycling, weapon cycling, and a signature dash-slash combo.

## External Dependencies
- **PostgreSQL**: Primary database with Drizzle ORM.
- **Passport.js**: User authentication with local strategy and scrypt hashing.
- **Express-session with connect-pg-simple**: Persistent session management.
- **ws library**: WebSocket server for multiplayer.