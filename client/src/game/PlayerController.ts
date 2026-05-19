import * as BABYLON from "@babylonjs/core";
import { StateMachine } from "./StateMachine";
import { EventBus, GameEvents } from "./EventBus";
import { DamageInfo, DamageResult, DamageResistance, IDamageable, DamageType } from "./DamageSystem";
import { AnimationSystem, AnimationState } from "./AnimationSystem";
import { HumanoidCharacter } from "./HumanoidCharacter";
import { HUMANOID_PRESETS } from "./HumanoidPresets";
import { equipArmorSet, deserializeArmorSet, EquippedArmor, ArmorSetSerialized, DEFAULT_ARMOR_SET } from "./RobotArmorSystem";
import type { WallCollider, FloorPlatform } from "./CityGenerator";

export type PlayerState = "idle" | "moving" | "sprinting" | "dodging" | "attacking" | "stunned" | "dead" | "jetpack" | "flying" | "hovering" | "swimming";

type TerrainHeightProvider = (x: number, z: number, currentY?: number) => number | null | undefined;
type WaterSurfaceProvider = (x: number, z: number) => number | null | undefined;

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
  // Core defensive stats — bumped from level 10 → 20 so endgame players can
  // keep investing past the previous wall.
  { id: "maxHealth",         name: "Max Health",      description: "Increase total health pool",     baseAmount:  25, baseCost: 200, costGrowth: 0.6, maxLevel: 20 },
  { id: "maxArmor",          name: "Max Armor",       description: "Increase armor capacity (70% absorb)", baseAmount: 15, baseCost: 200, costGrowth: 0.6, maxLevel: 20 },
  { id: "maxShield",         name: "Max Shield",      description: "Increase recharging shield pool",baseAmount:  20, baseCost: 250, costGrowth: 0.6, maxLevel: 20 },
  { id: "shieldRegenRate",   name: "Shield Regen",    description: "Faster shield restore per second",baseAmount:  5, baseCost: 300, costGrowth: 0.5, maxLevel:  8 },
  { id: "shieldRegenDelay",  name: "Recharge Speed",  description: "Less delay before shield regenerates", baseAmount: -0.3, baseCost: 400, costGrowth: 0.5, maxLevel: 5 },

  // ---- Armor Mods: special suit modules that boost weapons + survivability.
  // Stored on `playerUpgradeLevels` like the others, but read out via
  // `getPlayerBoosts()` which WeaponsSystem queries for damage / fire-rate
  // multipliers, and applied directly to incoming damage in takeDamage().
  { id: "damageBoost",       name: "Armor Mod: Power Core",   description: "+5% weapon damage per level (caps at +50%)",       baseAmount: 0.05, baseCost: 350, costGrowth: 0.55, maxLevel: 10 },
  { id: "fireRateBoost",     name: "Armor Mod: Pulse Driver", description: "+4% fire rate per level (caps at +40%)",            baseAmount: 0.04, baseCost: 350, costGrowth: 0.55, maxLevel: 10 },
  { id: "damageReduction",   name: "Armor Mod: Aegis Plating",description: "-3% incoming damage per level (caps at -30%)",     baseAmount: 0.03, baseCost: 400, costGrowth: 0.55, maxLevel: 10 },
  { id: "staminaBoost",      name: "Armor Mod: Kinetic Cells",description: "+15 max stamina per level (caps at +75)",          baseAmount: 15,   baseCost: 250, costGrowth: 0.5,  maxLevel: 5  },

  // Dash Capacitor — stores extra boost-dash charges so KeyL can be tapped
  // 2× or 3× back-to-back before the regen window catches up. Max level 2:
  // L1 unlocks Double Dash (2 charges), L2 unlocks Triple Dash (3 charges).
  // Each charge regenerates on the existing 0.7 s boost-dash cooldown.
  { id: "dashCharges",       name: "Dash Capacitor",  description: "Store an extra dash charge — chain back-to-back bursts (L1: Double Dash, L2: Triple Dash)", baseAmount: 1, baseCost: 600, costGrowth: 1.0, maxLevel: 2 },
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
  // Spinning Downward Smash (KeyJ-hold air-attack). When true, updatePhysics
  // forces velocity to a fast pure-down dive and ignores horizontal input
  // until the player touches a surface; on landing it fires the stored
  // callback so SmashAttackSystem can spawn the shockwave + AoE damage.
  private isAirSmashing: boolean = false;
  private airSmashLandCb: (() => void) | null = null;
  private wallColliders: WallCollider[] = [];
  private floorPlatforms: FloorPlatform[] = [];
  // Wall slide / wall jump state
  private wallTouchTimer: number = 0;       // seconds remaining where the player counts as "on a wall"
  private wallNormal: BABYLON.Vector3 = new BABYLON.Vector3(0, 0, 0); // unit vector pointing away from the last wall hit
  private wallJumpLockoutTimer: number = 0; // brief lockout after a wall-jump so we don't immediately re-stick

  // Slightly bumped from 0.3 / 0.55 to give the player a snappier feel.
  // ~13% faster walk, ~13% faster sprint — small enough to keep level
  // pacing intact, large enough to be felt within seconds.
  private walkSpeed: number = 0.34;
  private sprintSpeed: number = 0.62;
  private jumpForce: number = 0.5;
  private gravity: number = 0.02;
  private groundY: number = 1;
  private terrainHeightProvider: TerrainHeightProvider | null = null;
  private waterSurfaceProvider: WaterSurfaceProvider | null = null;
  private isSwimming: boolean = false;
  private swimSpeed: number = 0.18;
  private swimSprintSpeed: number = 0.28;
  private swimAscendSpeed: number = 0.12;
  private swimDiveSpeed: number = 0.10;
  private swimDrag: number = 0.86;

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
  // Lowered from 2.0 → 1.2 so players don't have to sprint forever to engage.
  // Even short sprint bursts now light up the skates within ~1.2 s of holding
  // shift while moving.
  private rocketSkateThreshold: number = 1.2;
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
  // Dash now uses a *charge* system instead of a single cooldown so the
  // "Dash Capacitor" upgrade (PLAYER_UPGRADES.dashCharges) can grant
  // stored extra dashes (double / triple back-to-back). The cooldown
  // timer still represents the time-to-next-charge — it just regenerates
  // ONE charge per cycle and re-arms itself while charges < max.
  private isBoostDashing: boolean = false;
  private boostDashTimer: number = 0;
  private boostDashDuration: number = 0.28;
  private boostDashCooldown: number = 0.7;
  private boostDashCooldownTimer: number = 0;
  private boostDashSpeed: number = 4.2;
  private boostDashDirection: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private lastBoostDashAt: number = 0;
  private maxDashCharges: number = 1;
  private dashCharges: number = 1;

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
  private petBondBoosts = { damageMul: 1, fireRateMul: 1, damageReduction: 0 };

  setCameraMode(mode: "first" | "third"): void {
    this.cameraMode = mode;
    this.applyVisualForCameraMode();
  }

  getCameraMode(): "first" | "third" {
    return this.cameraMode;
  }

  toggleCameraMode(): "first" | "third" {
    this.cameraMode = this.cameraMode === "first" ? "third" : "first";
    this.applyVisualForCameraMode();
    return this.cameraMode;
  }

  /** Show/hide the rendered humanoid based on camera mode. In first-person
   *  the camera sits at head height inside the body, so animation poses
   *  that raise the arms (jump = -0.8 rad, double jump = -1.2, triple
   *  jump = -2.5) drag the arm meshes directly across the camera frustum
   *  and obscure the view. The hidden capsule + procedural arms aren't
   *  needed for any first-person gameplay (no inverse-kinematics weapon
   *  hold), so disabling the whole humanoid root is the simplest
   *  guaranteed fix. We tolerate a missing humanoid for the brief window
   *  during construction before `this.humanoid` is assigned. */
  private applyVisualForCameraMode(): void {
    if (!this.humanoid) return;
    const root = this.humanoid.getRoot();
    if (root) root.setEnabled(this.cameraMode === "third");
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
  private flightEntryTimer: ReturnType<typeof setTimeout> | null = null;

  // Superman Flight — premium SPECIALS unlock layered ON TOP of the
  // standard flight-armor mode. Triggered by pressing KeyL + Space
  // simultaneously while airborne. Distinct from `isFlying` (the X-key
  // / triple-jump mode) so the existing armor-energy economy keeps
  // working untouched. While in this mode jetpack is suppressed,
  // gravity is overridden, and weapons fire normally.
  private hasSupermanFlight: boolean = false;
  private isSupermanFlight: boolean = false;
  // Held-Space boost multiplier eases in/out for a snappy but not
  // jarring acceleration. Applied to the cruise + ascend speeds.
  private supermanBoostMul: number = 1;
  // Cruise + boost speeds (per-frame meters). Boost is ~3× cruise so a
  // panicked burst genuinely outruns aerial-enemy chase speeds.
  private supermanCruiseSpeed: number = 0.95;
  private supermanBoostSpeed: number = 2.6;
  private supermanAscendSpeed: number = 0.55;
  private supermanDescendSpeed: number = 0.55;

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
      transitions: ["moving", "sprinting", "dodging", "attacking", "stunned", "dead", "jetpack", "flying", "hovering", "swimming"],
    });
    this.stateMachine.addState({
      name: "moving",
      transitions: ["idle", "sprinting", "dodging", "attacking", "stunned", "dead", "jetpack", "flying", "hovering", "swimming"],
    });
    this.stateMachine.addState({
      name: "sprinting",
      transitions: ["idle", "moving", "dodging", "attacking", "stunned", "dead", "jetpack", "flying", "hovering", "swimming"],
    });
    this.stateMachine.addState({
      name: "dodging",
      transitions: ["idle", "moving", "sprinting", "stunned", "dead", "swimming"],
    });
    this.stateMachine.addState({
      name: "attacking",
      transitions: ["idle", "moving", "dodging", "stunned", "dead", "flying", "swimming"],
    });
    this.stateMachine.addState({
      name: "stunned",
      transitions: ["idle", "dead", "swimming"],
    });
    this.stateMachine.addState({
      name: "dead",
    });
    this.stateMachine.addState({
      name: "jetpack",
      transitions: ["idle", "moving", "stunned", "dead", "flying", "swimming"],
    });
    this.stateMachine.addState({
      name: "flying",
      transitions: ["idle", "moving", "hovering", "stunned", "dead", "swimming"],
    });
    this.stateMachine.addState({
      name: "hovering",
      transitions: ["idle", "moving", "flying", "stunned", "dead", "swimming"],
    });
    this.stateMachine.addState({
      name: "swimming",
      transitions: ["idle", "moving", "sprinting", "stunned", "dead", "flying", "hovering"],
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

    if (!armorSetSerialized) {
      armorSetSerialized = DEFAULT_ARMOR_SET;
      console.log("[PlayerController] No saved armor — equipping default humanoid kit");
    }
    if (armorSetSerialized) {
      humanoidDef = { ...humanoidDef, hasArmor: false };
    }

    this.humanoid = new HumanoidCharacter(this.scene, humanoidDef);
    const root = this.humanoid.getRoot();
    root.position = new BABYLON.Vector3(0, 1, -15);
    this.meshRoot = root;
    // Default camera mode is first-person; hide the body now that the
    // humanoid exists so the player isn't staring at the inside of their
    // own torso / raised arms on jump.
    this.applyVisualForCameraMode();

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

      // Superman Flight combo: KeyL + Space pressed while airborne (and
      // unlock owned) toggles the mode. Detect on either keydown by
      // checking the OTHER key's currently-held state. This keydown
      // handler already set `keys[e.code] = true` at line 382, so the
      // pressed key reads as held too — order doesn't matter. We
      // short-circuit BEFORE the jump / boost-dash branches so the
      // combo doesn't also fire those (otherwise pressing the combo
      // would consume a jump and a dash on top of toggling).
      if (this.hasSupermanFlight && !this.isGrounded && !this.mountedVehicleRoot && !this.isAirSmashing) {
        if ((e.code === "Space" && this.keys["KeyL"]) || (e.code === "KeyL" && this.keys["Space"])) {
          this.toggleSupermanMode();
          return;
        }
      }

      if (e.code === "Space") {
        if (this.isSwimming) {
          return;
        }
        if (this.isFlying || this.isSupermanFlight) {
          return;
        }
        this.handleJump();
      }

      if (e.code === "KeyQ" && !this.isDodging && this.dodgeCooldownTimer <= 0) {
        this.startDodge();
      }

      if (e.code === "KeyL" && !this.isBoostDashing && this.dashCharges > 0 && !this.isSupermanFlight) {
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

      if (e.code === "KeyX") {
        // X is the universal flight-cancel: toggles the standard
        // armor-flight when owned, and also bails out of Superman
        // mode. Letting both share the key means the player has a
        // single muscle-memory "land now" button.
        if (this.isSupermanFlight) {
          this.exitSupermanMode();
        } else if (this.hasFlightArmor) {
          this.toggleFlightMode();
        }
      }

      if (e.code === "KeyC") {
        // Ignore camera-toggle while mounted in a vehicle. Gamepad R3
        // (right-stick click) maps to KeyC, and players were accidentally
        // flipping 1st/3rd person mid-drive while looking around with the
        // right stick. The vehicle camera doesn't change behaviour with
        // mode anyway since the player mesh is hidden, so this is a pure
        // anti-misclick guard.
        if (!this.isMounted()) {
          this.toggleCameraMode();
        }
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
    if (this.flightEntryTimer) {
      clearTimeout(this.flightEntryTimer);
      this.flightEntryTimer = null;
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
        if (this.flightEntryTimer) clearTimeout(this.flightEntryTimer);
        this.flightEntryTimer = setTimeout(() => {
          this.flightEntryTimer = null;
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
    if (this.dashCharges <= 0) return;

    // Consume one stored charge. The regen timer is armed at end-of-dash
    // (in updateBoostDash) so the i-frame burst itself isn't shortened by
    // the cooldown — a player with 3 charges can chain three full dashes
    // back-to-back, then wait 0.7 s per charge to regenerate.
    this.dashCharges--;
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
    this.updateWaterContact();

    if (this.isSwimming) {
      this.updateSwimming(deltaTime);
      this.updateCamera(deltaTime);
      this.updateAnimations(deltaTime);
      return;
    }

    if (this.isFlying) {
      this.updateFlight(deltaTime);
      this.updateCamera(deltaTime);
      this.updateAnimations(deltaTime);
      return;
    }

    if (this.isSupermanFlight) {
      this.updateSuperman(deltaTime);
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
      // Arm the regen timer ONLY if no regen is already in flight and we
      // still have room to refill. Without this guard, chaining a second
      // dash mid-regen would reset the regen clock and effectively delay
      // the next charge — breaking the "back-to-back, then steady drip"
      // feel of the Dash Capacitor upgrade.
      if (this.dashCharges < this.maxDashCharges && this.boostDashCooldownTimer <= 0) {
        this.boostDashCooldownTimer = this.boostDashCooldown;
      }
      return;
    }
    // Apply horizontal dash velocity; preserve gravity on Y.
    const step = this.boostDashDirection.scale(this.boostDashSpeed);
    this.velocity.x = step.x;
    this.velocity.z = step.z;
  }

  private updateTimers(dt: number): void {
    if (this.dodgeCooldownTimer > 0) this.dodgeCooldownTimer -= dt;
    if (this.boostDashCooldownTimer > 0) {
      this.boostDashCooldownTimer -= dt;
      if (this.boostDashCooldownTimer <= 0) {
        // Regen one charge per cooldown cycle. If still below the cap,
        // re-arm immediately so a 3-charge player who just dumped all
        // three dashes refills at 0.7 s + 1.4 s + 2.1 s (steady drip)
        // rather than only ever regenerating one.
        if (this.dashCharges < this.maxDashCharges) {
          this.dashCharges++;
          if (this.dashCharges < this.maxDashCharges) {
            this.boostDashCooldownTimer = this.boostDashCooldown;
          }
        }
      }
    }
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
      // Sprint released (or stamina gone, or stopped moving). We DON'T zero
      // the charge timer instantly — a brief grace period (~0.4 s) lets the
      // timer survive small interruptions (turning, hitting a curb, weapon
      // tap) so the player doesn't have to hold shift perfectly for the full
      // threshold window. After the grace expires, the timer decays to 0 and
      // any active skate state is stowed.
      this.sprintHoldTime = Math.max(0, this.sprintHoldTime - dt * 2.5);
      if (this.sprintHoldTime <= 0 && this.isRocketSkating) {
        this.bus.emit(GameEvents.UI_MESSAGE, {
          text: "Rocket Skates Stowed",
          duration: 1.0,
        });
        this.isRocketSkating = false;
      }
    }

    if (this.staminaRegenDelay <= 0 && this.stats.stamina < this.stats.maxStamina) {
      this.stats.stamina = Math.min(this.stats.maxStamina, this.stats.stamina + this.staminaRegenRate * dt);
    }
  }

  private getAnalyticalGroundY(x: number, z: number, currentY: number = this.meshRoot.position.y): number | null {
    if (!this.terrainHeightProvider) return null;
    const h = this.terrainHeightProvider(x, z, currentY);
    return typeof h === "number" && Number.isFinite(h) ? h : null;
  }

  private getWaterContact(): { waterY: number; groundY: number; depth: number } | null {
    if (!this.waterSurfaceProvider) return null;
    const x = this.meshRoot.position.x;
    const z = this.meshRoot.position.z;
    const waterY = this.waterSurfaceProvider(x, z);
    if (typeof waterY !== "number" || !Number.isFinite(waterY)) return null;

    const ground = this.getAnalyticalGroundY(x, z) ?? this.groundY;
    const depth = waterY - ground;
    if (depth < 1.05) return null;
    return { waterY, groundY: ground, depth };
  }

  private updateWaterContact(): void {
    const contact = this.getWaterContact();
    const canSwim =
      !!contact &&
      !this.mountedVehicleRoot &&
      !this.isFlying &&
      !this.isSupermanFlight &&
      !this.stateMachine.isInState("dead");

    const submerged = canSwim && this.meshRoot.position.y <= contact!.waterY + 0.95;
    if (!submerged) {
      if (this.isSwimming) this.exitSwimming();
      return;
    }

    if (!this.isSwimming) {
      this.isSwimming = true;
      this.isGrounded = false;
      this.isJetpacking = false;
      if (this.isDodging || this.isBoostDashing) this.isInvulnerable = false;
      this.isDodging = false;
      this.isBoostDashing = false;
      this.dodgeTimer = 0;
      this.boostDashTimer = 0;
      this.cancelAirSmash();
      this.velocity.y = Math.min(this.velocity.y, 0);
      this.bus.emit(GameEvents.UI_MESSAGE, { text: "SWIMMING", duration: 1.1 });
    }
    this.stateMachine.changeState("swimming");
  }

  private exitSwimming(): void {
    this.isSwimming = false;
    if (!this.stateMachine.isInState("dead", "stunned")) {
      this.stateMachine.changeState(this.isMoving() ? "moving" : "idle");
    }
  }

  private updateSwimming(dt: number): void {
    const contact = this.getWaterContact();
    if (!contact) {
      this.exitSwimming();
      return;
    }

    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const right = this.camera.getDirection(BABYLON.Vector3.Right());
    forward.y = 0;
    right.y = 0;
    if (forward.lengthSquared() < 0.0001) forward.set(0, 0, 1);
    else forward.normalize();
    if (right.lengthSquared() < 0.0001) right.set(1, 0, 0);
    else right.normalize();

    const target = BABYLON.Vector3.Zero();
    const speed = this.isSprinting ? this.swimSprintSpeed : this.swimSpeed;
    if (this.keys["KeyW"]) target.addInPlace(forward.scale(speed));
    if (this.keys["KeyS"]) target.addInPlace(forward.scale(-speed * 0.75));
    if (this.keys["KeyA"]) target.addInPlace(right.scale(-speed));
    if (this.keys["KeyD"]) target.addInPlace(right.scale(speed));

    this.velocity.x = this.velocity.x * this.swimDrag + target.x * (1 - this.swimDrag);
    this.velocity.z = this.velocity.z * this.swimDrag + target.z * (1 - this.swimDrag);

    const wantsUp = this.keys["Space"];
    const wantsDown = this.keys["ControlLeft"] || this.keys["ControlRight"] || this.keys["ShiftRight"];
    if (wantsUp) {
      this.velocity.y += this.swimAscendSpeed;
    } else if (wantsDown) {
      this.velocity.y -= this.swimDiveSpeed;
    } else {
      const surfaceFloatY = contact.waterY + 0.35;
      const buoyancy = (surfaceFloatY - this.meshRoot.position.y) * 0.018;
      this.velocity.y = this.velocity.y * 0.82 + BABYLON.Scalar.Clamp(buoyancy, -0.035, 0.045);
    }
    this.velocity.y = BABYLON.Scalar.Clamp(this.velocity.y, -0.16, 0.18);

    const frameScale = BABYLON.Scalar.Clamp(dt * 60, 0.35, 1.8);
    this.meshRoot.position.addInPlace(this.velocity.scale(frameScale));

    const minBodyY = contact.groundY + 0.75;
    const maxBodyY = contact.waterY + 0.72;
    if (this.meshRoot.position.y < minBodyY) {
      this.meshRoot.position.y = minBodyY;
      this.velocity.y = Math.max(0, this.velocity.y);
    }
    if (this.meshRoot.position.y > maxBodyY) {
      this.meshRoot.position.y = maxBodyY;
      this.velocity.y = Math.min(0, this.velocity.y);
    }

    this.isGrounded = false;
    this.jumpCount = 0;
    this.airMomentumX = this.velocity.x;
    this.airMomentumZ = this.velocity.z;
    this.stateMachine.changeState("swimming");
  }

  /** Public accessor so the HUD can show a rocket-skate badge. */
  isRocketSkateMode(): boolean {
    return this.isRocketSkating;
  }

  private updateJetpack(dt: number): void {
    if (this.keys["Space"] && !this.isGrounded && this.jetpackFuel > 0 && !this.isDodging && !this.isFlying && !this.isSupermanFlight) {
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

    const groundY = this.getAnalyticalGroundY(
      this.meshRoot.position.x,
      this.meshRoot.position.z,
      this.meshRoot.position.y,
    ) ?? this.groundY;
    if (this.meshRoot.position.y < groundY + 1) {
      this.meshRoot.position.y = groundY + 1;
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

    // Spinning Downward Smash: while active, ignore gravity / fall multiplier
    // and slam straight down at terminal velocity. Horizontal momentum is
    // killed so the player drops on a true vertical line. The mode self-
    // cancels at the bottom of updatePhysics() once isGrounded flips true.
    if (this.isAirSmashing && !this.isGrounded) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      this.velocity.y = -1.4; // matches maxFallSpeed below
    }

    if (!this.isGrounded && !this.isJetpacking && !this.isAirSmashing) {
      // Asymmetric "fall multiplier" — classic platformer trick: gravity
      // is normal on the way up so jump height/feel is unchanged, but
      // ramps up by 2.2× while descending so the player doesn't float
      // back down. Disabled while flying / using rocket-skates so those
      // movement modes keep their tuned arcs.
      const fallMul = (this.velocity.y < 0 && !this.isFlying) ? 2.2 : 1.0;
      this.velocity.y -= this.gravity * fallMul;
    }

    // Wall slide: while airborne, falling, and stuck against a wall, cap the
    // descent speed so the player gently slides down instead of free-falling.
    const isWallSliding = !this.isGrounded && !this.isJetpacking && !this.isFlying &&
                          this.wallTouchTimer > 0 && this.velocity.y < 0;
    if (isWallSliding) {
      const wallSlideMaxFall = 0.08; // very gentle slide
      if (this.velocity.y < -wallSlideMaxFall) this.velocity.y = -wallSlideMaxFall;
    }

    // Raised from 0.8 → 1.4 so the new fall-multiplier actually has room
    // to express itself before clamping. Wall-slide already capped above.
    const maxFallSpeed = 1.4;
    if (this.velocity.y < -maxFallSpeed) {
      this.velocity.y = -maxFallSpeed;
    }

    this.meshRoot.position.addInPlace(this.velocity);
    this.resolveWallCollisions();

    let surfaceY = this.groundY;
    const analyticalGroundY = this.getAnalyticalGroundY(
      this.meshRoot.position.x,
      this.meshRoot.position.z,
      this.meshRoot.position.y,
    );
    if (analyticalGroundY != null) {
      surfaceY = analyticalGroundY;
    }
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
      if (analyticalGroundY != null && n === "ground") return false;
      return n === "ground" || n.startsWith("skyPlat_") || n.startsWith("bridge_seg") ||
        n.startsWith("step_") || n.startsWith("rooftop_") || n === "mainHighway" ||
        n === "crossHighway" || n === "spaceport" ||
        n.startsWith("extRamp") || n.startsWith("rt_seg") || n.startsWith("rt_ramp") ||
        n === "miTerrain" || n === "sanctuaryTerrain" ||
        // Nature ring: mountain cones (main peak, side ridges, snow cap) and
        // hidden-temple stepped pyramids are all stand-on / climbable.
        // Cones produce slanted surfaces, so the existing per-frame ray-down
        // check naturally lets the player walk up them at any angle.
        n.startsWith("mountain_") || n.startsWith("temple_tier_") ||
        n.startsWith("temple_cap_");
    });

    if (hit && hit.hit && hit.pickedPoint) {
      const platSurface = hit.pickedPoint.y;
      if (hit.pickedMesh?.name === "miTerrain" || hit.pickedMesh?.name === "sanctuaryTerrain") {
        // Heightmap / sanctuary terrain can dip below the default city
        // ground baseline, so it must be allowed to lower surfaceY.
        surfaceY = platSurface;
      } else if (platSurface > surfaceY) {
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

    // Smash-dive landed this frame — fire the callback so the system that
    // started the smash can spawn its shockwave + AoE damage. Clear state
    // first in case the callback re-enters the controller.
    if (this.isAirSmashing && this.isGrounded) {
      this.isAirSmashing = false;
      const cb = this.airSmashLandCb;
      this.airSmashLandCb = null;
      if (cb) {
        try { cb(); } catch (err) { console.warn("airSmash land callback failed", err); }
      }
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
      // Player visual is scaled down (visualScale 0.12), so the third-person
      // camera aims lower than the 1.7m first-person eye height and sits
      // closer to the ground — otherwise the player reads as a tiny dot at
      // the bottom of the screen.
      const thirdPersonTargetHeight = 0.9;
      const cameraDistance = 5.5;
      const cameraHeight = 1.1;

      const target = new BABYLON.Vector3(
        this.meshRoot.position.x,
        this.meshRoot.position.y + thirdPersonTargetHeight,
        this.meshRoot.position.z,
      );

      const desired = target
        .add(flatForward.scale(-cameraDistance))
        .add(new BABYLON.Vector3(0, cameraHeight, 0));

      desired.y = Math.max(desired.y, 0.4);
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
      // Cancel any in-flight smash dive: while mounted the controller's
      // updatePhysics() doesn't run, so the auto-clear-on-land path can
      // never fire and the player would warp out still flagged as
      // smashing. Drop the callback too so a stale onLand can't fire.
      this.cancelAirSmash();
      // Same reasoning for Superman flight — the per-frame branch is
      // skipped while mounted, so leaving the flag set would strand
      // the player in the mode after dismount.
      this.exitSupermanMode();
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

  teleportTo(pos: BABYLON.Vector3): void {
    this.meshRoot.position.copyFrom(pos);
    this.velocity.setAll(0);
    this.airMomentumX = 0;
    this.airMomentumZ = 0;
    this.isGrounded = false;
    this.isJetpacking = false;
    this.isFlying = false;
    this.isSupermanFlight = false;
    this.isSwimming = false;
    this.isDodging = false;
    this.isBoostDashing = false;
    this.dodgeTimer = 0;
    this.boostDashTimer = 0;
    this.cancelAirSmash();
    this.jumpCount = 0;
    this.meshRoot.rotation.x = 0;
    this.stateMachine.forceState("idle");
  }

  setTerrainHeightProvider(provider: TerrainHeightProvider | null): void {
    this.terrainHeightProvider = provider;
  }

  setWaterSurfaceProvider(provider: WaterSurfaceProvider | null): void {
    this.waterSurfaceProvider = provider;
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

    // Armor Mod: Aegis Plating — flat percent damage reduction applied
    // before shield/armor absorption so it stacks multiplicatively with
    // the existing 70%-armor-absorb pipeline. Capped at 30% inside
    // getPlayerBoosts() to keep the player from going invincible.
    const drLvl = this.playerUpgradeLevels["damageReduction"] ?? 0;
    const totalReduction = Math.min(0.45, Math.min(0.30, 0.03 * drLvl) + this.petBondBoosts.damageReduction);
    if (totalReduction > 0) amount *= (1 - totalReduction);

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
    // Restore dash charges to the upgraded cap and clear the regen clock
    // so a respawned player isn't punished for whatever dash state they
    // died in (e.g. died with 0 charges and 0.4 s left on the regen).
    this.dashCharges = this.maxDashCharges;
    this.boostDashCooldownTimer = 0;
    this.boostDashTimer = 0;
    this.lastBoostDashAt = 0;
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
      // Armor-mod baselines: damage and fire-rate boosts are pure
      // multipliers added on top of 1.0; damage reduction reduces incoming
      // damage; stamina boost stacks on top of the default 100 max.
      case "damageBoost": return 0;
      case "fireRateBoost": return 0;
      case "damageReduction": return 0;
      case "staminaBoost": return 0;
      // Dash Capacitor: baseline is 1 charge (the default single dash);
      // each level adds +1 (Double Dash → Triple Dash).
      case "dashCharges": return 1;
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
      case "staminaBoost": {
        // staminaBoost is +15 per level — `value` is the cumulative bonus
        // (baseAmount * level), so the new cap is (100 + value). Top up the
        // current stamina pool by the *delta* in cap so each level adds 15
        // (not the cumulative total) when bought, and so initial recompute
        // on load doesn't over-heal a freshly-spawned player.
        const newMax = 100 + value;
        const delta = Math.max(0, newMax - this.stats.maxStamina);
        this.stats.maxStamina = newMax;
        if (delta > 0) {
          this.stats.stamina = Math.min(newMax, this.stats.stamina + delta);
        } else if (this.stats.stamina > newMax) {
          this.stats.stamina = newMax;
        }
        break;
      }
      // damageBoost / fireRateBoost / damageReduction don't write to a stat
      // field — they're consumed via getPlayerBoosts() / takeDamage(). No-op.
      case "damageBoost":
      case "fireRateBoost":
      case "damageReduction":
        break;
      case "dashCharges": {
        // Bump the cap and top off the player's available charges by the
        // delta so buying the upgrade mid-fight grants the new charge
        // immediately instead of waiting for the regen cycle.
        const newMax = Math.max(1, Math.floor(value));
        const delta = newMax - this.maxDashCharges;
        this.maxDashCharges = newMax;
        if (delta > 0) {
          this.dashCharges = Math.min(newMax, this.dashCharges + delta);
        } else if (this.dashCharges > newMax) {
          this.dashCharges = newMax;
        }
        break;
      }
    }
  }

  /** Snapshot of the player's armor-mod multipliers for WeaponsSystem to
   *  consume. damageMul / fireRateMul are >= 1; damageReduction is in [0, 0.3]
   *  and is applied directly inside takeDamage(). */
  getPlayerBoosts(): { damageMul: number; fireRateMul: number; damageReduction: number } {
    const dmgLvl = this.playerUpgradeLevels["damageBoost"] ?? 0;
    const frLvl = this.playerUpgradeLevels["fireRateBoost"] ?? 0;
    const drLvl = this.playerUpgradeLevels["damageReduction"] ?? 0;
    return {
      damageMul: (1 + 0.05 * dmgLvl) * this.petBondBoosts.damageMul,
      fireRateMul: (1 + 0.04 * frLvl) * this.petBondBoosts.fireRateMul,
      damageReduction: Math.min(0.45, Math.min(0.30, 0.03 * drLvl) + this.petBondBoosts.damageReduction),
    };
  }

  setPetBondBoosts(boosts: { damageMul: number; fireRateMul: number; damageReduction: number }): void {
    this.petBondBoosts.damageMul = Math.max(1, boosts.damageMul || 1);
    this.petBondBoosts.fireRateMul = Math.max(1, boosts.fireRateMul || 1);
    this.petBondBoosts.damageReduction = Math.max(0, Math.min(0.15, boosts.damageReduction || 0));
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

  /** Hard cap on the player's level. +10 maxHP / +5 stamina per level
   *  with attack-damage scaling via getLevelDamageMul means level 100
   *  gives +990 maxHP, +495 stamina, and +99% projectile damage on top
   *  of every other multiplier — comfortably "endgame" without breaking
   *  the elite/captain HP curve. */
  static readonly MAX_LEVEL = 100;

  addExperience(amount: number): void {
    if (this.stats.level >= PlayerController.MAX_LEVEL) return;
    this.stats.experience += amount;
    // Loop so a single huge XP grant (e.g. boss-clear bonus) can level
    // up multiple times — but stop at MAX_LEVEL so the cap is hard.
    while (
      this.stats.level < PlayerController.MAX_LEVEL &&
      this.stats.experience >= this.stats.level * 100
    ) {
      const expNeeded = this.stats.level * 100;
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
    // At cap, drain residual XP so the bar reads "MAX" and a future
    // overflow can't roll the integer.
    if (this.stats.level >= PlayerController.MAX_LEVEL) {
      this.stats.experience = 0;
    }
  }

  /** Per-level attack-damage multiplier exposed for WeaponsSystem.
   *  Linear +1% per level over level 1 → +99% at level 100. Combat
   *  systems (WeaponsSystem.createProjectile, melee paths) read this
   *  on every hit so it stacks with armor damage mods + jewels. */
  getLevelDamageMul(): number {
    return 1 + (Math.max(1, this.stats.level) - 1) * 0.01;
  }

  grantFlightArmor(): void {
    this.hasFlightArmor = true;
    console.log("[PlayerController] Flight armor acquired! Triple-jump flight enabled. Press X to toggle flight.");
    this.bus.emit(GameEvents.PLAYER_FLIGHT_ARMOR_ACQUIRED);
  }

  /** Premium SPECIALS unlock — enables the KeyL + Space airborne combo
   *  that toggles Superman flight. Idempotent. */
  unlockSupermanFlight(): void {
    if (this.hasSupermanFlight) return;
    this.hasSupermanFlight = true;
    console.log("[PlayerController] Superman Flight unlocked. Hold dash + jump while airborne to enter, hold Space to boost.");
  }
  getHasSupermanFlight(): boolean { return this.hasSupermanFlight; }
  getIsSupermanFlight(): boolean { return this.isSupermanFlight; }

  private toggleSupermanMode(): void {
    if (this.isSupermanFlight) {
      this.exitSupermanMode();
    } else {
      this.enterSupermanMode();
    }
  }
  private enterSupermanMode(): void {
    if (this.isSupermanFlight || this.isGrounded || this.mountedVehicleRoot) return;
    this.isSupermanFlight = true;
    // Cancel competing aerial states so updateSuperman owns velocity.
    this.isJetpacking = false;
    this.isDodging = false;
    this.isBoostDashing = false;
    this.cancelAirSmash();
    this.velocity.setAll(0);
    this.supermanBoostMul = 1;
    this.stateMachine.changeState("flying");
    this.bus.emit(GameEvents.UI_MESSAGE, { text: "SUPERMAN FLIGHT ENGAGED", duration: 1.4 });
  }
  private exitSupermanMode(): void {
    if (!this.isSupermanFlight) return;
    this.isSupermanFlight = false;
    this.supermanBoostMul = 1;
    // Restore upright posture so the next ground frame doesn't render
    // the player still pitched forward.
    if (this.meshRoot) this.meshRoot.rotation.x = 0;
    this.stateMachine.changeState("idle");
  }

  /** Free-flight mode that mirrors `updateFlight()` but skips the
   *  armor-energy drain and adds a held-Space boost. Camera-relative
   *  WASD with full pitch (so looking down dives, looking up climbs).
   *  Lands on contact with the ground plane. */
  private updateSuperman(dt: number): void {
    // Boost ramps in/out smoothly while Space is held (Space alone in
    // this mode means "go faster" — the entry combo is a one-shot
    // toggle, not a hold). The ramp avoids a jarring jolt at boost
    // start and a hard stop on release.
    const wantBoost = !!this.keys["Space"];
    const boostTarget = wantBoost ? this.supermanBoostSpeed / this.supermanCruiseSpeed : 1;
    const ease = Math.min(1, dt * 6);
    this.supermanBoostMul += (boostTarget - this.supermanBoostMul) * ease;

    // Full-pitch camera vectors so the player can dive / climb by
    // looking, just like the space-fighter flight loop.
    const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
    const right = this.camera.getDirection(BABYLON.Vector3.Right());
    forward.normalize();
    right.normalize();
    right.y = 0; right.normalize();

    const cruise = this.supermanCruiseSpeed * this.supermanBoostMul;
    let moveDir = BABYLON.Vector3.Zero();
    if (this.keys["KeyW"]) moveDir.addInPlace(forward.scale(cruise));
    if (this.keys["KeyS"]) moveDir.addInPlace(forward.scale(-cruise));
    if (this.keys["KeyA"]) moveDir.addInPlace(right.scale(-cruise));
    if (this.keys["KeyD"]) moveDir.addInPlace(right.scale(cruise));
    if (this.keys["ControlLeft"] || this.keys["ControlRight"] || this.keys["ShiftRight"]) {
      moveDir.y -= this.supermanDescendSpeed;
    }

    const damping = 0.82;
    this.velocity.x = this.velocity.x * damping + moveDir.x * (1 - damping);
    this.velocity.y = this.velocity.y * damping + moveDir.y * (1 - damping);
    this.velocity.z = this.velocity.z * damping + moveDir.z * (1 - damping);

    this.meshRoot.position.addInPlace(this.velocity);

    // Mesh pitches forward like a flying cape silhouette. Yaw still
    // tracks the camera via the standard updateMovement-style yaw
    // applied below.
    const horiz = Math.hypot(this.velocity.x, this.velocity.z);
    if (horiz > 0.05) {
      const yaw = Math.atan2(this.velocity.x, this.velocity.z);
      this.meshRoot.rotation.y = yaw;
    }
    this.meshRoot.rotation.x = -0.55;

    // Land cancels the mode and restores upright posture.
    const groundY = this.getAnalyticalGroundY(
      this.meshRoot.position.x,
      this.meshRoot.position.z,
      this.meshRoot.position.y,
    ) ?? this.groundY;
    if (this.meshRoot.position.y < groundY + 1) {
      this.meshRoot.position.y = groundY + 1;
      this.velocity.y = 0;
      this.isGrounded = true;
      this.jumpCount = 0;
      this.exitSupermanMode();
      return;
    }

    this.stateMachine.changeState(horiz > 0.05 ? "flying" : "hovering");
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

    if (this.isSwimming) return "flyingHover";
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

  getHealth(): number {
    return this.stats.health;
  }

  getPosition(): BABYLON.Vector3 {
    return this.meshRoot.position.clone();
  }

  copyPositionToRef(ref: BABYLON.Vector3): BABYLON.Vector3 {
    return ref.copyFrom(this.meshRoot.position);
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

  /** True only when the capsule is resting on a surface this frame. */
  getIsGrounded(): boolean {
    return this.isGrounded;
  }

  /** Used by SmashAttackSystem to gate charge-start (no smash while
   *  jetpacking or in DBZ free-flight — those modes own velocity.y). */
  getIsJetpacking(): boolean {
    return this.isJetpacking;
  }

  getIsSwimming(): boolean {
    return this.isSwimming;
  }

  /** True if the player is currently mid-smash. Lets external systems
   *  (e.g. SmashAttackSystem) know they should keep ticking damage. */
  getIsAirSmashing(): boolean {
    return this.isAirSmashing;
  }

  /** Begin a downward smash. Returns true if the request was accepted.
   *  Rejected when the player is already grounded, jetpacking, in
   *  free-flight, dodging, or already smashing. The callback fires
   *  exactly once when the player touches a surface again. */
  startAirSmash(onLand: () => void): boolean {
    if (this.isGrounded || this.isJetpacking || this.isFlying || this.isDodging || this.isAirSmashing) {
      return false;
    }
    this.isAirSmashing = true;
    this.airSmashLandCb = onLand;
    // Kill any residual horizontal momentum immediately so the dive reads
    // as a pure straight-down plunge from frame one.
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.velocity.y = -1.4;
    return true;
  }

  /** Force-cancel an in-flight smash dive without firing the land
   *  callback. Used by mount / fast-travel transitions where the dive
   *  would otherwise be stranded (updatePhysics doesn't run while the
   *  player is mounted, and the new world's ground plane doesn't carry
   *  the dive's intent). */
  cancelAirSmash(): void {
    this.isAirSmashing = false;
    this.airSmashLandCb = null;
  }

  /** Visual-only spin: the calling system rotates the player mesh once per
   *  frame for the cosmetic spinning-blade look. Bypasses the yaw lock
   *  used by the normal locomotion path because that lock only runs while
   *  the player is moving on the ground. */
  applySmashSpin(angleDelta: number): void {
    this.mesh.rotation.y += angleDelta;
  }

  setMeleeCallbacks(light: () => void, heavy: () => void): void {
    this.onMeleeAttack = light;
    this.onHeavyMeleeAttack = heavy;
  }

  /**
   * GHOST RIDE bail-out. Called by Game.tsx the same frame the player
   * triggers Ghost Ride (VehicleSystem.startGhostRide). Pops the player
   * off the vehicle's transform, plants them in the world at their
   * last-known mounted position, and applies a side+up shove velocity
   * so they somersault clear of the now-driverless ride. We piggyback
   * on the existing dodgeRoll animation (mapPlayerStateToAnimation
   * already maps `isDodging → "dodgeRoll"`) so the bail visual is the
   * same somersault used everywhere else — no new animation state.
   *
   * The dodge timer is bumped to ~0.7s (vs the standard 0.3s) so the
   * roll plays through the airborne arc, and `isInvulnerable` stays on
   * for the whole duration so the player can't get clipped by their
   * own ghost-ride shockwave or by an enemy attack mid-bail.
   */
  triggerSomersaultEject(velocity: BABYLON.Vector3): void {
    // The caller (Game.tsx) has ALREADY done setMounted(null), so the
    // mount fields are clear and updatePhysics() is back online. We
    // just need to plant the velocity + arm the dodge animation gate.
    this.velocity.x = velocity.x;
    this.velocity.y = velocity.y;
    this.velocity.z = velocity.z;
    this.isGrounded = false;
    this.isFlying = false;
    this.isJetpacking = false;
    this.isBoostDashing = false;
    this.isAirSmashing = false;

    // Mirror startDodge's invulnerability window, but DON'T touch
    // dodgeDirection/dodgeSpeed — those drive the per-frame `addInPlace`
    // shove inside updatePhysics, and we want the natural ballistic
    // arc from `velocity` to take over instead.
    this.isDodging = true;
    this.dodgeTimer = 0.7;
    this.isInvulnerable = true;
    this.dodgeCooldownTimer = this.dodgeCooldown;
    this.dodgeDirection = BABYLON.Vector3.Zero();
    this.dodgeSpeed = 0;
    this.stateMachine.changeState("dodging");
    this.bus.emit(GameEvents.PLAYER_DODGE);
  }
}
