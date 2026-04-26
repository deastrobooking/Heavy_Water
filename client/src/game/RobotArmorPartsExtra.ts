import * as BABYLON from "@babylonjs/core";
import { ArmorBuildContext, ArmorPartDefinition } from "./RobotArmorParts";

function attach(meshes: BABYLON.Mesh[], parent: BABYLON.TransformNode): BABYLON.Mesh[] {
  for (const m of meshes) m.parent = parent;
  return meshes;
}

export const HELMET_PARTS_EXTRA: ArmorPartDefinition[] = [
  {
    id: "helmet_samurai", name: "Samurai Kabuto", slot: "helmet",
    build: (ctx: ArmorBuildContext) => {
      const meshes: BABYLON.Mesh[] = [];
      const dome = BABYLON.MeshBuilder.CreateSphere("helm_kab_dome", { diameter: 0.7, segments: 12 }, ctx.scene);
      dome.scaling.y = 0.85;
      dome.position.y = 0.05;
      dome.material = ctx.materials.metal();
      meshes.push(dome);
      const brim = BABYLON.MeshBuilder.CreateTorus("helm_kab_brim", { diameter: 0.85, thickness: 0.08, tessellation: 16 }, ctx.scene);
      brim.position.y = -0.1;
      brim.scaling.y = 0.4;
      brim.material = ctx.materials.gold();
      meshes.push(brim);
      const crest = BABYLON.MeshBuilder.CreateBox("helm_kab_crest", { width: 0.06, height: 0.4, depth: 0.4 }, ctx.scene);
      crest.position.y = 0.35;
      crest.material = ctx.materials.gold();
      meshes.push(crest);
      for (let i = -1; i <= 1; i += 2) {
        const horn = BABYLON.MeshBuilder.CreateCylinder(`helm_kab_horn_${i}`, {
          height: 0.45, diameterTop: 0.0, diameterBottom: 0.08, tessellation: 8,
        }, ctx.scene);
        horn.position.set(i * 0.28, 0.25, 0.05);
        horn.rotation.z = i * -0.55;
        horn.material = ctx.materials.gold();
        meshes.push(horn);
      }
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "helmet_oni", name: "Oni Mask", slot: "helmet",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const dome = BABYLON.MeshBuilder.CreateSphere("helm_oni_dome", { diameter: 0.65 }, ctx.scene);
      dome.position.y = 0.04;
      dome.material = ctx.materials.black();
      meshes.push(dome);
      const mask = BABYLON.MeshBuilder.CreateBox("helm_oni_mask", { width: 0.5, height: 0.32, depth: 0.18 }, ctx.scene);
      mask.position.set(0, -0.05, 0.28);
      mask.material = ctx.materials.ceramic();
      meshes.push(mask);
      for (let i = -1; i <= 1; i += 2) {
        const tusk = BABYLON.MeshBuilder.CreateCylinder(`helm_oni_tusk_${i}`, {
          height: 0.18, diameterTop: 0.0, diameterBottom: 0.05, tessellation: 6,
        }, ctx.scene);
        tusk.position.set(i * 0.12, -0.18, 0.36);
        tusk.material = ctx.materials.gold();
        meshes.push(tusk);
        const eye = BABYLON.MeshBuilder.CreateSphere(`helm_oni_eye_${i}`, { diameter: 0.08 }, ctx.scene);
        eye.position.set(i * 0.13, 0.02, 0.36);
        eye.material = ctx.materials.neon();
        meshes.push(eye);
      }
      const crown = BABYLON.MeshBuilder.CreateTorus("helm_oni_crown", { diameter: 0.7, thickness: 0.05, tessellation: 16 }, ctx.scene);
      crown.position.y = 0.28;
      crown.scaling.y = 0.3;
      crown.material = ctx.materials.gold();
      meshes.push(crown);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "helmet_knight", name: "Knight Helm", slot: "helmet",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const dome = BABYLON.MeshBuilder.CreateCylinder("helm_kn_dome", {
        height: 0.55, diameterTop: 0.5, diameterBottom: 0.62, tessellation: 16,
      }, ctx.scene);
      dome.position.y = 0.1;
      dome.material = ctx.materials.metal();
      meshes.push(dome);
      const top = BABYLON.MeshBuilder.CreateCylinder("helm_kn_top", {
        height: 0.12, diameterTop: 0.0, diameterBottom: 0.5, tessellation: 16,
      }, ctx.scene);
      top.position.y = 0.42;
      top.material = ctx.materials.metal();
      meshes.push(top);
      const slit = BABYLON.MeshBuilder.CreateBox("helm_kn_slit", { width: 0.4, height: 0.05, depth: 0.05 }, ctx.scene);
      slit.position.set(0, 0.1, 0.32);
      slit.material = ctx.materials.neon();
      meshes.push(slit);
      const plume = BABYLON.MeshBuilder.CreateBox("helm_kn_plume", { width: 0.06, height: 0.5, depth: 0.06 }, ctx.scene);
      plume.position.y = 0.7;
      plume.material = ctx.materials.gold();
      meshes.push(plume);
      return attach(meshes, ctx.parent);
    },
  },
];

