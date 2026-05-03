/**
 * Boss Captain visual + stat variants. Each variant retints the captain's
 * humanoid materials, recolors the aura / sabre / tracker / dome, and
 * applies per-variant HP and damage multipliers on top of the base
 * `captain` stat block. The level system assigns a variant to every
 * level so each fortress shows up with its own silhouette and tells the
 * player at a glance which threat they're walking into.
 *
 * The base captain (the original red one) is `inferno` — chosen as the
 * default to preserve previous visuals when no variant is specified.
 */

export type BossVariantId = "inferno" | "plague" | "frost" | "storm" | "void";

export interface BossVariantColor {
  r: number;
  g: number;
  b: number;
}

export interface BossVariant {
  id: BossVariantId;
  /** Display name shown in the spawn-toast / HUD callout. */
  displayName: string;
  /** One-line taunt printed to the HUD when the captain spawns. */
  taunt: string;
  /** Per-channel multiplier applied to humanoid diffuse + emissive — shifts
   *  the body palette toward the variant theme without rebuilding meshes. */
  tint: BossVariantColor;
  /** Additive boost on top of the tinted emissive so the silhouette glows
   *  in the variant's signature color. Clamped at 1.0 by the consumer. */
  emissiveBoost: BossVariantColor;
  /** Aura-sphere emissive color (the soft glow halo around the captain). */
  auraColor: BossVariantColor;
  /** Sabre / slash arc / sabre-swing trail color. */
  sabreColor: BossVariantColor;
  /** Tracker orb + dome detonation color (also the impact-spark color). */
  projectileColor: BossVariantColor;
  /** HP scalar over the base captain's `maxHealth`. */
  healthMultiplier: number;
  /** Damage scalar over the base captain's `attackDamage`. */
  damageMultiplier: number;
}

export const BOSS_VARIANTS: Record<BossVariantId, BossVariant> = {
  inferno: {
    id: "inferno",
    displayName: "INFERNO LORD",
    taunt: "BURN, INTRUDER.",
    tint: { r: 1.0, g: 0.45, b: 0.30 },
    emissiveBoost: { r: 0.45, g: 0.05, b: 0.05 },
    auraColor: { r: 1.0, g: 0.18, b: 0.10 },
    sabreColor: { r: 1.0, g: 0.20, b: 0.12 },
    projectileColor: { r: 1.0, g: 0.30, b: 0.10 },
    healthMultiplier: 1.0,
    damageMultiplier: 1.0,
  },

  plague: {
    id: "plague",
    displayName: "PLAGUE WARDEN",
    taunt: "BREATHE DEEP. ROT WITH ME.",
    tint: { r: 0.55, g: 1.05, b: 0.45 },
    emissiveBoost: { r: 0.10, g: 0.45, b: 0.10 },
    auraColor: { r: 0.45, g: 1.0, b: 0.35 },
    sabreColor: { r: 0.55, g: 1.0, b: 0.30 },
    projectileColor: { r: 0.40, g: 0.95, b: 0.30 },
    healthMultiplier: 1.25,
    damageMultiplier: 1.10,
  },

  frost: {
    id: "frost",
    displayName: "FROST KING",
    taunt: "FREEZE WHERE YOU STAND.",
    tint: { r: 0.65, g: 0.90, b: 1.10 },
    emissiveBoost: { r: 0.15, g: 0.40, b: 0.55 },
    auraColor: { r: 0.55, g: 0.85, b: 1.0 },
    sabreColor: { r: 0.65, g: 0.95, b: 1.0 },
    projectileColor: { r: 0.50, g: 0.85, b: 1.0 },
    healthMultiplier: 1.30,
    damageMultiplier: 1.15,
  },

  storm: {
    id: "storm",
    displayName: "STORM CALLER",
    taunt: "THE SKY ANSWERS TO ME.",
    tint: { r: 0.85, g: 0.55, b: 1.10 },
    emissiveBoost: { r: 0.40, g: 0.25, b: 0.55 },
    auraColor: { r: 0.85, g: 0.45, b: 1.0 },
    sabreColor: { r: 0.95, g: 0.65, b: 1.0 },
    projectileColor: { r: 0.80, g: 0.45, b: 1.0 },
    healthMultiplier: 1.40,
    damageMultiplier: 1.20,
  },

  void: {
    id: "void",
    displayName: "VOID STALKER",
    taunt: "I AM THE END OF THIS CITY.",
    tint: { r: 0.40, g: 0.30, b: 0.55 },
    emissiveBoost: { r: 0.45, g: 0.10, b: 0.55 },
    auraColor: { r: 0.65, g: 0.20, b: 1.0 },
    sabreColor: { r: 0.85, g: 0.30, b: 1.0 },
    projectileColor: { r: 0.65, g: 0.20, b: 0.95 },
    healthMultiplier: 1.60,
    damageMultiplier: 1.30,
  },
};

/** Resolve a variant id to its definition, falling back to `inferno` for
 *  unknown ids (e.g. a stale save written before the registry existed). */
export function getBossVariant(id: BossVariantId | string | undefined | null): BossVariant {
  if (id && (id as BossVariantId) in BOSS_VARIANTS) {
    return BOSS_VARIANTS[id as BossVariantId];
  }
  return BOSS_VARIANTS.inferno;
}
