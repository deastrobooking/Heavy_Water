# Heavy Water

## Overview
Heavy Water is a 3D futuristic sci-fi action game developed using Babylon.js. It is set in a far-future Detroit and features anime-style cell-shaded graphics. The game offers immersive ground and aerial combat, DBZ-style flight mechanics, open-world biomes, and an explorable cityscape. The primary goal is to defend the city from an invasion of insane hybrid organoids, encompassing both ground swarms and hostile aerial forces like battleships and fighters. The project aims to deliver a rich, engaging experience with deep exploration, dynamic combat, and robust progression systems, including character customization, crafting, and base building.

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground
- Communication: Concise updates; documentation must always reflect changes.

## System Architecture

### Core Systems
The game architecture relies on an EventBus for decoupled communication and a generic StateMachine for managing entity behaviors. A unified DamageSystem handles all combat calculations. Babylon.js v8.x is used for WebGL rendering, implementing a cell-shaded anime aesthetic with ink outlines, bloom, chromatic aberration, and FXAA. The frontend is built with React, TypeScript, and Vite.

### Player and Character Systems
The PlayerController manages humanoid characters with extensive state machines for movement, combat, and a triple-jump flight system with a free-flight mode. The camera supports both first-person and third-person views. The HumanoidCharacter system enables procedural generation, modular body parts, clothing, and customizable colors. An AnimationSystem provides procedural, multi-part character animations with smooth blending. A CharacterEditor allows player customization.

### Robot and Armor Systems
The ArmorMaterialFactory produces reusable material types. The RobotArmorParts system provides a data-driven registry of parametric armor parts, which the RobotArmorSystem equips to humanoid rigs, handling mirroring and disposal.

### Combat, Inventory, and Crafting
Combat features light and heavy melee combo chains with input buffering. An InventorySystem offers a 24-slot grid. The CraftingSystem supports recipe-based crafting for weapons, armor, and base components. All ranged weapons have unlimited ammo.

### Music and Sound
A singleton MusicSystem manages menu and in-game music, supporting dynamic track loading and playback controls. It includes an in-game UI (MusicPlayerUI) with track selection, volume control, and keyboard shortcuts.

### Vehicles
A parametric vehicle pipeline, similar to the robot pipeline, allows for defining and generating ATVs and space fighters with customizable styles and parts. VehicleFactory builds primitive-only meshes, and VehicleSystem manages vehicle instances and physics for both ground and aerial vehicles, including a respawn mechanism.

### Loot and Pickups
The PickupSystem spawns physical glowing world meshes from defeated enemies, which magnetize towards the player and trigger collection events. Drop tables are enemy-specific.

### Upgrades and Progression
The WeaponsSystem implements per-weapon level progression, boosting damage, fire rate, and impact. The CompanionSystem manages companion upgrades for health, damage, and speed. An in-game UpgradeMenu provides the interface for these upgrades.

### Base Structures
The BaseSystem tracks player-placed, multi-level base structures like labs and gardens. Lab levels control companion roster caps and unlock robot blueprints, while Garden levels control capture roster caps and capture bonus chances. These structures have interactive UIs, including a LabUI for building robots and a GardenCaptureUI for managing captured bio-creatures.

### Building and Prefab Systems
The BuildingSystem facilitates Minecraft-style mining and building with various block types and grid-snapped placement. The PrefabSystem enables placing pre-designed structures, with both systems supporting serialization via the LevelSerializer.

### Commerce and Companions
A ShopSystem manages 5 shop locations with dynamic pricing. The GardenSystem and CompanionSystem manage digital companions with leveling and bonding mechanics. A MapSystem provides a real-time minimap.

### Enemy Systems
The EnemySystem features a wave spawner for distinct enemy types, including Commanders with advanced AI. The Robot Shape Engine is a data-driven system for generating all robots (enemies, allies, pets) using parametric descriptors and reusable themes. This includes aerial enemies like fighters and battleships, with specialized behaviors, health bars, and loot drops. Hostile Enemy Bases are strategically seeded, featuring turrets and a destructible loot vault.

### Resource Nodes
The MiningSystem scatters destructible glowing resource nodes across the open world, providing resources upon destruction and respawning after a delay.

### Player Progress and Persistence
ProgressSync.ts handles saving and loading player progress to a database, including stats, weapon levels, inventory, and captured creatures. Auto-save occurs periodically and on key game events, ensuring progression is preserved. A "friendly respawn" mechanism allows players to revive at a default location after death without losing progress, enhancing multiplayer-friendliness.

### Environment and World
A CityGenerator creates a massive 1200x1200 open world featuring a central city and four distinct biomes. The SkySystem renders a custom-shader gradient skybox and drives a full day/night cycle, interpolating environmental lighting and fog, and supports weather modes.

### Multiplayer
A MultiplayerSystem provides client-side WebSocket integration for real-time multiplayer, supporting room management, position synchronization, chat, and enemy damage syncing for up to 4 players.

### Input and UI
GamepadInput provides seamless controller integration by synthesizing keyboard/mouse/pointer events. The EffectsSystem drives transient visual effects for combat feedback. The UI includes a redesigned HUD with prominent health/armor displays, an AuthUI, GameUI, shop interfaces, upgrade interfaces, a multiplayer lobby, a contextual build hotbar, and a MainMenu with character customization options. An EnemyHealthBarSystem renders HTML overlays for active enemies and objects like mining nodes and enemy base turrets/vaults. Player base health and armor have been significantly increased.

## External Dependencies
- **PostgreSQL**: Primary database with Drizzle ORM.
- **Passport.js**: User authentication with local strategy and scrypt hashing.
- **Express-session with connect-pg-simple**: Persistent session management.
- **ws library**: WebSocket server for multiplayer.