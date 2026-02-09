import * as BABYLON from "@babylonjs/core";
import { RobotFactory } from "./RobotFactory";
import { RobotDescriptor } from "./RobotDesigner";
import { ALLY_PRESETS, PET_PRESETS } from "./RobotPresets";
import { EventBus, GameEvents } from "./EventBus";

export type CompanionType = "ally" | "pet";

export interface CompanionBehavior {
  followDistance: number;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;
  healAmount: number;
  healCooldown: number;
  moveSpeed: number;
  canAttack: boolean;
  canHeal: boolean;
}

interface ActiveCompanion {
  root: BABYLON.TransformNode;
  hitbox: BABYLON.Mesh;
  descriptor: RobotDescriptor;
  type: CompanionType;
  behavior: CompanionBehavior;
  attackTimer: number;
  healTimer: number;
  health: number;
  maxHealth: number;
  orbitAngle: number;
  bobTimer: number;
}

const DEFAULT_ALLY_BEHAVIOR: CompanionBehavior = {
  followDistance: 6,
  attackRange: 18,
  attackDamage: 12,
  attackCooldown: 2.0,
  healAmount: 5,
  healCooldown: 8.0,
  moveSpeed: 0.12,
  canAttack: true,
  canHeal: false,
};

const DEFAULT_PET_BEHAVIOR: CompanionBehavior = {
  followDistance: 3,
  attackRange: 0,
  attackDamage: 0,
  attackCooldown: 99,
  healAmount: 2,
  healCooldown: 10.0,
  moveSpeed: 0.15,
  canAttack: false,
  canHeal: true,
};

