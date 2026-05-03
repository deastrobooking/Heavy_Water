import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import type { WallCollider } from "./CityGenerator";

export type AerialKind = "fighter" | "battleship" | "fortress";

/**
 * Segment-vs-AABB intersection used for line-of-sight checks. Returns true
 * if the segment p0→p1 enters or passes through the AABB. Used so aerial
 * enemies cannot hit a player who is hiding inside a building.
 */
function segmentHitsAABB(p0: BABYLON.Vector3, p1: BABYLON.Vector3, a: WallCollider): boolean {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  let tmin = 0, tmax = 1;
  const eps = 1e-6;
  // X
  if (Math.abs(dx) < eps) {
    if (p0.x < a.minX || p0.x > a.maxX) return false;
  } else {
    let t1 = (a.minX - p0.x) / dx;
    let t2 = (a.maxX - p0.x) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  // Y
  if (Math.abs(dy) < eps) {
    if (p0.y < a.minY || p0.y > a.maxY) return false;
  } else {
    let t1 = (a.minY - p0.y) / dy;
    let t2 = (a.maxY - p0.y) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  // Z
  if (Math.abs(dz) < eps) {
    if (p0.z < a.minZ || p0.z > a.maxZ) return false;
  } else {
    let t1 = (a.minZ - p0.z) / dz;
    let t2 = (a.maxZ - p0.z) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  return tmax > 0 && tmin < 1;
}

/** Cheap world-AABB cull around the segment so we only test nearby walls. */
function segmentInsideRange(p0: BABYLON.Vector3, p1: BABYLON.Vector3, a: WallCollider): boolean {
  const minX = Math.min(p0.x, p1.x) - 1, maxX = Math.max(p0.x, p1.x) + 1;
  if (a.maxX < minX || a.minX > maxX) return false;
  const minY = Math.min(p0.y, p1.y) - 1, maxY = Math.max(p0.y, p1.y) + 1;
  if (a.maxY < minY || a.minY > maxY) return false;
  const minZ = Math.min(p0.z, p1.z) - 1, maxZ = Math.max(p0.z, p1.z) + 1;
  if (a.maxZ < minZ || a.minZ > maxZ) return false;
  return true;
}

interface AerialProjectile {
  mesh: BABYLON.Mesh;
  velocity: BABYLON.Vector3;
  damage: number;
  lifetime: number;
}

export class AerialUnit {
  kind: AerialKind;
  hitbox: BABYLON.Mesh;
  visual: BABYLON.TransformNode;
  health: number;
  maxHealth: number;
  speed: number;
  isAlive: boolean = true;
  // Health-bar styling hints honored by EnemyHealthBarSystem
  barWidth: number;
  barHeight: number;
  barColor: string;
  barAccent: string;
  barLabel: string;
  barMaxDistance: number;

  // AI state
  private orbitAngle: number;
  private orbitRadius: number;
  /** Public so AerialEnemySystem can re-anchor units in orbital combat
   *  (Level 5 / Orbital Front) — the default altitudes are tuned for a
   *  ground-level player and leave bullets way above the orbiting fighters
   *  when the player is piloting a fighter at y≈60. */
  orbitAltitude: number;
  private fireCooldown: number = 0;
  private divePhase: number = 0; // 0 = orbit, 1 = diving, 2 = climbing
  private bus: EventBus;
  private shakeTimer: number = 0;
  private lastHitFxAt: number = 0;
  private originalEmissives: { mat: BABYLON.StandardMaterial; color: BABYLON.Color3 }[] = [];
  // Set by AerialEnemySystem each frame so units can LOS-check the player
  // against city walls (so they cannot shoot through buildings).
  walls: WallCollider[] = [];
  // Set by AerialEnemySystem. When false, the unit patrols silently and does
  // not fire. Becomes true once the player attacks an enemy base, mothership
  // or any aerial unit.
  aggro: boolean = false;
  // Fixed world point a passive unit orbits around (so they don't shadow the
  // player like soft-aggro). Set at spawn time. When aggro becomes true the
  // unit switches to player-anchored orbit instead.
  patrolCenter: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  // Materials this unit owns and must dispose with itself.
  private ownedMaterials: BABYLON.Material[] = [];

  constructor(scene: BABYLON.Scene, kind: AerialKind, position: BABYLON.Vector3) {
    this.kind = kind;
    this.bus = EventBus.getInstance();

    if (kind === "fighter") {
      this.maxHealth = 70;
      this.speed = 8.5;
      this.orbitRadius = 32 + Math.random() * 14;
      this.orbitAltitude = 22 + Math.random() * 10;
      this.barWidth = 70;
      this.barHeight = 8;
      this.barColor = "linear-gradient(90deg, #ff8844 0%, #ffcc44 100%)";
      this.barAccent = "rgba(255, 140, 60, 0.95)";
      this.barLabel = "FIGHTER";
      this.barMaxDistance = 160;
    } else if (kind === "battleship") {
      this.maxHealth = 480;
      this.speed = 2.6;
      this.orbitRadius = 60 + Math.random() * 25;
      this.orbitAltitude = 48 + Math.random() * 12;
      this.barWidth = 140;
      this.barHeight = 12;
      this.barColor = "linear-gradient(90deg, #aa44ff 0%, #ff44ff 50%, #ff4488 100%)";
      this.barAccent = "rgba(220, 80, 255, 0.95)";
      this.barLabel = "BATTLESHIP";
      this.barMaxDistance = 250;
    } else {
      // FORTRESS — slow, massive flying carrier with heavy guns.
      this.maxHealth = 1500;
      this.speed = 1.6;
      this.orbitRadius = 100 + Math.random() * 30;
      this.orbitAltitude = 70 + Math.random() * 10;
      this.barWidth = 200;
      this.barHeight = 14;
      this.barColor = "linear-gradient(90deg, #ff3322 0%, #ff7733 50%, #ffcc33 100%)";
      this.barAccent = "rgba(255, 80, 40, 0.95)";
      this.barLabel = "FORTRESS";
      this.barMaxDistance = 320;
    }
    this.health = this.maxHealth;
    this.orbitAngle = Math.random() * Math.PI * 2;

    const built = kind === "fighter"
      ? this.buildFighter(scene)
      : kind === "battleship"
      ? this.buildBattleship(scene)
      : this.buildFortress(scene);
    this.visual = built.root;

    // Fortress hull is 18×4×30, so a sphere/capsule of r≈12 leaves the long
    // axis poking out the front and back — bullets often whiff. Bump the hit
    // radius so projectiles consistently register against the big silhouette.
    const hitR = kind === "fighter" ? 2.4 : kind === "battleship" ? 7.5 : 16;
    const hitH = kind === "fighter" ? 2 : kind === "battleship" ? 4 : 8;
    this.hitbox = BABYLON.MeshBuilder.CreateCapsule(`aerialHit_${kind}_${Date.now()}_${Math.floor(Math.random()*9999)}`, {
      height: hitH,
      radius: hitR,
    }, scene);
    this.hitbox.isVisible = false;
    this.hitbox.position.copyFrom(position);
    this.hitbox.metadata = { hitRadius: hitR, aerialUnit: this };
    this.visual.parent = this.hitbox;

    // Track original emissives for red-flash on hit, and remember every
    // material this unit's visual owns so we can dispose them with the unit
    // (otherwise StandardMaterials accumulate in the scene over time).
    const seenMats = new Set<BABYLON.Material>();
    const collect = (n: BABYLON.Node) => {
      const m = (n as BABYLON.AbstractMesh).material as BABYLON.StandardMaterial | null;
      if (m && !seenMats.has(m)) {
        seenMats.add(m);
        this.ownedMaterials.push(m);
        if (m.emissiveColor) {
          this.originalEmissives.push({ mat: m, color: m.emissiveColor.clone() });
        }
      }
    };
    for (const child of this.visual.getChildMeshes()) collect(child);
  }

  private buildFighter(scene: BABYLON.Scene): { root: BABYLON.TransformNode } {
    const root = new BABYLON.TransformNode(`fighterRoot_${Date.now()}_${Math.floor(Math.random()*9999)}`, scene);

    // Body — sleek dark wedge
    const body = BABYLON.MeshBuilder.CreateBox("fbody", { width: 1.4, height: 0.5, depth: 3.0 }, scene);
    const bodyMat = new BABYLON.StandardMaterial("fbodyMat", scene);
    bodyMat.diffuseColor = new BABYLON.Color3(0.18, 0.05, 0.05);
    bodyMat.emissiveColor = new BABYLON.Color3(0.08, 0.02, 0.02);
    body.material = bodyMat;
    body.parent = root;

    // Cockpit canopy
    const cockpit = BABYLON.MeshBuilder.CreateSphere("fcock", { diameter: 0.7, segments: 8 }, scene);
    cockpit.scaling = new BABYLON.Vector3(1, 0.4, 1.4);
    cockpit.position.set(0, 0.35, 0.2);
    const cockMat = new BABYLON.StandardMaterial("fcockMat", scene);
    cockMat.diffuseColor = new BABYLON.Color3(0.6, 0.05, 0.1);
    cockMat.emissiveColor = new BABYLON.Color3(0.9, 0.2, 0.3);
    cockMat.alpha = 0.85;
    cockpit.material = cockMat;
    cockpit.parent = root;

    // Wings — angled out
    const wingL = BABYLON.MeshBuilder.CreateBox("fwingL", { width: 2.4, height: 0.1, depth: 1.2 }, scene);
    wingL.position.set(-1.3, 0, -0.2);
    wingL.rotation.z = -0.18;
    wingL.material = bodyMat;
    wingL.parent = root;
    const wingR = wingL.clone("fwingR");
    wingR.position.x = 1.3;
    wingR.rotation.z = 0.18;
    wingR.parent = root;

    // Tail fin
    const tail = BABYLON.MeshBuilder.CreateBox("ftail", { width: 0.15, height: 0.8, depth: 0.7 }, scene);
    tail.position.set(0, 0.45, -1.1);
    tail.material = bodyMat;
    tail.parent = root;

    // Engine glows
    const engineMat = new BABYLON.StandardMaterial("fengineMat", scene);
    engineMat.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.1);
    engineMat.diffuseColor = new BABYLON.Color3(1.0, 0.5, 0.1);
    engineMat.disableLighting = true;
    const engL = BABYLON.MeshBuilder.CreateSphere("fengL", { diameter: 0.4 }, scene);
    engL.position.set(-0.45, 0, -1.55);
    engL.material = engineMat;
    engL.parent = root;
    const engR = BABYLON.MeshBuilder.CreateSphere("fengR", { diameter: 0.4 }, scene);
    engR.position.set(0.45, 0, -1.55);
    engR.material = engineMat;
    engR.parent = root;

    return { root };
  }

  private buildBattleship(scene: BABYLON.Scene): { root: BABYLON.TransformNode } {
    const root = new BABYLON.TransformNode(`bshipRoot_${Date.now()}_${Math.floor(Math.random()*9999)}`, scene);

    // Main hull
    const hull = BABYLON.MeshBuilder.CreateBox("bhull", { width: 5.5, height: 2.6, depth: 22 }, scene);
    const hullMat = new BABYLON.StandardMaterial("bhullMat", scene);
    hullMat.diffuseColor = new BABYLON.Color3(0.1, 0.05, 0.18);
    hullMat.emissiveColor = new BABYLON.Color3(0.05, 0.02, 0.08);
    hull.material = hullMat;
    hull.parent = root;

    // Bow — pointed nose box
    const bow = BABYLON.MeshBuilder.CreateBox("bbow", { width: 3.5, height: 1.8, depth: 4 }, scene);
    bow.position.set(0, 0, 12);
    bow.material = hullMat;
    bow.parent = root;

    // Bridge tower
    const bridge = BABYLON.MeshBuilder.CreateBox("bbridge", { width: 3.2, height: 1.6, depth: 4.5 }, scene);
    bridge.position.set(0, 1.9, -3);
    bridge.material = hullMat;
    bridge.parent = root;

    // Bridge windows — emissive band
    const winMat = new BABYLON.StandardMaterial("bwinMat", scene);
    winMat.emissiveColor = new BABYLON.Color3(1.0, 0.2, 0.15);
    winMat.diffuseColor = new BABYLON.Color3(1.0, 0.2, 0.15);
    winMat.disableLighting = true;
    const win = BABYLON.MeshBuilder.CreateBox("bwin", { width: 3.0, height: 0.25, depth: 4.2 }, scene);
    win.position.set(0, 2.4, -3);
    win.material = winMat;
    win.parent = root;

    // 4 turrets along the spine
    const turretMat = new BABYLON.StandardMaterial("bturMat", scene);
    turretMat.diffuseColor = new BABYLON.Color3(0.2, 0.1, 0.25);
    turretMat.emissiveColor = new BABYLON.Color3(0.05, 0.0, 0.08);
    for (let i = 0; i < 4; i++) {
      const tDome = BABYLON.MeshBuilder.CreateSphere(`bturD_${i}`, { diameter: 1.6, segments: 8 }, scene);
      tDome.scaling.y = 0.6;
      const z = 8 - i * 5;
      tDome.position.set(0, 1.6, z);
      tDome.material = turretMat;
      tDome.parent = root;

      const tBarrel = BABYLON.MeshBuilder.CreateCylinder(`bturB_${i}`, { height: 1.6, diameter: 0.32 }, scene);
      tBarrel.rotation.x = Math.PI / 2;
      tBarrel.position.set(0, 1.7, z + 0.7);
      tBarrel.material = turretMat;
      tBarrel.parent = root;
    }

    // Underside thrusters / lights
    const lightMat = new BABYLON.StandardMaterial("bligMat", scene);
    lightMat.emissiveColor = new BABYLON.Color3(1.0, 0.35, 0.2);
    lightMat.diffuseColor = new BABYLON.Color3(1.0, 0.35, 0.2);
    lightMat.disableLighting = true;
    for (let i = 0; i < 5; i++) {
      const l = BABYLON.MeshBuilder.CreateSphere(`bligL_${i}`, { diameter: 0.45 }, scene);
      l.position.set(-2, -1.4, 8 - i * 4);
      l.material = lightMat;
      l.parent = root;
      const r = l.clone(`bligR_${i}`);
      r.position.x = 2;
      r.parent = root;
    }

    // Rear engine glows
    const engMat = new BABYLON.StandardMaterial("bengMat", scene);
    engMat.emissiveColor = new BABYLON.Color3(1.0, 0.6, 0.2);
    engMat.diffuseColor = new BABYLON.Color3(1.0, 0.6, 0.2);
    engMat.disableLighting = true;
    for (let i = 0; i < 3; i++) {
      const e = BABYLON.MeshBuilder.CreateSphere(`beng_${i}`, { diameter: 1.2 }, scene);
      e.position.set(-1.6 + i * 1.6, 0, -11.5);
      e.material = engMat;
      e.parent = root;
    }

    return { root };
  }

  private buildFortress(scene: BABYLON.Scene): { root: BABYLON.TransformNode } {
    const root = new BABYLON.TransformNode(`fortRoot_${Date.now()}_${Math.floor(Math.random()*9999)}`, scene);

    // Massive armored hull
    const hull = BABYLON.MeshBuilder.CreateBox("forthull", { width: 18, height: 4, depth: 30 }, scene);
    const hullMat = new BABYLON.StandardMaterial("forthullMat", scene);
    hullMat.diffuseColor = new BABYLON.Color3(0.18, 0.08, 0.08);
    hullMat.emissiveColor = new BABYLON.Color3(0.06, 0.02, 0.02);
    hull.material = hullMat;
    hull.parent = root;

    // Underside armor plates / wings
    const plateL = BABYLON.MeshBuilder.CreateBox("fortplateL", { width: 6, height: 1.2, depth: 22 }, scene);
    plateL.position.set(-10, -1.2, 0);
    plateL.material = hullMat;
    plateL.parent = root;
    const plateR = plateL.clone("fortplateR");
    plateR.position.x = 10;
    plateR.parent = root;

    // Stepped command tower
    const tower1 = BABYLON.MeshBuilder.CreateBox("forttower1", { width: 8, height: 2.2, depth: 9 }, scene);
    tower1.position.set(0, 3.1, -3);
    tower1.material = hullMat;
    tower1.parent = root;
    const tower2 = BABYLON.MeshBuilder.CreateBox("forttower2", { width: 5, height: 2.0, depth: 5 }, scene);
    tower2.position.set(0, 5.2, -3);
    tower2.material = hullMat;
    tower2.parent = root;

    // Glowing command bridge windows
    const winMat = new BABYLON.StandardMaterial("fortwinMat", scene);
    winMat.emissiveColor = new BABYLON.Color3(1.0, 0.25, 0.18);
    winMat.diffuseColor = new BABYLON.Color3(1.0, 0.25, 0.18);
    winMat.disableLighting = true;
    const win = BABYLON.MeshBuilder.CreateBox("fortwin", { width: 5.2, height: 0.32, depth: 5.2 }, scene);
    win.position.set(0, 5.9, -3);
    win.material = winMat;
    win.parent = root;

    // 6 turret blisters around the perimeter
    const turretMat = new BABYLON.StandardMaterial("fortTurMat", scene);
    turretMat.diffuseColor = new BABYLON.Color3(0.25, 0.10, 0.10);
    turretMat.emissiveColor = new BABYLON.Color3(0.10, 0.02, 0.02);
    const turretPos: [number, number][] = [
      [-7, 12], [7, 12], [-9, 0], [9, 0], [-7, -12], [7, -12],
    ];
    for (let i = 0; i < turretPos.length; i++) {
      const [x, z] = turretPos[i];
      const dome = BABYLON.MeshBuilder.CreateSphere(`fortTurD_${i}`, { diameter: 2.4, segments: 8 }, scene);
      dome.scaling.y = 0.6;
      dome.position.set(x, 2.1, z);
      dome.material = turretMat;
      dome.parent = root;

      const barrel = BABYLON.MeshBuilder.CreateCylinder(`fortTurB_${i}`, { height: 2.6, diameter: 0.42 }, scene);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(x, 2.3, z + 1.3);
      barrel.material = turretMat;
      barrel.parent = root;
    }

    // Underside thruster grid
    const thrustMat = new BABYLON.StandardMaterial("fortThrustMat", scene);
    thrustMat.emissiveColor = new BABYLON.Color3(1.0, 0.35, 0.18);
    thrustMat.diffuseColor = new BABYLON.Color3(1.0, 0.35, 0.18);
    thrustMat.disableLighting = true;
    for (let i = 0; i < 8; i++) {
      const t = BABYLON.MeshBuilder.CreateSphere(`fortThr_${i}`, { diameter: 0.7 }, scene);
      const col = i % 2 === 0 ? -3.2 : 3.2;
      t.position.set(col, -2.0, 12 - Math.floor(i / 2) * 8);
      t.material = thrustMat;
      t.parent = root;
    }

    // Massive rear engine glows
    const engMat = new BABYLON.StandardMaterial("fortEngMat", scene);
    engMat.emissiveColor = new BABYLON.Color3(1.0, 0.55, 0.18);
    engMat.diffuseColor = new BABYLON.Color3(1.0, 0.55, 0.18);
    engMat.disableLighting = true;
    for (let i = 0; i < 4; i++) {
      const e = BABYLON.MeshBuilder.CreateSphere(`fortEng_${i}`, { diameter: 2.0 }, scene);
      e.position.set(-3 + i * 2, 0, -15.5);
      e.material = engMat;
      e.parent = root;
    }

    return { root };
  }

  takeDamage(amount: number, hitPoint?: BABYLON.Vector3): boolean {
    if (!this.isAlive) return false;
    this.health = Math.max(0, this.health - amount);
    this.flashRed();
    this.shakeTimer = 0.18;

    const now = performance.now();
    if (now - this.lastHitFxAt > 80) {
      this.lastHitFxAt = now;
      const impactPos = hitPoint ? hitPoint.clone() : this.hitbox.position.clone();
      this.bus.emit("effect:hitImpact", {
        position: impactPos,
        color: new BABYLON.Color3(1.0, 0.8, 0.25),
        scale: this.kind === "battleship" ? 2.0 : 1.1,
      });
    }

    this.bus.emit(GameEvents.ENEMY_DAMAGED, {
      damage: amount,
      position: this.hitbox.position.clone(),
    });

    if (this.health <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  private flashRed(): void {
    const RED = new BABYLON.Color3(1.0, 0.12, 0.12);
    for (const o of this.originalEmissives) o.mat.emissiveColor = RED;
    setTimeout(() => {
      for (const o of this.originalEmissives) {
        if (o.mat) o.mat.emissiveColor = o.color;
      }
    }, 160);
  }

  private die(): void {
    if (!this.isAlive) return;
    this.isAlive = false;

    const credits = this.kind === "fortress" ? 800 : this.kind === "battleship" ? 250 : 60;
    const exp = this.kind === "fortress" ? 600 : this.kind === "battleship" ? 200 : 45;
    const explosionScale = this.kind === "fortress" ? 6.0 : this.kind === "battleship" ? 4.0 : 2.0;
    const enemyType = this.kind === "fortress"
      ? "aerial_fortress"
      : this.kind === "battleship"
      ? "aerial_battleship"
      : "aerial_fighter";

    // Big explosion
    this.bus.emit("effect:hitImpact", {
      position: this.hitbox.position.clone(),
      color: new BABYLON.Color3(1.0, 0.55, 0.1),
      scale: explosionScale,
    });

    // Loot drops via EnemyKilled event so PickupSystem handles them
    this.bus.emit(GameEvents.ENEMY_KILLED, {
      type: enemyType,
      credits,
      experience: exp,
      position: this.hitbox.position.clone(),
    });

    // Allow visual to drop briefly then dispose
    setTimeout(() => this.dispose(), 1500);
  }

  update(dt: number, playerPos: BABYLON.Vector3): number {
    if (!this.isAlive) {
      // Falling
      this.hitbox.position.y = Math.max(0, this.hitbox.position.y - 18 * dt);
      this.visual.rotation.x += dt * 1.5;
      this.visual.rotation.z += dt * 0.8;
      return 0;
    }

    let damageToPlayer = 0;

    if (this.kind === "fighter") {
      // Orbit + occasional dive
      this.orbitAngle += (this.speed / this.orbitRadius) * dt;
      const targetX = playerPos.x + Math.cos(this.orbitAngle) * this.orbitRadius;
      const targetZ = playerPos.z + Math.sin(this.orbitAngle) * this.orbitRadius;
      const targetY = this.orbitAltitude + Math.sin(performance.now() * 0.001 + this.orbitAngle) * 1.5;

      this.hitbox.position.x += (targetX - this.hitbox.position.x) * Math.min(1, dt * 1.1);
      this.hitbox.position.y += (targetY - this.hitbox.position.y) * Math.min(1, dt * 1.0);
      this.hitbox.position.z += (targetZ - this.hitbox.position.z) * Math.min(1, dt * 1.1);

      // Face the player
      const toPlayer = playerPos.subtract(this.hitbox.position);
      this.visual.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);

      // Fire periodically — only when engaged AND with clear line of sight.
      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0 && this.aggro) {
        this.fireCooldown = 2.2 + Math.random() * 1.2;
        if (this.hasLineOfSight(playerPos)) {
          damageToPlayer += this.fireAtPlayer(playerPos, 12, 0.6);
        }
      }
    } else if (this.kind === "battleship") {
      // Battleship — slow drift
      this.orbitAngle += (this.speed / this.orbitRadius) * dt;
      const targetX = playerPos.x + Math.cos(this.orbitAngle) * this.orbitRadius;
      const targetZ = playerPos.z + Math.sin(this.orbitAngle) * this.orbitRadius;
      this.hitbox.position.x += (targetX - this.hitbox.position.x) * Math.min(1, dt * 0.4);
      this.hitbox.position.y += (this.orbitAltitude - this.hitbox.position.y) * Math.min(1, dt * 0.5);
      this.hitbox.position.z += (targetZ - this.hitbox.position.z) * Math.min(1, dt * 0.4);

      const toPlayer = playerPos.subtract(this.hitbox.position);
      this.visual.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);

      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0 && this.aggro) {
        this.fireCooldown = 2.4 + Math.random() * 1.5;
        if (this.hasLineOfSight(playerPos)) {
          damageToPlayer += this.fireAtPlayer(playerPos, 28, 1.4);
        }
      }
    } else {
      // Fortress — very slow drift at high altitude, heavy multi-turret fire.
      // While passive, orbit a fixed world point so they look like neutral
      // landmarks rather than always shadowing the player. Once aggro'd they
      // re-anchor on the player's position.
      const center = this.aggro ? playerPos : this.patrolCenter;
      this.orbitAngle += (this.speed / this.orbitRadius) * dt;
      const targetX = center.x + Math.cos(this.orbitAngle) * this.orbitRadius;
      const targetZ = center.z + Math.sin(this.orbitAngle) * this.orbitRadius;
      this.hitbox.position.x += (targetX - this.hitbox.position.x) * Math.min(1, dt * 0.25);
      this.hitbox.position.y += (this.orbitAltitude - this.hitbox.position.y) * Math.min(1, dt * 0.4);
      this.hitbox.position.z += (targetZ - this.hitbox.position.z) * Math.min(1, dt * 0.25);

      // Face along travel direction (or toward the player when aggro'd)
      const facing = this.aggro
        ? playerPos.subtract(this.hitbox.position)
        : new BABYLON.Vector3(-Math.sin(this.orbitAngle), 0, Math.cos(this.orbitAngle));
      this.visual.rotation.y = Math.atan2(facing.x, facing.z);

      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0 && this.aggro) {
        this.fireCooldown = 1.8 + Math.random() * 1.0;
        if (this.hasLineOfSight(playerPos)) {
          // Fortress fires a 3-shot turret salvo
          damageToPlayer += this.fireAtPlayer(playerPos, 22, 1.1);
          damageToPlayer += this.fireAtPlayer(playerPos, 22, 1.1);
          damageToPlayer += this.fireAtPlayer(playerPos, 22, 1.1);
        }
      }
    }

    // Hit-shake
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      const intensity = 0.25 * (this.shakeTimer / 0.18);
      this.hitbox.position.x += (Math.random() - 0.5) * intensity;
      this.hitbox.position.z += (Math.random() - 0.5) * intensity;
    }

    return damageToPlayer;
  }

  /**
   * Returns true if the segment from this unit's gun to the player is not
   * blocked by any registered city wall. Aerial enemies skip their shot
   * entirely (no tracer, no damage) when LOS is blocked, so a player who runs
   * inside a building cannot be hit through the walls.
   */
  private hasLineOfSight(playerPos: BABYLON.Vector3): boolean {
    if (this.walls.length === 0) return true;
    const p0 = this.hitbox.position;
    const p1 = playerPos;
    for (const w of this.walls) {
      if (!segmentInsideRange(p0, p1, w)) continue;
      if (segmentHitsAABB(p0, p1, w)) return false;
    }
    return true;
  }

  // Returns damage that hit the player this frame (immediate hit-scan style for simplicity).
  private fireAtPlayer(playerPos: BABYLON.Vector3, damage: number, sizeScale: number): number {
    const scene = this.hitbox.getScene();
    const origin = this.hitbox.position.clone();
    const dir = playerPos.subtract(origin).normalize();
    const dist = BABYLON.Vector3.Distance(origin, playerPos);

    // Visual tracer
    const tracer = BABYLON.MeshBuilder.CreateCylinder(`aerialTracer_${Date.now()}_${Math.floor(Math.random()*9999)}`, {
      height: dist,
      diameter: 0.18 * sizeScale,
      tessellation: 8,
    }, scene);
    const mat = new BABYLON.StandardMaterial("aerialTracerMat", scene);
    mat.emissiveColor = new BABYLON.Color3(1.0, 0.3, 0.15);
    mat.diffuseColor = new BABYLON.Color3(1.0, 0.3, 0.15);
    mat.disableLighting = true;
    tracer.material = mat;
    const mid = origin.add(dir.scale(dist * 0.5));
    tracer.position.copyFrom(mid);
    // Cylinder default axis is Y; rotate to match dir
    const upY = new BABYLON.Vector3(0, 1, 0);
    const axis = BABYLON.Vector3.Cross(upY, dir);
    const angle = Math.acos(BABYLON.Vector3.Dot(upY, dir));
    if (axis.length() > 0.0001) tracer.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis.normalize(), angle);

    setTimeout(() => {
      mat.dispose();
      tracer.dispose();
    }, 120);

    // Accuracy / dodge: 70% hit rate base; less if player is fast-moving/airborne (kept simple)
    const hit = Math.random() < 0.7;
    return hit ? damage : 0;
  }

  getMesh(): BABYLON.Mesh { return this.hitbox; }
  getPosition(): BABYLON.Vector3 { return this.hitbox.position; }
  // EnemyLike compatibility for EnemyHealthBarSystem
  get mesh(): BABYLON.Mesh { return this.hitbox; }

  dispose(): void {
    this.isAlive = false;
    this.originalEmissives = [];
    // NOTE: Disposing materials here while the engine may still hold a bound
    // effect/program for the just-disposed meshes was causing a crash:
    //   `Cannot read properties of null (reading 'program')` inside
    //   _Engine.bindSamplers → _StandardMaterial._preBind.
    // The materials are released by Babylon when the scene is torn down;
    // for in-game disposal we leave them alone (matches the long-standing
    // pattern used by the rest of the game).
    if (this.visual) this.visual.dispose();
    if (this.hitbox) this.hitbox.dispose();
    this.ownedMaterials = [];
  }
}

