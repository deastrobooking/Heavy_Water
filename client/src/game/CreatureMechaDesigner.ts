import { RobotDescriptor, RobotStyle } from "./RobotDesigner";
import {
  BioCreatureSpecies, Archetype, ElementalType, Rarity,
} from "./BioSpecies";

/**
 * CreatureMechaDesigner — the SINGLE source of truth for turning a data-only
 * `BioCreatureSpecies` into a renderable `RobotDescriptor`. Both the wild
 * `BioCreatureSystem` and the top-3 `ActivePetSystem` followers call
 * `buildCreatureDescriptor()` so a captured creature and its animated follower
 * are visually identical (they used to diverge — the follower path built a
 * generic chibi and skipped the archetype/type/rarity rigs entirely).
 *
 * The pipeline is: base chibi chassis → archetype silhouette → elemental
 * accents → rarity flair → expressive face → evolution stage. Everything is
 * pure procedural style mutation; no new geometry files or textures, and the
 * evolution stage is DERIVED from the already-persisted level + bond (no save
 * schema change).
 */

export interface CreatureBuildOpts {
  /** Captured creature level (wild = 1). Drives evolution stage. */
  level?: number;
  /** Captured bond level 0-20 (wild = 0). Drives evolution stage. */
  bond?: number;
  /** Followers render slightly smaller and ARTICULATED (un-merged) so the
   *  ActivePetSystem can animate their limbs/glow by mesh name. Wild
   *  creatures stay merged for draw-call economy. */
  follower?: boolean;
}

/** Human-readable evolution stage labels for the Bio Garden UI. */
export const EVOLUTION_STAGE_NAMES = ["Prototype", "Enhanced", "Advanced", "Prime"] as const;

/** Level/bond gates for reaching stage index+1. Kept here so the UI's
 *  "next stage" hint stays in lockstep with `deriveEvolutionStage`. */
export const EVOLUTION_THRESHOLDS: { level: number; bond: number }[] = [
  { level: 4, bond: 0 },   // → stage 1 (Enhanced)
  { level: 10, bond: 6 },  // → stage 2 (Advanced)
  { level: 18, bond: 12 }, // → stage 3 (Prime)
];

/** Visible evolution stage 0-3 derived purely from level + bond. Care raises
 *  both together, so a well-tended creature climbs the stages. */
export function deriveEvolutionStage(level: number, bond: number): 0 | 1 | 2 | 3 {
  const lv = Math.max(1, level || 1);
  const bd = Math.max(0, bond || 0);
  if (lv >= EVOLUTION_THRESHOLDS[2].level && bd >= EVOLUTION_THRESHOLDS[2].bond) return 3;
  if (lv >= EVOLUTION_THRESHOLDS[1].level && bd >= EVOLUTION_THRESHOLDS[1].bond) return 2;
  if (lv >= EVOLUTION_THRESHOLDS[0].level && bd >= EVOLUTION_THRESHOLDS[0].bond) return 1;
  return 0;
}

/** Chibi mecha chassis shared by every creature before the rigs run. Short
 *  stout torso, oversized head, big face — reads as a cute battle-bot mascot. */
function baseChibiStyle(species: BioCreatureSpecies): RobotStyle {
  return {
    archetype: "pet",
    scale: species.scale,
    torsoWidth: 0.85, torsoHeight: 0.55, torsoDepth: 0.85,
    headSize: 0.55, headShape: "sphere",
    armLength: 0.42, armThickness: 0.13, armStyle: "cylinder",
    legLength: 0.42, legThickness: 0.18, legStyle: "box",
    shoulderPadSize: 0.18, hipPadSize: 0.22,
    hasWings: false, wingSpan: 1.0, wingAngle: 0.4,
    hasCannons: false, cannonSize: 0.2,
    hasBackpack: false, backpackSize: 0.4,
    hasVisor: true, visorStyle: "round",
    hasHorns: false, hornLength: 0.25,
    hasTail: false, tailLength: 0.5, tailSegments: 4,
    hasAntennae: false, antennaLength: 0.25,
    hasShield: false, shieldSize: 0.6,
    extraPlating: 0, asymmetry: 0,
    hasPanelLines: true, panelLineDensity: 1.2,
    colors: {
      primary: species.primary,
      secondary: species.secondary,
      emissive: species.emissive,
    },
  };
}

