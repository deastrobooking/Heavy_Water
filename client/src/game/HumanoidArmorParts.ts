import * as BABYLON from "@babylonjs/core";
import { ArmorBuildContext, ArmorPartDefinition } from "./RobotArmorParts";

/**
 * Humanoid robot armor pack — the default frame for the player.
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

/**
 * Build a frustum-style tapered box (top face one width, bottom face another,
 * straight depth on both ends). Used for the torso piece to get the classic
 * "X" waist silhouette: pass `topW > botW` (or vice versa) and the side
 * faces will lean inward.
 *
 * Bottom face is at y = -h/2, top face at y = +h/2 — same as a regular
 * MeshBuilder.CreateBox so it's a drop-in replacement.
 */
function createTaperedBox(
  scene: BABYLON.Scene,
  name: string,
  topW: number,
  botW: number,
  h: number,
  depth: number,
): BABYLON.Mesh {
  const hwB = botW / 2;
  const hwT = topW / 2;
  const hh = h / 2;
  const hd = depth / 2;

  // 8 corners — bottom uses botW, top uses topW.
  const positions = [
    -hwB, -hh, -hd,  hwB, -hh, -hd,  hwB, -hh,  hd, -hwB, -hh,  hd, // 0..3 bottom
    -hwT,  hh, -hd,  hwT,  hh, -hd,  hwT,  hh,  hd, -hwT,  hh,  hd, // 4..7 top
  ];
  const indices = [
    0, 2, 1,  0, 3, 2,   // bottom (CCW from outside / below)
    4, 5, 6,  4, 6, 7,   // top    (CCW from outside / above)
    0, 1, 5,  0, 5, 4,   // back  (-z)
    1, 2, 6,  1, 6, 5,   // right (+x)
    2, 3, 7,  2, 7, 6,   // front (+z)
    3, 0, 4,  3, 4, 7,   // left  (-x)
  ];

  const normals: number[] = [];
  BABYLON.VertexData.ComputeNormals(positions, indices, normals);

  const vd = new BABYLON.VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;

  const mesh = new BABYLON.Mesh(name, scene);
  vd.applyToMesh(mesh);
  return mesh;
}

/**
 * Build a wedge-style robot boot. Bottom face is flat (y=0), top is
 * higher at the heel than at the toe (toeH < heelH), the toe top edge is
 * inset (toeW < 1) for a tapered front, and the toe face overhangs the
 * ankle origin forward by `toeOver`. Origin = ankle attachment point at
 * the back of the boot, so the heel sits behind the leg and the toe
 * extends forward — matches how the leg pivot is positioned above.
 */
interface BootConfig {
  toeH: number;     // height at front-top edge
  heelH: number;    // height at back-top edge
  w: number;        // total width
  len: number;      // total length heel→toe
  toeOver: number;  // how far the toe overhangs the ankle origin (forward)
  toeW: number;     // top width at the toe as fraction of `w` (0..1)
}
function createWedgeBoot(
  scene: BABYLON.Scene,
  name: string,
  c: BootConfig,
): BABYLON.Mesh {
  const hw = c.w / 2;
  const hlen = c.len / 2;
  const twH = hw * c.toeW;
  const toe_z = hlen + c.toeOver;
  const heel_z = -hlen;

  const positions = [
    // Bottom flat face (y = 0)
    -hw,      0,       toe_z,   // 0
     hw,      0,       toe_z,   // 1
     hw,      0,       heel_z,  // 2
    -hw,      0,       heel_z,  // 3
    // Top wedge face — toe low + tapered, heel high + full width
    -twH,     c.toeH,  toe_z,   // 4
     twH,     c.toeH,  toe_z,   // 5
     hw,      c.heelH, heel_z,  // 6
    -hw,      c.heelH, heel_z,  // 7
  ];
  const indices = [
    2, 1, 0,  3, 2, 0,   // bottom
    4, 5, 6,  4, 6, 7,   // top wedge
    0, 1, 5,  0, 5, 4,   // toe face
    1, 2, 6,  1, 6, 5,   // right
    2, 3, 7,  2, 7, 6,   // heel face
    3, 0, 4,  3, 4, 7,   // left
  ];

  const normals: number[] = [];
  BABYLON.VertexData.ComputeNormals(positions, indices, normals);

  const vd = new BABYLON.VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;

  const mesh = new BABYLON.Mesh(name, scene);
  vd.applyToMesh(mesh);
  return mesh;
}

