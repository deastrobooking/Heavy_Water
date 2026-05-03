import React, { useMemo, useState } from "react";
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
  upgradeCost: { gears: number; nano: number; cores: number } | null;
  canUpgradeGarden: boolean;
  onDeploy: (id: string) => void;
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
  upgradeCost, canUpgradeGarden, onDeploy, onUpgradeGarden, onClose,
}) => {
  const [tab, setTab] = useState<Tab>("roster");

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
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {tab === "roster" ? (
            <RosterView captured={captured} onDeploy={onDeploy} />
          ) : (
            <DexView dexCaughtIds={dexCaught} filterType={tab === "all" ? null : tab} />
          )}
        </div>

        {/* footer */}
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
}> = ({ captured, onDeploy }) => {
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
        return (
          <div key={c.id} className="bg-zinc-800/80 border border-lime-800 rounded-lg p-3 hover:border-lime-500 transition">
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
                  <div className="text-zinc-500 text-[10px] uppercase">{role}</div>
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
