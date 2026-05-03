import * as BABYLON from "@babylonjs/core";
import { RobotFactory } from "./RobotFactory";
import { RobotDescriptor } from "./RobotDesigner";
import { ALLY_PRESETS, PET_PRESETS } from "./RobotPresets";
import { EventBus, GameEvents } from "./EventBus";

export type CompanionType = "ally" | "pet";

export interface CompanionBehavior {
  followDistance: number;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;
  healAmount: number;
  healCooldown: number;
  moveSpeed: number;
  canAttack: boolean;
  canHeal: boolean;
}

interface ActiveCompanion {
  id: string;
  presetName: string;
  root: BABYLON.TransformNode;
  hitbox: BABYLON.Mesh;
  descriptor: RobotDescriptor;
  type: CompanionType;
  behavior: CompanionBehavior;
  attackTimer: number;
  healTimer: number;
  health: number;
  maxHealth: number;
  orbitAngle: number;
  bobTimer: number;
  level: number;
  baseDamage: number;
  baseHeal: number;
  baseMoveSpeed: number;
  baseMaxHealth: number;
  // Helper-bot weapon level — separate from base level. Each tier 0→3 doubles
  // the projectile damage scale, halves the cooldown, and increases the
  // projectile speed/size visual.
  weaponLevel: number;
  baseAttackCooldown: number;
}

export interface CompanionUpgradeInfo {
  id: string;
  name: string;
  presetName: string;
  type: CompanionType;
  level: number;
  maxLevel: number;
  health: number;
  maxHealth: number;
  damage: number;
  speed: number;
  healAmount: number;
  nextMaxHealth?: number;
  nextDamage?: number;
  nextSpeed?: number;
  upgradeCost: { gears: number; energyCores: number };
  cost: { gears: number; cores: number } | null;
  affordable: boolean;
}

const DEFAULT_ALLY_BEHAVIOR: CompanionBehavior = {
  followDistance: 6,
  // Allies were "hardly assisting" — pump engagement range, fire rate, and
  // damage so they actively contribute to fights instead of plinking.
  attackRange: 32,
  attackDamage: 22,
  attackCooldown: 0.85,
  healAmount: 5,
  healCooldown: 8.0,
  moveSpeed: 0.12,
  canAttack: true,
  canHeal: false,
};

const DEFAULT_PET_BEHAVIOR: CompanionBehavior = {
  followDistance: 3,
  attackRange: 0,
  attackDamage: 0,
  attackCooldown: 99,
  healAmount: 2,
  healCooldown: 10.0,
  moveSpeed: 0.15,
  canAttack: false,
  canHeal: true,
};

