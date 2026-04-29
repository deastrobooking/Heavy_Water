# Heavy Water

## Overview
Heavy Water is a 3D futuristic sci-fi action game developed with Babylon.js, set in a far-future Detroit. It features anime-style cell-shaded graphics, offering immersive ground and aerial combat, DBZ-style flight mechanics, and open-world exploration. The game's core purpose is to defend the city from an invasion of insane hybrid organoids, encompassing both ground swarms and hostile aerial forces. Key capabilities include deep exploration, dynamic combat, character customization, crafting, and base building, aiming to deliver a rich and engaging player experience with business vision to target the niche market of anime-style sci-fi game enthusiasts.

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground
- Communication: Concise updates; documentation must always reflect changes.

## System Architecture

### Core Systems
The game uses an EventBus for decoupled communication and a generic StateMachine for entity behaviors. A unified DamageSystem handles combat calculations. Babylon.js v8.x provides WebGL rendering with a cell-shaded anime aesthetic, including ink outlines, bloom, chromatic aberration, and FXAA. The frontend is built with React, TypeScript, and Vite.

### Player and Character Systems
PlayerController manages humanoid characters with complex state machines for movement, combat, and a triple-jump flight system with free-flight. Walk / sprint speeds are tuned at **0.34 / 0.62** (slightly bumped for snappier feel). Camera supports first-person and third-person views; aim sensitivity is set via `camera.angularSensibility = 2300` on `BabylonEngine.ts` (15% less twitchy than the previous 2000 default — note `angularSensibility` is INVERSE: bigger = less sensitive). The HumanoidCharacter system enables procedural generation, modular body parts, and customization. An AnimationSystem provides procedural, multi-part animations. The CharacterEditor allows player customization. Shield, stamina, and cooldown timers are persistent. A Boost Dash provides i-frames and a short burst of speed, with specific integration for a "dash → slash" combo. **Rocket Skates** engage after **1.2 s** of sustained on-foot sprinting (lowered from 2.0 s) and use a 0.4-s grace decay so brief sprint interruptions (turning, hitting a curb, weapon tap) no longer reset the charge timer.

### Robot and Armor Systems
The ArmorMaterialFactory creates reusable materials. RobotArmorParts provides a data-driven registry of parametric armor parts, equipped to humanoid rigs by the RobotArmorSystem.

### Combat, Inventory, and Crafting
Combat features melee combo chains and input buffering. The InventorySystem offers a 24-slot grid. The CraftingSystem supports recipe-based crafting. Ranged weapons have unlimited ammo. The Hunter Missile is a homing projectile weapon with AoE damage.

### Elemental Specials
A 6-element casting system operates parallel to weapons, offering Tracking Strikes (Lightning, Ice, Fireball) and Dome Explosions (Flame Inferno, Windstorm, Psychic Shockwave). Each elemental has independent cooldowns and levels (1-5), scaling damage, radius, and target count.

### Beam Sabre
The Beam Sabre is always equipped, featuring wide cross-screen slashes with multi-hit combos and arc-shaped energy waves. Damage scales with level, and level-5 waves pierce and apply AoE splash. Special unlocks include Spinning Blade, Twin Wave, and Giant Blade, enhancing its capabilities.

### Music and Sound
A singleton MusicSystem manages dynamic music loading and playback, with an in-game UI and automatic pausing on player death.

### Vehicles
A parametric vehicle pipeline generates ATVs and space fighters. VehicleFactory builds meshes, and VehicleSystem manages instances and physics for ground and aerial vehicles, including respawn, with careful material caching.

### Loot and Pickups
The PickupSystem spawns physical glowing world meshes from defeated enemies with enemy-specific drop tables and doubled drop rates. Auto-Loot Drones (an unlockable SPECIALS feature) allow companions to assist with collection.

### Upgrades and Progression
The WeaponsSystem implements per-weapon level progression. The CompanionSystem manages companion upgrades, including weapon tiers. The in-game UpgradeMenu features PLAYER, WEAPONS, ROBOTS, and SPECIALS tabs for comprehensive progression.

