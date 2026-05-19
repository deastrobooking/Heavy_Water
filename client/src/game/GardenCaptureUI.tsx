import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CapturedCreature } from "./BioCreatureSystem";
import {
  BIO_SPECIES, ALL_TYPES, TYPE_HEX, getSpeciesById,
  ElementalType, Rarity,
} from "./BioSpecies";

interface GardenCaptureUIProps {
  open: boolean;
  level: number;
  maxLevel: number;
  captureBonus: number;
  capacityMax: number;
  captured: CapturedCreature[];
  /** Persistent set of species ids the player has ever caught. Survives
   *  DEPLOY (which removes a creature from the live roster) so the dex
   *  completion percentage only ever grows. Filtered to known species
   *  by the BioCreatureSystem before it reaches us. */
  dexCaughtIds: string[];
  bioEssenceCount: number;
  petBondSummary?: string;
  upgradeCost: { gears: number; nano: number; cores: number } | null;
  canUpgradeGarden: boolean;
  onDeploy: (id: string) => void;
  onCare: (id: string) => void;
  onUpgradeGarden: () => void;
  onClose: () => void;
}

type Tab = "all" | "roster" | ElementalType;

const RARITY_STARS: Record<Rarity, string> = {
  common: "★",
  uncommon: "★★",
  rare: "★★★",
  legendary: "★★★★",
};
const RARITY_COLOR: Record<Rarity, string> = {
  common: "text-zinc-300",
  uncommon: "text-emerald-300",
  rare: "text-sky-300",
  legendary: "text-amber-300",
};

