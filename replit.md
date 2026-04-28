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

**Sabre specials (one-time SPECIALS-tab unlocks):**
- **Spinning Blade** — `hasSpinAttack`. Hold Y/J for ~0.5 s and release to perform a 360° spin AoE (12 m radius, 2× damage, 2× cooldown). Short tap still fires a normal slash.
- **Twin Wave** — `hasTwinWave`. Every arc wave is shadowed by a much larger trailing red wave for double coverage.
- **Giant Blade** — `hasGiantBlade`. Sabre mesh scales 1.6×, slash hit radius and damage gain +50%, deeper red glow on the blade and arc waves.
The unlock API is `unlockSpinAttack()` / `unlockTwinWave()` / `unlockGiantBlade()` plus `startCharge()` / `releaseCharge()` for hold-to-spin input.

### Music and Sound
A singleton MusicSystem manages dynamic music loading, playback, and includes an in-game UI. Game music auto-pauses on death (one-shot guard `deathHandledRef` so the per-frame death check doesn't repeatedly pause) and resumes from `handleRestart` via `MusicSystem.startGameMusic()`.

### Vehicles
A parametric vehicle pipeline generates ATVs and space fighters. VehicleFactory builds meshes, and VehicleSystem manages instances and physics for ground and aerial vehicles, including respawn. The factory's `matCacheByScene` is keyed per Babylon scene (with a `clearVehicleMaterialCache(scene)` hook called from `VehicleSystem.dispose`) so cached materials never outlive their scene — fixes the "transparent vehicles after death+restart" bug.

### Loot and Pickups
The PickupSystem spawns physical glowing world meshes from defeated enemies, which magnetize towards the player for collection. Drop tables are enemy-specific. **Drop rates are doubled** vs. the original baseline so progression keeps up with the new high-cost specials. The optional **Auto-Loot Drones** SPECIALS unlock turns every active companion into a secondary collector — `setCompanionPositionsProvider(fn)` feeds live companion positions and `setAutoLootEnabled(true)` extends both magnet (×1.4) and collect (×1.6) radii to the nearest companion as well as the player.

### Upgrades and Progression
WeaponsSystem implements per-weapon level progression. The CompanionSystem manages companion upgrades — including a separate per-companion **weapon tier** (`weaponLevel` 0–3) that scales `attackCooldown ÷ (1 + 0.4·wl)` and `damage × (1 + 0.6·wl)` independently of the base companion `level`. The in-game UpgradeMenu now has four tabs: **PLAYER**, **WEAPONS**, **ROBOTS** (with a HELPER WEAPONS row per active companion), and **SPECIALS** (one-time premium unlocks: Spinning Blade, Twin Wave, Giant Blade, Auto-Loot Drones, Robot Dragon).

### Base Structures
The BaseSystem tracks player-placed, multi-level structures like labs (controlling companion roster and blueprints) and gardens (controlling capture roster and bonuses). These have interactive UIs.

### Building and Prefab Systems
The BuildingSystem enables Minecraft-style mining and building with grid-snapped placement. The PrefabSystem allows placing pre-designed structures, with both supporting serialization.

### Commerce and Companions
A ShopSystem manages 5 shop locations with dynamic pricing. The GardenSystem and CompanionSystem manage digital companions with leveling and bonding. A MapSystem provides a real-time minimap. Companions are aggressive assistants — combat allies engage at 32m range with ~0.85s cooldowns and faster, larger projectiles. Even MedicDrones now contribute light support fire while healing. The premium **Robot Dragon** ally (`RoboDragon` hybrid preset, scale 1.6, winged with cannons) is gated behind a SPECIALS-tab unlock and bumps the companion cap by 1 if the lab is full so it always slots in.

### Enemy Systems
The EnemySystem features a wave spawner for distinct enemy types, including Commanders. The Robot Shape Engine generates all robots (enemies, allies, pets) using parametric descriptors. Aerial enemies (fighters, battleships, Fortresses) have specialized behaviors and are initially passive, engaging upon player aggression towards any aerial unit or enemy base. Aerial unit shots are line-of-sight tested against city buildings. Hostile Enemy Bases include turrets and destructible loot vaults. **Flying Fortresses** use a 5-minute regroup lockout (`FORTRESS_REGROUP_SECONDS = 300`) — once the player wipes out every fortress, none respawn until the timer elapses (a `FLYING FORTRESSES ROUTED — REGROUPING` UI message announces it). Fighters and battleships continue to drip-spawn during the lockout (when aggro).

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