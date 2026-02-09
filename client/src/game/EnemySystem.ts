import * as BABYLON from "@babylonjs/core";
import { StateMachine } from "./StateMachine";
import { EventBus, GameEvents } from "./EventBus";
import { DamageInfo, DamageResult, DamageResistance, IDamageable, DamageType, applyDamage } from "./DamageSystem";
import { RobotFactory } from "./RobotFactory";
import { ROBOT_PRESETS } from "./RobotPresets";

export type EnemyType = "drone" | "soldier" | "heavy" | "insectoid" | "hybrid";
export type EnemyAIState = "idle" | "patrol" | "chase" | "attack" | "stunned" | "dead";

export interface EnemyConfig {
  maxHealth: number;
  attackDamage: number;
  defense: number;
  movementSpeed: number;
  attackCooldown: number;
  knockbackForce: number;
  experienceValue: number;
  detectionRange: number;
  chaseRange: number;
  attackRange: number;
  patrolSpeed: number;
  chaseSpeed: number;
  credits: number;
}

const ENEMY_CONFIGS: Record<EnemyType, EnemyConfig> = {
  drone: {
    maxHealth: 50, attackDamage: 8, defense: 2, movementSpeed: 8, attackCooldown: 1.5,
    knockbackForce: 200, experienceValue: 15, detectionRange: 25, chaseRange: 35,
    attackRange: 15, patrolSpeed: 0.08, chaseSpeed: 0.15, credits: 10,
  },
  soldier: {
    maxHealth: 100, attackDamage: 15, defense: 5, movementSpeed: 4, attackCooldown: 2.0,
    knockbackForce: 400, experienceValue: 25, detectionRange: 20, chaseRange: 30,
    attackRange: 5, patrolSpeed: 0.06, chaseSpeed: 0.1, credits: 20,
  },
  heavy: {
    maxHealth: 300, attackDamage: 25, defense: 15, movementSpeed: 2, attackCooldown: 3.0,
    knockbackForce: 800, experienceValue: 50, detectionRange: 15, chaseRange: 25,
    attackRange: 8, patrolSpeed: 0.03, chaseSpeed: 0.05, credits: 50,
  },
  insectoid: {
    maxHealth: 80, attackDamage: 20, defense: 3, movementSpeed: 6, attackCooldown: 0.8,
    knockbackForce: 300, experienceValue: 20, detectionRange: 18, chaseRange: 28,
    attackRange: 4, patrolSpeed: 0.1, chaseSpeed: 0.12, credits: 30,
  },
  hybrid: {
    maxHealth: 1000, attackDamage: 40, defense: 20, movementSpeed: 3, attackCooldown: 2.5,
    knockbackForce: 1000, experienceValue: 200, detectionRange: 30, chaseRange: 50,
    attackRange: 10, patrolSpeed: 0.04, chaseSpeed: 0.08, credits: 100,
  },
};

export class EnemyUnit implements IDamageable {
  mesh: BABYLON.Mesh;
  type: EnemyType;
  health: number;
  maxHealth: number;
  isAlive: boolean = true;
  isInvulnerable: boolean = false;
  resistances: DamageResistance[] = [];

  private config: EnemyConfig;
  private fsm: StateMachine<EnemyAIState>;
  private attackTimer: number = 0;
  private stunTimer: number = 0;
  private idleTimer: number = 0;
  private patrolTarget: BABYLON.Vector3;
  private patrolOrigin: BABYLON.Vector3;
  private bus: EventBus;

  constructor(mesh: BABYLON.Mesh, type: EnemyType, waveMultiplier: number = 1) {
    this.mesh = mesh;
    this.type = type;
    this.config = { ...ENEMY_CONFIGS[type] };
    this.config.maxHealth *= waveMultiplier;
    this.config.attackDamage *= waveMultiplier;
    this.health = this.config.maxHealth;
    this.maxHealth = this.config.maxHealth;
    this.patrolOrigin = mesh.position.clone();
    this.patrolTarget = this.getRandomPatrolPoint();
    this.bus = EventBus.getInstance();

    this.fsm = new StateMachine<EnemyAIState>();
    this.setupFSM();
    this.fsm.forceState("patrol");

    mesh.metadata = {
      ...mesh.metadata,
      isEnemy: true,
      damageable: this,
      enemyUnit: this,
    };
  }

  private setupFSM(): void {
    this.fsm.addState({ name: "idle", transitions: ["patrol", "chase", "stunned", "dead"] });
    this.fsm.addState({ name: "patrol", transitions: ["idle", "chase", "stunned", "dead"] });
    this.fsm.addState({ name: "chase", transitions: ["patrol", "attack", "stunned", "dead"] });
    this.fsm.addState({ name: "attack", transitions: ["chase", "stunned", "dead"] });
    this.fsm.addState({ name: "stunned", transitions: ["chase", "idle", "dead"] });
    this.fsm.addState({ name: "dead" });
  }

