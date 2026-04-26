import React from "react";

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
  onBuild: (presetName: string) => void;
  onUpgradeLab: () => void;
  onClose: () => void;
}

export const LabUI: React.FC<LabUIProps> = ({
  open, level, maxLevel, blueprints, resources, capacityUsed, capacityMax,
  upgradeCost, canUpgrade, onBuild, onUpgradeLab, onClose,
}) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 pointer-events-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[760px] max-w-[95vw] max-h-[88vh] flex flex-col bg-zinc-900 border-2 border-emerald-400 rounded-xl shadow-2xl shadow-emerald-500/30 overflow-hidden">
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
            return (
              <div key={b.id} className={`bg-zinc-800/80 border rounded-lg p-3 transition ${enabled ? "border-emerald-700 hover:border-emerald-500" : "border-zinc-800 opacity-70"}`}>
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

        <div className="px-5 py-3 border-t border-zinc-700 flex items-center justify-between">
          <div className="text-zinc-500 text-[11px]">Press [E] or ESC to leave the Lab.</div>
          {upgradeCost ? (
            <button
              disabled={!canUpgrade}
              onClick={onUpgradeLab}
              className={`px-4 py-2 rounded text-xs font-bold tracking-wider ${canUpgrade ? "bg-amber-500 hover:bg-amber-400 text-black" : "bg-zinc-700 text-zinc-500"}`}
            >
              UPGRADE LAB → LVL {level + 1} ({upgradeCost.gears}g {upgradeCost.cores}c {upgradeCost.circuits}cb)
            </button>
          ) : (
            <span className="text-emerald-400 text-xs font-bold">LAB MAXED</span>
          )}
        </div>
      </div>
    </div>
  );
};
