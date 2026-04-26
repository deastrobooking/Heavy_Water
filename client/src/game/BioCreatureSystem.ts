import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { RobotFactory } from "./RobotFactory";
import { RobotDescriptor } from "./RobotDesigner";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";

export interface BioCreatureSpecies {
  id: string;
  name: string;
  baseCaptureChance: number;
  scale: number;
  primary: BABYLON.Color3;
  secondary: BABYLON.Color3;
  emissive: BABYLON.Color3;
  speciesArchetype: "fox" | "beetle" | "serpent" | "owl" | "frog";
}

export const BIO_SPECIES: BioCreatureSpecies[] = [
  {
    id: "robofox",
    name: "RoboFox",
    baseCaptureChance: 0.45,
    scale: 0.55,
    primary: new BABYLON.Color3(1.0, 0.55, 0.15),
    secondary: new BABYLON.Color3(1.0, 0.85, 0.4),
    emissive: new BABYLON.Color3(1.0, 0.6, 0.2),
    speciesArchetype: "fox",
  },
  {
    id: "crystalbeetle",
    name: "Crystal Beetle",
    baseCaptureChance: 0.55,
    scale: 0.4,
    primary: new BABYLON.Color3(0.4, 0.9, 1.0),
    secondary: new BABYLON.Color3(0.8, 1.0, 1.0),
    emissive: new BABYLON.Color3(0.5, 1.0, 1.0),
    speciesArchetype: "beetle",
  },
  {
    id: "hoverserpent",
    name: "Hover Serpent",
    baseCaptureChance: 0.3,
    scale: 0.6,
    primary: new BABYLON.Color3(0.3, 1.0, 0.4),
    secondary: new BABYLON.Color3(0.6, 1.0, 0.8),
    emissive: new BABYLON.Color3(0.5, 1.0, 0.6),
    speciesArchetype: "serpent",
  },
  {
    id: "neonowl",
    name: "Neon Owl",
    baseCaptureChance: 0.35,
    scale: 0.5,
    primary: new BABYLON.Color3(0.6, 0.3, 1.0),
    secondary: new BABYLON.Color3(0.85, 0.6, 1.0),
    emissive: new BABYLON.Color3(0.8, 0.4, 1.0),
    speciesArchetype: "owl",
  },
  {
    id: "voltfrog",
    name: "Volt Frog",
    baseCaptureChance: 0.5,
    scale: 0.45,
    primary: new BABYLON.Color3(1.0, 0.95, 0.3),
    secondary: new BABYLON.Color3(0.95, 1.0, 0.55),
    emissive: new BABYLON.Color3(1.0, 1.0, 0.4),
    speciesArchetype: "frog",
  },
];

export interface CapturedCreature {
  id: string;
  speciesId: string;
  name: string;
  level: number;
  hp: number;
  attackPower: number;
  speed: number;
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

export class BioCreatureSystem {
  private scene: BABYLON.Scene;
  private inventory: InventorySystem;
  private bus: EventBus;
  private factory: RobotFactory;
  private creatures: ActiveCreature[] = [];
  private captured: CapturedCreature[] = [];
  private orbs: CaptureOrb[] = [];
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private idCounter: number = 0;
  private getCaptureBonus: () => number = () => 0;
  private getCaptureCap: () => number = () => 6;

  constructor(scene: BABYLON.Scene, inventory: InventorySystem) {
    this.scene = scene;
    this.inventory = inventory;
    this.bus = EventBus.getInstance();
    this.factory = new RobotFactory(scene);
    this.observer = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      this.tick(dt);
    });
    console.log("[BioCreatureSystem] Initialized");
  }

  setHooks(getBonus: () => number, getCap: () => number): void {
    this.getCaptureBonus = getBonus;
    this.getCaptureCap = getCap;
  }

  setPlayerPosition(pos: BABYLON.Vector3): void {
    this.playerPos.copyFrom(pos);
  }

  spawnCreature(species: BioCreatureSpecies, position: BABYLON.Vector3): void {
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
  }

  spawnInitialCreatures(): void {
    const spots: { pos: BABYLON.Vector3; speciesIdx: number }[] = [
      { pos: new BABYLON.Vector3(-180, 1, -140), speciesIdx: 0 },
      { pos: new BABYLON.Vector3(160, 1, 90), speciesIdx: 1 },
      { pos: new BABYLON.Vector3(-220, 1, 220), speciesIdx: 2 },
      { pos: new BABYLON.Vector3(240, 1, -180), speciesIdx: 3 },
      { pos: new BABYLON.Vector3(40, 1, 280), speciesIdx: 4 },
      { pos: new BABYLON.Vector3(-90, 1, -240), speciesIdx: 0 },
      { pos: new BABYLON.Vector3(280, 1, 30), speciesIdx: 1 },
      { pos: new BABYLON.Vector3(-260, 1, -40), speciesIdx: 4 },
    ];
    for (const s of spots) {
      this.spawnCreature(BIO_SPECIES[s.speciesIdx], s.pos);
    }
  }

  private makeDescriptor(species: BioCreatureSpecies): RobotDescriptor {
    const isFlyer = species.speciesArchetype === "owl" || species.speciesArchetype === "serpent";
    const headShape = species.speciesArchetype === "beetle" ? "sphere" : "sphere";
    return {
      name: species.name,
      faction: "pet",
      style: {
        archetype: "pet",
        scale: species.scale,
        torsoWidth: 0.8, torsoHeight: 0.55, torsoDepth: 0.9,
        headSize: 0.45, headShape,
        armLength: 0.45, armThickness: 0.12, armStyle: "cylinder",
        legLength: species.speciesArchetype === "frog" ? 0.6 : 0.4, legThickness: 0.18, legStyle: "box",
        shoulderPadSize: 0.18, hipPadSize: 0.22,
        hasWings: isFlyer, wingSpan: 1.0, wingAngle: 0.4,
        hasCannons: false, cannonSize: 0.2,
        hasBackpack: false, backpackSize: 0.4,
        hasVisor: true, visorStyle: "round",
        hasHorns: species.speciesArchetype === "beetle", hornLength: 0.3,
        hasTail: species.speciesArchetype !== "beetle", tailLength: 0.55, tailSegments: 4,
        hasAntennae: species.speciesArchetype === "beetle" || species.speciesArchetype === "frog", antennaLength: 0.25,
        hasShield: false, shieldSize: 0.6,
        extraPlating: 0, asymmetry: 0,
        colors: {
          primary: species.primary,
          secondary: species.secondary,
          emissive: species.emissive,
        },
      },
    };
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
      const flying = c.species.speciesArchetype === "owl" || c.species.speciesArchetype === "serpent";
      const baseY = flying ? 2.4 : 0.6;
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
  }

  private resolveCapture(c: ActiveCreature): void {
    const baseChance = c.species.baseCaptureChance + this.getCaptureBonus();
    if (Math.random() < baseChance) {
      c.captured = true;
      const cap: CapturedCreature = {
        id: c.id,
        speciesId: c.species.id,
        name: c.species.name,
        level: 1,
        hp: 60,
        attackPower: 10,
        speed: 1.0,
      };
      this.captured.push(cap);
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

  removeCaptured(id: string): CapturedCreature | null {
    const idx = this.captured.findIndex(c => c.id === id);
    if (idx < 0) return null;
    const [c] = this.captured.splice(idx, 1);
    return c;
  }

  getSpecies(id: string): BioCreatureSpecies | null {
    return BIO_SPECIES.find(s => s.id === id) ?? null;
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
