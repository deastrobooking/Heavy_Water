import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";

export type BaseStructureKind = "lab" | "garden";

export interface BaseStructure {
  id: string;
  kind: BaseStructureKind;
  level: number;
  position: BABYLON.Vector3;
}

export interface BaseStructureUpgradeCost {
  gears: number;
  scrap: number;
  energyCores: number;
}

export const MAX_BASE_LEVEL = 3;

const LAB_LEVEL_COMPANION_CAP = [3, 5, 8];
// Garden capture cap per upgrade tier. Bumped from [3, 6, 10] so the
// max-tier garden can host a real menagerie of pets — players were
// hitting the old 10-slot ceiling almost immediately and giving up on
// further captures. Tier scaling stays meaningful (15 → 30 → 50) so
// each upgrade still feels like a real expansion. Persisted via
// `ProgressSnapshot.capturedCreatures` (open-ended JSONB array — no
// DB migration needed for the larger ceiling).
const GARDEN_LEVEL_CAPTURE_CAP = [15, 30, 50];
const GARDEN_LEVEL_CAPTURE_BONUS = [0, 0.15, 0.3];

function upgradeCostFor(kind: BaseStructureKind, nextLevel: number): BaseStructureUpgradeCost {
  const tier = Math.max(1, nextLevel - 1);
  if (kind === "lab") {
    return { gears: 20 * tier, scrap: 20 * tier, energyCores: 2 * tier };
  }
  return { gears: 16 * tier, scrap: 12 * tier, energyCores: 1 * tier };
}

export class BaseSystem {
  private bus: EventBus;
  private inventory: InventorySystem;
  private structures: BaseStructure[] = [];
  private idCounter: number = 0;
  /**
   * Saved per-kind structure level from the previous session. When
   * a level system later re-registers a structure of a given kind
   * (e.g. SanctuarySystem.onMount calls `registerStructure("lab", …)`),
   * `registerStructure` consults this map and starts the new structure
   * at the saved level instead of 1 — that way the player's spent
   * gears/scrap/energy cores aren't silently refunded into a downgrade.
   */
  private savedLevels: Partial<Record<BaseStructureKind, number>> = {};

  constructor(inventory: InventorySystem) {
    this.inventory = inventory;
    this.bus = EventBus.getInstance();
    console.log("[BaseSystem] Initialized");
  }

  registerStructure(kind: BaseStructureKind, position: BABYLON.Vector3): BaseStructure {
    const id = `base_${kind}_${this.idCounter++}`;
    // Pre-bump newly-registered structures up to the previously-saved
    // level for this kind so reload-then-mount restores the upgrade
    // tier (which drives companion cap, garden capture cap, etc.).
    const savedLevel = this.savedLevels[kind] ?? 1;
    const initialLevel = Math.min(MAX_BASE_LEVEL, Math.max(1, savedLevel));
    const s: BaseStructure = { id, kind, level: initialLevel, position: position.clone() };
    this.structures.push(s);
    this.bus.emit(GameEvents.BASE_STRUCTURE_PLACED, { id, kind, position: s.position });
    console.log(`[BaseSystem] Placed ${kind} at`, position.x.toFixed(1), position.z.toFixed(1), "lvl", initialLevel);
    return s;
  }

  removeStructureAt(position: BABYLON.Vector3, radius: number = 1.5): void {
    for (let i = this.structures.length - 1; i >= 0; i--) {
      if (BABYLON.Vector3.Distance(this.structures[i].position, position) < radius) {
        this.structures.splice(i, 1);
      }
    }
  }

  getStructures(): BaseStructure[] {
    return this.structures.slice();
  }

