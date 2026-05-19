import { EventBus, GameEvents } from "./EventBus";
import { BossVariantId } from "./BossVariants";

/** All world-level ids the campaign supports. Persisted as a number — older
 *  saves stored only `1 | 2`, those still load (anything > 4 is clamped to 4,
 *  anything < 1 is clamped to 1).
 *
 *  Levels 1–3 are the linear combat campaign (Detroit liberation). Level 4
 *  is **Ashur Sanctuary** — a peaceful side-zone where the player rehabilitates
 *  rescued Animatons (Char's animal-DNA synthetic mechanoids), grows special
 *  bio-crops, and runs errands for the nearby Village of Earth. It does not
 *  appear in the L1→L2→L3 progression chain; it's reached from the new TRAVEL
 *  tab on the upgrade menu and acts as the player's home base. */
export type WorldLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/** Persisted shape used by ProgressSync. */
export interface LevelSnapshot {
  worldLevel: WorldLevel;
}

interface LevelDef {
  level: WorldLevel;
  /** Display name shown in the TRAVEL tab. */
  displayName: string;
  /** Top-of-screen banner text. */
  banner: string;
  /** Long-form objective shown in the HUD. */
  objective: string;
  /** Wave/spawn intensity multiplier applied by Game.tsx. */
  difficultyMultiplier: number;
  /** Tint colour applied to the sky on this level. (Level 1 = neutral.) */
  skyTint: { r: number; g: number; b: number };
  /** Boss-captain variant assigned to this level's fortress. */
  bossVariantId: BossVariantId;
  /** World coordinate where this level's fortress is seeded. */
  fortressCenter: { x: number; z: number };
  /** World coordinate where the player is teleported on fast-travel-in. */
  spawnPoint: { x: number; z: number };
  /** Subtitle shown on the LEVEL COMPLETE overlay when this level falls. */
  completeSubtitle: string;
  /** When true, this level skips boss-fortress spawn, suppresses wave
   *  spawner intensity, and triggers SanctuarySystem mount. Used by Level 4
   *  (Ashur Sanctuary). */
  peaceful?: boolean;
  /** Per-level time-of-day in 0–24 hour clock. Game.tsx pipes this into
   *  SkySystem.setTimeOfDay on LEVEL_STARTED so the four ground levels
   *  read as visually distinct (morning / sunset / night / dawn) even
   *  though they share the same world geometry. Optional — Level 5 owns
   *  its own deep-space palette and ignores this. */
  timeOfDay?: number;
  /** Per-level city palette multiplier. Game.tsx pipes this into
   *  CityGenerator.setLevelTheme so the buildings + ground feel like a
   *  *different* city across levels (red Mars-like for L2, deep-violet
   *  void for L3, default cyan for L1, warm dawn for L4). Each component
   *  is multiplied against the building's stored original color so the
   *  per-building variety is preserved. */
  cityTheme?: {
    tint: { r: number; g: number; b: number };
    glowTint: { r: number; g: number; b: number };
    ground: { r: number; g: number; b: number };
  };
}

