import * as BABYLON from "@babylonjs/core";
import { EventBus } from "./EventBus";
import { PlayerController } from "./PlayerController";
import { EnemySystem } from "./EnemySystem";
import { AerialEnemySystem } from "./AerialEnemySystem";
import { DamageType } from "./DamageSystem";

/**
 * Spinning Downward Smash.
 *
 * Input: hold the beam-sabre key (KeyJ — gamepad LT in foot context) for
 * `CHARGE_SECONDS` while the player is airborne. On trigger, the player
 * is locked into a fast pure-down dive (PlayerController.startAirSmash),
 * spins visually, deals chip damage to enemies they pass through, and on
 * landing detonates a large circular shockwave (existing ExplosionSystem
 * "large" tier) that AoE-damages every ground + aerial enemy inside
 * `LANDING_RADIUS`.
 *
 * Cooldown prevents key-mashing the smash. Charge cancels if the player
 * touches the ground, releases the key, mounts a vehicle, or starts the
 * DBZ free-flight / jetpack modes (PlayerController gates entry on those).
 */
export class SmashAttackSystem {
  private static readonly CHARGE_SECONDS = 1.0;
  private static readonly DESCENT_DAMAGE_RADIUS = 2.6;
  private static readonly DESCENT_DAMAGE = 25;
  private static readonly LANDING_RADIUS = 9.0;
  private static readonly LANDING_DAMAGE = 140;
  private static readonly COOLDOWN_SECONDS = 1.5;

  private player: PlayerController;
  private enemySystem: EnemySystem;
  private aerialEnemySystem: AerialEnemySystem;
  private bus: EventBus;

  private keyHeld: boolean = false;
  private charging: boolean = false;
  private chargeElapsed: number = 0;
  private smashing: boolean = false;
  private cooldown: number = 0;
  // True if the most recent KeyJ press was claimed by the smash (i.e. the
  // player was airborne and not on cooldown). Game.tsx reads this on the
  // matching keyup so it can skip the beam-sabre release that would
  // otherwise fire alongside the smash.
  private claimedLastPress: boolean = false;

  // Per-smash set of enemy ids hit on the way down so a single dive can't
  // re-tick the same enemy every frame.
  private descentHitGround: Set<number> = new Set();
  private descentHitAerial: Set<number> = new Set();

  constructor(
    player: PlayerController,
    enemySystem: EnemySystem,
    aerialEnemySystem: AerialEnemySystem,
    bus: EventBus,
  ) {
    this.player = player;
    this.enemySystem = enemySystem;
    this.aerialEnemySystem = aerialEnemySystem;
    this.bus = bus;
  }

  /** Called from the keyboard handler on KeyJ down (gamepad LT foot).
   *  Game.tsx is responsible for only routing the press here when the
   *  player is airborne (so the beam-sabre still owns ground presses).
   *  We still re-validate so a race / stale call doesn't mis-trigger. */
  notifyKeyDown(): void {
    this.claimedLastPress = false;
    if (this.keyHeld) return; // ignore key-repeat
    this.keyHeld = true;
    if (this.smashing || this.cooldown > 0) return;
    if (this.player.getIsGrounded() || this.player.getIsJetpacking()) return;
    this.charging = true;
    this.chargeElapsed = 0;
    this.claimedLastPress = true;
  }

  /** Called from the keyboard handler on KeyJ up. */
  notifyKeyUp(): void {
    this.keyHeld = false;
    // Releasing the key before the threshold cancels the pending smash.
    // A smash that's already in flight keeps going — once committed, the
    // player can't bail out.
    if (this.charging) {
      this.charging = false;
      this.chargeElapsed = 0;
    }
  }

  /** True if the most recent press was routed into the smash (used by
   *  Game.tsx to suppress the matching beam-sabre release). Read once
   *  per keyup. */
  consumedLastPress(): boolean {
    const v = this.claimedLastPress;
    this.claimedLastPress = false;
    return v;
  }

