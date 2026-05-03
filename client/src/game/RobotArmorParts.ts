import * as BABYLON from "@babylonjs/core";
import { ArmorMaterialFactory } from "./ArmorMaterialFactory";

export type ArmorSlot =
  | "helmet"
  | "chest"
  | "back"
  | "leftShoulder"
  | "rightShoulder"
  | "leftArm"
  | "rightArm"
  | "leftWeapon"
  | "rightWeapon"
  | "legs";

export interface ArmorBuildContext {
  scene: BABYLON.Scene;
  materials: ArmorMaterialFactory;
  parent: BABYLON.TransformNode;
  bodyHeight: number;
  shoulderWidth: number;
  armLength: number;
  legLength: number;
  side?: "left" | "right";
}

export interface ArmorPartDefinition {
  id: string;
  name: string;
  slot: ArmorSlot;
  build: (ctx: ArmorBuildContext) => BABYLON.Mesh[];
}

function attach(meshes: BABYLON.Mesh[], parent: BABYLON.TransformNode): BABYLON.Mesh[] {
  for (const m of meshes) m.parent = parent;
  return meshes;
}

function ringOfBolts(
  scene: BABYLON.Scene, name: string, count: number, radius: number, y: number, mat: BABYLON.Material
): BABYLON.Mesh[] {
  const out: BABYLON.Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const bolt = BABYLON.MeshBuilder.CreateSphere(`${name}_bolt_${i}`, { diameter: 0.08 }, scene);
    bolt.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius);
    bolt.material = mat;
    out.push(bolt);
  }
  return out;
}

