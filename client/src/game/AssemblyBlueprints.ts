import * as BABYLON from "@babylonjs/core";
import { RobotDescriptor, RobotStyle, createDefaultStyle, validateStyle } from "./RobotDesigner";
import { PartKind, PartTier, getPartInfo, PART_TIER_NAMES } from "./ModularParts";

/**
 * Assembly blueprints — the recipes the Lab's ASSEMBLY tab uses to turn
 * modular parts into items, helper robots, and robo-pets.
 *
 * The assembled result is DETERMINISTIC from (blueprintId + slotted part
 * item ids), so a saved assembled unit can be rebuilt exactly on load.
 */

export type AssemblyCategory = "item" | "robot" | "pet";

export interface AssemblySlot {
  id: string;
  label: string;
  kind: PartKind;
}

export interface AssemblyBlueprint {
  id: string;
  name: string;
  category: AssemblyCategory;
  description: string;
  slots: AssemblySlot[];
  /** Lab level required to unlock this blueprint. */
  unlockTier: number;
}

export const ASSEMBLY_BLUEPRINTS: AssemblyBlueprint[] = [
  // ------------------------------------------------------------- robots
  {
    id: "vanguard",
    name: "Vanguard Unit",
    category: "robot",
    description: "Frontline combat robot. Part quality drives damage and armor.",
    unlockTier: 1,
    slots: [
      { id: "frame", label: "Frame", kind: "frame" },
      { id: "core", label: "Power Core", kind: "power_core" },
      { id: "servo", label: "Servo", kind: "servo" },
      { id: "weapon", label: "Weapon Mod", kind: "weapon_mod" },
    ],
  },
  {
    id: "bulwark",
    name: "Bulwark Sentinel",
    category: "robot",
    description: "Heavy shielded guardian. Twin servos give it a towering stride.",
    unlockTier: 2,
    slots: [
      { id: "frame", label: "Frame", kind: "frame" },
      { id: "core", label: "Power Core", kind: "power_core" },
      { id: "servoL", label: "Left Servo", kind: "servo" },
      { id: "servoR", label: "Right Servo", kind: "servo" },
    ],
  },
  // --------------------------------------------------------------- pets
  {
    id: "circuit_hound",
    name: "Circuit Hound",
    category: "pet",
    description: "Loyal robo-hound. Its synth organ pulses with healing energy.",
    unlockTier: 1,
    slots: [
      { id: "chassis", label: "Pet Chassis", kind: "pet_chassis" },
      { id: "organ", label: "Synth Organ", kind: "pet_organ" },
      { id: "core", label: "Power Core", kind: "power_core" },
    ],
  },
  {
    id: "aero_wisp",
    name: "Aero Wisp",
    category: "pet",
    description: "Tiny winged hover-pet. Higher-tier parts brighten its glow.",
    unlockTier: 2,
    slots: [
      { id: "chassis", label: "Pet Chassis", kind: "pet_chassis" },
      { id: "organ", label: "Synth Organ", kind: "pet_organ" },
      { id: "servo", label: "Servo", kind: "servo" },
    ],
  },
  // -------------------------------------------------------------- items
  {
    id: "weapon_kit",
    name: "Weapon Mod Kit",
    category: "item",
    description: "Converts spare parts into weapon parts for the upgrade bench.",
    unlockTier: 1,
    slots: [
      { id: "weapon", label: "Weapon Mod", kind: "weapon_mod" },
      { id: "servo", label: "Servo", kind: "servo" },
    ],
  },
  {
    id: "jewel_synth",
    name: "Jewel Synthesizer",
    category: "item",
    description: "Fuses cores + a weapon mod into a Power Jewel. Tier decides the cut.",
    unlockTier: 3,
    slots: [
      { id: "coreA", label: "Power Core", kind: "power_core" },
      { id: "coreB", label: "Power Core", kind: "power_core" },
      { id: "weapon", label: "Weapon Mod", kind: "weapon_mod" },
    ],
  },
];

export function getBlueprint(id: string): AssemblyBlueprint | null {
  return ASSEMBLY_BLUEPRINTS.find(b => b.id === id) ?? null;
}

