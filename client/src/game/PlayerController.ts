import * as BABYLON from "@babylonjs/core";
import { StateMachine } from "./StateMachine";
import { EventBus, GameEvents } from "./EventBus";
import { DamageInfo, DamageResult, DamageResistance, IDamageable, DamageType } from "./DamageSystem";
import { AnimationSystem, AnimationState } from "./AnimationSystem";
import { HumanoidCharacter } from "./HumanoidCharacter";
import { HUMANOID_PRESETS } from "./HumanoidPresets";
import { equipArmorSet, deserializeArmorSet, EquippedArmor, ArmorSetSerialized } from "./RobotArmorSystem";
import type { WallCollider, FloorPlatform } from "./CityGenerator";

export type PlayerState = "idle" | "moving" | "sprinting" | "dodging" | "attacking" | "stunned" | "dead" | "jetpack" | "flying" | "hovering";

export interface PlayerStats {
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  shield: number;
  maxShield: number;
  shieldRegenRate: number;
  shieldRegenDelay: number;
  stamina: number;
  maxStamina: number;
  credits: number;
  experience: number;
  level: number;
}

export interface PlayerUpgradeDef {
  id: string;
  name: string;
  description: string;
  baseAmount: number;
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
}

export interface PlayerUpgradeInfo extends PlayerUpgradeDef {
  level: number;
  cost: number;
  current: number;
  next: number;
  affordable: boolean;
  maxed: boolean;
}

export const PLAYER_UPGRADES: PlayerUpgradeDef[] = [
  { id: "maxHealth",         name: "Max Health",      description: "Increase total health pool",     baseAmount:  25, baseCost: 200, costGrowth: 0.6, maxLevel: 10 },
  { id: "maxArmor",          name: "Max Armor",       description: "Increase armor capacity (70% absorb)", baseAmount: 15, baseCost: 200, costGrowth: 0.6, maxLevel: 10 },
  { id: "maxShield",         name: "Max Shield",      description: "Increase recharging shield pool",baseAmount:  20, baseCost: 250, costGrowth: 0.6, maxLevel: 10 },
  { id: "shieldRegenRate",   name: "Shield Regen",    description: "Faster shield restore per second",baseAmount:  5, baseCost: 300, costGrowth: 0.5, maxLevel:  8 },
  { id: "shieldRegenDelay",  name: "Recharge Speed",  description: "Less delay before shield regenerates", baseAmount: -0.3, baseCost: 400, costGrowth: 0.5, maxLevel: 5 },
];