export const HELMET_PARTS: ArmorPartDefinition[] = [
  {
    id: "helmet_none", name: "None", slot: "helmet",
    build: () => [],
  },
  {
    id: "helmet_basic", name: "Basic Helm", slot: "helmet",
    build: (ctx) => {
      const r = 0.75;
      const dome = BABYLON.MeshBuilder.CreateSphere("helm_dome", { diameter: r * 2.2, segments: 16 }, ctx.scene);
      dome.position.y = 0.05;
      dome.material = ctx.materials.metal();
      const facePlate = BABYLON.MeshBuilder.CreateBox("helm_face", { width: r * 1.4, height: r * 0.7, depth: r * 0.2 }, ctx.scene);
      facePlate.position.set(0, -r * 0.15, r * 0.95);
      facePlate.material = ctx.materials.black();
      const visorStrip = BABYLON.MeshBuilder.CreateBox("helm_visor", { width: r * 1.5, height: r * 0.18, depth: r * 0.05 }, ctx.scene);
      visorStrip.position.set(0, -r * 0.05, r * 1.05);
      visorStrip.material = ctx.materials.neon();
      return attach([dome, facePlate, visorStrip], ctx.parent);
    },
  },
  {
    id: "helmet_horned", name: "Horned War Helm", slot: "helmet",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const r = 0.8;
      const dome = BABYLON.MeshBuilder.CreateSphere("helm_dome", { diameter: r * 2.2, segments: 16 }, ctx.scene);
      dome.position.y = 0.1;
      dome.material = ctx.materials.metal();
      meshes.push(dome);
      for (const sx of [-1, 1]) {
        const horn = BABYLON.MeshBuilder.CreateCylinder("helm_horn", {
          height: r * 1.6, diameterTop: 0, diameterBottom: r * 0.35, tessellation: 12,
        }, ctx.scene);
        horn.position.set(sx * r * 0.85, r * 0.65, 0);
        horn.rotation.z = sx * 0.6;
        horn.material = ctx.materials.gold();
        meshes.push(horn);
      }
      const visor = BABYLON.MeshBuilder.CreateBox("helm_visor", { width: r * 1.5, height: r * 0.2, depth: r * 0.05 }, ctx.scene);
      visor.position.set(0, 0, r * 1.05);
      visor.material = ctx.materials.neon();
      meshes.push(visor);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "helmet_crown", name: "Cyber Crown", slot: "helmet",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const r = 0.78;
      const dome = BABYLON.MeshBuilder.CreateSphere("helm_dome", { diameter: r * 2.2 }, ctx.scene);
      dome.material = ctx.materials.black();
      meshes.push(dome);
      const ring = BABYLON.MeshBuilder.CreateTorus("helm_ring", {
        diameter: r * 2.4, thickness: 0.12, tessellation: 24,
      }, ctx.scene);
      ring.position.y = r * 0.35;
      ring.material = ctx.materials.gold();
      meshes.push(ring);
      const spikeCount = 8;
      for (let i = 0; i < spikeCount; i++) {
        const a = (i / spikeCount) * Math.PI * 2;
        const spike = BABYLON.MeshBuilder.CreateCylinder(`helm_spike_${i}`, {
          height: r * 0.6, diameterTop: 0, diameterBottom: 0.12, tessellation: 8,
        }, ctx.scene);
        spike.position.set(Math.cos(a) * r * 1.05, r * 0.55, Math.sin(a) * r * 1.05);
        spike.material = ctx.materials.gold();
        meshes.push(spike);
      }
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "helmet_visor", name: "Pilot Visor", slot: "helmet",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const r = 0.7;
      const cap = BABYLON.MeshBuilder.CreateSphere("helm_cap", { diameter: r * 2.0, slice: 0.55 }, ctx.scene);
      cap.position.y = r * 0.2;
      cap.material = ctx.materials.metal();
      meshes.push(cap);
      const visor = BABYLON.MeshBuilder.CreateSphere("helm_visor", { diameter: r * 2.0, slice: 0.45 }, ctx.scene);
      visor.position.y = -r * 0.05;
      visor.rotation.x = Math.PI;
      visor.material = ctx.materials.neon();
      meshes.push(visor);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "helmet_cyber", name: "Sensor Cyber", slot: "helmet",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const r = 0.75;
      const dome = BABYLON.MeshBuilder.CreateSphere("helm_dome", { diameter: r * 2.2 }, ctx.scene);
      dome.material = ctx.materials.metal();
      meshes.push(dome);
      const sensorCount = 6;
      for (let i = 0; i < sensorCount; i++) {
        const a = (i / sensorCount) * Math.PI - Math.PI / 2;
        const sensor = BABYLON.MeshBuilder.CreateSphere(`helm_sensor_${i}`, { diameter: 0.18 }, ctx.scene);
        sensor.position.set(Math.cos(a) * r * 0.9, r * 0.3, Math.sin(a) * r * 1.05);
        sensor.material = ctx.materials.neon();
        meshes.push(sensor);
      }
      const antenna = BABYLON.MeshBuilder.CreateCylinder("helm_antenna", {
        height: r * 1.2, diameterTop: 0.05, diameterBottom: 0.1, tessellation: 8,
      }, ctx.scene);
      antenna.position.y = r * 1.4;
      antenna.material = ctx.materials.metal();
      meshes.push(antenna);
      const tip = BABYLON.MeshBuilder.CreateSphere("helm_antenna_tip", { diameter: 0.18 }, ctx.scene);
      tip.position.y = r * 2.0;
      tip.material = ctx.materials.neon();
      meshes.push(tip);
      return attach(meshes, ctx.parent);
    },
  },
];

