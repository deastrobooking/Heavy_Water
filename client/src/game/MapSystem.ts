import * as BABYLON from "@babylonjs/core";
import { ShopDefinition } from "./ShopSystem";
import { GardenDefinition } from "./GardenSystem";

export interface MapMarker {
  position: BABYLON.Vector3;
  type: "player" | "enemy" | "shop" | "garden" | "chest";
  label?: string;
}

export interface BaseMarker {
  position: BABYLON.Vector3;
  alive: boolean;
}

export interface SupplyCacheMarker {
  position: BABYLON.Vector3;
  looted: boolean;
}

export interface BossFortressMarker {
  position: BABYLON.Vector3;
  /** Spire still intact — render as bright pulsing gold star. */
  spireAlive: boolean;
  /** Outer turrets all destroyed — switches the marker to a brighter,
   *  rotating cue so the player knows the captain is exposed. */
  turretsCleared: boolean;
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
  private bases: BaseMarker[] = [];
  private supplyCaches: SupplyCacheMarker[] = [];
  private bossFortresses: BossFortressMarker[] = [];
  /** Player's last known world position — kept so distance-based icon
   *  fade/scale can be computed without each draw() caller passing it. */
  private playerWorldPos: BABYLON.Vector3 = new BABYLON.Vector3(0, 0, 0);
  private isVisible: boolean = true;

