# Detroit 3026: Developer Guide

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Core Systems](#core-systems)
   - [BabylonEngine](#babylonengine)
   - [EventBus](#eventbus)
   - [StateMachine](#statemachine)
   - [DamageSystem](#damagesystem)
4. [Player Systems](#player-systems)
   - [PlayerController](#playercontroller)
   - [CombatSystem](#combatsystem)
   - [InventorySystem](#inventorysystem)
5. [Weapon Systems](#weapon-systems)
   - [WeaponsSystem](#weaponssystem)
   - [SpecialWeaponsSystem](#specialweaponssystem)
   - [BeamSabreSystem](#beamsabresystem)
6. [Defense Systems](#defense-systems)
   - [ArmorSystem](#armorsystem)
   - [CraftingSystem](#craftingsystem)
7. [Enemy Systems](#enemy-systems)
   - [EnemySystem](#enemysystem)
   - [EnemyUnit](#enemyunit)
8. [World Systems](#world-systems)
   - [CityGenerator](#citygenerator)
   - [ChestSystem](#chestsystem)
9. [Companion Systems](#companion-systems)
   - [CompanionSystem](#companionsystem)
10. [Robot Construction](#robot-construction)
    - [RobotDesigner](#robotdesigner)
    - [RobotFactory](#robotfactory)
    - [RobotPresets](#robotpresets)
11. [UI Layer](#ui-layer)
    - [Game.tsx](#gametsx)
    - [GameUI.tsx](#gameuitsx)
    - [MainMenu.tsx](#mainmenutsx)
12. [Data Flow](#data-flow)
13. [Controls Reference](#controls-reference)
14. [How to Extend](#how-to-extend)
15. [Editing Game Parameters](#editing-game-parameters)
16. [Adding New Robots](#adding-new-robots)
17. [Editing Robot Designs](#editing-robot-designs)
18. [Adding / Editing Levels](#adding--editing-levels)

---

## Architecture Overview

Detroit 3026 is a first-person 3D action game built with **Babylon.js** (not React Three Fiber), **React**, and **TypeScript**. The game uses an event-driven architecture with finite state machines for entity behavior.

### Key Design Patterns

- **Event-Driven Communication**: Systems communicate through a singleton `EventBus`, keeping them decoupled.
- **Finite State Machines**: Both the player and enemies use generic `StateMachine<T>` instances to manage behavior states with validated transitions.
- **IDamageable Interface**: A unified damage pipeline where any entity that can take damage implements `IDamageable`.
- **Component Orchestration**: `Game.tsx` acts as the orchestrator, instantiating all systems and running the game loop. Individual systems don't know about each other directly; they interact through the event bus and through `Game.tsx` wiring.

### System Dependency Graph

```
Game.tsx (Orchestrator)
  |
  +-- BabylonEngine (canvas, engine, scene, camera, post-processing)
  |
  +-- CityGenerator (world geometry)
  |
  +-- PlayerController (movement, physics, damage)
  |     +-- StateMachine<PlayerState>
  |
  +-- WeaponsSystem (primary weapons 1-6)
  +-- SpecialWeaponsSystem (special weapons 7-0)
  +-- BeamSabreSystem (melee toggle weapon)
  +-- CombatSystem (melee combo chains)
  |
  +-- EnemySystem (spawning, wave management)
  |     +-- EnemyUnit[] (individual enemy AI via StateMachine<EnemyAIState>)
  |     +-- RobotFactory (mesh creation)
  |
  +-- ChestSystem (loot drops)
  +-- CompanionSystem (ally/pet followers)
  |
  +-- ArmorSystem (defense, elements)
  +-- CraftingSystem (recipe-based crafting)
  +-- InventorySystem (item storage)
  |
  +-- EventBus (global event system)
  +-- GameUI (HUD overlay)
```

---

## Project Structure

```
client/
  src/
    game/
      BabylonEngine.ts        - Core 3D engine, camera, lighting, post-processing
      CityGenerator.ts        - Procedural city/world generation (1200x1200)
      PlayerController.ts     - First-person player: movement, physics, state machine
      WeaponsSystem.ts        - 6 primary weapons with projectile physics
      SpecialWeaponsSystem.ts - 4 special weapons (keys 7-0) with tracking/AoE
      BeamSabreSystem.ts      - Toggle melee weapon with combos and energy waves
      CombatSystem.ts         - Melee combo system with input buffering
      ArmorSystem.ts          - Elemental armor with defense/damage modifiers
      CraftingSystem.ts       - Recipe-based crafting for items and structures
      InventorySystem.ts      - Slot-based inventory with stacking
      EnemySystem.ts          - Enemy spawning, wave management, AI
      ChestSystem.ts          - Loot chests with pickups
      CompanionSystem.ts      - Ally/pet companion followers
      RobotDesigner.ts        - Robot style/descriptor type definitions
      RobotFactory.ts         - Procedural robot mesh generation from descriptors
      RobotPresets.ts         - Pre-defined robot configurations
      EventBus.ts             - Singleton event system
      StateMachine.ts         - Generic FSM with transition validation
      DamageSystem.ts         - Unified damage types, interfaces, area damage
      Game.tsx                - Main game orchestration component
      GameUI.tsx              - HUD overlay (health, ammo, weapons, status)
      MainMenu.tsx            - Start screen
    components/ui/            - Shadcn UI components (not used in-game)
    lib/
      stores/
        useAudio.tsx          - Audio state management
        useGame.tsx           - Game state management
    App.tsx                   - App root
    main.tsx                  - Entry point
server/
  index.ts                    - Express server entry
  routes.ts                   - API routes
  static.ts                   - Static file serving
  vite.ts                     - Vite dev server middleware
```

---

## Core Systems

### BabylonEngine

**File**: `client/src/game/BabylonEngine.ts`

The rendering engine wrapper that initializes and manages the Babylon.js runtime.

#### Constructor

```ts
constructor(canvas: HTMLCanvasElement)
```

Creates the Babylon.js `Engine`, `Scene`, `FreeCamera`, lighting, and post-processing pipeline.

#### Camera Setup

- Type: `BABYLON.FreeCamera` (first-person)
- Initial position: `(350, 15, 150)` looking at `(300, 10, 100)`
- Controls: WASD keys mapped to camera movement
- `angularSensibility`: 2000 (mouse look speed)
- Near/far clip: 0.1 / 1000

#### Lighting

| Light | Type | Purpose |
|-------|------|---------|
| `ambientLight` | HemisphericLight | Ambient fill (blue tint above, purple below) |
| `sunLight` | DirectionalLight | Main directional sun (warm white) |
| `neonGlow` | PointLight | Cyan accent glow |

#### Post-Processing

- **Bloom**: threshold 0.5, weight 0.25, kernel 32
- **Chromatic Aberration**: amount 8
- **FXAA**: enabled
- **Sharpen**: edge amount 0.15
- **Fog**: EXP2, density 0.0015, dark blue color
- **Clear color**: near-black `(0.02, 0.02, 0.08)`

#### Public API

| Method | Returns | Description |
|--------|---------|-------------|
| `getScene()` | `BABYLON.Scene` | The active scene |
| `getCamera()` | `BABYLON.FreeCamera` | The player camera |
| `getEngine()` | `BABYLON.Engine` | The Babylon engine |
| `start(renderLoop)` | `void` | Starts the render loop, registers resize handler |
| `dispose()` | `void` | Cleans up scene and engine |

---

### EventBus

**File**: `client/src/game/EventBus.ts`

A singleton publish/subscribe event system for decoupled inter-system communication.

#### Usage

```ts
const bus = EventBus.getInstance();

// Subscribe
bus.on("player:damaged", (data) => { ... });

// Emit
bus.emit("player:damaged", { amount: 25, remaining: 75 });

// Unsubscribe
bus.off("player:damaged", callback);

// Clear all
bus.clear();
```

#### Defined Events (`GameEvents`)

| Event Constant | Event String | Payload |
|---------------|-------------|---------|
| `PLAYER_DAMAGED` | `player:damaged` | `{ amount, remaining }` |
| `PLAYER_HEALED` | `player:healed` | `{ amount, health }` |
| `PLAYER_DIED` | `player:died` | none |
| `PLAYER_DODGE` | `player:dodge` | none |
| `PLAYER_PARRY` | `player:parry` | `{ success?: boolean }` |
| `PLAYER_LEVEL_UP` | `player:levelUp` | `{ level }` |
| `PLAYER_STAMINA_CHANGED` | `player:staminaChanged` | - |
| `ENEMY_DAMAGED` | `enemy:damaged` | `{ enemy, damage, position }` |
| `ENEMY_KILLED` | `enemy:killed` | `{ type, credits, experience, position }` |
| `ENEMY_SPAWNED` | `enemy:spawned` | `{ type, position }` |
| `ENEMY_STATE_CHANGED` | `enemy:stateChanged` | - |
| `WEAPON_FIRED` | `weapon:fired` | none |
| `WEAPON_SWITCHED` | `weapon:switched` | - |
| `WEAPON_RELOADED` | `weapon:reloaded` | - |
| `COMBO_HIT` | `combat:comboHit` | `{ comboName, attackName, comboIndex }` |
| `COMBO_FINISHED` | `combat:comboFinished` | `{ comboName }` |
| `LOOT_COLLECTED` | `loot:collected` | - |
| `CHEST_OPENED` | `chest:opened` | - |
| `WAVE_STARTED` | `wave:started` | `{ wave }` |
| `WAVE_COMPLETED` | `wave:completed` | - |
| `INVENTORY_CHANGED` | `inventory:changed` | none |
| `ITEM_PICKED_UP` | `inventory:itemPickedUp` | - |
| `UI_MESSAGE` | `ui:message` | `{ text, duration }` or `string` |
| `UI_DAMAGE_NUMBER` | `ui:damageNumber` | `{ position, damage, isCritical }` |

---

### StateMachine

**File**: `client/src/game/StateMachine.ts`

A generic finite state machine with transition validation, enter/exit callbacks, and timers.

#### Type Parameter

```ts
class StateMachine<T extends string>
```

`T` is a string union type representing valid state names (e.g., `PlayerState`, `EnemyAIState`).

#### StateConfig Interface

```ts
interface StateConfig<T extends string> {
  name: T;
  onEnter?: () => void;
  onExit?: () => void;
  onUpdate?: (dt: number) => void;
  transitions?: T[];  // Allowed states to transition TO from this state
}
```

#### API

| Method | Description |
|--------|-------------|
| `addState(config)` | Register a state with its transitions and callbacks |
| `changeState(newState)` | Transition if allowed by current state's `transitions` array. Returns `boolean`. |
| `forceState(newState)` | Bypass transition validation (e.g., for death/reset). |
| `update(dt)` | Increments state timer, calls `onUpdate` callback. |
| `getState()` | Returns current state name or `null`. |
| `getPreviousState()` | Returns the state before the current one. |
| `getStateTimer()` | Time spent in current state. |
| `isInState(...states)` | Check if current state matches any of the given states. |

#### Example: Player State Machine

```
idle <-> moving <-> sprinting
  |         |          |
  v         v          v
dodging  attacking   jetpack
  |         |
  v         v
stunned -> dead (terminal)
```

---

### DamageSystem

**File**: `client/src/game/DamageSystem.ts`

The unified damage pipeline shared by all damageable entities.

#### DamageType Enum

```ts
enum DamageType {
  Plasma, Kinetic, Explosive, Laser, Melee, Fire, Collision, Drowning
}
```

#### DamageInfo Interface

```ts
interface DamageInfo {
  amount: number;
  hitPoint?: BABYLON.Vector3;
  hitDirection?: BABYLON.Vector3;
  hitNormal?: BABYLON.Vector3;
  attacker?: any;
  damageType: DamageType;
  isCritical?: boolean;
  knockbackForce?: number;
}
```

#### DamageResult Interface

```ts
interface DamageResult {
  damageAmount: number;
  wasKilled: boolean;
  wasBlocked: boolean;
  wasParried: boolean;
}
```

#### IDamageable Interface

Any entity that can receive damage must implement:

```ts
interface IDamageable {
  health: number;
  maxHealth: number;
  isAlive: boolean;
  isInvulnerable: boolean;
  resistances: DamageResistance[];
  takeDamage(info: DamageInfo): DamageResult;
  heal(amount: number): void;
  getPosition(): BABYLON.Vector3;
}
```

#### Helper Functions

| Function | Description |
|----------|-------------|
| `applyDamage(target, info)` | Apply damage respecting resistances and invulnerability. Returns `DamageResult`. |
| `damageInArea(center, radius, baseDamage, damageType, attacker, targets)` | AoE damage with distance falloff. |

#### Damage Pipeline

1. Check `isAlive` and `isInvulnerable`
2. Apply resistance reduction: `finalDamage *= (1 - resistancePercent)`
3. Clamp to minimum 1
4. Subtract from `health`
5. If health <= 0, set `isAlive = false`

---

## Player Systems

### PlayerController

**File**: `client/src/game/PlayerController.ts`

The first-person player character controller implementing `IDamageable`.

#### Player States

```ts
type PlayerState = "idle" | "moving" | "sprinting" | "dodging" | "attacking" | "stunned" | "dead" | "jetpack";
```

#### State Transition Map

| From | Allowed To |
|------|-----------|
| `idle` | moving, sprinting, dodging, attacking, stunned, dead, jetpack |
| `moving` | idle, sprinting, dodging, attacking, stunned, dead, jetpack |
| `sprinting` | idle, moving, dodging, attacking, stunned, dead, jetpack |
| `dodging` | idle, moving, sprinting, stunned, dead |
| `attacking` | idle, moving, dodging, stunned, dead |
| `stunned` | idle, dead |
| `dead` | (none - terminal) |
| `jetpack` | idle, moving, stunned, dead |

#### PlayerStats

```ts
interface PlayerStats {
  health: number;       // Current HP
  maxHealth: number;    // Max HP (increases with level)
  armor: number;        // Current armor points
  maxArmor: number;     // Max armor (100)
  stamina: number;      // Current stamina
  maxStamina: number;   // Max stamina (increases with level)
  credits: number;      // Currency
  experience: number;   // XP towards next level
  level: number;        // Player level
}
```

#### Movement Constants

| Property | Value | Description |
|----------|-------|-------------|
| `walkSpeed` | 0.3 | Normal movement speed |
| `sprintSpeed` | 0.55 | Sprint speed (requires stamina) |
| `jumpForce` | 0.5 | Initial jump velocity |
| `gravity` | 0.02 | Gravity acceleration per frame |
| `groundY` | 1 | Default ground level |

#### Air Momentum System

When airborne, the player retains horizontal momentum from their last grounded velocity:
- `airControl`: 0.15 factor for directional influence while airborne
- Momentum decays at 99.5% per frame when no input is given
- Full ground control restored on landing

#### Dodge Mechanic

- Cost: 20 stamina
- Duration: 0.3 seconds
- Cooldown: 0.5 seconds
- Grants invulnerability during dodge
- Speed: 1.2 (faster than sprint)
- Direction: Based on current movement input, defaults to backward

#### Parry Mechanic

- Window: 0.2 seconds
- Cooldown: 1.0 seconds
- Successfully parrying negates damage entirely
- Emits `PLAYER_PARRY` event with `{ success: true }`

#### Jetpack

- Fuel: 200 max
- Force: 0.06 per frame
- Fuel cost: 20/sec
- Fuel regen: 30/sec (grounded only)
- Max vertical velocity: 0.35

#### Damage Processing

1. Check invulnerability
2. Check parry window (returns `wasParried: true`)
3. Apply damage type resistance
4. Armor absorbs 70% of remaining damage
5. Minimum 1 damage
6. 0.2s invulnerability after hit

#### Ground Detection (Raycasting)

The player casts a ray downward to detect surfaces:
- Ray origin: player position + 1 unit up
- Direction: straight down
- Length: dynamic based on fall speed
- Detected surfaces: `ground`, `skyPlat_*`, `bridge_seg*`, `step_*`, `rooftop_*`, `mainHighway`, `crossHighway`, `spaceport`

#### Public API

| Method | Description |
|--------|-------------|
| `update(dt?)` | Main update loop |
| `takeDamage(info)` | IDamageable implementation |
| `takeDamageSimple(amount)` | Convenience for Kinetic damage |
| `heal(amount)` | Restore health |
| `addArmor(amount)` | Add armor points |
| `addCredits(amount)` | Add currency |
| `addExperience(amount)` | Add XP, handles leveling |
| `getStats()` | Returns PlayerStats copy |
| `getPosition()` | Player world position |
| `getMesh()` | Player capsule mesh (invisible) |
| `getJetpackFuel()` | Current fuel |
| `getMaxJetpackFuel()` | Max fuel |
| `getPlayerState()` | Current state machine state |
| `setMeleeCallbacks(light, heavy)` | Wire V/B keys to combat system |

#### Leveling

- XP needed per level: `level * 100`
- On level up: +10 maxHealth (full heal), +5 maxStamina (full restore)
- Emits `PLAYER_LEVEL_UP` event

---

### CombatSystem

**File**: `client/src/game/CombatSystem.ts`

Melee combo system with input buffering, hitbox detection, and damage multipliers.

#### Combo Chains

**Light Combo** (V key):

| Step | Name | Damage | Knockback | Duration | Hit Radius |
|------|------|--------|-----------|----------|------------|
| 1 | Jab | 15 | 3 | 0.4s | 3.0 |
| 2 | Cross | 20 | 4 | 0.45s | 3.0 |
| 3 | Uppercut | 30 | 6 | 0.6s | 3.5 |

**Heavy Combo** (B key):

| Step | Name | Damage | Knockback | Duration | Hit Radius |
|------|------|--------|-----------|----------|------------|
| 1 | Slam | 35 | 8 | 0.7s | 4.0 |
| 2 | Sweep | 45 | 10 | 0.8s | 5.0 |

#### Input Buffering

- Buffer window: 0.2 seconds
- If attack input arrives during an active attack, it's buffered and executed when the current attack ends
- Combo resets after `resetTime` (1.5s light, 2.0s heavy) of inactivity

#### Hit Detection

- Hit check occurs 150ms after attack start
- Checks all scene meshes with `metadata.isEnemy` and `metadata.damageable`
- Uses distance check from camera forward + `hitOffset`
- Applies `DamageType.Melee` through `applyDamage()`

#### API

| Method | Description |
|--------|-------------|
| `update(dt)` | Process combo timers and buffered input |
| `onLightAttack()` | Trigger light combo (returns boolean) |
| `onHeavyAttack()` | Trigger heavy combo (returns boolean) |
| `isInAttack()` | Whether currently attacking |
| `setDamageMultiplier(mult)` | Scale all melee damage |
| `dispose()` | Clean up timers |

---

### InventorySystem

**File**: `client/src/game/InventorySystem.ts`

Slot-based inventory with item stacking.

#### Item Types

```ts
enum ItemType {
  Weapon, Armor, Consumable, Ammo, KeyItem, Currency, Material
}

enum ItemRarity {
  Common, Uncommon, Rare, Epic, Legendary
}
```

#### ItemDefinition

```ts
interface ItemDefinition {
  id: string;
  name: string;
  type: ItemType;
  rarity: ItemRarity;
  maxStack: number;
  value: number;
  description: string;
  icon?: string;
  stats?: Record<string, number>;
}
```

#### API

| Method | Description |
|--------|-------------|
| `addItem(item, quantity)` | Add items, returns remaining (overflow) |
| `removeItem(itemId, quantity)` | Remove items, returns success |
| `getSlot(index)` | Get slot contents |
| `getSlots()` | Get all slots |
| `getItemCount(itemId)` | Total count across slots |
| `hasItem(itemId, quantity)` | Check availability |
| `isFull()` | Whether all slots occupied |
| `getMaxSlots()` | Returns max slot count (default 24) |
| `clear()` | Empty all slots |

#### Pre-defined Items (`ITEM_DEFINITIONS`)

- `credits` - Currency (stack 9999)
- `health_pack` - Heals 50 HP (stack 10)
- `armor_shard` - Restores 25 armor (stack 10)
- `plasma_cell` - Energy weapon ammo (stack 200)
- `kinetic_rounds` - Standard ammo (stack 200)
- `rocket_ammo` - Rockets (stack 20)
- `grenade_pack` - Grenades (stack 12)
- `shield_booster` - Doubles armor temporarily (stack 5)
- `damage_amp` - +50% damage for 20s (stack 5)
- `xp_chip` - Bonus 25 XP (stack 50)

---

## Weapon Systems

### WeaponsSystem

**File**: `client/src/game/WeaponsSystem.ts`

Primary weapons (keys 1-6) with projectile physics.

#### Weapons Table

| Key | Type | Name | Damage | Fire Rate (ms) | Ammo | Speed | Spread | Auto |
|-----|------|------|--------|----------------|------|-------|--------|------|
| 1 | pistol | Plasma Pistol | 15 | 300 | 50 | 2.0 | 0.02 | No |
| 2 | rifle | Pulse Rifle | 25 | 100 | 120 | 3.0 | 0.03 | Yes |
| 3 | shotgun | Scatter Blaster | 8 | 800 | 24 | 2.5 | 0.15 | No |
| 4 | rocket | Nova Launcher | 100 | 1500 | 8 | 1.0 | 0 | No |
| 5 | laser | Photon Beam | 40 | 50 | 200 | 10.0 | 0 | Yes |
| 6 | grenade | Fusion Grenades | 80 | 1000 | 6 | 0.5 | 0 | No |

#### Projectile Behavior

- Shotgun fires 8 pellets per shot
- Grenades arc downward (gravity applied)
- Rockets and grenades are explosive with blast radius
- Hit detection: distance < 1.5 units to enemy mesh
- Projectile lifetime: 3000ms or until ground hit

#### Explosion System

- Creates expanding sphere visual
- Spawns point light
- Explosive weapons check AoE against all enemies
- Damage falloff: `1 - (distance / radius)`

#### Controls

- Mouse wheel: Cycle weapons
- Keys 1-6: Direct weapon select
- R: Reload (restores to max ammo)
- Left mouse: Fire / hold for automatic weapons

#### API

| Method | Description |
|--------|-------------|
| `update(enemies)` | Process projectiles, returns hit list `{ hitEnemy, damage }[]` |
| `selectWeapon(type)` | Switch weapon |
| `addAmmo(type, amount)` | Add ammo to weapon |
| `getCurrentWeapon()` | Get active weapon data |
| `setOnAmmoChange(cb)` | Callback for UI updates |
| `setOnWeaponChange(cb)` | Callback for weapon switch |

---

### SpecialWeaponsSystem

**File**: `client/src/game/SpecialWeaponsSystem.ts`

Four special weapons with unique mechanics, upgradeable to level 3.

#### Special Weapons Table

| Key | Name | Base Damage | Cooldown | Ammo | Mechanic |
|-----|------|-------------|----------|------|----------|
| 7 | Homing Missile | 60 | 2.0s | 10 | Tracking projectile, AoE explosion |
| 8 | Tracking Energy Burst | 45 | 1.5s | 15 | Homing energy sphere, chain lightning at L2+ |
| 9 | Bomb | 120 | 4.0s | 5 | Timed explosive, cluster bombs at L2+ |
| 0 | Combat Drone | 20 | 10.0s | 3 | Autonomous drone, shield at L3 |

#### Upgrade System

Each weapon has 3 upgrade levels. Per-level effects:

**Homing Missile (7)**:
- L1: Single missile, tracking speed 0.05
- L2: +40% damage, faster tracking
- L3: Fires 3 missiles simultaneously

**Energy Burst (8)**:
- L1: Single tracking sphere
- L2: Chain lightning to 3 nearby enemies (40% damage)
- L3: Larger AoE, faster tracking

**Bomb (9)**:
- L1: 3s fuse, 6 unit radius
- L2: Spawns 4 cluster bombs on detonation
- L3: 1.5s fuse, larger radius

**Combat Drone (0)**:
- L1: 30s duration, auto-fire at enemies
- L2: 45s duration, faster fire rate
- L3: 60s duration + shield sphere around player

#### Projectile Types

```ts
type: "missile" | "energy" | "bomb" | "droneProjectile"
```

#### API

| Method | Description |
|--------|-------------|
| `update(dt, enemies, playerPos)` | Process all projectiles/drones, returns hits |
| `fireSpecialWeapon(slot)` | Fire weapon on slot 7/8/9/0 |
| `upgradeWeapon(slot)` | Upgrade weapon level (returns boolean) |
| `getSpecialWeapon(slot)` | Get weapon data |
| `getActiveSpecialWeapons()` | Get all weapons status for UI |
| `setOnSpecialWeaponChange(cb)` | UI update callback |
| `dispose()` | Clean up event listeners and meshes |

---

### BeamSabreSystem

**File**: `client/src/game/BeamSabreSystem.ts`

Toggle melee weapon with slash combos and energy wave projectiles.

#### Activation

- Toggle with T key (handled in `Game.tsx`)
- Renders a glowing cyan energy blade attached to the camera

#### Slash Combo

When attack is triggered:
1. Performs N consecutive slashes (based on level)
2. Each slash checks hitbox (3.5 unit radius, 2.5 unit offset)
3. After all slashes, launches energy wave projectile

#### Level Progression

| Level | Slash Damage | Wave Damage | Slash Count | Wave Width | Wave Speed | Cooldown |
|-------|-------------|-------------|-------------|------------|------------|----------|
| 1 | 25 | 40 | 2 | 3 | 30 | 0.8s |
| 2 | 35 | 60 | 2 | 4 | 35 | 0.7s |
| 3 | 50 | 80 | 3 | 5 | 40 | 0.6s |
| 4 | 65 | 100 | 4 | 6 | 45 | 0.5s |
| 5 | 85 | 150 | 5 | 8 | 50 | 0.4s |

#### Energy Wave Features

- L3+: Piercing (passes through enemies)
- L4+: Fires 2 waves
- L5: AoE splash on hit (60% damage to nearby)

#### Blade Visuals

- Color changes at L3: cyan -> purple
- GlowLayer applied for bloom effect
- Blade follows camera with quaternion rotation

#### API

| Method | Description |
|--------|-------------|
| `toggle()` | Enable/disable beam sabre |
| `attack()` | Start slash sequence |
| `upgrade()` | Increase level (max 5) |
| `update(dt, enemies?)` | Update blade position and energy waves |
| `active` (getter) | Whether sabre is active |
| `getLevel` (getter) | Current level |
| `getDamage` (getter) | Current slash damage |
| `dispose()` | Clean up all meshes and timers |

---

## Defense Systems

### ArmorSystem

**File**: `client/src/game/ArmorSystem.ts`

Armor equipment with elemental infusion.

#### Armor Slots

4 slots: `helmet`, `chest`, `legs`, `boots`

#### Armor Tiers (per slot)

| Tier | Level | Rarity | Defense (chest) | Health Bonus |
|------|-------|--------|----------------|-------------|
| Iron | 1 | Common | 8 | 15 |
| Steel | 2 | Uncommon | 16 | 30 |
| Titanium | 3 | Rare | 28 | 50 |
| Plasma | 4 | Epic | 42 | 75 |
| Quantum | 5 | Legendary | 60 | 100 |

#### Elemental Effects

| Element | Strength Bonus | Defense Bonus | Poison DPS | Duration | Special |
|---------|---------------|--------------|-----------|----------|---------|
| Fire | +15% | +5% | 8 | 3s | Burn on melee hit |
| Ice | +5% | +15% | 4 | 5s | Slow enemies |
| Electric | +10% | +10% | 12 | 2s | Chain lightning on kill |
| DarkEnergy | +20% | +0% | 15 | 4s | Life steal |
| Insectoid | +8% | +20% | 6 | 6s | Health regen |

#### Damage Reduction Formula

```
baseReduction = totalDefense / (totalDefense + 100)
reducedDamage = incomingDamage * (1 - baseReduction)
reducedDamage *= (1 - elementalDefenseBonus)
finalDamage = max(1, reducedDamage)
```

#### API

| Method | Description |
|--------|-------------|
| `equipArmor(piece)` | Equip armor, returns displaced piece |
| `unequipArmor(slot)` | Remove armor from slot |
| `getEquippedArmor()` | Map of equipped pieces |
| `getTotalDefense()` | Sum of all defense |
| `getTotalHealthBonus()` | Sum of all health bonuses |
| `getTotalStaminaBonus()` | Sum of all stamina bonuses |
| `setElement(element)` | Set active element for all armor |
| `getActiveElement()` | Current element |
| `getElementalEffect()` | Current element's effect data |
| `calculateDamageReduction(damage, type)` | Compute reduced damage |
| `getModifiedOutgoingDamage(baseDamage)` | Apply strength bonus |
| `getPoisonEffect()` | Get poison data if element active |

---

### CraftingSystem

**File**: `client/src/game/CraftingSystem.ts`

Recipe-based crafting using `InventorySystem` materials.

#### Crafting Materials

| ID | Name | Rarity | Stack | Value |
|----|------|--------|-------|-------|
| `scrap_metal` | Scrap Metal | Common | 99 | 5 |
| `energy_core` | Energy Core | Uncommon | 50 | 25 |
| `nano_fiber` | Nano Fiber | Uncommon | 50 | 20 |
| `circuit_board` | Circuit Board | Uncommon | 50 | 30 |
| `bio_sample` | Bio Sample | Rare | 30 | 40 |
| `crystal_shard` | Crystal Shard | Rare | 30 | 50 |
| `dark_matter` | Dark Matter | Legendary | 10 | 200 |

#### Recipe Categories

- **Weapon**: Damage Mod, Fire Rate Mod, Ammo Capacity Mod
- **Armor**: Basic Helmet/Chestplate/Leggings/Boots
- **Base**: Wall, Floor Panel, Auto-Turret, Power Generator, Storage Crate, Medical Bay
- **Consumable**: Advanced Health Pack, Shield Battery, Damage Booster
- **Upgrade**: Beam Sabre Core (requires L8, dark matter)

#### Base Structures

| Structure | Type | Health | Defense | Materials |
|-----------|------|--------|---------|-----------|
| Reinforced Wall | wall | 500 | 10 | 8 Scrap Metal |
| Floor Platform | floor | 400 | 5 | 6 Scrap Metal |
| Auto-Turret | turret | 300 | 5 | 12 Scrap + 4 Circuit + 2 Energy |
| Power Generator | generator | 350 | 3 | 10 Scrap + 3 Energy + 2 Circuit |
| Storage Crate | storage | 250 | 2 | 6 Scrap + 2 Nano |
| Medical Bay | medbay | 400 | 4 | 8 Scrap + 5 Bio + 3 Circuit |

Structures can be upgraded 3 times. Each upgrade costs 75% * (level+1) of base cost.

#### API

| Method | Description |
|--------|-------------|
| `getRecipes(category?)` | List recipes, optionally filtered |
| `canCraft(recipeId)` | Check if materials available |
| `craft(recipeId)` | Consume materials, produce item |
| `getBaseStructures()` | List structure templates |
| `canBuildStructure(id)` | Check build affordability |
| `buildStructure(id)` | Build structure |
| `upgradeStructure(index)` | Upgrade placed structure |
| `getCraftQueue()` | Get in-progress crafts |
| `getBuiltStructures()` | Get placed structures |

---

## Enemy Systems

### EnemySystem

**File**: `client/src/game/EnemySystem.ts`

Manages enemy spawning, wave progression, and AI updates.

#### Enemy Types

| Type | Health | Damage | Speed | Detection | Attack Range | Credits | XP |
|------|--------|--------|-------|-----------|-------------|---------|-----|
| drone | 50 | 8 | 8 | 25 | 15 | 10 | 15 |
| soldier | 100 | 15 | 4 | 20 | 5 | 20 | 25 |
| heavy | 300 | 25 | 2 | 15 | 8 | 50 | 50 |
| insectoid | 80 | 20 | 6 | 18 | 4 | 30 | 20 |
| hybrid | 1000 | 40 | 3 | 30 | 10 | 100 | 200 |

#### Spawn Rules

- Max enemies: starts at 20, increases by 2 per wave (cap 50)
- Spawn interval: starts at 5000ms, decreases by 200ms per wave (min 2000ms)
- Spawn distance: 30-80 units from player
- Type selection by wave:
  - Wave 1+: soldier (50%), drone (20%), insectoid (15%)
  - Wave 3+: heavy unlocks (15% chance)
  - Wave 5+: hybrid unlocks (5% chance)

#### Wave System

- Waves advance every 60 seconds
- Each wave: enemy stats scale by `1 + (wave-1) * 0.2`
- Emits `WAVE_STARTED` event

#### Robot Mesh Mapping

| Enemy Type | Robot Preset |
|-----------|-------------|
| drone | JetWarden |
| soldier | ScoutPrime |
| heavy | TankTitan |
| insectoid | InsectoidStalker |
| hybrid | HybridOmega |

#### API

| Method | Description |
|--------|-------------|
| `update(playerPos, deltaTime)` | Update all enemies, returns `{ damage, hits }` |
| `spawnEnemy(playerPos)` | Spawn one enemy near player |
| `damageEnemy(mesh, damage)` | Deal damage to enemy by mesh |
| `getEnemyMeshes()` | Get alive enemy meshes |
| `getEnemyCount()` | Count alive enemies |
| `nextWave()` | Advance wave number |
| `getWaveNumber()` | Current wave |

### EnemyUnit

Individual enemy entity implementing `IDamageable`.

#### AI States

```ts
type EnemyAIState = "idle" | "patrol" | "chase" | "attack" | "stunned" | "dead";
```

#### AI State Transitions

| State | Transitions To |
|-------|---------------|
| idle | patrol, chase, stunned, dead |
| patrol | idle, chase, stunned, dead |
| chase | patrol, attack, stunned, dead |
| attack | chase, stunned, dead |
| stunned | chase, idle, dead |
| dead | (terminal) |

#### AI Behavior

- **Idle**: Wait for `idleTimer` (1-3s), then transition to patrol. Check for player.
- **Patrol**: Move toward random patrol point (10-20 unit radius from origin). Transition to idle when reached. Check for player.
- **Chase**: Move toward player at `chaseSpeed`. Attack if within `attackRange`. Disengage if player > 1.5x `detectionRange`.
- **Attack**: Face player, deal damage on `attackCooldown` timer. Return to chase if player moves out of range.
- **Stunned**: Stun timer (1.5s), then resume chase.
- **Dead**: Terminal state. Death effect, mesh disposal after 2s.

#### Drone Special Behavior

Drones hover at y=5 with sinusoidal bobbing.

#### Death Drops

On death, emits `ENEMY_KILLED` with `credits` and `experience` values.

---

## World Systems

### CityGenerator

**File**: `client/src/game/CityGenerator.ts`

Procedural generation of the 1200x1200 game world.

#### World Layout

```
              North (+Z)
                |
    NW Mountains | NE Mountains
                |
   Residential  |  Downtown  |  Industrial
  (-220 to -120)|(-100 to 100)|(120 to 220)
                |
    -----------Highway-----------
                |
              River
                |
    SW Mountains | SE Mountains
                |
              South (-Z)
```

#### Generated Zones

| Zone | Method | Description |
|------|--------|-------------|
| Ground | `createGround()` | 1200x1200 plane, dark metallic |
| River | `createRiver()` | Sinusoidal path with animated water shader |
| Downtown | `createDowntown()` | Skyscrapers 30-150 height, cell-shaded |
| Industrial | `createIndustrialZone()` | Factories with chimneys |
| Residential | `createResidentialBlocks()` | Smaller buildings |
| Highways | `createHighways()` | Elevated roads with pillars |
| Neon Lights | `createNeonLights()` | 70 floating neon signs |
| Spaceports | `createSpaceports()` | 4 circular platforms with towers |
| Street Lights | `createStreetLights()` | Poles with colored lamps |
| Mountains | `createMountainZone()` | 4 ranges with peaks, snow, boulders |
| Nature | `createNatureZone()` | Trees, bushes, grass, ponds |
| Sky Cities | `createSkyCities()` | 12 floating platforms (y=40-250) |
| Sky Bridges | `createSkyBridges()` | Segmented walkways between platforms |
| Outer Districts | `createOuterDistricts()` | 5 additional city areas |

#### Cell-Shade Material

Custom GLSL shader used for buildings:
- 5-band toon shading based on light direction
- Rim lighting for edge glow
- Outline detection via normal-view dot product
- Panel detail lines from position-based patterns

```glsl
// Toon bands
if (intensity > 0.85) cellShade = 1.0;
else if (intensity > 0.6) cellShade = 0.75;
else if (intensity > 0.35) cellShade = 0.55;
else if (intensity > 0.1) cellShade = 0.35;
else cellShade = 0.2;
```

#### Water Shader

Custom vertex/fragment shader for the river:
- 3-layer wave animation (different frequencies)
- Deep/shallow color blending
- Foam on wave peaks
- Sparkle highlights
- Neon reflections

#### Seeded Random

All procedural generation uses `seededRandom(seed)` for deterministic layout:
```ts
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}
```

#### API

| Method | Description |
|--------|-------------|
| `generateCity()` | Generate the entire world |

---

### ChestSystem

**File**: `client/src/game/ChestSystem.ts`

Loot chests scattered around the world.

#### Loot Types

| Type | Probability | Amount Range |
|------|------------|-------------|
| credits | 35% | 50-200 |
| health | 20% | 25-75 |
| armor | 15% | 20-60 |
| ammo | 20% | 20-50 (random weapon type) |
| weapon_upgrade | 10% | 1 |

#### Chest Behavior

- Spawned at random positions within 400x300 area
- Golden box with lid and glowing point light
- Light pulses with sine wave
- Auto-opens when player is within 2 units
- Lid animates open
- Loot effect particles + burst light
- Chest despawns after 2 seconds

#### API

| Method | Description |
|--------|-------------|
| `spawnChests(count)` | Create N chests in world |
| `update(playerPos)` | Check proximity, open nearby chests |
| `setOnLootCollected(cb)` | Set loot pickup callback |
| `getChestCount()` | Count remaining closed chests |

---

## Companion Systems

### CompanionSystem

**File**: `client/src/game/CompanionSystem.ts`

Manages ally and pet companion NPCs that follow the player.

#### Companion Types

| Type | Follow Dist | Can Attack | Can Heal | Health |
|------|------------|-----------|---------|--------|
| ally | 6 | Yes (12 dmg, 2s CD) | No | 150 |
| pet | 3 | No | Yes (2 HP, 10s CD) | 50 |

#### Special Companions

- **MedicDrone**: Ally that heals instead of attacking (8 HP, 6s CD)

#### Movement

- Companions orbit the player at `followDistance`
- Orbit angle advances over time
- Pets bob up and down sinusoidally
- Position lerped toward target for smooth following

#### Combat (Allies)

- Auto-targets nearest enemy within `attackRange` (18 units)
- Fires colored projectile (speed 25, lifetime 3s)
- Hit detection: distance < 2 units

#### Healing (Pets)

- Heals player periodically
- Creates particle effect at player position

#### API

| Method | Description |
|--------|-------------|
| `addCompanion(presetName, playerPos)` | Add companion (max 5, no duplicates) |
| `update(dt, playerPos, enemies)` | Update all companions, returns `{ healed, attackHits }` |
| `getCompanions()` | Get companion status list |
| `getCompanionCount()` | Active companion count |
| `getCollectedNames()` | Set of collected preset names |
| `damageCompanion(index, amount)` | Damage a companion |
| `dispose()` | Clean up all companion meshes |

---

## Robot Construction

### RobotDesigner

**File**: `client/src/game/RobotDesigner.ts`

Type definitions for robot visual configuration.

#### RobotArchetype

```ts
type RobotArchetype = "scout" | "brute" | "flyer" | "tank" | "insectoid" | "hybrid" | "pet" | "ally";
```

#### RobotStyle Properties

| Category | Properties |
|----------|-----------|
| Base | `archetype`, `scale` |
| Torso | `torsoWidth`, `torsoHeight`, `torsoDepth` |
| Head | `headSize`, `headShape` (box/sphere/cylinder/cone) |
| Arms | `armLength`, `armThickness`, `armStyle` (cylinder/box/tapered) |
| Legs | `legLength`, `legThickness`, `legStyle` (box/digitigrade/hoverpads) |
| Pads | `shoulderPadSize`, `hipPadSize` |
| Wings | `hasWings`, `wingSpan`, `wingAngle` |
| Cannons | `hasCannons`, `cannonSize` |
| Backpack | `hasBackpack`, `backpackSize` |
| Visor | `hasVisor`, `visorStyle` (slit/round/full) |
| Horns | `hasHorns`, `hornLength` |
| Tail | `hasTail`, `tailLength`, `tailSegments` |
| Antennae | `hasAntennae`, `antennaLength` |
| Shield | `hasShield`, `shieldSize` |
| Plating | `extraPlating` (0-3), `asymmetry` (0-1) |
| Colors | `primary`, `secondary`, `emissive` (Color3) |

#### Utility Functions

| Function | Description |
|----------|-------------|
| `createDefaultStyle(archetype)` | Create a default style for an archetype |
| `serializeRobot(desc)` | Serialize to JSON string |
| `deserializeRobot(json)` | Deserialize from JSON string |
| `validateStyle(style)` | Clamp all values to valid ranges |

---

### RobotFactory

**File**: `client/src/game/RobotFactory.ts`

Procedurally generates robot meshes from `RobotDescriptor` configurations.

#### Mesh Generation

Creates a multi-part robot under a `TransformNode` root:
- **Primary parts**: Torso, head, upper/lower arms, thighs, shins (merged into one mesh)
- **Secondary parts**: Chest plate, shoulder pads, hip, hands, feet, side panels, horns, wings, backpack, shield (merged)
- **Emissive parts**: Visor, antenna tips, wing tips, cannon muzzles, core glow, shield glow (merged)

Each group uses a shared `StandardMaterial` with cached lookup.

#### Material System

3 material types per robot:
- **Primary**: `diffuseColor = color`, `emissiveColor = color * 0.15`
- **Secondary**: Same as primary
- **Emissive**: `emissiveColor = color`, `diffuseColor = near-black`

Materials are cached by color values to avoid duplicates.

#### Leg Styles

- **box**: Standard humanoid legs (thigh + shin + foot)
- **digitigrade**: Reverse-knee animal legs with angled shin
- **hoverpads**: Floating disc pads with struts

#### API

| Method | Description |
|--------|-------------|
| `createRobot(desc, position)` | Generate robot mesh, returns `TransformNode` |
| `dispose()` | Dispose all cached materials |

---

### RobotPresets

**File**: `client/src/game/RobotPresets.ts`

Pre-defined robot configurations organized by faction.

#### Enemy Presets (`ROBOT_PRESETS`)

| Name | Archetype | Scale | Key Features |
|------|-----------|-------|-------------|
| ScoutPrime | scout | 1.0 | Basic blue bot, slit visor |
| BruteForge | brute | 1.1 | Bulky red, horns, cannons, extra plating |
| JetWarden | flyer | 1.0 | Wings, hoverpads, backpack, purple emissive |
| TankTitan | tank | 1.2 | Largest, shield, horns, 3 extra plates, green |
| InsectoidStalker | insectoid | 0.9 | Digitigrade, wings, tail, antennae, organic green |
| HybridOmega | hybrid | 1.4 | All features, cone head, wings+tail+shield, purple |

#### Ally Presets (`ALLY_PRESETS`)

| Name | Scale | Key Features |
|------|-------|-------------|
| GuardianUnit | 1.0 | Shield, cannons, backpack, cyan |
| MedicDrone | 0.8 | Hoverpads, antennae, backpack, green emissive |
| ScoutCompanion | 0.85 | Digitigrade, cannons, green |

#### Pet Presets (`PET_PRESETS`)

| Name | Scale | Key Features |
|------|-------|-------------|
| SparkPup | 0.45 | Tail, antennae, golden yellow |
| NeonCat | 0.4 | Digitigrade, horns, tail, purple |
| HoverOrb | 0.35 | Wings, hoverpads, full visor, cyan orb |

---

## UI Layer

### Game.tsx

**File**: `client/src/game/Game.tsx`

The main React component that orchestrates all game systems.

#### Game Phases

```ts
type GamePhase = "menu" | "playing" | "paused" | "gameover";
```

#### Initialization Flow

1. Create `BabylonEngine` from canvas
2. Create `CityGenerator` and generate world
3. Create `PlayerController` with scene + camera
4. Create `WeaponsSystem` with scene + camera
5. Create `CombatSystem` with scene + camera
6. Wire player melee callbacks to combat system
7. Create `SpecialWeaponsSystem`
8. Create `BeamSabreSystem`
9. Create `InventorySystem`
10. Create `ArmorSystem`
11. Create `CraftingSystem` (with inventory)
12. Create `CompanionSystem`, add default companions
13. Load swarm drone GLB model
14. Create `EnemySystem`, spawn initial enemies
15. Create `ChestSystem`, spawn chests
16. Register EventBus listeners
17. Start render loop

#### Render Loop (per frame)

1. `player.update(dt)`
2. `combatSystem.update(dt)`
3. `weapons.update(enemyMeshes)` -> process hits
4. `specialWeapons.update(dt, enemyMeshes, playerPos)` -> process hits
5. `beamSabre.update(dt, enemyMeshes)`
6. `companionSystem.update(dt, playerPos, enemyMeshes)` -> heal + hits
7. `enemySystem.update(playerPos, deltaTime)` -> enemy attacks
8. `chestSystem.update(playerPos)` -> loot pickups
9. Update React state for UI
10. Check game over (health <= 0)
11. Wave timer (60s per wave)

#### State Management

All game state is managed through React `useState` hooks and passed to `GameUI` as props:
- `stats` (PlayerStats)
- `currentWeapon`, `ammo`, `maxAmmo`
- `enemyCount`, `waveNumber`, `chestCount`
- `jetpackFuel`, `maxJetpackFuel`
- `playerState`
- `comboInfo`
- `specialWeaponInfo`
- `beamSabreActive`, `beamSabreLevel`
- `activeElement`, `armorDefense`
- `companionInfo`

---

### GameUI.tsx

**File**: `client/src/game/GameUI.tsx`

HUD overlay rendered on top of the 3D canvas.

#### UI Panels

| Position | Content |
|----------|---------|
| Top-Left | Health bar, Armor bar, Stamina bar, Jetpack bar, Credits, Level, Element badge, Player state |
| Top-Right | Enemy count, Wave number, Chest count, Combo indicator, Beam Sabre status |
| Bottom-Left | Current weapon name, Ammo bar |
| Bottom-Left (offset) | Special weapons status (ammo, cooldowns) |
| Bottom-Left (above) | Companion list with health bars |
| Bottom-Right | Controls reference |
| Bottom-Center | Weapon selector bar (1-6) |
| Center | Crosshair |
| Upper-Center | Message popup (animated) |

#### Element Color Mapping

| Element | Text Color | Border | Background |
|---------|-----------|--------|-----------|
| Fire | orange-400 | orange-500 | orange-900/50 |
| Ice | sky-400 | sky-500 | sky-900/50 |
| Electric | yellow-300 | yellow-400 | yellow-900/50 |
| DarkEnergy | purple-400 | purple-500 | purple-900/50 |
| Insectoid | lime-400 | lime-500 | lime-900/50 |

---

### MainMenu.tsx

**File**: `client/src/game/MainMenu.tsx`

Start screen with story text, start button, and controls reference.

- Animated star field background
- Gradient title text
- Story lore paragraphs
- "START MISSION" button triggers `onStart` callback
- System status indicators (AI, Threat, Weapons)

---

## Data Flow

### Damage Flow (Player -> Enemy)

```
Player Input (LMB / V / B / T)
  |
  v
WeaponsSystem / CombatSystem / BeamSabreSystem
  |
  v
Hit Detection (distance check or raycast)
  |
  v
ArmorSystem.getModifiedOutgoingDamage(baseDamage)  [strength bonus]
  |
  v
EnemySystem.damageEnemy(mesh, damage)
  |
  v
EnemyUnit.takeDamage(DamageInfo)
  |
  v
Apply defense reduction, resistance
  |
  v
Update health, check death
  |
  v
EventBus: ENEMY_DAMAGED or ENEMY_KILLED
  |
  v
Game.tsx: player.addCredits(), player.addExperience()
```

### Damage Flow (Enemy -> Player)

```
EnemyUnit.updateAttack() returns damage > 0
  |
  v
EnemySystem.update() accumulates total damage
  |
  v
Game.tsx receives { damage, hits }
  |
  v
ArmorSystem.calculateDamageReduction(damage, type)
  |
  v
PlayerController.takeDamageSimple(reducedDamage)
  |
  v
Check parry -> Check invulnerability -> Apply resistance
  |
  v
Armor absorbs 70% -> Apply remainder to health
  |
  v
EventBus: PLAYER_DAMAGED or PLAYER_DIED
  |
  v
GameUI updates health bars
```

### Companion Healing Flow

```
CompanionSystem.update()
  |
  v
Pet companion healTimer expires
  |
  v
Returns { healed: amount }
  |
  v
Game.tsx: player.heal(amount)
  |
  v
EventBus: PLAYER_HEALED
```

---

## Controls Reference

### Movement

| Key | Action |
|-----|--------|
| W | Move forward |
| A | Move left |
| S | Move backward |
| D | Move right |
| Shift | Sprint (costs stamina) |
| Space | Jump (grounded) / Jetpack (airborne, hold) |
| Q | Dodge roll (20 stamina, i-frames) |

### Combat

| Key | Action |
|-----|--------|
| Left Mouse | Fire weapon (hold for auto) |
| V | Light melee combo |
| B | Heavy melee combo |
| F | Parry |
| T | Toggle Beam Sabre |

### Weapons

| Key | Weapon |
|-----|--------|
| 1 | Plasma Pistol |
| 2 | Pulse Rifle |
| 3 | Scatter Blaster |
| 4 | Nova Launcher |
| 5 | Photon Beam |
| 6 | Fusion Grenades |
| 7 | Homing Missile (special) |
| 8 | Tracking Energy Burst (special) |
| 9 | Bomb (special) |
| 0 | Combat Drone (special) |
| R | Reload |
| Scroll | Cycle weapons |

### Camera

| Input | Action |
|-------|--------|
| Mouse Move | Look around |
| Click Canvas | Enable pointer lock |

---

## How to Extend

### Adding a New Enemy Type

1. **Define config** in `ENEMY_CONFIGS` (`EnemySystem.ts`):
   ```ts
   myEnemy: {
     maxHealth: 150, attackDamage: 18, defense: 8,
     movementSpeed: 5, attackCooldown: 1.8,
     knockbackForce: 350, experienceValue: 30,
     detectionRange: 22, chaseRange: 32,
     attackRange: 6, patrolSpeed: 0.07,
     chaseSpeed: 0.11, credits: 25,
   },
   ```

2. **Add to EnemyType union**:
   ```ts
   export type EnemyType = "drone" | "soldier" | ... | "myEnemy";
   ```

3. **Create a robot preset** in `RobotPresets.ts` or map to existing one in `createEnemyMesh()`.

4. **Add spawn logic** in `selectEnemyType()`.

### Adding a New Weapon

1. **Add to WeaponType union** in `WeaponsSystem.ts`.
2. **Define weapon stats** in `initializeWeapons()`.
3. **Add projectile visual** in `createProjectile()` switch.
4. **Add key binding** in `setupControls()`.
5. **Update GameUI** weapon selector bar.

### Adding a New Armor Piece

1. **Add to `ARMOR_DEFINITIONS`** in `ArmorSystem.ts`.
2. **Add crafting recipe** in `CraftingSystem.ts` (optional).

### Adding a New Element

1. **Add to `ElementType` enum** in `ArmorSystem.ts`.
2. **Define effects** in `ELEMENTAL_DEFINITIONS`.
3. **Add color mapping** in `ELEMENT_COLORS` in `GameUI.tsx`.

### Adding a New Companion

1. **Create preset** in `ALLY_PRESETS` or `PET_PRESETS` in `RobotPresets.ts`.
2. **Add special behavior** in `CompanionSystem.addCompanion()` if needed.
3. **Summon in Game.tsx**: `companionSystem.addCompanion("PresetName", playerPos)`.

### Adding a New Crafting Recipe

1. **Add recipe** to `RECIPES` array in `CraftingSystem.ts`:
   ```ts
   {
     id: "my_item", name: "My Item", category: "weapon",
     materials: [{ materialId: "scrap_metal", quantity: 10 }],
     result: { itemId: "my_item", quantity: 1 },
     craftTime: 5, requiredLevel: 3,
   },
   ```

2. **Ensure result item exists** in `ITEM_DEFINITIONS` or `CRAFTING_MATERIALS`.

### Adding a New Event

1. **Add constant** to `GameEvents` in `EventBus.ts`.
2. **Emit** from the relevant system.
3. **Subscribe** in `Game.tsx` or wherever needed.

### Adding New World Geometry

1. **Add method** to `CityGenerator.ts` (e.g., `createMyZone()`).
2. **Call** from `generateCity()`.
3. **Use `seededRandom()`** for deterministic placement.
4. **Name meshes** appropriately if they should be walkable (add to PlayerController raycast filter).

### Making Surfaces Walkable

Add the mesh name pattern to the raycast predicate in `PlayerController.updatePhysics()`:
```ts
return n === "ground" || n.startsWith("skyPlat_") || ... || n === "myNewSurface";
```

### Adding UI Elements

1. **Add state** in `Game.tsx` (useState hook).
2. **Update state** in the render loop.
3. **Pass as prop** to `GameUI`.
4. **Render** in `GameUI.tsx` in appropriate panel position.

---

## Editing Game Parameters

Game balance parameters are centralized throughout the codebase. Here's where to find and modify them:

### Player Parameters

**File**: `client/src/game/PlayerController.ts`

| Parameter | Location | Purpose | Default |
|-----------|----------|---------|---------|
| `walkSpeed` | Line ~40 | Normal movement speed | 0.3 |
| `sprintSpeed` | Line ~41 | Sprint movement speed | 0.55 |
| `jumpForce` | Line ~42 | Jump velocity | 0.5 |
| `gravity` | Line ~43 | Gravity acceleration per frame | 0.02 |
| `dodgeCost` | Line ~52 | Stamina cost per dodge | 20 |
| `dodgeDuration` | Line ~53 | Duration of dodge invulnerability | 0.3 |
| `dodgeCooldown` | Line ~54 | Time before next dodge | 0.5 |
| `parryWindow` | Line ~57 | Duration of parry active window | 0.2 |
| `parryCooldown` | Line ~58 | Time before next parry | 1.0 |
| `jetpackForce` | Line ~61 | Upward force per frame | 0.06 |
| `jetpackFuelCost` | Line ~62 | Fuel burn per second | 20 |
| `jetpackRegenRate` | Line ~63 | Fuel regeneration per second (grounded) | 30 |
| `maxJetpackFuel` | Line ~64 | Maximum jetpack fuel | 200 |
| `invulnerabilityTime` | Line ~68 | Invulnerability window after hit | 0.2 |
| `armorDamageAbsorption` | Line ~451 (in takeDamage) | Armor absorbs this % of damage | 0.7 (70%) |
| `minimumDamage` | Line ~460 | Minimum damage allowed (prevents 0 damage) | 1 |

### Enemy Parameters

**File**: `client/src/game/EnemySystem.ts`

Enemy difficulty is configured in `ENEMY_CONFIGS` object. Example - Drone enemy:

```ts
drone: {
  maxHealth: 80,           // Hit points
  attackDamage: 12,        // Damage per hit
  defense: 4,              // Defense reduction %
  movementSpeed: 4,        // Move speed multiplier
  attackCooldown: 2.0,     // Seconds between attacks
  knockbackForce: 300,     // Knockback velocity
  experienceValue: 15,     // XP dropped on death
  detectionRange: 20,      // Distance to spot player
  chaseRange: 30,          // Distance to stop chasing
  attackRange: 5,          // Distance to attack from
  patrolSpeed: 0.05,       // Patrol movement speed
  chaseSpeed: 0.10,        // Chase movement speed
  credits: 20,             // Currency dropped
},
```

### Wave & Spawning

**File**: `client/src/game/EnemySystem.ts`

| Parameter | Location | Purpose |
|-----------|----------|---------|
| `baseSpawnCount` | `spawnEnemy()` | Initial enemies per wave |
| `initialEnemyCount` | `Game.tsx` line ~352 | Enemies spawned at start (usually 5) |
| `waveTimer` | `Game.tsx` line ~469 | Duration before next wave (60000ms = 60s) |
| Wave multiplier | `selectEnemyType()` logic | Difficulty increases with wave number |

### Weapon Parameters

**File**: `client/src/game/WeaponsSystem.ts`

Weapon stats are in the `initializeWeapons()` method:

```ts
// Example: Plasma Pistol (key 1)
{
  name: "Plasma Pistol",
  type: "pistol",
  damage: 15,              // Base damage
  fireRate: 300,           // Milliseconds between shots
  ammo: 50,                // Current ammo
  maxAmmo: 50,             // Magazine size
  speed: 2.0,              // Projectile speed
  spread: 0.02,            // Accuracy spread
  automatic: false,        // Hold to fire
}
```

### Special Weapon Parameters

**File**: `client/src/game/SpecialWeaponsSystem.ts`

Each special weapon (keys 7-0) has cooldown, damage, and upgrade properties:

```ts
// Level 1-3 multipliers
const upgradeLevels = {
  7: { 1: { dmgMult: 1.0, cooldown: 2.0 }, 2: { dmgMult: 1.4, cooldown: 1.8 }, 3: { dmgMult: 1.4, cooldown: 1.6 } },
  8: { 1: { dmgMult: 1.0, cooldown: 1.5 }, 2: { dmgMult: 1.2, cooldown: 1.3 }, 3: { dmgMult: 1.3, cooldown: 1.2 } },
  // ...
};
```

### Armor & Crafting

**File**: `client/src/game/ArmorSystem.ts`

Elemental types and defenses:

```ts
ELEMENTAL_DEFINITIONS: {
  fire: { defense: 8, penalty: -2 },      // +8 fire defense, -2 cold
  ice: { defense: 8, penalty: -2 },       // +8 cold defense, -2 fire
  // ...
}
```

### Leveling & Progression

**File**: `client/src/game/PlayerController.ts`

| Parameter | Location | Purpose |
|-----------|----------|---------|
| `xpFormula` | `addExperience()` | `level * 100` XP needed per level |
| `healthGainPerLevel` | `levelUp()` | +10 maxHealth per level |
| `staminaGainPerLevel` | `levelUp()` | +5 maxStamina per level |

---

## Adding New Robots

Robots are procedurally generated from **robot descriptors** (style configurations). Follow this guide to add new robot types to enemies, allies, or pets.

### Step 1: Create a Robot Style Definition

**File**: `client/src/game/RobotPresets.ts`

Add a new preset to one of the preset objects:

```ts
// Add to ROBOT_PRESETS (for enemies)
export const ROBOT_PRESETS = {
  // ... existing presets ...
  
  MyNewRobot: {
    archetype: "brute",
    scale: 1.0,
    torsoWidth: 20, torsoHeight: 40, torsoDepth: 15,
    headSize: 12, headShape: "box",
    armLength: 30, armThickness: 8, armStyle: "box",
    legLength: 35, legThickness: 10, legStyle: "box",
    shoulderPadSize: 8, hipPadSize: 6,
    hasWings: false, wingSpan: 30, wingAngle: 45,
    hasCannons: true, cannonSize: 4,
    hasBackpack: false, backpackSize: 10,
    hasVisor: true, visorStyle: "slit",
    hasHorns: true, hornLength: 15,
    hasTail: false, tailLength: 20, tailSegments: 4,
    hasAntennae: false, antennaLength: 25,
    hasShield: false, shieldSize: 30,
    extraPlating: 2, asymmetry: 0.3,
    primary: new BABYLON.Color3(0.8, 0.2, 0.2),  // Red
    secondary: new BABYLON.Color3(0.4, 0.1, 0.1), // Dark red
    emissive: new BABYLON.Color3(1.0, 0.4, 0.0),  // Orange glow
  },
};
```

### Step 2: Register in Enemy System

**File**: `client/src/game/EnemySystem.ts`

Add config in `ENEMY_CONFIGS` object:

```ts
myNewRobot: {
  maxHealth: 200,
  attackDamage: 22,
  defense: 10,
  movementSpeed: 5,
  attackCooldown: 1.5,
  knockbackForce: 400,
  experienceValue: 40,
  detectionRange: 25,
  chaseRange: 35,
  attackRange: 6,
  patrolSpeed: 0.08,
  chaseSpeed: 0.12,
  credits: 50,
},
```

### Step 3: Register Type & Spawn Logic

In `EnemySystem.ts`:

```ts
// Add to EnemyType union
export type EnemyType = "drone" | "soldier" | ... | "myNewRobot";

// In selectEnemyType() method, add spawn logic:
if (wave >= 15) {
  types.push({ type: "myNewRobot", weight: wave >= 20 ? 0.15 : 0.05 });
}
```

### Step 4: Add to Mesh Factory

**File**: `client/src/game/EnemySystem.ts`

In `createEnemyMesh()` method, map to the preset:

```ts
case "myNewRobot":
  return RobotFactory.createRobot(ROBOT_PRESETS.MyNewRobot, position);
```

### Step 5: Test

Start game, progress waves until your robot spawns. Adjust stats in `ENEMY_CONFIGS` for balance.

---

## Editing Robot Designs

All robot visual properties are controlled by **RobotStyle** objects. Here's how to customize robot appearance.

### Robot Style Properties Reference

**File**: `client/src/game/RobotDesigner.ts`

```ts
interface RobotStyle {
  // Base
  archetype: RobotArchetype;    // "scout" | "brute" | "flyer" | "tank" | "insectoid" | "hybrid"
  scale: number;                // Size multiplier (0.5 - 2.0)
  
  // Torso
  torsoWidth: number;           // 15 - 40
  torsoHeight: number;          // 30 - 60
  torsoDepth: number;           // 10 - 30
  
  // Head
  headSize: number;             // 8 - 20
  headShape: "box" | "sphere" | "cylinder" | "cone";
  
  // Arms
  armLength: number;            // 20 - 50
  armThickness: number;         // 4 - 12
  armStyle: "cylinder" | "box" | "tapered";
  
  // Legs
  legLength: number;            // 25 - 50
  legThickness: number;         // 6 - 15
  legStyle: "box" | "digitigrade" | "hoverpads";
  
  // Accessories
  shoulderPadSize: number;      // 5 - 15
  hipPadSize: number;           // 4 - 12
  
  // Wings, cannons, etc.
  hasWings: boolean;
  wingSpan: number;             // 25 - 60
  wingAngle: number;            // 0 - 90 degrees
  
  hasCannons: boolean;
  cannonSize: number;           // 2 - 8
  
  hasBackpack: boolean;
  backpackSize: number;         // 5 - 20
  
  hasVisor: boolean;
  visorStyle: "slit" | "round" | "full";
  
  hasHorns: boolean;
  hornLength: number;           // 10 - 30
  
  hasTail: boolean;
  tailLength: number;           // 15 - 40
  tailSegments: number;         // 3 - 8
  
  hasAntennae: boolean;
  antennaLength: number;        // 15 - 40
  
  hasShield: boolean;
  shieldSize: number;           // 20 - 50
  
  // Plating
  extraPlating: number;         // 0 - 3 (extra armor plates)
  asymmetry: number;            // 0 - 1 (0=symmetric, 1=very asymmetric)
  
  // Colors
  primary: BABYLON.Color3;      // Main body color
  secondary: BABYLON.Color3;    // Secondary parts color
  emissive: BABYLON.Color3;     // Glowing parts color
}
```

### Quick Customization Examples

**Make a Robot Skinnier**:
```ts
torsoWidth: 12,        // Narrow torso
armThickness: 4,       // Thin arms
legThickness: 6,       // Thin legs
```

**Make a Robot Bulkier**:
```ts
torsoWidth: 35,
torsoHeight: 55,
torsoDepth: 28,
armThickness: 12,
legThickness: 14,
extraPlating: 3,
```

**Add Unique Features**:
```ts
hasWings: true,
wingSpan: 50,
wingAngle: 60,
hasShield: true,
shieldSize: 40,
hasTail: true,
tailLength: 30,
tailSegments: 6,
```

**Change Colors**:
```ts
primary: new BABYLON.Color3(0.2, 0.8, 0.2),     // Green
secondary: new BABYLON.Color3(0.1, 0.4, 0.1),   // Dark green
emissive: new BABYLON.Color3(0.0, 1.0, 0.5),    // Cyan glow
```

### Editing Existing Robot Presets

To modify an existing robot (e.g., ScoutPrime), find it in `RobotPresets.ts` and update its properties:

```ts
ScoutPrime: {
  archetype: "scout",
  scale: 1.0,        // <- Change to 0.8 to make smaller
  torsoWidth: 18,    // <- Adjust width
  headSize: 10,      // <- Smaller head
  // ... rest of properties
},
```

Then run the game to see the changes instantly.

### Archetype Defaults

Each archetype has sensible defaults created by `createDefaultStyle(archetype)`:

- **scout**: Lightweight, slit visor, minimal accessories
- **brute**: Heavy, cannons, horns, extra plating
- **flyer**: Wings, hoverpads, backpack, sleek
- **tank**: Largest, shield, maximum plating
- **insectoid**: Digitigrade legs, wings, tail, antennae
- **hybrid**: All features enabled (wings, tail, shield, cannons, etc.)

---

## Adding / Editing Levels

Detroit 3026 uses procedural generation for the open world, but you can add new zones, adjust existing ones, or create entirely new environments.

### World Structure

**File**: `client/src/game/CityGenerator.ts`

The world is 1200x1200 units divided into zones:

```
            North (+Z)
       Mountains | Mountains
            (-X) | (+X)
                 |
    Residential | Downtown | Industrial
    (-220 to    | (-100 to | (120 to
     -120)      | 100)     | 220)
                 |
            Highway
                 |
              River
                 |
       Mountains | Mountains
```

### Adding a New Zone

1. **Create the generation method** in `CityGenerator.ts`:

```ts
private createMyNewZone(): void {
  // Define bounds
  const minX = -150;
  const maxX = -50;
  const minZ = -200;
  const maxZ = -100;
  
  // Create terrain/structures
  for (let i = 0; i < 10; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const z = minZ + Math.random() * (maxZ - minZ);
    
    const building = BABYLON.MeshBuilder.CreateBox("myBuilding", 
      { width: 20, height: 30, depth: 15 }, this.scene);
    building.position = new BABYLON.Vector3(x, 15, z);
    building.material = this.cellShadeMaterial;
  }
  
  // Add NPCs, objects, loot markers, etc.
}
```

2. **Call from generateCity()**:

```ts
public generateCity(): void {
  this.createGround();
  this.createDowntown();
  this.createIndustrialZone();
  this.createResidentialBlocks();
  // ... existing calls ...
  this.createMyNewZone();  // <- Add here
  // ... rest of generation
}
```

3. **Make surfaces walkable** by updating `PlayerController.ts` raycast filter:

```ts
// In PlayerController.updatePhysics() method
const isGround = (n: string) => 
  n === "ground" || n.startsWith("skyPlat_") || 
  n.startsWith("bridge_") || n.startsWith("rooftop_") ||
  n === "myZoneGround";  // <- Add your zone
```

### Editing Existing Zones

To modify an existing zone (e.g., Downtown):

1. Find the method: `createDowntown()` in `CityGenerator.ts`
2. Adjust parameters:
   - Building height: `height: 80` → `height: 120`
   - Building density: Loop iterations
   - Building materials: Change color/shader
3. Respawn the world by restarting the game

### Adding Interactive Objects

Add NPCs, destructible objects, or special zones:

```ts
// Example: Add a destructible building
const destructible = BABYLON.MeshBuilder.CreateBox("destructBuilding", 
  { width: 25, height: 40, depth: 20 }, this.scene);
destructible.position = new BABYLON.Vector3(100, 20, 150);
destructible.metadata = {
  isDestructible: true,
  health: 500,
  lootOnDestroy: { credits: 100, ammo: 30 },
};
```

Then wire it into `EnemySystem.damageEnemy()` or a new `EnvironmentSystem`.

### Wave Difficulty & Loot Scaling

Zones can have difficulty modifiers:

```ts
// In a zone creation method
zone.metadata = {
  difficultyMultiplier: 1.5,      // 50% harder enemies
  lootMultiplier: 1.2,            // 20% more loot
  waveModifier: 2,                // Start spawning at wave 2
};
```

Then read in `EnemySystem`:

```ts
const zoneModifier = mesh.metadata?.difficultyMultiplier || 1.0;
enemy.maxHealth *= zoneModifier;
enemy.attackDamage *= zoneModifier;
```

### Ambient Design

Add atmosphere to zones using lights, particles, and shaders:

```ts
// Add zone-specific lighting
const zoneLight = new BABYLON.PointLight("zoneLight", 
  new BABYLON.Vector3(50, 100, 50), this.scene);
zoneLight.range = 300;
zoneLight.intensity = 0.6;
zoneLight.diffuse = new BABYLON.Color3(0.2, 0.8, 1.0);  // Cyan glow

// Add fog for depth
this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
this.scene.fogDensity = 0.002;
this.scene.fogColor = new BABYLON.Color3(0.1, 0.2, 0.3);
```

### Spawning & Population

Control what spawns in each zone via `EnemySystem.selectEnemyType()`:

```ts
// Biome-specific enemy selection
if (this.isInZone(position, "myNewZone")) {
  if (wave <= 5) types.push({ type: "drone", weight: 1.0 });
  if (wave >= 10) types.push({ type: "soldier", weight: 0.8 });
  if (wave >= 15) types.push({ type: "myNewRobot", weight: 0.5 });
}
```

---
