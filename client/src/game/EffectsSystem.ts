import * as BABYLON from "@babylonjs/core";
import { EventBus } from "./EventBus";

interface ActiveEffect {
  meshes: BABYLON.Mesh[];
  particles?: BABYLON.ParticleSystem[];
  elapsed: number;
  duration: number;
  update?: (e: ActiveEffect, dt: number, t: number) => void;
}

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

  // Camera shake state
  private camera: BABYLON.Camera | null = null;
  private shakeIntensity: number = 0;
  private shakeRemaining: number = 0;
  private shakeDuration: number = 0;
  private lastShakeOffset: BABYLON.Vector3 = new BABYLON.Vector3(0, 0, 0);

  constructor(scene: BABYLON.Scene, camera?: BABYLON.Camera) {
    this.scene = scene;
    this.camera = camera || null;
    this.bus = EventBus.getInstance();

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

  setCamera(camera: BABYLON.Camera): void {
    this.camera = camera;
  }

  /**
   * Trigger a brief camera shake. New shakes layer onto existing ones —
   * the strongest of the requested or current intensity wins, and the
   * remaining time is extended to whichever lasts longer.
   */
  shakeCamera(intensity: number, duration: number): void {
    if (intensity <= 0 || duration <= 0) return;
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeRemaining = Math.max(this.shakeRemaining, duration);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
  }

  private updateCameraShake(dt: number): void {
    if (!this.camera) return;
    // Always undo previous frame's offset first so we don't drift
    if (this.lastShakeOffset.x !== 0 || this.lastShakeOffset.y !== 0 || this.lastShakeOffset.z !== 0) {
      this.camera.position.subtractInPlace(this.lastShakeOffset);
      this.lastShakeOffset.set(0, 0, 0);
    }
    if (this.shakeRemaining <= 0 || this.shakeIntensity <= 0) return;

    const t = this.shakeRemaining / Math.max(this.shakeDuration, 0.001);
    const amp = this.shakeIntensity * t; // ease-out
    const ox = (Math.random() * 2 - 1) * amp;
    const oy = (Math.random() * 2 - 1) * amp * 0.7;
    const oz = (Math.random() * 2 - 1) * amp;
    this.lastShakeOffset.set(ox, oy, oz);
    this.camera.position.addInPlace(this.lastShakeOffset);

    this.shakeRemaining -= dt;
    if (this.shakeRemaining <= 0) {
      this.shakeRemaining = 0;
      this.shakeIntensity = 0;
      this.shakeDuration = 0;
    }
  }

  spawnSparkle(position: BABYLON.Vector3, color?: BABYLON.Color3, count: number = 14): void {
    const c = color || new BABYLON.Color3(1.0, 0.95, 0.4);
    const meshes: BABYLON.Mesh[] = [];
    const velocities: BABYLON.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const star = BABYLON.MeshBuilder.CreateSphere(`spark_${i}_${Date.now()}`, { diameter: 0.25 }, this.scene);
      star.position.copyFrom(position);
      const mat = new BABYLON.StandardMaterial(`sparkMat_${i}`, this.scene);
      mat.emissiveColor = c;
      mat.diffuseColor = c;
      mat.disableLighting = true;
      star.material = mat;
      meshes.push(star);
      const angle = (i / count) * Math.PI * 2;
      const elev = (Math.random() - 0.3) * 1.4;
      velocities.push(new BABYLON.Vector3(
        Math.cos(angle) * (3 + Math.random() * 2),
        elev * 4 + 2,
        Math.sin(angle) * (3 + Math.random() * 2)
      ));
    }
    this.active.push({
      meshes,
      elapsed: 0,
      duration: 0.9,
      update: (e, dt, t) => {
        for (let i = 0; i < e.meshes.length; i++) {
          const m = e.meshes[i];
          const v = velocities[i];
          m.position.addInPlace(v.scale(dt));
          v.y -= 9 * dt;
          const f = 1 - t;
          m.scaling.setAll(0.4 + f * 1.2);
          (m.material as BABYLON.StandardMaterial).alpha = f;
        }
      },
    });
  }

  spawnCapture(position: BABYLON.Vector3, color?: BABYLON.Color3): void {
    const c = color || new BABYLON.Color3(0.4, 0.9, 1.0);
    const ring = BABYLON.MeshBuilder.CreateTorus("captureRing", { diameter: 4, thickness: 0.25, tessellation: 32 }, this.scene);
    ring.position.copyFrom(position);
    const ringMat = new BABYLON.StandardMaterial("captureRingMat", this.scene);
    ringMat.emissiveColor = c;
    ringMat.diffuseColor = c;
    ringMat.alpha = 0.85;
    ringMat.disableLighting = true;
    ring.material = ringMat;

    const beam = BABYLON.MeshBuilder.CreateCylinder("captureBeam", { height: 12, diameter: 0.6, tessellation: 16 }, this.scene);
    beam.position.copyFrom(position);
    beam.position.y += 6;
    const beamMat = new BABYLON.StandardMaterial("captureBeamMat", this.scene);
    beamMat.emissiveColor = c;
    beamMat.diffuseColor = c;
    beamMat.alpha = 0.55;
    beamMat.disableLighting = true;
    beam.material = beamMat;

    this.active.push({
      meshes: [ring, beam],
      elapsed: 0,
      duration: 1.4,
      update: (e, dt, t) => {
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
    mat.diffuseColor = golden;
    mat.alpha = 0.4;
    mat.disableLighting = true;
    pillar.material = mat;

    this.active.push({
      meshes: [pillar],
      elapsed: 0,
      duration: 1.6,
      update: (e, dt, t) => {
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

    // 1) Expanding shock-ring (oriented to face camera)
    const ring = BABYLON.MeshBuilder.CreateTorus(`hitRing_${Date.now()}`, { diameter: 0.6 * scale, thickness: 0.12 * scale, tessellation: 18 }, this.scene);
    ring.position.copyFrom(position);
    ring.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    const ringMat = new BABYLON.StandardMaterial(`hitRingMat_${Date.now()}`, this.scene);
    ringMat.emissiveColor = c;
    ringMat.diffuseColor = c;
    ringMat.disableLighting = true;
    ringMat.alpha = 1;
    ring.material = ringMat;

    // 2) Flash sphere — bright ball at the hit
    const flash = BABYLON.MeshBuilder.CreateSphere(`hitFlash_${Date.now()}`, { diameter: 0.45 * scale, segments: 8 }, this.scene);
    flash.position.copyFrom(position);
    const flashMat = new BABYLON.StandardMaterial(`hitFlashMat_${Date.now()}`, this.scene);
    flashMat.emissiveColor = new BABYLON.Color3(1, 0.95, 0.85);
    flashMat.diffuseColor = new BABYLON.Color3(1, 0.95, 0.85);
    flashMat.disableLighting = true;
    flashMat.alpha = 0.95;
    flash.material = flashMat;

    // 3) Radial spark shards
    const shardCount = 8;
    const shards: BABYLON.Mesh[] = [];
    const shardVels: BABYLON.Vector3[] = [];
    for (let i = 0; i < shardCount; i++) {
      const s = BABYLON.MeshBuilder.CreateBox(`hitShard_${i}_${Date.now()}`, { width: 0.08 * scale, height: 0.08 * scale, depth: 0.35 * scale }, this.scene);
      s.position.copyFrom(position);
      const sm = new BABYLON.StandardMaterial(`hitShardMat_${i}`, this.scene);
      sm.emissiveColor = c;
      sm.diffuseColor = c;
      sm.disableLighting = true;
      s.material = sm;
      shards.push(s);
      const ang = (i / shardCount) * Math.PI * 2 + Math.random() * 0.4;
      const elev = (Math.random() - 0.2) * 1.2;
      shardVels.push(new BABYLON.Vector3(
        Math.cos(ang) * (5 + Math.random() * 3),
        elev * 3 + 1.5,
        Math.sin(ang) * (5 + Math.random() * 3)
      ));
    }

    this.active.push({
      meshes: [ring, flash, ...shards],
      elapsed: 0,
      duration: 0.45,
      update: (e, dt, t) => {
        ring.scaling.setAll(1 + t * 5 * scale);
        (ring.material as BABYLON.StandardMaterial).alpha = 1 - t;
        flash.scaling.setAll(1 + t * 1.4);
        (flash.material as BABYLON.StandardMaterial).alpha = (1 - t) * 0.95;
        for (let i = 0; i < shards.length; i++) {
          const s = shards[i];
          const v = shardVels[i];
          s.position.addInPlace(v.scale(dt));
          v.y -= 12 * dt;
          (s.material as BABYLON.StandardMaterial).alpha = 1 - t;
          s.scaling.setAll(1 - t * 0.5);
        }
      },
    });
  }

  spawnSmokePuff(
    position: BABYLON.Vector3,
    color?: BABYLON.Color3,
    scale: number = 1,
    rise: number = 1.4,
    duration: number = 0.85,
  ): void {
    const c = color || new BABYLON.Color3(0.32, 0.32, 0.36);
    const puffCount = 3;
    const puffs: BABYLON.Mesh[] = [];
    const vels: BABYLON.Vector3[] = [];
    const stamp = Date.now();
    for (let i = 0; i < puffCount; i++) {
      const p = BABYLON.MeshBuilder.CreateSphere(`smoke_${i}_${stamp}_${Math.floor(Math.random() * 1e6)}`, { diameter: 0.45 * scale, segments: 6 }, this.scene);
      p.position.copyFrom(position);
      p.position.x += (Math.random() - 0.5) * 0.35 * scale;
      p.position.y += (Math.random() - 0.2) * 0.2 * scale;
      p.position.z += (Math.random() - 0.5) * 0.35 * scale;
      const mat = new BABYLON.StandardMaterial(`smokeMat_${i}_${stamp}`, this.scene);
      mat.emissiveColor = c.scale(0.55);
      mat.diffuseColor = c;
      mat.disableLighting = true;
      mat.alpha = 0.65;
      p.material = mat;
      p.isPickable = false;
      puffs.push(p);
      vels.push(new BABYLON.Vector3(
        (Math.random() - 0.5) * 0.9,
        rise * (0.7 + Math.random() * 0.6),
        (Math.random() - 0.5) * 0.9,
      ));
    }
    this.active.push({
      meshes: puffs,
      elapsed: 0,
      duration,
      update: (e, dt, t) => {
        for (let i = 0; i < puffs.length; i++) {
          puffs[i].position.addInPlace(vels[i].scale(dt));
          vels[i].y += 0.4 * dt; // slight buoyancy
          vels[i].x *= 1 - dt * 1.5;
          vels[i].z *= 1 - dt * 1.5;
          puffs[i].scaling.setAll(1 + t * 1.8 * scale);
          (puffs[i].material as BABYLON.StandardMaterial).alpha = 0.65 * (1 - t);
        }
      },
    });
  }

  private disposeEffect(e: ActiveEffect): void {
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
    this.bus.off("effect:sparkle", this.sparkleHandler);
    this.bus.off("effect:capture", this.captureHandler);
    this.bus.off("effect:levelUp", this.levelUpHandler);
    this.bus.off("effect:pickup", this.pickupHandler);
    this.bus.off("effect:hitImpact", this.hitImpactHandler);
    this.bus.off("effect:smokePuff", this.smokePuffHandler);
    this.bus.off("effect:cameraShake", this.cameraShakeHandler);
    // Undo any pending camera offset before letting go of the camera
    if (this.camera && (this.lastShakeOffset.x !== 0 || this.lastShakeOffset.y !== 0 || this.lastShakeOffset.z !== 0)) {
      this.camera.position.subtractInPlace(this.lastShakeOffset);
      this.lastShakeOffset.set(0, 0, 0);
    }
    for (const e of this.active) this.disposeEffect(e);
    this.active = [];
  }
}
