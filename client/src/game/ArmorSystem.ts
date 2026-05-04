import { EventBus, GameEvents } from "./EventBus";
import { DamageType, DamageInfo } from "./DamageSystem";
import { ItemRarity } from "./InventorySystem";

export enum ElementType {
  Fire = "Fire",
  Ice = "Ice",
  Electric = "Electric",
  DarkEnergy = "DarkEnergy",
  Insectoid = "Insectoid",
}

export interface ArmorPiece {
  id: string;
  name: string;
  type: "helmet" | "chest" | "legs" | "boots";
  element: ElementType | null;
  defense: number;
  healthBonus: number;
  staminaBonus: number;
  level: number;
  rarity: ItemRarity;
}

export interface ElementalEffect {
  element: ElementType;
  strengthBonus: number;
  defenseBonus: number;
  poisonDamage: number;
  poisonDuration: number;
  specialAbility: string;
}

const ELEMENTAL_DEFINITIONS: Record<ElementType, ElementalEffect> = {
  [ElementType.Fire]: {
    element: ElementType.Fire,
    strengthBonus: 0.15,
    defenseBonus: 0.05,
    poisonDamage: 8,
    poisonDuration: 3,
    specialAbility: "Burn enemies on melee hit",
  },
  [ElementType.Ice]: {
    element: ElementType.Ice,
    strengthBonus: 0.05,
    defenseBonus: 0.15,
    poisonDamage: 4,
    poisonDuration: 5,
    specialAbility: "Slow enemies on hit",
  },
  [ElementType.Electric]: {
    element: ElementType.Electric,
    strengthBonus: 0.10,
    defenseBonus: 0.10,
    poisonDamage: 12,
    poisonDuration: 2,
    specialAbility: "Chain lightning on kill",
  },
  [ElementType.DarkEnergy]: {
    element: ElementType.DarkEnergy,
    strengthBonus: 0.20,
    defenseBonus: 0.0,
    poisonDamage: 15,
    poisonDuration: 4,
    specialAbility: "Life steal on hit",
  },
  [ElementType.Insectoid]: {
    element: ElementType.Insectoid,
    strengthBonus: 0.08,
    defenseBonus: 0.20,
    poisonDamage: 6,
    poisonDuration: 6,
    specialAbility: "Regenerate health slowly",
  },
};

export class ArmorSystem {
  private equippedArmor: Map<string, ArmorPiece> = new Map();
  private activeElement: ElementType | null = null;
  private bus: EventBus;

  constructor() {
    this.bus = EventBus.getInstance();
  }

  equipArmor(piece: ArmorPiece): ArmorPiece | null {
    const previous = this.equippedArmor.get(piece.type) || null;
    this.equippedArmor.set(piece.type, piece);
    if (this.activeElement) {
      piece.element = this.activeElement;
    }
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
    return previous;
  }

  unequipArmor(slot: string): ArmorPiece | null {
    const piece = this.equippedArmor.get(slot) || null;
    this.equippedArmor.delete(slot);
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
    return piece;
  }

  getEquippedArmor(): Map<string, ArmorPiece> {
    return new Map(this.equippedArmor);
  }

  getTotalDefense(): number {
    let total = 0;
    Array.from(this.equippedArmor.values()).forEach(piece => {
      total += piece.defense;
    });
    return total;
  }

  getTotalHealthBonus(): number {
    let total = 0;
    Array.from(this.equippedArmor.values()).forEach(piece => {
      total += piece.healthBonus;
    });
    return total;
  }

  getTotalStaminaBonus(): number {
    let total = 0;
    Array.from(this.equippedArmor.values()).forEach(piece => {
      total += piece.staminaBonus;
    });
    return total;
  }

  setElement(element: ElementType | null): void {
    this.activeElement = element;
    Array.from(this.equippedArmor.values()).forEach(piece => {
      piece.element = element;
    });
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
  }

  getActiveElement(): ElementType | null {
    return this.activeElement;
  }

  getElementalEffect(): ElementalEffect | null {
    if (!this.activeElement) return null;
    return { ...ELEMENTAL_DEFINITIONS[this.activeElement] };
  }

  calculateDamageReduction(incomingDamage: number, damageType: DamageType): number {
    const totalDefense = this.getTotalDefense();
    const baseReduction = totalDefense / (totalDefense + 100);
    let reducedDamage = incomingDamage * (1 - baseReduction);

    const effect = this.getElementalEffect();
    if (effect) {
      reducedDamage *= (1 - effect.defenseBonus);
    }

    return Math.max(1, reducedDamage);
  }

  getModifiedOutgoingDamage(baseDamage: number): number {
    const effect = this.getElementalEffect();
    if (!effect) return baseDamage;
    return baseDamage * (1 + effect.strengthBonus);
  }

  getPoisonEffect(): { damage: number; duration: number; element: ElementType } | null {
    const effect = this.getElementalEffect();
    if (!effect || effect.poisonDamage <= 0) return null;
    return {
      damage: effect.poisonDamage,
      duration: effect.poisonDuration,
      element: effect.element,
    };
  }

  /**
   * Snapshot every equipped piece + the active element so the full
   * armor loadout (capsule-bought AND looted) round-trips through
   * `ProgressSync`. Without this, equipped armor + element silently
   * reset to nothing on every reload — the player loses defense, the
   * elemental aura, and any rare loot piece they were wearing.
   */
  serialize(): { pieces: ArmorPiece[]; element: ElementType | null } {
    return {
      pieces: Array.from(this.equippedArmor.values()).map(p => ({ ...p })),
      element: this.activeElement,
    };
  }