  getNearestStructure(position: BABYLON.Vector3, kind?: BaseStructureKind, maxRange: number = 5): BaseStructure | null {
    let best: BaseStructure | null = null;
    let bestDist = maxRange;
    for (const s of this.structures) {
      if (kind && s.kind !== kind) continue;
      const d = BABYLON.Vector3.Distance(s.position, position);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return best;
  }

  getStructureLevel(kind: BaseStructureKind): number {
    let max = 0;
    for (const s of this.structures) {
      if (s.kind === kind && s.level > max) max = s.level;
    }
    return max;
  }

  hasStructure(kind: BaseStructureKind): boolean {
    return this.structures.some(s => s.kind === kind);
  }

  getLabCompanionCap(): number {
    const lvl = this.getStructureLevel("lab");
    if (lvl < 1) return 0;
    return LAB_LEVEL_COMPANION_CAP[Math.min(lvl, LAB_LEVEL_COMPANION_CAP.length) - 1];
  }

  getGardenCaptureCap(): number {
    const lvl = this.getStructureLevel("garden");
    if (lvl < 1) return 0;
    return GARDEN_LEVEL_CAPTURE_CAP[Math.min(lvl, GARDEN_LEVEL_CAPTURE_CAP.length) - 1];
  }

  getGardenCaptureBonus(): number {
    const lvl = this.getStructureLevel("garden");
    if (lvl < 1) return 0;
    return GARDEN_LEVEL_CAPTURE_BONUS[Math.min(lvl, GARDEN_LEVEL_CAPTURE_BONUS.length) - 1];
  }

  getUpgradeCost(id: string): BaseStructureUpgradeCost | null {
    const s = this.structures.find(x => x.id === id);
    if (!s) return null;
    if (s.level >= MAX_BASE_LEVEL) return null;
    return upgradeCostFor(s.kind, s.level + 1);
  }

  canAfford(cost: BaseStructureUpgradeCost): boolean {
    return (
      this.inventory.getItemCount("gear") >= cost.gears &&
      this.inventory.getItemCount("scrap_metal") >= cost.scrap &&
      this.inventory.getItemCount("energy_core") >= cost.energyCores
    );
  }

  upgradeStructure(id: string): boolean {
    const s = this.structures.find(x => x.id === id);
    if (!s) return false;
    if (s.level >= MAX_BASE_LEVEL) return false;
    const cost = upgradeCostFor(s.kind, s.level + 1);
    if (!this.canAfford(cost)) return false;
    const gear = ITEM_DEFINITIONS["gear"];
    const scrap = ITEM_DEFINITIONS["scrap_metal"];
    const core = ITEM_DEFINITIONS["energy_core"];
    if (gear) this.inventory.removeItem(gear.id, cost.gears);
    if (scrap) this.inventory.removeItem(scrap.id, cost.scrap);
    if (core) this.inventory.removeItem(core.id, cost.energyCores);
    s.level += 1;
    this.bus.emit(GameEvents.BASE_STRUCTURE_UPGRADED, { id: s.id, kind: s.kind, level: s.level });
    return true;
  }

  /**
   * Snapshot the per-kind max level so structure upgrades survive a
   * reload. Without this, a player who spent 60+ gears + 60+ scrap +
   * 6+ energy cores leveling their lab from 1→2→3 would silently
   * watch it reset to level 1 (and their companion cap fall from 8
   * back to 3) every time they logged back in.
   */
  serialize(): Record<BaseStructureKind, number> {
    return {
      lab: this.getStructureLevel("lab"),
      garden: this.getStructureLevel("garden"),
    };
  }

  /**
   * Stash saved per-kind levels so subsequent `registerStructure`
   * calls (driven by SanctuarySystem mounting on LEVEL_STARTED) come
   * up at the restored tier. Also bumps any structures already
   * registered at construction time. Levels are clamped to
   * `[1, MAX_BASE_LEVEL]` to defend against malformed save data.
   */
  applyLoadedLevels(levels: Partial<Record<BaseStructureKind, number>> | undefined): void {
    if (!levels) return;
    for (const k of Object.keys(levels) as BaseStructureKind[]) {
      const raw = levels[k];
      if (typeof raw !== "number" || raw < 1) continue;
      const clamped = Math.min(MAX_BASE_LEVEL, Math.max(1, raw));
      this.savedLevels[k] = clamped;
      // Promote any structures of this kind already registered.
      for (const s of this.structures) {
        if (s.kind === k && s.level < clamped) s.level = clamped;
      }
    }
  }

  dispose(): void {
    this.structures = [];
  }
}