export class CompanionSystem {
  private scene: BABYLON.Scene;
  private factory: RobotFactory;
  private companions: ActiveCompanion[] = [];
  private bus: EventBus;
  private collected: Set<string> = new Set();
  // Default helper-bot cap — three slots is the supported "carry into battle"
  // amount surfaced in the upgrade menu and HUD. The Lab building can raise
  // this via setMaxCompanions (clamped 1–20) when the player upgrades it.
  private maxCompanions: number = 3;
  private projectiles: { mesh: BABYLON.Mesh; velocity: BABYLON.Vector3; lifetime: number; damage: number }[] = [];

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.factory = new RobotFactory(scene);
    this.bus = EventBus.getInstance();
  }

  setMaxCompanions(n: number): void {
    this.maxCompanions = Math.max(1, Math.min(20, Math.floor(n)));
  }

  getMaxCompanions(): number {
    return this.maxCompanions;
  }

  addCompanion(presetName: string, playerPos: BABYLON.Vector3, options?: { allowDuplicate?: boolean; customDescriptor?: RobotDescriptor; customType?: CompanionType }): boolean {
    if (this.companions.length >= this.maxCompanions) return false;
    if (!options?.allowDuplicate && !options?.customDescriptor && this.collected.has(presetName)) return false;

    let descriptor: RobotDescriptor | null = options?.customDescriptor ?? null;
    let type: CompanionType = options?.customType ?? "ally";
    let behavior = { ...DEFAULT_ALLY_BEHAVIOR };

    if (!descriptor) {
      if (ALLY_PRESETS[presetName]) {
        descriptor = ALLY_PRESETS[presetName];
        type = "ally";
        behavior = { ...DEFAULT_ALLY_BEHAVIOR };

        if (presetName === "MedicDrone") {
          // Medics still primarily heal, but they also fire a light support
          // beam so they aren't passive bystanders in fights.
          behavior.canHeal = true;
          behavior.canAttack = true;
          behavior.attackDamage = 10;
          behavior.attackCooldown = 1.4;
          behavior.attackRange = 26;
          behavior.healAmount = 8;
          behavior.healCooldown = 6.0;
        }
      } else if (PET_PRESETS[presetName]) {
        descriptor = PET_PRESETS[presetName];
        type = "pet";
        behavior = { ...DEFAULT_PET_BEHAVIOR };
      }
    } else {
      behavior = type === "pet" ? { ...DEFAULT_PET_BEHAVIOR } : { ...DEFAULT_ALLY_BEHAVIOR };
    }

    if (!descriptor) return false;

    const offset = new BABYLON.Vector3(
      Math.cos(this.companions.length * 1.2) * 4,
      0,
      Math.sin(this.companions.length * 1.2) * 4
    );
    const spawnPos = playerPos.add(offset);

    const root = this.factory.createRobot(descriptor, spawnPos);

    const hitbox = BABYLON.MeshBuilder.CreateBox(
      `companion_hitbox_${presetName}_${this.companions.length}`,
      { width: 1, height: 2, depth: 1 },
      this.scene
    );
    hitbox.position.copyFrom(spawnPos);
    hitbox.isVisible = false;
    root.parent = hitbox;

    const baseMaxHp = type === "ally" ? 150 : 50;
    const companion: ActiveCompanion = {
      id: `${presetName}_${Date.now()}_${Math.floor(Math.random() * 999)}`,
      presetName,
      root,
      hitbox,
      descriptor,
      type,
      behavior,
      attackTimer: 0,
      healTimer: 0,
      health: baseMaxHp,
      maxHealth: baseMaxHp,
      orbitAngle: this.companions.length * (Math.PI * 2 / this.maxCompanions),
      bobTimer: Math.random() * Math.PI * 2,
      level: 1,
      baseDamage: behavior.attackDamage,
      baseHeal: behavior.healAmount,
      baseMoveSpeed: behavior.moveSpeed,
      baseMaxHealth: baseMaxHp,
      weaponLevel: 0,
      baseAttackCooldown: behavior.attackCooldown,
    };

    this.companions.push(companion);
    this.collected.add(presetName);

    this.bus.emit(GameEvents.COMPANION_BUILT, { id: companion.id, presetName, type });

    this.bus.emit("effect:capture", {
      position: spawnPos.clone(),
      color: type === "ally"
        ? new BABYLON.Color3(0.4, 0.95, 0.6)
        : new BABYLON.Color3(0.95, 0.55, 1.0),
    });
    return true;
  }

  update(dt: number, playerPos: BABYLON.Vector3, enemyMeshes: BABYLON.AbstractMesh[]): { healed: number; attackHits: { mesh: BABYLON.AbstractMesh; damage: number }[] } {
    let totalHealed = 0;
    const attackHits: { mesh: BABYLON.AbstractMesh; damage: number }[] = [];

    for (let i = this.companions.length - 1; i >= 0; i--) {
      const comp = this.companions[i];

      if (comp.health <= 0) {
        comp.hitbox.dispose();
        comp.root.dispose();
        this.companions.splice(i, 1);
        continue;
      }

      comp.orbitAngle += dt * 0.5;
      comp.bobTimer += dt * 2;

      const targetX = playerPos.x + Math.cos(comp.orbitAngle) * comp.behavior.followDistance;
      const targetZ = playerPos.z + Math.sin(comp.orbitAngle) * comp.behavior.followDistance;
      const targetY = playerPos.y + (comp.type === "pet" ? 0.5 + Math.sin(comp.bobTimer) * 0.3 : 0);

      const currentPos = comp.hitbox.position;
      const dx = targetX - currentPos.x;
      const dz = targetZ - currentPos.z;
      const dy = targetY - currentPos.y;

      currentPos.x += dx * comp.behavior.moveSpeed;
      currentPos.z += dz * comp.behavior.moveSpeed;
      currentPos.y += dy * comp.behavior.moveSpeed;

      if (comp.behavior.canAttack && enemyMeshes.length > 0) {
        comp.attackTimer -= dt;
        if (comp.attackTimer <= 0) {
          let nearestEnemy: BABYLON.AbstractMesh | null = null;
          let nearestDist = comp.behavior.attackRange;

          for (const enemy of enemyMeshes) {
            const dist = BABYLON.Vector3.Distance(currentPos, enemy.position);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestEnemy = enemy;
            }
          }

          if (nearestEnemy) {
            // Helper-bot weapon level scales: cooldown ÷ (1 + 0.4 * lvl),
            // damage × (1 + 0.6 * lvl), projectile size/speed bumped a touch.
            const wl = comp.weaponLevel;
            comp.attackTimer = comp.behavior.attackCooldown / (1 + 0.4 * wl);
            const dmg = comp.behavior.attackDamage * (1 + 0.6 * wl);
            this.fireCompanionProjectile(
              currentPos,
              nearestEnemy.position,
              dmg,
              comp.descriptor.style.colors.emissive,
              wl,
            );
          }
        }
      }

      if (comp.behavior.canHeal) {
        comp.healTimer -= dt;
        if (comp.healTimer <= 0) {
          comp.healTimer = comp.behavior.healCooldown;
          totalHealed += comp.behavior.healAmount;
          this.createHealEffect(playerPos, comp.descriptor.style.colors.emissive);
        }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.mesh.position.addInPlace(proj.velocity.scale(dt));
      proj.lifetime -= dt;

      if (proj.lifetime <= 0) {
        proj.mesh.dispose();
        this.projectiles.splice(i, 1);
        continue;
      }

      for (const enemy of enemyMeshes) {
        const enemyR = (enemy.metadata as any)?.hitRadius ?? 1.5;
        if (BABYLON.Vector3.Distance(proj.mesh.position, enemy.position) < enemyR + 0.6) {
          attackHits.push({ mesh: enemy, damage: proj.damage });
          proj.mesh.dispose();
          this.projectiles.splice(i, 1);
          break;
        }
      }
    }

    return { healed: totalHealed, attackHits };
  }

  private fireCompanionProjectile(
    from: BABYLON.Vector3,
    to: BABYLON.Vector3,
    damage: number,
    color: BABYLON.Color3,
    weaponLevel: number = 0,
  ): void {
    const diameter = 0.3 + 0.12 * weaponLevel;
    const proj = BABYLON.MeshBuilder.CreateSphere("compProj", { diameter, segments: 6 }, this.scene);
    proj.position.copyFrom(from);

    const mat = new BABYLON.StandardMaterial("compProjMat", this.scene);
    mat.emissiveColor = color;
    mat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    proj.material = mat;

    const dir = to.subtract(from).normalize();
    const speed = 38 + 8 * weaponLevel;

    this.projectiles.push({
      mesh: proj,
      velocity: dir.scale(speed),
      lifetime: 3,
      damage,
    });
  }

  private createHealEffect(pos: BABYLON.Vector3, color: BABYLON.Color3): void {
    const particles = new BABYLON.ParticleSystem("healFx", 20, this.scene);
    particles.createSphereEmitter(0.5);
    particles.emitter = pos.clone();
    particles.color1 = new BABYLON.Color4(color.r, color.g, color.b, 0.8);
    particles.color2 = new BABYLON.Color4(color.r * 0.5, color.g * 0.5, color.b * 0.5, 0.4);
    particles.minSize = 0.1;
    particles.maxSize = 0.3;
    particles.minLifeTime = 0.5;
    particles.maxLifeTime = 1.0;
    particles.emitRate = 30;
    particles.gravity = new BABYLON.Vector3(0, 2, 0);
    particles.direction1 = new BABYLON.Vector3(-0.5, 1, -0.5);
    particles.direction2 = new BABYLON.Vector3(0.5, 2, 0.5);

    const texUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAADhJREFUGFdjZGBg+M9AAGBiIFIBIwMDA8P/////MzIy/mdkYGBgZGRkZMQpQdBAbAVENYOoAABmNAoBjNm8mAAAAABJRU5ErkJggg==";
    particles.particleTexture = new BABYLON.Texture(texUrl, this.scene);

    particles.start();
    setTimeout(() => {
      particles.stop();
      setTimeout(() => particles.dispose(), 2000);
    }, 500);
  }

  getCompanions(): { id: string; name: string; type: CompanionType; health: number; maxHealth: number; level: number }[] {
    return this.companions.map(c => ({
      id: c.id,
      name: c.descriptor.name,
      type: c.type,
      health: c.health,
      maxHealth: c.maxHealth,
      level: c.level,
    }));
  }

  getCompanionCount(): number {
    return this.companions.length;
  }

  /** True iff a companion built from the given preset is currently alive in
   *  the active roster. Used by the respawn flow to know whether the starter
   *  Spark Pup or the unlocked Robot Dragon needs to be re-issued. */
  hasCompanionByPreset(presetName: string): boolean {
    return this.companions.some(c => c.presetName === presetName);
  }

  getUpgradeInfo(id: string, getGearCount: () => number, getCoreCount: () => number): CompanionUpgradeInfo | null {
    const c = this.companions.find(x => x.id === id);
    if (!c) return null;
    const maxLvl = 5;
    const tier = c.level;
    const cost = { gears: 8 * tier, energyCores: tier };
    const isMax = c.level >= maxLvl;
    const affordable = !isMax && getGearCount() >= cost.gears && getCoreCount() >= cost.energyCores;
    let nextMaxHealth: number | undefined;
    let nextDamage: number | undefined;
    let nextSpeed: number | undefined;
    if (!isMax) {
      const nt = c.level;
      nextMaxHealth = Math.floor(c.baseMaxHealth * (1 + 0.3 * nt));
      nextDamage = c.baseDamage * (1 + 0.25 * nt);
      nextSpeed = c.baseMoveSpeed * (1 + 0.08 * nt);
    }
    return {
      id: c.id,
      name: c.descriptor.name,
      presetName: c.presetName,
      type: c.type,
      level: c.level,
      maxLevel: maxLvl,
      health: c.health,
      maxHealth: c.maxHealth,
      damage: c.behavior.attackDamage,
      speed: c.behavior.moveSpeed,
      healAmount: c.behavior.healAmount,
      nextMaxHealth,
      nextDamage,
      nextSpeed,
      upgradeCost: cost,
      cost: isMax ? null : { gears: cost.gears, cores: cost.energyCores },
      affordable,
    };
  }

  getAllUpgradeInfo(getGearCount: () => number, getCoreCount: () => number): CompanionUpgradeInfo[] {
    return this.companions.map(c => this.getUpgradeInfo(c.id, getGearCount, getCoreCount)!).filter(x => !!x);
  }

  upgradeCompanion(id: string, spend: (gears: number, cores: number) => boolean): boolean {
    const c = this.companions.find(x => x.id === id);
    if (!c) return false;
    if (c.level >= 5) return false;
    const cost = { gears: 8 * c.level, energyCores: c.level };
    if (!spend(cost.gears, cost.energyCores)) return false;
    c.level += 1;
    const tier = c.level - 1;
    c.behavior.attackDamage = c.baseDamage * (1 + 0.25 * tier);
    c.behavior.healAmount = c.baseHeal * (1 + 0.25 * tier);
    c.behavior.moveSpeed = c.baseMoveSpeed * (1 + 0.08 * tier);
    const newMax = Math.floor(c.baseMaxHealth * (1 + 0.3 * tier));
    const heal = newMax - c.maxHealth;
    c.maxHealth = newMax;
    c.health = Math.min(c.maxHealth, c.health + heal);
    this.bus.emit(GameEvents.COMPANION_UPGRADED, { id, level: c.level });
    return true;
  }

  getCollectedNames(): string[] {
    return Array.from(this.collected);
  }

  damageCompanion(index: number, amount: number): void {
    if (index >= 0 && index < this.companions.length) {
      this.companions[index].health = Math.max(0, this.companions[index].health - amount);
    }
  }

  /** Live world positions of every active companion. Used by the auto-loot
   *  pickup magnet so dropped items also fly toward helper bots. */
  getCompanionPositions(): BABYLON.Vector3[] {
    return this.companions.map(c => c.hitbox.position);
  }

  /** Helper-bot weapon-upgrade tier for a companion. Returns null if missing. */
  getWeaponUpgradeInfo(
    id: string,
    getGearCount: () => number,
    getCoreCount: () => number,
  ): { id: string; name: string; weaponLevel: number; maxLevel: number; cost: { gears: number; cores: number } | null; affordable: boolean } | null {
    const c = this.companions.find(x => x.id === id);
    if (!c) return null;
    const maxLvl = 3;
    const isMax = c.weaponLevel >= maxLvl;
    const tier = c.weaponLevel + 1;
    const cost = { gears: 25 * tier, cores: 4 * tier };
    const affordable = !isMax && getGearCount() >= cost.gears && getCoreCount() >= cost.cores;
    return {
      id: c.id,
      name: c.descriptor.name,
      weaponLevel: c.weaponLevel,
      maxLevel: maxLvl,
      cost: isMax ? null : cost,
      affordable,
    };
  }

  /** Buy the next helper-bot weapon tier for a companion. */
  upgradeCompanionWeapon(id: string, spend: (gears: number, cores: number) => boolean): boolean {
    const c = this.companions.find(x => x.id === id);
    if (!c) return false;
    if (c.weaponLevel >= 3) return false;
    const tier = c.weaponLevel + 1;
    const cost = { gears: 25 * tier, cores: 4 * tier };
    if (!spend(cost.gears, cost.cores)) return false;
    c.weaponLevel += 1;
    this.bus.emit(GameEvents.UI_MESSAGE, {
      text: `${c.descriptor.name} weapon → tier ${c.weaponLevel}`,
      duration: 2,
    });
    return true;
  }

  /**
   * Persisted shape of every active companion. Used by ProgressSync so that
   * the helper-bot roster, their per-companion `level` and per-companion
   * `weaponLevel` all survive death + restart. Without this, hard restarts
   * wiped every helper upgrade the player paid for.
   */
  serializeForSave(): { presetName: string; type: CompanionType; level: number; weaponLevel: number }[] {
    return this.companions.map(c => ({
      presetName: c.presetName,
      type: c.type,
      level: c.level,
      weaponLevel: c.weaponLevel,
    }));
  }

  /**
   * Rebuild the helper-bot roster from a saved snapshot. Each entry is
   * spawned with `allowDuplicate` so the roster comes back exactly as saved
   * (including the unique RoboDragon premium ally), and each companion's
   * cumulative level + weaponLevel investment is replayed in-place.
   */
  applyLoadedCompanions(
    saved: { presetName: string; type: CompanionType; level: number; weaponLevel: number }[],
    playerPos: BABYLON.Vector3,
  ): void {
    // Wipe any current roster first so we never end up with a duplicated set.
    for (const comp of this.companions) {
      try { comp.hitbox.dispose(); } catch {}
      try { comp.root.dispose(); } catch {}
    }
    this.companions = [];
    this.collected.clear();

    for (const entry of saved) {
      const ok = this.addCompanion(entry.presetName, playerPos, {
        allowDuplicate: true,
        customType: entry.type,
      });
      if (!ok) continue;
      const c = this.companions[this.companions.length - 1];
      // Replay the level investment so behavior stats line up with the saved
      // tier (mirrors upgradeCompanion's per-tier scaling).
      const targetLevel = Math.max(1, Math.min(5, entry.level || 1));
      while (c.level < targetLevel) {
        c.level += 1;
        const tier = c.level - 1;
        c.behavior.attackDamage = c.baseDamage * (1 + 0.25 * tier);
        c.behavior.healAmount = c.baseHeal * (1 + 0.25 * tier);
        c.behavior.moveSpeed = c.baseMoveSpeed * (1 + 0.08 * tier);
        const newMax = Math.floor(c.baseMaxHealth * (1 + 0.3 * tier));
        c.maxHealth = newMax;
        c.health = newMax;
      }
      // weaponLevel scales attack cooldown / damage at fire-time (no stored
      // derived stats), so we just clamp + assign.
      c.weaponLevel = Math.max(0, Math.min(3, entry.weaponLevel || 0));
    }
  }

  dispose(): void {
    for (const comp of this.companions) {
      comp.hitbox.dispose();
      comp.root.dispose();
    }
    for (const proj of this.projectiles) {
      proj.mesh.dispose();
    }
    this.companions = [];
    this.projectiles = [];
    this.factory.dispose();
  }
}
