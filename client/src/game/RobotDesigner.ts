import * as BABYLON from "@babylonjs/core";

export type RobotArchetype =
  | "scout" | "brute" | "flyer" | "tank" | "insectoid" | "hybrid" | "pet" | "ally"
  | "transformer" | "megaMan";

export type RobotThemeId = "transformer" | "megaMan" | "hybrid" | "default";

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

  themeId?: RobotThemeId;
  hasWheels?: boolean;
  wheelStyle?: "feet" | "shoulders" | "back";
  hasArmCannon?: "left" | "right" | "both" | null;
  armCannonScale?: number;
  hasBackpackEngine?: boolean;
  engineVentCount?: number;
  hasVents?: boolean;
  hasWedges?: boolean;
  wedgeCount?: number;
  bootStyle?: "standard" | "rounded" | "wheeled";
  gauntletStyle?: "standard" | "rounded" | "armored";
  hasPanelLines?: boolean;
  panelLineDensity?: number;
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

export interface RobotTheme {
  id: RobotThemeId;
  label: string;
  colors: RobotColors;
  apply: (s: RobotStyle) => RobotStyle;
}

export const ROBOT_THEMES: Record<RobotThemeId, RobotTheme> = {
  default: {
    id: "default",
    label: "Default",
    colors: {
      primary: new BABYLON.Color3(0.2, 0.3, 0.8),
      secondary: new BABYLON.Color3(0.7, 0.7, 0.75),
      emissive: new BABYLON.Color3(0.2, 0.9, 1.0),
    },
    apply: (s) => s,
  },
  transformer: {
    id: "transformer",
    label: "Transformer",
    colors: {
      primary: new BABYLON.Color3(0.15, 0.35, 0.85),
      secondary: new BABYLON.Color3(0.85, 0.12, 0.15),
      emissive: new BABYLON.Color3(0.4, 0.85, 1.0),
    },
    apply: (s) => ({
      ...s,
      torsoWidth: 1.55, torsoHeight: 1.7, torsoDepth: 0.95,
      headSize: 0.6, headShape: "box",
      armLength: 1.35, armThickness: 0.3, armStyle: "box",
      legLength: 1.3, legThickness: 0.4, legStyle: "box",
      shoulderPadSize: 0.85, hipPadSize: 0.75,
      hasVisor: true, visorStyle: "slit",
      hasBackpack: true, backpackSize: 0.8,
      extraPlating: 2,
      hasWheels: true, wheelStyle: "shoulders",
      hasArmCannon: "right", armCannonScale: 1.0,
      hasBackpackEngine: true, engineVentCount: 4,
      hasVents: true,
      hasWedges: true, wedgeCount: 3,
      bootStyle: "standard", gauntletStyle: "armored",
      hasPanelLines: true, panelLineDensity: 0.7,
    }),
  },
  megaMan: {
    id: "megaMan",
    label: "Humanoid",
    colors: {
      primary: new BABYLON.Color3(0.1, 0.55, 0.95),
      secondary: new BABYLON.Color3(0.95, 0.95, 0.98),
      emissive: new BABYLON.Color3(0.3, 1.0, 1.0),
    },
    apply: (s) => ({
      ...s,
      torsoWidth: 1.15, torsoHeight: 1.5, torsoDepth: 0.7,
      headSize: 0.62, headShape: "sphere",
      armLength: 1.15, armThickness: 0.24, armStyle: "tapered",
      legLength: 1.25, legThickness: 0.3, legStyle: "box",
      shoulderPadSize: 0.55, hipPadSize: 0.6,
      hasVisor: true, visorStyle: "round",
      hasBackpack: false,
      extraPlating: 1,
      hasArmCannon: "right", armCannonScale: 1.3,
      hasVents: false,
      hasWedges: false,
      bootStyle: "rounded", gauntletStyle: "rounded",
      hasPanelLines: true, panelLineDensity: 0.4,
      hasAntennae: false,
    }),
  },
  hybrid: {
    id: "hybrid",
    label: "Hybrid Boss",
    colors: {
      primary: new BABYLON.Color3(0.35, 0.15, 0.45),
      secondary: new BABYLON.Color3(0.12, 0.5, 0.25),
      emissive: new BABYLON.Color3(0.85, 0.0, 1.0),
    },
    apply: (s) => ({
      ...s,
      scale: Math.max(s.scale, 1.4),
      torsoWidth: 1.6, torsoHeight: 2.0, torsoDepth: 1.05,
      headSize: 0.72, headShape: "cone",
      armLength: 1.6, armThickness: 0.32, armStyle: "tapered",
      legLength: 1.55, legThickness: 0.42, legStyle: "digitigrade",
      shoulderPadSize: 0.85, hipPadSize: 0.75,
      hasWings: true, wingSpan: 2.4, wingAngle: 0.45,
      cannonSize: 0.65,
      hasBackpack: true, backpackSize: 0.95,
      hasVisor: true, visorStyle: "full",
      hasHorns: true, hornLength: 0.75,
      hasTail: true, tailLength: 2.2, tailSegments: 6,
      hasAntennae: true, antennaLength: 0.55,
      hasShield: true, shieldSize: 1.8,
      extraPlating: 3, asymmetry: 0.3,
      hasCannons: false,
      hasArmCannon: "both", armCannonScale: 1.1,
      hasBackpackEngine: true, engineVentCount: 6,
      hasVents: true,
      hasWedges: true, wedgeCount: 4,
      bootStyle: "rounded", gauntletStyle: "armored",
      hasPanelLines: true, panelLineDensity: 0.9,
    }),
  },
};

export interface ApplyThemeOptions {
  preserveColors?: boolean;
  preserveOverrides?: Partial<RobotStyle>;
}

export function applyTheme(
  style: RobotStyle,
  themeId: RobotThemeId,
  options: ApplyThemeOptions = {},
): RobotStyle {
  const theme = ROBOT_THEMES[themeId];
  if (!theme) return style;
  const themed = theme.apply({ ...style });
  themed.themeId = themeId;
  if (!options.preserveColors) {
    themed.colors = {
      primary: theme.colors.primary.clone(),
      secondary: theme.colors.secondary.clone(),
      emissive: theme.colors.emissive.clone(),
    };
  }
  if (options.preserveOverrides) {
    return { ...themed, ...options.preserveOverrides };
  }
  return themed;
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
