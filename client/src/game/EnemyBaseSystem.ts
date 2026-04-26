import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import type { EnemyLike } from "./EnemyHealthBarSystem";
import type { PickupSpawnRequest } from "./PickupSystem";

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
      scale: 4.0,
    });
    this.bus.emit(GameEvents.PICKUP_SPAWNED, {
      position: base.vault.position.clone().add(new BABYLON.Vector3(0, 0.6, 0)),
      requests: VAULT_LOOT,
      spread: 2.4,
    });
    this.bus.emit(GameEvents.ENEMY_KILLED, {
      type: "vault",
      credits: 250,
      experience: 200,
      position: base.vault.position.clone(),
    });
    base.vault.visual.setEnabled(false);
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

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
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
