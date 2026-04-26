import * as BABYLON from "@babylonjs/core";
import {
  RobotDescriptor, RobotStyle, validateStyle,
  RobotThemeId, ROBOT_THEMES, applyTheme, createDefaultStyle,
} from "./RobotDesigner";

type MatKey = "primary" | "secondary" | "emissive";

export class RobotFactory {
  private scene: BABYLON.Scene;
  private mats = new Map<string, BABYLON.StandardMaterial>();

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
  }

  private getMat(key: MatKey, style: RobotStyle): BABYLON.StandardMaterial {
    const c =
      key === "primary" ? style.colors.primary :
      key === "secondary" ? style.colors.secondary :
      style.colors.emissive;

    const id = `robotMat_${key}_${c.r.toFixed(2)}_${c.g.toFixed(2)}_${c.b.toFixed(2)}`;
    const cached = this.mats.get(id);
    if (cached) return cached;

    const m = new BABYLON.StandardMaterial(id, this.scene);
    if (key === "emissive") {
      m.emissiveColor = c;
      m.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    } else {
      m.diffuseColor = c;
      m.emissiveColor = c.scale(0.15);
      m.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    }
    this.mats.set(id, m);
    return m;
  }

  createRobot(desc: RobotDescriptor, position: BABYLON.Vector3): BABYLON.TransformNode {
    const style = validateStyle(desc.style);

    const root = new BABYLON.TransformNode(`robot_${desc.name}_${Date.now()}`, this.scene);
    root.position.copyFrom(position);
    root.scaling.setAll(style.scale);

    const primaryParts: BABYLON.Mesh[] = [];
    const secondaryParts: BABYLON.Mesh[] = [];
    const emissiveParts: BABYLON.Mesh[] = [];

    const torsoY = style.legLength + style.torsoHeight * 0.5;

    const torso = BABYLON.MeshBuilder.CreateBox("t", {
      width: style.torsoWidth,
      height: style.torsoHeight,
      depth: style.torsoDepth,
    }, this.scene);
    torso.position.y = torsoY;
    primaryParts.push(torso);

    const chestPlate = BABYLON.MeshBuilder.CreateBox("cp", {
      width: style.torsoWidth * 0.95,
      height: style.torsoHeight * 0.55,
      depth: style.torsoDepth * 0.15,
    }, this.scene);
    chestPlate.position.set(0, torsoY + style.torsoHeight * 0.1, style.torsoDepth * 0.55);
    secondaryParts.push(chestPlate);

    if (style.extraPlating > 0) {
      const sidePanel = BABYLON.MeshBuilder.CreateBox("sp", {
        width: style.torsoWidth * 0.12,
        height: style.torsoHeight * 0.7,
        depth: style.torsoDepth * 0.9,
      }, this.scene);
      sidePanel.position.set(style.torsoWidth * 0.55, torsoY, 0);
      secondaryParts.push(sidePanel);

      const sidePanel2 = sidePanel.clone("sp2");
      sidePanel2.position.x = -style.torsoWidth * 0.55;
      secondaryParts.push(sidePanel2);
    }

    if (style.extraPlating > 1) {
      const backPlate = BABYLON.MeshBuilder.CreateBox("bp", {
        width: style.torsoWidth * 0.8,
        height: style.torsoHeight * 0.4,
        depth: style.torsoDepth * 0.12,
      }, this.scene);
      backPlate.position.set(0, torsoY + style.torsoHeight * 0.2, -style.torsoDepth * 0.55);
      secondaryParts.push(backPlate);
    }

    if (style.extraPlating > 2) {
      const abPlate = BABYLON.MeshBuilder.CreateBox("ab", {
        width: style.torsoWidth * 0.6,
        height: style.torsoHeight * 0.25,
        depth: style.torsoDepth * 0.12,
      }, this.scene);
      abPlate.position.set(0, torsoY - style.torsoHeight * 0.25, style.torsoDepth * 0.55);
      secondaryParts.push(abPlate);
    }

    let head: BABYLON.Mesh;
    const headY = torsoY + style.torsoHeight * 0.65;
    switch (style.headShape) {
      case "sphere":
        head = BABYLON.MeshBuilder.CreateSphere("h", { diameter: style.headSize, segments: 10 }, this.scene);
        break;
      case "cylinder":
        head = BABYLON.MeshBuilder.CreateCylinder("h", { height: style.headSize * 0.8, diameter: style.headSize * 0.9, tessellation: 8 }, this.scene);
        break;
      case "cone":
        head = BABYLON.MeshBuilder.CreateCylinder("h", { height: style.headSize, diameterTop: 0, diameterBottom: style.headSize * 0.9, tessellation: 8 }, this.scene);
        break;
      default:
        head = BABYLON.MeshBuilder.CreateBox("h", { width: style.headSize * 0.9, height: style.headSize * 0.9, depth: style.headSize * 0.9 }, this.scene);
    }
    head.position.set(0, headY, 0);
    primaryParts.push(head);

    if (style.hasVisor) {
      let visor: BABYLON.Mesh;
      switch (style.visorStyle) {
        case "round":
          visor = BABYLON.MeshBuilder.CreateSphere("v", { diameter: style.headSize * 0.35, segments: 8 }, this.scene);
          visor.position.set(0, headY + 0.05, style.headSize * 0.45);
          break;
        case "full":
          visor = BABYLON.MeshBuilder.CreateBox("v", { width: style.headSize * 0.85, height: style.headSize * 0.45, depth: style.headSize * 0.12 }, this.scene);
          visor.position.set(0, headY + 0.02, style.headSize * 0.48);
          break;
        default:
          visor = BABYLON.MeshBuilder.CreateBox("v", { width: style.headSize * 0.75, height: style.headSize * 0.2, depth: style.headSize * 0.12 }, this.scene);
          visor.position.set(0, headY + 0.05, style.headSize * 0.5);
      }
      emissiveParts.push(visor);
    }

    if (style.hasHorns) {
      const makeHorn = (side: number) => {
        const horn = BABYLON.MeshBuilder.CreateCylinder("horn", {
          height: style.hornLength,
          diameterTop: 0,
          diameterBottom: style.headSize * 0.15,
          tessellation: 6,
        }, this.scene);
        horn.position.set(side * style.headSize * 0.35, headY + style.headSize * 0.4, 0);
        horn.rotation.z = -side * 0.4;
        secondaryParts.push(horn);
      };
      makeHorn(-1);
      makeHorn(1);
    }

    if (style.hasAntennae) {
      const makeAntenna = (side: number) => {
        const antenna = BABYLON.MeshBuilder.CreateCylinder("ant", {
          height: style.antennaLength,
          diameter: 0.04,
          tessellation: 6,
        }, this.scene);
        antenna.position.set(side * style.headSize * 0.25, headY + style.headSize * 0.4 + style.antennaLength * 0.5, 0);
        secondaryParts.push(antenna);

        const tip = BABYLON.MeshBuilder.CreateSphere("antTip", { diameter: 0.08, segments: 6 }, this.scene);
        tip.position.set(side * style.headSize * 0.25, headY + style.headSize * 0.4 + style.antennaLength, 0);
        emissiveParts.push(tip);
      };
      makeAntenna(-1);
      makeAntenna(1);
    }

    const shoulderY = torsoY + style.torsoHeight * 0.35;
    const shoulderX = style.torsoWidth * 0.6;

    const makeShoulder = (x: number) => {
      const pad = BABYLON.MeshBuilder.CreateBox("sh", {
        width: style.shoulderPadSize,
        height: style.shoulderPadSize * 0.6,
        depth: style.shoulderPadSize * 0.8,
      }, this.scene);
      pad.position.set(x, shoulderY, 0);
      secondaryParts.push(pad);
    };
    makeShoulder(-shoulderX);
    makeShoulder(shoulderX);

    const armAnchorY = shoulderY - style.shoulderPadSize * 0.2;
    const buildArm = (side: -1 | 1) => {
      let upper: BABYLON.Mesh;
      let fore: BABYLON.Mesh;

      if (style.armStyle === "box") {
        upper = BABYLON.MeshBuilder.CreateBox("ua", {
          width: style.armLength * 0.55,
          height: style.armThickness,
          depth: style.armThickness * 1.1,
        }, this.scene);
        fore = BABYLON.MeshBuilder.CreateBox("fa", {
          width: style.armLength * 0.5,
          height: style.armThickness * 0.9,
          depth: style.armThickness,
        }, this.scene);
      } else if (style.armStyle === "tapered") {
        upper = BABYLON.MeshBuilder.CreateCylinder("ua", {
          height: style.armLength * 0.55,
          diameterTop: style.armThickness * 0.7,
          diameterBottom: style.armThickness,
          tessellation: 8,
        }, this.scene);
        upper.rotation.z = Math.PI / 2;
        fore = BABYLON.MeshBuilder.CreateCylinder("fa", {
          height: style.armLength * 0.5,
          diameterTop: style.armThickness * 0.5,
          diameterBottom: style.armThickness * 0.8,
          tessellation: 8,
        }, this.scene);
        fore.rotation.z = Math.PI / 2;
      } else {
        upper = BABYLON.MeshBuilder.CreateCylinder("ua", {
          height: style.armLength * 0.55,
          diameter: style.armThickness,
          tessellation: 8,
        }, this.scene);
        upper.rotation.z = Math.PI / 2;
        fore = BABYLON.MeshBuilder.CreateCylinder("fa", {
          height: style.armLength * 0.5,
          diameter: style.armThickness * 0.9,
          tessellation: 8,
        }, this.scene);
        fore.rotation.z = Math.PI / 2;
      }

      upper.position.set(side * (shoulderX + style.armLength * 0.25), armAnchorY, 0);
      primaryParts.push(upper);

      fore.position.set(side * (shoulderX + style.armLength * 0.70), armAnchorY - style.armThickness * 0.15, 0);
      primaryParts.push(fore);

      const hand = BABYLON.MeshBuilder.CreateBox("hd", {
        width: style.armThickness * 0.7,
        height: style.armThickness * 0.5,
        depth: style.armThickness * 0.9,
      }, this.scene);
      hand.position.set(side * (shoulderX + style.armLength * 0.95), armAnchorY - style.armThickness * 0.15, 0);
      secondaryParts.push(hand);

      if (style.hasCannons) {
        const cannon = BABYLON.MeshBuilder.CreateCylinder("cn", {
          height: style.cannonSize,
          diameter: style.armThickness * 0.55,
          tessellation: 10,
        }, this.scene);
        cannon.rotation.z = Math.PI / 2;
        cannon.position.set(
          side * (shoulderX + style.armLength * 0.95 + style.cannonSize * 0.5),
          armAnchorY - style.armThickness * 0.15,
          style.armThickness * 0.4
        );
        secondaryParts.push(cannon);

        const muzzle = BABYLON.MeshBuilder.CreateSphere("mz", { diameter: style.armThickness * 0.3, segments: 6 }, this.scene);
        muzzle.position.set(
          side * (shoulderX + style.armLength * 0.95 + style.cannonSize),
          armAnchorY - style.armThickness * 0.15,
          style.armThickness * 0.4
        );
        emissiveParts.push(muzzle);
      }
    };
    buildArm(-1);
    buildArm(1);

    const hipY = style.legLength;
    const hip = BABYLON.MeshBuilder.CreateBox("hp", {
      width: style.torsoWidth * 0.9,
      height: style.hipPadSize * 0.35,
      depth: style.torsoDepth * 0.7,
    }, this.scene);
    hip.position.set(0, hipY + style.hipPadSize * 0.2, 0);
    secondaryParts.push(hip);

    const legOffsetX = style.torsoWidth * 0.22;
    const buildLeg = (side: -1 | 1) => {
      if (style.legStyle === "hoverpads") {
        const pad = BABYLON.MeshBuilder.CreateCylinder("lp", {
          height: 0.2,
          diameter: style.legThickness * 2,
          tessellation: 12,
        }, this.scene);
        pad.position.set(side * legOffsetX, 0.1, 0);
        primaryParts.push(pad);

        const glow = BABYLON.MeshBuilder.CreateCylinder("lg", {
          height: 0.05,
          diameter: style.legThickness * 1.5,
          tessellation: 12,
        }, this.scene);
        glow.position.set(side * legOffsetX, 0.02, 0);
        emissiveParts.push(glow);

        const strut = BABYLON.MeshBuilder.CreateCylinder("ls", {
          height: style.legLength * 0.8,
          diameter: style.legThickness * 0.4,
          tessellation: 6,
        }, this.scene);
        strut.position.set(side * legOffsetX, style.legLength * 0.45, 0);
        primaryParts.push(strut);
      } else if (style.legStyle === "digitigrade") {
        const thigh = BABYLON.MeshBuilder.CreateBox("th", {
          width: style.legThickness,
          height: style.legLength * 0.45,
          depth: style.legThickness * 1.1,
        }, this.scene);
        thigh.position.set(side * legOffsetX, style.legLength * 0.72, 0);
        primaryParts.push(thigh);

        const shin = BABYLON.MeshBuilder.CreateBox("sn", {
          width: style.legThickness * 0.8,
          height: style.legLength * 0.4,
          depth: style.legThickness * 0.9,
        }, this.scene);
        shin.position.set(side * legOffsetX, style.legLength * 0.30, style.legThickness * 0.3);
        shin.rotation.x = 0.3;
        primaryParts.push(shin);

        const foot = BABYLON.MeshBuilder.CreateBox("ft", {
          width: style.legThickness * 0.9,
          height: style.legThickness * 0.3,
          depth: style.legThickness * 2.5,
        }, this.scene);
        foot.position.set(side * legOffsetX, style.legThickness * 0.15, style.legThickness * 1.0);
        secondaryParts.push(foot);
      } else {
        const thigh = BABYLON.MeshBuilder.CreateBox("th", {
          width: style.legThickness,
          height: style.legLength * 0.55,
          depth: style.legThickness * 1.1,
        }, this.scene);
        thigh.position.set(side * legOffsetX, style.legLength * 0.65, 0);
        primaryParts.push(thigh);

        const shin = BABYLON.MeshBuilder.CreateBox("sn", {
          width: style.legThickness * 0.9,
          height: style.legLength * 0.55,
          depth: style.legThickness * 1.0,
        }, this.scene);
        shin.position.set(side * legOffsetX, style.legLength * 0.20, 0);
        primaryParts.push(shin);

        const foot = BABYLON.MeshBuilder.CreateBox("ft", {
          width: style.legThickness * 1.2,
          height: style.legThickness * 0.35,
          depth: style.legThickness * 2.0,
        }, this.scene);
        foot.position.set(side * legOffsetX, style.legThickness * 0.18, style.legThickness * 0.6);
        secondaryParts.push(foot);
      }
    };
    buildLeg(-1);
    buildLeg(1);

    if (style.hasBackpack) {
      const pack = BABYLON.MeshBuilder.CreateBox("bk", {
        width: style.torsoWidth * 0.65 * (style.backpackSize / 0.65),
        height: style.torsoHeight * 0.55,
        depth: style.torsoDepth * 0.35,
      }, this.scene);
      pack.position.set(0, torsoY, -style.torsoDepth * 0.65);
      secondaryParts.push(pack);

      const coreGlow = BABYLON.MeshBuilder.CreateSphere("cg", { diameter: style.torsoWidth * 0.18, segments: 8 }, this.scene);
      coreGlow.position.set(0, torsoY, -style.torsoDepth * 0.85);
      emissiveParts.push(coreGlow);
    }

    if (style.hasWings) {
      const wingY = torsoY + style.torsoHeight * 0.25;
      const wingZ = -style.torsoDepth * 0.55;

      const makeWing = (side: -1 | 1) => {
        const wing = BABYLON.MeshBuilder.CreateBox("wg", {
          width: style.torsoWidth * 0.15,
          height: style.torsoHeight * 0.5,
          depth: style.wingSpan,
        }, this.scene);
        wing.position.set(side * (style.torsoWidth * 0.75), wingY, wingZ);
        wing.rotation.y = side * style.wingAngle;
        secondaryParts.push(wing);

        const wingTip = BABYLON.MeshBuilder.CreateSphere("wt", { diameter: 0.12, segments: 6 }, this.scene);
        wingTip.position.set(side * (style.torsoWidth * 0.75), wingY, wingZ - style.wingSpan * 0.5);
        emissiveParts.push(wingTip);
      };
      makeWing(-1);
      makeWing(1);
    }

    if (style.hasTail) {
      for (let s = 0; s < style.tailSegments; s++) {
        const segSize = style.legThickness * 0.5 * (1 - s / (style.tailSegments + 1) * 0.6);
        const seg = BABYLON.MeshBuilder.CreateSphere("tl", { diameter: segSize, segments: 6 }, this.scene);
        const t = (s + 1) / style.tailSegments;
        seg.position.set(0, hipY - t * style.tailLength * 0.3, -style.torsoDepth * 0.5 - t * style.tailLength);
        if (s === style.tailSegments - 1) {
          emissiveParts.push(seg);
        } else {
          secondaryParts.push(seg);
        }
      }
    }

    if (style.hasShield) {
      const shield = BABYLON.MeshBuilder.CreateDisc("sh", {
        radius: style.shieldSize * 0.5,
        tessellation: 12,
      }, this.scene);
      shield.position.set(-shoulderX - style.armLength * 0.5, armAnchorY, style.armThickness);
      shield.rotation.y = Math.PI / 2;
      secondaryParts.push(shield);

      const shieldGlow = BABYLON.MeshBuilder.CreateDisc("sg", {
        radius: style.shieldSize * 0.35,
        tessellation: 10,
      }, this.scene);
      shieldGlow.position.set(-shoulderX - style.armLength * 0.5 - 0.02, armAnchorY, style.armThickness);
      shieldGlow.rotation.y = Math.PI / 2;
      emissiveParts.push(shieldGlow);
    }

    const coreGlow = BABYLON.MeshBuilder.CreateSphere("core", { diameter: style.torsoWidth * 0.15, segments: 8 }, this.scene);
    coreGlow.position.set(0, torsoY + style.torsoHeight * 0.15, style.torsoDepth * 0.55);
    emissiveParts.push(coreGlow);

    if (style.hasArmCannon) {
      const sides: Array<-1 | 1> = style.hasArmCannon === "both"
        ? [-1, 1]
        : style.hasArmCannon === "left" ? [-1] : [1];
      const cs = style.armCannonScale ?? 1.0;
      for (const side of sides) {
        const baseX = side * (shoulderX + style.armLength * 0.95);
        const cannonLen = style.armThickness * 2.6 * cs;
        const cannonDia = style.armThickness * 1.5 * cs;
        const housing = BABYLON.MeshBuilder.CreateCylinder("acH", {
          height: cannonLen * 0.55,
          diameter: cannonDia,
          tessellation: 14,
        }, this.scene);
        housing.rotation.z = Math.PI / 2;
        housing.position.set(baseX + side * cannonLen * 0.25, armAnchorY - style.armThickness * 0.15, 0);
        primaryParts.push(housing);

        const barrel = BABYLON.MeshBuilder.CreateCylinder("acB", {
          height: cannonLen * 0.6,
          diameterTop: cannonDia * 0.7,
          diameterBottom: cannonDia * 0.95,
          tessellation: 14,
        }, this.scene);
        barrel.rotation.z = Math.PI / 2;
        barrel.position.set(baseX + side * cannonLen * 0.7, armAnchorY - style.armThickness * 0.15, 0);
        secondaryParts.push(barrel);

        const muzzle = BABYLON.MeshBuilder.CreateTorus("acM", {
          diameter: cannonDia * 0.95,
          thickness: cannonDia * 0.18,
          tessellation: 14,
        }, this.scene);
        muzzle.rotation.z = Math.PI / 2;
        muzzle.position.set(baseX + side * cannonLen * 1.0, armAnchorY - style.armThickness * 0.15, 0);
        emissiveParts.push(muzzle);

        const inner = BABYLON.MeshBuilder.CreateDisc("acI", {
          radius: cannonDia * 0.32,
          tessellation: 12,
        }, this.scene);
        inner.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        inner.position.set(baseX + side * cannonLen * 1.005, armAnchorY - style.armThickness * 0.15, 0);
        emissiveParts.push(inner);
      }
    }

    if (style.bootStyle === "rounded" || style.bootStyle === "wheeled") {
      const bootR = style.legThickness * 1.05;
      for (const side of [-1, 1] as const) {
        const boot = BABYLON.MeshBuilder.CreateSphere("bt", {
          diameterX: bootR * 1.6,
          diameterY: bootR * 1.2,
          diameterZ: bootR * 2.2,
          segments: 10,
        }, this.scene);
        boot.position.set(side * legOffsetX, bootR * 0.5, style.legThickness * 0.35);
        secondaryParts.push(boot);

        const cuff = BABYLON.MeshBuilder.CreateTorus("bc", {
          diameter: bootR * 1.6,
          thickness: bootR * 0.18,
          tessellation: 16,
        }, this.scene);
        cuff.position.set(side * legOffsetX, bootR * 1.1, 0);
        emissiveParts.push(cuff);
      }
    }

    if (style.gauntletStyle === "rounded" || style.gauntletStyle === "armored") {
      const gR = style.armThickness * 1.6;
      for (const side of [-1, 1] as const) {
        const gauntlet = style.gauntletStyle === "rounded"
          ? BABYLON.MeshBuilder.CreateSphere("gl", {
              diameterX: gR * 1.0, diameterY: gR * 0.95, diameterZ: gR * 1.1, segments: 10,
            }, this.scene)
          : BABYLON.MeshBuilder.CreateBox("gl", {
              width: gR * 1.0, height: gR * 0.95, depth: gR * 1.1,
            }, this.scene);
        gauntlet.position.set(
          side * (shoulderX + style.armLength * 0.85),
          armAnchorY - style.armThickness * 0.15,
          0,
        );
        secondaryParts.push(gauntlet);

        const knuckle = BABYLON.MeshBuilder.CreateTorus("gk", {
          diameter: gR * 0.9, thickness: gR * 0.12, tessellation: 12,
        }, this.scene);
        knuckle.rotation.z = Math.PI / 2;
        knuckle.position.set(
          side * (shoulderX + style.armLength * 0.95),
          armAnchorY - style.armThickness * 0.15,
          0,
        );
        emissiveParts.push(knuckle);
      }
    }

    if (style.hasWheels) {
      const where = style.wheelStyle ?? "shoulders";
      const wheelDia = style.legThickness * 1.4;
      const positions: Array<[number, number, number]> = [];
      if (where === "shoulders") {
        positions.push([-shoulderX - 0.05, shoulderY - 0.05, -style.torsoDepth * 0.2]);
        positions.push([shoulderX + 0.05, shoulderY - 0.05, -style.torsoDepth * 0.2]);
      } else if (where === "back") {
        positions.push([-style.torsoWidth * 0.35, torsoY, -style.torsoDepth * 0.7]);
        positions.push([style.torsoWidth * 0.35, torsoY, -style.torsoDepth * 0.7]);
      } else {
        positions.push([-legOffsetX, wheelDia * 0.5, -style.legThickness * 0.4]);
        positions.push([legOffsetX, wheelDia * 0.5, -style.legThickness * 0.4]);
      }
      for (const [x, y, z] of positions) {
        const tire = BABYLON.MeshBuilder.CreateTorus("wht", {
          diameter: wheelDia, thickness: wheelDia * 0.28, tessellation: 18,
        }, this.scene);
        tire.rotation.x = Math.PI / 2;
        tire.position.set(x, y, z);
        primaryParts.push(tire);

        const hub = BABYLON.MeshBuilder.CreateCylinder("whh", {
          height: wheelDia * 0.32, diameter: wheelDia * 0.55, tessellation: 12,
        }, this.scene);
        hub.rotation.z = Math.PI / 2;
        hub.position.set(x, y, z);
        secondaryParts.push(hub);

        const rimGlow = BABYLON.MeshBuilder.CreateTorus("whg", {
          diameter: wheelDia * 0.62, thickness: wheelDia * 0.05, tessellation: 16,
        }, this.scene);
        rimGlow.rotation.x = Math.PI / 2;
        rimGlow.position.set(x, y, z);
        emissiveParts.push(rimGlow);
      }
    }

    if (style.hasBackpackEngine) {
      const engineW = style.torsoWidth * 0.85;
      const engineH = style.torsoHeight * 0.7;
      const engineD = style.torsoDepth * 0.45;
      const engineZ = -style.torsoDepth * 0.55 - engineD * 0.5;

      const block = BABYLON.MeshBuilder.CreateBox("eng", {
        width: engineW, height: engineH, depth: engineD,
      }, this.scene);
      block.position.set(0, torsoY + style.torsoHeight * 0.1, engineZ);
      secondaryParts.push(block);

      const ventCount = Math.max(2, Math.min(8, style.engineVentCount ?? 4));
      const ventH = engineH * 0.7 / ventCount;
      for (let v = 0; v < ventCount; v++) {
        const slat = BABYLON.MeshBuilder.CreateBox("vs", {
          width: engineW * 0.78,
          height: ventH * 0.5,
          depth: engineD * 0.18,
        }, this.scene);
        slat.position.set(
          0,
          torsoY + style.torsoHeight * 0.1 - engineH * 0.3 + v * ventH,
          engineZ - engineD * 0.5 - 0.02,
        );
        emissiveParts.push(slat);
      }

      for (const side of [-1, 1] as const) {
        const exhaust = BABYLON.MeshBuilder.CreateCylinder("ex", {
          height: engineD * 1.3,
          diameterTop: engineW * 0.2,
          diameterBottom: engineW * 0.16,
          tessellation: 12,
        }, this.scene);
        exhaust.position.set(side * engineW * 0.35, torsoY + style.torsoHeight * 0.4, engineZ);
        exhaust.rotation.x = Math.PI / 2;
        primaryParts.push(exhaust);

        const exGlow = BABYLON.MeshBuilder.CreateDisc("eg", {
          radius: engineW * 0.085, tessellation: 10,
        }, this.scene);
        exGlow.position.set(side * engineW * 0.35, torsoY + style.torsoHeight * 0.4, engineZ - engineD * 0.65);
        exGlow.rotation.x = Math.PI / 2;
        emissiveParts.push(exGlow);
      }
    }

    if (style.hasVents) {
      for (const side of [-1, 1] as const) {
        for (let i = 0; i < 3; i++) {
          const vent = BABYLON.MeshBuilder.CreateBox("vt", {
            width: style.shoulderPadSize * 0.55,
            height: style.shoulderPadSize * 0.06,
            depth: style.shoulderPadSize * 0.45,
          }, this.scene);
          vent.position.set(
            side * shoulderX,
            shoulderY + style.shoulderPadSize * 0.18 - i * style.shoulderPadSize * 0.12,
            -style.torsoDepth * 0.05,
          );
          emissiveParts.push(vent);
        }
      }
    }

    if (style.hasWedges) {
      const count = Math.max(1, Math.min(6, style.wedgeCount ?? 2));
      for (let i = 0; i < count; i++) {
        const t = (i + 1) / (count + 1);
        const wedge = BABYLON.MeshBuilder.CreateBox("wd", {
          width: style.torsoWidth * (0.85 - t * 0.45),
          height: style.torsoHeight * 0.06,
          depth: style.torsoDepth * 0.18,
        }, this.scene);
        wedge.rotation.x = -0.35;
        wedge.position.set(
          0,
          torsoY - style.torsoHeight * 0.15 + t * style.torsoHeight * 0.5,
          style.torsoDepth * 0.55 + 0.02,
        );
        secondaryParts.push(wedge);
      }
      for (const side of [-1, 1] as const) {
        const legWedge = BABYLON.MeshBuilder.CreateBox("lwd", {
          width: style.legThickness * 0.4,
          height: style.legLength * 0.15,
          depth: style.legThickness * 1.4,
        }, this.scene);
        legWedge.rotation.z = side * 0.3;
        legWedge.position.set(side * legOffsetX, style.legLength * 0.55, style.legThickness * 0.4);
        secondaryParts.push(legWedge);
      }
    }

    if (style.hasPanelLines) {
      const density = Math.max(0, Math.min(1, style.panelLineDensity ?? 0.5));
      const lineCount = Math.round(2 + density * 5);
      for (let i = 0; i < lineCount; i++) {
        const t = (i + 1) / (lineCount + 1);
        const horiz = BABYLON.MeshBuilder.CreateBox("pl", {
          width: style.torsoWidth * 0.82,
          height: 0.02,
          depth: 0.04,
        }, this.scene);
        horiz.position.set(
          0,
          torsoY - style.torsoHeight * 0.4 + t * style.torsoHeight * 0.8,
          style.torsoDepth * 0.51,
        );
        emissiveParts.push(horiz);
      }
      const vert = BABYLON.MeshBuilder.CreateBox("plv", {
        width: 0.025,
        height: style.torsoHeight * 0.78,
        depth: 0.04,
      }, this.scene);
      vert.position.set(0, torsoY, style.torsoDepth * 0.51);
      emissiveParts.push(vert);
    }

    if (primaryParts.length > 0) {
      const merged = BABYLON.Mesh.MergeMeshes(primaryParts, true, true, undefined, false, true);
      if (merged) {
        merged.name = `${desc.name}_primary`;
        merged.material = this.getMat("primary", style);
        merged.parent = root;
      }
    }
    if (secondaryParts.length > 0) {
      const merged = BABYLON.Mesh.MergeMeshes(secondaryParts, true, true, undefined, false, true);
      if (merged) {
        merged.name = `${desc.name}_secondary`;
        merged.material = this.getMat("secondary", style);
        merged.parent = root;
      }
    }
    if (emissiveParts.length > 0) {
      const merged = BABYLON.Mesh.MergeMeshes(emissiveParts, true, true, undefined, false, true);
      if (merged) {
        merged.name = `${desc.name}_emissive`;
        merged.material = this.getMat("emissive", style);
        merged.parent = root;
      }
    }

    return root;
  }

  buildFromTheme(themeId: RobotThemeId, name: string, position: BABYLON.Vector3): BABYLON.TransformNode {
    const baseStyle = createDefaultStyle();
    const themed = applyTheme(baseStyle, themeId);
    const desc: RobotDescriptor = {
      name,
      faction: themeId === "hybrid" ? "enemy" : themeId === "megaMan" ? "ally" : "neutral",
      style: themed,
    };
    return this.createRobot(desc, position);
  }

  dispose(): void {
    this.mats.forEach(m => m.dispose());
    this.mats.clear();
  }
}

export function buildRobotDemo(
  scene: BABYLON.Scene,
  themeId: RobotThemeId,
  position: BABYLON.Vector3 = BABYLON.Vector3.Zero(),
): { root: BABYLON.TransformNode; factory: RobotFactory; dispose: () => void } {
  const factory = new RobotFactory(scene);
  const theme = ROBOT_THEMES[themeId] ?? ROBOT_THEMES.default;
  const root = factory.buildFromTheme(themeId, `demo_${theme.label.replace(/\s+/g, "")}`, position);
  console.log(`[buildRobotDemo] Built ${theme.label} robot at`, position);
  const dispose = () => {
    root.getChildMeshes().forEach(m => m.dispose());
    root.dispose();
    factory.dispose();
  };
  return { root, factory, dispose };
}