  update(dt: number, playerPosition: BABYLON.Vector3): number {
    if (!this.isAlive) return 0;

    this.fsm.update(dt);
    const state = this.fsm.getState();

    switch (state) {
      case "idle": return this.updateIdle(dt, playerPosition);
      case "patrol": return this.updatePatrol(dt, playerPosition);
      case "chase": return this.updateChase(dt, playerPosition);
      case "attack": return this.updateAttack(dt, playerPosition);
      case "stunned": return this.updateStunned(dt);
      default: return 0;
    }
  }

  private updateIdle(dt: number, playerPos: BABYLON.Vector3): number {
    this.idleTimer -= dt;
    if (this.idleTimer <= 0) {
      this.fsm.changeState("patrol");
      this.patrolTarget = this.getRandomPatrolPoint();
    }
    this.checkForPlayer(playerPos);

    if (this.type === "drone") {
      this.mesh.position.y = 5 + Math.sin(Date.now() * 0.003) * 0.5;
    }
    return 0;
  }

  private updatePatrol(dt: number, playerPos: BABYLON.Vector3): number {
    const dir = this.patrolTarget.subtract(this.mesh.position);
    dir.y = 0;
    if (dir.length() < 1) {
      this.fsm.changeState("idle");
      this.idleTimer = 1 + Math.random() * 2;
      return 0;
    }

    this.mesh.position.addInPlace(dir.normalize().scale(this.config.patrolSpeed));
    this.faceDirection(dir);
    this.checkForPlayer(playerPos);

    if (this.type === "drone") {
      this.mesh.position.y = 5 + Math.sin(Date.now() * 0.003) * 0.5;
    }
    return 0;
  }

  private updateChase(dt: number, playerPos: BABYLON.Vector3): number {
    const dir = playerPos.subtract(this.mesh.position);
    const dist = dir.length();

    if (dist <= this.config.attackRange) {
      this.fsm.changeState("attack");
      this.attackTimer = 0.5;
      return 0;
    }

    if (dist > this.config.detectionRange * 1.5) {
      this.fsm.changeState("patrol");
      this.patrolTarget = this.getRandomPatrolPoint();
      return 0;
    }

    const moveDir = dir.clone();
    moveDir.y = 0;
    moveDir.normalize();
    this.mesh.position.addInPlace(moveDir.scale(this.config.chaseSpeed));
    this.faceDirection(moveDir);

    if (this.type === "drone") {
      this.mesh.position.y = 5 + Math.sin(Date.now() * 0.003) * 0.5;
    } else {
      this.mesh.position.y = 1.5;
    }
    return 0;
  }

  private updateAttack(dt: number, playerPos: BABYLON.Vector3): number {
    let damage = 0;
    this.attackTimer -= dt;

    const dist = BABYLON.Vector3.Distance(this.mesh.position, playerPos);
    if (dist > this.config.attackRange * 1.2) {
      this.fsm.changeState("chase");
      return 0;
    }

    this.faceDirection(playerPos.subtract(this.mesh.position));

    if (this.attackTimer <= 0) {
      damage = this.config.attackDamage;
      this.attackTimer = this.config.attackCooldown;
      this.createAttackEffect();
    }

    return damage;
  }

  private updateStunned(dt: number): number {
    this.stunTimer -= dt;
    if (this.stunTimer <= 0) {
      this.fsm.changeState("chase");
    }
    return 0;
  }

  private checkForPlayer(playerPos: BABYLON.Vector3): void {
    const dist = BABYLON.Vector3.Distance(this.mesh.position, playerPos);
    if (dist <= this.config.detectionRange) {
      this.fsm.changeState("chase");
    }
  }

  private faceDirection(dir: BABYLON.Vector3): void {
    if (dir.lengthSquared() < 0.001) return;
    const target = this.mesh.position.add(dir);
    target.y = this.mesh.position.y;
    this.mesh.lookAt(target);
  }

  private getRandomPatrolPoint(): BABYLON.Vector3 {
    const angle = Math.random() * Math.PI * 2;
    const radius = 10 + Math.random() * 20;
    return new BABYLON.Vector3(
      this.patrolOrigin.x + Math.cos(angle) * radius,
      this.mesh.position.y,
      this.patrolOrigin.z + Math.sin(angle) * radius
    );
  }

