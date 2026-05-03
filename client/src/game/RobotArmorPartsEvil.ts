import * as BABYLON from "@babylonjs/core";
import { ArmorBuildContext, ArmorPartDefinition } from "./RobotArmorParts";

function attach(meshes: BABYLON.Mesh[], parent: BABYLON.TransformNode): BABYLON.Mesh[] {
  for (const m of meshes) m.parent = parent;
  return meshes;
}

function studs(
  scene: BABYLON.Scene,
  name: string,
  layout: { x: number; y: number; z: number }[],
  diameter: number,
  mat: BABYLON.Material,
): BABYLON.Mesh[] {
  const out: BABYLON.Mesh[] = [];
  for (let i = 0; i < layout.length; i++) {
    const s = BABYLON.MeshBuilder.CreateSphere(`${name}_stud_${i}`, { diameter, segments: 6 }, scene);
    s.position.set(layout[i].x, layout[i].y, layout[i].z);
    s.material = mat;
    out.push(s);
  }
  return out;
}

export const EVIL_HELMET_PARTS: ArmorPartDefinition[] = [
  {
    id: "helmet_dread_horns", name: "Dread Skull Helm", slot: "helmet",
    build: (ctx: ArmorBuildContext) => {
      const meshes: BABYLON.Mesh[] = [];
      const r = 0.78;
      const skull = BABYLON.MeshBuilder.CreateSphere("helm_dread_skull", { diameter: r * 2.1, segments: 14 }, ctx.scene);
      skull.position.y = 0.05;
      skull.scaling.z = 1.05;
      skull.material = ctx.materials.black();
      meshes.push(skull);
      const jaw = BABYLON.MeshBuilder.CreateBox("helm_dread_jaw", { width: r * 1.3, height: r * 0.45, depth: r * 0.85 }, ctx.scene);
      jaw.position.set(0, -r * 0.45, r * 0.1);
      jaw.material = ctx.materials.metal();
      meshes.push(jaw);
      for (const sx of [-1, 1]) {
        const eye = BABYLON.MeshBuilder.CreateSphere(`helm_dread_eye_${sx}`, { diameter: 0.18, segments: 8 }, ctx.scene);
        eye.position.set(sx * r * 0.34, r * 0.08, r * 0.92);
        eye.material = ctx.materials.neon();
        meshes.push(eye);
        const horn = BABYLON.MeshBuilder.CreateCylinder(`helm_dread_horn_${sx}`, {
          height: r * 2.0, diameterTop: 0, diameterBottom: r * 0.42, tessellation: 10,
        }, ctx.scene);
        horn.position.set(sx * r * 0.85, r * 0.55, -r * 0.05);
        horn.rotation.z = sx * 0.85;
        horn.rotation.x = -0.25;
        horn.material = ctx.materials.metal();
        meshes.push(horn);
        const sub = BABYLON.MeshBuilder.CreateCylinder(`helm_dread_subhorn_${sx}`, {
          height: r * 0.7, diameterTop: 0, diameterBottom: r * 0.18, tessellation: 8,
        }, ctx.scene);
        sub.position.set(sx * r * 0.55, r * 1.1, -r * 0.1);
        sub.rotation.z = sx * 0.4;
        sub.material = ctx.materials.metal();
        meshes.push(sub);
      }
      const crownStudCount = 6;
      for (let i = 0; i < crownStudCount; i++) {
        const a = (i / (crownStudCount - 1) - 0.5) * Math.PI * 0.9;
        const stud = BABYLON.MeshBuilder.CreateCylinder(`helm_dread_crown_${i}`, {
          height: 0.32, diameterTop: 0, diameterBottom: 0.12, tessellation: 6,
        }, ctx.scene);
        stud.position.set(Math.sin(a) * r * 0.95, r * 0.85, -Math.cos(a) * r * 0.45);
        stud.rotation.x = -Math.cos(a) * 0.7;
        stud.rotation.z = Math.sin(a) * 0.7;
        stud.material = ctx.materials.metal();
        meshes.push(stud);
      }
      return attach(meshes, ctx.parent);
    },
  },
];

