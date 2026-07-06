---
name: Player mecha armor source
description: Where the player's Mega Man look comes from and how to change it without touching captains/NPCs
---

# Player mecha armor

The player's Mega Man–style look is NOT from the shared `HumanoidCharacter.buildArmor`
kit. It comes entirely from the modular `mm_*` "humanoid" armor parts
(`HumanoidArmorParts.ts`), equipped via `DEFAULT_ARMOR_SET`
(`RobotArmorSystem.ts`) + `equipArmorSet`, layered on the base humanoid rig.

**Why:** `PlayerController.createPlayerMesh` sets `hasArmor: false` whenever an
armor set is present, so the shared `buildArmor` path (captain/heavy/light kits)
never runs for the player. Captains/Titans instead use `armorType:"captain"` with
`hasArmor:true` — a separate hardcoded kit in `HumanoidCharacter.buildArmor`.

**How to apply:**
- To change the PLAYER's default appearance, edit the `mm_*` part builders
  (helmet/chest/shoulder/arm/legs/weapon) — this is player-scoped by default and
  will NOT leak into captains/NPCs/pets.
- All parts parent to existing limb pivots (head/torso/arm/leg), so additive
  meshes never float and don't affect the procedural animation rig.
- Only the 6 `ArmorMaterialFactory` keys exist: metal, black, ceramic, gold,
  neon, trim. `neon()` is unlit full-emissive (blooms under the cell-shade pass).
- Side handedness: shoulder/arm parts use `sx = ctx.side==="right"?1:-1`;
  `equipArmorSet` also negates per-mesh `scaling.x` on the right (flips geometry
  only, not positions).

## Gotcha: helmet accents must clear the opaque dome
The `mm_helm_dome` is an opaque sphere (Ø2.35, `scaling.z=1.05`, center y=0.05),
so its front surface at the brow is ~z=1.196. Any forehead/face accent (gem,
bezel) must be pushed forward past that (gem placed at z≈1.28) or it renders
buried inside the dome and is invisible. The visor (z=1.08) is likewise mostly
inside the dome — only its outer corners (|x|>~0.7) poke out.
