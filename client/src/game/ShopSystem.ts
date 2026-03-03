import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { InventorySystem, ItemDefinition, ItemType, ItemRarity, ITEM_DEFINITIONS } from "./InventorySystem";
import { CRAFTING_MATERIALS } from "./CraftingSystem";

export type ShopType = "weapon" | "armor" | "general";

export interface ShopItem {
  item: ItemDefinition;
  buyPrice: number;
  sellPrice: number;
  stock: number;
  maxStock: number;
}

export interface ShopDefinition {
  id: string;
  name: string;
  type: ShopType;
  items: ShopItem[];
  position: BABYLON.Vector3;
}

const WEAPON_SHOP_ITEMS: ItemDefinition[] = [
  { id: "plasma_cell", name: "Plasma Cell", type: ItemType.Ammo, rarity: ItemRarity.Common, maxStack: 200, value: 5, description: "Ammo for energy weapons" },
  { id: "kinetic_rounds", name: "Kinetic Rounds", type: ItemType.Ammo, rarity: ItemRarity.Common, maxStack: 200, value: 5, description: "Standard ammunition" },
  { id: "rocket_ammo", name: "Rocket Ammo", type: ItemType.Ammo, rarity: ItemRarity.Uncommon, maxStack: 20, value: 50, description: "Explosive ordnance" },
  { id: "grenade_pack", name: "Grenade Pack", type: ItemType.Ammo, rarity: ItemRarity.Uncommon, maxStack: 12, value: 40, description: "Fusion grenades" },
  { id: "damage_amp", name: "Damage Amplifier", type: ItemType.Consumable, rarity: ItemRarity.Rare, maxStack: 5, value: 120, description: "Increases damage 50% for 20s", stats: { damageMultiplier: 1.5, duration: 20 } },
  { id: "weapon_mod_scope", name: "Precision Scope", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 5, value: 200, description: "Improves weapon accuracy" },
  { id: "weapon_mod_barrel", name: "Extended Barrel", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 5, value: 180, description: "Increases weapon range" },
];

const ARMOR_SHOP_ITEMS: ItemDefinition[] = [
  { id: "armor_shard", name: "Armor Shard", type: ItemType.Consumable, rarity: ItemRarity.Common, maxStack: 10, value: 30, description: "Restores 25 armor", stats: { armorAmount: 25 } },
  { id: "shield_booster", name: "Shield Booster", type: ItemType.Consumable, rarity: ItemRarity.Rare, maxStack: 5, value: 100, description: "Temporarily doubles armor", stats: { armorBoost: 2, duration: 30 } },
  { id: "nano_fiber", name: "Nano Fiber", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 50, value: 20, description: "Ultra-strong synthetic fibers for armor weaving" },
  { id: "armor_plate_basic", name: "Basic Armor Plate", type: ItemType.Armor, rarity: ItemRarity.Common, maxStack: 1, value: 150, description: "A simple protective plate", stats: { defense: 10 } },
  { id: "armor_plate_reinforced", name: "Reinforced Armor Plate", type: ItemType.Armor, rarity: ItemRarity.Uncommon, maxStack: 1, value: 350, description: "A reinforced protective plate", stats: { defense: 25 } },
  { id: "energy_shield_module", name: "Energy Shield Module", type: ItemType.Armor, rarity: ItemRarity.Rare, maxStack: 1, value: 600, description: "Generates an energy shield around the wearer", stats: { defense: 40, shieldCapacity: 50 } },
];

const GENERAL_SHOP_ITEMS: ItemDefinition[] = [
  { id: "health_pack", name: "Health Pack", type: ItemType.Consumable, rarity: ItemRarity.Common, maxStack: 10, value: 25, description: "Restores 50 health", stats: { healAmount: 50 } },
  { id: "scrap_metal", name: "Scrap Metal", type: ItemType.Material, rarity: ItemRarity.Common, maxStack: 99, value: 5, description: "Salvaged metal fragments" },
  { id: "energy_core", name: "Energy Core", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 50, value: 25, description: "A compact power source" },
  { id: "circuit_board", name: "Circuit Board", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 50, value: 30, description: "Advanced electronics component" },
  { id: "bio_sample", name: "Bio Sample", type: ItemType.Material, rarity: ItemRarity.Rare, maxStack: 30, value: 40, description: "Organic compound for medical crafting" },
  { id: "xp_chip", name: "XP Chip", type: ItemType.Material, rarity: ItemRarity.Uncommon, maxStack: 50, value: 15, description: "Grants bonus experience", stats: { xpAmount: 25 } },
  { id: "crystal_shard", name: "Crystal Shard", type: ItemType.Material, rarity: ItemRarity.Rare, maxStack: 30, value: 50, description: "Resonant crystal fragment" },
];