  update(dt: number): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.charging) {
      // Cancel if the player landed before the threshold (the "in air"
      // requirement only matters at trigger time, but landing during the
      // wind-up should obviously void the move).
      if (this.player.getIsGrounded() || this.player.getIsJetpacking()) {
        this.charging = false;
        this.chargeElapsed = 0;
      } else {
        this.chargeElapsed += dt;
        if (this.chargeElapsed >= SmashAttackSystem.CHARGE_SECONDS) {
          this.charging = false;
          this.chargeElapsed = 0;
          this.tryStartSmash();
        }
      }
    }

    if (this.smashing) {
      // Visual: spin the player mesh fast around its yaw.
      this.player.applySmashSpin(dt * 18); // ~1030°/sec
      // Tick descent damage. Small radius around the falling player so
      // anything they punch through takes chip damage.
      this.tickDescentDamage();
      // Player.startAirSmash already wired its land callback to onLand();
      // so we just watch the flag and clean up here when it flips off.
      if (!this.player.getIsAirSmashing()) {
        this.smashing = false;
        this.cooldown = SmashAttackSystem.COOLDOWN_SECONDS;
        this.descentHitGround.clear();
        this.descentHitAerial.clear();
      }
    }
  }

  private tryStartSmash(): void {
    const ok = this.player.startAirSmash(() => this.onLand());
    if (!ok) return;
    this.smashing = true;
    this.descentHitGround.clear();
    this.descentHitAerial.clear();
    // Wind-up cue.
    this.bus.emit("sound:play", { url: "/sounds/hit.mp3", volume: 0.7, playbackRate: 0.6 });
    this.bus.emit("ui:message", { text: "SMASH DIVE!", duration: 900 });
  }

  private tickDescentDamage(): void {
    const pp = this.player.getPosition();
    const r = SmashAttackSystem.DESCENT_DAMAGE_RADIUS;
    const rSq = r * r;

    const ground = this.enemySystem.getEnemyMeshes();
    for (let i = 0; i < ground.length; i++) {
      const mesh = ground[i];
      if (this.descentHitGround.has(mesh.uniqueId)) continue;
      const dx = mesh.position.x - pp.x;
      const dy = mesh.position.y - pp.y;
      const dz = mesh.position.z - pp.z;
      if (dx * dx + dy * dy + dz * dz > rSq) continue;
      const meta: any = mesh.metadata;
      if (meta && meta.damageable && typeof meta.damageable.takeDamage === "function") {
        meta.damageable.takeDamage({
          amount: SmashAttackSystem.DESCENT_DAMAGE,
          damageType: DamageType.Melee,
          hitPoint: mesh.position.clone(),
          attacker: this.player,
          knockbackForce: 60,
        });
      }
      this.descentHitGround.add(mesh.uniqueId);
    }

    const aerial = this.aerialEnemySystem.getActiveUnits();
    for (let i = 0; i < aerial.length; i++) {
      const u = aerial[i];
      if (!u.isAlive) continue;
      const id = u.hitbox.uniqueId;
      if (this.descentHitAerial.has(id)) continue;
      const dx = u.hitbox.position.x - pp.x;
      const dy = u.hitbox.position.y - pp.y;
      const dz = u.hitbox.position.z - pp.z;
      if (dx * dx + dy * dy + dz * dz > rSq) continue;
      u.takeDamage(SmashAttackSystem.DESCENT_DAMAGE, u.hitbox.position.clone());
      this.descentHitAerial.add(id);
    }
  }

  private onLand(): void {
    const pp = this.player.getPosition();
    // Spawn the visual shockwave through the unified ExplosionSystem so
    // it pools / reuses meshes and the ground ring renders the same as
    // every other "large" detonation in the game.
    this.bus.emit("effect:explosion", {
      position: new BABYLON.Vector3(pp.x, Math.max(0.1, pp.y - 0.5), pp.z),
      tier: "large",
      radius: SmashAttackSystem.LANDING_RADIUS,
      color: new BABYLON.Color3(0.55, 0.85, 1.0), // cyan smash-shock palette
      shake: 0.45,
      shockwave: true,
    });
    this.bus.emit("effect:cameraShake", { intensity: 0.5, duration: 0.35 });
    this.bus.emit("sound:play", { url: "/sounds/hit.mp3", volume: 1.0, playbackRate: 0.7 });

    // AoE damage with linear falloff to the edge of the shockwave.
    const r = SmashAttackSystem.LANDING_RADIUS;
    const rSq = r * r;

    const ground = this.enemySystem.getEnemyMeshes();
    for (let i = 0; i < ground.length; i++) {
      const mesh = ground[i];
      const dx = mesh.position.x - pp.x;
      const dy = mesh.position.y - pp.y;
      const dz = mesh.position.z - pp.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > rSq) continue;
      const meta: any = mesh.metadata;
      if (!(meta && meta.damageable && typeof meta.damageable.takeDamage === "function")) continue;
      const falloff = Math.max(0.35, 1 - Math.sqrt(dSq) / r);
      meta.damageable.takeDamage({
        amount: SmashAttackSystem.LANDING_DAMAGE * falloff,
        damageType: DamageType.Explosive,
        hitPoint: mesh.position.clone(),
        attacker: this.player,
        knockbackForce: 240,
      });
    }

    const aerial = this.aerialEnemySystem.getActiveUnits();
    for (let i = 0; i < aerial.length; i++) {
      const u = aerial[i];
      if (!u.isAlive) continue;
      // Aerial radius is generous because the shockwave is a ground ring;
      // anything within ~12 m vertical is still in the blast column.
      const dx = u.hitbox.position.x - pp.x;
      const dy = u.hitbox.position.y - pp.y;
      const dz = u.hitbox.position.z - pp.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > rSq * 1.6) continue;
      const falloff = Math.max(0.3, 1 - Math.sqrt(dSq) / (r * 1.3));
      u.takeDamage(SmashAttackSystem.LANDING_DAMAGE * 0.7 * falloff, u.hitbox.position.clone());
    }
  }

  dispose(): void {
    this.charging = false;
    this.smashing = false;
    this.keyHeld = false;
    this.descentHitGround.clear();
    this.descentHitAerial.clear();
  }
}
