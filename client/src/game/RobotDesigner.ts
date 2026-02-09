import * as BABYLON from "@babylonjs/core";

export type RobotArchetype = "scout" | "brute" | "flyer" | "tank" | "insectoid" | "hybrid" | "pet" | "ally";

export interface RobotColors {
  primary: BABYLON.Color3;
  secondary: BABYLON.Color3;
  emissive: BABYLON.Color3;
}

export interface RobotStyle {
  archetype: RobotArchetype;
  scale: number;

  torsoWidth: number;
  torsoHeight: number;
  torsoDepth: number;

  headSize: number;
  headShape: "box" | "sphere" | "cylinder" | "cone";

  armLength: number;
  armThickness: number;
  armStyle: "cylinder" | "box" | "tapered";

  legLength: number;
  legThickness: number;
  legStyle: "box" | "digitigrade" | "hoverpads";

  shoulderPadSize: number;
  hipPadSize: number;

  hasWings: boolean;
  wingSpan: number;
  wingAngle: number;

  hasCannons: boolean;
  cannonSize: number;

  hasBackpack: boolean;
  backpackSize: number;

  hasVisor: boolean;
  visorStyle: "slit" | "round" | "full";

  hasHorns: boolean;
  hornLength: number;

  hasTail: boolean;
  tailLength: number;
  tailSegments: number;

  hasAntennae: boolean;
  antennaLength: number;

  hasShield: boolean;
  shieldSize: number;

  extraPlating: number;
  asymmetry: number;

  colors: RobotColors;
}

export interface RobotDescriptor {
  name: string;
  faction: "enemy" | "ally" | "pet" | "neutral";
  style: RobotStyle;
}

export function createDefaultStyle(archetype: RobotArchetype = "scout"): RobotStyle {
  return {
    archetype,
    scale: 1,
    torsoWidth: 1.2, torsoHeight: 1.5, torsoDepth: 0.7,
    headSize: 0.55, headShape: "box",
    armLength: 1.2, armThickness: 0.22, armStyle: "cylinder",
    legLength: 1.3, legThickness: 0.28, legStyle: "box",
    shoulderPadSize: 0.55, hipPadSize: 0.65,
    hasWings: false, wingSpan: 1.5, wingAngle: 0.35,
    hasCannons: false, cannonSize: 0.55,
    hasBackpack: false, backpackSize: 0.65,
    hasVisor: true, visorStyle: "slit",
    hasHorns: false, hornLength: 0.4,
    hasTail: false, tailLength: 1.5, tailSegments: 3,
    hasAntennae: false, antennaLength: 0.6,
    hasShield: false, shieldSize: 1.2,
    extraPlating: 0, asymmetry: 0,
    colors: {
      primary: new BABYLON.Color3(0.2, 0.3, 0.8),
      secondary: new BABYLON.Color3(0.7, 0.7, 0.75),
      emissive: new BABYLON.Color3(0.2, 0.9, 1.0),
    },
  };
}

export function serializeRobot(desc: RobotDescriptor): string {
  const clone = JSON.parse(JSON.stringify(desc, (key, value) => {
    if (value instanceof BABYLON.Color3) {
      return { r: value.r, g: value.g, b: value.b };
    }
    return value;
  }));
  return JSON.stringify(clone, null, 2);
}

export function deserializeRobot(json: string): RobotDescriptor {
  const obj = JSON.parse(json);
  const c = obj.style.colors;
  obj.style.colors = {
    primary: new BABYLON.Color3(c.primary.r, c.primary.g, c.primary.b),
    secondary: new BABYLON.Color3(c.secondary.r, c.secondary.g, c.secondary.b),
    emissive: new BABYLON.Color3(c.emissive.r, c.emissive.g, c.emissive.b),
  };
  return obj;
}

export function validateStyle(style: RobotStyle): RobotStyle {
  const s = { ...style };
  s.scale = Math.max(0.3, Math.min(3.0, s.scale));
  s.torsoWidth = Math.max(0.5, Math.min(3.0, s.torsoWidth));
  s.torsoHeight = Math.max(0.8, Math.min(3.5, s.torsoHeight));
  s.torsoDepth = Math.max(0.3, Math.min(2.0, s.torsoDepth));
  s.headSize = Math.max(0.2, Math.min(1.5, s.headSize));
  s.armLength = Math.max(0.5, Math.min(s.torsoWidth * 1.6 + 0.6, s.armLength));
  s.armThickness = Math.max(0.1, Math.min(0.6, s.armThickness));
  s.legLength = Math.max(s.torsoHeight * 0.6, Math.min(3.0, s.legLength));
  s.legThickness = Math.max(0.15, Math.min(0.8, s.legThickness));
  s.shoulderPadSize = Math.max(0.2, Math.min(1.2, s.shoulderPadSize));
  s.hipPadSize = Math.max(0.2, Math.min(1.2, s.hipPadSize));
  s.wingSpan = Math.max(0.5, Math.min(3.0, s.wingSpan));
  s.cannonSize = Math.max(0.2, Math.min(1.0, s.cannonSize));
  s.hornLength = Math.max(0.1, Math.min(1.0, s.hornLength));
  s.tailLength = Math.max(0.5, Math.min(3.0, s.tailLength));
  s.tailSegments = Math.max(2, Math.min(8, Math.floor(s.tailSegments)));
  s.antennaLength = Math.max(0.2, Math.min(1.5, s.antennaLength));
  s.shieldSize = Math.max(0.5, Math.min(2.5, s.shieldSize));
  s.extraPlating = Math.max(0, Math.min(3, Math.floor(s.extraPlating)));
  s.asymmetry = Math.max(0, Math.min(1, s.asymmetry));
  return s;
}
