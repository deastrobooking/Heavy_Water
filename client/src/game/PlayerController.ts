import * as BABYLON from "@babylonjs/core";
import { StateMachine } from "./StateMachine";
import { EventBus, GameEvents } from "./EventBus";
import { DamageInfo, DamageResult, DamageResistance, IDamageable, DamageType } from "./DamageSystem";

export type PlayerState = "idle" | "moving" | "sprinting" | "dodging" | "attacking" | "stunned" | "dead" | "jetpack";

export interface PlayerStats {
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  stamina: number;
  maxStamina: number;
  credits: number;
  experience: number;
  level: number;
}

export class PlayerController implements IDamageable {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private mesh: BABYLON.Mesh;
  private velocity: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private isGrounded: boolean = true;

  private walkSpeed: number = 0.3;
  private sprintSpeed: number = 0.55;
  private jumpForce: number = 0.5;
  private gravity: number = 0.02;
  private groundY: number = 1;

  health: number = 100;
  maxHealth: number = 100;
  isAlive: boolean = true;
  isInvulnerable: boolean = false;
  resistances: DamageResistance[] = [];

  private stats: PlayerStats;
  private keys: { [key: string]: boolean } = {};
  private bus: EventBus;
  private stateMachine: StateMachine<PlayerState>;

  private isSprinting: boolean = false;
  private staminaRegenDelay: number = 0;
  private staminaRegenRate: number = 15;
  private sprintStaminaCost: number = 12;

  private isDodging: boolean = false;
  private dodgeTimer: number = 0;
  private dodgeDuration: number = 0.3;
  private dodgeCooldown: number = 0.5;
  private dodgeCooldownTimer: number = 0;
  private dodgeSpeed: number = 1.2;
  private dodgeDirection: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private dodgeStaminaCost: number = 20;

  private isParrying: boolean = false;
  private parryTimer: number = 0;
  private parryWindow: number = 0.2;
  private parryCooldown: number = 1.0;
  private parryCooldownTimer: number = 0;

  private isJetpacking: boolean = false;
  private jetpackFuel: number = 200;
  private maxJetpackFuel: number = 200;
  private jetpackForce: number = 0.06;
  private jetpackFuelCost: number = 20;
  private jetpackFuelRegen: number = 30;

  private invulnerabilityTimer: number = 0;

  private onMeleeAttack: (() => void) | null = null;
  private onHeavyMeleeAttack: (() => void) | null = null;

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.mesh = this.createPlayerMesh();
    this.bus = EventBus.getInstance();

    this.stats = {
      health: 100,
      maxHealth: 100,
      armor: 50,
      maxArmor: 100,
      stamina: 100,
      maxStamina: 100,
      credits: 0,
      experience: 0,
      level: 1,
    };

