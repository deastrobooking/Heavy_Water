import * as BABYLON from "@babylonjs/core";
import { RobotFactory } from "./RobotFactory";
import { buildCreatureDescriptor } from "./CreatureMechaDesigner";
import { getSpeciesById } from "./BioSpecies";
import { EventBus, GameEvents } from "./EventBus";
import { ElementType } from "./ArmorSystem";
import type { CapturedCreature } from "./BioCreatureSystem";

export interface ActivePetEntry {
  creatureId: string;
  speciesId: string;
  name: string;
  level: number;
  bondLevel: number;
  elementalType: string;
}

export interface PetAugmentBonuses {
  damageMul: number;
  fireRateMul: number;
  speedMul: number;
  defense: number;       // flat damage-reduction fraction [0, 0.25]
  shieldRegen: number;
  healthRegen: number;
  critChance: number;
  summary: string;
}

/** Named robot-collection "armor set" bonus, fed into the modular-armor
 *  bonus pipeline (ArmorSystem.getModuleBonuses) so it reaches the player
 *  alongside looted/capsule armor modules. */
export interface RobotComboBonus {
  name: string;
  damageMul: number;       // additive pre-clamp fraction
  fireRateMul: number;
  speedMul: number;
  critChance: number;
  damageReduction: number; // additive pre-clamp fraction
}

/** Procedural-animation handles captured once at spawn so the per-frame
 *  pass doesn't re-scan the mesh tree. Glow parts breathe via per-mesh
 *  scaling (their StandardMaterials are shared/cached by RobotFactory, so
 *  emissive color can't be animated without affecting every other robot). */
interface PetAnimParts {
  legs: { mesh: BABYLON.AbstractMesh; baseRotX: number; side: number }[];
  arms: { mesh: BABYLON.AbstractMesh; baseRotX: number; side: number }[];
  glow: { mesh: BABYLON.AbstractMesh; baseScale: BABYLON.Vector3 }[];
  head: BABYLON.AbstractMesh | null;
}

interface LivePet {
  entry: ActivePetEntry;
  root: BABYLON.TransformNode;
  hitbox: BABYLON.Mesh;
  bobTimer: number;
  gaitPhase: number;
  facing: number;
  supportCooldown: number;
  anim: PetAnimParts;
}

const MAX_ACTIVE_PETS = 3;
const PET_SUPPORT_RANGE_SQ = 26 * 26;
const PET_SUPPORT_INTERVAL = 2.8;
const PET_FOLLOW_RESPONSE = 8;
const PET_TURN_RESPONSE = 11;
const PET_CATCHUP_DISTANCE_SQ = 24 * 24;
const PET_MIN_SEPARATION = 1.35;
const PET_FORMATION: ReadonlyArray<readonly [number, number]> = [
  [-1.8, -2.25],
  [1.8, -2.25],
  [0, -3.6],
];

const LEG_NAMES = new Set(["th", "sn", "ft"]);
const ARM_NAMES = new Set(["ua", "fa", "hd"]);
const GLOW_NAMES = new Set(["v", "antTip", "cg", "core", "wt", "tl", "lg", "mz", "eye", "chk"]);

type PetTarget = BABYLON.Mesh;
type PetDamageRouter = (mesh: BABYLON.AbstractMesh, damage: number) => void;
type PetHealRouter = (amount: number) => void;

export type PetAssignment = { creatureId: string; level: number };

/** Legacy saves have no activePets field, so they retain the historic
 * strongest-three selection. Kept pure so save migration behavior is easy to
 * cover without constructing a Babylon scene. */
export function strongestPetAssignment(captured: CapturedCreature[]): PetAssignment[] {
  return captured
    .filter(c => !!getSpeciesById(c.speciesId))
    .slice()
    .sort((a, b) => (b.level ?? 1) - (a.level ?? 1))
    .slice(0, MAX_ACTIVE_PETS)
    .map(c => ({ creatureId: c.id, level: c.level ?? 1 }));
}

/** Preserve each saved slot while repairing only invalid/duplicate slots.
 * Valid selections reserve their ids before repair, so a replacement can
 * never displace or reorder a surviving selection. */