  /**
   * Restore the equipped Map + active element from a saved snapshot.
   * Idempotent: clears any current state first so loading on top of a
   * fresh game doesn't double-equip. Emits one INVENTORY_CHANGED at
   * the end so the HUD/UI re-render once instead of per-piece.
   */
  applyLoadedState(state: { pieces?: ArmorPiece[]; element?: ElementType | null } | undefined): void {
    if (!state) return;
    this.equippedArmor.clear();
    this.activeElement = state.element ?? null;
    if (state.pieces && state.pieces.length > 0) {
      for (const p of state.pieces) {
        // Defensive copy + slot-keyed insert — matches `equipArmor`'s
        // contract so getters (getTotalDefense, etc.) work the same.
        this.equippedArmor.set(p.type, { ...p, element: this.activeElement });
      }
    }
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
  }
}

export const ARMOR_DEFINITIONS: Record<string, ArmorPiece> = {
  iron_helmet: { id: "iron_helmet", name: "Iron Helmet", type: "helmet", element: null, defense: 5, healthBonus: 10, staminaBonus: 0, level: 1, rarity: ItemRarity.Common },
  steel_helmet: { id: "steel_helmet", name: "Steel Helmet", type: "helmet", element: null, defense: 10, healthBonus: 20, staminaBonus: 5, level: 2, rarity: ItemRarity.Uncommon },
  titanium_helmet: { id: "titanium_helmet", name: "Titanium Helmet", type: "helmet", element: null, defense: 18, healthBonus: 35, staminaBonus: 10, level: 3, rarity: ItemRarity.Rare },
  plasma_helmet: { id: "plasma_helmet", name: "Plasma Helmet", type: "helmet", element: null, defense: 28, healthBonus: 50, staminaBonus: 15, level: 4, rarity: ItemRarity.Epic },
  quantum_helmet: { id: "quantum_helmet", name: "Quantum Helmet", type: "helmet", element: null, defense: 40, healthBonus: 75, staminaBonus: 25, level: 5, rarity: ItemRarity.Legendary },

  iron_chestplate: { id: "iron_chestplate", name: "Iron Chestplate", type: "chest", element: null, defense: 8, healthBonus: 15, staminaBonus: 0, level: 1, rarity: ItemRarity.Common },
  steel_chestplate: { id: "steel_chestplate", name: "Steel Chestplate", type: "chest", element: null, defense: 16, healthBonus: 30, staminaBonus: 5, level: 2, rarity: ItemRarity.Uncommon },
  titanium_chestplate: { id: "titanium_chestplate", name: "Titanium Chestplate", type: "chest", element: null, defense: 28, healthBonus: 50, staminaBonus: 10, level: 3, rarity: ItemRarity.Rare },
  plasma_chestplate: { id: "plasma_chestplate", name: "Plasma Chestplate", type: "chest", element: null, defense: 42, healthBonus: 75, staminaBonus: 20, level: 4, rarity: ItemRarity.Epic },
  quantum_chestplate: { id: "quantum_chestplate", name: "Quantum Chestplate", type: "chest", element: null, defense: 60, healthBonus: 100, staminaBonus: 30, level: 5, rarity: ItemRarity.Legendary },

  iron_leggings: { id: "iron_leggings", name: "Iron Leggings", type: "legs", element: null, defense: 6, healthBonus: 10, staminaBonus: 5, level: 1, rarity: ItemRarity.Common },
  steel_leggings: { id: "steel_leggings", name: "Steel Leggings", type: "legs", element: null, defense: 12, healthBonus: 20, staminaBonus: 10, level: 2, rarity: ItemRarity.Uncommon },
  titanium_leggings: { id: "titanium_leggings", name: "Titanium Leggings", type: "legs", element: null, defense: 22, healthBonus: 40, staminaBonus: 15, level: 3, rarity: ItemRarity.Rare },
  plasma_leggings: { id: "plasma_leggings", name: "Plasma Leggings", type: "legs", element: null, defense: 34, healthBonus: 60, staminaBonus: 25, level: 4, rarity: ItemRarity.Epic },
  quantum_leggings: { id: "quantum_leggings", name: "Quantum Leggings", type: "legs", element: null, defense: 50, healthBonus: 85, staminaBonus: 35, level: 5, rarity: ItemRarity.Legendary },

  iron_boots: { id: "iron_boots", name: "Iron Boots", type: "boots", element: null, defense: 4, healthBonus: 5, staminaBonus: 5, level: 1, rarity: ItemRarity.Common },
  steel_boots: { id: "steel_boots", name: "Steel Boots", type: "boots", element: null, defense: 8, healthBonus: 15, staminaBonus: 10, level: 2, rarity: ItemRarity.Uncommon },
  titanium_boots: { id: "titanium_boots", name: "Titanium Boots", type: "boots", element: null, defense: 15, healthBonus: 25, staminaBonus: 20, level: 3, rarity: ItemRarity.Rare },
  plasma_boots: { id: "plasma_boots", name: "Plasma Boots", type: "boots", element: null, defense: 24, healthBonus: 40, staminaBonus: 30, level: 4, rarity: ItemRarity.Epic },
  quantum_boots: { id: "quantum_boots", name: "Quantum Boots", type: "boots", element: null, defense: 35, healthBonus: 60, staminaBonus: 40, level: 5, rarity: ItemRarity.Legendary },
};
