import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as BABYLON from "@babylonjs/core";
import {
  ASSEMBLY_BLUEPRINTS, AssemblyBlueprint, assemblyQuality,
  buildAssembledDescriptor, describeOutput, validateAssembly,
} from "./AssemblyBlueprints";
import { MODULAR_PART_DEFINITIONS, getPartInfo, partIdFor, PART_TIER_NAMES, PartTier } from "./ModularParts";
import { RobotFactory } from "./RobotFactory";

interface AssemblyPanelProps {
  labLevel: number;
  partCounts: Record<string, number>;
  capacityUsed: number;
  capacityMax: number;
  onAssemble: (blueprintId: string, partIds: string[]) => void;
  onSwitchTab: () => void;
  onClose: () => void;
}

const TIER_TEXT: Record<PartTier, string> = {
  1: "text-sky-300",
  2: "text-violet-300",
  3: "text-amber-300",
};

/**
 * Lab ASSEMBLY tab — pick a blueprint, slot modular parts into it, watch a
 * live rotating preview, and assemble the result. Fully driveable with
 * keyboard (arrows/Enter/Esc) and gamepad (via the "gamepad-menu" events).
 *
 * Row model for navigation: blueprint rows, then the selected blueprint's
 * slot rows, then the ASSEMBLE row. Left/Right on a slot row cycles the
 * slotted part; Left/Right anywhere else switches Lab tabs.
 */
