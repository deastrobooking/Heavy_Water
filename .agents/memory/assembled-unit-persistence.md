---
name: Assembled-unit & item-family persistence
description: Rules for Lab-assembled companions (recipe-based rebuild) and adding new inventory item families
---

# Assembled-unit & item-family persistence

**Rule 1:** Companions with custom descriptors (Lab ASSEMBLY builds) cannot persist by presetName. They persist as a recipe (`CompanionSaveEntry.assembly = { blueprintId, partIds }`) and the descriptor is rebuilt deterministically on load (`buildAssembledDescriptor` in AssemblyBlueprints.ts). Any change to the descriptor builder changes existing saved units' looks — keep it deterministic and backward-tolerant. Display name is also recomputed from the recipe (saved presetName is an internal unique id).

**Rule 2:** Item definitions are looked up through fallback chains in more than one place (pickup collection AND save-load rehydration), and inventory-derived UI state is refreshed in more than one place (the periodic in-loop refresh AND syncResourcesNow). A new item family or UI count must join *all* of those paths or items silently vanish on reload / show stale in menus.

**Why:** Crafting materials once reset on every reload for exactly this reason; modular parts then hit both traps and were caught in review twice.

**How to apply:** When adding an item family or inventory-driven UI state, search for every existing lookup/refresh site of an established family and mirror it there.
