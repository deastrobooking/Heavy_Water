import * as BABYLON from "@babylonjs/core";
import { HumanoidLimbs } from "./HumanoidCharacter";
import { ArmorMaterialFactory, ArmorPalette } from "./ArmorMaterialFactory";
import { ArmorBuildContext, ArmorSlot, findPart } from "./RobotArmorParts";

export interface ArmorSetConfig {
  helmet: string;
  chest: string;
  back: string;
  leftShoulder: string;
  rightShoulder: string;
  leftArm: string;
  rightArm: string;
  leftWeapon: string;
  rightWeapon: string;
  legs: string;
  palette: ArmorPalette;
}

export interface ArmorSetSerialized {
  helmet: string;
  chest: string;
  back: string;
  leftShoulder: string;
  rightShoulder: string;
  leftArm: string;
  rightArm: string;
  leftWeapon: string;
  rightWeapon: string;
  legs: string;
  colors: {
    primary: [number, number, number];
    secondary: [number, number, number];
    trim: [number, number, number];
    glow: [number, number, number];
  };
}

export const DEFAULT_ARMOR_SET: ArmorSetSerialized = {
  helmet: "helmet_humanoid",
  chest: "chest_humanoid",
  back: "back_none",
  leftShoulder: "shoulder_humanoid",
  rightShoulder: "shoulder_humanoid",
  leftArm: "arm_humanoid_glove",
  rightArm: "arm_humanoid_glove",
  leftWeapon: "weapon_none",
  rightWeapon: "weapon_humanoid_blaster",
  legs: "legs_humanoid",
  colors: {
    primary: [0.18, 0.55, 0.95],
    secondary: [0.06, 0.18, 0.42],
    trim: [1.0, 0.85, 0.25],
    glow: [0.35, 0.95, 1.0],
  },
};

/** Premium "evil dread" preset built from the new spike + studded armor
 *  parts in `RobotArmorPartsEvil.ts`. Black-on-blood-red palette with a
 *  cyan reactor-heart so the silhouette still pops against the cell-shaded
 *  sky. Used both by the player customizer (DREAD button) and as the
 *  default look for player-overridden captain / titan styles. */
export const DREAD_ARMOR_SET: ArmorSetSerialized = {
  helmet: "helmet_dread_horns",
  chest: "chest_studded",
  back: "back_spine_spikes",
  leftShoulder: "shoulder_dread_spikes",
  rightShoulder: "shoulder_dread_spikes",
  leftArm: "arm_blade",
  rightArm: "arm_thrusters",
  leftWeapon: "weapon_none",
  rightWeapon: "weapon_blade",
  legs: "legs_studded",
  colors: {
    primary: [0.08, 0.08, 0.10],
    secondary: [0.42, 0.04, 0.06],
    trim: [0.92, 0.18, 0.12],
    glow: [1.0, 0.20, 0.85],
  },
};

export const TITAN_ARMOR_SET: ArmorSetSerialized = {
  helmet: "helmet_horned",
  chest: "chest_titan",
  back: "back_jetpack",
  leftShoulder: "shoulder_spikes",
  rightShoulder: "shoulder_cannon",
  leftArm: "arm_blade",
  rightArm: "arm_thrusters",
  leftWeapon: "weapon_none",
  rightWeapon: "weapon_blade",
  legs: "legs_titan",
  colors: {
    primary: [0.16, 0.16, 0.18],
    secondary: [0.32, 0.05, 0.05],
    trim: [1.0, 0.82, 0.2],
    glow: [1.0, 0.35, 0.1],
  },
};

function safeColorArray(v: any, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v) || v.length < 3) return fallback;
  const r = typeof v[0] === "number" ? Math.max(0, Math.min(1, v[0])) : fallback[0];
  const g = typeof v[1] === "number" ? Math.max(0, Math.min(1, v[1])) : fallback[1];
  const b = typeof v[2] === "number" ? Math.max(0, Math.min(1, v[2])) : fallback[2];
  return [r, g, b];
}