export const GardenCaptureUI: React.FC<GardenCaptureUIProps> = ({
  open, level, maxLevel, captureBonus, capacityMax, captured, dexCaughtIds, bioEssenceCount,
  petBondSummary, upgradeCost, canUpgradeGarden, onDeploy, onCare, onUpgradeGarden, onClose,
}) => {
  const [tab, setTab] = useState<Tab>("roster");
  // Per-roster-row cursor for keyboard + gamepad. Only the ROSTER tab
  // has actionable rows (DEPLOY); the DEX tab is informational so we
  // don't bother building a focus list there. The cursor resets
  // whenever the player switches into the roster tab so the highlight
  // never strands them past the end of a shorter list.
  const [rosterIdx, setRosterIdx] = useState(0);
  // Tracks whether the bottom UPGRADE GARDEN button currently owns the
  // controller/keyboard cursor. Pressing Down past the last roster row
  // (or Down on any non-roster tab) moves focus here so a controller
  // user can always reach the upgrade button without a mouse. Pressing
  // Up from here returns to the roster's last row (or the tab strip).
  const [upgradeFocused, setUpgradeFocused] = useState(false);
  const rosterRowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const upgradeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Persistent "ever caught" species ids — also fold the live roster in
  // so any captures from this session are reflected even before the next
  // autosave round-trip. Unknown ids are filtered out so legacy saves
  // can't inflate the count.
  // IMPORTANT: this hook MUST run on every render (open OR closed) to keep
  // React's hook-order stable. Putting an `if (!open) return null;` above
  // it produces React error #310 ("rendered more hooks than the previous
  // render") when the dialog opens, because the closed render only ran
  // useState while the open render runs useState + useMemo.
  const dexCaught = useMemo(() => {
    const set = new Set<string>();
    for (const id of dexCaughtIds) if (getSpeciesById(id)) set.add(id);
    for (const c of captured) if (getSpeciesById(c.speciesId)) set.add(c.speciesId);
    return set;
  }, [dexCaughtIds, captured]);

  // Stable left-to-right tab order so D-Pad Left / Right can step
  // through them. The dynamic part is the elemental list, which can
  // grow if BIO_SPECIES adds new types — `ALL_TYPES` is the single
  // source of truth so this stays in lockstep with the tab strip.
  const tabOrder = useMemo<Tab[]>(() => ["roster", "all", ...ALL_TYPES] as Tab[], []);

  // Clamp once the roster shrinks (DEPLOY removes a creature) so the
  // ring never highlights an empty row.
  const rosterCount = captured.length;
  const rosterCurIdx = Math.min(rosterIdx, Math.max(0, rosterCount - 1));

  // Single nav dispatcher shared by gamepad CustomEvents + keyboard
  // arrows so both controllers and keyboards drive the menu identically.
  useEffect(() => {
    if (!open) return;
    const nav = (action: "up" | "down" | "left" | "right" | "activate" | "close") => {
      if (action === "close") { onClose(); return; }
      if (action === "left" || action === "right") {
        // Left/Right always cycles tabs. If the upgrade button currently
        // owns focus, hand focus back to the tab strip so the highlight
        // tracks the active tab again.
        const idx = tabOrder.indexOf(tab);
        const safe = idx < 0 ? 0 : idx;
        const next = (safe + (action === "right" ? 1 : -1) + tabOrder.length) % tabOrder.length;
        const nextTab = tabOrder[next];
        setTab(nextTab);
        if (nextTab !== "roster") setRosterIdx(0);
        setUpgradeFocused(false);
        return;
      }
      if (action === "up" || action === "down") {
        if (upgradeFocused) {
          // From the upgrade button: Up returns focus into the body
          // (roster's last row, or just the active tab body for dex tabs).
          if (action === "up") {
            setUpgradeFocused(false);
            if (tab === "roster" && rosterCount > 0) {
              setRosterIdx(rosterCount - 1);
            }
          }
          return;
        }
        if (tab !== "roster") {
          // Dex tabs have no row cursor; Down jumps to the upgrade button
          // so it's always reachable from a non-roster tab.
          if (action === "down") setUpgradeFocused(true);
          return;
        }
        // Roster tab: walk the cursor; falling off the bottom focuses
        // the upgrade button. Falling off the top is clamped at row 0.
        const max = Math.max(0, rosterCount - 1);
        const cur = Math.min(rosterIdx, max);
        if (action === "down") {
          if (rosterCount === 0 || cur >= max) {
            setUpgradeFocused(true);
          } else {
            setRosterIdx(cur + 1);
          }
        } else {
          setRosterIdx(Math.max(0, cur - 1));
        }
        return;
      }
      if (action === "activate") {
        if (upgradeFocused) {
          if (canUpgradeGarden && upgradeCost) onUpgradeGarden();
          return;
        }
        if (tab === "roster") {
          const c = captured[rosterCurIdx];
          if (c) onDeploy(c.id);
          return;
        }
        // From any non-roster tab without explicit upgrade focus, A still
        // activates the upgrade-garden button when affordable.
        if (canUpgradeGarden && upgradeCost) onUpgradeGarden();
      }
    };
    const padHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { action?: string } | null;
      if (!detail?.action) return;
      nav(detail.action as Parameters<typeof nav>[0]);
    };
    const keyHandler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      if (e.repeat) return;
      if (e.code === "ArrowUp")         { e.preventDefault(); nav("up"); }
      else if (e.code === "ArrowDown")  { e.preventDefault(); nav("down"); }
      else if (e.code === "ArrowLeft")  { e.preventDefault(); nav("left"); }
      else if (e.code === "ArrowRight") { e.preventDefault(); nav("right"); }
      else if (e.code === "Enter")      { e.preventDefault(); nav("activate"); }
      else if (e.code === "Escape")     { e.preventDefault(); nav("close"); }
    };
    window.addEventListener("gamepad-menu", padHandler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("gamepad-menu", padHandler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [open, tab, tabOrder, rosterCount, rosterCurIdx, rosterIdx, upgradeFocused, captured, canUpgradeGarden, upgradeCost, onDeploy, onUpgradeGarden, onClose]);

  // Reset upgrade focus whenever the dialog re-opens so a fresh open
  // always starts with the roster cursor (matches the existing roster
  // index reset behavior).
  useEffect(() => {
    if (open) setUpgradeFocused(false);
  }, [open]);

  // Keep the upgrade button visible when it owns focus (it sits in a
  // sticky footer today, so this is only defense-in-depth, but it
  // mirrors the roster auto-scroll for consistency).
  useEffect(() => {
    if (!open || !upgradeFocused) return;
    const el = upgradeBtnRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [open, upgradeFocused]);

  // Auto-scroll the focused roster row into view so controller-only
  // navigation never strands the player past the bottom of the list.
  const rosterCurId = captured[rosterCurIdx]?.id ?? null;
  useEffect(() => {
    if (!open || tab !== "roster" || !rosterCurId) return;
    const el = rosterRowRefs.current.get(rosterCurId);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [open, tab, rosterCurId]);

  if (!open) return null;

  const dexTotal = BIO_SPECIES.length;
  const dexCount = dexCaught.size;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 pointer-events-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[920px] max-w-[96vw] max-h-[90vh] flex flex-col bg-zinc-900 border-2 border-lime-400 rounded-xl shadow-2xl shadow-lime-500/30 overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-lime-700 bg-gradient-to-r from-lime-950 to-zinc-900">
          <div>
            <div className="text-lime-300 text-xl font-bold tracking-wider">BIO GARDEN · CREATURE DEX</div>
            <div className="text-lime-500 text-xs">
              Lvl {level}/{maxLevel} · Roster {captured.length}/{capacityMax} · Capture +{(captureBonus * 100).toFixed(0)}% · Dex <b className="text-lime-200">{dexCount}/{dexTotal}</b>
            </div>
            {petBondSummary && (
              <div className="text-cyan-300 text-[11px] mt-1">{petBondSummary}</div>
            )}
          </div>
          <div className="text-xs font-mono text-lime-300">
            BIO ESSENCE: <b>{bioEssenceCount}</b> <span className="text-zinc-500">(used by capture orbs)</span>
          </div>
        </div>

        {/* tab strip */}
        <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-zinc-800 bg-zinc-950/60">
          <TabBtn active={tab === "roster"} onClick={() => setTab("roster")} label={`ROSTER (${captured.length})`} />
          <TabBtn active={tab === "all"} onClick={() => setTab("all")} label={`DEX (${dexCount}/${dexTotal})`} />
          <span className="mx-1 text-zinc-600">|</span>
          {ALL_TYPES.map(tp => {
            const total = BIO_SPECIES.filter(s => s.elementalType === tp).length;
            const caught = BIO_SPECIES.filter(s => s.elementalType === tp && dexCaught.has(s.id)).length;
            return (
              <TypeTab
                key={tp}
                active={tab === tp}
                color={TYPE_HEX[tp]}
                label={`${tp.toUpperCase()} ${caught}/${total}`}
                onClick={() => setTab(tp)}
              />
            );
          })}
        </div>

        <div className="px-5 py-2 text-zinc-400 text-xs border-b border-zinc-800">
          Press <span className="text-lime-300 font-bold">[H]</span> in the world near a wild bio-creature to throw a capture orb. Captured creatures join your roster and your dex.
          <span className="ml-2 text-zinc-500">[←/→] swap tabs · [↑/↓] cursor (down past the last row reaches UPGRADE) · [Enter] / [A] deploy or upgrade · [E] / [B] / Esc close.</span>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {tab === "roster" ? (
            <RosterView
              captured={captured}
              onDeploy={onDeploy}
              onCare={onCare}
              selectedId={rosterCurId}
              setRowRef={(id, el) => {
                if (el) rosterRowRefs.current.set(id, el);
                else rosterRowRefs.current.delete(id);
              }}
              onHover={(id) => {
                const idx = captured.findIndex(c => c.id === id);
                if (idx >= 0) setRosterIdx(idx);
              }}
            />
          ) : (
            <DexView dexCaughtIds={dexCaught} filterType={tab === "all" ? null : tab} />
          )}
        </div>

        {/* footer */}
        <div className="px-5 py-3 border-t border-zinc-700 flex items-center justify-between">
          <div className="text-zinc-500 text-[11px]">Press [E] or ESC to leave the Garden.</div>
          {upgradeCost ? (
            <button
              ref={upgradeBtnRef}
              disabled={!canUpgradeGarden}
              onClick={onUpgradeGarden}
              onMouseEnter={() => setUpgradeFocused(true)}
              onMouseLeave={() => setUpgradeFocused(false)}
              className={`px-4 py-2 rounded text-xs font-bold tracking-wider ${canUpgradeGarden ? "bg-amber-500 hover:bg-amber-400 text-black" : "bg-zinc-700 text-zinc-500"}${upgradeFocused ? " ring-2 ring-amber-300 ring-offset-1 ring-offset-zinc-900" : ""}`}
            >
              UPGRADE GARDEN → LVL {level + 1} ({upgradeCost.gears}g {upgradeCost.nano}nf {upgradeCost.cores}c)
            </button>
          ) : (
            <span className="text-lime-400 text-xs font-bold">GARDEN MAXED</span>
          )}
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------- subcomponents

const TabBtn: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1 rounded text-[11px] font-bold tracking-wider ${active ? "bg-lime-500 text-black" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
  >{label}</button>
);

const TypeTab: React.FC<{ active: boolean; color: string; label: string; onClick: () => void }> = ({ active, color, label, onClick }) => (
  <button
    onClick={onClick}
    style={active ? { backgroundColor: color, color: "#0a0a0a" } : { borderColor: color, color }}
    className={`px-2 py-1 rounded text-[10px] font-bold tracking-wider border ${active ? "" : "bg-zinc-900/70 hover:bg-zinc-800"}`}
  >{label}</button>
);

const RosterView: React.FC<{
  captured: CapturedCreature[];
  onDeploy: (id: string) => void;
  onCare: (id: string) => void;
  selectedId: string | null;
  setRowRef: (id: string, el: HTMLDivElement | null) => void;
  onHover: (id: string) => void;
}> = ({ captured, onDeploy, onCare, selectedId, setRowRef, onHover }) => {
  if (captured.length === 0) {
    return <div className="text-center text-zinc-500 py-8 text-sm">Garden roster empty. Find wild bio-creatures and capture them.</div>;
  }
  return (
    <>
      {captured.map(c => {
        const sp = getSpeciesById(c.speciesId);
        const tp = sp?.elementalType ?? "normal";
        const color = TYPE_HEX[tp];
        const role = sp?.role ?? "Bio-companion";
        const rarity = sp?.rarity ?? "common";
        const focused = c.id === selectedId;
        return (
          <div
            key={c.id}
            ref={(el) => setRowRef(c.id, el)}
            onMouseEnter={() => onHover(c.id)}
            className={`bg-zinc-800/80 border border-lime-800 rounded-lg p-3 hover:border-lime-500 transition ${focused ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-zinc-900" : ""}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="text-white font-bold">{c.name}</div>
                  <span
                    style={{ backgroundColor: color, color: "#0a0a0a" }}
                    className="px-2 py-[1px] rounded text-[9px] font-bold tracking-wider"
                  >{tp.toUpperCase()}</span>
                  <div className={`text-[10px] ${RARITY_COLOR[rarity]}`}>{RARITY_STARS[rarity]}</div>
                  <div className="text-lime-400 text-xs font-mono">LVL {c.level}</div>
                  <div className="text-cyan-300 text-xs font-mono">BOND {c.bondLevel ?? 0}</div>
                  <div className="text-emerald-300 text-[10px] uppercase">CARE {c.care ?? 0}/3</div>
                  <div className="text-zinc-500 text-[10px] uppercase">{role}</div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                  <Mini label="HP" value={c.hp.toString()} />
                  <Mini label="ATK" value={c.attackPower.toString()} />
                  <Mini label="SPD" value={c.speed.toFixed(2)} />
                </div>
              </div>
              <div className="ml-3 flex flex-col gap-2">
                <button
                  onClick={() => onCare(c.id)}
                  className="px-4 py-2 rounded text-xs font-bold tracking-wider bg-cyan-500 hover:bg-cyan-400 text-black"
                >
                  CARE
                </button>
                <button
                  onClick={() => onDeploy(c.id)}
                  className="px-4 py-2 rounded text-xs font-bold tracking-wider bg-lime-500 hover:bg-lime-400 text-black"
                >
                  DEPLOY
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};

const DexView: React.FC<{
  dexCaughtIds: Set<string>;
  filterType: ElementalType | null;
}> = ({ dexCaughtIds, filterType }) => {
  const list = filterType ? BIO_SPECIES.filter(s => s.elementalType === filterType) : BIO_SPECIES;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {list.map(sp => {
        const caught = dexCaughtIds.has(sp.id);
        const color = TYPE_HEX[sp.elementalType];
        return (
          <div
            key={sp.id}
            className={`rounded-lg p-2 border text-[11px] ${caught ? "bg-zinc-800/80 border-lime-700" : "bg-zinc-950/70 border-zinc-800 opacity-70"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className={`font-bold truncate ${caught ? "text-white" : "text-zinc-500"}`}>
                {caught ? sp.name : "???"}
              </div>
              <span
                style={{ backgroundColor: color, color: "#0a0a0a" }}
                className="px-1.5 py-[1px] rounded text-[8px] font-bold tracking-wider shrink-0"
              >{sp.elementalType.toUpperCase()}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className={`text-[10px] ${RARITY_COLOR[sp.rarity]}`}>{RARITY_STARS[sp.rarity]}</div>
              <div className="text-[9px] text-zinc-500 uppercase truncate">{caught ? sp.archetype : "—"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const Mini: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-zinc-900/80 rounded px-2 py-1">
    <div className="text-[9px] text-zinc-500 uppercase">{label}</div>
    <div className="text-zinc-100">{value}</div>
  </div>
);
