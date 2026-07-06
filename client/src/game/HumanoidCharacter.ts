import * as BABYLON from "@babylonjs/core";

export interface HumanoidDefinition {
  height: number;
  headScale: number;
  shoulderWidth: number;
  chestWidth: number;
  armLength: number;
  legLength: number;
  bodyType: "lean" | "athletic" | "heavy";
  colors: {
    primary: BABYLON.Color3;
    secondary: BABYLON.Color3;
    skin: BABYLON.Color3;
    hair: BABYLON.Color3;
  };
  hasArmor: boolean;
  armorType?: "light" | "heavy" | "captain" | "humanoid";
  /**
   * Final visual size multiplier applied to the rendered body mesh + armor.
   * The original presets were authored at ~18 unit "mech" scale, but the
   * player's collision capsule and camera assume a 2 m humanoid. Setting
   * `visualScale: 0.12` shrinks an 18-unit body to ~2.16 m so it actually
   * fits inside the capsule and reads as a proper humanoid robot.
   * Defaults to 1.0 for backward compatibility.
   */
  visualScale?: number;
}

export interface HumanoidLimbs {
  root: BABYLON.TransformNode;
  head: BABYLON.TransformNode;
  torso: BABYLON.TransformNode;
  leftArm: BABYLON.TransformNode;
  rightArm: BABYLON.TransformNode;
  leftLeg: BABYLON.TransformNode;
  rightLeg: BABYLON.TransformNode;
}

export class HumanoidCharacter {
  private root: BABYLON.TransformNode;
  /**
   * Visual sub-root that holds every rendered body / armor mesh. Parented
   * to `root` and uniformly scaled by `definition.visualScale`. Keeping
   * the visible mesh on a separate scaled node means callers (player
   * capsule, camera anchors, weapon attach points) can keep parenting to
   * the unscaled `root` without inheriting the shrink — so collision and
   * gameplay stay at world scale while the silhouette renders human-sized.
   */
  private visualRoot: BABYLON.TransformNode;
  private definition: HumanoidDefinition;
  private materials: Map<string, BABYLON.StandardMaterial> = new Map();

  private headMesh!: BABYLON.Mesh;
  private torsoMesh!: BABYLON.Mesh;
  private leftArmPivot!: BABYLON.TransformNode;
  private rightArmPivot!: BABYLON.TransformNode;
  private leftLegPivot!: BABYLON.TransformNode;
  private rightLegPivot!: BABYLON.TransformNode;

  constructor(scene: BABYLON.Scene, definition: HumanoidDefinition) {
    this.definition = definition;
    this.root = new BABYLON.TransformNode("humanoidRoot", scene);
    this.visualRoot = new BABYLON.TransformNode("humanoidVisual", scene);
    this.visualRoot.parent = this.root;
    const scale = definition.visualScale ?? 1.0;
    this.visualRoot.scaling.setAll(scale);
    this.createMaterials(scene);
    this.buildBody(scene);
    if (definition.hasArmor) {
      this.buildArmor(scene);
    }
  }

  public getAnimatableLimbs(): HumanoidLimbs {
    return {
      root: this.root,
      head: this.headMesh,
      torso: this.torsoMesh,
      leftArm: this.leftArmPivot,
      rightArm: this.rightArmPivot,
      leftLeg: this.leftLegPivot,
      rightLeg: this.rightLegPivot,
    };
  }

  private createMaterials(scene: BABYLON.Scene): void {
    const skinMat = new BABYLON.StandardMaterial("skinMat", scene);
    skinMat.diffuseColor = this.definition.colors.skin;
    skinMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    this.materials.set("skin", skinMat);

    const hairMat = new BABYLON.StandardMaterial("hairMat", scene);
    hairMat.diffuseColor = this.definition.colors.hair;
    hairMat.emissiveColor = this.definition.colors.hair.scale(0.2);
    this.materials.set("hair", hairMat);

    const primaryMat = new BABYLON.StandardMaterial("primaryMat", scene);
    primaryMat.diffuseColor = this.definition.colors.primary;
    primaryMat.emissiveColor = this.definition.colors.primary.scale(0.1);
    this.materials.set("primary", primaryMat);

    const secondaryMat = new BABYLON.StandardMaterial("secondaryMat", scene);
    secondaryMat.diffuseColor = this.definition.colors.secondary;
    secondaryMat.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    this.materials.set("secondary", secondaryMat);
  }