/**
 * Build the full descriptor for a species. `opts.level`/`opts.bond` drive the
 * evolution stage; `opts.follower` shrinks + articulates the rig.
 */
export function buildCreatureDescriptor(
  species: BioCreatureSpecies,
  opts: CreatureBuildOpts = {},
): RobotDescriptor {
  const t = species.elementalType;
  const a = species.archetype;
  const style = baseChibiStyle(species);

  applyArchetype(a, style);
  applyTypeAccents(t, style);
  applyRarityFlair(style, species.rarity);
  applyFace(a, t, style);
  applyEvolutionStage(style, deriveEvolutionStage(opts.level ?? 1, opts.bond ?? 0));

  if (opts.follower) {
    // Companion-sized so the trio orbiting the player reads clearly without
    // clipping the camera; evolution still scales them up over time.
    style.scale *= 0.85;
  }

  return {
    name: species.name,
    faction: "pet",
    style,
    articulate: !!opts.follower,
  };
}

// ============================================================ archetype rigs
// Each archetype mutates the base style to give the pet a recognizable
// silhouette. The player sees a bunny by its tall ear-antennae, a dragon
// by its wings + horns + tail, a turtle by its shell-backpack, etc.

function applyArchetype(a: Archetype, s: RobotStyle): void {
  switch (a) {
    case "fox":
      s.headSize = 0.6; s.headShape = "sphere";
      s.hasTail = true; s.tailLength = 0.7; s.tailSegments = 5;
      s.hasAntennae = true; s.antennaLength = 0.35; // ears
      s.legStyle = "digitigrade"; s.legLength = 0.45;
      s.visorStyle = "round";
      break;
    case "cat":
      s.headSize = 0.6; s.headShape = "sphere";
      s.hasTail = true; s.tailLength = 0.65; s.tailSegments = 5;
      s.hasAntennae = true; s.antennaLength = 0.3;
      s.legStyle = "digitigrade"; s.legLength = 0.42;
      s.torsoWidth = 0.8; s.torsoHeight = 0.5;
      break;
    case "bunny":
      s.headSize = 0.55; s.headShape = "sphere";
      s.hasAntennae = true; s.antennaLength = 0.7; // tall ears
      s.hasTail = true; s.tailLength = 0.18; s.tailSegments = 2;
      s.legStyle = "digitigrade"; s.legLength = 0.55;
      s.legThickness = 0.22;
      s.visorStyle = "round";
      break;
    case "mouse":
      s.scale *= 0.85;
      s.headSize = 0.6; s.headShape = "sphere";
      s.hasAntennae = true; s.antennaLength = 0.35;
      s.hasTail = true; s.tailLength = 0.85; s.tailSegments = 6;
      s.torsoHeight = 0.45;
      break;
    case "pup":
      s.headSize = 0.6; s.headShape = "sphere";
      s.hasTail = true; s.tailLength = 0.4; s.tailSegments = 3;
      s.hasAntennae = true; s.antennaLength = 0.28;
      s.legStyle = "digitigrade"; s.legLength = 0.45;
      s.torsoWidth = 0.85;
      break;
    case "beetle":
      s.headSize = 0.5; s.headShape = "sphere";
      s.hasHorns = true; s.hornLength = 0.45;
      s.hasAntennae = true; s.antennaLength = 0.4;
      s.hasBackpack = true; s.backpackSize = 0.55; // shell
      s.extraPlating = 2;
      s.legLength = 0.32;
      break;
    case "frog":
      s.headSize = 0.65; s.headShape = "sphere";
      s.legLength = 0.6; s.legThickness = 0.22;
      s.hasAntennae = true; s.antennaLength = 0.18;
      s.torsoWidth = 0.95; s.torsoHeight = 0.5;
      s.visorStyle = "full";
      break;
    case "lizard":
      s.headSize = 0.55; s.headShape = "cone";
      s.hasTail = true; s.tailLength = 0.85; s.tailSegments = 6;
      s.legStyle = "digitigrade"; s.legLength = 0.4;
      s.extraPlating = 1;
      break;
    case "salamander":
      s.headSize = 0.55; s.headShape = "cone";
      s.hasTail = true; s.tailLength = 0.95; s.tailSegments = 7;
      s.legLength = 0.32; s.legThickness = 0.16;
      s.torsoHeight = 0.45;
      break;
    case "serpent":
      s.headSize = 0.5; s.headShape = "cone";
      s.hasTail = true; s.tailLength = 1.4; s.tailSegments = 9;
      s.hasWings = true; s.wingSpan = 0.9; s.wingAngle = 0.2;
      s.legLength = 0.18; s.legThickness = 0.1;
      s.torsoHeight = 0.4; s.torsoWidth = 0.6;
      break;
    case "owl":
      s.headSize = 0.65; s.headShape = "sphere";
      s.hasWings = true; s.wingSpan = 1.3; s.wingAngle = 0.45;
      s.hasAntennae = true; s.antennaLength = 0.3; // ear tufts
      s.legLength = 0.35;
      s.visorStyle = "full";
      break;
    case "bird":
      s.headSize = 0.55; s.headShape = "cone";
      s.hasWings = true; s.wingSpan = 1.4; s.wingAngle = 0.5;
      s.hasTail = true; s.tailLength = 0.55; s.tailSegments = 4;
      s.legStyle = "digitigrade"; s.legLength = 0.4;
      break;
    case "dragon":
      s.headSize = 0.6; s.headShape = "cone";
      s.hasHorns = true; s.hornLength = 0.5;
      s.hasWings = true; s.wingSpan = 1.5; s.wingAngle = 0.5;
      s.hasTail = true; s.tailLength = 0.95; s.tailSegments = 6;
      s.extraPlating = 2;
      s.legStyle = "digitigrade"; s.legLength = 0.5;
      break;
    case "fish":
      s.headSize = 0.6; s.headShape = "cone";
      s.hasWings = true; s.wingSpan = 0.7; s.wingAngle = 0.7; // fins
      s.hasTail = true; s.tailLength = 0.7; s.tailSegments = 3;
      s.legLength = 0.15; s.legThickness = 0.08;
      s.torsoWidth = 0.6; s.torsoHeight = 0.6; s.torsoDepth = 1.0;
      break;
    case "crab":
      s.torsoWidth = 1.05; s.torsoHeight = 0.45; s.torsoDepth = 0.95;
      s.shoulderPadSize = 0.4;
      s.hasAntennae = true; s.antennaLength = 0.25;
      s.armLength = 0.55; s.armStyle = "tapered";
      s.legLength = 0.3;
      s.extraPlating = 2;
      break;
    case "turtle":
      s.torsoWidth = 0.9; s.torsoHeight = 0.55;
      s.hasBackpack = true; s.backpackSize = 0.85; // shell
      s.hasTail = true; s.tailLength = 0.3; s.tailSegments = 2;
      s.legLength = 0.32; s.legThickness = 0.22;
      s.extraPlating = 3;
      break;
    case "bear":
      s.scale *= 1.05;
      s.headSize = 0.6; s.headShape = "sphere";
      s.hasAntennae = true; s.antennaLength = 0.2;
      s.torsoWidth = 1.1; s.torsoHeight = 0.7; s.torsoDepth = 0.95;
      s.armThickness = 0.22; s.armLength = 0.55;
      s.legLength = 0.5; s.legThickness = 0.28;
      s.extraPlating = 2;
      break;
    case "monkey":
      s.headSize = 0.55; s.headShape = "sphere";
      s.armLength = 0.7; s.armStyle = "tapered";
      s.hasTail = true; s.tailLength = 1.0; s.tailSegments = 7;
      s.legStyle = "digitigrade"; s.legLength = 0.5;
      break;
    case "golem":
      s.scale *= 1.15;
      s.headShape = "box"; s.headSize = 0.55;
      s.torsoWidth = 1.2; s.torsoHeight = 0.85; s.torsoDepth = 1.05;
      s.armThickness = 0.28; s.armStyle = "box";
      s.legThickness = 0.32; s.legLength = 0.55;
      s.extraPlating = 3;
      s.shoulderPadSize = 0.45;
      break;
    case "flutter":
      s.scale *= 0.9;
      s.headSize = 0.5;
      s.hasWings = true; s.wingSpan = 1.5; s.wingAngle = 0.6;
      s.hasAntennae = true; s.antennaLength = 0.45;
      s.legLength = 0.25; s.legThickness = 0.1;
      s.torsoHeight = 0.4; s.torsoWidth = 0.55;
      break;
    case "slime":
      s.headSize = 0.85; s.headShape = "sphere";
      s.torsoWidth = 1.0; s.torsoHeight = 0.4; s.torsoDepth = 1.0;
      s.armLength = 0.25; s.armThickness = 0.1;
      s.legLength = 0.15; s.legThickness = 0.18;
      s.visorStyle = "round";
      break;
    case "bot":
      s.scale *= 0.95;
      s.headSize = 0.66; s.headShape = "box";
      s.torsoWidth = 0.72; s.torsoHeight = 0.55; s.torsoDepth = 0.68;
      s.armLength = 0.32; s.armThickness = 0.12; s.armStyle = "box";
      s.legLength = 0.26; s.legThickness = 0.18; s.legStyle = "box";
      s.hasAntennae = true; s.antennaLength = 0.28;
      s.hasBackpack = true; s.backpackSize = 0.36;
      s.hasVisor = true; s.visorStyle = "round";
      s.extraPlating = Math.max(s.extraPlating, 1);
      s.bootStyle = "rounded"; s.gauntletStyle = "rounded";
      break;
    case "drone":
      s.scale *= 0.86;
      s.headSize = 0.62; s.headShape = "sphere";
      s.torsoWidth = 0.58; s.torsoHeight = 0.42; s.torsoDepth = 0.58;
      s.armLength = 0.18; s.armThickness = 0.08;
      s.legLength = 0.16; s.legThickness = 0.10; s.legStyle = "hoverpads";
      s.hasWings = true; s.wingSpan = 1.0; s.wingAngle = 0.78;
      s.hasAntennae = true; s.antennaLength = 0.36;
      s.hasBackpackEngine = true; s.engineVentCount = 2;
      s.hasVisor = true; s.visorStyle = "full";
      break;
    case "roller":
      s.scale *= 0.9;
      s.headSize = 0.56; s.headShape = "sphere";
      s.torsoWidth = 0.88; s.torsoHeight = 0.44; s.torsoDepth = 0.98;
      s.armLength = 0.24; s.armThickness = 0.10; s.armStyle = "tapered";
      s.legLength = 0.18; s.legThickness = 0.16;
      s.hasWheels = true; s.wheelStyle = "feet"; s.bootStyle = "wheeled";
      s.hasBackpack = true; s.backpackSize = 0.42;
      s.hasVisor = true; s.visorStyle = "round";
      s.extraPlating = Math.max(s.extraPlating, 1);
      break;
  }
}

