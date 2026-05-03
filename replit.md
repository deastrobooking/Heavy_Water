# Heavy Water

## Overview
Heavy Water is a 3D futuristic sci-fi action game developed with Babylon.js, set in a far-future Detroit. It features anime-style cell-shaded graphics, offering immersive ground and aerial combat, DBZ-style flight mechanics, and open-world exploration. The game's core purpose is to defend the city from an invasion of insane hybrid organoids, encompassing both ground swarms and hostile aerial forces. Key capabilities include deep exploration, dynamic combat, character customization, crafting, and base building, aiming to deliver a rich and engaging player experience. The business vision is to target the niche market of anime-style sci-fi game enthusiasts.

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground
- Communication: Concise updates; documentation must always reflect changes.

## System Architecture

### Core Systems
The game uses an EventBus for decoupled communication and a generic StateMachine for entity behaviors. A unified DamageSystem handles combat calculations. Babylon.js v8.x provides WebGL rendering with a cell-shaded anime aesthetic, including ink outlines, bloom, chromatic aberration, and FXAA. The frontend is built with React, TypeScript, and Vite.

### Player and Character Systems
PlayerController manages humanoid characters with complex state machines for movement, combat, and a triple-jump flight system. Rocket Skates engage after a short sprint. The HumanoidCharacter system enables procedural generation, modular body parts, and customization. An AnimationSystem provides procedural, multi-part animations. The CharacterEditor shares the same humanoid armor pipeline as the in-game player: it instantiates a `HumanoidCharacter` from `HUMANOID_PRESETS.PlayerDefault` (`visualScale: 0.12`, `armorType: "humanoid"`), equips parts via `equipArmorSet` against `ARMOR_PART_REGISTRY` (which merges the canonical Humanoid parts pack — `helmet_humanoid`, `chest_humanoid`, `shoulder_humanoid`, `arm_humanoid_glove`, `weapon_humanoid_buster`, `legs_humanoid`), and exposes a body-tab Armor Frame selector (humanoid / light / heavy / captain) plus "HUMANOID" / "TITAN" preset buttons that swap `DEFAULT_ARMOR_SET` / `TITAN_ARMOR_SET`. `sanitizeArmorSet` migrates legacy `*_megaman` part ids onto the new `*_humanoid` ids so old saves keep working. Shield, stamina, and cooldown timers are persistent. A Boost Dash provides i-frames and a short burst of speed, with specific integration for a "dash → slash" combo.

### Robot and Armor Systems
The ArmorMaterialFactory creates reusable materials, and RobotArmorParts provides a data-driven registry of parametric armor parts. The Humanoid armor pack (in `HumanoidArmorParts.ts`) is the default frame for the player, offering canonical helmet/chest/shoulder/arm/weapon/leg pieces and is wired into `DEFAULT_ARMOR_SET`. Humanoid visual scale is adjusted to fit collision capsules.

### Combat, Inventory, and Crafting
Combat features melee combo chains and input buffering. The InventorySystem offers a 24-slot grid. The CraftingSystem supports recipe-based crafting. Ranged weapons have unlimited ammo. The Hunter Missile is a homing projectile weapon with AoE damage.

### Elemental Specials
A 6-element casting system operates parallel to weapons, offering Tracking Strikes (Lightning, Ice, Fireball) and Dome Explosions (Flame Inferno, Windstorm, Psychic Shockwave). Each elemental has independent cooldowns and levels (1-5), scaling damage, radius, and target count.

### Beam Sabre
The Beam Sabre is always equipped, featuring wide cross-screen slashes with multi-hit combos and arc-shaped energy waves. Damage scales with level, and level-5 waves pierce and apply AoE splash. Special unlocks include Spinning Blade, Twin Wave, and Giant Blade.

### Mega Beam Cannon (Beam + Weapon Combo)
Pressing the beam attack (Y / J) and the weapon attack (LMB) within ~220ms (or while either is already held) triggers `MegaBeamCannonSystem.fire()` — a single combo special on a 6-second cooldown. The cannon launches **20 self-seeking missiles** in a spiral fan around the aim direction (each homes onto the nearest enemy with strong steering, detonates on contact for AoE damage with falloff) and one **Kamehameha-style high-energy laser**: a 220m × 5m beam built from three coaxial emissive cylinders (white core + cyan halo + soft outer glow) plus a charge-orb muzzle and bright fill point-light. The beam fades + pulses over a 1.4s lifetime and damages each enemy intersecting its ray once for ~1800 damage (routed through the central `routeHit` so it hurts every hit category and engages the aerial squadron). The lone slash and weapon shot still fire alongside it; the cannon adds on top. Wired in `Game.tsx` via `beamPressTimeRef` / `weaponPressTimeRef` / `beamHeldRef` / `weaponHeldRef` against keydown(KeyY|KeyJ) and mousedown(button 0).

