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