export const EVIL_CHEST_PARTS: ArmorPartDefinition[] = [
  {
    id: "chest_studded", name: "Studded Plate", slot: "chest",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const w = ctx.shoulderWidth * 0.82;
      const h = ctx.bodyHeight * 0.26;
      const plate = BABYLON.MeshBuilder.CreateBox("chest_studded_main", { width: w, height: h, depth: 0.55 }, ctx.scene);
      plate.material = ctx.materials.black();
      meshes.push(plate);
      const layout: { x: number; y: number; z: number }[] = [];
      const cols = 5; const rows = 4;
      for (let r2 = 0; r2 < rows; r2++) {
        for (let c = 0; c < cols; c++) {
          if (r2 === 1 && c === 2) continue;
          layout.push({
            x: (c - (cols - 1) / 2) * (w / cols) * 0.85,
            y: ((rows - 1) / 2 - r2) * (h / rows) * 0.75,
            z: 0.32,
          });
        }
      }
      meshes.push(...studs(ctx.scene, "chest_studded", layout, 0.14, ctx.materials.metal()));
      const heart = BABYLON.MeshBuilder.CreateCylinder("chest_studded_heart", {
        height: 0.06, diameter: 0.32, tessellation: 16,
      }, ctx.scene);
      heart.rotation.x = Math.PI / 2;
      heart.position.set(0, h * 0.1, 0.34);
      heart.material = ctx.materials.neon();
      meshes.push(heart);
      const ring = BABYLON.MeshBuilder.CreateTorus("chest_studded_ring", {
        diameter: 0.5, thickness: 0.05, tessellation: 18,
      }, ctx.scene);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, h * 0.1, 0.34);
      ring.material = ctx.materials.metal();
      meshes.push(ring);
      return attach(meshes, ctx.parent);
    },
  },
];

export const EVIL_SHOULDER_PARTS: ArmorPartDefinition[] = [
  {
    id: "shoulder_dread_spikes", name: "Dread Spike Pauldron", slot: "leftShoulder",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const pad = BABYLON.MeshBuilder.CreateSphere("shoulder_dread_pad", { diameter: 0.85, slice: 0.55, segments: 14 }, ctx.scene);
      pad.material = ctx.materials.black();
      meshes.push(pad);
      const trim = BABYLON.MeshBuilder.CreateTorus("shoulder_dread_trim", {
        diameter: 0.85, thickness: 0.08, tessellation: 18,
      }, ctx.scene);
      trim.position.y = -0.02;
      trim.material = ctx.materials.metal();
      meshes.push(trim);
      const bigSpikeCount = 3;
      for (let i = 0; i < bigSpikeCount; i++) {
        const a = (i / (bigSpikeCount - 1) - 0.5) * Math.PI * 0.7;
        const spike = BABYLON.MeshBuilder.CreateCylinder(`shoulder_dread_big_${i}`, {
          height: 0.85, diameterTop: 0, diameterBottom: 0.2, tessellation: 10,
        }, ctx.scene);
        spike.position.set(Math.cos(a) * 0.32, 0.4, Math.sin(a) * 0.32);
        spike.rotation.z = -Math.cos(a) * 0.65;
        spike.rotation.x = Math.sin(a) * 0.65;
        spike.material = ctx.materials.metal();
        meshes.push(spike);
      }
      const studCount = 8;
      for (let i = 0; i < studCount; i++) {
        const a = (i / studCount) * Math.PI * 2;
        const s = BABYLON.MeshBuilder.CreateSphere(`shoulder_dread_stud_${i}`, { diameter: 0.12, segments: 6 }, ctx.scene);
        s.position.set(Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42);
        s.material = ctx.materials.metal();
        meshes.push(s);
      }
      return attach(meshes, ctx.parent);
    },
  },
];

