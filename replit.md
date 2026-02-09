# Detroit 3026: The First Attack

## Overview
A 3D futuristic sci-fi action game set in Detroit in the year 3026. Built with Babylon.js featuring anime-style cell-shaded graphics, immersive combat, and an explorable cityscape.

## Story
In 3026, humanity has colonized the Moon, Mars, and Venus alongside AI partners. But in Detroit, hybrid organoids - AI fused with human and tardigrade DNA - have gone insane. Their secret experiments on insects and mammals threaten civilization. Defend Detroit against the first wave of the invasion!

## Project Structure
```
client/
  src/
    game/
      BabylonEngine.ts        - Core 3D engine setup with Babylon.js
      CityGenerator.ts        - Futuristic Detroit cityscape generation with water shader river
      PlayerController.ts     - First-person player with dodge, parry, sprint, jetpack, stamina, air momentum
      WeaponsSystem.ts        - 6 primary weapon types with projectile physics
      SpecialWeaponsSystem.ts - 4 special weapons (keys 7-0): Missile, Energy Burst, Bomb, Drone
      BeamSabreSystem.ts      - Toggle melee weapon with slash combos and energy wave attacks
      ArmorSystem.ts          - 5 elemental armor types with strength/defense/poison effects
      CraftingSystem.ts       - Recipe-based crafting for weapons, armor, and bases
      EnemySystem.ts          - 5 enemy types with FSM AI (Patrol/Chase/Attack/Stunned/Dead)
      ChestSystem.ts          - Loot chests with upgrades
      CombatSystem.ts         - Melee combo system with input buffering and hitbox detection
      EventBus.ts             - Global event system for decoupled communication
      StateMachine.ts         - Generic finite state machine with transition validation
      DamageSystem.ts         - Unified damage pipeline with resistances, types, area damage
      InventorySystem.ts      - Slot-based inventory with item stacking and definitions
      GameUI.tsx              - HUD with all system displays
      MainMenu.tsx            - Game start menu
      Game.tsx                - Main game orchestration integrating all systems
```

## Architecture

### Core Systems
- **EventBus**: Singleton event system for decoupled communication between game systems
- **StateMachine**: Generic FSM with state configs, transition validation, timers
- **DamageSystem**: Unified damage pipeline with DamageType enum, resistances, IDamageable interface, area damage

### Player Systems
- **PlayerController**: Implements IDamageable, has full state machine (idle/moving/sprinting/dodging/attacking/stunned/dead/jetpack). Air momentum system preserves horizontal velocity while airborne with 0.15 air control factor and 99.5% momentum decay.
- **CombatSystem**: Light/heavy melee combo chains with input buffering, hitbox detection, damage multipliers
- **InventorySystem**: 24-slot grid inventory with item stacking, item definitions catalog

### Weapon Systems
- **WeaponsSystem**: 6 primary weapons (keys 1-6) with projectile physics
- **SpecialWeaponsSystem**: 4 special weapons (keys 7-0) with unique mechanics
  - Homing Missile (key 7): Tracking projectile with explosion radius, 3-level upgrades
  - Tracking Energy Burst (key 8): Multi-projectile energy burst that tracks enemies
  - Bomb (key 9): Deployable explosive with delayed detonation and area damage
  - Combat Drone (key 0): Autonomous drone that fires at enemies, upgradeable to shield drone
- **BeamSabreSystem**: Toggle melee weapon (T key) with slash combos and energy wave projectiles. 5 upgrade levels with increasing damage, combo length, and wave power.

### Armor & Crafting Systems
- **ArmorSystem**: 4 armor slots (helmet, chest, legs, boots) with 5 elemental types
  - Fire: +15% strength, burn damage on melee hit
  - Ice: +15% defense, slow enemies on hit
  - Electric: +10% both, chain lightning on kill
  - DarkEnergy: +20% strength, life steal on hit
  - Insectoid: +20% defense, health regeneration
  - Damage reduction formula: defense / (defense + 100) base reduction
