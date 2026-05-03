import { LSystemConfig } from "./LSystem";

/**
 * Ready-made grammars for the alien foliage system.
 *
 * Each preset has been tuned so a single iteration count keeps the final
 * mesh under ~150 segments — enough for a believable silhouette but light
 * enough to merge ~100 of them into the world without hurting frame rate.
 *
 * Tip: when adding a preset, run it locally and watch the segment count
 * via the renderer return value. Anything above ~250 segments per plant
 * starts to become a draw-call burden once you scatter dozens of them.
 */
export const LSystemPresets = {
  /** Tall, branchy alien tree — three-way splits with leaf orbs at tips.
   *  iter 3 yields ~76 F segments — within the per-plant budget. */
  alienTree: {
    axiom: "X",
    rules: {
      X: "F[+&FX][-&FX][^FX]L",
      F: "FF",
    },
    iterations: 3,
    angleDeg: 26,
    segmentLength: 0.65,
    branchRadius: 0.18,
    radiusDecay: 0.7,
  } satisfies LSystemConfig,

  /** Wider, lower bush — flat-ish canopy of glowing fronds.
   *  iter 2 yields ~36 F segments. */
  alienBush: {
    axiom: "F",
    rules: {
      F: "F[+FL][-FL][&FL][^FL]F",
    },
    iterations: 2,
    angleDeg: 32,
    segmentLength: 0.5,
    branchRadius: 0.12,
    radiusDecay: 0.78,
  } satisfies LSystemConfig,

  /** Coral / fungal spire — wide-angle splits, bulbous tip. Good for
   *  decorating temple/mountain bases. iter 3 yields ~216 F segments
   *  (iter 4 was 1296 — 6× worse and tanked startup). */
  alienCoral: {
    axiom: "F",
    rules: {
      F: "F[+F][-F][&F][^F]/FL",
    },
    iterations: 3,
    angleDeg: 38,
    segmentLength: 0.4,
    branchRadius: 0.14,
    radiusDecay: 0.82,
  } satisfies LSystemConfig,
} as const;

export type LSystemPresetKey = keyof typeof LSystemPresets;
