import * as BABYLON from "@babylonjs/core";
import { RobotFactory } from "./RobotFactory";
import { RobotDescriptor, deserializeRobot, serializeRobot, validateStyle } from "./RobotDesigner";
import { ALLY_PRESETS, PET_PRESETS } from "./RobotPresets";
import { EventBus, GameEvents } from "./EventBus";
import { getBlueprint, buildAssembledDescriptor, assemblyQuality } from "./AssemblyBlueprints";

export type CompanionType = "ally" | "pet";

/** Recipe metadata for a Lab-assembled companion. Persisted alongside the
 *  companion so its custom descriptor can be rebuilt deterministically on
 *  load (preset-based restore can't handle custom descriptors). */
export interface AssemblyRecipe {
  blueprintId: string;
  partIds: string[];
}

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
  bobTimer: number;
  level: number;
  baseDamage: number;
  baseHeal: number;
  baseMoveSpeed: number;
  baseMaxHealth: number;
  // Helper-bot weapon level — separate from base level. Each tier 0→6 raises
  // the projectile damage scale, cuts the cooldown, and increases the
  // projectile speed/size visual.
  weaponLevel: number;
  baseAttackCooldown: number;
  /** Set only for Lab-assembled units — the recipe that rebuilds them. */
  assembly?: AssemblyRecipe;
  /** Set only for Creator-Suite units — the serialized descriptor that
   *  rebuilds them deterministically on load (self-contained, no recipe). */
  design?: string;
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

const COMPANION_CATCHUP_DISTANCE_SQ = 30 * 30;
const COMPANION_MIN_SEPARATION = 1.8;
const COMPANION_MIN_FORMATION_RADIUS = 4.8;