export const EVIL_BACK_PARTS: ArmorPartDefinition[] = [
  {
    id: "back_spine_spikes", name: "Spine Spikes", slot: "back",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const ridge = BABYLON.MeshBuilder.CreateBox("back_spine_ridge", { width: 0.35, height: 2.0, depth: 0.18 }, ctx.scene);
      ridge.position.set(0, -0.1, -0.4);
      ridge.material = ctx.materials.black();
      meshes.push(ridge);
      const spikeCount = 6;
      for (let i = 0; i < spikeCount; i++) {
        const t = i / (spikeCount - 1);
        const len = 0.45 + (1 - Math.abs(t - 0.5) * 2) * 0.55;
        const spike = BABYLON.MeshBuilder.CreateCylinder(`back_spine_spike_${i}`, {
          height: len, diameterTop: 0, diameterBottom: 0.18, tessellation: 8,
        }, ctx.scene);
        spike.position.set(0, 0.85 - t * 1.7, -0.55);
        spike.rotation.x = 0.45;
        spike.material = ctx.materials.metal();
        meshes.push(spike);
      }
      for (const sy of [0.7, 0.0, -0.7]) {
        for (const sx of [-1, 1]) {
          const stud = BABYLON.MeshBuilder.CreateSphere(`back_spine_stud_${sy}_${sx}`, { diameter: 0.13, segments: 6 }, ctx.scene);
          stud.position.set(sx * 0.25, sy, -0.4);
          stud.material = ctx.materials.metal();
          meshes.push(stud);
        }
      }
      return attach(meshes, ctx.parent);
    },
  },
];

export const EVIL_LEG_PARTS: ArmorPartDefinition[] = [
  {
    id: "legs_studded", name: "Studded Greaves", slot: "legs",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const thighLen = ctx.legLength * 0.5;
      const shinLen = ctx.legLength * 0.5;
      const thigh = BABYLON.MeshBuilder.CreateBox("legs_studded_thigh", { width: 0.5, height: thighLen * 0.92, depth: 0.5 }, ctx.scene);
      thigh.position.y = -thighLen * 0.5;
      thigh.material = ctx.materials.black();
      meshes.push(thigh);
      const shin = BABYLON.MeshBuilder.CreateBox("legs_studded_shin", { width: 0.45, height: shinLen * 0.92, depth: 0.45 }, ctx.scene);
      shin.position.y = -thighLen - shinLen * 0.5;
      shin.material = ctx.materials.black();
      meshes.push(shin);
      const knee = BABYLON.MeshBuilder.CreateSphere("legs_studded_knee", { diameter: 0.34, segments: 10 }, ctx.scene);
      knee.position.y = -thighLen;
      knee.material = ctx.materials.metal();
      meshes.push(knee);
      const kneeSpike = BABYLON.MeshBuilder.CreateCylinder("legs_studded_kneespike", {
        height: 0.4, diameterTop: 0, diameterBottom: 0.16, tessellation: 8,
      }, ctx.scene);
      kneeSpike.position.set(0, -thighLen + 0.1, 0.25);
      kneeSpike.rotation.x = -1.2;
      kneeSpike.material = ctx.materials.metal();
      meshes.push(kneeSpike);
      for (let i = 0; i < 3; i++) {
        const y = -thighLen - shinLen * (0.2 + i * 0.25);
        for (const sx of [-1, 1]) {
          const stud = BABYLON.MeshBuilder.CreateSphere(`legs_studded_stud_${i}_${sx}`, { diameter: 0.11, segments: 6 }, ctx.scene);
          stud.position.set(sx * 0.22, y, 0.24);
          stud.material = ctx.materials.metal();
          meshes.push(stud);
        }
      }
      return attach(meshes, ctx.parent);
    },
  },
];
