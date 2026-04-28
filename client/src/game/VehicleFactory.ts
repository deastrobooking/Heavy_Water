import * as BABYLON from "@babylonjs/core";
import { VehicleDescriptor, VehicleStyle, RGB } from "./VehicleDesigner";

// Per-scene material cache. The previous implementation used a single global
// cache, which left disposed materials lingering after a restart and caused
// vehicle meshes to render fully transparent on respawn (the cached
// StandardMaterial belonged to the disposed scene). Keying by scene means
// each new scene gets fresh materials, and the dispose hook below clears
// entries when their scene goes away.
const matCacheByScene = new WeakMap<BABYLON.Scene, Map<string, BABYLON.StandardMaterial>>();

function getMat(scene: BABYLON.Scene, color: RGB, emissive: RGB = [0, 0, 0], glossy: boolean = false): BABYLON.StandardMaterial {
  const key = `vehmat_${color.join("_")}_${emissive.join("_")}_${glossy ? 1 : 0}`;
  let cache = matCacheByScene.get(scene);
  if (!cache) {
    cache = new Map();
    matCacheByScene.set(scene, cache);
    // Drop the cache when this scene is disposed so we never hand out a
    // material from a dead scene on the next vehicle build.
    scene.onDisposeObservable.add(() => matCacheByScene.delete(scene));
  }
  const cached = cache.get(key);
  // isDisposed guard handles the rarer case of a single material being
  // disposed while its scene is still alive.
  if (cached && !(cached as any).isDisposed?.()) return cached;
  const m = new BABYLON.StandardMaterial(key, scene);
  m.diffuseColor = new BABYLON.Color3(color[0], color[1], color[2]);
  m.emissiveColor = new BABYLON.Color3(emissive[0] * 0.4, emissive[1] * 0.4, emissive[2] * 0.4);
  m.specularColor = glossy ? new BABYLON.Color3(0.6, 0.6, 0.6) : new BABYLON.Color3(0.05, 0.05, 0.05);
  m.specularPower = glossy ? 64 : 16;
  cache.set(key, m);
  return m;
}

/** Drop the per-scene vehicle material cache (called from VehicleSystem.dispose). */
export function clearVehicleMaterialCache(scene: BABYLON.Scene): void {
  matCacheByScene.delete(scene);
}

function box(scene: BABYLON.Scene, name: string, w: number, h: number, d: number, parent: BABYLON.TransformNode, mat: BABYLON.Material): BABYLON.Mesh {
  const m = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.parent = parent;
  m.material = mat;
  return m;
}

function cyl(scene: BABYLON.Scene, name: string, h: number, d: number, parent: BABYLON.TransformNode, mat: BABYLON.Material, tessellation: number = 12): BABYLON.Mesh {
  const m = BABYLON.MeshBuilder.CreateCylinder(name, { height: h, diameter: d, tessellation }, scene);
  m.parent = parent;
  m.material = mat;
  return m;
}

export interface VehicleMeshes {
  root: BABYLON.TransformNode;
  hitbox: BABYLON.Mesh;
  thrusters: BABYLON.Mesh[];
  wheels: BABYLON.Mesh[];
}