export function normalizePetAssignment(
  assignment: PetAssignment[],
  source: CapturedCreature[],
  repairMissing: boolean,
): PetAssignment[] {
  const valid = source.filter(c => !!getSpeciesById(c.speciesId));
  const byId = new Map(valid.map(c => [c.id, c]));
  const ranked = valid.slice().sort((a, b) => (b.level ?? 1) - (a.level ?? 1));
  const reserved = new Set<string>();
  const savedSlots = assignment.slice(0, MAX_ACTIVE_PETS).map(saved => {
    const creature = byId.get(saved.creatureId);
    if (!creature || reserved.has(creature.id)) return { saved, creature: undefined };
    reserved.add(creature.id);
    return { saved, creature };
  });
  const used = new Set(reserved);
  const normalized: PetAssignment[] = [];

  for (const slot of savedSlots) {
    let creature = slot.creature;
    if (!creature && repairMissing) {
      creature = ranked.find(candidate => !used.has(candidate.id));
    }
    if (!creature) continue;
    used.add(creature.id);
    normalized.push({ creatureId: creature.id, level: creature.level ?? slot.saved.level ?? 1 });
  }
  return normalized;
}

/** Frame-rate independent follower movement with a bounded catch-up snap. */
export function calculatePetFollowStep(
  current: BABYLON.Vector3,
  target: BABYLON.Vector3,
  dt: number,
): BABYLON.Vector3 {
  const frameDt = Math.max(0, Math.min(0.1, dt));
  if (frameDt <= 0) return current.clone();
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dz = target.z - current.z;
  if (dx * dx + dy * dy + dz * dz > PET_CATCHUP_DISTANCE_SQ) return target.clone();
  const moveAlpha = 1 - Math.exp(-PET_FOLLOW_RESPONSE * frameDt);
  return new BABYLON.Vector3(
    current.x + dx * moveAlpha,
    current.y + dy * moveAlpha,
    current.z + dz * moveAlpha,
  );
}

/** Map a creature's bio elemental type to an ArmorSystem weapon element.
 *  Returns null for families that don't map to a combat element. */
function elementalToWeaponElement(el: string): ElementType | null {
  switch (el) {
    case "flame":
    case "dragon":
      return ElementType.Fire;
    case "ice":
    case "water":
      return ElementType.Ice;
    case "electric":
    case "psychic":
      return ElementType.Electric;
    case "evil":
      return ElementType.DarkEnergy;
    case "grass":
      return ElementType.Insectoid;
    default:
      return null;
  }
}

/** Coarse elemental "family" used to name robot armor-set combos. */
function elementalFamily(el: string): string {
  switch (el) {
    case "flame":
    case "dragon":
    case "evil":
      return "Pyro";
    case "ice":
    case "water":
      return "Cryo";
    case "electric":
    case "psychic":
      return "Volt";
    case "grass":
      return "Verdant";
    default:
      return "Forge";
  }
}

