import * as BABYLON from "@babylonjs/core";
import { StateMachine } from "./StateMachine";
import { EventBus, GameEvents } from "./EventBus";
import { DamageInfo, DamageResult, DamageResistance, IDamageable, DamageType, applyDamage } from "./DamageSystem";
import { RobotFactory } from "./RobotFactory";
import { ROBOT_PRESETS } from "./RobotPresets";
import { HumanoidCharacter } from "./HumanoidCharacter";
import { HUMANOID_PRESETS } from "./HumanoidPresets";
import { BossVariant, BossVariantId, BOSS_VARIANTS, getBossVariant } from "./BossVariants";

export type EnemyType = "drone" | "soldier" | "heavy" | "insectoid" | "hybrid" | "commander" | "captain";
export type EnemyAIState = "idle" | "patrol" | "chase" | "attack" | "stunned" | "dead" | "flying" | "hovering" | "dodging";

/** A homing red orb the BossCaptain fires at the player. Tracked per-captain
 *  so we can lerp it forward + check the impact-radius each frame, and clean
 *  up the mesh when its lifetime expires. */
interface CaptainTracker {
  mesh: BABYLON.Mesh;
  trail: BABYLON.Mesh;
  ttl: number;
  speed: number;
  damage: number;
  done: boolean;
}

/** Pending elemental dome the BossCaptain has armed. The visual sphere
 *  expands over ~0.45s; once it crosses the damage frame we apply AoE to
 *  the player if they're inside the final radius. */