  private buildBody(scene: BABYLON.Scene): void {
    const h = this.definition.height;
    const torsoHeight = h * 0.28;
    const headScale = this.definition.headScale;

    const pelvisY = h * 0.48;
    const chestY = pelvisY + torsoHeight * 0.55;
    const neckY = pelvisY + torsoHeight;

    const torsoRadius = this.definition.chestWidth * 0.22;
    const armR = Math.max(0.12, this.definition.chestWidth * 0.06);
    const legR = Math.max(0.14, this.definition.chestWidth * 0.07);
    const upperArmLen = this.definition.armLength * 0.50;
    const forearmLen = this.definition.armLength * 0.50;
    const thighLen = this.definition.legLength * 0.50;
    const shinLen = this.definition.legLength * 0.50;

    const torso = BABYLON.MeshBuilder.CreateCapsule("torso", {
      height: torsoHeight,
      radius: torsoRadius,
      tessellation: 12,
    }, scene);
    torso.position.y = chestY;
    torso.material = this.materials.get("primary")!;
    torso.parent = this.visualRoot;
    this.torsoMesh = torso;

    const head = BABYLON.MeshBuilder.CreateSphere("head", {
      diameterX: headScale * 0.9,
      diameterY: headScale,
      diameterZ: headScale * 0.9,
      segments: 16,
    }, scene);
    head.position.y = neckY + headScale * 0.6;
    head.material = this.materials.get("skin")!;
    head.parent = this.visualRoot;
    this.headMesh = head;

    this.buildHair(scene, head.position.y);

    const shoulderY = chestY + torsoHeight * 0.4;
    const hipY = pelvisY - torsoRadius * 0.2;
    const shoulderX = this.definition.shoulderWidth * 0.45;
    const hipX = this.definition.shoulderWidth * 0.20;

    this.leftArmPivot = this.buildArmRig(
      scene, "leftArm", new BABYLON.Vector3(-shoulderX, shoulderY, 0),
      upperArmLen, forearmLen, armR
    );
    this.rightArmPivot = this.buildArmRig(
      scene, "rightArm", new BABYLON.Vector3(shoulderX, shoulderY, 0),
      upperArmLen, forearmLen, armR
    );

    this.leftLegPivot = this.buildLegRig(
      scene, "leftLeg", new BABYLON.Vector3(-hipX, hipY, 0),
      thighLen, shinLen, legR
    );
    this.rightLegPivot = this.buildLegRig(
      scene, "rightLeg", new BABYLON.Vector3(hipX, hipY, 0),
      thighLen, shinLen, legR
    );
  }

  private buildArmRig(
    scene: BABYLON.Scene, name: string, jointPos: BABYLON.Vector3,
    upperLen: number, foreLen: number, radius: number
  ): BABYLON.TransformNode {
    const pivot = new BABYLON.TransformNode(`${name}Pivot`, scene);
    pivot.position = jointPos.clone();
    pivot.parent = this.visualRoot;

    const upper = BABYLON.MeshBuilder.CreateCapsule(`${name}Upper`, {
      height: upperLen,
      radius: radius,
      tessellation: 10,
    }, scene);
    upper.position.y = -upperLen * 0.5;
    upper.material = this.materials.get("primary")!;
    upper.parent = pivot;

    const fore = BABYLON.MeshBuilder.CreateCapsule(`${name}Fore`, {
      height: foreLen,
      radius: radius * 0.85,
      tessellation: 10,
    }, scene);
    fore.position.y = -upperLen - foreLen * 0.5;
    fore.material = this.materials.get("primary")!;
    fore.parent = pivot;

    return pivot;
  }

