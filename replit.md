# Detroit 3026: The First Attack

## Overview
Detroit 3026 is a 3D futuristic sci-fi action game built with Babylon.js. Set in Detroit in the year 3026, the game features anime-style cell-shaded graphics, immersive combat, DBZ-style flight, open-world biomes, and an explorable cityscape. The core objective is to defend Detroit from an invasion of insane hybrid organoids, which are AI fused with human and tardigrade DNA. The project aims to deliver a rich, engaging experience with deep exploration, dynamic combat, and robust progression systems.

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground
- Communication: Concise updates; documentation must always reflect changes.

## System Architecture

### Core Systems
- **EventBus**: Singleton pattern for decoupled communication between game components.
- **StateMachine**: Generic Finite State Machine for managing entity behaviors with state configurations and transition validation.
- **DamageSystem**: Unified pipeline for managing damage, incorporating damage types, resistances, and area-of-effect calculations.

### Player Systems
- **PlayerController**: Manages a humanoid character with a comprehensive state machine (idle, moving, sprinting, dodging, attacking, stunned, dead, jetpack, flying, hovering). Features a triple-jump flight system allowing for sky launches into free flight mode with air momentum preservation. On construction it loads any saved character from `localStorage` (`detroit3026_character_v1`) so customizations from the Character Editor persist into gameplay.
- **HumanoidCharacter**: Procedural generation for humanoid meshes, supporting modular body parts, clothing, armor, hair, and customizable colors and armor types. Exposes `getAnimatableLimbs()` returning the joint pivot transform-nodes (head, torso, left/right arm and leg pivots) so the AnimationSystem can drive the actual visible body — preventing duplicate "white shape" placeholders.
- **AnimationSystem**: Procedural, multi-part character animations with smooth blending for various states including running, jumping, combat moves, and flight. Can either create its own placeholder limbs OR `attachToParts()` to animate an existing HumanoidCharacter's limb pivots (the player path uses attach-mode, so only one body is rendered).
- **CharacterEditor** (`CharacterEditor.tsx`): React modal opened from the main menu's CUSTOMIZE button. Provides sliders for height, head scale, shoulder width, arm/leg length; toggles for body type (lean/athletic/heavy) and armor type (light/heavy/captain); color pickers for primary/secondary/skin/hair. Renders a live preview in its own mini Babylon scene with arc-rotate camera. Saves to `localStorage` so the next mission start uses the customized look.
- **CombatSystem**: Implements light and heavy melee combo chains with input buffering and hitbox detection.
- **InventorySystem**: A 24-slot grid-based inventory system with item stacking and a catalog of item definitions.

### Weapon Systems
- **WeaponsSystem**: Manages 6 primary weapon types with distinct projectile physics.
- **SpecialWeaponsSystem**: Implements 4 unique special weapons.
- **BeamSabreSystem**: A toggleable melee weapon offering slash combos and energy wave attacks.

### Armor & Upgrade Systems
- **ArmorSystem**: Features 4 armor slots and 5 elemental armor types, each providing different strengths and effects.
- **ArmorCapsuleSystem**: An interactive laboratory building where players can upgrade armor through 6 tiers, with the first tier granting essential flight capabilities.
- **CraftingSystem**: Recipe-based crafting for weapons, armor, and base components utilizing inventory materials.
- **BuildingSystem**: A Minecraft-style mining and building system allowing terrain manipulation, structure destruction, and the placement of 13 block types with grid-snapped previews. Block catalog: Metal Wall, Glass, Platform, Ramp, Door, Light, Cube, Sphere, Pyramid, Pillar, Foundation, Fence, Neon Strip — each with material costs, health, and (where appropriate) emissive color. Controls: G toggles build mode, mouse-wheel cycles the hotbar, number keys 1–9/0/-/= jump-select, R rotates, LMB places, RMB mines. The currently-selected block and full hotbar are surfaced through `getSelectedBlockType()` and `getHotbar()` so the in-game HUD can render the live hotbar strip.

### Commerce & Companion Systems
- **ShopSystem**: Features 5 shop locations with 3 distinct types (weapon, armor, general) offering dynamic pricing for buying and selling items.
- **GardenSystem**: Four pet gardens provide safe zones for managing, training, and bonding with digital companions.
- **CompanionSystem**: Manages allies and digital pets, including healing companions and combat companions, with an experience and leveling system.
- **MapSystem**: Real-time minimap display with player position, enemy markers, shop and garden locations, grid overlay, and toggle control (M key).

### Enemy Systems
- **EnemySystem**: Implements a wave spawner for 6 distinct enemy types, including Drone, Soldier, Heavy, Insectoid, Hybrid, and Commander. Commanders are humanoid captains with advanced AI, flight capabilities, and rare loot drops.

### Environment & World
- **CityGenerator**: Creates a massive 1200x1200 open world featuring a central city and four unique biomes: Mountains, Jungle, Desert, and Junkyard Robot City. Each biome includes temples, villages, and secret areas, along with sky cities and dynamic environmental elements.
- **Rendering**: Utilizes cell-shaded shader materials with rim lighting, outlines, panel lines, animated water, and neon accents.

### Multiplayer
- **MultiplayerSystem**: Client-side WebSocket integration for real-time multiplayer, supporting room creation, joining, listing, position synchronization, chat, and enemy damage syncing for up to 4 players.

### Effects & Polish
- **EffectsSystem** (`EffectsSystem.ts`): Pokemon-style transient VFX driven by EventBus events. Effects: `effect:sparkle` (radial burst of small glowing spheres with gravity), `effect:capture` (rotating ring + pulsing beam-of-light + sparkle burst — used when bonding companions and opening chests), `effect:levelUp` (golden expanding pillar + sparkles), `effect:pickup` (small green sparkle). The CompanionSystem fires a green `effect:capture` for allies and pink for pets when one bonds, and the ChestSystem fires a gold `effect:capture` when a chest opens.

### User Interface
- **AuthUI**: Login/register authentication screen with an option for offline play.
- **GameUI**: In-game HUD displaying critical information, shop interfaces, capsule upgrade interface, multiplayer lobby, and a contextual **build hotbar** (only visible while build mode is active) that highlights the currently selected block plus its number-key shortcut.
- **MainMenu**: The primary game start menu, now featuring a START MISSION button and a CUSTOMIZE button that opens the CharacterEditor.

### Technical Details
- **Engine**: Babylon.js v8.x, WebGL rendering.
- **Graphics**: Cell-shaded anime aesthetic with ink outlines (Sobel edge detection), bloom, chromatic aberration, and FXAA.
- **Frontend**: React + TypeScript + Vite.
- **Backend**: Express.js.
- **Architecture**: Event-driven with FSM-based entity states.

## External Dependencies
- **PostgreSQL**: Used as the primary database with Drizzle ORM for schema management and interaction.
- **Passport.js**: Utilized for user authentication, including local strategy and scrypt password hashing.
- **Express-session with connect-pg-simple**: For persistent session management.
- **ws library**: Powers the WebSocket server for real-time multiplayer functionality.