interface CaptainDome {
  mesh: BABYLON.Mesh;
  origin: BABYLON.Vector3;
  age: number;
  duration: number;
  radius: number;
  damage: number;
  fired: boolean;
}

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
  // Boss Captain — abilities mirror the player (sabre slash, tracker, dash, dome).
  // High HP, fast, and dangerous: this is the inner boss of the boss fortress.
  captain: {
    maxHealth: 2400, attackDamage: 38, defense: 22, movementSpeed: 6, attackCooldown: 1.4,
    knockbackForce: 1400, experienceValue: 800, detectionRange: 60, chaseRange: 90,
    attackRange: 6.5, patrolSpeed: 0.08, chaseSpeed: 0.16, credits: 500,
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
  private shakeTimer: number = 0;
  private lastHitFxAt: number = 0;
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

  // ---- BossCaptain-only state (mirrors player abilities) ----
  /** Visible red sabre prop carried by a captain — null for other types. */
  private captainSabre: BABYLON.Mesh | null = null;
  /** Cooldown gate so the captain doesn't spam tracker / dome every frame. */
  private captainAbilityCd: number = 0;
  /** Active homing red orbs in flight. Each is ticked + collided per-frame. */
  private captainTrackers: CaptainTracker[] = [];
  /** Currently-armed AoE dome (only one at a time). */
  private captainDome: CaptainDome | null = null;
  /** Damage from completed trackers/dome impacts, drained each `update()`. */
  private pendingDamage: number = 0;
  /** Last player position, sampled every frame so async impact callbacks
   *  (setTimeout-based dome detonation) can score against the latest pos. */
  private lastPlayerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  /** True for captains spawned by the boss fortress: emit a special ENEMY_KILLED
   *  payload so Game.tsx can broadcast a victory toast. */
  public isBossCaptain: boolean = false;
  /** Boss-variant theme (color + stat scalars) used when this enemy is a
   *  captain. Null for every other type — the variant has no effect on
   *  drones / soldiers / heavies / etc. */
  private captainVariant: BossVariant | null = null;

  constructor(mesh: BABYLON.Mesh, type: EnemyType, waveMultiplier: number = 1, variant?: BossVariant | null) {
    this.mesh = mesh;
    this.type = type;
    this.config = { ...ENEMY_CONFIGS[type] };
    if (type === "captain" && variant) this.captainVariant = variant;
    const hpMul = this.captainVariant?.healthMultiplier ?? 1;
    const dmgMul = this.captainVariant?.damageMultiplier ?? 1;
    this.config.maxHealth *= waveMultiplier * hpMul;
    this.config.attackDamage *= waveMultiplier * dmgMul;
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

    if (type === "captain") {
      this.createCaptainAura();
      this.createCaptainSabre();
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

    if (this.type === "captain") {
      this.lastPlayerPos.copyFrom(playerPosition);
      this.updateAura();
      this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
      this.captainAbilityCd = Math.max(0, this.captainAbilityCd - dt);
      this.tickCaptainTrackers(dt, playerPosition);
      this.tickCaptainDome(dt);
      // While chasing or attacking, fire a special when ability cooldown is up.
      if ((state === "chase" || state === "attack") && this.captainAbilityCd <= 0) {
        const dist = BABYLON.Vector3.Distance(this.mesh.position, playerPosition);
        if (dist <= 9.5) {
          this.captainCastDome();
          this.captainAbilityCd = 4.2;
        } else if (dist <= 45) {
          this.captainCastTracker(playerPosition);
          this.captainAbilityCd = 2.4;
        }
      }
    }

    let dmg = 0;
    switch (state) {
      case "idle": dmg = this.updateIdle(dt, playerPosition); break;
      case "patrol": dmg = this.updatePatrol(dt, playerPosition); break;
      case "chase": dmg = this.updateChase(dt, playerPosition); break;
      case "attack": dmg = this.updateAttack(dt, playerPosition); break;
      case "stunned": dmg = this.updateStunned(dt); break;
      case "flying": dmg = this.updateFlying(dt, playerPosition); break;
      case "hovering": dmg = this.updateHovering(dt, playerPosition); break;
      case "dodging": dmg = this.updateDodging(dt, playerPosition); break;
    }

    // Drain async damage accumulated by captain abilities (tracker + dome).
    if (this.pendingDamage > 0) {
      dmg += this.pendingDamage;
      this.pendingDamage = 0;
    }

    // Hit-shake jitter — applied AFTER FSM movement so it visibly displaces the mesh briefly.
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      const intensity = 0.18 * (this.shakeTimer / 0.18);
      this.mesh.position.x += (Math.random() - 0.5) * intensity;
      this.mesh.position.z += (Math.random() - 0.5) * intensity;
    }

    return dmg;
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
      } else if (this.type === "captain") {
        this.captainSabreSlashEffect(playerPos);
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
    if (this.dodgeCooldown > 0) return false;
    // Captains dash much more aggressively than commanders.
    if (this.type === "commander") {
      if (Math.random() > 0.4) return false;
    } else if (this.type === "captain") {
      if (Math.random() > 0.65) return false;
    } else {
      return false;
    }

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

    if ((this.type === "commander" || this.type === "captain") && info.hitPoint) {
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
    this.shakeTimer = 0.18;

    // Throttle hit-impact spawns per-enemy to ~80ms so rapid-fire weapons
    // don't generate a runaway storm of effect meshes/materials.
    const now = performance.now();
    if (now - this.lastHitFxAt > 80) {
      this.lastHitFxAt = now;
      const impactPos = (info.hitPoint ? info.hitPoint.clone() : this.mesh.position.clone());
      const impactScale = this.type === "commander" ? 1.6 : this.type === "heavy" || this.type === "hybrid" ? 1.25 : 1.0;
      this.bus.emit("effect:hitImpact", {
        position: impactPos,
        color: new BABYLON.Color3(1.0, 0.85, 0.25),
        scale: impactScale,
      });
    }

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
    } else if (this.type === "captain") {
      // Captains barely flinch — only a quick 0.25s stagger so the player can
      // still combo, but the boss never gets perma-locked into a stun chain.
      const cur = this.fsm.getState();
      if (cur !== "stunned" && cur !== "dodging") {
        this.fsm.changeState("stunned");
        this.stunTimer = 0.25;
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
    // Tint the entire mesh hierarchy red briefly so it's obvious the robot was hit.
    const mats: BABYLON.StandardMaterial[] = [];
    const originals: BABYLON.Color3[] = [];

    const collect = (n: BABYLON.AbstractMesh) => {
      const m = n.material as BABYLON.StandardMaterial | null;
      if (m && m.emissiveColor) {
        mats.push(m);
        originals.push(m.emissiveColor.clone());
      }
    };
    collect(this.mesh);
    for (const child of this.mesh.getChildMeshes()) collect(child as BABYLON.AbstractMesh);

    const RED = new BABYLON.Color3(1.0, 0.12, 0.12);
    for (const m of mats) m.emissiveColor = RED;

    setTimeout(() => {
      for (let i = 0; i < mats.length; i++) {
        if (mats[i]) mats[i].emissiveColor = originals[i];
      }
    }, 160);
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
    } else if (this.type === "captain") {
      lootData.rareLoot = true;
      lootData.upgradeModules = 3 + Math.floor(Math.random() * 4);
      lootData.credits = this.config.credits * 2;
      lootData.isBossCaptain = this.isBossCaptain;
    }

    this.bus.emit(GameEvents.ENEMY_KILLED, lootData);

    if (this.type === "commander" || this.type === "captain") {
      this.createCommanderDeathEffect();
    } else {
      this.createDeathEffect();
    }

    // Captains: actively dispose orbiting projectiles + dome so they don't
    // outlive the corpse and keep ticking damage.
    if (this.type === "captain") {
      for (const t of this.captainTrackers) {
        if (!t.mesh.isDisposed()) try { t.mesh.dispose(); } catch {}
        if (!t.trail.isDisposed()) try { t.trail.dispose(); } catch {}
      }
      this.captainTrackers = [];
      if (this.captainDome && !this.captainDome.mesh.isDisposed()) {
        try { this.captainDome.mesh.dispose(); } catch {}
      }
      this.captainDome = null;
      if (this.captainSabre && !this.captainSabre.isDisposed()) {
        try { this.captainSabre.dispose(); } catch {}
        this.captainSabre = null;
      }
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

  // ============================================================================
  //                    Boss Captain — abilities mirror player
  // ============================================================================

  /** Resolve a per-channel BABYLON color from the captain's active variant
   *  (defaults to inferno red when no variant was supplied). */
  private variantColor(channel: "aura" | "sabre" | "projectile"): BABYLON.Color3 {
    const v = this.captainVariant ?? BOSS_VARIANTS.inferno;
    const c = channel === "aura" ? v.auraColor
            : channel === "sabre" ? v.sabreColor
            : v.projectileColor;
    return new BABYLON.Color3(c.r, c.g, c.b);
  }

  /** Pulsing variant-tinted aura around the captain (more menacing than the
   *  commander's orange aura). Color is driven by the variant. */
  private createCaptainAura(): void {
    const scene = this.mesh.getScene();
    this.auraMesh = BABYLON.MeshBuilder.CreateSphere("captainAura", { diameter: 5.5, segments: 12 }, scene);
    this.auraMesh.parent = this.mesh;
    this.auraMesh.position = BABYLON.Vector3.Zero();
    const auraMat = new BABYLON.StandardMaterial("captainAuraMat", scene);
    auraMat.emissiveColor = this.variantColor("aura");
    auraMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    auraMat.alpha = 0.16;
    auraMat.backFaceCulling = false;
    this.auraMesh.material = auraMat;
  }

  /** Variant-colored beam-sabre prop parented to the captain so it's visible
   *  at rest and during the attack swing. */
  private createCaptainSabre(): void {
    const scene = this.mesh.getScene();
    const blade = BABYLON.MeshBuilder.CreateCylinder("captainSabre", {
      height: 3.0,
      diameter: 0.22,
      tessellation: 8,
    }, scene);
    const mat = new BABYLON.StandardMaterial("captainSabreMat", scene);
    mat.emissiveColor = this.variantColor("sabre");
    mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    mat.disableLighting = true;
    blade.material = mat;
    blade.parent = this.mesh;
    // Hold it on the right side, tilted slightly forward.
    blade.position.set(0.65, 0.4, 0.6);
    blade.rotation.set(0, 0, 0.25);
    this.captainSabre = blade;
  }

  /** Wide red arc-slash visual + brief sabre swing animation. The actual
   *  damage is the standard `attackDamage` already returned by updateAttack. */
  private captainSabreSlashEffect(playerPos: BABYLON.Vector3): void {
    const scene = this.mesh.getScene();
    const origin = this.mesh.position.clone();
    origin.y += 1.0;

    const dir = playerPos.subtract(origin);
    dir.y = 0;
    if (dir.lengthSquared() < 0.001) return;
    dir.normalize();

    // Arc disc projected on the ground in front of the captain.
    const arc = BABYLON.MeshBuilder.CreateDisc("captainSlashArc", {
      radius: this.config.attackRange + 1.5,
      tessellation: 24,
    }, scene);
    arc.rotation.x = Math.PI / 2;
    arc.position = origin.clone();
    arc.position.addInPlace(dir.scale(1.5));
    const mat = new BABYLON.StandardMaterial("captainSlashMat", scene);
    mat.emissiveColor = this.variantColor("sabre");
    mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    mat.alpha = 0.65;
    mat.backFaceCulling = false;
    arc.material = mat;

    // Sabre swing — quick rotation around its parent.
    if (this.captainSabre && !this.captainSabre.isDisposed()) {
      const sabre = this.captainSabre;
      const startZ = sabre.rotation.z;
      let f = 0;
      const swing = () => {
        f++;
        sabre.rotation.z = startZ + Math.sin(f * 0.4) * 1.4;
        if (f < 8) requestAnimationFrame(swing);
        else sabre.rotation.z = startZ;
      };
      swing();
    }

    let frame = 0;
    const animate = () => {
      frame++;
      arc.scaling.setAll(1 + frame * 0.06);
      mat.alpha = Math.max(0, 0.65 - frame * 0.07);
      if (frame < 10) requestAnimationFrame(animate);
      else {
        arc.dispose();
        try { mat.dispose(); } catch {}
      }
    };
    animate();
  }

  /** Fire a homing red orb at the player. Lerps toward the player position
   *  each frame in tickCaptainTrackers and applies damage on impact. */
  private captainCastTracker(playerPos: BABYLON.Vector3): void {
    const scene = this.mesh.getScene();
    const start = this.mesh.position.clone();
    start.y += 1.4;

    const orb = BABYLON.MeshBuilder.CreateSphere("captainTracker", { diameter: 0.85, segments: 12 }, scene);
    orb.position = start.clone();
    const mat = new BABYLON.StandardMaterial("captainTrackerMat", scene);
    mat.emissiveColor = this.variantColor("projectile");
    mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    mat.disableLighting = true;
    orb.material = mat;

    const trail = BABYLON.MeshBuilder.CreateSphere("captainTrackerTrail", { diameter: 1.4, segments: 10 }, scene);
    trail.position = start.clone();
    const tmat = new BABYLON.StandardMaterial("captainTrackerTrailMat", scene);
    tmat.emissiveColor = this.variantColor("projectile").scale(0.85);
    tmat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    tmat.alpha = 0.32;
    tmat.backFaceCulling = false;
    trail.material = tmat;
    trail.parent = orb;
    trail.position = BABYLON.Vector3.Zero();

    const tracker: CaptainTracker = {
      mesh: orb,
      trail,
      ttl: 3.5,
      speed: 22,
      damage: this.config.attackDamage * 0.9,
      done: false,
    };
    this.captainTrackers.push(tracker);
  }

  private tickCaptainTrackers(dt: number, playerPos: BABYLON.Vector3): void {
    if (this.captainTrackers.length === 0) return;
    for (let i = this.captainTrackers.length - 1; i >= 0; i--) {
      const t = this.captainTrackers[i];
      t.ttl -= dt;
      if (t.done || t.ttl <= 0) {
        if (!t.mesh.isDisposed()) try { t.mesh.dispose(); } catch {}
        this.captainTrackers.splice(i, 1);
        continue;
      }

      const aim = playerPos.clone();
      aim.y += 1.0;
      const toTarget = aim.subtract(t.mesh.position);
      const dist = toTarget.length();
      if (dist < 1.4) {
        // Impact!
        this.pendingDamage += t.damage;
        this.bus.emit("effect:hitImpact", {
          position: t.mesh.position.clone(),
          color: this.variantColor("projectile"),
          scale: 1.4,
        });
        t.done = true;
        continue;
      }
      const step = Math.min(dist, t.speed * dt);
      t.mesh.position.addInPlace(toTarget.normalize().scale(step));
    }
  }

  /** Spawn an expanding red dome centered on the captain. After `duration`s
   *  the dome detonates and applies AoE damage if the player is within. */
  private captainCastDome(): void {
    if (this.captainDome) return;
    const scene = this.mesh.getScene();
    const origin = this.mesh.position.clone();
    const radius = 9.0;

    const dome = BABYLON.MeshBuilder.CreateSphere("captainDome", { diameter: 1.5, segments: 16 }, scene);
    dome.position = origin.clone();
    const mat = new BABYLON.StandardMaterial("captainDomeMat", scene);
    mat.emissiveColor = this.variantColor("projectile");
    mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    mat.alpha = 0.45;
    mat.backFaceCulling = false;
    dome.material = mat;

    this.captainDome = {
      mesh: dome,
      origin,
      age: 0,
      duration: 0.55,
      radius,
      damage: this.config.attackDamage * 1.35,
      fired: false,
    };

    // Telegraph ring on the ground so the player sees the danger zone early.
    const ring = BABYLON.MeshBuilder.CreateTorus("captainDomeRing", { diameter: radius * 2, thickness: 0.18, tessellation: 32 }, scene);
    ring.position = origin.clone();
    ring.position.y = 0.1;
    const rmat = new BABYLON.StandardMaterial("captainDomeRingMat", scene);
    rmat.emissiveColor = this.variantColor("projectile");
    rmat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    rmat.disableLighting = true;
    ring.material = rmat;
    setTimeout(() => {
      if (!ring.isDisposed()) try { ring.dispose(); } catch {}
      try { rmat.dispose(); } catch {}
    }, 700);
  }

  private tickCaptainDome(dt: number): void {
    const d = this.captainDome;
    if (!d) return;
    d.age += dt;
    const t = Math.min(1, d.age / d.duration);
    d.mesh.scaling.setAll(1 + t * d.radius * 1.3);
    const mat = d.mesh.material as BABYLON.StandardMaterial;
    if (mat) mat.alpha = Math.max(0, 0.55 - t * 0.55);

    if (!d.fired && t >= 1) {
      d.fired = true;
      // AoE damage check against the captain's last sampled player position.
      const dist = BABYLON.Vector3.Distance(this.lastPlayerPos, d.origin);
      if (dist <= d.radius) {
        this.pendingDamage += d.damage;
        this.bus.emit("effect:hitImpact", {
          position: this.lastPlayerPos.clone(),
          color: this.variantColor("projectile"),
          scale: 1.6,
        });
      }
    }
    if (d.age >= d.duration + 0.2) {
      if (!d.mesh.isDisposed()) try { d.mesh.dispose(); } catch {}
      this.captainDome = null;
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

  private createEnemyMesh(type: EnemyType, position: BABYLON.Vector3, variant?: BossVariant | null): BABYLON.Mesh {
    // Commanders + Captains use humanoid models instead of robots.
    if (type === "commander" || type === "captain") {
      const captainPresets = [
        "HumanoidCaptainAlpha",
        "HumanoidCaptainBeta",
        "HumanoidCaptainGamma",
        "HumanoidCaptainOmega",
      ];
      const randomPreset = captainPresets[Math.floor(Math.random() * captainPresets.length)];
      const def = HUMANOID_PRESETS[randomPreset];

      if (def) {
        const humanoid = new HumanoidCharacter(this.scene, def);
        const root = humanoid.getRoot();
        root.position = position;

        // Captains stand a touch taller than commanders.
        const hitH = type === "captain" ? 4.6 : 4.0;
        const hitR = type === "captain" ? 1.0 : 0.9;
        const hitbox = BABYLON.MeshBuilder.CreateCapsule(`enemyHit_${type}_${Date.now()}`, {
          height: hitH,
          radius: hitR,
        }, this.scene);
        hitbox.isVisible = false;
        hitbox.position.copyFrom(position);
        root.parent = hitbox;
        root.position = BABYLON.Vector3.Zero();

        // Captains: re-tint every visible material to match the variant
        // theme (inferno red, plague green, frost cyan, storm violet, void
        // purple). Each level assigns its own variant so the player reads
        // the threat at a glance. Commanders keep their preset palette.
        if (type === "captain") {
          const v = variant ?? BOSS_VARIANTS.inferno;
          for (const m of root.getChildMeshes()) {
            const mat = m.material as BABYLON.StandardMaterial | null;
            if (mat) {
              if (mat.diffuseColor) {
                mat.diffuseColor = new BABYLON.Color3(
                  Math.min(1, mat.diffuseColor.r * v.tint.r),
                  Math.min(1, mat.diffuseColor.g * v.tint.g),
                  Math.min(1, mat.diffuseColor.b * v.tint.b),
                );
              }
              if (mat.emissiveColor) {
                mat.emissiveColor = new BABYLON.Color3(
                  Math.min(1, mat.emissiveColor.r * v.tint.r + v.emissiveBoost.r),
                  Math.min(1, mat.emissiveColor.g * v.tint.g + v.emissiveBoost.g),
                  Math.min(1, mat.emissiveColor.b * v.tint.b + v.emissiveBoost.b),
                );
              }
            }
          }
        }

        return hitbox;
      }
    }

    const presetMap: Record<EnemyType, string[]> = {
      drone: ["JetWarden"],
      soldier: ["ScoutPrime"],
      heavy: ["TankTitan", "OptimusForge"],
      insectoid: ["InsectoidStalker"],
      hybrid: ["HybridOmega", "HybridApex"],
      commander: ["CommanderOmega"],
      // Fallback only — captains are normally built in the humanoid branch
      // above and never reach this map.
      captain: ["CommanderOmega"],
    };

    const variants = presetMap[type] || ["ScoutPrime"];
    const presetName = variants[Math.floor(Math.random() * variants.length)];
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

  /** Spawn the BossCaptain at a precise world position. Used by the boss
   *  fortress (after its outer turrets fall) and by the Level-2 spawner.
   *  When `isBossCaptain` is true the death payload includes a flag so
   *  Game.tsx can announce the kill + advance the level. Captains DO NOT
   *  count against `maxEnemies` so they can always spawn. */
  spawnCaptain(position: BABYLON.Vector3, opts?: {
    isBossCaptain?: boolean;
    healthMultiplier?: number;
    /** Boss-variant theme (defaults to inferno red — the original look). */
    variantId?: BossVariantId;
  }): EnemyUnit {
    const variant = getBossVariant(opts?.variantId);
    const mesh = this.createEnemyMesh("captain", position, variant);
    const waveMultiplier = (1 + (this.waveNumber - 1) * 0.25) * (opts?.healthMultiplier ?? 1);
    const enemy = new EnemyUnit(mesh, "captain", waveMultiplier, variant);
    enemy.isBossCaptain = !!opts?.isBossCaptain;
    this.enemies.push(enemy);
    this.bus.emit(GameEvents.ENEMY_SPAWNED, {
      type: "captain",
      position,
      isBossCaptain: enemy.isBossCaptain,
      variantId: variant.id,
      variantName: variant.displayName,
      taunt: variant.taunt,
    });
    return enemy;
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

  getActiveEnemies(): EnemyUnit[] {
    return this.enemies.filter(e => e.isAlive);
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

  /** Force the wave counter forward (used when starting Level 2 to make
   *  every spawn meaningfully tougher). Bumps spawn interval / max-enemy
   *  cap the same way nextWave() does, but without re-emitting every
   *  WAVE_STARTED tick along the way. */
  jumpToWave(targetWave: number): void {
    if (targetWave <= this.waveNumber) return;
    while (this.waveNumber < targetWave) {
      this.waveNumber++;
      this.spawnInterval = Math.max(2000, this.spawnInterval - 200);
      this.maxEnemies = Math.min(50, this.maxEnemies + 2);
    }
    this.bus.emit(GameEvents.WAVE_STARTED, { wave: this.waveNumber });
  }
}
