# Rendering & cell-shading

The art direction is anime / retro 80s sci-fi cell-shaded. The render
pipeline is built around that.

## Engine

File: [`BabylonEngine.ts`](../../client/src/game/BabylonEngine.ts)

Wraps Babylon.js v8.x. On boot:

1. Tries to create a **WebGPU** engine.
2. Falls back to **WebGL2** on failure.
3. Configures the scene clear color, fog, and HDR pipeline if available.
4. Registers the cell-shading post-process chain (see below).

The single `Scene` instance is owned here and passed by reference to
every other system.

## Cell-shading pipeline

- **Custom GLSL-ES-1.0 shader** for diffuse + ramp lighting (banded
  shading rather than smooth). Applied to most opaque materials.
- **Ink outlines** — silhouette outlines on enemies, the player, and
  vehicles. Implemented as a back-face-culled inverted-hull pass.
- **Bloom** — glowing weapons, neon, jewel drops.
- **Chromatic aberration** — edges-of-screen effect during damage and
  flight.
- **FXAA** — cheap edge AA.

All four post-FX live on a single Babylon `DefaultRenderingPipeline`
configured in `BabylonEngine.ts`.

## Material conventions

- **Cell-shaded materials** — reuse the materials built in
  `BabylonEngine` / `CombatSystem` / `RobotFactory` / `HumanoidCharacter`.
  Don't roll your own without good reason. The character/armor pipeline
  has its own dedicated factory — see
  [`character-and-armor.md`](character-and-armor.md) for
  `ArmorMaterialFactory`'s six canonical keys (`metal`, `black`,
  `ceramic`, `gold`, `neon`, `trim`).
- **Emissive surfaces** (jewels, neon, weapon trails) bias their colour
  high on the green/cyan channels so they bloom strongly.
- **Tints** — many materials accept a runtime `Color3` tint multiplier
  so per-level `cityTheme` can recolor without rebuilding meshes.

## Per-style material caching

The two big mesh factories each maintain their own caches:

- **`RobotFactory`** caches by `(matKey, color.rgb)` so a wave of 200
  robots reuses ~3 materials per faction. Cache lives on the factory
  instance — disposed with it.
- **`VehicleFactory`** caches by **scene** (a `WeakMap<Scene, Map<key,
  Material>>`). The scene-keyed indirection exists because a previous
  global cache survived scene disposal and handed out dead-scene
  materials on the next vehicle build, rendering the new mesh fully
  transparent. See [`vehicles.md`](vehicles.md#material-caching).
- **`ArmorMaterialFactory`** caches per-instance keyed by the requested
  variant. The instance also takes a `salt` so two factions can ask
  for `metal()` and get visually identical but separately-disposable
  materials.

## Sky

[`SkySystem.ts`](../../client/src/game/SkySystem.ts) is a custom-shader
gradient skybox (not a cubemap). It supports:

- Day/night cycle driven by `LevelDef.timeOfDay`.
- Per-level `skyTint`.
- Weather modes (clear, fog, storm).
- Spacelike mode (starfield + nebula) for L5.

## Performance knobs

- [`LODCullSystem.ts`](../../client/src/game/LODCullSystem.ts) hides
  far meshes per-frame. Side-zones suppress LOD culling so their indoor
  meshes don't pop.
- The procedural foliage systems batch meshes aggressively.
- Particle counts in [`EffectsSystem.ts`](../../client/src/game/EffectsSystem.ts)
  scale with the rendering pipeline budget.

## Adding a new shader

- Co-locate the GLSL source with the system that uses it.
- Use Babylon's `ShaderMaterial` rather than `Effect.ShadersStore`
  hacks — easier HMR.
- Test on WebGL2; WebGPU's GLSL behavior is mostly compatible but a few
  precision qualifiers differ.