function safeString(v: any, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/**
 * Backwards-compat: older saves used `*_megaman` armor part ids before
 * the rename to the canonical "humanoid" frame. Map them on load so
 * existing localStorage / DB entries keep rendering the same parts.
 */
const LEGACY_PART_ID_ALIASES: Record<string, string> = {
  helmet_megaman: "helmet_humanoid",
  chest_megaman: "chest_humanoid",
  shoulder_megaman: "shoulder_humanoid",
  arm_megaman_glove: "arm_humanoid_glove",
  // The buster has been renamed to the blaster — old saves carrying either
  // the original `*_megaman_buster` id or the intermediate
  // `weapon_humanoid_buster` id resolve onto the new blaster part.
  weapon_megaman_buster: "weapon_humanoid_blaster",
  weapon_humanoid_buster: "weapon_humanoid_blaster",
  legs_megaman: "legs_humanoid",
};
function migratePartId(id: string): string {
  return LEGACY_PART_ID_ALIASES[id] ?? id;
}

export function sanitizeArmorSet(input: any): ArmorSetSerialized {
  const d = DEFAULT_ARMOR_SET;
  const src = input && typeof input === "object" ? input : {};
  const colors = src.colors && typeof src.colors === "object" ? src.colors : {};
  return {
    helmet: migratePartId(safeString(src.helmet, d.helmet)),
    chest: migratePartId(safeString(src.chest, d.chest)),
    back: migratePartId(safeString(src.back, d.back)),
    leftShoulder: migratePartId(safeString(src.leftShoulder, d.leftShoulder)),
    rightShoulder: migratePartId(safeString(src.rightShoulder, d.rightShoulder)),
    leftArm: migratePartId(safeString(src.leftArm, d.leftArm)),
    rightArm: migratePartId(safeString(src.rightArm, d.rightArm)),
    leftWeapon: migratePartId(safeString(src.leftWeapon, d.leftWeapon)),
    rightWeapon: migratePartId(safeString(src.rightWeapon, d.rightWeapon)),
    legs: migratePartId(safeString(src.legs, d.legs)),
    colors: {
      primary: safeColorArray(colors.primary, d.colors.primary),
      secondary: safeColorArray(colors.secondary, d.colors.secondary),
      trim: safeColorArray(colors.trim, d.colors.trim),
      glow: safeColorArray(colors.glow, d.colors.glow),
    },
  };
}

export function deserializeArmorSet(s: ArmorSetSerialized): ArmorSetConfig {
  const safe = sanitizeArmorSet(s);
  return {
    helmet: safe.helmet,
    chest: safe.chest,
    back: safe.back,
    leftShoulder: safe.leftShoulder,
    rightShoulder: safe.rightShoulder,
    leftArm: safe.leftArm,
    rightArm: safe.rightArm,
    leftWeapon: safe.leftWeapon,
    rightWeapon: safe.rightWeapon,
    legs: safe.legs,
    palette: {
      primary: BABYLON.Color3.FromArray(safe.colors.primary),
      secondary: BABYLON.Color3.FromArray(safe.colors.secondary),
      trim: BABYLON.Color3.FromArray(safe.colors.trim),
      glow: BABYLON.Color3.FromArray(safe.colors.glow),
    },
  };
}

export interface EquippedArmor {
  meshes: BABYLON.Mesh[];
  materials: ArmorMaterialFactory;
  dispose(): void;
}

export interface EquipParams {
  bodyHeight: number;
  shoulderWidth: number;
  armLength: number;
  legLength: number;
  saltId?: string;
}

export function equipArmorSet(
  scene: BABYLON.Scene,
  limbs: HumanoidLimbs,
  set: ArmorSetConfig,
  params: EquipParams
): EquippedArmor {
  const salt = params.saltId || `armor_${Date.now()}`;
  const materials = new ArmorMaterialFactory(scene, set.palette, salt);
  const allMeshes: BABYLON.Mesh[] = [];

  const slotAnchors: Record<ArmorSlot, BABYLON.TransformNode> = {
    helmet: limbs.head,
    chest: limbs.torso,
    back: limbs.torso,
    leftShoulder: limbs.leftArm,
    rightShoulder: limbs.rightArm,
    leftArm: limbs.leftArm,
    rightArm: limbs.rightArm,
    leftWeapon: limbs.leftArm,
    rightWeapon: limbs.rightArm,
    legs: limbs.root,
  };

  const buildSlot = (slot: ArmorSlot, partId: string, side?: "left" | "right", parent?: BABYLON.TransformNode) => {
    const part = findPart(slot, partId);
    if (!part) return;
    const ctx: ArmorBuildContext = {
      scene,
      materials,
      parent: parent || slotAnchors[slot],
      bodyHeight: params.bodyHeight,
      shoulderWidth: params.shoulderWidth,
      armLength: params.armLength,
      legLength: params.legLength,
      side,
    };
    const meshes = part.build(ctx);
    for (const m of meshes) {
      allMeshes.push(m);
      if (side === "right") m.scaling.x = -m.scaling.x;
    }
  };

  buildSlot("helmet", set.helmet);
  buildSlot("chest", set.chest);
  buildSlot("back", set.back);
  buildSlot("leftShoulder", set.leftShoulder, "left");
  buildSlot("rightShoulder", set.rightShoulder, "right");
  buildSlot("leftArm", set.leftArm, "left");
  buildSlot("rightArm", set.rightArm, "right");
  buildSlot("leftWeapon", set.leftWeapon, "left");
  buildSlot("rightWeapon", set.rightWeapon, "right");
  buildSlot("legs", set.legs, "left", limbs.leftLeg);
  buildSlot("legs", set.legs, "right", limbs.rightLeg);

  return {
    meshes: allMeshes,
    materials,
    dispose() {
      for (const m of allMeshes) {
        if (!m.isDisposed()) m.dispose();
      }
      materials.dispose();
    },
  };
}
