# Inventory, crafting, loot

| System | File |
|---|---|
| Inventory (24 slots, stackable) | [`InventorySystem.ts`](../../client/src/game/InventorySystem.ts) |
| Crafting (recipe-based) | [`CraftingSystem.ts`](../../client/src/game/CraftingSystem.ts) |
| Pickups + drop tables | [`PickupSystem.ts`](../../client/src/game/PickupSystem.ts) |
| Chests | [`ChestSystem.ts`](../../client/src/game/ChestSystem.ts) |
| Mining nodes (destructible) | [`MiningSystem.ts`](../../client/src/game/MiningSystem.ts) |
| Shop | [`ShopSystem.ts`](../../client/src/game/ShopSystem.ts) |

## Inventory

24 slots, stackable. Each slot is `{ itemId, count }`. Public API:

```ts
inventorySystem.add(itemId, count?);     // returns overflow
inventorySystem.remove(itemId, count);
inventorySystem.has(itemId, count?);
inventorySystem.getAll();                 // for HUD
```

Emits `INVENTORY_CHANGED` on every mutation; HUD listens and re-renders.

## Crafting

Recipes are declared inline in `CraftingSystem.ts` as a typed table —
each recipe lists input items, an output item, optional unlock
condition. The Lab UI ([`LabUI.tsx`](../../client/src/game/LabUI.tsx))
renders them.

## Loot drop tables

`PickupSystem` listens for `ENEMY_KILLED` and rolls per-enemy drop
tables defined in the same file. Drops include:

- Resource items (scrap, crystals, biomass).
- Power Jewels (rare; weighted by enemy type — see boss tables).
- Healing pickups.

Aerial enemies and boss-fortress vaults have separate tables.

## Mining

Destructible glowing resource nodes scattered across the world. Hitting
them with any weapon emits `PICKUP_SPAWNED` via `PickupSystem`.

## Shop

Owned by [`ShopSystem.ts`](../../client/src/game/ShopSystem.ts). Trades
credits for items / upgrades / blueprints. Render layer is the **SHOP**
tab in the Upgrade Menu.

## Persistence

`ProgressSnapshot.inventoryCounts` is a `Record<string, number>` —
preserved exactly across reloads. Crafting unlocks live alongside
weapon/companion levels in the snapshot.
