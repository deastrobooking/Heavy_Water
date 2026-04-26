import React from "react";
import type { CapturedCreature } from "./BioCreatureSystem";

interface GardenCaptureUIProps {
  open: boolean;
  level: number;
  maxLevel: number;
  captureBonus: number;
  capacityMax: number;
  captured: CapturedCreature[];
  bioEssenceCount: number;
  upgradeCost: { gears: number; nano: number; cores: number } | null;
  canUpgradeGarden: boolean;
  onDeploy: (id: string) => void;
  onUpgradeGarden: () => void;
  onClose: () => void;
}

const SPECIES_HINT: Record<string, string> = {
  robofox: "Agile attacker",
  crystalbeetle: "Tough scout",
  hoverserpent: "Aerial striker",
  neonowl: "Recon drone",
  voltfrog: "Shock support",
};

export const GardenCaptureUI: React.FC<GardenCaptureUIProps> = ({
  open, level, maxLevel, captureBonus, capacityMax, captured, bioEssenceCount,
  upgradeCost, canUpgradeGarden, onDeploy, onUpgradeGarden, onClose,
}) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 pointer-events-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[760px] max-w-[95vw] max-h-[88vh] flex flex-col bg-zinc-900 border-2 border-lime-400 rounded-xl shadow-2xl shadow-lime-500/30 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-lime-700 bg-gradient-to-r from-lime-950 to-zinc-900">
          <div>
            <div className="text-lime-300 text-xl font-bold tracking-wider">BIO GARDEN</div>
            <div className="text-lime-500 text-xs">
              Lvl {level}/{maxLevel} · Roster {captured.length}/{capacityMax} · Capture +{(captureBonus * 100).toFixed(0)}%
            </div>
          </div>
          <div className="text-xs font-mono text-lime-300">
            BIO ESSENCE: <b>{bioEssenceCount}</b> <span className="text-zinc-500">(used by capture orbs)</span>
          </div>
        </div>

        <div className="px-5 py-2 text-zinc-400 text-xs border-b border-zinc-800">
          Press <span className="text-lime-300 font-bold">[H]</span> in the world near a wild bio-creature to throw a capture orb. Captured creatures are stored here.
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {captured.length === 0 ? (
            <div className="text-center text-zinc-500 py-8 text-sm">Garden roster empty. Find wild bio-creatures and capture them.</div>
          ) : captured.map(c => (
            <div key={c.id} className="bg-zinc-800/80 border border-lime-800 rounded-lg p-3 hover:border-lime-500 transition">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div className="text-white font-bold">{c.name}</div>
                    <div className="text-lime-400 text-xs font-mono">LVL {c.level}</div>
                    <div className="text-zinc-500 text-[10px] uppercase">{SPECIES_HINT[c.speciesId] ?? "Bio-companion"}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                    <Mini label="HP" value={c.hp.toString()} />
                    <Mini label="ATK" value={c.attackPower.toString()} />
                    <Mini label="SPD" value={c.speed.toFixed(2)} />
                  </div>
                </div>
                <button
                  onClick={() => onDeploy(c.id)}
                  className="ml-3 px-4 py-2 rounded text-xs font-bold tracking-wider bg-lime-500 hover:bg-lime-400 text-black"
                >
                  DEPLOY
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-zinc-700 flex items-center justify-between">
          <div className="text-zinc-500 text-[11px]">Press [E] or ESC to leave the Garden.</div>
          {upgradeCost ? (
            <button
              disabled={!canUpgradeGarden}
              onClick={onUpgradeGarden}
              className={`px-4 py-2 rounded text-xs font-bold tracking-wider ${canUpgradeGarden ? "bg-amber-500 hover:bg-amber-400 text-black" : "bg-zinc-700 text-zinc-500"}`}
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

const Mini: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-zinc-900/80 rounded px-2 py-1">
    <div className="text-[9px] text-zinc-500 uppercase">{label}</div>
    <div className="text-zinc-100">{value}</div>
  </div>
);
