import React, { useEffect, useRef, useState } from "react";
import * as BABYLON from "@babylonjs/core";
import { HumanoidCharacter, HumanoidDefinition } from "./HumanoidCharacter";
import { HUMANOID_PRESETS } from "./HumanoidPresets";
import {
  ArmorSetSerialized,
  DEFAULT_ARMOR_SET,
  TITAN_ARMOR_SET,
  DREAD_ARMOR_SET,
  deserializeArmorSet,
  equipArmorSet,
  EquippedArmor,
  sanitizeArmorSet,
} from "./RobotArmorSystem";
import { ARMOR_PART_REGISTRY, ArmorSlot } from "./RobotArmorParts";
import { BOSS_VARIANTS, BossVariantId } from "./BossVariants";

const CHARACTER_STORAGE_KEY = "detroit3026_character_v1";

/** Per-player overrides for the visual look of spawned enemy elites. The
 *  art-direction picker in the Captain/Titan tab writes these; EnemySystem
 *  reads them via `getEnemyStyleOverrides()` on each spawn so the chosen
 *  preset is what shows up regardless of which level / wave triggered the
 *  spawn. Unset / "random" keeps the original randomized roster. */
export interface EnemyStyleOverrides {
  /** Humanoid preset id used for ALL captain spawns. "random" keeps the
   *  original Alpha/Beta/Gamma/Omega randomization. The variant tint
   *  (inferno / plague / frost / storm / void) is still chosen by the
   *  level system — this only changes the underlying body silhouette. */
  captainPreset?: "random" | "HumanoidCaptainAlpha" | "HumanoidCaptainBeta" | "HumanoidCaptainGamma" | "HumanoidCaptainOmega";
  /** Robot preset id used for heavy/titan ground spawns. "random" keeps
   *  the original TankTitan/OptimusForge coin-flip. */
  titanPreset?: "random" | "TankTitan" | "OptimusForge";
  /** Force a single boss-variant tint on every captain regardless of
   *  level. "byLevel" keeps the LevelSystem's per-level assignment. */
  captainVariant?: "byLevel" | BossVariantId;
}

export interface SavedCharacter {
  height: number;
  headScale: number;
  shoulderWidth: number;
  armLength: number;
  legLength: number;
  bodyType: "lean" | "athletic" | "heavy";
  armorType: "light" | "heavy" | "captain" | "humanoid";
  colors: {
    primary: [number, number, number];
    secondary: [number, number, number];
    skin: [number, number, number];
    hair: [number, number, number];
  };
  armorSet?: ArmorSetSerialized;
  enemyStyles?: EnemyStyleOverrides;
}

/** Module-level cache so EnemySystem doesn't have to hit localStorage on
 *  every spawn. The CharacterEditor refreshes this on save; consumers
 *  outside the editor can call `refreshEnemyStyleOverrides()` at startup
 *  to seed it from the persisted SavedCharacter. */
let _enemyStyleCache: EnemyStyleOverrides = {};
export function getEnemyStyleOverrides(): EnemyStyleOverrides {
  return _enemyStyleCache;
}
export function refreshEnemyStyleOverrides(): EnemyStyleOverrides {
  try {
    const raw = localStorage.getItem(CHARACTER_STORAGE_KEY);
    if (!raw) { _enemyStyleCache = {}; return _enemyStyleCache; }
    const parsed = JSON.parse(raw) as SavedCharacter;
    _enemyStyleCache = parsed.enemyStyles ?? {};
    return _enemyStyleCache;
  } catch {
    _enemyStyleCache = {};
    return _enemyStyleCache;
  }
}

