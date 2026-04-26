import * as BABYLON from "@babylonjs/core";
import { VehicleFactory, VehicleMeshes } from "./VehicleFactory";
import { VehicleDescriptor, VehicleKind, VEHICLE_PRESETS } from "./VehicleDesigner";
import { EventBus } from "./EventBus";

export interface VehicleInstance {
  id: string;
  kind: VehicleKind;
  descriptor: VehicleDescriptor;
  meshes: VehicleMeshes;
  position: BABYLON.Vector3;
  velocity: BABYLON.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  hp: number;
  maxHp: number;
}

export interface VehicleInputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  boost: boolean;
}

const ATV_GROUND_HEIGHT = 0.0;
const FIGHTER_MIN_ALTITUDE = 1.0;
const FIGHTER_MAX_ALTITUDE = 600.0;

export class VehicleSystem {
  private scene: BABYLON.Scene;
  private factory: VehicleFactory;
  private vehicles: VehicleInstance[] = [];
  private active: VehicleInstance | null = null;
  private getCameraYaw: () => number;
  private getCameraPitch: () => number;
  private getGroundHeight: ((x: number, z: number) => number) | null = null;
  private input: VehicleInputState = { forward: false, back: false, left: false, right: false, up: false, down: false, boost: false };
  private nextId: number = 0;

  constructor(scene: BABYLON.Scene, getCameraYaw: () => number, getCameraPitch: () => number) {
    this.scene = scene;
    this.factory = new VehicleFactory(scene);
    this.getCameraYaw = getCameraYaw;
    this.getCameraPitch = getCameraPitch;
    console.log("[VehicleSystem] Initialized");
  }

  setGroundHeightFn(fn: (x: number, z: number) => number): void {
    this.getGroundHeight = fn;
  }

  setInput(state: Partial<VehicleInputState>): void {
    Object.assign(this.input, state);
  }

  spawnPreset(presetName: string, position: BABYLON.Vector3): VehicleInstance | null {
    const desc = VEHICLE_PRESETS[presetName];
    if (!desc) return null;
    return this.spawn(desc, position);
  }

  spawn(desc: VehicleDescriptor, position: BABYLON.Vector3): VehicleInstance {
    const meshes = this.factory.createVehicle(desc, position);
    const inst: VehicleInstance = {
      id: `vehicle_${this.nextId++}`,
      kind: desc.style.kind,
      descriptor: desc,
      meshes,
      position: position.clone(),
      velocity: BABYLON.Vector3.Zero(),
      yaw: 0,
      pitch: 0,
      roll: 0,
      speed: 0,
      hp: 200,
      maxHp: 200,
    };
    this.vehicles.push(inst);
    return inst;
  }

  getVehicles(): VehicleInstance[] {
    return this.vehicles.slice();
  }

