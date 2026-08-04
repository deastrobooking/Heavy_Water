import React, { useEffect, useMemo, useRef, useState } from "react";
import * as BABYLON from "@babylonjs/core";
import { RobotFactory } from "./RobotFactory";
import {
  RobotDescriptor, RobotStyle, createDefaultStyle, validateStyle,
  serializeRobot, deserializeRobot,
} from "./RobotDesigner";
import { ROBOT_PRESETS, ALLY_PRESETS, PET_PRESETS } from "./RobotPresets";
import { BIO_SPECIES } from "./BioSpecies";
import { buildCreatureDescriptor } from "./CreatureMechaDesigner";
import { HUMANOID_PRESETS } from "./HumanoidPresets";
import { HumanoidCharacter } from "./HumanoidCharacter";
import {
  SavedCharacter, loadSavedCharacter, saveCharacterToStorage,
  savedCharacterToHumanoidDef,
} from "./CharacterEditor";
import {
  CreatorDesign, DesignCategory, listDesigns, saveDesign, deleteDesign,
  newDesignId, importDesign, descriptorFromDesign, queueDeploy,
  sanitizeCharacterPayload, MAX_DESIGNS,
} from "./CreatorDesigns";

/**
 * CreatorSuite — a Blender/Unity-lite in-game editor where players design
 * their own robots, pets, characters and enemies from the game's existing
 * part libraries. Orbit camera + grid preview, click-to-select part groups,
 * range-clamped sliders (the same `validateStyle` clamps the factory uses),
 * undo/redo, named designs with JSON export/import, and deploy hooks:
 * robots/pets join the companion squad, enemies spawn as hostile test
 * units, characters apply to the player through the CharacterEditor path.
 */

interface CreatorSuiteProps {
  onClose: () => void;
  /** True when opened mid-mission — deploys take effect immediately. */
  inGame?: boolean;
}

type PartGroup = "body" | "head" | "arms" | "legs" | "addons" | "colors";

// Mesh-name prefixes from RobotFactory → editor part group. Built
// articulate so sub-meshes keep their names; unknown names fall to body.
const MESH_GROUP: Array<[RegExp, PartGroup]> = [
  [/^(h|v|horn|ant|eye|eyb|brw|mth|chk)(?![a-z])/, "head"],
  [/^(ua|fa|hd|gl|gk|cn|sp|sh|sg)(?![a-z])/, "arms"],
  [/^(th|sn|ft|lg|lp|ls|bt|bc|hp)(?![a-z])/, "legs"],
  [/^(wg|bk|bp|eng|ex|eg|tl|wht|whh|whg|wd|lwd|vt|vs|ab)(?![a-z])/, "addons"],
];

function groupForMesh(name: string): PartGroup {
  for (const [re, g] of MESH_GROUP) if (re.test(name)) return g;
  return "body";
}

interface SliderSpec { key: keyof RobotStyle; label: string; min: number; max: number; step?: number; }
interface ToggleSpec { key: keyof RobotStyle; label: string; }
interface SelectSpec { key: keyof RobotStyle; label: string; options: string[]; }

const GROUP_SLIDERS: Record<Exclude<PartGroup, "colors">, SliderSpec[]> = {
  body: [
    { key: "scale", label: "Overall Size", min: 0.3, max: 3.0, step: 0.05 },
    { key: "torsoWidth", label: "Torso Width", min: 0.5, max: 3.0, step: 0.05 },
    { key: "torsoHeight", label: "Torso Height", min: 0.8, max: 3.5, step: 0.05 },
    { key: "torsoDepth", label: "Torso Depth", min: 0.3, max: 2.0, step: 0.05 },
    { key: "extraPlating", label: "Extra Plating", min: 0, max: 3, step: 1 },
    { key: "asymmetry", label: "Asymmetry", min: 0, max: 1, step: 0.05 },
  ],
  head: [
    { key: "headSize", label: "Head Size", min: 0.2, max: 1.5, step: 0.05 },
    { key: "hornLength", label: "Horn Length", min: 0.1, max: 1.0, step: 0.05 },
    { key: "antennaLength", label: "Antenna Length", min: 0.2, max: 1.5, step: 0.05 },
  ],
  arms: [
    { key: "armLength", label: "Arm Length", min: 0.5, max: 3.0, step: 0.05 },
    { key: "armThickness", label: "Arm Thickness", min: 0.1, max: 0.6, step: 0.02 },
    { key: "shoulderPadSize", label: "Shoulder Pads", min: 0.2, max: 1.2, step: 0.05 },
    { key: "cannonSize", label: "Cannon Size", min: 0.2, max: 1.0, step: 0.05 },
    { key: "shieldSize", label: "Shield Size", min: 0.5, max: 2.5, step: 0.05 },
  ],
  legs: [
    { key: "legLength", label: "Leg Length", min: 0.6, max: 3.0, step: 0.05 },
    { key: "legThickness", label: "Leg Thickness", min: 0.15, max: 0.8, step: 0.02 },
    { key: "hipPadSize", label: "Hip Pads", min: 0.2, max: 1.2, step: 0.05 },
  ],
  addons: [
    { key: "wingSpan", label: "Wing Span", min: 0.5, max: 3.0, step: 0.05 },
    { key: "wingAngle", label: "Wing Angle", min: 0, max: 1.2, step: 0.05 },
    { key: "tailLength", label: "Tail Length", min: 0.5, max: 3.0, step: 0.05 },
    { key: "tailSegments", label: "Tail Segments", min: 2, max: 8, step: 1 },
    { key: "backpackSize", label: "Backpack Size", min: 0.3, max: 1.5, step: 0.05 },
  ],
};

