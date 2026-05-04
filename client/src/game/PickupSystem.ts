import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";
import { CRAFTING_MATERIALS } from "./CraftingSystem";
import { JEWEL_DEFS, type JewelTier } from "./JewelSystem";

export type PickupType =
  | "gear"
  | "weapon_part"
  | "scrap_metal"
  | "energy_core"
  | "circuit_board"
  | "nano_fiber"
  | "bio_essence"
  | "health_kit"
  | "jewel";

export interface PickupSpawnRequest {
  type: PickupType;
  amount: number;
  weaponId?: string;
  /** Only meaningful when `type === "jewel"`. Selects which Power-Jewel
   *  item id is granted on collect (and which colour / mesh is rendered). */
  jewelTier?: JewelTier;
}

interface ActivePickup {
  id: number;
  mesh: BABYLON.Mesh;
  halo: BABYLON.Mesh;
  type: PickupType;
  amount: number;
  weaponId?: string;
  /** Tier of the dropped jewel (only set when `type === "jewel"`). */
  jewelTier?: JewelTier;
  bobOffset: number;
  bobBase: number;
  age: number;
  collected: boolean;
  /** Last time (ms via Date.now) collection was refused due to a full
   *  inventory. Used to throttle the "INVENTORY FULL" toast so it doesn't
   *  spam every frame while a jewel orbits the player. Only meaningful
   *  for jewel pickups today. */
  lastCollectFailAt?: number;
}

const PICKUP_COLORS: Record<PickupType, BABYLON.Color3> = {
  gear: new BABYLON.Color3(0.95, 0.78, 0.25),
  weapon_part: new BABYLON.Color3(1.0, 0.35, 0.85),
  scrap_metal: new BABYLON.Color3(0.7, 0.7, 0.75),
  energy_core: new BABYLON.Color3(0.2, 0.95, 1.0),
  circuit_board: new BABYLON.Color3(0.2, 1.0, 0.5),
  nano_fiber: new BABYLON.Color3(0.95, 0.95, 1.0),
  bio_essence: new BABYLON.Color3(0.6, 1.0, 0.4),
  health_kit: new BABYLON.Color3(1.0, 0.3, 0.4),
  // Default jewel colour — overridden per-instance by jewelTier in
  // createPickupMesh() so each tier glows its own hue.
  jewel: new BABYLON.Color3(1.0, 0.4, 0.85),
};

const PICKUP_LABELS: Record<PickupType, string> = {
  gear: "GEAR",
  weapon_part: "WEAPON PART",
  scrap_metal: "SCRAP",
  energy_core: "ENERGY CORE",
  circuit_board: "CIRCUIT",
  nano_fiber: "NANO FIBER",
  bio_essence: "BIO ESSENCE",
  health_kit: "HEALTH",
  jewel: "POWER JEWEL",
};

/** Roll a Power-Jewel drop. Returns null when the drop misses entirely.
 *  Tier weights are skewed toward the rough variant so the flawless jewel
 *  remains the headline reward of a boss spire / boss captain. */
function rollJewelTier(rng: () => number, weights: { rough: number; cut: number; flawless: number }): JewelTier | null {
  const total = weights.rough + weights.cut + weights.flawless;
  if (total <= 0) return null;
  const r = rng() * total;
  if (r < weights.flawless) return "flawless";
  if (r < weights.flawless + weights.cut) return "cut";
  return "rough";
}

