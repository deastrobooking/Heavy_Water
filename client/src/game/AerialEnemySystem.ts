import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";

export type AerialKind = "fighter" | "battleship";

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
  private orbitAltitude: number;
  private fireCooldown: number = 0;
  private divePhase: number = 0; // 0 = orbit, 1 = diving, 2 = climbing
  private bus: EventBus;
  private shakeTimer: number = 0;
  private lastHitFxAt: number = 0;
  private originalEmissives: { mat: BABYLON.StandardMaterial; color: BABYLON.Color3 }[] = [];

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
    } else {
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
    }
    this.health = this.maxHealth;
    this.orbitAngle = Math.random() * Math.PI * 2;

    const built = kind === "fighter"
      ? this.buildFighter(scene)
      : this.buildBattleship(scene);
    this.visual = built.root;

    const hitR = kind === "fighter" ? 2.4 : 7.5;
    const hitH = kind === "fighter" ? 2 : 4;
    this.hitbox = BABYLON.MeshBuilder.CreateCapsule(`aerialHit_${kind}_${Date.now()}_${Math.floor(Math.random()*9999)}`, {
      height: hitH,
      radius: hitR,
    }, scene);
    this.hitbox.isVisible = false;
    this.hitbox.position.copyFrom(position);
    this.hitbox.metadata = { hitRadius: hitR, aerialUnit: this };
    this.visual.parent = this.hitbox;

    // Track original emissives for red-flash on hit
    const collect = (n: BABYLON.Node) => {
      const m = (n as BABYLON.AbstractMesh).material as BABYLON.StandardMaterial | null;
      if (m && m.emissiveColor) {
        this.originalEmissives.push({ mat: m, color: m.emissiveColor.clone() });
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

    const credits = this.kind === "battleship" ? 250 : 60;
    const exp = this.kind === "battleship" ? 200 : 45;

    // Big explosion
    this.bus.emit("effect:hitImpact", {
      position: this.hitbox.position.clone(),
      color: new BABYLON.Color3(1.0, 0.55, 0.1),
      scale: this.kind === "battleship" ? 4.0 : 2.0,
    });

    // Loot drops via EnemyKilled event so PickupSystem handles them
    this.bus.emit(GameEvents.ENEMY_KILLED, {
      type: this.kind === "battleship" ? "aerial_battleship" : "aerial_fighter",
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

      // Fire periodically
      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0) {
        this.fireCooldown = 2.2 + Math.random() * 1.2;
        damageToPlayer += this.fireAtPlayer(playerPos, 12, 0.6);
      }
    } else {
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
      if (this.fireCooldown <= 0) {
        this.fireCooldown = 2.4 + Math.random() * 1.5;
        damageToPlayer += this.fireAtPlayer(playerPos, 28, 1.4);
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
    if (this.visual) this.visual.dispose();
    if (this.hitbox) this.hitbox.dispose();
  }
}

export class AerialEnemySystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private units: AerialUnit[] = [];
  private spawnCooldown: number = 4;
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();

  private static readonly MAX_FIGHTERS = 4;
  private static readonly MAX_BATTLESHIPS = 1;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    console.log("[AerialEnemySystem] Initialized");
  }

  setPlayerPosition(pos: BABYLON.Vector3): void {
    this.playerPos.copyFrom(pos);
  }

  spawnFighter(playerPos: BABYLON.Vector3): AerialUnit {
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 30;
    const pos = new BABYLON.Vector3(
      playerPos.x + Math.cos(angle) * dist,
      28 + Math.random() * 12,
      playerPos.z + Math.sin(angle) * dist
    );
    const u = new AerialUnit(this.scene, "fighter", pos);
    this.units.push(u);
    this.bus.emit(GameEvents.ENEMY_SPAWNED, { type: "aerial_fighter", position: pos });
    return u;
  }

  spawnBattleship(playerPos: BABYLON.Vector3): AerialUnit {
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 30;
    const pos = new BABYLON.Vector3(
      playerPos.x + Math.cos(angle) * dist,
      55,
      playerPos.z + Math.sin(angle) * dist
    );
    const u = new AerialUnit(this.scene, "battleship", pos);
    this.units.push(u);
    this.bus.emit(GameEvents.ENEMY_SPAWNED, { type: "aerial_battleship", position: pos });
    return u;
  }

  update(dt: number, playerPos: BABYLON.Vector3): { damage: number } {
    this.playerPos.copyFrom(playerPos);
    let totalDamage = 0;

    // Drip-spawn fighters/battleships
    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0) {
      this.spawnCooldown = 6 + Math.random() * 4;
      const fighters = this.units.filter(u => u.kind === "fighter" && u.isAlive).length;
      const battleships = this.units.filter(u => u.kind === "battleship" && u.isAlive).length;
      if (fighters < AerialEnemySystem.MAX_FIGHTERS) {
        this.spawnFighter(playerPos);
      } else if (battleships < AerialEnemySystem.MAX_BATTLESHIPS && Math.random() < 0.4) {
        this.spawnBattleship(playerPos);
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
