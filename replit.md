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
      BabylonEngine.ts     - Core 3D engine setup with Babylon.js
      CityGenerator.ts     - Futuristic Detroit cityscape generation with water shader river
      PlayerController.ts  - First-person player with dodge, parry, sprint, jetpack, stamina
      WeaponsSystem.ts     - 6 weapon types with projectile physics
      EnemySystem.ts       - 5 enemy types with FSM AI (Patrol/Chase/Attack/Stunned/Dead)
      ChestSystem.ts       - Loot chests with upgrades
      CombatSystem.ts      - Melee combo system with input buffering and hitbox detection
      EventBus.ts          - Global event system for decoupled communication
      StateMachine.ts      - Generic finite state machine with transition validation
      DamageSystem.ts      - Unified damage pipeline with resistances, types, area damage
      InventorySystem.ts   - Slot-based inventory with item stacking and definitions
      GameUI.tsx           - HUD with health, armor, stamina, jetpack, combat status
      MainMenu.tsx         - Game start menu
      Game.tsx             - Main game orchestration
```

## Architecture

### Core Systems
- **EventBus**: Singleton event system for decoupled communication between game systems
- **StateMachine**: Generic FSM with state configs, transition validation, timers
- **DamageSystem**: Unified damage pipeline with DamageType enum, resistances, IDamageable interface, area damage

### Player Systems
- **PlayerController**: Implements IDamageable, has full state machine (idle/moving/sprinting/dodging/attacking/stunned/dead/jetpack)
- **CombatSystem**: Light/heavy melee combo chains with input buffering, hitbox detection, damage multipliers
- **InventorySystem**: 24-slot grid inventory with item stacking, item definitions catalog

### Enemy Systems
- **EnemyUnit**: Implements IDamageable, FSM-driven AI with Patrol→Chase→Attack→Stunned→Dead states
- **EnemySystem**: Wave spawner with type selection based on wave number, difficulty scaling

### City
- **CityGenerator**: Zones (Downtown, Industrial, Residential, Spaceport, Highway), cell-shaded shader materials, animated water shader river, neon lights, street lights

## Features

### City Generation
- Downtown skyscrapers with cell-shaded materials
- Industrial zone with factories and chimneys
- Residential blocks
- Elevated highways with support pillars
- Animated river with custom water shader (waves, foam, sparkles, neon reflections)
- Spaceports with landing platforms
- Neon signs and atmospheric lighting
- Street lights with colored glow

### Weapons (1-6 keys)
1. Plasma Pistol - Semi-auto sidearm
2. Pulse Rifle - Automatic assault weapon
3. Scatter Blaster - 8-pellet shotgun
4. Nova Launcher - Explosive rockets
5. Photon Beam - Rapid-fire laser
6. Fusion Grenades - Explosive grenades with arc

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
- Jetpack (hold Space in air, uses fuel)
- Stamina system with regen delay
- Armor damage absorption (70%)
- Invulnerability frames after taking damage

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
- 1-6 - Switch weapons
- R - Reload
- Space - Jump / Jetpack (hold in air)
- Q - Dodge roll
- F - Parry
- V - Light melee attack
- B - Heavy melee attack
- Click canvas to enable pointer lock

## Technical Details
- Engine: Babylon.js 7.x
- Rendering: WebGL with bloom, chromatic aberration, FXAA
- Graphics Style: Cell-shaded anime aesthetic with neon accents
- Frontend: React + TypeScript + Vite
- Backend: Express.js
- Custom shaders: Cell-shading, animated water
- Architecture: Event-driven with FSM-based entity states

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground

## Recent Changes
- February 2026: Major systems upgrade
  - Added EventBus, StateMachine, DamageSystem core architecture
  - Enhanced PlayerController with dodge, parry, sprint, jetpack, stamina
  - Upgraded EnemySystem with FSM AI (Patrol/Chase/Attack/Stunned/Dead)
  - Added CombatSystem with melee combo chains and input buffering
  - Added InventorySystem with slot-based stacking
  - Enhanced CityGenerator with animated water shader river and street lights
  - Upgraded GameUI with stamina, jetpack fuel, player state, combo indicators
- December 2024: Initial implementation with complete game systems