### Music and Sound
A singleton MusicSystem manages dynamic music loading and playback, with an in-game UI and automatic pausing on player death.

### Vehicles
A parametric vehicle pipeline generates ATVs and space fighters. VehicleFactory builds meshes, and VehicleSystem manages instances and physics for ground and aerial vehicles, including respawn, with careful material caching.

### Loot and Pickups
The PickupSystem spawns physical glowing world meshes from defeated enemies with enemy-specific drop tables and doubled drop rates. Auto-Loot Drones are an unlockable feature.

### Upgrades and Progression
The WeaponsSystem implements per-weapon level progression. The CompanionSystem manages companion upgrades. The in-game UpgradeMenu features PLAYER, WEAPONS, ROBOTS, and SPECIALS tabs for comprehensive progression. Player upgrades cover core defensive stats and "Armor Mods" that boost weapons and survivability.

### Base Structures and Building
The BaseSystem tracks player-placed, multi-level structures like labs and gardens, each with interactive UIs. The BuildingSystem enables Minecraft-style mining and building with grid-snapped placement. The PrefabSystem allows placing pre-designed structures, with both supporting serialization.

### Commerce and Companions
A ShopSystem manages 5 shop locations with dynamic pricing. The GardenSystem and CompanionSystem manage digital companions with leveling and bonding. A MapSystem provides a real-time minimap. Companions are aggressive assistants, with MedicDrones providing support fire. The premium Robot Dragon ally is an unlockable SPECIALS feature.

### Bio-Creature Dex (Robotic Pokemon Pets)
The pet catalog (`BioSpecies.ts`) defines 125+ collectible robotic-Pokemon-style creatures, each tagged with one of 21 archetypes (fox, cat, bunny, mouse, pup, beetle, frog, lizard, salamander, serpent, owl, bird, dragon, fish, crab, turtle, bear, monkey, golem, flutter, slime), one of 11 elemental types (normal, fire, water, grass, electric, ice, psychic, dark, steel, crystal, dragon), and a rarity tier (common → legendary). `BioCreatureSystem.makeDescriptor` builds chibi-proportioned `RobotDescriptor`s with archetype-specific silhouettes (bunny ears, dragon wings+horns+tail, turtle shell-backpack, slime sphere body, fish fins, etc.) and type-tinted accents — every species reads as a unique mascot. Wild creatures spawn rarity-weighted across a 6×6 world grid (~36 alive at once) and gradually respawn over time. The Bio Garden UI is now a full Dex with type-filter tabs, capture progress (X/total), per-type tallies, and rarity stars. The original five ids (`robofox`, `crystalbeetle`, `hoverserpent`, `neonowl`, `voltfrog`) are preserved for save compatibility; legacy saves resolve unchanged.

### Enemy Systems
The EnemySystem features a wave spawner for distinct enemy types, including Commanders. The Robot Shape Engine generates all robots. Aerial enemies have specialized behaviors and engage upon player aggression. Hostile Enemy Bases include turrets and destructible loot vaults. Aerial regroup timers manage respawns. The BossCaptain is a humanoid boss enemy mirroring the player's kit. Boss Fortresses are level capstones with turrets and a central core, leading to boss variant spawns. Five themed boss variants are defined, each with unique visual, damage, and taunt characteristics.

### LevelSystem (campaign progression)
Three world levels are defined, each with specific banners, objectives, difficulty multipliers, sky tints, and boss variants. Completion of a boss fortress advances the player to the next level. Level progression is persisted.

### Resource Nodes
The MiningSystem scatters destructible glowing resource nodes that respawn after a delay.

