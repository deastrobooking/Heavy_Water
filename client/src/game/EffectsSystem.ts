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

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
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

    this.bus.on("effect:sparkle", this.sparkleHandler);
    this.bus.on("effect:capture", this.captureHandler);
    this.bus.on("effect:levelUp", this.levelUpHandler);
    this.bus.on("effect:pickup", this.pickupHandler);

    console.log("[EffectsSystem] Initialized");
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

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.elapsed += dt;
      const t = Math.min(e.elapsed / e.duration, 1);
      if (e.update) e.update(e, dt, t);
      if (e.elapsed >= e.duration) {
        for (const m of e.meshes) m.dispose();
        if (e.particles) for (const p of e.particles) p.dispose();
        this.active.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.bus.off("effect:sparkle", this.sparkleHandler);
    this.bus.off("effect:capture", this.captureHandler);
    this.bus.off("effect:levelUp", this.levelUpHandler);
    this.bus.off("effect:pickup", this.pickupHandler);
    for (const e of this.active) {
      for (const m of e.meshes) m.dispose();
      if (e.particles) for (const p of e.particles) p.dispose();
    }
    this.active = [];
  }
}