/** Type-themed accent flourishes that don't override archetype silhouette.
 *  Each type adds two or more visible flairs (horns, antennae, wings,
 *  visor, plating, panel lines, asymmetry, glowing tail, etc.) so a
 *  player can read the elemental type at a glance even before the colour
 *  palette registers. */
function applyTypeAccents(t: ElementalType, s: RobotStyle): void {
  switch (t) {
    case "flame":
      // Twin horns + a subtle asymmetric plate so flame creatures read
      // as "battle-scarred fire-breathers" rather than just "orange".
      s.hasHorns = true; s.hornLength = Math.max(s.hornLength, 0.35);
      s.hasTail = s.hasTail || true;
      s.tailLength = Math.max(s.tailLength, 0.55);
      s.panelLineDensity = (s.panelLineDensity ?? 1.0) * 1.2;
      s.asymmetry = Math.max(s.asymmetry, 0.15);
      break;
    case "electric":
      // Long whip antennae + amplified emissive panel lines.
      s.hasAntennae = true; s.antennaLength = Math.max(s.antennaLength, 0.55);
      s.panelLineDensity = (s.panelLineDensity ?? 1.0) * 1.4;
      break;
    case "ice":
      // Heavy plating like rime caked on, with a chest plate (backpack).
      s.extraPlating = Math.max(s.extraPlating, 2);
      s.hasBackpack = s.hasBackpack || true;
      s.backpackSize = Math.max(s.backpackSize, 0.5);
      break;
    case "crystal":
      // Geometric plating + cone horns reading as raw crystal shards.
      s.extraPlating = Math.max(s.extraPlating, 3);
      s.hasHorns = true; s.hornLength = Math.max(s.hornLength, 0.4);
      break;
    case "psychic":
      // Tall single antenna for that mind-control silhouette (the face
      // pass gives psychics their glowing cheek nodes).
      s.hasAntennae = true; s.antennaLength = Math.max(s.antennaLength, 0.5);
      break;
    case "evil":
      // Asymmetric, jagged silhouette: shoulder asymmetry + dense panel
      // lines + a single longer horn make evil units look unhinged
      // rather than merely shadowy.
      s.panelLineDensity = (s.panelLineDensity ?? 1.0) * 1.6;
      s.asymmetry = Math.max(s.asymmetry, 0.35);
      s.hasHorns = true; s.hornLength = Math.max(s.hornLength, 0.45);
      s.shoulderPadSize = Math.max(s.shoulderPadSize, 0.3);
      break;
    case "steel":
      // Boxy heavy industrial silhouette.
      s.extraPlating = Math.max(s.extraPlating, 3);
      s.armStyle = "box";
      s.shoulderPadSize = Math.max(s.shoulderPadSize, 0.32);
      break;
    case "dragon":
      // Wings + horns + a long armoured tail.
      s.hasWings = true; s.wingSpan = Math.max(s.wingSpan, 1.2);
      s.hasHorns = true; s.hornLength = Math.max(s.hornLength, 0.45);
      s.hasTail = true; s.tailLength = Math.max(s.tailLength, 1.0);
      s.extraPlating = Math.max(s.extraPlating, 2);
      break;
    case "water":
      // Side fins (small wings, swept back) + a flow-cell backpack so
      // water mons stop looking like blue-painted normal mons.
      s.hasWings = true; s.wingSpan = Math.max(s.wingSpan, 0.7);
      s.wingAngle = Math.max(s.wingAngle, 0.65);
      s.hasBackpack = s.hasBackpack || true;
      s.backpackSize = Math.max(s.backpackSize, 0.45);
      break;
    case "grass":
      // Leafy ear-antennae + a small back tuft (backpack) reading as
      // sprouting foliage.
      s.hasAntennae = true; s.antennaLength = Math.max(s.antennaLength, 0.45);
      s.hasBackpack = s.hasBackpack || true;
      s.backpackSize = Math.max(s.backpackSize, 0.4);
      s.panelLineDensity = (s.panelLineDensity ?? 1.0) * 0.8;
      break;
    case "normal":
      // Reads as a clean utility chassis — short tufts, no extra plating clutter.
      s.hasAntennae = s.hasAntennae || true;
      s.antennaLength = Math.max(s.antennaLength, 0.25);
      break;
    default:
      break;
  }
}