export const CHEST_PARTS_EXTRA: ArmorPartDefinition[] = [
  {
    id: "chest_samurai", name: "Samurai Do", slot: "chest",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const torso = BABYLON.MeshBuilder.CreateBox("ch_sam_torso", { width: 1.05, height: 1.05, depth: 0.55 }, ctx.scene);
      torso.position.y = -0.1;
      torso.material = ctx.materials.ceramic();
      meshes.push(torso);
      for (let row = 0; row < 4; row++) {
        const slat = BABYLON.MeshBuilder.CreateBox(`ch_sam_slat_${row}`, {
          width: 0.95, height: 0.18, depth: 0.05,
        }, ctx.scene);
        slat.position.set(0, 0.2 - row * 0.22, 0.3);
        slat.material = ctx.materials.gold();
        meshes.push(slat);
      }
      const collar = BABYLON.MeshBuilder.CreateTorus("ch_sam_col", { diameter: 0.55, thickness: 0.07, tessellation: 16 }, ctx.scene);
      collar.position.y = 0.5;
      collar.scaling.y = 0.4;
      collar.material = ctx.materials.gold();
      meshes.push(collar);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "chest_ornate", name: "Ornate Cuirass", slot: "chest",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const torso = BABYLON.MeshBuilder.CreateSphere("ch_orn_torso", { diameter: 1.15, segments: 12 }, ctx.scene);
      torso.scaling.set(1.0, 0.95, 0.7);
      torso.position.y = 0.0;
      torso.material = ctx.materials.metal();
      meshes.push(torso);
      const center = BABYLON.MeshBuilder.CreateBox("ch_orn_center", { width: 0.18, height: 0.85, depth: 0.05 }, ctx.scene);
      center.position.set(0, 0.0, 0.42);
      center.material = ctx.materials.gold();
      meshes.push(center);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI - Math.PI / 2;
        const orn = BABYLON.MeshBuilder.CreateSphere(`ch_orn_jewel_${i}`, { diameter: 0.09 }, ctx.scene);
        orn.position.set(Math.cos(a) * 0.32, Math.sin(a) * 0.32 + 0.05, 0.43);
        orn.material = ctx.materials.neon();
        meshes.push(orn);
      }
      const trim = BABYLON.MeshBuilder.CreateTorus("ch_orn_trim", { diameter: 1.0, thickness: 0.06, tessellation: 20 }, ctx.scene);
      trim.position.y = 0.45;
      trim.scaling.set(1.0, 0.4, 0.7);
      trim.material = ctx.materials.gold();
      meshes.push(trim);
      return attach(meshes, ctx.parent);
    },
  },
];