### Procedural Alien Foliage (L-system)
A small reusable L-system module lives at `client/src/game/lsystem/` (`LSystem.ts` string rewriter, `LSystemRenderer.ts` turtle interpreter that emits merged Babylon meshes, `LSystemPresets.ts` with `alienTree`/`alienBush`/`alienCoral` grammars). `AlienFoliageSystem.ts` consumes those presets to scatter ~90 procedural alien plants across the wilderness band (radius 90–540) using a deterministic mulberry32 PRNG, rejecting candidates within 32m of the spawn / fortress / temple anchors and within 12m of an already-placed plant. Each plant is built from up to two merged meshes (`alien_plant_<i>_trunk` + `alien_plant_<i>_leaves`) so a full scatter is ~180 meshes total; squared-distance culling with 220/215m hysteresis disables far plants. Trunks share one dark organic material; leaves use one of three emissive tints (green/pink/cyan) per preset. Plants are decorative — not pickable, not damageable, and intentionally excluded from the player's ground ray-pick predicate.

### Mountain Ring & Hidden Temples
`MountainRingSystem` builds a ring of 9 mountain "ranges" at radius 560 around the world center — each range is a tight cluster of 3–5 peaks (one tall hero + 2–4 shorter flanks) bunched along the ring tangent, so the silhouette reads as a real range with foothills rather than evenly-spaced cones. Peaks use a gentle h/w ≈ 0.45–0.6 ratio (was ~1.0) so slopes are walkable, and snow caps appear only on the hero peak of each range. All peaks share one tintable `mountainMat` so a `LEVEL_STARTED` listener can blend the rock color toward the active sky tint. Inside the ring, four stepped-pyramid hidden temples sit at the diagonals (45/135/225/315°) at radius 480, each with a glowing inward-facing portal disc and a floating beacon. Temple ids are namespaced per level (`L{1-3}_temple_{ne|nw|sw|se}`) so each level keeps an independent looted history. Approaching a temple shows a `PRESS E — RAID HIDDEN TEMPLE` HTML prompt; pressing E grants a level-scaled rare-item bundle (energy_core, circuit_board, nano_fiber, weapon_part_rocket/laser, shield_booster, damage_amp, xp_chip — quantities ×1/×1.5/×2 by level) and spawns a guaranteed rare/legendary guardian creature (legendary-only at L3) via `BioCreatureSystem.spawnCreature`. The portal+beacon dim, a `UI_MESSAGE` toast fires, and the temple id is added to a persistent `lootedTempleIds` set saved in `ProgressSnapshot`.

### Player Progress and Persistence
ProgressSync.ts handles saving and loading player progress to a database, covering stats, weapon levels, inventory, companion roster, beam sabre level, SPECIALS unlocks, and elemental specials levels. Auto-save runs every 5 seconds and on key progression events.

### Environment and World
A CityGenerator creates a 1200x1200 open world with a central city and four biomes. The SkySystem renders a custom-shader gradient skybox, a day/night cycle, and weather modes. Buildings are hollow with accessible interiors and a sky racetrack is integrated.

### Multiplayer
A MultiplayerSystem provides client-side WebSocket integration for real-time multiplayer, supporting room management, position synchronization, chat, and enemy damage syncing for up to 4 players.

### Friendly NPCs
FriendlyNPCSystem scatters six brightly-coloured humanoid NPCs around the spawn area, each introducing one game system via interactive dialogue.

### Input and UI
GamepadInput provides seamless controller integration. Triggers are context-aware: on foot, **RT** fires the primary weapon (LMB) and **LT** triggers the beam-sabre slash (KeyJ); while driving a vehicle, **RT** becomes throttle (KeyW) and **LT** becomes reverse / brake (KeyS). The host wires the context via `gamepad.setContextProvider(() => vehicleRef.current?.getActive() ? "vehicle" : "foot")`. On context change, any held trigger releases its previous binding before the new one is dispatched, so transitions never leave a stuck key. The EffectsSystem drives transient visual effects. The UI includes a redesigned HUD, AuthUI, GameUI, shop interfaces, upgrade interfaces, multiplayer lobby, contextual build hotbar, and MainMenu with character customization. An EnemyHealthBarSystem renders HTML overlays for active enemies and objects. Comprehensive Xbox-style controller mapping is implemented.

## External Dependencies
- **PostgreSQL**: Primary database with Drizzle ORM.
- **Passport.js**: User authentication with local strategy and scrypt hashing.
- **Express-session with connect-pg-simple**: Persistent session management.
- **ws library**: WebSocket server for multiplayer.