export class AerialEnemySystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private units: AerialUnit[] = [];
  private spawnCooldown: number = 4;
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private walls: WallCollider[] = [];

  /**
   * Aggro gate. False at game start — fighters/battleships are not spawned
   * and existing fortresses patrol silently. Becomes true the first time the
   * player attacks an enemy base, mothership, fortress, or any aerial unit.
   * Once raised it stays raised for the rest of the session.
   */
  private aggro: boolean = false;

  private static readonly MAX_FIGHTERS = 4;
  private static readonly MAX_BATTLESHIPS = 1;
  private static readonly MAX_FORTRESSES = 3;
  // Once the player wipes out every Flying Fortress, the squadron stays away
  // for this long before any can respawn (5 minutes). Prevents the fortresses
  // from re-appearing seconds after a hard-fought victory.
  private static readonly FORTRESS_REGROUP_SECONDS = 300;
  /** When the player wipes out the ENTIRE aerial roster (fighters,
   *  battleships, AND fortresses), all aerial spawns are suppressed for
   *  this long. This is what players really mean when they say "the air
   *  cleared after I beat them" — they want a real break, not just a
   *  fortress break. */
  private static readonly SKIES_CLEARED_REGROUP_SECONDS = 300;
  /** Counts down after the last live fortress dies; while > 0, no fortress respawn. */
  private fortressRegroupTimer: number = 0;
  /** Timer that suppresses ALL aerial spawns (fighters, battleships, and
   *  fortresses) once the entire roster has been wiped. Independent of
   *  the fortress-only timer so the two regroups can co-exist. */
  private skiesClearedTimer: number = 0;
  /** True once the player has had at least one aerial unit alive since
   *  the last skies-cleared event — gates the "skies just emptied"
   *  edge detection so we don't trigger the lockout at game start. */
  private aerialEverAlive: boolean = false;
  /** Tracks whether at least one fortress was alive last tick, so we know when "all" just died. */
  private fortressesEverAlive: boolean = false;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    console.log("[AerialEnemySystem] Initialized");
  }

  setPlayerPosition(pos: BABYLON.Vector3): void {
    this.playerPos.copyFrom(pos);
  }

  /** Pass the city's wall AABBs so units can LOS-check the player. */
  setWallColliders(walls: WallCollider[]): void {
    this.walls = walls;
    for (const u of this.units) u.walls = walls;
  }

  /**
   * Promote the squadron to attack mode. Called when the player damages an
   * enemy base, a battleship/fortress, or any aerial fighter. Idempotent.
   */
  engage(): void {
    if (this.aggro) return;
    this.aggro = true;
    for (const u of this.units) u.aggro = true;
    console.log("[AerialEnemySystem] AGGRO engaged — aerial squadron will now attack");
    this.bus.emit(GameEvents.UI_MESSAGE, "AERIAL THREAT ENGAGED");
  }

  /** Hard kill-switch for the entire drip-spawn loop. Used by Versus mode
   *  so a PvP arena isn't littered with patrolling fortresses. When false,
   *  update() still ticks existing units (so disposes/cleanup run) but
   *  spawnFighter/spawnBattleship/spawnFortress AND the periodic auto-spawn
   *  block in update() are all silenced. */
  private spawningEnabled: boolean = true;
  setSpawningEnabled(enabled: boolean): void { this.spawningEnabled = enabled; }

  /** Drop aggro and despawn every active aerial unit. Used by Game.tsx's
   *  LEVEL_STARTED handler when warping into the peaceful sanctuary so the
   *  player doesn't trail combat units from a prior front. */
  disengageAndClear(): void {
    this.aggro = false;
    for (const u of this.units) {
      try { u.dispose(); } catch {}
    }
    this.units = [];
  }

  isAggro(): boolean { return this.aggro; }

  /** Orbital-Front anchor. When non-null, every spawn (and any existing
   *  unit) re-anchors its orbit altitude to `playerY + perKindOffset` so
   *  the squadron actually fights at the player's altitude in vacuum.
   *  SpaceLevelSystem sets this on warp-in and clears it on warp-out. */
  private spaceAltitudeAnchor: (() => number) | null = null;
  private static readonly SPACE_ALT_OFFSETS = { fighter: -6, battleship: 6, fortress: 24 };
  setSpaceCombat(active: boolean, playerYProvider?: () => number): void {
    if (active && playerYProvider) {
      this.spaceAltitudeAnchor = playerYProvider;
      // Re-anchor existing units so they immediately migrate up to the
      // player's altitude band instead of waiting for natural respawn.
      const py = playerYProvider();
      for (const u of this.units) {
        const off = AerialEnemySystem.SPACE_ALT_OFFSETS[u.kind] ?? 0;
        u.orbitAltitude = py + off;
        u.hitbox.position.y = u.orbitAltitude;
      }
    } else {
      this.spaceAltitudeAnchor = null;
    }
  }

  /** Returns the altitude a newly-spawned unit of `kind` should orbit at,
   *  honouring the orbital-front anchor when active. */
  private spawnAltitudeFor(kind: AerialKind): number {
    if (this.spaceAltitudeAnchor) {
      return this.spaceAltitudeAnchor() + AerialEnemySystem.SPACE_ALT_OFFSETS[kind];
    }
    if (kind === "fighter") return 28 + Math.random() * 12;
    if (kind === "battleship") return 55;
    return 75;
  }

  spawnFighter(playerPos: BABYLON.Vector3): AerialUnit {
    // The kill-switch must guard the public spawners too — Game.tsx calls
    // spawnFortress() three times at init for the open-world ambience, and
    // we don't want those to fire when the player picked Versus.
    if (!this.spawningEnabled) return null as any;
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 30;
    const altY = this.spawnAltitudeFor("fighter");
    const pos = new BABYLON.Vector3(
      playerPos.x + Math.cos(angle) * dist,
      altY,
      playerPos.z + Math.sin(angle) * dist
    );
    const u = new AerialUnit(this.scene, "fighter", pos);
    u.walls = this.walls;
    u.aggro = this.aggro;
    this.units.push(u);
    this.bus.emit(GameEvents.ENEMY_SPAWNED, { type: "aerial_fighter", position: pos });
    return u;
  }

  spawnBattleship(playerPos: BABYLON.Vector3): AerialUnit {
    if (!this.spawningEnabled) return null as any;
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 30;
    const pos = new BABYLON.Vector3(
      playerPos.x + Math.cos(angle) * dist,
      this.spawnAltitudeFor("battleship"),
      playerPos.z + Math.sin(angle) * dist
    );
    const u = new AerialUnit(this.scene, "battleship", pos);
    u.walls = this.walls;
    u.aggro = this.aggro;
    this.units.push(u);
    this.bus.emit(GameEvents.ENEMY_SPAWNED, { type: "aerial_battleship", position: pos });
    return u;
  }

  spawnFortress(playerPos: BABYLON.Vector3): AerialUnit {
    if (!this.spawningEnabled) return null as any;
    // Fortresses get a fixed world-anchored patrol center so they don't
    // shadow the player while passive. Centers are spread around the world
    // so multiple fortresses don't stack on top of each other.
    const fortIndex = this.units.filter(u => u.kind === "fortress").length;
    const baseAngle = (fortIndex * (Math.PI * 2 / 3)) + Math.random() * 0.8;
    const baseDist = 240 + Math.random() * 120;
    const center = new BABYLON.Vector3(
      Math.cos(baseAngle) * baseDist,
      75,
      Math.sin(baseAngle) * baseDist
    );
    const angle = Math.random() * Math.PI * 2;
    const dist = 130 + Math.random() * 40;
    const pos = new BABYLON.Vector3(
      playerPos.x + Math.cos(angle) * dist,
      this.spawnAltitudeFor("fortress"),
      playerPos.z + Math.sin(angle) * dist
    );
    const u = new AerialUnit(this.scene, "fortress", pos);
    u.walls = this.walls;
    u.aggro = this.aggro;
    u.patrolCenter = center;
    this.units.push(u);
    this.bus.emit(GameEvents.ENEMY_SPAWNED, { type: "aerial_fortress", position: pos });
    return u;
  }

  update(dt: number, playerPos: BABYLON.Vector3): { damage: number } {
    this.playerPos.copyFrom(playerPos);
    let totalDamage = 0;

    // Drip-spawn squadron. Fortresses always patrol the skies (a few flying
    // landmarks). Fighters/battleships only spawn after the player picks a
    // fight (engages a base, mothership, or any aerial unit).
    this.spawnCooldown -= dt;
    // Tick down both regroup timers regardless of spawn cooldown state.
    if (this.fortressRegroupTimer > 0) this.fortressRegroupTimer -= dt;
    if (this.skiesClearedTimer > 0) this.skiesClearedTimer -= dt;

    // Detect the "last fortress just died" transition: when we previously had
    // any fortresses alive and now have zero, start the 5-minute lockout.
    const liveFortresses = this.units.filter(u => u.kind === "fortress" && u.isAlive).length;
    if (liveFortresses > 0) {
      this.fortressesEverAlive = true;
    } else if (this.fortressesEverAlive && this.fortressRegroupTimer <= 0) {
      this.fortressRegroupTimer = AerialEnemySystem.FORTRESS_REGROUP_SECONDS;
      this.fortressesEverAlive = false;
      console.log("[AerialEnemySystem] All fortresses defeated — regrouping for 5 minutes");
      this.bus.emit(GameEvents.UI_MESSAGE, "FLYING FORTRESSES ROUTED — REGROUPING");
    }

    // Detect the "skies are clear" transition: every aerial unit (fighter,
    // battleship, fortress) is dead. Trigger the global aerial lockout so
    // the player gets a real 5-minute breather before the next wave shows.
    const liveAerial = this.units.filter(u => u.isAlive).length;
    if (liveAerial > 0) {
      this.aerialEverAlive = true;
    } else if (this.aerialEverAlive && this.skiesClearedTimer <= 0) {
      this.skiesClearedTimer = AerialEnemySystem.SKIES_CLEARED_REGROUP_SECONDS;
      this.aerialEverAlive = false;
      console.log("[AerialEnemySystem] Skies cleared — all aerial spawns suppressed for 5 minutes");
      this.bus.emit(GameEvents.UI_MESSAGE, "SKIES CLEARED — AERIAL FORCES REGROUPING (5 MIN)");
    }

    // The skies-cleared lockout suppresses ALL aerial spawns (fighters,
    // battleships, AND fortresses). When active, just skip the spawn block
    // entirely so existing units still tick + clean up below.
    if (this.spawnCooldown <= 0 && this.skiesClearedTimer <= 0 && this.spawningEnabled) {
      this.spawnCooldown = 6 + Math.random() * 4;
      const fighters = this.units.filter(u => u.kind === "fighter" && u.isAlive).length;
      const battleships = this.units.filter(u => u.kind === "battleship" && u.isAlive).length;
      const fortresses = liveFortresses;

      // Fortresses only respawn after the regroup lockout expires.
      if (fortresses < AerialEnemySystem.MAX_FORTRESSES && this.fortressRegroupTimer <= 0) {
        this.spawnFortress(playerPos);
      } else if (this.aggro && fighters < AerialEnemySystem.MAX_FIGHTERS) {
        this.spawnFighter(playerPos);
      } else if (this.aggro && battleships < AerialEnemySystem.MAX_BATTLESHIPS && Math.random() < 0.4) {
        this.spawnBattleship(playerPos);
      }
    }

    // In orbital combat the player altitude can drift over time (the
    // fighter climbs/dives), so re-anchor every live unit's orbit altitude
    // each frame to keep the squadron fighting at the player's altitude
    // band instead of the original ground-level defaults.
    if (this.spaceAltitudeAnchor) {
      const py = this.spaceAltitudeAnchor();
      for (const u of this.units) {
        if (!u.isAlive) continue;
        const off = AerialEnemySystem.SPACE_ALT_OFFSETS[u.kind] ?? 0;
        u.orbitAltitude = py + off;
      }
    }

    // Update + collect damage
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      totalDamage += u.update(dt, playerPos);
      if (!u.isAlive && u.getPosition().y <= 0.1) {
        u.dispose();
        this.units.splice(i, 1);
      }
    }

    return { damage: totalDamage };
  }

  // Returns BABYLON.Mesh hitboxes so weapons.update can collide-check them
  getMeshes(): BABYLON.Mesh[] {
    const out: BABYLON.Mesh[] = [];
    for (const u of this.units) if (u.isAlive) out.push(u.getMesh());
    return out;
  }

  // Try to damage the unit owning this mesh. Returns true if found.
  damageEnemy(mesh: BABYLON.Mesh, amount: number): boolean {
    for (const u of this.units) {
      if (u.getMesh() === mesh) {
        u.takeDamage(amount, mesh.position.clone());
        return true;
      }
    }
    return false;
  }

  getUnitCount(): number { return this.units.filter(u => u.isAlive).length; }

  getActiveUnits(): AerialUnit[] {
    return this.units.filter(u => u.isAlive);
  }

  dispose(): void {
    for (const u of this.units) u.dispose();
    this.units = [];
  }
}
