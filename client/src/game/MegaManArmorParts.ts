import * as BABYLON from "@babylonjs/core";
import { ArmorBuildContext, ArmorPartDefinition } from "./RobotArmorParts";

/**
 * Mega Man-inspired humanoid robot armor pack.
 *
 * Authored at the registry's "mech scale" (units assume the unscaled
 * humanoid frame, ~18 units tall). Once parented to limbs that live under
 * `HumanoidCharacter.visualRoot` they are uniformly shrunk by the
 * preset's `visualScale` (0.12 for the player), so the actual on-screen
 * helmet ends up roughly 25 cm wide on a 2 m character — proper
 * humanoid-robot proportions instead of the previous mech-titan silhouette.
 *
 * Each part follows the same construction rules as the base registry so
 * the existing `equipArmorSet` pipeline (palette materials, side mirroring
 * via `scaling.x = -1`, automatic anchor lookup) Just Works.
 */

function attach(meshes: BABYLON.Mesh[], parent: BABYLON.TransformNode): BABYLON.Mesh[] {
  for (const m of meshes) m.parent = parent;
  return meshes;
}

export const MEGAMAN_HELMET_PARTS: ArmorPartDefinition[] = [
  {
    id: "helmet_megaman",
    name: "Mega Crest Helm",
    slot: "helmet",
    build: (ctx: ArmorBuildContext) => {
      const meshes: BABYLON.Mesh[] = [];

      const dome = BABYLON.MeshBuilder.CreateSphere("mm_helm_dome", {
        diameter: 2.35,
        segments: 18,
      }, ctx.scene);
      dome.position.y = 0.05;
      dome.scaling.z = 1.05;
      dome.material = ctx.materials.metal();
      meshes.push(dome);

      const back = BABYLON.MeshBuilder.CreateSphere("mm_helm_back", {
        diameter: 2.45,
        segments: 18,
        slice: 0.55,
      }, ctx.scene);
      back.position.set(0, 0.1, -0.15);
      back.rotation.y = Math.PI;
      back.material = ctx.materials.metal();
      meshes.push(back);

      const crestBase = BABYLON.MeshBuilder.CreateBox("mm_helm_crest_base", {
        width: 1.55,
        height: 0.32,
        depth: 0.28,
      }, ctx.scene);
      crestBase.position.set(0, 0.55, 0.92);
      crestBase.material = ctx.materials.gold();
      meshes.push(crestBase);

      const crestFin = BABYLON.MeshBuilder.CreateCylinder("mm_helm_crest_fin", {
        height: 0.55,
        diameterTop: 0.12,
        diameterBottom: 0.55,
        tessellation: 4,
      }, ctx.scene);
      crestFin.position.set(0, 0.95, 0.95);
      crestFin.rotation.y = Math.PI / 4;
      crestFin.material = ctx.materials.gold();
      meshes.push(crestFin);

      const visor = BABYLON.MeshBuilder.CreateBox("mm_helm_visor", {
        width: 1.65,
        height: 0.22,
        depth: 0.08,
      }, ctx.scene);
      visor.position.set(0, 0.05, 1.08);
      visor.material = ctx.materials.neon();
      meshes.push(visor);

      for (const sx of [-1, 1]) {
        const ear = BABYLON.MeshBuilder.CreateCylinder(`mm_helm_ear_${sx}`, {
          height: 0.45,
          diameter: 0.78,
          tessellation: 18,
        }, ctx.scene);
        ear.rotation.z = Math.PI / 2;
        ear.position.set(sx * 1.05, -0.05, 0.05);
        ear.material = ctx.materials.metal();
        meshes.push(ear);

        const earCore = BABYLON.MeshBuilder.CreateCylinder(`mm_helm_ear_core_${sx}`, {
          height: 0.12,
          diameter: 0.42,
          tessellation: 18,
        }, ctx.scene);
        earCore.rotation.z = Math.PI / 2;
        earCore.position.set(sx * 1.25, -0.05, 0.05);
        earCore.material = ctx.materials.gold();
        meshes.push(earCore);

        const earGem = BABYLON.MeshBuilder.CreateSphere(`mm_helm_ear_gem_${sx}`, {
          diameter: 0.24,
        }, ctx.scene);
        earGem.position.set(sx * 1.32, -0.05, 0.05);
        earGem.material = ctx.materials.neon();
        meshes.push(earGem);
      }

      const chinGuard = BABYLON.MeshBuilder.CreateBox("mm_helm_chin", {
        width: 1.05,
        height: 0.32,
        depth: 0.55,
      }, ctx.scene);
      chinGuard.position.set(0, -0.62, 0.55);
      chinGuard.material = ctx.materials.metal();
      meshes.push(chinGuard);

      return attach(meshes, ctx.parent);
    },
  },
];

