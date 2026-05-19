import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { RobotFactory } from "./RobotFactory";
import { RobotDescriptor, RobotStyle } from "./RobotDesigner";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";
import {
  BIO_SPECIES, BioCreatureSpecies, Archetype, ElementalType,
  getSpeciesById, pickWeightedSpecies, statsFromRarity,
} from "./BioSpecies";

// Re-export catalog types so existing imports (`BIO_SPECIES`,
// `BioCreatureSpecies`) keep working unchanged.
export { BIO_SPECIES };
export type { BioCreatureSpecies };

export interface CapturedCreature {
  id: string;
  speciesId: string;
  name: string;
  level: number;
  hp: number;
  attackPower: number;
  speed: number;
  bondLevel: number;
  care: number;
}

export interface PetBondBonuses {
  damageMul: number;
  fireRateMul: number;
  damageReduction: number;
  summary: string;
}

interface ActiveCreature {
  id: string;
  species: BioCreatureSpecies;
  root: BABYLON.TransformNode;
  hitbox: BABYLON.Mesh;
  position: BABYLON.Vector3;
  homePoint: BABYLON.Vector3;
  wanderTarget: BABYLON.Vector3;
  wanderTimer: number;
  bobTimer: number;
  captureProgress: number;
  capturing: boolean;
  captured: boolean;
}

interface CaptureOrb {
  mesh: BABYLON.Mesh;
  beam: BABYLON.LinesMesh | null;
  target: ActiveCreature;
  age: number;
  totalDuration: number;
  startPos: BABYLON.Vector3;
}

const CAPTURE_DURATION = 1.6;
const CAPTURE_ORB_RANGE = 22;
/** Wild population the world tries to maintain. */
const TARGET_WILD_POP = 36;
/** Seconds between respawn ticks (one creature added per tick when below target). */
const RESPAWN_INTERVAL = 14;

export class BioCreatureSystem {
  private scene: BABYLON.Scene;
  private inventory: InventorySystem;
  private bus: EventBus;
  private factory: RobotFactory;
  private creatures: ActiveCreature[] = [];
  private captured: CapturedCreature[] = [];
  /** Persistent "ever caught" dex history. Survives DEPLOY (which removes
   *  the creature from the live roster) so the dex completion percentage
   *  only ever grows. Only species ids that resolve via getSpeciesById are
   *  kept here, so legacy/unknown ids can't inflate the count. */
  private dexCaughtIds: Set<string> = new Set();
  private orbs: CaptureOrb[] = [];
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private idCounter: number = 0;
  private respawnTimer: number = RESPAWN_INTERVAL;
  private getCaptureBonus: () => number = () => 0;
  private getCaptureCap: () => number = () => 15;

