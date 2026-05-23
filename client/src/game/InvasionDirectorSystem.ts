import { EventBus, GameEvents } from "./EventBus";
import type { WorldLevel } from "./LevelSystem";

export type ZoneState = "uncleared" | "liberated" | "peaceful" | "threatened" | "invaded" | "purified";

export type WorldZoneId =
  | "detroit_star_city"
  | "detroit_hold_line"
  | "detroit_void"
  | "ashur_sanctuary"
  | "orbital_front"
  | "pontiac_lab"
  | "swarms_lair"
  | "saginaw_lab"
  | "zug_island"
  | "ann_arbor"
  | "michigan_wilds";

export interface RebuildZoneDef {
  id: WorldZoneId;
  worldLevel: WorldLevel;
  name: string;
  invasionEligible: boolean;
  baseThreat: number;
}

export interface ZoneProgress {
  id: WorldZoneId;
  worldLevel: WorldLevel;
  state: ZoneState;
  threatLevel: number;
  victories: number;
  liberatedAt: number | null;
  peaceStartedAt: number | null;
  lastResolvedAt: number | null;
}

export interface ActiveInvasionSnapshot {
  zoneId: WorldZoneId;
  worldLevel: WorldLevel;
  threatLevel: number;
  startedAt: number;
}

export interface InvasionDirectorSnapshot {
  mainCampaignComplete: boolean;
  nextInvasionIn: number;
  warningZoneId: WorldZoneId | null;
  warningTimer: number;
  activeInvasion: ActiveInvasionSnapshot | null;
  zones: Partial<Record<WorldZoneId, ZoneProgress>>;
}

const REBUILD_ZONES: RebuildZoneDef[] = [
  { id: "detroit_star_city", worldLevel: 1, name: "Detroit Star City Front", invasionEligible: true, baseThreat: 1 },
  { id: "detroit_hold_line", worldLevel: 2, name: "Detroit Hold the Line", invasionEligible: true, baseThreat: 2 },
  { id: "detroit_void", worldLevel: 3, name: "Detroit Void Front", invasionEligible: true, baseThreat: 3 },
  { id: "ashur_sanctuary", worldLevel: 4, name: "Ashur Sanctuary", invasionEligible: false, baseThreat: 1 },
  { id: "orbital_front", worldLevel: 5, name: "Orbital Front", invasionEligible: true, baseThreat: 4 },
  { id: "pontiac_lab", worldLevel: 6, name: "Pontiac Secret Lab", invasionEligible: false, baseThreat: 2 },
  { id: "swarms_lair", worldLevel: 7, name: "Swarms Lair", invasionEligible: true, baseThreat: 5 },
  { id: "saginaw_lab", worldLevel: 8, name: "Saginaw Underwater Lab", invasionEligible: true, baseThreat: 5 },
  { id: "zug_island", worldLevel: 9, name: "Zug Island Legion", invasionEligible: true, baseThreat: 6 },
  { id: "ann_arbor", worldLevel: 10, name: "Ann Arbor Apocalypse", invasionEligible: true, baseThreat: 6 },
  { id: "michigan_wilds", worldLevel: 11, name: "Michigan Wildlands", invasionEligible: true, baseThreat: 7 },
];

const ZONES_BY_LEVEL = new Map<WorldLevel, RebuildZoneDef>(
  REBUILD_ZONES.map((zone) => [zone.worldLevel, zone]),
);
const ZONES_BY_ID = new Map<WorldZoneId, RebuildZoneDef>(
  REBUILD_ZONES.map((zone) => [zone.id, zone]),
);

const INITIAL_PEACE_SECONDS = 15 * 60;
const REPEAT_PEACE_SECONDS = 20 * 60;
const WARNING_SECONDS = 2 * 60;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function cloneZone(progress: ZoneProgress): ZoneProgress {
  return { ...progress };
}

function makeZoneProgress(def: RebuildZoneDef): ZoneProgress {
  return {
    id: def.id,
    worldLevel: def.worldLevel,
    state: "uncleared",
    threatLevel: def.baseThreat,
    victories: 0,
    liberatedAt: null,
    peaceStartedAt: null,
    lastResolvedAt: null,
  };
}

