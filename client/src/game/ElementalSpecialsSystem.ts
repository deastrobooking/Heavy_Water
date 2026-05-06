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
  isCurrent: boolean;
}

const ELEMENT_ORDER: ElementalKind[] = [
  "lightning",
  "ice",
  "fireball",
  "inferno",
  "windstorm",
  "psychic",
];

const MAX_LEVEL = 20;

/** Credits cost to advance from `level` → `level + 1`. Mirrors the
 *  `upgradeCost` formula used by PLAYER_UPGRADES so the menu math feels
 *  consistent across tabs. */
function elementalUpgradeCost(level: number): number {
  return Math.floor(300 * (1 + level * 0.5));
}

export interface ElementalUpgradeInfo {
  kind: ElementalKind;
  name: string;
  category: ElementalCategory;
  level: number;
  maxLevel: number;
  damage: number;
  nextDamage: number | null;
  radius: number;
  nextRadius: number | null;
  cooldownMs: number;
  nextCooldownMs: number | null;
  /** Tracking elements only — domes are AoE so this stays at 0 for them. */
  projectilesPerCast: number;
  nextProjectilesPerCast: number | null;
  cost: number;
  affordable: boolean;
  maxed: boolean;
}

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

interface ActiveBeam {
  kind: ElementalKind;
  origin: BABYLON.Vector3;
  direction: BABYLON.Vector3;
  length: number;
  radius: number;
  damage: number;
  lifetime: number;
  elapsed: number;
  meshes: BABYLON.Mesh[];
  muzzleMesh: BABYLON.Mesh | null;
  light: BABYLON.PointLight | null;
  hit: Set<BABYLON.Mesh>;
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
  private activeBeams: ActiveBeam[] = [];
  private activeDomes: ActiveDome[] = [];
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private onChange: ((list: ElementalDisplay[]) => void) | null = null;
  private playerPosProvider: () => BABYLON.Vector3;
  private onCast: ((kind: ElementalKind) => void) | null = null;
  private pendingTimeouts: Set<number> = new Set();
  private pendingRafs: Set<number> = new Set();
  private disposed: boolean = false;
  private currentIndex: number = 0;
  // Throttle UI notifications. Cooldown ticks every frame would otherwise
  // re-render the React HUD ~60 times/sec, which is wasteful and contributed
  // to the prior sluggish feel.
  private notifyAccumMs: number = 0;
  private notifyIntervalMs: number = 100;

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
    // Iterate in canonical ELEMENT_ORDER so D-pad cycling and the HUD line up.
    for (let i = 0; i < ELEMENT_ORDER.length; i++) {
      const kind = ELEMENT_ORDER[i];
      const sp = this.specials.get(kind);
      if (!sp) continue;
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
        isCurrent: i === this.currentIndex,
      });
    }
    return out;
  }

  /** Cycle the currently-selected elemental (for RB-style "fire current"). */
  cycleCurrent(direction: number): void {
    const n = ELEMENT_ORDER.length;
    this.currentIndex = ((this.currentIndex + direction) % n + n) % n;
    this.notifyChange();
  }

  /** Cast whichever elemental is currently selected. Used by RB on controller. */
  castCurrent(): void {
    const kind = ELEMENT_ORDER[this.currentIndex];
    if (kind) this.cast(kind);
  }

  getCurrentKind(): ElementalKind {
    return ELEMENT_ORDER[this.currentIndex];
  }

  private scaledDamage(def: typeof ELEMENT_DEFS[ElementalKind], level: number): number {
    // +35% per level. At L20 = +665% (≈ 7.65× base) so endgame waves and
    // bolts melt titans without one-shotting the player's whole screen.
    return Math.round(def.baseDamage * (1 + 0.35 * (level - 1)));
  }

  private scaledRadius(def: typeof ELEMENT_DEFS[ElementalKind], level: number): number {
    // Domes scale much harder than trackers — at L20 the psychic shockwave
    // sweeps a ~70 m radius, large enough to clear a whole arena in one cast.
    const perLevel = def.category === "dome" ? 0.20 : 0.14;
    return def.baseRadius * (1 + perLevel * (level - 1));
  }

  private scaledTargets(def: typeof ELEMENT_DEFS[ElementalKind], level: number): number {
    if (def.category === "dome") return 999;
    // Tracking unique-targets cap: 2 (L1) → 10 (L20), linearly. Combined
    // with `scaledProjectilesPerCast` the actual number of bolts on screen
    // gets dramatic: up to 10 targets × 8 bolts each = 80 projectiles.
    const base = def.baseTargets;
    const span = 10 - base;
    return Math.min(10, Math.round(base + span * ((level - 1) / (MAX_LEVEL - 1))));
  }

  /** How many projectiles per target a tracking element fires per cast.
   *  Domes return 0 (they're area-of-effect and don't multiply this way).
   *  Tracking: starts at 1 @ L1 and gains one extra projectile every two
   *  levels, capped at 8 — so casts go from a single bolt to a dramatic
   *  volley of 8 bolts per target by L15+. */
  private scaledProjectilesPerCast(def: typeof ELEMENT_DEFS[ElementalKind], level: number): number {
    if (def.category === "dome") return 0;
    return Math.min(8, 1 + Math.floor((level - 1) / 2));
  }

  private scaledCooldown(def: typeof ELEMENT_DEFS[ElementalKind], level: number): number {
    // -8% per level (compounding). At L20 = ~0.205× base; we floor at 800ms
    // so the fastest specials can be re-cast almost as quickly as a basic
    // weapon, but still feel like a special.
    return Math.max(800, def.baseCooldown * Math.pow(0.92, level - 1));
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
    const projPerTarget = this.scaledProjectilesPerCast(def, sp.level);

    if (def.category === "tracking") {
      // The three tracking elementals (lightning, ice, fireball) used to
      // spawn up to (volley × targets) ≈ 80 self-tracking projectiles per
      // cast, each with its own mesh + material + point light. That was
      // crashing the scene on high-level casts. We collapse that storm
      // into ONE big mega-beam-style colored shaft that rays out from the
      // camera and one-shots everything in its path. Total damage is
      // preserved by folding the per-target volley + target count into a
      // single beam tick so player upgrades still pay off.
      const totalDamage = Math.round(damage * Math.max(1, targets) * Math.max(1, projPerTarget));
      this.spawnElementalBeam(kind, totalDamage, Math.max(radius, 5));
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

  private spawnTrackingStrike(
    kind: ElementalKind,
    damage: number,
    radius: number,
    maxTargets: number,
    projPerTarget: number,
  ): void {
    const def = ELEMENT_DEFS[kind];
    const playerPos = this.playerPosProvider();
    const enemies = this.pickNearestEnemies(playerPos, maxTargets, 80);
    const volley = Math.max(1, projPerTarget);

    if (enemies.length === 0) {
      // No targets: still fan out `volley` trackers forward so high-level
      // casts feel powerful even when nothing's around.
      const fwd = this.camera.getDirection(BABYLON.Vector3.Forward());
      const right = this.camera.getDirection(BABYLON.Vector3.Right());
      for (let i = 0; i < volley; i++) {
        this.scheduleTimeout(() => {
          if (this.disposed) return;
          const lateralOffset = (i - (volley - 1) / 2) * 1.6;
          const spawn = playerPos
            .add(new BABYLON.Vector3(0, 6, 0))
            .add(fwd.scale(2))
            .add(right.scale(lateralOffset));
          this.spawnSingleTracker(kind, def, spawn, null, damage, radius);
        }, i * 60);
      }
      return;
    }

    enemies.forEach((target, idx) => {
      for (let p = 0; p < volley; p++) {
        // Stagger spawn for a cool sequential feel — both across targets
        // and across the per-target volley.
        const delay = idx * 90 + p * 55;
        this.scheduleTimeout(() => {
          if (this.disposed) return;
          if (target.isDisposed()) return;
          const baseSpawn = this.computeSpawnFor(kind, target.position);
          const spawn = this.jitterSpawn(kind, baseSpawn, p, volley);
          this.spawnSingleTracker(kind, def, spawn, target, damage, radius);
        }, delay);
      }
    });
  }

  /** Adds a per-projectile spatial offset so the volley reads as a flurry
   *  instead of N projectiles overlapping in the same pixel. Lightning bolts
   *  splay out around the target on the XZ plane; ice eruptions ring around
   *  the target; fireballs fan out laterally from the player's chest. */
  private jitterSpawn(
    kind: ElementalKind,
    base: BABYLON.Vector3,
    index: number,
    volley: number,
  ): BABYLON.Vector3 {
    if (volley <= 1) return base;
    const angle = (index / volley) * Math.PI * 2;
    if (kind === "lightning") {
      const r = 1.2 + index * 0.4;
      return base.add(new BABYLON.Vector3(Math.cos(angle) * r, index * 0.6, Math.sin(angle) * r));
    }
    if (kind === "ice") {
      const r = 1.5 + index * 0.5;
      return base.add(new BABYLON.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
    }
    // fireball: lateral fan from camera-right
    const right = this.camera.getDirection(BABYLON.Vector3.Right());
    const up = this.camera.getDirection(BABYLON.Vector3.Up());
    const lateral = (index - (volley - 1) / 2) * 0.9;
    const vert = ((index % 2) === 0 ? 1 : -1) * 0.4 * Math.floor(index / 2);
    return base.add(right.scale(lateral)).add(up.scale(vert));
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

  /** Mega-beam-style colored shaft for the three tracking elementals.
   *  Modeled on MegaBeamCannonSystem.spawnBeam: 3 coaxial cylinders (white
   *  core / mid halo / outer glow) tinted to the element color, with a
   *  muzzle orb and a fill light. One damage tick per enemy whose hit
   *  volume intersects the beam. Cheap to render (4 meshes + 1 light vs
   *  the 80+ trackers + lights the old strike spawned). */
  private spawnElementalBeam(kind: ElementalKind, damage: number, beamRadius: number): void {
    const def = ELEMENT_DEFS[kind];
    const origin = this.playerPosProvider().add(new BABYLON.Vector3(0, 1.4, 0));
    const forward = this.camera.getDirection(BABYLON.Vector3.Forward()).normalize();
    const beamLength = 220;
    const muzzle = origin.add(forward.scale(2.0));
    const center = muzzle.add(forward.scale(beamLength * 0.5));

    // Inner core stays bright white for that anime "energy core" feel; the
    // halo + outer glow take the element tint.
    const tint = def.color.clone();
    const cylConfigs = [
      { diameter: beamRadius * 0.55, color: new BABYLON.Color3(1, 1, 1), alpha: 1.0 },
      { diameter: beamRadius * 1.15, color: tint, alpha: 0.65 },
      { diameter: beamRadius * 1.85, color: tint.scale(0.85), alpha: 0.32 },
    ];

    const meshes: BABYLON.Mesh[] = [];
    for (let i = 0; i < cylConfigs.length; i++) {
      const cfg = cylConfigs[i];
      const cyl = BABYLON.MeshBuilder.CreateCylinder(`elemBeam_${kind}_${i}_${Date.now()}`, {
        height: beamLength,
        diameter: cfg.diameter,
        tessellation: 18,
      }, this.scene);
      const mat = new BABYLON.StandardMaterial(`elemBeamMat_${kind}_${i}`, this.scene);
      mat.emissiveColor = cfg.color;
      mat.diffuseColor = cfg.color;
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mat.alpha = cfg.alpha;
      mat.disableLighting = true;
      cyl.material = mat;
      cyl.isPickable = false;
      cyl.position.copyFrom(center);
      // Default cylinder long axis is +Y; rotate so it lies along `forward`.
      const q = new BABYLON.Quaternion();
      BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Vector3.Up(), forward, q);
      cyl.rotationQuaternion = q;
      meshes.push(cyl);
    }

    const muzzleMesh = BABYLON.MeshBuilder.CreateSphere(`elemBeamMuzzle_${kind}_${Date.now()}`, {
      diameter: beamRadius * 2.4,
      segments: 16,
    }, this.scene);
    const mmat = new BABYLON.StandardMaterial(`elemBeamMuzzleMat_${kind}`, this.scene);
    mmat.emissiveColor = tint.clone();
    mmat.diffuseColor = tint.clone();
    mmat.alpha = 0.85;
    mmat.disableLighting = true;
    muzzleMesh.material = mmat;
    muzzleMesh.isPickable = false;
    muzzleMesh.position.copyFrom(muzzle);

    const light = new BABYLON.PointLight(`elemBeamLight_${kind}_${Date.now()}`, muzzle.clone(), this.scene);
    light.diffuse = tint.clone();
    light.specular = new BABYLON.Color3(1, 1, 1);
    light.intensity = 10;
    light.range = 60;

    const glow = this.scene.effectLayers?.find(l => l instanceof BABYLON.GlowLayer) as BABYLON.GlowLayer | undefined;
    if (glow) {
      for (const m of meshes) glow.addIncludedOnlyMesh(m);
      glow.addIncludedOnlyMesh(muzzleMesh);
    }

    this.activeBeams.push({
      kind,
      origin: muzzle.clone(),
      direction: forward.clone(),
      length: beamLength,
      radius: beamRadius,
      damage,
      lifetime: 1400, // ms — matches MegaBeamCannon's 1.4s
      elapsed: 0,
      meshes,
      muzzleMesh,
      light,
      hit: new Set(),
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
    let anyOnCooldown = false;
    for (const sp of cdList) {
      if (sp.cooldownRemaining > 0) {
        sp.cooldownRemaining = Math.max(0, sp.cooldownRemaining - dtMs);
        anyOnCooldown = true;
      }
    }
    // Throttle UI updates: only notify ~10 times/sec when something is on
    // cooldown. Avoids per-frame React re-renders of the elemental HUD.
    if (anyOnCooldown) {
      this.notifyAccumMs += dtMs;
      if (this.notifyAccumMs >= this.notifyIntervalMs) {
        this.notifyAccumMs = 0;
        cooldownChanged = true;
      }
    } else {
      this.notifyAccumMs = 0;
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

    // beams (lightning / ice / fireball replacement)
    for (let bi = this.activeBeams.length - 1; bi >= 0; bi--) {
      const beam = this.activeBeams[bi];
      beam.elapsed += dtMs;
      const tt = beam.elapsed / beam.lifetime;
      const fade = Math.max(0, 1 - tt);
      const pulse = 1 + Math.sin(beam.elapsed * 0.03) * 0.05;
      for (let mi = 0; mi < beam.meshes.length; mi++) {
        const m = beam.meshes[mi];
        const mat = m.material as BABYLON.StandardMaterial | null;
        if (!mat) continue;
        const baseAlpha = mi === 0 ? 1.0 : mi === 1 ? 0.65 : 0.32;
        mat.alpha = baseAlpha * fade;
        m.scaling.x = pulse;
        m.scaling.z = pulse;
      }
      if (beam.muzzleMesh) {
        const mmat = beam.muzzleMesh.material as BABYLON.StandardMaterial | null;
        if (mmat) mmat.alpha = 0.85 * fade;
        beam.muzzleMesh.scaling.setAll(1 + Math.sin(beam.elapsed * 0.022) * 0.15);
      }
      if (beam.light) beam.light.intensity = 10 * fade;

      // One-tick damage to anything inside the beam cylinder.
      const ox = beam.origin.x, oy = beam.origin.y, oz = beam.origin.z;
      const dx = beam.direction.x, dy = beam.direction.y, dz = beam.direction.z;
      const len = beam.length;
      for (const e of enemies) {
        if (!e || e.isDisposed() || beam.hit.has(e)) continue;
        const ex = e.position.x - ox;
        const ey = e.position.y - oy;
        const ez = e.position.z - oz;
        const proj = ex * dx + ey * dy + ez * dz;
        if (proj < 0 || proj > len) continue;
        const cx = ex - dx * proj;
        const cy = ey - dy * proj;
        const cz = ez - dz * proj;
        const perpSq = cx * cx + cy * cy + cz * cz;
        const meshHitR = (e.metadata as any)?.hitRadius ?? 1.5;
        const hitR = beam.radius + meshHitR;
        if (perpSq < hitR * hitR) {
          beam.hit.add(e);
          hits.push({ hitEnemy: e, damage: beam.damage });
        }
      }

      if (beam.elapsed >= beam.lifetime) {
        for (const m of beam.meshes) {
          try { m.material?.dispose(); } catch {}
          try { m.dispose(); } catch {}
        }
        if (beam.muzzleMesh) {
          try { beam.muzzleMesh.material?.dispose(); } catch {}
          try { beam.muzzleMesh.dispose(); } catch {}
        }
        try { beam.light?.dispose(); } catch {}
        this.activeBeams.splice(bi, 1);
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

  /** Surfaces every elemental's current/next stats + credit cost so the
   *  upgrade menu can render rows without reaching into private state.
   *  Pass the player's credit balance and `affordable` is computed for you. */
  getUpgradeInfo(credits: number): ElementalUpgradeInfo[] {
    const out: ElementalUpgradeInfo[] = [];
    for (const kind of ELEMENT_ORDER) {
      const sp = this.specials.get(kind);
      if (!sp) continue;
      const def = ELEMENT_DEFS[kind];
      const lvl = sp.level;
      const maxed = lvl >= MAX_LEVEL;
      const cost = maxed ? 0 : elementalUpgradeCost(lvl);
      out.push({
        kind,
        name: def.name,
        category: def.category,
        level: lvl,
        maxLevel: MAX_LEVEL,
        damage: this.scaledDamage(def, lvl),
        nextDamage: maxed ? null : this.scaledDamage(def, lvl + 1),
        radius: this.scaledRadius(def, lvl),
        nextRadius: maxed ? null : this.scaledRadius(def, lvl + 1),
        cooldownMs: this.scaledCooldown(def, lvl),
        nextCooldownMs: maxed ? null : this.scaledCooldown(def, lvl + 1),
        projectilesPerCast: this.scaledProjectilesPerCast(def, lvl),
        nextProjectilesPerCast: maxed ? null : this.scaledProjectilesPerCast(def, lvl + 1),
        cost,
        affordable: !maxed && credits >= cost,
        maxed,
      });
    }
    return out;
  }

  /** Credits cost to advance the given element from its current level. */
  getUpgradeCost(kind: ElementalKind): number {
    const sp = this.specials.get(kind);
    if (!sp) return 0;
    if (sp.level >= MAX_LEVEL) return 0;
    return elementalUpgradeCost(sp.level);
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
    for (const b of this.activeBeams) {
      for (const m of b.meshes) {
        try { m.material?.dispose(); } catch {}
        try { m.dispose(); } catch {}
      }
      if (b.muzzleMesh) {
        try { b.muzzleMesh.material?.dispose(); } catch {}
        try { b.muzzleMesh.dispose(); } catch {}
      }
      try { b.light?.dispose(); } catch {}
    }
    this.activeBeams = [];
    for (const d of this.activeDomes) {
      try { d.mesh.dispose(); } catch {}
      try { d.light.dispose(); } catch {}
    }
    this.activeDomes = [];
    this.onChange = null;
    this.onCast = null;
  }
}