const GROUP_TOGGLES: Record<Exclude<PartGroup, "colors">, ToggleSpec[]> = {
  body: [{ key: "hasPanelLines", label: "Panel Lines" }],
  head: [
    { key: "hasVisor", label: "Visor" },
    { key: "hasHorns", label: "Horns" },
    { key: "hasAntennae", label: "Antennae" },
    { key: "hasFace", label: "Creature Face" },
  ],
  arms: [
    { key: "hasCannons", label: "Shoulder Cannons" },
    { key: "hasShield", label: "Shield" },
  ],
  legs: [{ key: "hasWheels", label: "Wheels" }],
  addons: [
    { key: "hasWings", label: "Wings" },
    { key: "hasTail", label: "Tail" },
    { key: "hasBackpack", label: "Backpack" },
    { key: "hasBackpackEngine", label: "Engine Pack" },
  ],
};

const GROUP_SELECTS: Record<Exclude<PartGroup, "colors">, SelectSpec[]> = {
  body: [],
  head: [
    { key: "headShape", label: "Head Shape", options: ["box", "sphere", "cylinder", "cone"] },
    { key: "visorStyle", label: "Visor Style", options: ["slit", "round", "full"] },
    { key: "faceStyle", label: "Face Style", options: ["twinEyes", "insectEyes", "visorFace", "singleEye"] },
    { key: "mouthStyle", label: "Mouth", options: ["none", "grill", "fang", "jaw", "beak"] },
  ],
  arms: [
    { key: "armStyle", label: "Arm Style", options: ["cylinder", "box", "tapered"] },
    { key: "gauntletStyle", label: "Gauntlets", options: ["standard", "rounded", "armored"] },
  ],
  legs: [
    { key: "legStyle", label: "Leg Style", options: ["box", "digitigrade", "hoverpads"] },
    { key: "bootStyle", label: "Boots", options: ["standard", "rounded", "wheeled"] },
  ],
  addons: [],
};

const CATEGORY_TABS: Array<{ id: DesignCategory; label: string }> = [
  { id: "robot", label: "ROBOTS" },
  { id: "pet", label: "PETS" },
  { id: "character", label: "CHARACTERS" },
  { id: "enemy", label: "ENEMIES" },
];

const FACTION: Record<DesignCategory, RobotDescriptor["faction"]> = {
  robot: "ally", pet: "pet", enemy: "enemy", character: "neutral",
};

