import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { InventorySystem } from "./InventorySystem";
import { ArmorMaterialFactory, ArmorPalette } from "./ArmorMaterialFactory";

export type PrefabCategory = "Defense" | "Housing" | "Industry" | "Decoration";

export interface PrefabCost {
  materialId: string;
  quantity: number;
}

export interface PrefabBuildContext {
  scene: BABYLON.Scene;
  parent: BABYLON.TransformNode;
  materials: ArmorMaterialFactory;
}

export interface PrefabDefinition {
  id: string;
  name: string;
  category: PrefabCategory;
  footprint: { width: number; depth: number };
  cost: PrefabCost[];
  build: (ctx: PrefabBuildContext) => BABYLON.Mesh[];
  baseStructureKind?: "lab" | "garden";
}

export interface PlacedPrefab {
  id: string;
  definitionId: string;
  root: BABYLON.TransformNode;
  meshes: BABYLON.Mesh[];
  position: BABYLON.Vector3;
  rotation: number;
  materials: ArmorMaterialFactory;
}

export interface SerializedPrefab {
  defId: string;
  pos: [number, number, number];
  rot: number;
}

const PREFAB_GRID_SIZE = 2;

const DEFAULT_PALETTE: ArmorPalette = {
  primary: new BABYLON.Color3(0.55, 0.6, 0.7),
  secondary: new BABYLON.Color3(0.3, 0.32, 0.36),
  trim: new BABYLON.Color3(0.95, 0.78, 0.25),
  glow: new BABYLON.Color3(0.2, 0.95, 1.0),
};

function box(scene: BABYLON.Scene, name: string, w: number, h: number, d: number, mat: BABYLON.Material): BABYLON.Mesh {
  const m = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.material = mat;
  return m;
}

function pillar(scene: BABYLON.Scene, name: string, h: number, d: number, mat: BABYLON.Material): BABYLON.Mesh {
  const m = BABYLON.MeshBuilder.CreateCylinder(name, { height: h, diameterTop: d, diameterBottom: d, tessellation: 12 }, scene);
  m.material = mat;
  return m;
}

function sphere(scene: BABYLON.Scene, name: string, d: number, mat: BABYLON.Material): BABYLON.Mesh {
  const m = BABYLON.MeshBuilder.CreateSphere(name, { diameter: d, segments: 12 }, scene);
  m.material = mat;
  return m;
}

function ring(scene: BABYLON.Scene, name: string, d: number, t: number, mat: BABYLON.Material): BABYLON.Mesh {
  const m = BABYLON.MeshBuilder.CreateTorus(name, { diameter: d, thickness: t, tessellation: 24 }, scene);
  m.material = mat;
  return m;
}