export const CHEST_PARTS: ArmorPartDefinition[] = [
  {
    id: "chest_none", name: "None", slot: "chest",
    build: () => [],
  },
  {
    id: "chest_plate", name: "Combat Plate", slot: "chest",
    build: (ctx) => {
      const w = ctx.shoulderWidth * 0.75;
      const h = ctx.bodyHeight * 0.22;
      const plate = BABYLON.MeshBuilder.CreateBox("chest_plate", { width: w, height: h, depth: 0.45 }, ctx.scene);
      plate.material = ctx.materials.metal();
      const pec1 = BABYLON.MeshBuilder.CreateBox("chest_pec1", { width: w * 0.4, height: h * 0.5, depth: 0.18 }, ctx.scene);
      pec1.position.set(-w * 0.18, h * 0.18, 0.32);
      pec1.material = ctx.materials.ceramic();
      const pec2 = pec1.clone("chest_pec2")!;
      pec2.position.x *= -1;
      const trim = BABYLON.MeshBuilder.CreateBox("chest_trim", { width: w * 0.92, height: 0.08, depth: 0.05 }, ctx.scene);
      trim.position.set(0, -h * 0.42, 0.25);
      trim.material = ctx.materials.gold();
      return attach([plate, pec1, pec2, trim], ctx.parent);
    },
  },
  {
    id: "chest_reactor", name: "Reactor Core", slot: "chest",
    build: (ctx) => {
      const w = ctx.shoulderWidth * 0.78;
      const h = ctx.bodyHeight * 0.24;
      const plate = BABYLON.MeshBuilder.CreateBox("chest_plate", { width: w, height: h, depth: 0.5 }, ctx.scene);
      plate.material = ctx.materials.black();
      const reactor = BABYLON.MeshBuilder.CreateSphere("chest_reactor", { diameter: 0.6 }, ctx.scene);
      reactor.position.set(0, 0, 0.3);
      reactor.material = ctx.materials.neon();
      const ring = BABYLON.MeshBuilder.CreateTorus("chest_reactor_ring", {
        diameter: 0.85, thickness: 0.08, tessellation: 24,
      }, ctx.scene);
      ring.position.set(0, 0, 0.32);
      ring.rotation.x = Math.PI / 2;
      ring.material = ctx.materials.gold();
      const bolts = ringOfBolts(ctx.scene, "chest_bolts", 8, 0.55, 0.32, ctx.materials.gold());
      bolts.forEach((b) => (b.position.z = 0.28));
      return attach([plate, reactor, ring, ...bolts], ctx.parent);
    },
  },
  {
    id: "chest_layered", name: "Layered Plates", slot: "chest",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const w = ctx.shoulderWidth * 0.78;
      const h = ctx.bodyHeight * 0.24;
      const layers = 4;
      for (let i = 0; i < layers; i++) {
        const t = i / (layers - 1);
        const plate = BABYLON.MeshBuilder.CreateBox(`chest_layer_${i}`, {
          width: w * (1 - t * 0.18),
          height: h * 0.28,
          depth: 0.25,
        }, ctx.scene);
        plate.position.set(0, h * 0.5 - t * h * 0.25 - h * 0.15, 0.2 - t * 0.04);
        plate.material = i % 2 === 0 ? ctx.materials.metal() : ctx.materials.ceramic();
        meshes.push(plate);
      }
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "chest_minimal", name: "Sternum Strip", slot: "chest",
    build: (ctx) => {
      const w = ctx.shoulderWidth * 0.18;
      const h = ctx.bodyHeight * 0.22;
      const strip = BABYLON.MeshBuilder.CreateBox("chest_strip", { width: w, height: h, depth: 0.3 }, ctx.scene);
      strip.position.z = 0.28;
      strip.material = ctx.materials.metal();
      const glow = BABYLON.MeshBuilder.CreateBox("chest_strip_glow", { width: w * 0.4, height: h * 0.85, depth: 0.05 }, ctx.scene);
      glow.position.z = 0.45;
      glow.material = ctx.materials.neon();
      return attach([strip, glow], ctx.parent);
    },
  },
  {
    id: "chest_titan", name: "Titan Plates", slot: "chest",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const w = ctx.shoulderWidth * 0.85;
      const h = ctx.bodyHeight * 0.26;
      const plate = BABYLON.MeshBuilder.CreateBox("chest_titan_main", { width: w, height: h, depth: 0.55 }, ctx.scene);
      plate.material = ctx.materials.metal();
      meshes.push(plate);
      for (let i = 0; i < 3; i++) {
        const stripe = BABYLON.MeshBuilder.CreateBox(`chest_titan_stripe_${i}`, {
          width: 0.06, height: h * 0.85, depth: 0.04,
        }, ctx.scene);
        stripe.position.set((i - 1) * 0.4, 0, 0.3);
        stripe.material = ctx.materials.gold();
        meshes.push(stripe);
      }
      const core = BABYLON.MeshBuilder.CreateCylinder("chest_titan_core", {
        height: 0.05, diameter: 0.5, tessellation: 16,
      }, ctx.scene);
      core.rotation.x = Math.PI / 2;
      core.position.set(0, h * 0.05, 0.32);
      core.material = ctx.materials.neon();
      meshes.push(core);
      return attach(meshes, ctx.parent);
    },
  },
];

