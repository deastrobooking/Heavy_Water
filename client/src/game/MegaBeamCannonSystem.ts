import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";

/**
 * Mega Beam Cannon — the Beam-Sabre + Weapon combo special.
 *
 * Triggered when the player presses the beam attack and the weapon attack
 * within a small window (see Game.tsx input handling). Fires a swarm of
 * 20 self-seeking missiles plus one huge Kamehameha-style energy beam.
 *
 * The beam visual is a stack of layered emissive cylinders (white core +
 * cyan halo + outer glow) extending from the player's aim origin out to a
 * fixed range, with a charge orb at the muzzle and a tip impact flash.
 * Damage is dealt once per enemy when their hit-volume first intersects
 * the ray, so each enemy in the beam path takes one massive tick.
 */

interface CannonMissile {
  mesh: BABYLON.Mesh;
  velocity: BABYLON.Vector3;
  lifetime: number;
  damage: number;
  trackingSpeed: number;
  explosionRadius: number;
}

interface ActiveBeam {
  origin: BABYLON.Vector3;
  direction: BABYLON.Vector3;
  length: number;
  radius: number;
  damage: number;
  lifetime: number;
  elapsed: number;
  meshes: BABYLON.Mesh[];
  muzzleMesh: BABYLON.Mesh | null;
  light: BABYLON.PointLight | null;
  hit: Set<BABYLON.AbstractMesh>;
}