// ------------------------------------------------------------- validation

/** Validate that partIds line up with the blueprint slots (kind match). */
export function validateAssembly(bp: AssemblyBlueprint, partIds: string[]): { ok: boolean; reason?: string } {
  if (partIds.length !== bp.slots.length) return { ok: false, reason: "Missing parts" };
  for (let i = 0; i < bp.slots.length; i++) {
    const info = getPartInfo(partIds[i]);
    if (!info) return { ok: false, reason: `Slot ${bp.slots[i].label}: not a part` };
    if (info.kind !== bp.slots[i].kind) {
      return { ok: false, reason: `Slot ${bp.slots[i].label} needs a ${bp.slots[i].kind.replace("_", " ")}` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------- quality

export interface AssemblyQuality {
  /** Average part tier, 1..3. */
  avgTier: number;
  /** Stat multiplier applied to the assembled unit (1.0 / ~1.35 / ~1.8). */
  statMult: number;
  label: string;
}

export function assemblyQuality(partIds: string[]): AssemblyQuality {
  const tiers = partIds.map(id => getPartInfo(id)?.tier ?? 1);
  const avg = tiers.reduce((a, b) => a + b, 0) / Math.max(1, tiers.length);
  const statMult = 1 + (avg - 1) * 0.4; // t1 → 1.0, t2 → 1.4, t3 → 1.8
  const label = avg >= 2.7 ? "PRIME" : avg >= 1.7 ? "REFINED" : "STANDARD";
  return { avgTier: avg, statMult, label };
}

// ------------------------------------------------------------ descriptors

/** Tier-driven color families so higher-quality builds visibly glow richer. */
function qualityColors(category: AssemblyCategory, avgTier: number): RobotStyle["colors"] {
  const t = Math.max(0, Math.min(1, (avgTier - 1) / 2));
  if (category === "pet") {
    return {
      primary: BABYLON.Color3.Lerp(new BABYLON.Color3(0.55, 0.4, 0.15), new BABYLON.Color3(0.8, 0.3, 0.9), t),
      secondary: BABYLON.Color3.Lerp(new BABYLON.Color3(0.75, 0.7, 0.6), new BABYLON.Color3(0.95, 0.85, 1.0), t),
      emissive: BABYLON.Color3.Lerp(new BABYLON.Color3(0.9, 0.7, 0.2), new BABYLON.Color3(1.0, 0.3, 1.0), t),
    };
  }
  return {
    primary: BABYLON.Color3.Lerp(new BABYLON.Color3(0.3, 0.32, 0.38), new BABYLON.Color3(0.15, 0.25, 0.7), t),
    secondary: BABYLON.Color3.Lerp(new BABYLON.Color3(0.6, 0.6, 0.62), new BABYLON.Color3(0.9, 0.75, 0.3), t),
    emissive: BABYLON.Color3.Lerp(new BABYLON.Color3(0.3, 0.9, 0.9), new BABYLON.Color3(1.0, 0.85, 0.2), t),
  };
}

/**
 * Deterministically build the assembled unit's descriptor from the
 * blueprint + slotted parts. Called both at build time AND on save-load
 * (CompanionSystem rebuilds assembled units from their saved recipe).
 */
export function buildAssembledDescriptor(bp: AssemblyBlueprint, partIds: string[], name: string): RobotDescriptor | null {
  if (bp.category === "item") return null;
  const q = assemblyQuality(partIds);
  const t = Math.max(0, Math.min(1, (q.avgTier - 1) / 2));
  let style: RobotStyle;

  if (bp.category === "pet") {
    style = createDefaultStyle("pet");
    style.scale = 0.42 + 0.1 * t;
    style.torsoWidth = 0.7; style.torsoHeight = 0.55; style.torsoDepth = 0.9;
    style.headSize = 0.45; style.headShape = "sphere";
    style.armLength = 0.5; style.armThickness = 0.12;
    style.legLength = 0.5; style.legThickness = 0.15;
    style.shoulderPadSize = 0.2; style.hipPadSize = 0.25;
    style.hasVisor = true; style.visorStyle = "round";
    style.hasTail = true; style.tailLength = 0.7; style.tailSegments = 4;
    style.hasAntennae = true; style.antennaLength = 0.35;
    if (bp.id === "aero_wisp") {
      style.hasWings = true; style.wingSpan = 0.7; style.wingAngle = 0.25;
      style.legStyle = "hoverpads"; style.hasTail = false;
      style.torsoDepth = 0.6; style.scale = 0.36 + 0.08 * t;
    } else {
      style.legStyle = "digitigrade";
      style.hasHorns = t > 0.6; style.hornLength = 0.18;
    }
    style.extraPlating = Math.round(t * 2);
    style.emissiveBoost = 1 + t * 0.8;
  } else {
    style = createDefaultStyle("ally");
    style.scale = 0.95 + 0.25 * t;
    if (bp.id === "bulwark") {
      style.torsoWidth = 1.5; style.torsoHeight = 1.7; style.torsoDepth = 0.95;
      style.armStyle = "box"; style.armThickness = 0.32;
      style.legStyle = "box"; style.legThickness = 0.42;
      style.shoulderPadSize = 0.85;
      style.hasShield = true; style.shieldSize = 1.4 + 0.4 * t;
      style.hasBackpack = true; style.backpackSize = 0.8;
      style.hasVisor = true; style.visorStyle = "full";
    } else {
      style.torsoWidth = 1.25; style.torsoHeight = 1.55;
      style.armStyle = "tapered";
      style.hasCannons = true; style.cannonSize = 0.45 + 0.25 * t;
      style.hasBackpack = t > 0.4; style.backpackSize = 0.65;
      style.hasVisor = true; style.visorStyle = "slit";
      style.hasAntennae = t > 0.6; style.antennaLength = 0.5;
    }
    style.extraPlating = Math.round(1 + t * 2);
  }

  style.colors = qualityColors(bp.category, q.avgTier);
  return {
    name,
    faction: bp.category === "pet" ? "pet" : "ally",
    style: validateStyle(style),
  };
}

// ------------------------------------------------------------ item output

export interface AssembledItemOutput { itemId: string; quantity: number; }

/** Resolve what an item-category blueprint produces for the given parts. */
export function resolveItemOutput(bp: AssemblyBlueprint, partIds: string[]): AssembledItemOutput[] {
  const q = assemblyQuality(partIds);
  if (bp.id === "jewel_synth") {
    const itemId = q.avgTier >= 2.7 ? "power_jewel_flawless" : q.avgTier >= 1.7 ? "power_jewel_cut" : "power_jewel_rough";
    return [{ itemId, quantity: 1 }];
  }
  // weapon_kit — a spread of weapon parts, more + rarer with quality.
  const count = 2 + Math.round(q.avgTier);
  const pool = q.avgTier >= 2 ? ["rocket", "laser", "grenade"] : ["pistol", "rifle", "shotgun"];
  const out: AssembledItemOutput[] = [];
  for (let i = 0; i < count; i++) {
    const w = pool[i % pool.length];
    const existing = out.find(o => o.itemId === `weapon_part_${w}`);
    if (existing) existing.quantity += 1;
    else out.push({ itemId: `weapon_part_${w}`, quantity: 1 });
  }
  return out;
}

/** Human-readable output preview for the UI. */
export function describeOutput(bp: AssemblyBlueprint, partIds: string[]): string {
  const q = assemblyQuality(partIds);
  if (bp.category === "item") {
    if (bp.id === "jewel_synth") {
      const tier = q.avgTier >= 2.7 ? "Flawless" : q.avgTier >= 1.7 ? "Cut" : "Rough";
      return `Produces: 1× ${tier} Power Jewel`;
    }
    return `Produces: ${2 + Math.round(q.avgTier)}× weapon parts (${q.avgTier >= 2 ? "heavy" : "light"} weapons)`;
  }
  const pct = Math.round((q.statMult - 1) * 100);
  return `${q.label} build — +${pct}% stats over a standard unit`;
}

export { PART_TIER_NAMES };
export type { PartTier };
