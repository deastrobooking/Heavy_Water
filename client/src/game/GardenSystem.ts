import * as BABYLON from "@babylonjs/core";
import { CompanionSystem, CompanionType } from "./CompanionSystem";
import { EventBus, GameEvents } from "./EventBus";

export interface GardenDefinition {
  id: string;
  name: string;
  position: BABYLON.Vector3;
}

export class GardenSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private companionSystem: CompanionSystem;
  private bus: EventBus;
  private gardens: GardenDefinition[] = [];
  private gardenMeshes: Map<string, BABYLON.Mesh> = new Map();
  private isGardenOpen: boolean = false;
  private currentGardenId: string | null = null;
  private onGardenOpen: ((gardenId: string) => void) | null = null;
  private onGardenClose: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera, companionSystem: CompanionSystem) {
    this.scene = scene;
    this.camera = camera;
    this.companionSystem = companionSystem;
    this.bus = EventBus.getInstance();
    this.setupControls();
  }

  private setupControls(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.code === "KeyG") {
        if (this.isGardenOpen) {
          this.closeGarden();
        } else {
          this.tryOpenNearbyGarden();
        }
      }
      if (e.code === "Escape" && this.isGardenOpen) {
        this.closeGarden();
      }
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  setOnGardenOpen(cb: (gardenId: string) => void): void {
    this.onGardenOpen = cb;
  }

  setOnGardenClose(cb: () => void): void {
    this.onGardenClose = cb;
  }

  createGardenBuildings(): void {
    this.createGarden("garden_1", "Neon Gardens", new BABYLON.Vector3(200, 0, 50));
    this.createGarden("garden_2", "Cyber Sanctuary", new BABYLON.Vector3(550, 0, 250));
    this.createGarden("garden_3", "Digital Paradise", new BABYLON.Vector3(100, 0, 500));
    this.createGarden("garden_4", "Pet Haven", new BABYLON.Vector3(600, 0, 600));
  }

  private createGarden(id: string, name: string, position: BABYLON.Vector3): void {
    const gardenDef: GardenDefinition = {
      id,
      name,
      position,
    };
    this.gardens.push(gardenDef);

    const buildingMesh = this.createGardenMesh(gardenDef);
    this.gardenMeshes.set(id, buildingMesh);
  }

  private createGardenMesh(garden: GardenDefinition): BABYLON.Mesh {
    const root = new BABYLON.Mesh("garden_" + garden.id, this.scene);
    root.position = garden.position.clone();

    const baseColor = new BABYLON.Color3(0.2, 0.3, 0.1);
    const accentColor = new BABYLON.Color3(0.4, 1.0, 0.2);

    const building = BABYLON.MeshBuilder.CreateBox("gardenBuilding_" + garden.id, {
      width: 12, height: 7, depth: 12,
    }, this.scene);
    building.position.y = 3.5;
    building.parent = root;
    const buildingMat = new BABYLON.StandardMaterial("gardenBuildingMat_" + garden.id, this.scene);
    buildingMat.diffuseColor = baseColor;
    buildingMat.specularColor = new BABYLON.Color3(0.05, 0.1, 0.05);
    building.material = buildingMat;

    const roof = BABYLON.MeshBuilder.CreateBox("gardenRoof_" + garden.id, {
      width: 13, height: 0.5, depth: 13,
    }, this.scene);
    roof.position.y = 7.25;
    roof.parent = root;
    const roofMat = new BABYLON.StandardMaterial("gardenRoofMat_" + garden.id, this.scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.1, 0.2, 0.05);
    roof.material = roofMat;

    const signBoard = BABYLON.MeshBuilder.CreateBox("gardenSign_" + garden.id, {
      width: 8, height: 1.8, depth: 0.3,
    }, this.scene);
    signBoard.position.y = 5.5;
    signBoard.position.z = -6.2;
    signBoard.parent = root;
    const signMat = new BABYLON.StandardMaterial("gardenSignMat_" + garden.id, this.scene);
    signMat.diffuseColor = accentColor;
    signMat.emissiveColor = accentColor.scale(0.4);
    signBoard.material = signMat;

    const door = BABYLON.MeshBuilder.CreateBox("gardenDoor_" + garden.id, {
      width: 2.5, height: 4, depth: 0.2,
    }, this.scene);
    door.position.y = 2;
    door.position.z = -6.1;
    door.parent = root;
    const doorMat = new BABYLON.StandardMaterial("gardenDoorMat_" + garden.id, this.scene);
    doorMat.diffuseColor = new BABYLON.Color3(0.1, 0.15, 0.08);
    door.material = doorMat;

    const planter1 = BABYLON.MeshBuilder.CreateCylinder("gardenPlanter1_" + garden.id, {
      diameter: 2, height: 0.8, tessellation: 12,
    }, this.scene);
    planter1.position.set(-3, 0.4, -3);
    planter1.parent = root;
    const planterMat = new BABYLON.StandardMaterial("gardenPlanterMat_" + garden.id, this.scene);
    planterMat.diffuseColor = new BABYLON.Color3(0.5, 0.3, 0.1);
    planter1.material = planterMat;

    const planter2 = planter1.clone("gardenPlanter2_" + garden.id)!;
    planter2.position.set(3, 0.4, -3);
    planter2.parent = root;

    const planter3 = planter1.clone("gardenPlanter3_" + garden.id)!;
    planter3.position.set(-3, 0.4, 3);
    planter3.parent = root;

    const planter4 = planter1.clone("gardenPlanter4_" + garden.id)!;
    planter4.position.set(3, 0.4, 3);
    planter4.parent = root;

    const beacon = BABYLON.MeshBuilder.CreateTorus("gardenBeacon_" + garden.id, {
      diameter: 2, thickness: 0.2, tessellation: 16,
    }, this.scene);
    beacon.position.y = 8;
    beacon.parent = root;
    const beaconMat = new BABYLON.StandardMaterial("gardenBeaconMat_" + garden.id, this.scene);
    beaconMat.diffuseColor = accentColor;
    beaconMat.emissiveColor = accentColor.scale(0.6);
    beacon.material = beaconMat;
    beacon.rotation.z = Math.PI / 4;

    return root;
  }

  private tryOpenNearbyGarden(): void {
    const tolerance = 25;
    const cameraPos = this.camera.position;

    for (const garden of this.gardens) {
      const dist = BABYLON.Vector3.Distance(cameraPos, garden.position);
      if (dist < tolerance) {
        this.openGarden(garden.id, garden.name);
        return;
      }
    }
  }

  private openGarden(gardenId: string, gardenName: string): void {
    this.isGardenOpen = true;
    this.currentGardenId = gardenId;
    if (this.onGardenOpen) {
      this.onGardenOpen(gardenId);
    }
  }

  closeGarden(): void {
    this.isGardenOpen = false;
    this.currentGardenId = null;
    if (this.onGardenClose) {
      this.onGardenClose();
    }
  }

  getGardens(): GardenDefinition[] {
    return [...this.gardens];
  }

  isGardenOpenCheck(): boolean {
    return this.isGardenOpen;
  }

  getCurrentGardenId(): string | null {
    return this.currentGardenId;
  }

  dispose(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    this.gardenMeshes.forEach((mesh) => mesh.dispose());
    this.gardenMeshes.clear();
    this.onGardenOpen = null;
    this.onGardenClose = null;
  }
}
