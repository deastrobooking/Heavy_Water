import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { RobotFactory } from "./RobotFactory";
import { RobotDescriptor } from "./RobotDesigner";
import { buildCreatureDescriptor, isFlyer } from "./CreatureMechaDesigner";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";
import {
  BIO_SPECIES, BioCreatureSpecies,
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
  /** Countdown to the next sparkle emitted along the orb's flight path. */
  trailTimer: number;
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
    // Wild creatures render at base evolution stage (level 1 / bond 0) and stay
    // MERGED (not articulated). The captured-follower path in ActivePetSystem
    // calls the SAME builder with the creature's real level/bond + articulate,
    // so a wild mon and its captured follower are visually identical.
    return buildCreatureDescriptor(species);
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
    const chance = this.captureChance(nearest);
    this.bus.emit(GameEvents.CAPTURE_ORB_THROWN, { creatureId: nearest.id });
    this.bus.emit(GameEvents.UI_MESSAGE, {
      message: `Orb away! ${nearest.species.name} · ${Math.round(chance * 100)}% capture`,
    });
    this.bus.emit("effect:sparkle", {
      position: this.playerPos.add(new BABYLON.Vector3(0, 1.2, 0)),
      color: new BABYLON.Color3(0.4, 1.0, 0.6),
      count: 10,
    });
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
      trailTimer: 0,
    });
    return true;
  }

  /** Clamped capture probability, shared by the thrown-orb UI readout and the
   *  actual roll in resolveCapture so the displayed % always matches the odds. */
  private captureChance(c: ActiveCreature): number {
    return Math.max(0.05, Math.min(0.95, c.species.baseCaptureChance + this.getCaptureBonus()));
  }

  /** Struggle animation while an orb closes in — the creature shudders and
   *  spins in place so the capture reads as a real tug-of-war. */
  private animateCapturing(c: ActiveCreature, dt: number): void {
    c.bobTimer += dt * 22;
    const shake = 0.06 * Math.sin(c.bobTimer);
    c.hitbox.position.x = c.position.x + shake;
    c.hitbox.position.z = c.position.z + shake * 0.5;
    c.hitbox.rotation.y += dt * 8;
  }

  private tick(dt: number): void {
    for (const c of this.creatures) {
      if (c.captured) continue;
      if (c.capturing) { this.animateCapturing(c, dt); continue; }
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

      // Sparkle trail so the orb reads as a charged projectile in flight.
      o.trailTimer -= dt;
      if (o.trailTimer <= 0) {
        o.trailTimer = 0.06;
        this.bus.emit("effect:sparkle", {
          position: o.mesh.position.clone(),
          color: new BABYLON.Color3(0.4, 1.0, 0.6),
          count: 3,
        });
      }

      if (t >= 1) {
        // Impact punch: flash + a small camera shake right as the orb lands.
        this.bus.emit("effect:hitImpact", {
          position: o.target.position.clone(),
          color: new BABYLON.Color3(0.5, 1.0, 0.6),
        });
        this.bus.emit("effect:cameraShake", { intensity: 0.18, duration: 0.2 });
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
    if (Math.random() < this.captureChance(c)) {
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
      // Celebratory burst + confirmation on a successful capture.
      this.bus.emit("effect:levelUp", { position: c.position.clone() });
      this.bus.emit(GameEvents.UI_MESSAGE, { message: `Captured ${c.species.name}!` });
      this.bus.emit(GameEvents.CREATURE_CAPTURED, cap);
      const idx = this.creatures.indexOf(c);
      if (idx >= 0) this.creatures.splice(idx, 1);
      if (c.hitbox && !c.hitbox.isDisposed()) c.hitbox.dispose();
    } else {
      c.capturing = false;
      c.captureProgress = 0;
      // Reset the shudder transform so the freed creature resumes clean wander.
      c.hitbox.position.copyFrom(c.position);
      // Red break-free flash + smoke puff so failure reads clearly.
      this.bus.emit("effect:capture", {
        position: c.position.clone(),
        color: new BABYLON.Color3(1.0, 0.3, 0.2),
      });
      this.bus.emit("effect:smokePuff", {
        position: c.position.clone(),
        color: new BABYLON.Color3(0.4, 0.4, 0.45),
      });
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
        bondLevel: typeof e.bondLevel === "number" ? Math.max(0, Math.min(20, Math.floor(e.bondLevel))) : 0,
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
    if (c.care >= 3 && c.bondLevel < 20) {
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

    const damageMul = 1 + Math.min(0.40, damage);
    const fireRateMul = 1 + Math.min(0.28, fireRate);
    const damageReduction = Math.min(0.24, reduction);
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

  /** Spawn a specific species by id. Sanctuary uses this for curated
   *  peaceful animals / cute helper robots instead of rolling the full
   *  combat-world dex. */
  spawnSpeciesAt(speciesId: string, position: BABYLON.Vector3): string | null {
    const species = getSpeciesById(speciesId);
    if (!species) return null;
    return this.spawnCreature(species, position);
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
