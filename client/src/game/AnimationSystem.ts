import * as BABYLON from "@babylonjs/core";

export type AnimationState =
  | "idle"
  | "running"
  | "sprinting"
  | "jumping"
  | "doubleJump"
  | "tripleJumpLaunch"
  | "flyingHover"
  | "lightPunch"
  | "heavySlam"
  | "dodgeRoll"
  | "edgeGrab"
  | "landing"
  | "dead";

export interface CharacterParts {
  root: BABYLON.TransformNode;
  head: BABYLON.TransformNode;
  torso: BABYLON.TransformNode;
  leftArm: BABYLON.TransformNode;
  rightArm: BABYLON.TransformNode;
  leftLeg: BABYLON.TransformNode;
  rightLeg: BABYLON.TransformNode;
}

interface AnimationBlend {
  current: AnimationState;
  previous: AnimationState;
  blendFactor: number;
  blendSpeed: number;
}

interface LimbPose {
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  positionOffsetX?: number;
  positionOffsetY?: number;
  positionOffsetZ?: number;
}

interface FullPose {
  head: LimbPose;
  torso: LimbPose;
  leftArm: LimbPose;
  rightArm: LimbPose;
  leftLeg: LimbPose;
  rightLeg: LimbPose;
}

export class AnimationSystem {
  private parts: CharacterParts | null = null;
  private ownsParts: boolean = false;
  private blend: AnimationBlend;
  private time: number = 0;
  private attackTimer: number = 0;
  private landingTimer: number = 0;
  private wasGrounded: boolean = true;

  constructor() {
    this.blend = {
      current: "idle",
      previous: "idle",
      blendFactor: 1,
      blendSpeed: 8,
    };
  }

  attachToParts(parts: CharacterParts): void {
    this.parts = parts;
    this.ownsParts = false;
  }

  createCharacterMesh(scene: BABYLON.Scene, parentMesh: BABYLON.Mesh): CharacterParts {
    this.ownsParts = true;
    const root = new BABYLON.TransformNode("charRoot", scene);
    root.parent = parentMesh;
    root.position = BABYLON.Vector3.Zero();

    const bodyMat = new BABYLON.StandardMaterial("bodyMat", scene);
    bodyMat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.9);
    bodyMat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    bodyMat.emissiveColor = new BABYLON.Color3(0.05, 0.15, 0.25);

    const limbMat = new BABYLON.StandardMaterial("limbMat", scene);
    limbMat.diffuseColor = new BABYLON.Color3(0.15, 0.45, 0.75);
    limbMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    limbMat.emissiveColor = new BABYLON.Color3(0.03, 0.1, 0.2);