export function loadSavedCharacter(): SavedCharacter | null {
  try {
    const raw = localStorage.getItem(CHARACTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedCharacter;
    parsed.armorSet = sanitizeArmorSet(parsed.armorSet);
    return parsed;
  } catch (e) {
    console.warn("[CharacterEditor] Failed to load saved character, using defaults:", e);
    return null;
  }
}

export function savedCharacterToHumanoidDef(s: SavedCharacter): HumanoidDefinition {
  const base = HUMANOID_PRESETS.PlayerDefault;
  return {
    ...base,
    height: s.height,
    headScale: s.headScale,
    shoulderWidth: s.shoulderWidth,
    chestWidth: s.shoulderWidth,
    armLength: s.armLength,
    legLength: s.legLength,
    bodyType: s.bodyType,
    armorType: s.armorType,
    colors: {
      primary: BABYLON.Color3.FromArray(s.colors.primary),
      secondary: BABYLON.Color3.FromArray(s.colors.secondary),
      skin: BABYLON.Color3.FromArray(s.colors.skin),
      hair: BABYLON.Color3.FromArray(s.colors.hair),
    },
    hasArmor: false,
  };
}

const DEFAULT_CHAR: SavedCharacter = {
  height: 18,
  headScale: 2.2,
  shoulderWidth: 6,
  armLength: 9,
  legLength: 10,
  bodyType: "athletic",
  armorType: "humanoid",
  colors: {
    primary: [0.18, 0.55, 0.95],
    secondary: [0.06, 0.18, 0.42],
    skin: [0.92, 0.78, 0.68],
    hair: [0.08, 0.08, 0.08],
  },
  armorSet: DEFAULT_ARMOR_SET,
};

function colorToHex(c: [number, number, number]): string {
  const r = Math.round(c[0] * 255).toString(16).padStart(2, "0");
  const g = Math.round(c[1] * 255).toString(16).padStart(2, "0");
  const b = Math.round(c[2] * 255).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function hexToColor(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

interface CharacterEditorProps {
  onClose: () => void;
}

type Tab = "body" | "armor" | "colors" | "enemies";

export const CharacterEditor: React.FC<CharacterEditorProps> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BABYLON.Engine | null>(null);
  const sceneRef = useRef<BABYLON.Scene | null>(null);
  const charRef = useRef<HumanoidCharacter | null>(null);
  const armorRef = useRef<EquippedArmor | null>(null);
  const [config, setConfig] = useState<SavedCharacter>(() => loadSavedCharacter() || DEFAULT_CHAR);
  const [tab, setTab] = useState<Tab>("body");

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new BABYLON.Engine(canvasRef.current, true, { preserveDrawingBuffer: true });
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.05, 0.06, 0.12, 1);

    const camera = new BABYLON.ArcRotateCamera(
      "previewCam", -Math.PI / 2, Math.PI / 2.4, 45,
      new BABYLON.Vector3(0, 9, 0), scene
    );
    camera.attachControl(canvasRef.current, true);
    camera.lowerRadiusLimit = 25;
    camera.upperRadiusLimit = 80;

    const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.9;
    const dir = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-0.4, -0.8, -0.4), scene);
    dir.intensity = 0.7;

    const grid = BABYLON.MeshBuilder.CreateDisc("grid", { radius: 12, tessellation: 32 }, scene);
    grid.rotation.x = Math.PI / 2;
    const gMat = new BABYLON.StandardMaterial("gMat", scene);
    gMat.diffuseColor = new BABYLON.Color3(0.15, 0.18, 0.25);
    gMat.emissiveColor = new BABYLON.Color3(0.05, 0.08, 0.15);
    grid.material = gMat;

    engineRef.current = engine;
    sceneRef.current = scene;

    engine.runRenderLoop(() => scene.render());
    const handleResize = () => engine.resize();
    window.addEventListener("resize", handleResize);

    rebuildCharacter(config);

    return () => {
      window.removeEventListener("resize", handleResize);
      armorRef.current?.dispose();
      charRef.current?.dispose();
      scene.dispose();
      engine.dispose();
    };
  }, []);

  function rebuildCharacter(c: SavedCharacter) {
    if (!sceneRef.current) return;
    if (armorRef.current) {
      armorRef.current.dispose();
      armorRef.current = null;
    }
    if (charRef.current) {
      charRef.current.dispose();
      charRef.current = null;
    }
    const def = savedCharacterToHumanoidDef(c);
    const char = new HumanoidCharacter(sceneRef.current, def);
    char.getRoot().position = new BABYLON.Vector3(0, 0, 0);
    charRef.current = char;
    if (c.armorSet) {
      const setCfg = deserializeArmorSet(c.armorSet);
      armorRef.current = equipArmorSet(sceneRef.current, char.getAnimatableLimbs(), setCfg, {
        bodyHeight: def.height,
        shoulderWidth: def.shoulderWidth,
        armLength: def.armLength,
        legLength: def.legLength,
      });
    }
  }

  useEffect(() => { rebuildCharacter(config); }, [config]);

  function update<K extends keyof SavedCharacter>(key: K, value: SavedCharacter[K]) {
    setConfig({ ...config, [key]: value });
  }

  function updateColor(key: keyof SavedCharacter["colors"], hex: string) {
    setConfig({ ...config, colors: { ...config.colors, [key]: hexToColor(hex) } });
  }

  function updateArmorPart(slot: ArmorSlot, partId: string) {
    const armorSet = { ...(config.armorSet || DEFAULT_ARMOR_SET), [slot]: partId } as ArmorSetSerialized;
    setConfig({ ...config, armorSet });
  }

  function updateArmorColor(key: keyof ArmorSetSerialized["colors"], hex: string) {
    const base = config.armorSet || DEFAULT_ARMOR_SET;
    const armorSet: ArmorSetSerialized = {
      ...base,
      colors: { ...base.colors, [key]: hexToColor(hex) },
    };
    setConfig({ ...config, armorSet });
  }

  function applyPreset(preset: ArmorSetSerialized) {
    setConfig({ ...config, armorSet: { ...preset } });
  }

  function save() {
    localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(config));
    // Refresh the in-memory enemy-style cache so the new captain / titan
    // overrides take effect on the very next enemy spawn — without this,
    // EnemySystem would keep reading the stale cache until a full reload.
    refreshEnemyStyleOverrides();
    onClose();
  }

  function updateEnemyStyle<K extends keyof EnemyStyleOverrides>(key: K, value: EnemyStyleOverrides[K]) {
    setConfig({ ...config, enemyStyles: { ...(config.enemyStyles ?? {}), [key]: value } });
  }

  function reset() {
    setConfig(DEFAULT_CHAR);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "detroit3026_character.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as SavedCharacter;
        parsed.armorSet = sanitizeArmorSet(parsed.armorSet);
        setConfig(parsed);
      } catch {
        alert("Invalid character JSON");
      }
    };
    reader.readAsText(file);
  }

  const sliderClass = "w-full accent-cyan-400";
  const labelClass = "block text-xs text-cyan-300 uppercase tracking-wide mb-1";
  const groupClass = "mb-3";
  const armorSet = config.armorSet || DEFAULT_ARMOR_SET;

  const slotLabels: { slot: ArmorSlot; label: string }[] = [
    { slot: "helmet", label: "Helmet" },
    { slot: "chest", label: "Chest" },
    { slot: "back", label: "Back" },
    { slot: "leftShoulder", label: "L. Shoulder" },
    { slot: "rightShoulder", label: "R. Shoulder" },
    { slot: "leftArm", label: "L. Arm" },
    { slot: "rightArm", label: "R. Arm" },
    { slot: "leftWeapon", label: "L. Weapon" },
    { slot: "rightWeapon", label: "R. Weapon" },
    { slot: "legs", label: "Legs" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-gradient-to-br from-gray-900 to-purple-950 border-2 border-cyan-500/50 rounded-lg shadow-2xl shadow-cyan-500/30 max-w-6xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b border-cyan-500/30 bg-black/40">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
            CHARACTER CUSTOMIZATION
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl px-2">×</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 bg-black relative">
            <canvas ref={canvasRef} className="w-full h-full block" />
            <div className="absolute bottom-2 left-2 text-xs text-cyan-300/70">
              Drag to rotate · Scroll to zoom
            </div>
            <div className="absolute top-2 right-2 flex gap-2">
              <button onClick={() => applyPreset(DEFAULT_ARMOR_SET)}
                className="px-3 py-1 text-xs rounded bg-cyan-900/60 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-800/60">
                HUMANOID PRESET
              </button>
              <button onClick={() => applyPreset(TITAN_ARMOR_SET)}
                className="px-3 py-1 text-xs rounded bg-red-900/60 border border-orange-500/40 text-orange-200 hover:bg-red-800/60">
                TITAN PRESET
              </button>
              <button onClick={() => applyPreset(DREAD_ARMOR_SET)}
                className="px-3 py-1 text-xs rounded bg-purple-900/70 border border-fuchsia-500/50 text-fuchsia-200 hover:bg-purple-800/70">
                DREAD PRESET
              </button>
            </div>
          </div>

          <div className="w-[26rem] bg-gray-950/80 flex flex-col border-l border-cyan-500/30">
            <div className="flex border-b border-cyan-500/30">
              {(["body", "armor", "colors", "enemies"] as Tab[]).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 px-3 py-2 text-xs font-bold uppercase ${tab === t ? "bg-cyan-500/20 text-cyan-200 border-b-2 border-cyan-400" : "text-gray-400 hover:bg-gray-800/50"}`}>
                  {t === "enemies" ? "Boss Style" : t}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {tab === "body" && (
                <div>
                  <h3 className="text-cyan-300 font-bold mb-3">PROPORTIONS</h3>
                  <div className={groupClass}>
                    <label className={labelClass}>Height: {config.height.toFixed(1)}</label>
                    <input type="range" min={12} max={26} step={0.5} value={config.height}
                      onChange={(e) => update("height", parseFloat(e.target.value))} className={sliderClass} />
                  </div>
                  <div className={groupClass}>
                    <label className={labelClass}>Head Scale: {config.headScale.toFixed(2)}</label>
                    <input type="range" min={1.4} max={3.2} step={0.05} value={config.headScale}
                      onChange={(e) => update("headScale", parseFloat(e.target.value))} className={sliderClass} />
                  </div>
                  <div className={groupClass}>
                    <label className={labelClass}>Shoulder Width: {config.shoulderWidth.toFixed(1)}</label>
                    <input type="range" min={4} max={9} step={0.1} value={config.shoulderWidth}
                      onChange={(e) => update("shoulderWidth", parseFloat(e.target.value))} className={sliderClass} />
                  </div>
                  <div className={groupClass}>
                    <label className={labelClass}>Arm Length: {config.armLength.toFixed(1)}</label>
                    <input type="range" min={6} max={13} step={0.1} value={config.armLength}
                      onChange={(e) => update("armLength", parseFloat(e.target.value))} className={sliderClass} />
                  </div>
                  <div className={groupClass}>
                    <label className={labelClass}>Leg Length: {config.legLength.toFixed(1)}</label>
                    <input type="range" min={7} max={14} step={0.1} value={config.legLength}
                      onChange={(e) => update("legLength", parseFloat(e.target.value))} className={sliderClass} />
                  </div>

                  <div className={groupClass}>
                    <label className={labelClass}>Body Type</label>
                    <div className="flex gap-2">
                      {(["lean", "athletic", "heavy"] as const).map((t) => (
                        <button key={t} onClick={() => update("bodyType", t)}
                          className={`flex-1 px-2 py-1 text-xs rounded border ${config.bodyType === t ? "bg-cyan-500/30 border-cyan-400 text-cyan-200" : "border-gray-600 text-gray-400 hover:border-cyan-500/50"}`}>
                          {t.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={groupClass}>
                    <label className={labelClass}>Armor Frame</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["humanoid", "light", "heavy", "captain"] as const).map((t) => (
                        <button key={t} onClick={() => update("armorType", t)}
                          className={`px-2 py-1 text-xs rounded border ${config.armorType === t ? "bg-cyan-500/30 border-cyan-400 text-cyan-200" : "border-gray-600 text-gray-400 hover:border-cyan-500/50"}`}>
                          {t.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {tab === "armor" && (
                <div>
                  <h3 className="text-cyan-300 font-bold mb-3">ARMOR PARTS</h3>
                  {slotLabels.map(({ slot, label }) => {
                    const options = ARMOR_PART_REGISTRY[slot];
                    const current = (armorSet[slot] as string) || options[0]?.id || "";
                    return (
                      <div key={slot} className={groupClass}>
                        <label className={labelClass}>{label}</label>
                        <select value={current}
                          onChange={(e) => updateArmorPart(slot, e.target.value)}
                          className="w-full bg-gray-900 border border-cyan-500/40 rounded px-2 py-1 text-sm text-cyan-100">
                          {options.map((opt) => (
                            <option key={opt.id} value={opt.id}>{opt.name}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}

              {tab === "enemies" && (
                <div>
                  <h3 className="text-fuchsia-300 font-bold mb-2">CAPTAIN & TITAN STYLES</h3>
                  <p className="text-[11px] text-gray-400 mb-4">
                    Force every spawned elite to wear the look you pick. Saved with your
                    character; takes effect on the next spawn.
                  </p>

                  <div className={groupClass}>
                    <label className={labelClass}>Captain Body</label>
                    <select
                      value={config.enemyStyles?.captainPreset ?? "random"}
                      onChange={(e) => updateEnemyStyle("captainPreset", e.target.value as EnemyStyleOverrides["captainPreset"])}
                      className="w-full bg-gray-900 border border-fuchsia-500/40 rounded px-2 py-1 text-sm text-fuchsia-100"
                    >
                      <option value="random">Random (default)</option>
                      <option value="HumanoidCaptainAlpha">Captain Alpha — Heavy Brute</option>
                      <option value="HumanoidCaptainBeta">Captain Beta — Athletic</option>
                      <option value="HumanoidCaptainGamma">Captain Gamma — Lean Stalker</option>
                      <option value="HumanoidCaptainOmega">Captain Omega — Towering</option>
                    </select>
                  </div>

                  <div className={groupClass}>
                    <label className={labelClass}>Captain Tint</label>
                    <select
                      value={config.enemyStyles?.captainVariant ?? "byLevel"}
                      onChange={(e) => updateEnemyStyle("captainVariant", e.target.value as EnemyStyleOverrides["captainVariant"])}
                      className="w-full bg-gray-900 border border-fuchsia-500/40 rounded px-2 py-1 text-sm text-fuchsia-100"
                    >
                      <option value="byLevel">By Level (default)</option>
                      {(Object.keys(BOSS_VARIANTS) as BossVariantId[]).map((id) => (
                        <option key={id} value={id}>{BOSS_VARIANTS[id].displayName}</option>
                      ))}
                    </select>
                  </div>

                  <div className={groupClass}>
                    <label className={labelClass}>Titan / Heavy Body</label>
                    <select
                      value={config.enemyStyles?.titanPreset ?? "random"}
                      onChange={(e) => updateEnemyStyle("titanPreset", e.target.value as EnemyStyleOverrides["titanPreset"])}
                      className="w-full bg-gray-900 border border-fuchsia-500/40 rounded px-2 py-1 text-sm text-fuchsia-100"
                    >
                      <option value="random">Random (default)</option>
                      <option value="TankTitan">Tank Titan — Stocky</option>
                      <option value="OptimusForge">Optimus Forge — Tall</option>
                    </select>
                  </div>

                  <div className="mt-4 p-3 rounded border border-fuchsia-500/30 bg-fuchsia-900/10 text-[11px] text-fuchsia-200/80">
                    Pair these picks with the new <b>DREAD</b> armor preset above (DREAD button on the
                    preview) to give yourself the matching evil silhouette.
                  </div>
                </div>
              )}

              {tab === "colors" && (
                <div>
                  <h3 className="text-cyan-300 font-bold mb-3">CHARACTER COLORS</h3>
                  {(["primary", "secondary", "skin", "hair"] as const).map((key) => (
                    <div key={key} className={groupClass}>
                      <label className={labelClass}>{key}</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={colorToHex(config.colors[key])}
                          onChange={(e) => updateColor(key, e.target.value)}
                          className="w-12 h-8 rounded border border-cyan-500/40 bg-transparent cursor-pointer" />
                        <span className="text-xs text-gray-400">{colorToHex(config.colors[key])}</span>
                      </div>
                    </div>
                  ))}

                  <h3 className="text-cyan-300 font-bold mt-5 mb-3">ARMOR PALETTE</h3>
                  {(["primary", "secondary", "trim", "glow"] as const).map((key) => (
                    <div key={key} className={groupClass}>
                      <label className={labelClass}>Armor {key}</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={colorToHex(armorSet.colors[key])}
                          onChange={(e) => updateArmorColor(key, e.target.value)}
                          className="w-12 h-8 rounded border border-cyan-500/40 bg-transparent cursor-pointer" />
                        <span className="text-xs text-gray-400">{colorToHex(armorSet.colors[key])}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-cyan-500/30 p-3 space-y-2 bg-black/40">
              <div className="flex gap-2">
                <button onClick={exportJson}
                  className="flex-1 px-2 py-1 text-xs font-bold border border-purple-500/50 text-purple-200 hover:bg-purple-900/40 rounded">
                  EXPORT JSON
                </button>
                <label className="flex-1 px-2 py-1 text-xs font-bold border border-purple-500/50 text-purple-200 hover:bg-purple-900/40 rounded text-center cursor-pointer">
                  IMPORT JSON
                  <input type="file" accept="application/json" className="hidden" onChange={importJson} />
                </label>
              </div>
              <div className="flex gap-2">
                <button onClick={reset}
                  className="flex-1 px-3 py-2 text-sm font-bold border border-gray-500 text-gray-300 hover:bg-gray-700 rounded">
                  RESET
                </button>
                <button onClick={save}
                  className="flex-1 px-3 py-2 text-sm font-bold text-black bg-gradient-to-r from-cyan-400 to-purple-500 hover:scale-105 transition-transform rounded">
                  SAVE & CLOSE
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