  private buildLegRig(
    scene: BABYLON.Scene, name: string, jointPos: BABYLON.Vector3,
    thighLen: number, shinLen: number, radius: number
  ): BABYLON.TransformNode {
    const pivot = new BABYLON.TransformNode(`${name}Pivot`, scene);
    pivot.position = jointPos.clone();
    pivot.parent = this.visualRoot;

    const thigh = BABYLON.MeshBuilder.CreateCapsule(`${name}Thigh`, {
      height: thighLen,
      radius: radius,
      tessellation: 10,
    }, scene);
    thigh.position.y = -thighLen * 0.5;
    thigh.material = this.materials.get("primary")!;
    thigh.parent = pivot;

    const shin = BABYLON.MeshBuilder.CreateCapsule(`${name}Shin`, {
      height: shinLen,
      radius: radius * 0.85,
      tessellation: 10,
    }, scene);
    shin.position.y = -thighLen - shinLen * 0.5;
    shin.material = this.materials.get("secondary")!;
    shin.parent = pivot;

    const foot = BABYLON.MeshBuilder.CreateBox(`${name}Foot`, {
      width: radius * 1.6,
      height: 0.12,
      depth: radius * 2.4,
    }, scene);
    foot.position.y = -thighLen - shinLen - 0.05;
    foot.position.z = radius * 0.6;
    foot.material = this.materials.get("secondary")!;
    foot.parent = pivot;

    return pivot;
  }

  private buildHair(scene: BABYLON.Scene, headY: number): void {
    const hairGroup = new BABYLON.TransformNode("hairGroup", scene);
    hairGroup.parent = this.visualRoot;

    for (let i = 0; i < 12; i++) {
      const strand = BABYLON.MeshBuilder.CreatePlane(`hairStrand_${i}`, {
        width: 0.15,
        height: 0.45,
      }, scene);

      const angle = (i / 12) * Math.PI * 2;
      strand.position = new BABYLON.Vector3(
        Math.cos(angle) * 0.22,
        headY + 0.15,
        Math.sin(angle) * 0.22
      );

      strand.rotation.z = angle;
      strand.rotation.x = 0.3;
      strand.material = this.materials.get("hair")!;
      strand.parent = hairGroup;
    }
  }