const LEVEL_DEFS: Record<WorldLevel, LevelDef> = {
  1: {
    level: 1,
    displayName: "DETROIT — Star City Front",
    banner: "LEVEL 1 — RESCUE THE ALLY",
    objective: "Breach the enemy fortress and rescue the captured ally.",
    difficultyMultiplier: 1.0,
    skyTint: { r: 1.0, g: 1.0, b: 1.0 },
    bossVariantId: "inferno",
    fortressCenter: { x: 380, z: -120 },
    spawnPoint: { x: 0, z: 0 },
    completeSubtitle: "Stand by — the war isn't over.",
    timeOfDay: 9.0, // crisp morning over Detroit
    cityTheme: {
      tint:     { r: 1.0, g: 1.0, b: 1.0 },
      glowTint: { r: 1.0, g: 1.0, b: 1.0 },
      ground:   { r: 1.0, g: 1.0, b: 1.0 },
    },
  },
  2: {
    level: 2,
    displayName: "DETROIT — Hold the Line",
    banner: "LEVEL 2 — HOLD THE LINE",
    objective: "The captains have invaded. Crush the next fortress and survive.",
    difficultyMultiplier: 1.5,
    skyTint: { r: 1.25, g: 0.55, b: 0.45 },
    bossVariantId: "plague",
    fortressCenter: { x: -360, z: -360 },
    spawnPoint: { x: -200, z: -200 },
    completeSubtitle: "The plague clears. One stronghold left.",
    timeOfDay: 18.5, // burning sunset (matches the red sky tint)
    // RED MARS — burnt amber buildings + rust-red ground. Reads as a
    // completely different city even though the geometry is shared.
    cityTheme: {
      tint:     { r: 1.6, g: 0.55, b: 0.35 },
      glowTint: { r: 1.8, g: 0.65, b: 0.30 },
      ground:   { r: 2.6, g: 1.20, b: 0.70 },
    },
  },
  3: {
    level: 3,
    displayName: "DETROIT — Purge the Void",
    banner: "LEVEL 3 — PURGE THE VOID",
    objective: "Storm the final command tower. End the invasion.",
    difficultyMultiplier: 2.0,
    skyTint: { r: 0.55, g: 0.55, b: 1.05 },
    bossVariantId: "void",
    fortressCenter: { x: -120, z: 420 },
    spawnPoint: { x: -60, z: 240 },
    completeSubtitle: "DETROIT IS FREE. The hybrids are broken.",
    timeOfDay: 22.5, // deep night under the violet "void" sky
    // VOID NIGHT — deep blue-violet city with cold magenta neon. Reads as
    // an entirely different "void-corrupted" Detroit.
    cityTheme: {
      tint:     { r: 0.45, g: 0.55, b: 1.30 },
      glowTint: { r: 1.30, g: 0.40, b: 1.80 },
      ground:   { r: 0.55, g: 0.50, b: 1.00 },
    },
  },
  4: {
    level: 4,
    displayName: "ASHUR SANCTUARY",
    banner: "ASHUR SANCTUARY — A QUIET PLACE TO HEAL",
    // Two intertwined loops: rehab Animatons rescued from Char/Swarm labs, and
    // run errands for the Village of Earth at the sanctuary's edge.
    objective: "Tend the bio-crops, rehabilitate rescued Animatons, and help the Village of Earth.",
    // Spawner intensity is gated to ~0 by the `peaceful` flag in Game.tsx; the
    // multiplier here only matters if anything reads it bypassing that check.
    difficultyMultiplier: 0.0,
    // Warm dawn over the sanctuary fields.
    skyTint: { r: 1.15, g: 1.0, b: 0.85 },
    // No boss for this level — value is unused while peaceful=true but a
    // real BossVariantId is required by the type. Pick anything stable.
    bossVariantId: "inferno",
    // Far off-map so even if any stale fortress-spawn slipped through, it
    // wouldn't land in the sanctuary itself.
    fortressCenter: { x: 9999, z: 9999 },
    // Top-left corner of the world (-480, -480) — past the city, against the
    // mountain ring at radius 560 from origin so the sanctuary sits in a
    // sheltered pocket of the wilderness.
    spawnPoint: { x: -480, z: -480 },
    completeSubtitle: "The sanctuary endures.",
    peaceful: true,
    timeOfDay: 6.5, // warm dawn over the sanctuary fields
    // SANCTUARY DAWN — soft warm/golden bias on the distant city behind
    // the village so it reads as a peaceful frontier outpost.
    cityTheme: {
      tint:     { r: 1.20, g: 1.00, b: 0.80 },
      glowTint: { r: 1.30, g: 1.10, b: 0.70 },
      ground:   { r: 1.40, g: 1.20, b: 0.90 },
    },
  },
  6: {
    level: 6,
    displayName: "PONTIAC SECRET LAB",
    banner: "PONTIAC SECRET LAB — RESTRICTED RESEARCH",
    objective: "Explore the covert lab. Read the terminals, study the cryo subjects, talk to Dr. You.",
    difficultyMultiplier: 0.0,
    // Cool blue-violet tint reads "lab interior under blacklight"; mostly
    // overridden by PontiacLabSystem's own emissive props anyway.
    skyTint: { r: 0.55, g: 0.65, b: 1.10 },
    bossVariantId: "void",
    fortressCenter: { x: -9999, z: 9999 },
    // Opposite world corner from Ashur Sanctuary (-480/-480) so the lab's
    // 1500m hide-bubble can't clip into the sanctuary's, and warps between
    // them are clearly different places.
    spawnPoint: { x: 480, z: 480 },
    completeSubtitle: "The lab keeps its secrets — for now.",
    peaceful: true,
    timeOfDay: 0.5, // late-night raid; black sky bleeds in around the lab edges
    // LAB INTERIOR — cold blue/cyan bias. The world geometry is hidden by
    // PontiacLabSystem on mount, so this theme only ever multiplies the
    // background sky / lighting, not visible meshes.
    cityTheme: {
      tint:     { r: 0.55, g: 0.75, b: 1.20 },
      glowTint: { r: 0.50, g: 0.90, b: 1.40 },
      ground:   { r: 0.40, g: 0.50, b: 0.70 },
    },
  },
  5: {
    level: 5,
    displayName: "ORBITAL FRONT",
    banner: "LEVEL 5 — ORBITAL FRONT",
    objective: "Engage the orbital fleet — clear asteroids and bring down the motherships.",
    difficultyMultiplier: 2.4,
    // Cool blue void tint — most of the visual swap is owned by SpaceLevelSystem
    // (custom skybox + Earth + asteroids); this tint is only the residual
    // multiplier applied to lighting.
    skyTint: { r: 0.4, g: 0.5, b: 0.95 },
    bossVariantId: "void",
    // Off-map fortress center — combat in space is owned by AerialEnemySystem,
    // not the ground BossFortress chain. The space-level handler in Game.tsx
    // gates ground-fortress spawning behind a `spacelike` check the same way
    // the sanctuary does for `peaceful`.
    fortressCenter: { x: 9999, z: -9999 },
    // Spawn near origin so the SpaceLevelSystem's asteroid band naturally
    // surrounds the player on warp-in.
    spawnPoint: { x: 0, z: 0 },
    completeSubtitle: "Orbit secured.",
  },
  8: {
    level: 8,
    displayName: "SAGINAW UNDERWATER LAB",
    banner: "LEVEL 8 — SAGINAW UNDERWATER LAB",
    objective: "Breach the flooded Saginaw lab. Survive the captains. Bring down the spider tanks.",
    // Hardest combat zone in the game — bumps over the lair (2.8) so it
    // reads as the post-lair endgame challenge.
    difficultyMultiplier: 3.5,
    // Deep blue/teal tint that bleeds through the lab's flooded ceiling.
    // The Saginaw system itself owns its visual identity (caustics,
    // water surface, blue fog) via SaginawLabSystem.
    skyTint: { r: 0.20, g: 0.45, b: 0.85 },
    bossVariantId: "frost",
    fortressCenter: { x: -9999, z: 9999 },
    // Far SE corner of the expanded open world — the lab now occupies its
    // own dedicated section of the map (~940 m beyond the mountain ring at
    // r=560), opposite the SW Zug Island section. Must match
    // SaginawLabSystem.CENTER so fast-travel lands at arena center.
    spawnPoint: { x: 1500, z: -1500 },
    completeSubtitle: "Saginaw is silent. The water swallows the rest.",
    timeOfDay: 23.0,
  },
  9: {
    level: 9,
    displayName: "ZUG ISLAND — LEGION",
    banner: "LEVEL 9 — ZUG ISLAND LEGION",
    objective: "Hold Zug Island. Cut down the Legion — titans, captains, spider tanks, no end.",
    // Hardest combat zone in the game by a wide margin — bumps over the
    // Saginaw Lab (3.5) so the wave-spawner keeps the enemy count
    // saturated even after the player levels their gear.
    difficultyMultiplier: 4.5,
    // Burnt orange/red tint — Zug Island's industrial sky reads as
    // perpetually slag-lit. The system itself owns its visual identity
    // (ember discs, blast furnaces, smokestacks) via ZugIslandSystem.
    skyTint: { r: 1.40, g: 0.55, b: 0.25 },
    bossVariantId: "inferno",
    fortressCenter: { x: 9999, z: -9999 },
    // Far SW corner of the expanded open world — the island now occupies
    // its own dedicated section of the map (~940 m beyond the mountain
    // ring at r=560), opposite the SE Saginaw Lab section. Must match
    // ZugIslandSystem.CENTER so fast-travel lands at arena center.
    spawnPoint: { x: -1500, z: -1500 },
    completeSubtitle: "The Legion is broken. Zug Island holds.",
    timeOfDay: 21.0,
  },
  10: {
    level: 10,
    displayName: "ANN ARBOR APOCALYPSE",
    banner: "LEVEL 10 — ANN ARBOR APOCALYPSE",
    objective: "A mothership has landed on Ann Arbor. Bring down the maxed captains on its deck and hold the streets against the swarm.",
    // Hardest level on the roster — maxed captains atop the saucer +
    // an everything-goes ground swarm. Bumps over Zug Legion (4.5).
    difficultyMultiplier: 5.0,
    // Sickly purple/violet apocalypse sky bleeding off the mothership.
    skyTint: { r: 0.85, g: 0.40, b: 1.10 },
    bossVariantId: "void",
    fortressCenter: { x: -9999, z: 9999 },
    // Pure WEST corner of the expanded open world — west of every
    // other map section (origin city, Saginaw SE, Zug SW). Must match
    // AnnArborSystem.CENTER so fast-travel lands on the city street
    // directly under the mothership.
    spawnPoint: { x: -3000, z: 0 },
    completeSubtitle: "The mothership is dead. Ann Arbor breathes.",
    timeOfDay: 21.5, // late-evening apocalypse
  },
  11: {
    level: 11,
    displayName: "MICHIGAN WILDS",
    banner: "MICHIGAN WILDS — HEIGHTMAP FRONTIER",
    objective: "Explore flooded lowlands, grass foothills, and rocky peaks generated from MIHEIGHTMAP.",
    difficultyMultiplier: 0.0,
    skyTint: { r: 0.80, g: 1.00, b: 1.08 },
    bossVariantId: "frost",
    fortressCenter: { x: 9999, z: 9999 },
    spawnPoint: { x: 3000, z: 1500 },
    completeSubtitle: "The wilds settle back into the mist.",
    peaceful: true,
    timeOfDay: 14.5,
  },
  7: {
    level: 7,
    displayName: "SWARMS LAIR",
    banner: "LEVEL 7 — SWARMS LAIR",
    objective: "Descend into the lair. Cut through the swarm. End the General.",
    // Combat zone, not a side-zone — but ground-fortress chain is suppressed
    // (the General is spawned by SwarmsLairSystem directly, not by an
    // EnemyBaseSystem fortress). Difficulty bumped above L3 to read as
    // "post-campaign challenge".
    difficultyMultiplier: 2.8,
    // Sickly red-violet tint that bleeds through the cave ceiling; the
    // lair itself owns most of its visual identity via SwarmsLairSystem.
    skyTint: { r: 0.85, g: 0.30, b: 0.55 },
    bossVariantId: "void",
    // Off-map fortress center — the lair is an indoor zone with its own
    // boss spawn flow. Game.tsx gates ground-fortress seeding behind the
    // new `isLair` check the same way it does for `peaceful` / spacelike.
    fortressCenter: { x: -9999, z: -9999 },
    // Spawn near origin so the SwarmsLairSystem's entry tunnel naturally
    // wraps around the player on warp-in.
    spawnPoint: { x: 0, z: 0 },
    completeSubtitle: "The General falls. The Swarm scatters.",
    timeOfDay: 22.0, // late night — even the surface bleed-through reads dim
  },
};

