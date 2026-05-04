import { EventBus, GameEvents } from "./EventBus";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";
import type { WeaponType } from "./WeaponsSystem";

export type JewelTier = "rough" | "cut" | "flawless";

export interface JewelDef {
  tier: JewelTier;
  itemId: string;
  name: string;
  shortName: string;
  bonusMul: number;
  color: string;
}

export const JEWEL_DEFS: Record<JewelTier, JewelDef> = {
  rough:    { tier: "rough",    itemId: "power_jewel_rough",    name: "Rough Power Jewel",    shortName: "ROUGH",    bonusMul: 0.15, color: "#ff6699" },
  cut:      { tier: "cut",      itemId: "power_jewel_cut",      name: "Cut Power Jewel",      shortName: "CUT",      bonusMul: 0.30, color: "#ff44dd" },
  flawless: { tier: "flawless", itemId: "power_jewel_flawless", name: "Flawless Power Jewel", shortName: "FLAWLESS", bonusMul: 0.50, color: "#ffcc33" },
};

export const JEWEL_TIERS: JewelTier[] = ["rough", "cut", "flawless"];

/** Ranged weapon types that can mount a jewel. The melee-arsenal weapons
 *  (sabre, glaive, daggers, axe, whip) get their damage from the SPECIALS
 *  tab progression — jewels only buff projectile weapons. */
export const JEWEL_MOUNTABLE_WEAPONS: WeaponType[] = [
  "pistol",
  "rifle",
  "shotgun",
  "rocket",
  "laser",
  "grenade",
  "tracking_missile",
];

export function isJewelMountable(type: WeaponType): boolean {
  return JEWEL_MOUNTABLE_WEAPONS.includes(type);
}

/** Tracks which jewel (if any) is socketed into each ranged weapon. Mount
 *  consumes 1 of the matching jewel from the player's inventory; unmount
 *  (or replacing an existing mount) returns the previous jewel to the
 *  inventory. WeaponsSystem reads getDamageMul() per shot to apply the
 *  bonus on top of vehicle + Power Core multipliers. */
export class JewelSystem {
  private mounts: Map<WeaponType, JewelTier> = new Map();
  private inventory: InventorySystem;
  private bus: EventBus = EventBus.getInstance();
  /** Optional notifier: called whenever a weapon's mount changes so
   *  WeaponsSystem can update its cached damage multiplier. */
  private onMountChanged: ((type: WeaponType, mul: number) => void) | null = null;

  constructor(inventory: InventorySystem) {
    this.inventory = inventory;
  }

  setOnMountChanged(fn: ((type: WeaponType, mul: number) => void) | null): void {
    this.onMountChanged = fn;
  }

  getMount(type: WeaponType): JewelTier | null {
    return this.mounts.get(type) ?? null;
  }

  getMountedDef(type: WeaponType): JewelDef | null {
    const t = this.mounts.get(type);
    return t ? JEWEL_DEFS[t] : null;
  }

  /** Damage multiplier applied to projectiles fired by `type`. 1.0 when no
   *  jewel is mounted; 1 + bonus otherwise. */
  getDamageMul(type: WeaponType): number {
    const t = this.mounts.get(type);
    return t ? 1 + JEWEL_DEFS[t].bonusMul : 1;
  }

  /** Mount a jewel of `tier` onto `type`. Pulls 1 of the matching item from
   *  the inventory; if a different jewel was already mounted, that previous
   *  jewel is returned to the inventory before the new one is consumed.
   *  Returns false if the weapon isn't mountable, the player has no jewel
   *  of that tier, or the inventory is full and we can't return the
   *  previous jewel. */
  mount(type: WeaponType, tier: JewelTier): boolean {
    if (!isJewelMountable(type)) return false;
    const newDef = JEWEL_DEFS[tier];
    if (this.inventory.getItemCount(newDef.itemId) <= 0) return false;

    // If the same jewel is already mounted, no-op (avoid round-tripping
    // through the inventory which could fail if the inventory is full).
    if (this.mounts.get(type) === tier) return false;

    const prev = this.mounts.get(type);
    // Pre-flight: if we'd need to return a previous jewel, ensure the
    // inventory can accept it. ITEM_DEFINITIONS lookup is safe — every
    // jewel id is registered there.
    if (prev) {
      const prevDef = ITEM_DEFINITIONS[JEWEL_DEFS[prev].itemId];
      if (!prevDef) return false;
      // Try to add it back; if the add returns >0 it means inventory is
      // full and we should refuse the swap rather than destroying the jewel.
      const remaining = this.inventory.addItem(prevDef, 1);
      if (remaining > 0) {
        // Refund: we already consumed nothing from inventory yet, so
        // there's nothing to undo. Just bail.
        // We need to remove the one we just added back to stay neutral —
        // but addItem only added what was possible. Since remaining===1,
        // it added 0, so nothing to undo.
        return false;
      }
      this.mounts.delete(type);
    }
    // Consume the new jewel from the inventory.
    this.inventory.removeItem(newDef.itemId, 1);
    this.mounts.set(type, tier);
    this.notify(type);
    return true;
  }

  /** Remove a mounted jewel and return it to the inventory. Returns false
   *  if no jewel was mounted or the inventory has no room for the refund. */
  unmount(type: WeaponType): boolean {
    const prev = this.mounts.get(type);
    if (!prev) return false;
    const prevDef = ITEM_DEFINITIONS[JEWEL_DEFS[prev].itemId];
    if (!prevDef) return false;
    const remaining = this.inventory.addItem(prevDef, 1);
    if (remaining > 0) {
      // Inventory was full — keep the jewel mounted rather than vaporizing it.
      return false;
    }
    this.mounts.delete(type);
    this.notify(type);
    return true;
  }

  /** Snapshot mounts for ProgressSync. */
  serialize(): Record<string, JewelTier> {
    const out: Record<string, JewelTier> = {};
    this.mounts.forEach((tier, type) => {
      out[type] = tier;
    });
    return out;
  }

  /** Restore mounts from a save. Does NOT touch inventory — the saved
   *  inventoryCounts already excludes mounted jewels (they were removed
   *  on mount). Unknown weapon ids / tiers are silently dropped. */
  applyLoadedState(map: Record<string, string> | undefined): void {
    this.mounts.clear();
    if (!map) {
      this.notifyAll();
      return;
    }
    for (const [type, tier] of Object.entries(map)) {
      if (!isJewelMountable(type as WeaponType)) continue;
      if (tier !== "rough" && tier !== "cut" && tier !== "flawless") continue;
      this.mounts.set(type as WeaponType, tier as JewelTier);
    }
    this.notifyAll();
  }

  /** Re-emit current mul for every mountable weapon — used after a load to
   *  push the cached multipliers into WeaponsSystem in one pass. */
  notifyAll(): void {
    for (const type of JEWEL_MOUNTABLE_WEAPONS) {
      this.onMountChanged?.(type, this.getDamageMul(type));
    }
  }

  private notify(type: WeaponType): void {
    this.onMountChanged?.(type, this.getDamageMul(type));
    this.bus.emit("jewel:changed", { type, tier: this.mounts.get(type) ?? null });
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
  }
}
