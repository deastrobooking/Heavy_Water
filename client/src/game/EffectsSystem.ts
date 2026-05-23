import * as BABYLON from "@babylonjs/core";
import { EventBus } from "./EventBus";

interface ActiveEffect {
  meshes: BABYLON.Mesh[];
  particles?: BABYLON.ParticleSystem[];
  elapsed: number;
  duration: number;
  update?: (e: ActiveEffect, dt: number, t: number) => void;
  returnToPool?: () => void;
}

// ── Pool slot types ──────────────────────────────────────────────────────────
// Velocities are flat Float32Arrays  [vx0,vy0,vz0, vx1,vy1,vz1, …] to avoid
// per-spawn Vector3 allocations inside heavy-combat hot paths.

interface HitImpactSlot {
  ring: BABYLON.Mesh;
  ringMat: BABYLON.StandardMaterial;
  flash: BABYLON.Mesh;
  flashMat: BABYLON.StandardMaterial;
  shards: BABYLON.Mesh[];
  shardMat: BABYLON.StandardMaterial;
  vel: Float32Array;
  inUse: boolean;
}

interface SparkleSlot {
  spheres: BABYLON.Mesh[];
  mat: BABYLON.StandardMaterial;
  vel: Float32Array;
  inUse: boolean;
}

interface SmokePuffSlot {
  spheres: BABYLON.Mesh[];
  mat: BABYLON.StandardMaterial;
  vel: Float32Array;
  inUse: boolean;
}

const HIT_POOL_SIZE    = 16;
const SPARKLE_POOL_SIZE = 8;
const SMOKE_POOL_SIZE  = 8;
const SPARKLE_COUNT    = 14;
const SHARD_COUNT      = 8;
const SMOKE_COUNT      = 3;

