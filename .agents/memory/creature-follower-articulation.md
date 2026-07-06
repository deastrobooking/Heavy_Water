---
name: Creature follower articulation vs mesh merging
description: Why animated robot followers must be built "articulate" (parented parts) instead of merged, and how wild+follower creature looks are unified.
---

# Creature follower articulation

`RobotFactory.finalize()` has two modes:

- **Merged** (default, `articulate` falsy): all sub-meshes are combined with
  `Mesh.MergeMeshes(..., disposeSource=true)` into one static mesh named
  `${name}_${key}`. This is fast and right for enemies/props that never
  self-animate.
- **Articulate** (`articulate: true`): named parts (legs, arms, glow,
  head, face) are parented to the root and kept as individual meshes.

**Why:** `ActivePetSystem` animates a follower by scanning the root for
child meshes *by name* (leg/arm swing, glow pulse). If the creature was
merged, those named sub-meshes no longer exist — the animation loop finds
nothing and silently no-ops (the follower looks frozen). Any procedurally
animated robot MUST be built articulate.

**How to apply:** followers set `articulate: true` via
`buildCreatureDescriptor(species, { follower: true })`. Adding a new
animated part means registering its mesh name in TWO places that must stay
in sync: the builder in `RobotFactory` (so the name survives finalize) AND
the matching name set in `ActivePetSystem`. If they drift, the part either
merges away or is never found — both silently break the animation.

## Unified wild + follower look

`buildCreatureDescriptor` is the single source of truth for every
creature's appearance (wild spawn in `BioCreatureSystem` AND follower in
`ActivePetSystem`). A follower is just the same descriptor with
`scale ×0.85` + `articulate`. Never fork a second style-builder for
followers — that's exactly the drift that made captured pets look nothing
like their wild forms before.

**Head is not spun on followers:** the head now carries a face (eyes,
mouth, cheek-lights). A prior "slow head spin to read as alive" desyncs the
face from the body — remove it; the gait + glow-pulse already sell life.
