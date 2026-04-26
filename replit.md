# Detroit 3026: The First Attack

## Overview
Detroit 3026 is a 3D futuristic sci-fi action game built with Babylon.js. Set in Detroit in the year 3026, it features anime-style cell-shaded graphics, immersive combat, DBZ-style flight, open-world biomes, and an explorable cityscape. The game's core objective is to defend Detroit from an invasion of insane hybrid organoids (AI fused with human and tardigrade DNA). The project aims to deliver a rich, engaging experience with deep exploration, dynamic combat, and robust progression systems, including character customization, crafting, and base building.

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground
- Communication: Concise updates; documentation must always reflect changes.

## System Architecture

### Core Systems
The game uses an EventBus for decoupled communication and a generic StateMachine for managing entity behaviors. A unified DamageSystem handles all combat calculations. The game utilizes Babylon.js v8.x for WebGL rendering, with a cell-shaded anime aesthetic, ink outlines, bloom, chromatic aberration, and FXAA. The frontend is built with React, TypeScript, and Vite.

### Player Systems
The PlayerController manages a humanoid character with extensive state machines for movement, combat, and a triple-jump flight system with free flight mode. The camera supports both first-person and third-person modes. The HumanoidCharacter system allows for procedural generation, modular body parts, clothing, and customizable colors. The AnimationSystem provides procedural, multi-part character animations with smooth blending. A CharacterEditor allows players to customize their character.

### Robot Armor System
The ArmorMaterialFactory produces reusable material types. The RobotArmorParts system defines a data-driven registry of parametric armor parts, and the RobotArmorSystem equips these to humanoid rigs, handling mirroring and disposal.

### Combat, Inventory & Crafting
Combat features light and heavy melee combo chains with input buffering. An InventorySystem provides a 24-slot grid. The CraftingSystem supports recipe-based crafting for weapons, armor, and base components. All ranged weapons have unlimited ammo.

### Vehicles (ATV + Space Fighter)
A parametric vehicle pipeline, similar to the robot pipeline, allows for defining and generating ATVs and space fighters with customizable styles and parts. VehicleFactory builds primitive-only meshes, and VehicleSystem manages vehicle instances and physics for both ground and aerial vehicles.

### Loot Drops & Pickups
The PickupSystem spawns physical glowing world meshes when enemies die, which magnetize towards the player and emit `PICKUP_COLLECTED` events upon collection. Drop tables vary by enemy type.

### Weapon & Companion Upgrades
The WeaponsSystem implements per-weapon level progression, boosting damage, fire rate, and impact. The CompanionSystem manages companion upgrades for health, damage, and speed. An in-game UpgradeMenu provides an interface for these upgrades.

### Base Structures (Lab + Garden)
The BaseSystem tracks player-placed base structures (lab, garden) with multiple levels. Lab level controls companion roster cap and unlocks robot blueprints; Garden level controls capture roster cap and capture bonus chance. These structures have interactive UIs.

### Lab UI (Build Robots)
The LabUI displays robot blueprints across different tiers. Players can build companions by spending resources.

### Bio Creature Capture & Garden UI
The BioCreatureSystem defines wandering bio-robotic species. Players can attempt to capture these creatures, which are then managed by the GardenCaptureUI and can be deployed as companions.

### Building & Prefab Systems
The BuildingSystem offers Minecraft-style mining and building with various block types and grid-snapped placement. The PrefabSystem allows placing pre-designed structures, both serialized by the LevelSerializer.

### Commerce & Companion Systems
A ShopSystem manages 5 shop locations with dynamic pricing. The GardenSystem and CompanionSystem manage digital companions with leveling and bonding mechanics. A MapSystem provides a real-time minimap.

### Enemy Systems & Robot Generation
The EnemySystem features a wave spawner for distinct enemy types, including Commanders with advanced AI. The Robot Shape Engine is a data-driven system for generating all robots (enemies, allies, pets) with extensive parametric descriptors and reusable themes.

### Environment & World
A CityGenerator creates a massive 1200x1200 open world with a central city and four distinct biomes.

### Sky & Day/Night System
The SkySystem renders a custom-shader gradient skybox and drives a full day/night cycle, smoothly interpolating sky, sun direction/intensity/color, ambient color, fog color, and scene clear color. It also supports weather modes.

### Multiplayer
A MultiplayerSystem provides client-side WebSocket integration for real-time multiplayer, supporting room management, position synchronization, chat, and enemy damage syncing for up to 4 players.

### Controller Support (Gamepad)
GamepadInput polls connected gamepads and synthesizes existing keyboard/mouse/pointer events, providing seamless controller integration without requiring game-specific branches.

### Effects & UI
An EffectsSystem drives transient visual effects. The UI includes an AuthUI, a GameUI with HUD, shop interfaces, upgrade interfaces, a multiplayer lobby, and a contextual build hotbar. A MainMenu provides game start and character customization options. EnemyHealthBarSystem renders HTML overlays for active enemies.

## External Dependencies
- **PostgreSQL**: Primary database with Drizzle ORM.
- **Passport.js**: User authentication with local strategy and scrypt hashing.
- **Express-session with connect-pg-simple**: Persistent session management.
- **ws library**: WebSocket server for multiplayer.