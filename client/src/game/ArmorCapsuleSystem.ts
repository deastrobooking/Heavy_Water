import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { ArmorSystem, ArmorPiece, ElementType, ARMOR_DEFINITIONS } from "./ArmorSystem";
import { ItemRarity } from "./InventorySystem";

export interface ArmorUpgrade {
  id: string;
  name: string;
  description: string;
  tier: number;
  cost: number;
  applied: boolean;
  effects: {
    movementSpeedBonus?: number;
    flightCapability?: boolean;
    defenseBonus?: number;
    specialAbility?: string;
    armorPiece?: ArmorPiece;
    element?: ElementType;
  };
}

const CAPSULE_UPGRADES: ArmorUpgrade[] = [
  {
    id: "flight_armor",
    name: "Aero-Flight Module",
    description: "Grants triple-jump flight capability. Soar through Detroit's skies.",
    tier: 1,
    cost: 0,
    applied: false,
    effects: {
      flightCapability: true,
      defenseBonus: 10,
      armorPiece: {
        id: "flight_chestplate",
        name: "Aero-Flight Chestplate",
        type: "chest",
        element: null,
        defense: 20,
        healthBonus: 30,
        staminaBonus: 15,
        level: 2,
        rarity: ItemRarity.Rare,
      },
    },
  },
  {
    id: "speed_boost",
    name: "Kinetic Accelerator",
    description: "Enhances movement speed by 25%. Sprint like the wind.",
    tier: 2,
    cost: 500,
    applied: false,
    effects: {
      movementSpeedBonus: 0.25,
      armorPiece: {
        id: "kinetic_boots",
        name: "Kinetic Boots",
        type: "boots",
        element: null,
        defense: 12,
        healthBonus: 15,
        staminaBonus: 25,
        level: 2,
        rarity: ItemRarity.Rare,
      },
    },
  },
  {
    id: "titan_defense",
    name: "Titan Defense Matrix",
    description: "Massive defense upgrade. Reduces incoming damage significantly.",
    tier: 3,
    cost: 1200,
    applied: false,
    effects: {
      defenseBonus: 40,
      armorPiece: {
        id: "titan_chestplate",
        name: "Titan Chestplate",
        type: "chest",
        element: null,
        defense: 50,
        healthBonus: 80,
        staminaBonus: 20,
        level: 4,
        rarity: ItemRarity.Epic,
      },
    },
  },
  {
    id: "fire_infusion",
    name: "Inferno Core",
    description: "Infuses armor with fire element. Burn enemies on contact.",
    tier: 3,
    cost: 1500,
    applied: false,
    effects: {
      element: ElementType.Fire,
      defenseBonus: 15,
      specialAbility: "Fire Aura - burns nearby enemies",
    },
  },
  {
    id: "electric_infusion",
    name: "Storm Conductor",
    description: "Infuses armor with electric element. Chain lightning on kills.",
    tier: 4,
    cost: 2000,
    applied: false,
    effects: {
      element: ElementType.Electric,
      defenseBonus: 20,
      specialAbility: "Lightning Shield - shocks attackers",
    },
  },
  {
    id: "quantum_armor",
    name: "Quantum Exo-Suit",
    description: "Ultimate armor upgrade. Quantum-level protection and abilities.",
    tier: 5,
    cost: 5000,
    applied: false,
    effects: {
      defenseBonus: 80,
      movementSpeedBonus: 0.15,
      flightCapability: true,
      specialAbility: "Quantum Dash - short-range teleport",
      armorPiece: {
        id: "quantum_full_set",
        name: "Quantum Exo-Suit",
        type: "chest",
        element: null,
        defense: 60,
        healthBonus: 100,
        staminaBonus: 30,
        level: 5,
        rarity: ItemRarity.Legendary,
      },
    },
  },
];

