import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";

export type ElementalKind =
  | "lightning"
  | "ice"
  | "fireball"
  | "inferno"
  | "windstorm"
  | "psychic";

export type ElementalCategory = "tracking" | "dome";

export interface ElementalSpecial {
  kind: ElementalKind;
  name: string;
  category: ElementalCategory;
  key: string;
  level: number;
  cooldownMs: number;
  cooldownRemaining: number;
}

export interface ElementalDisplay {
  kind: ElementalKind;
  name: string;
  category: ElementalCategory;
  key: string;
  level: number;
  maxLevel: number;
  cooldownMs: number;
  cooldownRemaining: number;
  damagePerHit: number;
  radius: number;
  maxTargets: number;
}

const MAX_LEVEL = 5;

const ELEMENT_DEFS: Record<ElementalKind, {
  name: string;
  category: ElementalCategory;
  key: string;
  baseCooldown: number;
  baseDamage: number;
  baseRadius: number;
  baseTargets: number;
  color: BABYLON.Color3;
}> = {
  lightning: {
    name: "Lightning Strike",
    category: "tracking",
    key: "KeyZ",
    baseCooldown: 4000,
    baseDamage: 90,
    baseRadius: 4,
    baseTargets: 2,
    color: new BABYLON.Color3(0.7, 0.85, 1.0),
  },
  ice: {
    name: "Ice Strike",
    category: "tracking",
    key: "KeyI",
    baseCooldown: 4500,
    baseDamage: 75,
    baseRadius: 4,
    baseTargets: 2,
    color: new BABYLON.Color3(0.55, 0.85, 1.0),
  },
  fireball: {
    name: "Fireball",
    category: "tracking",
    key: "KeyN",
    baseCooldown: 3500,
    baseDamage: 110,
    baseRadius: 5,
    baseTargets: 2,
    color: new BABYLON.Color3(1.0, 0.45, 0.1),
  },
  inferno: {
    name: "Flame Inferno",
    category: "dome",
    key: "KeyU",
    baseCooldown: 8000,
    baseDamage: 140,
    baseRadius: 12,
    baseTargets: 999, // dome hits all in radius
    color: new BABYLON.Color3(1.0, 0.35, 0.05),
  },
  windstorm: {
    name: "Windstorm",
    category: "dome",
    key: "KeyT",
    baseCooldown: 7000,
    baseDamage: 95,
    baseRadius: 14,
    baseTargets: 999,
    color: new BABYLON.Color3(0.7, 0.95, 0.85),
  },
  psychic: {
    name: "Psychic Shockwave",
    category: "dome",
    key: "KeyM",
    baseCooldown: 9000,
    baseDamage: 165,
    baseRadius: 16,
    baseTargets: 999,
    color: new BABYLON.Color3(0.8, 0.4, 1.0),
  },
};

interface ActiveTracker {
  kind: ElementalKind;
  mesh: BABYLON.Mesh;
  trail?: BABYLON.Mesh;
  target: BABYLON.Mesh | null;
  damage: number;
  radius: number;
  velocity: BABYLON.Vector3;
  speed: number;
  lifetime: number;
  alreadyHit: Set<BABYLON.Mesh>;
  fromAbove: boolean;
  spawnPos: BABYLON.Vector3;
}

interface ActiveDome {
  kind: ElementalKind;
  mesh: BABYLON.Mesh;
  light: BABYLON.PointLight;
  radius: number;
  damage: number;
  damageTicksRemaining: number;
  tickIntervalMs: number;
  tickTimer: number;
  totalLifetime: number;
  elapsed: number;
  victims: Set<BABYLON.Mesh>;
  centerProvider: () => BABYLON.Vector3;
}

