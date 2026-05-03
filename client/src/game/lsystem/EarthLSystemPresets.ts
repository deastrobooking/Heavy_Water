import { LSystemConfig } from "./LSystem";

/**
 * Realistic Earth tree + shrub L-system grammars.
 *
 * Companion to LSystemPresets (which holds the alien glow-foliage). These
 * presets are tuned to read as recognisable terrestrial silhouettes when
 * paired with the realistic bark + leaf colours in EarthFoliageSystem:
 *   - Oaks have a thick trunk and a broad rounded canopy.
 *   - Pines are tall and narrow with short horizontal side branches.
 *   - Birches are slender with sparse, wispy foliage.
 *   - Willows droop heavily on side branches.
 *   - Shrubs / ferns stay low and bushy near the ground.
 *
 * Iteration counts are kept tight so the merged trunk stays under ~150
 * cylinders per plant — same per-plant budget as the alien presets, since
 * EarthFoliageSystem scatters dozens of these in the wilderness band and
 * we share the merged-mesh draw-call discipline. Keep an eye on the
 * renderer's segmentCount return value when adjusting any of these.
 */
export const EarthLSystemPresets = {
  /** Mature oak: thick base, three- and four-way splits, broad canopy.
   *  iter 3 with `F → FF` doubles trunk length each pass — keeps the
   *  silhouette tall enough to read as a real tree without exploding the
   *  string length. */
  oakTree: {
    axiom: "A",
    rules: {
      A: "F[+&FA][-&FA][^FA][/FA]L",
      F: "FF",
    },
    iterations: 3,
    angleDeg: 28,
    segmentLength: 0.7,
    branchRadius: 0.22,
    radiusDecay: 0.68,
  } satisfies LSystemConfig,

  /** Pine: a strong central spine with short, near-horizontal side
   *  branches. Wide angle (70°) tips the side branches out flat so they
   *  read as pine boughs rather than oak limbs. iter 4 stays cheap
   *  because each pass only adds short side branches, not nested
   *  recursion. */
  pineTree: {
    axiom: "A",
    rules: {
      A: "F[&&FL][^^FL][\\&FL][/&FL]FA",
    },
    iterations: 4,
    angleDeg: 70,
    segmentLength: 0.55,
    branchRadius: 0.16,
    radiusDecay: 0.86,
  } satisfies LSystemConfig,

  /** Birch: slender, pale, taller-than-wide with sparse wispy clusters.
   *  Narrow split angle (22°) keeps the canopy column-like. */
  birchTree: {
    axiom: "FFA",
    rules: {
      A: "F[+FFL][-FFL][&FL]FA",
    },
    iterations: 3,
    angleDeg: 22,
    segmentLength: 0.6,
    branchRadius: 0.13,
    radiusDecay: 0.82,
  } satisfies LSystemConfig,

  /** Willow: drooping branches. The repeated `&` (pitch down) on side
   *  branches makes the canopy fall toward the ground. */
  willowTree: {
    axiom: "A",
    rules: {
      A: "F[&&&FL][&&FL][\\&&FL][/&&FL]FA",
    },
    iterations: 3,
    angleDeg: 35,
    segmentLength: 0.5,
    branchRadius: 0.18,
    radiusDecay: 0.78,
  } satisfies LSystemConfig,

  /** Generic shrub: short, dense, multi-branch from the base. iter 2 is
   *  plenty — anything more turns into an opaque ball. */
  shrub: {
    axiom: "F",
    rules: {
      F: "F[+FL][-FL][&FL][^FL]",
    },
    iterations: 2,
    angleDeg: 35,
    segmentLength: 0.35,
    branchRadius: 0.09,
    radiusDecay: 0.82,
  } satisfies LSystemConfig,

  /** Fern: very short, feathery side fronds along a single stem. iter 4
   *  is safe because the rule only adds leaves and one continuation per
   *  step (no nested recursion). */
  fernShrub: {
    axiom: "A",
    rules: {
      A: "F[+L][-L][&L][^L]A",
    },
    iterations: 4,
    angleDeg: 45,
    segmentLength: 0.28,
    branchRadius: 0.05,
    radiusDecay: 0.9,
  } satisfies LSystemConfig,
} as const;

export type EarthLSystemPresetKey = keyof typeof EarthLSystemPresets;