export const SHOULDER_PARTS: ArmorPartDefinition[] = [
  {
    id: "shoulder_none", name: "None", slot: "leftShoulder",
    build: () => [],
  },
  {
    id: "shoulder_pad", name: "Round Pad", slot: "leftShoulder",
    build: (ctx) => {
      const pad = BABYLON.MeshBuilder.CreateSphere("shoulder_pad", {
        diameter: 0.7, slice: 0.55,
      }, ctx.scene);
      pad.material = ctx.materials.metal();
      pad.position.y = 0.05;
      const trim = BABYLON.MeshBuilder.CreateTorus("shoulder_trim", {
        diameter: 0.7, thickness: 0.06, tessellation: 16,
      }, ctx.scene);
      trim.position.y = -0.02;
      trim.material = ctx.materials.gold();
      return attach([pad, trim], ctx.parent);
    },
  },
  {
    id: "shoulder_spikes", name: "Spike Pad", slot: "leftShoulder",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const pad = BABYLON.MeshBuilder.CreateSphere("shoulder_pad", { diameter: 0.7, slice: 0.55 }, ctx.scene);
      pad.material = ctx.materials.black();
      meshes.push(pad);
      const spikeCount = 5;
      for (let i = 0; i < spikeCount; i++) {
        const a = (i / (spikeCount - 1) - 0.5) * Math.PI;
        const spike = BABYLON.MeshBuilder.CreateCylinder(`shoulder_spike_${i}`, {
          height: 0.45, diameterTop: 0, diameterBottom: 0.12, tessellation: 8,
        }, ctx.scene);
        spike.position.set(Math.cos(a) * 0.35, 0.25, Math.sin(a) * 0.35);
        spike.rotation.z = -Math.cos(a) * 0.5;
        spike.rotation.x = Math.sin(a) * 0.5;
        spike.material = ctx.materials.metal();
        meshes.push(spike);
      }
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "shoulder_cannon", name: "Mounted Cannon", slot: "leftShoulder",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const pad = BABYLON.MeshBuilder.CreateSphere("shoulder_pad", { diameter: 0.6, slice: 0.55 }, ctx.scene);
      pad.material = ctx.materials.metal();
      meshes.push(pad);
      const cannon = BABYLON.MeshBuilder.CreateCylinder("shoulder_cannon", {
        height: 0.7, diameter: 0.22, tessellation: 12,
      }, ctx.scene);
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(0, 0.18, 0.3);
      cannon.material = ctx.materials.black();
      meshes.push(cannon);
      const muzzle = BABYLON.MeshBuilder.CreateSphere("shoulder_muzzle", { diameter: 0.15 }, ctx.scene);
      muzzle.position.set(0, 0.18, 0.65);
      muzzle.material = ctx.materials.neon();
      meshes.push(muzzle);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "shoulder_minimal", name: "Plate Cap", slot: "leftShoulder",
    build: (ctx) => {
      const cap = BABYLON.MeshBuilder.CreateBox("shoulder_cap", {
        width: 0.55, height: 0.14, depth: 0.5,
      }, ctx.scene);
      cap.material = ctx.materials.ceramic();
      return attach([cap], ctx.parent);
    },
  },
];