export const MEGAMAN_CHEST_PARTS: ArmorPartDefinition[] = [
  {
    id: "chest_megaman",
    name: "Mega Core Plate",
    slot: "chest",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const w = ctx.shoulderWidth * 0.78;
      const h = ctx.bodyHeight * 0.24;

      const plate = BABYLON.MeshBuilder.CreateBox("mm_chest_plate", {
        width: w,
        height: h,
        depth: 0.5,
      }, ctx.scene);
      plate.position.y = 0;
      plate.material = ctx.materials.metal();
      meshes.push(plate);

      const upperBand = BABYLON.MeshBuilder.CreateBox("mm_chest_band", {
        width: w * 1.02,
        height: h * 0.18,
        depth: 0.55,
      }, ctx.scene);
      upperBand.position.y = h * 0.5;
      upperBand.material = ctx.materials.ceramic();
      meshes.push(upperBand);

      for (const sx of [-1, 1]) {
        const vTrim = BABYLON.MeshBuilder.CreateBox(`mm_chest_v_${sx}`, {
          width: 0.18,
          height: h * 0.85,
          depth: 0.08,
        }, ctx.scene);
        vTrim.position.set(sx * w * 0.18, -h * 0.05, 0.3);
        vTrim.rotation.z = sx * 0.32;
        vTrim.material = ctx.materials.gold();
        meshes.push(vTrim);
      }

      const reactor = BABYLON.MeshBuilder.CreateCylinder("mm_chest_reactor", {
        height: 0.08,
        diameter: 0.55,
        tessellation: 24,
      }, ctx.scene);
      reactor.rotation.x = Math.PI / 2;
      reactor.position.set(0, h * 0.05, 0.32);
      reactor.material = ctx.materials.neon();
      meshes.push(reactor);

      const reactorRing = BABYLON.MeshBuilder.CreateTorus("mm_chest_reactor_ring", {
        diameter: 0.78,
        thickness: 0.08,
        tessellation: 24,
      }, ctx.scene);
      reactorRing.rotation.x = Math.PI / 2;
      reactorRing.position.set(0, h * 0.05, 0.32);
      reactorRing.material = ctx.materials.gold();
      meshes.push(reactorRing);

      const beltBuckle = BABYLON.MeshBuilder.CreateBox("mm_chest_belt", {
        width: w * 0.45,
        height: 0.18,
        depth: 0.55,
      }, ctx.scene);
      beltBuckle.position.set(0, -h * 0.55, 0);
      beltBuckle.material = ctx.materials.gold();
      meshes.push(beltBuckle);

      return attach(meshes, ctx.parent);
    },
  },
];