  getNearest(position: BABYLON.Vector3, maxRange: number = 5.5): VehicleInstance | null {
    let best: VehicleInstance | null = null;
    let bestDist = maxRange;
    for (const v of this.vehicles) {
      if (this.active === v) continue;
      const d = BABYLON.Vector3.Distance(v.position, position);
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    return best;
  }

  getActive(): VehicleInstance | null {
    return this.active;
  }

  enter(v: VehicleInstance): void {
    this.active = v;
    v.velocity.setAll(0);
    v.speed = 0;
    EventBus.getInstance().emit("vehicle:entered", { id: v.id, kind: v.kind, name: v.descriptor.name });
  }

  exit(): VehicleInstance | null {
    const v = this.active;
    if (!v) return null;
    v.velocity.setAll(0);
    v.speed = 0;
    this.active = null;
    EventBus.getInstance().emit("vehicle:exited", { id: v.id });
    return v;
  }

  update(dt: number): void {
    if (!this.active) return;
    const v = this.active;
    if (v.kind === "atv") this.updateATV(v, dt);
    else this.updateFighter(v, dt);

    // Apply transform to mesh
    v.meshes.root.position.copyFrom(v.position);
    v.meshes.root.rotation.x = v.pitch;
    v.meshes.root.rotation.y = v.yaw;
    v.meshes.root.rotation.z = v.roll;

    // Spin wheels
    if (v.kind === "atv") {
      const spin = -v.speed * dt * 1.6;
      for (const w of v.meshes.wheels) {
        w.rotation.x += spin;
      }
    }

    // Pulse thrusters
    const t = performance.now() * 0.01;
    const pulse = 0.7 + Math.sin(t) * 0.3 + Math.abs(v.speed) * 0.01;
    for (const th of v.meshes.thrusters) {
      th.scaling.set(1 + pulse * 0.2, 1 + pulse * 0.2, 1 + pulse * 0.4);
    }
  }

  private updateATV(v: VehicleInstance, dt: number): void {
    const camYaw = this.getCameraYaw();
    const targetYaw = camYaw;
    // Smoothly steer toward camera yaw
    const yawDelta = ((targetYaw - v.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    v.yaw += yawDelta * Math.min(1, dt * 6);

    // Throttle
    const accel = 22;
    const maxSpeed = this.input.boost ? 38 : 24;
    const drag = 4;
    if (this.input.forward) v.speed += accel * dt;
    if (this.input.back) v.speed -= accel * 0.7 * dt;
    if (!this.input.forward && !this.input.back) {
      if (v.speed > 0) v.speed = Math.max(0, v.speed - drag * dt);
      else if (v.speed < 0) v.speed = Math.min(0, v.speed + drag * dt);
    }
    v.speed = Math.max(-maxSpeed * 0.4, Math.min(maxSpeed, v.speed));

    // Strafe (light)
    let strafe = 0;
    if (this.input.left) strafe -= 1;
    if (this.input.right) strafe += 1;

    const forward = new BABYLON.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    const right = new BABYLON.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));

    v.velocity.x = forward.x * v.speed + right.x * strafe * 6;
    v.velocity.z = forward.z * v.speed + right.z * strafe * 6;

    v.position.x += v.velocity.x * dt;
    v.position.z += v.velocity.z * dt;

    // Stick to ground
    const groundY = this.getGroundHeight ? this.getGroundHeight(v.position.x, v.position.z) : 0;
    const targetY = groundY + ATV_GROUND_HEIGHT;
    v.position.y += (targetY - v.position.y) * Math.min(1, dt * 12);

    // Lean roll based on strafe
    v.roll += (-strafe * 0.15 - v.roll) * Math.min(1, dt * 8);
    v.pitch = 0;
  }

  private updateFighter(v: VehicleInstance, dt: number): void {
    const camYaw = this.getCameraYaw();
    const camPitch = this.getCameraPitch();

    // Smoothly orient toward camera
    const yawDelta = ((camYaw - v.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    v.yaw += yawDelta * Math.min(1, dt * 4);
    v.pitch += (camPitch - v.pitch) * Math.min(1, dt * 4);

    // Throttle
    const accel = 30;
    const maxSpeed = this.input.boost ? 95 : 55;
    const drag = 3;
    if (this.input.forward) v.speed += accel * dt;
    if (this.input.back) v.speed -= accel * 0.6 * dt;
    if (!this.input.forward && !this.input.back) {
      if (v.speed > 0) v.speed = Math.max(0, v.speed - drag * dt);
      else if (v.speed < 0) v.speed = Math.min(0, v.speed + drag * dt);
    }
    v.speed = Math.max(-maxSpeed * 0.4, Math.min(maxSpeed, v.speed));

    // Direction in 3D from yaw + pitch (negate pitch so look up = nose up)
    const cp = Math.cos(-v.pitch);
    const sp = Math.sin(-v.pitch);
    const forward = new BABYLON.Vector3(Math.sin(v.yaw) * cp, sp, Math.cos(v.yaw) * cp);
    const right = new BABYLON.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw));

    v.velocity = forward.scale(v.speed);

    // Strafe + vertical
    let strafe = 0;
    if (this.input.left) strafe -= 1;
    if (this.input.right) strafe += 1;
    v.velocity.addInPlace(right.scale(strafe * 14));
    if (this.input.up) v.velocity.y += 18;
    if (this.input.down) v.velocity.y -= 18;

    v.position.addInPlace(v.velocity.scale(dt));

    // Soft floor & ceiling
    const groundY = this.getGroundHeight ? this.getGroundHeight(v.position.x, v.position.z) : 0;
    const minY = groundY + FIGHTER_MIN_ALTITUDE;
    if (v.position.y < minY) v.position.y = minY;
    if (v.position.y > FIGHTER_MAX_ALTITUDE) v.position.y = FIGHTER_MAX_ALTITUDE;

    // Roll into turns
    v.roll += (-strafe * 0.5 - v.roll) * Math.min(1, dt * 6);
  }

  dispose(): void {
    this.active = null;
    for (const v of this.vehicles) {
      try { v.meshes.root.dispose(); } catch {}
    }
    this.vehicles = [];
  }
}