  constructor(scene: BABYLON.Scene, inventory: InventorySystem) {
    this.scene = scene;
    this.inventory = inventory;
    this.bus = EventBus.getInstance();
    this.factory = new RobotFactory(scene);
    this.observer = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      this.tick(dt);
    });
    console.log(`[BioCreatureSystem] Initialized — ${BIO_SPECIES.length} species in dex`);
  }

  setHooks(getBonus: () => number, getCap: () => number): void {
    this.getCaptureBonus = getBonus;
    this.getCaptureCap = getCap;
  }

  setPlayerPosition(pos: BABYLON.Vector3): void {
    this.playerPos.copyFrom(pos);
  }

  spawnCreature(species: BioCreatureSpecies, position: BABYLON.Vector3): string {
    const id = `bio_${this.idCounter++}`;
    const descriptor = this.makeDescriptor(species);
    const root = this.factory.createRobot(descriptor, position);

    const hitbox = BABYLON.MeshBuilder.CreateBox(`bio_hitbox_${id}`, { width: 1, height: 1.5, depth: 1 }, this.scene);
    hitbox.position.copyFrom(position);
    hitbox.isVisible = false;
    root.parent = hitbox;

    const c: ActiveCreature = {
      id,
      species,
      root,
      hitbox,
      position: position.clone(),
      homePoint: position.clone(),
      wanderTarget: position.clone(),
      wanderTimer: 0,
      bobTimer: Math.random() * Math.PI * 2,
      captureProgress: 0,
      capturing: false,
      captured: false,
    };
    this.creatures.push(c);
    this.bus.emit(GameEvents.CREATURE_SPAWNED, { id, speciesId: species.id, position });
    return id;
  }

  /**
   * Scatter a rarity-weighted starting population around the world. Spots
   * are placed on a coarse 6×6 grid centered on the origin, with jitter, so
   * every quadrant of the open world has wild creatures to find.
   */
  spawnInitialCreatures(): void {
    const radius = 280; // matches typical city/biome footprint
    const cols = 6, rows = 6;
    let placed = 0;
    for (let i = 0; i < cols && placed < TARGET_WILD_POP; i++) {
      for (let j = 0; j < rows && placed < TARGET_WILD_POP; j++) {
        const fx = (i + 0.5) / cols - 0.5;
        const fz = (j + 0.5) / rows - 0.5;
        const jx = (Math.random() - 0.5) * (2 * radius / cols) * 0.7;
        const jz = (Math.random() - 0.5) * (2 * radius / rows) * 0.7;
        // Skip the dead center (player spawn area) so creatures don't clip
        // into the spawn pad / starter NPCs.
        if (Math.abs(fx) < 0.08 && Math.abs(fz) < 0.08) continue;
        const pos = new BABYLON.Vector3(fx * 2 * radius + jx, 1, fz * 2 * radius + jz);
        const species = pickWeightedSpecies();
        this.spawnCreature(species, pos);
        placed++;
      }
    }
  }

  // ---------------------------------------------------------------- visuals
  /**
   * Build a rich, "robotic Pokemon"-style descriptor. Each archetype owns
   * its silhouette (proportions, ears via antennae, wings, tail, shell,
   * etc.); colors come from the species palette which is itself derived
   * from `elementalType` unless overridden.
   */
  private makeDescriptor(species: BioCreatureSpecies): RobotDescriptor {
    const t = species.elementalType;
    const a = species.archetype;

    // Defaults: chibi proportions — short stout torso, oversized head, big
    // visor eyes — that read as cute robot mascots.
    const style: RobotStyle = {
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

    applyArchetype(a, style);
    applyTypeAccents(t, style);
    applyRarityFlair(style, species.rarity);

    return { name: species.name, faction: "pet", style };
  }

  attemptCaptureNearest(): boolean {
    const cap = this.getCaptureCap();
    if (this.captured.length >= cap) {
      this.bus.emit(GameEvents.UI_MESSAGE, { message: `Garden roster full (${cap})` });
      return false;
    }
    const orbItem = ITEM_DEFINITIONS["bio_essence"];
    if (!orbItem || this.inventory.getItemCount("bio_essence") < 1) {
      this.bus.emit(GameEvents.UI_MESSAGE, { message: "Need 1 Bio Essence to throw a capture orb" });
      return false;
    }

    let nearest: ActiveCreature | null = null;
    let nearestDist = CAPTURE_ORB_RANGE;
    for (const c of this.creatures) {
      if (c.captured || c.capturing) continue;
      const d = BABYLON.Vector3.Distance(c.position, this.playerPos);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = c;
      }
    }
    if (!nearest) {
      this.bus.emit(GameEvents.UI_MESSAGE, { message: "No bio-creature in range" });
      return false;
    }

    this.inventory.removeItem("bio_essence", 1);
    this.bus.emit(GameEvents.CAPTURE_ORB_THROWN, { creatureId: nearest.id });
    nearest.capturing = true;
    nearest.captureProgress = 0;

    const orbMesh = BABYLON.MeshBuilder.CreateSphere(`captureOrb_${nearest.id}`, { diameter: 0.5, segments: 8 }, this.scene);
    const orbMat = new BABYLON.StandardMaterial(`captureOrbMat_${nearest.id}`, this.scene);
    orbMat.emissiveColor = new BABYLON.Color3(0.4, 1.0, 0.5);
    orbMat.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.2);
    orbMesh.material = orbMat;
    orbMesh.position.copyFrom(this.playerPos.add(new BABYLON.Vector3(0, 1.2, 0)));
    orbMesh.isPickable = false;

    this.orbs.push({
      mesh: orbMesh,
      beam: null,
      target: nearest,
      age: 0,
      totalDuration: CAPTURE_DURATION,
      startPos: orbMesh.position.clone(),
    });
    return true;
  }

  private tick(dt: number): void {
    for (const c of this.creatures) {
      if (c.captured) continue;
      if (c.capturing) continue;
      c.bobTimer += dt * 2;
      c.wanderTimer -= dt;
      if (c.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const r = 4 + Math.random() * 8;
        c.wanderTarget = c.homePoint.add(new BABYLON.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
        c.wanderTimer = 3 + Math.random() * 3;
      }
      const dx = c.wanderTarget.x - c.position.x;
      const dz = c.wanderTarget.z - c.position.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const sp = 1.5;
      if (d > 0.2) {
        c.position.x += (dx / d) * sp * dt;
        c.position.z += (dz / d) * sp * dt;
      }
      const flying = isFlyer(c.species.archetype);
      const baseY = c.homePoint.y + (flying ? 1.8 : 0.6);
      c.position.y = baseY + Math.sin(c.bobTimer) * (flying ? 0.3 : 0.1);
      c.hitbox.position.copyFrom(c.position);
      if (d > 0.05) {
        c.hitbox.rotation.y = Math.atan2(dx, dz);
      }
    }

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.age += dt;
      const t = Math.min(1, o.age / o.totalDuration);
      const arcY = Math.sin(t * Math.PI) * 2;
      o.mesh.position.x = o.startPos.x + (o.target.position.x - o.startPos.x) * t;
      o.mesh.position.y = o.startPos.y + (o.target.position.y - o.startPos.y) * t + arcY;
      o.mesh.position.z = o.startPos.z + (o.target.position.z - o.startPos.z) * t;
      o.mesh.rotation.y += dt * 5;

      o.target.captureProgress = t;

      if (t >= 1) {
        o.mesh.dispose();
        this.orbs.splice(i, 1);
        this.resolveCapture(o.target);
      }
    }

    // Gradual respawn: the wild world stays alive even after captures.
    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0) {
      this.respawnTimer = RESPAWN_INTERVAL;
      const alive = this.creatures.filter(c => !c.captured).length;
      if (alive < TARGET_WILD_POP) {
        const radius = 280;
        const angle = Math.random() * Math.PI * 2;
        const r = 60 + Math.random() * (radius - 60);
        const pos = new BABYLON.Vector3(Math.cos(angle) * r, 1, Math.sin(angle) * r);
        this.spawnCreature(pickWeightedSpecies(), pos);
      }
    }
  }

  private resolveCapture(c: ActiveCreature): void {
    const baseChance = c.species.baseCaptureChance + this.getCaptureBonus();
    if (Math.random() < baseChance) {
      c.captured = true;
      const baseStats = statsFromRarity(c.species.rarity);
      const cap: CapturedCreature = {
        id: c.id,
        speciesId: c.species.id,
        name: c.species.name,
        level: 1,
        hp: baseStats.hp,
        attackPower: baseStats.attack,
        speed: baseStats.speed,
        bondLevel: 0,
        care: 0,
      };
      this.captured.push(cap);
      // Permanent dex flag (only valid known species — guards legacy/unknown ids).
      if (getSpeciesById(c.species.id)) this.dexCaughtIds.add(c.species.id);
      this.bus.emit("effect:capture", {
        position: c.position.clone(),
        color: c.species.emissive.clone(),
      });
      this.bus.emit(GameEvents.CREATURE_CAPTURED, cap);
      const idx = this.creatures.indexOf(c);
      if (idx >= 0) this.creatures.splice(idx, 1);
      if (c.hitbox && !c.hitbox.isDisposed()) c.hitbox.dispose();
    } else {
      c.capturing = false;
      c.captureProgress = 0;
      this.bus.emit(GameEvents.UI_MESSAGE, { message: `${c.species.name} broke free!` });
    }
  }

  getActiveCreatures(): { id: string; name: string; speciesId: string; position: BABYLON.Vector3 }[] {
    return this.creatures.filter(c => !c.captured).map(c => ({
      id: c.id,
      name: c.species.name,
      speciesId: c.species.id,
      position: c.position.clone(),
    }));
  }

  getCaptured(): CapturedCreature[] {
    return this.captured.slice();
  }

  /** Persistent set of species ids the player has ever caught — used for
   *  dex completion. Filtered to known species only. */
  getDexCaughtIds(): string[] {
    return Array.from(this.dexCaughtIds);
  }

  /** Hydrate captured roster from a save. Unknown species ids are
   *  silently skipped; legacy entries that resolve via `getSpeciesById`
   *  are restored with their persisted stats (or rebuilt from rarity if
   *  the saved entry is malformed). */
  loadCaptured(saved: any[] | undefined): void {
    if (!Array.isArray(saved)) return;
    let counter = 0;
    for (const e of saved) {
      if (!e || typeof e.speciesId !== "string") continue;
      const sp = getSpeciesById(e.speciesId);
      if (!sp) continue; // unknown id — skip rather than crash
      const fallback = statsFromRarity(sp.rarity);
      const cap: CapturedCreature = {
        id: typeof e.id === "string" ? e.id : `bio_load_${counter++}`,
        speciesId: sp.id,
        name: typeof e.name === "string" ? e.name : sp.name,
        level: typeof e.level === "number" ? e.level : 1,
        hp: typeof e.hp === "number" ? e.hp : fallback.hp,
        attackPower: typeof e.attackPower === "number" ? e.attackPower : fallback.attack,
        speed: typeof e.speed === "number" ? e.speed : fallback.speed,
        bondLevel: typeof e.bondLevel === "number" ? Math.max(0, Math.min(10, Math.floor(e.bondLevel))) : 0,
        care: typeof e.care === "number" ? Math.max(0, Math.min(3, Math.floor(e.care))) : 0,
      };
      this.captured.push(cap);
      this.dexCaughtIds.add(sp.id); // restoring a creature also flags the dex
    }
  }

  /** Hydrate the dex-caught history from a save (independent of roster). */
  loadDexCaughtIds(ids: string[] | undefined): void {
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (typeof id !== "string") continue;
      if (getSpeciesById(id)) this.dexCaughtIds.add(id);
    }
  }

  removeCaptured(id: string): CapturedCreature | null {
    const idx = this.captured.findIndex(c => c.id === id);
    if (idx < 0) return null;
    const [c] = this.captured.splice(idx, 1);
    return c;
  }

  careForCaptured(id: string): { ok: boolean; message: string } {
    const c = this.captured.find(p => p.id === id);
    if (!c) return { ok: false, message: "Pet not found." };

    const feedId = this.inventory.getItemCount("animaton_feed") > 0 ? "animaton_feed" : "bio_crop";
    if (this.inventory.getItemCount(feedId) < 1) {
      return { ok: false, message: "Need Bio Crop or Animaton Feed from the farm." };
    }

    this.inventory.removeItem(feedId, 1);
    const feedPower = feedId === "animaton_feed" ? 2 : 1;
    c.care = Math.min(3, (c.care ?? 0) + feedPower);
    if (c.care >= 3 && c.bondLevel < 10) {
      c.care = 0;
      c.bondLevel += 1;
      c.level += 1;
      c.hp += 8;
      c.attackPower += 2;
      c.speed += 0.03;
      this.bus.emit(GameEvents.UI_MESSAGE, { message: `${c.name} bonded with you! Bond Lv ${c.bondLevel}` });
    } else {
      this.bus.emit(GameEvents.UI_MESSAGE, { message: `${c.name} recovered at the sanctuary clinic.` });
    }
    return { ok: true, message: `${c.name} cared for.` };
  }

  getPetBondBonuses(): PetBondBonuses {
    let damage = 0;
    let fireRate = 0;
    let reduction = 0;

    for (const c of this.captured) {
      const sp = getSpeciesById(c.speciesId);
      if (!sp) continue;
      const rarityMul = sp.rarity === "legendary" ? 2.2 : sp.rarity === "rare" ? 1.6 : sp.rarity === "uncommon" ? 1.25 : 1.0;
      const bond = Math.max(0, c.bondLevel ?? 0);
      const level = Math.max(1, c.level ?? 1);
      const power = rarityMul * (0.0025 + bond * 0.0015 + level * 0.0004);
      switch (sp.elementalType) {
        case "flame":
        case "dragon":
        case "evil":
          damage += power;
          break;
        case "electric":
        case "psychic":
        case "crystal":
          fireRate += power * 0.8;
          break;
        case "water":
        case "grass":
        case "ice":
        case "steel":
        case "normal":
        default:
          reduction += power * 0.55;
          break;
      }
    }

    const damageMul = 1 + Math.min(0.25, damage);
    const fireRateMul = 1 + Math.min(0.18, fireRate);
    const damageReduction = Math.min(0.15, reduction);
    const summary = `Pet Bonds: +${Math.round((damageMul - 1) * 100)}% DMG, +${Math.round((fireRateMul - 1) * 100)}% FIRE, -${Math.round(damageReduction * 100)}% DMG TAKEN`;
    return { damageMul, fireRateMul, damageReduction, summary };
  }

  getSpecies(id: string): BioCreatureSpecies | null {
    return getSpeciesById(id);
  }

  /** Pick a rarity-weighted species and spawn it at `position`. Returns
   *  the spawned id so callers (e.g. SanctuarySystem) can despawn it on
   *  zone teardown. */
  spawnRandomAt(position: BABYLON.Vector3): string {
    return this.spawnCreature(pickWeightedSpecies(), position);
  }

  /** Forcibly remove a live (uncaptured) creature from the world by id —
   *  used by SanctuarySystem on warp-out so sanctuary-spawned creatures
   *  don't linger in the world after the player leaves Level 4. Captured
   *  creatures are NOT touched (they live in `this.captured`, not
   *  `this.creatures`, and are persisted to the player's roster). */
  despawnCreature(id: string): boolean {
    const idx = this.creatures.findIndex(c => c.id === id);
    if (idx < 0) return false;
    const c = this.creatures[idx];
    // Never strip a creature whose capture is mid-flight or already
    // resolved — the orb tick still references c.position / c.captureProgress
    // and resolveCapture pushes onto `captured[]` after the orb lands.
    if (c.captured || c.capturing) return false;
    if (c.hitbox && !c.hitbox.isDisposed()) {
      try { c.hitbox.dispose(); } catch {}
    }
    this.creatures.splice(idx, 1);
    return true;
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    for (const o of this.orbs) o.mesh.dispose();
    for (const c of this.creatures) {
      if (c.hitbox && !c.hitbox.isDisposed()) c.hitbox.dispose();
    }
    this.orbs = [];
    this.creatures = [];
    this.factory.dispose();
  }
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
  }
}