export class ActivePetSystem {
  private scene: BABYLON.Scene;
  private factory: RobotFactory;
  private bus: EventBus;
  private pets: LivePet[] = [];
  private entries: ActivePetEntry[] = [];
  /** One-step, session-only undo buffer. An empty array is meaningful: it
   * represents the player's intentionally empty lineup. */
  private previousLoadout: { creatureId: string; level: number }[] | null = null;
  /** False for old saves/new games until the player makes a choice or a
   *  persisted activePets array is restored. Legacy mode keeps the historic
   *  strongest-three behavior; explicit mode preserves the chosen roster. */
  private hasExplicitLoadout = false;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.factory = new RobotFactory(scene);
    this.bus = EventBus.getInstance();
  }

  /** Populate the active-pet roster from captured creatures.
   *  `source` is the full garden roster; only creatures whose ids appear
   *  in `assignment` become active followers. */
  assignPets(
    assignment: { creatureId: string; level: number }[],
    source: CapturedCreature[],
  ): void {
    this.hasExplicitLoadout = true;
    const next = this.normalizeAssignment(assignment, source, false);
    if (this.assignmentSignature(next) !== this.assignmentSignature(this.serialize())) {
      this.previousLoadout = this.serialize();
    }
    this.applyAssignment(next, source);
  }

  /** Restore a persisted player-selected lineup. The saved array's presence
   *  marks the loadout explicit even when it is empty. Invalid/duplicate saved
   *  ids are repaired one-for-one from the strongest unused valid captures,
   *  while intentionally unused slots remain unused. */
  restorePets(
    assignment: { creatureId: string; level: number }[],
    source: CapturedCreature[],
  ): void {
    this.hasExplicitLoadout = true;
    this.applyAssignment(this.normalizeAssignment(assignment, source, true), source);
  }

  private applyAssignment(
    assignment: { creatureId: string; level: number }[],
    source: CapturedCreature[],
  ): void {
    const nextEntries: ActivePetEntry[] = [];
    for (const a of assignment.slice(0, MAX_ACTIVE_PETS)) {
      const creature = source.find(c => c.id === a.creatureId);
      if (!creature) continue;
      const sp = getSpeciesById(creature.speciesId);
      if (!sp) continue;
      const entry: ActivePetEntry = {
        creatureId: a.creatureId,
        speciesId: creature.speciesId,
        name: creature.name,
        // CapturedCreature is the canonical progression record. Saved
        // active-pet levels are retained for schema compatibility only.
        level: Math.max(1, Math.min(100, creature.level ?? a.level ?? 1)),
        bondLevel: Math.max(0, creature.bondLevel ?? 0),
        elementalType: sp.elementalType,
      };
      nextEntries.push(entry);
    }

    const nextSig = nextEntries.map(e => `${e.creatureId}:${e.level}:${e.bondLevel}`).join("|");
    const curSig = this.entries.map(e => `${e.creatureId}:${e.level}:${e.bondLevel}`).join("|");
    if (nextSig === curSig) return;

    this.clearPets();
    this.entries = nextEntries;
    for (const entry of this.entries) {
      this.spawnLivePet(entry);
    }
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
  }

  /** Refresh the active roster from the canonical captured-creature records.
   *  Legacy saves still auto-select the strongest three. Once an explicit
   *  lineup exists, order/count are preserved and only missing selected slots
   *  are repaired; level/bond/appearance refresh without silent reordering. */
  syncFromCaptured(captured: CapturedCreature[]): void {
    const assignment = this.hasExplicitLoadout
      ? this.normalizeAssignment(this.serialize(), captured, true)
      : this.strongestAssignment(captured);
    this.applyAssignment(assignment, captured);
  }

  private strongestAssignment(captured: CapturedCreature[]): { creatureId: string; level: number }[] {
    return captured
      .filter(c => !!getSpeciesById(c.speciesId))
      .slice()
      .sort((a, b) => (b.level ?? 1) - (a.level ?? 1))
      .slice(0, MAX_ACTIVE_PETS)
      .map(c => ({ creatureId: c.id, level: c.level ?? 1 }));
  }

  private normalizeAssignment(
    assignment: { creatureId: string; level: number }[],
    source: CapturedCreature[],
    repairMissing: boolean,
  ): { creatureId: string; level: number }[] {
    const valid = source.filter(c => !!getSpeciesById(c.speciesId));
    const byId = new Map(valid.map(c => [c.id, c]));
    const ranked = valid.slice().sort((a, b) => (b.level ?? 1) - (a.level ?? 1));
    const reserved = new Set<string>();
    const savedSlots = assignment.slice(0, MAX_ACTIVE_PETS).map(saved => {
      const creature = byId.get(saved.creatureId);
      if (!creature || reserved.has(creature.id)) return { saved, creature: undefined };
      reserved.add(creature.id);
      return { saved, creature };
    });
    const used = new Set(reserved);
    const normalized: { creatureId: string; level: number }[] = [];

    for (const slot of savedSlots) {
      let creature = slot.creature;
      if (!creature && repairMissing) {
        creature = ranked.find(candidate => !used.has(candidate.id));
      }
      if (!creature) continue;
      used.add(creature.id);
      normalized.push({ creatureId: creature.id, level: creature.level ?? slot.saved.level ?? 1 });
    }
    return normalized;
  }

  getEntries(): ActivePetEntry[] {
    return this.entries.slice();
  }

  getMaxPets(): number {
    return MAX_ACTIVE_PETS;
  }

  /** Whether a previous lineup can be restored during this session. */
  hasPreviousLoadout(): boolean {
    return this.previousLoadout !== null;
  }

  /** Restore the most recent lineup once. The buffer is consumed so repeated
   * undo presses cannot unexpectedly toggle between two lineups. */
  undoPreviousLoadout(source: CapturedCreature[]): boolean {
    if (this.previousLoadout === null) return false;
    const previous = this.previousLoadout;
    this.previousLoadout = null;
    this.hasExplicitLoadout = true;
    this.applyAssignment(this.normalizeAssignment(previous, source, false), source);
    return true;
  }

  /** Whether the player/save has explicitly chosen a loadout. Implicit legacy
   *  auto-fill must remain distinguishable so saves can keep omitting
   *  activePets until the player actually makes a selection. */
  hasExplicitSelection(): boolean {
    return this.hasExplicitLoadout;
  }

  private assignmentSignature(assignment: { creatureId: string; level: number }[]): string {
    return assignment.map(a => `${a.creatureId}:${a.level}`).join("|");
  }

  /** Recompute augment bonuses from the active roster.
   *  Each pet's elemental type determines which stat it boosts;
   *  magnitude scales with pet level (1-100). The robot armor-set combo
   *  (getComboBonus) is NOT folded in here — it is applied once through the
   *  ArmorSystem module-bonus pipeline — but its name rides in the summary. */
  getAugmentBonuses(): PetAugmentBonuses {
    let dmg = 0, fr = 0, spd = 0, def = 0, sRegen = 0, hRegen = 0, crit = 0;
    for (const e of this.entries) {
      // 0.4% per level. Each elemental family feeds a DISTINCT augment axis
      // so a varied active roster covers more of the player's kit.
      const power = 0.004 * e.level;
      switch (e.elementalType) {
        case "flame":
        case "dragon":
        case "evil":
          dmg += power;
          break;
        case "electric":
        case "psychic":
          fr += power * 0.8;
          break;
        case "crystal":
          crit += power * 0.5;
          break;
        case "ice":
        case "water":
          sRegen += power * 0.6;
          def += power * 0.4;
          break;
        case "grass":
          hRegen += power * 0.5;
          break;
        case "steel":
          def += power * 0.6;
          break;
        case "normal":
        default:
          spd += power * 0.5;
          break;
      }
    }
    // NOTE: the named robot combo is applied ONLY through the ArmorSystem
    // module-bonus pipeline (setRobotComboBonus), not folded in here, to avoid
    // double-counting. We still surface its name in the summary below.
    const combo = this.getComboBonus();

    const damageMul = 1 + Math.min(0.35, dmg);
    const fireRateMul = 1 + Math.min(0.25, fr);
    const speedMul = 1 + Math.min(0.18, spd);
    const defense = Math.min(0.25, def);
    const shieldRegen = Math.min(6.0, sRegen);
    const healthRegen = Math.min(5.0, hRegen);
    const critChance = Math.min(0.18, crit);
    const comboTag = combo.name ? ` · ${combo.name}` : "";
    const summary = `Pet Augments: +${Math.round((damageMul - 1) * 100)}% DMG, +${Math.round((speedMul - 1) * 100)}% SPD, +${Math.round(defense * 100)}% DEF, +${Math.round((fireRateMul - 1) * 100)}% FIRE, +${Math.round(critChance * 100)}% CRIT${comboTag}`;
    return { damageMul, fireRateMul, speedMul, defense, shieldRegen, healthRegen, critChance, summary };
  }

  /** Weapon element imbued by the active roster: the highest-level pet that
   *  maps to a combat element wins. null when no active pet maps to one. */
  getWeaponElement(): ElementType | null {
    let best: ActivePetEntry | null = null;
    for (const e of this.entries) {
      if (!elementalToWeaponElement(e.elementalType)) continue;
      if (!best || e.level > best.level) best = e;
    }
    return best ? elementalToWeaponElement(best.elementalType) : null;
  }

  /** Named robot-collection "armor set" combo derived from the elemental
   *  families present in the active roster. Empty name = no combo. */
  getComboBonus(): RobotComboBonus {
    const empty: RobotComboBonus = {
      name: "", damageMul: 0, fireRateMul: 0, speedMul: 0, critChance: 0, damageReduction: 0,
    };
    if (this.entries.length < 2) return empty;
    const families = new Set(this.entries.map(e => elementalFamily(e.elementalType)));
    const distinct = families.size;
    if (distinct >= 3) {
      return { name: "Spectrum Core", damageMul: 0.06, fireRateMul: 0.05, speedMul: 0.05, critChance: 0.04, damageReduction: 0.06 };
    }
    if (distinct === 2) {
      return { name: "Dual Forge", damageMul: 0.05, fireRateMul: 0.03, speedMul: 0.03, critChance: 0.02, damageReduction: 0.05 };
    }
    // All active pets share one family — a focused resonance set.
    const fam = Array.from(families)[0];
    switch (fam) {
      case "Pyro": return { name: "Pyro Resonance", damageMul: 0.10, fireRateMul: 0.02, speedMul: 0, critChance: 0.03, damageReduction: 0.02 };
      case "Cryo": return { name: "Cryo Resonance", damageMul: 0.02, fireRateMul: 0, speedMul: 0, critChance: 0, damageReduction: 0.10 };
      case "Volt": return { name: "Volt Resonance", damageMul: 0.03, fireRateMul: 0.10, speedMul: 0.03, critChance: 0.03, damageReduction: 0.02 };
      case "Verdant": return { name: "Verdant Resonance", damageMul: 0.02, fireRateMul: 0, speedMul: 0.06, critChance: 0, damageReduction: 0.06 };
      default: return { name: "Forge Resonance", damageMul: 0.04, fireRateMul: 0.02, speedMul: 0.06, critChance: 0.02, damageReduction: 0.06 };
    }
  }

  getComboName(): string {
    return this.getComboBonus().name;
  }

  /** Move followers and let each one fire a modest family-specific support
   * action. Targets are supplied by Game so pets use the same live enemy list
   * and damage router as player weapons and companion helpers. */
  update(
    dt: number,
    playerPos: BABYLON.Vector3,
    targets: PetTarget[] = [],
    routeDamage?: PetDamageRouter,
    healPlayer?: PetHealRouter,
  ): void {
    const frameDt = Math.max(0, Math.min(0.1, dt));
    if (frameDt <= 0) return;
    this.updateSupportActions(frameDt, playerPos, targets, routeDamage, healPlayer);
    const moveAlpha = 1 - Math.exp(-PET_FOLLOW_RESPONSE * frameDt);
    const turnAlpha = 1 - Math.exp(-PET_TURN_RESPONSE * frameDt);

    for (let i = 0; i < this.pets.length; i++) {
      const lp = this.pets[i];
      lp.bobTimer += frameDt * 2.5;
      const formation = PET_FORMATION[i] ?? PET_FORMATION[PET_FORMATION.length - 1];
      let targetX = playerPos.x + formation[0];
      let targetZ = playerPos.z + formation[1];
      const targetY = playerPos.y + 0.3 + Math.sin(lp.bobTimer) * 0.25;
      const p = lp.hitbox.position;

      // Lightweight local separation keeps followers from visually merging
      // while preserving their stable formation slots.
      for (let j = 0; j < this.pets.length; j++) {
        if (j === i) continue;
        const other = this.pets[j].hitbox.position;
        let dx = p.x - other.x;
        let dz = p.z - other.z;
        let distSq = dx * dx + dz * dz;
        if (distSq >= PET_MIN_SEPARATION * PET_MIN_SEPARATION) continue;
        if (distSq < 0.0001) {
          const angle = (i + 1) * 2.17 + j;
          dx = Math.cos(angle) * 0.01;
          dz = Math.sin(angle) * 0.01;
          distSq = dx * dx + dz * dz;
        }
        const dist = Math.sqrt(distSq);
        const push = (PET_MIN_SEPARATION - dist) * 0.5;
        targetX += (dx / dist) * push;
        targetZ += (dz / dist) * push;
      }

      const prevX = p.x, prevZ = p.z;
      const dx = targetX - p.x;
      const dy = targetY - p.y;
      const dz = targetZ - p.z;
      if (dx * dx + dy * dy + dz * dz > PET_CATCHUP_DISTANCE_SQ) {
        p.set(targetX, targetY, targetZ);
      } else {
        p.x += dx * moveAlpha;
        p.z += dz * moveAlpha;
        p.y += dy * moveAlpha;
      }

      // Face direction of travel (turn smoothly toward velocity).
      const vx = p.x - prevX, vz = p.z - prevZ;
      const distanceMoved = Math.hypot(vx, vz);
      const speed = distanceMoved / frameDt;
      if (speed > 0.04) {
        const want = Math.atan2(vx, vz);
        let delta = want - lp.facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        lp.facing += delta * turnAlpha;
        lp.root.rotation.y = lp.facing;
      }

      // Gait advances with travel speed (plus a small idle shuffle) so the
      // legs/arms swing while moving and settle when hovering in place.
      lp.gaitPhase += frameDt * (4 + Math.min(16, speed) * 3);
      const swing = Math.sin(lp.gaitPhase);
      for (const l of lp.anim.legs) l.mesh.rotation.x = l.baseRotX + swing * 0.45 * l.side;
      for (const a of lp.anim.arms) a.mesh.rotation.x = a.baseRotX - swing * 0.32 * a.side;

      // Emissive "breathing" via per-mesh scaling (safe — doesn't touch the
      // shared cached materials). The head is NOT spun: it now carries a face
      // (eyes/mouth/cheeks) that must stay oriented forward with the body.
      const pulse = 1 + 0.22 * Math.sin(lp.bobTimer * 1.6);
      for (const g of lp.anim.glow) {
        g.mesh.scaling.set(g.baseScale.x * pulse, g.baseScale.y * pulse, g.baseScale.z * pulse);
      }
    }
  }

  private updateSupportActions(
    dt: number,
    playerPos: BABYLON.Vector3,
    targets: PetTarget[],
    routeDamage?: PetDamageRouter,
    healPlayer?: PetHealRouter,
  ): void {
    for (const lp of this.pets) {
      lp.supportCooldown -= dt;
      if (lp.supportCooldown > 0) continue;

      const isVerdant = lp.entry.elementalType === "grass";
      let target: PetTarget | null = null;
      let nearestSq = PET_SUPPORT_RANGE_SQ;
      if (!isVerdant) {
        for (const candidate of targets) {
          if (!candidate || candidate.isDisposed() || !candidate.isEnabled()) continue;
          // The shared target scratch also contains props, ore, and structures.
          // Only enemy metadata is eligible for pet support attacks.
          const meta = candidate.metadata as any;
          if (!meta?.isEnemy && !meta?.aerialUnit) continue;
          const d = BABYLON.Vector3.DistanceSquared(lp.hitbox.position, candidate.position);
          if (d < nearestSq) {
            nearestSq = d;
            target = candidate;
          }
        }
      }

      // Missing targets do not consume the pet's shot opportunity; this keeps
      // a pet from firing into empty space while the player is exploring.
      if (!target && !isVerdant) {
        lp.supportCooldown = 0.2;
        continue;
      }

      const levelPower = Math.max(1, lp.entry.level);
      if (isVerdant) {
        const amount = 2.5 + levelPower * 0.08;
        healPlayer?.(amount);
        this.showSupportPulse(lp.hitbox.position, new BABYLON.Color3(0.25, 1, 0.4));
      } else if (target && routeDamage) {
        const damage = 7 + levelPower * 0.32;
        routeDamage(target, damage);
        const color = this.supportColor(lp.entry.elementalType);
        this.showSupportBolt(lp.hitbox.position, target.position, color);
      }
      // A small deterministic stagger prevents three active pets from
      // producing simultaneous flashes and keeps their cadence readable.
      lp.supportCooldown = PET_SUPPORT_INTERVAL + (this.pets.indexOf(lp) * 0.22);
    }
  }

  private supportColor(elementalType: string): BABYLON.Color3 {
    switch (elementalType) {
      case "flame":
      case "dragon":
      case "evil":
        return new BABYLON.Color3(1, 0.3, 0.08);
      case "ice":
      case "water":
        return new BABYLON.Color3(0.25, 0.8, 1);
      case "electric":
      case "psychic":
        return new BABYLON.Color3(0.8, 0.35, 1);
      case "crystal":
        return new BABYLON.Color3(1, 0.75, 0.25);
      case "steel":
        return new BABYLON.Color3(0.65, 0.75, 0.85);
      default:
        return new BABYLON.Color3(1, 1, 1);
    }
  }

  private showSupportBolt(from: BABYLON.Vector3, to: BABYLON.Vector3, color: BABYLON.Color3): void {
    const line = BABYLON.MeshBuilder.CreateLines("petSupportBolt", {
      points: [from.add(new BABYLON.Vector3(0, 0.25, 0)), to.clone()],
      colors: [color.toColor4(0.9), color.toColor4(0.9)],
    }, this.scene);
    window.setTimeout(() => {
      if (!line.isDisposed()) line.dispose();
    }, 140);
  }

  private showSupportPulse(position: BABYLON.Vector3, color: BABYLON.Color3): void {
    const ring = BABYLON.MeshBuilder.CreateTorus("petSupportPulse", {
      diameter: 1.5, thickness: 0.06, tessellation: 16,
    }, this.scene);
    ring.position.copyFrom(position);
    ring.position.y += 0.08;
    ring.rotation.x = Math.PI / 2;
    const material = new BABYLON.StandardMaterial("petSupportPulseMat", this.scene);
    material.emissiveColor = color;
    material.diffuseColor = color;
    material.alpha = 0.75;
    ring.material = material;
    window.setTimeout(() => {
      if (!ring.isDisposed()) ring.dispose();
      material.dispose();
    }, 220);
  }

  private captureAnimParts(root: BABYLON.TransformNode): PetAnimParts {
    const parts: PetAnimParts = { legs: [], arms: [], glow: [], head: null };
    for (const m of root.getChildMeshes(false)) {
      const n = m.name;
      if (LEG_NAMES.has(n)) {
        parts.legs.push({ mesh: m, baseRotX: m.rotation.x, side: Math.sign(m.position.x) || 1 });
      } else if (ARM_NAMES.has(n)) {
        parts.arms.push({ mesh: m, baseRotX: m.rotation.x, side: Math.sign(m.position.x) || 1 });
      } else if (GLOW_NAMES.has(n)) {
        parts.glow.push({ mesh: m, baseScale: m.scaling.clone() });
      } else if (n === "h" && !parts.head) {
        parts.head = m;
      }
    }
    return parts;
  }

  private spawnLivePet(entry: ActivePetEntry): void {
    const sp = getSpeciesById(entry.speciesId);
    if (!sp) return;
    // Followers share the exact same mecha-designer pipeline as wild creatures
    // (archetype silhouette, type accents, face, evolution stage) so a captured
    // pet looks identical to its wild form — just articulated + slightly smaller.
    const descriptor = buildCreatureDescriptor(sp, {
      level: entry.level,
      bond: entry.bondLevel,
      follower: true,
    });
    const offset = new BABYLON.Vector3(
      PET_FORMATION[this.pets.length]?.[0] ?? 0,
      0,
      PET_FORMATION[this.pets.length]?.[1] ?? -3,
    );
    const pos = offset;
    const root = this.factory.createRobot(descriptor, pos);
    const hitbox = BABYLON.MeshBuilder.CreateBox(
      `activePet_${entry.creatureId}`,
      { width: 0.7, height: 1.2, depth: 0.7 },
      this.scene,
    );
    hitbox.position.copyFrom(pos);
    hitbox.isVisible = false;
    root.parent = hitbox;
    this.pets.push({
      entry,
      root,
      hitbox,
      bobTimer: Math.random() * Math.PI * 2,
      gaitPhase: Math.random() * Math.PI * 2,
      facing: 0,
      // Stagger the opening volley so a full lineup reads as three helpers,
      // not one combined effect.
      supportCooldown: 0.8 + this.pets.length * 0.22,
      anim: this.captureAnimParts(root),
    });
  }

  private clearPets(): void {
    for (const lp of this.pets) {
      try { lp.hitbox.dispose(); } catch {}
      try { lp.root.dispose(); } catch {}
    }
    this.pets = [];
  }

  dispose(): void {
    this.clearPets();
    this.factory.dispose();
  }

  /** Shape for ProgressSync serialization. */
  serialize(): { creatureId: string; level: number }[] {
    return this.entries.map(e => ({ creatureId: e.creatureId, level: e.level }));
  }
}