export const ARM_PARTS: ArmorPartDefinition[] = [
  {
    id: "arm_none", name: "None", slot: "leftArm",
    build: () => [],
  },
  {
    id: "arm_gauntlet", name: "Gauntlet", slot: "leftArm",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const foreLen = ctx.armLength * 0.5;
      const tube = BABYLON.MeshBuilder.CreateCylinder("arm_gauntlet", {
        height: foreLen * 0.85, diameter: 0.42, tessellation: 12,
      }, ctx.scene);
      tube.position.y = -ctx.armLength - foreLen * 0.05;
      tube.material = ctx.materials.metal();
      meshes.push(tube);
      const knuckle = BABYLON.MeshBuilder.CreateBox("arm_knuckle", { width: 0.32, height: 0.18, depth: 0.34 }, ctx.scene);
      knuckle.position.y = -ctx.armLength - foreLen * 0.5;
      knuckle.material = ctx.materials.gold();
      meshes.push(knuckle);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "arm_blade", name: "Forearm Blade", slot: "leftArm",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const foreLen = ctx.armLength * 0.5;
      const tube = BABYLON.MeshBuilder.CreateCylinder("arm_blade_base", {
        height: foreLen * 0.7, diameter: 0.4, tessellation: 12,
      }, ctx.scene);
      tube.position.y = -ctx.armLength - foreLen * 0.1;
      tube.material = ctx.materials.metal();
      meshes.push(tube);
      const blade = BABYLON.MeshBuilder.CreateBox("arm_blade", {
        width: 0.06, height: foreLen * 1.2, depth: 0.2,
      }, ctx.scene);
      blade.position.y = -ctx.armLength - foreLen * 0.5;
      blade.position.x = 0.25;
      blade.rotation.z = -Math.PI / 8;
      blade.material = ctx.materials.neon();
      meshes.push(blade);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "arm_thrusters", name: "Wrist Thrusters", slot: "leftArm",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const foreLen = ctx.armLength * 0.5;
      const tube = BABYLON.MeshBuilder.CreateCylinder("arm_t_base", {
        height: foreLen * 0.7, diameter: 0.4, tessellation: 12,
      }, ctx.scene);
      tube.position.y = -ctx.armLength - foreLen * 0.1;
      tube.material = ctx.materials.black();
      meshes.push(tube);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const thruster = BABYLON.MeshBuilder.CreateCylinder(`arm_thruster_${i}`, {
          height: 0.18, diameterTop: 0.08, diameterBottom: 0.14, tessellation: 8,
        }, ctx.scene);
        thruster.position.set(Math.cos(a) * 0.22, -ctx.armLength - foreLen * 0.45, Math.sin(a) * 0.22);
        thruster.material = ctx.materials.neon();
        meshes.push(thruster);
      }
      return attach(meshes, ctx.parent);
    },
  },
];

