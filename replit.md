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
      CityGenerator.ts     - Futuristic Detroit cityscape generation
      PlayerController.ts  - First-person player movement and stats
      WeaponsSystem.ts     - 6 weapon types with projectile physics
      EnemySystem.ts       - 5 enemy types with AI behavior
      ChestSystem.ts       - Loot chests with upgrades
      GameUI.tsx           - HUD with health, ammo, combat status
      MainMenu.tsx         - Game start menu
      Game.tsx             - Main game orchestration
```

## Features

### City Generation
- Downtown skyscrapers with cell-shaded materials
- Industrial zone with factories and chimneys
- Residential blocks
- Elevated highways with support pillars
- River on the south side
- Spaceports with landing platforms
- Neon signs and atmospheric lighting

### Weapons (1-6 keys)
1. Plasma Pistol - Semi-auto sidearm
2. Pulse Rifle - Automatic assault weapon
3. Scatter Blaster - 8-pellet shotgun
4. Nova Launcher - Explosive rockets
5. Photon Beam - Rapid-fire laser
6. Fusion Grenades - Explosive grenades with arc

### Enemies
- Drones - Fast flying scouts
- Soldiers - Standard humanoid combat units
- Heavy - Armored tanks
- Insectoids - Mutated insects with exoskeletons
- Hybrids - AI-human-tardigrade fusion (boss type)

### Progression
- Treasure chests with credits, health, armor, ammo
- Experience and leveling system
- Wave-based enemy spawning with increasing difficulty

## Controls
- WASD - Move
- Mouse - Look around
- Left Click - Fire weapon
- 1-6 - Switch weapons
- R - Reload
- Space - Jump
- Click canvas to enable pointer lock

## Technical Details
- Engine: Babylon.js 7.x
- Rendering: WebGL with bloom, chromatic aberration, FXAA
- Graphics Style: Cell-shaded anime aesthetic with neon accents
- Frontend: React + TypeScript + Vite
- Backend: Express.js

## Recent Changes
- December 2024: Initial implementation with complete game systems
