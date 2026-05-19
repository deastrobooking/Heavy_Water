import * as BABYLON from "@babylonjs/core";
import { StateMachine } from "./StateMachine";
import { EventBus, GameEvents } from "./EventBus";
import { DamageInfo, DamageResult, DamageResistance, IDamageable, DamageType, applyDamage } from "./DamageSystem";
import { RobotFactory } from "./RobotFactory";
import { ROBOT_PRESETS } from "./RobotPresets";
import { HumanoidCharacter } from "./HumanoidCharacter";
import { HUMANOID_PRESETS } from "./HumanoidPresets";
import { BossVariant, BossVariantId, BOSS_VARIANTS, getBossVariant } from "./BossVariants";
import { getEnemyStyleOverrides } from "./CharacterEditor";

export type EnemyType =
  | "drone" | "soldier" | "heavy" | "insectoid" | "hybrid"
  | "commander" | "captain" | "tank" | "titan" | "spider_tank"
  | "wilds_titan" | "wilds_transformer";
export type EnemyAIState = "idle" | "patrol" | "chase" | "attack" | "stunned" | "dead" | "flying" | "hovering" | "dodging";

/** Module-level provider so EnemyUnit instances can ask "is the player
 *  currently airborne?" without each one needing a callback wired in.
 *  Game.tsx flips this on construction via setPlayerIsFlyingProvider().
 *  Used by the commander "fly to chase the player upward" branches —
 *  when the player is grounded, commanders STAY grounded too, fixing
 *  the bug where a hit would chain stun→fly and the target-height
 *  re-add at every hit caused captains/commanders to climb forever. */
let playerIsFlyingFn: () => boolean = () => false;
export function setPlayerIsFlyingProvider(fn: () => boolean): void {
  playerIsFlyingFn = fn;
}

const ENEMY_TARGET_FRAME_SECONDS = 1 / 60;

function enemyFrameScale(dt: number): number {
  return Math.max(0, dt / ENEMY_TARGET_FRAME_SECONDS);
}

function scaledFrameLerp(perFrameAlpha: number, frameScale: number): number {
  return 1 - Math.pow(1 - perFrameAlpha, frameScale);
}

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
  // Tank — slow, heavily-armoured ground vehicle that spawns out on the
  // city OUTSKIRTS and shells the player from long range. The huge
  // attackRange (28 m) is what makes the tank distinct: it never closes —
  // it parks, faces, and fires a tracer shell every ~3.5 s. Treat it
  // as siege artillery rather than a chaser.
  tank: {
    maxHealth: 600, attackDamage: 45, defense: 18, movementSpeed: 1.8, attackCooldown: 3.5,
    knockbackForce: 1100, experienceValue: 120, detectionRange: 55, chaseRange: 80,
    attackRange: 28, patrolSpeed: 0.025, chaseSpeed: 0.045, credits: 90,
  },
  // Titan — a beefier "heavy" variant. Uses TankTitan preset upscaled
  // 1.6x with double HP + 50% more damage so it reads as a true mid-boss
  // alongside captains in late waves. Selected from the wave drip-spawn
  // and from a dedicated periodic spawner (one every ~28 s on wave 2+).
  titan: {
    maxHealth: 900, attackDamage: 38, defense: 22, movementSpeed: 2.4, attackCooldown: 2.6,
    knockbackForce: 1300, experienceValue: 220, detectionRange: 22, chaseRange: 35,
    attackRange: 9, patrolSpeed: 0.04, chaseSpeed: 0.07, credits: 140,
  },
  // Michigan Wilds apex walkers: giant versions of the classic Titan /
  // Transformer silhouettes. Spawned by MichiganTerrainSystem as landmarks
  // and minibosses rather than regular wave fodder.
  wilds_titan: {
    maxHealth: 1800, attackDamage: 55, defense: 30, movementSpeed: 2.0, attackCooldown: 2.7,
    knockbackForce: 1750, experienceValue: 460, detectionRange: 42, chaseRange: 65,
    attackRange: 12, patrolSpeed: 0.035, chaseSpeed: 0.060, credits: 320,
  },
  wilds_transformer: {
    maxHealth: 2200, attackDamage: 62, defense: 34, movementSpeed: 2.2, attackCooldown: 2.5,
    knockbackForce: 1900, experienceValue: 560, detectionRange: 46, chaseRange: 70,
    attackRange: 13, patrolSpeed: 0.038, chaseSpeed: 0.065, credits: 420,
  },
  // Spider Tank — Saginaw Lab mid-boss. Six-legged walker with a missile
  // turret on top. Stays at long range (32 m) and lobs homing tracking
  // missiles via the captainCastTracker code path, so the player feels
  // the missile-weapon read at a distance even though it's an enemy unit.
  spider_tank: {
    maxHealth: 2200, attackDamage: 55, defense: 20, movementSpeed: 2.2, attackCooldown: 2.8,
    knockbackForce: 1500, experienceValue: 600, detectionRange: 70, chaseRange: 110,
    attackRange: 32, patrolSpeed: 0.03, chaseSpeed: 0.06, credits: 400,
  },
};

export class EnemyUnit implements IDamageable {
  // Shared scratch Vector3s — safe because update() is fully synchronous
  // (no re-entrant calls from within a single FSM tick).
  private static readonly _dirScratch    = new BABYLON.Vector3();
  private static readonly _lookAtScratch = new BABYLON.Vector3();
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
  /** When non-null, updateChase / patrol Y-snaps are overridden to this
   *  altitude. Used by AnnArborSystem to keep the 10 throne captains on
   *  the saucer deck (y≈152) instead of falling to the ground. */
  public keepAirborneY: number | null = null;
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