export class InvasionDirectorSystem {
  private bus = EventBus.getInstance();
  private zones = new Map<WorldZoneId, ZoneProgress>();
  private mainCampaignComplete = false;
  private nextInvasionIn = INITIAL_PEACE_SECONDS;
  private warningZoneId: WorldZoneId | null = null;
  private warningTimer = 0;
  private activeInvasion: ActiveInvasionSnapshot | null = null;
  private currentLevelProvider: (() => WorldLevel | null) | null = null;
  private settlementStrengthProvider: (() => number) | null = null;

  constructor() {
    for (const def of REBUILD_ZONES) {
      this.zones.set(def.id, makeZoneProgress(def));
    }
    this.bus.on(GameEvents.LEVEL_COMPLETED, this.onLevelCompleted);
    this.bus.on(GameEvents.BOSS_FORTRESS_CLEARED, this.onBossFortressCleared);
    this.bus.on(GameEvents.SWARMS_GENERAL_DEFEATED, this.onSwarmsGeneralDefeated);
    console.log("[InvasionDirectorSystem] Initialized");
  }

  setCurrentLevelProvider(provider: () => WorldLevel | null): void {
    this.currentLevelProvider = provider;
  }

  setSettlementStrengthProvider(provider: () => number): void {
    this.settlementStrengthProvider = provider;
  }

  update(dt: number): void {
    if (!this.mainCampaignComplete || dt <= 0) return;
    if (this.activeInvasion) return;

    if (this.warningZoneId) {
      this.warningTimer += dt;
      if (this.warningTimer >= WARNING_SECONDS) {
        const zone = this.zones.get(this.warningZoneId);
        this.warningZoneId = null;
        this.warningTimer = 0;
        if (zone) this.startInvasion(zone);
      }
      return;
    }

    this.nextInvasionIn = Math.max(0, this.nextInvasionIn - dt);
    if (this.nextInvasionIn > 0) return;

    const target = this.chooseInvasionTarget();
    if (!target) {
      this.nextInvasionIn = REPEAT_PEACE_SECONDS;
      return;
    }
    this.startWarning(target);
  }

  getSnapshot(): InvasionDirectorSnapshot {
    const zones: Partial<Record<WorldZoneId, ZoneProgress>> = {};
    this.zones.forEach((progress, id) => {
      if (progress.state !== "uncleared" || progress.victories > 0) {
        zones[id] = cloneZone(progress);
      }
    });
    return {
      mainCampaignComplete: this.mainCampaignComplete,
      nextInvasionIn: this.nextInvasionIn,
      warningZoneId: this.warningZoneId,
      warningTimer: this.warningTimer,
      activeInvasion: this.activeInvasion ? { ...this.activeInvasion } : null,
      zones,
    };
  }

  applyLoadedState(snapshot: InvasionDirectorSnapshot | null | undefined): void {
    if (!snapshot) return;
    this.mainCampaignComplete = !!snapshot.mainCampaignComplete;
    this.nextInvasionIn = typeof snapshot.nextInvasionIn === "number"
      ? Math.max(0, snapshot.nextInvasionIn)
      : INITIAL_PEACE_SECONDS;
    this.warningZoneId = snapshot.warningZoneId && ZONES_BY_ID.has(snapshot.warningZoneId)
      ? snapshot.warningZoneId
      : null;
    this.warningTimer = typeof snapshot.warningTimer === "number" ? Math.max(0, snapshot.warningTimer) : 0;
    this.activeInvasion = snapshot.activeInvasion && ZONES_BY_ID.has(snapshot.activeInvasion.zoneId)
      ? { ...snapshot.activeInvasion }
      : null;

    if (snapshot.zones) {
      for (const [rawId, rawProgress] of Object.entries(snapshot.zones)) {
        const id = rawId as WorldZoneId;
        const def = ZONES_BY_ID.get(id);
        if (!def || !rawProgress) continue;
        this.zones.set(id, {
          id,
          worldLevel: def.worldLevel,
          state: this.sanitizeState(rawProgress.state),
          threatLevel: Number.isFinite(rawProgress.threatLevel) ? Math.max(1, rawProgress.threatLevel) : def.baseThreat,
          victories: Number.isFinite(rawProgress.victories) ? Math.max(0, rawProgress.victories) : 0,
          liberatedAt: typeof rawProgress.liberatedAt === "number" ? rawProgress.liberatedAt : null,
          peaceStartedAt: typeof rawProgress.peaceStartedAt === "number" ? rawProgress.peaceStartedAt : null,
          lastResolvedAt: typeof rawProgress.lastResolvedAt === "number" ? rawProgress.lastResolvedAt : null,
        });
      }
    }
  }