- **CraftingSystem**: Recipe-based system using InventorySystem materials
  - Craft weapons, armor pieces, and bases
  - Material requirements scale with item tier

### Enemy Systems
- **EnemyUnit**: Implements IDamageable, FSM-driven AI with Patrol→Chase→Attack→Stunned→Dead states
- **EnemySystem**: Wave spawner with type selection based on wave number, difficulty scaling

### City & Environment
- **CityGenerator**: Expanded 1200x1200 world with multiple biomes
  - City Zones: Downtown, Industrial, Residential, Spaceport, Highway, Outer Districts
  - Sky Cities: 12 floating platforms at heights 40-250 with buildings, towers, beacons
  - Sky Bridges: Segmented walkways connecting platforms with glowing rails
  - Stairways: Ground-to-sky stepping stone ramps with glow strips
  - Mountains: 4 mountain ranges with peaks, snow caps, boulders, ridges
  - Nature: 4 nature zones with trees, bushes, grass, ponds, rocks
  - Apex Platform: Highest point (y=250) with animated rings and energy orb
  - Rooftop Landing Platforms: All buildings have landing platforms with glowing cyan edges
  - Cell-shaded shader materials with rim lighting, outlines, and panel detail lines
  - Animated water shader river, neon lights, street lights

## Features

### City Generation
- Downtown skyscrapers with cell-shaded materials and rooftop platforms
- Industrial zone with factories, chimneys, and rooftop platforms
- Residential blocks with rooftop platforms
- Elevated highways with support pillars
- Animated river with custom water shader (waves, foam, sparkles, neon reflections)
- Spaceports with landing platforms
- Neon signs and atmospheric lighting
- Street lights with colored glow
- Outer districts with rooftop platforms
- Enhanced cell-shading with sharper edges, rim lighting, outlines, panel lines

### Primary Weapons (1-6 keys)
1. Plasma Pistol - Semi-auto sidearm
2. Pulse Rifle - Automatic assault weapon
3. Scatter Blaster - 8-pellet shotgun
4. Nova Launcher - Explosive rockets
5. Photon Beam - Rapid-fire laser
6. Fusion Grenades - Explosive grenades with arc

### Special Weapons (7-0 keys)
7. Homing Missile - Tracking explosive projectile (3 levels)
8. Tracking Energy Burst - Multi-projectile energy attack (3 levels)
9. Bomb - Deployable explosive with delayed detonation (3 levels)
0. Combat Drone - Autonomous combat assistant (3 levels, level 3 = shield drone)

### Beam Sabre (T key)
- Toggle melee weapon with cyan energy blade
- Double slash combo with energy wave projectiles
- 5 upgrade levels with increasing damage and effects
- Energy waves can hit multiple enemies

### Combat
- Light melee combo: Jab → Cross → Uppercut (V key)
- Heavy melee combo: Slam → Sweep (B key)
- Input buffering for fluid combo chains
- Dodge with i-frames (Q key, costs 20 stamina)
- Parry window for blocking damage (F key)
- Damage types: Plasma, Kinetic, Explosive, Laser, Melee, Fire
- Damage resistances per type

### Player Mechanics
- Sprint (Shift, costs stamina)
- Dodge roll with invulnerability (Q, costs stamina)
- Parry with damage reflection (F)
- Jetpack (hold Space in air, uses fuel, max velocity 0.35)
- Forward momentum preserved during jumps and jetpack (air control system)
- Stamina system with regen delay
- Armor damage absorption (70%)
- Invulnerability frames after taking damage

### Armor System
- 4 armor slots: Helmet, Chest, Legs, Boots
- 5 tiers per slot: Iron, Steel, Titanium, Plasma, Quantum
- 5 elemental infusions: Fire, Ice, Electric, DarkEnergy, Insectoid
- Each element provides strength bonus, defense bonus, and poison effects
- Defense reduces incoming damage via formula