export const AssemblyPanel: React.FC<AssemblyPanelProps> = ({
  labLevel, partCounts, capacityUsed, capacityMax, onAssemble, onSwitchTab, onClose,
}) => {
  const [selectedBp, setSelectedBp] = useState<string>(ASSEMBLY_BLUEPRINTS[0].id);
  // slotId -> chosen part item id (or null = empty)
  const [slotChoice, setSlotChoice] = useState<Record<string, string | null>>({});
  const [cursor, setCursor] = useState(0);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const bp = ASSEMBLY_BLUEPRINTS.find(b => b.id === selectedBp) ?? ASSEMBLY_BLUEPRINTS[0];
  const bpLocked = labLevel < bp.unlockTier;

  // Candidate parts per slot kind: the three tiers, only those owned.
  const candidatesFor = useCallback((kind: string): string[] => {
    const out: string[] = [];
    for (const tier of [1, 2, 3] as PartTier[]) {
      const id = partIdFor(kind as any, tier);
      if ((partCounts[id] ?? 0) > 0) out.push(id);
    }
    return out;
  }, [partCounts]);

  // Resolved part ids in slot order (null when a slot is empty).
  const chosenParts: (string | null)[] = bp.slots.map(s => slotChoice[`${bp.id}:${s.id}`] ?? null);

  // Auto-fill empty slots with the best owned candidate when the blueprint
  // changes (respecting duplicate usage across slots of the same kind).
  useEffect(() => {
    setSlotChoice(prev => {
      const next = { ...prev };
      const usage: Record<string, number> = {};
      for (const s of bp.slots) {
        const key = `${bp.id}:${s.id}`;
        const existing = next[key];
        if (existing && (partCounts[existing] ?? 0) > (usage[existing] ?? 0)) {
          usage[existing] = (usage[existing] ?? 0) + 1;
          continue;
        }
        // pick highest tier with remaining stock
        let picked: string | null = null;
        for (const tier of [3, 2, 1] as PartTier[]) {
          const id = partIdFor(s.kind, tier);
          if ((partCounts[id] ?? 0) > (usage[id] ?? 0)) { picked = id; break; }
        }
        next[key] = picked;
        if (picked) usage[picked] = (usage[picked] ?? 0) + 1;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bp.id, partCounts]);

  // Availability check counting duplicate part usage across slots.
  const availability = useMemo(() => {
    const usage: Record<string, number> = {};
    let allFilled = true;
    let enough = true;
    for (const p of chosenParts) {
      if (!p) { allFilled = false; continue; }
      usage[p] = (usage[p] ?? 0) + 1;
      if (usage[p] > (partCounts[p] ?? 0)) enough = false;
    }
    return { allFilled, enough };
  }, [chosenParts, partCounts]);

  const filled = chosenParts.filter((p): p is string => !!p);
  const valid = availability.allFilled && availability.enough && !bpLocked
    && validateAssembly(bp, filled).ok
    && (bp.category === "item" || capacityUsed < capacityMax);

  const compatMessage = bpLocked
    ? `LOCKED — requires Lab Lvl ${bp.unlockTier}`
    : !availability.allFilled ? "Missing parts — hunt enemies, props & chests for components"
    : !availability.enough ? "Not enough copies of a slotted part"
    : (bp.category !== "item" && capacityUsed >= capacityMax) ? "Roster full — upgrade the Lab"
    : `READY — ${describeOutput(bp, filled)}`;

  // ------------------------------------------------------------ navigation
  const rows = useMemo(() => {
    const out: { key: string; kind: "bp" | "slot" | "assemble"; bpId?: string; slotIdx?: number }[] = [];
    for (const b of ASSEMBLY_BLUEPRINTS) out.push({ key: `bp-${b.id}`, kind: "bp", bpId: b.id });
    bp.slots.forEach((s, i) => out.push({ key: `slot-${bp.id}-${s.id}`, kind: "slot", slotIdx: i }));
    out.push({ key: "assemble", kind: "assemble" });
    return out;
  }, [bp]);

  const cycleSlot = useCallback((slotIdx: number, dir: 1 | -1) => {
    const slot = bp.slots[slotIdx];
    const key = `${bp.id}:${slot.id}`;
    const cands = candidatesFor(slot.kind);
    if (cands.length === 0) return;
    setSlotChoice(prev => {
      const cur = prev[key];
      const curIdx = cur ? cands.indexOf(cur) : -1;
      const nextIdx = (curIdx + dir + cands.length + 1) % (cands.length + 1); // extra state = empty
      return { ...prev, [key]: nextIdx === cands.length ? null : cands[nextIdx] };
    });
  }, [bp, candidatesFor]);

  const doAssemble = useCallback(() => {
    if (!valid) return;
    onAssemble(bp.id, filled);
  }, [valid, onAssemble, bp.id, filled]);

  useEffect(() => {
    const nav = (action: string) => {
      if (action === "close") { onClose(); return; }
      const max = rows.length - 1;
      if (action === "up" || action === "down") {
        setCursor(c => Math.max(0, Math.min(max, c + (action === "down" ? 1 : -1))));
        return;
      }
      const row = rows[Math.min(cursor, max)];
      if (!row) return;
      if (action === "left" || action === "right") {
        if (row.kind === "slot") cycleSlot(row.slotIdx!, action === "right" ? 1 : -1);
        else onSwitchTab();
        return;
      }
      if (action === "activate") {
        if (row.kind === "bp") setSelectedBp(row.bpId!);
        else if (row.kind === "slot") cycleSlot(row.slotIdx!, 1);
        else doAssemble();
      }
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
  }, [rows, cursor, cycleSlot, doAssemble, onSwitchTab, onClose]);

  const cursorKey = rows[Math.min(cursor, rows.length - 1)]?.key;
  useEffect(() => {
    if (cursorKey) rowRefs.current.get(cursorKey)?.scrollIntoView({ block: "nearest" });
  }, [cursorKey]);

  // ------------------------------------------------------------ 3D preview
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BABYLON.Engine | null>(null);
  const sceneRef = useRef<BABYLON.Scene | null>(null);
  const factoryRef = useRef<RobotFactory | null>(null);
  const rootRef = useRef<BABYLON.TransformNode | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    let engine: BABYLON.Engine;
    try {
      engine = new BABYLON.Engine(canvasRef.current, true);
    } catch {
      return; // WebGL unavailable — panel still works without preview
    }
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.04, 0.07, 0.06, 1);
    const cam = new BABYLON.ArcRotateCamera("asmCam", -Math.PI / 2, Math.PI / 2.6, 7, new BABYLON.Vector3(0, 1.4, 0), scene);
    cam.lowerRadiusLimit = 3; cam.upperRadiusLimit = 14;
    const hemi = new BABYLON.HemisphericLight("asmHemi", new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.95;
    const dir = new BABYLON.DirectionalLight("asmDir", new BABYLON.Vector3(-0.4, -0.8, -0.4), scene);
    dir.intensity = 0.6;
    scene.onBeforeRenderObservable.add(() => {
      if (rootRef.current) rootRef.current.rotation.y += engine.getDeltaTime() * 0.0009;
    });
    engineRef.current = engine;
    sceneRef.current = scene;
    factoryRef.current = new RobotFactory(scene);
    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);
    return () => {
      // MUST fully dispose — leaked preview engines exhaust WebGL contexts.
      window.removeEventListener("resize", onResize);
      try { factoryRef.current?.dispose?.(); } catch {}
      try { scene.dispose(); } catch {}
      try { engine.dispose(); } catch {}
      engineRef.current = null; sceneRef.current = null; factoryRef.current = null; rootRef.current = null;
    };
  }, []);

  const previewKey = `${bp.id}|${chosenParts.join(",")}`;
  useEffect(() => {
    const scene = sceneRef.current;
    const factory = factoryRef.current;
    if (!scene || !factory) return;
    if (rootRef.current) { try { rootRef.current.dispose(false, true); } catch {} rootRef.current = null; }
    if (bp.category === "item") return;
    // Preview uses tier-1 placeholders for empty slots so the silhouette
    // shows even before every part is slotted.
    const previewParts = bp.slots.map((s, i) => chosenParts[i] ?? partIdFor(s.kind, 1));
    const desc = buildAssembledDescriptor(bp, previewParts, bp.name);
    if (!desc) return;
    rootRef.current = factory.createRobot(desc, new BABYLON.Vector3(0, 0, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  // ------------------------------------------------------------------ UI
  const q = availability.allFilled ? assemblyQuality(filled) : null;

  return (
    <div className="flex-1 flex min-h-0">
      {/* Blueprint list */}
      <div className="w-[220px] border-r border-zinc-800 overflow-y-auto p-2 space-y-1">
        {ASSEMBLY_BLUEPRINTS.map(b => {
          const locked = labLevel < b.unlockTier;
          const isCursor = cursorKey === `bp-${b.id}`;
          const isSelected = b.id === bp.id;
          return (
            <div
              key={b.id}
              ref={el => { rowRefs.current.set(`bp-${b.id}`, el); }}
              onClick={() => setSelectedBp(b.id)}
              className={`px-2 py-1.5 rounded cursor-pointer border ${isSelected ? "border-emerald-500 bg-emerald-950/50" : "border-transparent hover:bg-zinc-800"} ${isCursor ? "ring-1 ring-emerald-300" : ""}`}
            >
              <div className={`text-sm font-bold ${locked ? "text-zinc-500" : "text-white"}`}>{b.name}</div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                {b.category}{locked ? ` · LAB LVL ${b.unlockTier}` : ""}
              </div>
            </div>
          );
        })}
      </div>

      {/* Slots + feedback */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="text-zinc-400 text-xs">{bp.description}</div>
        {bp.slots.map((s, i) => {
          const key = `slot-${bp.id}-${s.id}`;
          const isCursor = cursorKey === key;
          const chosen = chosenParts[i];
          const info = chosen ? getPartInfo(chosen) : null;
          const def = chosen ? MODULAR_PART_DEFINITIONS[chosen] : null;
          const owned = chosen ? (partCounts[chosen] ?? 0) : 0;
          return (
            <div
              key={key}
              ref={el => { rowRefs.current.set(key, el); }}
              className={`flex items-center justify-between bg-zinc-800/70 border rounded px-3 py-2 ${isCursor ? "border-emerald-400" : "border-zinc-700"}`}
            >
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">{s.label}</div>
                {def && info ? (
                  <div className={`text-sm font-bold ${TIER_TEXT[info.tier]}`}>
                    {def.name} <span className="text-zinc-500 font-normal">× {owned} owned</span>
                  </div>
                ) : (
                  <div className="text-sm text-zinc-500 italic">Empty — no matching part</div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => cycleSlot(i, -1)} className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs">◀</button>
                <button onClick={() => cycleSlot(i, 1)} className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs">▶</button>
              </div>
            </div>
          );
        })}

        <div className={`text-xs font-mono px-1 ${valid ? "text-emerald-300" : "text-amber-300"}`}>
          {compatMessage}
        </div>
        {q && (
          <div className="text-[11px] text-zinc-400 px-1">
            Quality: <b className={q.label === "PRIME" ? "text-amber-300" : q.label === "REFINED" ? "text-violet-300" : "text-sky-300"}>{q.label}</b>
            {bp.category !== "item" && <> · avg tier {q.avgTier.toFixed(1)} ({PART_TIER_NAMES[Math.round(q.avgTier) as PartTier]})</>}
          </div>
        )}

        <div ref={el => { rowRefs.current.set("assemble", el); }}>
          <button
            disabled={!valid}
            onClick={doAssemble}
            className={`w-full py-2 rounded text-sm font-bold tracking-widest ${valid ? "bg-emerald-500 hover:bg-emerald-400 text-black" : "bg-zinc-700 text-zinc-500 cursor-not-allowed"} ${cursorKey === "assemble" ? "ring-2 ring-emerald-300" : ""}`}
          >
            ⚙ ASSEMBLE
          </button>
        </div>
        <div className="text-[10px] text-zinc-600">
          ◀ ▶ on a slot cycles parts · ◀ ▶ elsewhere switches tabs · Enter/Ⓐ confirms
        </div>
      </div>

      {/* Live preview */}
      <div className="w-[240px] border-l border-zinc-800 flex flex-col">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-2 py-1">Preview</div>
        {/* Canvas stays mounted for all categories so the preview engine is
            created exactly once; item blueprints just overlay text. */}
        <div className="flex-1 relative min-h-0">
          <canvas ref={canvasRef} className={`absolute inset-0 w-full h-full ${bp.category === "item" ? "opacity-20" : ""}`} />
          {bp.category === "item" && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400 text-xs px-4 text-center">
              {describeOutput(bp, filled.length ? filled : bp.slots.map(s => partIdFor(s.kind, 1)))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