  hydrateLegacyProgress(worldLevel: WorldLevel | undefined, swarmsGeneralDefeated: boolean | undefined): void {
    if (worldLevel === 2) {
      this.markZoneLiberated(1, { quiet: true });
    } else if (worldLevel === 3) {
      this.markZoneLiberated(1, { quiet: true });
      this.markZoneLiberated(2, { quiet: true });
    }
    if (swarmsGeneralDefeated) {
      this.markZoneLiberated(7, { quiet: true, purified: true });
    }
  }

  getZoneProgress(levelOrId: WorldLevel | WorldZoneId): ZoneProgress | null {
    const def = typeof levelOrId === "number" ? ZONES_BY_LEVEL.get(levelOrId) : ZONES_BY_ID.get(levelOrId);
    if (!def) return null;
    const progress = this.zones.get(def.id);
    return progress ? cloneZone(progress) : null;
  }

  getActiveInvasion(): ActiveInvasionSnapshot | null {
    return this.activeInvasion ? { ...this.activeInvasion } : null;
  }

  resolveInvasion(levelOrId: WorldLevel | WorldZoneId, reason: string = "defended"): void {
    const def = typeof levelOrId === "number" ? ZONES_BY_LEVEL.get(levelOrId) : ZONES_BY_ID.get(levelOrId);
    if (!def) return;
    const zone = this.zones.get(def.id);
    if (!zone) return;
    if (zone.state !== "invaded" && zone.state !== "threatened") return;

    zone.state = "purified";
    zone.victories += 1;
    zone.threatLevel = Math.max(def.baseThreat, zone.threatLevel + 1);
    zone.lastResolvedAt = nowSeconds();
    zone.peaceStartedAt = zone.lastResolvedAt;
    if (this.activeInvasion?.zoneId === zone.id) this.activeInvasion = null;
    if (this.warningZoneId === zone.id) {
      this.warningZoneId = null;
      this.warningTimer = 0;
    }
    this.nextInvasionIn = REPEAT_PEACE_SECONDS;
    this.emitZoneState(zone);
    this.bus.emit(GameEvents.INVASION_RESOLVED, {
      zoneId: zone.id,
      worldLevel: zone.worldLevel,
      name: def.name,
      threatLevel: zone.threatLevel,
      reason,
    });
    this.bus.emit(GameEvents.UI_MESSAGE, {
      text: `${def.name.toUpperCase()} DEFENDED - PEACE RESTORED`,
      duration: 5000,
    });
  }

  dispose(): void {
    this.bus.off(GameEvents.LEVEL_COMPLETED, this.onLevelCompleted);
    this.bus.off(GameEvents.BOSS_FORTRESS_CLEARED, this.onBossFortressCleared);
    this.bus.off(GameEvents.SWARMS_GENERAL_DEFEATED, this.onSwarmsGeneralDefeated);
  }

  private onLevelCompleted = (payload: any): void => {
    const level = typeof payload?.level === "number" ? payload.level as WorldLevel : null;
    if (!level) return;
    this.markZoneLiberated(level);
    if (level === 3 || payload?.final) {
      this.mainCampaignComplete = true;
      this.nextInvasionIn = Math.max(10 * 60, this.nextInvasionIn);
      this.bus.emit(GameEvents.UI_MESSAGE, {
        text: "REBUILD ERA UNLOCKED - EARTH WILL HOLD",
        duration: 5200,
      });
    }
  };

  private onBossFortressCleared = (): void => {
    const currentLevel = this.currentLevelProvider?.() ?? null;
    if (!currentLevel) return;
    const active = this.activeInvasion;
    if (active && active.worldLevel === currentLevel) {
      this.resolveInvasion(currentLevel, "fortress_cleared");
    }
  };

  private onSwarmsGeneralDefeated = (): void => {
    this.markZoneLiberated(7, { purified: true });
    if (this.activeInvasion?.worldLevel === 7) {
      this.resolveInvasion(7, "general_defeated");
    }
  };

