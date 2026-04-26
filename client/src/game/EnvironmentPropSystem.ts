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
  position: BABYLON.Vector3;
  config: PropConfig;
  damageable: PropDamageable;
  /** Open container: per-player one-shot loot spawn. */
  alreadyLooted?: boolean;
  /** For open container "ready to collect" pulse */
  glow?: BABYLON.Mesh | null;
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
    this.health = Math.max(0, this.health - finalDamage);

    EventBus.getInstance().emit("effect:hitImpact", {
      position: info.hitPoint ? info.hitPoint.clone() : prop.position.clone(),
      color: new BABYLON.Color3(1.0, 0.7, 0.2),
      scale: 0.9,
    });

    this.system.flashProp(prop);

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

  /** Returns mesh hitboxes for all alive props (so vehicle/contact code can iterate them). */
  getHitboxMeshes(): BABYLON.Mesh[] {
    return this.props.filter(p => p.damageable.isAlive).map(p => p.hitbox);
  }

  /** Spawn a single prop; returns the active record. */
  spawn(kind: PropKind, position: BABYLON.Vector3, yaw: number = 0): ActiveProp {
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
      position: root.position,
      config: { ...config, topY },
      damageable,
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
   * Helper: spawn a small cluster of mixed props at `center`.
   */
  spawnCluster(
    center: BABYLON.Vector3,
    options?: { count?: number; radius?: number; includeOpenContainer?: boolean; includeHoloSign?: boolean },
  ): void {
    const count = Math.max(2, options?.count ?? 4 + Math.floor(Math.random() * 3));
    const radius = options?.radius ?? 5;
    const pool: PropKind[] = ["crate", "crate", "barrel", "barrel", "canister", "container"];
    if (options?.includeOpenContainer !== false) pool.push("open_container");
    if (options?.includeHoloSign !== false) pool.push("holo_sign");
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const r = Math.random() * radius;
      const pos = new BABYLON.Vector3(
        center.x + Math.cos(angle) * r,
        center.y,
        center.z + Math.sin(angle) * r,
      );
      const kind = pool[Math.floor(Math.random() * pool.length)];
      this.spawn(kind, pos, Math.random() * Math.PI * 2);
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

  /** Public: brief red flash over the prop's primary mesh. */
  flashProp(prop: ActiveProp): void {
    for (const child of prop.root.getChildMeshes()) {
      const m = child.material as BABYLON.StandardMaterial | null;
      if (!m || !m.emissiveColor) continue;
      const orig = m.emissiveColor.clone();
      m.emissiveColor = new BABYLON.Color3(1.0, 0.25, 0.1);
      setTimeout(() => {
        if (m && !m.isDisposed()) m.emissiveColor = orig;
      }, 110);
    }
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
    this.disposeProp(prop);
  }

  private disposeProp(prop: ActiveProp): void {
    if (prop.glow && !prop.glow.isDisposed()) prop.glow.dispose();
    for (const child of prop.root.getChildMeshes()) {
      if (!child.isDisposed()) child.dispose();
    }
    if (!prop.hitbox.isDisposed()) prop.hitbox.dispose();
    if (!prop.root.isDisposed()) prop.root.dispose();
  }

  private tick(): void {
    if (this.props.length === 0) return;
    const ppos = this.playerPos;
    const lootRangeSq = 2.6 * 2.6;
    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i];
      if (!p.damageable.isAlive) {
        this.props.splice(i, 1);
        continue;
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
      // Holo signs gently pulse
      if (p.kind === "holo_sign") {
        const pulse = 0.6 + Math.sin(performance.now() * 0.003 + p.id) * 0.3;
        for (const child of p.root.getChildMeshes()) {
          if (child.name.startsWith("propHoloEmissive_")) {
            const mat = child.material as BABYLON.StandardMaterial | null;
            if (mat) {
              mat.emissiveColor = new BABYLON.Color3(0.1 * pulse, 0.85 * pulse, 1.0 * pulse);
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

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    for (const p of this.props) this.disposeProp(p);
    this.props = [];
    this.materials.forEach(m => { if (!m.isDisposed()) m.dispose(); });
    this.materials.clear();
    console.log("[EnvironmentPropSystem] Disposed");
  }
}

// Re-export PropConfig type so callers can introspect drops if useful
export type { PropConfig };