    this.stateMachine = new StateMachine<PlayerState>();
    this.setupStateMachine();
    this.setupControls();
    this.stateMachine.forceState("idle");
  }

  private setupStateMachine(): void {
    this.stateMachine.addState({
      name: "idle",
      transitions: ["moving", "sprinting", "dodging", "attacking", "stunned", "dead", "jetpack"],
    });
    this.stateMachine.addState({
      name: "moving",
      transitions: ["idle", "sprinting", "dodging", "attacking", "stunned", "dead", "jetpack"],
    });
    this.stateMachine.addState({
      name: "sprinting",
      transitions: ["idle", "moving", "dodging", "attacking", "stunned", "dead", "jetpack"],
    });
    this.stateMachine.addState({
      name: "dodging",
      transitions: ["idle", "moving", "sprinting", "stunned", "dead"],
    });
    this.stateMachine.addState({
      name: "attacking",
      transitions: ["idle", "moving", "dodging", "stunned", "dead"],
    });
    this.stateMachine.addState({
      name: "stunned",
      transitions: ["idle", "dead"],
    });
    this.stateMachine.addState({
      name: "dead",
    });
    this.stateMachine.addState({
      name: "jetpack",
      transitions: ["idle", "moving", "stunned", "dead"],
    });
  }

  private createPlayerMesh(): BABYLON.Mesh {
    const player = BABYLON.MeshBuilder.CreateCapsule(
      "player",
      { height: 2, radius: 0.5 },
      this.scene
    );
    player.position = new BABYLON.Vector3(0, 1, -15);
    player.isVisible = false;
    player.metadata = { tag: "Player", playerController: this };
    return player;
  }

  private setupControls(): void {
    window.addEventListener("keydown", (e) => {
      this.keys[e.code] = true;

      if (e.code === "Space" && this.isGrounded) {
        this.jump();
      }

      if (e.code === "KeyQ" && !this.isDodging && this.dodgeCooldownTimer <= 0) {
        this.startDodge();
      }

      if (e.code === "KeyF" && !this.isParrying && this.parryCooldownTimer <= 0) {
        this.startParry();
      }

      if (e.code === "KeyV") {
        this.onMeleeAttack?.();
      }

      if (e.code === "KeyB") {
        this.onHeavyMeleeAttack?.();
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
    });
  }

  private jump(): void {
    if (this.isGrounded && !this.isDodging) {
      this.velocity.y = this.jumpForce;
      this.isGrounded = false;
    }
  }

  private startDodge(): void {
    if (this.stats.stamina < this.dodgeStaminaCost) return;
    if (this.stateMachine.isInState("stunned", "dead", "dodging")) return;

    this.isDodging = true;
    this.dodgeTimer = this.dodgeDuration;
    this.isInvulnerable = true;
    this.stats.stamina -= this.dodgeStaminaCost;
    this.staminaRegenDelay = 1.0;

    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const right = this.camera.getDirection(BABYLON.Vector3.Right());
    forward.y = 0; right.y = 0;
    forward.normalize(); right.normalize();

    this.dodgeDirection = BABYLON.Vector3.Zero();
    if (this.keys["KeyW"]) this.dodgeDirection.addInPlace(forward);
    if (this.keys["KeyS"]) this.dodgeDirection.addInPlace(forward.scale(-1));
    if (this.keys["KeyA"]) this.dodgeDirection.addInPlace(right.scale(-1));
    if (this.keys["KeyD"]) this.dodgeDirection.addInPlace(right);

    if (this.dodgeDirection.length() < 0.1) {
      this.dodgeDirection = forward.scale(-1);
    }
    this.dodgeDirection.normalize();

    this.stateMachine.changeState("dodging");
    this.bus.emit(GameEvents.PLAYER_DODGE);
  }

  private startParry(): void {
    if (this.stateMachine.isInState("stunned", "dead", "dodging")) return;

    this.isParrying = true;
    this.parryTimer = this.parryWindow;
    this.parryCooldownTimer = this.parryCooldown;
    this.bus.emit(GameEvents.PLAYER_PARRY);
  }

  update(dt?: number): void {
    const deltaTime = dt ?? (1 / 60);

    if (!this.isAlive) return;

    this.stateMachine.update(deltaTime);
    this.updateTimers(deltaTime);
    this.updateStamina(deltaTime);
    this.updateJetpack(deltaTime);

    if (this.isDodging) {
      this.updateDodge(deltaTime);
    } else {
      this.updateMovement(deltaTime);
    }

    this.updatePhysics(deltaTime);
    this.updateCamera();
  }

  private updateTimers(dt: number): void {
    if (this.dodgeCooldownTimer > 0) this.dodgeCooldownTimer -= dt;
    if (this.parryCooldownTimer > 0) this.parryCooldownTimer -= dt;
    if (this.staminaRegenDelay > 0) this.staminaRegenDelay -= dt;

    if (this.invulnerabilityTimer > 0) {
      this.invulnerabilityTimer -= dt;
      if (this.invulnerabilityTimer <= 0) {
        this.isInvulnerable = false;
      }
    }

    if (this.isParrying) {
      this.parryTimer -= dt;
      if (this.parryTimer <= 0) {
        this.isParrying = false;
      }
    }
  }

  private updateStamina(dt: number): void {
    this.isSprinting = this.keys["ShiftLeft"] && this.stats.stamina > 0 && this.isMoving();

    if (this.isSprinting) {
      this.stats.stamina = Math.max(0, this.stats.stamina - this.sprintStaminaCost * dt);
      this.staminaRegenDelay = 0.5;
    }

    if (this.staminaRegenDelay <= 0 && this.stats.stamina < this.stats.maxStamina) {
      this.stats.stamina = Math.min(this.stats.maxStamina, this.stats.stamina + this.staminaRegenRate * dt);
    }
  }

  private updateJetpack(dt: number): void {
    if (this.keys["Space"] && !this.isGrounded && this.jetpackFuel > 0 && !this.isDodging) {
      this.isJetpacking = true;
      this.velocity.y = Math.min(this.velocity.y + this.jetpackForce, 0.3);
      this.jetpackFuel -= this.jetpackFuelCost * dt;
      if (this.jetpackFuel <= 0) {
        this.jetpackFuel = 0;
        this.isJetpacking = false;
      }
    } else {
      this.isJetpacking = false;
    }

    if (this.isGrounded && this.jetpackFuel < this.maxJetpackFuel) {
      this.jetpackFuel = Math.min(this.maxJetpackFuel, this.jetpackFuel + this.jetpackFuelRegen * dt);
    }
  }

  private updateDodge(dt: number): void {
    this.dodgeTimer -= dt;
    if (this.dodgeTimer <= 0) {
      this.isDodging = false;
      this.isInvulnerable = false;
      this.dodgeCooldownTimer = this.dodgeCooldown;
      this.stateMachine.changeState("idle");
    } else {
      this.mesh.position.addInPlace(this.dodgeDirection.scale(this.dodgeSpeed));
    }
  }

  private updateMovement(dt: number): void {
    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const right = this.camera.getDirection(BABYLON.Vector3.Right());

    forward.y = 0;
    right.y = 0;
    forward.normalize();
    right.normalize();

    let moveDirection = BABYLON.Vector3.Zero();
    const speed = this.isSprinting ? this.sprintSpeed : this.walkSpeed;

    if (this.keys["KeyW"]) moveDirection.addInPlace(forward.scale(speed));
    if (this.keys["KeyS"]) moveDirection.addInPlace(forward.scale(-speed));
    if (this.keys["KeyA"]) moveDirection.addInPlace(right.scale(-speed));
    if (this.keys["KeyD"]) moveDirection.addInPlace(right.scale(speed));

    this.velocity.x = moveDirection.x;
    this.velocity.z = moveDirection.z;

    if (this.isMoving()) {
      if (this.isSprinting) {
        this.stateMachine.changeState("sprinting");
      } else {
        this.stateMachine.changeState("moving");
      }
    } else if (!this.isDodging && !this.isJetpacking) {
      this.stateMachine.changeState("idle");
    }
  }

  private updatePhysics(dt: number): void {
    if (!this.isGrounded && !this.isJetpacking) {
      this.velocity.y -= this.gravity;
    }

    const maxFallSpeed = 0.8;
    if (this.velocity.y < -maxFallSpeed) {
      this.velocity.y = -maxFallSpeed;
    }

    this.mesh.position.addInPlace(this.velocity);

    let surfaceY = this.groundY;
    const rayLength = Math.max(8, Math.abs(this.velocity.y) * 20 + 5);
    const ray = new BABYLON.Ray(
      new BABYLON.Vector3(this.mesh.position.x, this.mesh.position.y + 1, this.mesh.position.z),
      BABYLON.Vector3.Down(),
      rayLength
    );
    const hit = this.scene.pickWithRay(ray, (mesh) => {
      if (mesh.name === "player") return false;
      const n = mesh.name;
      return n === "ground" || n.startsWith("skyPlat_") || n.startsWith("bridge_seg") ||
        n.startsWith("step_") || n === "mainHighway" || n === "crossHighway" ||
        n === "spaceport";
    });

    if (hit && hit.hit && hit.pickedPoint) {
      const platSurface = hit.pickedPoint.y;
      if (platSurface > surfaceY) {
        surfaceY = platSurface;
      }
    }

    if (this.mesh.position.y <= surfaceY + 1) {
      this.mesh.position.y = surfaceY + 1;
      this.velocity.y = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }
  }

  private updateCamera(): void {
    this.camera.position = new BABYLON.Vector3(
      this.mesh.position.x,
      this.mesh.position.y + 1.5,
      this.mesh.position.z
    );
  }

  private isMoving(): boolean {
    return this.keys["KeyW"] || this.keys["KeyS"] || this.keys["KeyA"] || this.keys["KeyD"];
  }

  takeDamage(info: DamageInfo): DamageResult {
    if (this.isInvulnerable || !this.isAlive) {
      return { damageAmount: 0, wasKilled: false, wasBlocked: false, wasParried: false };
    }

    if (this.isParrying) {
      this.isParrying = false;
      this.bus.emit(GameEvents.PLAYER_PARRY, { success: true });
      return { damageAmount: 0, wasKilled: false, wasBlocked: false, wasParried: true };
    }

    let amount = info.amount;

    let resistance = this.resistances.find(r => r.damageType === info.damageType);
    if (resistance) {
      amount *= (1 - resistance.resistancePercent);
    }

    if (this.stats.armor > 0) {
      const armorAbsorb = Math.min(this.stats.armor, amount * 0.7);
      this.stats.armor -= armorAbsorb;
      amount -= armorAbsorb;
    }

    amount = Math.max(1, amount);
    this.stats.health = Math.max(0, this.stats.health - amount);
    this.health = this.stats.health;

    this.invulnerabilityTimer = 0.2;
    this.isInvulnerable = true;

    this.bus.emit(GameEvents.PLAYER_DAMAGED, { amount, remaining: this.stats.health });

    if (this.stats.health <= 0) {
      this.die();
      return { damageAmount: amount, wasKilled: true, wasBlocked: false, wasParried: false };
    }

    return { damageAmount: amount, wasKilled: false, wasBlocked: false, wasParried: false };
  }

  takeDamageSimple(amount: number): void {
    this.takeDamage({
      amount,
      damageType: DamageType.Kinetic,
    });
  }

  private die(): void {
    this.isAlive = false;
    this.stateMachine.forceState("dead");
    this.bus.emit(GameEvents.PLAYER_DIED);
  }

  heal(amount: number): void {
    this.stats.health = Math.min(this.stats.maxHealth, this.stats.health + amount);
    this.health = this.stats.health;
    this.bus.emit(GameEvents.PLAYER_HEALED, { amount, health: this.stats.health });
  }

  addArmor(amount: number): void {
    this.stats.armor = Math.min(this.stats.maxArmor, this.stats.armor + amount);
  }

  addCredits(amount: number): void {
    this.stats.credits += amount;
  }

  addExperience(amount: number): void {
    this.stats.experience += amount;
    const expNeeded = this.stats.level * 100;
    if (this.stats.experience >= expNeeded) {
      this.stats.experience -= expNeeded;
      this.stats.level++;
      this.stats.maxHealth += 10;
      this.stats.health = this.stats.maxHealth;
      this.health = this.stats.health;
      this.maxHealth = this.stats.maxHealth;
      this.stats.maxStamina += 5;
      this.stats.stamina = this.stats.maxStamina;
      this.bus.emit(GameEvents.PLAYER_LEVEL_UP, { level: this.stats.level });
    }
  }

  getStats(): PlayerStats {
    return { ...this.stats };
  }

  getPosition(): BABYLON.Vector3 {
    return this.mesh.position.clone();
  }

  getMesh(): BABYLON.Mesh {
    return this.mesh;
  }

  getJetpackFuel(): number {
    return this.jetpackFuel;
  }

  getMaxJetpackFuel(): number {
    return this.maxJetpackFuel;
  }

  getPlayerState(): PlayerState {
    return this.stateMachine.getState() ?? "idle";
  }

  setMeleeCallbacks(light: () => void, heavy: () => void): void {
    this.onMeleeAttack = light;
    this.onHeavyMeleeAttack = heavy;
  }
}