export class ArmorCapsuleSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private armorSystem: ArmorSystem;
  private laboratoryMeshes: BABYLON.Mesh[] = [];
  private capsuleMesh: BABYLON.Mesh | null = null;
  private capsuleGlow: BABYLON.PointLight | null = null;
  private upgrades: ArmorUpgrade[];
  private isUIOpen: boolean = false;
  private playerNearCapsule: boolean = false;
  private interactionDistance: number = 8;
  private capsulePosition: BABYLON.Vector3;
  private pulseTime: number = 0;
  private hasFlightArmor: boolean = false;
  private onUIToggle: ((open: boolean, upgrades: ArmorUpgrade[]) => void) | null = null;
  private onUpgradeApplied: ((upgrade: ArmorUpgrade) => void) | null = null;
  private promptMesh: BABYLON.Mesh | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(scene: BABYLON.Scene, armorSystem: ArmorSystem) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.armorSystem = armorSystem;
    this.upgrades = CAPSULE_UPGRADES.map(u => ({ ...u, effects: { ...u.effects } }));
    this.capsulePosition = new BABYLON.Vector3(30, 0, 30);
    this.buildLaboratory();
    this.setupInteraction();
  }

  private buildLaboratory(): void {
    const pos = this.capsulePosition;

    const floorMat = new BABYLON.StandardMaterial("labFloorMat", this.scene);
    floorMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.2);
    floorMat.specularColor = new BABYLON.Color3(0.4, 0.4, 0.6);
    floorMat.emissiveColor = new BABYLON.Color3(0.05, 0.05, 0.1);

    const floor = BABYLON.MeshBuilder.CreateBox("labFloor", { width: 20, height: 0.3, depth: 20 }, this.scene);
    floor.position = new BABYLON.Vector3(pos.x, 0.15, pos.z);
    floor.material = floorMat;
    this.laboratoryMeshes.push(floor);

    const glassMat = new BABYLON.StandardMaterial("labGlassMat", this.scene);
    glassMat.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.8);
    glassMat.alpha = 0.3;
    glassMat.specularColor = new BABYLON.Color3(1, 1, 1);
    glassMat.emissiveColor = new BABYLON.Color3(0.1, 0.15, 0.25);

    const wallPositions = [
      { x: pos.x - 10, z: pos.z, rx: 0, ry: 0, rz: 0, w: 0.2, h: 8, d: 20 },
      { x: pos.x + 10, z: pos.z, rx: 0, ry: 0, rz: 0, w: 0.2, h: 8, d: 20 },
      { x: pos.x, z: pos.z - 10, rx: 0, ry: 0, rz: 0, w: 20, h: 8, d: 0.2 },
      { x: pos.x, z: pos.z + 10, rx: 0, ry: 0, rz: 0, w: 20, h: 8, d: 0.2 },
    ];

    wallPositions.forEach((wp, i) => {
      const wall = BABYLON.MeshBuilder.CreateBox(`labWall${i}`, { width: wp.w, height: wp.h, depth: wp.d }, this.scene);
      wall.position = new BABYLON.Vector3(wp.x, 4, wp.z);
      wall.material = glassMat;
      this.laboratoryMeshes.push(wall);
    });

    const roofMat = new BABYLON.StandardMaterial("labRoofMat", this.scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.15);
    roofMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.05);

    const roof = BABYLON.MeshBuilder.CreateBox("labRoof", { width: 20, height: 0.3, depth: 20 }, this.scene);
    roof.position = new BABYLON.Vector3(pos.x, 8, pos.z);
    roof.material = roofMat;
    this.laboratoryMeshes.push(roof);

    const capsuleMat = new BABYLON.StandardMaterial("capsuleMat", this.scene);
    capsuleMat.diffuseColor = new BABYLON.Color3(0.2, 0.8, 1.0);
    capsuleMat.emissiveColor = new BABYLON.Color3(0.1, 0.4, 0.6);
    capsuleMat.alpha = 0.6;
    capsuleMat.specularColor = new BABYLON.Color3(1, 1, 1);
    capsuleMat.specularPower = 64;

    this.capsuleMesh = BABYLON.MeshBuilder.CreateCylinder("capsule", {
      height: 5,
      diameterTop: 2.5,
      diameterBottom: 2.5,
      tessellation: 24,
    }, this.scene);
    this.capsuleMesh.position = new BABYLON.Vector3(pos.x, 2.8, pos.z);
    this.capsuleMesh.material = capsuleMat;
    this.laboratoryMeshes.push(this.capsuleMesh);

    const capsuleTop = BABYLON.MeshBuilder.CreateSphere("capsuleTop", { diameter: 2.5, segments: 16 }, this.scene);
    capsuleTop.position = new BABYLON.Vector3(pos.x, 5.3, pos.z);
    capsuleTop.material = capsuleMat;
    this.laboratoryMeshes.push(capsuleTop);

    const capsuleBase = BABYLON.MeshBuilder.CreateCylinder("capsuleBase", {
      height: 0.5,
      diameterTop: 3.5,
      diameterBottom: 3.5,
      tessellation: 24,
    }, this.scene);
    capsuleBase.position = new BABYLON.Vector3(pos.x, 0.55, pos.z);
    const baseMat = new BABYLON.StandardMaterial("capsuleBaseMat", this.scene);
    baseMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.4);
    baseMat.emissiveColor = new BABYLON.Color3(0.05, 0.1, 0.15);
    capsuleBase.material = baseMat;
    this.laboratoryMeshes.push(capsuleBase);

    this.capsuleGlow = new BABYLON.PointLight("capsuleGlow", new BABYLON.Vector3(pos.x, 3, pos.z), this.scene);
    this.capsuleGlow.diffuse = new BABYLON.Color3(0.2, 0.8, 1.0);
    this.capsuleGlow.intensity = 2;
    this.capsuleGlow.range = 15;

    const innerLight = new BABYLON.PointLight("capsuleInnerLight", new BABYLON.Vector3(pos.x, 4, pos.z), this.scene);
    innerLight.diffuse = new BABYLON.Color3(0.5, 0.2, 1.0);
    innerLight.intensity = 1;
    innerLight.range = 5;

    this.createHolographicDisplays(pos);
    this.createEnergyRings(pos);

    const labSign = BABYLON.MeshBuilder.CreatePlane("labSign", { width: 6, height: 1.5 }, this.scene);
    labSign.position = new BABYLON.Vector3(pos.x, 7, pos.z + 10.2);
    const signMat = new BABYLON.StandardMaterial("labSignMat", this.scene);
    signMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    signMat.emissiveColor = new BABYLON.Color3(0.0, 0.8, 1.0);
    labSign.material = signMat;
    this.laboratoryMeshes.push(labSign);
  }

  private createHolographicDisplays(pos: BABYLON.Vector3): void {
    const holoMat = new BABYLON.StandardMaterial("holoMat", this.scene);
    holoMat.diffuseColor = new BABYLON.Color3(0, 1, 0.8);
    holoMat.emissiveColor = new BABYLON.Color3(0, 0.5, 0.4);
    holoMat.alpha = 0.4;

    const displayPositions = [
      new BABYLON.Vector3(pos.x - 5, 3, pos.z - 3),
      new BABYLON.Vector3(pos.x + 5, 3, pos.z - 3),
      new BABYLON.Vector3(pos.x - 5, 3, pos.z + 3),
      new BABYLON.Vector3(pos.x + 5, 3, pos.z + 3),
    ];

    displayPositions.forEach((dPos, i) => {
      const display = BABYLON.MeshBuilder.CreatePlane(`holoDisplay${i}`, { width: 2.5, height: 3 }, this.scene);
      display.position = dPos;
      display.rotation.y = i < 2 ? Math.PI / 6 : -Math.PI / 6;
      display.material = holoMat;
      this.laboratoryMeshes.push(display);

      const displayLight = new BABYLON.PointLight(`holoLight${i}`, dPos, this.scene);
      displayLight.diffuse = new BABYLON.Color3(0, 1, 0.8);
      displayLight.intensity = 0.3;
      displayLight.range = 3;
    });
  }

  private createEnergyRings(pos: BABYLON.Vector3): void {
    const ringMat = new BABYLON.StandardMaterial("ringMat", this.scene);
    ringMat.diffuseColor = new BABYLON.Color3(0.3, 0.6, 1.0);
    ringMat.emissiveColor = new BABYLON.Color3(0.2, 0.4, 0.8);
    ringMat.alpha = 0.5;

    for (let i = 0; i < 3; i++) {
      const ring = BABYLON.MeshBuilder.CreateTorus(`energyRing${i}`, {
        diameter: 3.5 + i * 0.3,
        thickness: 0.08,
        tessellation: 32,
      }, this.scene);
      ring.position = new BABYLON.Vector3(pos.x, 1.5 + i * 1.5, pos.z);
      ring.material = ringMat;
      this.laboratoryMeshes.push(ring);
    }
  }

  private setupInteraction(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.code === "KeyE" && this.playerNearCapsule && !this.isUIOpen) {
        this.openUI();
      } else if (e.code === "Escape" && this.isUIOpen) {
        this.closeUI();
      }
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  update(deltaTime: number, playerPosition: BABYLON.Vector3): void {
    this.pulseTime += deltaTime;

    if (this.capsuleMesh) {
      const pulse = Math.sin(this.pulseTime * 2) * 0.1 + 0.6;
      const mat = this.capsuleMesh.material as BABYLON.StandardMaterial;
      if (mat) {
        mat.emissiveColor = new BABYLON.Color3(0.1 * pulse, 0.4 * pulse, 0.6 * pulse);
      }
    }

    if (this.capsuleGlow) {
      this.capsuleGlow.intensity = 1.5 + Math.sin(this.pulseTime * 3) * 0.5;
    }

    this.laboratoryMeshes.forEach((mesh) => {
      if (mesh.name.startsWith("energyRing")) {
        mesh.rotation.y += deltaTime * 0.5;
        mesh.rotation.x = Math.sin(this.pulseTime + parseFloat(mesh.name.replace("energyRing", "")) * 2) * 0.3;
      }
    });

    const dist = BABYLON.Vector3.Distance(playerPosition, this.capsulePosition);
    const wasNear = this.playerNearCapsule;
    this.playerNearCapsule = dist < this.interactionDistance;

    if (this.playerNearCapsule && !wasNear) {
      this.bus.emit(GameEvents.UI_MESSAGE, "Press E to access Armor Capsule");
      this.showPrompt(true);
    } else if (!this.playerNearCapsule && wasNear) {
      this.showPrompt(false);
      if (this.isUIOpen) {
        this.closeUI();
      }
    }
  }

  private showPrompt(visible: boolean): void {
    if (visible && !this.promptMesh) {
      const promptMat = new BABYLON.StandardMaterial("promptMat", this.scene);
      promptMat.diffuseColor = new BABYLON.Color3(1, 1, 0);
      promptMat.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0);

      this.promptMesh = BABYLON.MeshBuilder.CreatePlane("interactPrompt", { width: 2, height: 0.5 }, this.scene);
      this.promptMesh.position = new BABYLON.Vector3(this.capsulePosition.x, 6.5, this.capsulePosition.z);
      this.promptMesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      this.promptMesh.material = promptMat;
    } else if (!visible && this.promptMesh) {
      this.promptMesh.dispose();
      this.promptMesh = null;
    }
  }

  private openUI(): void {
    this.isUIOpen = true;
    if (this.onUIToggle) {
      this.onUIToggle(true, this.getAvailableUpgrades());
    }
  }

  private closeUI(): void {
    this.isUIOpen = false;
    if (this.onUIToggle) {
      this.onUIToggle(false, []);
    }
  }

  applyUpgrade(upgradeId: string, playerCredits: number): { success: boolean; message: string; upgrade?: ArmorUpgrade } {
    const upgrade = this.upgrades.find(u => u.id === upgradeId);
    if (!upgrade) {
      return { success: false, message: "Upgrade not found." };
    }
    if (upgrade.applied) {
      return { success: false, message: "Upgrade already applied." };
    }
    if (playerCredits < upgrade.cost) {
      return { success: false, message: `Not enough credits. Need ${upgrade.cost}, have ${playerCredits}.` };
    }

    upgrade.applied = true;

    if (upgrade.effects.armorPiece) {
      this.armorSystem.equipArmor({ ...upgrade.effects.armorPiece });
    }

    if (upgrade.effects.element) {
      this.armorSystem.setElement(upgrade.effects.element);
    }

    if (upgrade.effects.flightCapability) {
      this.hasFlightArmor = true;
    }

    if (this.onUpgradeApplied) {
      this.onUpgradeApplied(upgrade);
    }

    this.bus.emit(GameEvents.UI_MESSAGE, `Upgrade Applied: ${upgrade.name}`);
    this.bus.emit(GameEvents.INVENTORY_CHANGED);

    return { success: true, message: `${upgrade.name} installed successfully!`, upgrade };
  }

  getAvailableUpgrades(): ArmorUpgrade[] {
    return this.upgrades.map(u => ({ ...u, effects: { ...u.effects } }));
  }

  getHasFlightArmor(): boolean {
    return this.hasFlightArmor;
  }

  /**
   * Snapshot which capsule upgrades have been applied. Persisted via
   * `ProgressSync` so the shop UI doesn't re-offer (and re-charge for)
   * upgrades the player already bought — the 5000-credit Quantum
   * Exo-Suit being the most painful repeat purchase pre-fix.
   *
   * We persist *only* the id list — the equipped armor + element
   * side-effects round-trip through `ArmorSystem.serialize()`, and
   * `hasFlightArmor` round-trips through `PlayerController`. Keeping
   * those concerns split avoids double-restore conflicts on load.
   */
  serialize(): string[] {
    return this.upgrades.filter(u => u.applied).map(u => u.id);
  }

  /**
   * Restore the `applied` flag on each previously-purchased upgrade.
   * Pure UI/shop bookkeeping — does NOT replay equipArmor / setElement
   * (those are restored by ArmorSystem) and does NOT re-fire
   * `onUpgradeApplied` (that would spam UI messages on every load).
   * The internal `hasFlightArmor` mirror is also re-flipped so callers
   * that ask the capsule directly stay consistent with the persisted
   * player flag.
   */
  applyLoadedState(appliedIds: string[] | undefined): void {
    if (!appliedIds || appliedIds.length === 0) return;
    const wanted = new Set(appliedIds);
    for (const u of this.upgrades) {
      if (wanted.has(u.id)) {
        u.applied = true;
        if (u.effects.flightCapability) this.hasFlightArmor = true;
      }
    }
  }

  isOpen(): boolean {
    return this.isUIOpen;
  }

  isPlayerNear(): boolean {
    return this.playerNearCapsule;
  }

  getCapsulePosition(): BABYLON.Vector3 {
    return this.capsulePosition.clone();
  }

  setUIToggleCallback(callback: (open: boolean, upgrades: ArmorUpgrade[]) => void): void {
    this.onUIToggle = callback;
  }

  setUpgradeAppliedCallback(callback: (upgrade: ArmorUpgrade) => void): void {
    this.onUpgradeApplied = callback;
  }

  dispose(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    this.laboratoryMeshes.forEach(m => m.dispose());
    this.laboratoryMeshes = [];
    if (this.capsuleGlow) this.capsuleGlow.dispose();
    if (this.promptMesh) this.promptMesh.dispose();
    this.capsuleMesh = null;
    this.capsuleGlow = null;
    this.promptMesh = null;
    this.onUIToggle = null;
    this.onUpgradeApplied = null;
  }
}