export const WEAPON_PARTS: ArmorPartDefinition[] = [
  {
    id: "weapon_none", name: "None", slot: "rightWeapon",
    build: () => [],
  },
  {
    id: "weapon_blade", name: "Energy Blade", slot: "rightWeapon",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const foreLen = ctx.armLength * 0.5;
      const grip = BABYLON.MeshBuilder.CreateCylinder("weapon_grip", {
        height: 0.5, diameter: 0.16, tessellation: 12,
      }, ctx.scene);
      grip.position.y = -ctx.armLength - foreLen - 0.3;
      grip.material = ctx.materials.black();
      meshes.push(grip);
      const blade = BABYLON.MeshBuilder.CreateBox("weapon_blade", {
        width: 0.08, height: 2.2, depth: 0.25,
      }, ctx.scene);
      blade.position.y = -ctx.armLength - foreLen - 1.65;
      blade.material = ctx.materials.neon();
      meshes.push(blade);
      const guard = BABYLON.MeshBuilder.CreateBox("weapon_guard", {
        width: 0.5, height: 0.05, depth: 0.3,
      }, ctx.scene);
      guard.position.y = -ctx.armLength - foreLen - 0.55;
      guard.material = ctx.materials.gold();
      meshes.push(guard);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "weapon_cannon", name: "Plasma Cannon", slot: "rightWeapon",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const foreLen = ctx.armLength * 0.5;
      const yBase = -ctx.armLength - foreLen - 0.3;
      const body = BABYLON.MeshBuilder.CreateBox("weapon_body", { width: 0.5, height: 0.5, depth: 1.2 }, ctx.scene);
      body.position.set(0, yBase, 0.4);
      body.material = ctx.materials.metal();
      meshes.push(body);
      const barrel = BABYLON.MeshBuilder.CreateCylinder("weapon_barrel", {
        height: 1.0, diameter: 0.3, tessellation: 16,
      }, ctx.scene);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, yBase, 1.2);
      barrel.material = ctx.materials.black();
      meshes.push(barrel);
      const muzzle = BABYLON.MeshBuilder.CreateSphere("weapon_muzzle", { diameter: 0.28 }, ctx.scene);
      muzzle.position.set(0, yBase, 1.7);
      muzzle.material = ctx.materials.neon();
      meshes.push(muzzle);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "weapon_pistol", name: "Sidearm", slot: "rightWeapon",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const foreLen = ctx.armLength * 0.5;
      const yBase = -ctx.armLength - foreLen - 0.3;
      const grip = BABYLON.MeshBuilder.CreateBox("weapon_grip", { width: 0.18, height: 0.45, depth: 0.18 }, ctx.scene);
      grip.position.set(0, yBase, 0.05);
      grip.material = ctx.materials.black();
      meshes.push(grip);
      const slide = BABYLON.MeshBuilder.CreateBox("weapon_slide", { width: 0.2, height: 0.18, depth: 0.6 }, ctx.scene);
      slide.position.set(0, yBase + 0.25, 0.3);
      slide.material = ctx.materials.metal();
      meshes.push(slide);
      const sight = BABYLON.MeshBuilder.CreateBox("weapon_sight", { width: 0.05, height: 0.04, depth: 0.05 }, ctx.scene);
      sight.position.set(0, yBase + 0.36, 0.55);
      sight.material = ctx.materials.neon();
      meshes.push(sight);
      return attach(meshes, ctx.parent);
    },
  },
];

