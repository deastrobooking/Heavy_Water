---
name: Pet & robot upgrade caps
description: Where the pet/robot progression caps live and the cross-file clamps that must move together when raising them.
---

# Pet & robot upgrade caps

Raising any pet/robot cap requires moving BOTH the live guard and the load-time
clamp, or saves silently truncate the new range on the next load.

**Why:** progression is persisted as raw numbers (companion level/weaponLevel,
captured bondLevel, active-pet level); only the load clamps gate them. The
UpgradeMenu + GardenCaptureUI are fully data-driven, so caps surface in the UI
automatically — no UI edits needed when raising caps.

**How to apply:**
- Helper robots — `CompanionSystem.ts`: level cap in `getUpgradeInfo` (maxLvl),
  `upgradeCompanion` guard, AND `applyLoadedCompanions` `Math.min`. Weapon tier
  cap in `getWeaponUpgradeInfo`, `upgradeCompanionWeapon` guard, AND the
  `applyLoadedCompanions` weaponLevel clamp. Cost formulas scale with tier, so
  they self-balance — leave them.
- Bio bonds — `BioCreatureSystem.ts`: bond cap in `careForCaptured` guard AND
  `loadCaptured` clamp. Bond power feeds `getPetBondBonuses` (DMG/FIRE/reduction
  caps). The reduction value is ALSO re-clamped in
  `PlayerController.setPetBondBoosts` — raise that clamp too or the extra
  reduction is thrown away.
- Active pets — `ActivePetSystem.ts`: level clamp in `assignPets`;
  `getAugmentBonuses` maps each elemental family to one augment axis. The player
  honors damageMul/fireRateMul/speedMul/shieldRegen/healthRegen/critChance
  (PlayerController consumes all six), but historically only dmg/fr/shieldRegen
  were ever populated — the other three were dead axes until wired by type.
