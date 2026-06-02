---
name: Side-zone neon bloom (GlowLayer)
description: How the L9/L10/L11 side-zones add restricted GlowLayer bloom without conflicting with the global sabre glow or blooming enemies.
---

# Side-zone neon bloom

Each hidden-world side-zone (Zug L9, Ann Arbor L10, MI Wilds L11) owns its own
`BABYLON.GlowLayer`, created after all decor is built and disposed in the
system's dispose path (the layer is NOT parented to `root`, so `root.dispose()`
alone will not remove it — dispose it explicitly).

Each layer is restricted with `addIncludedOnlyMesh` to only the bright
decorative meshes (`max(emissive channel) >= ~0.25–0.3`) gathered from
`root.getChildMeshes()` (recursive, captures meshes nested under sub-nodes like
the saucer/factory roots). This bounds GPU cost and avoids blooming the enemy
roster (enemies/captains/titans are NOT parented under the zone root).

**Why restricted, not global:** these are the heaviest combat zones (hundreds of
enemies in Zug). An unrestricted glow re-renders every emissive mesh into the
blur buffer — too costly. Restriction keeps it to ~dozens of decor meshes.

**Coexistence with sabreGlow:** `BeamSabreSystem` creates a `"sabreGlow"`
GlowLayer at game start, restricted to just the sabre mesh. Beam/explosion
systems locate "a glow layer" via `scene.effectLayers.find(l => l instanceof
GlowLayer)`, which returns the FIRST one = sabreGlow (created before any
side-zone). So zone glow layers are independent and never hijacked. At most two
glow layers are live at once (sabreGlow + the one active zone).

**Zug ember shimmer:** `emberMats` stores each material's BASE emissive and the
tick lerps around it (`~0.6–1.0×`). The old code re-read the live emissive and
multiplied by `k<=1` every frame, which decayed the molten glow toward black
over a long siege.