export const LEG_PARTS: ArmorPartDefinition[] = [
  {
    id: "legs_none", name: "None", slot: "legs",
    build: () => [],
  },
  {
    id: "legs_greaves", name: "Greaves", slot: "legs",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const thighLen = ctx.legLength * 0.5;
      const shinLen = ctx.legLength * 0.5;
      const thigh = BABYLON.MeshBuilder.CreateBox("legs_thigh", { width: 0.42, height: thighLen * 0.9, depth: 0.42 }, ctx.scene);
      thigh.position.y = -thighLen * 0.5;
      thigh.material = ctx.materials.metal();
      meshes.push(thigh);
      const shin = BABYLON.MeshBuilder.CreateBox("legs_shin", { width: 0.36, height: shinLen * 0.9, depth: 0.36 }, ctx.scene);
      shin.position.y = -thighLen - shinLen * 0.5;
      shin.material = ctx.materials.ceramic();
      meshes.push(shin);
      const knee = BABYLON.MeshBuilder.CreateSphere("legs_knee", { diameter: 0.28 }, ctx.scene);
      knee.position.y = -thighLen;
      knee.material = ctx.materials.gold();
      meshes.push(knee);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "legs_boosters", name: "Boost Greaves", slot: "legs",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const thighLen = ctx.legLength * 0.5;
      const shinLen = ctx.legLength * 0.5;
      const thigh = BABYLON.MeshBuilder.CreateBox("legs_thigh", { width: 0.42, height: thighLen * 0.85, depth: 0.42 }, ctx.scene);
      thigh.position.y = -thighLen * 0.5;
      thigh.material = ctx.materials.black();
      meshes.push(thigh);
      const shin = BABYLON.MeshBuilder.CreateCylinder("legs_shin", {
        height: shinLen * 0.85, diameterTop: 0.32, diameterBottom: 0.42, tessellation: 12,
      }, ctx.scene);
      shin.position.y = -thighLen - shinLen * 0.5;
      shin.material = ctx.materials.metal();
      meshes.push(shin);
      const booster = BABYLON.MeshBuilder.CreateCylinder("legs_booster", {
        height: 0.4, diameterTop: 0.18, diameterBottom: 0.32, tessellation: 12,
      }, ctx.scene);
      booster.position.set(0, -thighLen - shinLen - 0.1, -0.2);
      booster.rotation.x = -0.3;
      booster.material = ctx.materials.neon();
      meshes.push(booster);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "legs_titan", name: "Titan Legs", slot: "legs",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const thighLen = ctx.legLength * 0.5;
      const shinLen = ctx.legLength * 0.5;
      const thigh = BABYLON.MeshBuilder.CreateBox("legs_thigh", { width: 0.55, height: thighLen * 0.95, depth: 0.5 }, ctx.scene);
      thigh.position.y = -thighLen * 0.5;
      thigh.material = ctx.materials.metal();
      meshes.push(thigh);
      const shin = BABYLON.MeshBuilder.CreateBox("legs_shin", { width: 0.5, height: shinLen * 0.95, depth: 0.5 }, ctx.scene);
      shin.position.y = -thighLen - shinLen * 0.5;
      shin.material = ctx.materials.metal();
      meshes.push(shin);
      const trim = BABYLON.MeshBuilder.CreateBox("legs_trim", { width: 0.6, height: 0.06, depth: 0.55 }, ctx.scene);
      trim.position.y = -thighLen;
      trim.material = ctx.materials.gold();
      meshes.push(trim);
      const stripeY = -thighLen - shinLen * 0.5;
      for (let i = 0; i < 3; i++) {
        const stripe = BABYLON.MeshBuilder.CreateBox(`legs_stripe_${i}`, { width: 0.04, height: shinLen * 0.6, depth: 0.04 }, ctx.scene);
        stripe.position.set((i - 1) * 0.18, stripeY, 0.28);
        stripe.material = ctx.materials.neon();
        meshes.push(stripe);
      }
      return attach(meshes, ctx.parent);
    },
  },
];

export const BACK_PARTS: ArmorPartDefinition[] = [
  {
    id: "back_none", name: "None", slot: "back",
    build: () => [],
  },
  {
    id: "back_jetpack", name: "Jetpack", slot: "back",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      for (const sx of [-1, 1]) {
        const tank = BABYLON.MeshBuilder.CreateCylinder("back_tank", {
          height: 1.2, diameter: 0.35, tessellation: 12,
        }, ctx.scene);
        tank.position.set(sx * 0.3, 0, -0.45);
        tank.material = ctx.materials.metal();
        meshes.push(tank);
        const flame = BABYLON.MeshBuilder.CreateCylinder("back_flame", {
          height: 0.3, diameterTop: 0.18, diameterBottom: 0.28, tessellation: 8,
        }, ctx.scene);
        flame.position.set(sx * 0.3, -0.7, -0.45);
        flame.material = ctx.materials.neon();
        meshes.push(flame);
      }
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "back_wings", name: "Energy Wings", slot: "back",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      for (const sx of [-1, 1]) {
        const wing = BABYLON.MeshBuilder.CreateBox("back_wing", { width: 1.6, height: 1.0, depth: 0.06 }, ctx.scene);
        wing.position.set(sx * 0.85, 0.3, -0.4);
        wing.rotation.z = sx * -0.4;
        wing.rotation.y = sx * 0.3;
        wing.material = ctx.materials.neon();
        meshes.push(wing);
        const spar = BABYLON.MeshBuilder.CreateCylinder("back_spar", { height: 1.6, diameter: 0.08, tessellation: 8 }, ctx.scene);
        spar.rotation.z = Math.PI / 2;
        spar.position.set(sx * 0.85, 0.3, -0.32);
        spar.material = ctx.materials.gold();
        meshes.push(spar);
      }
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "back_cape", name: "Tactical Cape", slot: "back",
    build: (ctx) => {
      const cape = BABYLON.MeshBuilder.CreateBox("back_cape", { width: 1.5, height: 2.4, depth: 0.04 }, ctx.scene);
      cape.position.set(0, -0.5, -0.4);
      cape.material = ctx.materials.ceramic();
      const trim = BABYLON.MeshBuilder.CreateBox("back_cape_trim", { width: 1.5, height: 0.08, depth: 0.05 }, ctx.scene);
      trim.position.set(0, 0.6, -0.42);
      trim.material = ctx.materials.gold();
      return attach([cape, trim], ctx.parent);
    },
  },
];