### Crafting System
- Recipe-based crafting using inventory materials
- Craft weapons, armor, and base structures
- Material requirements scale with item quality

### Enemies
- Drones - Fast flying scouts (FSM AI, hover behavior)
- Soldiers - Standard humanoid combat units
- Heavy - Armored tanks with high defense
- Insectoids - Fast melee attackers
- Hybrids - AI-human-tardigrade fusion boss (1000 HP)
- All enemies use FSM: Patrol → Chase → Attack → Stunned → Dead
- Defense stat reduces incoming damage
- Stun on hit with recovery timer

### Progression
- Treasure chests with credits, health, armor, ammo
- Experience and leveling system (increases max health, stamina)
- Wave-based enemy spawning with increasing difficulty
- Inventory system with item stacking

## Controls
- WASD - Move
- SHIFT - Sprint
- Mouse - Look around
- Left Click - Fire weapon
- 1-6 - Switch primary weapons
- 7-0 - Fire special weapons
- T - Toggle Beam Sabre
- R - Reload
- Space - Jump / Jetpack (hold in air)
- Q - Dodge roll
- F - Parry
- V - Light melee attack
- B - Heavy melee attack
- Click canvas to enable pointer lock

## Technical Details
- Engine: Babylon.js v8.x
- Rendering: WebGL with bloom, chromatic aberration, FXAA
- Graphics Style: Cell-shaded anime aesthetic with neon accents, rim lighting, panel lines
- Frontend: React + TypeScript + Vite
- Backend: Express.js
- Custom shaders: Cell-shading with outlines, animated water
- Architecture: Event-driven with FSM-based entity states

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground

## Recent Changes
- February 2026: New combat & progression systems
  - Added SpecialWeaponsSystem with 4 weapons on keys 7-0 (Missile, Energy Burst, Bomb, Drone)
  - Added BeamSabreSystem with slash combos and energy wave attacks (T key)
  - Added ArmorSystem with 5 elemental types and damage reduction
  - Added CraftingSystem with recipe-based item creation
  - Enhanced cell-shading with sharper edges, rim lighting, outlines, panel detail lines
  - Added rooftop landing platforms to all building types with glowing edges
  - Fixed jetpack/jump physics with air momentum system (preserves forward velocity)
  - Increased jetpack max vertical velocity to 0.35
  - Added rooftop platform detection in PlayerController raycasting
  - Updated GameUI with special weapons, beam sabre, armor element, and defense displays
  - Integrated all new systems into Game.tsx with proper lifecycle management
- February 2026: Environment expansion
  - Expanded world from 500x500 to 1200x1200
  - Added 12 sky city platforms at heights 40-250 with buildings and towers
  - Added sky bridges with segmented walkways and glowing rails
  - Added ground-to-sky stairways with stepping stones
  - Added 4 mountain ranges with peaks, snow caps, boulders, ridges
  - Added 4 nature zones with trees, bushes, grass, ponds, rocks
  - Added apex platform with animated rings and energy orb
  - Added 5 outer city districts
  - Upgraded jetpack (200 fuel, stronger thrust, faster regen)
  - Added platform landing detection via raycasting
  - Extended highways and river to span full world
- February 2026: Major systems upgrade
  - Added EventBus, StateMachine, DamageSystem core architecture
  - Enhanced PlayerController with dodge, parry, sprint, jetpack, stamina
  - Upgraded EnemySystem with FSM AI (Patrol/Chase/Attack/Stunned/Dead)
  - Added CombatSystem with melee combo chains and input buffering
  - Added InventorySystem with slot-based stacking
  - Enhanced CityGenerator with animated water shader river and street lights
  - Upgraded GameUI with stamina, jetpack fuel, player state, combo indicators
- December 2024: Initial implementation with complete game systems
