import React, { useEffect, useRef, useState } from "react";
import * as BABYLON from "@babylonjs/core";
import { HumanoidCharacter, HumanoidDefinition } from "./HumanoidCharacter";
import { HUMANOID_PRESETS } from "./HumanoidPresets";

const CHARACTER_STORAGE_KEY = "detroit3026_character_v1";

export interface SavedCharacter {
  height: number;
  headScale: number;
  shoulderWidth: number;
  armLength: number;
  legLength: number;
  bodyType: "lean" | "athletic" | "heavy";
  armorType: "light" | "heavy" | "captain";
  colors: {
    primary: [number, number, number];
    secondary: [number, number, number];
    skin: [number, number, number];
    hair: [number, number, number];
  };
}

export function loadSavedCharacter(): SavedCharacter | null {
  try {
    const raw = localStorage.getItem(CHARACTER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedCharacter;
  } catch {
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
    hasArmor: true,
  };
}

const DEFAULT_CHAR: SavedCharacter = {
  height: 18,
  headScale: 2.2,
  shoulderWidth: 6,
  armLength: 9,
  legLength: 10,
  bodyType: "athletic",
  armorType: "light",
  colors: {
    primary: [0.1, 0.3, 0.6],
    secondary: [0.05, 0.15, 0.3],
    skin: [0.9, 0.75, 0.65],
    hair: [0.1, 0.1, 0.1],
  },
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

export const CharacterEditor: React.FC<CharacterEditorProps> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BABYLON.Engine | null>(null);
  const sceneRef = useRef<BABYLON.Scene | null>(null);
  const charRef = useRef<HumanoidCharacter | null>(null);
  const [config, setConfig] = useState<SavedCharacter>(() => loadSavedCharacter() || DEFAULT_CHAR);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new BABYLON.Engine(canvasRef.current, true, { preserveDrawingBuffer: true });
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.05, 0.06, 0.12, 1);

    const camera = new BABYLON.ArcRotateCamera(
      "previewCam",
      -Math.PI / 2,
      Math.PI / 2.4,
      45,
      new BABYLON.Vector3(0, 9, 0),
      scene
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
      charRef.current?.dispose();
      scene.dispose();
      engine.dispose();
    };
  }, []);

  function rebuildCharacter(c: SavedCharacter) {
    if (!sceneRef.current) return;
    if (charRef.current) {
      charRef.current.dispose();
      charRef.current = null;
    }
    const def = savedCharacterToHumanoidDef(c);
    const char = new HumanoidCharacter(sceneRef.current, def);
    char.getRoot().position = new BABYLON.Vector3(0, 0, 0);
    charRef.current = char;
  }

  useEffect(() => {
    rebuildCharacter(config);
  }, [config]);

  function update<K extends keyof SavedCharacter>(key: K, value: SavedCharacter[K]) {
    setConfig({ ...config, [key]: value });
  }

  function updateColor(key: keyof SavedCharacter["colors"], hex: string) {
    setConfig({ ...config, colors: { ...config.colors, [key]: hexToColor(hex) } });
  }

  function save() {
    localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(config));
    onClose();
  }

  function reset() {
    setConfig(DEFAULT_CHAR);
  }

  const sliderClass = "w-full accent-cyan-400";
  const labelClass = "block text-xs text-cyan-300 uppercase tracking-wide mb-1";
  const groupClass = "mb-3";

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-gradient-to-br from-gray-900 to-purple-950 border-2 border-cyan-500/50 rounded-lg shadow-2xl shadow-cyan-500/30 max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b border-cyan-500/30 bg-black/40">
          <h2 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
            CHARACTER CUSTOMIZATION
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl px-2"
          >×</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 bg-black relative">
            <canvas ref={canvasRef} className="w-full h-full block" />
            <div className="absolute bottom-2 left-2 text-xs text-cyan-300/70">
              Drag to rotate · Scroll to zoom
            </div>
          </div>

          <div className="w-96 bg-gray-950/80 p-4 overflow-y-auto border-l border-cyan-500/30">
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
                  <button key={t}
                    onClick={() => update("bodyType", t)}
                    className={`flex-1 px-2 py-1 text-xs rounded border ${config.bodyType === t ? "bg-cyan-500/30 border-cyan-400 text-cyan-200" : "border-gray-600 text-gray-400 hover:border-cyan-500/50"}`}>
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className={groupClass}>
              <label className={labelClass}>Armor Type</label>
              <div className="grid grid-cols-3 gap-2">
                {(["light", "heavy", "captain"] as const).map((t) => (
                  <button key={t}
                    onClick={() => update("armorType", t)}
                    className={`px-2 py-1 text-xs rounded border ${config.armorType === t ? "bg-purple-500/30 border-purple-400 text-purple-200" : "border-gray-600 text-gray-400 hover:border-purple-500/50"}`}>
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <h3 className="text-cyan-300 font-bold mt-4 mb-3">COLORS</h3>
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

            <div className="flex gap-2 mt-4">
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
  );
};
