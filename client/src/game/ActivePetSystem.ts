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
  orbitAngle: number;
  bobTimer: number;
  gaitPhase: number;
  facing: number;
  lastPos: BABYLON.Vector3;
  anim: PetAnimParts;
}

const MAX_ACTIVE_PETS = 3;
const PET_FOLLOW_DISTANCE = 2.5;

const LEG_NAMES = new Set(["th", "sn", "ft"]);
const ARM_NAMES = new Set(["ua", "fa", "hd"]);
const GLOW_NAMES = new Set(["v", "antTip", "cg", "core", "wt", "tl", "lg", "mz", "eye", "chk"]);

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
    this.clearPets();
    this.entries = [];
    for (const a of assignment.slice(0, MAX_ACTIVE_PETS)) {
      const creature = source.find(c => c.id === a.creatureId);
      if (!creature) continue;
      const sp = getSpeciesById(creature.speciesId);
      if (!sp) continue;
      const entry: ActivePetEntry = {
        creatureId: a.creatureId,
        speciesId: creature.speciesId,
        name: creature.name,
        level: Math.max(1, Math.min(100, a.level)),
        bondLevel: Math.max(0, creature.bondLevel ?? 0),
        elementalType: sp.elementalType,
      };
      this.entries.push(entry);
      this.spawnLivePet(entry);
    }
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
  }

  /** Active pets auto-derive from the player's strongest captured creatures
   *  (top MAX_ACTIVE_PETS by level). This makes the whole pet-power system
   *  reachable without a separate assignment UI: capturing better creatures
   *  upgrades your animated robot followers, their augments, weapon element,
   *  and armor combo. Persistence rides on capturedCreatures (already saved). */
  syncFromCaptured(captured: CapturedCreature[]): void {
    const ranked = captured
      .filter(c => !!getSpeciesById(c.speciesId))
      .slice()
      .sort((a, b) => (b.level ?? 1) - (a.level ?? 1))
      .slice(0, MAX_ACTIVE_PETS);
    // Idempotent: if the resulting top-N roster matches the live one, skip the
    // clear/respawn so this is safe to call every frame / on a throttle.
    // Bond is part of the signature so crossing an evolution threshold (which
    // depends on both level AND bond) respawns the follower with the new look.
    const nextSig = ranked.map(c => `${c.id}:${c.level ?? 1}:${c.bondLevel ?? 0}`).join("|");
    const curSig = this.entries.map(e => `${e.creatureId}:${e.level}:${e.bondLevel}`).join("|");
    if (nextSig === curSig) return;
    this.assignPets(
      ranked.map(c => ({ creatureId: c.id, level: c.level ?? 1 })),
      captured,
    );
  }

  getEntries(): ActivePetEntry[] {
    return this.entries.slice();
  }

  getMaxPets(): number {
    return MAX_ACTIVE_PETS;
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

  update(dt: number, playerPos: BABYLON.Vector3): void {
    for (let i = 0; i < this.pets.length; i++) {
      const lp = this.pets[i];
      lp.orbitAngle += dt * 0.7;
      lp.bobTimer += dt * 2.5;
      const targetX = playerPos.x + Math.cos(lp.orbitAngle) * (PET_FOLLOW_DISTANCE + i * 0.6);
      const targetZ = playerPos.z + Math.sin(lp.orbitAngle) * (PET_FOLLOW_DISTANCE + i * 0.6);
      const targetY = playerPos.y + 0.3 + Math.sin(lp.bobTimer) * 0.25;
      const p = lp.hitbox.position;
      const prevX = p.x, prevZ = p.z;
      p.x += (targetX - p.x) * 0.12;
      p.z += (targetZ - p.z) * 0.12;
      p.y += (targetY - p.y) * 0.12;

      // Face direction of travel (turn smoothly toward velocity).
      const vx = p.x - prevX, vz = p.z - prevZ;
      const speed = Math.hypot(vx, vz);
      if (speed > 0.0008) {
        const want = Math.atan2(vx, vz);
        let delta = want - lp.facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        lp.facing += delta * 0.2;
        lp.root.rotation.y = lp.facing;
      }

      // Gait advances with travel speed (plus a small idle shuffle) so the
      // legs/arms swing while moving and settle when hovering in place.
      lp.gaitPhase += (speed * 14 + dt * 4);
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
      Math.cos(this.pets.length * 1.2) * 3,
      0,
      Math.sin(this.pets.length * 1.2) * 3,
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
      orbitAngle: this.pets.length * (Math.PI * 2 / MAX_ACTIVE_PETS),
      bobTimer: Math.random() * Math.PI * 2,
      gaitPhase: Math.random() * Math.PI * 2,
      facing: 0,
      lastPos: pos.clone(),
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
