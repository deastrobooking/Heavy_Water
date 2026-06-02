import * as BABYLON from "@babylonjs/core";
import { RobotFactory } from "./RobotFactory";
import { RobotDescriptor, RobotStyle } from "./RobotDesigner";
import {
  BIO_SPECIES, BioCreatureSpecies, Archetype, ElementalType,
  getSpeciesById,
} from "./BioSpecies";
import { EventBus, GameEvents } from "./EventBus";
import type { CapturedCreature } from "./BioCreatureSystem";

export interface ActivePetEntry {
  creatureId: string;
  speciesId: string;
  name: string;
  level: number;
  elementalType: string;
}

export interface PetAugmentBonuses {
  damageMul: number;
  fireRateMul: number;
  speedMul: number;
  shieldRegen: number;
  healthRegen: number;
  critChance: number;
  summary: string;
}

interface LivePet {
  entry: ActivePetEntry;
  root: BABYLON.TransformNode;
  hitbox: BABYLON.Mesh;
  orbitAngle: number;
  bobTimer: number;
}

const MAX_ACTIVE_PETS = 3;
const PET_FOLLOW_DISTANCE = 2.5;

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
        elementalType: sp.elementalType,
      };
      this.entries.push(entry);
      this.spawnLivePet(entry);
    }
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
  }

  getEntries(): ActivePetEntry[] {
    return this.entries.slice();
  }

  getMaxPets(): number {
    return MAX_ACTIVE_PETS;
  }

  /** Recompute augment bonuses from the active roster.
   *  Each pet's elemental type determines which stat it boosts;
   *  magnitude scales with pet level (1-100). */
  getAugmentBonuses(): PetAugmentBonuses {
    let dmg = 0, fr = 0, spd = 0, sRegen = 0, hRegen = 0, crit = 0;
    for (const e of this.entries) {
      // 0.4% per level. Each elemental family now feeds a DISTINCT augment
      // axis (previously speed / health-regen / crit were never populated),
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
          break;
        case "grass":
          hRegen += power * 0.5;
          break;
        case "steel":
        case "normal":
        default:
          spd += power * 0.5;
          break;
      }
    }
    const damageMul = 1 + Math.min(0.30, dmg);
    const fireRateMul = 1 + Math.min(0.22, fr);
    const speedMul = 1 + Math.min(0.15, spd);
    const shieldRegen = Math.min(6.0, sRegen);
    const healthRegen = Math.min(5.0, hRegen);
    const critChance = Math.min(0.15, crit);
    const summary = `Pet Augments: +${Math.round((damageMul - 1) * 100)}% DMG, +${Math.round((fireRateMul - 1) * 100)}% FIRE, +${Math.round((speedMul - 1) * 100)}% SPD, +${Math.round(critChance * 100)}% CRIT, +${Math.round(shieldRegen * 10) / 10} shield/s, +${Math.round(healthRegen * 10) / 10} hp/s`;
    return { damageMul, fireRateMul, speedMul, shieldRegen, healthRegen, critChance, summary };
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
      p.x += (targetX - p.x) * 0.12;
      p.z += (targetZ - p.z) * 0.12;
      p.y += (targetY - p.y) * 0.12;
    }
  }

  private spawnLivePet(entry: ActivePetEntry): void {
    const sp = getSpeciesById(entry.speciesId);
    if (!sp) return;
    const descriptor = this.makeDescriptor(sp);
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
    });
  }

  private clearPets(): void {
    for (const lp of this.pets) {
      try { lp.hitbox.dispose(); } catch {}
      try { lp.root.dispose(); } catch {}
    }
    this.pets = [];
  }

  private makeDescriptor(species: BioCreatureSpecies): RobotDescriptor {
    const style: RobotStyle = {
      archetype: "pet",
      scale: species.scale * 0.7,
      torsoWidth: 0.7, torsoHeight: 0.45, torsoDepth: 0.7,
      headSize: 0.45, headShape: "sphere",
      armLength: 0.32, armThickness: 0.1, armStyle: "cylinder",
      legLength: 0.32, legThickness: 0.14, legStyle: "box",
      shoulderPadSize: 0.12, hipPadSize: 0.16,
      hasWings: false, wingSpan: 0.8, wingAngle: 0.3,
      hasCannons: false, cannonSize: 0.15,
      hasBackpack: false, backpackSize: 0.3,
      hasVisor: true, visorStyle: "round",
      hasHorns: false, hornLength: 0.18,
      hasTail: true, tailLength: 0.4, tailSegments: 3,
      hasAntennae: true, antennaLength: 0.18,
      hasShield: false, shieldSize: 0.4,
      extraPlating: 0, asymmetry: 0,
      hasPanelLines: true, panelLineDensity: 1.0,
      colors: {
        primary: species.primary,
        secondary: species.secondary,
        emissive: species.emissive,
      },
    };
    return {
      name: species.name,
      style,
      faction: "neutral",
    };
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