export class VehicleFactory {
  private scene: BABYLON.Scene;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
  }

  createVehicle(desc: VehicleDescriptor, position: BABYLON.Vector3): VehicleMeshes {
    const root = new BABYLON.TransformNode(`veh_${desc.name}_${Date.now()}`, this.scene);
    root.position.copyFrom(position);

    const style = desc.style;

    if (style.kind === "atv") {
      return this.buildATV(root, style);
    } else {
      return this.buildSpaceFighter(root, style);
    }
  }

  private buildATV(root: BABYLON.TransformNode, style: VehicleStyle): VehicleMeshes {
    const scene = this.scene;
    const matBody = getMat(scene, style.primaryColor, style.emissiveColor, true);
    const matDark = getMat(scene, style.secondaryColor);
    const matAccent = getMat(scene, style.accentColor, style.accentColor, true);
    const matEmissive = getMat(scene, style.emissiveColor, style.emissiveColor);

    const wheelR = style.wheelRadius ?? 0.55;
    const wheelW = style.wheelWidth ?? 0.4;
    const len = style.bodyLength;
    const wid = style.bodyWidth;
    const hgt = style.bodyHeight;

    // Hitbox (invisible) - sized for whole vehicle
    const hitbox = BABYLON.MeshBuilder.CreateBox("atv_hitbox", { width: wid + 0.4, height: hgt + wheelR * 2, depth: len }, scene);
    hitbox.parent = root;
    hitbox.position.y = wheelR + hgt / 2;
    hitbox.isVisible = false;
    hitbox.checkCollisions = false;

    // Main chassis
    const chassis = box(scene, "atv_chassis", wid, hgt, len, root, matBody);
    chassis.position.y = wheelR + hgt / 2;

    // Lower skid plate
    const skid = box(scene, "atv_skid", wid * 0.85, hgt * 0.4, len * 0.9, root, matDark);
    skid.position.y = wheelR + hgt * 0.15;

    // Front nose
    const nose = box(scene, "atv_nose", wid * 0.85, hgt * 0.7, len * 0.25, root, matBody);
    nose.position.set(0, wheelR + hgt * 0.5, len * 0.5 + len * 0.1);

    // Seat
    const seat = box(scene, "atv_seat", wid * 0.55, hgt * 0.35, len * 0.3, root, matDark);
    seat.position.set(0, wheelR + hgt + hgt * 0.18, -len * 0.05);

    // Backrest
    const back = box(scene, "atv_back", wid * 0.55, hgt * 0.7, hgt * 0.2, root, matDark);
    back.position.set(0, wheelR + hgt + hgt * 0.45, -len * 0.18);

    // Handlebars — two side posts (like a bike fork) so the center forward
    // sightline stays CLEAR for the driver to shoot through. A single
    // centered post used to block the reticle directly.
    const barPostL = cyl(scene, "atv_post_l", hgt * 0.8, 0.08, root, matDark);
    barPostL.position.set(-wid * 0.22, wheelR + hgt + hgt * 0.4, len * 0.28);
    const barPostR = cyl(scene, "atv_post_r", hgt * 0.8, 0.08, root, matDark);
    barPostR.position.set(wid * 0.22, wheelR + hgt + hgt * 0.4, len * 0.28);
    const handle = cyl(scene, "atv_handle", wid * 0.7, 0.06, root, matDark);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0, wheelR + hgt + hgt * 0.85, len * 0.28);

    // Headlights
    if (style.hasHeadlights) {
      const lh = box(scene, "atv_headlight_l", 0.22, 0.18, 0.1, root, matEmissive);
      lh.position.set(-wid * 0.32, wheelR + hgt * 0.6, len * 0.62);
      const rh = box(scene, "atv_headlight_r", 0.22, 0.18, 0.1, root, matEmissive);
      rh.position.set(wid * 0.32, wheelR + hgt * 0.6, len * 0.62);
    }

    // Roll cage — only the rear posts and short rear rails so the front
    // forward view from the driver's seat stays unobstructed.
    if (style.hasRollCage) {
      const cageH = hgt * 1.6;
      const post3 = cyl(scene, "atv_cage_bl", cageH, 0.08, root, matAccent);
      post3.position.set(-wid * 0.42, wheelR + hgt + cageH / 2, -len * 0.32);
      const post4 = cyl(scene, "atv_cage_br", cageH, 0.08, root, matAccent);
      post4.position.set(wid * 0.42, wheelR + hgt + cageH / 2, -len * 0.32);
      const top1 = box(scene, "atv_cage_top_l", 0.08, 0.08, len * 0.25, root, matAccent);
      top1.position.set(-wid * 0.42, wheelR + hgt + cageH, -len * 0.20);
      const top2 = box(scene, "atv_cage_top_r", 0.08, 0.08, len * 0.25, root, matAccent);
      top2.position.set(wid * 0.42, wheelR + hgt + cageH, -len * 0.20);
      const cross = box(scene, "atv_cage_cross", wid * 0.92, 0.08, 0.08, root, matAccent);
      cross.position.set(0, wheelR + hgt + cageH, -len * 0.32);
    }

    // Wheels
    const wheels: BABYLON.Mesh[] = [];
    const wheelCount = style.wheelCount ?? 4;
    const wheelMat = matDark;
    const rimMat = matAccent;
    const wheelPositions: [number, number][] = wheelCount === 3
      ? [[0, len * 0.4], [-wid * 0.55, -len * 0.35], [wid * 0.55, -len * 0.35]]
      : [[-wid * 0.55, len * 0.36], [wid * 0.55, len * 0.36], [-wid * 0.55, -len * 0.36], [wid * 0.55, -len * 0.36]];
    for (let i = 0; i < wheelPositions.length; i++) {
      const [x, z] = wheelPositions[i];
      const tire = cyl(scene, `atv_tire_${i}`, wheelW, wheelR * 2, root, wheelMat, 14);
      tire.rotation.z = Math.PI / 2;
      tire.position.set(x, wheelR, z);
      wheels.push(tire);
      const rim = cyl(scene, `atv_rim_${i}`, wheelW * 0.5, wheelR * 1.0, root, rimMat, 10);
      rim.rotation.z = Math.PI / 2;
      rim.position.set(x, wheelR, z);

      if (style.hasFenders) {
        const fend = box(scene, `atv_fender_${i}`, wheelW + 0.15, wheelR * 0.8, wheelR * 1.8, root, matBody);
        fend.position.set(x, wheelR + wheelR * 0.7, z);
      }
    }

    // Exhaust pipes
    const thrusters: BABYLON.Mesh[] = [];
    if (style.hasExhaust) {
      const ex = cyl(scene, "atv_exhaust", 0.8, 0.18, root, matDark);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(wid * 0.2, wheelR + hgt * 0.4, -len * 0.5);
      const tip = cyl(scene, "atv_exhaust_tip", 0.15, 0.22, root, matEmissive);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(wid * 0.2, wheelR + hgt * 0.4, -len * 0.5 - 0.4);
      thrusters.push(tip);
    }

    return { root, hitbox, thrusters, wheels };
  }

  private buildSpaceFighter(root: BABYLON.TransformNode, style: VehicleStyle): VehicleMeshes {
    const scene = this.scene;
    const matBody = getMat(scene, style.primaryColor, style.emissiveColor, true);
    const matDark = getMat(scene, style.secondaryColor);
    const matAccent = getMat(scene, style.accentColor, style.accentColor, true);
    const matEmissive = getMat(scene, style.emissiveColor, style.emissiveColor);

    const len = style.bodyLength;
    const wid = style.bodyWidth;
    const hgt = style.bodyHeight;

    const hitbox = BABYLON.MeshBuilder.CreateBox("fighter_hitbox", { width: (style.wingSpan ?? wid) + 0.4, height: hgt + 0.4, depth: len + 0.4 }, scene);
    hitbox.parent = root;
    hitbox.position.y = 0;
    hitbox.isVisible = false;
    hitbox.checkCollisions = false;

    // Fuselage main
    const fuse = box(scene, "fighter_fuse", wid, hgt, len * 0.7, root, matBody);
    fuse.position.set(0, 0, 0);

    // Nose cone (taper via stacked boxes)
    const noseFront = box(scene, "fighter_nose1", wid * 0.8, hgt * 0.7, len * 0.16, root, matBody);
    noseFront.position.set(0, 0, len * 0.43);
    const noseTip = box(scene, "fighter_nose2", wid * 0.45, hgt * 0.45, len * 0.12, root, matAccent);
    noseTip.position.set(0, 0, len * 0.55);

    // Tail (taper rear)
    const tail = box(scene, "fighter_tail", wid * 0.8, hgt * 0.7, len * 0.18, root, matDark);
    tail.position.set(0, 0, -len * 0.43);

    // Cockpit
    const cockpitStyle = style.cockpitStyle ?? "wedge";
    if (cockpitStyle === "bubble") {
      const dome = BABYLON.MeshBuilder.CreateSphere("fighter_cockpit", { diameter: hgt * 1.4, segments: 8 }, scene);
      dome.scaling.y = 0.6;
      dome.parent = root;
      dome.material = matEmissive;
      dome.position.set(0, hgt * 0.55, len * 0.05);
    } else if (cockpitStyle === "wedge") {
      const cock = box(scene, "fighter_cockpit", wid * 0.7, hgt * 0.55, len * 0.3, root, matEmissive);
      cock.position.set(0, hgt * 0.55, len * 0.05);
      const front = box(scene, "fighter_cockpit_front", wid * 0.6, hgt * 0.4, len * 0.1, root, matEmissive);
      front.position.set(0, hgt * 0.45, len * 0.18);
    } else {
      const cock = box(scene, "fighter_cockpit", wid * 0.8, hgt * 0.4, len * 0.32, root, matEmissive);
      cock.position.set(0, hgt * 0.5, len * 0.05);
    }

    // Wings
    const wingSpan = style.wingSpan ?? 5.0;
    const wingChord = style.wingChord ?? 1.6;
    const wingTaper = style.wingTaper ?? 0.4;
    const wingArmLen = (wingSpan - wid) / 2;

    const wingL = box(scene, "fighter_wing_l", wingArmLen, hgt * 0.25, wingChord, root, matBody);
    wingL.position.set(-wid / 2 - wingArmLen / 2, -hgt * 0.05, -len * 0.05);
    const wingR = box(scene, "fighter_wing_r", wingArmLen, hgt * 0.25, wingChord, root, matBody);
    wingR.position.set(wid / 2 + wingArmLen / 2, -hgt * 0.05, -len * 0.05);

    // Wing tip taper plates
    const tipChord = wingChord * wingTaper;
    const tipL = box(scene, "fighter_tip_l", wingArmLen * 0.3, hgt * 0.22, tipChord, root, matAccent);
    tipL.position.set(-wid / 2 - wingArmLen * 0.85, -hgt * 0.05, -len * 0.05);
    const tipR = box(scene, "fighter_tip_r", wingArmLen * 0.3, hgt * 0.22, tipChord, root, matAccent);
    tipR.position.set(wid / 2 + wingArmLen * 0.85, -hgt * 0.05, -len * 0.05);

    // Wing tip fins
    const finH = style.wingTipFinHeight ?? 0.6;
    if (finH > 0) {
      const finL = box(scene, "fighter_finwing_l", 0.15, finH, tipChord * 0.9, root, matBody);
      finL.position.set(-wid / 2 - wingArmLen * 0.95, finH / 2, -len * 0.05);
      const finR = box(scene, "fighter_finwing_r", 0.15, finH, tipChord * 0.9, root, matBody);
      finR.position.set(wid / 2 + wingArmLen * 0.95, finH / 2, -len * 0.05);
    }

    // Tail fin (vertical stabilizer)
    const tfH = style.tailFinHeight ?? 1.0;
    const tailFin = box(scene, "fighter_tailfin", 0.18, tfH, len * 0.25, root, matBody);
    tailFin.position.set(0, hgt * 0.4 + tfH / 2, -len * 0.36);
    const tailFinAccent = box(scene, "fighter_tailfin_accent", 0.2, tfH * 0.3, len * 0.08, root, matAccent);
    tailFinAccent.position.set(0, hgt * 0.4 + tfH * 0.85, -len * 0.45);

    // Forward cannons
    const cannonCount = style.cannonCount ?? 2;
    for (let i = 0; i < cannonCount; i++) {
      const xSpread = ((i % 2) === 0 ? -1 : 1) * (wingSpan * 0.18 + Math.floor(i / 2) * 0.4);
      const can = cyl(scene, `fighter_cannon_${i}`, len * 0.45, 0.16, root, matDark, 10);
      can.rotation.x = Math.PI / 2;
      can.position.set(xSpread, -hgt * 0.15, len * 0.25);
      const tip = cyl(scene, `fighter_cannon_tip_${i}`, 0.1, 0.2, root, matEmissive, 10);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(xSpread, -hgt * 0.15, len * 0.48);
    }

    // Thrusters
    const thrusters: BABYLON.Mesh[] = [];
    const thrusterCount = style.thrusterCount ?? 2;
    for (let i = 0; i < thrusterCount; i++) {
      const xOff = thrusterCount === 1 ? 0 : (i === 0 ? -wid * 0.32 : wid * 0.32);
      const housing = cyl(scene, `fighter_thrust_${i}`, len * 0.18, hgt * 0.7, root, matDark, 10);
      housing.rotation.x = Math.PI / 2;
      housing.position.set(xOff, 0, -len * 0.5);
      const glow = cyl(scene, `fighter_thrust_glow_${i}`, 0.18, hgt * 0.55, root, matEmissive, 10);
      glow.rotation.x = Math.PI / 2;
      glow.position.set(xOff, 0, -len * 0.6);
      thrusters.push(glow);
    }

    // Landing skids (only show on ground)
    if (style.hasLandingSkids) {
      const skidL = box(scene, "fighter_skid_l", 0.15, 0.4, len * 0.5, root, matDark);
      skidL.position.set(-wid * 0.4, -hgt * 0.6, 0);
      const skidR = box(scene, "fighter_skid_r", 0.15, 0.4, len * 0.5, root, matDark);
      skidR.position.set(wid * 0.4, -hgt * 0.6, 0);
      const skidF = box(scene, "fighter_skid_f", 0.3, 0.4, 0.3, root, matDark);
      skidF.position.set(0, -hgt * 0.6, len * 0.3);
    }

    return { root, hitbox, thrusters, wheels: [] };
  }
}
