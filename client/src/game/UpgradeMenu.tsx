import React, { useState, useEffect, useMemo, useRef } from "react";
import type { WeaponUpgradeInfo } from "./WeaponsSystem";
import type { CompanionUpgradeInfo } from "./CompanionSystem";
import type { PlayerUpgradeInfo } from "./PlayerController";
import type { ElementalUpgradeInfo } from "./ElementalSpecialsSystem";
import { JEWEL_DEFS, JEWEL_TIERS, type JewelTier } from "./JewelSystem";

/** Per-weapon Power-Jewel state surfaced into the WEAPONS tab. The menu
 *  shows the currently-mounted jewel (if any) plus mount buttons for every
 *  tier the player still has stockpiled in their inventory. */
export interface WeaponJewelInfo {
  /** WeaponType ("pistol" | "rifle" | …). Plain string so this module
   *  doesn't need to import the WeaponsSystem type circularly. */
  weaponType: string;
  mounted: JewelTier | null;
  /** How many of each jewel tier the player owns in their inventory.
   *  Buttons are disabled when the count is zero (or the same tier is
   *  already mounted). */
  available: Record<JewelTier, number>;
}

export interface CompanionWeaponInfo {
  id: string;
  name: string;
  weaponLevel: number;
  maxLevel: number;
  cost: { gears: number; cores: number } | null;
  affordable: boolean;
}

export interface SpecialUpgradeInfo {
  id: string;
  name: string;
  description: string;
  owned: boolean;
  cost: { gears: number; cores: number; nanofiber: number; circuits?: number; credits?: number };
  affordable: boolean;
}

/** One destination listed in the TRAVEL tab. */
export interface TravelWarpPoint {
  x: number;
  z: number;
  y?: number;
}

export interface TravelDestinationInfo {
  /** Stable row id. Defaults to `level` for normal level warps. */
  id?: string;
  /** WorldLevel id. Kept as plain number so this module doesn't need to
   *  import the LevelSystem type-circularly. */
  level: number;
  /** Display name shown in the row. */
  name: string;
  /** One-line flavour for the destination. */
  description: string;
  /** When true, the row is disabled (locked / not yet unlocked). */
  locked?: boolean;
  /** Lock reason — shown in place of the warp button when `locked`. */
  lockReason?: string;
  /** Optional in-level destination, used for named open-world warp points. */
  warpPoint?: TravelWarpPoint;
}

interface UpgradeMenuProps {
  open: boolean;
  weapons: WeaponUpgradeInfo[];
  companions: CompanionUpgradeInfo[];
  playerUpgrades?: PlayerUpgradeInfo[];
  /** Per-element upgrade rows — rendered at the bottom of the PLAYER tab. */
  elementalUpgrades?: ElementalUpgradeInfo[];
  onUpgradeElemental?: (kind: string) => void;
  playerCredits?: number;
  resources: { gears: number; scrap: number; cores: number; circuits: number; nanofiber: number };
  partCounts: Record<string, number>;
  specials?: SpecialUpgradeInfo[];
  companionWeapons?: CompanionWeaponInfo[];
  travelDestinations?: TravelDestinationInfo[];
  /** WorldLevel the player is currently in — used to highlight the row. */
  currentLevel?: number;
  onUpgradeWeapon: (type: string) => void;
  onUpgradeCompanion: (id: string) => void;
  onUpgradePlayer?: (id: string) => void;
  onUnlockSpecial?: (id: string) => void;
  onUpgradeCompanionWeapon?: (id: string) => void;
  onFastTravel?: (level: number, warpPoint?: TravelWarpPoint) => void;
  onClose: () => void;
  /** Per-weapon Power-Jewel state. When omitted the jewel slot UI is
   *  hidden — keeps backward compat with any caller that hasn't wired
   *  JewelSystem yet. */
  weaponJewelInfo?: Record<string, WeaponJewelInfo>;
  onMountJewel?: (type: string, tier: JewelTier) => void;
  onUnmountJewel?: (type: string) => void;
}

const formatStat = (n: number, digits = 1) => n.toFixed(digits);