    const headMat = new BABYLON.StandardMaterial("headMat", scene);
    headMat.diffuseColor = new BABYLON.Color3(0.25, 0.7, 1.0);
    headMat.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);
    headMat.emissiveColor = new BABYLON.Color3(0.1, 0.2, 0.35);

    const torso = BABYLON.MeshBuilder.CreateBox("charTorso", { width: 0.6, height: 0.7, depth: 0.35 }, scene);
    torso.material = bodyMat;
    torso.parent = root;
    torso.position = new BABYLON.Vector3(0, 0.15, 0);

    const head = BABYLON.MeshBuilder.CreateBox("charHead", { width: 0.35, height: 0.35, depth: 0.35 }, scene);
    head.material = headMat;
    head.parent = root;
    head.position = new BABYLON.Vector3(0, 0.7, 0);

    const visor = BABYLON.MeshBuilder.CreateBox("charVisor", { width: 0.3, height: 0.1, depth: 0.05 }, scene);
    const visorMat = new BABYLON.StandardMaterial("visorMat", scene);
    visorMat.diffuseColor = new BABYLON.Color3(0, 1, 0.8);
    visorMat.emissiveColor = new BABYLON.Color3(0, 0.8, 0.6);
    visorMat.alpha = 0.8;
    visor.material = visorMat;
    visor.parent = head;
    visor.position = new BABYLON.Vector3(0, 0.02, 0.18);

    const leftArm = BABYLON.MeshBuilder.CreateBox("charLeftArm", { width: 0.18, height: 0.55, depth: 0.18 }, scene);
    leftArm.material = limbMat;
    leftArm.parent = root;
    leftArm.position = new BABYLON.Vector3(-0.42, 0.1, 0);
    leftArm.setPivotPoint(new BABYLON.Vector3(0, 0.25, 0));

    const rightArm = BABYLON.MeshBuilder.CreateBox("charRightArm", { width: 0.18, height: 0.55, depth: 0.18 }, scene);
    rightArm.material = limbMat;
    rightArm.parent = root;
    rightArm.position = new BABYLON.Vector3(0.42, 0.1, 0);
    rightArm.setPivotPoint(new BABYLON.Vector3(0, 0.25, 0));

    const leftLeg = BABYLON.MeshBuilder.CreateBox("charLeftLeg", { width: 0.2, height: 0.55, depth: 0.2 }, scene);
    leftLeg.material = limbMat;
    leftLeg.parent = root;
    leftLeg.position = new BABYLON.Vector3(-0.15, -0.45, 0);
    leftLeg.setPivotPoint(new BABYLON.Vector3(0, 0.25, 0));

    const rightLeg = BABYLON.MeshBuilder.CreateBox("charRightLeg", { width: 0.2, height: 0.55, depth: 0.2 }, scene);
    rightLeg.material = limbMat;
    rightLeg.parent = root;
    rightLeg.position = new BABYLON.Vector3(0.15, -0.45, 0);
    rightLeg.setPivotPoint(new BABYLON.Vector3(0, 0.25, 0));

    this.parts = { root, head, torso, leftArm, rightArm, leftLeg, rightLeg };
    return this.parts;
  }

  setAnimationState(state: AnimationState): void {
    // Lock the body into the current attack pose for the duration of the
    // attack timer. Without this, the per-frame state mapping in
    // PlayerController (which returns "lightPunch" whenever player state ==
    // "attacking") would overwrite a freshly-triggered heavySlam, and the
    // visible animation would always look like a light punch.
    if (this.attackTimer > 0 && (this.blend.current === "lightPunch" || this.blend.current === "heavySlam")) {
      // Allow re-triggering an attack of the same type (combo) or upgrading
      // light → heavy, but block downgrades / unrelated states from
      // hijacking the animation mid-swing.
      if (state === this.blend.current) return;
      if (state === "lightPunch" && this.blend.current === "heavySlam") return;
      if (state !== "lightPunch" && state !== "heavySlam" && state !== "dead" && state !== "dodgeRoll") return;
    }

    if (state === this.blend.current) return;
    this.blend.previous = this.blend.current;
    this.blend.current = state;
    this.blend.blendFactor = 0;

    if (state === "lightPunch" || state === "heavySlam") {
      this.attackTimer = state === "lightPunch" ? 0.4 : 0.6;
    }
    if (state === "landing") {
      this.landingTimer = 0.25;
    }
  }

  notifyGroundedChange(isGrounded: boolean): void {
    if (isGrounded && !this.wasGrounded) {
      this.setAnimationState("landing");
    }
    this.wasGrounded = isGrounded;
  }

  update(dt: number): void {
    if (!this.parts) return;

    this.time += dt;

    if (this.blend.blendFactor < 1) {
      this.blend.blendFactor = Math.min(1, this.blend.blendFactor + this.blend.blendSpeed * dt);
    }

    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.setAnimationState("idle");
      }
    }

    if (this.landingTimer > 0) {
      this.landingTimer -= dt;
      if (this.landingTimer <= 0 && this.blend.current === "landing") {
        this.setAnimationState("idle");
      }
    }

    const currentPose = this.computePose(this.blend.current);
    const previousPose = this.computePose(this.blend.previous);
    const t = this.blend.blendFactor;

    this.applyBlendedPose(this.parts.head, currentPose.head, previousPose.head, t);
    this.applyBlendedPose(this.parts.torso, currentPose.torso, previousPose.torso, t);
    this.applyBlendedPose(this.parts.leftArm, currentPose.leftArm, previousPose.leftArm, t);
    this.applyBlendedPose(this.parts.rightArm, currentPose.rightArm, previousPose.rightArm, t);
    this.applyBlendedPose(this.parts.leftLeg, currentPose.leftLeg, previousPose.leftLeg, t);
    this.applyBlendedPose(this.parts.rightLeg, currentPose.rightLeg, previousPose.rightLeg, t);
  }

  private applyBlendedPose(node: BABYLON.TransformNode, current: LimbPose, previous: LimbPose, t: number): void {
    node.rotation.x = this.lerp(previous.rotationX, current.rotationX, t);
    node.rotation.y = this.lerp(previous.rotationY, current.rotationY, t);
    node.rotation.z = this.lerp(previous.rotationZ, current.rotationZ, t);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private zeroPose(): LimbPose {
    return { rotationX: 0, rotationY: 0, rotationZ: 0 };
  }

  private computePose(state: AnimationState): FullPose {
    switch (state) {
      case "idle":
        return this.idlePose();
      case "running":
        return this.runningPose(6);
      case "sprinting":
        return this.runningPose(9);
      case "jumping":
        return this.jumpingPose();
      case "doubleJump":
        return this.doubleJumpPose();
      case "tripleJumpLaunch":
        return this.tripleJumpLaunchPose();
      case "flyingHover":
        return this.flyingHoverPose();
      case "lightPunch":
        return this.lightPunchPose();
      case "heavySlam":
        return this.heavySlamPose();
      case "dodgeRoll":
        return this.dodgeRollPose();
      case "edgeGrab":
        return this.edgeGrabPose();
      case "landing":
        return this.landingPose();
      case "dead":
        return this.deadPose();
      default:
        return this.idlePose();
    }
  }

  private idlePose(): FullPose {
    const breathe = Math.sin(this.time * 2) * 0.03;
    const armSway = Math.sin(this.time * 1.5) * 0.05;
    return {
      head: { rotationX: breathe * 0.5, rotationY: 0, rotationZ: 0 },
      torso: { rotationX: breathe, rotationY: 0, rotationZ: 0 },
      leftArm: { rotationX: armSway, rotationY: 0, rotationZ: 0.08 },
      rightArm: { rotationX: -armSway, rotationY: 0, rotationZ: -0.08 },
      leftLeg: { rotationX: 0, rotationY: 0, rotationZ: 0 },
      rightLeg: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    };
  }

  private runningPose(speed: number): FullPose {
    const legSwing = Math.sin(this.time * speed) * 0.4;
    const armSwing = Math.sin(this.time * speed) * 0.28;
    const bobble = Math.sin(this.time * speed * 2) * 0.022;
    return {
      head: { rotationX: bobble, rotationY: 0, rotationZ: 0 },
      torso: { rotationX: 0.06, rotationY: Math.sin(this.time * speed) * 0.025, rotationZ: 0 },
      leftArm: { rotationX: armSwing, rotationY: 0, rotationZ: 0.08 },
      rightArm: { rotationX: -armSwing, rotationY: 0, rotationZ: -0.08 },
      leftLeg: { rotationX: -legSwing, rotationY: 0, rotationZ: 0 },
      rightLeg: { rotationX: legSwing, rotationY: 0, rotationZ: 0 },
    };
  }

  private jumpingPose(): FullPose {
    return {
      head: { rotationX: -0.15, rotationY: 0, rotationZ: 0 },
      torso: { rotationX: -0.1, rotationY: 0, rotationZ: 0 },
      leftArm: { rotationX: -0.8, rotationY: 0, rotationZ: 0.3 },
      rightArm: { rotationX: -0.8, rotationY: 0, rotationZ: -0.3 },
      leftLeg: { rotationX: 0.3, rotationY: 0, rotationZ: 0 },
      rightLeg: { rotationX: -0.2, rotationY: 0, rotationZ: 0 },
    };
  }

  private doubleJumpPose(): FullPose {
    const spin = Math.sin(this.time * 12) * 0.3;
    return {
      head: { rotationX: -0.2, rotationY: 0, rotationZ: 0 },
      torso: { rotationX: spin, rotationY: 0, rotationZ: 0 },
      leftArm: { rotationX: -1.2, rotationY: 0, rotationZ: 0.5 },
      rightArm: { rotationX: -1.2, rotationY: 0, rotationZ: -0.5 },
      leftLeg: { rotationX: 0.5, rotationY: 0, rotationZ: 0.1 },
      rightLeg: { rotationX: 0.5, rotationY: 0, rotationZ: -0.1 },
    };
  }

  private tripleJumpLaunchPose(): FullPose {
    const thrust = Math.sin(this.time * 15) * 0.15;
    return {
      head: { rotationX: -0.4, rotationY: 0, rotationZ: 0 },
      torso: { rotationX: -0.3 + thrust, rotationY: 0, rotationZ: 0 },
      leftArm: { rotationX: -2.5, rotationY: 0, rotationZ: 0.4 },
      rightArm: { rotationX: -2.5, rotationY: 0, rotationZ: -0.4 },
      leftLeg: { rotationX: 0.2, rotationY: 0, rotationZ: 0.15 },
      rightLeg: { rotationX: 0.2, rotationY: 0, rotationZ: -0.15 },
    };
  }

  private flyingHoverPose(): FullPose {
    const hover = Math.sin(this.time * 3) * 0.1;
    const armFloat = Math.sin(this.time * 2) * 0.15;
    return {
      head: { rotationX: hover * 0.5, rotationY: 0, rotationZ: 0 },
      torso: { rotationX: 0.15 + hover, rotationY: 0, rotationZ: 0 },
      leftArm: { rotationX: -0.5 + armFloat, rotationY: 0, rotationZ: 0.6 },
      rightArm: { rotationX: -0.5 - armFloat, rotationY: 0, rotationZ: -0.6 },
      leftLeg: { rotationX: 0.3, rotationY: 0, rotationZ: 0.1 },
      rightLeg: { rotationX: 0.3, rotationY: 0, rotationZ: -0.1 },
    };
  }

  private lightPunchPose(): FullPose {
    const punchPhase = Math.max(0, this.attackTimer / 0.4);
    const punchExtend = Math.sin(punchPhase * Math.PI);
    return {
      head: { rotationX: 0, rotationY: 0.2 * punchExtend, rotationZ: 0 },
      torso: { rotationX: 0.1 * punchExtend, rotationY: 0.3 * punchExtend, rotationZ: 0 },
      leftArm: { rotationX: 0.1, rotationY: 0, rotationZ: 0.1 },
      rightArm: { rotationX: -1.5 * punchExtend, rotationY: 0, rotationZ: -0.3 * punchExtend },
      leftLeg: { rotationX: 0.1 * punchExtend, rotationY: 0, rotationZ: 0 },
      rightLeg: { rotationX: -0.1 * punchExtend, rotationY: 0, rotationZ: 0 },
    };
  }

  private heavySlamPose(): FullPose {
    const slamPhase = Math.max(0, this.attackTimer / 0.6);
    const windUp = slamPhase > 0.5 ? (slamPhase - 0.5) * 2 : 0;
    const slamDown = slamPhase <= 0.5 ? slamPhase * 2 : 0;
    return {
      head: { rotationX: 0.3 * windUp - 0.4 * slamDown, rotationY: 0, rotationZ: 0 },
      torso: { rotationX: -0.3 * windUp + 0.5 * slamDown, rotationY: 0, rotationZ: 0 },
      leftArm: { rotationX: -2.5 * windUp + 1.5 * slamDown, rotationY: 0, rotationZ: 0.3 },
      rightArm: { rotationX: -2.5 * windUp + 1.5 * slamDown, rotationY: 0, rotationZ: -0.3 },
      leftLeg: { rotationX: 0.2 * slamDown, rotationY: 0, rotationZ: 0 },
      rightLeg: { rotationX: -0.2 * slamDown, rotationY: 0, rotationZ: 0 },
    };
  }

  private dodgeRollPose(): FullPose {
    const rollAngle = this.time * 12;
    const roll = Math.sin(rollAngle) * 1.5;
    return {
      head: { rotationX: roll * 0.5, rotationY: 0, rotationZ: 0 },
      torso: { rotationX: roll, rotationY: 0, rotationZ: 0 },
      leftArm: { rotationX: -1.0, rotationY: 0, rotationZ: 0.8 },
      rightArm: { rotationX: -1.0, rotationY: 0, rotationZ: -0.8 },
      leftLeg: { rotationX: 0.8, rotationY: 0, rotationZ: 0 },
      rightLeg: { rotationX: 0.8, rotationY: 0, rotationZ: 0 },
    };
  }

  private edgeGrabPose(): FullPose {
    const strain = Math.sin(this.time * 4) * 0.05;
    return {
      head: { rotationX: 0.3, rotationY: 0, rotationZ: 0 },
      torso: { rotationX: 0.1 + strain, rotationY: 0, rotationZ: 0 },
      leftArm: { rotationX: -2.8, rotationY: 0, rotationZ: 0.2 },
      rightArm: { rotationX: -2.8, rotationY: 0, rotationZ: -0.2 },
      leftLeg: { rotationX: 0.4, rotationY: 0, rotationZ: 0 },
      rightLeg: { rotationX: 0.2, rotationY: 0, rotationZ: 0 },
    };
  }

  private landingPose(): FullPose {
    const crunch = Math.max(0, this.landingTimer / 0.25);
    return {
      head: { rotationX: 0.2 * crunch, rotationY: 0, rotationZ: 0 },
      torso: { rotationX: 0.3 * crunch, rotationY: 0, rotationZ: 0 },
      leftArm: { rotationX: 0.3 * crunch, rotationY: 0, rotationZ: 0.4 * crunch },
      rightArm: { rotationX: 0.3 * crunch, rotationY: 0, rotationZ: -0.4 * crunch },
      leftLeg: { rotationX: -0.4 * crunch, rotationY: 0, rotationZ: 0 },
      rightLeg: { rotationX: -0.4 * crunch, rotationY: 0, rotationZ: 0 },
    };
  }

  private deadPose(): FullPose {
    return {
      head: { rotationX: 0.5, rotationY: 0.3, rotationZ: 0.2 },
      torso: { rotationX: 1.4, rotationY: 0, rotationZ: 0.3 },
      leftArm: { rotationX: 0.5, rotationY: 0, rotationZ: 1.2 },
      rightArm: { rotationX: 0.3, rotationY: 0, rotationZ: -0.8 },
      leftLeg: { rotationX: -0.2, rotationY: 0, rotationZ: 0.1 },
      rightLeg: { rotationX: 0.1, rotationY: 0, rotationZ: -0.2 },
    };
  }

  getCharacterParts(): CharacterParts | null {
    return this.parts;
  }

  getCurrentState(): AnimationState {
    return this.blend.current;
  }

  dispose(): void {
    if (this.parts && this.ownsParts) {
      this.parts.head.dispose();
      this.parts.torso.dispose();
      this.parts.leftArm.dispose();
      this.parts.rightArm.dispose();
      this.parts.leftLeg.dispose();
      this.parts.rightLeg.dispose();
      this.parts.root.dispose();
    }
    this.parts = null;
    this.ownsParts = false;
  }
}
