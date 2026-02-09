import { EventBus, GameEvents } from "./EventBus";
import { InventorySystem, ItemDefinition, ItemType, ItemRarity, ITEM_DEFINITIONS } from "./InventorySystem";

export enum CraftingMaterial {
  ScrapMetal = "scrap_metal",
  EnergyCore = "energy_core",
  NanoFiber = "nano_fiber",
  CircuitBoard = "circuit_board",
  BioSample = "bio_sample",
  CrystalShard = "crystal_shard",
  DarkMatter = "dark_matter",
}

export const CRAFTING_MATERIALS: Record<string, ItemDefinition> = {
  scrap_metal: { id: "scrap_metal", name: "Scrap Metal", type: ItemType.Material, rarity: ItemRarity.Common, maxStack: 99, value: 5, description: "Salvaged metal fragments useful for construction" },
  energy_core: { id: "energy_core", name: "Energy Core", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 50, value: 25, description: "A compact power source harvested from machines" },
  nano_fiber: { id: "nano_fiber", name: "Nano Fiber", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 50, value: 20, description: "Ultra-strong synthetic fibers for armor weaving" },
  circuit_board: { id: "circuit_board", name: "Circuit Board", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 50, value: 30, description: "Advanced electronics component for upgrades" },
  bio_sample: { id: "bio_sample", name: "Bio Sample", type: ItemType.Material, rarity: ItemRarity.Rare, maxStack: 30, value: 40, description: "Organic compound used in medical crafting" },
  crystal_shard: { id: "crystal_shard", name: "Crystal Shard", type: ItemType.Material, rarity: ItemRarity.Rare, maxStack: 30, value: 50, description: "Resonant crystal fragment with energy-focusing properties" },
  dark_matter: { id: "dark_matter", name: "Dark Matter", type: ItemType.Material, rarity: ItemRarity.Legendary, maxStack: 10, value: 200, description: "Exotic matter with reality-warping potential" },
};

export interface CraftingRecipe {
  id: string;
  name: string;
  category: "weapon" | "armor" | "base" | "upgrade" | "consumable";
  materials: Array<{ materialId: string; quantity: number }>;
  result: { itemId: string; quantity: number };
  craftTime: number;
  requiredLevel: number;
}

export interface BaseStructure {
  id: string;
  name: string;
  type: "wall" | "floor" | "turret" | "generator" | "storage" | "medbay";
  health: number;
  defense: number;
  size: { width: number; height: number; depth: number };
  cost: Array<{ materialId: string; quantity: number }>;
  upgradeLevel: number;
}

interface CraftQueueItem {
  recipe: CraftingRecipe;
  startTime: number;
  endTime: number;
}