function getShopItemsForType(type: ShopType): ShopItem[] {
  let items: ItemDefinition[];
  switch (type) {
    case "weapon": items = WEAPON_SHOP_ITEMS; break;
    case "armor": items = ARMOR_SHOP_ITEMS; break;
    case "general": items = GENERAL_SHOP_ITEMS; break;
  }
  return items.map(item => ({
    item,
    buyPrice: Math.ceil(item.value * 1.5),
    sellPrice: Math.floor(item.value * 0.5),
    stock: item.rarity === ItemRarity.Rare ? 3 : item.rarity === ItemRarity.Uncommon ? 8 : 20,
    maxStock: item.rarity === ItemRarity.Rare ? 3 : item.rarity === ItemRarity.Uncommon ? 8 : 20,
  }));
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export class ShopSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private inventory: InventorySystem;
  private bus: EventBus;
  private shops: ShopDefinition[] = [];
  private shopMeshes: Map<string, BABYLON.Mesh> = new Map();
  private activeShop: ShopDefinition | null = null;
  private interactionRange: number = 8;
  private isShopOpen: boolean = false;

  private onShopOpen: ((shop: ShopDefinition) => void) | null = null;
  private onShopClose: (() => void) | null = null;
  private onTransactionComplete: ((message: string) => void) | null = null;

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera, inventory: InventorySystem) {
    this.scene = scene;
    this.camera = camera;
    this.inventory = inventory;
    this.bus = EventBus.getInstance();
    this.setupControls();
  }

  setOnShopOpen(cb: (shop: ShopDefinition) => void): void {
    this.onShopOpen = cb;
  }

  setOnShopClose(cb: () => void): void {
    this.onShopClose = cb;
  }

  setOnTransactionComplete(cb: (message: string) => void): void {
    this.onTransactionComplete = cb;
  }

  private setupControls(): void {
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyE") {
        if (this.isShopOpen) {
          this.closeShop();
        } else {
          this.tryOpenNearbyShop();
        }
      }
      if (e.code === "Escape" && this.isShopOpen) {
        this.closeShop();
      }
    });
  }

  createShopBuildings(): void {
    this.createShop("weapon_shop_1", "Cyber Arms Dealer", "weapon", new BABYLON.Vector3(320, 0, 120));
    this.createShop("armor_shop_1", "Titan Defense Shop", "armor", new BABYLON.Vector3(280, 0, 160));
    this.createShop("general_shop_1", "Neon Market", "general", new BABYLON.Vector3(360, 0, 80));
    this.createShop("general_shop_village_1", "Outpost Trader", "general", new BABYLON.Vector3(450, 0, 300));
    this.createShop("weapon_shop_village_1", "Frontier Armory", "weapon", new BABYLON.Vector3(150, 0, 350));
  }

  private createShop(id: string, name: string, type: ShopType, position: BABYLON.Vector3): void {
    const shopDef: ShopDefinition = {
      id,
      name,
      type,
      items: getShopItemsForType(type),
      position,
    };
    this.shops.push(shopDef);

    const buildingMesh = this.createShopMesh(shopDef);
    this.shopMeshes.set(id, buildingMesh);
  }

  private createShopMesh(shop: ShopDefinition): BABYLON.Mesh {
    const root = new BABYLON.Mesh("shop_" + shop.id, this.scene);
    root.position = shop.position.clone();

    let baseColor: BABYLON.Color3;
    let accentColor: BABYLON.Color3;
    let signText: string;

    switch (shop.type) {
      case "weapon":
        baseColor = new BABYLON.Color3(0.3, 0.1, 0.1);
        accentColor = new BABYLON.Color3(1.0, 0.2, 0.2);
        signText = "WEAPONS";
        break;
      case "armor":
        baseColor = new BABYLON.Color3(0.1, 0.15, 0.3);
        accentColor = new BABYLON.Color3(0.3, 0.5, 1.0);
        signText = "ARMOR";
        break;
      case "general":
        baseColor = new BABYLON.Color3(0.1, 0.25, 0.1);
        accentColor = new BABYLON.Color3(0.2, 1.0, 0.4);
        signText = "SHOP";
        break;
    }

    const building = BABYLON.MeshBuilder.CreateBox("shopBuilding_" + shop.id, {
      width: 10, height: 8, depth: 10,
    }, this.scene);
    building.position.y = 4;
    building.parent = root;
    const buildingMat = new BABYLON.StandardMaterial("shopBuildingMat_" + shop.id, this.scene);
    buildingMat.diffuseColor = baseColor;
    buildingMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    building.material = buildingMat;

    const roof = BABYLON.MeshBuilder.CreateBox("shopRoof_" + shop.id, {
      width: 11, height: 0.5, depth: 11,
    }, this.scene);
    roof.position.y = 8.25;
    roof.parent = root;
    const roofMat = new BABYLON.StandardMaterial("shopRoofMat_" + shop.id, this.scene);
    roofMat.diffuseColor = baseColor.scale(0.5);
    roof.material = roofMat;

    const signBoard = BABYLON.MeshBuilder.CreateBox("shopSign_" + shop.id, {
      width: 8, height: 2, depth: 0.3,
    }, this.scene);
    signBoard.position.y = 6.5;
    signBoard.position.z = -5.2;
    signBoard.parent = root;
    const signMat = new BABYLON.StandardMaterial("shopSignMat_" + shop.id, this.scene);
    signMat.diffuseColor = accentColor;
    signMat.emissiveColor = accentColor.scale(0.5);
    signBoard.material = signMat;

    const doorFrame = BABYLON.MeshBuilder.CreateBox("shopDoor_" + shop.id, {
      width: 3, height: 5, depth: 0.5,
    }, this.scene);
    doorFrame.position.y = 2.5;
    doorFrame.position.z = -5.1;
    doorFrame.parent = root;
    const doorMat = new BABYLON.StandardMaterial("shopDoorMat_" + shop.id, this.scene);
    doorMat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    doorMat.emissiveColor = accentColor.scale(0.1);
    doorFrame.material = doorMat;

    const leftPillar = BABYLON.MeshBuilder.CreateBox("shopPillarL_" + shop.id, {
      width: 0.5, height: 8, depth: 0.5,
    }, this.scene);
    leftPillar.position.set(-5.25, 4, -5.25);
    leftPillar.parent = root;
    const pillarMat = new BABYLON.StandardMaterial("shopPillarMat_" + shop.id, this.scene);
    pillarMat.diffuseColor = accentColor.scale(0.7);
    pillarMat.emissiveColor = accentColor.scale(0.3);
    leftPillar.material = pillarMat;

    const rightPillar = leftPillar.clone("shopPillarR_" + shop.id);
    rightPillar.position.set(5.25, 4, -5.25);
    rightPillar.parent = root;

    const beacon = BABYLON.MeshBuilder.CreateCylinder("shopBeacon_" + shop.id, {
      height: 0.3, diameter: 1.5, tessellation: 16,
    }, this.scene);
    beacon.position.y = 8.65;
    beacon.parent = root;
    const beaconMat = new BABYLON.StandardMaterial("shopBeaconMat_" + shop.id, this.scene);
    beaconMat.diffuseColor = accentColor;
    beaconMat.emissiveColor = accentColor;
    beacon.material = beaconMat;

    const beaconLight = new BABYLON.PointLight(
      "shopLight_" + shop.id,
      new BABYLON.Vector3(shop.position.x, shop.position.y + 9, shop.position.z),
      this.scene
    );
    beaconLight.diffuse = accentColor;
    beaconLight.intensity = 0.5;
    beaconLight.range = 20;

    return root;
  }

  private tryOpenNearbyShop(): void {
    const playerPos = this.camera.position;
    let closestShop: ShopDefinition | null = null;
    let closestDist = Infinity;

    for (const shop of this.shops) {
      const dist = BABYLON.Vector3.Distance(playerPos, new BABYLON.Vector3(
        shop.position.x, playerPos.y, shop.position.z
      ));
      if (dist < this.interactionRange && dist < closestDist) {
        closestDist = dist;
        closestShop = shop;
      }
    }

    if (closestShop) {
      this.openShop(closestShop);
    }
  }

  private openShop(shop: ShopDefinition): void {
    this.activeShop = shop;
    this.isShopOpen = true;
    console.log(`[ShopSystem] Opened shop: ${shop.name} (${shop.type})`);
    this.bus.emit(GameEvents.UI_MESSAGE, `Welcome to ${shop.name}!`);
    if (this.onShopOpen) {
      this.onShopOpen(shop);
    }
  }

  closeShop(): void {
    if (!this.isShopOpen) return;
    this.activeShop = null;
    this.isShopOpen = false;
    console.log("[ShopSystem] Shop closed");
    if (this.onShopClose) {
      this.onShopClose();
    }
  }

  buyItem(shopId: string, itemIndex: number, quantity: number = 1): boolean {
    const shop = this.shops.find(s => s.id === shopId);
    if (!shop) return false;

    const shopItem = shop.items[itemIndex];
    if (!shopItem) return false;
    if (shopItem.stock < quantity) {
      this.bus.emit(GameEvents.UI_MESSAGE, "Item out of stock!");
      return false;
    }

    const totalCost = shopItem.buyPrice * quantity;
    const credits = this.inventory.getItemCount("credits");
    if (credits < totalCost) {
      this.bus.emit(GameEvents.UI_MESSAGE, `Not enough credits! Need ${totalCost}, have ${credits}`);
      return false;
    }

    if (this.inventory.isFull()) {
      this.bus.emit(GameEvents.UI_MESSAGE, "Inventory is full!");
      return false;
    }

    this.inventory.removeItem("credits", totalCost);

    const itemDef = ITEM_DEFINITIONS[shopItem.item.id] ?? CRAFTING_MATERIALS[shopItem.item.id] ?? shopItem.item;
    this.inventory.addItem(itemDef, quantity);

    shopItem.stock -= quantity;

    const msg = `Bought ${quantity}x ${shopItem.item.name} for ${totalCost} credits`;
    console.log(`[ShopSystem] ${msg}`);
    this.bus.emit(GameEvents.UI_MESSAGE, msg);
    this.bus.emit(GameEvents.INVENTORY_CHANGED);

    if (this.onTransactionComplete) {
      this.onTransactionComplete(msg);
    }

    return true;
  }

  sellItem(shopId: string, inventoryItemId: string, quantity: number = 1): boolean {
    const shop = this.shops.find(s => s.id === shopId);
    if (!shop) return false;

    if (!this.inventory.hasItem(inventoryItemId, quantity)) {
      this.bus.emit(GameEvents.UI_MESSAGE, "You don't have enough of that item!");
      return false;
    }

    const shopItem = shop.items.find(si => si.item.id === inventoryItemId);
    let sellPrice: number;

    if (shopItem) {
      sellPrice = shopItem.sellPrice * quantity;
    } else {
      const itemDef = ITEM_DEFINITIONS[inventoryItemId] ?? CRAFTING_MATERIALS[inventoryItemId];
      if (itemDef) {
        sellPrice = Math.floor(itemDef.value * 0.4) * quantity;
      } else {
        sellPrice = 1 * quantity;
      }
    }

    this.inventory.removeItem(inventoryItemId, quantity);

    const creditsDef = ITEM_DEFINITIONS["credits"] ?? {
      id: "credits", name: "Credits", type: ItemType.Currency,
      rarity: ItemRarity.Common, maxStack: 9999, value: 1, description: "Universal currency",
    };
    this.inventory.addItem(creditsDef, sellPrice);

    if (shopItem) {
      shopItem.stock = Math.min(shopItem.stock + quantity, shopItem.maxStock);
    }

    const msg = `Sold ${quantity}x ${inventoryItemId} for ${sellPrice} credits`;
    console.log(`[ShopSystem] ${msg}`);
    this.bus.emit(GameEvents.UI_MESSAGE, msg);
    this.bus.emit(GameEvents.INVENTORY_CHANGED);

    if (this.onTransactionComplete) {
      this.onTransactionComplete(msg);
    }

    return true;
  }

  getActiveShop(): ShopDefinition | null {
    return this.activeShop;
  }

  isOpen(): boolean {
    return this.isShopOpen;
  }

  getShops(): ShopDefinition[] {
    return [...this.shops];
  }

  getShopById(id: string): ShopDefinition | undefined {
    return this.shops.find(s => s.id === id);
  }

  getNearbyShop(): ShopDefinition | null {
    const playerPos = this.camera.position;
    let closestShop: ShopDefinition | null = null;
    let closestDist = Infinity;

    for (const shop of this.shops) {
      const dist = BABYLON.Vector3.Distance(playerPos, new BABYLON.Vector3(
        shop.position.x, playerPos.y, shop.position.z
      ));
      if (dist < this.interactionRange && dist < closestDist) {
        closestDist = dist;
        closestShop = shop;
      }
    }

    return closestShop;
  }

  restockAll(): void {
    for (const shop of this.shops) {
      for (const item of shop.items) {
        item.stock = item.maxStock;
      }
    }
    console.log("[ShopSystem] All shops restocked");
  }

  update(): void {
  }

  dispose(): void {
    this.shopMeshes.forEach((mesh) => {
      mesh.dispose();
    });
    this.shopMeshes.clear();
    this.shops = [];
    this.activeShop = null;
    this.isShopOpen = false;
  }
}