  /** Distance (world units) at which non-player icons start to shrink/fade.
   *  Inside this radius they render at full size; beyond it they ramp down
   *  toward the minimum so the map stays readable when the player is
   *  surrounded by ~130 lootable props. */
  private static readonly ICON_FALLOFF_NEAR = 80;
  /** Distance beyond which icons reach their minimum scale/opacity. */
  private static readonly ICON_FALLOFF_FAR = 320;

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
      ["GAMEPAD (XInput)", [
        ["L Stick", "Move"],
        ["R Stick", "Look"],
        ["RT / LT", "Fire / Mine"],
        ["A / B / X / Y", "Jump / Parry / Light / Heavy"],
        ["LB / RB", "Dodge / Reload"],
        ["LS / RS click", "Sprint / Cam toggle"],
        ["DPad U/D/L/R", "Flight / Sabre / Use / Plan"],
        ["Start / Back", "Build / Map"],
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

  /** Replaces the cached enemy-base positions used for the mini-map icons.
   *  Cheap to call every frame — we keep the latest snapshot only. */
  setEnemyBases(bases: ReadonlyArray<{ position: BABYLON.Vector3; alive: boolean }>): void {
    this.bases = bases.map(b => ({ position: b.position, alive: b.alive }));
  }

  /** Replaces the cached supply-cache (open container) positions used for
   *  the mini-map icons. Looted caches stay in the list so they can fade
   *  out instead of popping. */
  setSupplyCaches(caches: ReadonlyArray<{ position: BABYLON.Vector3; looted: boolean }>): void {
    this.supplyCaches = caches.map(c => ({ position: c.position, looted: c.looted }));
  }

  /** Replaces the cached boss-fortress positions used for the mini-map. */
  setBossFortresses(fs: ReadonlyArray<BossFortressMarker>): void {
    this.bossFortresses = fs.map(f => ({ ...f }));
  }

  updatePlayerPosition(playerPos: BABYLON.Vector3): void {
    this.playerWorldPos.copyFrom(playerPos);
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

  /** Compute a `{ scale, alpha }` pair for an icon at `worldPos` based on
   *  its distance from the player. Icons close to the player render at full
   *  size; far-off icons shrink and fade so the mini-map stays legible
   *  even when ~130 props + multiple bases are placed across the world. */
  private distanceFalloff(worldPos: BABYLON.Vector3): { scale: number; alpha: number } {
    const dx = worldPos.x - this.playerWorldPos.x;
    const dz = worldPos.z - this.playerWorldPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const near = MapSystem.ICON_FALLOFF_NEAR;
    const far = MapSystem.ICON_FALLOFF_FAR;
    if (dist <= near) return { scale: 1, alpha: 1 };
    if (dist >= far) return { scale: 0.45, alpha: 0.35 };
    const t = (dist - near) / (far - near);
    return { scale: 1 - t * 0.55, alpha: 1 - t * 0.65 };
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

  /** If `targetWorldPos` falls outside the mini-map's visible window, return
   *  the on-border point + heading (radians) of an arrow that points toward
   *  it. Returns null when the target is on-screen or degenerate. The
   *  origin used for the ray is the player's icon when it's on-screen, with
   *  a fallback to the map center if the player too is off-window — that
   *  way arrows still appear in a sensible direction in edge cases. */
  private computeEdgeArrow(
    targetWorldPos: BABYLON.Vector3
  ): { x: number; y: number; angle: number } | null {
    const w = this.mapCanvas.width;
    const h = this.mapCanvas.height;
    const target = this.worldToMapCoords(targetWorldPos);
    if (target.x >= 0 && target.x <= w && target.y >= 0 && target.y <= h) {
      return null;
    }

    // Inset so the rotated arrow head still fits inside the border frame
    // and isn't clipped at the corners.
    const inset = 10;
    const minX = inset;
    const maxX = w - inset;
    const minY = inset;
    const maxY = h - inset;

    // Use the player as the ray origin only when the icon is fully inside
    // the mini-map; otherwise fall back to the map center for both axes.
    // Mixing axes (player.x but center.y, etc.) can produce arrows that
    // point to the wrong side when the player is near a border.
    const player = this.worldToMapCoords(this.playerWorldPos);
    const playerOnScreen =
      player.x >= 0 && player.x <= w && player.y >= 0 && player.y <= h;
    let ox = playerOnScreen ? player.x : w / 2;
    let oy = playerOnScreen ? player.y : h / 2;

    // Clamp the origin into the inset rect so the border-intersection math
    // always yields a positive t. Without this, a player hugging the very
    // edge of the map could produce a negative t and we'd lose the arrow
    // for a perfectly valid off-screen target.
    ox = Math.min(maxX, Math.max(minX, ox));
    oy = Math.min(maxY, Math.max(minY, oy));

    const dx = target.x - ox;
    const dy = target.y - oy;
    if (dx === 0 && dy === 0) return null;

    let t = Infinity;
    if (dx > 0) t = Math.min(t, (maxX - ox) / dx);
    else if (dx < 0) t = Math.min(t, (minX - ox) / dx);
    if (dy > 0) t = Math.min(t, (maxY - oy) / dy);
    else if (dy < 0) t = Math.min(t, (minY - oy) / dy);
    if (!isFinite(t) || t <= 0) return null;

    return {
      x: ox + dx * t,
      y: oy + dy * t,
      angle: Math.atan2(dy, dx),
    };
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

    // Supply caches: small dots that fade out once looted. Drawn before
    // bases/enemies so those higher-priority icons render on top.
    for (const cache of this.supplyCaches) {
      const coords = this.worldToMapCoords(cache.position);
      if (coords.x < 0 || coords.x > width || coords.y < 0 || coords.y > height) continue;
      const falloff = this.distanceFalloff(cache.position);
      // Looted caches fade aggressively but linger briefly so the player can
      // visually confirm "yep, already grabbed it" rather than the icon
      // popping out the moment they collect.
      const lootedMul = cache.looted ? 0.25 : 1.0;
      const alpha = falloff.alpha * lootedMul;
      if (alpha < 0.05) continue;
      const r = Math.max(1.5, 2.6 * falloff.scale);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = cache.looted
        ? "rgba(140, 130, 110, 1)"
        : "rgba(255, 215, 110, 1)";
      ctx.beginPath();
      ctx.arc(coords.x, coords.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (!cache.looted) {
        ctx.strokeStyle = "rgba(255, 170, 40, 1)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Enemy bases: bold red diamonds with a black outline. Cleared bases
    // (vault destroyed) drop to a dim hollow marker so the player can still
    // see "I've been here" without the icon screaming for attention.
    // Off-screen bases get a small directional arrow clamped to the border
    // so the player can orient toward the next objective from any spot.
    for (const base of this.bases) {
      const coords = this.worldToMapCoords(base.position);
      const onScreen =
        coords.x >= 0 && coords.x <= width && coords.y >= 0 && coords.y <= height;
      const falloff = this.distanceFalloff(base.position);

      if (onScreen) {
        // Bases stay readable further out than caches — they're the biggest
        // landmarks on the map, so we floor their scale a bit higher.
        const scale = Math.max(0.6, falloff.scale);
        const alpha = base.alive ? Math.max(0.55, falloff.alpha) : 0.35;
        const size = 6 * scale;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(coords.x, coords.y - size);
        ctx.lineTo(coords.x + size, coords.y);
        ctx.lineTo(coords.x, coords.y + size);
        ctx.lineTo(coords.x - size, coords.y);
        ctx.closePath();
        if (base.alive) {
          ctx.fillStyle = "rgba(255, 60, 60, 1)";
          ctx.fill();
          ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.strokeStyle = "rgba(120, 60, 60, 0.9)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else {
        const arrow = this.computeEdgeArrow(base.position);
        if (!arrow) continue;
        // Edge arrows shrink/fade with distance like the icons but keep a
        // higher floor so a far-off base is still visible at the border.
        // Cleared bases use a dim variant so they don't compete with live
        // objectives for the player's attention.
        const scale = Math.max(0.7, falloff.scale);
        const alpha = base.alive ? Math.max(0.55, falloff.alpha) : 0.28;
        const len = 7 * scale;
        const wid = 5 * scale;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(arrow.x, arrow.y);
        ctx.rotate(arrow.angle);
        ctx.beginPath();
        ctx.moveTo(len, 0);
        ctx.lineTo(-len * 0.6, -wid);
        ctx.lineTo(-len * 0.6, wid);
        ctx.closePath();
        if (base.alive) {
          ctx.fillStyle = "rgba(255, 80, 80, 1)";
          ctx.fill();
          ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.strokeStyle = "rgba(140, 80, 80, 0.9)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;

    // Boss fortresses: prominent gold star + pulsing ring. Always shows
    // an edge arrow when off-screen since this is THE objective.
    const t = performance.now() / 1000;
    for (const boss of this.bossFortresses) {
      const coords = this.worldToMapCoords(boss.position);
      const onScreen =
        coords.x >= 0 && coords.x <= width && coords.y >= 0 && coords.y <= height;
      const cleared = !boss.spireAlive;
      const fillColor = cleared
        ? "rgba(180, 180, 180, 1)"
        : boss.turretsCleared
          ? "rgba(255, 245, 130, 1)"
          : "rgba(255, 200, 60, 1)";
      const strokeColor = cleared
        ? "rgba(120, 120, 120, 0.8)"
        : "rgba(0, 0, 0, 0.85)";

      if (onScreen) {
        // Five-point star shape.
        const baseR = cleared ? 6 : 9 + Math.sin(t * 3) * 1.2;
        ctx.save();
        ctx.translate(coords.x, coords.y);
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? baseR : baseR * 0.45;
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        if (!cleared) {
          // Pulsing ring around the star to draw the eye to the objective.
          const ringR = 12 + Math.sin(t * 4) * 2;
          ctx.beginPath();
          ctx.arc(0, 0, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = boss.turretsCleared
            ? "rgba(255, 230, 100, 0.85)"
            : "rgba(255, 180, 50, 0.7)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.restore();
      } else if (!cleared) {
        const arrow = this.computeEdgeArrow(boss.position);
        if (!arrow) continue;
        const len = 11;
        const wid = 7;
        ctx.save();
        ctx.translate(arrow.x, arrow.y);
        ctx.rotate(arrow.angle);
        ctx.beginPath();
        ctx.moveTo(len, 0);
        ctx.lineTo(-len * 0.55, -wid);
        ctx.lineTo(-len * 0.55, wid);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
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