    if (this.type === "spider_tank") {
      // Spider tank uses the captain-tracker path for its homing missile
      // attack — tick the same projectile pool every frame so missiles
      // home + impact correctly.
      this.lastPlayerPos.copyFrom(playerPosition);
      this.captainAbilityCd = Math.max(0, this.captainAbilityCd - dt);
      this.tickCaptainTrackers(dt, playerPosition);
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
    const frameScale = enemyFrameScale(dt);
    const dx = this.patrolTarget.x - this.mesh.position.x;
    const dz = this.patrolTarget.z - this.mesh.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 1) {
      this.fsm.changeState("idle");
      this.idleTimer = 1 + Math.random() * 2;
      return 0;
    }

    const step = Math.min(dist, this.config.patrolSpeed * frameScale);
    const inv  = step / dist;
    this.mesh.position.x += dx * inv;
    this.mesh.position.z += dz * inv;
    EnemyUnit._dirScratch.set(dx, 0, dz);
    this.faceDirection(EnemyUnit._dirScratch);
    this.checkForPlayer(playerPos);

    if (this.type === "drone") {
      this.mesh.position.y = 5 + Math.sin(Date.now() * 0.003) * 0.5;
    }
    if (this.type === "commander") {
      this.mesh.position.y += Math.sin(Date.now() * 0.002) * 0.02 * frameScale;
    }
    return 0;
  }

  private updateChase(dt: number, playerPos: BABYLON.Vector3): number {
    const frameScale = enemyFrameScale(dt);
    const cdx = playerPos.x - this.mesh.position.x;
    const cdy = playerPos.y - this.mesh.position.y;
    const cdz = playerPos.z - this.mesh.position.z;
    const dist = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz);

    if (this.type === "commander") {
      // Only chase upward when the player is ACTUALLY airborne. Without
      // this gate, even a grounded player at the top of a small ramp
      // could trigger flying — and the takeDamage stun→fly chain on
      // each hit would compound the targetFlightHeight, sending the
      // commander spiraling into the sky forever.
      if (playerIsFlyingFn() && playerPos.y > this.mesh.position.y + 5) {
        this.targetFlightHeight = Math.min(playerPos.y + 3, this.patrolOrigin.y + 35);
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

    const horizDist = Math.sqrt(cdx * cdx + cdz * cdz);
    if (horizDist > 0.001) {
      const step = Math.min(horizDist, this.config.chaseSpeed * frameScale);
      const inv  = step / horizDist;
      this.mesh.position.x += cdx * inv;
      this.mesh.position.z += cdz * inv;
      EnemyUnit._dirScratch.set(cdx, 0, cdz);
      this.faceDirection(EnemyUnit._dirScratch);
    }

    if (this.type === "drone") {
      this.mesh.position.y = 5 + Math.sin(Date.now() * 0.003) * 0.5;
    } else if (this.type === "commander") {
      const targetY = Math.max(this.patrolOrigin.y, 1.5);
      this.mesh.position.y += (targetY - this.mesh.position.y) * scaledFrameLerp(0.05, frameScale);
    } else if (this.keepAirborneY != null) {
      // Dedicated side-zones can pin large enemies to a custom terrain
      // height (Michigan Wilds heightmap, Ann Arbor saucer deck, etc.).
      this.mesh.position.y = this.keepAirborneY;
    } else if (this.type === "spider_tank") {
      // Body sits 3.5 m up so the six legs reach the ground without the
      // chassis sinking when chase code touches Y.
      this.mesh.position.y = 3.5;
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

    EnemyUnit._dirScratch.set(
      playerPos.x - this.mesh.position.x,
      playerPos.y - this.mesh.position.y,
      playerPos.z - this.mesh.position.z,
    );
    this.faceDirection(EnemyUnit._dirScratch);

    if (this.attackTimer <= 0) {
      this.attackTimer = this.config.attackCooldown;
      if (this.type === "commander") {
        damage = this.config.attackDamage;
        this.createCommanderAttackEffect();
      } else if (this.type === "captain") {
        damage = this.config.attackDamage;
        this.captainSabreSlashEffect(playerPos);
      } else if (this.type === "tank") {
        damage = this.config.attackDamage;
        this.createTankShellEffect(playerPos);
      } else if (this.type === "spider_tank") {
        // Spider tank fires a homing missile rather than dealing instant
        // melee/contact damage. The damage lands later via pendingDamage
        // when tickCaptainTrackers detects an impact, so we return 0
        // here on the launch frame.
        this.captainCastTracker(playerPos);
      } else {
        damage = this.config.attackDamage;
        this.createAttackEffect();
      }
    }

    return damage;
  }

  private updateStunned(dt: number): number {
    this.stunTimer -= dt;
    if (this.stunTimer <= 0) {
      // Commanders only re-enter flying out of stun when the player is
      // also airborne — otherwise just chase on the ground. Prevents the
      // bug where every hit would re-add +8 m to the flight height and
      // the commander would climb infinitely.
      if (this.type === "commander" && playerIsFlyingFn()) {
        this.fsm.changeState("flying");
        this.targetFlightHeight = Math.min(
          this.mesh.position.y + 8 + Math.random() * 5,
          this.patrolOrigin.y + 35,
        );
      } else {
        this.fsm.changeState("chase");
      }
    }
    return 0;
  }

  private updateFlying(dt: number, playerPos: BABYLON.Vector3): number {
    const frameScale = enemyFrameScale(dt);
    const heightDiff = this.targetFlightHeight - this.mesh.position.y;
    this.mesh.position.y += heightDiff * scaledFrameLerp(0.08, frameScale);

    const fdx = playerPos.x - this.mesh.position.x;
    const fdz = playerPos.z - this.mesh.position.z;
    const horizDist = Math.sqrt(fdx * fdx + fdz * fdz);

    if (Math.abs(heightDiff) < 1) {
      this.fsm.changeState("hovering");
      return 0;
    }

    if (horizDist > 5 && horizDist > 0.001) {
      const step = Math.min(horizDist, this.config.chaseSpeed * 1.5 * frameScale);
      const inv  = step / horizDist;
      this.mesh.position.x += fdx * inv;
      this.mesh.position.z += fdz * inv;
      EnemyUnit._dirScratch.set(fdx, 0, fdz);
      this.faceDirection(EnemyUnit._dirScratch);
    }

    return 0;
  }

  private updateHovering(dt: number, playerPos: BABYLON.Vector3): number {
    const frameScale = enemyFrameScale(dt);
    this.mesh.position.y += Math.sin(Date.now() * 0.003) * 0.03 * frameScale;

    const ds = EnemyUnit._dirScratch;
    ds.set(
      playerPos.x - this.mesh.position.x,
      playerPos.y - this.mesh.position.y,
      playerPos.z - this.mesh.position.z,
    );
    const dist = ds.length();

    if (dist <= this.config.attackRange * 1.5) {
      this.fsm.changeState("attack");
      this.attackTimer = 0.3;
      return 0;
    }

    if (dist > 0.001) {
      const step = Math.min(dist, this.config.chaseSpeed * 1.2 * frameScale);
      const inv  = step / dist;
      this.mesh.position.x += ds.x * inv;
      this.mesh.position.y += ds.y * inv;
      this.mesh.position.z += ds.z * inv;
      this.faceDirection(ds);
    }

    if (dist > this.config.chaseRange) {
      this.targetFlightHeight = 1.5;
      this.fsm.changeState("flying");
    }

    return 0;
  }

  private updateDodging(dt: number, _playerPos: BABYLON.Vector3): number {
    this.dodgeTimer -= dt;

    const step = 0.4 * enemyFrameScale(dt);
    this.mesh.position.x += this.dodgeDirection.x * step;
    this.mesh.position.z += this.dodgeDirection.z * step;

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

    const tpDx = playerPos.x - this.mesh.position.x;
    const tpDz = playerPos.z - this.mesh.position.z;
    const tpLen = Math.sqrt(tpDx * tpDx + tpDz * tpDz) || 1;
    const tpNx = tpDx / tpLen;
    const tpNz = tpDz / tpLen;
    const side = Math.random() > 0.5 ? 1 : -1;
    this.dodgeDirection = new BABYLON.Vector3(-tpNz * side, 0, tpNx * side);
    this.dodgeTimer = 0.3;
    this.dodgeCooldown = 2.0;
    this.fsm.changeState("dodging");
    this.createDodgeEffect();
    return true;
  }

  private checkForPlayer(playerPos: BABYLON.Vector3): void {
    const dist = BABYLON.Vector3.Distance(this.mesh.position, playerPos);
    if (dist <= this.config.detectionRange) {
      // Same fix as updateChase / updateStunned: only fly when the player
      // is actually airborne. A grounded player on a tall building roof
      // (y > 10) shouldn't lure commanders into a permanent climb.
      if (this.type === "commander" && playerIsFlyingFn() && playerPos.y > 10) {
        this.targetFlightHeight = Math.min(playerPos.y + 3, this.patrolOrigin.y + 35);
        this.fsm.changeState("flying");
      } else {
        this.fsm.changeState("chase");
      }
    }
  }

  private faceDirection(dir: BABYLON.Vector3): void {
    if (dir.lengthSquared() < 0.001) return;
    EnemyUnit._lookAtScratch.set(
      this.mesh.position.x + dir.x,
      this.mesh.position.y,
      this.mesh.position.z + dir.z,
    );
    this.mesh.lookAt(EnemyUnit._lookAtScratch);
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
      // CRITICAL bug-fix: previously every hit while at <50% HP re-set
      // `targetFlightHeight = mesh.position.y + 10` — additive from the
      // *current* position — so each successive hit drove the commander
      // 10 m higher forever. Now we (a) gate on the player actually
      // flying and (b) clamp to a reasonable ceiling above the original
      // patrol height so even when flying is allowed the runaway climb
      // can't happen.
      if (this.health < this.maxHealth * 0.5 && this.fsm.getState() !== "flying" && playerIsFlyingFn()) {
        this.targetFlightHeight = Math.min(
          this.patrolOrigin.y + 10 + Math.random() * 8,
          this.patrolOrigin.y + 35,
        );
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
      meshUniqueId: this.mesh.uniqueId,
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

  /** Tank long-range shell: a glowing tracer travels from the muzzle
   *  toward the player position over ~22 frames, with a brief bright
   *  muzzle flash at the launch point. Visual-only — actual damage is
   *  already applied this frame in `updateAttack`, same as every other
   *  enemy attack effect. */
  private createTankShellEffect(playerPos: BABYLON.Vector3): void {
    const scene = this.mesh.getScene();
    // Spawn the shell ~2.6 m in front of the tank's center at turret
    // height — close enough to "the barrel" that the player reads it as
    // muzzle fire. We use mesh.forward so the shell respects the tank's
    // facing (`faceDirection` runs every attack tick).
    const fwd = this.mesh.forward || new BABYLON.Vector3(0, 0, 1);
    const muzzle = this.mesh.position.add(fwd.scale(2.6));
    muzzle.y = this.mesh.position.y + 0.4;

    // Bright muzzle flash sphere — fades + grows in 8 frames.
    const flash = BABYLON.MeshBuilder.CreateSphere("tankFlash",
      { diameter: 1.4, segments: 8 }, scene);
    flash.position = muzzle.clone();
    const flashMat = new BABYLON.StandardMaterial("tankFlashMat", scene);
    flashMat.emissiveColor = new BABYLON.Color3(1.0, 0.55, 0.15);
    flashMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    flashMat.alpha = 0.9;
    flash.material = flashMat;

    // The shell tracer — a small bright orb that lerps from muzzle to
    // (an estimate of) the player's torso position over the lifetime.
    const target = playerPos.add(new BABYLON.Vector3(0, 1.0, 0));
    const shell = BABYLON.MeshBuilder.CreateSphere("tankShell",
      { diameter: 0.55, segments: 10 }, scene);
    shell.position = muzzle.clone();
    const shellMat = new BABYLON.StandardMaterial("tankShellMat", scene);
    shellMat.emissiveColor = new BABYLON.Color3(1.0, 0.7, 0.2);
    shellMat.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.0);
    shell.material = shellMat;

    const trail = BABYLON.MeshBuilder.CreateCylinder("tankShellTrail",
      { height: 0.6, diameter: 0.15, tessellation: 6 }, scene);
    const trailMat = new BABYLON.StandardMaterial("tankShellTrailMat", scene);
    trailMat.emissiveColor = new BABYLON.Color3(1.0, 0.4, 0.05);
    trailMat.alpha = 0.6;
    trail.material = trailMat;

    const start = muzzle.clone();
    const total = 22;
    let frame = 0;
    const animate = () => {
      frame++;
      const t = Math.min(1, frame / total);
      shell.position = BABYLON.Vector3.Lerp(start, target, t);
      trail.position = shell.position.clone();
      // Anchor the trail behind the shell so it reads as smoke.
      const back = BABYLON.Vector3.Lerp(start, target, Math.max(0, t - 0.05));
      trail.position = BABYLON.Vector3.Lerp(back, shell.position, 0.5);
      flashMat.alpha = Math.max(0, 0.9 - frame * 0.13);
      flash.scaling.setAll(1 + frame * 0.18);
      if (frame < total) {
        requestAnimationFrame(animate);
      } else {
        flash.dispose();
        shell.dispose();
        trail.dispose();
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
  /** Dedicated timer for the outskirts tank spawner. Tanks are too high-
   *  impact (long-range shells, heavy HP) to gate purely behind the 7%
   *  random roll in `selectEnemyType` — this guarantees roughly one tank
   *  appears at the outskirts every 22 s during active combat, which the
   *  player feels as "siege artillery hammers from the ring road". */
  private tankSpawnTimer: number = 0;
  private tankSpawnInterval: number = 22000;
  private maxEnemies: number = 20;
  private waveNumber: number = 1;
  private bus: EventBus;
  /** Master gate for the wave spawner. Flipped off by Game.tsx's
   *  LEVEL_STARTED handler when entering a peaceful zone (the sanctuary)
   *  so the timer-based drip-spawn in update() goes silent. Re-enabled
   *  on warp out. The spawnEnemy() call site still works directly when
   *  forced (e.g. the level-init seeding loop). */
  private spawningEnabled: boolean = true;

  private robotFactory: RobotFactory;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.robotFactory = new RobotFactory(scene);
  }

  private createEnemyMesh(
    type: EnemyType,
    position: BABYLON.Vector3,
    variant?: BossVariant | null,
    /** Forces a specific HUMANOID_PRESETS key for `commander`/`captain`
     *  spawns, bypassing the random pick + the player's editor override.
     *  Used by SwarmsLairSystem to spawn the unique General Voidcrown
     *  preset instead of one of the four standard captain presets. */
    humanoidPresetOverride?: string,
  ): BABYLON.Mesh {
    // Tanks use a parametric vehicle build (treads + hull + turret +
    // barrel) — there's no robot/humanoid preset that reads as a tank,
    // and the proportions matter for the silhouette. Built BEFORE the
    // humanoid + robot branches so the type-specific dispatch is clean.
    if (type === "tank") {
      return this.createTankMesh(position);
    }
    if (type === "spider_tank") {
      return this.createSpiderTankMesh(position);
    }

    // Commanders + Captains use humanoid models instead of robots.
    if (type === "commander" || type === "captain") {
      const captainPresets = [
        "HumanoidCaptainAlpha",
        "HumanoidCaptainBeta",
        "HumanoidCaptainGamma",
        "HumanoidCaptainOmega",
      ];
      // Player-side override from the CharacterEditor "Boss Style" tab.
      // Only applies to captains (commanders keep their canonical preset)
      // so the wave sub-boss spawns reflect the player's chosen art.
      const overrides = getEnemyStyleOverrides();
      const overridePreset =
        type === "captain" && overrides.captainPreset && overrides.captainPreset !== "random"
          ? overrides.captainPreset
          : null;
      // Priority: explicit caller override (SwarmsLair General) > editor
      // override (Boss Style tab) > random pick from captain roster.
      const presetName = humanoidPresetOverride
        ?? overridePreset
        ?? captainPresets[Math.floor(Math.random() * captainPresets.length)];
      const def = HUMANOID_PRESETS[presetName];

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
          // Player tint override wins over the level-system pick so the
          // Boss-Style tab can lock every captain to e.g. Void Stalker
          // regardless of which front the player is fighting on.
          const tintOverride = overrides.captainVariant && overrides.captainVariant !== "byLevel"
            ? BOSS_VARIANTS[overrides.captainVariant as BossVariantId]
            : null;
          const v = tintOverride ?? variant ?? BOSS_VARIANTS.inferno;
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
      // Tanks are built parametrically in `createTankMesh` and never reach
      // this preset path. Entry exists purely to satisfy the exhaustive
      // record type so a future EnemyType addition fails to compile if it
      // forgets a preset.
      tank: ["TankTitan"],
      // Titan reuses the TankTitan robot preset but is upscaled + tougher
      // when the EnemyUnit constructor runs (config + per-spawn scale).
      titan: ["TankTitan"],
      wilds_titan: ["TankTitan", "BruteForge", "MegaUnitX"],
      wilds_transformer: ["OptimusForge", "GuardianUnit", "ScoutPrime", "ScoutCompanion", "SparkPup", "NeonCat"],
      // Spider tank is parametric; this entry is just a fallback so the
      // exhaustive Record type compiles. createEnemyMesh short-circuits
      // to createSpiderTankMesh above before it ever reads this entry.
      spider_tank: ["TankTitan"],
    };

    const variants = presetMap[type] || ["ScoutPrime"];
    // Heavy/titan preset override from the Boss-Style tab. Only "heavy"
    // type is overridable — drone/soldier/insectoid/hybrid presets are
    // fixed by gameplay role and would mis-read the silhouette if swapped.
    const heavyOverrides = getEnemyStyleOverrides();
    const overridePresetName =
      type === "heavy" && heavyOverrides.titanPreset && heavyOverrides.titanPreset !== "random"
        ? heavyOverrides.titanPreset
        : null;
    const presetName = overridePresetName ?? variants[Math.floor(Math.random() * variants.length)];
    const preset = ROBOT_PRESETS[presetName];

    if (preset) {
      const root = this.robotFactory.createRobot(preset, position);

      const hitboxH = type === "hybrid" ? 3.5
        : type === "wilds_transformer" ? 7.2
        : type === "wilds_titan" ? 6.4
        : type === "titan" ? 4.5
        : type === "heavy" ? 3
        : 2;
      const hitboxR = type === "hybrid" ? 0.8
        : type === "wilds_transformer" ? 1.85
        : type === "wilds_titan" ? 1.65
        : type === "titan" ? 1.2
        : type === "heavy" ? 0.7
        : 0.5;
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

      // Scale titans up to read as a true heavy mid-boss alongside captains.
      if (type === "titan") {
        root.scaling.setAll(1.6);
      } else if (type === "wilds_titan") {
        root.scaling.setAll(2.35);
      } else if (type === "wilds_transformer") {
        root.scaling.setAll(2.65);
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

  /** Build the tank mesh parametrically. The hitbox is a capsule sized to
   *  match the hull silhouette so AABB-based weapons hit something
   *  sensible, and every visible part is parented to it so the chase /
   *  patrol code can move the whole vehicle by translating one node.
   *
   *  Local-space layout (visual root sits at hitbox.y - 1.5 so treads
   *  meet the ground when the chase code snaps Y to 1.5):
   *
   *    treads (left + right)  → y ≈ 0.4
   *    hull body              → y ≈ 1.0
   *    turret base            → y ≈ 1.9
   *    turret housing         → y ≈ 2.3
   *    barrel                 → y ≈ 2.3, +Z 2.0
   *    glowing emissive trim along hull mid-line
   */
  private createTankMesh(position: BABYLON.Vector3): BABYLON.Mesh {
    const scene = this.scene;
    const idSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Hitbox capsule — matches every other ground enemy's pattern so the
    // chase code can keep snapping `mesh.position.y = 1.5`.
    const hitbox = BABYLON.MeshBuilder.CreateCapsule(`enemyHit_tank_${idSuffix}`,
      { height: 3.6, radius: 1.6 }, scene);
    hitbox.isVisible = false;
    hitbox.position.copyFrom(position);
    hitbox.position.y = 1.5;

    const root = new BABYLON.TransformNode(`tankRoot_${idSuffix}`, scene);
    root.parent = hitbox;
    // Tracks rest on the ground when hitbox center is at y=1.5.
    root.position = new BABYLON.Vector3(0, -1.5, 0);

    // Hull-armor material — desaturated greys with subtle red emissive so
    // the tank reads as enemy faction (same red-orange palette as drones
    // / soldiers) without overwhelming the silhouette.
    const armorMat = new BABYLON.StandardMaterial(`tankArmorMat_${idSuffix}`, scene);
    armorMat.diffuseColor = new BABYLON.Color3(0.30, 0.27, 0.22);
    armorMat.emissiveColor = new BABYLON.Color3(0.12, 0.06, 0.04);
    armorMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);

    const trimMat = new BABYLON.StandardMaterial(`tankTrimMat_${idSuffix}`, scene);
    trimMat.diffuseColor = new BABYLON.Color3(0.55, 0.10, 0.08);
    trimMat.emissiveColor = new BABYLON.Color3(0.95, 0.30, 0.10);
    trimMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const trackMat = new BABYLON.StandardMaterial(`tankTrackMat_${idSuffix}`, scene);
    trackMat.diffuseColor = new BABYLON.Color3(0.10, 0.10, 0.11);
    trackMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.02);
    trackMat.specularColor = new BABYLON.Color3(0, 0, 0);

    // Treads — two long thin boxes, one per side.
    for (const side of [-1, 1]) {
      const tread = BABYLON.MeshBuilder.CreateBox(`tankTread_${side > 0 ? "R" : "L"}_${idSuffix}`,
        { width: 0.9, height: 0.8, depth: 5.4 }, scene);
      tread.position.set(side * 1.4, 0.4, 0);
      tread.parent = root;
      tread.material = trackMat;
    }

    // Hull body — wider than the treads, lower than the turret.
    const hull = BABYLON.MeshBuilder.CreateBox(`tankHull_${idSuffix}`,
      { width: 3.2, height: 1.2, depth: 4.6 }, scene);
    hull.position.set(0, 1.0, 0);
    hull.parent = root;
    hull.material = armorMat;

    // Hull trim line — a thin emissive strip running along each side at
    // the hull's mid-height. Pure decoration — sells the "enemy unit"
    // read at distance.
    for (const side of [-1, 1]) {
      const trim = BABYLON.MeshBuilder.CreateBox(`tankTrim_${side > 0 ? "R" : "L"}_${idSuffix}`,
        { width: 0.08, height: 0.18, depth: 4.4 }, scene);
      trim.position.set(side * 1.62, 1.0, 0);
      trim.parent = root;
      trim.material = trimMat;
    }

    // Turret base ring — a short cylinder so the housing reads as
    // pivoting on top of the hull.
    const turretBase = BABYLON.MeshBuilder.CreateCylinder(`tankTurretBase_${idSuffix}`,
      { height: 0.4, diameter: 2.4, tessellation: 18 }, scene);
    turretBase.position.set(0, 1.9, 0);
    turretBase.parent = root;
    turretBase.material = armorMat;

    // Turret housing — a smaller box than the hull, tilted forward.
    const turret = BABYLON.MeshBuilder.CreateBox(`tankTurret_${idSuffix}`,
      { width: 2.4, height: 1.0, depth: 2.6 }, scene);
    turret.position.set(0, 2.3, -0.1);
    turret.parent = root;
    turret.material = armorMat;

    // Glowing eye/sensor on the turret front so the silhouette has a
    // recognisable "face".
    const eye = BABYLON.MeshBuilder.CreateBox(`tankEye_${idSuffix}`,
      { width: 0.9, height: 0.18, depth: 0.06 }, scene);
    eye.position.set(0, 2.55, 1.18);
    eye.parent = root;
    eye.material = trimMat;

    // Main barrel — long thin cylinder pointing forward (+Z).
    const barrel = BABYLON.MeshBuilder.CreateCylinder(`tankBarrel_${idSuffix}`,
      { height: 3.6, diameter: 0.42, tessellation: 14 }, scene);
    // Cylinders in Babylon point along +Y by default; rotate around X so
    // the long axis aligns with the tank's forward (+Z).
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 2.3, 2.1);
    barrel.parent = root;
    barrel.material = armorMat;

    // Muzzle ring — a slightly larger cylinder at the barrel tip so the
    // muzzle reads visually + where the shell tracer originates.
    const muzzle = BABYLON.MeshBuilder.CreateCylinder(`tankMuzzle_${idSuffix}`,
      { height: 0.4, diameter: 0.55, tessellation: 14 }, scene);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 2.3, 3.85);
    muzzle.parent = root;
    muzzle.material = trimMat;

    return hitbox;
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

  /** Spawns a tank at the city OUTSKIRTS — between 90 and 130 m from the
   *  player, on the ground. The big radius is the whole point: tanks
   *  are siege artillery, not chasers, so they need to be visible across
   *  the rooftops on entry and start shelling without ever closing.
   *
   *  Caps against the same `maxEnemies` budget as the regular drip-spawn
   *  so a passive player doesn't accumulate ten tanks parked around the
   *  city.  */
  spawnTankAtOutskirts(playerPosition: BABYLON.Vector3): void {
    if (this.enemies.length >= this.maxEnemies) return;
    const angle = Math.random() * Math.PI * 2;
    const distance = 90 + Math.random() * 40;
    const x = playerPosition.x + Math.cos(angle) * distance;
    const z = playerPosition.z + Math.sin(angle) * distance;
    const position = new BABYLON.Vector3(x, 1.5, z);

    const mesh = this.createEnemyMesh("tank", position);
    const waveMultiplier = 1 + (this.waveNumber - 1) * 0.2;
    const enemy = new EnemyUnit(mesh, "tank", waveMultiplier);
    this.enemies.push(enemy);
    this.bus.emit(GameEvents.ENEMY_SPAWNED, { type: "tank", position });
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
    /** Force a specific HUMANOID_PRESETS key. Used by SwarmsLairSystem
     *  to spawn `HumanoidGeneralVoidcrown` (Level 7's unique boss).
     *  Bypasses the player's editor "Boss Style" override. */
    humanoidPreset?: string;
  }): EnemyUnit {
    const variant = getBossVariant(opts?.variantId);
    const mesh = this.createEnemyMesh("captain", position, variant, opts?.humanoidPreset);
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

  /** Spawn a single enemy of an explicit type at a precise world position.
   *  Bypasses the wave-spawner's distance/angle math so dedicated zones
   *  (SwarmsLairSystem cave arena) can place swarm minions exactly where
   *  needed. Counts against `maxEnemies` like the regular drip-spawn so
   *  a zone can't accidentally overflow the population cap. */
  spawnEnemyAt(type: EnemyType, position: BABYLON.Vector3): EnemyUnit | null {
    if (this.enemies.length >= this.maxEnemies) return null;
    const mesh = this.createEnemyMesh(type, position);
    const waveMultiplier = 1 + (this.waveNumber - 1) * 0.2;
    const enemy = new EnemyUnit(mesh, type, waveMultiplier);
    this.enemies.push(enemy);
    this.bus.emit(GameEvents.ENEMY_SPAWNED, { type, position });
    return enemy;
  }

  /** Build a six-legged spider-tank mesh — Saginaw Lab mid-boss. The body
   *  sits 3.5 m above ground (matches updateChase ground-snap), with six
   *  jointed legs angling out + down to plant on the floor. A turret on
   *  top sports a pair of forward-facing missile pods so the silhouette
   *  reads "long-range homing weapon" before it fires. */
  private createSpiderTankMesh(position: BABYLON.Vector3): BABYLON.Mesh {
    const scene = this.scene;
    const idSuffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Tall capsule hitbox so the spider tank reads as a multi-meter-high
    // unit. Center sits at y=3.5 to match the updateChase ground-snap.
    const hitbox = BABYLON.MeshBuilder.CreateCapsule(`enemyHit_spiderTank_${idSuffix}`,
      { height: 5.0, radius: 2.0 }, scene);
    hitbox.isVisible = false;
    hitbox.position.copyFrom(position);
    hitbox.position.y = 3.5;

    const root = new BABYLON.TransformNode(`spiderTankRoot_${idSuffix}`, scene);
    root.parent = hitbox;
    // Body local origin centered on hitbox center; legs reach down to ground.
    root.position = BABYLON.Vector3.Zero();

    // Materials — dark armor + cyan emissive trim (matches the underwater
    // lab palette so the boss reads as a Saginaw lab construct).
    const armorMat = new BABYLON.StandardMaterial(`spiderArmorMat_${idSuffix}`, scene);
    armorMat.diffuseColor = new BABYLON.Color3(0.18, 0.22, 0.28);
    armorMat.emissiveColor = new BABYLON.Color3(0.04, 0.06, 0.10);
    armorMat.specularColor = new BABYLON.Color3(0.20, 0.22, 0.25);

    const trimMat = new BABYLON.StandardMaterial(`spiderTrimMat_${idSuffix}`, scene);
    trimMat.diffuseColor = new BABYLON.Color3(0.10, 0.55, 0.85);
    trimMat.emissiveColor = new BABYLON.Color3(0.20, 0.85, 1.10);
    trimMat.specularColor = new BABYLON.Color3(0, 0, 0);

    // Main chassis — wide flattened sphere so the silhouette reads "spider
    // body" not "tank hull".
    const body = BABYLON.MeshBuilder.CreateSphere(`spiderBody_${idSuffix}`,
      { diameter: 4.4, segments: 12 }, scene);
    body.scaling.set(1.0, 0.55, 1.1);
    body.position.set(0, 0, 0);
    body.parent = root;
    body.material = armorMat;

    // Glowing eye band — a short ring of trim mat around the front of the body.
    for (let i = 0; i < 5; i++) {
      const eye = BABYLON.MeshBuilder.CreateSphere(`spiderEye_${i}_${idSuffix}`,
        { diameter: 0.32, segments: 6 }, scene);
      const ang = -0.6 + (i * 0.3);
      eye.position.set(Math.sin(ang) * 1.9, 0.2, Math.cos(ang) * 2.1);
      eye.parent = root;
      eye.material = trimMat;
    }

    // Six legs — three per side, splayed outward + downward. Each leg is
    // two cylinder segments (femur + tibia) so the silhouette reads
    // "jointed insect leg" rather than a straight stick.
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const slot = i % 3; // 0..2 along the body
      const angY = side * (Math.PI / 4) + (slot - 1) * 0.55;
      const baseX = Math.sin(angY) * 1.8;
      const baseZ = Math.cos(angY) * 1.8 * (slot === 1 ? 0.2 : 1);

      // Femur — angled outward from body to mid-air.
      const femur = BABYLON.MeshBuilder.CreateCylinder(`spiderFemur_${i}_${idSuffix}`,
        { height: 2.2, diameter: 0.45, tessellation: 8 }, scene);
      femur.parent = root;
      femur.position.set(baseX + side * 1.1, -0.4, baseZ);
      femur.rotation.z = -side * 0.9;
      femur.material = armorMat;

      // Tibia — angled down from femur tip to the floor.
      const tibia = BABYLON.MeshBuilder.CreateCylinder(`spiderTibia_${i}_${idSuffix}`,
        { height: 2.6, diameter: 0.32, tessellation: 8 }, scene);
      tibia.parent = root;
      tibia.position.set(baseX + side * 2.4, -2.0, baseZ);
      tibia.rotation.z = side * 0.25;
      tibia.material = armorMat;

      // Foot — flat disc planted on the floor.
      const foot = BABYLON.MeshBuilder.CreateCylinder(`spiderFoot_${i}_${idSuffix}`,
        { height: 0.18, diameter: 0.7, tessellation: 8 }, scene);
      foot.parent = root;
      foot.position.set(baseX + side * 2.7, -3.4, baseZ);
      foot.material = trimMat;
    }

    // Turret base — a short cylinder atop the body.
    const turretBase = BABYLON.MeshBuilder.CreateCylinder(`spiderTurretBase_${idSuffix}`,
      { height: 0.5, diameter: 1.8, tessellation: 14 }, scene);
    turretBase.position.set(0, 1.2, 0);
    turretBase.parent = root;
    turretBase.material = armorMat;

    // Twin missile pods on top — forward-facing rectangular launchers
    // that reads as "homing missile weapon".
    for (const side of [-1, 1]) {
      const pod = BABYLON.MeshBuilder.CreateBox(`spiderPod_${side > 0 ? "R" : "L"}_${idSuffix}`,
        { width: 0.75, height: 0.55, depth: 1.6 }, scene);
      pod.position.set(side * 0.55, 1.7, 0.4);
      pod.parent = root;
      pod.material = armorMat;

      // Trim ring at the muzzle so the launch tube reads emissive.
      const muzzle = BABYLON.MeshBuilder.CreateBox(`spiderMuzzle_${side > 0 ? "R" : "L"}_${idSuffix}`,
        { width: 0.78, height: 0.58, depth: 0.12 }, scene);
      muzzle.position.set(side * 0.55, 1.7, 1.22);
      muzzle.parent = root;
      muzzle.material = trimMat;
    }

    return hitbox;
  }

  /** Spawn a single titan at a random angle around the player. Mirrors
   *  spawnTankAtOutskirts but at a closer band so the heavy actually
   *  closes to melee. Used by the periodic titan spawner in update(). */
  spawnTitanAt(playerPosition: BABYLON.Vector3): void {
    if (this.enemies.length >= this.maxEnemies) return;
    const angle = Math.random() * Math.PI * 2;
    const distance = 35 + Math.random() * 35;
    const x = playerPosition.x + Math.cos(angle) * distance;
    const z = playerPosition.z + Math.sin(angle) * distance;
    const position = new BABYLON.Vector3(x, 1.5, z);
    const mesh = this.createEnemyMesh("titan", position);
    const waveMultiplier = 1 + (this.waveNumber - 1) * 0.2;
    const enemy = new EnemyUnit(mesh, "titan", waveMultiplier);
    this.enemies.push(enemy);
    this.bus.emit(GameEvents.ENEMY_SPAWNED, { type: "titan", position });
  }

  private selectEnemyType(): EnemyType {
    // Rare elite tiers each get their own INDEPENDENT roll (rather than
    // sharing the cumulative band of the common-tier roll below). The
    // prior cumulative-band structure broke when tank was inserted: a
    // 0.07 tank band positioned ahead of hybrid's 0.05 band swallowed
    // hybrid entirely, and commander's 0.08 band on wave 7+ swallowed
    // both. Independent rolls let each elite have its stated chance
    // without cannibalising the next.
    if (this.waveNumber >= 7 && Math.random() < 0.08) return "commander";
    if (this.waveNumber >= 5 && Math.random() < 0.05) return "hybrid";
    // Tank — ~7% of regular drip-spawns from wave 2+. The dedicated
    // outskirts timer in update() also fires `spawnTankAtOutskirts`
    // every ~22 s, so this roll is a top-up that occasionally puts a
    // tank inside the close-in spawn cone.
    if (this.waveNumber >= 2 && Math.random() < 0.07) return "tank";
    // Titan — periodic heavy mid-boss alongside captains. Independent
    // roll so it doesn't cannibalize tank/commander/hybrid bands.
    if (this.waveNumber >= 2 && Math.random() < 0.06) return "titan";
    // Common tier — single shared roll, cumulative-band style preserved
    // from the original behaviour.
    const roll = Math.random();
    if (this.waveNumber >= 3 && roll < 0.15) return "heavy";
    if (roll < 0.3) return "insectoid";
    if (roll < 0.5) return "drone";
    return "soldier";
  }

  update(playerPosition: BABYLON.Vector3, deltaTime: number): { damage: number; hits: EnemyUnit[] } {
    if (this.spawningEnabled) {
      this.spawnTimer += deltaTime;
      if (this.spawnTimer >= this.spawnInterval) {
        this.spawnTimer = 0;
        this.spawnEnemy(playerPosition);
      }
      // Outskirts tank spawner — independent cadence from the normal
      // drip-spawn so even a player camping a single street still sees
      // a new tank appear on the ring road every ~22 s. Held off until
      // wave 2 so the very first wave reads as light infantry only.
      this.tankSpawnTimer += deltaTime;
      if (this.waveNumber >= 2 && this.tankSpawnTimer >= this.tankSpawnInterval) {
        this.tankSpawnTimer = 0;
        this.spawnTankAtOutskirts(playerPosition);
      }
    } else {
      // Bleed the timers back to zero so the next combat zone starts with
      // a fresh full-interval grace period instead of an immediate spawn.
      this.spawnTimer = 0;
      this.tankSpawnTimer = 0;
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

  /** Toggle the wave spawner. Used by Game.tsx LEVEL_STARTED handler to
   *  silence ground spawns when entering the peaceful sanctuary. */
  setSpawningEnabled(enabled: boolean): void {
    this.spawningEnabled = enabled;
  }

  /** Override the live-enemy population cap. Used by side-zones that need
   *  a larger swarm than the default (e.g. AnnArborSystem maintains ~70
   *  ground enemies). Caller is responsible for restoring the prior value
   *  on dispose — getMaxEnemies() returns the current cap so it can be
   *  snapshotted before mutation. */
  setMaxEnemies(n: number): void {
    this.maxEnemies = Math.max(1, Math.floor(n));
  }
  getMaxEnemies(): number {
    return this.maxEnemies;
  }

  /** Despawn every active enemy mesh. Used when warping into a peaceful
   *  zone so the sanctuary doesn't have leftover drones from the combat
   *  level the player came from. */
  clearAllEnemies(): void {
    for (const e of this.enemies) {
      if (e.isAlive) {
        e.isAlive = false;
        try { e.mesh.dispose(); } catch {}
      }
    }
    this.enemies = [];
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