/** Bigger / shinier rare and legendary mons read as "boss-tier" without
 *  needing custom geometry per species. Uses Math.max so an archetype
 *  that already sets a higher value isn't shrunk back down. */
function applyRarityFlair(s: RobotStyle, rarity: Rarity): void {
  switch (rarity) {
    case "rare":
      s.scale *= 1.08;
      s.extraPlating = Math.max(s.extraPlating, 1);
      s.shoulderPadSize = Math.max(s.shoulderPadSize, 0.25);
      s.hasPanelLines = true;
      s.panelLineDensity = (s.panelLineDensity ?? 1.0) * 1.15;
      break;
    case "legendary":
      s.scale *= 1.18;
      s.extraPlating = Math.max(s.extraPlating, 2);
      s.shoulderPadSize = Math.max(s.shoulderPadSize, 0.32);
      s.panelLineDensity = (s.panelLineDensity ?? 1.0) * 1.3;
      s.hasHorns = s.hasHorns || true;
      s.hornLength = Math.max(s.hornLength, 0.42);
      s.hasShield = s.hasShield || true;
      s.shieldSize = Math.max(s.shieldSize, 0.8);
      s.hasCannons = s.hasCannons || true;
      s.cannonSize = Math.max(s.cannonSize, 0.26);
      break;
    case "uncommon":
    case "common":
    default:
      break;
  }
}

