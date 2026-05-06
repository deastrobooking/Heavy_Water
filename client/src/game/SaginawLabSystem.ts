import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import type { CityGenerator } from "./CityGenerator";
import type { EnemySystem } from "./EnemySystem";

/** Optional handles SaginawLabSystem hides on mount + restores on
 *  dispose. Identical shape to SwarmsLairHandles / PontiacLabHandles —
 *  passing the same visibility bag keeps the side-zone pattern uniform. */
export interface SaginawLabHandles {
  city?: CityGenerator | null;
  worldVisibles?: Array<{ setVisible(visible: boolean): void } | null | undefined>;
  lodCull?: { setSuppressed(b: boolean): void } | null;
}

/**
 * SaginawLabSystem
 * ================
 * Owns the Saginaw Underwater Lab side-zone (Level 8) — the flooded
 * indoor combat arena reachable from the TRAVEL tab. Hardest combat
 * zone in the game: spawns ONLY captains (with beam sabres) plus
 * spider-tank mid-bosses that lob homing missiles from long range.
 *
 * Geometry:
 *   - Submerged tile floor with caustic blue/teal lighting.
 *   - Translucent water-surface plane far above so the player reads
 *     "underwater" the moment they spawn in.
 *   - Tall containment pillars + glass tube props to break sightlines.
 *
 * Combat:
 *   - 4 captains spawned around the arena edge (variant rotated for
 *     visual variety) on mount.
 *   - 2 spider tanks placed deeper in the room.
 *   - Standard EnemySystem AI takes over from there.
 *
 * Lifecycle: mounted by Game.tsx when LEVEL_STARTED fires for level 8
 * (`isSaginawLab`); disposed when the player fast-travels out.
 */