export class ElementalSpecialsSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private specials: Map<ElementalKind, ElementalSpecial> = new Map();
  private activeTrackers: ActiveTracker[] = [];
  private activeDomes: ActiveDome[] = [];
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private onChange: ((list: ElementalDisplay[]) => void) | null = null;
  private playerPosProvider: () => BABYLON.Vector3;
  private onCast: ((kind: ElementalKind) => void) | null = null;
  private pendingTimeouts: Set<number> = new Set();
  private pendingRafs: Set<number> = new Set();
  private disposed: boolean = false;

  constructor(
    scene: BABYLON.Scene,
    camera: BABYLON.FreeCamera,
    playerPosProvider: () => BABYLON.Vector3,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.playerPosProvider = playerPosProvider;
    this.initSpecials();
    this.bindKeys();
  }

  private initSpecials(): void {
    (Object.keys(ELEMENT_DEFS) as ElementalKind[]).forEach((kind) => {
      const def = ELEMENT_DEFS[kind];
      this.specials.set(kind, {
        kind,
        name: def.name,
        category: def.category,
        key: def.key,
        level: 1,
        cooldownMs: def.baseCooldown,
        cooldownRemaining: 0,
      });
    });
  }

  private bindKeys(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      // Allow firing only when no input/textarea is focused.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || (target as any).isContentEditable)) return;
      const list = Array.from(this.specials.values());
      for (const sp of list) {
        if (e.code === sp.key) {
          this.cast(sp.kind);
          return;
        }
      }
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  setOnChange(cb: (list: ElementalDisplay[]) => void): void {
    this.onChange = cb;
    cb(this.getDisplays());
  }

  setOnCast(cb: (kind: ElementalKind) => void): void {
    this.onCast = cb;
  }

  getDisplays(): ElementalDisplay[] {
    const out: ElementalDisplay[] = [];
    const list = Array.from(this.specials.values());
    for (const sp of list) {
      const def = ELEMENT_DEFS[sp.kind];
      out.push({
        kind: sp.kind,
        name: sp.name,
        category: sp.category,
        key: sp.key,
        level: sp.level,
        maxLevel: MAX_LEVEL,
        cooldownMs: sp.cooldownMs,
        cooldownRemaining: sp.cooldownRemaining,
        damagePerHit: this.scaledDamage(def, sp.level),
        radius: this.scaledRadius(def, sp.level),
        maxTargets: this.scaledTargets(def, sp.level),
      });
    }
    return out;
  }

  private scaledDamage(def: typeof ELEMENT_DEFS[ElementalKind], level: number): number {
    // +35% per level over base
    return Math.round(def.baseDamage * (1 + 0.35 * (level - 1)));
  }

  private scaledRadius(def: typeof ELEMENT_DEFS[ElementalKind], level: number): number {
    return def.baseRadius * (1 + 0.18 * (level - 1));
  }

  private scaledTargets(def: typeof ELEMENT_DEFS[ElementalKind], level: number): number {
    if (def.category === "dome") return 999;
    // Tracking: 2 (L1) → 10 (L5), linearly.
    const base = def.baseTargets;
    const span = 10 - base;
    return Math.min(10, Math.round(base + span * ((level - 1) / (MAX_LEVEL - 1))));
  }

  private scaledCooldown(def: typeof ELEMENT_DEFS[ElementalKind], level: number): number {
    // -8% per level
    return Math.max(1500, def.baseCooldown * Math.pow(0.92, level - 1));
  }

  upgrade(kind: ElementalKind): boolean {
    const sp = this.specials.get(kind);
    if (!sp) return false;
    if (sp.level >= MAX_LEVEL) return false;
    sp.level++;
    const def = ELEMENT_DEFS[kind];
    sp.cooldownMs = this.scaledCooldown(def, sp.level);
    this.notifyChange();
    return true;
  }

  cast(kind: ElementalKind): boolean {
    const sp = this.specials.get(kind);
    if (!sp) return false;
    if (sp.cooldownRemaining > 0) return false;
    sp.cooldownRemaining = sp.cooldownMs;

    const def = ELEMENT_DEFS[kind];
    const damage = this.scaledDamage(def, sp.level);
    const radius = this.scaledRadius(def, sp.level);
    const targets = this.scaledTargets(def, sp.level);

    if (def.category === "tracking") {
      this.spawnTrackingStrike(kind, damage, radius, targets);
    } else {
      this.spawnDome(kind, damage, radius);
    }

    EventBus.getInstance().emit(GameEvents.WEAPON_FIRED);
    this.onCast?.(kind);
    this.notifyChange();
    return true;
  }

  private currentEnemies(): BABYLON.Mesh[] {
    return this.lastEnemies;
  }

  private lastEnemies: BABYLON.Mesh[] = [];

  private spawnTrackingStrike(kind: ElementalKind, damage: number, radius: number, maxTargets: number): void {
    const def = ELEMENT_DEFS[kind];
    const playerPos = this.playerPosProvider();
    const enemies = this.pickNearestEnemies(playerPos, maxTargets, 80);

    if (enemies.length === 0) {
      // Fire one tracker straight forward as a "no target" visual fallback.
      const fwd = this.camera.getDirection(BABYLON.Vector3.Forward());
      const spawn = playerPos.add(new BABYLON.Vector3(0, 6, 0)).add(fwd.scale(2));
      this.spawnSingleTracker(kind, def, spawn, null, damage, radius);
      return;
    }

    enemies.forEach((target, idx) => {
      // Stagger spawn for a cool sequential feel
      this.scheduleTimeout(() => {
        if (this.disposed) return;
        if (target.isDisposed()) return;
        const spawn = this.computeSpawnFor(kind, target.position);
        this.spawnSingleTracker(kind, def, spawn, target, damage, radius);
      }, idx * 90);
    });
  }

  private scheduleTimeout(fn: () => void, ms: number): void {
    if (this.disposed) return;
    const id = window.setTimeout(() => {
      this.pendingTimeouts.delete(id);
      if (this.disposed) return;
      fn();
    }, ms);
    this.pendingTimeouts.add(id);
  }

  private scheduleRaf(fn: (id: number) => void): void {
    if (this.disposed) return;
    const id = window.requestAnimationFrame(() => {
      this.pendingRafs.delete(id);
      if (this.disposed) return;
      fn(id);
    });
    this.pendingRafs.add(id);
  }

  private computeSpawnFor(kind: ElementalKind, targetPos: BABYLON.Vector3): BABYLON.Vector3 {
    if (kind === "lightning") {
      return new BABYLON.Vector3(targetPos.x, targetPos.y + 60, targetPos.z);
    }
    if (kind === "ice") {
      // Erupts from below the target position
      return new BABYLON.Vector3(targetPos.x, Math.max(0, targetPos.y - 4), targetPos.z);
    }
    // Fireball: from player's chest area outward
    const playerPos = this.playerPosProvider();
    return playerPos.add(new BABYLON.Vector3(0, 1.4, 0));
  }

  private spawnSingleTracker(
    kind: ElementalKind,
    def: typeof ELEMENT_DEFS[ElementalKind],
    spawn: BABYLON.Vector3,
    target: BABYLON.Mesh | null,
    damage: number,
    radius: number,
  ): void {
    let mesh: BABYLON.Mesh;
    let speed = 0.6;
    const fromAbove = kind === "lightning";

    if (kind === "lightning") {
      mesh = BABYLON.MeshBuilder.CreateCylinder("lightningBolt", { height: 60, diameterTop: 0.05, diameterBottom: 1.1, tessellation: 8 }, this.scene);
      mesh.position = spawn.clone();
      speed = 2.4;
    } else if (kind === "ice") {
      mesh = BABYLON.MeshBuilder.CreateCylinder("iceShard", { height: 3.2, diameterTop: 0.04, diameterBottom: 1.4, tessellation: 8 }, this.scene);
      mesh.position = spawn.clone();
      speed = 1.6;
    } else {
      // fireball
      mesh = BABYLON.MeshBuilder.CreateSphere("fireball", { diameter: 1.4, segments: 12 }, this.scene);
      mesh.position = spawn.clone();
      speed = 0.65;
    }

    const mat = new BABYLON.StandardMaterial(`${kind}Mat`, this.scene);
    mat.emissiveColor = def.color.clone();
    mat.diffuseColor = def.color.clone();
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    if (kind === "lightning") mat.alpha = 0.92;
    if (kind === "ice") mat.alpha = 0.85;
    mesh.material = mat;
    mesh.isPickable = false;

    // Add light for punch
    const light = new BABYLON.PointLight(`${kind}Light`, mesh.position.clone(), this.scene);
    light.diffuse = def.color.clone();
    light.intensity = 4;
    light.range = 18;
    this.scheduleTimeout(() => { try { light.dispose(); } catch {} }, 600);

    // Compute initial velocity towards target
    let velocity: BABYLON.Vector3;
    if (target) {
      velocity = target.position.subtract(spawn).normalize().scale(speed);
    } else {
      velocity = this.camera.getDirection(BABYLON.Vector3.Forward()).scale(speed);
    }

    this.activeTrackers.push({
      kind,
      mesh,
      target,
      damage,
      radius,
      velocity,
      speed,
      lifetime: kind === "lightning" ? 600 : 3500,
      alreadyHit: new Set(),
      fromAbove,
      spawnPos: spawn.clone(),
    });
  }

  private spawnDome(kind: ElementalKind, damage: number, radius: number): void {
    const def = ELEMENT_DEFS[kind];
    const center = this.playerPosProvider();
    const mesh = BABYLON.MeshBuilder.CreateSphere(`${kind}Dome`, { diameter: 0.5, segments: 16 }, this.scene);
    mesh.position = center.clone();
    mesh.position.y = Math.max(0.5, center.y);
    const mat = new BABYLON.StandardMaterial(`${kind}DomeMat`, this.scene);
    mat.emissiveColor = def.color.clone();
    mat.diffuseColor = def.color.clone();
    mat.alpha = 0.55;
    mat.backFaceCulling = false;
    if (kind === "windstorm") {
      mat.wireframe = true;
      mat.alpha = 0.7;
    }
    mesh.material = mat;
    mesh.isPickable = false;

    const light = new BABYLON.PointLight(`${kind}DomeLight`, mesh.position.clone(), this.scene);
    light.diffuse = def.color.clone();
    light.intensity = 8;
    light.range = radius * 2.5;

    const tickIntervalMs = kind === "windstorm" ? 200 : 250;
    const totalLifetime = kind === "psychic" ? 700 : 1100; // dome animation duration
    const damageTicks = kind === "windstorm" ? 4 : kind === "inferno" ? 3 : 1;

    this.activeDomes.push({
      kind,
      mesh,
      light,
      radius,
      damage,
      damageTicksRemaining: damageTicks,
      tickIntervalMs,
      tickTimer: 0,
      totalLifetime,
      elapsed: 0,
      victims: new Set(),
      centerProvider: () => this.playerPosProvider(),
    });
  }

  private pickNearestEnemies(origin: BABYLON.Vector3, count: number, maxRange: number): BABYLON.Mesh[] {
    if (count <= 0) return [];
    const sorted = this.lastEnemies
      .filter((e) => !e.isDisposed())
      .map((e) => ({ e, d: BABYLON.Vector3.Distance(origin, e.position) }))
      .filter((entry) => entry.d <= maxRange)
      .sort((a, b) => a.d - b.d)
      .slice(0, count)
      .map((entry) => entry.e);
    return sorted;
  }

  update(dt: number, enemies: BABYLON.Mesh[], _playerPos: BABYLON.Vector3): { hitEnemy: BABYLON.Mesh; damage: number }[] {
    this.lastEnemies = enemies;
    const hits: { hitEnemy: BABYLON.Mesh; damage: number }[] = [];
    let cooldownChanged = false;

    // Game.tsx passes dt in seconds, but cooldowns/lifetimes/tick timers in this
    // system are stored in milliseconds (matches the *Ms suffix on those fields
    // and the baseCooldown literals in ELEMENT_DEFS). Convert once at the entry.
    const dtMs = dt * 1000;

    // tick cooldowns
    const cdList = Array.from(this.specials.values());
    for (const sp of cdList) {
      if (sp.cooldownRemaining > 0) {
        sp.cooldownRemaining = Math.max(0, sp.cooldownRemaining - dtMs);
        cooldownChanged = true;
      }
    }

    // trackers
    for (let i = this.activeTrackers.length - 1; i >= 0; i--) {
      const t = this.activeTrackers[i];
      t.lifetime -= dtMs;

      // Reacquire target if disposed
      if (t.target && t.target.isDisposed()) {
        t.target = this.pickNearestEnemies(t.mesh.position, 1, 60)[0] ?? null;
      }

      // Steering
      if (t.target) {
        const desired = t.target.position.subtract(t.mesh.position).normalize().scale(t.speed);
        // Lightning travels straight down quickly, others home aggressively.
        const steerLerp = t.kind === "lightning" ? 0.5 : 0.2;
        t.velocity = BABYLON.Vector3.Lerp(t.velocity, desired, steerLerp);
      }

      const step = t.velocity.scale(dtMs / 16);
      t.mesh.position.addInPlace(step);

      // Visual: face direction of travel for non-lightning
      if (t.kind !== "lightning") {
        const dir = t.velocity.length() > 0.001 ? t.velocity.normalize() : BABYLON.Vector3.Forward();
        const yaw = Math.atan2(dir.x, dir.z);
        t.mesh.rotation.y = yaw;
        if (t.kind === "fireball") t.mesh.rotation.x += 0.2;
      }

      // Hit check (sphere overlap with target / nearby enemies in radius)
      let detonated = false;
      const checkPos = t.mesh.position;
      const closeRadius = t.kind === "lightning" ? 2.0 : 1.6;

      for (const e of enemies) {
        if (e.isDisposed()) continue;
        if (BABYLON.Vector3.Distance(checkPos, e.position) <= closeRadius) {
          // Detonate AoE around impact
          for (const aoeE of enemies) {
            if (aoeE.isDisposed()) continue;
            if (BABYLON.Vector3.Distance(checkPos, aoeE.position) <= t.radius && !t.alreadyHit.has(aoeE)) {
              t.alreadyHit.add(aoeE);
              hits.push({ hitEnemy: aoeE, damage: t.damage });
            }
          }
          this.spawnImpactBurst(t.kind, checkPos, t.radius);
          detonated = true;
          break;
        }
      }

      if (detonated || t.lifetime <= 0 || t.mesh.position.y < -10) {
        t.mesh.dispose();
        this.activeTrackers.splice(i, 1);
      }
    }

    // domes
    for (let i = this.activeDomes.length - 1; i >= 0; i--) {
      const d = this.activeDomes[i];
      d.elapsed += dtMs;
      d.tickTimer -= dtMs;

      // Grow the dome
      const t = Math.min(1, d.elapsed / d.totalLifetime);
      const scale = 0.5 + (d.radius * 2) * t;
      d.mesh.scaling.setAll(scale);
      const mat = d.mesh.material as BABYLON.StandardMaterial;
      if (mat) mat.alpha = Math.max(0, (d.kind === "windstorm" ? 0.7 : 0.55) * (1 - t));
      d.light.intensity = Math.max(0, 8 * (1 - t));

      // Track player position for dome-on-player effects
      const center = d.centerProvider();
      d.mesh.position.x = center.x;
      d.mesh.position.z = center.z;
      d.mesh.position.y = Math.max(0.5, center.y);
      d.light.position = d.mesh.position.clone();

      // Rotate windstorm visually
      if (d.kind === "windstorm") {
        d.mesh.rotation.y += dtMs * 0.01;
      }

      if (d.tickTimer <= 0 && d.damageTicksRemaining > 0) {
        d.tickTimer = d.tickIntervalMs;
        d.damageTicksRemaining--;
        const center2 = d.centerProvider();
        for (const e of enemies) {
          if (e.isDisposed()) continue;
          if (BABYLON.Vector3.Distance(center2, e.position) <= d.radius) {
            // Each victim only gets full damage once per dome (avoid stacking large hits per tick),
            // but inferno/windstorm do reduced ticking damage on subsequent ticks.
            const isFirstHit = !d.victims.has(e);
            d.victims.add(e);
            const dmgScale = isFirstHit ? 1.0 : 0.35;
            hits.push({ hitEnemy: e, damage: d.damage * dmgScale });
          }
        }
      }

      if (d.elapsed >= d.totalLifetime) {
        d.mesh.dispose();
        d.light.dispose();
        this.activeDomes.splice(i, 1);
      }
    }

    if (cooldownChanged) this.notifyChange();
    return hits;
  }

  private spawnImpactBurst(kind: ElementalKind, position: BABYLON.Vector3, radius: number): void {
    const def = ELEMENT_DEFS[kind];
    const burst = BABYLON.MeshBuilder.CreateSphere(`${kind}Impact`, { diameter: 1, segments: 12 }, this.scene);
    burst.position = position.clone();
    burst.isPickable = false;
    const mat = new BABYLON.StandardMaterial(`${kind}ImpactMat`, this.scene);
    mat.emissiveColor = def.color.clone();
    mat.diffuseColor = def.color.clone();
    mat.alpha = 0.8;
    burst.material = mat;

    const light = new BABYLON.PointLight(`${kind}ImpactLight`, position.clone(), this.scene);
    light.diffuse = def.color.clone();
    light.intensity = 6;
    light.range = radius * 3;

    let frame = 0;
    const animate = () => {
      if (this.disposed) {
        try { burst.dispose(); } catch {}
        try { light.dispose(); } catch {}
        return;
      }
      frame++;
      const s = 1 + frame * (radius * 0.18);
      burst.scaling.setAll(s);
      mat.alpha = Math.max(0, 0.8 - frame * 0.08);
      light.intensity = Math.max(0, 6 - frame * 0.6);
      if (frame < 12) {
        this.scheduleRaf(animate);
      } else {
        try { burst.dispose(); } catch {}
        try { light.dispose(); } catch {}
      }
    };
    animate();
  }

  private notifyChange(): void {
    this.onChange?.(this.getDisplays());
  }

  getSpecial(kind: ElementalKind): ElementalSpecial | undefined {
    return this.specials.get(kind);
  }

  getMaxLevel(): number {
    return MAX_LEVEL;
  }

  setLevels(levels: Partial<Record<ElementalKind, number>>): void {
    let changed = false;
    for (const [kind, lvl] of Object.entries(levels) as [ElementalKind, number][]) {
      const sp = this.specials.get(kind);
      if (!sp || !lvl) continue;
      const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.floor(lvl)));
      if (clamped !== sp.level) {
        sp.level = clamped;
        sp.cooldownMs = this.scaledCooldown(ELEMENT_DEFS[kind], clamped);
        changed = true;
      }
    }
    if (changed) this.notifyChange();
  }

  getLevels(): Record<ElementalKind, number> {
    const out: Record<ElementalKind, number> = {
      lightning: 1,
      ice: 1,
      fireball: 1,
      inferno: 1,
      windstorm: 1,
      psychic: 1,
    };
    const list = Array.from(this.specials.values());
    for (const sp of list) out[sp.kind] = sp.level;
    return out;
  }

  dispose(): void {
    this.disposed = true;
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    for (const id of Array.from(this.pendingTimeouts)) {
      try { window.clearTimeout(id); } catch {}
    }
    this.pendingTimeouts.clear();
    for (const id of Array.from(this.pendingRafs)) {
      try { window.cancelAnimationFrame(id); } catch {}
    }
    this.pendingRafs.clear();
    for (const t of this.activeTrackers) {
      try { t.mesh.dispose(); } catch {}
    }
    this.activeTrackers = [];
    for (const d of this.activeDomes) {
      try { d.mesh.dispose(); } catch {}
      try { d.light.dispose(); } catch {}
    }
    this.activeDomes = [];
    this.onChange = null;
    this.onCast = null;
  }
}