const formatUpgradeValue = (id: string, value: number): string => {
  switch (id) {
    case "shieldRegenRate":  return `${value.toFixed(0)}/s`;
    case "shieldRegenDelay": return `${value.toFixed(1)}s`;
    // Armor-mod upgrades store fractional multipliers / reductions — format
    // them as percent so the player can actually see the boost.
    case "damageBoost":      return `+${Math.round(value * 100)}%`;
    case "fireRateBoost":    return `+${Math.round(value * 100)}%`;
    case "damageReduction":  return `-${Math.round(value * 100)}%`;
    case "staminaBoost":     return `+${value.toFixed(0)}`;
    default:                  return value.toFixed(0);
  }
};

export const UpgradeMenu: React.FC<UpgradeMenuProps> = ({
  open,
  weapons,
  companions,
  playerUpgrades = [],
  elementalUpgrades = [],
  onUpgradeElemental,
  playerCredits = 0,
  resources,
  partCounts,
  specials = [],
  companionWeapons = [],
  travelDestinations = [],
  currentLevel = 1,
  onUpgradeWeapon,
  onUpgradeCompanion,
  onUpgradePlayer,
  onUnlockSpecial,
  onUpgradeCompanionWeapon,
  onFastTravel,
  onClose,
  weaponJewelInfo,
  onMountJewel,
  onUnmountJewel,
}) => {
  const [tab, setTab] = useState<"player" | "weapons" | "robots" | "specials" | "travel">("player");
  // Per-tab selected-row index for gamepad / keyboard navigation. Each
  // tab keeps its own cursor so jumping between tabs doesn't lose the
  // player's place.
  const [selectedIdx, setSelectedIdx] = useState<Record<string, number>>({
    player: 0, weapons: 0, robots: 0, specials: 0, travel: 0,
  });
  // Refs for every selectable row, keyed by stable row id, so the active
  // row can be auto-scrolled into view on cursor change.
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Build a stable, ordered list of {key, activate, canActivate} for the
  // current tab. The `key` matches the React `key` (and the dataset
  // attribute) on each rendered row so selection highlight + ref lookup
  // line up. canActivate gates the A-button confirm so disabled rows
  // (maxed / unaffordable / locked / current zone) don't trip handlers.
  const rows = useMemo(() => {
    const out: { key: string; activate: () => void; canActivate: boolean }[] = [];
    if (tab === "player") {
      for (const p of playerUpgrades) {
        out.push({
          key: `p-${p.id}`,
          activate: () => onUpgradePlayer?.(p.id),
          canActivate: !p.maxed && p.affordable,
        });
      }
      for (const e of elementalUpgrades) {
        out.push({
          key: `e-${e.kind}`,
          activate: () => onUpgradeElemental?.(e.kind),
          canActivate: !e.maxed && e.affordable,
        });
      }
    } else if (tab === "weapons") {
      for (const w of weapons) {
        out.push({
          key: `w-${w.type}`,
          activate: () => onUpgradeWeapon(w.type),
          canActivate: w.level < w.maxLevel && w.affordable,
        });
      }
    } else if (tab === "robots") {
      for (const cw of companionWeapons) {
        out.push({
          key: `cw-${cw.id}`,
          activate: () => onUpgradeCompanionWeapon?.(cw.id),
          canActivate: cw.weaponLevel < cw.maxLevel && cw.affordable,
        });
      }
      for (const c of companions) {
        out.push({
          key: `c-${c.id}`,
          activate: () => onUpgradeCompanion(c.id),
          canActivate: c.level < c.maxLevel && c.affordable,
        });
      }
    } else if (tab === "specials") {
      for (const s of specials) {
        out.push({
          key: `s-${s.id}`,
          activate: () => onUnlockSpecial?.(s.id),
          canActivate: !s.owned && s.affordable,
        });
      }
    } else {
      for (const d of travelDestinations) {
        const key = `t-${d.id ?? d.level}`;
        out.push({
          key,
          activate: () => onFastTravel?.(d.level, d.warpPoint),
          canActivate: !d.locked && (d.warpPoint != null || d.level !== currentLevel),
        });
      }
    }
    return out;
  }, [tab, playerUpgrades, elementalUpgrades, weapons, companions, companionWeapons, specials, travelDestinations, currentLevel, onUpgradePlayer, onUpgradeElemental, onUpgradeWeapon, onUpgradeCompanion, onUpgradeCompanionWeapon, onUnlockSpecial, onFastTravel]);

  const TAB_ORDER = ["player", "weapons", "robots", "specials", "travel"] as const;
  const curIdx = Math.min(selectedIdx[tab] ?? 0, Math.max(0, rows.length - 1));
  const selectedKey = rows[curIdx]?.key ?? null;

  // Single navigation dispatch shared by gamepad CustomEvents AND
  // keyboard arrows / Enter so both controllers and keyboards can drive
  // the menu identically.
  useEffect(() => {
    if (!open) return;
    const nav = (action: "up" | "down" | "left" | "right" | "activate" | "close") => {
      if (action === "close") { onClose(); return; }
      if (action === "left" || action === "right") {
        const idx = TAB_ORDER.indexOf(tab);
        const nextIdx = (idx + (action === "right" ? 1 : -1) + TAB_ORDER.length) % TAB_ORDER.length;
        setTab(TAB_ORDER[nextIdx]);
        return;
      }
      if (action === "up" || action === "down") {
        setSelectedIdx(prev => {
          const max = Math.max(0, rows.length - 1);
          // Clamp the stored index to the current tab's row count BEFORE
          // applying the delta. Otherwise switching to a tab with fewer
          // rows than the stored index would silently swallow the first
          // Up press (architect MEDIUM finding).
          const cur = Math.min(prev[tab] ?? 0, max);
          const nextSel = Math.max(0, Math.min(max, cur + (action === "down" ? 1 : -1)));
          return { ...prev, [tab]: nextSel };
        });
        return;
      }
      if (action === "activate") {
        const r = rows[curIdx];
        if (r && r.canActivate) r.activate();
      }
    };
    const padHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { action?: string } | null;
      if (!detail?.action) return;
      nav(detail.action as Parameters<typeof nav>[0]);
    };
    const keyHandler = (e: KeyboardEvent) => {
      // Don't steal arrow keys from any focused text input (none today,
      // but defensive — a future search box would still work).
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      // Ignore OS auto-repeat: the menu uses a single discrete press per
      // step so the cursor doesn't sprint when a key is held. Gamepad
      // edge-detection in handleMenuMode already gives discrete presses.
      if (e.repeat) return;
      if (e.code === "ArrowUp")        { e.preventDefault(); nav("up"); }
      else if (e.code === "ArrowDown") { e.preventDefault(); nav("down"); }
      else if (e.code === "ArrowLeft") { e.preventDefault(); nav("left"); }
      else if (e.code === "ArrowRight"){ e.preventDefault(); nav("right"); }
      else if (e.code === "Enter")     { e.preventDefault(); nav("activate"); }
    };
    window.addEventListener("gamepad-menu", padHandler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("gamepad-menu", padHandler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [open, tab, rows, curIdx, onClose]);

  // Auto-scroll the selected row into view whenever the cursor moves so
  // controller-only navigation never strands the player off-screen.
  useEffect(() => {
    if (!open || !selectedKey) return;
    const el = rowRefs.current.get(selectedKey);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [open, selectedKey]);

  if (!open) return null;
  const ringClass = (key: string) =>
    selectedKey === key ? " ring-2 ring-amber-400 ring-offset-1 ring-offset-zinc-900" : "";
  const setRowRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(key, el);
    else rowRefs.current.delete(key);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 pointer-events-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[820px] max-w-[95vw] max-h-[88vh] flex flex-col bg-zinc-900 border-2 border-cyan-400 rounded-xl shadow-2xl shadow-cyan-500/30 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-cyan-700 bg-gradient-to-r from-cyan-950 to-zinc-900">
          <div>
            <div className="text-cyan-300 text-xl font-bold tracking-wider">UPGRADE BAY</div>
            <div className="text-cyan-500 text-xs">[TAB] to close</div>
          </div>
          <div className="flex gap-3 text-xs font-mono">
            <Resource label="CREDITS" value={playerCredits} color="yellow" />
            <Resource label="GEARS" value={resources.gears} color="amber" />
            <Resource label="SCRAP" value={resources.scrap} color="zinc" />
            <Resource label="CORES" value={resources.cores} color="cyan" />
            <Resource label="CIRCUITS" value={resources.circuits} color="emerald" />
            <Resource label="NANO" value={resources.nanofiber} color="fuchsia" />
          </div>
        </div>

        <div className="flex border-b border-zinc-700">
          <TabBtn active={tab === "player"} onClick={() => setTab("player")} label="PLAYER" />
          <TabBtn active={tab === "weapons"} onClick={() => setTab("weapons")} label="WEAPONS" />
          <TabBtn active={tab === "robots"} onClick={() => setTab("robots")} label="HELPER ROBOTS" />
          <TabBtn active={tab === "specials"} onClick={() => setTab("specials")} label="SPECIALS" />
          <TabBtn active={tab === "travel"} onClick={() => setTab("travel")} label="TRAVEL" />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {tab === "player" && (playerUpgrades.length === 0 ? (
            <div className="text-center text-zinc-400 py-8 text-sm">No player upgrades available.</div>
          ) : playerUpgrades.map(p => {
            const canAfford = p.affordable;
            return (
              <div ref={setRowRef(`p-${p.id}`)} key={p.id} className={`bg-zinc-800/80 border border-zinc-700 rounded-lg p-3 hover:border-yellow-500 transition${ringClass(`p-${p.id}`)}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="text-white font-bold uppercase">{p.name}</div>
                      <div className="text-yellow-400 text-xs font-mono">LVL {p.level}/{p.maxLevel}</div>
                    </div>
                    <div className="text-zinc-400 text-[11px] mt-1">{p.description}</div>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
                      <Stat
                        label="CURRENT"
                        cur={formatUpgradeValue(p.id, p.current)}
                        next={!p.maxed ? formatUpgradeValue(p.id, p.next) : null}
                        good={p.id === "shieldRegenDelay" ? "down" : "up"}
                      />
                    </div>
                  </div>
                  <div className="ml-3 text-right min-w-[120px]">
                    {p.maxed ? (
                      <div className="text-emerald-400 font-bold text-sm">MAX LEVEL</div>
                    ) : (
                      <>
                        <div className="text-[10px] text-zinc-400">COST:</div>
                        <div className={`text-xs ${playerCredits >= p.cost ? "text-yellow-300" : "text-red-400"}`}>{p.cost} credits</div>
                        <button
                          disabled={!canAfford}
                          onClick={() => onUpgradePlayer?.(p.id)}
                          className={`mt-1 px-3 py-1 rounded text-xs font-bold tracking-wider ${canAfford ? "bg-yellow-400 hover:bg-yellow-300 text-black" : "bg-zinc-700 text-zinc-500 cursor-not-allowed"}`}
                        >
                          UPGRADE
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          }))}

          {tab === "player" && elementalUpgrades.length > 0 && (
            <div className="mt-3 pt-2 border-t border-fuchsia-900/60">
              <div className="text-fuchsia-300 text-xs font-bold tracking-wider mb-2">ELEMENTAL POWERS — RB / DPad ↑↓</div>
              {elementalUpgrades.map(e => {
                const cdSec = (e.cooldownMs / 1000).toFixed(2);
                const nextCdSec = e.nextCooldownMs != null ? (e.nextCooldownMs / 1000).toFixed(2) : null;
                const radius = e.radius.toFixed(1);
                const nextRadius = e.nextRadius != null ? e.nextRadius.toFixed(1) : null;
                const isTracking = e.category === "tracking";
                return (
                  <div ref={setRowRef(`e-${e.kind}`)} key={e.kind} className={`bg-zinc-800/80 border border-zinc-700 rounded-lg p-3 hover:border-fuchsia-500 transition mb-2${ringClass(`e-${e.kind}`)}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <div className="text-white font-bold uppercase">{e.name}</div>
                          <div className="text-fuchsia-400 text-xs font-mono">LVL {e.level}/{e.maxLevel}</div>
                          <div className="text-zinc-400 text-[10px] font-mono uppercase">{e.category === "dome" ? "WAVE" : "TRACKING"}</div>
                        </div>
                        <div className={`grid ${isTracking ? "grid-cols-4" : "grid-cols-3"} gap-2 mt-2 text-[11px]`}>
                          <Stat label="DMG" cur={e.damage.toFixed(0)} next={e.nextDamage != null ? e.nextDamage.toFixed(0) : null} good="up" />
                          <Stat label="RADIUS" cur={`${radius}m`} next={nextRadius != null ? `${nextRadius}m` : null} good="up" />
                          <Stat label="CD" cur={`${cdSec}s`} next={nextCdSec != null ? `${nextCdSec}s` : null} good="down" />
                          {isTracking && (
                            <Stat
                              label="VOLLEY"
                              cur={`${e.projectilesPerCast}×`}
                              next={e.nextProjectilesPerCast != null && e.nextProjectilesPerCast !== e.projectilesPerCast ? `${e.nextProjectilesPerCast}×` : null}
                              good="up"
                            />
                          )}
                        </div>
                      </div>
                      <div className="ml-3 text-right min-w-[120px]">
                        {e.maxed ? (
                          <div className="text-emerald-400 font-bold text-sm">MAX LEVEL</div>
                        ) : (
                          <>
                            <div className="text-[10px] text-zinc-400">COST:</div>
                            <div className={`text-xs ${playerCredits >= e.cost ? "text-fuchsia-300" : "text-red-400"}`}>{e.cost} credits</div>
                            <button
                              disabled={!e.affordable}
                              onClick={() => onUpgradeElemental?.(e.kind)}
                              className={`mt-1 px-3 py-1 rounded text-xs font-bold tracking-wider ${e.affordable ? "bg-fuchsia-500 hover:bg-fuchsia-400 text-black" : "bg-zinc-700 text-zinc-500 cursor-not-allowed"}`}
                            >
                              UPGRADE
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "weapons" && weapons.map(w => {
            const partsHave = partCounts[w.type] ?? 0;
            const cost = w.cost;
            const canAfford = w.affordable;
            const maxed = w.level >= w.maxLevel;
            const jewel = weaponJewelInfo?.[w.type];
            return (
              <div ref={setRowRef(`w-${w.type}`)} key={w.type} className={`bg-zinc-800/80 border border-zinc-700 rounded-lg p-3 hover:border-cyan-600 transition${ringClass(`w-${w.type}`)}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="text-white font-bold uppercase">{w.name}</div>
                      <div className="text-amber-400 text-xs font-mono">LVL {w.level}/{w.maxLevel}</div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-2 text-[11px]">
                      <Stat label="DMG" cur={formatStat(w.damage)} next={!maxed ? formatStat(w.nextDamage ?? 0) : null} good="up" />
                      <Stat label="RATE" cur={`${(60000/w.fireRate).toFixed(0)}rpm`} next={!maxed ? `${(60000/(w.nextFireRate ?? 1)).toFixed(0)}rpm` : null} good="up" />
                      <Stat label="SPREAD" cur={formatStat(w.spread, 2)} next={!maxed ? formatStat(w.nextSpread ?? 0, 2) : null} good="down" />
                      <Stat label="IMPACT" cur={formatStat(w.knockback, 2)} next={!maxed ? formatStat(w.nextKnockback ?? 0, 2) : null} good="up" />
                    </div>
                  </div>
                  <div className="ml-3 text-right min-w-[120px]">
                    {maxed ? (
                      <div className="text-emerald-400 font-bold text-sm">MAX LEVEL</div>
                    ) : cost ? (
                      <>
                        <div className="text-[10px] text-zinc-400">COST:</div>
                        <div className={`text-xs ${resources.gears >= cost.gears ? "text-amber-300" : "text-red-400"}`}>{cost.gears} gears</div>
                        <div className={`text-xs ${partsHave >= cost.parts ? "text-cyan-300" : "text-red-400"}`}>{cost.parts} parts ({partsHave})</div>
                        <button
                          disabled={!canAfford}
                          onClick={() => onUpgradeWeapon(w.type)}
                          className={`mt-1 px-3 py-1 rounded text-xs font-bold tracking-wider ${canAfford ? "bg-cyan-500 hover:bg-cyan-400 text-black" : "bg-zinc-700 text-zinc-500 cursor-not-allowed"}`}
                        >
                          UPGRADE
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                {jewel && (
                  <div className="mt-2 pt-2 border-t border-zinc-700/60">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-[10px] text-fuchsia-300 font-bold tracking-wider">JEWEL SLOT:</div>
                      {jewel.mounted ? (
                        <>
                          <div
                            className="px-2 py-0.5 rounded text-[11px] font-bold border"
                            style={{
                              borderColor: JEWEL_DEFS[jewel.mounted].color,
                              color: JEWEL_DEFS[jewel.mounted].color,
                              background: "rgba(0,0,0,0.4)",
                              boxShadow: `0 0 8px ${JEWEL_DEFS[jewel.mounted].color}66`,
                            }}
                          >
                            ◆ {JEWEL_DEFS[jewel.mounted].shortName} +{Math.round(JEWEL_DEFS[jewel.mounted].bonusMul * 100)}% DMG
                          </div>
                          <button
                            onClick={() => onUnmountJewel?.(w.type)}
                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
                          >
                            UNMOUNT
                          </button>
                        </>
                      ) : (
                        <div className="text-[11px] text-zinc-500 italic">empty</div>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        {JEWEL_TIERS.map(tier => {
                          const def = JEWEL_DEFS[tier];
                          const count = jewel.available[tier] ?? 0;
                          const isMounted = jewel.mounted === tier;
                          const disabled = count <= 0 || isMounted;
                          return (
                            <button
                              key={tier}
                              disabled={disabled}
                              onClick={() => onMountJewel?.(w.type, tier)}
                              title={`${def.name} — +${Math.round(def.bonusMul * 100)}% damage`}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition ${disabled ? "bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed" : "hover:brightness-125"}`}
                              style={!disabled ? {
                                borderColor: def.color,
                                color: def.color,
                                background: "rgba(0,0,0,0.5)",
                              } : undefined}
                            >
                              {def.shortName} ({count})
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {tab === "robots" && companionWeapons.length > 0 && (
            <div className="bg-zinc-950/60 border border-fuchsia-900/60 rounded-lg p-3 mb-2">
              <div className="text-fuchsia-300 text-xs font-bold tracking-wider mb-2">HELPER WEAPONS</div>
              <div className="space-y-1">
                {companionWeapons.map(cw => {
                  const isMax = cw.weaponLevel >= cw.maxLevel;
                  return (
                    <div ref={setRowRef(`cw-${cw.id}`)} key={cw.id} className={`flex items-center justify-between bg-zinc-900/70 rounded px-2 py-1.5 text-[11px]${ringClass(`cw-${cw.id}`)}`}>
                      <div className="flex items-center gap-2">
                        <div className="text-zinc-200 font-bold">{cw.name}</div>
                        <div className="text-fuchsia-400 font-mono">WPN T{cw.weaponLevel}/{cw.maxLevel}</div>
                      </div>
                      {isMax ? (
                        <div className="text-emerald-400 font-bold">MAX</div>
                      ) : cw.cost ? (
                        <div className="flex items-center gap-2">
                          <div className={`${resources.gears >= cw.cost.gears ? "text-amber-300" : "text-red-400"}`}>{cw.cost.gears}g</div>
                          <div className={`${resources.cores >= cw.cost.cores ? "text-cyan-300" : "text-red-400"}`}>{cw.cost.cores}c</div>
                          <button
                            disabled={!cw.affordable}
                            onClick={() => onUpgradeCompanionWeapon?.(cw.id)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${cw.affordable ? "bg-fuchsia-500 hover:bg-fuchsia-400 text-black" : "bg-zinc-700 text-zinc-500 cursor-not-allowed"}`}
                          >
                            +TIER
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "robots" && (companions.length === 0 ? (
            <div className="text-center text-zinc-400 py-8 text-sm">No helper robots active. Build one at the Lab.</div>
          ) : companions.map(c => {
            const maxed = c.level >= c.maxLevel;
            const cost = c.cost;
            return (
              <div ref={setRowRef(`c-${c.id}`)} key={c.id} className={`bg-zinc-800/80 border border-zinc-700 rounded-lg p-3 hover:border-fuchsia-600 transition${ringClass(`c-${c.id}`)}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="text-white font-bold">{c.name}</div>
                      <div className="text-fuchsia-400 text-xs font-mono">LVL {c.level}/{c.maxLevel}</div>
                      <div className="text-zinc-500 text-[10px] uppercase">{c.type}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                      <Stat label="HP" cur={formatStat(c.maxHealth, 0)} next={!maxed ? formatStat(c.nextMaxHealth ?? 0, 0) : null} good="up" />
                      <Stat label="DMG" cur={formatStat(c.damage)} next={!maxed ? formatStat(c.nextDamage ?? 0) : null} good="up" />
                      <Stat label="SPD" cur={formatStat(c.speed, 2)} next={!maxed ? formatStat(c.nextSpeed ?? 0, 2) : null} good="up" />
                    </div>
                  </div>
                  <div className="ml-3 text-right min-w-[120px]">
                    {maxed ? (
                      <div className="text-emerald-400 font-bold text-sm">MAX LEVEL</div>
                    ) : cost ? (
                      <>
                        <div className="text-[10px] text-zinc-400">COST:</div>
                        <div className={`text-xs ${resources.gears >= cost.gears ? "text-amber-300" : "text-red-400"}`}>{cost.gears} gears</div>
                        <div className={`text-xs ${resources.cores >= cost.cores ? "text-cyan-300" : "text-red-400"}`}>{cost.cores} cores</div>
                        <button
                          disabled={!c.affordable}
                          onClick={() => onUpgradeCompanion(c.id)}
                          className={`mt-1 px-3 py-1 rounded text-xs font-bold tracking-wider ${c.affordable ? "bg-fuchsia-500 hover:bg-fuchsia-400 text-black" : "bg-zinc-700 text-zinc-500 cursor-not-allowed"}`}
                        >
                          UPGRADE
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          }))}

          {tab === "specials" && (specials.length === 0 ? (
            <div className="text-center text-zinc-400 py-8 text-sm">No specials available right now.</div>
          ) : specials.map(s => {
            const c = s.cost;
            const have = {
              gears: resources.gears, cores: resources.cores,
              nanofiber: resources.nanofiber, circuits: resources.circuits,
              credits: playerCredits,
            };
            return (
              <div ref={setRowRef(`s-${s.id}`)} key={s.id} className={`border rounded-lg p-3 transition ${s.owned ? "bg-emerald-950/40 border-emerald-700" : "bg-zinc-800/80 border-zinc-700 hover:border-purple-500"}${ringClass(`s-${s.id}`)}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="text-white font-bold uppercase tracking-wider">{s.name}</div>
                      {s.owned && <div className="text-emerald-300 text-[10px] font-bold">OWNED</div>}
                    </div>
                    <div className="text-zinc-400 text-[11px] mt-1">{s.description}</div>
                  </div>
                  <div className="ml-3 text-right min-w-[150px]">
                    {s.owned ? (
                      <div className="text-emerald-400 font-bold text-sm">UNLOCKED</div>
                    ) : (
                      <>
                        <div className="text-[10px] text-zinc-400">COST:</div>
                        <div className={`text-xs ${have.gears >= c.gears ? "text-amber-300" : "text-red-400"}`}>{c.gears} gears</div>
                        <div className={`text-xs ${have.cores >= c.cores ? "text-cyan-300" : "text-red-400"}`}>{c.cores} cores</div>
                        <div className={`text-xs ${have.nanofiber >= c.nanofiber ? "text-fuchsia-300" : "text-red-400"}`}>{c.nanofiber} nano</div>
                        {c.circuits != null && (
                          <div className={`text-xs ${have.circuits >= c.circuits ? "text-emerald-300" : "text-red-400"}`}>{c.circuits} circuits</div>
                        )}
                        {c.credits != null && (
                          <div className={`text-xs ${have.credits >= c.credits ? "text-yellow-300" : "text-red-400"}`}>{c.credits} credits</div>
                        )}
                        <button
                          disabled={!s.affordable}
                          onClick={() => onUnlockSpecial?.(s.id)}
                          className={`mt-1 px-3 py-1 rounded text-xs font-bold tracking-wider ${s.affordable ? "bg-purple-500 hover:bg-purple-400 text-black" : "bg-zinc-700 text-zinc-500 cursor-not-allowed"}`}
                        >
                          UNLOCK
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          }))}

          {tab === "travel" && (travelDestinations.length === 0 ? (
            <div className="text-center text-zinc-400 py-8 text-sm">No destinations available.</div>
          ) : (
            <>
              <div className="text-cyan-300 text-[11px] tracking-wider mb-2 px-1">
                FAST TRAVEL — instantly relocate to any unlocked zone. Your build progress and inventory are preserved.
              </div>
              {travelDestinations.map(d => {
                const rowKey = `t-${d.id ?? d.level}`;
                const isCurrent = d.warpPoint == null && d.level === currentLevel;
                const disabled = d.locked || isCurrent;
                return (
                  <div
                    ref={setRowRef(rowKey)}
                    key={rowKey}
                    className={`border rounded-lg p-3 transition ${isCurrent ? "bg-cyan-950/40 border-cyan-500" : d.locked ? "bg-zinc-900/60 border-zinc-800" : "bg-zinc-800/80 border-zinc-700 hover:border-cyan-500"}${ringClass(rowKey)}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <div className="text-white font-bold uppercase tracking-wider">{d.name}</div>
                          {isCurrent && <div className="text-cyan-300 text-[10px] font-bold">YOU ARE HERE</div>}
                          {d.locked && <div className="text-red-400 text-[10px] font-bold">LOCKED</div>}
                        </div>
                        <div className="text-zinc-400 text-[11px] mt-1">{d.description}</div>
                      </div>
                      <div className="ml-3 text-right min-w-[140px]">
                        {isCurrent ? (
                          <div className="text-cyan-400 font-bold text-sm">CURRENT</div>
                        ) : d.locked ? (
                          <div className="text-zinc-500 text-[11px]">{d.lockReason ?? "Unlock by progressing the campaign."}</div>
                        ) : (
                          <button
                            disabled={disabled}
                            onClick={() => onFastTravel?.(d.level, d.warpPoint)}
                            className="px-3 py-1.5 rounded text-xs font-bold tracking-wider bg-cyan-500 hover:bg-cyan-400 text-black"
                          >
                            WARP
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          ))}
        </div>

        <div className="px-5 py-2 border-t border-zinc-700 text-zinc-500 text-[11px] flex justify-between">
          <span>D-Pad / ← → cycle tabs · ↑ ↓ pick row · A / Enter confirm</span>
          <span>B / TAB / ESC to close</span>
        </div>
      </div>
    </div>
  );
};

const Resource: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className={`text-${color}-300`}>
    <span className="opacity-70">{label}:</span> <span className="font-bold">{value}</span>
  </div>
);

const TabBtn: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button
    onClick={onClick}
    className={`px-5 py-2 text-sm font-bold tracking-wider transition ${active ? "bg-cyan-600/30 text-cyan-200 border-b-2 border-cyan-400" : "text-zinc-500 hover:text-zinc-300"}`}
  >
    {label}
  </button>
);

const Stat: React.FC<{ label: string; cur: string; next: string | null; good: "up" | "down" }> = ({ label, cur, next, good }) => (
  <div className="bg-zinc-900/80 rounded px-2 py-1">
    <div className="text-[9px] text-zinc-500 uppercase">{label}</div>
    <div className="text-zinc-100">{cur}</div>
    {next !== null && (
      <div className={`text-[10px] ${good === "up" ? "text-emerald-400" : "text-emerald-400"}`}>→ {next}</div>
    )}
  </div>
);