function c3ToHex(c: BABYLON.Color3): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}
function hexToC3(hex: string): BABYLON.Color3 {
  return new BABYLON.Color3(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
}
function arrToHex(a: [number, number, number]): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return `#${h(a[0])}${h(a[1])}${h(a[2])}`;
}
function hexToArr(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

const DEFAULT_CHAR_CFG: SavedCharacter = {
  height: 18, headScale: 2.2, shoulderWidth: 6, armLength: 9, legLength: 10,
  bodyType: "athletic", armorType: "humanoid",
  colors: {
    primary: [0.18, 0.55, 0.95], secondary: [0.06, 0.18, 0.42],
    skin: [0.92, 0.78, 0.68], hair: [0.08, 0.08, 0.08],
  },
};

function defaultDescriptor(category: DesignCategory): RobotDescriptor {
  return { name: "Custom Unit", faction: FACTION[category], style: createDefaultStyle("scout") };
}

// History snapshot — full editor state so undo/redo works across modes.
interface Snapshot { descJson: string; charJson: string; }

export const CreatorSuite: React.FC<CreatorSuiteProps> = ({ onClose, inGame }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BABYLON.Engine | null>(null);
  const sceneRef = useRef<BABYLON.Scene | null>(null);
  const factoryRef = useRef<RobotFactory | null>(null);
  const robotRootRef = useRef<BABYLON.TransformNode | null>(null);
  const charRef = useRef<HumanoidCharacter | null>(null);
  const cameraRef = useRef<BABYLON.ArcRotateCamera | null>(null);

  const [tab, setTab] = useState<DesignCategory>("robot");
  const [desc, setDesc] = useState<RobotDescriptor>(() => defaultDescriptor("robot"));
  const [charCfg, setCharCfg] = useState<SavedCharacter>(() => loadSavedCharacter() ?? DEFAULT_CHAR_CFG);
  const [designName, setDesignName] = useState("My Robot");
  const [group, setGroup] = useState<PartGroup>("body");
  const [designs, setDesigns] = useState<CreatorDesign[]>(() => listDesigns());
  const [status, setStatus] = useState<string>("");
  const [seedIdx, setSeedIdx] = useState(0);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const descRef = useRef(desc); descRef.current = desc;
  const charCfgRef = useRef(charCfg); charCfgRef.current = charCfg;
  const tabRef = useRef(tab); tabRef.current = tab;

  const flash = (msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(s => (s === msg ? "" : s)), 2600);
  };

  const snapshot = (): Snapshot => ({
    descJson: serializeRobot(descRef.current),
    charJson: JSON.stringify(charCfgRef.current),
  });

  const pushHistory = () => {
    undoStack.current.push(snapshot());
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
  };

  const applySnapshot = (s: Snapshot) => {
    try {
      setDesc(deserializeRobot(s.descJson));
      setCharCfg(JSON.parse(s.charJson));
    } catch {}
  };

  const undo = () => {
    const s = undoStack.current.pop();
    if (!s) { flash("Nothing to undo"); return; }
    redoStack.current.push(snapshot());
    applySnapshot(s);
  };
  const redo = () => {
    const s = redoStack.current.pop();
    if (!s) { flash("Nothing to redo"); return; }
    undoStack.current.push(snapshot());
    applySnapshot(s);
  };

  // ------------------------------------------------------------ seeds
  const seeds = useMemo<Array<{ id: string; label: string; apply: () => RobotDescriptor | null }>>(() => {
    if (tab === "robot") {
      return [...Object.keys(ALLY_PRESETS), ...Object.keys(ROBOT_PRESETS)].map(k => ({
        id: k, label: k,
        apply: () => {
          const p = ALLY_PRESETS[k] ?? ROBOT_PRESETS[k];
          return p ? { ...p, faction: "ally" as const, style: { ...p.style, colors: { ...p.style.colors } } } : null;
        },
      }));
    }
    if (tab === "pet") {
      const presets = Object.keys(PET_PRESETS).map(k => ({
        id: k, label: k,
        apply: () => {
          const p = PET_PRESETS[k];
          return p ? { ...p, faction: "pet" as const, style: { ...p.style, colors: { ...p.style.colors } } } : null;
        },
      }));
      const species = BIO_SPECIES.map(s => ({
        id: s.id, label: s.name,
        apply: () => buildCreatureDescriptor(s, { follower: true }),
      }));
      return [...presets, ...species];
    }
    if (tab === "enemy") {
      return Object.keys(ROBOT_PRESETS).map(k => ({
        id: k, label: k,
        apply: () => {
          const p = ROBOT_PRESETS[k];
          return p ? { ...p, faction: "enemy" as const, style: { ...p.style, colors: { ...p.style.colors } } } : null;
        },
      }));
    }
    // characters — seed body proportions + palette from humanoid presets
    return Object.keys(HUMANOID_PRESETS).map(k => ({
      id: k, label: k.replace(/^Humanoid/, ""),
      apply: () => {
        const def = HUMANOID_PRESETS[k];
        if (!def) return null;
        pushHistory();
        setCharCfg(prev => ({
          ...prev,
          height: def.height, headScale: def.headScale,
          shoulderWidth: def.shoulderWidth,
          armLength: def.armLength, legLength: def.legLength,
          bodyType: def.bodyType ?? prev.bodyType,
          armorType: def.armorType ?? prev.armorType,
          colors: {
            primary: def.colors.primary.asArray() as [number, number, number],
            secondary: def.colors.secondary.asArray() as [number, number, number],
            skin: def.colors.skin.asArray() as [number, number, number],
            hair: def.colors.hair.asArray() as [number, number, number],
          },
        }));
        return null;
      },
    }));
  }, [tab]);

  const applySeed = (i: number) => {
    const seed = seeds[i];
    if (!seed) return;
    if (tab === "character") { seed.apply(); flash(`Preset: ${seed.label}`); return; }
    const d = seed.apply();
    if (d) {
      pushHistory();
      d.style = validateStyle({ ...d.style });
      setDesc(d);
      setDesignName(d.name || seed.label);
      setLoadedId(null);
      flash(`Loaded parts: ${seed.label}`);
    }
  };

  // ------------------------------------------------------ babylon scene
  useEffect(() => {
    if (!canvasRef.current) return;
    let engine: BABYLON.Engine;
    try {
      engine = new BABYLON.Engine(canvasRef.current, true, { preserveDrawingBuffer: false });
    } catch (e) {
      console.warn("[CreatorSuite] engine init failed", e);
      return;
    }
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.045, 0.055, 0.1, 1);

    const camera = new BABYLON.ArcRotateCamera(
      "creatorCam", -Math.PI / 2.3, Math.PI / 2.5, 12,
      new BABYLON.Vector3(0, 2.2, 0), scene,
    );
    camera.attachControl(canvasRef.current, true);
    camera.lowerRadiusLimit = 3;
    camera.upperRadiusLimit = 80;
    camera.wheelPrecision = 20;
    cameraRef.current = camera;

    const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.85;
    const dir = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-0.4, -0.8, -0.3), scene);
    dir.intensity = 0.75;

    // Editor floor grid — thin emissive lines, Blender-style.
    const gridMat = new BABYLON.StandardMaterial("gridMat", scene);
    gridMat.diffuseColor = new BABYLON.Color3(0.1, 0.12, 0.18);
    gridMat.emissiveColor = new BABYLON.Color3(0.03, 0.05, 0.09);
    const floor = BABYLON.MeshBuilder.CreateGround("floor", { width: 40, height: 40 }, scene);
    floor.material = gridMat;
    floor.isPickable = false;
    const lineMat = new BABYLON.StandardMaterial("lineMat", scene);
    lineMat.emissiveColor = new BABYLON.Color3(0.12, 0.3, 0.45);
    lineMat.disableLighting = true;
    for (let i = -20; i <= 20; i += 2) {
      for (const horiz of [true, false]) {
        const ln = BABYLON.MeshBuilder.CreateBox(`gl_${i}_${horiz}`, {
          width: horiz ? 40 : 0.02, height: 0.01, depth: horiz ? 0.02 : 40,
        }, scene);
        ln.position.set(horiz ? 0 : i, 0.005, horiz ? i : 0);
        ln.material = lineMat;
        ln.isPickable = false;
      }
    }

    factoryRef.current = new RobotFactory(scene);
    engineRef.current = engine;
    sceneRef.current = scene;

    // Click a part → select its slider group (the "gizmo" of this editor).
    scene.onPointerObservable.add(info => {
      if (info.type !== BABYLON.PointerEventTypes.POINTERTAP) return;
      const hit = info.pickInfo;
      if (hit?.hit && hit.pickedMesh && tabRef.current !== "character") {
        setGroup(groupForMesh(hit.pickedMesh.name));
      }
    });

    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      try { charRef.current?.dispose(); } catch {}
      try { robotRootRef.current?.dispose(); } catch {}
      // Full teardown — leaked WebGL contexts eventually kill the game view.
      try { scene.dispose(); } catch {}
      try { engine.dispose(); } catch {}
      engineRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  // Rebuild preview whenever the working design changes.
  useEffect(() => {
    const scene = sceneRef.current;
    const factory = factoryRef.current;
    if (!scene || !factory) return;
    try { robotRootRef.current?.dispose(); } catch {}
    robotRootRef.current = null;
    try { charRef.current?.dispose(); } catch {}
    charRef.current = null;

    if (tab === "character") {
      const char = new HumanoidCharacter(scene, savedCharacterToHumanoidDef(charCfg));
      char.getRoot().position = BABYLON.Vector3.Zero();
      charRef.current = char;
      if (cameraRef.current) {
        cameraRef.current.target = new BABYLON.Vector3(0, charCfg.height * 0.55, 0);
        cameraRef.current.radius = Math.max(cameraRef.current.radius, charCfg.height * 2.2);
      }
    } else {
      // Articulate build keeps sub-meshes named so click-select works.
      const preview: RobotDescriptor = { ...desc, articulate: true };
      const root = factory.createRobot(preview, new BABYLON.Vector3(0, desc.style.legLength * desc.style.scale, 0));
      root.getChildMeshes().forEach(m => { m.isPickable = true; });
      robotRootRef.current = root;
      if (cameraRef.current) {
        const h = (desc.style.legLength + desc.style.torsoHeight + desc.style.headSize) * desc.style.scale;
        cameraRef.current.target = new BABYLON.Vector3(0, h * 0.6, 0);
      }
    }
  }, [desc, charCfg, tab]);

  // Keyboard: undo/redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Gamepad: d-pad navigates the parts palette, A applies, LB/RB switch tabs.
  useEffect(() => {
    let prev: boolean[] = [];
    const iv = window.setInterval(() => {
      const gp = navigator.getGamepads?.()[0];
      if (!gp) return;
      const pressed = gp.buttons.map(b => b.pressed);
      const edge = (i: number) => pressed[i] && !prev[i];
      if (edge(12)) setSeedIdx(i => Math.max(0, i - 1));
      if (edge(13)) setSeedIdx(i => Math.min(seeds.length - 1, i + 1));
      if (edge(0)) applySeed(seedIdxRef.current);
      if (edge(4)) cycleTab(-1);
      if (edge(5)) cycleTab(1);
      if (edge(1)) onClose();
      prev = pressed;
    }, 120);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeds, onClose]);
  const seedIdxRef = useRef(seedIdx); seedIdxRef.current = seedIdx;

  const cycleTab = (dir: number) => {
    const idx = CATEGORY_TABS.findIndex(t => t.id === tabRef.current);
    const next = CATEGORY_TABS[(idx + dir + CATEGORY_TABS.length) % CATEGORY_TABS.length];
    switchTab(next.id);
  };

  const switchTab = (t: DesignCategory) => {
    setTab(t);
    setSeedIdx(0);
    setLoadedId(null);
    setGroup(t === "character" ? "body" : "body");
    if (t !== "character") {
      setDesc(d => ({ ...d, faction: FACTION[t] }));
      setDesignName(t === "pet" ? "My Pet" : t === "enemy" ? "My Enemy" : "My Robot");
    } else {
      setDesignName("My Character");
    }
  };

  // ------------------------------------------------------------- edits
  const updateStyle = (patch: Partial<RobotStyle>) => {
    pushHistory();
    setDesc(d => ({ ...d, style: validateStyle({ ...d.style, ...patch }) }));
  };
  const updateColor = (key: "primary" | "secondary" | "emissive", hex: string) => {
    pushHistory();
    setDesc(d => ({
      ...d,
      style: { ...d.style, colors: { ...d.style.colors, [key]: hexToC3(hex) } },
    }));
  };
  const updateChar = (patch: Partial<SavedCharacter>) => {
    pushHistory();
    setCharCfg(c => ({ ...c, ...patch }));
  };
  const updateCharColor = (key: keyof SavedCharacter["colors"], hex: string) => {
    pushHistory();
    setCharCfg(c => ({ ...c, colors: { ...c.colors, [key]: hexToArr(hex) } }));
  };

  // ----------------------------------------------------------- designs
  const currentDesignPayload = (): CreatorDesign => {
    const base: CreatorDesign = {
      id: loadedId ?? newDesignId(),
      name: designName.trim() || "Untitled",
      category: tab,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (tab === "character") base.character = charCfgRef.current;
    else base.robotJson = serializeRobot({ ...descRef.current, name: base.name, faction: FACTION[tab] });
    return base;
  };

  const handleSave = () => {
    const d = currentDesignPayload();
    const existing = listDesigns().find(x => x.id === d.id);
    if (existing) d.createdAt = existing.createdAt;
    if (!saveDesign(d)) {
      flash(`Save failed — max ${MAX_DESIGNS} designs`);
      return;
    }
    setLoadedId(d.id);
    setDesigns(listDesigns());
    flash(`Saved "${d.name}"`);
  };

  const handleLoad = (d: CreatorDesign) => {
    if (d.category !== tab) switchTab(d.category);
    if (d.category === "character") {
      const c = sanitizeCharacterPayload(d.character);
      if (c) { pushHistory(); setCharCfg(prev => ({ ...prev, ...c })); }
      else { flash("Design is corrupt"); return; }
    } else {
      const parsed = descriptorFromDesign(d);
      if (!parsed) { flash("Design is corrupt"); return; }
      pushHistory();
      setDesc(parsed);
    }
    setDesignName(d.name);
    setLoadedId(d.id);
    flash(`Loaded "${d.name}"`);
  };

  const handleDelete = (d: CreatorDesign) => {
    deleteDesign(d.id);
    if (loadedId === d.id) setLoadedId(null);
    setDesigns(listDesigns());
    flash(`Deleted "${d.name}"`);
  };

  const handleExport = (d: CreatorDesign) => {
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${d.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "design"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = importDesign(String(reader.result));
        if (!saveDesign(d)) { flash(`Import failed — max ${MAX_DESIGNS} designs`); return; }
        setDesigns(listDesigns());
        flash(`Imported "${d.name}"`);
      } catch {
        flash("Invalid design file");
      }
    };
    reader.readAsText(file);
  };

  const handleDeploy = (d: CreatorDesign) => {
    if (d.category === "character") {
      // Apply through the CharacterEditor path — keeps armor + boss styles.
      // Sanitize first: the payload may have arrived via JSON import.
      const existing = loadSavedCharacter();
      const c = sanitizeCharacterPayload(d.character);
      if (!c) { flash("Design is corrupt"); return; }
      saveCharacterToStorage({
        ...(existing ?? DEFAULT_CHAR_CFG),
        height: c.height, headScale: c.headScale, shoulderWidth: c.shoulderWidth,
        armLength: c.armLength, legLength: c.legLength,
        bodyType: c.bodyType, armorType: c.armorType, colors: c.colors,
      });
      flash(`"${d.name}" applied to your character`);
      return;
    }
    queueDeploy({ designId: d.id, action: d.category === "enemy" ? "enemy" : "companion" });
    flash(d.category === "enemy"
      ? (inGame ? `"${d.name}" spawning as a test enemy` : `"${d.name}" will spawn as a test enemy in your next mission`)
      : (inGame ? `"${d.name}" joining your squad` : `"${d.name}" will join your squad in your next mission`));
  };

  // ---------------------------------------------------------------- UI
  const S = styles;
  const tabDesigns = designs.filter(d => d.category === tab);
  const isChar = tab === "character";
  const g = group === "colors" ? "body" : group as Exclude<PartGroup, "colors">;

  return (
    <div style={S.overlay}>
      {/* Left rail — categories, parts palette, saved designs */}
      <div style={S.leftPanel}>
        <div style={S.title}>CREATOR SUITE</div>
        <div style={S.tabRow}>
          {CATEGORY_TABS.map(t => (
            <button key={t.id} style={{ ...S.tabBtn, ...(tab === t.id ? S.tabActive : {}) }}
              onClick={() => switchTab(t.id)}>{t.label}</button>
          ))}
        </div>

        <div style={S.sectionLabel}>PARTS PALETTE {`(${seeds.length})`}</div>
        <div style={S.seedList}>
          {seeds.map((s, i) => (
            <button key={s.id}
              style={{ ...S.seedBtn, ...(i === seedIdx ? S.seedFocus : {}) }}
              onClick={() => { setSeedIdx(i); applySeed(i); }}>
              {s.label}
            </button>
          ))}
        </div>

        <div style={S.sectionLabel}>SAVED DESIGNS {`(${tabDesigns.length})`}</div>
        <div style={S.designList}>
          {tabDesigns.length === 0 && <div style={S.hint}>No saved {tab} designs yet.</div>}
          {tabDesigns.map(d => (
            <div key={d.id} style={S.designRow}>
              <span style={S.designName} title={d.name}>{d.name}</span>
              <button style={S.miniBtn} onClick={() => handleLoad(d)}>EDIT</button>
              <button style={S.miniBtn} onClick={() => handleDeploy(d)}>
                {d.category === "character" ? "USE" : d.category === "enemy" ? "SPAWN" : "SQUAD"}
              </button>
              <button style={S.miniBtn} onClick={() => handleExport(d)}>⇩</button>
              <button style={{ ...S.miniBtn, color: "#f66" }} onClick={() => handleDelete(d)}>✕</button>
            </div>
          ))}
        </div>
        <label style={S.importBtn}>
          IMPORT JSON
          <input type="file" accept="application/json" style={{ display: "none" }} onChange={handleImport} />
        </label>
        <div style={S.hint}>Gamepad: D-pad browse · A apply · LB/RB category</div>
      </div>

      {/* Center — 3D viewport */}
      <div style={S.viewport}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", outline: "none" }} />
        <div style={S.viewportHint}>Drag to orbit · scroll to zoom{isChar ? "" : " · click a part to edit it"}</div>
        {status && <div style={S.status}>{status}</div>}
      </div>

      {/* Right rail — part group editing */}
      <div style={S.rightPanel}>
        <div style={S.nameRow}>
          <input style={S.nameInput} value={designName} maxLength={40}
            onChange={e => setDesignName(e.target.value)} placeholder="Design name" />
        </div>
        <div style={S.rowBtns}>
          <button style={S.actionBtn} onClick={undo}>↩ UNDO</button>
          <button style={S.actionBtn} onClick={redo}>↪ REDO</button>
          <button style={{ ...S.actionBtn, background: "#134" }} onClick={handleSave}>💾 SAVE</button>
        </div>

        {!isChar && (
          <>
            <div style={S.groupRow}>
              {(["body", "head", "arms", "legs", "addons", "colors"] as PartGroup[]).map(pg => (
                <button key={pg} style={{ ...S.groupBtn, ...(group === pg ? S.tabActive : {}) }}
                  onClick={() => setGroup(pg)}>{pg.toUpperCase()}</button>
              ))}
            </div>

            <div style={S.controls}>
              {group === "colors" ? (
                <>
                  {(["primary", "secondary", "emissive"] as const).map(k => (
                    <div key={k} style={S.colorRow}>
                      <span style={S.ctlLabel}>{k.toUpperCase()}</span>
                      <input type="color" value={c3ToHex(desc.style.colors[k])}
                        onChange={e => updateColor(k, e.target.value)} />
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {GROUP_TOGGLES[g].map(t => (
                    <label key={String(t.key)} style={S.toggleRow}>
                      <input type="checkbox" checked={!!desc.style[t.key]}
                        onChange={e => updateStyle({ [t.key]: e.target.checked } as Partial<RobotStyle>)} />
                      <span style={S.ctlLabel}>{t.label}</span>
                    </label>
                  ))}
                  {GROUP_SELECTS[g].map(sel => (
                    <div key={String(sel.key)} style={S.selectRow}>
                      <span style={S.ctlLabel}>{sel.label}</span>
                      <select style={S.select} value={String(desc.style[sel.key] ?? sel.options[0])}
                        onChange={e => updateStyle({ [sel.key]: e.target.value } as Partial<RobotStyle>)}>
                        {sel.options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                  {GROUP_SLIDERS[g].map(sl => (
                    <div key={String(sl.key)} style={S.sliderRow}>
                      <span style={S.ctlLabel}>{sl.label}</span>
                      <input type="range" min={sl.min} max={sl.max} step={sl.step ?? 0.05}
                        value={Number(desc.style[sl.key] ?? sl.min)}
                        onChange={e => updateStyle({ [sl.key]: parseFloat(e.target.value) } as Partial<RobotStyle>)}
                        style={{ flex: 1 }} />
                      <span style={S.value}>{Number(desc.style[sl.key] ?? 0).toFixed(2)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}

        {isChar && (
          <div style={S.controls}>
            {([
              ["height", "Height", 12, 26],
              ["headScale", "Head Scale", 1.2, 3.5],
              ["shoulderWidth", "Shoulders", 3, 9],
              ["armLength", "Arm Length", 5, 13],
              ["legLength", "Leg Length", 6, 14],
            ] as Array<[keyof SavedCharacter, string, number, number]>).map(([k, label, min, max]) => (
              <div key={String(k)} style={S.sliderRow}>
                <span style={S.ctlLabel}>{label}</span>
                <input type="range" min={min} max={max} step={0.1}
                  value={Number(charCfg[k])}
                  onChange={e => updateChar({ [k]: parseFloat(e.target.value) } as Partial<SavedCharacter>)}
                  style={{ flex: 1 }} />
                <span style={S.value}>{Number(charCfg[k]).toFixed(1)}</span>
              </div>
            ))}
            <div style={S.selectRow}>
              <span style={S.ctlLabel}>Build</span>
              <select style={S.select} value={charCfg.bodyType}
                onChange={e => updateChar({ bodyType: e.target.value as SavedCharacter["bodyType"] })}>
                {["lean", "athletic", "heavy"].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div style={S.selectRow}>
              <span style={S.ctlLabel}>Armor Kit</span>
              <select style={S.select} value={charCfg.armorType}
                onChange={e => updateChar({ armorType: e.target.value as SavedCharacter["armorType"] })}>
                {["light", "heavy", "captain", "humanoid"].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            {(["primary", "secondary", "skin", "hair"] as const).map(k => (
              <div key={k} style={S.colorRow}>
                <span style={S.ctlLabel}>{k.toUpperCase()}</span>
                <input type="color" value={arrToHex(charCfg.colors[k])}
                  onChange={e => updateCharColor(k, e.target.value)} />
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />
        <button style={S.closeBtn} onClick={onClose}>CLOSE EDITOR</button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 60, display: "flex",
    background: "#05070d", color: "#cfe8ff",
    fontFamily: "'Courier New', monospace", fontSize: 12,
  },
  leftPanel: {
    width: 260, padding: 10, display: "flex", flexDirection: "column",
    borderRight: "1px solid #1c3350", background: "#080d17", gap: 6,
  },
  rightPanel: {
    width: 300, padding: 10, display: "flex", flexDirection: "column",
    borderLeft: "1px solid #1c3350", background: "#080d17", gap: 8,
  },
  viewport: { flex: 1, position: "relative" },
  viewportHint: {
    position: "absolute", bottom: 8, left: 12, opacity: 0.55, pointerEvents: "none",
  },
  status: {
    position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
    background: "#0c2138", border: "1px solid #2c88c8", padding: "6px 14px",
    borderRadius: 4, color: "#8fdcff", pointerEvents: "none",
  },
  title: { fontSize: 15, fontWeight: 700, color: "#43d3ff", letterSpacing: 2 },
  tabRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 },
  tabBtn: {
    padding: "6px 4px", background: "#0c1626", color: "#9fc4e8",
    border: "1px solid #1c3350", cursor: "pointer", fontSize: 10, letterSpacing: 1,
  },
  tabActive: { background: "#123a5c", color: "#5fe0ff", borderColor: "#2c88c8" },
  sectionLabel: { marginTop: 6, color: "#5a8ab8", letterSpacing: 1, fontSize: 10 },
  seedList: {
    overflowY: "auto", maxHeight: "32vh", display: "flex",
    flexDirection: "column", gap: 2, border: "1px solid #14243c", padding: 4,
  },
  seedBtn: {
    textAlign: "left", padding: "3px 6px", background: "transparent",
    color: "#b8d6f2", border: "1px solid transparent", cursor: "pointer", fontSize: 11,
  },
  seedFocus: { background: "#10263e", borderColor: "#2c88c8", color: "#6fe3ff" },
  designList: {
    overflowY: "auto", flex: 1, minHeight: 60, display: "flex",
    flexDirection: "column", gap: 2, border: "1px solid #14243c", padding: 4,
  },
  designRow: { display: "flex", alignItems: "center", gap: 3 },
  designName: {
    flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    color: "#d8ecff",
  },
  miniBtn: {
    padding: "2px 5px", fontSize: 9, background: "#0c1626", color: "#8fc8f0",
    border: "1px solid #1c3350", cursor: "pointer",
  },
  importBtn: {
    padding: "6px", textAlign: "center", background: "#0c1626",
    border: "1px dashed #2c88c8", color: "#8fdcff", cursor: "pointer", fontSize: 10,
  },
  hint: { opacity: 0.5, fontSize: 10 },
  nameRow: { display: "flex", gap: 6 },
  nameInput: {
    flex: 1, padding: "6px 8px", background: "#0c1626", color: "#e8f6ff",
    border: "1px solid #1c3350", fontSize: 13, fontFamily: "inherit",
  },
  rowBtns: { display: "flex", gap: 4 },
  actionBtn: {
    flex: 1, padding: "6px 0", background: "#0c1626", color: "#9fd4f8",
    border: "1px solid #1c3350", cursor: "pointer", fontSize: 10,
  },
  groupRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 3 },
  groupBtn: {
    padding: "5px 0", background: "#0c1626", color: "#9fc4e8",
    border: "1px solid #1c3350", cursor: "pointer", fontSize: 9, letterSpacing: 1,
  },
  controls: {
    display: "flex", flexDirection: "column", gap: 7, overflowY: "auto",
    border: "1px solid #14243c", padding: 8, maxHeight: "58vh",
  },
  sliderRow: { display: "flex", alignItems: "center", gap: 6 },
  toggleRow: { display: "flex", alignItems: "center", gap: 6, cursor: "pointer" },
  selectRow: { display: "flex", alignItems: "center", gap: 6 },
  colorRow: { display: "flex", alignItems: "center", gap: 6 },
  ctlLabel: { width: 104, color: "#9fc4e8", fontSize: 10 },
  select: {
    flex: 1, background: "#0c1626", color: "#d8ecff",
    border: "1px solid #1c3350", padding: "3px 4px", fontFamily: "inherit", fontSize: 11,
  },
  value: { width: 34, textAlign: "right", color: "#6fe3ff", fontSize: 10 },
  closeBtn: {
    padding: "10px 0", background: "#341420", color: "#ff9db0",
    border: "1px solid #7c2c40", cursor: "pointer", letterSpacing: 2, fontSize: 11,
  },
};