  private markZoneLiberated(
    level: WorldLevel,
    opts: { quiet?: boolean; purified?: boolean } = {},
  ): void {
    const def = ZONES_BY_LEVEL.get(level);
    if (!def) return;
    const zone = this.zones.get(def.id);
    if (!zone) return;

    const nextState: ZoneState = opts.purified ? "purified" : "peaceful";
    if (zone.state === "invaded" || zone.state === "threatened") return;
    if (zone.state === nextState || zone.state === "purified") return;

    const stamp = nowSeconds();
    zone.state = nextState;
    zone.liberatedAt = zone.liberatedAt ?? stamp;
    zone.peaceStartedAt = stamp;
    zone.threatLevel = Math.max(zone.threatLevel, def.baseThreat);
    this.emitZoneState(zone);

    if (!opts.quiet && def.invasionEligible) {
      this.bus.emit(GameEvents.UI_MESSAGE, {
        text: `${def.name.toUpperCase()} LIBERATED - PATROLS REMAIN OPEN`,
        duration: 4200,
      });
    }
  }

  private startWarning(zone: ZoneProgress): void {
    const def = ZONES_BY_ID.get(zone.id);
    if (!def) return;
    zone.state = "threatened";
    zone.threatLevel = this.calculateThreatLevel(zone, def);
    this.warningZoneId = zone.id;
    this.warningTimer = 0;
    this.emitZoneState(zone);
    this.bus.emit(GameEvents.INVASION_WARNING, {
      zoneId: zone.id,
      worldLevel: zone.worldLevel,
      name: def.name,
      threatLevel: zone.threatLevel,
      warningSeconds: WARNING_SECONDS,
    });
    this.bus.emit(GameEvents.UI_MESSAGE, {
      text: `INVASION WARNING - ${def.name.toUpperCase()} NEEDS DEFENSES`,
      duration: 6000,
    });
  }

  private startInvasion(zone: ZoneProgress): void {
    const def = ZONES_BY_ID.get(zone.id);
    if (!def) return;
    zone.state = "invaded";
    const startedAt = nowSeconds();
    this.activeInvasion = {
      zoneId: zone.id,
      worldLevel: zone.worldLevel,
      threatLevel: zone.threatLevel,
      startedAt,
    };
    this.emitZoneState(zone);
    this.bus.emit(GameEvents.INVASION_STARTED, {
      zoneId: zone.id,
      worldLevel: zone.worldLevel,
      name: def.name,
      threatLevel: zone.threatLevel,
      startedAt,
    });
    this.bus.emit(GameEvents.UI_MESSAGE, {
      text: `${def.name.toUpperCase()} UNDER INVASION - DEFEND AND PURGE`,
      duration: 6500,
    });
  }

  private chooseInvasionTarget(): ZoneProgress | null {
    const candidates = Array.from(this.zones.values())
      .filter((zone) => {
        const def = ZONES_BY_ID.get(zone.id);
        return !!def
          && def.invasionEligible
          && (zone.state === "peaceful" || zone.state === "liberated" || zone.state === "purified");
      })
      .sort((a, b) => {
        const aResolved = a.lastResolvedAt ?? 0;
        const bResolved = b.lastResolvedAt ?? 0;
        if (aResolved !== bResolved) return aResolved - bResolved;
        return a.worldLevel - b.worldLevel;
      });
    return candidates[0] ?? null;
  }

  private calculateThreatLevel(zone: ZoneProgress, def: RebuildZoneDef): number {
    const settlementStrength = this.settlementStrengthProvider?.() ?? 0;
    const strengthDampener = Math.min(2, Math.floor(settlementStrength / 18));
    return Math.max(1, def.baseThreat + zone.victories - strengthDampener);
  }

  private emitZoneState(zone: ZoneProgress): void {
    const def = ZONES_BY_ID.get(zone.id);
    this.bus.emit(GameEvents.ZONE_STATE_CHANGED, {
      zoneId: zone.id,
      worldLevel: zone.worldLevel,
      name: def?.name ?? zone.id,
      state: zone.state,
      threatLevel: zone.threatLevel,
      victories: zone.victories,
    });
  }

  private sanitizeState(state: unknown): ZoneState {
    if (
      state === "uncleared" ||
      state === "liberated" ||
      state === "peaceful" ||
      state === "threatened" ||
      state === "invaded" ||
      state === "purified"
    ) {
      return state;
    }
    return "uncleared";
  }
}
