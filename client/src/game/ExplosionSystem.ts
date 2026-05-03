import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";

/**
 * Unified ExplosionSystem.
 *
 * Replaces the half-dozen ad-hoc `createExplosion` / `spawnExplosion`
 * helpers that used to be inlined into WeaponsSystem, SpecialWeaponsSystem,
 * MegaBeamCannonSystem and others. All of those allocated a fresh sphere +
 * material + PointLight per detonation and animated them via a setTimeout
 * loop, which got expensive in a heavy fight and produced visually
 * inconsistent explosions.
 *
 * The new system:
 *   - Pools meshes and materials up-front (no per-frame allocation in the
 *     hot path). Pool sizes are sized for "many small + a few big" combat.
 *   - Caps simultaneous PointLights so a screen full of explosions doesn't
 *     blow past the renderer's per-frame light budget.
 *   - Has named TIERS (small / medium / large) with sensible defaults so
 *     callers don't have to keep reinventing radius/color/shake numbers.
 *   - Drives all per-frame state from `update(dt)` instead of nested
 *     requestAnimationFrame loops, which means a paused game actually
 *     pauses the explosions (and dispose() really cancels everything).
 *
 * Event contract (back-compat with the previous ad-hoc emitters):
 *   bus.emit("effect:explosion", {
 *     position: Vector3,
 *     tier?:    "small" | "medium" | "large",
 *     radius?:  number,        // overrides tier default
 *     color?:   Color3,        // overrides tier default
 *     shake?:   number,        // overrides tier default
 *     shockwave?: boolean,     // ground ring (default: tier default)
 *     debris?:  number,        // override debris count
 *   });
 *
 * Also subscribes to `GameEvents.ENEMY_KILLED` so every enemy death
 * automatically gets a tier-appropriate explosion without each caller
 * having to remember to emit one.
 */

export type ExplosionTier = "small" | "medium" | "large";

export interface ExplosionRequest {
  position: BABYLON.Vector3;
  tier?: ExplosionTier;
  radius?: number;
  color?: BABYLON.Color3;
  shake?: number;
  shockwave?: boolean;
  debris?: number;
}

interface TierConfig {
  radius: number;
  color: BABYLON.Color3;
  shake: number;
  debris: number;
  shockwave: boolean;
  duration: number;
  light: boolean;
  smokeScale: number;
}

const TIERS: Record<ExplosionTier, TierConfig> = {
  small: {
    radius: 1.6,
    color: new BABYLON.Color3(1.0, 0.7, 0.25),
    shake: 0.05,
    debris: 4,
    shockwave: false,
    duration: 0.55,
    light: false,
    smokeScale: 0.7,
  },
  medium: {
    radius: 3.5,
    color: new BABYLON.Color3(1.0, 0.55, 0.15),
    shake: 0.15,
    debris: 10,
    shockwave: true,
    duration: 0.85,
    light: true,
    smokeScale: 1.4,
  },
  large: {
    radius: 6.5,
    color: new BABYLON.Color3(1.0, 0.45, 0.10),
    shake: 0.4,
    debris: 16,
    shockwave: true,
    duration: 1.2,
    light: true,
    smokeScale: 2.6,
  },
};

interface PooledItem<T extends BABYLON.AbstractMesh | BABYLON.PointLight> {
  obj: T;
  inUse: boolean;
}

interface ActiveExplosion {
  // Lifetime
  elapsed: number;
  duration: number;
  // Geometry / state
  position: BABYLON.Vector3;
  radius: number;
  // Acquired pool slots
  core: PooledItem<BABYLON.Mesh>;
  glow: PooledItem<BABYLON.Mesh>;
  ring: PooledItem<BABYLON.Mesh> | null;
  debris: { item: PooledItem<BABYLON.Mesh>; vel: BABYLON.Vector3; spin: BABYLON.Vector3 }[];
  light: PooledItem<BABYLON.PointLight> | null;
  // Materials we mutated (alpha/emissive) so update() can address them
  // without `instanceof` checks.
  coreMat: BABYLON.StandardMaterial;
  glowMat: BABYLON.StandardMaterial;
  ringMat: BABYLON.StandardMaterial | null;
  debrisMats: BABYLON.StandardMaterial[];
}

