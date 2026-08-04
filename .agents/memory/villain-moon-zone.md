---
name: Villain moon zone & player body swap
description: Luna Bastion (L12) villain campaign — body-swap, low-gravity, and save-slice ordering rules
---

- **Player body swap** (`PlayerController.setVillainBody`): the invisible physics capsule is parented to the humanoid's root. Any body rebuild must detach the capsule FIRST, dispose old armor + humanoid, then reparent the capsule to the new root and re-run `animationSystem.attachToParts` + `applyVisualForCameraMode`. **Why:** disposing the old root with the capsule still attached kills the player's physics/tag mesh.
- **Save-slice hydration order**: any per-zone progress slice read by a zone system on mount (e.g. villainProgress read by MoonWorldSystem) must be hydrated BEFORE `levelSystem.applyLoadedState` — that call synchronously emits LEVEL_STARTED and mounts the zone, which can otherwise overwrite the real slice with zeroed defaults on its next save.
- **Zone-owned materials**: `TransformNode.dispose()` does NOT cascade into materials — side-zone systems must track and dispose their own materials explicitly (MoonWorldSystem uses a `trackMat` helper).
- Moon physics via explicit gravity/jump constants (`setMoonPhysics`), not stored multipliers, so double enable/disable can't drift the baseline.
