import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import type { EnemyLike } from "./EnemyHealthBarSystem";
import type { PickupSpawnRequest } from "./PickupSystem";
import { HumanoidCharacter } from "./HumanoidCharacter";
import { HUMANOID_PRESETS } from "./HumanoidPresets";

interface BaseTurret extends EnemyLike {
  hitbox: BABYLON.Mesh;
  visual: BABYLON.TransformNode;
  emissives: BABYLON.StandardMaterial[];
  ownedMaterials: BABYLON.Material[];
  fireCooldown: number;
  shakeTimer: number;
  lastHitFxAt: number;
  baseId: number;
}

interface LootVault {
  baseId: number;
  hitbox: BABYLON.Mesh;
  visual: BABYLON.TransformNode;
  emissives: BABYLON.StandardMaterial[];
  ownedMaterials: BABYLON.Material[];
  hp: number;
  maxHp: number;
  armed: boolean;
  alive: boolean;
  shakeTimer: number;
  lastHitFxAt: number;
  position: BABYLON.Vector3;
}

interface EnemyBase {
  id: number;
  position: BABYLON.Vector3;
  turrets: BaseTurret[];
  vault: LootVault;
  centerPillar: BABYLON.TransformNode;
  ownedMaterials: BABYLON.Material[];

  // ---- Boss-fortress only fields ----
  /** Marks this base as the giant boss-fortress variant — triggers the
   *  extra event broadcasts (turrets cleared, fortress cleared). */
  isBoss?: boolean;
  /** True after BOSS_FORTRESS_TURRETS_CLEARED has fired so we don't re-emit. */
  bossTurretsClearedFired?: boolean;
  /** Captured ally humanoid sitting inside the central spire. */
  allyRoot?: BABYLON.TransformNode;
  /** Halo mesh that activates once the ally is freed. */
  allyHalo?: BABYLON.Mesh;
  /** Toggled true when the spire breaks and the ally is rescued. */
  allyFreed?: boolean;
}

interface BaseTracer {
  mesh: BABYLON.Mesh;
  ttl: number;
}

const VAULT_LOOT: PickupSpawnRequest[] = [
  { type: "gear", amount: 10 },
  { type: "energy_core", amount: 5 },
  { type: "circuit_board", amount: 5 },
  { type: "nano_fiber", amount: 3 },
  { type: "weapon_part", amount: 2, weaponId: "rocket" },
  { type: "weapon_part", amount: 1, weaponId: "laser" },
];

