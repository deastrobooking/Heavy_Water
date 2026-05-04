import { EventBus, GameEvents } from "./EventBus";

export enum ItemType {
  Weapon = "weapon",
  Armor = "armor",
  Consumable = "consumable",
  Ammo = "ammo",
  KeyItem = "keyItem",
  Currency = "currency",
  Material = "material",
}

export enum ItemRarity {
  Common = "common",
  Uncommon = "uncommon",
  Rare = "rare",
  Epic = "epic",
  Legendary = "legendary",
}

export interface ItemDefinition {
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

export interface InventorySlot {
  item: ItemDefinition;
  quantity: number;
}

export class InventorySystem {
  private slots: (InventorySlot | null)[];
  private maxSlots: number;
  private bus: EventBus;

  // Default ceiling bumped from 24 → 100 so the player never gets
  // "INVENTORY FULL" rejections on rare special-upgrade drops (power
  // jewels especially — they're a 5%/1.5%/0.4% drop, so losing one to
  // a packed bag was unacceptable). Stacks still cap at each item's
  // `maxStack`, so this lifts the SLOT count, not per-item ceilings.
  // Persisted via `ProgressSnapshot.inventoryCounts` (open-ended JSONB
  // record — no DB migration needed for the larger ceiling).
  constructor(maxSlots: number = 100) {
    this.maxSlots = maxSlots;
    this.slots = new Array(maxSlots).fill(null);
    this.bus = EventBus.getInstance();
  }

  addItem(item: ItemDefinition, quantity: number = 1): number {
    let remaining = quantity;

    for (let i = 0; i < this.maxSlots && remaining > 0; i++) {
      const slot = this.slots[i];
      if (slot && slot.item.id === item.id && slot.quantity < item.maxStack) {
        const canAdd = Math.min(remaining, item.maxStack - slot.quantity);
        slot.quantity += canAdd;
        remaining -= canAdd;
      }
    }

    for (let i = 0; i < this.maxSlots && remaining > 0; i++) {
      if (!this.slots[i]) {
        const canAdd = Math.min(remaining, item.maxStack);
        this.slots[i] = { item, quantity: canAdd };
        remaining -= canAdd;
      }
    }

    if (remaining < quantity) {
      this.bus.emit(GameEvents.INVENTORY_CHANGED);
    }

    return remaining;
  }

  removeItem(itemId: string, quantity: number = 1): boolean {
    let toRemove = quantity;

    for (let i = this.maxSlots - 1; i >= 0 && toRemove > 0; i--) {
      const slot = this.slots[i];
      if (slot && slot.item.id === itemId) {
        const canRemove = Math.min(toRemove, slot.quantity);
        slot.quantity -= canRemove;
        toRemove -= canRemove;
        if (slot.quantity <= 0) {
          this.slots[i] = null;
        }
      }
    }

    if (toRemove < quantity) {
      this.bus.emit(GameEvents.INVENTORY_CHANGED);
    }

    return toRemove === 0;
  }

  getSlot(index: number): InventorySlot | null {
    return this.slots[index] ?? null;
  }

  getSlots(): (InventorySlot | null)[] {
    return [...this.slots];
  }

  getItemCount(itemId: string): number {
    let count = 0;
    for (const slot of this.slots) {
      if (slot && slot.item.id === itemId) {
        count += slot.quantity;
      }
    }
    return count;
  }

  hasItem(itemId: string, quantity: number = 1): boolean {
    return this.getItemCount(itemId) >= quantity;
  }

  isFull(): boolean {
    return this.slots.every(s => s !== null);
  }

  getMaxSlots(): number {
    return this.maxSlots;
  }

