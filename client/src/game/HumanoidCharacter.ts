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
  armorType?: "light" | "heavy" | "captain";
}

export class HumanoidCharacter {
  private root: BABYLON.TransformNode;
  private definition: HumanoidDefinition;
  private materials: Map<string, BABYLON.StandardMaterial> = new Map();

  constructor(scene: BABYLON.Scene, definition: HumanoidDefinition) {
    this.definition = definition;
    this.root = new BABYLON.TransformNode("humanoidRoot", scene);
    this.createMaterials(scene);
    this.buildBody(scene);
    if (definition.hasArmor) {
      this.buildArmor(scene);
    }
  }

  private createMaterials(scene: BABYLON.Scene): void {
    const skinMat = new BABYLON.StandardMaterial("skinMat", scene);
    skinMat.diffuse = this.definition.colors.skin;
    skinMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    this.materials.set("skin", skinMat);

    const hairMat = new BABYLON.StandardMaterial("hairMat", scene);
    hairMat.diffuse = this.definition.colors.hair;
    hairMat.emissiveColor = this.definition.colors.hair.scale(0.2);
    this.materials.set("hair", hairMat);

    const primaryMat = new BABYLON.StandardMaterial("primaryMat", scene);
    primaryMat.diffuse = this.definition.colors.primary;
    primaryMat.emissiveColor = this.definition.colors.primary.scale(0.1);
    this.materials.set("primary", primaryMat);

    const secondaryMat = new BABYLON.StandardMaterial("secondaryMat", scene);
    secondaryMat.diffuse = this.definition.colors.secondary;
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

    const torso = BABYLON.MeshBuilder.CreateCapsule("torso", {
      height: torsoHeight,
      radius: torsoRadius,
      tessellation: 12,
    }, scene);
    torso.position.y = chestY;
    torso.material = this.materials.get("primary")!;
    torso.parent = this.root;

    const head = BABYLON.MeshBuilder.CreateSphere("head", {
      diameterX: headScale * 0.9,
      diameterY: headScale,
      diameterZ: headScale * 0.9,
      segments: 16,
    }, scene);
    head.position.y = neckY + headScale * 0.6;
    head.material = this.materials.get("skin")!;
    head.parent = this.root;

    this.buildHair(scene, head.position.y);

    const leftUpperArm = BABYLON.MeshBuilder.CreateCapsule("leftUpperArm", {
      height: this.definition.armLength * 0.45,
      radius: 0.12,
      tessellation: 10,
    }, scene);
    leftUpperArm.rotation.z = Math.PI / 2;
    leftUpperArm.position = new BABYLON.Vector3(
      -this.definition.shoulderWidth * 0.5,
      chestY + 0.1,
      0
    );
    leftUpperArm.material = this.materials.get("primary")!;
    leftUpperArm.parent = this.root;

    const rightUpperArm = leftUpperArm.clone("rightUpperArm")!;
    rightUpperArm.position.x *= -1;
    rightUpperArm.parent = this.root;

    const leftForearm = BABYLON.MeshBuilder.CreateCapsule("leftForearm", {
      height: this.definition.armLength * 0.40,
      radius: 0.10,
      tessellation: 10,
    }, scene);
    leftForearm.rotation.z = Math.PI / 2;
    leftForearm.position = new BABYLON.Vector3(
      -this.definition.shoulderWidth * 0.5 - this.definition.armLength * 0.25,
      chestY - 0.2,
      0
    );
    leftForearm.material = this.materials.get("primary")!;
    leftForearm.parent = this.root;

    const rightForearm = leftForearm.clone("rightForearm")!;
    rightForearm.position.x *= -1;
    rightForearm.parent = this.root;

    const leftThigh = BABYLON.MeshBuilder.CreateCapsule("leftThigh", {
      height: this.definition.legLength * 0.48,
      radius: 0.14,
      tessellation: 10,
    }, scene);
    leftThigh.position = new BABYLON.Vector3(
      -this.definition.shoulderWidth * 0.18,
      pelvisY - this.definition.legLength * 0.22,
      0
    );
    leftThigh.material = this.materials.get("primary")!;
    leftThigh.parent = this.root;

    const rightThigh = leftThigh.clone("rightThigh")!;
    rightThigh.position.x *= -1;
    rightThigh.parent = this.root;

    const leftShin = BABYLON.MeshBuilder.CreateCapsule("leftShin", {
      height: this.definition.legLength * 0.42,
      radius: 0.11,
      tessellation: 10,
    }, scene);
    leftShin.position = new BABYLON.Vector3(
      -this.definition.shoulderWidth * 0.18,
      pelvisY - this.definition.legLength * 0.62,
      0
    );
    leftShin.material = this.materials.get("secondary")!;
    leftShin.parent = this.root;

    const rightShin = leftShin.clone("rightShin")!;
    rightShin.position.x *= -1;
    rightShin.parent = this.root;

    const leftFoot = BABYLON.MeshBuilder.CreateBox("leftFoot", {
      width: 0.18,
      height: 0.10,
      depth: 0.24,
    }, scene);
    leftFoot.position = new BABYLON.Vector3(
      -this.definition.shoulderWidth * 0.18,
      pelvisY - this.definition.legLength + 0.05,
      0.06
    );
    leftFoot.material = this.materials.get("secondary")!;
    leftFoot.parent = this.root;

    const rightFoot = leftFoot.clone("rightFoot")!;
    rightFoot.position.x *= -1;
    rightFoot.parent = this.root;
  }

  private buildHair(scene: BABYLON.Scene, headY: number): void {
    const hairGroup = new BABYLON.TransformNode("hairGroup", scene);
    hairGroup.parent = this.root;

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

    if (armorType === "light" || armorType === "heavy") {
      const leftShoulder = BABYLON.MeshBuilder.CreateBox("leftShoulderArmor", {
        width: 0.38,
        height: 0.30,
        depth: 0.40,
      }, scene);
      leftShoulder.position = new BABYLON.Vector3(
        -this.definition.shoulderWidth * 0.55,
        this.definition.height * 0.63,
        0
      );
      leftShoulder.material = matArmor;
      leftShoulder.parent = this.root;

      const rightShoulder = leftShoulder.clone("rightShoulderArmor")!;
      rightShoulder.position.x *= -1;
      rightShoulder.parent = this.root;
    }

    if (armorType === "heavy" || armorType === "captain") {
      const leftThighArmor = BABYLON.MeshBuilder.CreateBox("leftThighArmor", {
        width: 0.32,
        height: 0.42,
        depth: 0.28,
      }, scene);
      leftThighArmor.position = new BABYLON.Vector3(
        -this.definition.shoulderWidth * 0.18,
        this.definition.height * 0.35,
        0.05
      );
      leftThighArmor.material = matArmor;
      leftThighArmor.parent = this.root;

      const rightThighArmor = leftThighArmor.clone("rightThighArmor")!;
      rightThighArmor.position.x *= -1;
      rightThighArmor.parent = this.root;
    }

    const leftBoot = BABYLON.MeshBuilder.CreateBox("leftBoot", {
      width: 0.24,
      height: 0.18,
      depth: 0.28,
    }, scene);
    leftBoot.position = new BABYLON.Vector3(
      -this.definition.shoulderWidth * 0.18,
      this.definition.height * 0.05,
      0.08
    );
    leftBoot.material = matArmor;
    leftBoot.parent = this.root;

    const rightBoot = leftBoot.clone("rightBoot")!;
    rightBoot.position.x *= -1;
    rightBoot.parent = this.root;
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