// Drop rates were tuned up: at higher player levels gears and especially
// energy cores were too rare to keep upgrading helper bots. Every enemy now
// drops more gears, and even basic enemies have a small chance to drop a
// core / circuit so progression keeps moving.
const ENEMY_DROP_TABLE: Record<string, PickupSpawnRequest[]> = {
  drone: [
    { type: "gear", amount: 3 },
    { type: "scrap_metal", amount: 2 },
  ],
  soldier: [
    { type: "gear", amount: 5 },
    { type: "scrap_metal", amount: 3 },
  ],
  heavy: [
    { type: "gear", amount: 9 },
    { type: "scrap_metal", amount: 5 },
    { type: "energy_core", amount: 2 },
    { type: "circuit_board", amount: 1 },
  ],
  insectoid: [
    { type: "gear", amount: 4 },
    { type: "bio_essence", amount: 2 },
  ],
  hybrid: [
    { type: "gear", amount: 12 },
    { type: "circuit_board", amount: 3 },
    { type: "energy_core", amount: 1 },
    { type: "bio_essence", amount: 2 },
  ],
  commander: [
    { type: "gear", amount: 22 },
    { type: "energy_core", amount: 5 },
    { type: "circuit_board", amount: 6 },
    { type: "nano_fiber", amount: 4 },
  ],
  // Tanks are siege artillery — slow, heavily armoured, expensive to take
  // down — so the loot is meaty: scrap dominates (twisted hull plating)
  // and the player gets a guaranteed core/circuit pair plus extra gears.
  tank: [
    { type: "gear", amount: 11 },
    { type: "scrap_metal", amount: 14 },
    { type: "energy_core", amount: 3 },
    { type: "circuit_board", amount: 2 },
  ],
  aerial_fighter: [
    { type: "gear", amount: 7 },
    { type: "scrap_metal", amount: 6 },
    { type: "energy_core", amount: 2 },
    { type: "circuit_board", amount: 1 },
  ],
  aerial_battleship: [
    { type: "gear", amount: 35 },
    { type: "scrap_metal", amount: 20 },
    { type: "energy_core", amount: 8 },
    { type: "circuit_board", amount: 8 },
    { type: "nano_fiber", amount: 6 },
  ],
};

// Bonus drop chances for tier-2 components from EVERY enemy kill, so cores
// and circuits aren't gated solely behind tough enemies.
const BONUS_CORE_CHANCE: Record<string, number> = {
  drone: 0.10,
  soldier: 0.18,
  heavy: 0.0,        // already guaranteed
  insectoid: 0.15,
  hybrid: 0.0,       // already in base table
  commander: 0.0,    // already in base table
  aerial_fighter: 0.0,
  aerial_battleship: 0.0,
};
const BONUS_CIRCUIT_CHANCE: Record<string, number> = {
  drone: 0.05,
  soldier: 0.10,
  heavy: 0.25,
  insectoid: 0.10,
  hybrid: 0.0,
  commander: 0.0,
  aerial_fighter: 0.20,
  aerial_battleship: 0.0,
};
const BONUS_NANO_CHANCE: Record<string, number> = {
  drone: 0.0,
  soldier: 0.0,
  heavy: 0.10,
  insectoid: 0.05,
  hybrid: 0.20,
  commander: 0.45,
  aerial_fighter: 0.10,
  aerial_battleship: 0.55,
};

const WEAPON_PART_BY_ENEMY: Record<string, string[]> = {
  drone: ["pistol"],
  soldier: ["rifle", "shotgun"],
  heavy: ["rocket"],
  insectoid: ["laser"],
  hybrid: ["laser", "grenade", "rifle"],
  commander: ["pistol", "rifle", "shotgun", "rocket", "laser", "grenade"],
};

const HEALTH_DROP_CHANCE = 0.5;
const HEALTH_DROP_CHANCE_TOUGH = 0.85; // hybrid / heavy / commander
const HEALTH_KIT_AMOUNT = 35;

export class PickupSystem {
  private scene: BABYLON.Scene;
  private inventory: InventorySystem;
  private bus: EventBus;
  private active: ActivePickup[] = [];
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private idCounter: number = 0;
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private enemyKilledHandler: (data: any) => void;
  private spawnHandler: (data: any) => void;

  // Auto-loot: when enabled, dropped items also magnetize toward and are
  // collected at any companion position returned by the supplied provider.
  // The provider is queried each tick; positions are live references.
  private autoLootEnabled: boolean = false;
  private companionProvider: (() => BABYLON.Vector3[]) | null = null;

  private static readonly MAGNET_RANGE = 6;
  private static readonly COLLECT_RANGE = 1.4;
  private static readonly MAGNET_SPEED = 14;
  private static readonly LIFETIME = 35;

