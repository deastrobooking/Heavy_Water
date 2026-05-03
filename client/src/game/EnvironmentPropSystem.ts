import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import {
  IDamageable,
  DamageInfo,
  DamageResult,
  DamageResistance,
  DamageType,
} from "./DamageSystem";
import { PickupSpawnRequest, PickupType } from "./PickupSystem";

export type PropKind =
  | "crate"
  | "barrel"
  | "canister"
  | "container"
  | "holo_sign"
  | "open_container";

interface PropConfig {
  kind: PropKind;
  maxHealth: number;
  /** loot dropped on destruction (or auto-collected for open containers) */
  drops: PickupSpawnRequest[];
  spread: number;
  /** approximate "radius" for contact-damage tests (XZ distance) */
  contactRadius: number;
  /** approximate cap on prop height for loot spawn altitude */
  topY: number;
}

const PROP_CONFIGS: Record<PropKind, PropConfig> = {
  crate: {
    kind: "crate",
    maxHealth: 60,
    drops: [
      { type: "scrap_metal", amount: 2 },
      { type: "gear", amount: 1 },
    ],
    spread: 0.9,
    contactRadius: 1.1,
    topY: 1.0,
  },
  barrel: {
    kind: "barrel",
    maxHealth: 40,
    drops: [
      { type: "energy_core", amount: 1 },
      { type: "scrap_metal", amount: 1 },
    ],
    spread: 1.0,
    contactRadius: 0.9,
    topY: 1.2,
  },
  canister: {
    kind: "canister",
    maxHealth: 35,
    drops: [
      { type: "nano_fiber", amount: 1 },
      { type: "circuit_board", amount: 1 },
    ],
    spread: 0.8,
    contactRadius: 0.8,
    topY: 1.2,
  },
  container: {
    kind: "container",
    maxHealth: 140,
    drops: [
      { type: "scrap_metal", amount: 4 },
      { type: "gear", amount: 3 },
      { type: "circuit_board", amount: 1 },
      { type: "energy_core", amount: 1 },
    ],
    spread: 1.4,
    contactRadius: 1.8,
    topY: 1.6,
  },
  holo_sign: {
    kind: "holo_sign",
    maxHealth: 30,
    drops: [
      { type: "circuit_board", amount: 1 },
    ],
    spread: 0.7,
    contactRadius: 0.7,
    topY: 2.4,
  },
  open_container: {
    kind: "open_container",
    maxHealth: 120,
    drops: [
      { type: "scrap_metal", amount: 3 },
      { type: "gear", amount: 2 },
      { type: "health_kit", amount: 35 },
    ],
    spread: 1.0,
    contactRadius: 1.6,
    topY: 1.0,
  },
};

interface ActiveProp {
  id: number;
  kind: PropKind;
  root: BABYLON.Mesh;
  hitbox: BABYLON.Mesh;
  /** Canonical world position used by gameplay queries — does NOT jitter
   *  with the rattle/shake animation. The visual `root.position` may be
   *  offset slightly during a shake but is restored back to this anchor. */
  position: BABYLON.Vector3;
  config: PropConfig;
  damageable: PropDamageable;
  /** Open container: per-player one-shot loot spawn. */
  alreadyLooted?: boolean;
  /** For open container "ready to collect" pulse */
  glow?: BABYLON.Mesh | null;
  /** Performance.now() timestamp for next continuous smoke puff (low-HP). */
  nextSmokeAt?: number;
  /** Performance.now() timestamp until which the prop should rattle (loot/hit shake). */
  rattleUntil?: number;
  /** Total rattle duration (seconds) for the active rattle. */
  rattleDuration?: number;
  /** Rattle intensity scalar. */
  rattleAmp?: number;
  /** Visible damage stage. 0 = pristine, 1 = damaged (<60% HP), 2 = heavily damaged (<30% HP). */
  damageStage: number;
  /** Per-prop material clones, keyed by the child mesh name they were applied to.
   *  Materials in the system cache are shared between props, so we lazily clone
   *  any material we want to recolor / dim for damage states. */
  clonedMaterials?: Map<string, BABYLON.StandardMaterial>;
  /** Decoration meshes added during damage transitions (cracks, scorch patches,
   *  leaks, drip puddles) — disposed alongside the prop. */
  damageDecorations?: BABYLON.Mesh[];
}

/** System-wide per-material flash state. Materials are shared from the
 *  material cache, so flash state MUST be tracked at material scope —
 *  otherwise concurrent hits on different props that share a material
 *  race each other's restore timers. */
interface MaterialFlashState {
  /** Emissive color to restore to. Refreshed each time a new flash starts
   *  while no other flash is in flight, so external code that mutates the
   *  emissive between flashes is respected. */
  original: BABYLON.Color3;
  /** Monotonic counter — only the latest flash gets to restore. */
  token: number;
  /** How many flash timers are currently armed against this material. */
  inFlight: number;
}

/** Metadata stamped onto prop hitbox meshes — typed so callers can
 *  narrow `mesh.metadata` without casting through `any`. */
export interface PropHitboxMetadata {
  isProp: true;
  propKind: PropKind;
  damageable: PropDamageable;
}

class PropDamageable implements IDamageable {
  health: number;
  maxHealth: number;
  isAlive: boolean = true;
  isInvulnerable: boolean = false;
  resistances: DamageResistance[] = [];

  private getProp: () => ActiveProp;
  private system: EnvironmentPropSystem;

  constructor(system: EnvironmentPropSystem, maxHealth: number, getProp: () => ActiveProp) {
    this.system = system;
    this.getProp = getProp;
    this.health = maxHealth;
    this.maxHealth = maxHealth;
  }