export const PREFAB_REGISTRY: PrefabDefinition[] = [
  {
    id: "def_watchtower",
    name: "Watchtower",
    category: "Defense",
    footprint: { width: 4, depth: 4 },
    cost: [{ materialId: "scrap_metal", quantity: 18 }, { materialId: "energy_core", quantity: 1 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const base = box(scene, "wt_base", 4, 0.4, 4, materials.metal());
      base.position.y = 0.2;
      ms.push(base);
      const post = pillar(scene, "wt_post", 8, 0.6, materials.metal());
      post.position.y = 0.4 + 4;
      ms.push(post);
      const top = box(scene, "wt_top", 3.5, 0.3, 3.5, materials.metal());
      top.position.y = 8.4;
      ms.push(top);
      const railH = 0.6;
      for (const [rx, rz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]] as [number, number][]) {
        const rail = box(scene, `wt_rail_${rx}_${rz}`, rx === 0 ? 3.5 : 0.1, railH, rz === 0 ? 0.1 : 3.5, materials.gold());
        rail.position.set(rx, 8.4 + railH / 2, rz);
        ms.push(rail);
      }
      const lamp = sphere(scene, "wt_lamp", 0.6, materials.neon());
      lamp.position.y = 9.3;
      ms.push(lamp);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "def_bunker",
    name: "Bunker",
    category: "Defense",
    footprint: { width: 5, depth: 5 },
    cost: [{ materialId: "scrap_metal", quantity: 20 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const floor = box(scene, "bk_floor", 5, 0.3, 5, materials.metal());
      floor.position.y = 0.15;
      ms.push(floor);
      const walls = [
        { x: 0, z: -2.5, w: 5, d: 0.4 },
        { x: 0, z: 2.5, w: 5, d: 0.4 },
        { x: -2.5, z: 0, w: 0.4, d: 5 },
        { x: 2.5, z: 0, w: 0.4, d: 5 },
      ];
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        const wall = box(scene, `bk_wall_${i}`, w.w, 2.6, w.d, materials.ceramic());
        wall.position.set(w.x, 1.4, w.z);
        ms.push(wall);
      }
      const door = box(scene, "bk_door", 1.0, 1.8, 0.45, materials.black());
      door.position.set(0, 1.0, 2.55);
      ms.push(door);
      const slit = box(scene, "bk_slit", 0.8, 0.15, 0.5, materials.neon());
      slit.position.set(0, 2.0, -2.55);
      ms.push(slit);
      const roof = box(scene, "bk_roof", 5.4, 0.3, 5.4, materials.metal());
      roof.position.y = 2.8;
      ms.push(roof);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "def_gate_arch",
    name: "Gate Arch",
    category: "Defense",
    footprint: { width: 6, depth: 1 },
    cost: [{ materialId: "scrap_metal", quantity: 14 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      for (const sgn of [-1, 1]) {
        const post = pillar(scene, `ga_post_${sgn}`, 5, 0.7, materials.metal());
        post.position.set(sgn * 2.5, 2.5, 0);
        ms.push(post);
        const cap = box(scene, `ga_cap_${sgn}`, 1.2, 0.35, 1.2, materials.gold());
        cap.position.set(sgn * 2.5, 5.2, 0);
        ms.push(cap);
      }
      const arch = box(scene, "ga_arch", 6.2, 0.5, 0.7, materials.metal());
      arch.position.y = 5.6;
      ms.push(arch);
      const sign = box(scene, "ga_sign", 4.5, 0.6, 0.1, materials.neon());
      sign.position.set(0, 5.6, 0.45);
      ms.push(sign);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "def_turret_pad",
    name: "Turret Emplacement",
    category: "Defense",
    footprint: { width: 3, depth: 3 },
    cost: [{ materialId: "scrap_metal", quantity: 10 }, { materialId: "circuit_board", quantity: 2 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const base = box(scene, "tp_base", 3, 0.4, 3, materials.metal());
      base.position.y = 0.2;
      ms.push(base);
      const dome = sphere(scene, "tp_dome", 1.6, materials.metal());
      dome.scaling.y = 0.6;
      dome.position.y = 0.7;
      ms.push(dome);
      const collar = ring(scene, "tp_collar", 1.7, 0.1, materials.gold());
      collar.position.y = 0.85;
      collar.scaling.y = 0.4;
      ms.push(collar);
      const barrel = pillar(scene, "tp_barrel", 1.6, 0.18, materials.black());
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(0.7, 1.0, 0);
      ms.push(barrel);
      const tip = sphere(scene, "tp_tip", 0.3, materials.neon());
      tip.position.set(1.4, 1.0, 0);
      ms.push(tip);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "hou_house_small",
    name: "Small House",
    category: "Housing",
    footprint: { width: 5, depth: 5 },
    cost: [{ materialId: "scrap_metal", quantity: 12 }, { materialId: "nano_fiber", quantity: 4 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const floor = box(scene, "hs_floor", 5, 0.25, 5, materials.metal());
      floor.position.y = 0.13;
      ms.push(floor);
      const walls = [
        { x: 0, z: -2.5, w: 5, d: 0.3 },
        { x: 0, z: 2.5, w: 5, d: 0.3 },
        { x: -2.5, z: 0, w: 0.3, d: 5 },
        { x: 2.5, z: 0, w: 0.3, d: 5 },
      ];
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        const wall = box(scene, `hs_wall_${i}`, w.w, 2.4, w.d, materials.ceramic());
        wall.position.set(w.x, 1.25, w.z);
        ms.push(wall);
      }
      const door = box(scene, "hs_door", 0.9, 1.7, 0.35, materials.black());
      door.position.set(0, 0.95, 2.55);
      ms.push(door);
      const win = box(scene, "hs_win", 0.8, 0.7, 0.35, materials.neon());
      win.position.set(-1.6, 1.6, 2.55);
      ms.push(win);
      const roof = box(scene, "hs_roof", 5.6, 0.4, 5.6, materials.metal());
      roof.position.y = 2.65;
      ms.push(roof);
      const peak = box(scene, "hs_peak", 5.6, 0.8, 1.5, materials.metal());
      peak.position.set(0, 3.1, 0);
      peak.rotation.x = 0.3;
      ms.push(peak);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "hou_market_stall",
    name: "Market Stall",
    category: "Housing",
    footprint: { width: 4, depth: 3 },
    cost: [{ materialId: "scrap_metal", quantity: 6 }, { materialId: "nano_fiber", quantity: 2 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      for (const [x, z] of [[-1.8, -1.3], [1.8, -1.3], [-1.8, 1.3], [1.8, 1.3]] as [number, number][]) {
        const post = pillar(scene, `mk_post_${x}_${z}`, 2.4, 0.18, materials.metal());
        post.position.set(x, 1.2, z);
        ms.push(post);
      }
      const canopy = box(scene, "mk_canopy", 4.4, 0.18, 3.0, materials.neon());
      canopy.position.y = 2.45;
      ms.push(canopy);
      const counter = box(scene, "mk_counter", 4.0, 1.0, 0.6, materials.ceramic());
      counter.position.set(0, 0.5, 1.0);
      ms.push(counter);
      const trim = box(scene, "mk_trim", 4.2, 0.08, 0.65, materials.gold());
      trim.position.set(0, 1.05, 1.0);
      ms.push(trim);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "hou_well",
    name: "Energy Well",
    category: "Housing",
    footprint: { width: 2.5, depth: 2.5 },
    cost: [{ materialId: "scrap_metal", quantity: 6 }, { materialId: "energy_core", quantity: 1 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const wall = pillar(scene, "wl_wall", 1.0, 2.2, materials.ceramic());
      wall.position.y = 0.5;
      ms.push(wall);
      const inner = pillar(scene, "wl_inner", 1.0, 1.6, materials.black());
      inner.position.y = 0.51;
      ms.push(inner);
      const glow = sphere(scene, "wl_glow", 1.4, materials.neon());
      glow.scaling.y = 0.2;
      glow.position.y = 0.95;
      ms.push(glow);
      for (const sgn of [-1, 1]) {
        const post = pillar(scene, `wl_post_${sgn}`, 1.8, 0.12, materials.metal());
        post.position.set(sgn * 1.0, 1.9, 0);
        ms.push(post);
      }
      const beam = box(scene, "wl_beam", 2.4, 0.12, 0.12, materials.metal());
      beam.position.y = 2.7;
      ms.push(beam);
      const finial = sphere(scene, "wl_finial", 0.3, materials.gold());
      finial.position.y = 2.85;
      ms.push(finial);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "hou_lamp_post",
    name: "Lamp Post",
    category: "Housing",
    footprint: { width: 1, depth: 1 },
    cost: [{ materialId: "scrap_metal", quantity: 3 }, { materialId: "energy_core", quantity: 1 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const base = pillar(scene, "lp_base", 0.3, 0.6, materials.metal());
      base.position.y = 0.15;
      ms.push(base);
      const post = pillar(scene, "lp_post", 4, 0.18, materials.metal());
      post.position.y = 2.3;
      ms.push(post);
      const arm = box(scene, "lp_arm", 0.12, 0.12, 0.8, materials.metal());
      arm.position.set(0, 4.1, 0.4);
      ms.push(arm);
      const lamp = sphere(scene, "lp_lamp", 0.45, materials.neon());
      lamp.position.set(0, 4.0, 0.85);
      ms.push(lamp);
      const cap = sphere(scene, "lp_cap", 0.5, materials.gold());
      cap.scaling.y = 0.3;
      cap.position.set(0, 4.2, 0.85);
      ms.push(cap);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "ind_power_pylon",
    name: "Power Pylon",
    category: "Industry",
    footprint: { width: 3, depth: 3 },
    cost: [{ materialId: "scrap_metal", quantity: 14 }, { materialId: "energy_core", quantity: 2 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const base = box(scene, "pp_base", 3, 0.4, 3, materials.metal());
      base.position.y = 0.2;
      ms.push(base);
      const post = pillar(scene, "pp_post", 6, 0.5, materials.metal());
      post.position.y = 3.4;
      ms.push(post);
      const core = sphere(scene, "pp_core", 1.4, materials.neon());
      core.position.y = 6.6;
      ms.push(core);
      const halo = ring(scene, "pp_halo", 2.2, 0.1, materials.gold());
      halo.position.y = 6.6;
      halo.scaling.y = 0.3;
      ms.push(halo);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const ant = pillar(scene, `pp_ant_${i}`, 2.0, 0.08, materials.metal());
        ant.position.set(Math.cos(a) * 1.0, 7.5, Math.sin(a) * 1.0);
        ant.rotation.x = Math.cos(a) * 0.3;
        ant.rotation.z = -Math.sin(a) * 0.3;
        ms.push(ant);
        const tip = sphere(scene, `pp_tip_${i}`, 0.18, materials.neon());
        tip.position.set(Math.cos(a) * 1.5, 8.2, Math.sin(a) * 1.5);
        ms.push(tip);
      }
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "ind_comms_dish",
    name: "Comms Dish",
    category: "Industry",
    footprint: { width: 3, depth: 3 },
    cost: [{ materialId: "scrap_metal", quantity: 10 }, { materialId: "circuit_board", quantity: 3 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const base = box(scene, "cd_base", 2.6, 0.3, 2.6, materials.metal());
      base.position.y = 0.15;
      ms.push(base);
      const post = pillar(scene, "cd_post", 4, 0.4, materials.metal());
      post.position.y = 2.3;
      ms.push(post);
      const dish = sphere(scene, "cd_dish", 2.6, materials.ceramic());
      dish.scaling.set(1.0, 0.35, 1.0);
      dish.position.y = 4.4;
      dish.rotation.x = -0.6;
      ms.push(dish);
      const horn = pillar(scene, "cd_horn", 1.0, 0.16, materials.gold());
      horn.position.y = 4.7;
      horn.position.z = 0.3;
      horn.rotation.x = -0.6;
      ms.push(horn);
      const led = sphere(scene, "cd_led", 0.2, materials.neon());
      led.position.set(0, 4.4, 0.9);
      ms.push(led);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "ind_storage_silo",
    name: "Storage Silo",
    category: "Industry",
    footprint: { width: 3, depth: 3 },
    cost: [{ materialId: "scrap_metal", quantity: 16 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const base = pillar(scene, "ss_base", 0.4, 3.2, materials.metal());
      base.position.y = 0.2;
      ms.push(base);
      const body = pillar(scene, "ss_body", 6, 2.6, materials.ceramic());
      body.position.y = 3.4;
      ms.push(body);
      for (let i = 0; i < 3; i++) {
        const band = ring(scene, `ss_band_${i}`, 2.7, 0.08, materials.gold());
        band.position.y = 1.5 + i * 1.8;
        band.scaling.y = 0.25;
        ms.push(band);
      }
      const cap = sphere(scene, "ss_cap", 2.6, materials.metal());
      cap.scaling.y = 0.5;
      cap.position.y = 6.6;
      ms.push(cap);
      const vent = pillar(scene, "ss_vent", 0.6, 0.5, materials.neon());
      vent.position.y = 7.2;
      ms.push(vent);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "dec_monument",
    name: "Monument",
    category: "Decoration",
    footprint: { width: 2, depth: 2 },
    cost: [{ materialId: "scrap_metal", quantity: 8 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const base = box(scene, "mn_base", 2, 0.5, 2, materials.metal());
      base.position.y = 0.25;
      ms.push(base);
      const step = box(scene, "mn_step", 1.5, 0.3, 1.5, materials.metal());
      step.position.y = 0.65;
      ms.push(step);
      const post = pillar(scene, "mn_post", 5, 0.5, materials.ceramic());
      post.position.y = 3.3;
      ms.push(post);
      const ring1 = ring(scene, "mn_ring", 0.9, 0.08, materials.gold());
      ring1.position.y = 5.9;
      ring1.scaling.y = 0.4;
      ms.push(ring1);
      const top = pillar(scene, "mn_top", 1.0, 0.3, materials.gold());
      top.position.y = 6.4;
      ms.push(top);
      const orb = sphere(scene, "mn_orb", 0.7, materials.neon());
      orb.position.y = 7.2;
      ms.push(orb);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "dec_banner",
    name: "Banner",
    category: "Decoration",
    footprint: { width: 4, depth: 1 },
    cost: [{ materialId: "nano_fiber", quantity: 3 }, { materialId: "scrap_metal", quantity: 4 }],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      for (const sgn of [-1, 1]) {
        const post = pillar(scene, `bn_post_${sgn}`, 4.5, 0.15, materials.metal());
        post.position.set(sgn * 1.8, 2.25, 0);
        ms.push(post);
      }
      const cross = box(scene, "bn_cross", 4.0, 0.15, 0.15, materials.metal());
      cross.position.y = 4.4;
      ms.push(cross);
      const cloth = box(scene, "bn_cloth", 3.6, 2.6, 0.06, materials.neon());
      cloth.position.y = 3.0;
      ms.push(cloth);
      const trim = box(scene, "bn_trim", 3.7, 0.1, 0.08, materials.gold());
      trim.position.y = 4.25;
      ms.push(trim);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "base_lab",
    name: "Lab",
    category: "Industry",
    footprint: { width: 7, depth: 7 },
    cost: [
      { materialId: "scrap_metal", quantity: 30 },
      { materialId: "circuit_board", quantity: 4 },
      { materialId: "energy_core", quantity: 2 },
    ],
    baseStructureKind: "lab",
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const floor = box(scene, "lab_floor", 7, 0.3, 7, materials.metal());
      floor.position.y = 0.15;
      ms.push(floor);
      const trim = box(scene, "lab_trim", 7.2, 0.12, 7.2, materials.gold());
      trim.position.y = 0.35;
      ms.push(trim);
      for (const [x, z] of [[-3.2, -3.2], [3.2, -3.2], [-3.2, 3.2], [3.2, 3.2]] as [number, number][]) {
        const post = pillar(scene, `lab_post_${x}_${z}`, 4.5, 0.35, materials.metal());
        post.position.set(x, 2.4, z);
        ms.push(post);
      }
      const wallBack = box(scene, "lab_wallBack", 7, 4.0, 0.3, materials.ceramic());
      wallBack.position.set(0, 2.2, -3.4);
      ms.push(wallBack);
      const wallLeft = box(scene, "lab_wallLeft", 0.3, 4.0, 7, materials.ceramic());
      wallLeft.position.set(-3.4, 2.2, 0);
      ms.push(wallLeft);
      const wallRight = box(scene, "lab_wallRight", 0.3, 4.0, 7, materials.ceramic());
      wallRight.position.set(3.4, 2.2, 0);
      ms.push(wallRight);
      const dome = sphere(scene, "lab_dome", 5.5, materials.neon());
      dome.scaling.y = 0.6;
      dome.position.y = 4.6;
      const domeMat = dome.material as BABYLON.StandardMaterial;
      if (domeMat) domeMat.alpha = 0.55;
      ms.push(dome);
      const podBase = pillar(scene, "lab_podBase", 1.6, 1.4, materials.metal());
      podBase.position.set(0, 0.8, -1.6);
      ms.push(podBase);
      const podGlass = sphere(scene, "lab_podGlass", 1.6, materials.neon());
      podGlass.position.set(0, 2.2, -1.6);
      const pgMat = podGlass.material as BABYLON.StandardMaterial;
      if (pgMat) pgMat.alpha = 0.5;
      ms.push(podGlass);
      const console1 = box(scene, "lab_console", 2.2, 1.1, 0.8, materials.black());
      console1.position.set(2.0, 0.55, 1.5);
      ms.push(console1);
      const screen = box(scene, "lab_screen", 1.8, 0.8, 0.05, materials.neon());
      screen.position.set(2.0, 1.4, 1.1);
      ms.push(screen);
      const sign = box(scene, "lab_sign", 4.5, 0.6, 0.15, materials.neon());
      sign.position.set(0, 4.6, 3.5);
      ms.push(sign);
      const signFrame = box(scene, "lab_signFrame", 4.7, 0.75, 0.18, materials.gold());
      signFrame.position.set(0, 4.6, 3.45);
      ms.push(signFrame);
      const beacon = sphere(scene, "lab_beacon", 0.6, materials.neon());
      beacon.position.set(0, 5.6, 0);
      ms.push(beacon);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "base_garden",
    name: "Garden Dome",
    category: "Industry",
    footprint: { width: 8, depth: 8 },
    cost: [
      { materialId: "scrap_metal", quantity: 22 },
      { materialId: "nano_fiber", quantity: 6 },
      { materialId: "energy_core", quantity: 1 },
    ],
    baseStructureKind: "garden",
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const floor = box(scene, "gd_floor", 8, 0.3, 8, materials.ceramic());
      floor.position.y = 0.15;
      ms.push(floor);
      const trim = box(scene, "gd_trim", 8.2, 0.12, 8.2, materials.gold());
      trim.position.y = 0.35;
      ms.push(trim);
      const dome = sphere(scene, "gd_dome", 8.0, materials.neon());
      dome.scaling.y = 0.85;
      dome.position.y = 3.4;
      const dmMat = dome.material as BABYLON.StandardMaterial;
      if (dmMat) {
        dmMat.alpha = 0.32;
        dmMat.diffuseColor = new BABYLON.Color3(0.4, 1.0, 0.5);
      }
      ms.push(dome);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const arch = pillar(scene, `gd_rib_${i}`, 6.5, 0.16, materials.metal());
        arch.position.set(Math.cos(a) * 3.6, 3.0, Math.sin(a) * 3.6);
        arch.rotation.z = -Math.cos(a) * 0.3;
        arch.rotation.x = Math.sin(a) * 0.3;
        ms.push(arch);
      }
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const planter = pillar(scene, `gd_planter_${i}`, 0.4, 1.2, materials.gold());
        planter.position.set(Math.cos(a) * 2.4, 0.4, Math.sin(a) * 2.4);
        ms.push(planter);
        const plant = sphere(scene, `gd_plant_${i}`, 1.0, materials.neon());
        plant.position.set(Math.cos(a) * 2.4, 1.0, Math.sin(a) * 2.4);
        const pmMat = plant.material as BABYLON.StandardMaterial;
        if (pmMat) pmMat.diffuseColor = new BABYLON.Color3(0.2, 0.8, 0.3);
        ms.push(plant);
      }
      const pond = pillar(scene, "gd_pond", 0.18, 2.2, materials.neon());
      pond.position.y = 0.4;
      ms.push(pond);
      const sign = box(scene, "gd_sign", 4.0, 0.55, 0.15, materials.neon());
      sign.position.set(0, 5.4, 3.6);
      ms.push(sign);
      const signFrame = box(scene, "gd_signFrame", 4.2, 0.7, 0.18, materials.gold());
      signFrame.position.set(0, 5.4, 3.55);
      ms.push(signFrame);
      const beacon = sphere(scene, "gd_beacon", 0.55, materials.neon());
      beacon.position.set(0, 6.6, 0);
      ms.push(beacon);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
  {
    id: "city_block_small",
    name: "City Block",
    category: "Housing",
    footprint: { width: 14, depth: 14 },
    cost: [
      { materialId: "scrap_metal", quantity: 60 },
      { materialId: "circuit_board", quantity: 4 },
      { materialId: "energy_core", quantity: 2 },
      { materialId: "nano_fiber", quantity: 6 },
    ],
    build: ({ scene, parent, materials }) => {
      const ms: BABYLON.Mesh[] = [];
      const plaza = box(scene, "cb_plaza", 14, 0.3, 14, materials.ceramic());
      plaza.position.y = 0.15;
      ms.push(plaza);
      const trimRing = box(scene, "cb_trim_ring", 14.4, 0.12, 14.4, materials.gold());
      trimRing.position.y = 0.32;
      ms.push(trimRing);
      const innerCut = box(scene, "cb_inner", 11.6, 0.32, 11.6, materials.metal());
      innerCut.position.y = 0.34;
      ms.push(innerCut);
      const houseSpots: [number, number][] = [[-5, -5], [5, -5], [-5, 5], [5, 5]];
      for (let i = 0; i < houseSpots.length; i++) {
        const [hx, hz] = houseSpots[i];
        const base = box(scene, `cb_h_base_${i}`, 4, 0.4, 4, materials.metal());
        base.position.set(hx, 0.55, hz);
        ms.push(base);
        const walls = box(scene, `cb_h_walls_${i}`, 3.6, 2.6, 3.6, materials.ceramic());
        walls.position.set(hx, 1.85, hz);
        ms.push(walls);
        const roof = BABYLON.MeshBuilder.CreateCylinder(`cb_h_roof_${i}`, {
          height: 1.4, diameterTop: 0, diameterBottom: 4.2, tessellation: 4,
        }, scene);
        roof.material = materials.metal();
        roof.position.set(hx, 3.85, hz);
        roof.rotation.y = Math.PI / 4;
        ms.push(roof);
        const glow = sphere(scene, `cb_h_glow_${i}`, 0.45, materials.neon());
        glow.position.set(hx, 4.6, hz);
        ms.push(glow);
      }
      for (const sgn of [-1, 1]) {
        const lampPost = pillar(scene, `cb_lamp_post_${sgn}`, 3.5, 0.18, materials.metal());
        lampPost.position.set(sgn * 6.4, 2.0, 0);
        ms.push(lampPost);
        const lampHead = sphere(scene, `cb_lamp_head_${sgn}`, 0.5, materials.neon());
        lampHead.position.set(sgn * 6.4, 4.0, 0);
        ms.push(lampHead);
      }
      const fountainBase = pillar(scene, "cb_fb", 0.6, 3.2, materials.metal());
      fountainBase.position.y = 0.6;
      ms.push(fountainBase);
      const fountainBowl = ring(scene, "cb_fbowl", 2.8, 0.4, materials.gold());
      fountainBowl.position.y = 1.0;
      ms.push(fountainBowl);
      const fountainOrb = sphere(scene, "cb_forb", 1.2, materials.neon());
      fountainOrb.position.y = 1.6;
      ms.push(fountainOrb);
      for (const m of ms) m.parent = parent;
      return ms;
    },
  },
];

export interface PrefabSummary {
  id: string;
  name: string;
  category: PrefabCategory;
  cost: PrefabCost[];
}

export class PrefabSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private inventory: InventorySystem;
  private bus: EventBus;

  private planMode: boolean = false;
  private selectedIndex: number = 0;
  private placementRotation: number = 0;
  private previewMesh: BABYLON.Mesh | null = null;
  private placed: PlacedPrefab[] = [];
  private placedCounter: number = 0;

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private clickHandler: ((e: PointerEvent) => void) | null = null;
  private renderObserver: BABYLON.Observer<BABYLON.Scene> | null = null;
  private onPlacedCallback: ((p: PlacedPrefab, def: PrefabDefinition) => void) | null = null;
  private onRemovedCallback: ((id: string) => void) | null = null;

  constructor(scene: BABYLON.Scene, camera: BABYLON.FreeCamera, inventory: InventorySystem) {
    this.scene = scene;
    this.camera = camera;
    this.inventory = inventory;
    this.bus = EventBus.getInstance();
    this.setupControls();
    this.renderObserver = scene.onBeforeRenderObservable.add(() => this.updatePreview());
    console.log("[PrefabSystem] Initialized with", PREFAB_REGISTRY.length, "prefabs");
  }

  private setupControls(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.code === "KeyP") {
        this.togglePlanMode();
        return;
      }
      if (!this.planMode) return;
      if (e.code === "KeyR") this.placementRotation = (this.placementRotation + 45) % 360;
      if (e.code === "BracketLeft") this.cycle(-1);
      if (e.code === "BracketRight") this.cycle(1);
      if (e.code === "Escape" && this.planMode) this.togglePlanMode();
    };
    this.wheelHandler = (e: WheelEvent) => {
      if (!this.planMode) return;
      e.preventDefault();
      this.cycle(e.deltaY > 0 ? 1 : -1);
    };
    this.clickHandler = (e: PointerEvent) => {
      if (!this.planMode) return;
      if (e.button === 0) this.placeAtCrosshair();
      else if (e.button === 2) this.removeAtCrosshair();
    };
    window.addEventListener("keydown", this.keyHandler);
    window.addEventListener("wheel", this.wheelHandler, { passive: false });
    window.addEventListener("pointerdown", this.clickHandler);
  }

  togglePlanMode(): void {
    this.planMode = !this.planMode;
    if (this.planMode) {
      this.bus.emit("building:disableBuildMode");
      this.createPreview();
      this.bus.emit(GameEvents.UI_MESSAGE, "Plan Mode ON — wheel cycles, R rotates, LMB places, RMB removes");
    } else {
      this.destroyPreview();
      this.bus.emit(GameEvents.UI_MESSAGE, "Plan Mode OFF");
    }
    this.bus.emit("prefab:modeChanged", this.planMode);
  }

  isPlanMode(): boolean {
    return this.planMode;
  }

  getHotbar(): PrefabSummary[] {
    return PREFAB_REGISTRY.map((p) => ({ id: p.id, name: p.name, category: p.category, cost: p.cost }));
  }

  getSelected(): PrefabSummary {
    const def = PREFAB_REGISTRY[this.selectedIndex];
    return { id: def.id, name: def.name, category: def.category, cost: def.cost };
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  private cycle(dir: number): void {
    const len = PREFAB_REGISTRY.length;
    this.selectedIndex = (this.selectedIndex + dir + len) % len;
    this.updatePreviewSize();
    this.bus.emit("prefab:selectionChanged", this.selectedIndex);
    this.bus.emit(GameEvents.UI_MESSAGE, `Selected: ${PREFAB_REGISTRY[this.selectedIndex].name}`);
  }

  private getPlacementPosition(): BABYLON.Vector3 {
    const ray = this.scene.createPickingRay(
      this.scene.getEngine().getRenderWidth() / 2,
      this.scene.getEngine().getRenderHeight() / 2,
      BABYLON.Matrix.Identity(),
      this.camera
    );
    const groundPlane = BABYLON.Plane.FromPositionAndNormal(BABYLON.Vector3.Zero(), BABYLON.Axis.Y);
    const dist = ray.intersectsPlane(groundPlane);
    let pt: BABYLON.Vector3;
    if (dist !== null && dist >= 0) {
      pt = ray.origin.add(ray.direction.scale(dist));
      const maxDist = 60;
      if (BABYLON.Vector3.Distance(this.camera.position, pt) > maxDist) {
        pt = this.camera.position.add(this.camera.getDirection(BABYLON.Axis.Z).scale(15));
      }
    } else {
      pt = this.camera.position.add(this.camera.getDirection(BABYLON.Axis.Z).scale(15));
    }
    pt.x = Math.round(pt.x / PREFAB_GRID_SIZE) * PREFAB_GRID_SIZE;
    pt.z = Math.round(pt.z / PREFAB_GRID_SIZE) * PREFAB_GRID_SIZE;
    pt.y = 0;
    return pt;
  }

  private createPreview(): void {
    this.destroyPreview();
    const m = BABYLON.MeshBuilder.CreateBox("prefab_preview", {
      width: 1, height: 0.1, depth: 1,
    }, this.scene);
    const mat = new BABYLON.StandardMaterial("prefab_preview_mat", this.scene);
    mat.diffuseColor = new BABYLON.Color3(0.2, 1.0, 0.5);
    mat.emissiveColor = new BABYLON.Color3(0.05, 0.5, 0.2);
    mat.alpha = 0.4;
    mat.wireframe = true;
    m.material = mat;
    m.isPickable = false;
    this.previewMesh = m;
    this.updatePreviewSize();
  }

  private updatePreviewSize(): void {
    if (!this.previewMesh) return;
    const def = PREFAB_REGISTRY[this.selectedIndex];
    this.previewMesh.scaling.set(def.footprint.width, 1, def.footprint.depth);
  }

  private destroyPreview(): void {
    if (this.previewMesh) {
      this.previewMesh.material?.dispose();
      this.previewMesh.dispose();
      this.previewMesh = null;
    }
  }

  private updatePreview(): void {
    if (!this.planMode || !this.previewMesh) return;
    const pos = this.getPlacementPosition();
    this.previewMesh.position = pos.add(new BABYLON.Vector3(0, 0.05, 0));
    this.previewMesh.rotation.y = BABYLON.Tools.ToRadians(this.placementRotation);
  }

  private canAfford(def: PrefabDefinition): boolean {
    return def.cost.every((c) => this.inventory.hasItem(c.materialId, c.quantity));
  }

  private consume(def: PrefabDefinition): void {
    for (const c of def.cost) this.inventory.removeItem(c.materialId, c.quantity);
  }

  private placeAtCrosshair(): void {
    const def = PREFAB_REGISTRY[this.selectedIndex];
    if (!this.canAfford(def)) {
      this.bus.emit(GameEvents.UI_MESSAGE, "Not enough materials!");
      return;
    }
    const pos = this.getPlacementPosition();
    const overlapping = this.placed.some((p) => BABYLON.Vector3.Distance(p.position, pos) < 1.5);
    if (overlapping) {
      this.bus.emit(GameEvents.UI_MESSAGE, "Cannot place — too close to another structure");
      return;
    }
    this.consume(def);
    const id = `prefab_${this.placedCounter++}`;
    const root = new BABYLON.TransformNode(id, this.scene);
    const materials = new ArmorMaterialFactory(this.scene, DEFAULT_PALETTE, id);
    const meshes = def.build({ scene: this.scene, parent: root, materials });
    for (const m of meshes) {
      m.checkCollisions = true;
      m.metadata = { tag: "PlacedPrefab", prefabId: id };
    }
    root.position = pos.clone();
    root.rotation.y = BABYLON.Tools.ToRadians(this.placementRotation);
    this.placed.push({
      id,
      definitionId: def.id,
      root,
      meshes,
      position: pos.clone(),
      rotation: this.placementRotation,
      materials,
    });
    const placed = this.placed[this.placed.length - 1];
    if (this.onPlacedCallback) this.onPlacedCallback(placed, def);
    this.bus.emit(GameEvents.UI_MESSAGE, `Placed ${def.name}`);
    this.bus.emit(GameEvents.INVENTORY_CHANGED);
    console.log("[PrefabSystem] Placed", def.name, "at", pos.x.toFixed(1), pos.z.toFixed(1));
  }

  setOnPlacedCallback(cb: (p: PlacedPrefab, def: PrefabDefinition) => void): void {
    this.onPlacedCallback = cb;
  }

  setOnRemovedCallback(cb: (id: string) => void): void {
    this.onRemovedCallback = cb;
  }

  getPlaced(): PlacedPrefab[] {
    return this.placed.slice();
  }

  getDefinition(defId: string): PrefabDefinition | undefined {
    return PREFAB_REGISTRY.find(p => p.id === defId);
  }

  private removeAtCrosshair(): void {
    const ray = this.scene.createPickingRay(
      this.scene.getEngine().getRenderWidth() / 2,
      this.scene.getEngine().getRenderHeight() / 2,
      BABYLON.Matrix.Identity(),
      this.camera
    );
    const hit = this.scene.pickWithRay(ray, (m) => m?.metadata?.tag === "PlacedPrefab");
    if (!hit || !hit.hit || !hit.pickedMesh) return;
    const pid = hit.pickedMesh.metadata?.prefabId;
    if (!pid) return;
    const idx = this.placed.findIndex((p) => p.id === pid);
    if (idx < 0) return;
    const target = this.placed[idx];
    for (const m of target.meshes) {
      if (!m.isDisposed()) m.dispose();
    }
    target.materials.dispose();
    target.root.dispose();
    this.placed.splice(idx, 1);
    if (this.onRemovedCallback) this.onRemovedCallback(target.id);
    this.bus.emit(GameEvents.UI_MESSAGE, "Structure removed");
  }

  getPlacedCount(): number {
    return this.placed.length;
  }

  exportPlaced(): SerializedPrefab[] {
    return this.placed.map((p) => ({
      defId: p.definitionId,
      pos: [p.position.x, p.position.y, p.position.z] as [number, number, number],
      rot: p.rotation,
    }));
  }

  clearAll(): void {
    for (const p of this.placed) {
      for (const m of p.meshes) if (!m.isDisposed()) m.dispose();
      p.materials.dispose();
      p.root.dispose();
    }
    this.placed = [];
  }

  placeAt(defId: string, pos: BABYLON.Vector3, rotationDeg: number): boolean {
    const def = PREFAB_REGISTRY.find((p) => p.id === defId);
    if (!def) {
      console.warn(`[PrefabSystem] Unknown prefab id: ${defId}`);
      return false;
    }
    const id = `prefab_${this.placedCounter++}`;
    const root = new BABYLON.TransformNode(id, this.scene);
    const materials = new ArmorMaterialFactory(this.scene, DEFAULT_PALETTE, id);
    const meshes = def.build({ scene: this.scene, parent: root, materials });
    for (const m of meshes) {
      m.checkCollisions = true;
      m.metadata = { tag: "PlacedPrefab", prefabId: id };
    }
    root.position = pos.clone();
    root.rotation.y = BABYLON.Tools.ToRadians(rotationDeg);
    this.placed.push({
      id, definitionId: def.id, root, meshes,
      position: pos.clone(), rotation: rotationDeg, materials,
    });
    return true;
  }

  dispose(): void {
    if (this.keyHandler) window.removeEventListener("keydown", this.keyHandler);
    if (this.wheelHandler) window.removeEventListener("wheel", this.wheelHandler);
    if (this.clickHandler) window.removeEventListener("pointerdown", this.clickHandler);
    if (this.renderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }
    this.destroyPreview();
    for (const p of this.placed) {
      for (const m of p.meshes) if (!m.isDisposed()) m.dispose();
      p.materials.dispose();
      p.root.dispose();
    }
    this.placed = [];
    this.keyHandler = null;
    this.wheelHandler = null;
    this.clickHandler = null;
    console.log("[PrefabSystem] Disposed");
  }
}