function companionFormationOffset(
  index: number,
  total: number,
  followDistance: number,
): { x: number; z: number } {
  const radius = Math.max(COMPANION_MIN_FORMATION_RADIUS, followDistance);
  if (total <= 3) {
    const offsets: ReadonlyArray<readonly [number, number]> = [
      [-0.62, -0.82],
      [0.62, -0.82],
      [0, -1.18],
    ];
    const offset = offsets[index] ?? offsets[offsets.length - 1];
    return { x: offset[0] * radius, z: offset[1] * radius };
  }

  const ring = Math.floor(index / 6);
  const ringStart = ring * 6;
  const ringCount = Math.min(6, total - ringStart);
  const angle = -Math.PI / 2 + ((index - ringStart) / Math.max(1, ringCount)) * Math.PI * 2;
  const ringRadius = radius + ring * 2.4;
  return { x: Math.cos(angle) * ringRadius, z: Math.sin(angle) * ringRadius };
}

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
  // Reusable per-update attack-hit buffer. The caller only reads it within
  // the same synchronous frame (Game.tsx iterates then discards), so we can
  // safely clear + refill it each update instead of allocating a fresh array.
  private attackHits: { mesh: BABYLON.AbstractMesh; damage: number }[] = [];
  // One shared projectile material for the whole system — projectiles set the
  // emissive color per-shot, but they no longer each own a StandardMaterial.
  // Never disposed per-projectile; released in dispose().
  private sharedProjectileMat: BABYLON.StandardMaterial | null = null;
  // One shared particle texture reused by every heal effect (avoids a fresh
  // Texture allocation per heal tick).
  private sharedHealTexture: BABYLON.Texture | null = null;
  // Active heal particle systems + their pending stop/dispose timer handles,
  // tracked so a level swap can dispose/cancel them instead of leaking.
  private healEffects: Set<BABYLON.ParticleSystem> = new Set();
  private healTimers: Set<ReturnType<typeof setTimeout>> = new Set();

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.factory = new RobotFactory(scene);
    this.bus = EventBus.getInstance();
  }

  private getProjectileMaterial(): BABYLON.StandardMaterial {
    if (!this.sharedProjectileMat) {
      const mat = new BABYLON.StandardMaterial("compProjMat", this.scene);
      mat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.05);
      this.sharedProjectileMat = mat;
    }
    return this.sharedProjectileMat;
  }

  setMaxCompanions(n: number): void {
    this.maxCompanions = Math.max(1, Math.min(20, Math.floor(n)));
  }

  getMaxCompanions(): number {
    return this.maxCompanions;
  }

  addCompanion(presetName: string, playerPos: BABYLON.Vector3, options?: { allowDuplicate?: boolean; customDescriptor?: RobotDescriptor; customType?: CompanionType; assembly?: AssemblyRecipe; design?: string }): boolean {
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
      bobTimer: Math.random() * Math.PI * 2,
      level: 1,
      baseDamage: behavior.attackDamage,
      baseHeal: behavior.healAmount,
      baseMoveSpeed: behavior.moveSpeed,
      baseMaxHealth: baseMaxHp,
      weaponLevel: 0,
      baseAttackCooldown: behavior.attackCooldown,
      assembly: options?.assembly,
      design: options?.design,
    };

    // Assembled units scale their base stats by part quality (tier-driven).
    // Applied to the BASE stats so the level-up replay math stays correct.
    if (options?.assembly) {
      const mult = assemblyQuality(options.assembly.partIds).statMult;
      companion.baseDamage *= mult;
      companion.baseHeal *= mult;
      companion.baseMaxHealth = Math.floor(companion.baseMaxHealth * mult);
      companion.maxHealth = companion.baseMaxHealth;
      companion.health = companion.maxHealth;
      companion.behavior.attackDamage = companion.baseDamage;
      companion.behavior.healAmount = companion.baseHeal;
    }

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
    const attackHits = this.attackHits;
    attackHits.length = 0;
    const frameDt = Math.max(0, Math.min(0.1, dt));

    for (let i = this.companions.length - 1; i >= 0; i--) {
      const comp = this.companions[i];

      if (comp.health <= 0) {
        comp.hitbox.dispose();
        comp.root.dispose();
        this.companions.splice(i, 1);
        continue;
      }

      comp.bobTimer += frameDt * 2;

      const formation = companionFormationOffset(i, this.companions.length, comp.behavior.followDistance);
      let targetX = playerPos.x + formation.x;
      let targetZ = playerPos.z + formation.z;
      const targetY = playerPos.y + (comp.type === "pet" ? 0.5 + Math.sin(comp.bobTimer) * 0.3 : 0);

      const currentPos = comp.hitbox.position;

      // Keep neighboring helpers from stacking on the same pixel without
      // replacing their stable formation targets with independent orbits.
      for (let j = 0; j < this.companions.length; j++) {
        if (j === i) continue;
        const other = this.companions[j].hitbox.position;
        let sx = currentPos.x - other.x;
        let sz = currentPos.z - other.z;
        let distSq = sx * sx + sz * sz;
        if (distSq >= COMPANION_MIN_SEPARATION * COMPANION_MIN_SEPARATION) continue;
        if (distSq < 0.0001) {
          const angle = (i + 1) * 1.93 + j;
          sx = Math.cos(angle) * 0.01;
          sz = Math.sin(angle) * 0.01;
          distSq = sx * sx + sz * sz;
        }
        const dist = Math.sqrt(distSq);
        const push = (COMPANION_MIN_SEPARATION - dist) * 0.5;
        targetX += (sx / dist) * push;
        targetZ += (sz / dist) * push;
      }

      const dx = targetX - currentPos.x;
      const dz = targetZ - currentPos.z;
      const dy = targetY - currentPos.y;
      if (dx * dx + dy * dy + dz * dz > COMPANION_CATCHUP_DISTANCE_SQ) {
        currentPos.set(targetX, targetY, targetZ);
      } else if (frameDt > 0) {
        // moveSpeed historically stored a per-60fps-frame interpolation
        // factor. Convert it to an equivalent per-second response so upgrades
        // keep their feel while following remains stable at every frame rate.
        const perFrame = Math.max(0.001, Math.min(0.95, comp.behavior.moveSpeed));
        const response = -Math.log(1 - perFrame) * 60;
        const moveAlpha = 1 - Math.exp(-response * frameDt);
        currentPos.x += dx * moveAlpha;
        currentPos.z += dz * moveAlpha;
        currentPos.y += dy * moveAlpha;
      }

      if (comp.behavior.canAttack && enemyMeshes.length > 0) {
        comp.attackTimer -= dt;
        if (comp.attackTimer <= 0) {
          let nearestEnemy: BABYLON.AbstractMesh | null = null;
          let nearestDistSq = comp.behavior.attackRange * comp.behavior.attackRange;

          for (const enemy of enemyMeshes) {
            const distSq = BABYLON.Vector3.DistanceSquared(currentPos, enemy.position);
            if (distSq < nearestDistSq) {
              nearestDistSq = distSq;
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
        const reach = enemyR + 0.6;
        if (BABYLON.Vector3.DistanceSquared(proj.mesh.position, enemy.position) < reach * reach) {
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

    // Shared system-owned material — no per-projectile StandardMaterial
    // allocation (which previously leaked proportional to fire rate). The
    // emissive tint is set from the firing companion's color.
    const mat = this.getProjectileMaterial();
    mat.emissiveColor = color;
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

    if (!this.sharedHealTexture) {
      const texUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAAXNSR0IArs4c6QAAADhJREFUGFdjZGBg+M9AAGBiIFIBIwMDA8P/////MzIy/mdkYGBgZGRkZMQpQdBAbAVENYOoAABmNAoBjNm8mAAAAABJRU5ErkJggg==";
      this.sharedHealTexture = new BABYLON.Texture(texUrl, this.scene);
    }
    particles.particleTexture = this.sharedHealTexture;

    particles.start();
    this.healEffects.add(particles);
    const stopHandle = setTimeout(() => {
      this.healTimers.delete(stopHandle);
      particles.stop();
      const disposeHandle = setTimeout(() => {
        this.healTimers.delete(disposeHandle);
        this.healEffects.delete(particles);
        // Dispose the particle system but NOT the shared texture.
        try { particles.dispose(false); } catch {}
      }, 2000);
      this.healTimers.add(disposeHandle);
    }, 500);
    this.healTimers.add(stopHandle);
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
    const maxLvl = 10;
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
    if (c.level >= 10) return false;
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
    const maxLvl = 6;
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
    if (c.weaponLevel >= 6) return false;
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
  serializeForSave(): { presetName: string; type: CompanionType; level: number; weaponLevel: number; assembly?: AssemblyRecipe; design?: string }[] {
    return this.companions.map(c => ({
      presetName: c.presetName,
      type: c.type,
      level: c.level,
      weaponLevel: c.weaponLevel,
      ...(c.assembly ? { assembly: c.assembly } : {}),
      ...(c.design ? { design: c.design } : {}),
    }));
  }

  /**
   * Rebuild the helper-bot roster from a saved snapshot. Each entry is
   * spawned with `allowDuplicate` so the roster comes back exactly as saved
   * (including the unique RoboDragon premium ally), and each companion's
   * cumulative level + weaponLevel investment is replayed in-place.
   */
  applyLoadedCompanions(
    saved: { presetName: string; type: CompanionType; level: number; weaponLevel: number; assembly?: AssemblyRecipe; design?: string }[],
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
      // Lab-assembled units carry their recipe; rebuild the exact custom
      // descriptor from blueprint + parts (preset lookup would fail).
      let customDescriptor: RobotDescriptor | undefined;
      if (entry.assembly) {
        const bp = getBlueprint(entry.assembly.blueprintId);
        if (bp) {
          // Recompute the display name deterministically from the recipe
          // (quality prefix + blueprint name) — the saved presetName is an
          // internal unique id, not the user-facing name.
          const q = assemblyQuality(entry.assembly.partIds);
          const prefix = q.label === "STANDARD" ? "" : q.label.charAt(0) + q.label.slice(1).toLowerCase() + " ";
          customDescriptor = buildAssembledDescriptor(bp, entry.assembly.partIds, `${prefix}${bp.name}`) ?? undefined;
        }
        if (!customDescriptor) continue; // unknown blueprint — skip safely
      }
      // Creator-Suite units are self-contained: the serialized descriptor
      // itself is the persisted recipe. Re-clamp on load so a hand-edited
      // save can't produce out-of-range geometry.
      if (!customDescriptor && entry.design) {
        try {
          const d = deserializeRobot(entry.design);
          d.style = validateStyle(d.style);
          customDescriptor = d;
        } catch {
          continue; // corrupt design payload — skip safely
        }
      }
      const ok = this.addCompanion(entry.presetName, playerPos, {
        allowDuplicate: true,
        customType: entry.type,
        customDescriptor,
        assembly: entry.assembly,
        design: entry.design,
      });
      if (!ok) continue;
      const c = this.companions[this.companions.length - 1];
      // Replay the level investment so behavior stats line up with the saved
      // tier (mirrors upgradeCompanion's per-tier scaling).
      const targetLevel = Math.max(1, Math.min(10, entry.level || 1));
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
      c.weaponLevel = Math.max(0, Math.min(6, entry.weaponLevel || 0));
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
    // Cancel any pending heal stop/dispose timers and tear down active heal
    // particle systems so they don't leak across a level swap.
    this.healTimers.forEach(h => clearTimeout(h));
    this.healTimers.clear();
    this.healEffects.forEach(ps => {
      try { ps.dispose(false); } catch {}
    });
    this.healEffects.clear();
    if (this.sharedProjectileMat) {
      try { this.sharedProjectileMat.dispose(); } catch {}
      this.sharedProjectileMat = null;
    }
    if (this.sharedHealTexture) {
      try { this.sharedHealTexture.dispose(); } catch {}
      this.sharedHealTexture = null;
    }
    this.companions = [];
    this.projectiles = [];
    this.factory.dispose();
  }
}
