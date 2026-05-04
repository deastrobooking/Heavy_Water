type EventCallback = (...args: any[]) => void;

export class EventBus {
  private static instance: EventBus;
  private listeners: Map<string, EventCallback[]> = new Map();

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: EventCallback): void {
    const cbs = this.listeners.get(event);
    if (cbs) {
      this.listeners.set(event, cbs.filter(cb => cb !== callback));
    }
  }

  emit(event: string, ...args: any[]): void {
    const cbs = this.listeners.get(event);
    if (cbs) {
      for (const cb of cbs) {
        cb(...args);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const GameEvents = {
  PLAYER_DAMAGED: "player:damaged",
  PLAYER_HEALED: "player:healed",
  PLAYER_DIED: "player:died",
  PLAYER_DODGE: "player:dodge",
  PLAYER_PARRY: "player:parry",
  PLAYER_LEVEL_UP: "player:levelUp",
  PLAYER_UPGRADED: "player:upgraded",
  PLAYER_STAMINA_CHANGED: "player:staminaChanged",

  ENEMY_DAMAGED: "enemy:damaged",
  ENEMY_KILLED: "enemy:killed",
  ENEMY_SPAWNED: "enemy:spawned",
  ENEMY_STATE_CHANGED: "enemy:stateChanged",

  WEAPON_FIRED: "weapon:fired",
  WEAPON_SWITCHED: "weapon:switched",
  WEAPON_RELOADED: "weapon:reloaded",

  COMBO_HIT: "combat:comboHit",
  COMBO_FINISHED: "combat:comboFinished",

  LOOT_COLLECTED: "loot:collected",
  CHEST_OPENED: "chest:opened",

  PICKUP_SPAWNED: "pickup:spawned",
  PICKUP_COLLECTED: "pickup:collected",

  WEAPON_UPGRADED: "weapon:upgraded",
  COMPANION_UPGRADED: "companion:upgraded",
  COMPANION_BUILT: "companion:built",

  BASE_STRUCTURE_PLACED: "base:structurePlaced",
  BASE_STRUCTURE_UPGRADED: "base:structureUpgraded",
  BASE_INTERACT: "base:interact",

  CREATURE_SPAWNED: "creature:spawned",
  CREATURE_CAPTURED: "creature:captured",
  CAPTURE_ORB_THROWN: "creature:captureOrbThrown",

  WAVE_STARTED: "wave:started",
  WAVE_COMPLETED: "wave:completed",

  INVENTORY_CHANGED: "inventory:changed",
  ITEM_PICKED_UP: "inventory:itemPickedUp",

  PLAYER_FLIGHT_ENTER: "player:flightEnter",
  PLAYER_FLIGHT_EXIT: "player:flightExit",
  PLAYER_FLIGHT_ARMOR_ACQUIRED: "player:flightArmorAcquired",

  UI_MESSAGE: "ui:message",
  UI_DAMAGE_NUMBER: "ui:damageNumber",

  // ---- Boss fortress + level progression ----
  /** Fired by EnemyBaseSystem when every outer turret of the boss fortress
   *  is destroyed — Game.tsx uses it to spawn the BossCaptain at the spire. */
  BOSS_FORTRESS_TURRETS_CLEARED: "boss:turretsCleared",
  /** Fired by EnemyBaseSystem when the central command spire's HP hits 0. */
  BOSS_FORTRESS_CLEARED: "boss:fortressCleared",
  /** Fired when the captured ally inside the spire is freed. Carries the
   *  ally's world position so other systems can mark it / spawn pickups. */
  ALLY_RESCUED: "boss:allyRescued",
  /** Fired by RescueSystem when the player frees a captured humanoid
   *  synthetic from its containment cage. Payload: { id, name, title,
   *  level, position }. Used to persist the rescued id and play any
   *  optional companion / VFX hooks. */
  SYNTHETIC_RESCUED: "rescue:syntheticRescued",
  /** Fired by PontiacLabSystem when the player frees a caged lab animal.
   *  Payload: { id, name, position }. Persisted via
   *  `ProgressSnapshot.freedLabAnimalIds` and counts toward the
   *  legendary-companion grant. */
  ANIMAL_FREED: "lab:animalFreed",
  /** Fired by PontiacLabSystem when the player presses E on the cave
   *  hatch in the lab floor. Game.tsx wires this to fast-travel to
   *  Level 7 (Swarms Lair). No payload. */
  LAB_CAVE_ENTERED: "lab:caveEntered",
  /** Fired by SwarmsLairSystem when the General captain is killed inside
   *  the Swarms Lair. Distinct from `BOSS_FORTRESS_CLEARED` because the
   *  General is not a fortress boss — it's spawned inline by the lair
   *  system. Payload: { position }. */
  SWARMS_GENERAL_DEFEATED: "lair:generalDefeated",
  /** Fired by Game.tsx after the legendary mini-General humanoid
   *  companion has been granted (defeat-General + free-all-synths +
   *  free-all-animals). Payload: { presetName }. */
  LEGENDARY_COMPANION_GRANTED: "companion:legendaryGranted",
  /** Fired by LevelSystem when a level is finished. */
  LEVEL_COMPLETED: "level:completed",
  /** Fired by LevelSystem when a new level begins (including the initial
   *  Level 1 emit on world load). */
  LEVEL_STARTED: "level:started",
};
