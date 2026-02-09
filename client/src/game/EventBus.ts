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

  WAVE_STARTED: "wave:started",
  WAVE_COMPLETED: "wave:completed",

  INVENTORY_CHANGED: "inventory:changed",
  ITEM_PICKED_UP: "inventory:itemPickedUp",

  UI_MESSAGE: "ui:message",
  UI_DAMAGE_NUMBER: "ui:damageNumber",
};