export const SHOULDER_PARTS_EXTRA: ArmorPartDefinition[] = [
  {
    id: "shoulder_titan", name: "Titan Pauldron", slot: "leftShoulder",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const main = BABYLON.MeshBuilder.CreateSphere("sh_titan_main", { diameter: 0.8, segments: 12 }, ctx.scene);
      main.scaling.set(1.0, 0.7, 1.0);
      main.position.set(-0.05, 0.05, 0);
      main.material = ctx.materials.metal();
      meshes.push(main);
      const cap = BABYLON.MeshBuilder.CreateCylinder("sh_titan_cap", {
        height: 0.1, diameterTop: 0.55, diameterBottom: 0.7, tessellation: 16,
      }, ctx.scene);
      cap.position.set(-0.05, 0.18, 0);
      cap.material = ctx.materials.gold();
      meshes.push(cap);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const stud = BABYLON.MeshBuilder.CreateSphere(`sh_titan_stud_${i}`, { diameter: 0.1 }, ctx.scene);
        stud.position.set(-0.05 + Math.cos(a) * 0.32, 0.05, Math.sin(a) * 0.32);
        stud.material = ctx.materials.neon();
        meshes.push(stud);
      }
      return attach(meshes, ctx.parent);
    },
  },
];

export const WEAPON_PARTS_EXTRA: ArmorPartDefinition[] = [
  {
    id: "weapon_dual_blade", name: "Dual Blade", slot: "leftWeapon",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const armEnd = -ctx.armLength;
      const grip = BABYLON.MeshBuilder.CreateCylinder("wp_dual_grip", {
        height: 0.32, diameterTop: 0.1, diameterBottom: 0.1, tessellation: 8,
      }, ctx.scene);
      grip.position.set(0, armEnd - 0.15, 0);
      grip.material = ctx.materials.black();
      meshes.push(grip);
      for (const sgn of [-1, 1]) {
        const blade = BABYLON.MeshBuilder.CreateBox(`wp_dual_blade_${sgn}`, { width: 0.06, height: 0.95, depth: 0.16 }, ctx.scene);
        blade.position.set(0, armEnd - 0.15 + sgn * 0.55, 0);
        blade.material = ctx.materials.neon();
        meshes.push(blade);
        const tip = BABYLON.MeshBuilder.CreateCylinder(`wp_dual_tip_${sgn}`, {
          height: 0.18, diameterTop: 0.0, diameterBottom: 0.16, tessellation: 8,
        }, ctx.scene);
        tip.position.set(0, armEnd - 0.15 + sgn * 1.1, 0);
        tip.rotation.z = sgn > 0 ? 0 : Math.PI;
        tip.material = ctx.materials.neon();
        meshes.push(tip);
      }
      const guard = BABYLON.MeshBuilder.CreateTorus("wp_dual_guard", { diameter: 0.28, thickness: 0.05, tessellation: 12 }, ctx.scene);
      guard.position.set(0, armEnd - 0.15, 0);
      guard.scaling.y = 0.3;
      guard.material = ctx.materials.gold();
      meshes.push(guard);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "weapon_missile_pod", name: "Missile Pod", slot: "leftWeapon",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const armEnd = -ctx.armLength;
      const housing = BABYLON.MeshBuilder.CreateBox("wp_pod_housing", { width: 0.45, height: 0.4, depth: 0.55 }, ctx.scene);
      housing.position.set(0, armEnd - 0.1, 0.05);
      housing.material = ctx.materials.metal();
      meshes.push(housing);
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          const tube = BABYLON.MeshBuilder.CreateCylinder(`wp_pod_t_${r}_${c}`, {
            height: 0.5, diameterTop: 0.13, diameterBottom: 0.13, tessellation: 10,
          }, ctx.scene);
          tube.rotation.x = Math.PI / 2;
          tube.position.set((c - 0.5) * 0.18, armEnd - 0.1 + (r - 0.5) * 0.18, 0.32);
          tube.material = ctx.materials.black();
          meshes.push(tube);
          const cap = BABYLON.MeshBuilder.CreateCylinder(`wp_pod_cap_${r}_${c}`, {
            height: 0.05, diameterTop: 0.13, diameterBottom: 0.13, tessellation: 10,
          }, ctx.scene);
          cap.rotation.x = Math.PI / 2;
          cap.position.set((c - 0.5) * 0.18, armEnd - 0.1 + (r - 0.5) * 0.18, 0.55);
          cap.material = ctx.materials.neon();
          meshes.push(cap);
        }
      }
      return attach(meshes, ctx.parent);
    },
  },
];