export class EnemyBaseSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private bases: EnemyBase[] = [];
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private tracers: BaseTracer[] = [];
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private idCounter = 0;
  private damageOut: number = 0;
  /** Pending setTimeout IDs (e.g. delayed boss telegraph UI messages).
   *  Tracked here so dispose() can clear them — otherwise a scene restart
   *  could fire a stale "FIRE AT THE GLOWING RED CORE" message into the
   *  wrong session. */
  private pendingTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();
  /** Optional callback fired during base/turret/vault creation so the
   *  LODCullSystem can register the heavy visual nodes for distance
   *  culling. We pass the visual TransformNode (parent of all walls /
   *  spire / turret stand+head meshes) plus a recommended cull radius.
   *  Hitbox meshes are intentionally NOT registered — they're invisible,
   *  free to render, and used by weapons aim resolution. */
  private cullRegistrar: ((node: BABYLON.TransformNode, radius: number) => void) | null = null;
  setCullRegistrar(fn: (node: BABYLON.TransformNode, radius: number) => void): void {
    this.cullRegistrar = fn;
  }

  static readonly TURRET_RANGE = 60;
  static readonly TURRET_HP = 250;
  static readonly TURRET_DAMAGE = 14;
  static readonly TURRET_FIRE_INTERVAL = 1.6;
  static readonly VAULT_HP = 320;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.bus = EventBus.getInstance();

    this.observer = this.scene.onBeforeRenderObservable.add(() => {
      // tracers tick on every render
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      this.tickTracers(dt);
    });

    console.log("[EnemyBaseSystem] Initialized");
  }

  setPlayerPosition(pos: BABYLON.Vector3): void {
    this.playerPos.copyFrom(pos);
  }

  /** Called from main loop. Returns total damage to apply to player this frame. */
  update(dt: number): { damage: number } {
    this.damageOut = 0;
    for (const base of this.bases) {
      for (const t of base.turrets) {
        if (!t.isAlive) continue;
        if (t.shakeTimer > 0) {
          t.shakeTimer -= dt;
          const k = Math.max(0, t.shakeTimer / 0.18);
          t.visual.position.x = t.hitbox.position.x + (Math.random() - 0.5) * 0.15 * k;
          t.visual.position.z = t.hitbox.position.z + (Math.random() - 0.5) * 0.15 * k;
        } else {
          t.visual.position.x = t.hitbox.position.x;
          t.visual.position.z = t.hitbox.position.z;
        }

        const dx = this.playerPos.x - t.hitbox.position.x;
        const dz = this.playerPos.z - t.hitbox.position.z;
        const distSq = dx * dx + dz * dz;
        const range = EnemyBaseSystem.TURRET_RANGE;
        if (distSq > range * range) continue;

        // Aim turret yaw
        const yaw = Math.atan2(dx, dz);
        t.visual.rotation.y = yaw;

        t.fireCooldown -= dt;
        if (t.fireCooldown <= 0) {
          t.fireCooldown = EnemyBaseSystem.TURRET_FIRE_INTERVAL + Math.random() * 0.4;
          this.fireTurret(t);
        }
      }
    }
    return { damage: this.damageOut };
  }

  private fireTurret(t: BaseTurret): void {
    const from = t.hitbox.position.clone();
    from.y += 1.4;
    const to = this.playerPos.clone();
    to.y += 1.0;
    const dir = to.subtract(from);
    const len = dir.length();
    if (len < 0.001) return;
    const tracer = BABYLON.MeshBuilder.CreateCylinder(`turretTracer_${this.idCounter++}`, { height: len, diameter: 0.16, tessellation: 6 }, this.scene);
    const mat = new BABYLON.StandardMaterial(`turretTracerMat_${this.idCounter}`, this.scene);
    mat.diffuseColor = new BABYLON.Color3(1, 0.4, 0.3);
    mat.emissiveColor = new BABYLON.Color3(1, 0.4, 0.3);
    mat.disableLighting = true;
    tracer.material = mat;
    tracer.position = from.add(dir.scale(0.5));
    const dirN = dir.normalize();
    const axis = BABYLON.Vector3.Cross(BABYLON.Axis.Y, dirN);
    const dot = Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(BABYLON.Axis.Y, dirN)));
    const angle = Math.acos(dot);
    if (axis.lengthSquared() > 0.0001) {
      tracer.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis.normalize(), angle);
    } else if (dot < 0) {
      // Pointing straight down: 180-degree flip around X
      tracer.rotationQuaternion = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, Math.PI);
    }
    this.tracers.push({ mesh: tracer, ttl: 0.12 });

    // ~75% accuracy when in range
    if (Math.random() < 0.75) {
      this.damageOut += EnemyBaseSystem.TURRET_DAMAGE;
    }
  }

  private tickTracers(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.ttl -= dt;
      if (t.ttl <= 0) {
        t.mesh.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  /** Returns true if the mesh was a turret/vault and damage was applied */
  damageStructure(mesh: BABYLON.AbstractMesh, damage: number): boolean {
    // Turret hit?
    for (const base of this.bases) {
      for (const t of base.turrets) {
        if (t.hitbox === mesh) {
          if (!t.isAlive) return true;
          this.damageTurret(t, damage);
          return true;
        }
      }
      if (base.vault.hitbox === mesh) {
        if (!base.vault.alive) return true;
        // Vault is invulnerable until armed (turrets all dead)
        if (!base.vault.armed) {
          this.bus.emit("effect:hitImpact", {
            position: base.vault.position.clone().add(new BABYLON.Vector3(0, 1.4, 0)),
            color: new BABYLON.Color3(0.4, 0.5, 1.0),
            scale: 0.6,
          });
          return true;
        }
        this.damageVault(base, damage);
        return true;
      }
    }
    return false;
  }

  private damageTurret(t: BaseTurret, damage: number): void {
    t.health = Math.max(0, t.health - damage);
    t.shakeTimer = 0.18;
    const now = performance.now();
    if (now - t.lastHitFxAt > 80) {
      t.lastHitFxAt = now;
      this.bus.emit("effect:hitImpact", {
        position: t.hitbox.position.clone().add(new BABYLON.Vector3(0, 1.0, 0)),
        color: new BABYLON.Color3(1, 0.3, 0.3),
        scale: 1.0,
      });
    }
    const origs = t.emissives.map(m => m.emissiveColor.clone());
    for (const m of t.emissives) m.emissiveColor = new BABYLON.Color3(1, 0.1, 0.1);
    setTimeout(() => {
      for (let i = 0; i < t.emissives.length; i++) {
        if (t.emissives[i]) t.emissives[i].emissiveColor = origs[i];
      }
    }, 160);

    if (t.health <= 0) this.killTurret(t);
  }

  private killTurret(t: BaseTurret): void {
    t.isAlive = false;
    t.visual.setEnabled(false);
    this.bus.emit("effect:hitImpact", {
      position: t.hitbox.position.clone().add(new BABYLON.Vector3(0, 1.4, 0)),
      color: new BABYLON.Color3(1, 0.55, 0.2),
      scale: 2.0,
    });
    // Small loot for clearing turrets
    this.bus.emit(GameEvents.PICKUP_SPAWNED, {
      position: t.hitbox.position.clone(),
      requests: [{ type: "scrap_metal", amount: 3 }, { type: "circuit_board", amount: 1 }],
      spread: 1.2,
    });
    this.bus.emit(GameEvents.ENEMY_KILLED, {
      type: "turret",
      credits: 35,
      experience: 25,
      position: t.hitbox.position.clone(),
    });
    // Check if base is now armed
    const base = this.bases.find(b => b.id === t.baseId);
    if (base) this.checkArmVault(base);
  }

  private checkArmVault(base: EnemyBase): void {
    if (base.vault.armed) return;
    if (base.turrets.every(t => !t.isAlive)) {
      base.vault.armed = true;
      // Switch vault to gold emissive
      const gold = new BABYLON.Color3(1.0, 0.78, 0.25);
      for (const m of base.vault.emissives) m.emissiveColor = gold;
      this.bus.emit("effect:hitImpact", {
        position: base.vault.position.clone().add(new BABYLON.Vector3(0, 2, 0)),
        color: gold,
        scale: 3.0,
      });

      // Boss fortress: this is the cue to spawn the BossCaptain.
      if (base.isBoss && !base.bossTurretsClearedFired) {
        base.bossTurretsClearedFired = true;
        const spawnPos = base.position.clone();
        spawnPos.y = 1.5;
        // Drop the captain in front of the spire so the player can engage him.
        spawnPos.z += 8;
        this.bus.emit(GameEvents.BOSS_FORTRESS_TURRETS_CLEARED, {
          baseId: base.id,
          spirePosition: base.position.clone(),
          captainSpawnPosition: spawnPos,
        });
        this.bus.emit(GameEvents.UI_MESSAGE, {
          text: "FORTRESS DEFENSES DOWN — BOSS CAPTAIN INCOMING",
          duration: 4000,
        });
        // Second message a beat later so the player knows what to actually
        // shoot. Without this many players don't realize the glowing red
        // core on the spire is the kill target. Tracked so dispose() can
        // cancel it if the scene tears down before it fires.
        const handle = setTimeout(() => {
          this.pendingTimeouts.delete(handle);
          this.bus.emit(GameEvents.UI_MESSAGE, {
            text: "FIRE AT THE GLOWING RED CORE — SPIRE VULNERABLE",
            duration: 5000,
          });
        }, 4200);
        this.pendingTimeouts.add(handle);
      }
    }
  }

  private damageVault(base: EnemyBase, damage: number): void {
    base.vault.hp = Math.max(0, base.vault.hp - damage);
    base.vault.shakeTimer = 0.18;
    const now = performance.now();
    if (now - base.vault.lastHitFxAt > 80) {
      base.vault.lastHitFxAt = now;
      this.bus.emit("effect:hitImpact", {
        position: base.vault.position.clone().add(new BABYLON.Vector3(0, 1.6, 0)),
        color: new BABYLON.Color3(1, 0.85, 0.3),
        scale: 1.2,
      });
    }
    const origs = base.vault.emissives.map(m => m.emissiveColor.clone());
    for (const m of base.vault.emissives) m.emissiveColor = new BABYLON.Color3(1, 0.15, 0.15);
    setTimeout(() => {
      for (let i = 0; i < base.vault.emissives.length; i++) {
        if (base.vault.emissives[i]) base.vault.emissives[i].emissiveColor = origs[i];
      }
    }, 160);

    if (base.vault.hp <= 0) this.crackVault(base);
  }

  private crackVault(base: EnemyBase): void {
    base.vault.alive = false;
    this.bus.emit("effect:hitImpact", {
      position: base.vault.position.clone().add(new BABYLON.Vector3(0, 1.6, 0)),
      color: new BABYLON.Color3(1.0, 0.78, 0.25),
      scale: base.isBoss ? 8.0 : 4.0,
    });
    // Power-Jewel rolls. Regular bases drop them rarely as the headline
    // surprise; boss spires guarantee at least one rough jewel and have
    // strong odds at the higher tiers — clearing a fortress should always
    // leave the player with at least one jewel to mount.
    const baseLoot = base.isBoss ? this.bossVaultLoot() : [...VAULT_LOOT];
    if (base.isBoss) {
      // Always one rough jewel from a boss vault.
      baseLoot.push({ type: "jewel", amount: 1, jewelTier: "rough" });
      if (Math.random() < 0.50) baseLoot.push({ type: "jewel", amount: 1, jewelTier: "cut" });
      if (Math.random() < 0.20) baseLoot.push({ type: "jewel", amount: 1, jewelTier: "flawless" });
    } else {
      // Regular base — single roll. Rough is the most likely tier; flawless
      // is exceedingly rare here.
      const r = Math.random();
      if (r < 0.05) baseLoot.push({ type: "jewel", amount: 1, jewelTier: "rough" });
      else if (r < 0.065) baseLoot.push({ type: "jewel", amount: 1, jewelTier: "cut" });
      else if (r < 0.069) baseLoot.push({ type: "jewel", amount: 1, jewelTier: "flawless" });
    }
    this.bus.emit(GameEvents.PICKUP_SPAWNED, {
      position: base.vault.position.clone().add(new BABYLON.Vector3(0, 0.6, 0)),
      requests: baseLoot,
      spread: base.isBoss ? 4.0 : 2.4,
    });
    this.bus.emit(GameEvents.ENEMY_KILLED, {
      type: base.isBoss ? "bossSpire" : "vault",
      credits: base.isBoss ? 1500 : 250,
      experience: base.isBoss ? 1200 : 200,
      position: base.vault.position.clone(),
    });
    base.vault.visual.setEnabled(false);

    // Boss fortress: free the captured ally + emit the fortress-cleared event.
    if (base.isBoss) {
      this.freeAlly(base);
      this.bus.emit(GameEvents.BOSS_FORTRESS_CLEARED, {
        baseId: base.id,
        position: base.position.clone(),
      });
      this.bus.emit(GameEvents.UI_MESSAGE, {
        text: "ALLY RESCUED — FORTRESS CLEARED",
        duration: 5000,
      });
    }
  }

  /** Activate the freed-ally visuals (halo + lift + ALLY_RESCUED event). */
  private freeAlly(base: EnemyBase): void {
    if (base.allyFreed) return;
    base.allyFreed = true;
    if (!base.allyRoot) return;

    // Bright golden halo above the ally's head.
    if (!base.allyHalo) {
      const halo = BABYLON.MeshBuilder.CreateTorus(`bossAllyHalo_${base.id}`, {
        diameter: 1.2,
        thickness: 0.12,
        tessellation: 32,
      }, this.scene);
      const haloMat = new BABYLON.StandardMaterial(`bossAllyHaloMat_${base.id}`, this.scene);
      haloMat.emissiveColor = new BABYLON.Color3(1.0, 0.88, 0.35);
      haloMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
      haloMat.disableLighting = true;
      halo.material = haloMat;
      halo.parent = base.allyRoot;
      halo.position.set(0, 2.5, 0);
      base.allyHalo = halo;
      base.ownedMaterials.push(haloMat);
    }

    // Tiny lift animation so the rescue reads as a celebration.
    const startY = base.allyRoot.position.y;
    let f = 0;
    const animate = () => {
      f++;
      if (!base.allyRoot || base.allyRoot.isDisposed()) return;
      base.allyRoot.position.y = startY + Math.min(0.4, f * 0.02);
      if (base.allyHalo && !base.allyHalo.isDisposed()) {
        base.allyHalo.rotation.y += 0.05;
      }
      if (f < 200) requestAnimationFrame(animate);
    };
    animate();

    this.bus.emit(GameEvents.ALLY_RESCUED, {
      baseId: base.id,
      position: base.allyRoot.position.clone().add(base.position),
    });
  }

  /** Premium loot table for the boss spire. Significantly bigger payout
   *  than the regular vault loot. Credits are granted via the ENEMY_KILLED
   *  payload (1500), so we don't include them in the pickup list. */
  private bossVaultLoot(): PickupSpawnRequest[] {
    return [
      { type: "gear", amount: 30 },
      { type: "energy_core", amount: 15 },
      { type: "circuit_board", amount: 15 },
      { type: "nano_fiber", amount: 10 },
      { type: "weapon_part", amount: 4, weaponId: "rocket" },
      { type: "weapon_part", amount: 3, weaponId: "laser" },
      { type: "weapon_part", amount: 3, weaponId: "grenade" },
    ];
  }

  /** Returns hitbox meshes routed through WeaponsSystem.update */
  getActiveMeshes(): BABYLON.Mesh[] {
    const out: BABYLON.Mesh[] = [];
    for (const base of this.bases) {
      for (const t of base.turrets) if (t.isAlive) out.push(t.hitbox);
      if (base.vault.alive) out.push(base.vault.hitbox);
    }
    return out;
  }

  /** Position + alive-state of every base. The `alive` flag tracks the
   *  vault — once the vault is destroyed the base is essentially "cleared"
   *  and HUD overlays (mini-map icons, etc.) can dim or drop the marker. */
  getBasePositions(): ReadonlyArray<{ position: BABYLON.Vector3; alive: boolean }> {
    return this.bases.map(b => ({ position: b.position, alive: b.vault.alive }));
  }

  /** EnemyLike list for health-bar provider */
  getEnemyLikes(): EnemyLike[] {
    const out: EnemyLike[] = [];
    for (const base of this.bases) {
      for (const t of base.turrets) if (t.isAlive) out.push(t);
      if (base.vault.alive && base.vault.armed) {
        out.push({
          health: base.vault.hp,
          maxHealth: base.vault.maxHp,
          isAlive: base.vault.alive,
          mesh: base.vault.hitbox,
          barWidth: 160,
          barHeight: 12,
          barColor: "linear-gradient(90deg, #ffaa22 0%, #ffe066 100%)",
          barAccent: "rgba(255, 200, 60, 0.95)",
          barLabel: "LOOT VAULT",
          barMaxDistance: 200,
        });
      }
    }
    return out;
  }

  spawnBase(center: BABYLON.Vector3): EnemyBase {
    const id = this.idCounter++;
    const baseRoot = new BABYLON.TransformNode(`enemyBase_${id}`, this.scene);
    baseRoot.position.copyFrom(center);

    // Central pillar
    const pillarMat = new BABYLON.StandardMaterial(`basePillarMat_${id}`, this.scene);
    pillarMat.diffuseColor = new BABYLON.Color3(0.18, 0.18, 0.22);
    pillarMat.emissiveColor = new BABYLON.Color3(0.04, 0.05, 0.1);
    const ownedMaterials: BABYLON.Material[] = [pillarMat];

    const pillar = BABYLON.MeshBuilder.CreateCylinder(`basePillar_${id}`, { height: 6, diameter: 3 }, this.scene);
    pillar.material = pillarMat;
    pillar.position.set(0, 3, 0);
    pillar.parent = baseRoot;

    const top = BABYLON.MeshBuilder.CreateBox(`basePillarTop_${id}`, { width: 3.6, height: 1, depth: 3.6 }, this.scene);
    top.material = pillarMat;
    top.position.set(0, 6.5, 0);
    top.parent = baseRoot;

    // 4 perimeter walls (low)
    const wallMat = new BABYLON.StandardMaterial(`baseWallMat_${id}`, this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.22, 0.22, 0.28);
    ownedMaterials.push(wallMat);
    const wallSpec = [
      { x: 0, z: 14, w: 28, d: 1.2 },
      { x: 0, z: -14, w: 28, d: 1.2 },
      { x: 14, z: 0, w: 1.2, d: 28 },
      { x: -14, z: 0, w: 1.2, d: 28 },
    ];
    for (const ws of wallSpec) {
      const wall = BABYLON.MeshBuilder.CreateBox(`baseWall_${id}_${ws.x}_${ws.z}`, { width: ws.w, height: 2.2, depth: ws.d }, this.scene);
      wall.material = wallMat;
      wall.position.set(ws.x, 1.1, ws.z);
      wall.parent = baseRoot;
    }

    // 4 corner turrets
    const turrets: BaseTurret[] = [];
    const corners = [
      new BABYLON.Vector3(11, 0, 11),
      new BABYLON.Vector3(-11, 0, 11),
      new BABYLON.Vector3(11, 0, -11),
      new BABYLON.Vector3(-11, 0, -11),
    ];
    for (const c of corners) {
      const turret = this.createTurret(center.add(c), id);
      turrets.push(turret);
    }

    // Loot vault (golden cube on platform, surrounded by 4 spike pillars)
    const vault = this.createVault(center, id);

    const base: EnemyBase = { id, position: center.clone(), turrets, vault, centerPillar: baseRoot, ownedMaterials };
    this.bases.push(base);
    // Register the whole base shell + per-turret visuals for distance culling.
    if (this.cullRegistrar) {
      this.cullRegistrar(baseRoot, 320);
      for (const t of turrets) this.cullRegistrar(t.visual, 260);
      this.cullRegistrar(vault.visual, 320);
    }
    return base;
  }

  private createTurret(position: BABYLON.Vector3, baseId: number): BaseTurret {
    const id = this.idCounter++;
    const visual = new BABYLON.TransformNode(`turretVisual_${id}`, this.scene);
    visual.position.copyFrom(position);

    const baseMat = new BABYLON.StandardMaterial(`turretBaseMat_${id}`, this.scene);
    baseMat.diffuseColor = new BABYLON.Color3(0.28, 0.28, 0.34);

    const eyeMat = new BABYLON.StandardMaterial(`turretEyeMat_${id}`, this.scene);
    eyeMat.diffuseColor = new BABYLON.Color3(1, 0.3, 0.3);
    eyeMat.emissiveColor = new BABYLON.Color3(1, 0.3, 0.3);
    eyeMat.disableLighting = true;

    const stand = BABYLON.MeshBuilder.CreateCylinder(`turretStand_${id}`, { height: 1.4, diameterTop: 0.7, diameterBottom: 1.0 }, this.scene);
    stand.material = baseMat;
    stand.position.y = 0.7;
    stand.parent = visual;

    const head = BABYLON.MeshBuilder.CreateBox(`turretHead_${id}`, { width: 1.2, height: 0.8, depth: 1.2 }, this.scene);
    head.material = baseMat;
    head.position.y = 1.7;
    head.parent = visual;

    const eye = BABYLON.MeshBuilder.CreateSphere(`turretEye_${id}`, { diameter: 0.45, segments: 10 }, this.scene);
    eye.material = eyeMat;
    eye.position.set(0, 1.7, 0.55);
    eye.parent = visual;

    const barrelL = BABYLON.MeshBuilder.CreateCylinder(`turretBarrelL_${id}`, { height: 1.2, diameter: 0.18 }, this.scene);
    barrelL.material = baseMat;
    barrelL.rotation.x = Math.PI / 2;
    barrelL.position.set(-0.32, 1.5, 1.0);
    barrelL.parent = visual;

    const barrelR = BABYLON.MeshBuilder.CreateCylinder(`turretBarrelR_${id}`, { height: 1.2, diameter: 0.18 }, this.scene);
    barrelR.material = baseMat;
    barrelR.rotation.x = Math.PI / 2;
    barrelR.position.set(0.32, 1.5, 1.0);
    barrelR.parent = visual;

    const hitbox = BABYLON.MeshBuilder.CreateBox(`turretHitbox_${id}`, { width: 1.8, height: 2.4, depth: 1.8 }, this.scene);
    hitbox.position.copyFrom(position);
    hitbox.position.y += 1.2;
    hitbox.isVisible = false;
    hitbox.metadata = { hitRadius: 1.4, isTurret: true };

    const t: BaseTurret = {
      health: EnemyBaseSystem.TURRET_HP,
      maxHealth: EnemyBaseSystem.TURRET_HP,
      isAlive: true,
      mesh: hitbox,
      hitbox,
      visual,
      emissives: [eyeMat],
      ownedMaterials: [baseMat, eyeMat],
      fireCooldown: 1.2 + Math.random() * 1.0,
      shakeTimer: 0,
      lastHitFxAt: 0,
      baseId,
      barWidth: 80,
      barHeight: 8,
      barColor: "linear-gradient(90deg, #ff3030 0%, #ff8060 100%)",
      barAccent: "rgba(255, 80, 80, 0.95)",
      barLabel: "TURRET",
      barMaxDistance: 140,
    };
    return t;
  }

  private createVault(center: BABYLON.Vector3, baseId: number): LootVault {
    const id = this.idCounter++;
    const visual = new BABYLON.TransformNode(`vaultVisual_${id}`, this.scene);
    visual.position.copyFrom(center);

    const platMat = new BABYLON.StandardMaterial(`vaultPlatMat_${id}`, this.scene);
    platMat.diffuseColor = new BABYLON.Color3(0.18, 0.18, 0.2);
    const cubeMat = new BABYLON.StandardMaterial(`vaultCubeMat_${id}`, this.scene);
    cubeMat.diffuseColor = new BABYLON.Color3(0.28, 0.22, 0.18);
    const lockMat = new BABYLON.StandardMaterial(`vaultLockMat_${id}`, this.scene);
    lockMat.diffuseColor = new BABYLON.Color3(0.35, 0.45, 1.0);
    lockMat.emissiveColor = new BABYLON.Color3(0.35, 0.45, 1.0); // starts blue (locked)
    lockMat.disableLighting = true;

    const platform = BABYLON.MeshBuilder.CreateCylinder(`vaultPlat_${id}`, { height: 0.4, diameter: 4.5 }, this.scene);
    platform.material = platMat;
    platform.position.y = 0.2;
    platform.parent = visual;

    const cube = BABYLON.MeshBuilder.CreateBox(`vaultCube_${id}`, { width: 2.4, height: 2.4, depth: 2.4 }, this.scene);
    cube.material = cubeMat;
    cube.position.y = 1.6;
    cube.parent = visual;

    const lock = BABYLON.MeshBuilder.CreateTorus(`vaultLock_${id}`, { diameter: 1.4, thickness: 0.2, tessellation: 16 }, this.scene);
    lock.material = lockMat;
    lock.position.y = 1.6;
    lock.position.z = 1.3;
    lock.rotation.x = Math.PI / 2;
    lock.parent = visual;

    const lockCore = BABYLON.MeshBuilder.CreateSphere(`vaultLockCore_${id}`, { diameter: 0.6, segments: 12 }, this.scene);
    lockCore.material = lockMat;
    lockCore.position.y = 1.6;
    lockCore.position.z = 1.35;
    lockCore.parent = visual;

    // 4 spike pillars around the vault
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const spike = BABYLON.MeshBuilder.CreateCylinder(`vaultSpike_${id}_${i}`, { height: 2.6, diameterBottom: 0.5, diameterTop: 0.05 }, this.scene);
      spike.material = platMat;
      spike.position.set(Math.cos(ang) * 1.9, 1.3, Math.sin(ang) * 1.9);
      spike.parent = visual;
    }

    const hitbox = BABYLON.MeshBuilder.CreateBox(`vaultHitbox_${id}`, { width: 3.2, height: 3.2, depth: 3.2 }, this.scene);
    hitbox.position.copyFrom(center);
    hitbox.position.y += 1.6;
    hitbox.isVisible = false;
    hitbox.metadata = { hitRadius: 2.0, isVault: true };

    return {
      baseId,
      hitbox,
      visual,
      emissives: [lockMat],
      ownedMaterials: [platMat, cubeMat, lockMat],
      hp: EnemyBaseSystem.VAULT_HP,
      maxHp: EnemyBaseSystem.VAULT_HP,
      armed: false,
      alive: true,
      shakeTimer: 0,
      lastHitFxAt: 0,
      position: center.clone(),
    };
  }

  seedWorld(centers: BABYLON.Vector3[]): void {
    for (const c of centers) this.spawnBase(c);
  }

  // ============================================================================
  //                            BOSS FORTRESS
  // ============================================================================

  static readonly BOSS_TURRET_HP = 280;
  static readonly BOSS_SPIRE_HP = 900;

  /** Build the giant boss fortress at `center`: outer wall ring, 12 turrets
   *  in two concentric rings, central command spire (high-HP vault analog),
   *  and the captured-ally humanoid sitting in front of the spire.
   *
   *  Hooks (via EventBus):
   *    - `BOSS_FORTRESS_TURRETS_CLEARED` once every outer turret dies.
   *    - `BOSS_FORTRESS_CLEARED` + `ALLY_RESCUED` once the spire is broken.
   */
  spawnBossFortress(center: BABYLON.Vector3): EnemyBase {
    const id = this.idCounter++;
    const baseRoot = new BABYLON.TransformNode(`bossFortress_${id}`, this.scene);
    baseRoot.position.copyFrom(center);

    // Materials reused across the fortress shell.
    const wallMat = new BABYLON.StandardMaterial(`bossWallMat_${id}`, this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.18, 0.16, 0.22);
    wallMat.emissiveColor = new BABYLON.Color3(0.05, 0.02, 0.06);
    const trimMat = new BABYLON.StandardMaterial(`bossTrimMat_${id}`, this.scene);
    trimMat.diffuseColor = new BABYLON.Color3(0.45, 0.06, 0.10);
    trimMat.emissiveColor = new BABYLON.Color3(0.7, 0.05, 0.1);
    trimMat.disableLighting = true;
    const spireMat = new BABYLON.StandardMaterial(`bossSpireMat_${id}`, this.scene);
    spireMat.diffuseColor = new BABYLON.Color3(0.22, 0.16, 0.20);
    spireMat.emissiveColor = new BABYLON.Color3(0.08, 0.02, 0.04);
    const coreMat = new BABYLON.StandardMaterial(`bossCoreMat_${id}`, this.scene);
    coreMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    coreMat.emissiveColor = new BABYLON.Color3(1.0, 0.18, 0.22); // glowing red core
    coreMat.disableLighting = true;
    const ownedMaterials: BABYLON.Material[] = [wallMat, trimMat, spireMat, coreMat];

    // Octagonal outer wall (8 segments, each 16 units long).
    const outerR = 32;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const wall = BABYLON.MeshBuilder.CreateBox(`bossWall_${id}_${i}`, {
        width: 16, height: 5.5, depth: 1.6,
      }, this.scene);
      wall.material = wallMat;
      wall.position.set(cosA * outerR, 2.75, sinA * outerR);
      wall.rotation.y = -a + Math.PI / 2;
      wall.parent = baseRoot;

      // Glowing red trim along the top edge of each wall section.
      const trim = BABYLON.MeshBuilder.CreateBox(`bossWallTrim_${id}_${i}`, {
        width: 16, height: 0.25, depth: 1.7,
      }, this.scene);
      trim.material = trimMat;
      trim.position.set(cosA * outerR, 5.6, sinA * outerR);
      trim.rotation.y = -a + Math.PI / 2;
      trim.parent = baseRoot;
    }

    // Central command spire — tall obelisk with a glowing red core.
    const spireBase = BABYLON.MeshBuilder.CreateCylinder(`bossSpireBase_${id}`, {
      height: 4, diameterBottom: 12, diameterTop: 9,
    }, this.scene);
    spireBase.material = spireMat;
    spireBase.position.y = 2;
    spireBase.parent = baseRoot;

    const spireBody = BABYLON.MeshBuilder.CreateCylinder(`bossSpireBody_${id}`, {
      height: 14, diameterBottom: 6, diameterTop: 3.2,
    }, this.scene);
    spireBody.material = spireMat;
    spireBody.position.y = 11;
    spireBody.parent = baseRoot;

    const spireTop = BABYLON.MeshBuilder.CreateCylinder(`bossSpireTop_${id}`, {
      height: 4, diameterBottom: 3.2, diameterTop: 0.4,
    }, this.scene);
    spireTop.material = spireMat;
    spireTop.position.y = 20;
    spireTop.parent = baseRoot;

    // Glowing red core embedded mid-spire (the visual weak point).
    const core = BABYLON.MeshBuilder.CreateSphere(`bossSpireCore_${id}`, { diameter: 2.2, segments: 16 }, this.scene);
    core.material = coreMat;
    core.position.y = 9;
    core.parent = baseRoot;

    // Four red trim rings climbing the spire.
    for (let i = 0; i < 4; i++) {
      const ring = BABYLON.MeshBuilder.CreateTorus(`bossSpireRing_${id}_${i}`, {
        diameter: 5.5 - i * 0.7, thickness: 0.18, tessellation: 24,
      }, this.scene);
      ring.material = trimMat;
      ring.position.y = 5 + i * 4;
      ring.parent = baseRoot;
    }

    // 12 turrets: 8 in an outer ring + 4 inner sentries near the spire.
    const turrets: BaseTurret[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 16;
      const x = Math.cos(a) * (outerR - 3);
      const z = Math.sin(a) * (outerR - 3);
      turrets.push(this.createBossTurret(center.add(new BABYLON.Vector3(x, 0, z)), id));
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * 14;
      const z = Math.sin(a) * 14;
      turrets.push(this.createBossTurret(center.add(new BABYLON.Vector3(x, 0, z)), id));
    }

    // Spire vault hitbox — sits at the glowing core. Massive HP.
    const vault = this.createSpireVault(center, id);

    // Captured ally inside the spire base, at floor level in front of the
    // spire (so the player can see them once they breach the inner ring).
    const allyRoot = this.createCapturedAlly(id);
    allyRoot.parent = baseRoot;
    allyRoot.position.set(0, 0, 5);

    const base: EnemyBase = {
      id,
      position: center.clone(),
      turrets,
      vault,
      centerPillar: baseRoot,
      ownedMaterials,
      isBoss: true,
      bossTurretsClearedFired: false,
      allyRoot,
      allyFreed: false,
    };
    this.bases.push(base);
    // Boss fortress is iconic — register with a much larger radius so it's
    // visible on the horizon, but still drops out beyond the camera maxZ.
    if (this.cullRegistrar) {
      this.cullRegistrar(baseRoot, 700);
      for (const t of turrets) this.cullRegistrar(t.visual, 360);
      this.cullRegistrar(vault.visual, 700);
    }
    return base;
  }

  private createBossTurret(position: BABYLON.Vector3, baseId: number): BaseTurret {
    const turret = this.createTurret(position, baseId);
    // Beefier than a normal turret.
    turret.health = EnemyBaseSystem.BOSS_TURRET_HP;
    turret.maxHealth = EnemyBaseSystem.BOSS_TURRET_HP;
    turret.barLabel = "FORTRESS TURRET";
    turret.barColor = "linear-gradient(90deg, #b8001a 0%, #ff4030 100%)";
    return turret;
  }

  private createSpireVault(center: BABYLON.Vector3, baseId: number): LootVault {
    const id = this.idCounter++;
    const visual = new BABYLON.TransformNode(`bossSpireVaultVisual_${id}`, this.scene);
    visual.position.copyFrom(center);

    // Highlight ring at the core for "shoot here when armed" telegraphing.
    const lockMat = new BABYLON.StandardMaterial(`bossSpireLockMat_${id}`, this.scene);
    lockMat.diffuseColor = new BABYLON.Color3(0.35, 0.45, 1.0);
    lockMat.emissiveColor = new BABYLON.Color3(0.35, 0.45, 1.0);
    lockMat.disableLighting = true;
    const ring = BABYLON.MeshBuilder.CreateTorus(`bossSpireLock_${id}`, {
      diameter: 3.5, thickness: 0.28, tessellation: 24,
    }, this.scene);
    ring.material = lockMat;
    ring.position.y = 9;
    ring.parent = visual;

    // Big invisible hitbox covering the spire's mid-section.
    const hitbox = BABYLON.MeshBuilder.CreateBox(`bossSpireHit_${id}`, {
      width: 5, height: 12, depth: 5,
    }, this.scene);
    hitbox.position.copyFrom(center);
    hitbox.position.y += 9;
    hitbox.isVisible = false;
    hitbox.metadata = { hitRadius: 3.0, isVault: true, isBossSpire: true };

    return {
      baseId,
      hitbox,
      visual,
      emissives: [lockMat],
      ownedMaterials: [lockMat],
      hp: EnemyBaseSystem.BOSS_SPIRE_HP,
      maxHp: EnemyBaseSystem.BOSS_SPIRE_HP,
      armed: false,
      alive: true,
      shakeTimer: 0,
      lastHitFxAt: 0,
      position: center.clone(),
    };
  }

  /** Create the kneeling captured-ally humanoid + small "cuffs" cube at
   *  the wrists. Owned by the boss-fortress base root, so it disposes with
   *  the rest of the fortress. */
  private createCapturedAlly(baseId: number): BABYLON.TransformNode {
    const wrap = new BABYLON.TransformNode(`bossAlly_${baseId}`, this.scene);

    // Use any available humanoid preset (PlayerDefault first), tinted
    // friendly cyan/yellow so the ally never gets confused for a captain.
    const preferred = ["PlayerDefault", "HumanoidCaptainAlpha", "HumanoidCaptainBeta"];
    let placed = false;
    for (const name of preferred) {
      const def = HUMANOID_PRESETS[name];
      if (!def) continue;
      try {
        const human = new HumanoidCharacter(this.scene, def);
        const root = human.getRoot();
        root.parent = wrap;
        root.position = BABYLON.Vector3.Zero();
        root.scaling.setAll(0.95);

        // Friendly cyan/yellow tint so it visually contrasts with captains.
        for (const m of root.getChildMeshes()) {
          const mat = m.material as BABYLON.StandardMaterial | null;
          if (mat) {
            if (mat.diffuseColor) {
              mat.diffuseColor = new BABYLON.Color3(
                Math.min(1, mat.diffuseColor.r * 0.6 + 0.25),
                Math.min(1, mat.diffuseColor.g * 0.6 + 0.55),
                Math.min(1, mat.diffuseColor.b * 0.6 + 0.55),
              );
            }
            if (mat.emissiveColor) {
              mat.emissiveColor = new BABYLON.Color3(
                mat.emissiveColor.r * 0.4,
                Math.min(1, mat.emissiveColor.g * 0.6 + 0.25),
                Math.min(1, mat.emissiveColor.b * 0.6 + 0.30),
              );
            }
          }
        }

        placed = true;
        break;
      } catch {
        /* try the next preset */
      }
    }
    if (!placed) {
      const cap = BABYLON.MeshBuilder.CreateCapsule(`bossAllyFallback_${baseId}`, {
        height: 1.8, radius: 0.35,
      }, this.scene);
      const mat = new BABYLON.StandardMaterial(`bossAllyFallbackMat_${baseId}`, this.scene);
      mat.diffuseColor = new BABYLON.Color3(0.95, 0.85, 0.4);
      mat.emissiveColor = new BABYLON.Color3(0.4, 0.35, 0.15);
      cap.material = mat;
      cap.position.y = 0.9;
      cap.parent = wrap;
    }

    // Glowing red containment cuffs on the ground (visual only).
    const cuffs = BABYLON.MeshBuilder.CreateTorus(`bossAllyCuffs_${baseId}`, {
      diameter: 1.6, thickness: 0.18, tessellation: 24,
    }, this.scene);
    const cuffMat = new BABYLON.StandardMaterial(`bossAllyCuffsMat_${baseId}`, this.scene);
    cuffMat.emissiveColor = new BABYLON.Color3(1.0, 0.18, 0.22);
    cuffMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    cuffMat.disableLighting = true;
    cuffs.material = cuffMat;
    cuffs.position.y = 0.15;
    cuffs.parent = wrap;

    return wrap;
  }

  /** Returns every boss fortress + its rescue-state. Empty when no boss
   *  fortress has been seeded yet. Both the L1 and (later) L2 fortresses
   *  appear here simultaneously once L2 starts. */
  getBossFortresses(): Array<{
    position: BABYLON.Vector3;
    spireAlive: boolean;
    turretsCleared: boolean;
    allyFreed: boolean;
  }> {
    return this.bases
      .filter(b => b.isBoss)
      .map(b => ({
        position: b.position.clone(),
        spireAlive: b.vault.alive,
        turretsCleared: !!b.bossTurretsClearedFired,
        allyFreed: !!b.allyFreed,
      }));
  }

  /** Convenience: the most-recently-spawned boss fortress, or null. Used
   *  by the level system to detect whether the L2 fortress already exists
   *  before re-seeding it after a save reload. */
  getLatestBossFortress(): null | {
    position: BABYLON.Vector3;
    spireAlive: boolean;
    turretsCleared: boolean;
    allyFreed: boolean;
  } {
    const all = this.getBossFortresses();
    return all.length === 0 ? null : all[all.length - 1];
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    // Cancel any in-flight delayed UI messages so they don't leak into the
    // next session.
    this.pendingTimeouts.forEach(t => clearTimeout(t));
    this.pendingTimeouts.clear();
    for (const tr of this.tracers) {
      const mat = tr.mesh.material;
      tr.mesh.dispose();
      if (mat) try { mat.dispose(); } catch {}
    }
    this.tracers = [];
    const disposeChildren = (node: BABYLON.TransformNode) => {
      const children = node.getChildMeshes(false);
      for (const c of children) c.dispose();
    };
    for (const base of this.bases) {
      for (const t of base.turrets) {
        disposeChildren(t.visual);
        t.hitbox.dispose();
        t.visual.dispose();
        for (const m of t.ownedMaterials) try { m.dispose(); } catch {}
      }
      disposeChildren(base.vault.visual);
      base.vault.hitbox.dispose();
      base.vault.visual.dispose();
      for (const m of base.vault.ownedMaterials) try { m.dispose(); } catch {}
      disposeChildren(base.centerPillar);
      base.centerPillar.dispose();
      for (const m of base.ownedMaterials) try { m.dispose(); } catch {}
    }
    this.bases = [];
  }
}