/** Expressive Digimon-style faces. Replaces the single visor band with per-
 *  archetype eyes + mouth + brow + cheek lights so creatures emote at a
 *  glance. All parts are procedural meshes built by RobotFactory.buildFace. */
function applyFace(a: Archetype, t: ElementalType, s: RobotStyle): void {
  s.hasFace = true;
  s.hasVisor = false; // the face supersedes the plain visor band
  s.eyeSize = s.headSize * 0.22;
  s.mouthStyle = "none";
  s.hasBrow = false;
  s.hasCheekLights = false;

  switch (a) {
    case "fox": case "cat": case "pup": case "bunny": case "mouse":
      s.faceStyle = "twinEyes"; s.mouthStyle = "fang"; s.hasBrow = true;
      break;
    case "bear": case "monkey":
      s.faceStyle = "twinEyes"; s.mouthStyle = "jaw"; s.hasBrow = true;
      break;
    case "owl": case "bird":
      s.faceStyle = "twinEyes"; s.eyeSize = s.headSize * 0.3; s.mouthStyle = "beak";
      break;
    case "beetle": case "crab":
      s.faceStyle = "insectEyes"; s.mouthStyle = "grill";
      break;
    case "fish": case "frog": case "turtle": case "serpent":
      s.faceStyle = "visorFace"; s.hasCheekLights = true;
      break;
    case "lizard": case "salamander": case "dragon":
      s.faceStyle = "twinEyes"; s.mouthStyle = "fang"; s.hasBrow = true;
      break;
    case "golem":
      s.faceStyle = "singleEye"; s.mouthStyle = "grill";
      break;
    case "slime":
      s.faceStyle = "twinEyes";
      break;
    case "bot": case "roller":
      s.faceStyle = "visorFace"; s.hasCheekLights = true;
      break;
    case "drone":
      s.faceStyle = "singleEye";
      break;
    default:
      s.faceStyle = "twinEyes"; s.mouthStyle = "grill";
      break;
  }

  // Energy types wear glowing cheek nodes to read as "charged".
  if (t === "electric" || t === "psychic") s.hasCheekLights = true;
}