export const LEG_PARTS_EXTRA: ArmorPartDefinition[] = [
  {
    id: "legs_mech_tank", name: "Mech Tank Legs", slot: "legs",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const thighLen = ctx.legLength * 0.5;
      const shinLen = ctx.legLength * 0.5;
      const hip = BABYLON.MeshBuilder.CreateBox("lg_mt_hip", { width: 0.7, height: 0.35, depth: 0.6 }, ctx.scene);
      hip.position.y = -0.15;
      hip.material = ctx.materials.metal();
      meshes.push(hip);
      const thigh = BABYLON.MeshBuilder.CreateCylinder("lg_mt_thigh", {
        height: thighLen * 0.85, diameterTop: 0.55, diameterBottom: 0.5, tessellation: 12,
      }, ctx.scene);
      thigh.position.y = -thighLen * 0.55;
      thigh.material = ctx.materials.metal();
      meshes.push(thigh);
      const piston = BABYLON.MeshBuilder.CreateCylinder("lg_mt_pist", {
        height: thighLen * 0.6, diameterTop: 0.1, diameterBottom: 0.1, tessellation: 8,
      }, ctx.scene);
      piston.position.set(0, -thighLen * 0.55, 0.32);
      piston.material = ctx.materials.gold();
      meshes.push(piston);
      const knee = BABYLON.MeshBuilder.CreateSphere("lg_mt_knee", { diameter: 0.5 }, ctx.scene);
      knee.position.y = -thighLen;
      knee.material = ctx.materials.metal();
      meshes.push(knee);
      const shin = BABYLON.MeshBuilder.CreateBox("lg_mt_shin", { width: 0.55, height: shinLen * 0.85, depth: 0.55 }, ctx.scene);
      shin.position.y = -thighLen - shinLen * 0.5;
      shin.material = ctx.materials.metal();
      meshes.push(shin);
      const foot = BABYLON.MeshBuilder.CreateBox("lg_mt_foot", { width: 0.7, height: 0.18, depth: 0.95 }, ctx.scene);
      foot.position.set(0, -thighLen - shinLen - 0.05, 0.18);
      foot.material = ctx.materials.black();
      meshes.push(foot);
      const toe = BABYLON.MeshBuilder.CreateBox("lg_mt_toe", { width: 0.65, height: 0.1, depth: 0.18 }, ctx.scene);
      toe.position.set(0, -thighLen - shinLen - 0.02, 0.65);
      toe.material = ctx.materials.gold();
      meshes.push(toe);
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "legs_hover_tread", name: "Hover Treads", slot: "legs",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const thighLen = ctx.legLength * 0.5;
      const shinLen = ctx.legLength * 0.5;
      const housing = BABYLON.MeshBuilder.CreateBox("lg_hv_house", { width: 0.45, height: thighLen * 0.7, depth: 0.45 }, ctx.scene);
      housing.position.y = -thighLen * 0.5;
      housing.material = ctx.materials.black();
      meshes.push(housing);
      const ringTop = BABYLON.MeshBuilder.CreateTorus("lg_hv_ring_t", { diameter: 0.55, thickness: 0.05, tessellation: 16 }, ctx.scene);
      ringTop.position.y = -thighLen - shinLen * 0.3;
      ringTop.material = ctx.materials.neon();
      meshes.push(ringTop);
      const cone = BABYLON.MeshBuilder.CreateCylinder("lg_hv_cone", {
        height: shinLen * 0.7, diameterTop: 0.7, diameterBottom: 0.3, tessellation: 16,
      }, ctx.scene);
      cone.position.y = -thighLen - shinLen * 0.65;
      cone.material = ctx.materials.metal();
      meshes.push(cone);
      const ringBot = BABYLON.MeshBuilder.CreateTorus("lg_hv_ring_b", { diameter: 0.85, thickness: 0.06, tessellation: 16 }, ctx.scene);
      ringBot.position.y = -thighLen - shinLen;
      ringBot.material = ctx.materials.neon();
      meshes.push(ringBot);
      const glow = BABYLON.MeshBuilder.CreateSphere("lg_hv_glow", { diameter: 0.35 }, ctx.scene);
      glow.position.y = -thighLen - shinLen - 0.1;
      glow.scaling.y = 0.3;
      glow.material = ctx.materials.neon();
      meshes.push(glow);
      return attach(meshes, ctx.parent);
    },
  },
];

