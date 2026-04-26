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
  private controlsPanel: HTMLDivElement;
  private keyHandler: (e: KeyboardEvent) => void;
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
    this.mapContainer.style.width = "260px";
    this.mapContainer.style.border = "2px solid rgba(0, 255, 255, 0.8)";
    this.mapContainer.style.backgroundColor = "rgba(0, 0, 0, 0.78)";
    this.mapContainer.style.borderRadius = "8px";
    this.mapContainer.style.overflow = "hidden";
    this.mapContainer.style.zIndex = "1000";
    this.mapContainer.style.fontFamily = "monospace";
    this.mapContainer.style.color = "rgba(220, 245, 255, 0.92)";
    this.mapContainer.style.boxShadow = "0 0 16px rgba(0, 255, 255, 0.15)";

    this.mapCanvas.style.display = "block";
    this.mapContainer.appendChild(this.mapCanvas);

    this.controlsPanel = this.buildControlsPanel();
    this.mapContainer.appendChild(this.controlsPanel);

    document.body.appendChild(this.mapContainer);
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.code === "KeyM") this.toggleMap();
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  private buildControlsPanel(): HTMLDivElement {
    const panel = document.createElement("div");
    panel.style.padding = "8px 10px 10px 10px";
    panel.style.borderTop = "1px solid rgba(0, 255, 255, 0.35)";
    panel.style.fontSize = "10px";
    panel.style.lineHeight = "1.45";
    panel.style.maxHeight = "260px";
    panel.style.overflowY = "auto";

    const title = document.createElement("div");
    title.textContent = "CONTROLS";
    title.style.color = "rgba(0, 255, 255, 0.95)";
    title.style.fontWeight = "bold";
    title.style.fontSize = "11px";
    title.style.letterSpacing = "1px";
    title.style.marginBottom = "6px";
    panel.appendChild(title);

    const sections: Array<[string, Array<[string, string]>]> = [
      ["MOVEMENT", [
        ["WASD", "Move"],
        ["Shift", "Sprint"],
        ["Space", "Jump (x2 dbl, x3 flight)"],
        ["X", "Toggle Flight"],
        ["Ctrl", "Descend (in flight)"],
        ["Q", "Dodge / Dash"],
        ["C", "Toggle 1st / 3rd person"],
      ]],
      ["COMBAT", [
        ["LMB", "Fire weapon"],
        ["V", "Light melee"],
        ["B", "Heavy melee"],
        ["F", "Parry"],
        ["R", "Reload / Rotate"],
        ["1-6", "Primary weapons"],
        ["7-0", "Special weapons"],
        ["T", "Beam Sabre"],
        ["E", "Interact"],
      ]],
      ["BUILD / WORLD", [
        ["G", "Build mode (blocks)"],
        ["LMB", "Place block (in build)"],
        ["RMB", "Mine / Remove"],
        ["R", "Rotate block / reload"],
        ["1-9 0 - =", "Select block type"],
        ["P / Esc", "Plan mode (prefabs)"],
        ["[ ]", "Cycle prefabs"],
        ["Wheel", "Cycle weapon/block"],
        ["M", "Toggle this panel"],
      ]],
    ];

    for (const [heading, rows] of sections) {
      const h = document.createElement("div");
      h.textContent = heading;
      h.style.color = "rgba(255, 200, 0, 0.85)";
      h.style.fontSize = "9px";
      h.style.letterSpacing = "1.5px";
      h.style.marginTop = "4px";
      h.style.marginBottom = "2px";
      panel.appendChild(h);

      for (const [k, label] of rows) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.gap = "8px";
        const key = document.createElement("span");
        key.textContent = k;
        key.style.color = "rgba(0, 255, 255, 0.95)";
        key.style.minWidth = "62px";
        const val = document.createElement("span");
        val.textContent = label;
        val.style.color = "rgba(220, 220, 220, 0.85)";
        val.style.textAlign = "right";
        val.style.flex = "1";
        row.appendChild(key);
        row.appendChild(val);
        panel.appendChild(row);
      }
    }

    return panel;
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
    window.removeEventListener("keydown", this.keyHandler);
    if (this.mapContainer.parentElement) {
      this.mapContainer.parentElement.removeChild(this.mapContainer);
    }
  }
}
