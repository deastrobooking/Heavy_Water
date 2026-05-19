import * as BABYLON from "@babylonjs/core";

export interface EnemyLike {
  health: number;
  maxHealth: number;
  isAlive: boolean;
  mesh: BABYLON.AbstractMesh;
  // Optional styling hints (used for aerial battleships, etc.)
  barWidth?: number;
  barHeight?: number;
  barColor?: string;
  barAccent?: string;
  barLabel?: string;
  barMaxDistance?: number;
}

interface BarEntry {
  enemy: EnemyLike;
  container: HTMLDivElement;
  fill: HTMLDivElement;
  label: HTMLDivElement | null;
  lastHealth: number;
}

export class EnemyHealthBarSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.Camera;
  private root: HTMLDivElement;
  private bars = new Map<EnemyLike, BarEntry>();
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private maxDistance = 90;
  private readonly tickIntervalMs = 1000 / 30;
  private tickAccumulatorMs = 0;
  private readonly liveEnemies = new Set<EnemyLike>();
  private readonly staleEnemies: EnemyLike[] = [];
  private readonly headWorld = new BABYLON.Vector3();
  private readonly screenPosition = new BABYLON.Vector3();
  private readonly identityMatrix = BABYLON.Matrix.Identity();

  constructor(scene: BABYLON.Scene, camera: BABYLON.Camera) {
    this.scene = scene;
    this.camera = camera;

    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "20",
      overflow: "hidden",
    } as CSSStyleDeclaration);
    document.body.appendChild(this.root);

    this.observer = this.scene.onBeforeRenderObservable.add(() => {
      this.tickAccumulatorMs += this.scene.getEngine().getDeltaTime();
      if (this.tickAccumulatorMs < this.tickIntervalMs) return;
      this.tickAccumulatorMs = 0;
      this.tick();
    });
  }

  setEnemyProvider(fn: () => EnemyLike[]): void {
    this.enemyProvider = fn;
  }

  private enemyProvider: () => EnemyLike[] = () => [];

  private getOrCreateBar(enemy: EnemyLike): BarEntry {
    let entry = this.bars.get(enemy);
    if (entry) return entry;

    const w = enemy.barWidth ?? 60;
    const h = enemy.barHeight ?? 8;
    const accent = enemy.barAccent ?? "rgba(255, 80, 80, 0.85)";
    const fillColor = enemy.barColor ?? "linear-gradient(90deg, #ff4444 0%, #ff8844 100%)";

    const container = document.createElement("div");
    Object.assign(container.style, {
      position: "absolute",
      width: `${w}px`,
      height: `${h}px`,
      background: "rgba(0,0,0,0.75)",
      border: `1px solid ${accent}`,
      borderRadius: "2px",
      transform: "translate(-50%, -100%)",
      boxShadow: `0 0 6px ${accent}, 0 0 4px rgba(0,0,0,0.6)`,
      transition: "opacity 120ms linear",
    } as CSSStyleDeclaration);

    const fill = document.createElement("div");
    Object.assign(fill.style, {
      width: "100%",
      height: "100%",
      background: fillColor,
      transition: "width 120ms linear",
    } as CSSStyleDeclaration);
    container.appendChild(fill);

    let label: HTMLDivElement | null = null;
    if (enemy.barLabel) {
      label = document.createElement("div");
      Object.assign(label.style, {
        position: "absolute",
        top: `-${Math.max(12, h + 4)}px`,
        left: "50%",
        transform: "translateX(-50%)",
        fontFamily: "'Press Start 2P', monospace",
        fontSize: "9px",
        letterSpacing: "1px",
        color: "#ffffff",
        textShadow: `0 0 4px ${accent}, 0 1px 2px rgba(0,0,0,0.9)`,
        whiteSpace: "nowrap",
        pointerEvents: "none",
      } as CSSStyleDeclaration);
      label.textContent = enemy.barLabel;
      container.appendChild(label);
    }

    this.root.appendChild(container);

    entry = { enemy, container, fill, label, lastHealth: enemy.health };
    this.bars.set(enemy, entry);
    return entry;
  }

  private removeBar(enemy: EnemyLike): void {
    const entry = this.bars.get(enemy);
    if (!entry) return;
    entry.container.remove();
    this.bars.delete(enemy);
  }

  private tick(): void {
    const enemies = this.enemyProvider();
    const live = this.liveEnemies;
    live.clear();

    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const camPos = this.camera.position;
    const transform = this.scene.getTransformMatrix();
    const viewport = this.camera.viewport.toGlobal(w, h);
    const camForward = this.camera.getForwardRay().direction;

    for (const enemy of enemies) {
      if (!enemy || !enemy.isAlive || !enemy.mesh || enemy.mesh.isDisposed()) continue;
      const meshPos = enemy.mesh.position;
      const dx = meshPos.x - camPos.x;
      const dy = meshPos.y - camPos.y;
      const dz = meshPos.z - camPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const perEnemyMax = enemy.barMaxDistance ?? this.maxDistance;
      if (distSq > perEnemyMax * perEnemyMax) continue;

      const dot = dx * camForward.x + dy * camForward.y + dz * camForward.z;
      if (dot <= 0) continue;

      live.add(enemy);

      const bb = enemy.mesh.getBoundingInfo().boundingBox;
      this.headWorld.set(
        meshPos.x,
        meshPos.y + (bb.maximum.y - bb.minimum.y) * 0.6 + 0.6,
        meshPos.z,
      );
      BABYLON.Vector3.ProjectToRef(
        this.headWorld,
        this.identityMatrix,
        transform,
        viewport,
        this.screenPosition,
      );
      const screen = this.screenPosition;

      if (screen.z < 0 || screen.z > 1) continue;

      const entry = this.getOrCreateBar(enemy);
      entry.container.style.left = `${screen.x}px`;
      entry.container.style.top = `${screen.y}px`;

      const ratio = Math.max(0, Math.min(1, enemy.health / Math.max(1, enemy.maxHealth)));
      if (entry.lastHealth !== enemy.health) {
        entry.fill.style.width = `${ratio * 100}%`;
        entry.lastHealth = enemy.health;
      }

      const fadeStart = Math.min(perEnemyMax * 0.35, 30);
      const fadeRange = Math.max(40, perEnemyMax - fadeStart);
      const distFade = Math.min(1, 1 - (Math.sqrt(distSq) - fadeStart) / fadeRange);
      entry.container.style.opacity = `${Math.max(0.35, distFade)}`;
    }

    this.staleEnemies.length = 0;
    for (const enemy of Array.from(this.bars.keys())) {
      if (!live.has(enemy) || !enemy.isAlive) {
        this.staleEnemies.push(enemy);
      }
    }
    for (const enemy of this.staleEnemies) this.removeBar(enemy);
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    for (const enemy of Array.from(this.bars.keys())) this.removeBar(enemy);
    this.root.remove();
  }
}
