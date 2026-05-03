/**
 * Lindenmayer (L-system) string rewriter.
 *
 * An L-system starts from an `axiom` string and rewrites every character
 * using `rules` for `iterations` steps. The resulting string is a turtle
 * program consumed by LSystemRenderer to emit branch geometry.
 *
 * Common turtle symbols (interpreted by LSystemRenderer):
 *   F  = move forward and draw a branch segment
 *   f  = move forward without drawing
 *   +/- = yaw right/left
 *   &/^ = pitch down/up
 *   \\// = roll left/right (note: `\` is escaped in TS strings)
 *   [   = push turtle state
 *   ]   = pop turtle state
 *   L   = drop a leaf/orb at the current turtle position
 */
export type LSystemRules = Record<string, string>;

export interface LSystemConfig {
  axiom: string;
  rules: LSystemRules;
  /** How many rewrite passes to apply. Keep small (3–5) — string length grows
   *  exponentially with rule expansion. */
  iterations: number;
  /** Turtle rotation step in degrees for +/-/&/^/\\// symbols. */
  angleDeg: number;
  /** World units traveled per `F` symbol. */
  segmentLength: number;
  /** Trunk diameter at the base. */
  branchRadius: number;
  /** Multiplier applied to the radius when entering a `[` push (taper). */
  radiusDecay: number;
}

export class LSystem {
  constructor(private config: LSystemConfig) {}

  /** Apply the rewrite rules `iterations` times and return the final string. */
  generateString(): string {
    let current = this.config.axiom;
    for (let i = 0; i < this.config.iterations; i++) {
      let next = "";
      for (const char of current) {
        next += this.config.rules[char] ?? char;
      }
      current = next;
    }
    return current;
  }
}