function upgradeCost(def: PlayerUpgradeDef, level: number): number {
  return Math.floor(def.baseCost * (1 + level * def.costGrowth));
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
  private wallColliders: WallCollider[] = [];
  private floorPlatforms: FloorPlatform[] = [];
  // Wall slide / wall jump state
  private wallTouchTimer: number = 0;       // seconds remaining where the player counts as "on a wall"
  private wallNormal: BABYLON.Vector3 = new BABYLON.Vector3(0, 0, 0); // unit vector pointing away from the last wall hit
  private wallJumpLockoutTimer: number = 0; // brief lockout after a wall-jump so we don't immediately re-stick

  private walkSpeed: number = 0.3;
  private sprintSpeed: number = 0.55;
  private jumpForce: number = 0.5;
  private gravity: number = 0.02;
  private groundY: number = 1;

  health: number = 250;
  maxHealth: number = 250;
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

  // Rocket skates: hold sprint for `rocketSkateThreshold` seconds and the
  // player slides into a "rollerskating" mode — even faster, smoother
  // momentum, and reduced stamina drain so it can be sustained for cinematic
  // long-distance traversal.
  private sprintHoldTime: number = 0;
  private isRocketSkating: boolean = false;
  private rocketSkateThreshold: number = 2.0;
  private rocketSkateSpeed: number = 1.0;

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

  // Boost dash — a forward camera-direction burst with brief invuln frames.
  // Distinct from the standard Q dodge: dashing right before a beam-sabre
  // slash triggers an instant energy wave (LB → LT chain).
  private isBoostDashing: boolean = false;
  private boostDashTimer: number = 0;
  private boostDashDuration: number = 0.28;
  private boostDashCooldown: number = 0.7;
  private boostDashCooldownTimer: number = 0;
  private boostDashSpeed: number = 4.2;
  private boostDashDirection: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private lastBoostDashAt: number = 0;

  private isJetpacking: boolean = false;
  private jetpackFuel: number = 200;
  private maxJetpackFuel: number = 200;
  private jetpackForce: number = 0.06;
  private jetpackFuelCost: number = 20;
  private jetpackFuelRegen: number = 30;

  private invulnerabilityTimer: number = 0;
  private cameraMode: "first" | "third" = "first";

  private shieldRegenCooldown: number = 0;
  private playerUpgradeLevels: Record<string, number> = {};

  setCameraMode(mode: "first" | "third"): void {
    this.cameraMode = mode;
  }

  getCameraMode(): "first" | "third" {
    return this.cameraMode;
  }

  toggleCameraMode(): "first" | "third" {
    this.cameraMode = this.cameraMode === "first" ? "third" : "first";
    return this.cameraMode;
  }

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
      health: 250,
      maxHealth: 250,
      armor: 100,
      maxArmor: 100,
      shield: 75,
      maxShield: 75,
      shieldRegenRate: 30,
      shieldRegenDelay: 1.2,
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

      if (e.code === "KeyL" && !this.isBoostDashing && this.boostDashCooldownTimer <= 0) {
        this.startBoostDash();
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

      if (e.code === "KeyC") {
        this.toggleCameraMode();
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

    // Wall jump — when airborne and stuck on a wall, leap away + up.
    // Refunds the air-jump count so the player can still double-jump after.
    if (!this.isGrounded && this.wallTouchTimer > 0) {
      const pushAway = 0.45;
      this.velocity.y = this.jumpForce;
      this.velocity.x = this.wallNormal.x * pushAway;
      this.velocity.z = this.wallNormal.z * pushAway;
      this.airMomentumX = this.velocity.x;
      this.airMomentumZ = this.velocity.z;
      this.wallTouchTimer = 0;
      this.wallJumpLockoutTimer = 0.25; // quarter-second so we don't re-stick
      this.jumpCount = 1; // refresh so the player gets their full air-jump set
      console.log("[PlayerController] Wall jump");
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

  private startBoostDash(): void {
    if (this.stateMachine.isInState("stunned", "dead")) return;
    if (this.mountedVehiclePos) return;

    this.isBoostDashing = true;
    this.boostDashTimer = this.boostDashDuration;
    this.isInvulnerable = true;
    this.lastBoostDashAt = performance.now();

    // Forward camera direction (or input direction if WASD held).
    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const right = this.camera.getDirection(BABYLON.Vector3.Right());
    forward.y = 0; right.y = 0;
    forward.normalize(); right.normalize();

    const dir = BABYLON.Vector3.Zero();
    if (this.keys["KeyW"]) dir.addInPlace(forward);
    if (this.keys["KeyS"]) dir.addInPlace(forward.scale(-1));
    if (this.keys["KeyA"]) dir.addInPlace(right.scale(-1));
    if (this.keys["KeyD"]) dir.addInPlace(right);
    if (dir.length() < 0.1) dir.copyFrom(forward);
    dir.normalize();

    this.boostDashDirection = dir;
    this.bus.emit(GameEvents.PLAYER_DODGE);
  }

  /** Milliseconds since the last boost-dash trigger. Used by the Beam Sabre to
   *  recognize a "dash → slash" chain and fire an instant energy wave. */
  getMsSinceLastBoostDash(): number {
    if (this.lastBoostDashAt === 0) return Number.POSITIVE_INFINITY;
    return performance.now() - this.lastBoostDashAt;
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

    // Shield, stamina and cooldown timers tick even while the player is
    // riding inside a vehicle — sitting in an ATV shouldn't pause your
    // recharge or cooldowns. Only movement/physics is suppressed.
    this.updateTimers(deltaTime);
    this.updateStamina(deltaTime);
    this.updateShield(deltaTime);

    if (this.mountedVehiclePos) {
      this.meshRoot.position.copyFrom(this.mountedVehiclePos);
      this.updateCamera(deltaTime);
      return;
    }

    this.stateMachine.update(deltaTime);

    if (this.isFlying) {
      this.updateFlight(deltaTime);
      this.updateCamera(deltaTime);
      this.updateAnimations(deltaTime);
      return;
    }

    this.updateJetpack(deltaTime);

    if (this.isDodging) {
      this.updateDodge(deltaTime);
    } else if (this.isBoostDashing) {
      this.updateBoostDash(deltaTime);
    } else {
      this.updateMovement(deltaTime);
    }

    this.updatePhysics(deltaTime);
    this.updateCamera(deltaTime);
    this.updateAnimations(deltaTime);
  }

  private updateBoostDash(dt: number): void {
    this.boostDashTimer -= dt;
    if (this.boostDashTimer <= 0) {
      this.isBoostDashing = false;
      this.isInvulnerable = false;
      this.boostDashCooldownTimer = this.boostDashCooldown;
      return;
    }
    // Apply horizontal dash velocity; preserve gravity on Y.
    const step = this.boostDashDirection.scale(this.boostDashSpeed);
    this.velocity.x = step.x;
    this.velocity.z = step.z;
  }

  private updateTimers(dt: number): void {
    if (this.dodgeCooldownTimer > 0) this.dodgeCooldownTimer -= dt;
    if (this.boostDashCooldownTimer > 0) this.boostDashCooldownTimer -= dt;
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

  private updateShield(dt: number): void {
    if (this.shieldRegenCooldown > 0) {
      this.shieldRegenCooldown -= dt;
      return;
    }
    if (this.stats.shield < this.stats.maxShield) {
      this.stats.shield = Math.min(
        this.stats.maxShield,
        this.stats.shield + this.stats.shieldRegenRate * dt,
      );
    }
  }

  private updateStamina(dt: number): void {
    this.isSprinting = this.keys["ShiftLeft"] && this.stats.stamina > 0 && this.isMoving();

    // Only accumulate skate-charge while genuinely sprinting on foot — being
    // airborne, jetpacking, or in free-flight should not trigger an "engaged"
    // popup mid-air.
    const onFoot = this.isGrounded && !this.isFlying && !this.isJetpacking && !this.isDodging;

    if (this.isSprinting) {
      // Drain stamina any time the player is sprinting, but only CHARGE the
      // skate timer while on foot. Once engaged, skates persist through brief
      // jumps so a launch off a ramp won't pop the mode.
      const cost = this.isRocketSkating ? this.sprintStaminaCost * 0.4 : this.sprintStaminaCost;
      this.stats.stamina = Math.max(0, this.stats.stamina - cost * dt);
      this.staminaRegenDelay = 0.5;

      if (onFoot) {
        this.sprintHoldTime += dt;
        if (this.sprintHoldTime >= this.rocketSkateThreshold && !this.isRocketSkating) {
          this.isRocketSkating = true;
          this.bus.emit(GameEvents.UI_MESSAGE, {
            text: "ROCKET SKATES ENGAGED",
            duration: 1.5,
          });
        }
      }
    } else {
      // Sprint released (or stamina gone, or stopped moving): stow skates.
      if (this.isRocketSkating) {
        this.bus.emit(GameEvents.UI_MESSAGE, {
          text: "Rocket Skates Stowed",
          duration: 1.0,
        });
      }
      this.sprintHoldTime = 0;
      this.isRocketSkating = false;
    }

    if (this.staminaRegenDelay <= 0 && this.stats.stamina < this.stats.maxStamina) {
      this.stats.stamina = Math.min(this.stats.maxStamina, this.stats.stamina + this.staminaRegenRate * dt);
    }
  }

  /** Public accessor so the HUD can show a rocket-skate badge. */
  isRocketSkateMode(): boolean {
    return this.isRocketSkating;
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
    // Rocket skates > sprint > walk. Speed applies to every WASD axis below.
    const speed = this.isRocketSkating
      ? this.rocketSkateSpeed
      : (this.isSprinting ? this.sprintSpeed : this.walkSpeed);

    if (this.keys["KeyW"]) moveDirection.addInPlace(forward.scale(speed));
    if (this.keys["KeyS"]) moveDirection.addInPlace(forward.scale(-speed));
    if (this.keys["KeyA"]) moveDirection.addInPlace(right.scale(-speed));
    if (this.keys["KeyD"]) moveDirection.addInPlace(right.scale(speed));

    if (this.isGrounded) {
      if (this.isRocketSkating) {
        // Vehicle-like momentum so the skates feel weighty and glide-y
        // instead of snapping direction every frame.
        const lerp = 0.14;
        this.velocity.x += (moveDirection.x - this.velocity.x) * lerp;
        this.velocity.z += (moveDirection.z - this.velocity.z) * lerp;
      } else {
        this.velocity.x = moveDirection.x;
        this.velocity.z = moveDirection.z;
      }
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
    // Tick wall-touch + wall-jump-lockout timers
    if (this.wallTouchTimer > 0) this.wallTouchTimer = Math.max(0, this.wallTouchTimer - dt);
    if (this.wallJumpLockoutTimer > 0) this.wallJumpLockoutTimer = Math.max(0, this.wallJumpLockoutTimer - dt);
    // Touching a wall in mid-air resets after landing
    if (this.isGrounded) this.wallTouchTimer = 0;

    if (!this.isGrounded && !this.isJetpacking) {
      this.velocity.y -= this.gravity;
    }

    // Wall slide: while airborne, falling, and stuck against a wall, cap the
    // descent speed so the player gently slides down instead of free-falling.
    const isWallSliding = !this.isGrounded && !this.isJetpacking && !this.isFlying &&
                          this.wallTouchTimer > 0 && this.velocity.y < 0;
    if (isWallSliding) {
      const wallSlideMaxFall = 0.08; // very gentle slide
      if (this.velocity.y < -wallSlideMaxFall) this.velocity.y = -wallSlideMaxFall;
    }

    const maxFallSpeed = 0.8;
    if (this.velocity.y < -maxFallSpeed) {
      this.velocity.y = -maxFallSpeed;
    }

    this.meshRoot.position.addInPlace(this.velocity);
    this.resolveWallCollisions();

    let surfaceY = this.groundY;
    const rayLength = Math.max(8, Math.abs(this.velocity.y) * 20 + 5);
    const ray = new BABYLON.Ray(
      new BABYLON.Vector3(this.meshRoot.position.x, this.meshRoot.position.y, this.meshRoot.position.z),
      BABYLON.Vector3.Down(),
      rayLength
    );
    // Predicate: only large-area pickable surfaces (rooftop platforms,
    // highways, sky bridges, exterior ramps). Building interior floors and
    // roofs are NOT picked here — they're handled analytically by
    // getBuildingFloorYAt(), which is O(n) AABB tests instead of full
    // ray-mesh intersections (~5x faster when standing inside a building).
    const hit = this.scene.pickWithRay(ray, (mesh) => {
      if (mesh.name === "player" || mesh.name.startsWith("char")) return false;
      const n = mesh.name;
      return n === "ground" || n.startsWith("skyPlat_") || n.startsWith("bridge_seg") ||
        n.startsWith("step_") || n.startsWith("rooftop_") || n === "mainHighway" ||
        n === "crossHighway" || n === "spaceport" ||
        n.startsWith("extRamp") || n.startsWith("rt_seg") || n.startsWith("rt_ramp");
    });

    if (hit && hit.hit && hit.pickedPoint) {
      const platSurface = hit.pickedPoint.y;
      if (platSurface > surfaceY) {
        surfaceY = platSurface;
      }
    }

    // Add building-interior floor / external landing platforms via cheap AABB lookup.
    const floorY = this.getBuildingFloorYAt(
      this.meshRoot.position.x,
      this.meshRoot.position.z,
      this.meshRoot.position.y,
    );
    if (floorY > surfaceY) {
      surfaceY = floorY;
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

  /**
   * Pushes the player out of any building wall AABBs. Called every frame after
   * vertical movement is applied so the player can't walk through hollow-shell
   * building walls. Door cutouts are naturally permitted because no collider is
   * registered in those gap regions.
   */
  private resolveWallCollisions(): void {
    if (this.wallColliders.length === 0) return;
    if (this.isMounted()) return; // vehicles handle their own collision
    const r = 0.5; // player radius
    const headroom = 1.8;
    const px0 = this.meshRoot.position.x;
    const pz0 = this.meshRoot.position.z;
    const py = this.meshRoot.position.y;
    let px = px0;
    let pz = pz0;
    let nx = 0; // wall normal X (pointing away from wall toward player)
    let nz = 0; // wall normal Z
    // Use velocity to decide push-out direction so the player gets pushed
    // back along the axis they came in on (prevents tunnelling on thin walls).
    const vx = this.velocity.x;
    const vz = this.velocity.z;

    for (let i = 0; i < this.wallColliders.length; i++) {
      const w = this.wallColliders[i];
      // Vertical-range filter: only walls overlapping the player's body height
      if (py + headroom < w.minY || py - 0.2 > w.maxY) continue;
      const minX = w.minX - r;
      const maxX = w.maxX + r;
      const minZ = w.minZ - r;
      const maxZ = w.maxZ + r;
      if (px < minX || px > maxX || pz < minZ || pz > maxZ) continue;

      const dxL = px - minX;
      const dxR = maxX - px;
      const dzB = pz - minZ;
      const dzF = maxZ - pz;
      // Prefer push-out opposite to travel direction — this corrects for
      // fast crossings that would otherwise pop the player to the far side.
      const ax = Math.abs(vx);
      const az = Math.abs(vz);
      const useX = ax > az + 0.001;
      const useZ = az > ax + 0.001;
      if (useX) {
        if (vx > 0) { px = minX - 0.001; nx = -1; nz = 0; }
        else { px = maxX + 0.001; nx = 1; nz = 0; }
      } else if (useZ) {
        if (vz > 0) { pz = minZ - 0.001; nx = 0; nz = -1; }
        else { pz = maxZ + 0.001; nx = 0; nz = 1; }
      } else {
        // No clear direction — fall back to shortest axis
        const m = Math.min(dxL, dxR, dzB, dzF);
        if (m === dxL)      { px = minX - 0.001; nx = -1; nz = 0; }
        else if (m === dxR) { px = maxX + 0.001; nx = 1;  nz = 0; }
        else if (m === dzB) { pz = minZ - 0.001; nx = 0;  nz = -1; }
        else                { pz = maxZ + 0.001; nx = 0;  nz = 1; }
      }
    }

    if (px !== px0) this.meshRoot.position.x = px;
    if (pz !== pz0) this.meshRoot.position.z = pz;

    // If we were pushed out and we're airborne, mark the player as
    // touching a wall — feeds the wall-slide and wall-jump systems.
    if ((nx !== 0 || nz !== 0) && !this.isGrounded && this.wallJumpLockoutTimer <= 0) {
      this.wallNormal.set(nx, 0, nz);
      this.wallTouchTimer = 0.18; // ~10 frames at 60fps
    }
  }

  setBuildingColliders(colliders: WallCollider[]): void {
    this.wallColliders = colliders;
  }

  setFloorPlatforms(platforms: FloorPlatform[]): void {
    this.floorPlatforms = platforms;
  }

  /**
   * Returns the highest floor-platform Y at (x,z) that is at or below the
   * player's current head height. Used by ground detection so we don't have
   * to raycast against thousands of pickable building floor/roof meshes.
   */
  private getBuildingFloorYAt(px: number, pz: number, py: number): number {
    let best = -Infinity;
    const maxY = py + 1.5; // allow tiny tolerance above player's feet (py is feet)
    for (let i = 0; i < this.floorPlatforms.length; i++) {
      const f = this.floorPlatforms[i];
      if (f.y > maxY) continue;
      if (px < f.minX || px > f.maxX || pz < f.minZ || pz > f.maxZ) continue;
      if (f.y > best) best = f.y;
    }
    return best;
  }

  private updateCamera(dt: number = 1 / 60): void {
    const headHeight = 1.7;

    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const flatForward = new BABYLON.Vector3(forward.x, 0, forward.z);
    if (flatForward.lengthSquared() < 0.0001) {
      flatForward.set(0, 0, 1);
    } else {
      flatForward.normalize();
    }

    if (this.cameraMode === "third") {
      const cameraDistance = 6.5;
      const cameraHeight = 2.2;

      const target = new BABYLON.Vector3(
        this.meshRoot.position.x,
        this.meshRoot.position.y + headHeight,
        this.meshRoot.position.z,
      );

      const desired = target
        .add(flatForward.scale(-cameraDistance))
        .add(new BABYLON.Vector3(0, cameraHeight, 0));

      desired.y = Math.max(desired.y, 0.6);
      this.camera.position.copyFrom(desired);
    } else {
      const eyeForwardOffset = 0.25;
      const desired = new BABYLON.Vector3(
        this.meshRoot.position.x + flatForward.x * eyeForwardOffset,
        this.meshRoot.position.y + headHeight,
        this.meshRoot.position.z + flatForward.z * eyeForwardOffset,
      );
      this.camera.position.copyFrom(desired);
    }

    if (this.meshRoot instanceof BABYLON.Mesh || this.meshRoot instanceof BABYLON.TransformNode) {
      const targetYaw = Math.atan2(flatForward.x, flatForward.z);
      const r = this.meshRoot.rotation;
      const delta = ((targetYaw - r.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      const smooth = 1 - Math.exp(-12 * dt);
      r.y += delta * smooth;
    }
  }

  private mountedVehiclePos: BABYLON.Vector3 | null = null;
  private mountedVehicleRoot: BABYLON.TransformNode | null = null;
  private hiddenForVehicle: BABYLON.AbstractMesh[] = [];

  setMounted(vehicleRoot: BABYLON.TransformNode | null): void {
    if (vehicleRoot) {
      this.mountedVehicleRoot = vehicleRoot;
      this.mountedVehiclePos = vehicleRoot.position;
      this.velocity.setAll(0);
      this.isFlying = false;
      this.isDodging = false;
      this.isBoostDashing = false;
      this.stateMachine.changeState("idle");
      if (this.humanoid) {
        const root = this.humanoid.getRoot();
        this.hiddenForVehicle = root.getChildMeshes();
        for (const m of this.hiddenForVehicle) m.isVisible = false;
      }
    } else {
      this.mountedVehicleRoot = null;
      this.mountedVehiclePos = null;
      for (const m of this.hiddenForVehicle) m.isVisible = true;
      this.hiddenForVehicle = [];
    }
  }

  isMounted(): boolean {
    return this.mountedVehicleRoot !== null;
  }

  setPosition(pos: BABYLON.Vector3): void {
    this.meshRoot.position.copyFrom(pos);
  }

  getCameraYaw(): number {
    return this.camera.rotation.y;
  }

  getCameraPitch(): number {
    return this.camera.rotation.x;
  }

  getAimOrigin(): BABYLON.Vector3 {
    return new BABYLON.Vector3(
      this.meshRoot.position.x,
      this.meshRoot.position.y + 1.7,
      this.meshRoot.position.z,
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

    this.shieldRegenCooldown = this.stats.shieldRegenDelay;

    if (this.stats.shield > 0 && amount > 0) {
      const shieldAbsorb = Math.min(this.stats.shield, amount);
      this.stats.shield -= shieldAbsorb;
      amount -= shieldAbsorb;
      this.bus.emit(GameEvents.PLAYER_DAMAGED, { amount: shieldAbsorb, remaining: this.stats.health, viaShield: true });
    }

    if (this.stats.armor > 0 && amount > 0) {
      const armorAbsorb = Math.min(this.stats.armor, amount * 0.7);
      this.stats.armor -= armorAbsorb;
      amount -= armorAbsorb;
    }

    if (amount <= 0) {
      this.invulnerabilityTimer = 0.2;
      this.isInvulnerable = true;
      return { damageAmount: 0, wasKilled: false, wasBlocked: true, wasParried: false };
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

  respawn(spawnPosition: BABYLON.Vector3): void {
    this.isAlive = true;
    this.isInvulnerable = false;
    this.stats.health = this.stats.maxHealth;
    this.health = this.stats.health;
    this.stats.armor = this.stats.maxArmor;
    this.stats.shield = this.stats.maxShield;
    this.shieldRegenCooldown = 0;
    this.stats.stamina = this.stats.maxStamina;
    this.armorEnergy = this.maxArmorEnergy;
    this.jetpackFuel = this.maxJetpackFuel;
    this.isFlying = false;
    this.isJetpacking = false;
    this.isDodging = false;
    this.isBoostDashing = false;
    this.isParrying = false;
    this.velocity.setAll(0);
    this.meshRoot.position.copyFrom(spawnPosition);
    // Reset orientation. Without this the character respawned still rotated
    // from whatever pose they died in (mid-roll, mid-flight, ragdoll), which
    // shows up as a misaligned mesh after the friendly respawn.
    this.meshRoot.rotation.setAll(0);
    if (this.meshRoot.rotationQuaternion) {
      this.meshRoot.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
    }
    this.stateMachine.forceState("idle");
    this.bus.emit(GameEvents.PLAYER_HEALED, { amount: this.stats.maxHealth, health: this.stats.health });
  }

  applyLoadedSnapshot(snap: { stats?: Partial<PlayerStats>; hasFlightArmor?: boolean; playerUpgrades?: Record<string, number> }): void {
    if (snap.playerUpgrades) {
      this.playerUpgradeLevels = { ...snap.playerUpgrades };
      this.recomputeUpgradeStats();
    }
    if (snap.stats) {
      if (typeof snap.stats.maxHealth === "number") {
        this.stats.maxHealth = snap.stats.maxHealth;
        this.maxHealth = snap.stats.maxHealth;
      }
      if (typeof snap.stats.maxArmor === "number") this.stats.maxArmor = snap.stats.maxArmor;
      if (typeof snap.stats.maxShield === "number") this.stats.maxShield = snap.stats.maxShield;
      // Migrate legacy slow shield-regen values from older saves: never go
      // below the current defaults (30/sec, 1.2s delay).
      if (typeof snap.stats.shieldRegenRate === "number") {
        this.stats.shieldRegenRate = Math.max(snap.stats.shieldRegenRate, 30);
      }
      if (typeof snap.stats.shieldRegenDelay === "number") {
        this.stats.shieldRegenDelay = Math.min(snap.stats.shieldRegenDelay, 1.2);
      }
      if (typeof snap.stats.maxStamina === "number") this.stats.maxStamina = snap.stats.maxStamina;
      if (typeof snap.stats.credits === "number") this.stats.credits = snap.stats.credits;
      if (typeof snap.stats.experience === "number") this.stats.experience = snap.stats.experience;
      if (typeof snap.stats.level === "number") this.stats.level = snap.stats.level;
      // Always heal to full on apply (player just logged in)
      this.stats.health = this.stats.maxHealth;
      this.health = this.stats.health;
      this.stats.stamina = this.stats.maxStamina;
      this.stats.armor = this.stats.maxArmor;
      this.stats.shield = this.stats.maxShield;
      this.shieldRegenCooldown = 0;
    }
    if (snap.hasFlightArmor && !this.hasFlightArmor) {
      this.hasFlightArmor = true;
    }
  }

  private getBaseStat(id: string): number {
    switch (id) {
      case "maxHealth": return 250;
      case "maxArmor": return 100;
      case "maxShield": return 75;
      case "shieldRegenRate": return 30;
      case "shieldRegenDelay": return 1.2;
      default: return 0;
    }
  }

  private applyStatFromUpgrade(id: string, value: number): void {
    switch (id) {
      case "maxHealth":
        this.stats.maxHealth = value;
        this.maxHealth = value;
        if (this.stats.health > value) this.stats.health = value;
        this.health = this.stats.health;
        break;
      case "maxArmor":
        this.stats.maxArmor = value;
        if (this.stats.armor > value) this.stats.armor = value;
        break;
      case "maxShield":
        this.stats.maxShield = value;
        if (this.stats.shield > value) this.stats.shield = value;
        break;
      case "shieldRegenRate":
        this.stats.shieldRegenRate = value;
        break;
      case "shieldRegenDelay":
        this.stats.shieldRegenDelay = Math.max(0.5, value);
        break;
    }
  }

  private recomputeUpgradeStats(): void {
    for (const def of PLAYER_UPGRADES) {
      const lvl = this.playerUpgradeLevels[def.id] ?? 0;
      const value = this.getBaseStat(def.id) + def.baseAmount * lvl;
      this.applyStatFromUpgrade(def.id, value);
    }
  }

  getPlayerUpgradeLevels(): Record<string, number> {
    return { ...this.playerUpgradeLevels };
  }

  getPlayerUpgradeInfo(): PlayerUpgradeInfo[] {
    return PLAYER_UPGRADES.map(def => {
      const level = this.playerUpgradeLevels[def.id] ?? 0;
      const maxed = level >= def.maxLevel;
      const cost = maxed ? 0 : upgradeCost(def, level);
      const current = this.getBaseStat(def.id) + def.baseAmount * level;
      const next = current + def.baseAmount;
      return {
        ...def,
        level,
        cost,
        current,
        next,
        affordable: !maxed && this.stats.credits >= cost,
        maxed,
      };
    });
  }

  upgradePlayerStat(id: string): boolean {
    const def = PLAYER_UPGRADES.find(d => d.id === id);
    if (!def) return false;
    const level = this.playerUpgradeLevels[id] ?? 0;
    if (level >= def.maxLevel) return false;
    const cost = upgradeCost(def, level);
    if (this.stats.credits < cost) return false;
    this.stats.credits -= cost;
    this.playerUpgradeLevels[id] = level + 1;
    const value = this.getBaseStat(id) + def.baseAmount * (level + 1);
    this.applyStatFromUpgrade(id, value);
    // Top off newly added pool when upgrading capacity
    if (id === "maxShield") this.stats.shield = this.stats.maxShield;
    if (id === "maxArmor") this.stats.armor = this.stats.maxArmor;
    if (id === "maxHealth") this.stats.health = this.stats.maxHealth;
    this.bus.emit(GameEvents.PLAYER_UPGRADED, { id, level: level + 1 });
    return true;
  }

  heal(amount: number): void {
    this.stats.health = Math.min(this.stats.maxHealth, this.stats.health + amount);
    this.health = this.stats.health;
    this.bus.emit(GameEvents.PLAYER_HEALED, { amount, health: this.stats.health });
  }

  addArmor(amount: number): void {
    this.stats.armor = Math.min(this.stats.maxArmor, this.stats.armor + amount);
  }

  /** Real wallet read used by ShopSystem. Credits live here, not on inventory. */
  getCredits(): number {
    return this.stats.credits;
  }

  addCredits(amount: number): void {
    this.stats.credits += amount;
  }

  spendCredits(amount: number): boolean {
    if (this.stats.credits < amount) return false;
    this.stats.credits -= amount;
    return true;
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