  clear(): void {
    this.slots.fill(null);
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
  }
}

export const ITEM_DEFINITIONS: Record<string, ItemDefinition> = {
  credits: { id: "credits", name: "Credits", type: ItemType.Currency, rarity: ItemRarity.Common, maxStack: 9999, value: 1, description: "Universal currency" },
  health_pack: { id: "health_pack", name: "Health Pack", type: ItemType.Consumable, rarity: ItemRarity.Common, maxStack: 10, value: 25, description: "Restores 50 health", stats: { healAmount: 50 } },
  armor_shard: { id: "armor_shard", name: "Armor Shard", type: ItemType.Consumable, rarity: ItemRarity.Common, maxStack: 10, value: 30, description: "Restores 25 armor", stats: { armorAmount: 25 } },
  plasma_cell: { id: "plasma_cell", name: "Plasma Cell", type: ItemType.Ammo, rarity: ItemRarity.Common, maxStack: 200, value: 5, description: "Ammo for energy weapons" },
  kinetic_rounds: { id: "kinetic_rounds", name: "Kinetic Rounds", type: ItemType.Ammo, rarity: ItemRarity.Common, maxStack: 200, value: 5, description: "Standard ammunition" },
  rocket_ammo: { id: "rocket_ammo", name: "Rocket Ammo", type: ItemType.Ammo, rarity: ItemRarity.Uncommon, maxStack: 20, value: 50, description: "Explosive ordnance" },
  grenade_pack: { id: "grenade_pack", name: "Grenade Pack", type: ItemType.Ammo, rarity: ItemRarity.Uncommon, maxStack: 12, value: 40, description: "Fusion grenades" },
  shield_booster: { id: "shield_booster", name: "Shield Booster", type: ItemType.Consumable, rarity: ItemRarity.Rare, maxStack: 5, value: 100, description: "Temporarily doubles armor", stats: { armorBoost: 2, duration: 30 } },
  damage_amp: { id: "damage_amp", name: "Damage Amplifier", type: ItemType.Consumable, rarity: ItemRarity.Rare, maxStack: 5, value: 120, description: "Increases damage 50% for 20s", stats: { damageMultiplier: 1.5, duration: 20 } },
  xp_chip: { id: "xp_chip", name: "XP Chip", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 50, value: 15, description: "Grants bonus experience", stats: { xpAmount: 25 } },

  gear: { id: "gear", name: "Gear", type: ItemType.Material, rarity: ItemRarity.Common, maxStack: 999, value: 8, description: "Universal upgrade currency salvaged from machines" },
  bio_essence: { id: "bio_essence", name: "Bio Essence", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 99, value: 30, description: "Glowing organic residue, used to capture bio-creatures" },

  weapon_part_pistol: { id: "weapon_part_pistol", name: "Pistol Part", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 99, value: 18, description: "Salvaged plasma pistol component" },
  weapon_part_rifle: { id: "weapon_part_rifle", name: "Rifle Part", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 99, value: 22, description: "Salvaged pulse rifle component" },
  weapon_part_shotgun: { id: "weapon_part_shotgun", name: "Shotgun Part", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 99, value: 22, description: "Salvaged scatter blaster component" },
  weapon_part_rocket: { id: "weapon_part_rocket", name: "Rocket Part", type: ItemType.Material, rarity: ItemRarity.Rare, maxStack: 50, value: 35, description: "Salvaged nova launcher component" },
  weapon_part_laser: { id: "weapon_part_laser", name: "Laser Part", type: ItemType.Material, rarity: ItemRarity.Rare, maxStack: 50, value: 35, description: "Salvaged photon beam component" },
  weapon_part_grenade: { id: "weapon_part_grenade", name: "Grenade Part", type: ItemType.Material, rarity: ItemRarity.Rare, maxStack: 50, value: 32, description: "Salvaged fusion grenade component" },

  // === Ashur Sanctuary farming chain ===
  // Players earn bio_seeds from sanctuary NPCs and harvest plots, then refine
  // bio_crops into animaton_feed to strengthen rescued Animatons.
  bio_seed: { id: "bio_seed", name: "Bio Seed", type: ItemType.Material, rarity: ItemRarity.Common, maxStack: 99, value: 6, description: "Engineered Mechanoid seed. Plant on a sanctuary plot to grow a bio-crop." },
  bio_crop: { id: "bio_crop", name: "Bio Crop", type: ItemType.Consumable, rarity: ItemRarity.Uncommon, maxStack: 99, value: 18, description: "Sanctuary harvest. Refines into Animaton Feed; raw, restores a sliver of HP." },
  animaton_feed: { id: "animaton_feed", name: "Animaton Feed", type: ItemType.Consumable, rarity: ItemRarity.Rare, maxStack: 50, value: 60, description: "Refined bio-crop blend. Strengthens a rescued Animaton when fed at the sanctuary stable." },

  // === Power Jewels (very rare weapon mounts) ===
  // Drop occasionally from enemy-base vaults, boss-fortress spires, and boss
  // captains. Mounted via the WEAPONS tab of the upgrade menu; each grants a
  // permanent damage multiplier on the socketed ranged weapon. Kept in sync
  // with JEWEL_ITEM_DEFINITIONS in JewelSystem.ts.
  power_jewel_rough:    { id: "power_jewel_rough",    name: "Rough Power Jewel",    type: ItemType.Material, rarity: ItemRarity.Epic,      maxStack: 9, value: 600,  description: "Very rare. Mount on a ranged weapon to add +15% damage.",            stats: { damageMul: 0.15 } },
  power_jewel_cut:      { id: "power_jewel_cut",      name: "Cut Power Jewel",      type: ItemType.Material, rarity: ItemRarity.Legendary, maxStack: 9, value: 1500, description: "Very rare. Mount on a ranged weapon to add +30% damage.",            stats: { damageMul: 0.30 } },
  power_jewel_flawless: { id: "power_jewel_flawless", name: "Flawless Power Jewel", type: ItemType.Material, rarity: ItemRarity.Legendary, maxStack: 9, value: 4000, description: "Extraordinarily rare. Mount on a ranged weapon to add +50% damage.", stats: { damageMul: 0.50 } },
};