export class ExplosionSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private active: ActiveExplosion[] = [];

  // Pool sizes — sized for moderate combat. Items beyond capacity are
  // dropped silently (acquire returns null) so we never block on growth.
  private static readonly CORE_POOL = 16;
  private static readonly GLOW_POOL = 16;
  private static readonly RING_POOL = 12;
  private static readonly DEBRIS_POOL = 96;
  private static readonly LIGHT_POOL = 6;

  private cores: PooledItem<BABYLON.Mesh>[] = [];
  private glows: PooledItem<BABYLON.Mesh>[] = [];
  private rings: PooledItem<BABYLON.Mesh>[] = [];
  private debris: PooledItem<BABYLON.Mesh>[] = [];
  private lights: PooledItem<BABYLON.PointLight>[] = [];

  private explosionHandler: (data: ExplosionRequest) => void;
  private enemyKilledHandler: (data: any) => void;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.buildPools();

    this.explosionHandler = (data) => {
      if (!data || !data.position) return;
      this.spawn(data);
    };
    this.enemyKilledHandler = (data) => {
      if (!data || !data.position) return;
      const tier = this.tierForEnemyType(data.type);
      // Don't spawn another explosion if the type already produces a custom
      // visual we want to preserve (boss fortress turrets/spires already get
      // their own dramatic effect from EnemyBaseSystem).
      if (tier === null) return;
      this.spawn({ position: data.position, tier });
    };

    this.bus.on("effect:explosion", this.explosionHandler);
    this.bus.on(GameEvents.ENEMY_KILLED, this.enemyKilledHandler);

    console.log("[ExplosionSystem] Initialized — pooled meshes ready");
  }

  // ------------- Pool construction -------------

  private buildPools(): void {
    for (let i = 0; i < ExplosionSystem.CORE_POOL; i++) {
      const m = BABYLON.MeshBuilder.CreateSphere(`expl_core_${i}`, { diameter: 1, segments: 10 }, this.scene);
      const mat = new BABYLON.StandardMaterial(`expl_coreMat_${i}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = new BABYLON.Color3(1, 0.7, 0.25);
      mat.diffuseColor = mat.emissiveColor;
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mat.alpha = 0;
      m.material = mat;
      m.isPickable = false;
      m.setEnabled(false);
      this.cores.push({ obj: m, inUse: false });
    }
    for (let i = 0; i < ExplosionSystem.GLOW_POOL; i++) {
      const m = BABYLON.MeshBuilder.CreateSphere(`expl_glow_${i}`, { diameter: 1, segments: 10 }, this.scene);
      const mat = new BABYLON.StandardMaterial(`expl_glowMat_${i}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = new BABYLON.Color3(1, 0.4, 0.1);
      mat.diffuseColor = mat.emissiveColor;
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mat.alpha = 0;
      m.material = mat;
      m.isPickable = false;
      m.setEnabled(false);
      this.glows.push({ obj: m, inUse: false });
    }
    for (let i = 0; i < ExplosionSystem.RING_POOL; i++) {
      const m = BABYLON.MeshBuilder.CreateTorus(`expl_ring_${i}`, { diameter: 1, thickness: 0.12, tessellation: 24 }, this.scene);
      const mat = new BABYLON.StandardMaterial(`expl_ringMat_${i}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = new BABYLON.Color3(1, 0.85, 0.5);
      mat.diffuseColor = mat.emissiveColor;
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mat.alpha = 0;
      m.material = mat;
      m.isPickable = false;
      m.setEnabled(false);
      this.rings.push({ obj: m, inUse: false });
    }
    for (let i = 0; i < ExplosionSystem.DEBRIS_POOL; i++) {
      const m = BABYLON.MeshBuilder.CreateBox(`expl_dbr_${i}`, { size: 0.22 }, this.scene);
      const mat = new BABYLON.StandardMaterial(`expl_dbrMat_${i}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = new BABYLON.Color3(1, 0.5, 0.15);
      mat.diffuseColor = mat.emissiveColor;
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mat.alpha = 0;
      m.material = mat;
      m.isPickable = false;
      m.setEnabled(false);
      this.debris.push({ obj: m, inUse: false });
    }
    for (let i = 0; i < ExplosionSystem.LIGHT_POOL; i++) {
      const l = new BABYLON.PointLight(`expl_light_${i}`, BABYLON.Vector3.Zero(), this.scene);
      l.intensity = 0;
      l.range = 1;
      this.lights.push({ obj: l, inUse: false });
    }

    // Add cores + glows + rings to the glow layer if one exists so the
    // ink-outline post-FX picks them up.
    const glow = this.scene.effectLayers?.find(l => l instanceof BABYLON.GlowLayer) as BABYLON.GlowLayer | undefined;
    if (glow) {
      for (const p of this.cores) glow.addIncludedOnlyMesh(p.obj);
      for (const p of this.glows) glow.addIncludedOnlyMesh(p.obj);
      for (const p of this.rings) glow.addIncludedOnlyMesh(p.obj);
    }
  }

  private acquire<T extends BABYLON.AbstractMesh | BABYLON.PointLight>(pool: PooledItem<T>[]): PooledItem<T> | null {
    for (const p of pool) {
      if (!p.inUse) { p.inUse = true; return p; }
    }
    return null;
  }

  private release<T extends BABYLON.AbstractMesh | BABYLON.PointLight>(item: PooledItem<T> | null, hideMesh: boolean): void {
    if (!item) return;
    item.inUse = false;
    if (hideMesh) {
      if ((item.obj as BABYLON.AbstractMesh).setEnabled) {
        (item.obj as BABYLON.AbstractMesh).setEnabled(false);
      }
    }
  }

  // ------------- Public API -------------

  /** Spawn an explosion. Returns true if it actually rendered, false if the
   *  pool was full and the request was dropped. */
  spawn(req: ExplosionRequest): boolean {
    const tier = TIERS[req.tier ?? "medium"];
    const radius = req.radius ?? tier.radius;
    const color = req.color ?? tier.color;
    const shake = req.shake ?? tier.shake;
    const wantShockwave = req.shockwave ?? tier.shockwave;
    const debrisCount = req.debris ?? tier.debris;

    const core = this.acquire(this.cores);
    const glow = this.acquire(this.glows);
    if (!core || !glow) {
      // Couldn't even get the basics — release whatever we did grab and bail.
      this.release(core, true);
      this.release(glow, true);
      return false;
    }

    // Configure core/glow at full alpha and starting scale. update() drives
    // the rest via the elapsed/duration ratio.
    const coreMat = core.obj.material as BABYLON.StandardMaterial;
    coreMat.emissiveColor.copyFrom(color);
    coreMat.diffuseColor.copyFrom(color);
    coreMat.alpha = 1;
    core.obj.position.copyFrom(req.position);
    core.obj.scaling.setAll(radius * 0.3);
    core.obj.setEnabled(true);

    const glowMat = glow.obj.material as BABYLON.StandardMaterial;
    glowMat.emissiveColor.copyFromFloats(color.r * 0.85, color.g * 0.5, color.b * 0.4);
    glowMat.diffuseColor.copyFrom(glowMat.emissiveColor);
    glowMat.alpha = 0.65;
    glow.obj.position.copyFrom(req.position);
    glow.obj.scaling.setAll(radius * 0.5);
    glow.obj.setEnabled(true);

    // Optional shockwave ring on the ground.
    let ring: PooledItem<BABYLON.Mesh> | null = null;
    let ringMat: BABYLON.StandardMaterial | null = null;
    if (wantShockwave) {
      ring = this.acquire(this.rings);
      if (ring) {
        ringMat = ring.obj.material as BABYLON.StandardMaterial;
        ringMat.emissiveColor.copyFromFloats(1, color.g * 1.4, color.b * 1.4);
        ringMat.diffuseColor.copyFrom(ringMat.emissiveColor);
        ringMat.alpha = 0.95;
        ring.obj.position.copyFrom(req.position);
        // Ring sits flat on the ground at the explosion's foot. We don't
        // know exact ground height here (no terrain probe wired in), but
        // most explosions happen close enough to ground that y - radius*0.4
        // is a fine visual approximation.
        ring.obj.position.y = Math.max(0.1, req.position.y - radius * 0.4);
        ring.obj.scaling.setAll(radius * 0.6);
        ring.obj.rotation.x = 0; // Torus is XZ-flat by default — perfect.
        ring.obj.setEnabled(true);
      }
    }

    // Optional fill light (only on tiers that requested one — small
    // explosions don't waste a light slot).
    let light: PooledItem<BABYLON.PointLight> | null = null;
    if (tier.light) {
      light = this.acquire(this.lights);
      if (light) {
        light.obj.position.copyFrom(req.position);
        light.obj.diffuse.copyFrom(color);
        light.obj.specular.copyFromFloats(1, 1, 1);
        light.obj.intensity = req.tier === "large" ? 14 : 8;
        light.obj.range = radius * 4;
      }
    }

    // Debris chunks. Each gets a randomized velocity (radial outward + a
    // little upward) and angular spin. Gravity is applied in update().
    const debris: ActiveExplosion["debris"] = [];
    const debrisMats: BABYLON.StandardMaterial[] = [];
    for (let i = 0; i < debrisCount; i++) {
      const it = this.acquire(this.debris);
      if (!it) break; // pool ran dry — stop growing this explosion.
      const ang = (i / Math.max(1, debrisCount)) * Math.PI * 2 + Math.random() * 0.5;
      const elev = Math.random() * 0.7 + 0.3;
      const speed = radius * (1.6 + Math.random() * 1.4);
      const vel = new BABYLON.Vector3(
        Math.cos(ang) * speed * (1 - elev),
        speed * elev * 1.1,
        Math.sin(ang) * speed * (1 - elev),
      );
      const spin = new BABYLON.Vector3(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
      );
      it.obj.position.copyFrom(req.position);
      it.obj.scaling.setAll(0.4 + Math.random() * 0.6 + radius * 0.06);
      it.obj.setEnabled(true);
      const mat = it.obj.material as BABYLON.StandardMaterial;
      mat.emissiveColor.copyFromFloats(color.r, color.g * 0.7, color.b * 0.4);
      mat.diffuseColor.copyFrom(mat.emissiveColor);
      mat.alpha = 1;
      debris.push({ item: it, vel, spin });
      debrisMats.push(mat);
    }

    const expl: ActiveExplosion = {
      elapsed: 0,
      duration: tier.duration,
      position: req.position.clone(),
      radius,
      core,
      glow,
      ring,
      debris,
      light,
      coreMat,
      glowMat,
      ringMat,
      debrisMats,
    };
    this.active.push(expl);

    // Ancillary effects (camera shake + lingering smoke) — these go through
    // the existing EffectsSystem so we don't reimplement them here.
    if (shake > 0) {
      this.bus.emit("effect:cameraShake", { intensity: shake, duration: 0.18 + Math.min(0.5, shake) });
    }
    this.bus.emit("effect:smokePuff", {
      position: req.position.clone(),
      color: new BABYLON.Color3(0.25, 0.22, 0.20),
      scale: tier.smokeScale,
      rise: 1.2,
      duration: 1.0 + tier.smokeScale * 0.3,
    });
    return true;
  }

  // ------------- Frame update -------------

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.elapsed += dt;
      const t = Math.min(1, e.elapsed / e.duration);

      // Core: fast scale-up and quick alpha ramp to 0.
      const coreScale = e.radius * (0.3 + t * 0.9);
      e.core.obj.scaling.setAll(coreScale);
      e.coreMat.alpha = Math.max(0, 1 - t * 1.6);

      // Glow: slower expand, slower fade — outlives the core slightly.
      const glowScale = e.radius * (0.5 + t * 1.4);
      e.glow.obj.scaling.setAll(glowScale);
      e.glowMat.alpha = Math.max(0, 0.65 - t * 0.7);

      // Shockwave ring: snaps outward and fades.
      if (e.ring && e.ringMat) {
        const ringScale = e.radius * (0.6 + t * 2.2);
        e.ring.obj.scaling.setAll(ringScale);
        e.ringMat.alpha = Math.max(0, 0.95 - t * 1.1);
      }

      // Light: linear fade.
      if (e.light) {
        e.light.obj.intensity = Math.max(0, e.light.obj.intensity * (1 - dt * 4));
      }

      // Debris: ballistic with gravity, spin, and alpha fade.
      for (const d of e.debris) {
        d.item.obj.position.x += d.vel.x * dt;
        d.item.obj.position.y += d.vel.y * dt;
        d.item.obj.position.z += d.vel.z * dt;
        d.vel.y -= 18 * dt; // gravity
        // Mild air drag so chunks don't keep accelerating along XZ.
        d.vel.x *= 1 - dt * 1.2;
        d.vel.z *= 1 - dt * 1.2;
        d.item.obj.rotation.x += d.spin.x * dt;
        d.item.obj.rotation.y += d.spin.y * dt;
        d.item.obj.rotation.z += d.spin.z * dt;
      }
      for (const m of e.debrisMats) m.alpha = Math.max(0, 1 - t * 1.3);

      if (e.elapsed >= e.duration) {
        this.releaseExplosion(e);
        this.active.splice(i, 1);
      }
    }
  }

  private releaseExplosion(e: ActiveExplosion): void {
    this.release(e.core, true);
    this.release(e.glow, true);
    this.release(e.ring, true);
    for (const d of e.debris) this.release(d.item, true);
    if (e.light) {
      e.light.obj.intensity = 0;
      this.release(e.light, false);
    }
  }

  // ------------- Helpers -------------

  /** Map an enemy `type` string to an explosion tier, or null to skip
   *  (e.g. for enemies that already have a bespoke death visual we don't
   *  want to compete with). */
  private tierForEnemyType(type: string | undefined): ExplosionTier | null {
    if (!type) return "small";
    const t = type.toLowerCase();
    // Big bois.
    if (
      t.includes("boss") ||
      t.includes("fortress") ||
      t.includes("battleship") ||
      t.includes("captain") ||
      t.includes("vault") ||
      t.includes("spire")
    ) return "large";
    // Mid-tier.
    if (
      t.includes("commander") ||
      t.includes("turret") ||
      t.includes("aerial_battleship")
    ) return "medium";
    // Aerial fighters / regular grunts.
    return "small";
  }

  dispose(): void {
    this.bus.off("effect:explosion", this.explosionHandler);
    this.bus.off(GameEvents.ENEMY_KILLED, this.enemyKilledHandler);
    for (const e of this.active) this.releaseExplosion(e);
    this.active = [];
    for (const p of this.cores)  { try { p.obj.material?.dispose(); p.obj.dispose(); } catch {} }
    for (const p of this.glows)  { try { p.obj.material?.dispose(); p.obj.dispose(); } catch {} }
    for (const p of this.rings)  { try { p.obj.material?.dispose(); p.obj.dispose(); } catch {} }
    for (const p of this.debris) { try { p.obj.material?.dispose(); p.obj.dispose(); } catch {} }
    for (const p of this.lights) { try { p.obj.dispose(); } catch {} }
    this.cores = []; this.glows = []; this.rings = []; this.debris = []; this.lights = [];
  }
}
