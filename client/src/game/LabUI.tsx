import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssemblyPanel } from "./AssemblyPanel";

export interface LabBlueprint {
  id: string;
  presetName: string;
  displayName: string;
  type: "ally" | "pet";
  description: string;
  cost: { gears: number; scrap: number; cores: number; circuits: number };
  unlockTier: number;
}

interface LabUIProps {
  open: boolean;
  level: number;
  maxLevel: number;
  blueprints: LabBlueprint[];
  resources: { gears: number; scrap: number; cores: number; circuits: number };
  capacityUsed: number;
  capacityMax: number;
  upgradeCost: { gears: number; cores: number; circuits: number } | null;
  canUpgrade: boolean;
  /** Modular assembly part counts (item id → owned), for the ASSEMBLY tab. */
  partCounts: Record<string, number>;
  onBuild: (presetName: string) => void;
  onAssemble: (blueprintId: string, partIds: string[]) => void;
  onUpgradeLab: () => void;
  onClose: () => void;
}

type LabTab = "build" | "assembly";

export const LabUI: React.FC<LabUIProps> = ({
  open, level, maxLevel, blueprints, resources, capacityUsed, capacityMax,
  upgradeCost, canUpgrade, partCounts, onBuild, onAssemble, onUpgradeLab, onClose,
}) => {
  const [tab, setTab] = useState<LabTab>("build");
  const [cursor, setCursor] = useState(0);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const switchTab = useCallback(() => setTab(t => (t === "build" ? "assembly" : "build")), []);

  // BUILD-tab navigation rows: one per blueprint + the upgrade button.
  const buildRows = useMemo(() => {
    const rows = blueprints.map(b => ({ key: `b-${b.id}`, activate: () => onBuild(b.presetName) }));
    if (upgradeCost) rows.push({ key: "upgrade", activate: onUpgradeLab });
    return rows;
  }, [blueprints, upgradeCost, onBuild, onUpgradeLab]);

  // Keyboard + gamepad nav for the BUILD tab (the ASSEMBLY tab owns its own).
  useEffect(() => {
    if (!open || tab !== "build") return;
    const nav = (action: string) => {
      if (action === "close") { onClose(); return; }
      if (action === "left" || action === "right") { switchTab(); return; }
      const max = buildRows.length - 1;
      if (action === "up") setCursor(c => Math.max(0, c - 1));
      else if (action === "down") setCursor(c => Math.min(max, c + 1));
      else if (action === "activate") buildRows[Math.min(cursor, max)]?.activate();
    };
    const onGamepad = (e: Event) => nav((e as CustomEvent).detail?.action);
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, string> = {
        ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "activate",
      };
      const a = map[e.code];
      if (a) { e.preventDefault(); e.stopPropagation(); nav(a); }
    };
    window.addEventListener("gamepad-menu", onGamepad as EventListener);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("gamepad-menu", onGamepad as EventListener);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, tab, buildRows, cursor, onClose, switchTab]);

  const cursorKey = tab === "build" ? buildRows[Math.min(cursor, buildRows.length - 1)]?.key : null;
  useEffect(() => {
    if (cursorKey) rowRefs.current.get(cursorKey)?.scrollIntoView({ block: "nearest" });
  }, [cursorKey]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 pointer-events-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[900px] max-w-[96vw] h-[620px] max-h-[90vh] flex flex-col bg-zinc-900 border-2 border-emerald-400 rounded-xl shadow-2xl shadow-emerald-500/30 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-emerald-700 bg-gradient-to-r from-emerald-950 to-zinc-900">
          <div>
            <div className="text-emerald-300 text-xl font-bold tracking-wider">ROBOTICS LAB</div>
            <div className="text-emerald-500 text-xs">Lvl {level}/{maxLevel} · Roster {capacityUsed}/{capacityMax}</div>
          </div>
          <div className="flex gap-3 text-xs font-mono">
            <span className="text-amber-300">GEARS: <b>{resources.gears}</b></span>
            <span className="text-zinc-300">SCRAP: <b>{resources.scrap}</b></span>
            <span className="text-cyan-300">CORES: <b>{resources.cores}</b></span>
            <span className="text-emerald-300">CIRC: <b>{resources.circuits}</b></span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800">
          {(["build", "assembly"] as LabTab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 text-xs font-bold tracking-widest ${tab === t ? "text-emerald-300 border-b-2 border-emerald-400 bg-emerald-950/40" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {t === "build" ? "BUILD" : "ASSEMBLY"}
            </button>
          ))}
          <div className="flex-1" />
          <div className="text-[10px] text-zinc-600 self-center pr-4">◀ ▶ switch tabs</div>
        </div>

        {tab === "build" ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {blueprints.map(b => {
              const locked = level < b.unlockTier;
              const canAfford =
                resources.gears >= b.cost.gears &&
                resources.scrap >= b.cost.scrap &&
                resources.cores >= b.cost.cores &&
                resources.circuits >= b.cost.circuits;
              const full = capacityUsed >= capacityMax;
              const enabled = !locked && canAfford && !full;
              const isCursor = cursorKey === `b-${b.id}`;
              return (
                <div
                  key={b.id}
                  ref={el => { rowRefs.current.set(`b-${b.id}`, el); }}
                  className={`bg-zinc-800/80 border rounded-lg p-3 transition ${enabled ? "border-emerald-700 hover:border-emerald-500" : "border-zinc-800 opacity-70"} ${isCursor ? "ring-1 ring-emerald-300" : ""}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <div className="text-white font-bold">{b.displayName}</div>
                        <div className="text-[10px] uppercase text-zinc-500">{b.type}</div>
                        {locked && <div className="text-[10px] text-red-400">LOCKED — Lab Lvl {b.unlockTier}</div>}
                      </div>
                      <div className="text-zinc-400 text-xs mt-1">{b.description}</div>
                      <div className="flex gap-3 mt-2 text-[11px] font-mono">
                        <span className={resources.gears >= b.cost.gears ? "text-amber-300" : "text-red-400"}>{b.cost.gears} gears</span>
                        <span className={resources.scrap >= b.cost.scrap ? "text-zinc-200" : "text-red-400"}>{b.cost.scrap} scrap</span>
                        <span className={resources.cores >= b.cost.cores ? "text-cyan-300" : "text-red-400"}>{b.cost.cores} cores</span>
                        <span className={resources.circuits >= b.cost.circuits ? "text-emerald-300" : "text-red-400"}>{b.cost.circuits} circuits</span>
                      </div>
                    </div>
                    <button
                      disabled={!enabled}
                      onClick={() => onBuild(b.presetName)}
                      className={`ml-3 px-4 py-2 rounded text-xs font-bold tracking-wider ${enabled ? "bg-emerald-500 hover:bg-emerald-400 text-black" : "bg-zinc-700 text-zinc-500 cursor-not-allowed"}`}
                    >
                      {full ? "ROSTER FULL" : "BUILD"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <AssemblyPanel
            labLevel={level}
            partCounts={partCounts}
            capacityUsed={capacityUsed}
            capacityMax={capacityMax}
            onAssemble={onAssemble}
            onSwitchTab={switchTab}
            onClose={onClose}
          />
        )}

        <div className="px-5 py-3 border-t border-zinc-700 flex items-center justify-between">
          <div className="text-zinc-500 text-[11px]">Press [E] or ESC to leave the Lab.</div>
          {upgradeCost ? (
            <div ref={el => { rowRefs.current.set("upgrade", el); }}>
              <button
                disabled={!canUpgrade}
                onClick={onUpgradeLab}
                className={`px-4 py-2 rounded text-xs font-bold tracking-wider ${canUpgrade ? "bg-amber-500 hover:bg-amber-400 text-black" : "bg-zinc-700 text-zinc-500"} ${cursorKey === "upgrade" ? "ring-2 ring-emerald-300" : ""}`}
              >
                UPGRADE LAB → LVL {level + 1} ({upgradeCost.gears}g {upgradeCost.cores}c {upgradeCost.circuits}cb)
              </button>
            </div>
          ) : (
            <span className="text-emerald-400 text-xs font-bold">LAB MAXED</span>
          )}
        </div>
      </div>
    </div>
  );
};