/** Tracks the player's world-level progression and drives transitions when
 *  the boss fortress falls.
 *
 *  Rules:
 *  - Starts at Level 1.
 *  - Each `BOSS_FORTRESS_CLEARED` advances by one until Level 3 is cleared.
 *  - Each transition fires `LEVEL_COMPLETED` (with the level we just beat),
 *    then after a short cinematic pause fires `LEVEL_STARTED` (with the next
 *    level's banner / objective / sky tint / fortress center / boss variant).
 *  - Clearing Level 3 fires `LEVEL_COMPLETED` with `final: true` and does
 *    not advance — the campaign is over.
 *  - `applyLoadedState` rehydrates a saved snapshot. If we resume mid-campaign
 *    we re-fire `LEVEL_STARTED` so the listeners (sky tint, spawner, HUD)
 *    re-apply their state.
 */
export class LevelSystem {
  private bus: EventBus;
  private currentLevel: WorldLevel = 1;
  private transitioning = false;
  /** Levels whose fortress has already been cleared. Prevents double-fire
   *  if `BOSS_FORTRESS_CLEARED` is replayed (e.g. corrupted save reload). */
  private clearedLevels = new Set<WorldLevel>();
  /** Active transition setTimeout id (so dispose() can cancel it and a stale
   *  callback can't emit `LEVEL_STARTED` into a fresh game session). */
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Position-tolerance for matching a `BOSS_FORTRESS_CLEARED` payload to
   *  the current level's fortress. World coords are integers; 8 m gives
   *  some slack for any future floor-snapping without bleeding into a
   *  neighbouring level's fortress (closest pair is L1↔L3 ~570 m apart). */
  private static readonly FORTRESS_MATCH_RADIUS = 8;
  /** Public hook so callers (e.g. progress save) can know when a transition
   *  is mid-flight — they should defer non-critical work until it's over. */
  get isTransitioning(): boolean { return this.transitioning; }