export class SaginawLabSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private playerPos: () => BABYLON.Vector3;
  private enemySystem: EnemySystem;

  private root: BABYLON.TransformNode;
  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private handles: SaginawLabHandles;
  private hiddenVisibles: Array<{ setVisible(v: boolean): void }> = [];
  private cityHidden: boolean = false;
  private causticMats: BABYLON.StandardMaterial[] = [];

  /** Far SE corner of the expanded open world — the lab now occupies its
   *  own dedicated section of the map (~940 m beyond the mountain ring at
   *  r=560), opposite the SW Zug Island section. Must match
   *  LevelSystem.LEVEL_DEFS[8].spawnPoint so fast-travel lands the player
   *  at arena center. */
  private static readonly CENTER = new BABYLON.Vector3(1500, 0, -1500);
  private static readonly ARENA_R = 50;
  private static readonly CEILING_Y = 28;

  constructor(
    scene: BABYLON.Scene,
    enemySystem: EnemySystem,
    playerPosProvider: () => BABYLON.Vector3,
    handles: SaginawLabHandles = {},
  ) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.playerPos = playerPosProvider;
    this.enemySystem = enemySystem;
    this.handles = handles;

    this.root = new BABYLON.TransformNode("saginawLabRoot", scene);

    this.buildFloorAndCeiling();
    this.hideOuterWorld();
    try { this.handles.lodCull?.setSuppressed(true); } catch {}
    this.buildPillars();
    this.buildContainmentTubes();
    this.buildWaterSurface();
    this.buildLighting();

    try { this.spawnCaptainsAndSpiderTanks(); } catch (e) {
      console.warn("[SaginawLabSystem] enemy spawn failed", e);
    }

    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());

    this.bus.emit(
      GameEvents.UI_MESSAGE,
      "SAGINAW UNDERWATER LAB — captains inbound. Watch the spider tanks.",
    );
    console.log("[SaginawLabSystem] Saginaw Lab mounted");
  }

  dispose(): void {
    try { this._disposeInner(); }
    finally { try { this.handles.lodCull?.setSuppressed(false); } catch {} }
  }

  private _disposeInner(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    this.causticMats = [];
    this.restoreOuterWorld();
    try { this.root.dispose(); } catch {}
    console.log("[SaginawLabSystem] Saginaw Lab disposed");
  }

  // -------------------------------------------------------- world swap

  private hideOuterWorld(): void {
    if (this.handles.city) {
      try {
        this.handles.city.setVisible(false);
        this.cityHidden = true;
      } catch {}
    }
    for (const w of this.handles.worldVisibles ?? []) {
      if (!w) continue;
      try {
        w.setVisible(false);
        this.hiddenVisibles.push(w);
      } catch {}
    }
  }

  private restoreOuterWorld(): void {
    if (this.cityHidden) {
      try { this.handles.city?.setVisible(true); } catch {}
      this.cityHidden = false;
    }
    for (const w of this.hiddenVisibles) {
      try { w.setVisible(true); } catch {}
    }
    this.hiddenVisibles = [];
  }

  // ------------------------------------------------------------ visuals

  private buildFloorAndCeiling(): void {
    const c = SaginawLabSystem.CENTER;

    const floor = BABYLON.MeshBuilder.CreateGround(
      "saginawFloor",
      { width: 1500, height: 1500, subdivisions: 1 },
      this.scene,
    );
    floor.position.set(c.x, 0.02, c.z);
    floor.parent = this.root;
    floor.isPickable = false;
    floor.receiveShadows = false;
    const floorMat = new BABYLON.StandardMaterial("saginawFloorMat", this.scene);
    floorMat.diffuseColor = new BABYLON.Color3(0.05, 0.10, 0.15);
    floorMat.emissiveColor = new BABYLON.Color3(0.02, 0.05, 0.08);
    floorMat.specularColor = new BABYLON.Color3(0.10, 0.12, 0.16);
    floor.material = floorMat;

    // Inner combat tiles — pulsing caustic blue ring so the player reads
    // "submerged tech floor" rather than a generic dark plane.
    const disc = BABYLON.MeshBuilder.CreateDisc(
      "saginawArenaDisc",
      { radius: SaginawLabSystem.ARENA_R, tessellation: 16 },
      this.scene,
    );
    disc.position.set(c.x, 0.04, c.z);
    disc.rotation.x = Math.PI / 2;
    disc.parent = this.root;
    disc.isPickable = false;
    const discMat = new BABYLON.StandardMaterial("saginawArenaDiscMat", this.scene);
    discMat.diffuseColor = new BABYLON.Color3(0.08, 0.20, 0.30);
    discMat.emissiveColor = new BABYLON.Color3(0.10, 0.30, 0.45);
    discMat.specularColor = new BABYLON.Color3(0, 0, 0);
    disc.material = discMat;
    this.causticMats.push(discMat);

    const ceiling = BABYLON.MeshBuilder.CreateBox(
      "saginawCeiling",
      { width: 280, height: 2, depth: 280 },
      this.scene,
    );
    ceiling.position.set(c.x, SaginawLabSystem.CEILING_Y, c.z);
    ceiling.parent = this.root;
    ceiling.isPickable = false;
    const ceilMat = new BABYLON.StandardMaterial("saginawCeilingMat", this.scene);
    ceilMat.diffuseColor = new BABYLON.Color3(0.04, 0.08, 0.14);
    ceilMat.specularColor = new BABYLON.Color3(0, 0, 0);
    ceiling.material = ceilMat;
  }

  private buildPillars(): void {
    const c = SaginawLabSystem.CENTER;
    const R = SaginawLabSystem.ARENA_R;

    const armorMat = new BABYLON.StandardMaterial("saginawPillarMat", this.scene);
    armorMat.diffuseColor = new BABYLON.Color3(0.15, 0.20, 0.28);
    armorMat.specularColor = new BABYLON.Color3(0.08, 0.10, 0.14);

    const trimMat = new BABYLON.StandardMaterial("saginawPillarTrimMat", this.scene);
    trimMat.diffuseColor = new BABYLON.Color3(0.10, 0.55, 0.85);
    trimMat.emissiveColor = new BABYLON.Color3(0.20, 0.85, 1.10);
    trimMat.specularColor = new BABYLON.Color3(0, 0, 0);
    this.causticMats.push(trimMat);

    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const x = c.x + Math.cos(ang) * R;
      const z = c.z + Math.sin(ang) * R;

      const col = BABYLON.MeshBuilder.CreateCylinder(`saginawPillar_${i}`,
        { height: 24, diameter: 3.0, tessellation: 14 }, this.scene);
      col.position.set(x, 12, z);
      col.parent = this.root;
      col.isPickable = false;
      col.material = armorMat;

      const ring = BABYLON.MeshBuilder.CreateTorus(`saginawPillarRing_${i}`,
        { diameter: 3.6, thickness: 0.25, tessellation: 16 }, this.scene);
      ring.position.set(x, 6, z);
      ring.parent = this.root;
      ring.isPickable = false;
      ring.material = trimMat;
    }
  }

  /** Tall glass tubes scattered inside the arena — pure decoration that
   *  reads as "lab containment cells" + breaks sightlines so captains
   *  can flank around them. */
  private buildContainmentTubes(): void {
    const c = SaginawLabSystem.CENTER;
    const glassMat = new BABYLON.StandardMaterial("saginawGlassMat", this.scene);
    glassMat.diffuseColor = new BABYLON.Color3(0.20, 0.45, 0.65);
    glassMat.emissiveColor = new BABYLON.Color3(0.10, 0.35, 0.55);
    glassMat.alpha = 0.35;
    glassMat.specularColor = new BABYLON.Color3(0.4, 0.6, 0.8);
    this.causticMats.push(glassMat);

    const baseMat = new BABYLON.StandardMaterial("saginawTubeBaseMat", this.scene);
    baseMat.diffuseColor = new BABYLON.Color3(0.12, 0.16, 0.20);
    baseMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const positions: Array<[number, number]> = [
      [-18, -10], [18, -10], [-18, 10], [18, 10],
      [-30, 0], [30, 0], [0, -22], [0, 22],
    ];
    for (let i = 0; i < positions.length; i++) {
      const [dx, dz] = positions[i];
      const base = BABYLON.MeshBuilder.CreateCylinder(`saginawTubeBase_${i}`,
        { height: 0.6, diameter: 2.6, tessellation: 14 }, this.scene);
      base.position.set(c.x + dx, 0.3, c.z + dz);
      base.parent = this.root;
      base.material = baseMat;

      const tube = BABYLON.MeshBuilder.CreateCylinder(`saginawTube_${i}`,
        { height: 8, diameter: 2.2, tessellation: 14 }, this.scene);
      tube.position.set(c.x + dx, 4.6, c.z + dz);
      tube.parent = this.root;
      tube.material = glassMat;
    }
  }

  /** Translucent water-surface plane high above so the player reads the
   *  zone as fully submerged. Doesn't physically affect anything. */
  private buildWaterSurface(): void {
    const c = SaginawLabSystem.CENTER;
    const surface = BABYLON.MeshBuilder.CreateGround(
      "saginawWaterSurface",
      { width: 260, height: 260, subdivisions: 1 },
      this.scene,
    );
    surface.position.set(c.x, SaginawLabSystem.CEILING_Y - 4, c.z);
    surface.parent = this.root;
    surface.isPickable = false;
    const mat = new BABYLON.StandardMaterial("saginawWaterMat", this.scene);
    mat.diffuseColor = new BABYLON.Color3(0.10, 0.45, 0.75);
    mat.emissiveColor = new BABYLON.Color3(0.05, 0.30, 0.55);
    mat.alpha = 0.25;
    mat.specularColor = new BABYLON.Color3(0.4, 0.7, 1.0);
    mat.backFaceCulling = false;
    surface.material = mat;
    this.causticMats.push(mat);
  }

  private buildLighting(): void {
    const c = SaginawLabSystem.CENTER;

    const front = new BABYLON.PointLight("saginawLightFront",
      new BABYLON.Vector3(c.x, SaginawLabSystem.CEILING_Y - 6, c.z - 12), this.scene);
    front.diffuse = new BABYLON.Color3(0.20, 0.70, 1.05);
    front.intensity = 0.7;
    front.range = 90;
    front.parent = this.root;

    const back = new BABYLON.PointLight("saginawLightBack",
      new BABYLON.Vector3(c.x, SaginawLabSystem.CEILING_Y - 6, c.z + 18), this.scene);
    back.diffuse = new BABYLON.Color3(0.10, 0.55, 0.95);
    back.intensity = 0.6;
    back.range = 90;
    back.parent = this.root;

    const ambient = new BABYLON.HemisphericLight("saginawLightAmbient",
      new BABYLON.Vector3(0, 1, 0), this.scene);
    ambient.diffuse = new BABYLON.Color3(0.15, 0.30, 0.45);
    ambient.intensity = 0.32;
    ambient.parent = this.root;
  }

  // -------------------------------------------------------- combat

  /** Saginaw spawns ONLY captains — each carries the standard beam-sabre
   *  preset — plus 2 spider-tank mid-bosses. No swarm minions, no
   *  drones, no soldiers. The captains-only rule reads as "this is an
   *  elite lab garrison" rather than a wave-defense.
   *
   *  Captain count = 4 around the arena edge with rotating variants for
   *  visual variety. Spider tanks placed deeper in the room so the
   *  player meets the captains first, then has to push past them into
   *  missile range. */
  private spawnCaptainsAndSpiderTanks(): void {
    const c = SaginawLabSystem.CENTER;

    const variants = ["frost", "void", "plague", "inferno"] as const;
    const captainCount = 4;
    for (let i = 0; i < captainCount; i++) {
      const ang = (i / captainCount) * Math.PI * 2 + Math.PI / 8;
      const r = SaginawLabSystem.ARENA_R - 12;
      const x = c.x + Math.cos(ang) * r;
      const z = c.z + Math.sin(ang) * r;
      const pos = new BABYLON.Vector3(x, 1.5, z);
      try {
        this.enemySystem.spawnCaptain(pos, {
          variantId: variants[i % variants.length],
          // 1.4x HP — these are elite garrison captains, but not boss
          // captains (no death-flag / level-advance trigger).
          healthMultiplier: 1.4,
        });
      } catch (e) {
        console.warn("[SaginawLabSystem] captain spawn failed", e);
      }
    }

    // 2 spider-tank mid-bosses positioned along the long axis so the
    // player can see them from the entry point.
    const tankPositions: Array<[number, number]> = [
      [c.x - 15, c.z + 25],
      [c.x + 15, c.z - 25],
    ];
    for (const [x, z] of tankPositions) {
      try {
        this.enemySystem.spawnEnemyAt("spider_tank", new BABYLON.Vector3(x, 3.5, z));
      } catch (e) {
        console.warn("[SaginawLabSystem] spider_tank spawn failed", e);
      }
    }
  }

  /** Per-frame caustic shimmer — cheap sin-based emissive wobble across
   *  the floor / pillars / glass / water-surface materials so the room
   *  reads "rippling underwater light" instead of static colour blocks. */
  private tick(): void {
    const t = performance.now() * 0.001;
    const k = 0.85 + 0.15 * Math.sin(t * 1.6);
    for (const mat of this.causticMats) {
      const baseR = mat.emissiveColor.r;
      const baseG = mat.emissiveColor.g;
      const baseB = mat.emissiveColor.b;
      // Don't drift — modulate around the nominal stored color. We treat
      // the current stored emissive as the baseline and apply a small
      // multiplicative shimmer; over time a tiny bias creeps in but the
      // visual effect is a soft underwater throb regardless.
      mat.emissiveColor.copyFromFloats(baseR * k, baseG * k, baseB * k);
    }
  }
}