export const MEGAMAN_SHOULDER_PARTS: ArmorPartDefinition[] = [
  {
    id: "shoulder_megaman",
    name: "Mega Round Pad",
    slot: "leftShoulder",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];

      // Side-aware sign so the outward-facing accents (accent dot, stripe
      // tilt, pad inset) stay physically outboard on both shoulders.
      // `equipArmorSet` only mirrors right-side meshes via `scaling.x = -1`
      // (geometry flip), which leaves x-positions untouched — so we have
      // to handle handedness here in the local frame.
      const sx = ctx.side === "right" ? 1 : -1;

      const pad = BABYLON.MeshBuilder.CreateSphere("mm_shoulder_pad", {
        diameter: 1.55,
        slice: 0.55,
        segments: 18,
      }, ctx.scene);
      pad.position.set(sx * 0.12, 0.05, 0);
      pad.material = ctx.materials.metal();
      meshes.push(pad);

      const trim = BABYLON.MeshBuilder.CreateTorus("mm_shoulder_trim", {
        diameter: 1.55,
        thickness: 0.12,
        tessellation: 24,
      }, ctx.scene);
      trim.position.set(sx * 0.12, -0.02, 0);
      trim.material = ctx.materials.gold();
      meshes.push(trim);

      const accentDot = BABYLON.MeshBuilder.CreateSphere("mm_shoulder_dot", {
        diameter: 0.32,
      }, ctx.scene);
      accentDot.position.set(sx * 0.85, 0.25, 0);
      accentDot.material = ctx.materials.neon();
      meshes.push(accentDot);

      const stripe = BABYLON.MeshBuilder.CreateBox("mm_shoulder_stripe", {
        width: 1.1,
        height: 0.12,
        depth: 0.65,
      }, ctx.scene);
      stripe.position.set(sx * 0.15, 0.42, 0);
      stripe.rotation.z = sx * 0.15;
      stripe.material = ctx.materials.ceramic();
      meshes.push(stripe);

      return attach(meshes, ctx.parent);
    },
  },
];

export const MEGAMAN_ARM_PARTS: ArmorPartDefinition[] = [
  {
    id: "arm_megaman_glove",
    name: "Mega Glove",
    slot: "leftArm",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const foreLen = ctx.armLength * 0.5;

      const sleeve = BABYLON.MeshBuilder.CreateCylinder("mm_arm_sleeve", {
        height: foreLen * 0.85,
        diameter: 0.62,
        tessellation: 16,
      }, ctx.scene);
      sleeve.position.y = -ctx.armLength - foreLen * 0.05;
      sleeve.material = ctx.materials.ceramic();
      meshes.push(sleeve);

      const cuff = BABYLON.MeshBuilder.CreateTorus("mm_arm_cuff", {
        diameter: 0.7,
        thickness: 0.1,
        tessellation: 18,
      }, ctx.scene);
      cuff.position.y = -ctx.armLength - foreLen * 0.45;
      cuff.material = ctx.materials.gold();
      meshes.push(cuff);

      const fist = BABYLON.MeshBuilder.CreateSphere("mm_arm_fist", {
        diameter: 0.62,
      }, ctx.scene);
      fist.position.y = -ctx.armLength - foreLen * 0.55;
      fist.material = ctx.materials.metal();
      meshes.push(fist);

      return attach(meshes, ctx.parent);
    },
  },
];