/** Visible evolution: pure style mutations keyed to the derived stage so a
 *  higher-level/bonded creature looks progressively more advanced (bigger,
 *  more plating, horns, cheek nodes, brighter glow). Bounded so followers
 *  never balloon past their hitbox / the camera. */
function applyEvolutionStage(s: RobotStyle, stage: number): void {
  s.emissiveBoost = 1;
  if (stage >= 1) {
    s.scale *= 1.06;
    s.extraPlating = Math.max(s.extraPlating, 1);
    s.panelLineDensity = (s.panelLineDensity ?? 1.0) * 1.1;
    s.hasBrow = true;
    s.emissiveBoost = 1.18;
  }
  if (stage >= 2) {
    s.scale *= 1.06;
    s.shoulderPadSize = Math.max(s.shoulderPadSize, 0.3);
    s.hasHorns = s.hasHorns || true;
    s.hornLength = Math.max(s.hornLength, 0.35);
    s.hasCheekLights = true;
    s.extraPlating = Math.max(s.extraPlating, 2);
    s.emissiveBoost = 1.32;
  }
  if (stage >= 3) {
    s.scale *= 1.06;
    s.hasShield = s.hasShield || true;
    s.shieldSize = Math.max(s.shieldSize, 0.7);
    s.hasBackpack = s.hasBackpack || true;
    s.backpackSize = Math.max(s.backpackSize, 0.5);
    s.hornLength = Math.max(s.hornLength, 0.5);
    s.asymmetry = Math.max(s.asymmetry, 0.12);
    s.emissiveBoost = 1.5;
  }
}

/** Archetypes that hover/fly — used by BioCreatureSystem for wild bob height. */
export function isFlyer(a: Archetype): boolean {
  return a === "owl" || a === "bird" || a === "serpent" || a === "dragon" || a === "flutter" || a === "fish" || a === "drone";
}