  private buildArmor(scene: BABYLON.Scene): void {
    const armorType = this.definition.armorType || "light";
    const matArmor = this.materials.get("secondary")!;
    const matPrimary = this.materials.get("primary")!;
    const matGlow = this.materials.get("hair")!;

    const torsoHeight = this.definition.height * 0.28;
    const pelvisY = this.definition.height * 0.48;
    const chestY = pelvisY + torsoHeight * 0.55;
    const neckY = pelvisY + torsoHeight;
    const torsoRadius = this.definition.chestWidth * 0.22;
    const totalLegLen = this.definition.height * 0.45;
    const thighLen = totalLegLen * 0.5;
    const shinLen = totalLegLen * 0.5;

    if (armorType === "light" || armorType === "heavy") {
      const leftShoulder = BABYLON.MeshBuilder.CreateBox("leftShoulderArmor", {
        width: 0.38,
        height: 0.30,
        depth: 0.40,
      }, scene);
      leftShoulder.position = new BABYLON.Vector3(-0.05, 0.0, 0);
      leftShoulder.material = matArmor;
      leftShoulder.parent = this.leftArmPivot;

      const rightShoulder = leftShoulder.clone("rightShoulderArmor")!;
      rightShoulder.position = new BABYLON.Vector3(0.05, 0.0, 0);
      rightShoulder.parent = this.rightArmPivot;
    }

    if (armorType === "heavy" || armorType === "captain") {
      const leftThighArmor = BABYLON.MeshBuilder.CreateBox("leftThighArmor", {
        width: 0.32,
        height: 0.42,
        depth: 0.28,
      }, scene);
      leftThighArmor.position = new BABYLON.Vector3(0, -thighLen * 0.5, 0.05);
      leftThighArmor.material = matArmor;
      leftThighArmor.parent = this.leftLegPivot;

      const rightThighArmor = leftThighArmor.clone("rightThighArmor")!;
      rightThighArmor.position = new BABYLON.Vector3(0, -thighLen * 0.5, 0.05);
      rightThighArmor.parent = this.rightLegPivot;
    }

    const leftBoot = BABYLON.MeshBuilder.CreateBox("leftBoot", {
      width: 0.24,
      height: 0.18,
      depth: 0.28,
    }, scene);
    leftBoot.position = new BABYLON.Vector3(0, -(thighLen + shinLen) - 0.04, 0.08);
    leftBoot.material = matArmor;
    leftBoot.parent = this.leftLegPivot;

    const rightBoot = leftBoot.clone("rightBoot")!;
    rightBoot.position = new BABYLON.Vector3(0, -(thighLen + shinLen) - 0.04, 0.08);
    rightBoot.parent = this.rightLegPivot;

    if (armorType === "captain") {
      // ── Mega Man–style captain mecha ──────────────────────────────
      // Rebuilds the captain silhouette as a cel-shaded hero-robot:
      // helmet dome + faceplate + glowing eye visor + forehead power gem,
      // tapered chest with a reactor core + ab line, rounded pauldrons,
      // a right-arm buster cannon, and plated legs with glowing knees.
      // Every piece reuses the four shared humanoid materials (primary /
      // secondary / skin / glow) so the EnemySystem boss-variant tint loop
      // (which recolors each child mesh's StandardMaterial) still themes
      // captains inferno/plague/frost/storm/void. The player is unaffected
      // because it builds from the modular mm_* armor set (hasArmor:false).
      const hs = this.definition.headScale;
      const sw = this.definition.shoulderWidth;
      const al = this.definition.armLength;

      // ── Torso: tapered chest plate + flaring pecs + reactor + ab line ──
      const chestPlate = BABYLON.MeshBuilder.CreateBox("captainChestPlate", {
        width: sw * 0.58,
        height: torsoHeight * 0.82,
        depth: 0.44,
      }, scene);
      chestPlate.position.set(0, chestY + torsoHeight * 0.04, torsoRadius + 0.04);
      chestPlate.material = matArmor;
      chestPlate.parent = this.visualRoot;

      for (const side of [-1, 1]) {
        const pec = BABYLON.MeshBuilder.CreateBox(`captainPec_${side}`, {
          width: sw * 0.24,
          height: torsoHeight * 0.34,
          depth: 0.32,
        }, scene);
        pec.position.set(side * sw * 0.20, chestY + torsoHeight * 0.24, torsoRadius + 0.02);
        pec.rotation.z = side * 0.28;
        pec.material = matArmor;
        pec.parent = this.visualRoot;
      }

      const coreRing = BABYLON.MeshBuilder.CreateTorus("captainCoreRing", {
        diameter: sw * 0.30,
        thickness: 0.05,
        tessellation: 18,
      }, scene);
      coreRing.rotation.x = Math.PI / 2;
      coreRing.position.set(0, chestY + torsoHeight * 0.10, torsoRadius + 0.26);
      coreRing.material = matPrimary;
      coreRing.parent = this.visualRoot;

      const core = BABYLON.MeshBuilder.CreateCylinder("captainCore", {
        height: 0.12,
        diameter: sw * 0.20,
        tessellation: 16,
      }, scene);
      core.rotation.x = Math.PI / 2;
      core.position.set(0, chestY + torsoHeight * 0.10, torsoRadius + 0.30);
      core.material = matGlow;
      core.parent = this.visualRoot;

      const abLine = BABYLON.MeshBuilder.CreateBox("captainAbLine", {
        width: sw * 0.30,
        height: 0.06,
        depth: 0.06,
      }, scene);
      abLine.position.set(0, chestY - torsoHeight * 0.24, torsoRadius + 0.16);
      abLine.material = matGlow;
      abLine.parent = this.visualRoot;

      const collar = BABYLON.MeshBuilder.CreateBox("captainCollarGuard", {
        width: sw * 0.42,
        height: 0.22,
        depth: 0.38,
      }, scene);
      collar.position.set(0, neckY - 0.10, torsoRadius * 0.20);
      collar.material = matArmor;
      collar.parent = this.visualRoot;

      // ── Pelvis: centre crotch plate + hip guards + glowing belt ──
      const crotch = BABYLON.MeshBuilder.CreateBox("captainCrotchPlate", {
        width: sw * 0.20,
        height: torsoHeight * 0.30,
        depth: 0.30,
      }, scene);
      crotch.position.set(0, pelvisY - torsoRadius * 0.55, torsoRadius * 0.30);
      crotch.material = matPrimary;
      crotch.parent = this.visualRoot;

      for (const side of [-1, 1]) {
        const hipGuard = BABYLON.MeshBuilder.CreateBox(`captainHipGuard_${side}`, {
          width: sw * 0.20,
          height: torsoHeight * 0.34,
          depth: 0.34,
        }, scene);
        hipGuard.position.set(side * sw * 0.24, pelvisY - torsoRadius * 0.42, torsoRadius * 0.20);
        hipGuard.rotation.z = side * 0.12;
        hipGuard.material = matArmor;
        hipGuard.parent = this.visualRoot;
      }

      const belt = BABYLON.MeshBuilder.CreateBox("captainWarBelt", {
        width: sw * 0.44,
        height: 0.16,
        depth: 0.40,
      }, scene);
      belt.position.set(0, pelvisY - torsoRadius * 0.28, torsoRadius * 0.36);
      belt.material = matGlow;
      belt.parent = this.visualRoot;

      // ── Back thrusters (jet vents) ──
      for (const side of [-1, 1]) {
        const thruster = BABYLON.MeshBuilder.CreateCylinder(`captainThruster_${side}`, {
          height: torsoHeight * 0.6,
          diameterTop: 0.16,
          diameterBottom: 0.24,
          tessellation: 10,
        }, scene);
        thruster.position.set(side * sw * 0.20, chestY - torsoHeight * 0.05, -torsoRadius - 0.16);
        thruster.rotation.x = 0.18;
        thruster.material = matArmor;
        thruster.parent = this.visualRoot;

        const thrusterGlow = BABYLON.MeshBuilder.CreateDisc(`captainThrusterGlow_${side}`, {
          radius: 0.10,
          tessellation: 12,
        }, scene);
        thrusterGlow.position.set(side * sw * 0.20, chestY - torsoHeight * 0.34, -torsoRadius - 0.20);
        thrusterGlow.rotation.x = Math.PI / 2 + 0.18;
        thrusterGlow.material = matGlow;
        thrusterGlow.parent = this.visualRoot;
      }

      // ── Helmet: dome + faceplate + eye visor + forehead gem + crest + ear pods ──
      const helmet = BABYLON.MeshBuilder.CreateSphere("captainHelmet", {
        diameterX: hs * 1.10,
        diameterY: hs * 1.02,
        diameterZ: hs * 1.10,
        segments: 16,
      }, scene);
      helmet.position.set(0, hs * 0.10, -hs * 0.04);
      helmet.material = matArmor;
      helmet.parent = this.headMesh;

      const facePlate = BABYLON.MeshBuilder.CreateBox("captainFacePlate", {
        width: hs * 0.62,
        height: hs * 0.44,
        depth: hs * 0.30,
      }, scene);
      facePlate.position.set(0, -hs * 0.16, hs * 0.42);
      facePlate.material = matPrimary;
      facePlate.parent = this.headMesh;

      const visor = BABYLON.MeshBuilder.CreateBox("captainFaceVisor", {
        width: hs * 0.66,
        height: hs * 0.16,
        depth: 0.08,
      }, scene);
      visor.position.set(0, hs * 0.06, hs * 0.50);
      visor.material = matGlow;
      visor.parent = this.headMesh;

      const gemBezel = BABYLON.MeshBuilder.CreateCylinder("captainGemBezel", {
        height: 0.06,
        diameter: hs * 0.26,
        tessellation: 6,
      }, scene);
      gemBezel.rotation.x = Math.PI / 2;
      gemBezel.position.set(0, hs * 0.30, hs * 0.46);
      gemBezel.material = matPrimary;
      gemBezel.parent = this.headMesh;

      const gem = BABYLON.MeshBuilder.CreateCylinder("captainForeheadGem", {
        height: 0.08,
        diameter: hs * 0.18,
        tessellation: 6,
      }, scene);
      gem.rotation.x = Math.PI / 2;
      gem.position.set(0, hs * 0.30, hs * 0.50);
      gem.material = matGlow;
      gem.parent = this.headMesh;

      const crest = BABYLON.MeshBuilder.CreateBox("captainHeadCrest", {
        width: hs * 0.16,
        height: hs * 0.46,
        depth: hs * 0.60,
      }, scene);
      crest.position.set(0, hs * 0.46, -hs * 0.10);
      crest.rotation.x = 0.12;
      crest.material = matArmor;
      crest.parent = this.headMesh;

      for (const side of [-1, 1]) {
        const ear = BABYLON.MeshBuilder.CreateCylinder(`captainEarPod_${side}`, {
          height: 0.16,
          diameter: hs * 0.30,
          tessellation: 12,
        }, scene);
        ear.rotation.z = Math.PI / 2;
        ear.position.set(side * hs * 0.52, hs * 0.02, 0);
        ear.material = matArmor;
        ear.parent = this.headMesh;

        const earGlow = BABYLON.MeshBuilder.CreateCylinder(`captainEarGlow_${side}`, {
          height: 0.04,
          diameter: hs * 0.14,
          tessellation: 12,
        }, scene);
        earGlow.rotation.z = Math.PI / 2;
        earGlow.position.set(side * hs * 0.60, hs * 0.02, 0);
        earGlow.material = matGlow;
        earGlow.parent = this.headMesh;
      }

      // ── Shoulders + arms: rounded pauldrons, plated forearms, glowing joints ──
      for (const side of [-1, 1]) {
        const pivot = side < 0 ? this.leftArmPivot : this.rightArmPivot;

        const pauldron = BABYLON.MeshBuilder.CreateSphere(
          side < 0 ? "captainLeftPauldron" : "captainRightPauldron",
          { diameterX: 0.9, diameterY: 0.7, diameterZ: 0.85, segments: 12 },
          scene,
        );
        pauldron.position.set(side * 0.08, 0.10, 0);
        pauldron.material = matArmor;
        pauldron.parent = pivot;

        const pauldronGlow = BABYLON.MeshBuilder.CreateTorus(
          side < 0 ? "captainLeftPauldronGlow" : "captainRightPauldronGlow",
          { diameter: 0.5, thickness: 0.06, tessellation: 14 },
          scene,
        );
        pauldronGlow.position.set(side * 0.08, 0.10, 0);
        pauldronGlow.rotation.x = Math.PI / 2;
        pauldronGlow.material = matGlow;
        pauldronGlow.parent = pivot;

        const upperPlate = BABYLON.MeshBuilder.CreateBox(
          side < 0 ? "captainLeftUpperPlate" : "captainRightUpperPlate",
          { width: 0.34, height: al * 0.34, depth: 0.34 },
          scene,
        );
        upperPlate.position.set(0, -al * 0.28, 0.02);
        upperPlate.material = matPrimary;
        upperPlate.parent = pivot;

        const forearm = BABYLON.MeshBuilder.CreateBox(
          side < 0 ? "captainLeftForearmGuard" : "captainRightForearmGuard",
          { width: 0.38, height: al * 0.30, depth: 0.42 },
          scene,
        );
        forearm.position.set(0, -al * 0.70, 0.06);
        forearm.material = matArmor;
        forearm.parent = pivot;

        const elbow = BABYLON.MeshBuilder.CreateSphere(
          side < 0 ? "captainLeftElbow" : "captainRightElbow",
          { diameter: 0.20, segments: 8 },
          scene,
        );
        elbow.position.set(0, -al * 0.50, 0.06);
        elbow.material = matGlow;
        elbow.parent = pivot;
      }

      // Right arm buster cannon (iconic) — a barrel replacing the hand,
      // aligned down the arm axis (-y) with a glowing muzzle facing down,
      // so it sits at the wrist below the forearm gauntlet without clipping
      // back through the arm. Left arm keeps a fist.
      const buster = BABYLON.MeshBuilder.CreateCylinder("captainBusterHousing", {
        height: al * 0.34,
        diameterTop: 0.42,
        diameterBottom: 0.52,
        tessellation: 16,
      }, scene);
      buster.position.set(0, -al * 0.92, 0.06);
      buster.material = matArmor;
      buster.parent = this.rightArmPivot;

      const busterMuzzle = BABYLON.MeshBuilder.CreateTorus("captainBusterMuzzle", {
        diameter: 0.52,
        thickness: 0.08,
        tessellation: 16,
      }, scene);
      busterMuzzle.position.set(0, -al * 1.09, 0.06);
      busterMuzzle.material = matArmor;
      busterMuzzle.parent = this.rightArmPivot;

      const busterCore = BABYLON.MeshBuilder.CreateDisc("captainBusterCore", {
        radius: 0.22,
        tessellation: 16,
      }, scene);
      busterCore.rotation.x = Math.PI / 2;
      busterCore.position.set(0, -al * 1.10, 0.06);
      busterCore.material = matGlow;
      busterCore.parent = this.rightArmPivot;

      const leftFist = BABYLON.MeshBuilder.CreateSphere("captainLeftFist", {
        diameterX: 0.42, diameterY: 0.40, diameterZ: 0.46, segments: 10,
      }, scene);
      leftFist.position.set(0, -al * 0.96, 0.06);
      leftFist.material = matPrimary;
      leftFist.parent = this.leftArmPivot;

      // ── Legs: knee guards + glowing knees + shin plates + vents ──
      for (const side of [-1, 1]) {
        const pivot = side < 0 ? this.leftLegPivot : this.rightLegPivot;

        const knee = BABYLON.MeshBuilder.CreateBox(
          side < 0 ? "captainLeftKneeGuard" : "captainRightKneeGuard",
          { width: 0.40, height: 0.30, depth: 0.40 },
          scene,
        );
        knee.position.set(0, -thighLen, 0.12);
        knee.material = matArmor;
        knee.parent = pivot;

        const kneeGlow = BABYLON.MeshBuilder.CreateSphere(
          side < 0 ? "captainLeftKneeGlow" : "captainRightKneeGlow",
          { diameter: 0.16, segments: 8 },
          scene,
        );
        kneeGlow.position.set(0, -thighLen, 0.30);
        kneeGlow.material = matGlow;
        kneeGlow.parent = pivot;

        const shinPlate = BABYLON.MeshBuilder.CreateBox(
          side < 0 ? "captainLeftShinPlate" : "captainRightShinPlate",
          { width: 0.40, height: shinLen * 0.7, depth: 0.16 },
          scene,
        );
        shinPlate.position.set(0, -thighLen - shinLen * 0.5, 0.22);
        shinPlate.material = matPrimary;
        shinPlate.parent = pivot;

        const shinVent = BABYLON.MeshBuilder.CreateBox(
          side < 0 ? "captainLeftShinVent" : "captainRightShinVent",
          { width: 0.24, height: 0.06, depth: 0.06 },
          scene,
        );
        shinVent.position.set(0, -thighLen - shinLen * 0.35, 0.30);
        shinVent.material = matGlow;
        shinVent.parent = pivot;
      }
    }
  }

  public getRoot(): BABYLON.TransformNode {
    return this.root;
  }

  public getMeshes(): BABYLON.Mesh[] {
    const meshes: BABYLON.Mesh[] = [];
    this.root.getChildMeshes(false).forEach((mesh) => {
      if (mesh instanceof BABYLON.Mesh) meshes.push(mesh);
    });
    return meshes;
  }

  public dispose(): void {
    this.root.dispose();
    this.materials.forEach((mat) => mat.dispose());
  }
}