export const MEGAMAN_WEAPON_PARTS: ArmorPartDefinition[] = [
  {
    id: "weapon_megaman_buster",
    name: "Mega Buster",
    slot: "rightWeapon",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const foreLen = ctx.armLength * 0.5;
      const yBase = -ctx.armLength - foreLen * 0.5;

      const shroud = BABYLON.MeshBuilder.CreateCylinder("mm_buster_shroud", {
        height: foreLen * 1.1,
        diameter: 0.95,
        tessellation: 18,
      }, ctx.scene);
      shroud.position.y = yBase;
      shroud.material = ctx.materials.metal();
      meshes.push(shroud);

      const accentRing = BABYLON.MeshBuilder.CreateTorus("mm_buster_ring", {
        diameter: 1.0,
        thickness: 0.1,
        tessellation: 24,
      }, ctx.scene);
      accentRing.position.y = yBase + foreLen * 0.15;
      accentRing.material = ctx.materials.gold();
      meshes.push(accentRing);

      const barrel = BABYLON.MeshBuilder.CreateCylinder("mm_buster_barrel", {
        height: foreLen * 0.55,
        diameterTop: 0.85,
        diameterBottom: 0.62,
        tessellation: 18,
      }, ctx.scene);
      barrel.position.y = yBase - foreLen * 0.7;
      barrel.material = ctx.materials.metal();
      meshes.push(barrel);

      const muzzleRing = BABYLON.MeshBuilder.CreateTorus("mm_buster_muzzle_ring", {
        diameter: 0.92,
        thickness: 0.1,
        tessellation: 24,
      }, ctx.scene);
      muzzleRing.position.y = yBase - foreLen;
      muzzleRing.material = ctx.materials.gold();
      meshes.push(muzzleRing);

      const muzzleCore = BABYLON.MeshBuilder.CreateSphere("mm_buster_muzzle_core", {
        diameter: 0.55,
      }, ctx.scene);
      muzzleCore.position.y = yBase - foreLen + 0.08;
      muzzleCore.material = ctx.materials.neon();
      meshes.push(muzzleCore);

      return attach(meshes, ctx.parent);
    },
  },
];

export const MEGAMAN_LEG_PARTS: ArmorPartDefinition[] = [
  {
    id: "legs_megaman",
    name: "Mega Boots",
    slot: "legs",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const thighLen = ctx.legLength * 0.5;
      const shinLen = ctx.legLength * 0.5;

      const thigh = BABYLON.MeshBuilder.CreateBox("mm_leg_thigh", {
        width: 0.55,
        height: thighLen * 0.92,
        depth: 0.55,
      }, ctx.scene);
      thigh.position.y = -thighLen * 0.5;
      thigh.material = ctx.materials.ceramic();
      meshes.push(thigh);

      const knee = BABYLON.MeshBuilder.CreateCylinder("mm_leg_knee", {
        height: 0.18,
        diameter: 0.62,
        tessellation: 20,
      }, ctx.scene);
      knee.rotation.x = Math.PI / 2;
      knee.position.y = -thighLen;
      knee.material = ctx.materials.gold();
      meshes.push(knee);

      const kneeDot = BABYLON.MeshBuilder.CreateSphere("mm_leg_knee_dot", {
        diameter: 0.22,
      }, ctx.scene);
      kneeDot.position.set(0, -thighLen, 0.32);
      kneeDot.material = ctx.materials.neon();
      meshes.push(kneeDot);

      const shin = BABYLON.MeshBuilder.CreateBox("mm_leg_shin", {
        width: 0.5,
        height: shinLen * 0.78,
        depth: 0.5,
      }, ctx.scene);
      shin.position.y = -thighLen - shinLen * 0.42;
      shin.material = ctx.materials.metal();
      meshes.push(shin);

      const bootFlare = BABYLON.MeshBuilder.CreateCylinder("mm_leg_flare", {
        height: 0.32,
        diameterTop: 0.55,
        diameterBottom: 0.95,
        tessellation: 18,
      }, ctx.scene);
      bootFlare.position.y = -thighLen - shinLen * 0.85;
      bootFlare.material = ctx.materials.metal();
      meshes.push(bootFlare);

      const bootBase = BABYLON.MeshBuilder.CreateBox("mm_leg_boot", {
        width: 0.95,
        height: 0.42,
        depth: 1.25,
      }, ctx.scene);
      bootBase.position.set(0, -thighLen - shinLen - 0.05, 0.18);
      bootBase.material = ctx.materials.metal();
      meshes.push(bootBase);

      const toeStripe = BABYLON.MeshBuilder.CreateBox("mm_leg_toe_stripe", {
        width: 0.96,
        height: 0.1,
        depth: 0.18,
      }, ctx.scene);
      toeStripe.position.set(0, -thighLen - shinLen + 0.05, 0.78);
      toeStripe.material = ctx.materials.gold();
      meshes.push(toeStripe);

      return attach(meshes, ctx.parent);
    },
  },
];