/** Type-themed accent flourishes that don't override archetype silhouette.
 *  Each type adds two or more visible flairs (horns, antennae, wings,
 *  visor, plating, panel lines, asymmetry, glowing tail, etc.) so a
 *  player can read the elemental type at a glance even before the colour
 *  palette registers. Renamed in this pass: "fire" → "flame" and "dark"
 *  → "evil" to keep the dex distinct from the obvious franchise. */
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
      // Full visor (no separate eyes) + tall single antenna for that
      // mind-control silhouette.
      s.visorStyle = "full";
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
      // Reads as a clean utility chassis — short tufts + tidy round
      // visor, no extra plating clutter.
      s.hasAntennae = s.hasAntennae || true;
      s.antennaLength = Math.max(s.antennaLength, 0.25);
      s.visorStyle = s.visorStyle === "full" ? "full" : "round";
      break;
    default:
      break;
  }
}

/** Bigger / shinier rare and legendary mons read as "boss-tier" without
 *  needing custom geometry per species. Uses Math.max so an archetype
 *  that already sets a higher value isn't shrunk back down. */
function applyRarityFlair(s: RobotStyle, rarity: import("./BioSpecies").Rarity): void {
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

function isFlyer(a: Archetype): boolean {
  return a === "owl" || a === "bird" || a === "serpent" || a === "dragon" || a === "flutter" || a === "fish";
}
