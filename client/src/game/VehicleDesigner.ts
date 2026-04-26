export type VehicleKind = "atv" | "spaceFighter";

export type RGB = [number, number, number];

export interface VehicleStyle {
  kind: VehicleKind;
  bodyLength: number;
  bodyWidth: number;
  bodyHeight: number;
  primaryColor: RGB;
  secondaryColor: RGB;
  accentColor: RGB;
  emissiveColor: RGB;

  wheelCount?: number;
  wheelRadius?: number;
  wheelWidth?: number;
  hasRollCage?: boolean;
  hasFenders?: boolean;
  hasHeadlights?: boolean;
  hasExhaust?: boolean;

  wingSpan?: number;
  wingChord?: number;
  wingTaper?: number;
  wingTipFinHeight?: number;
  tailFinHeight?: number;
  cannonCount?: number;
  thrusterCount?: number;
  cockpitStyle?: "bubble" | "wedge" | "flat";
  hasLandingSkids?: boolean;
}

export interface VehicleDescriptor {
  name: string;
  style: VehicleStyle;
}

export const VEHICLE_PRESETS: Record<string, VehicleDescriptor> = {
  RaiderATV: {
    name: "Raider ATV",
    style: {
      kind: "atv",
      bodyLength: 3.2,
      bodyWidth: 1.8,
      bodyHeight: 0.7,
      primaryColor: [0.85, 0.35, 0.18],
      secondaryColor: [0.18, 0.18, 0.22],
      accentColor: [1.0, 0.8, 0.2],
      emissiveColor: [1.0, 0.5, 0.1],
      wheelCount: 4,
      wheelRadius: 0.55,
      wheelWidth: 0.42,
      hasRollCage: true,
      hasFenders: true,
      hasHeadlights: true,
      hasExhaust: true,
    },
  },
  StrikerATV: {
    name: "Striker ATV",
    style: {
      kind: "atv",
      bodyLength: 3.0,
      bodyWidth: 1.7,
      bodyHeight: 0.65,
      primaryColor: [0.18, 0.55, 0.85],
      secondaryColor: [0.12, 0.12, 0.16],
      accentColor: [0.3, 0.95, 1.0],
      emissiveColor: [0.2, 0.9, 1.0],
      wheelCount: 4,
      wheelRadius: 0.5,
      wheelWidth: 0.38,
      hasRollCage: true,
      hasFenders: true,
      hasHeadlights: true,
      hasExhaust: true,
    },
  },
  CometFighter: {
    name: "Comet Fighter",
    style: {
      kind: "spaceFighter",
      bodyLength: 7.0,
      bodyWidth: 1.4,
      bodyHeight: 1.1,
      primaryColor: [0.78, 0.78, 0.85],
      secondaryColor: [0.18, 0.2, 0.28],
      accentColor: [1.0, 0.25, 0.25],
      emissiveColor: [1.0, 0.5, 1.0],
      wingSpan: 5.4,
      wingChord: 1.8,
      wingTaper: 0.45,
      wingTipFinHeight: 0.6,
      tailFinHeight: 1.2,
      cannonCount: 2,
      thrusterCount: 2,
      cockpitStyle: "wedge",
      hasLandingSkids: true,
    },
  },
  NebulaInterceptor: {
    name: "Nebula Interceptor",
    style: {
      kind: "spaceFighter",
      bodyLength: 6.4,
      bodyWidth: 1.2,
      bodyHeight: 1.0,
      primaryColor: [0.15, 0.18, 0.32],
      secondaryColor: [0.05, 0.07, 0.12],
      accentColor: [0.4, 0.9, 1.0],
      emissiveColor: [0.3, 1.0, 1.0],
      wingSpan: 4.6,
      wingChord: 1.4,
      wingTaper: 0.35,
      wingTipFinHeight: 0.8,
      tailFinHeight: 1.0,
      cannonCount: 4,
      thrusterCount: 2,
      cockpitStyle: "bubble",
      hasLandingSkids: true,
    },
  },
};

export function getVehiclePreset(name: string): VehicleDescriptor | null {
  return VEHICLE_PRESETS[name] ?? null;
}