  takeDamage(info: DamageInfo): DamageResult {
    if (!this.isAlive) {
      return { damageAmount: 0, wasKilled: false, wasBlocked: false, wasParried: false };
    }

    let finalDamage = Math.max(1, info.amount - this.config.defense);

    const resistance = this.resistances.find(r => r.damageType === info.damageType);
    if (resistance) {
      finalDamage *= (1 - resistance.resistancePercent);
    }

    this.health = Math.max(0, this.health - finalDamage);

    this.flashDamage();

    this.bus.emit(GameEvents.ENEMY_DAMAGED, {
      enemy: this,
      damage: finalDamage,
      position: this.mesh.position.clone(),
    });

    if (this.health <= 0) {
      this.die();
      return { damageAmount: finalDamage, wasKilled: true, wasBlocked: false, wasParried: false };
    }

    if (this.fsm.getState() !== "stunned") {
      this.fsm.changeState("stunned");
      this.stunTimer = 1.5;
    }

    return { damageAmount: finalDamage, wasKilled: false, wasBlocked: false, wasParried: false };
  }

  private flashDamage(): void {
    const mat = this.mesh.material as BABYLON.StandardMaterial;
    if (!mat) return;
    const originalEmissive = mat.emissiveColor.clone();
    mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    setTimeout(() => {
      if (mat) mat.emissiveColor = originalEmissive;
    }, 100);
  }

  private die(): void {
    this.isAlive = false;
    this.fsm.forceState("dead");
    this.bus.emit(GameEvents.ENEMY_KILLED, {
      type: this.type,
      credits: this.config.credits,
      experience: this.config.experienceValue,
      position: this.mesh.position.clone(),
    });
    this.createDeathEffect();
    setTimeout(() => {
      if (this.mesh && !this.mesh.isDisposed()) {
        this.mesh.dispose();
      }
    }, 2000);
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  getPosition(): BABYLON.Vector3 {
    return this.mesh.position.clone();
  }

  getState(): EnemyAIState {
    return this.fsm.getState() ?? "idle";
  }

  getConfig(): EnemyConfig {
    return this.config;
  }

  private createAttackEffect(): void {
    const effect = BABYLON.MeshBuilder.CreateSphere("attackEffect", { diameter: 0.5 }, this.mesh.getScene());
    effect.position = this.mesh.position.clone();
    const mat = new BABYLON.StandardMaterial("effectMat", this.mesh.getScene());
    mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
    mat.alpha = 0.8;
    effect.material = mat;

    let frame = 0;
    const animate = () => {
      frame++;
      effect.scaling = new BABYLON.Vector3(1 + frame * 0.2, 1 + frame * 0.2, 1 + frame * 0.2);
      mat.alpha = Math.max(0, 0.8 - frame * 0.1);
      if (frame < 8) requestAnimationFrame(animate);
      else effect.dispose();
    };
    animate();
  }

  private createDeathEffect(): void {
    const scene = this.mesh.getScene();
    const pos = this.mesh.position.clone();
    for (let i = 0; i < 10; i++) {
      const particle = BABYLON.MeshBuilder.CreateBox("deathParticle", { size: 0.2 }, scene);
      particle.position = pos.clone();
      const mat = new BABYLON.StandardMaterial("deathMat", scene);
      mat.emissiveColor = new BABYLON.Color3(1, 0.5, 0);
      particle.material = mat;

      const velocity = new BABYLON.Vector3(
        (Math.random() - 0.5) * 0.3,
        Math.random() * 0.3,
        (Math.random() - 0.5) * 0.3
      );

      let frame = 0;
      const animate = () => {
        frame++;
        particle.position.addInPlace(velocity);
        velocity.y -= 0.01;
        particle.rotation.addInPlace(new BABYLON.Vector3(0.1, 0.1, 0.1));
        mat.alpha = Math.max(0, 1 - frame * 0.05);
        if (frame < 20) requestAnimationFrame(animate);
        else particle.dispose();
      };
      animate();
    }
  }
}

export class EnemySystem {
  private scene: BABYLON.Scene;
  private enemies: EnemyUnit[] = [];
  private spawnTimer: number = 0;
  private spawnInterval: number = 5000;
  private maxEnemies: number = 20;
  private waveNumber: number = 1;
  private bus: EventBus;

  private robotFactory: RobotFactory;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.robotFactory = new RobotFactory(scene);
  }