export class EffectsSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private active: ActiveEffect[] = [];

  private sparkleHandler: (data: any) => void;
  private captureHandler: (data: any) => void;
  private levelUpHandler: (data: any) => void;
  private pickupHandler: (data: any) => void;
  private hitImpactHandler: (data: any) => void;
  private smokePuffHandler: (data: any) => void;
  private cameraShakeHandler: (data: any) => void;

  // ── Camera shake ────────────────────────────────────────────────────────
  private camera: BABYLON.Camera | null = null;
  private shakeIntensity: number = 0;
  private shakeRemaining: number = 0;
  private shakeDuration: number = 0;
  private lastShakeOffset: BABYLON.Vector3 = new BABYLON.Vector3(0, 0, 0);

  // ── Mesh/material pools ─────────────────────────────────────────────────
  private hitImpactPool: HitImpactSlot[] = [];
  private sparklePool: SparkleSlot[] = [];
  private smokePuffPool: SmokePuffSlot[] = [];

  constructor(scene: BABYLON.Scene, camera?: BABYLON.Camera) {
    this.scene = scene;
    this.camera = camera || null;
    this.bus = EventBus.getInstance();

    this.buildHitImpactPool();
    this.buildSparklePool();
    this.buildSmokePuffPool();

    this.sparkleHandler = (data: { position: BABYLON.Vector3; color?: BABYLON.Color3; count?: number }) => {
      this.spawnSparkle(data.position, data.color, data.count);
    };
    this.captureHandler = (data: { position: BABYLON.Vector3; color?: BABYLON.Color3 }) => {
      this.spawnCapture(data.position, data.color);
    };
    this.levelUpHandler = (data: { position: BABYLON.Vector3 }) => {
      this.spawnLevelUp(data.position);
    };
    this.pickupHandler = (data: { position: BABYLON.Vector3; color?: BABYLON.Color3 }) => {
      this.spawnPickup(data.position, data.color);
    };
    this.hitImpactHandler = (data: { position: BABYLON.Vector3; color?: BABYLON.Color3; scale?: number }) => {
      this.spawnHitImpact(data.position, data.color, data.scale);
    };
    this.smokePuffHandler = (data: { position: BABYLON.Vector3; color?: BABYLON.Color3; scale?: number; rise?: number; duration?: number }) => {
      this.spawnSmokePuff(data.position, data.color, data.scale, data.rise, data.duration);
    };
    this.cameraShakeHandler = (data: { intensity?: number; duration?: number }) => {
      this.shakeCamera(data?.intensity ?? 0.25, data?.duration ?? 0.25);
    };

    this.bus.on("effect:sparkle", this.sparkleHandler);
    this.bus.on("effect:capture", this.captureHandler);
    this.bus.on("effect:levelUp", this.levelUpHandler);
    this.bus.on("effect:pickup", this.pickupHandler);
    this.bus.on("effect:hitImpact", this.hitImpactHandler);
    this.bus.on("effect:smokePuff", this.smokePuffHandler);
    this.bus.on("effect:cameraShake", this.cameraShakeHandler);

    console.log("[EffectsSystem] Initialized");
  }

  // ── Pool builders ────────────────────────────────────────────────────────

  private buildHitImpactPool(): void {
    for (let s = 0; s < HIT_POOL_SIZE; s++) {
      const ring = BABYLON.MeshBuilder.CreateTorus(`_hiRingP_${s}`, {
        diameter: 0.6, thickness: 0.12, tessellation: 18,
      }, this.scene);
      ring.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      ring.isPickable = false;
      ring.setEnabled(false);
      const ringMat = new BABYLON.StandardMaterial(`_hiRingM_${s}`, this.scene);
      ringMat.disableLighting = true;
      ring.material = ringMat;

      const flash = BABYLON.MeshBuilder.CreateSphere(`_hiFlashP_${s}`, {
        diameter: 0.45, segments: 8,
      }, this.scene);
      flash.isPickable = false;
      flash.setEnabled(false);
      const flashMat = new BABYLON.StandardMaterial(`_hiFlashM_${s}`, this.scene);
      flashMat.emissiveColor = new BABYLON.Color3(1, 0.95, 0.85);
      flashMat.diffuseColor  = new BABYLON.Color3(1, 0.95, 0.85);
      flashMat.disableLighting = true;
      flash.material = flashMat;

      const shardMat = new BABYLON.StandardMaterial(`_hiShardM_${s}`, this.scene);
      shardMat.disableLighting = true;
      const shards: BABYLON.Mesh[] = [];
      for (let i = 0; i < SHARD_COUNT; i++) {
        const sh = BABYLON.MeshBuilder.CreateBox(`_hiShardP_${s}_${i}`, {
          width: 0.08, height: 0.08, depth: 0.35,
        }, this.scene);
        sh.material = shardMat;
        sh.isPickable = false;
        sh.setEnabled(false);
        shards.push(sh);
      }

      this.hitImpactPool.push({
        ring, ringMat, flash, flashMat,
        shards, shardMat,
        vel: new Float32Array(SHARD_COUNT * 3),
        inUse: false,
      });
    }
  }

  private buildSparklePool(): void {
    for (let s = 0; s < SPARKLE_POOL_SIZE; s++) {
      const mat = new BABYLON.StandardMaterial(`_sparkM_${s}`, this.scene);
      mat.disableLighting = true;
      const spheres: BABYLON.Mesh[] = [];
      for (let i = 0; i < SPARKLE_COUNT; i++) {
        const sp = BABYLON.MeshBuilder.CreateSphere(`_sparkP_${s}_${i}`, {
          diameter: 0.25,
        }, this.scene);
        sp.material = mat;
        sp.isPickable = false;
        sp.setEnabled(false);
        spheres.push(sp);
      }
      this.sparklePool.push({
        spheres, mat,
        vel: new Float32Array(SPARKLE_COUNT * 3),
        inUse: false,
      });
    }
  }

  private buildSmokePuffPool(): void {
    for (let s = 0; s < SMOKE_POOL_SIZE; s++) {
      const mat = new BABYLON.StandardMaterial(`_smokeM_${s}`, this.scene);
      mat.disableLighting = true;
      const spheres: BABYLON.Mesh[] = [];
      for (let i = 0; i < SMOKE_COUNT; i++) {
        const sp = BABYLON.MeshBuilder.CreateSphere(`_smokeP_${s}_${i}`, {
          diameter: 0.45, segments: 6,
        }, this.scene);
        sp.material = mat;
        sp.isPickable = false;
        sp.setEnabled(false);
        spheres.push(sp);
      }
      this.smokePuffPool.push({
        spheres, mat,
        vel: new Float32Array(SMOKE_COUNT * 3),
        inUse: false,
      });
    }
  }

  // ── Pool slot acquisition ────────────────────────────────────────────────

  private acquireHitImpact(): HitImpactSlot | null {
    for (const slot of this.hitImpactPool) {
      if (!slot.inUse) { slot.inUse = true; return slot; }
    }
    return null;
  }

  private acquireSparkle(): SparkleSlot | null {
    for (const slot of this.sparklePool) {
      if (!slot.inUse) { slot.inUse = true; return slot; }
    }
    return null;
  }

  private acquireSmokePuff(): SmokePuffSlot | null {
    for (const slot of this.smokePuffPool) {
      if (!slot.inUse) { slot.inUse = true; return slot; }
    }
    return null;
  }

  // ── Camera shake ─────────────────────────────────────────────────────────

  setCamera(camera: BABYLON.Camera): void {
    this.camera = camera;
  }

  shakeCamera(intensity: number, duration: number): void {
    if (intensity <= 0 || duration <= 0) return;
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeRemaining = Math.max(this.shakeRemaining, duration);
    this.shakeDuration  = Math.max(this.shakeDuration, duration);
  }

  private updateCameraShake(dt: number): void {
    if (!this.camera) return;
    if (this.lastShakeOffset.x !== 0 || this.lastShakeOffset.y !== 0 || this.lastShakeOffset.z !== 0) {
      this.camera.position.subtractInPlace(this.lastShakeOffset);
      this.lastShakeOffset.set(0, 0, 0);
    }
    if (this.shakeRemaining <= 0 || this.shakeIntensity <= 0) return;

    const t = this.shakeRemaining / Math.max(this.shakeDuration, 0.001);
    const amp = this.shakeIntensity * t;
    const ox = (Math.random() * 2 - 1) * amp;
    const oy = (Math.random() * 2 - 1) * amp * 0.7;
    const oz = (Math.random() * 2 - 1) * amp;
    this.lastShakeOffset.set(ox, oy, oz);
    this.camera.position.addInPlace(this.lastShakeOffset);

    this.shakeRemaining -= dt;
    if (this.shakeRemaining <= 0) {
      this.shakeRemaining = 0;
      this.shakeIntensity = 0;
      this.shakeDuration  = 0;
    }
  }

  // ── Effect spawners ──────────────────────────────────────────────────────

  spawnSparkle(position: BABYLON.Vector3, color?: BABYLON.Color3, count: number = 14): void {
    const c = color || new BABYLON.Color3(1.0, 0.95, 0.4);
    const slot = this.acquireSparkle();

    if (slot) {
      slot.mat.emissiveColor.copyFrom(c);
      slot.mat.diffuseColor.copyFrom(c);
      const used = Math.min(count, SPARKLE_COUNT);
      const v = slot.vel;
      for (let i = 0; i < used; i++) {
        const sp = slot.spheres[i];
        sp.position.copyFrom(position);
        sp.scaling.setAll(1);
        sp.setEnabled(true);
        const angle = (i / used) * Math.PI * 2;
        const elev = (Math.random() - 0.3) * 1.4;
        v[i * 3]     = Math.cos(angle) * (3 + Math.random() * 2);
        v[i * 3 + 1] = elev * 4 + 2;
        v[i * 3 + 2] = Math.sin(angle) * (3 + Math.random() * 2);
      }
      for (let i = used; i < SPARKLE_COUNT; i++) slot.spheres[i].setEnabled(false);
      const returnFn = () => {
        for (let i = 0; i < SPARKLE_COUNT; i++) slot.spheres[i].setEnabled(false);
        slot.inUse = false;
      };
      this.active.push({
        meshes: [],
        elapsed: 0,
        duration: 0.9,
        returnToPool: returnFn,
        update: (_e, dt, t) => {
          const f = 1 - t;
          slot.mat.alpha = f;
          for (let i = 0; i < used; i++) {
            v[i * 3 + 1] -= 9 * dt;
            slot.spheres[i].position.x += v[i * 3]     * dt;
            slot.spheres[i].position.y += v[i * 3 + 1] * dt;
            slot.spheres[i].position.z += v[i * 3 + 2] * dt;
            slot.spheres[i].scaling.setAll(0.4 + f * 1.2);
          }
        },
      });
      return;
    }

    // Cosmetic overflow: drop the sparkle rather than allocating during a
    // burst frame. Big specials can already be CPU/GPU heavy without pool
    // fallback growth.
  }

  spawnCapture(position: BABYLON.Vector3, color?: BABYLON.Color3): void {
    const c = color || new BABYLON.Color3(0.4, 0.9, 1.0);
    const ring = BABYLON.MeshBuilder.CreateTorus("captureRing", { diameter: 4, thickness: 0.25, tessellation: 32 }, this.scene);
    ring.position.copyFrom(position);
    const ringMat = new BABYLON.StandardMaterial("captureRingMat", this.scene);
    ringMat.emissiveColor = c;
    ringMat.diffuseColor  = c;
    ringMat.alpha = 0.85;
    ringMat.disableLighting = true;
    ring.material = ringMat;

    const beam = BABYLON.MeshBuilder.CreateCylinder("captureBeam", { height: 12, diameter: 0.6, tessellation: 16 }, this.scene);
    beam.position.copyFrom(position);
    beam.position.y += 6;
    const beamMat = new BABYLON.StandardMaterial("captureBeamMat", this.scene);
    beamMat.emissiveColor = c;
    beamMat.diffuseColor  = c;
    beamMat.alpha = 0.55;
    beamMat.disableLighting = true;
    beam.material = beamMat;

    this.active.push({
      meshes: [ring, beam],
      elapsed: 0,
      duration: 1.4,
      update: (_e, dt, t) => {
        ring.scaling.setAll(1 + t * 1.6);
        ring.rotation.y += dt * 4;
        (ring.material as BABYLON.StandardMaterial).alpha = 0.85 * (1 - t);
        const pulse = 0.5 + Math.sin(t * Math.PI * 6) * 0.4;
        (beam.material as BABYLON.StandardMaterial).alpha = pulse * (1 - t * 0.5);
        beam.scaling.x = beam.scaling.z = 1 + Math.sin(t * Math.PI * 8) * 0.3;
      },
    });
    this.spawnSparkle(position, c, 18);
  }

  spawnLevelUp(position: BABYLON.Vector3): void {
    const golden = new BABYLON.Color3(1.0, 0.85, 0.2);
    const pillar = BABYLON.MeshBuilder.CreateCylinder("lvlPillar", { height: 14, diameter: 3, tessellation: 24 }, this.scene);
    pillar.position.copyFrom(position);
    pillar.position.y += 7;
    const mat = new BABYLON.StandardMaterial("lvlMat", this.scene);
    mat.emissiveColor = golden;
    mat.diffuseColor  = golden;
    mat.alpha = 0.4;
    mat.disableLighting = true;
    pillar.material = mat;

    this.active.push({
      meshes: [pillar],
      elapsed: 0,
      duration: 1.6,
      update: (_e, dt, t) => {
        pillar.scaling.x = pillar.scaling.z = 1 + t * 0.8;
        (pillar.material as BABYLON.StandardMaterial).alpha = 0.5 * (1 - t);
        pillar.rotation.y += dt * 2;
      },
    });
    this.spawnSparkle(position, golden, 24);
  }

  spawnPickup(position: BABYLON.Vector3, color?: BABYLON.Color3): void {
    const c = color || new BABYLON.Color3(0.5, 1.0, 0.6);
    this.spawnSparkle(position, c, 8);
  }

  spawnHitImpact(position: BABYLON.Vector3, color?: BABYLON.Color3, scale: number = 1): void {
    const c = color || new BABYLON.Color3(1.0, 0.9, 0.3);
    const slot = this.acquireHitImpact();

    if (slot) {
      slot.ringMat.emissiveColor.copyFrom(c);
      slot.ringMat.diffuseColor.copyFrom(c);
      slot.ringMat.alpha = 1;
      slot.ring.position.copyFrom(position);
      slot.ring.scaling.setAll(scale);
      slot.ring.setEnabled(true);

      slot.flashMat.alpha = 0.95;
      slot.flash.position.copyFrom(position);
      slot.flash.scaling.setAll(scale);
      slot.flash.setEnabled(true);

      slot.shardMat.emissiveColor.copyFrom(c);
      slot.shardMat.diffuseColor.copyFrom(c);
      slot.shardMat.alpha = 1;
      const v = slot.vel;
      for (let i = 0; i < SHARD_COUNT; i++) {
        const sh = slot.shards[i];
        sh.position.copyFrom(position);
        sh.scaling.setAll(scale);
        sh.setEnabled(true);
        const ang  = (i / SHARD_COUNT) * Math.PI * 2 + Math.random() * 0.4;
        const elev = (Math.random() - 0.2) * 1.2;
        v[i * 3]     = Math.cos(ang) * (5 + Math.random() * 3);
        v[i * 3 + 1] = elev * 3 + 1.5;
        v[i * 3 + 2] = Math.sin(ang) * (5 + Math.random() * 3);
      }
      const returnFn = () => {
        slot.ring.setEnabled(false);
        slot.flash.setEnabled(false);
        for (const sh of slot.shards) sh.setEnabled(false);
        slot.inUse = false;
      };
      this.active.push({
        meshes: [],
        elapsed: 0,
        duration: 0.45,
        returnToPool: returnFn,
        update: (_e, dt, t) => {
          slot.ring.scaling.setAll((1 + t * 5) * scale);
          slot.ringMat.alpha = 1 - t;
          slot.flash.scaling.setAll((1 + t * 1.4) * scale);
          slot.flashMat.alpha = (1 - t) * 0.95;
          slot.shardMat.alpha = 1 - t;
          for (let i = 0; i < SHARD_COUNT; i++) {
            v[i * 3 + 1] -= 12 * dt;
            slot.shards[i].position.x += v[i * 3]     * dt;
            slot.shards[i].position.y += v[i * 3 + 1] * dt;
            slot.shards[i].position.z += v[i * 3 + 2] * dt;
            slot.shards[i].scaling.setAll((1 - t * 0.5) * scale);
          }
        },
      });
      return;
    }

    // Cosmetic overflow: hit impacts are nice feedback, but dropping extras
    // is much better than allocating fresh meshes during a beam multi-hit.
  }

  spawnSmokePuff(
    position: BABYLON.Vector3,
    color?: BABYLON.Color3,
    scale: number = 1,
    rise: number = 1.4,
    duration: number = 0.85,
  ): void {
    const c = color || new BABYLON.Color3(0.32, 0.32, 0.36);
    const slot = this.acquireSmokePuff();

    if (slot) {
      slot.mat.emissiveColor.set(c.r * 0.55, c.g * 0.55, c.b * 0.55);
      slot.mat.diffuseColor.copyFrom(c);
      slot.mat.alpha = 0.65;
      const v = slot.vel;
      for (let i = 0; i < SMOKE_COUNT; i++) {
        const sp = slot.spheres[i];
        sp.position.copyFrom(position);
        sp.position.x += (Math.random() - 0.5) * 0.35 * scale;
        sp.position.y += (Math.random() - 0.2) * 0.2  * scale;
        sp.position.z += (Math.random() - 0.5) * 0.35 * scale;
        sp.scaling.setAll(scale);
        sp.setEnabled(true);
        v[i * 3]     = (Math.random() - 0.5) * 0.9;
        v[i * 3 + 1] = rise * (0.7 + Math.random() * 0.6);
        v[i * 3 + 2] = (Math.random() - 0.5) * 0.9;
      }
      const returnFn = () => {
        for (const sp of slot.spheres) sp.setEnabled(false);
        slot.inUse = false;
      };
      this.active.push({
        meshes: [],
        elapsed: 0,
        duration,
        returnToPool: returnFn,
        update: (_e, dt, t) => {
          slot.mat.alpha = 0.65 * (1 - t);
          for (let i = 0; i < SMOKE_COUNT; i++) {
            v[i * 3 + 1] += 0.4 * dt;
            v[i * 3]     *= 1 - dt * 1.5;
            v[i * 3 + 2] *= 1 - dt * 1.5;
            slot.spheres[i].position.x += v[i * 3]     * dt;
            slot.spheres[i].position.y += v[i * 3 + 1] * dt;
            slot.spheres[i].position.z += v[i * 3 + 2] * dt;
            slot.spheres[i].scaling.setAll((1 + t * 1.8) * scale);
          }
        },
      });
      return;
    }

    // Cosmetic overflow: missile volleys can emit many explosions at once;
    // keep smoke pooled and bounded.
  }

  // ── Core update / dispose ─────────────────────────────────────────────────

  private disposeEffect(e: ActiveEffect): void {
    if (e.returnToPool) {
      e.returnToPool();
      return;
    }
    for (const m of e.meshes) {
      const mat = m.material;
      if (mat) mat.dispose();
      m.dispose();
    }
    if (e.particles) for (const p of e.particles) p.dispose();
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.elapsed += dt;
      const t = Math.min(e.elapsed / e.duration, 1);
      if (e.update) e.update(e, dt, t);
      if (e.elapsed >= e.duration) {
        this.disposeEffect(e);
        this.active.splice(i, 1);
      }
    }
    this.updateCameraShake(dt);
  }

  dispose(): void {
    this.bus.off("effect:sparkle",     this.sparkleHandler);
    this.bus.off("effect:capture",     this.captureHandler);
    this.bus.off("effect:levelUp",     this.levelUpHandler);
    this.bus.off("effect:pickup",      this.pickupHandler);
    this.bus.off("effect:hitImpact",   this.hitImpactHandler);
    this.bus.off("effect:smokePuff",   this.smokePuffHandler);
    this.bus.off("effect:cameraShake", this.cameraShakeHandler);

    if (this.camera && (this.lastShakeOffset.x !== 0 || this.lastShakeOffset.y !== 0 || this.lastShakeOffset.z !== 0)) {
      this.camera.position.subtractInPlace(this.lastShakeOffset);
      this.lastShakeOffset.set(0, 0, 0);
    }

    for (const e of this.active) this.disposeEffect(e);
    this.active = [];

    for (const slot of this.hitImpactPool) {
      slot.ringMat.dispose();  slot.ring.dispose();
      slot.flashMat.dispose(); slot.flash.dispose();
      slot.shardMat.dispose();
      for (const sh of slot.shards) sh.dispose();
    }
    this.hitImpactPool = [];

    for (const slot of this.sparklePool) {
      slot.mat.dispose();
      for (const sp of slot.spheres) sp.dispose();
    }
    this.sparklePool = [];

    for (const slot of this.smokePuffPool) {
      slot.mat.dispose();
      for (const sp of slot.spheres) sp.dispose();
    }
    this.smokePuffPool = [];
  }
}