  takeDamage(info: DamageInfo): DamageResult {
    if (!this.isAlive) {
      return { damageAmount: 0, wasKilled: false, wasBlocked: false, wasParried: false };
    }
    const prop = this.getProp();
    const finalDamage = Math.max(1, info.amount);
    const previousHealth = this.health;
    this.health = Math.max(0, this.health - finalDamage);

    const hitPos = info.hitPoint ? info.hitPoint.clone() : prop.position.clone();
    const bus = EventBus.getInstance();

    bus.emit("effect:hitImpact", {
      position: hitPos,
      color: new BABYLON.Color3(1.0, 0.95, 0.55),
      scale: 0.85,
    });
    bus.emit("sound:propHit", { kind: prop.kind, propId: prop.id });

    // Small smoke/spark puff at the hit point so even glancing hits read.
    if (this.health > 0) {
      bus.emit("effect:smokePuff", {
        position: hitPos,
        color: new BABYLON.Color3(0.4, 0.4, 0.42),
        scale: 0.55,
        rise: 1.1,
        duration: 0.55,
      });
    }

    this.system.flashProp(prop);
    // Tiny impact shake — different from the big "loot rattle" but reuses the
    // same kinematic offset path in tick().
    this.system.shakeProp(prop, 0.18, 0.045);

    // If the hit just dropped us under 30%, kick continuous smoke immediately.
    const lowFrac = 0.3;
    if (this.health > 0 && this.health / this.maxHealth < lowFrac && previousHealth / this.maxHealth >= lowFrac) {
      this.system.armContinuousSmoke(prop);
    }

    // Visible damage state progression — 60% → stage 1, 30% → stage 2.
    if (this.health > 0) {
      const frac = this.health / this.maxHealth;
      const targetStage = frac < 0.3 ? 2 : frac < 0.6 ? 1 : 0;
      if (targetStage > prop.damageStage) {
        this.system.applyDamageStage(prop, targetStage);
      }
    }

    if (this.health <= 0) {
      this.isAlive = false;
      this.system.destroyProp(prop);
      return { damageAmount: finalDamage, wasKilled: true, wasBlocked: false, wasParried: false };
    }
    return { damageAmount: finalDamage, wasKilled: false, wasBlocked: false, wasParried: false };
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  getPosition(): BABYLON.Vector3 {
    return this.getProp().position;
  }
}

/**
 * EnvironmentPropSystem: scatters Babylon-primitive sci-fi props (crates,
 * barrels, canisters, containers, holo-signs) across the world. Most are
 * IDamageable destructible; "open_container" props instead drop their loot
 * when the player walks within range.
 *
 * Props are picked up by the existing weapon-collision pipeline
 * (mesh.metadata.damageable) and the existing pickup pipeline
 * (GameEvents.PICKUP_SPAWNED).
 */
export class EnvironmentPropSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private props: ActiveProp[] = [];
  private nextId: number = 0;
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private materials: Map<string, BABYLON.StandardMaterial> = new Map();
  /** Per-material flash bookkeeping (see MaterialFlashState). */
  private materialFlashState: Map<number, MaterialFlashState> = new Map();

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());
    console.log("[EnvironmentPropSystem] Initialized");
  }

  setPlayerPosition(pos: BABYLON.Vector3): void {
    this.playerPos.copyFrom(pos);
  }

  private getMaterial(key: string, builder: () => BABYLON.StandardMaterial): BABYLON.StandardMaterial {
    let m = this.materials.get(key);
    if (!m) {
      m = builder();
      this.materials.set(key, m);
    }
    return m;
  }

  /** Returns currently-alive props (mainly for diagnostics). */
  getActiveProps(): ReadonlyArray<{ kind: PropKind; position: BABYLON.Vector3; hp: number }> {
    return this.props.filter(p => p.damageable.isAlive).map(p => ({
      kind: p.kind,
      position: p.position,
      hp: p.damageable.health,
    }));
  }

  /** Returns positions of every "supply cache" open container with its
   *  current looted state. Open containers are not destroyed when looted —
   *  they simply mark `alreadyLooted` and stop yielding pickups — so this
   *  exposes that flag for HUD/minimap consumers that want to fade looted
   *  caches out instead of removing them. */
  getOpenContainers(): ReadonlyArray<{ position: BABYLON.Vector3; looted: boolean }> {
    const out: Array<{ position: BABYLON.Vector3; looted: boolean }> = [];
    for (const p of this.props) {
      if (p.kind !== "open_container") continue;
      if (!p.damageable.isAlive) continue;
      out.push({ position: p.position, looted: !!p.alreadyLooted });
    }
    return out;
  }

  /** Returns mesh hitboxes for all alive props (so vehicle/contact code can iterate them). */
  getHitboxMeshes(): BABYLON.Mesh[] {
    return this.props.filter(p => p.damageable.isAlive).map(p => p.hitbox);
  }

  /** Spawn a single prop; returns the active record (or throws if over budget). */
  spawn(kind: PropKind, position: BABYLON.Vector3, yaw: number = 0): ActiveProp {
    if (this.props.length >= EnvironmentPropSystem.MAX_PROPS) {
      // Hard guard so direct `spawn()` callers also respect the world budget.
      // Throwing is loud on purpose: silently dropping props led to confusing
      // missing-loot reports during world layout iteration.
      throw new Error(
        `[EnvironmentPropSystem] MAX_PROPS (${EnvironmentPropSystem.MAX_PROPS}) reached; refusing to spawn '${kind}' at ${position.toString()}.`,
      );
    }
    const config = PROP_CONFIGS[kind];
    const id = this.nextId++;
    const root = new BABYLON.Mesh(`prop_${kind}_${id}`, this.scene);
    root.position.copyFrom(position);
    root.rotation.y = yaw;

    let topY = config.topY;
    let hitboxScale = new BABYLON.Vector3(1.6, 1.4, 1.6);

    switch (kind) {
      case "crate":
        this.buildCrate(root, id);
        topY = 1.0;
        hitboxScale = new BABYLON.Vector3(1.8, 1.6, 1.8);
        break;
      case "barrel":
        this.buildBarrel(root, id);
        topY = 1.4;
        hitboxScale = new BABYLON.Vector3(1.4, 1.6, 1.4);
        break;
      case "canister":
        this.buildCanister(root, id);
        topY = 1.4;
        hitboxScale = new BABYLON.Vector3(1.2, 1.6, 1.2);
        break;
      case "container":
        this.buildContainer(root, id);
        topY = 1.8;
        hitboxScale = new BABYLON.Vector3(3.4, 2.4, 1.8);
        break;
      case "holo_sign":
        this.buildHoloSign(root, id);
        topY = 2.4;
        hitboxScale = new BABYLON.Vector3(1.4, 2.6, 0.6);
        break;
      case "open_container":
        this.buildOpenContainer(root, id);
        topY = 1.0;
        hitboxScale = new BABYLON.Vector3(2.6, 1.2, 1.6);
        break;
    }

    const hitbox = BABYLON.MeshBuilder.CreateBox(`prop_hit_${id}`, {
      width: hitboxScale.x,
      height: hitboxScale.y,
      depth: hitboxScale.z,
    }, this.scene);
    hitbox.parent = root;
    hitbox.position.set(0, hitboxScale.y / 2, 0);
    hitbox.isVisible = false;
    hitbox.isPickable = true;

    // Two-phase init to break the cyclic dep between ActiveProp and
    // PropDamageable without resorting to `any`. The damageable holds a
    // getter so it always sees the latest prop record.
    let propRef: ActiveProp | null = null;
    const damageable = new PropDamageable(this, config.maxHealth, () => {
      if (!propRef) throw new Error("PropDamageable accessed before prop init");
      return propRef;
    });
    const prop: ActiveProp = {
      id,
      kind,
      root,
      hitbox,
      // Anchor is a clone — we'll restore root.position to this each frame
      // so any rattle/shake offset doesn't leak into gameplay-facing position.
      position: root.position.clone(),
      config: { ...config, topY },
      damageable,
      damageStage: 0,
    };
    propRef = prop;

    const propMeta: PropHitboxMetadata = {
      isProp: true,
      propKind: kind,
      damageable,
    };
    hitbox.metadata = { ...(hitbox.metadata || {}), ...propMeta };

    if (kind === "open_container") {
      prop.glow = this.attachReadyGlow(root);
    }

    this.props.push(prop);
    return prop;
  }

  /**
   * Soft cap on total spawned props world-wide. spawnCluster / spawn skip
   * additional props past this so a future content-creep doesn't tank
   * frame rate on lower-end devices. Tuned generously for current world
   * (~130 props placed); raise if a real budget profile demands it.
   */
  static readonly MAX_PROPS = 220;

  /**
   * Distance-based visual culling thresholds (squared, world units).
   *
   * Props farther than `CULL_DISTANCE_SQ` from the player have their visual
   * root `setEnabled(false)`, which cheaply removes the entire mesh group
   * (body + braces + glow + decorations + hitbox child) from rendering AND
   * picking. They re-enable once the player gets back within
   * `SHOW_DISTANCE_SQ` (slight hysteresis prevents per-frame flicker for
   * props sitting right on the boundary).
   *
   * Hitboxes are parented to the root, so disabled props are also skipped
   * by Babylon's picking (weapon raycasts ignore disabled meshes). The
   * ATV ram loop in Game.tsx still iterates every alive hitbox but does
   * its own ~2.6m proximity check, so far disabled props bail out cheaply.
   * Either way, at 200m+ neither weapons nor a ramming ATV could realistically
   * hit, so gating these interactions at the same threshold is deliberate.
   */
  private static readonly CULL_DISTANCE_SQ = 200 * 200;
  private static readonly SHOW_DISTANCE_SQ = 195 * 195;

  /**
   * Helper: spawn a small cluster of mixed props at `center`.
   *
   * `theme` biases the prop pool so areas feel distinct:
   *   - "industrial": crate/barrel/canister heavy (no holo signs by default)
   *   - "military": container/crate/barrel heavy (no holo signs by default)
   *   - "holo":      holo_sign heavy with a few crates/barrels
   *   - "mixed" (default): the original pool with everything
   *
   * `requiredKinds` guarantees those kinds are placed first (deterministic
   * cluster composition — e.g. ["open_container", "crate", "crate", "barrel"]
   * for a base "supply cache" that must always include a mix of crates,
   * barrels, and an open container). These count toward `count`.
   *
   * `forceOpenContainer` is a shorthand for `requiredKinds: ["open_container"]`
   * (kept for back-compat with the original API).
   */
  spawnCluster(
    center: BABYLON.Vector3,
    options?: {
      count?: number;
      radius?: number;
      includeOpenContainer?: boolean;
      includeHoloSign?: boolean;
      theme?: "industrial" | "military" | "holo" | "mixed";
      forceOpenContainer?: boolean;
      requiredKinds?: PropKind[];
    },
  ): void {
    const count = Math.max(2, options?.count ?? 4 + Math.floor(Math.random() * 3));
    const radius = options?.radius ?? 5;
    const theme = options?.theme ?? "mixed";

    let pool: PropKind[];
    let themeAllowsHolo = true;
    let themeAllowsOpen = true;
    switch (theme) {
      case "industrial":
        pool = ["crate", "crate", "crate", "barrel", "barrel", "canister"];
        themeAllowsHolo = false;
        themeAllowsOpen = false;
        break;
      case "military":
        pool = ["container", "container", "crate", "crate", "barrel", "canister"];
        themeAllowsHolo = false;
        themeAllowsOpen = false;
        break;
      case "holo":
        pool = ["holo_sign", "holo_sign", "holo_sign", "crate", "barrel"];
        themeAllowsOpen = false;
        break;
      case "mixed":
      default:
        pool = ["crate", "crate", "barrel", "barrel", "canister", "container"];
        break;
    }

    // Per-call overrides win over theme defaults.
    const includeOpen = options?.includeOpenContainer ?? themeAllowsOpen;
    const includeHolo = options?.includeHoloSign ?? themeAllowsHolo;
    if (includeOpen) pool.push("open_container");
    if (includeHolo) pool.push("holo_sign");

    // Compose the required-kinds list (back-compat with forceOpenContainer).
    const required: PropKind[] = [];
    if (options?.requiredKinds) required.push(...options.requiredKinds);
    if (options?.forceOpenContainer && !required.includes("open_container")) {
      required.unshift("open_container");
    }

    const positions: BABYLON.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const r = Math.random() * radius;
      positions.push(new BABYLON.Vector3(
        center.x + Math.cos(angle) * r,
        center.y,
        center.z + Math.sin(angle) * r,
      ));
    }

    // Plant required kinds first (deterministic), then random-fill from pool.
    for (let i = 0; i < positions.length; i++) {
      if (this.props.length >= EnvironmentPropSystem.MAX_PROPS) {
        console.warn(`[EnvironmentPropSystem] MAX_PROPS (${EnvironmentPropSystem.MAX_PROPS}) reached; skipping further cluster props.`);
        break;
      }
      const kind = i < required.length
        ? required[i]
        : pool[Math.floor(Math.random() * pool.length)];
      this.spawn(kind, positions[i], Math.random() * Math.PI * 2);
    }
  }

  /** Called by VehicleSystem/Game contact code when ATV strikes a prop. */
  applyContactDamage(prop: ActiveProp, amount: number, hitPoint?: BABYLON.Vector3): DamageResult {
    return prop.damageable.takeDamage({
      amount,
      damageType: DamageType.Collision,
      hitPoint: hitPoint || prop.position.clone(),
    });
  }

  /** Public: brief white/yellow emissive flash over the prop's primary mesh.
   *
   *  Flash bookkeeping is keyed by material `uniqueId` (not by prop) because
   *  the material cache shares one material instance across many props. If we
   *  tracked per-prop, a second prop's flash starting mid-flash on the first
   *  prop would either (a) capture the already-brightened color as "original"
   *  or (b) get its restore overridden by the first prop's earlier timer. */
  flashProp(prop: ActiveProp): void {
    const flash = new BABYLON.Color3(1.0, 0.95, 0.55);
    const dur = 110;
    for (const child of prop.root.getChildMeshes()) {
      const m = child.material as BABYLON.StandardMaterial | null;
      if (!m || !m.emissiveColor) continue;
      const key = m.uniqueId;
      let state = this.materialFlashState.get(key);
      if (!state) {
        state = { original: m.emissiveColor.clone(), token: 0, inFlight: 0 };
        this.materialFlashState.set(key, state);
      } else if (state.inFlight === 0) {
        // No flash currently active — refresh the baseline so any external
        // emissive change since the last flash (e.g. container glow state)
        // becomes the new restore target.
        state.original.copyFrom(m.emissiveColor);
      }
      state.token += 1;
      state.inFlight += 1;
      const myToken = state.token;
      m.emissiveColor = flash;
      setTimeout(() => {
        const current = this.materialFlashState.get(key);
        if (!current) return;
        current.inFlight = Math.max(0, current.inFlight - 1);
        if (!m || (m as any).isDisposed) return;
        // Only the latest flash gets to restore — earlier timers no-op.
        if (current.token === myToken) {
          m.emissiveColor = current.original;
        }
      }, dur);
    }
  }

  /** Public: schedule a brief kinematic shake of the prop's root mesh. */
  shakeProp(prop: ActiveProp, durationSec: number, amplitude: number): void {
    const now = performance.now();
    const endAt = now + durationSec * 1000;
    // Layer with any in-flight rattle: keep the larger amplitude and the later end.
    if (!prop.rattleUntil || endAt > prop.rattleUntil) {
      prop.rattleUntil = endAt;
      prop.rattleDuration = durationSec;
    }
    if (!prop.rattleAmp || amplitude > prop.rattleAmp) {
      prop.rattleAmp = amplitude;
    }
  }

  /** Public: arm continuous low-HP smoke for a prop. */
  armContinuousSmoke(prop: ActiveProp): void {
    prop.nextSmokeAt = performance.now();
  }

  /** Internal: a prop just died — drop loot via the bus + dispose meshes. */
  destroyProp(prop: ActiveProp): void {
    const dropPos = prop.position.add(new BABYLON.Vector3(0, 0.4, 0));
    this.bus.emit(GameEvents.PICKUP_SPAWNED, {
      position: dropPos,
      requests: prop.config.drops,
      spread: prop.config.spread,
    });
    // Big chunky impact on death
    this.bus.emit("effect:hitImpact", {
      position: dropPos,
      color: new BABYLON.Color3(1.0, 0.55, 0.15),
      scale: 1.8,
    });
    this.bus.emit("sound:propBreak", { kind: prop.kind, propId: prop.id });
    this.disposeProp(prop);
  }

  private disposeProp(prop: ActiveProp): void {
    if (prop.glow && !prop.glow.isDisposed()) prop.glow.dispose();
    if (prop.damageDecorations) {
      for (const d of prop.damageDecorations) {
        if (!d.isDisposed()) d.dispose();
      }
      prop.damageDecorations = undefined;
    }
    if (prop.clonedMaterials) {
      prop.clonedMaterials.forEach(m => { m.dispose(); });
      prop.clonedMaterials = undefined;
    }
    for (const child of prop.root.getChildMeshes()) {
      if (!child.isDisposed()) child.dispose();
    }
    if (!prop.hitbox.isDisposed()) prop.hitbox.dispose();
    if (!prop.root.isDisposed()) prop.root.dispose();
  }

  /** Public: advance a prop's visible damage stage to `target`, applying any
   *  intermediate stages cumulatively. No-op if already at/past `target`. */
  applyDamageStage(prop: ActiveProp, target: number): void {
    while (prop.damageStage < target) {
      prop.damageStage++;
      this.applyDamageStageStep(prop, prop.damageStage);
    }
  }

  private applyDamageStageStep(prop: ActiveProp, stage: number): void {
    switch (prop.kind) {
      case "crate": this.applyCrateDamage(prop, stage); break;
      case "barrel": this.applyBarrelDamage(prop, stage); break;
      case "canister": this.applyCanisterDamage(prop, stage); break;
      case "container": this.applyContainerDamage(prop, stage); break;
      case "holo_sign": this.applyHoloSignDamage(prop, stage); break;
      case "open_container": this.applyOpenContainerDamage(prop, stage); break;
    }
  }

  /** Find the first child mesh whose name starts with `prefix`. */
  private findChild(prop: ActiveProp, prefix: string): BABYLON.Mesh | null {
    for (const c of prop.root.getChildMeshes()) {
      if (c.name.startsWith(prefix)) return c as BABYLON.Mesh;
    }
    return null;
  }

  /** Lazily clone the material on `mesh` so we can safely mutate it for this
   *  prop without affecting other props sharing the cached material. */
  private clonePropMaterial(prop: ActiveProp, mesh: BABYLON.Mesh): BABYLON.StandardMaterial | null {
    const mat = mesh.material as BABYLON.StandardMaterial | null;
    if (!mat) return null;
    if (!prop.clonedMaterials) prop.clonedMaterials = new Map();
    let cloned = prop.clonedMaterials.get(mesh.name);
    if (cloned) return cloned;
    cloned = mat.clone(`${mat.name}_dmg_${prop.id}`);
    prop.clonedMaterials.set(mesh.name, cloned);
    mesh.material = cloned;
    return cloned;
  }

  private registerDecoration(prop: ActiveProp, mesh: BABYLON.Mesh): void {
    if (!prop.damageDecorations) prop.damageDecorations = [];
    prop.damageDecorations.push(mesh);
    mesh.isPickable = false;
  }

  /** Build a small dark soot/scorch patch as a child of the prop root. */
  private addScorchPatch(
    prop: ActiveProp,
    localPos: BABYLON.Vector3,
    width: number,
    depth: number,
    rotY: number = 0,
  ): BABYLON.Mesh {
    const patch = BABYLON.MeshBuilder.CreateBox(
      `propScorch_${prop.id}_${(prop.damageDecorations?.length ?? 0)}`,
      { width, height: 0.04, depth },
      this.scene,
    );
    patch.parent = prop.root;
    patch.position.copyFrom(localPos);
    patch.rotation.y = rotY;
    const m = new BABYLON.StandardMaterial(`propScorchMat_${prop.id}_${(prop.damageDecorations?.length ?? 0)}`, this.scene);
    m.diffuseColor = new BABYLON.Color3(0.04, 0.03, 0.02);
    m.emissiveColor = new BABYLON.Color3(0.0, 0.0, 0.0);
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    patch.material = m;
    this.registerDecoration(prop, patch);
    if (!prop.clonedMaterials) prop.clonedMaterials = new Map();
    prop.clonedMaterials.set(patch.name, m);
    return patch;
  }

  /** Build a dark crack line stripe (very thin box) on a face of the prop. */
  private addCrack(
    prop: ActiveProp,
    localPos: BABYLON.Vector3,
    length: number,
    rotZ: number,
    rotY: number = 0,
  ): BABYLON.Mesh {
    const crack = BABYLON.MeshBuilder.CreateBox(
      `propCrack_${prop.id}_${(prop.damageDecorations?.length ?? 0)}`,
      { width: length, height: 0.06, depth: 0.04 },
      this.scene,
    );
    crack.parent = prop.root;
    crack.position.copyFrom(localPos);
    crack.rotation.y = rotY;
    crack.rotation.z = rotZ;
    const m = new BABYLON.StandardMaterial(`propCrackMat_${prop.id}_${(prop.damageDecorations?.length ?? 0)}`, this.scene);
    m.diffuseColor = new BABYLON.Color3(0.02, 0.02, 0.03);
    m.emissiveColor = new BABYLON.Color3(0, 0, 0);
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    crack.material = m;
    this.registerDecoration(prop, crack);
    if (!prop.clonedMaterials) prop.clonedMaterials = new Map();
    prop.clonedMaterials.set(crack.name, m);
    return crack;
  }

  /** Build a glowing leak drip (and optional puddle) for canister damage. */
  private addLeak(
    prop: ActiveProp,
    color: BABYLON.Color3,
    height: number,
    withPuddle: boolean,
  ): void {
    const drip = BABYLON.MeshBuilder.CreateCylinder(
      `propLeak_${prop.id}_${(prop.damageDecorations?.length ?? 0)}`,
      { height, diameter: 0.12, tessellation: 8 },
      this.scene,
    );
    drip.parent = prop.root;
    drip.position.set((Math.random() - 0.5) * 0.25, height / 2 + 0.04, 0.36);
    const m = new BABYLON.StandardMaterial(
      `propLeakMat_${prop.id}_${(prop.damageDecorations?.length ?? 0)}`,
      this.scene,
    );
    m.diffuseColor = color.scale(0.4);
    m.emissiveColor = color;
    m.alpha = 0.85;
    drip.material = m;
    this.registerDecoration(prop, drip);
    if (!prop.clonedMaterials) prop.clonedMaterials = new Map();
    prop.clonedMaterials.set(drip.name, m);

    if (withPuddle) {
      const puddle = BABYLON.MeshBuilder.CreateCylinder(
        `propPuddle_${prop.id}_${(prop.damageDecorations?.length ?? 0)}`,
        { height: 0.02, diameter: 0.85, tessellation: 16 },
        this.scene,
      );
      puddle.parent = prop.root;
      puddle.position.set(0, 0.025, 0.55);
      const pm = new BABYLON.StandardMaterial(
        `propPuddleMat_${prop.id}_${(prop.damageDecorations?.length ?? 0)}`,
        this.scene,
      );
      pm.diffuseColor = color.scale(0.4);
      pm.emissiveColor = color.scale(0.7);
      pm.alpha = 0.75;
      puddle.material = pm;
      this.registerDecoration(prop, puddle);
      prop.clonedMaterials.set(puddle.name, pm);
    }
  }

  // --- Per-kind damage stage handlers ---

  private applyCrateDamage(prop: ActiveProp, stage: number): void {
    const body = this.findChild(prop, `propCrateBody_`);
    const seam = this.findChild(prop, `propCrateSeam_`);
    if (stage === 1) {
      // Darken & desaturate body, dim glow seam, add a couple of crack lines.
      if (body) {
        const m = this.clonePropMaterial(prop, body);
        if (m) {
          m.diffuseColor = new BABYLON.Color3(0.13, 0.15, 0.18);
          m.emissiveColor = new BABYLON.Color3(0.03, 0.03, 0.04);
        }
      }
      if (seam) {
        const m = this.clonePropMaterial(prop, seam);
        if (m) m.emissiveColor = new BABYLON.Color3(0.08, 0.4, 0.45);
      }
      this.addCrack(prop, new BABYLON.Vector3(0.0, 0.85, 0.76), 0.9, 0.5);
      this.addCrack(prop, new BABYLON.Vector3(-0.3, 0.55, 0.76), 0.6, -0.6);
    } else if (stage === 2) {
      // Heavy charring + dead seam glow + scorch patch on top.
      if (body) {
        const m = this.clonePropMaterial(prop, body);
        if (m) {
          m.diffuseColor = new BABYLON.Color3(0.07, 0.07, 0.08);
          m.emissiveColor = new BABYLON.Color3(0.0, 0.0, 0.0);
        }
      }
      if (seam) {
        const m = this.clonePropMaterial(prop, seam);
        if (m) m.emissiveColor = new BABYLON.Color3(0.0, 0.0, 0.0);
      }
      this.addScorchPatch(prop, new BABYLON.Vector3(0.2, 1.42, 0.0), 1.1, 0.9);
      this.addCrack(prop, new BABYLON.Vector3(0.4, 0.7, 0.76), 1.2, 0.9);
    }
  }

  private applyBarrelDamage(prop: ActiveProp, stage: number): void {
    const body = this.findChild(prop, `propBarrelBody_`);
    const band = this.findChild(prop, `propBarrelBand_`);
    if (stage === 1) {
      // Charred red → burnt brown; dim hazard band.
      if (body) {
        const m = this.clonePropMaterial(prop, body);
        if (m) {
          m.diffuseColor = new BABYLON.Color3(0.32, 0.12, 0.08);
          m.emissiveColor = new BABYLON.Color3(0.08, 0.02, 0.01);
        }
      }
      if (band) {
        const m = this.clonePropMaterial(prop, band);
        if (m) m.emissiveColor = new BABYLON.Color3(0.4, 0.32, 0.04);
      }
      // A vertical scorch streak up one side
      const streak = this.addScorchPatch(prop, new BABYLON.Vector3(0.48, 0.7, 0.0), 0.18, 0.9);
      streak.rotation.z = Math.PI / 2;
    } else if (stage === 2) {
      // Heavily charred — body almost black, hazard band dead.
      if (body) {
        const m = this.clonePropMaterial(prop, body);
        if (m) {
          m.diffuseColor = new BABYLON.Color3(0.1, 0.05, 0.04);
          m.emissiveColor = new BABYLON.Color3(0.02, 0.005, 0.0);
        }
      }
      if (band) {
        const m = this.clonePropMaterial(prop, band);
        if (m) m.emissiveColor = new BABYLON.Color3(0.05, 0.04, 0.0);
      }
      // Scorch on the lid + extra streak
      this.addScorchPatch(prop, new BABYLON.Vector3(0.0, 1.43, 0.0), 0.95, 0.95);
      const streak2 = this.addScorchPatch(prop, new BABYLON.Vector3(-0.48, 0.5, 0.0), 0.25, 1.1);
      streak2.rotation.z = Math.PI / 2;
    }
  }

  private applyCanisterDamage(prop: ActiveProp, stage: number): void {
    const body = this.findChild(prop, `propCanisterBody_`);
    const win = this.findChild(prop, `propCanisterWin_`);
    const leakColor = new BABYLON.Color3(0.3, 1.0, 0.55);
    if (stage === 1) {
      // Dim window glow; small leak drip starts.
      if (win) {
        const m = this.clonePropMaterial(prop, win);
        if (m) m.emissiveColor = new BABYLON.Color3(0.15, 0.5, 0.27);
      }
      if (body) {
        const m = this.clonePropMaterial(prop, body);
        if (m) m.diffuseColor = new BABYLON.Color3(0.09, 0.16, 0.24);
      }
      this.addLeak(prop, leakColor, 0.35, false);
    } else if (stage === 2) {
      // Window dead, body charred, larger leak with puddle below.
      if (win) {
        const m = this.clonePropMaterial(prop, win);
        if (m) m.emissiveColor = new BABYLON.Color3(0.04, 0.1, 0.06);
      }
      if (body) {
        const m = this.clonePropMaterial(prop, body);
        if (m) {
          m.diffuseColor = new BABYLON.Color3(0.06, 0.08, 0.1);
          m.emissiveColor = new BABYLON.Color3(0.0, 0.01, 0.01);
        }
      }
      this.addLeak(prop, leakColor, 0.7, true);
      this.addScorchPatch(prop, new BABYLON.Vector3(0.0, 1.34, 0.0), 0.6, 0.6);
    }
  }

  private applyContainerDamage(prop: ActiveProp, stage: number): void {
    const body = this.findChild(prop, `propContainerBody_`);
    const door = this.findChild(prop, `propContainerDoor_`);
    const light = this.findChild(prop, `propContainerLight_`);
    if (stage === 1) {
      // Dent/darken body; status light flickers warning red.
      if (body) {
        const m = this.clonePropMaterial(prop, body);
        if (m) {
          m.diffuseColor = new BABYLON.Color3(0.13, 0.2, 0.1);
          m.emissiveColor = new BABYLON.Color3(0.03, 0.04, 0.02);
        }
      }
      if (light) {
        const m = this.clonePropMaterial(prop, light);
        if (m) m.emissiveColor = new BABYLON.Color3(1.0, 0.1, 0.05);
      }
      // Cracked panel marks across door
      this.addCrack(prop, new BABYLON.Vector3(0.0, 1.3, 0.86), 1.0, 0.4);
      this.addCrack(prop, new BABYLON.Vector3(-0.2, 0.6, 0.86), 0.7, -0.5);
    } else if (stage === 2) {
      // Status light dies, heavy charring + scorch marks.
      if (body) {
        const m = this.clonePropMaterial(prop, body);
        if (m) {
          m.diffuseColor = new BABYLON.Color3(0.06, 0.09, 0.05);
          m.emissiveColor = new BABYLON.Color3(0.0, 0.0, 0.0);
        }
      }
      if (door) {
        const m = this.clonePropMaterial(prop, door);
        if (m) m.diffuseColor = new BABYLON.Color3(0.06, 0.06, 0.06);
      }
      if (light) {
        const m = this.clonePropMaterial(prop, light);
        if (m) m.emissiveColor = new BABYLON.Color3(0.0, 0.0, 0.0);
      }
      this.addScorchPatch(prop, new BABYLON.Vector3(-0.8, 1.4, 0.86), 1.2, 0.9);
      this.addScorchPatch(prop, new BABYLON.Vector3(1.0, 0.6, 0.86), 0.9, 0.7);
    }
  }

  private applyHoloSignDamage(prop: ActiveProp, stage: number): void {
    // Holo plate flicker color is driven by the per-frame tick() which reads
    // `prop.damageStage` directly — we don't need to mutate emissive here.
    // Plate material is already per-prop (`propHoloGlow_<id>`), so no clone.
    // Find the plate (skip the "cap_" sub-emitter).
    let plate: BABYLON.Mesh | null = null;
    for (const c of prop.root.getChildMeshes()) {
      if (c.name.startsWith("propHoloEmissive_") && !c.name.startsWith("propHoloEmissive_cap_")) {
        plate = c as BABYLON.Mesh;
        break;
      }
    }
    if (stage === 2) {
      // Plate visibly broken — tilt it and add a scorched halo on the post.
      if (plate) plate.rotation.z = -0.35;
      this.addScorchPatch(prop, new BABYLON.Vector3(0.0, 0.45, 0.12), 0.18, 0.18);
    }
  }

  private applyOpenContainerDamage(prop: ActiveProp, stage: number): void {
    if (stage === 1) {
      // Darken walls + add a crack across the back wall.
      for (const name of [`propOpenLeft_`, `propOpenRight_`, `propOpenFront_`, `propOpenBack_`]) {
        const c = this.findChild(prop, name);
        if (c) {
          const m = this.clonePropMaterial(prop, c);
          if (m) m.diffuseColor = new BABYLON.Color3(0.16, 0.13, 0.1);
        }
      }
      this.addCrack(prop, new BABYLON.Vector3(0.0, 0.55, -0.65), 1.4, 0.25);
    } else if (stage === 2) {
      for (const name of [`propOpenLeft_`, `propOpenRight_`, `propOpenFront_`, `propOpenBack_`]) {
        const c = this.findChild(prop, name);
        if (c) {
          const m = this.clonePropMaterial(prop, c);
          if (m) {
            m.diffuseColor = new BABYLON.Color3(0.07, 0.06, 0.05);
            m.emissiveColor = new BABYLON.Color3(0.0, 0.0, 0.0);
          }
        }
      }
      this.addScorchPatch(prop, new BABYLON.Vector3(0.6, 0.86, -0.65), 0.6, 0.5);
      this.addScorchPatch(prop, new BABYLON.Vector3(-1.18, 0.7, 0.0), 0.5, 0.6, Math.PI / 2);
    }
  }

  private tick(): void {
    if (this.props.length === 0) return;
    const ppos = this.playerPos;
    const lootRangeSq = 2.6 * 2.6;
    const now = performance.now();
    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i];
      if (!p.damageable.isAlive) {
        this.props.splice(i, 1);
        continue;
      }

      // ---- Distance-based visual culling ----
      // Cheap squared-distance check; no sqrt. Disabling the root naturally
      // cascades to all child meshes (visuals + hitbox) so Babylon skips
      // rendering and picking for far props. We also skip the rest of the
      // per-frame work (rattle, smoke, holo pulse, open-container loot)
      // for hidden props — none of it is observable from 200m+ away.
      const dxCull = ppos.x - p.position.x;
      const dyCull = ppos.y - p.position.y;
      const dzCull = ppos.z - p.position.z;
      const distSq = dxCull * dxCull + dyCull * dyCull + dzCull * dzCull;
      const wasEnabled = p.root.isEnabled(false);
      if (wasEnabled && distSq > EnvironmentPropSystem.CULL_DISTANCE_SQ) {
        // Snap any in-flight rattle back to anchor before hiding so the prop
        // doesn't pop back into view at an offset position next time.
        if (p.rattleUntil) {
          p.root.position.copyFrom(p.position);
          if (p.kind === "open_container") p.root.rotation.z = 0;
          p.rattleUntil = undefined;
          p.rattleDuration = undefined;
          p.rattleAmp = undefined;
        }
        // Clear smoke timer so we don't dump a backlog of puffs on re-enable.
        p.nextSmokeAt = undefined;
        p.root.setEnabled(false);
        continue;
      }
      if (!wasEnabled) {
        if (distSq < EnvironmentPropSystem.SHOW_DISTANCE_SQ) {
          p.root.setEnabled(true);
        } else {
          // Still hidden — skip all per-frame work below.
          continue;
        }
      }

      // ---- Rattle / impact-shake (kinematic, never persists into anchor) ----
      if (p.rattleUntil && p.rattleUntil > now && p.rattleDuration && p.rattleAmp) {
        const remaining = (p.rattleUntil - now) / 1000;
        const t = Math.max(0, Math.min(1, remaining / p.rattleDuration));
        // Decay the offset over the rattle's life so it eases out.
        const amp = p.rattleAmp * t;
        // Use simple time-based oscillators per axis for a busy "rattle" feel.
        const osc = now * 0.06 + p.id;
        const ox = Math.sin(osc * 1.7) * amp;
        const oy = Math.sin(osc * 2.3 + 1.3) * amp * 0.6;
        const oz = Math.cos(osc * 1.9 + 0.7) * amp;
        p.root.position.set(p.position.x + ox, p.position.y + oy, p.position.z + oz);
        // Tiny rotational jitter for open containers (feels more "loot-pop"-y)
        if (p.kind === "open_container") {
          p.root.rotation.z = Math.sin(osc * 2.1) * amp * 0.18;
        }
      } else if (p.rattleUntil) {
        // Just ended — restore anchor position/rotation cleanly.
        p.root.position.copyFrom(p.position);
        if (p.kind === "open_container") p.root.rotation.z = 0;
        p.rattleUntil = undefined;
        p.rattleDuration = undefined;
        p.rattleAmp = undefined;
      }

      // ---- Continuous low-HP smoke (heavily damaged props < 30%) ----
      const hpFrac = p.damageable.health / p.damageable.maxHealth;
      if (hpFrac < 0.3) {
        if (p.nextSmokeAt === undefined) p.nextSmokeAt = now;
        if (now >= p.nextSmokeAt) {
          // Puff from somewhere on the prop's upper half.
          const offX = (Math.random() - 0.5) * p.config.contactRadius * 0.7;
          const offZ = (Math.random() - 0.5) * p.config.contactRadius * 0.7;
          const offY = p.config.topY * (0.55 + Math.random() * 0.4);
          this.bus.emit("effect:smokePuff", {
            position: new BABYLON.Vector3(p.position.x + offX, p.position.y + offY, p.position.z + offZ),
            color: hpFrac < 0.15
              ? new BABYLON.Color3(0.22, 0.22, 0.24)
              : new BABYLON.Color3(0.38, 0.36, 0.36),
            scale: 0.7 + (1 - hpFrac) * 0.35,
            rise: 1.6,
            duration: 1.1,
          });
          // Tighter cadence as health drops.
          const interval = 320 + hpFrac * 700;
          p.nextSmokeAt = now + interval;
        }
      } else {
        p.nextSmokeAt = undefined;
      }
      // Open container: when the player (on foot or in vehicle) walks/drives up,
      // spawn loot at their feet with zero spread so PickupSystem's magnet/collect
      // grabs it on the next tick — deterministic, no scatter.
      if (p.kind === "open_container" && !p.alreadyLooted) {
        const dx = ppos.x - p.position.x;
        const dy = (ppos.y + 1) - (p.position.y + 0.6);
        const dz = ppos.z - p.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < lootRangeSq) {
          p.alreadyLooted = true;
          this.bus.emit(GameEvents.PICKUP_SPAWNED, {
            position: ppos.clone(),
            requests: p.config.drops,
            spread: 0,
          });
          this.bus.emit("effect:hitImpact", {
            position: p.position.add(new BABYLON.Vector3(0, 0.5, 0)),
            color: new BABYLON.Color3(0.3, 1.0, 0.5),
            scale: 1.2,
          });
          // Visible "rattle" so the player feels the loot pop.
          this.shakeProp(p, 0.42, 0.09);
          if (p.glow) {
            const mat = p.glow.material as BABYLON.StandardMaterial | null;
            if (mat) mat.emissiveColor = new BABYLON.Color3(0.15, 0.6, 1.0);
          }
        } else if (p.glow) {
          // Pulse the ready glow
          const pulse = 0.55 + Math.sin(performance.now() * 0.005) * 0.35;
          const mat = p.glow.material as BABYLON.StandardMaterial | null;
          if (mat) mat.emissiveColor = new BABYLON.Color3(0.2 + pulse * 0.4, 0.9, 0.4);
        }
      }
      // Holo signs gently pulse — damaged ones flicker glitchy red.
      if (p.kind === "holo_sign") {
        const t = performance.now();
        let pulse: number;
        let baseR: number, baseG: number, baseB: number;
        if (p.damageStage >= 2) {
          // Heavily damaged: stuttery on/off flicker, mostly dim.
          const blip = Math.sin(t * 0.025 + p.id) > 0.4 ? 1 : 0.08;
          pulse = blip * (Math.random() < 0.85 ? 1 : 0.15);
          baseR = 1.0; baseG = 0.18; baseB = 0.28;
        } else if (p.damageStage === 1) {
          // Damaged: nervous flicker with occasional drop-outs.
          pulse = 0.55 + Math.sin(t * 0.012 + p.id) * 0.4;
          if (Math.random() < 0.05) pulse = 0.08;
          baseR = 1.0; baseG = 0.25; baseB = 0.4;
        } else {
          pulse = 0.6 + Math.sin(t * 0.003 + p.id) * 0.3;
          baseR = 0.1; baseG = 0.85; baseB = 1.0;
        }
        for (const child of p.root.getChildMeshes()) {
          if (child.name.startsWith("propHoloEmissive_")) {
            const mat = child.material as BABYLON.StandardMaterial | null;
            if (mat) {
              mat.emissiveColor = new BABYLON.Color3(baseR * pulse, baseG * pulse, baseB * pulse);
            }
          }
        }
      }
    }
  }

  // === MESH BUILDERS — all primitives ===

  private buildCrate(root: BABYLON.Mesh, id: number): void {
    const matBody = this.getMaterial("propCrateBody", () => {
      const m = new BABYLON.StandardMaterial("propCrateBody", this.scene);
      m.diffuseColor = new BABYLON.Color3(0.18, 0.22, 0.28);
      m.emissiveColor = new BABYLON.Color3(0.04, 0.05, 0.08);
      m.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);
      return m;
    });
    const matTrim = this.getMaterial("propCrateTrim", () => {
      const m = new BABYLON.StandardMaterial("propCrateTrim", this.scene);
      m.diffuseColor = new BABYLON.Color3(0.95, 0.55, 0.1);
      m.emissiveColor = new BABYLON.Color3(0.4, 0.18, 0.02);
      return m;
    });
    const matGlow = this.getMaterial("propCrateGlow", () => {
      const m = new BABYLON.StandardMaterial("propCrateGlow", this.scene);
      m.diffuseColor = new BABYLON.Color3(0, 0, 0);
      m.emissiveColor = new BABYLON.Color3(0.2, 0.95, 1.0);
      return m;
    });

    const body = BABYLON.MeshBuilder.CreateBox(`propCrateBody_${id}`, {
      width: 1.5, height: 1.4, depth: 1.5,
    }, this.scene);
    body.parent = root;
    body.position.y = 0.7;
    body.material = matBody;

    // Corner braces (4 vertical bars)
    const braceLen = 1.4;
    const braceSize = 0.16;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const brace = BABYLON.MeshBuilder.CreateBox(`propCrateBrace_${id}`, {
          width: braceSize, height: braceLen, depth: braceSize,
        }, this.scene);
        brace.parent = root;
        brace.position.set(sx * 0.7, 0.7, sz * 0.7);
        brace.material = matTrim;
      }
    }

    // Top chevron strip + glowing seam
    const seam = BABYLON.MeshBuilder.CreateBox(`propCrateSeam_${id}`, {
      width: 1.55, height: 0.08, depth: 0.2,
    }, this.scene);
    seam.parent = root;
    seam.position.set(0, 1.05, 0);
    seam.material = matGlow;
  }

  private buildBarrel(root: BABYLON.Mesh, id: number): void {
    const matBody = this.getMaterial("propBarrelBody", () => {
      const m = new BABYLON.StandardMaterial("propBarrelBody", this.scene);
      m.diffuseColor = new BABYLON.Color3(0.55, 0.16, 0.16);
      m.emissiveColor = new BABYLON.Color3(0.18, 0.04, 0.04);
      return m;
    });
    const matRing = this.getMaterial("propBarrelRing", () => {
      const m = new BABYLON.StandardMaterial("propBarrelRing", this.scene);
      m.diffuseColor = new BABYLON.Color3(0.85, 0.85, 0.9);
      m.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.22);
      return m;
    });
    const matGlow = this.getMaterial("propBarrelGlow", () => {
      const m = new BABYLON.StandardMaterial("propBarrelGlow", this.scene);
      m.diffuseColor = new BABYLON.Color3(0, 0, 0);
      m.emissiveColor = new BABYLON.Color3(1.0, 0.85, 0.1);
      return m;
    });

    const body = BABYLON.MeshBuilder.CreateCylinder(`propBarrelBody_${id}`, {
      height: 1.4, diameter: 0.95, tessellation: 14,
    }, this.scene);
    body.parent = root;
    body.position.y = 0.7;
    body.material = matBody;

    // Top + bottom rings
    const topRing = BABYLON.MeshBuilder.CreateTorus(`propBarrelTopRing_${id}`, {
      diameter: 1.0, thickness: 0.08, tessellation: 14,
    }, this.scene);
    topRing.parent = root;
    topRing.position.y = 1.36;
    topRing.material = matRing;

    const botRing = BABYLON.MeshBuilder.CreateTorus(`propBarrelBotRing_${id}`, {
      diameter: 1.0, thickness: 0.08, tessellation: 14,
    }, this.scene);
    botRing.parent = root;
    botRing.position.y = 0.04;
    botRing.material = matRing;

    // Hazard glow band
    const band = BABYLON.MeshBuilder.CreateCylinder(`propBarrelBand_${id}`, {
      height: 0.16, diameter: 0.96, tessellation: 14,
    }, this.scene);
    band.parent = root;
    band.position.y = 0.9;
    band.material = matGlow;
  }

  private buildCanister(root: BABYLON.Mesh, id: number): void {
    const matBody = this.getMaterial("propCanisterBody", () => {
      const m = new BABYLON.StandardMaterial("propCanisterBody", this.scene);
      m.diffuseColor = new BABYLON.Color3(0.12, 0.22, 0.32);
      m.emissiveColor = new BABYLON.Color3(0.03, 0.06, 0.1);
      return m;
    });
    const matCap = this.getMaterial("propCanisterCap", () => {
      const m = new BABYLON.StandardMaterial("propCanisterCap", this.scene);
      m.diffuseColor = new BABYLON.Color3(0.25, 0.35, 0.45);
      m.emissiveColor = new BABYLON.Color3(0.1, 0.15, 0.2);
      return m;
    });
    const matGlow = this.getMaterial("propCanisterGlow", () => {
      const m = new BABYLON.StandardMaterial("propCanisterGlow", this.scene);
      m.diffuseColor = new BABYLON.Color3(0, 0, 0);
      m.emissiveColor = new BABYLON.Color3(0.3, 1.0, 0.55);
      return m;
    });

    const body = BABYLON.MeshBuilder.CreateCylinder(`propCanisterBody_${id}`, {
      height: 1.2, diameter: 0.7, tessellation: 14,
    }, this.scene);
    body.parent = root;
    body.position.y = 0.6;
    body.material = matBody;

    const cap = BABYLON.MeshBuilder.CreateCylinder(`propCanisterCap_${id}`, {
      height: 0.18, diameter: 0.78, tessellation: 14,
    }, this.scene);
    cap.parent = root;
    cap.position.y = 1.25;
    cap.material = matCap;

    const window = BABYLON.MeshBuilder.CreateBox(`propCanisterWin_${id}`, {
      width: 0.55, height: 0.5, depth: 0.06,
    }, this.scene);
    window.parent = root;
    window.position.set(0, 0.65, 0.36);
    window.material = matGlow;
  }

  private buildContainer(root: BABYLON.Mesh, id: number): void {
    const matBody = this.getMaterial("propContainerBody", () => {
      const m = new BABYLON.StandardMaterial("propContainerBody", this.scene);
      m.diffuseColor = new BABYLON.Color3(0.22, 0.34, 0.18);
      m.emissiveColor = new BABYLON.Color3(0.05, 0.08, 0.04);
      return m;
    });
    const matRib = this.getMaterial("propContainerRib", () => {
      const m = new BABYLON.StandardMaterial("propContainerRib", this.scene);
      m.diffuseColor = new BABYLON.Color3(0.12, 0.18, 0.1);
      m.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.02);
      return m;
    });
    const matLight = this.getMaterial("propContainerLight", () => {
      const m = new BABYLON.StandardMaterial("propContainerLight", this.scene);
      m.diffuseColor = new BABYLON.Color3(0, 0, 0);
      m.emissiveColor = new BABYLON.Color3(1.0, 0.35, 0.1);
      return m;
    });

    const body = BABYLON.MeshBuilder.CreateBox(`propContainerBody_${id}`, {
      width: 3.2, height: 2.0, depth: 1.6,
    }, this.scene);
    body.parent = root;
    body.position.y = 1.0;
    body.material = matBody;

    // Vertical ribs
    for (let i = -1; i <= 1; i++) {
      const rib = BABYLON.MeshBuilder.CreateBox(`propContainerRib_${id}_${i}`, {
        width: 0.12, height: 2.0, depth: 1.62,
      }, this.scene);
      rib.parent = root;
      rib.position.set(i * 1.0, 1.0, 0);
      rib.material = matRib;
    }

    // Door panel
    const door = BABYLON.MeshBuilder.CreateBox(`propContainerDoor_${id}`, {
      width: 1.2, height: 1.7, depth: 0.08,
    }, this.scene);
    door.parent = root;
    door.position.set(0, 0.9, 0.81);
    door.material = matRib;

    // Status light
    const light = BABYLON.MeshBuilder.CreateBox(`propContainerLight_${id}`, {
      width: 0.16, height: 0.16, depth: 0.05,
    }, this.scene);
    light.parent = root;
    light.position.set(0.7, 1.6, 0.83);
    light.material = matLight;
  }

  private buildHoloSign(root: BABYLON.Mesh, id: number): void {
    const matPost = this.getMaterial("propHoloPost", () => {
      const m = new BABYLON.StandardMaterial("propHoloPost", this.scene);
      m.diffuseColor = new BABYLON.Color3(0.18, 0.18, 0.22);
      m.emissiveColor = new BABYLON.Color3(0.04, 0.04, 0.06);
      return m;
    });
    // Glow material is per-prop so the tick can pulse it independently
    const matGlow = new BABYLON.StandardMaterial(`propHoloGlow_${id}`, this.scene);
    matGlow.diffuseColor = new BABYLON.Color3(0, 0, 0);
    matGlow.emissiveColor = new BABYLON.Color3(0.1, 0.85, 1.0);
    matGlow.alpha = 0.8;
    matGlow.disableLighting = true;

    const post = BABYLON.MeshBuilder.CreateCylinder(`propHoloPost_${id}`, {
      height: 1.6, diameter: 0.18, tessellation: 8,
    }, this.scene);
    post.parent = root;
    post.position.y = 0.8;
    post.material = matPost;

    const base = BABYLON.MeshBuilder.CreateCylinder(`propHoloBase_${id}`, {
      height: 0.12, diameter: 0.55, tessellation: 14,
    }, this.scene);
    base.parent = root;
    base.position.y = 0.06;
    base.material = matPost;

    // Holo plate (glowing thin slab on top)
    const plate = BABYLON.MeshBuilder.CreateBox(`propHoloEmissive_${id}`, {
      width: 1.1, height: 0.65, depth: 0.05,
    }, this.scene);
    plate.parent = root;
    plate.position.y = 1.95;
    plate.material = matGlow;

    // Tiny "antenna" emitter
    const cap = BABYLON.MeshBuilder.CreateBox(`propHoloEmissive_cap_${id}`, {
      width: 0.16, height: 0.16, depth: 0.16,
    }, this.scene);
    cap.parent = root;
    cap.position.y = 1.65;
    cap.material = matGlow;
  }

  private buildOpenContainer(root: BABYLON.Mesh, id: number): void {
    const matBody = this.getMaterial("propOpenBody", () => {
      const m = new BABYLON.StandardMaterial("propOpenBody", this.scene);
      m.diffuseColor = new BABYLON.Color3(0.24, 0.20, 0.16);
      m.emissiveColor = new BABYLON.Color3(0.04, 0.03, 0.02);
      return m;
    });
    const matInner = this.getMaterial("propOpenInner", () => {
      const m = new BABYLON.StandardMaterial("propOpenInner", this.scene);
      m.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.12);
      m.emissiveColor = new BABYLON.Color3(0.05, 0.18, 0.25);
      return m;
    });

    // Floor
    const floor = BABYLON.MeshBuilder.CreateBox(`propOpenFloor_${id}`, {
      width: 2.4, height: 0.12, depth: 1.4,
    }, this.scene);
    floor.parent = root;
    floor.position.y = 0.06;
    floor.material = matInner;

    // 4 walls (no top)
    const wallH = 0.85;
    const wallT = 0.12;
    const left = BABYLON.MeshBuilder.CreateBox(`propOpenLeft_${id}`, {
      width: wallT, height: wallH, depth: 1.4,
    }, this.scene);
    left.parent = root;
    left.position.set(-1.2, wallH / 2, 0);
    left.material = matBody;

    const right = BABYLON.MeshBuilder.CreateBox(`propOpenRight_${id}`, {
      width: wallT, height: wallH, depth: 1.4,
    }, this.scene);
    right.parent = root;
    right.position.set(1.2, wallH / 2, 0);
    right.material = matBody;

    const front = BABYLON.MeshBuilder.CreateBox(`propOpenFront_${id}`, {
      width: 2.4, height: wallH * 0.6, depth: wallT,
    }, this.scene);
    front.parent = root;
    front.position.set(0, wallH * 0.3, 0.7);
    front.material = matBody;

    const back = BABYLON.MeshBuilder.CreateBox(`propOpenBack_${id}`, {
      width: 2.4, height: wallH, depth: wallT,
    }, this.scene);
    back.parent = root;
    back.position.set(0, wallH / 2, -0.7);
    back.material = matBody;
  }

  private attachReadyGlow(root: BABYLON.Mesh): BABYLON.Mesh {
    const glow = BABYLON.MeshBuilder.CreateCylinder(`propOpenGlow_${root.name}`, {
      height: 0.04, diameter: 1.6, tessellation: 18,
    }, this.scene);
    glow.parent = root;
    glow.position.y = 0.18;
    const mat = new BABYLON.StandardMaterial(`propOpenGlowMat_${root.name}`, this.scene);
    mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    mat.emissiveColor = new BABYLON.Color3(0.3, 1.0, 0.45);
    mat.alpha = 0.55;
    mat.disableLighting = true;
    glow.material = mat;
    glow.isPickable = false;
    return glow;
  }

  /** Number of alive props, useful for diagnostics. */
  getCount(): number {
    return this.props.filter(p => p.damageable.isAlive).length;
  }

  /** Show/hide every active prop — used by SpaceLevelSystem to clear the
   *  surface during the orbital warp. */
  setVisible(visible: boolean): void {
    for (const p of this.props) {
      try { p.root.setEnabled(visible); } catch {}
    }
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    for (const p of this.props) this.disposeProp(p);
    this.props = [];
    this.materials.forEach(m => { if (!(m as any).isDisposed) m.dispose(); });
    this.materials.clear();
    this.materialFlashState.clear();
    console.log("[EnvironmentPropSystem] Disposed");
  }
}

// Re-export PropConfig type so callers can introspect drops if useful
export type { PropConfig };
