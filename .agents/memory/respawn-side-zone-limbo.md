---
name: Respawn side-zone limbo invariant
description: Why same-level respawns into hidden-world side-zones must re-fire the level, and why forceStart is safe to do so.
---

# Side-zone respawn must re-assert world geometry

Heavy Water uses a "hidden world" map: side-zones (levels 4–11: Ashur, space,
Pontiac/Saginaw labs, Swarms lair, Zug, Ann Arbor, MI Wilds) live at extreme
coordinates and HIDE the default Detroit city meshes when mounted. The mount /
hide logic is driven by the `LEVEL_STARTED` event handler.

**Rule:** On player death+respawn *within the same level*, `LEVEL_STARTED` does
NOT naturally re-fire (level index didn't change), so the side-zone's hide/mount
contract is never re-asserted. The player can wake up in "limbo" — side-zone
meshes gone, Detroit restored underneath. The fix is to re-fire the current
level via `LevelSystem.forceStart(worldLevel)` for ALL side-zones, not just the
two that expose `reassertWorldState()` (Ann Arbor, MI Wilds).

**Why forceStart is safe (does not reset progress):**
- `forceStart` re-emits `LEVEL_STARTED` with `levelChanged=false` for a same-level
  re-fire. The destructive reset path (clear all enemies / aerial clear) only
  runs when `levelChanged` is true.
- Side-zone *systems* (which spawn garrisons/captains/waves in their constructor)
  are only instantiated when their ref is absent (`!annArborSystemRef.current`,
  etc.). With the ref already present, forceStart only re-asserts (re-hides
  Detroit) — it does NOT re-seed captains or cleared encounters. So Ann Arbor's
  "captains don't respawn" objective and Zug/Saginaw progress survive a death.

**How to apply:** Position the player FIRST (`respawn(spawn)` / teleport) THEN
call `forceStart`. This matches the fast-travel `teleport -> forceStart` order
that `SpaceLevelSystem` depends on (it reads player position during
`LEVEL_STARTED` to spawn the asteroid field + auto-mount the orbital fighter).
MI Wilds additionally needs collider/platform clear + a RAF height re-snap after
its terrain re-mounts.