const RECIPES: CraftingRecipe[] = [
  {
    id: "damage_mod", name: "Damage Mod", category: "weapon",
    materials: [{ materialId: "scrap_metal", quantity: 5 }, { materialId: "circuit_board", quantity: 2 }],
    result: { itemId: "damage_mod", quantity: 1 }, craftTime: 5, requiredLevel: 2,
  },
  {
    id: "fire_rate_mod", name: "Fire Rate Mod", category: "weapon",
    materials: [{ materialId: "circuit_board", quantity: 3 }, { materialId: "energy_core", quantity: 1 }],
    result: { itemId: "fire_rate_mod", quantity: 1 }, craftTime: 5, requiredLevel: 3,
  },
  {
    id: "ammo_capacity_mod", name: "Ammo Capacity Mod", category: "weapon",
    materials: [{ materialId: "scrap_metal", quantity: 4 }, { materialId: "nano_fiber", quantity: 2 }],
    result: { itemId: "ammo_capacity_mod", quantity: 1 }, craftTime: 4, requiredLevel: 2,
  },
  {
    id: "basic_helmet", name: "Basic Helmet", category: "armor",
    materials: [{ materialId: "scrap_metal", quantity: 6 }, { materialId: "nano_fiber", quantity: 3 }],
    result: { itemId: "basic_helmet", quantity: 1 }, craftTime: 8, requiredLevel: 1,
  },
  {
    id: "basic_chestplate", name: "Basic Chestplate", category: "armor",
    materials: [{ materialId: "scrap_metal", quantity: 10 }, { materialId: "nano_fiber", quantity: 5 }],
    result: { itemId: "basic_chestplate", quantity: 1 }, craftTime: 12, requiredLevel: 1,
  },
  {
    id: "basic_leggings", name: "Basic Leggings", category: "armor",
    materials: [{ materialId: "scrap_metal", quantity: 8 }, { materialId: "nano_fiber", quantity: 4 }],
    result: { itemId: "basic_leggings", quantity: 1 }, craftTime: 10, requiredLevel: 1,
  },
  {
    id: "basic_boots", name: "Basic Boots", category: "armor",
    materials: [{ materialId: "scrap_metal", quantity: 4 }, { materialId: "nano_fiber", quantity: 2 }],
    result: { itemId: "basic_boots", quantity: 1 }, craftTime: 6, requiredLevel: 1,
  },
  {
    id: "wall_section", name: "Wall", category: "base",
    materials: [{ materialId: "scrap_metal", quantity: 8 }],
    result: { itemId: "wall_section", quantity: 1 }, craftTime: 3, requiredLevel: 1,
  },
  {
    id: "floor_panel", name: "Floor Panel", category: "base",
    materials: [{ materialId: "scrap_metal", quantity: 6 }],
    result: { itemId: "floor_panel", quantity: 1 }, craftTime: 2, requiredLevel: 1,
  },
  {
    id: "auto_turret", name: "Auto-Turret", category: "base",
    materials: [{ materialId: "scrap_metal", quantity: 12 }, { materialId: "circuit_board", quantity: 4 }, { materialId: "energy_core", quantity: 2 }],
    result: { itemId: "auto_turret", quantity: 1 }, craftTime: 15, requiredLevel: 5,
  },
  {
    id: "power_generator", name: "Power Generator", category: "base",
    materials: [{ materialId: "scrap_metal", quantity: 10 }, { materialId: "energy_core", quantity: 3 }, { materialId: "circuit_board", quantity: 2 }],
    result: { itemId: "power_generator", quantity: 1 }, craftTime: 12, requiredLevel: 3,
  },
  {
    id: "storage_crate", name: "Storage Crate", category: "base",
    materials: [{ materialId: "scrap_metal", quantity: 6 }, { materialId: "nano_fiber", quantity: 2 }],
    result: { itemId: "storage_crate", quantity: 1 }, craftTime: 4, requiredLevel: 1,
  },
  {
    id: "medical_bay", name: "Medical Bay", category: "base",
    materials: [{ materialId: "scrap_metal", quantity: 8 }, { materialId: "bio_sample", quantity: 5 }, { materialId: "circuit_board", quantity: 3 }],
    result: { itemId: "medical_bay", quantity: 1 }, craftTime: 20, requiredLevel: 4,
  },
  {
    id: "advanced_health_pack", name: "Advanced Health Pack", category: "consumable",
    materials: [{ materialId: "bio_sample", quantity: 3 }, { materialId: "nano_fiber", quantity: 1 }],
    result: { itemId: "advanced_health_pack", quantity: 2 }, craftTime: 3, requiredLevel: 2,
  },
  {
    id: "shield_battery", name: "Shield Battery", category: "consumable",
    materials: [{ materialId: "energy_core", quantity: 2 }, { materialId: "crystal_shard", quantity: 1 }],
    result: { itemId: "shield_battery", quantity: 1 }, craftTime: 4, requiredLevel: 3,
  },
  {
    id: "damage_booster", name: "Damage Booster", category: "consumable",
    materials: [{ materialId: "crystal_shard", quantity: 2 }, { materialId: "energy_core", quantity: 1 }],
    result: { itemId: "damage_booster", quantity: 1 }, craftTime: 5, requiredLevel: 4,
  },
  {
    id: "beam_sabre_core", name: "Beam Sabre Core", category: "upgrade",
    materials: [{ materialId: "crystal_shard", quantity: 5 }, { materialId: "dark_matter", quantity: 2 }, { materialId: "energy_core", quantity: 3 }],
    result: { itemId: "beam_sabre_core", quantity: 1 }, craftTime: 30, requiredLevel: 8,
  },
];

const BASE_STRUCTURE_TEMPLATES: BaseStructure[] = [
  {
    id: "wall", name: "Reinforced Wall", type: "wall",
    health: 500, defense: 10,
    size: { width: 4, height: 3, depth: 0.5 },
    cost: [{ materialId: "scrap_metal", quantity: 8 }],
    upgradeLevel: 1,
  },
  {
    id: "floor", name: "Floor Platform", type: "floor",
    health: 400, defense: 5,
    size: { width: 4, height: 0.2, depth: 4 },
    cost: [{ materialId: "scrap_metal", quantity: 6 }],
    upgradeLevel: 1,
  },
  {
    id: "turret", name: "Auto-Turret", type: "turret",
    health: 300, defense: 5,
    size: { width: 1, height: 1.5, depth: 1 },
    cost: [{ materialId: "scrap_metal", quantity: 12 }, { materialId: "circuit_board", quantity: 4 }, { materialId: "energy_core", quantity: 2 }],
    upgradeLevel: 1,
  },
  {
    id: "generator", name: "Power Generator", type: "generator",
    health: 350, defense: 3,
    size: { width: 2, height: 2, depth: 2 },
    cost: [{ materialId: "scrap_metal", quantity: 10 }, { materialId: "energy_core", quantity: 3 }, { materialId: "circuit_board", quantity: 2 }],
    upgradeLevel: 1,
  },
  {
    id: "storage", name: "Storage Crate", type: "storage",
    health: 250, defense: 2,
    size: { width: 2, height: 1.5, depth: 2 },
    cost: [{ materialId: "scrap_metal", quantity: 6 }, { materialId: "nano_fiber", quantity: 2 }],
    upgradeLevel: 1,
  },
  {
    id: "medbay", name: "Medical Bay", type: "medbay",
    health: 400, defense: 4,
    size: { width: 3, height: 2.5, depth: 3 },
    cost: [{ materialId: "scrap_metal", quantity: 8 }, { materialId: "bio_sample", quantity: 5 }, { materialId: "circuit_board", quantity: 3 }],
    upgradeLevel: 1,
  },
];

