# Game events reference

Source: [`client/src/game/EventBus.ts`](../../client/src/game/EventBus.ts)

This is the canonical list of `GameEvents.*` constants. Payload shapes
are documented in JSDoc comments above each constant in the source —
this page is the formatted index.

## Player

| Constant | String | When |
|---|---|---|
| `PLAYER_DAMAGED` | `"player:damaged"` | Player takes damage |
| `PLAYER_HEALED` | `"player:healed"` | Player healed |
| `PLAYER_DIED` | `"player:died"` | Player HP reaches 0 |
| `PLAYER_DODGE` | `"player:dodge"` | Successful dodge |
| `PLAYER_PARRY` | `"player:parry"` | Successful parry |
| `PLAYER_LEVEL_UP` | `"player:levelUp"` | XP threshold crossed |
| `PLAYER_UPGRADED` | `"player:upgraded"` | Any per-stat upgrade applied |
| `PLAYER_STAMINA_CHANGED` | `"player:staminaChanged"` | Stamina delta |
| `PLAYER_FLIGHT_ENTER` | `"player:flightEnter"` | Triple-jump → flight |
| `PLAYER_FLIGHT_EXIT` | `"player:flightExit"` | Flight ended |
| `PLAYER_FLIGHT_ARMOR_ACQUIRED` | `"player:flightArmorAcquired"` | Flight armor unlocked |

## Enemies

| Constant | String | When |
|---|---|---|
| `ENEMY_SPAWNED` | `"enemy:spawned"` | Any enemy spawn |
| `ENEMY_DAMAGED` | `"enemy:damaged"` | Enemy hit |
| `ENEMY_KILLED` | `"enemy:killed"` | Enemy HP ≤ 0 (carries `isBossCaptain`) |
| `ENEMY_STATE_CHANGED` | `"enemy:stateChanged"` | StateMachine transition |

## Combat / weapons

| Constant | String | When |
|---|---|---|
| `WEAPON_FIRED` | `"weapon:fired"` | Any weapon fire |
| `WEAPON_SWITCHED` | `"weapon:switched"` | Slot change |
| `WEAPON_RELOADED` | `"weapon:reloaded"` | Mag reset |
| `WEAPON_UPGRADED` | `"weapon:upgraded"` | Per-weapon level up |
| `COMBO_HIT` | `"combat:comboHit"` | Hit lands inside a combo |
| `COMBO_FINISHED` | `"combat:comboFinished"` | Combo chain ended |

## Loot / inventory

| Constant | String | When |
|---|---|---|
| `LOOT_COLLECTED` | `"loot:collected"` | Generic loot pickup |
| `CHEST_OPENED` | `"chest:opened"` | Chest unlocked |
| `PICKUP_SPAWNED` | `"pickup:spawned"` | Drop placed in world |
| `PICKUP_COLLECTED` | `"pickup:collected"` | Player walked over a pickup |
| `INVENTORY_CHANGED` | `"inventory:changed"` | Any inventory mutation |
| `ITEM_PICKED_UP` | `"inventory:itemPickedUp"` | Specific add to inventory |

## Companions / creatures

| Constant | String | When |
|---|---|---|
| `COMPANION_BUILT` | `"companion:built"` | Companion constructed in editor |
| `COMPANION_UPGRADED` | `"companion:upgraded"` | Companion stat upgrade |
| `LEGENDARY_COMPANION_GRANTED` | `"companion:legendaryGranted"` | One-shot legendary grant fired |
| `CREATURE_SPAWNED` | `"creature:spawned"` | Bio-creature spawned in world |
| `CREATURE_CAPTURED` | `"creature:captured"` | Capture orb succeeded |
| `CAPTURE_ORB_THROWN` | `"creature:captureOrbThrown"` | Orb thrown |

## Base building

| Constant | String | When |
|---|---|---|
| `BASE_STRUCTURE_PLACED` | `"base:structurePlaced"` | Structure placed |
| `BASE_STRUCTURE_UPGRADED` | `"base:structureUpgraded"` | Structure level up |
| `BASE_INTERACT` | `"base:interact"` | Player pressed E on a structure |

## Waves / levels

| Constant | String | When |
|---|---|---|
| `WAVE_STARTED` | `"wave:started"` | New wave begins |
| `WAVE_COMPLETED` | `"wave:completed"` | Wave cleared |
| `LEVEL_STARTED` | `"level:started"` | Level entered |
| `LEVEL_COMPLETED` | `"level:completed"` | Combat level cleared |

## Bosses & rescues

| Constant | String | When |
|---|---|---|
| `BOSS_FORTRESS_TURRETS_CLEARED` | `"boss:turretsCleared"` | Fortress turrets down |
| `BOSS_FORTRESS_CLEARED` | `"boss:fortressCleared"` | Fortress vault cracked |
| `ALLY_RESCUED` | `"boss:allyRescued"` | Captured ally freed at L1 |
| `SYNTHETIC_RESCUED` | `"rescue:syntheticRescued"` | Caged synthetic freed (any combat level) |
| `ANIMAL_FREED` | `"lab:animalFreed"` | Caged lab animal freed (L6) |
| `LAB_CAVE_ENTERED` | `"lab:caveEntered"` | Pontiac Lab cave hatch used (warps to L7) |
| `SWARMS_GENERAL_DEFEATED` | `"lair:generalDefeated"` | General Voidcrown killed (L7) |

## UI

| Constant | String | When |
|---|---|---|
| `UI_MESSAGE` | `"ui:message"` | Toast string |
| `UI_DAMAGE_NUMBER` | `"ui:damageNumber"` | Floating damage number |

## Adding a new event

See [`how-to/add-a-game-event.md`](../how-to/add-a-game-event.md). Add
the constant + JSDoc, then update this table.