export const HUMANOID_HELMET_PARTS: ArmorPartDefinition[] = [
  {
    id: "helmet_humanoid",
    name: "Humanoid Crest Helm",
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

export const HUMANOID_CHEST_PARTS: ArmorPartDefinition[] = [
  {
    id: "chest_humanoid",
    name: "Humanoid Core Plate",
    slot: "chest",
    build: (ctx) => {
      const meshes: BABYLON.Mesh[] = [];
      const w = ctx.shoulderWidth * 0.78;
      const h = ctx.bodyHeight * 0.24;

      // Tapered chest frustum — top face full chest width, bottom face
      // tucked in at the waist (waist_ratio ≈ 0.78). This gives the
      // classic "X" silhouette where the shoulders read wide and the
      // waist reads narrow, instead of the prior straight-edged crate.
      const waistRatio = 0.78;
      const plate = createTaperedBox(
        ctx.scene,
        "mm_chest_plate",
        w,                // top width = shoulder width
        w * waistRatio,   // bottom width = waist
        h,
        0.5,
      );
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

export const HUMANOID_SHOULDER_PARTS: ArmorPartDefinition[] = [
  {
    id: "shoulder_humanoid",
    name: "Humanoid Round Pad",
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

export const HUMANOID_ARM_PARTS: ArmorPartDefinition[] = [
  {
    id: "arm_humanoid_glove",
    name: "Humanoid Glove",
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

export const HUMANOID_WEAPON_PARTS: ArmorPartDefinition[] = [
  {
    id: "weapon_humanoid_blaster",
    name: "Humanoid Blaster",
    slot: "rightWeapon",
    build: (ctx) => {
      // Three-piece blaster following the canvas spec:
      //   1. Housing block at the wrist attach point
      //   2. Tapered cylinder barrel that flares out toward the muzzle
      //      (diameter at the muzzle end > diameter at the housing end)
      //   3. Flat muzzle disc at the very tip + a glowing core sphere
      //
      // The arm rig hangs down the local -y axis from the shoulder, so
      // "forward" along the barrel is also -y here. A Babylon cylinder's
      // diameterBottom is at -y, so for a flared muzzle (wider at the
      // far/distal end) we want diameterBottom > diameterTop.
      const meshes: BABYLON.Mesh[] = [];
      const foreLen = ctx.armLength * 0.5;
      const yWrist = -ctx.armLength - foreLen * 0.05;

      // 1. Housing block — chunky box at wrist, slightly proud forward.
      const housing = BABYLON.MeshBuilder.CreateBox("mm_blaster_housing", {
        width: 0.85,
        height: 0.78,
        depth: 0.95,
      }, ctx.scene);
      housing.position.y = yWrist;
      housing.material = ctx.materials.metal();
      meshes.push(housing);

      // Gold accent stripe wrapping the housing.
      const housingTrim = BABYLON.MeshBuilder.CreateBox("mm_blaster_housing_trim", {
        width: 0.88,
        height: 0.16,
        depth: 0.98,
      }, ctx.scene);
      housingTrim.position.y = yWrist + 0.18;
      housingTrim.material = ctx.materials.gold();
      meshes.push(housingTrim);

      // 2. Barrel — tapered cylinder, flared at the muzzle end (-y).
      const barrelLen = foreLen * 1.05;
      const barrel = BABYLON.MeshBuilder.CreateCylinder("mm_blaster_barrel", {
        height: barrelLen,
        diameterTop: 0.62,     // narrow at housing end
        diameterBottom: 0.92,  // flared toward muzzle
        tessellation: 18,
      }, ctx.scene);
      barrel.position.y = yWrist - 0.34 - barrelLen * 0.5;
      barrel.material = ctx.materials.metal();
      meshes.push(barrel);

      // Mid-barrel accent ring (gold) for visual punctuation.
      const accentRing = BABYLON.MeshBuilder.CreateTorus("mm_blaster_ring", {
        diameter: 0.86,
        thickness: 0.1,
        tessellation: 24,
      }, ctx.scene);
      accentRing.position.y = yWrist - 0.34 - barrelLen * 0.35;
      accentRing.material = ctx.materials.gold();
      meshes.push(accentRing);

      // 3. Flat muzzle disc — thin cylinder oriented across the barrel
      // axis at the very tip, slightly larger than the barrel's flare.
      const muzzleTipY = yWrist - 0.34 - barrelLen;
      const muzzleDisc = BABYLON.MeshBuilder.CreateCylinder("mm_blaster_muzzle_disc", {
        diameterTop: 1.05,
        diameterBottom: 1.05,
        height: 0.1,
        tessellation: 24,
      }, ctx.scene);
      muzzleDisc.position.y = muzzleTipY + 0.05;
      muzzleDisc.material = ctx.materials.gold();
      meshes.push(muzzleDisc);

      // Glowing energy core just inside the muzzle.
      const muzzleCore = BABYLON.MeshBuilder.CreateSphere("mm_blaster_muzzle_core", {
        diameter: 0.6,
      }, ctx.scene);
      muzzleCore.position.y = muzzleTipY + 0.18;
      muzzleCore.material = ctx.materials.neon();
      meshes.push(muzzleCore);

      return attach(meshes, ctx.parent);
    },
  },
];

export const HUMANOID_LEG_PARTS: ArmorPartDefinition[] = [
  {
    id: "legs_humanoid",
    name: "Humanoid Boots",
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

      // Wedge-style boot — heel high, toe low, tapered toe top edge,
      // and a forward toe overhang. Bottom of the wedge sits flush with
      // the ground at y = -thighLen - shinLen - 0.42 (the previous boot
      // base height) so the visual ground contact is unchanged.
      const bootGroundY = -thighLen - shinLen - 0.26;
      const boot = createWedgeBoot(ctx.scene, "mm_leg_boot", {
        toeH: 0.22,
        heelH: 0.5,
        w: 0.95,
        len: 1.05,
        toeOver: 0.22,
        toeW: 0.82,
      });
      boot.position.set(0, bootGroundY, 0.05);
      boot.material = ctx.materials.metal();
      meshes.push(boot);

      // Ankle connector — short cylinder bridging the wedge top down
      // from the shin/flare. Sits on top of the heel region so the
      // wedge reads as a sculpted boot instead of a floating shoe.
      const ankle = BABYLON.MeshBuilder.CreateCylinder("mm_leg_ankle", {
        diameter: 0.48,
        height: 0.22,
        tessellation: 14,
      }, ctx.scene);
      ankle.position.set(0, bootGroundY + 0.5 + 0.11, -0.12);
      ankle.material = ctx.materials.gold();
      meshes.push(ankle);

      // Gold toe stripe across the front of the wedge.
      const toeStripe = BABYLON.MeshBuilder.CreateBox("mm_leg_toe_stripe", {
        width: 0.78,
        height: 0.08,
        depth: 0.16,
      }, ctx.scene);
      toeStripe.position.set(0, bootGroundY + 0.06, 0.05 + 1.05 / 2 + 0.22 - 0.08);
      toeStripe.material = ctx.materials.gold();
      meshes.push(toeStripe);

      return attach(meshes, ctx.parent);
    },
  },
];