export class CraftingSystem {
  private recipes: Map<string, CraftingRecipe> = new Map();
  private inventory: InventorySystem;
  private craftQueue: CraftQueueItem[] = [];
  private baseStructures: BaseStructure[] = [];
  private bus: EventBus;

  constructor(inventory: InventorySystem) {
    this.inventory = inventory;
    this.bus = EventBus.getInstance();

    for (const recipe of RECIPES) {
      this.recipes.set(recipe.id, recipe);
    }
  }

  getRecipes(category?: CraftingRecipe["category"]): CraftingRecipe[] {
    const all = Array.from(this.recipes.values());
    if (!category) return all;
    return all.filter(r => r.category === category);
  }

  canCraft(recipeId: string): boolean {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return false;

    return recipe.materials.every(mat =>
      this.inventory.hasItem(mat.materialId, mat.quantity)
    );
  }

  craft(recipeId: string): boolean {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) return false;
    if (!this.canCraft(recipeId)) return false;

    for (const mat of recipe.materials) {
      this.inventory.removeItem(mat.materialId, mat.quantity);
    }

    const now = Date.now();
    const queueItem: CraftQueueItem = {
      recipe,
      startTime: now,
      endTime: now + recipe.craftTime * 1000,
    };
    this.craftQueue.push(queueItem);

    const resultDef = ITEM_DEFINITIONS[recipe.result.itemId] ?? CRAFTING_MATERIALS[recipe.result.itemId] ?? {
      id: recipe.result.itemId,
      name: recipe.name,
      type: ItemType.Material,
      rarity: ItemRarity.Common,
      maxStack: 10,
      value: 50,
      description: `Crafted ${recipe.name}`,
    };

    this.inventory.addItem(resultDef, recipe.result.quantity);
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
    this.bus.emit(GameEvents.UI_MESSAGE, `Crafted ${recipe.name} x${recipe.result.quantity}`);

    return true;
  }

  getBaseStructures(): BaseStructure[] {
    return BASE_STRUCTURE_TEMPLATES.map(s => ({ ...s }));
  }

  canBuildStructure(structureId: string): boolean {
    const template = BASE_STRUCTURE_TEMPLATES.find(s => s.id === structureId);
    if (!template) return false;

    return template.cost.every(mat =>
      this.inventory.hasItem(mat.materialId, mat.quantity)
    );
  }

  buildStructure(structureId: string): BaseStructure | null {
    const template = BASE_STRUCTURE_TEMPLATES.find(s => s.id === structureId);
    if (!template) return null;
    if (!this.canBuildStructure(structureId)) return null;

    for (const mat of template.cost) {
      this.inventory.removeItem(mat.materialId, mat.quantity);
    }

    const structure: BaseStructure = { ...template, upgradeLevel: 1 };
    this.baseStructures.push(structure);
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
    this.bus.emit(GameEvents.UI_MESSAGE, `Built ${template.name}`);

    return structure;
  }

  upgradeStructure(structureIndex: number): boolean {
    const structure = this.baseStructures[structureIndex];
    if (!structure) return false;
    if (structure.upgradeLevel >= 3) return false;

    const template = BASE_STRUCTURE_TEMPLATES.find(s => s.id === structure.id);
    if (!template) return false;

    const multiplier = structure.upgradeLevel + 1;
    const upgradeCost = template.cost.map(mat => ({
      materialId: mat.materialId,
      quantity: Math.ceil(mat.quantity * multiplier * 0.75),
    }));

    const canAfford = upgradeCost.every(mat =>
      this.inventory.hasItem(mat.materialId, mat.quantity)
    );
    if (!canAfford) return false;

    for (const mat of upgradeCost) {
      this.inventory.removeItem(mat.materialId, mat.quantity);
    }

    structure.upgradeLevel += 1;
    structure.health = Math.floor(structure.health * 1.5);
    structure.defense = Math.floor(structure.defense * 1.4);
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
    this.bus.emit(GameEvents.UI_MESSAGE, `Upgraded ${structure.name} to level ${structure.upgradeLevel}`);

    return true;
  }

  getCraftQueue(): CraftQueueItem[] {
    return [...this.craftQueue];
  }

  getBuiltStructures(): BaseStructure[] {
    return [...this.baseStructures];
  }
}
