import * as BABYLON from "@babylonjs/core";
import { StateMachine } from "./StateMachine";
import { EventBus, GameEvents } from "./EventBus";
import { DamageInfo, DamageResult, DamageResistance, IDamageable, DamageType, applyDamage } from "./DamageSystem";
import { RobotFactory } from "./RobotFactory";
import { ROBOT_PRESETS } from "./RobotPresets";

export type EnemyType = "drone" | "soldier" | "heavy" | "insectoid" | "hybrid" | "commander";
export type EnemyAIState = "idle" | "patrol" | "chase" | "attack" | "stunned" | "dead" | "flying" | "hovering" | "dodging";

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
  commander: {
    maxHealth: 1500, attackDamage: 50, defense: 25, movementSpeed: 5, attackCooldown: 2.0,
    knockbackForce: 1200, experienceValue: 500, detectionRange: 45, chaseRange: 60,
    attackRange: 12, patrolSpeed: 0.06, chaseSpeed: 0.12, credits: 250,
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

  private flightHeight: number = 0;
  private targetFlightHeight: number = 0;
  private dodgeTimer: number = 0;
  private dodgeCooldown: number = 0;
  private dodgeDirection: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private auraMesh: BABYLON.Mesh | null = null;

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

    if (type === "commander") {
      this.flightHeight = mesh.position.y;
      this.targetFlightHeight = mesh.position.y;
      this.createCommanderAura();
    }

    mesh.metadata = {
      ...mesh.metadata,
      isEnemy: true,
      damageable: this,
      enemyUnit: this,
    };
  }

  private setupFSM(): void {
    this.fsm.addState({ name: "idle", transitions: ["patrol", "chase", "flying", "stunned", "dead"] });
    this.fsm.addState({ name: "patrol", transitions: ["idle", "chase", "flying", "stunned", "dead"] });
    this.fsm.addState({ name: "chase", transitions: ["patrol", "attack", "flying", "dodging", "stunned", "dead"] });
    this.fsm.addState({ name: "attack", transitions: ["chase", "flying", "dodging", "stunned", "dead"] });
    this.fsm.addState({ name: "stunned", transitions: ["chase", "idle", "flying", "dead"] });
    this.fsm.addState({ name: "flying", transitions: ["hovering", "chase", "attack", "dodging", "stunned", "dead"] });
    this.fsm.addState({ name: "hovering", transitions: ["flying", "chase", "attack", "dodging", "stunned", "dead"] });
    this.fsm.addState({ name: "dodging", transitions: ["chase", "flying", "attack", "stunned", "dead"] });
    this.fsm.addState({ name: "dead" });
  }

  private createCommanderAura(): void {
    const scene = this.mesh.getScene();
    this.auraMesh = BABYLON.MeshBuilder.CreateSphere("cmdAura", { diameter: 4.5, segments: 12 }, scene);
    this.auraMesh.parent = this.mesh;
    this.auraMesh.position = BABYLON.Vector3.Zero();
    const auraMat = new BABYLON.StandardMaterial("cmdAuraMat", scene);
    auraMat.emissiveColor = new BABYLON.Color3(1.0, 0.4, 0.0);
    auraMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    auraMat.alpha = 0.12;
    auraMat.backFaceCulling = false;
    this.auraMesh.material = auraMat;
  }

  private updateAura(): void {
    if (this.auraMesh && !this.auraMesh.isDisposed()) {
      const pulse = 1.0 + Math.sin(Date.now() * 0.004) * 0.15;
      this.auraMesh.scaling.setAll(pulse);
      const mat = this.auraMesh.material as BABYLON.StandardMaterial;
      if (mat) {
        mat.alpha = 0.08 + Math.sin(Date.now() * 0.003) * 0.04;
      }
    }
  }

  update(dt: number, playerPosition: BABYLON.Vector3): number {
    if (!this.isAlive) return 0;

    this.fsm.update(dt);
    const state = this.fsm.getState();

    if (this.type === "commander") {
      this.updateAura();
      this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    }

    switch (state) {
      case "idle": return this.updateIdle(dt, playerPosition);
      case "patrol": return this.updatePatrol(dt, playerPosition);
      case "chase": return this.updateChase(dt, playerPosition);
      case "attack": return this.updateAttack(dt, playerPosition);
      case "stunned": return this.updateStunned(dt);
      case "flying": return this.updateFlying(dt, playerPosition);
      case "hovering": return this.updateHovering(dt, playerPosition);
      case "dodging": return this.updateDodging(dt, playerPosition);
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
    if (this.type === "commander") {
      this.mesh.position.y += Math.sin(Date.now() * 0.002) * 0.02;
    }
    return 0;
  }

  private updateChase(dt: number, playerPos: BABYLON.Vector3): number {
    const dir = playerPos.subtract(this.mesh.position);
    const dist = dir.length();

    if (this.type === "commander") {
      if (playerPos.y > this.mesh.position.y + 5) {
        this.targetFlightHeight = playerPos.y + 3;
        this.fsm.changeState("flying");
        return 0;
      }
    }

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
    } else if (this.type === "commander") {
      const targetY = Math.max(this.patrolOrigin.y, 1.5);
      this.mesh.position.y += (targetY - this.mesh.position.y) * 0.05;
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
      if (this.type === "commander") {
        this.createCommanderAttackEffect();
      } else {
        this.createAttackEffect();
      }
    }

    return damage;
  }

  private updateStunned(dt: number): number {
    this.stunTimer -= dt;
    if (this.stunTimer <= 0) {
      if (this.type === "commander") {
        this.fsm.changeState("flying");
        this.targetFlightHeight = this.mesh.position.y + 8 + Math.random() * 5;
      } else {
        this.fsm.changeState("chase");
      }
    }
    return 0;
  }

  private updateFlying(dt: number, playerPos: BABYLON.Vector3): number {
    const heightDiff = this.targetFlightHeight - this.mesh.position.y;
    this.mesh.position.y += heightDiff * 0.08;

    const dir = playerPos.subtract(this.mesh.position);
    const horizDist = new BABYLON.Vector3(dir.x, 0, dir.z).length();

    if (Math.abs(heightDiff) < 1) {
      this.fsm.changeState("hovering");
      return 0;
    }

    if (horizDist > 5) {
      const moveDir = dir.clone();
      moveDir.y = 0;
      moveDir.normalize();
      this.mesh.position.addInPlace(moveDir.scale(this.config.chaseSpeed * 1.5));
      this.faceDirection(moveDir);
    }

    return 0;
  }

  private updateHovering(dt: number, playerPos: BABYLON.Vector3): number {
    this.mesh.position.y += Math.sin(Date.now() * 0.003) * 0.03;

    const dir = playerPos.subtract(this.mesh.position);
    const dist = dir.length();

    if (dist <= this.config.attackRange * 1.5) {
      this.fsm.changeState("attack");
      this.attackTimer = 0.3;
      return 0;
    }

    const moveDir = dir.clone();
    moveDir.normalize();
    this.mesh.position.addInPlace(moveDir.scale(this.config.chaseSpeed * 1.2));
    this.faceDirection(dir);

    if (dist > this.config.chaseRange) {
      this.targetFlightHeight = 1.5;
      this.fsm.changeState("flying");
    }

    return 0;
  }

  private updateDodging(dt: number, _playerPos: BABYLON.Vector3): number {
    this.dodgeTimer -= dt;

    this.mesh.position.addInPlace(this.dodgeDirection.scale(0.4));

    if (this.dodgeTimer <= 0) {
      this.fsm.changeState("chase");
    }
    return 0;
  }

  private tryDodge(playerPos: BABYLON.Vector3): boolean {
    if (this.type !== "commander" || this.dodgeCooldown > 0) return false;
    if (Math.random() > 0.4) return false;

    const toPlayer = playerPos.subtract(this.mesh.position);
    toPlayer.y = 0;
    toPlayer.normalize();
    const side = Math.random() > 0.5 ? 1 : -1;
    this.dodgeDirection = new BABYLON.Vector3(-toPlayer.z * side, 0, toPlayer.x * side);
    this.dodgeTimer = 0.3;
    this.dodgeCooldown = 2.0;
    this.fsm.changeState("dodging");
    this.createDodgeEffect();
    return true;
  }

  private checkForPlayer(playerPos: BABYLON.Vector3): void {
    const dist = BABYLON.Vector3.Distance(this.mesh.position, playerPos);
    if (dist <= this.config.detectionRange) {
      if (this.type === "commander" && playerPos.y > 10) {
        this.targetFlightHeight = playerPos.y + 3;
        this.fsm.changeState("flying");
      } else {
        this.fsm.changeState("chase");
      }
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

    if (this.type === "commander" && info.hitPoint) {
      if (this.tryDodge(info.hitPoint)) {
        return { damageAmount: 0, wasKilled: false, wasBlocked: false, wasParried: false };
      }
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

    if (this.type === "commander") {
      if (this.health < this.maxHealth * 0.5 && this.fsm.getState() !== "flying") {
        this.targetFlightHeight = this.mesh.position.y + 10 + Math.random() * 8;
        this.fsm.changeState("flying");
      } else if (this.fsm.getState() !== "stunned") {
        this.fsm.changeState("stunned");
        this.stunTimer = 0.8;
      }
    } else {
      if (this.fsm.getState() !== "stunned") {
        this.fsm.changeState("stunned");
        this.stunTimer = 1.5;
      }
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

    const lootData: any = {
      type: this.type,
      credits: this.config.credits,
      experience: this.config.experienceValue,
      position: this.mesh.position.clone(),
    };

    if (this.type === "commander") {
      lootData.rareLoot = true;
      lootData.upgradeModules = 1 + Math.floor(Math.random() * 3);
      lootData.credits = this.config.credits * 2;
    }

    this.bus.emit(GameEvents.ENEMY_KILLED, lootData);

    if (this.type === "commander") {
      this.createCommanderDeathEffect();
    } else {
      this.createDeathEffect();
    }
    setTimeout(() => {
      if (this.auraMesh && !this.auraMesh.isDisposed()) {
        this.auraMesh.dispose();
      }
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

  private createCommanderAttackEffect(): void {
    const scene = this.mesh.getScene();
    const pos = this.mesh.position.clone();

    const beam = BABYLON.MeshBuilder.CreateCylinder("cmdBeam", {
      height: this.config.attackRange,
      diameter: 0.6,
      tessellation: 8,
    }, scene);
    beam.position = pos.clone();
    beam.position.y += 1;
    const forward = this.mesh.forward || new BABYLON.Vector3(0, 0, 1);
    beam.lookAt(pos.add(forward.scale(this.config.attackRange)));
    beam.rotation.x += Math.PI / 2;
    const beamMat = new BABYLON.StandardMaterial("cmdBeamMat", scene);
    beamMat.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.0);
    beamMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    beamMat.alpha = 0.7;
    beam.material = beamMat;

    const flash = BABYLON.MeshBuilder.CreateSphere("cmdFlash", { diameter: 1.5, segments: 8 }, scene);
    flash.position = pos.clone();
    const flashMat = new BABYLON.StandardMaterial("cmdFlashMat", scene);
    flashMat.emissiveColor = new BABYLON.Color3(1.0, 0.6, 0.0);
    flashMat.alpha = 0.9;
    flash.material = flashMat;

    let frame = 0;
    const animate = () => {
      frame++;
      beamMat.alpha = Math.max(0, 0.7 - frame * 0.07);
      flashMat.alpha = Math.max(0, 0.9 - frame * 0.09);
      flash.scaling.setAll(1 + frame * 0.3);
      if (frame < 10) requestAnimationFrame(animate);
      else {
        beam.dispose();
        flash.dispose();
      }
    };
    animate();
  }

  private createDodgeEffect(): void {
    const scene = this.mesh.getScene();
    const pos = this.mesh.position.clone();
    const afterimage = BABYLON.MeshBuilder.CreateBox("dodgeGhost", { size: 1.5 }, scene);
    afterimage.position = pos;
    const mat = new BABYLON.StandardMaterial("dodgeMat", scene);
    mat.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.0);
    mat.alpha = 0.5;
    afterimage.material = mat;

    let frame = 0;
    const animate = () => {
      frame++;
      mat.alpha = Math.max(0, 0.5 - frame * 0.05);
      if (frame < 10) requestAnimationFrame(animate);
      else afterimage.dispose();
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

  private createCommanderDeathEffect(): void {
    const scene = this.mesh.getScene();
    const pos = this.mesh.position.clone();

    const explosion = BABYLON.MeshBuilder.CreateSphere("cmdExplosion", { diameter: 2, segments: 12 }, scene);
    explosion.position = pos.clone();
    const explMat = new BABYLON.StandardMaterial("cmdExplMat", scene);
    explMat.emissiveColor = new BABYLON.Color3(1.0, 0.6, 0.0);
    explMat.alpha = 1.0;
    explosion.material = explMat;

    for (let i = 0; i < 20; i++) {
      const particle = BABYLON.MeshBuilder.CreateBox("cmdDeathP", { size: 0.3 + Math.random() * 0.2 }, scene);
      particle.position = pos.clone();
      const mat = new BABYLON.StandardMaterial("cmdDeathMat", scene);
      mat.emissiveColor = new BABYLON.Color3(1.0, 0.3 + Math.random() * 0.4, 0);
      particle.material = mat;

      const velocity = new BABYLON.Vector3(
        (Math.random() - 0.5) * 0.5,
        Math.random() * 0.5,
        (Math.random() - 0.5) * 0.5
      );

      let frame = 0;
      const animate = () => {
        frame++;
        particle.position.addInPlace(velocity);
        velocity.y -= 0.012;
        particle.rotation.addInPlace(new BABYLON.Vector3(0.15, 0.15, 0.15));
        mat.alpha = Math.max(0, 1 - frame * 0.033);
        if (frame < 30) requestAnimationFrame(animate);
        else particle.dispose();
      };
      animate();
    }

    let expFrame = 0;
    const animateExplosion = () => {
      expFrame++;
      explosion.scaling.setAll(1 + expFrame * 0.5);
      explMat.alpha = Math.max(0, 1 - expFrame * 0.05);
      if (expFrame < 20) requestAnimationFrame(animateExplosion);
      else explosion.dispose();
    };
    animateExplosion();
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
      commander: "CommanderOmega",
    };

    const presetName = presetMap[type] || "ScoutPrime";
    const preset = ROBOT_PRESETS[presetName];

    if (preset) {
      const root = this.robotFactory.createRobot(preset, position);

      const hitboxH = type === "commander" ? 4.0 : type === "hybrid" ? 3.5 : type === "heavy" ? 3 : 2;
      const hitboxR = type === "commander" ? 0.9 : type === "hybrid" ? 0.8 : type === "heavy" ? 0.7 : 0.5;
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

  spawnCommander(playerPosition: BABYLON.Vector3): void {
    if (this.enemies.length >= this.maxEnemies) return;

    const angle = Math.random() * Math.PI * 2;
    const distance = 40 + Math.random() * 40;
    const x = playerPosition.x + Math.cos(angle) * distance;
    const z = playerPosition.z + Math.sin(angle) * distance;
    const rooftopHeight = 20 + Math.random() * 30;
    const position = new BABYLON.Vector3(x, rooftopHeight, z);

    const mesh = this.createEnemyMesh("commander", position);
    const waveMultiplier = 1 + (this.waveNumber - 1) * 0.25;

    const enemy = new EnemyUnit(mesh, "commander", waveMultiplier);
    this.enemies.push(enemy);
    this.bus.emit(GameEvents.ENEMY_SPAWNED, { type: "commander", position });
  }

  private selectEnemyType(): EnemyType {
    const roll = Math.random();
    if (this.waveNumber >= 7 && roll < 0.08) return "commander";
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
