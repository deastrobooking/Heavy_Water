import * as BABYLON from "@babylonjs/core";
import { ShopDefinition } from "./ShopSystem";
import { GardenDefinition } from "./GardenSystem";

export interface MapMarker {
  position: BABYLON.Vector3;
  type: "player" | "enemy" | "shop" | "garden" | "chest";
  label?: string;
}

export class MapSystem {
  private scene: BABYLON.Scene;
  private mapCanvas: HTMLCanvasElement;
  private mapContext: CanvasRenderingContext2D;
  private mapContainer: HTMLDivElement;
  private mapScale: number = 0.15;
  private worldCenter: BABYLON.Vector3 = new BABYLON.Vector3(600, 0, 600);
  private worldSize: number = 1200;
  private markers: Map<string, MapMarker> = new Map();
  private shops: ShopDefinition[] = [];
  private gardens: GardenDefinition[] = [];
  private isVisible: boolean = true;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.mapCanvas = document.createElement("canvas");
    this.mapCanvas.width = 250;
    this.mapCanvas.height = 250;
    this.mapContext = this.mapCanvas.getContext("2d")!;

    this.mapContainer = document.createElement("div");
    this.mapContainer.style.position = "absolute";
    this.mapContainer.style.top = "10px";
    this.mapContainer.style.right = "10px";
    this.mapContainer.style.border = "2px solid rgba(0, 255, 255, 0.8)";
    this.mapContainer.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    this.mapContainer.style.borderRadius = "8px";
    this.mapContainer.style.overflow = "hidden";
    this.mapContainer.style.zIndex = "1000";
    this.mapContainer.appendChild(this.mapCanvas);

    document.body.appendChild(this.mapContainer);
    this.setupControls();
  }

  private setupControls(): void {
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyM") {
        this.toggleMap();
      }
    });
  }

  toggleMap(): void {
    this.isVisible = !this.isVisible;
    this.mapContainer.style.display = this.isVisible ? "block" : "none";
  }

  setShops(shops: ShopDefinition[]): void {
    this.shops = shops;
  }

  setGardens(gardens: GardenDefinition[]): void {
    this.gardens = gardens;
  }

  updatePlayerPosition(playerPos: BABYLON.Vector3): void {
    this.markers.set("player", {
      position: playerPos,
      type: "player",
      label: "You",
    });
  }

  updateEnemies(enemyPositions: BABYLON.Vector3[]): void {
    this.markers.forEach((marker, key) => {
      if (marker.type === "enemy") {
        this.markers.delete(key);
      }
    });

    enemyPositions.forEach((pos, index) => {
      this.markers.set(`enemy_${index}`, {
        position: pos,
        type: "enemy",
      });
    });
  }

  updateChests(chestPositions: BABYLON.Vector3[]): void {
    this.markers.forEach((marker, key) => {
      if (marker.type === "chest") {
        this.markers.delete(key);
      }
    });

    chestPositions.forEach((pos, index) => {
      this.markers.set(`chest_${index}`, {
        position: pos,
        type: "chest",
      });
    });
  }

  private worldToMapCoords(worldPos: BABYLON.Vector3): { x: number; y: number } {
    const mapSize = this.mapCanvas.width;
    const halfSize = this.worldSize / 2;

    const relX = (worldPos.x - this.worldCenter.x + halfSize) / this.worldSize;
    const relZ = (worldPos.z - this.worldCenter.z + halfSize) / this.worldSize;

    const x = relX * mapSize;
    const y = relZ * mapSize;

    return { x, y };
  }

  draw(): void {
    if (!this.isVisible) return;

    const ctx = this.mapContext;
    const width = this.mapCanvas.width;
    const height = this.mapCanvas.height;

    ctx.fillStyle = "rgba(10, 10, 20, 0.9)";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(0, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    ctx.fillStyle = "rgba(0, 255, 255, 0.1)";
    const gridSize = width / 4;
    for (let i = 1; i < 4; i++) {
      ctx.fillRect(i * gridSize - 0.5, 0, 1, height);
      ctx.fillRect(0, i * gridSize - 0.5, width, 1);
    }

    for (const shop of this.shops) {
      const coords = this.worldToMapCoords(shop.position);
      if (coords.x >= 0 && coords.x <= width && coords.y >= 0 && coords.y <= height) {
        ctx.fillStyle = "rgba(255, 200, 0, 0.8)";
        ctx.beginPath();
        ctx.arc(coords.x, coords.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 150, 0, 1)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    for (const garden of this.gardens) {
      const coords = this.worldToMapCoords(garden.position);
      if (coords.x >= 0 && coords.x <= width && coords.y >= 0 && coords.y <= height) {
        ctx.fillStyle = "rgba(0, 255, 100, 0.8)";
        ctx.beginPath();
        ctx.rect(coords.x - 3, coords.y - 3, 6, 6);
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 200, 100, 1)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    this.markers.forEach((marker) => {
      const coords = this.worldToMapCoords(marker.position);

      if (coords.x < 0 || coords.x > width || coords.y < 0 || coords.y > height) {
        return;
      }

      switch (marker.type) {
        case "player":
          ctx.fillStyle = "rgba(255, 255, 255, 1)";
          ctx.beginPath();
          ctx.arc(coords.x, coords.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(200, 255, 200, 1)";
          ctx.lineWidth = 2;
          ctx.stroke();
          break;

        case "enemy":
          ctx.fillStyle = "rgba(255, 50, 50, 0.8)";
          ctx.beginPath();
          ctx.arc(coords.x, coords.y, 3, 0, Math.PI * 2);
          ctx.fill();
          break;

        case "chest":
          ctx.fillStyle = "rgba(200, 150, 50, 0.9)";
          ctx.beginPath();
          ctx.rect(coords.x - 2, coords.y - 2, 4, 4);
          ctx.fill();
          break;
      }
    });

    ctx.fillStyle = "rgba(200, 200, 200, 0.6)";
    ctx.font = "10px monospace";
    ctx.fillText("M to toggle", 5, height - 5);
  }

  dispose(): void {
    if (this.mapContainer.parentElement) {
      this.mapContainer.parentElement.removeChild(this.mapContainer);
    }
  }
}