export const BACK_PARTS_EXTRA: ArmorPartDefinition[] = [
  {
    id: "back_speaker", name: "Speaker Stack", slot: "back",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const chassis = BABYLON.MeshBuilder.CreateBox("bk_sp_ch", { width: 0.85, height: 1.0, depth: 0.3 }, ctx.scene);
      chassis.position.set(0, 0, -0.4);
      chassis.material = ctx.materials.black();
      meshes.push(chassis);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 2; c++) {
          const cone = BABYLON.MeshBuilder.CreateCylinder(`bk_sp_cone_${r}_${c}`, {
            height: 0.08, diameterTop: 0.18, diameterBottom: 0.22, tessellation: 12,
          }, ctx.scene);
          cone.rotation.x = Math.PI / 2;
          cone.position.set((c - 0.5) * 0.4, 0.35 - r * 0.32, -0.55);
          cone.material = ctx.materials.metal();
          meshes.push(cone);
          const center = BABYLON.MeshBuilder.CreateSphere(`bk_sp_dot_${r}_${c}`, { diameter: 0.08 }, ctx.scene);
          center.position.set((c - 0.5) * 0.4, 0.35 - r * 0.32, -0.6);
          center.material = ctx.materials.neon();
          meshes.push(center);
        }
      }
      return attach(meshes, ctx.parent);
    },
  },
  {
    id: "back_banner", name: "Banner Pole", slot: "back",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const pole = BABYLON.MeshBuilder.CreateCylinder("bk_bn_pole", {
        height: 1.6, diameterTop: 0.06, diameterBottom: 0.06, tessellation: 8,
      }, ctx.scene);
      pole.position.set(0, 0.4, -0.4);
      pole.material = ctx.materials.metal();
      meshes.push(pole);
      const banner = BABYLON.MeshBuilder.CreateBox("bk_bn_cloth", { width: 0.55, height: 0.85, depth: 0.04 }, ctx.scene);
      banner.position.set(0.32, 0.5, -0.4);
      banner.material = ctx.materials.neon();
      meshes.push(banner);
      const trim = BABYLON.MeshBuilder.CreateBox("bk_bn_trim", { width: 0.6, height: 0.06, depth: 0.05 }, ctx.scene);
      trim.position.set(0.32, 0.92, -0.4);
      trim.material = ctx.materials.gold();
      meshes.push(trim);
      const finial = BABYLON.MeshBuilder.CreateCylinder("bk_bn_finial", {
        height: 0.15, diameterTop: 0.0, diameterBottom: 0.12, tessellation: 8,
      }, ctx.scene);
      finial.position.set(0, 1.28, -0.4);
      finial.material = ctx.materials.gold();
      meshes.push(finial);
      return attach(meshes, ctx.parent);
    },
  },
];
