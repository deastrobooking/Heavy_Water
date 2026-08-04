import { ItemDefinition, ItemType, ItemRarity } from "./InventorySystem";

/**
 * Modular assembly parts — typed components that drop from enemies, props
 * and chests, and are combined in the Lab's ASSEMBLY tab into items,
 * helper robots, and robo-pets.
 *
 * Six part kinds × three quality tiers = 18 inventory items. Tier drives
 * the assembled unit's stat quality (see AssemblyBlueprints.ts).
 */
export type PartKind =
  | "frame"        // robot skeleton / chassis
  | "power_core"   // energy source
  | "servo"        // limb actuators
  | "weapon_mod"   // offensive module
  | "pet_organ"    // synthetic bio-organ (pets)
  | "pet_chassis"; // small-frame pet body

export type PartTier = 1 | 2 | 3;

export const PART_TIER_NAMES: Record<PartTier, string> = {
  1: "Standard",
  2: "Refined",
  3: "Prime",
};

const KIND_META: Record<PartKind, { label: string; desc: string }> = {
  frame:       { label: "Frame",       desc: "Structural robot skeleton. Assembly base for helper robots." },
  power_core:  { label: "Power Core",  desc: "Sealed reactor cell. Powers assembled robots, pets and devices." },
  servo:       { label: "Servo",       desc: "Precision limb actuator. Drives assembled arms, legs and mounts." },
  weapon_mod:  { label: "Weapon Mod",  desc: "Offensive hardpoint module for assembled units and weapon kits." },
  pet_organ:   { label: "Synth Organ", desc: "Synthetic bio-organ. Gives an assembled pet its spark of life." },
  pet_chassis: { label: "Pet Chassis", desc: "Compact small-frame body. Assembly base for robo-pets." },
};

const TIER_RARITY: Record<PartTier, ItemRarity> = {
  1: ItemRarity.Uncommon,
  2: ItemRarity.Rare,
  3: ItemRarity.Epic,
};

const TIER_VALUE: Record<PartTier, number> = { 1: 20, 2: 55, 3: 140 };

export function partIdFor(kind: PartKind, tier: PartTier): string {
  return `part_${kind}_t${tier}`;
}

export const PART_KINDS: PartKind[] = [
  "frame", "power_core", "servo", "weapon_mod", "pet_organ", "pet_chassis",
];

/** All 18 modular part item definitions, keyed by item id. */
export const MODULAR_PART_DEFINITIONS: Record<string, ItemDefinition> = {};
for (const kind of PART_KINDS) {
  for (const tier of [1, 2, 3] as PartTier[]) {
    const id = partIdFor(kind, tier);
    MODULAR_PART_DEFINITIONS[id] = {
      id,
      name: `${PART_TIER_NAMES[tier]} ${KIND_META[kind].label}`,
      type: ItemType.Material,
      rarity: TIER_RARITY[tier],
      maxStack: 50,
      value: TIER_VALUE[tier],
      description: `${KIND_META[kind].desc} (Tier ${tier}/3 — assemble in the Lab.)`,
      stats: { partTier: tier },
    };
  }
}

export interface PartInfo { kind: PartKind; tier: PartTier; }

const PART_ID_RE = /^part_(frame|power_core|servo|weapon_mod|pet_organ|pet_chassis)_t([123])$/;

/** Parse a modular-part item id back into { kind, tier }, or null. */
export function getPartInfo(itemId: string): PartInfo | null {
  const m = PART_ID_RE.exec(itemId);
  if (!m) return null;
  return { kind: m[1] as PartKind, tier: Number(m[2]) as PartTier };
}

export function partLabel(kind: PartKind): string {
  return KIND_META[kind].label;
}

// ---------------------------------------------------------------- drop rolls

/** Weighted tier roll. Higher `quality` (0..1) skews toward Prime. */
function rollTier(quality: number): PartTier {
  const r = Math.random();
  const primeC = 0.04 + 0.16 * quality;
  const refinedC = primeC + 0.22 + 0.28 * quality;
  if (r < primeC) return 3;
  if (r < refinedC) return 2;
  return 1;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Which part kinds each enemy family tends to drop. */
const ENEMY_PART_POOL: Record<string, PartKind[]> = {
  drone:             ["servo", "power_core"],
  soldier:           ["frame", "servo", "weapon_mod"],
  heavy:             ["frame", "weapon_mod", "power_core"],
  insectoid:         ["pet_organ", "pet_chassis", "servo"],
  hybrid:            ["pet_organ", "weapon_mod", "power_core"],
  commander:         ["frame", "weapon_mod", "power_core", "servo"],
  captain:           ["frame", "weapon_mod", "power_core"],
  tank:              ["frame", "servo"],
  aerial_fighter:    ["servo", "weapon_mod"],
  aerial_battleship: ["frame", "power_core", "weapon_mod", "pet_chassis"],
};

/** Per-enemy chance that a modular part drops at all. */
const ENEMY_PART_CHANCE: Record<string, number> = {
  drone: 0.10,
  soldier: 0.14,
  heavy: 0.30,
  insectoid: 0.22,
  hybrid: 0.40,
  commander: 0.75,
  captain: 0.75,
  tank: 0.35,
  aerial_fighter: 0.20,
  aerial_battleship: 0.90,
};

/** Enemy "quality" — tougher enemies skew toward higher part tiers. */
const ENEMY_PART_QUALITY: Record<string, number> = {
  drone: 0.0,
  soldier: 0.1,
  heavy: 0.35,
  insectoid: 0.2,
  hybrid: 0.5,
  commander: 0.8,
  captain: 0.85,
  tank: 0.4,
  aerial_fighter: 0.3,
  aerial_battleship: 0.9,
};

/** Roll a modular-part drop for an enemy kill. Null when the roll misses. */
export function rollEnemyModularPart(enemyType: string): { partId: string; amount: number } | null {
  const chance = ENEMY_PART_CHANCE[enemyType] ?? 0.08;
  if (Math.random() >= chance) return null;
  const pool = ENEMY_PART_POOL[enemyType] ?? ["servo", "frame"];
  const tier = rollTier(ENEMY_PART_QUALITY[enemyType] ?? 0.1);
  return { partId: partIdFor(pick(pool), tier), amount: 1 };
}

/** Roll a modular-part drop for a destroyed environment prop (rare). */
export function rollPropModularPart(): { partId: string; amount: number } | null {
  if (Math.random() >= 0.08) return null;
  const pool: PartKind[] = ["servo", "frame", "power_core", "pet_chassis"];
  return { partId: partIdFor(pick(pool), rollTier(0.1)), amount: 1 };
}

/** Roll a modular-part bonus for an opened chest (generous — chests are rare). */
export function rollChestModularPart(): { partId: string; amount: number } | null {
  if (Math.random() >= 0.45) return null;
  return { partId: partIdFor(pick(PART_KINDS), rollTier(0.45)), amount: 1 };
}