export class CompanionSystem {
  private scene: BABYLON.Scene;
  private factory: RobotFactory;
  private companions: ActiveCompanion[] = [];
  private bus: EventBus;
  private collected: Set<string> = new Set();
  private maxCompanions: number = 5;
  private projectiles: { mesh: BABYLON.Mesh; velocity: BABYLON.Vector3; lifetime: number; damage: number }[] = [];

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.factory = new RobotFactory(scene);
    this.bus = EventBus.getInstance();
  }

  addCompanion(presetName: string, playerPos: BABYLON.Vector3): boolean {
    if (this.companions.length >= this.maxCompanions) return false;
    if (this.collected.has(presetName)) return false;

    let descriptor: RobotDescriptor | null = null;
    let type: CompanionType = "ally";
    let behavior = { ...DEFAULT_ALLY_BEHAVIOR };

    if (ALLY_PRESETS[presetName]) {
      descriptor = ALLY_PRESETS[presetName];
      type = "ally";
      behavior = { ...DEFAULT_ALLY_BEHAVIOR };

      if (presetName === "MedicDrone") {
        behavior.canHeal = true;
        behavior.canAttack = false;
        behavior.healAmount = 8;
        behavior.healCooldown = 6.0;
      }
    } else if (PET_PRESETS[presetName]) {
      descriptor = PET_PRESETS[presetName];
      type = "pet";
      behavior = { ...DEFAULT_PET_BEHAVIOR };
    }

    if (!descriptor) return false;

    const offset = new BABYLON.Vector3(
      Math.cos(this.companions.length * 1.2) * 4,
      0,
      Math.sin(this.companions.length * 1.2) * 4
    );
    const spawnPos = playerPos.add(offset);

    const root = this.factory.createRobot(descriptor, spawnPos);

    const hitbox = BABYLON.MeshBuilder.CreateBox(
      `companion_hitbox_${presetName}`,
      { width: 1, height: 2, depth: 1 },
      this.scene
    );
    hitbox.position.copyFrom(spawnPos);
    hitbox.isVisible = false;
    root.parent = hitbox;

    const companion: ActiveCompanion = {
      root,
      hitbox,
      descriptor,
      type,
      behavior,
      attackTimer: 0,
      healTimer: 0,
      health: type === "ally" ? 150 : 50,
      maxHealth: type === "ally" ? 150 : 50,
      orbitAngle: this.companions.length * (Math.PI * 2 / this.maxCompanions),
      bobTimer: Math.random() * Math.PI * 2,
    };

    this.companions.push(companion);
    this.collected.add(presetName);
    return true;
  }

  update(dt: number, playerPos: BABYLON.Vector3, enemyMeshes: BABYLON.AbstractMesh[]): { healed: number; attackHits: { mesh: BABYLON.AbstractMesh; damage: number }[] } {
    let totalHealed = 0;
    const attackHits: { mesh: BABYLON.AbstractMesh; damage: number }[] = [];

    for (let i = this.companions.length - 1; i >= 0; i--) {
      const comp = this.companions[i];

      if (comp.health <= 0) {
        comp.hitbox.dispose();
        comp.root.dispose();
        this.companions.splice(i, 1);
        continue;
      }

      comp.orbitAngle += dt * 0.5;
      comp.bobTimer += dt * 2;

      const targetX = playerPos.x + Math.cos(comp.orbitAngle) * comp.behavior.followDistance;
      const targetZ = playerPos.z + Math.sin(comp.orbitAngle) * comp.behavior.followDistance;
      const targetY = playerPos.y + (comp.type === "pet" ? 0.5 + Math.sin(comp.bobTimer) * 0.3 : 0);

      const currentPos = comp.hitbox.position;
      const dx = targetX - currentPos.x;
      const dz = targetZ - currentPos.z;
      const dy = targetY - currentPos.y;

      currentPos.x += dx * comp.behavior.moveSpeed;
      currentPos.z += dz * comp.behavior.moveSpeed;
      currentPos.y += dy * comp.behavior.moveSpeed;

      if (comp.behavior.canAttack && enemyMeshes.length > 0) {
        comp.attackTimer -= dt;
        if (comp.attackTimer <= 0) {
          let nearestEnemy: BABYLON.AbstractMesh | null = null;
          let nearestDist = comp.behavior.attackRange;

          for (const enemy of enemyMeshes) {
            const dist = BABYLON.Vector3.Distance(currentPos, enemy.position);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestEnemy = enemy;
            }
          }

          if (nearestEnemy) {
            comp.attackTimer = comp.behavior.attackCooldown;
            this.fireCompanionProjectile(currentPos, nearestEnemy.position, comp.behavior.attackDamage, comp.descriptor.style.colors.emissive);
          }
        }
      }

      if (comp.behavior.canHeal) {
        comp.healTimer -= dt;
        if (comp.healTimer <= 0) {
          comp.healTimer = comp.behavior.healCooldown;
          totalHealed += comp.behavior.healAmount;
          this.createHealEffect(playerPos, comp.descriptor.style.colors.emissive);
        }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.mesh.position.addInPlace(proj.velocity.scale(dt));
      proj.lifetime -= dt;

      if (proj.lifetime <= 0) {
        proj.mesh.dispose();
        this.projectiles.splice(i, 1);
        continue;
      }

      for (const enemy of enemyMeshes) {
        if (BABYLON.Vector3.Distance(proj.mesh.position, enemy.position) < 2) {
          attackHits.push({ mesh: enemy, damage: proj.damage });
          proj.mesh.dispose();
          this.projectiles.splice(i, 1);
          break;
        }
      }
    }

    return { healed: totalHealed, attackHits };
  }

  private fireCompanionProjectile(from: BABYLON.Vector3, to: BABYLON.Vector3, damage: number, color: BABYLON.Color3): void {
    const proj = BABYLON.MeshBuilder.CreateSphere("compProj", { diameter: 0.3, segments: 6 }, this.scene);
    proj.position.copyFrom(from);

    const mat = new BABYLON.StandardMaterial("compProjMat", this.scene);
    mat.emissiveColor = color;
    mat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    proj.material = mat;

    const dir = to.subtract(from).normalize();
    const speed = 25;

    this.projectiles.push({
      mesh: proj,
      velocity: dir.scale(speed),
      lifetime: 3,
      damage,
    });
  }

  private createHealEffect(pos: BABYLON.Vector3, color: BABYLON.Color3): void {
    const particles = new BABYLON.ParticleSystem("healFx", 20, this.scene);
    particles.createSphereEmitter(0.5);
    particles.emitter = pos.clone();
    particles.color1 = new BABYLON.Color4(color.r, color.g, color.b, 0.8);
    particles.color2 = new BABYLON.Color4(color.r * 0.5, color.g * 0.5, color.b * 0.5, 0.4);
    particles.minSize = 0.1;
    particles.maxSize = 0.3;
    particles.minLifeTime = 0.5;
    particles.maxLifeTime = 1.0;
    particles.emitRate = 30;
    particles.gravity = new BABYLON.Vector3(0, 2, 0);
    particles.direction1 = new BABYLON.Vector3(-0.5, 1, -0.5);
    particles.direction2 = new BABYLON.Vector3(0.5, 2, 0.5);

    const texUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAADhJREFUGFdjZGBg+M9AAGBiIFIBIwMDA8P/////MzIy/mdkYGBgZGRkZMQpQdBAbAVENYOoAABmNAoBjNm8mAAAAABJRU5ErkJggg==";
    particles.particleTexture = new BABYLON.Texture(texUrl, this.scene);

    particles.start();
    setTimeout(() => {
      particles.stop();
      setTimeout(() => particles.dispose(), 2000);
    }, 500);
  }

  getCompanions(): { name: string; type: CompanionType; health: number; maxHealth: number }[] {
    return this.companions.map(c => ({
      name: c.descriptor.name,
      type: c.type,
      health: c.health,
      maxHealth: c.maxHealth,
    }));
  }

  getCompanionCount(): number {
    return this.companions.length;
  }

  getCollectedNames(): string[] {
    return Array.from(this.collected);
  }

  damageCompanion(index: number, amount: number): void {
    if (index >= 0 && index < this.companions.length) {
      this.companions[index].health = Math.max(0, this.companions[index].health - amount);
    }
  }

  dispose(): void {
    for (const comp of this.companions) {
      comp.hitbox.dispose();
      comp.root.dispose();
    }
    for (const proj of this.projectiles) {
      proj.mesh.dispose();
    }
    this.companions = [];
    this.projectiles = [];
    this.factory.dispose();
  }
}