import {
  HELMET_PARTS_EXTRA,
  CHEST_PARTS_EXTRA,
  SHOULDER_PARTS_EXTRA,
  WEAPON_PARTS_EXTRA,
  LEG_PARTS_EXTRA,
  BACK_PARTS_EXTRA,
} from "./RobotArmorPartsExtra";
import {
  HUMANOID_HELMET_PARTS,
  HUMANOID_CHEST_PARTS,
  HUMANOID_SHOULDER_PARTS,
  HUMANOID_ARM_PARTS,
  HUMANOID_WEAPON_PARTS,
  HUMANOID_LEG_PARTS,
} from "./HumanoidArmorParts";
import {
  EVIL_HELMET_PARTS,
  EVIL_CHEST_PARTS,
  EVIL_SHOULDER_PARTS,
  EVIL_BACK_PARTS,
  EVIL_LEG_PARTS,
} from "./RobotArmorPartsEvil";

export const ARMOR_PART_REGISTRY: Record<ArmorSlot, ArmorPartDefinition[]> = {
  helmet: [...HELMET_PARTS, ...HELMET_PARTS_EXTRA, ...HUMANOID_HELMET_PARTS, ...EVIL_HELMET_PARTS],
  chest: [...CHEST_PARTS, ...CHEST_PARTS_EXTRA, ...HUMANOID_CHEST_PARTS, ...EVIL_CHEST_PARTS],
  back: [...BACK_PARTS, ...BACK_PARTS_EXTRA, ...EVIL_BACK_PARTS],
  leftShoulder: [...SHOULDER_PARTS, ...SHOULDER_PARTS_EXTRA, ...HUMANOID_SHOULDER_PARTS, ...EVIL_SHOULDER_PARTS],
  rightShoulder: [...SHOULDER_PARTS, ...SHOULDER_PARTS_EXTRA, ...HUMANOID_SHOULDER_PARTS, ...EVIL_SHOULDER_PARTS],
  leftArm: [...ARM_PARTS, ...HUMANOID_ARM_PARTS],
  rightArm: [...ARM_PARTS, ...HUMANOID_ARM_PARTS],
  leftWeapon: [...WEAPON_PARTS, ...WEAPON_PARTS_EXTRA, ...HUMANOID_WEAPON_PARTS],
  rightWeapon: [...WEAPON_PARTS, ...WEAPON_PARTS_EXTRA, ...HUMANOID_WEAPON_PARTS],
  legs: [...LEG_PARTS, ...LEG_PARTS_EXTRA, ...HUMANOID_LEG_PARTS, ...EVIL_LEG_PARTS],
};

export function findPart(slot: ArmorSlot, id: string): ArmorPartDefinition | null {
  const list = ARMOR_PART_REGISTRY[slot];
  return list.find((p) => p.id === id) || null;
}
