import * as BABYLON from "@babylonjs/core";
import { StateMachine } from "./StateMachine";
import { EventBus, GameEvents } from "./EventBus";
import { DamageInfo, DamageResult, DamageResistance, IDamageable, DamageType } from "./DamageSystem";
import { AnimationSystem, AnimationState } from "./AnimationSystem";
import { HumanoidCharacter } from "./HumanoidCharacter";
import { HUMANOID_PRESETS } from "./HumanoidPresets";
import { equipArmorSet, deserializeArmorSet, EquippedArmor, ArmorSetSerialized } from "./RobotArmorSystem";

export type PlayerState = "idle" | "moving" | "sprinting" | "dodging" | "attacking" | "stunned" | "dead" | "jetpack" | "flying" | "hovering";

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
  private humanoid?: HumanoidCharacter;
  private equippedArmor?: EquippedArmor;
  private meshRoot!: BABYLON.TransformNode | BABYLON.Mesh;
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

  private jumpCount: number = 0;
  private maxJumpCount: number = 3;
  private doubleJumpForce: number = 0.65;
  private tripleJumpLaunchForce: number = 1.2;

  private isFlying: boolean = false;
  private flightSpeed: number = 0.5;
  private flightSprintSpeed: number = 0.85;
  private flightAscendSpeed: number = 0.35;
  private flightDescendSpeed: number = 0.35;

  private armorEnergy: number = 200;
  private maxArmorEnergy: number = 200;
  private flightEnergyCost: number = 15;
  private armorEnergyRegen: number = 25;

  private hasFlightArmor: boolean = false;

  private animationSystem: AnimationSystem;
  private prevGrounded: boolean = true;

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.mesh = this.createPlayerMesh();
    this.animationSystem = new AnimationSystem();
    if (this.humanoid) {
      this.animationSystem.attachToParts(this.humanoid.getAnimatableLimbs());
    }
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
      transitions: ["moving", "sprinting", "dodging", "attacking", "stunned", "dead", "jetpack", "flying", "hovering"],
    });
    this.stateMachine.addState({
      name: "moving",
      transitions: ["idle", "sprinting", "dodging", "attacking", "stunned", "dead", "jetpack", "flying", "hovering"],
    });
    this.stateMachine.addState({
      name: "sprinting",
      transitions: ["idle", "moving", "dodging", "attacking", "stunned", "dead", "jetpack", "flying", "hovering"],
    });
    this.stateMachine.addState({
      name: "dodging",
      transitions: ["idle", "moving", "sprinting", "stunned", "dead"],
    });
    this.stateMachine.addState({
      name: "attacking",
      transitions: ["idle", "moving", "dodging", "stunned", "dead", "flying"],
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
      transitions: ["idle", "moving", "stunned", "dead", "flying"],
    });
    this.stateMachine.addState({
      name: "flying",
      transitions: ["idle", "moving", "hovering", "stunned", "dead"],
    });
    this.stateMachine.addState({
      name: "hovering",
      transitions: ["idle", "moving", "flying", "stunned", "dead"],
    });
  }

  private createPlayerMesh(): BABYLON.Mesh {
    let humanoidDef = { ...HUMANOID_PRESETS.PlayerDefault };
    let armorSetSerialized: ArmorSetSerialized | null = null;
    try {
      const raw = typeof localStorage !== "undefined"
        ? localStorage.getItem("detroit3026_character_v1")
        : null;
      if (raw) {
        const saved = JSON.parse(raw);
        humanoidDef = {
          ...humanoidDef,
          height: saved.height ?? humanoidDef.height,
          headScale: saved.headScale ?? humanoidDef.headScale,
          shoulderWidth: saved.shoulderWidth ?? humanoidDef.shoulderWidth,
          chestWidth: saved.shoulderWidth ?? humanoidDef.chestWidth,
          armLength: saved.armLength ?? humanoidDef.armLength,
          legLength: saved.legLength ?? humanoidDef.legLength,
          bodyType: saved.bodyType ?? humanoidDef.bodyType,
          armorType: saved.armorType ?? humanoidDef.armorType,
          colors: saved.colors ? {
            primary: BABYLON.Color3.FromArray(saved.colors.primary),
            secondary: BABYLON.Color3.FromArray(saved.colors.secondary),
            skin: BABYLON.Color3.FromArray(saved.colors.skin),
            hair: BABYLON.Color3.FromArray(saved.colors.hair),
          } : humanoidDef.colors,
        };
        if (saved.armorSet) armorSetSerialized = saved.armorSet as ArmorSetSerialized;
        console.log("[PlayerController] Loaded saved character");
      }
    } catch (e) {
      console.warn("[PlayerController] Could not load saved character:", e);
    }

    if (armorSetSerialized) {
      humanoidDef = { ...humanoidDef, hasArmor: false };
    }

    this.humanoid = new HumanoidCharacter(this.scene, humanoidDef);
    const root = this.humanoid.getRoot();
    root.position = new BABYLON.Vector3(0, 1, -15);
    this.meshRoot = root;

    if (armorSetSerialized) {
      const setCfg = deserializeArmorSet(armorSetSerialized);
      this.equippedArmor = equipArmorSet(this.scene, this.humanoid.getAnimatableLimbs(), setCfg, {
        bodyHeight: humanoidDef.height,
        shoulderWidth: humanoidDef.shoulderWidth,
        armLength: humanoidDef.armLength,
        legLength: humanoidDef.legLength,
      });
      console.log("[PlayerController] Equipped robot armor set");
    }

    const capsule = BABYLON.MeshBuilder.CreateCapsule(
      "player",
      { height: 2, radius: 0.5 },
      this.scene
    );
    capsule.position = new BABYLON.Vector3(0, 1, -15);
    capsule.isVisible = false;
    capsule.renderingGroupId = 1;
    capsule.parent = root;
    capsule.metadata = { tag: "Player", playerController: this };
    
    const invisMat = new BABYLON.StandardMaterial("playerInvis", this.scene);
    invisMat.alpha = 0;
    capsule.material = invisMat;
    
    return capsule;
  }

  private keyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyUpHandler: ((e: KeyboardEvent) => void) | null = null;

  private setupControls(): void {
    this.keyDownHandler = (e: KeyboardEvent) => {
      this.keys[e.code] = true;

      if (e.code === "Space") {
        if (this.isFlying) {
          return;
        }
        this.handleJump();
      }

      if (e.code === "KeyQ" && !this.isDodging && this.dodgeCooldownTimer <= 0) {
        this.startDodge();
      }

      if (e.code === "KeyF" && !this.isParrying && this.parryCooldownTimer <= 0) {
        this.startParry();
      }

      if (e.code === "KeyV") {
        this.triggerAttackAnimation(false);
        this.onMeleeAttack?.();
      }

      if (e.code === "KeyB") {
        this.triggerAttackAnimation(true);
        this.onHeavyMeleeAttack?.();
      }

      if (e.code === "KeyX" && this.hasFlightArmor) {
        this.toggleFlightMode();
      }
    };

    this.keyUpHandler = (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    };

    window.addEventListener("keydown", this.keyDownHandler);
    window.addEventListener("keyup", this.keyUpHandler);
  }

  dispose(): void {
    if (this.keyDownHandler) {
      window.removeEventListener("keydown", this.keyDownHandler);
      this.keyDownHandler = null;
    }
    if (this.keyUpHandler) {
      window.removeEventListener("keyup", this.keyUpHandler);
      this.keyUpHandler = null;
    }
    if (this.animationSystem) {
      this.animationSystem.dispose();
    }
    if (this.equippedArmor) {
      this.equippedArmor.dispose();
    }
    if (this.humanoid) {
      this.humanoid.dispose();
    }
    if (this.mesh && !this.mesh.isDisposed()) {
      this.mesh.dispose();
    }
    console.log("[PlayerController] Disposed");
  }

  private handleJump(): void {
    if (this.isDodging) return;

    if (this.isGrounded) {
      this.jumpCount = 1;
      this.velocity.y = this.jumpForce;
      this.isGrounded = false;
      console.log("[PlayerController] Jump 1 - Normal jump");
      return;
    }

    if (!this.isGrounded && this.jumpCount < this.maxJumpCount) {
      this.jumpCount++;

      if (this.jumpCount === 2) {
        this.velocity.y = this.doubleJumpForce;
        console.log("[PlayerController] Jump 2 - Double jump");
      } else if (this.jumpCount === 3 && this.hasFlightArmor) {
        this.velocity.y = this.tripleJumpLaunchForce;
        console.log("[PlayerController] Jump 3 - LAUNCH into sky!");
        setTimeout(() => {
          if (!this.isGrounded && this.hasFlightArmor && this.armorEnergy > 0) {
            this.enterFlightMode();
          }
        }, 400);
      } else if (this.jumpCount === 3 && !this.hasFlightArmor) {
        this.velocity.y = this.doubleJumpForce * 0.8;
        console.log("[PlayerController] Jump 3 - No flight armor, weaker third jump");
      }
    }
  }

  private enterFlightMode(): void {
    if (this.isFlying) return;
    this.isFlying = true;
    this.velocity.y = 0;
    this.stateMachine.changeState("flying");
    this.bus.emit(GameEvents.PLAYER_FLIGHT_ENTER);
    console.log("[PlayerController] Entered flight mode");
  }

  private exitFlightMode(): void {
    if (!this.isFlying) return;
    this.isFlying = false;
    this.stateMachine.changeState("idle");
    this.bus.emit(GameEvents.PLAYER_FLIGHT_EXIT);
    console.log("[PlayerController] Exited flight mode");
  }

  private toggleFlightMode(): void {
    if (this.isFlying) {
      this.exitFlightMode();
    } else if (!this.isGrounded && this.armorEnergy > 0) {
      this.enterFlightMode();
    }
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

    if (this.isFlying) {
      this.updateFlight(deltaTime);
      this.updateCamera();
      this.updateAnimations(deltaTime);
      return;
    }

    this.updateJetpack(deltaTime);

    if (this.isDodging) {
      this.updateDodge(deltaTime);
    } else {
      this.updateMovement(deltaTime);
    }

    this.updatePhysics(deltaTime);
    this.updateCamera();
    this.updateAnimations(deltaTime);
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
    if (this.keys["Space"] && !this.isGrounded && this.jetpackFuel > 0 && !this.isDodging && !this.isFlying) {
      this.isJetpacking = true;
      this.velocity.y = Math.min(this.velocity.y + this.jetpackForce, 0.35);
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

  private updateFlight(dt: number): void {
    this.armorEnergy -= this.flightEnergyCost * dt;
    if (this.armorEnergy <= 0) {
      this.armorEnergy = 0;
      this.exitFlightMode();
      return;
    }

    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const right = this.camera.getDirection(BABYLON.Vector3.Right());
    const speed = this.isSprinting ? this.flightSprintSpeed : this.flightSpeed;

    let moveDir = BABYLON.Vector3.Zero();

    if (this.keys["KeyW"]) moveDir.addInPlace(forward.scale(speed));
    if (this.keys["KeyS"]) moveDir.addInPlace(forward.scale(-speed));
    if (this.keys["KeyA"]) moveDir.addInPlace(right.scale(-speed));
    if (this.keys["KeyD"]) moveDir.addInPlace(right.scale(speed));

    if (this.keys["Space"]) {
      moveDir.y += this.flightAscendSpeed;
    }
    if (this.keys["ControlLeft"] || this.keys["ControlRight"] || this.keys["ShiftRight"]) {
      moveDir.y -= this.flightDescendSpeed;
    }

    const damping = 0.85;
    this.velocity.x = this.velocity.x * damping + moveDir.x * (1 - damping);
    this.velocity.y = this.velocity.y * damping + moveDir.y * (1 - damping);
    this.velocity.z = this.velocity.z * damping + moveDir.z * (1 - damping);

    this.meshRoot.position.addInPlace(this.velocity);

    if (this.meshRoot.position.y < this.groundY + 1) {
      this.meshRoot.position.y = this.groundY + 1;
      this.velocity.y = 0;
      this.isGrounded = true;
      this.jumpCount = 0;
      this.exitFlightMode();
      return;
    }

    const isMovingInFlight = this.keys["KeyW"] || this.keys["KeyS"] || this.keys["KeyA"] || this.keys["KeyD"] || this.keys["Space"] || this.keys["ControlLeft"] || this.keys["ControlRight"] || this.keys["ShiftRight"];

    if (isMovingInFlight) {
      this.stateMachine.changeState("flying");
    } else {
      this.stateMachine.changeState("hovering");
    }

    if (!this.isGrounded && this.armorEnergy > 0) {
      this.armorEnergy = Math.max(0, this.armorEnergy);
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
      this.meshRoot.position.addInPlace(this.dodgeDirection.scale(this.dodgeSpeed));
    }
  }

  private airMomentumX: number = 0;
  private airMomentumZ: number = 0;

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

    if (this.isGrounded) {
      this.velocity.x = moveDirection.x;
      this.velocity.z = moveDirection.z;
      this.airMomentumX = this.velocity.x;
      this.airMomentumZ = this.velocity.z;
    } else {
      const airControl = 0.15;
      if (this.isMoving()) {
        this.velocity.x = this.airMomentumX + moveDirection.x * airControl;
        this.velocity.z = this.airMomentumZ + moveDirection.z * airControl;
      } else {
        this.velocity.x = this.airMomentumX * 0.995;
        this.velocity.z = this.airMomentumZ * 0.995;
      }
    }

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

    this.meshRoot.position.addInPlace(this.velocity);

    let surfaceY = this.groundY;
    const rayLength = Math.max(8, Math.abs(this.velocity.y) * 20 + 5);
    const ray = new BABYLON.Ray(
      new BABYLON.Vector3(this.meshRoot.position.x, this.meshRoot.position.y, this.meshRoot.position.z),
      BABYLON.Vector3.Down(),
      rayLength
    );
    const hit = this.scene.pickWithRay(ray, (mesh) => {
      if (mesh.name === "player" || mesh.name.startsWith("char")) return false;
      const n = mesh.name;
      return n === "ground" || n.startsWith("skyPlat_") || n.startsWith("bridge_seg") ||
        n.startsWith("step_") || n.startsWith("rooftop_") || n === "mainHighway" ||
        n === "crossHighway" || n === "spaceport";
    });

    if (hit && hit.hit && hit.pickedPoint) {
      const platSurface = hit.pickedPoint.y;
      if (platSurface > surfaceY) {
        surfaceY = platSurface;
      }
    }

    if (this.meshRoot.position.y <= surfaceY + 1) {
      this.meshRoot.position.y = surfaceY + 1;
      this.velocity.y = 0;
      this.isGrounded = true;
      this.jumpCount = 0;
    } else {
      this.isGrounded = false;
    }

    if (this.isGrounded && this.armorEnergy < this.maxArmorEnergy) {
      this.armorEnergy = Math.min(this.maxArmorEnergy, this.armorEnergy + this.armorEnergyRegen * dt);
    }
  }

  private updateCamera(): void {
    this.camera.position = new BABYLON.Vector3(
      this.meshRoot.position.x,
      this.meshRoot.position.y + 1.5,
      this.meshRoot.position.z
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
    if (this.isFlying) {
      this.isFlying = false;
    }
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

  grantFlightArmor(): void {
    this.hasFlightArmor = true;
    console.log("[PlayerController] Flight armor acquired! Triple-jump flight enabled. Press X to toggle flight.");
    this.bus.emit(GameEvents.PLAYER_FLIGHT_ARMOR_ACQUIRED);
  }

  getHasFlightArmor(): boolean {
    return this.hasFlightArmor;
  }

  getIsFlying(): boolean {
    return this.isFlying;
  }

  getArmorEnergy(): number {
    return this.armorEnergy;
  }

  getMaxArmorEnergy(): number {
    return this.maxArmorEnergy;
  }

  getJumpCount(): number {
    return this.jumpCount;
  }

  private updateAnimations(dt: number): void {
    this.animationSystem.notifyGroundedChange(this.isGrounded);
    this.prevGrounded = this.isGrounded;

    const animState = this.mapPlayerStateToAnimation();
    this.animationSystem.setAnimationState(animState);
    this.animationSystem.update(dt);
  }

  private mapPlayerStateToAnimation(): AnimationState {
    if (!this.isAlive) return "dead";

    if (this.isDodging) return "dodgeRoll";

    const playerState = this.stateMachine.getState();

    if (playerState === "flying") return "flyingHover";
    if (playerState === "hovering") return "flyingHover";

    if (!this.isGrounded) {
      if (this.jumpCount >= 3) return "tripleJumpLaunch";
      if (this.jumpCount === 2) return "doubleJump";
      return "jumping";
    }

    if (playerState === "sprinting") return "sprinting";
    if (playerState === "moving") return "running";
    if (playerState === "attacking") return "lightPunch";
    if (playerState === "jetpack") return "flyingHover";

    return "idle";
  }

  triggerAttackAnimation(heavy: boolean): void {
    this.animationSystem.setAnimationState(heavy ? "heavySlam" : "lightPunch");
  }

  getAnimationSystem(): AnimationSystem {
    return this.animationSystem;
  }

  getAnimationState(): AnimationState {
    return this.animationSystem.getCurrentState();
  }

  getStats(): PlayerStats {
    return { ...this.stats };
  }

  getPosition(): BABYLON.Vector3 {
    return this.meshRoot.position.clone();
  }

  getRotation(): BABYLON.Vector3 {
    return this.mesh.rotation.clone();
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