  private createEnemyMesh(type: EnemyType, position: BABYLON.Vector3): BABYLON.Mesh {
    const presetMap: Record<EnemyType, string> = {
      drone: "JetWarden",
      soldier: "ScoutPrime",
      heavy: "TankTitan",
      insectoid: "InsectoidStalker",
      hybrid: "HybridOmega",
    };

    const presetName = presetMap[type] || "ScoutPrime";
    const preset = ROBOT_PRESETS[presetName];

    if (preset) {
      const root = this.robotFactory.createRobot(preset, position);

      const hitboxH = type === "hybrid" ? 3.5 : type === "heavy" ? 3 : 2;
      const hitboxR = type === "hybrid" ? 0.8 : type === "heavy" ? 0.7 : 0.5;
      const hitbox = BABYLON.MeshBuilder.CreateCapsule(`enemyHit_${type}_${Date.now()}`, {
        height: hitboxH,
        radius: hitboxR,
      }, this.scene);
      hitbox.isVisible = false;
      hitbox.position.copyFrom(position);
      root.parent = hitbox;
      root.position = BABYLON.Vector3.Zero();

      if (type === "drone") {
        hitbox.position.y = 5;
      }

      return hitbox;
    }

    const mesh = BABYLON.MeshBuilder.CreateCapsule(`enemy_${type}`, { height: 2, radius: 0.4 }, this.scene);
    mesh.position = position;
    const material = new BABYLON.StandardMaterial(`enemyMat_${type}`, this.scene);
    material.diffuseColor = new BABYLON.Color3(0.5, 0.2, 0.2);
    material.emissiveColor = new BABYLON.Color3(0.3, 0.1, 0.1);
    mesh.material = material;
    return mesh;
  }

  spawnEnemy(playerPosition: BABYLON.Vector3): void {
    if (this.enemies.length >= this.maxEnemies) return;

    const angle = Math.random() * Math.PI * 2;
    const distance = 30 + Math.random() * 50;
    const x = playerPosition.x + Math.cos(angle) * distance;
    const z = playerPosition.z + Math.sin(angle) * distance;
    const position = new BABYLON.Vector3(x, 1.5, z);

    const type = this.selectEnemyType();
    const mesh = this.createEnemyMesh(type, position);
    const waveMultiplier = 1 + (this.waveNumber - 1) * 0.2;

    const enemy = new EnemyUnit(mesh, type, waveMultiplier);
    this.enemies.push(enemy);
    this.bus.emit(GameEvents.ENEMY_SPAWNED, { type, position });
  }

  private selectEnemyType(): EnemyType {
    const roll = Math.random();
    if (this.waveNumber >= 5 && roll < 0.05) return "hybrid";
    if (this.waveNumber >= 3 && roll < 0.15) return "heavy";
    if (roll < 0.3) return "insectoid";
    if (roll < 0.5) return "drone";
    return "soldier";
  }

  update(playerPosition: BABYLON.Vector3, deltaTime: number): { damage: number; hits: EnemyUnit[] } {
    this.spawnTimer += deltaTime;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0;
      this.spawnEnemy(playerPosition);
    }

    let totalDamage = 0;
    const attackingEnemies: EnemyUnit[] = [];
    const dt = deltaTime / 1000;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.isAlive && enemy.mesh.isDisposed()) {
        this.enemies.splice(i, 1);
        continue;
      }

      const damage = enemy.update(dt, playerPosition);
      if (damage > 0) {
        totalDamage += damage;
        attackingEnemies.push(enemy);
      }
    }

    return { damage: totalDamage, hits: attackingEnemies };
  }

  damageEnemy(mesh: BABYLON.Mesh, damage: number): { killed: boolean; credits: number; experience: number } {
    const enemy = this.enemies.find(e => e.mesh === mesh);
    if (!enemy || !enemy.isAlive) return { killed: false, credits: 0, experience: 0 };

    const info: DamageInfo = {
      amount: damage,
      damageType: DamageType.Plasma,
      hitPoint: mesh.position.clone(),
    };
    const result = enemy.takeDamage(info);

    if (result.wasKilled) {
      const config = enemy.getConfig();
      return { killed: true, credits: config.credits, experience: config.experienceValue };
    }
    return { killed: false, credits: 0, experience: 0 };
  }

  getEnemyMeshes(): BABYLON.Mesh[] {
    return this.enemies.filter(e => e.isAlive).map(e => e.mesh);
  }

  getEnemyCount(): number {
    return this.enemies.filter(e => e.isAlive).length;
  }

  nextWave(): void {
    this.waveNumber++;
    this.spawnInterval = Math.max(2000, this.spawnInterval - 200);
    this.maxEnemies = Math.min(50, this.maxEnemies + 2);
    this.bus.emit(GameEvents.WAVE_STARTED, { wave: this.waveNumber });
  }

  getWaveNumber(): number {
    return this.waveNumber;
  }
}
