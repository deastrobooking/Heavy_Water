---
name: Captain boss-variant tint compounding
description: Why the captain armor kit must reuse the shared humanoid materials, and why the tint loop over-saturates.
---

# Captain boss-variant tint compounding

The captain boss-variant recolor in `EnemySystem.createEnemyMesh` (the
`type === "captain"` block) loops over `root.getChildMeshes()` and multiplies
each mesh's `StandardMaterial` diffuse/emissive by the variant tint. Captain
meshes SHARE four per-instance materials (primary / secondary / skin /
hair-glow), so a shared material gets multiplied ONCE PER MESH that uses it —
the tint compounds N times, where N = number of meshes on that material.

**Why it matters:**
- Any new captain armor piece MUST reuse those four shared materials. A new
  unique `StandardMaterial` would be tinted only once and read differently;
  worse, the redesign relies on the compounding regime to look right.
- Adding meshes raises N, which deepens saturation (non-dominant diffuse
  channels crush toward black, emissive converges to its clamp). Variants
  stay hue-distinct (inferno/plague/frost/storm/void) because the dominant
  channel still wins, but captains read MORE uniformly neon in the variant hue.

**How to apply:**
- When editing the captain kit, keep using the shared `primary/secondary/glow`
  materials and expect saturated results — that is the intended look.
- Do NOT "fix" over-saturation by deduping the loop with a `Set<Material>`
  unless you have an actual screenshot showing wash-out: deduping changes the
  established captain appearance for every existing level/variant.
- Titans are NOT tinted (only `type === "captain"` is), so titan/`MegaTitan*`
  preset colors are final and independent of this.