export class MegaBeamCannonSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private bus: EventBus;
  private aimOriginProvider: (() => BABYLON.Vector3) | null = null;
  private damageRouter: ((mesh: BABYLON.AbstractMesh, dmg: number) => void) | null = null;

  private missiles: CannonMissile[] = [];
  private beams: ActiveBeam[] = [];
  // All time values are in SECONDS; Game.tsx feeds `dt` as deltaTime/1000.
  private cooldown: number = 0;
  private readonly cooldownDuration: number = 6;

  // Beam tuning
  private readonly beamLength: number = 220;
  private readonly beamRadius: number = 5;
  private readonly beamDamage: number = 1800;
  private readonly beamLifetime: number = 1.4;

  // Missile tuning
  private readonly missileCount: number = 20;
  private readonly missileDamage: number = 90;
  private readonly missileExplosionRadius: number = 5;
  private readonly missileTrackingSpeed: number = 0.16;

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.bus = EventBus.getInstance();
  }

  setAimOriginProvider(fn: () => BABYLON.Vector3): void {
    this.aimOriginProvider = fn;
  }

  setDamageRouter(fn: (mesh: BABYLON.AbstractMesh, dmg: number) => void): void {
    this.damageRouter = fn;
  }

  private getAimOrigin(): BABYLON.Vector3 {
    return this.aimOriginProvider ? this.aimOriginProvider() : this.camera.position;
  }

  isReady(): boolean {
    return this.cooldown <= 0;
  }

  getCooldownFraction(): number {
    return Math.max(0, Math.min(1, this.cooldown / this.cooldownDuration));
  }

  /** Master enable gate — flipped off in space so the player can't fire. */
  private firingEnabled: boolean = true;
  setFiringEnabled(enabled: boolean): void {
    this.firingEnabled = enabled;
  }

  /** Fire the combo. Returns true if it actually fired (was off cooldown). */
  fire(): boolean {
    if (!this.firingEnabled) return false;
    if (this.cooldown > 0) return false;
    this.cooldown = this.cooldownDuration;

    const origin = this.getAimOrigin();
    const forward = this.camera.getDirection(BABYLON.Vector3.Forward()).normalize();

    this.spawnBeam(origin, forward);
    this.spawnMissiles(origin, forward);

    this.bus.emit(GameEvents.UI_MESSAGE, {
      text: "MEGA BEAM CANNON!",
      duration: 1.4,
    });
    this.bus.emit(GameEvents.WEAPON_FIRED);
    return true;
  }

  private spawnBeam(origin: BABYLON.Vector3, forward: BABYLON.Vector3): void {
    // The beam is a stack of three coaxial cylinders for that classic
    // anime "white core + cyan halo + soft outer glow" look. Each is
    // built along world-Y (the default cylinder orientation), then
    // rotated to face `forward` and translated so its base sits at the
    // muzzle and its tip extends `beamLength` units forward.
    const muzzle = origin.add(forward.scale(2.0));
    const center = muzzle.add(forward.scale(this.beamLength * 0.5));

    const cylConfigs = [
      { diameter: this.beamRadius * 0.55, color: new BABYLON.Color3(1, 1, 1), alpha: 1.0 },
      { diameter: this.beamRadius * 1.15, color: new BABYLON.Color3(0.55, 0.95, 1.0), alpha: 0.65 },
      { diameter: this.beamRadius * 1.85, color: new BABYLON.Color3(0.1, 0.55, 1.0), alpha: 0.32 },
    ];

    const meshes: BABYLON.Mesh[] = [];
    for (let i = 0; i < cylConfigs.length; i++) {
      const cfg = cylConfigs[i];
      const cyl = BABYLON.MeshBuilder.CreateCylinder(`megaBeam_${i}_${Date.now()}`, {
        height: this.beamLength,
        diameter: cfg.diameter,
        tessellation: 18,
      }, this.scene);
      const mat = new BABYLON.StandardMaterial(`megaBeamMat_${i}`, this.scene);
      mat.emissiveColor = cfg.color;
      mat.diffuseColor = cfg.color;
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mat.alpha = cfg.alpha;
      mat.disableLighting = true;
      cyl.material = mat;
      cyl.isPickable = false;
      cyl.position.copyFrom(center);
      // Orient cylinder along forward. Default cylinder long axis is +Y.
      // NOTE: `FromUnitVectorsToRef` returns void (it writes into the ref
      // param), so the previous code accidentally assigned `undefined` to
      // rotationQuaternion and the beam stayed vertical, shooting straight
      // up ~110m in front of the player — invisible from the camera. Build
      // the quaternion explicitly and assign it after.
      const q = new BABYLON.Quaternion();
      BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Vector3.Up(), forward, q);
      cyl.rotationQuaternion = q;
      meshes.push(cyl);
    }

    // Muzzle charge orb
    const muzzleMesh = BABYLON.MeshBuilder.CreateSphere(`megaBeamMuzzle_${Date.now()}`, {
      diameter: this.beamRadius * 2.4,
      segments: 16,
    }, this.scene);
    const mmat = new BABYLON.StandardMaterial("megaBeamMuzzleMat", this.scene);
    mmat.emissiveColor = new BABYLON.Color3(0.85, 0.98, 1.0);
    mmat.diffuseColor = new BABYLON.Color3(0.85, 0.98, 1.0);
    mmat.alpha = 0.85;
    mmat.disableLighting = true;
    muzzleMesh.material = mmat;
    muzzleMesh.isPickable = false;
    muzzleMesh.position.copyFrom(muzzle);

    // Bright fill light for the moment of fire
    const light = new BABYLON.PointLight(`megaBeamLight_${Date.now()}`, muzzle.clone(), this.scene);
    light.diffuse = new BABYLON.Color3(0.55, 0.9, 1.0);
    light.specular = new BABYLON.Color3(1, 1, 1);
    light.intensity = 10;
    light.range = 60;

    // Glow integration
    const glow = this.scene.effectLayers?.find(l => l instanceof BABYLON.GlowLayer) as BABYLON.GlowLayer | undefined;
    if (glow) {
      for (const m of meshes) glow.addIncludedOnlyMesh(m);
      glow.addIncludedOnlyMesh(muzzleMesh);
    }

    this.beams.push({
      origin: muzzle.clone(),
      direction: forward.clone(),
      length: this.beamLength,
      radius: this.beamRadius,
      damage: this.beamDamage,
      lifetime: this.beamLifetime,
      elapsed: 0,
      meshes,
      muzzleMesh,
      light,
      hit: new Set(),
    });
  }

  private spawnMissiles(origin: BABYLON.Vector3, forward: BABYLON.Vector3): void {
    const right = this.camera.getDirection(BABYLON.Vector3.Right()).normalize();
    const up = this.camera.getDirection(BABYLON.Vector3.Up()).normalize();

    for (let i = 0; i < this.missileCount; i++) {
      const mesh = BABYLON.MeshBuilder.CreateCylinder(`megaCannonMissile_${i}_${Date.now()}`, {
        height: 0.7,
        diameter: 0.18,
        tessellation: 8,
      }, this.scene);
      const mat = new BABYLON.StandardMaterial("megaCannonMissileMat", this.scene);
      mat.emissiveColor = new BABYLON.Color3(1, 0.45, 0.85);
      mat.diffuseColor = new BABYLON.Color3(1, 0.4, 0.85);
      mat.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.rotation.x = Math.PI / 2;

      // Spiral spread around the aim direction so missiles fan out in a
      // satisfying corkscrew before they lock onto targets.
      const angle = (i / this.missileCount) * Math.PI * 2;
      const spreadRadius = 1.5;
      const lateral = right.scale(Math.cos(angle) * spreadRadius)
        .add(up.scale(Math.sin(angle) * spreadRadius));
      mesh.position = origin.add(forward.scale(2.5)).add(lateral);

      // Initial velocity: forward + outward burst. Outward component decays
      // quickly because the homing routine will overwrite direction once a
      // target is acquired.
      const initialDir = forward.add(lateral.scale(0.35)).normalize();
      const speed = 0.55;

      this.missiles.push({
        mesh,
        // Velocity is stored in "units per 60-fps-frame" so legacy increment
        // values (0.025/frame, max 1.4/frame) read naturally; we scale by
        // (dt * 60) when integrating position so it's framerate-independent.
        velocity: initialDir.scale(speed),
        lifetime: 6.5,
        damage: this.missileDamage,
        trackingSpeed: this.missileTrackingSpeed,
        explosionRadius: this.missileExplosionRadius,
      });
    }
  }

  update(dt: number, enemies: BABYLON.AbstractMesh[], _playerPos: BABYLON.Vector3): { hitEnemy: BABYLON.AbstractMesh; damage: number }[] {
    const hits: { hitEnemy: BABYLON.AbstractMesh; damage: number }[] = [];

    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
    }

    // ---- Beam update ----
    for (let bi = this.beams.length - 1; bi >= 0; bi--) {
      const beam = this.beams[bi];
      beam.elapsed += dt;
      const t = beam.elapsed / beam.lifetime;

      // Fade out + slight scale pulse over lifetime
      const fade = Math.max(0, 1 - t);
      const pulse = 1 + Math.sin(beam.elapsed * 30) * 0.05;
      for (let mi = 0; mi < beam.meshes.length; mi++) {
        const m = beam.meshes[mi];
        if (!m.material) continue;
        const mat = m.material as BABYLON.StandardMaterial;
        const baseAlpha = mi === 0 ? 1.0 : mi === 1 ? 0.65 : 0.32;
        mat.alpha = baseAlpha * fade;
        m.scaling.x = pulse;
        m.scaling.z = pulse;
      }
      if (beam.muzzleMesh && beam.muzzleMesh.material) {
        const mmat = beam.muzzleMesh.material as BABYLON.StandardMaterial;
        mmat.alpha = 0.85 * fade;
        beam.muzzleMesh.scaling.setAll(1 + Math.sin(beam.elapsed * 22) * 0.15);
      }
      if (beam.light) {
        beam.light.intensity = 10 * fade;
      }

      // Damage pass: any enemy whose center sits within `beamRadius +
      // enemyHitRadius` of the beam segment gets hit once.
      const ox = beam.origin.x, oy = beam.origin.y, oz = beam.origin.z;
      const dx = beam.direction.x, dy = beam.direction.y, dz = beam.direction.z;
      const len = beam.length;
      for (const e of enemies) {
        if (!e || e.isDisposed?.() || beam.hit.has(e)) continue;
        const ex = e.position.x - ox;
        const ey = e.position.y - oy;
        const ez = e.position.z - oz;
        // Project onto beam direction
        const proj = ex * dx + ey * dy + ez * dz;
        if (proj < 0 || proj > len) continue;
        // Perpendicular distance squared
        const cx = ex - dx * proj;
        const cy = ey - dy * proj;
        const cz = ez - dz * proj;
        const perpSq = cx * cx + cy * cy + cz * cz;
        const meshHitR = (e.metadata as any)?.hitRadius ?? 1.5;
        const hitR = beam.radius + meshHitR;
        if (perpSq < hitR * hitR) {
          beam.hit.add(e);
          if (this.damageRouter) this.damageRouter(e, beam.damage);
          hits.push({ hitEnemy: e, damage: beam.damage });
          this.bus.emit(GameEvents.UI_DAMAGE_NUMBER, {
            position: e.position.clone(),
            damage: beam.damage,
            isCritical: true,
          });
        }
      }

      if (beam.elapsed >= beam.lifetime) {
        for (const m of beam.meshes) {
          m.material?.dispose();
          m.dispose();
        }
        if (beam.muzzleMesh) {
          beam.muzzleMesh.material?.dispose();
          beam.muzzleMesh.dispose();
        }
        beam.light?.dispose();
        this.beams.splice(bi, 1);
      }
    }

    // ---- Missile update (homing) ----
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.lifetime -= dt;
      if (m.lifetime <= 0) {
        m.mesh.material?.dispose();
        m.mesh.dispose();
        this.missiles.splice(i, 1);
        continue;
      }

      // Acquire nearest live enemy
      let nearest: BABYLON.AbstractMesh | null = null;
      let bestDistSq = Infinity;
      const px = m.mesh.position.x;
      const py = m.mesh.position.y;
      const pz = m.mesh.position.z;
      for (let k = 0; k < enemies.length; k++) {
        const e = enemies[k];
        if (!e || e.isDisposed?.()) continue;
        const dx = e.position.x - px;
        const dy = e.position.y - py;
        const dz = e.position.z - pz;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          nearest = e;
        }
      }

      // Convert dt (seconds) into frames-at-60fps so the per-frame tuning
      // constants below behave the same regardless of actual framerate.
      const frames = dt * 60;

      if (nearest) {
        const desired = nearest.position.subtract(m.mesh.position).normalize();
        const trackStep = Math.min(1, m.trackingSpeed * frames);
        const newDir = BABYLON.Vector3.Lerp(m.velocity.normalize(), desired, trackStep);
        const speed = Math.min(1.4, m.velocity.length() + 0.025 * frames);
        m.velocity = newDir.normalize().scale(speed);

        const lookDir = m.velocity.normalize();
        const yaw = Math.atan2(lookDir.x, lookDir.z);
        const pitch = -Math.asin(Math.max(-1, Math.min(1, lookDir.y)));
        m.mesh.rotation = new BABYLON.Vector3(pitch + Math.PI / 2, yaw, 0);
      }

      m.mesh.position.addInPlace(m.velocity.scale(frames));

      // Collision check
      let detonated = false;
      for (let k = 0; k < enemies.length; k++) {
        const e = enemies[k];
        if (!e || e.isDisposed?.()) continue;
        const dx = e.position.x - m.mesh.position.x;
        const dy = e.position.y - m.mesh.position.y;
        const dz = e.position.z - m.mesh.position.z;
        const dSq = dx * dx + dy * dy + dz * dz;
        const meshHitR = (e.metadata as any)?.hitRadius ?? 1.5;
        const trigger = (1.4 + meshHitR);
        if (dSq < trigger * trigger) {
          this.detonateMissile(m, enemies, hits);
          detonated = true;
          break;
        }
      }
      if (detonated) {
        this.missiles.splice(i, 1);
      }
    }

    return hits;
  }

  private detonateMissile(
    m: CannonMissile,
    enemies: BABYLON.AbstractMesh[],
    hits: { hitEnemy: BABYLON.AbstractMesh; damage: number }[],
  ): void {
    const center = m.mesh.position.clone();
    const radius = m.explosionRadius;
    const radSq = radius * radius;
    for (const e of enemies) {
      if (!e || e.isDisposed?.()) continue;
      const dx = e.position.x - center.x;
      const dy = e.position.y - center.y;
      const dz = e.position.z - center.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq < radSq) {
        const falloff = 1 - Math.sqrt(dSq) / radius;
        const dmg = m.damage * Math.max(0.4, falloff);
        if (this.damageRouter) this.damageRouter(e, dmg);
        hits.push({ hitEnemy: e, damage: dmg });
      }
    }
    this.spawnExplosion(center, radius);
    m.mesh.material?.dispose();
    m.mesh.dispose();
  }

  private spawnExplosion(pos: BABYLON.Vector3, radius: number): void {
    // Pink missile detonation routed through the unified ExplosionSystem.
    const tier: "small" | "medium" | "large" =
      radius >= 5 ? "large" : radius >= 2.5 ? "medium" : "small";
    this.bus.emit("effect:explosion", {
      position: pos.clone(),
      radius,
      tier,
      color: new BABYLON.Color3(1.0, 0.5, 0.85),
    });
  }

  dispose(): void {
    for (const beam of this.beams) {
      for (const m of beam.meshes) {
        m.material?.dispose();
        m.dispose();
      }
      if (beam.muzzleMesh) {
        beam.muzzleMesh.material?.dispose();
        beam.muzzleMesh.dispose();
      }
      beam.light?.dispose();
    }
    this.beams = [];
    for (const m of this.missiles) {
      m.mesh.material?.dispose();
      m.mesh.dispose();
    }
    this.missiles = [];
  }
}
