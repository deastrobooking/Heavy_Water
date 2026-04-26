# Detroit 3026: The First Attack

## Overview
Detroit 3026 is a 3D futuristic sci-fi action game built with Babylon.js, set in Detroit in the year 3026. The game features anime-style cell-shaded graphics, immersive combat, DBZ-style flight, open-world biomes, and an explorable cityscape. The core objective is to defend Detroit from an invasion of insane hybrid organoids (AI fused with human and tardigrade DNA). The project aims to deliver a rich, engaging experience with deep exploration, dynamic combat, and robust progression systems, including character customization, crafting, and base building.

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground
- Communication: Concise updates; documentation must always reflect changes.

## System Architecture

### Core Systems
The game uses an EventBus for decoupled communication and a generic StateMachine for managing entity behaviors. A unified DamageSystem handles all combat calculations.

### Player Systems
The PlayerController manages a humanoid character with extensive state machines for movement, combat, and a triple-jump flight system with free flight mode. The camera is third-person: it orbits 6.5 units behind the player at 2.2 units of vertical lift, follows the mouse-look yaw, and the body smoothly rotates to face the camera direction (frame-rate independent exponential damping at rate 12) so movement always reads forward on-screen. PlayerController exposes `getAimOrigin()` (head-height world position), which all weapon/combat systems use as the projectile/melee spawn origin via a `setAimOriginProvider(fn)` hook — this keeps shots originating from the player rather than the camera 6.5u behind. BabylonEngine's FreeCamera has its built-in WASD bindings cleared (keysUp/Down/Left/Right empty, speed 0) so it does not contend with PlayerController's movement input. The HumanoidCharacter system allows for procedural generation of character meshes, modular body parts, clothing, and customizable colors. The AnimationSystem provides procedural, multi-part character animations with smooth blending. A CharacterEditor, accessible from the main menu, allows players to customize body parameters, modular armor (from a data-driven registry of parametric parts), and colors, with changes persisting via local storage.

### Robot Armor System
The ArmorMaterialFactory produces reusable material types for consistent aesthetics. The RobotArmorParts system defines a data-driven registry of parametric armor parts, and the RobotArmorSystem equips these parts to humanoid rigs, handling mirroring and clean disposal. Player armor customization is integrated with this system.

### Combat, Inventory & Crafting
Combat involves light and heavy melee combo chains with input buffering. An InventorySystem provides a 24-slot grid. The CraftingSystem supports recipe-based crafting for weapons, armor, and base components.

### Building & Prefab Systems
The BuildingSystem offers Minecraft-style mining and building with 19 block types, grid-snapped placement, and a live GridMaterial overlay. The PrefabSystem allows players to place pre-designed structures (e.g., watchtowers, houses, city blocks) using the same material factory as the armor system, also with grid-snapped placement. Both systems are serialized by the LevelSerializer for saving and loading.

### Commerce & Companion Systems
A ShopSystem manages 5 shop locations with dynamic pricing. The GardenSystem and CompanionSystem manage digital companions, including healing and combat types, with leveling and bonding mechanics. A MapSystem provides a real-time minimap.

### Enemy Systems & Robot Generation
The EnemySystem features a wave spawner for 6 distinct enemy types, including Commanders with advanced AI and flight. The Robot Shape Engine (RobotDesigner/Factory) is a data-driven system for generating all robots (enemies, allies, pets) with extensive parametric descriptors for visual styles, including new features like arm cannons, rounded boots, wheels, and engine blocks. Reusable themes (e.g., transformer, mega-man, hybrid) allow for quick styling.

### Environment & World
A CityGenerator creates a massive 1200x1200 open world with a central city and four distinct biomes (Mountains, Jungle, Desert, Junkyard Robot City), featuring temples, villages, and sky cities.

### Sky & Day/Night System
SkySystem renders a custom-shader gradient skybox (zenith ↔ horizon blend, sun disc + halo, twinkling stars at night) and drives a full day/night cycle. Time of day flows through midnight → dawn → day → dusk palettes with smoothly interpolated sky, sun direction/intensity/color, ambient color, fog color, and scene clear color. Configurable seconds-per-day cycle (default 300s = 5 min real time), `setTimeOfDay(hours)`, pause/resume, and weather modes (`clear`/`overcast`/`storm`) that adjust fog density and overcast tint. Skybox follows the camera so the world feels infinite. The previous static `clearColor`/fog values in BabylonEngine are now driven each frame by SkySystem. To prevent shared materials from drifting brighter over time, `BabylonEngine.boostMaterialBrightness` now uses a WeakSet so each material is boosted at most once.

### Multiplayer
A MultiplayerSystem provides client-side WebSocket integration for real-time multiplayer, supporting room management, position synchronization, chat, and enemy damage syncing for up to 4 players.

### Effects & UI
An EffectsSystem drives transient visual effects (sparkles, captures, level-ups). The UI includes an AuthUI, a GameUI with HUD, shop interfaces, upgrade interfaces, a multiplayer lobby, and a contextual build hotbar. A MainMenu provides game start and character customization options.

### Technical Details
The game uses Babylon.js v8.x for WebGL rendering, with a cell-shaded anime aesthetic, ink outlines, bloom, chromatic aberration, and FXAA. The frontend is built with React, TypeScript, and Vite, while the backend uses Express.js. The architecture is event-driven with FSM-based entity states.

## External Dependencies
- **PostgreSQL**: Primary database with Drizzle ORM.
- **Passport.js**: User authentication with local strategy and scrypt hashing.
- **Express-session with connect-pg-simple**: Persistent session management.
- **ws library**: WebSocket server for multiplayer.