  constructor() {
    this.bus = EventBus.getInstance();
    this.bus.on(GameEvents.BOSS_FORTRESS_CLEARED, this.onFortressCleared);
  }

  /** Listener for the boss fortress clear event. We validate the cleared
   *  fortress's position against the current level's fortress so that on
   *  a loaded L2/L3 session, *also* clearing the seeded-at-startup L1
   *  fortress can't accidentally advance the level (the L1 fortress is
   *  always spawned at world init, but only the level's own fortress
   *  should advance progression). */
  private onFortressCleared = (payload: any): void => {
    if (this.clearedLevels.has(this.currentLevel)) return;

    // Verify the cleared fortress matches the current level's coordinate.
    const expected = LEVEL_DEFS[this.currentLevel].fortressCenter;
    const pos = payload?.position;
    if (pos && typeof pos.x === "number" && typeof pos.z === "number") {
      const dx = pos.x - expected.x;
      const dz = pos.z - expected.z;
      if (Math.hypot(dx, dz) > LevelSystem.FORTRESS_MATCH_RADIUS) {
        // A stale fortress (e.g. the L1 fortress on a loaded L2 session)
        // was cleared. Don't advance — that capstone belongs to a
        // different level.
        return;
      }
    }

    const cleared = this.currentLevel;
    this.clearedLevels.add(cleared);

    const def = LEVEL_DEFS[cleared];
    const isFinal = cleared === 3;
    this.transitioning = !isFinal;

    this.bus.emit(GameEvents.LEVEL_COMPLETED, {
      level: cleared,
      banner: def.banner,
      subtitle: def.completeSubtitle,
      final: isFinal,
    });

    if (isFinal) {
      // Campaign over — stay on Level 3 visuals; no advance.
      return;
    }

    const next = (cleared + 1) as WorldLevel;
    if (this.transitionTimer !== null) clearTimeout(this.transitionTimer);
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      this.advanceTo(next);
    }, 3000);
  };

  /** Internal: switch to the given level + emit `LEVEL_STARTED`. */
  private advanceTo(level: WorldLevel): void {
    this.currentLevel = level;
    this.transitioning = false;
    const def = LEVEL_DEFS[level];
    this.bus.emit(GameEvents.LEVEL_STARTED, {
      level,
      banner: def.banner,
      objective: def.objective,
      difficultyMultiplier: def.difficultyMultiplier,
      skyTint: def.skyTint,
      bossVariantId: def.bossVariantId,
      fortressCenter: { ...def.fortressCenter },
      // New fields for the sanctuary + fast-travel feature. Listeners
      // (Game.tsx LEVEL_STARTED handler) read `peaceful` to mount/dispose
      // SanctuarySystem and skip wave bumps + fortress seeding.
      spawnPoint: { ...def.spawnPoint },
      peaceful: def.peaceful === true,
      timeOfDay: def.timeOfDay,
      cityTheme: def.cityTheme,
    });
  }

  /** Manual jump used by fast-travel and the level-N boot path.
   *  Idempotent; **does not** auto-mark prior levels as cleared, because
   *  fast-travel is non-linear (especially traveling to the peaceful Level
   *  4 from mid-campaign). The save/load path goes through
   *  `applyLoadedState` which still marks 1..lvl-1 cleared for the linear
   *  combat chain (lvl 2 or 3). */
  forceStart(level: WorldLevel): void {
    // Always re-emit LEVEL_STARTED so consumers (sky tint, sanctuary mount,
    // HUD banner) re-apply their state — even when fast-travelling to the
    // level the player is already on.
    this.advanceTo(level);
  }

  getCurrentLevel(): WorldLevel { return this.currentLevel; }

  getObjectiveText(): string { return LEVEL_DEFS[this.currentLevel].objective; }

  getBannerText(): string { return LEVEL_DEFS[this.currentLevel].banner; }

  getDifficultyMultiplier(): number {
    return LEVEL_DEFS[this.currentLevel].difficultyMultiplier;
  }

  getSkyTint(): { r: number; g: number; b: number } {
    return { ...LEVEL_DEFS[this.currentLevel].skyTint };
  }

  /** Boss-captain variant for the *current* level's fortress. Used by
   *  Game.tsx when the BossFortress turret-clear handler spawns the captain. */
  getBossVariantId(): BossVariantId {
    return LEVEL_DEFS[this.currentLevel].bossVariantId;
  }

  /** World coordinate of the *current* level's fortress. Used by Game.tsx
   *  to seed the fortress mesh on level entry. */
  getFortressCenter(): { x: number; z: number } {
    return { ...LEVEL_DEFS[this.currentLevel].fortressCenter };
  }

  /** Static lookup — returns the fortress center for any level (used at
   *  initial world load to seed Level 1 before any LEVEL_STARTED fires). */
  static getFortressCenterFor(level: WorldLevel): { x: number; z: number } {
    return { ...LEVEL_DEFS[level].fortressCenter };
  }

  /** Static lookup — fast-travel teleport target for any level. */
  static getSpawnPointFor(level: WorldLevel): { x: number; z: number } {
    return { ...LEVEL_DEFS[level].spawnPoint };
  }

  /** Static lookup — display name for the TRAVEL tab. */
  static getDisplayNameFor(level: WorldLevel): string {
    return LEVEL_DEFS[level].displayName;
  }

  /** Static lookup — `true` if this level should suppress combat (no boss
   *  fortress, no wave spawning, sanctuary content active). */
  static isPeaceful(level: WorldLevel): boolean {
    return LEVEL_DEFS[level].peaceful === true;
  }

  /** Instance check — whether the *current* level is peaceful. */
  isPeaceful(): boolean {
    return LEVEL_DEFS[this.currentLevel].peaceful === true;
  }

  /** All known levels — used by the TRAVEL tab. */
  static getAllLevels(): WorldLevel[] {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  }

  /** `true` for Ann Arbor Apocalypse (Level 10) — a medium-sized
   *  city WEST of every other map section, with a giant alien
   *  mothership crashed through the downtown towers. Combat is
   *  active: 10 maxed captains atop the saucer + a continuous
   *  ground swarm of every robot type. Spawns are owned by
   *  AnnArborSystem rather than the standard wave/fortress chain. */
  static isAnnArbor(level: WorldLevel): boolean {
    return level === 10;
  }

  /** `true` for Michigan Wilds (Level 11) — a heightmap terrain side-zone
   *  generated from MIHEIGHTMAP.png. It hides the city and keeps the city
   *  material pipeline untouched while TerrainMaterial handles lowland /
   *  foothill / mountain texture mixing. */
  static isMichiganTerrain(level: WorldLevel): boolean {
    return level === 11;
  }

  /** `true` for the Saginaw Underwater Lab (Level 8) — a flooded indoor
   *  combat side-zone reachable from the TRAVEL tab. Like the Swarms
   *  Lair, combat IS active here, but spawns are owned by
   *  SaginawLabSystem (captains-only + spider-tank mid-bosses) rather
   *  than the standard wave/fortress chain. */
  static isSaginawLab(level: WorldLevel): boolean {
    return level === 8;
  }

  /** `true` for the Zug Island Legion (Level 9) — a wide-open industrial
   *  wasteland combat side-zone. Like the Saginaw Lab, combat IS active
   *  here, but spawns are owned by ZugIslandSystem (sustained waves of
   *  titans + captains + spider tanks) rather than the standard
   *  wave/fortress chain. */
  static isZugIsland(level: WorldLevel): boolean {
    return level === 9;
  }

  /** `true` for the Pontiac Secret Lab side-zone (Level 6). Like the
   *  sanctuary it's `peaceful` (no waves, no fortress) but it owns its
   *  own indoor world — `PontiacLabSystem` mounts on this level and
   *  hides the city + mountains + foliage + props so the player walks a
   *  dark metallic lab interior instead of a corner of Detroit. */
  static isLab(level: WorldLevel): boolean {
    return level === 6;
  }

  /** `true` for off-canon side-zones that should suppress the campaign's
   *  ground combat / fortress chain (peaceful sanctuary, orbital combat).
   *  Anything `spacelike` swaps the skybox via SpaceLevelSystem and skips
   *  ground-fortress seeding the same way `peaceful` skips ground combat. */
  static isSpacelike(level: WorldLevel): boolean {
    return level === 5;
  }

  /** `true` for the Swarms Lair (Level 7) — an indoor cave combat zone
   *  reachable from the Pontiac Lab cave hatch or from the TRAVEL tab.
   *  `SwarmsLairSystem` mounts on this level and hides the outer world
   *  (city + mountains + foliage + props) the same way the lab and
   *  sanctuary do. Combat IS active here — but the General boss is
   *  spawned directly by SwarmsLairSystem instead of an EnemyBaseSystem
   *  fortress, so the standard ground-fortress chain in Game.tsx is
   *  gated behind this check. */
  static isLair(level: WorldLevel): boolean {
    return level === 7;
  }

  /** Persisted snapshot for ProgressSync. */
  getSnapshot(): LevelSnapshot {
    return { worldLevel: this.currentLevel };
  }

  /** Restore from a saved snapshot. The saved level's `LEVEL_STARTED` is
   *  re-fired so listeners (sky, spawner, HUD) reapply their state. */
  applyLoadedState(snap: Partial<LevelSnapshot> | null | undefined): void {
    let lvl: WorldLevel = 1;
    const raw = snap && typeof snap.worldLevel === "number" ? snap.worldLevel : 1;
    if (raw >= 11) lvl = 11;
    else if (raw === 10) lvl = 10;
    else if (raw === 9) lvl = 9;
    else if (raw === 8) lvl = 8;
    else if (raw === 7) lvl = 7;
    else if (raw === 6) lvl = 6;
    else if (raw === 5) lvl = 5;
    else if (raw === 4) lvl = 4;
    else if (raw === 3) lvl = 3;
    else if (raw === 2) lvl = 2;
    else lvl = 1;

    if (lvl === 1) {
      this.currentLevel = 1;
      this.clearedLevels.clear();
      return;
    }
    // Levels 4 (sanctuary), 5 (orbital), 6 (Pontiac Lab), 7 (Swarms Lair),
    // 8 (Saginaw Lab), 9 (Zug Island), 10 (Ann Arbor), and 11 (Michigan
    // Wilds) are side-content — don't auto-mark L1/L2/L3 as
    // cleared just because the player saved there; that would let them
    // skip the campaign on re-entry. Only treat the main chain (1→2→3)
    // as cleared-on-load.
    if (lvl === 4 || lvl === 5 || lvl === 6 || lvl === 7 || lvl === 8 || lvl === 9 || lvl === 10 || lvl === 11) {
      this.advanceTo(lvl);
      return;
    }
    for (let l = 1; l < lvl; l++) this.clearedLevels.add(l as WorldLevel);
    this.advanceTo(lvl);
  }

  dispose(): void {
    this.bus.off(GameEvents.BOSS_FORTRESS_CLEARED, this.onFortressCleared);
    if (this.transitionTimer !== null) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
  }
}