  constructor(scene: BABYLON.Scene, inventory: InventorySystem) {
    this.scene = scene;
    this.inventory = inventory;
    this.bus = EventBus.getInstance();

    this.enemyKilledHandler = (data: any) => this.onEnemyKilled(data);
    this.spawnHandler = (data: any) => {
      if (data && data.position) this.spawn(data.position, data.requests || [], data.spread);
    };

    this.bus.on(GameEvents.ENEMY_KILLED, this.enemyKilledHandler);
    this.bus.on(GameEvents.PICKUP_SPAWNED, this.spawnHandler);

    this.observer = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      this.tick(dt);
    });

    console.log("[PickupSystem] Initialized");
  }

  setPlayerPosition(pos: BABYLON.Vector3): void {
    this.playerPos.copyFrom(pos);
  }

  /** Plug in a callback that returns live companion positions. The list is
   *  re-queried each tick so it stays in sync as bots move. */
  setCompanionPositionsProvider(provider: (() => BABYLON.Vector3[]) | null): void {
    this.companionProvider = provider;
  }

  /** Toggle auto-loot. While enabled, pickups also magnetize/collect at any
   *  companion position. */
  setAutoLootEnabled(enabled: boolean): void {
    this.autoLootEnabled = enabled;
  }

  isAutoLootEnabled(): boolean {
    return this.autoLootEnabled;
  }

  private onEnemyKilled(data: any): void {
    if (!data || !data.position) return;
    const drops: PickupSpawnRequest[] = [...(ENEMY_DROP_TABLE[data.type] || ENEMY_DROP_TABLE.drone)];
    const partTable = WEAPON_PART_BY_ENEMY[data.type] || ["pistol"];
    // Weapon-part drops were also bumped — at high level the player needs a
    // steady supply of parts to keep all six weapons leveled.
    const dropChance = data.type === "commander" ? 1.0 : data.type === "hybrid" ? 0.85 : 0.6;
    if (Math.random() < dropChance) {
      const wid = partTable[Math.floor(Math.random() * partTable.length)];
      const amount = data.type === "commander" ? 3 + Math.floor(Math.random() * 3) : 1 + (Math.random() < 0.4 ? 1 : 0);
      drops.push({ type: "weapon_part", amount, weaponId: wid });
    }
    // Bonus tier-2 component rolls so cores / circuits / nano fiber drop
    // even from grunts. Without these, late-game upgrades stall completely.
    const coreChance = BONUS_CORE_CHANCE[data.type] ?? 0.05;
    if (coreChance > 0 && Math.random() < coreChance) {
      drops.push({ type: "energy_core", amount: 1 });
    }
    const circuitChance = BONUS_CIRCUIT_CHANCE[data.type] ?? 0.05;
    if (circuitChance > 0 && Math.random() < circuitChance) {
      drops.push({ type: "circuit_board", amount: 1 });
    }
    const nanoChance = BONUS_NANO_CHANCE[data.type] ?? 0;
    if (nanoChance > 0 && Math.random() < nanoChance) {
      drops.push({ type: "nano_fiber", amount: 1 });
    }
    const isTough = data.type === "heavy" || data.type === "hybrid" || data.type === "commander";
    const healthChance = isTough ? HEALTH_DROP_CHANCE_TOUGH : HEALTH_DROP_CHANCE;
    if (Math.random() < healthChance) {
      drops.push({ type: "health_kit", amount: HEALTH_KIT_AMOUNT });
      // Tough enemies get a chance for a SECOND kit
      if (isTough && Math.random() < 0.5) {
        drops.push({ type: "health_kit", amount: HEALTH_KIT_AMOUNT });
      }
    }
    // Power-Jewel rolls. Boss captains (the special spire-guard variant of
    // a captain) are the headline source; ordinary commanders get a much
    // smaller chance so jewels still trickle from elite waves. Aerial
    // battleships also have a moderate chance because they're rare and
    // expensive to take down.
    let jewel: JewelTier | null = null;
    if (data.isBossCaptain) {
      // Boss captain — guaranteed jewel, weighted toward higher tiers.
      jewel = rollJewelTier(Math.random, { rough: 60, cut: 30, flawless: 10 });
    } else if (data.type === "captain" || data.type === "commander") {
      if (Math.random() < 0.20) {
        jewel = rollJewelTier(Math.random, { rough: 80, cut: 17, flawless: 3 });
      }
    } else if (data.type === "aerial_battleship") {
      if (Math.random() < 0.35) {
        jewel = rollJewelTier(Math.random, { rough: 70, cut: 25, flawless: 5 });
      }
    }
    if (jewel) drops.push({ type: "jewel", amount: 1, jewelTier: jewel });
    this.spawn(data.position, drops, 0.8);
  }

  spawn(origin: BABYLON.Vector3, requests: PickupSpawnRequest[], spread: number = 1.2): void {
    for (const req of requests) {
      if (!req || !req.type) continue;
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      const pos = origin.add(new BABYLON.Vector3(Math.cos(angle) * r, 0.5, Math.sin(angle) * r));
      this.createPickupMesh(pos, req);
    }
  }

  private createPickupMesh(pos: BABYLON.Vector3, req: PickupSpawnRequest): void {
    const id = this.idCounter++;
    let color = PICKUP_COLORS[req.type] || new BABYLON.Color3(1, 1, 1);
    // Per-tier override: each jewel tier gets its own glow colour so the
    // player can tell rough / cut / flawless apart from across the field.
    if (req.type === "jewel" && req.jewelTier) {
      const hex = JEWEL_DEFS[req.jewelTier].color;
      color = BABYLON.Color3.FromHexString(hex);
    }

    let mesh: BABYLON.Mesh;
    switch (req.type) {
      case "gear":
        mesh = BABYLON.MeshBuilder.CreateTorus(`pickup_${id}`, { diameter: 0.55, thickness: 0.18, tessellation: 10 }, this.scene);
        break;
      case "weapon_part":
        mesh = BABYLON.MeshBuilder.CreateBox(`pickup_${id}`, { width: 0.5, height: 0.18, depth: 0.5 }, this.scene);
        break;
      case "energy_core":
        mesh = BABYLON.MeshBuilder.CreateSphere(`pickup_${id}`, { diameter: 0.55, segments: 12 }, this.scene);
        break;
      case "scrap_metal":
        mesh = BABYLON.MeshBuilder.CreateBox(`pickup_${id}`, { width: 0.45, height: 0.45, depth: 0.45 }, this.scene);
        break;
      case "circuit_board":
        mesh = BABYLON.MeshBuilder.CreateBox(`pickup_${id}`, { width: 0.55, height: 0.05, depth: 0.4 }, this.scene);
        break;
      case "nano_fiber":
        mesh = BABYLON.MeshBuilder.CreateCylinder(`pickup_${id}`, { height: 0.6, diameter: 0.15, tessellation: 8 }, this.scene);
        break;
      case "bio_essence":
        mesh = BABYLON.MeshBuilder.CreateSphere(`pickup_${id}`, { diameter: 0.5, segments: 10 }, this.scene);
        break;
      case "health_kit":
        mesh = BABYLON.MeshBuilder.CreateBox(`pickup_${id}`, { width: 0.45, height: 0.3, depth: 0.45 }, this.scene);
        break;
      case "jewel":
        // Faceted gem-style mesh — Babylon polyhedron type 1 = octahedron,
        // type 2 = dodecahedron. Use type 2 for flawless to read as the
        // "biggest, fanciest" stone, and type 1 for the others.
        {
          const polyType = req.jewelTier === "flawless" ? 2 : 1;
          const size = req.jewelTier === "flawless" ? 0.55 : (req.jewelTier === "cut" ? 0.45 : 0.38);
          mesh = BABYLON.MeshBuilder.CreatePolyhedron(`pickup_${id}`, { type: polyType, size }, this.scene);
        }
        break;
      default:
        mesh = BABYLON.MeshBuilder.CreateSphere(`pickup_${id}`, { diameter: 0.4 }, this.scene);
    }

    const mat = new BABYLON.StandardMaterial(`pickupMat_${id}`, this.scene);
    mat.emissiveColor = color;
    mat.diffuseColor = color.scale(0.6);
    mat.disableLighting = false;
    mesh.material = mat;
    mesh.position.copyFrom(pos);
    mesh.isPickable = false;

    const halo = BABYLON.MeshBuilder.CreateSphere(`pickup_halo_${id}`, { diameter: 0.95, segments: 8 }, this.scene);
    const haloMat = new BABYLON.StandardMaterial(`pickupHaloMat_${id}`, this.scene);
    haloMat.emissiveColor = color;
    haloMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    haloMat.alpha = 0.18;
    haloMat.disableLighting = true;
    halo.material = haloMat;
    halo.position.copyFrom(pos);
    halo.isPickable = false;
    halo.parent = mesh;
    halo.position.set(0, 0, 0);

    const bobBase = pos.y;
    const item: ActivePickup = {
      id,
      mesh,
      halo,
      type: req.type,
      amount: req.amount,
      weaponId: req.weaponId,
      jewelTier: req.jewelTier,
      bobOffset: Math.random() * Math.PI * 2,
      bobBase,
      age: 0,
      collected: false,
    };
    this.active.push(item);
  }

  private tick(dt: number): void {
    if (this.active.length === 0) return;
    const ppos = this.playerPos;
    // Auto-loot widens both magnet and collect ranges so companions sweep
    // dropped items efficiently as they orbit.
    const autoLoot = this.autoLootEnabled && !!this.companionProvider;
    const companionPositions = autoLoot ? this.companionProvider!() : [];
    const autoMagnetR = PickupSystem.MAGNET_RANGE * 1.4;
    const autoCollectR = PickupSystem.COLLECT_RANGE * 1.6;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.age += dt;

      if (p.age > PickupSystem.LIFETIME) {
        this.disposePickup(p);
        this.active.splice(i, 1);
        continue;
      }

      p.mesh.rotation.y += dt * 2.2;
      const bob = Math.sin(p.age * 3 + p.bobOffset) * 0.18;

      // Player attractor first.
      const dx = ppos.x - p.mesh.position.x;
      const dy = ppos.y + 1 - p.mesh.position.y;
      const dz = ppos.z - p.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < PickupSystem.COLLECT_RANGE) {
        if (this.collect(p)) {
          this.disposePickup(p);
          this.active.splice(i, 1);
          continue;
        }
        // Collection refused (inventory full + non-droppable item). Leave
        // the pickup in the world so the player can recover it after
        // making room. Skip the magnet/bob update for this frame so it
        // doesn't keep tugging into the player and re-firing the failure
        // toast every tick.
        continue;
      }

      // Pick the best attractor: player vs nearest companion (when auto-loot
      // is on). The closer one wins so a pickup never tugs toward both at once.
      let bestDx = dx, bestDy = dy, bestDz = dz, bestDist = dist;
      let bestSource: "player" | "companion" = "player";
      if (autoLoot) {
        for (const cp of companionPositions) {
          const cdx = cp.x - p.mesh.position.x;
          const cdy = cp.y + 0.6 - p.mesh.position.y;
          const cdz = cp.z - p.mesh.position.z;
          const cd = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz);
          if (cd < bestDist) {
            bestDist = cd;
            bestDx = cdx; bestDy = cdy; bestDz = cdz;
            bestSource = "companion";
          }
        }
      }

      // Companion-side collection (player path already handled above).
      if (bestSource === "companion" && bestDist < autoCollectR) {
        if (this.collect(p)) {
          this.disposePickup(p);
          this.active.splice(i, 1);
        }
        // Refused collections (inventory full) just stay put — see
        // the player branch above for the same rationale.
        continue;
      }

      const magnetR = bestSource === "companion" ? autoMagnetR : PickupSystem.MAGNET_RANGE;
      if (bestDist < magnetR) {
        const speed = PickupSystem.MAGNET_SPEED * (1 - bestDist / magnetR) + 4;
        const inv = 1 / Math.max(0.001, bestDist);
        p.mesh.position.x += bestDx * inv * speed * dt;
        p.mesh.position.y += bestDy * inv * speed * dt;
        p.mesh.position.z += bestDz * inv * speed * dt;
      } else {
        p.mesh.position.y = p.bobBase + bob;
      }
    }
  }

  /** Try to collect a pickup. Returns `true` when the pickup should be
   *  disposed (collected fully, or item undeliverable so we drop it on
   *  the floor anyway), `false` when it should remain in the world for
   *  another attempt — currently only Power Jewels do this, so a single
   *  full-inventory event can't vaporize a very-rare drop. */
  private collect(p: ActivePickup): boolean {
    let itemId: string | null = null;
    let payloadAmount = p.amount;
    let healthHeal = 0;

    switch (p.type) {
      case "gear":
        itemId = "gear";
        break;
      case "bio_essence":
        itemId = "bio_essence";
        break;
      case "weapon_part":
        itemId = `weapon_part_${p.weaponId || "pistol"}`;
        break;
      case "scrap_metal":
      case "energy_core":
      case "circuit_board":
      case "nano_fiber":
        itemId = p.type;
        break;
      case "health_kit":
        healthHeal = p.amount;
        break;
      case "jewel":
        if (p.jewelTier) itemId = JEWEL_DEFS[p.jewelTier].itemId;
        // Jewels never stack as a "5 jewels in one mesh" thing — every
        // jewel mesh that drops represents exactly one unit. Force the
        // payload to 1 even if a misconfigured spawn requested more.
        payloadAmount = 1;
        break;
    }

    if (itemId) {
      const def = ITEM_DEFINITIONS[itemId] || CRAFTING_MATERIALS[itemId];
      if (def) {
        const remaining = this.inventory.addItem(def, payloadAmount);
        if (remaining > 0 && p.type === "jewel") {
          // Inventory full + jewel — refuse the collection so the player
          // can recover this very-rare drop after freeing a slot. Throttle
          // the toast to once every 2.5s so it doesn't spam while the
          // jewel sits inside collect range.
          const now = Date.now();
          if (!p.lastCollectFailAt || now - p.lastCollectFailAt > 2500) {
            this.bus.emit(GameEvents.UI_MESSAGE, {
              text: `★ POWER JEWEL — INVENTORY FULL! MAKE ROOM TO COLLECT ★`,
              duration: 2500,
            });
            p.lastCollectFailAt = now;
          }
          return false;
        }
        // Track partial-pickup amount so PICKUP_COLLECTED reports what
        // actually landed, not what was attempted. (Only matters for
        // stackable items like gears at the cap; jewels above already
        // bailed.)
        if (remaining > 0) payloadAmount -= remaining;
      }
    }

    this.bus.emit("effect:pickup", {
      position: p.mesh.position.clone(),
      color: PICKUP_COLORS[p.type],
    });

    // Big celebratory toast for jewels — the player should never miss one.
    if (p.type === "jewel" && p.jewelTier) {
      const def = JEWEL_DEFS[p.jewelTier];
      this.bus.emit(GameEvents.UI_MESSAGE, {
        text: `★ ${def.name.toUpperCase()} ACQUIRED — MOUNT IT IN THE WEAPONS TAB ★`,
        duration: 5000,
      });
    }

    this.bus.emit(GameEvents.PICKUP_COLLECTED, {
      type: p.type,
      itemId,
      amount: payloadAmount,
      weaponId: p.weaponId,
      jewelTier: p.jewelTier,
      healAmount: healthHeal,
      label: p.type === "jewel" && p.jewelTier
        ? `${JEWEL_DEFS[p.jewelTier].shortName} JEWEL`
        : PICKUP_LABELS[p.type],
    });
    return true;
  }

  private disposePickup(p: ActivePickup): void {
    if (!p.collected) {
      p.collected = true;
    }
    if (p.halo && !p.halo.isDisposed()) p.halo.dispose();
    if (p.mesh && !p.mesh.isDisposed()) p.mesh.dispose();
  }

  getActiveCount(): number {
    return this.active.length;
  }

  dispose(): void {
    this.bus.off(GameEvents.ENEMY_KILLED, this.enemyKilledHandler);
    this.bus.off(GameEvents.PICKUP_SPAWNED, this.spawnHandler);
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    for (const p of this.active) this.disposePickup(p);
    this.active = [];
    console.log("[PickupSystem] Disposed");
  }
}