**Player upgrades** (defined in `PLAYER_UPGRADES` on `PlayerController.ts`) cover both core defensive stats and a second tier of "Armor Mods":
- **Core stats** — `maxHealth`, `maxArmor`, `maxShield` are upgradeable to **level 20** (was 10), `shieldRegenRate` to 8, `shieldRegenDelay` to 5.
- **Armor Mods** — special suit modules that boost weapons + survivability:
  - **Power Core** (`damageBoost`, max 10): +5% weapon damage per level
  - **Pulse Driver** (`fireRateBoost`, max 10): +4% fire rate per level
  - **Aegis Plating** (`damageReduction`, max 10): -3% incoming damage per level (capped at 30%)
  - **Kinetic Cells** (`staminaBoost`, max 5): +15 max stamina per level
  Damage / fire-rate mods are exposed via `PlayerController.getPlayerBoosts()` and pushed to `WeaponsSystem.setPlayerBoosts(...)` on every `PLAYER_UPGRADED` event (and once after ProgressSync load). They stack multiplicatively with the vehicle-mode bonuses inside `fire()` / `createProjectile()`. Aegis Plating is consumed directly inside `takeDamage()` before shield/armor absorption.

### Base Structures
The BaseSystem tracks player-placed, multi-level structures like labs (companion roster, blueprints) and gardens (capture roster, bonuses), each with interactive UIs.

### Building and Prefab Systems
The BuildingSystem enables Minecraft-style mining and building with grid-snapped placement. The PrefabSystem allows placing pre-designed structures, with both supporting serialization.

### Commerce and Companions
A ShopSystem manages 5 shop locations with dynamic pricing, integrating with `PlayerController.stats.credits` for transactions. General shops stock `gear` and `nano_fiber`, and weapon shops stock matching weapon parts. The GardenSystem and CompanionSystem manage digital companions with leveling and bonding. A MapSystem provides a real-time minimap. Companions are aggressive assistants, with MedicDrones providing support fire. The premium Robot Dragon ally is an unlockable SPECIALS feature.

### Enemy Systems
The EnemySystem features a wave spawner for distinct enemy types, including Commanders. The Robot Shape Engine generates all robots. Aerial enemies have specialized behaviors and engage upon player aggression. Hostile Enemy Bases include turrets and destructible loot vaults. Flying Fortresses use a 5-minute regroup lockout. BossCaptain is a humanoid boss enemy mirroring the player's kit, spawned in specific scenarios. The Boss Fortress is a multi-stage objective with turrets, a central command spire vault, and a captured ally.

### Resource Nodes
The MiningSystem scatters destructible glowing resource nodes that respawn after a delay.

### Player Progress and Persistence
ProgressSync.ts handles saving and loading player progress to a database. The snapshot covers stats, weapon levels, inventory, live companion roster (level, weaponLevel), beam sabre level, all SPECIALS unlocks, and elemental specials levels. Auto-save runs every 5 seconds and on key progression events, with a "friendly respawn" mechanism.

### Environment and World
A CityGenerator creates a 1200x1200 open world with a central city and four biomes. The SkySystem renders a custom-shader gradient skybox, a day/night cycle, and weather modes. Buildings are hollow with accessible interiors and ramps. Wall AABBs are exposed for collision. A sky racetrack ring with four cardinal-direction connection ramps is integrated into the cityscape.

### Multiplayer
A MultiplayerSystem provides client-side WebSocket integration for real-time multiplayer, supporting room management, position synchronization, chat, and enemy damage syncing for up to 4 players.

### Friendly NPCs
FriendlyNPCSystem scatters six brightly-coloured humanoid NPCs around the spawn area, each introducing one game system (combat, shops, helper-bot upgrades, rocket skates/sabre/flight, elemental specials, biome/fortress dangers) via interactive dialogue.

### Input and UI
GamepadInput provides seamless controller integration. The EffectsSystem drives transient visual effects. The UI includes a redesigned HUD, AuthUI, GameUI, shop interfaces, upgrade interfaces, multiplayer lobby, contextual build hotbar, and MainMenu with character customization. An EnemyHealthBarSystem renders HTML overlays for active enemies and objects.

### Controller Mapping
The game features comprehensive Xbox-style controller mapping for all core actions, including movement, interaction, combat, elemental casting, and menu navigation.

## External Dependencies
- **PostgreSQL**: Primary database with Drizzle ORM.
- **Passport.js**: User authentication with local strategy and scrypt hashing.
- **Express-session with connect-pg-simple**: Persistent session management.
- **ws library**: WebSocket server for multiplayer.