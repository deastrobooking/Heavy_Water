import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";
import { BioCreatureSystem } from "./BioCreatureSystem";
import { BIO_SPECIES, getSpeciesById, BioCreatureSpecies } from "./BioSpecies";
import type { WorldLevel } from "./LevelSystem";

/**
 * Hidden temple loot bundle granted on first interaction. Mix is chosen so
 * the player gets a noticeable late-game payoff: tier-2 components, a
 * weapon part, a one-shot consumable, and an XP chip. Quantities scale
 * with world level inside the system itself.
 */
const TEMPLE_LOOT_BASE = [
  { itemId: "energy_core", amount: 2 },
  { itemId: "circuit_board", amount: 2 },
  { itemId: "nano_fiber", amount: 2 },
  { itemId: "weapon_part_rocket", amount: 2 },
  { itemId: "weapon_part_laser", amount: 2 },
  { itemId: "shield_booster", amount: 1 },
  { itemId: "damage_amp", amount: 1 },
  { itemId: "xp_chip", amount: 4 },
] as const;

interface TempleDef {
  /** Stable id, scoped per-level (e.g. "L1_temple_n"). Used as the
   *  persistence key so each level's temples have an independent looted
   *  state — re-entering an earlier level replays its loot. */
  id: string;
  /** World position of the temple footprint center. */
  position: BABYLON.Vector3;
  /** Direction the temple's portal door faces (unit vector). */
  facing: BABYLON.Vector3;
  /** Locked species id this temple is guarding. Picked from the rarest
   *  tiers so each temple grants a guaranteed dex-worthy mascot. */
  guardianId: string;
}

interface ActiveTemple {
  def: TempleDef;
  root: BABYLON.TransformNode;
  /** The glowing portal disc — fades to dim grey once looted. */
  portal: BABYLON.Mesh;
  portalMat: BABYLON.StandardMaterial;
  /** Floating glow billboard above the portal (visual cue). */
  beacon: BABYLON.Mesh;
  beaconMat: BABYLON.StandardMaterial;
  looted: boolean;
}

/**
 * Builds a ring of mountains around the world and seeds four hidden
 * temples inside that ring. Each temple grants a one-time loot drop
 * (rare items + a guaranteed legendary/epic creature) and remembers
 * its looted state per world-level so re-entering an earlier level
 * replays that level's temple bounty.
 *
 * Layout (per level):
 *   - 28 conical mountains on a ring at ~560 m radius (jittered).
 *   - 4 stepped-pyramid temples at the four diagonals, radius 480 m.
 *
 * Re-themed on LEVEL_STARTED: mountain tint matches the sky tint, the
 * temple portals re-enable for any temple this level hasn't yet looted,
 * and the active temple definitions swap to the new level's id-space.
 */
export class MountainRingSystem {
  private scene: BABYLON.Scene;
  private bus: EventBus;
  private inventory: InventorySystem;
  private bioSystem: BioCreatureSystem;
  /** Where the player is right now — set by Game.tsx every tick. */
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();

  /** Mountains are reused across levels; only their material tint swaps. */
  private mountainRoot: BABYLON.TransformNode;
  private mountainMat: BABYLON.StandardMaterial;

  /** Temples are torn down + rebuilt per level (so the looted state and
   *  per-level guardian assignment stay clean). */
  private templeRoot: BABYLON.TransformNode;
  private temples: ActiveTemple[] = [];

  /** Persistent set of looted temple ids, scoped by level via the id
   *  prefix ("L1_temple_n", "L2_temple_e", ...). */
  private lootedTempleIds: Set<string> = new Set();

  /** HTML "PRESS E" prompt; shared across all temples. */
  private promptEl: HTMLDivElement;
  private promptVisible: boolean = false;

  /** Currently focused temple (closest within range) — drives the prompt
   *  and is what gets looted on E. */
  private focused: ActiveTemple | null = null;

  /** Active world level — determines temple id prefix + loot scaling. */
  private currentLevel: WorldLevel = 1;

  /** External providers so the prompt + key-handler don't fight other
   *  modal owners (shops, dialogue bubbles, build menu, etc.). */
  private inputBlockedProvider: () => boolean = () => false;

  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private keydownHandler: (e: KeyboardEvent) => void;
  private levelStartedHandler: (data: any) => void;

  /** Trigger radius for the prompt + interaction. */
  private static readonly INTERACT_RADIUS = 5;
  /** Ring geometry. */
  private static readonly RING_RADIUS = 560;
  private static readonly TEMPLE_RADIUS = 480;
  private static readonly MOUNTAIN_COUNT = 28;
  /** Four off-diagonal angles. We deliberately avoid the exact 45/135/225/315
   *  diagonals because Level 2's fortress sits near (-360,-360) — putting a
   *  temple at radius 480 on the SW diagonal would overlap that lane. The
   *  30° offset here keeps every temple > 100m from any L1/L2/L3 fortress
   *  center (L1≈(380,-120), L2≈(-360,-360), L3≈(-120,420)). */
  private static readonly TEMPLE_ANGLES_DEG = [30, 120, 210, 300];
  private static readonly TEMPLE_KEYS = ["temple_e", "temple_n", "temple_w", "temple_s"];

  constructor(scene: BABYLON.Scene, inventory: InventorySystem, bioSystem: BioCreatureSystem) {
    this.scene = scene;
    this.bus = EventBus.getInstance();
    this.inventory = inventory;
    this.bioSystem = bioSystem;

    this.mountainRoot = new BABYLON.TransformNode("mountainRingRoot", scene);
    this.templeRoot = new BABYLON.TransformNode("templeRoot", scene);

    this.mountainMat = new BABYLON.StandardMaterial("mountainMat", scene);
    this.mountainMat.diffuseColor = new BABYLON.Color3(0.42, 0.4, 0.45);
    this.mountainMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    this.mountainMat.emissiveColor = new BABYLON.Color3(0.04, 0.04, 0.05);

    this.buildMountainRing();
    this.buildTemplesForLevel(1);

    // HTML interaction prompt — same look as FriendlyNPCSystem so it's
    // visually consistent with the rest of the world hints.
    this.promptEl = document.createElement("div");
    Object.assign(this.promptEl.style, {
      position: "absolute",
      pointerEvents: "none",
      padding: "6px 14px",
      background: "rgba(20, 12, 28, 0.92)",
      border: "2px solid #ffcc55",
      borderRadius: "6px",
      color: "#ffe9a8",
      fontFamily: '"Press Start 2P", monospace',
      fontSize: "10px",
      letterSpacing: "1px",
      textShadow: "0 0 6px rgba(255, 200, 80, 0.7)",
      zIndex: "1500",
      display: "none",
      transform: "translate(-50%, -100%)",
      whiteSpace: "nowrap",
    } as CSSStyleDeclaration);
    document.body.appendChild(this.promptEl);

    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.code !== "KeyE") return;
      if (this.inputBlockedProvider()) return;
      if (!this.focused || this.focused.looted) return;
      this.lootTemple(this.focused);
    };
    window.addEventListener("keydown", this.keydownHandler);

    // Re-theme on level change. The Level 1 build above seeded the L1
    // temples; LEVEL_STARTED for L2/L3 swaps both visuals and id-space.
    this.levelStartedHandler = (data: any) => {
      const lvl = (data?.level ?? 1) as WorldLevel;
      this.currentLevel = lvl;
      const tint = data?.skyTint as { r: number; g: number; b: number } | undefined;
      this.applyLevelTheme(tint);
      this.buildTemplesForLevel(lvl);
    };
    this.bus.on(GameEvents.LEVEL_STARTED, this.levelStartedHandler);

    console.log("[MountainRingSystem] Initialized — ring + temples placed");
  }

  setPlayerPosition(pos: BABYLON.Vector3): void {
    this.playerPos.copyFrom(pos);
  }

  setInputBlockedProvider(fn: () => boolean): void {
    this.inputBlockedProvider = fn;
  }

  // ------------------------------------------------------------------ build

  /** Generate the static mountain ring once. We keep the meshes alive
   *  across levels and just tint the shared material on level change —
   *  cheaper than rebuilding 28 cones every time. Each "mountain" is a
   *  cluster of three stacked cones for a chunky, hand-painted look that
   *  matches the cell-shaded aesthetic. */
  private buildMountainRing(): void {
    const r = MountainRingSystem.RING_RADIUS;
    for (let i = 0; i < MountainRingSystem.MOUNTAIN_COUNT; i++) {
      const baseAngle = (i / MountainRingSystem.MOUNTAIN_COUNT) * Math.PI * 2;
      // Deterministic jitter so layout is stable across reloads.
      const seed = i * 7919;
      const jr = ((Math.sin(seed) + 1) * 0.5 - 0.5) * 60;
      const ja = ((Math.cos(seed * 1.3) + 1) * 0.5 - 0.5) * 0.07;
      const angle = baseAngle + ja;
      const radius = r + jr;
      const cx = Math.cos(angle) * radius;
      const cz = Math.sin(angle) * radius;

      // Heights vary so the silhouette reads as a real mountain range.
      const baseH = 60 + ((Math.sin(seed * 2.7) + 1) * 0.5) * 40;
      const baseW = 70 + ((Math.cos(seed * 4.1) + 1) * 0.5) * 30;

      const main = BABYLON.MeshBuilder.CreateCylinder(
        `mountain_main_${i}`,
        { diameterTop: 4, diameterBottom: baseW, height: baseH, tessellation: 7 },
        this.scene,
      );
      main.position = new BABYLON.Vector3(cx, baseH / 2, cz);
      main.material = this.mountainMat;
      main.parent = this.mountainRoot;
      main.checkCollisions = false;

      // Side ridges to break up the silhouette.
      for (let k = 0; k < 2; k++) {
        const off = (k === 0 ? -1 : 1) * (baseW * 0.35 + ((Math.sin(seed + k) + 1) * 0.5) * 8);
        const oa = angle + Math.PI / 2;
        const sx = cx + Math.cos(oa) * off;
        const sz = cz + Math.sin(oa) * off;
        const sh = baseH * (0.55 + ((Math.cos(seed + k * 13) + 1) * 0.5) * 0.25);
        const sw = baseW * (0.55 + ((Math.sin(seed + k * 17) + 1) * 0.5) * 0.2);
        const ridge = BABYLON.MeshBuilder.CreateCylinder(
          `mountain_ridge_${i}_${k}`,
          { diameterTop: 3, diameterBottom: sw, height: sh, tessellation: 6 },
          this.scene,
        );
        ridge.position = new BABYLON.Vector3(sx, sh / 2, sz);
        ridge.material = this.mountainMat;
        ridge.parent = this.mountainRoot;
        ridge.checkCollisions = false;
      }

      // Snow cap — a small bright cone on top of the main peak so the
      // ring reads as a "mountain ring" from the city below.
      const cap = BABYLON.MeshBuilder.CreateCylinder(
        `mountain_cap_${i}`,
        { diameterTop: 0, diameterBottom: 14, height: 12, tessellation: 7 },
        this.scene,
      );
      const capMat = new BABYLON.StandardMaterial(`mountain_cap_mat_${i}`, this.scene);
      capMat.diffuseColor = new BABYLON.Color3(0.92, 0.95, 1.0);
      capMat.emissiveColor = new BABYLON.Color3(0.3, 0.34, 0.4);
      capMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
      cap.material = capMat;
      cap.position = new BABYLON.Vector3(cx, baseH + 6, cz);
      cap.parent = this.mountainRoot;
      cap.checkCollisions = false;
    }
  }

  /** Tear down any prior temples and place a fresh set for the given
   *  world level. Temples for the same level share the same id-space, so
   *  reloading a save into the same level reuses the same lootedTempleIds
   *  flags. */
  private buildTemplesForLevel(level: WorldLevel): void {
    // Clean up prior temples (mountains are kept).
    for (const t of this.temples) {
      t.root.dispose(false, true);
    }
    this.temples = [];

    const guardians = this.pickGuardiansForLevel(level);
    const angles = MountainRingSystem.TEMPLE_ANGLES_DEG;
    const keys = MountainRingSystem.TEMPLE_KEYS;
    for (let i = 0; i < angles.length; i++) {
      const ang = (angles[i] * Math.PI) / 180;
      const x = Math.cos(ang) * MountainRingSystem.TEMPLE_RADIUS;
      const z = Math.sin(ang) * MountainRingSystem.TEMPLE_RADIUS;
      // Face inward toward the city so the player approaches the door.
      const facing = new BABYLON.Vector3(-Math.cos(ang), 0, -Math.sin(ang));
      const id = `L${level}_${keys[i]}`;
      const def: TempleDef = {
        id,
        position: new BABYLON.Vector3(x, 0, z),
        facing,
        guardianId: guardians[i % guardians.length].id,
      };
      const active = this.buildTempleMesh(def);
      // If this temple was already looted in a prior session, dim it.
      if (this.lootedTempleIds.has(id)) this.markLootedVisuals(active);
      this.temples.push(active);
    }
  }

  /** Choose four high-rarity guardians for this level. Higher levels get
   *  rarer pools so L3 temples reward legendary creatures. Always returns
   *  at least one valid species (fallback to BIO_SPECIES[0]). */
  private pickGuardiansForLevel(level: WorldLevel): BioCreatureSpecies[] {
    const rareOrLegendary = BIO_SPECIES.filter(s => s.rarity === "rare" || s.rarity === "legendary");
    const legendaryOnly = BIO_SPECIES.filter(s => s.rarity === "legendary");
    const pool = level >= 3 && legendaryOnly.length >= 4
      ? legendaryOnly
      : rareOrLegendary.length > 0 ? rareOrLegendary : BIO_SPECIES;

    // Deterministic per-level pick so each temple's guardian id is stable
    // across reloads (drives the "press E to claim X" preview later if
    // we want to surface it in the prompt).
    const out: BioCreatureSpecies[] = [];
    const seed = level * 1009;
    for (let i = 0; i < 4; i++) {
      const idx = (seed + i * 269) % pool.length;
      out.push(pool[idx]);
    }
    return out;
  }

  /** Build a single temple's meshes, parented under templeRoot. */
  private buildTempleMesh(def: TempleDef): ActiveTemple {
    const root = new BABYLON.TransformNode(`temple_${def.id}`, this.scene);
    root.parent = this.templeRoot;
    root.position = def.position.clone();

    const stoneMat = new BABYLON.StandardMaterial(`templeStone_${def.id}`, this.scene);
    stoneMat.diffuseColor = new BABYLON.Color3(0.55, 0.5, 0.42);
    stoneMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    stoneMat.emissiveColor = new BABYLON.Color3(0.05, 0.04, 0.03);

    // Three-tier stepped pyramid. Heights/widths chosen so the tower is
    // visible from a long distance but doesn't overshadow the mountains
    // behind it.
    const tiers = [
      { w: 30, d: 30, h: 6 },
      { w: 22, d: 22, h: 5 },
      { w: 14, d: 14, h: 4 },
    ];
    let y = 0;
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const tier = BABYLON.MeshBuilder.CreateBox(
        `temple_tier_${def.id}_${i}`,
        { width: t.w, height: t.h, depth: t.d },
        this.scene,
      );
      tier.material = stoneMat;
      tier.position = new BABYLON.Vector3(0, y + t.h / 2, 0);
      tier.parent = root;
      y += t.h;
    }
    // Capstone — a small obelisk so the silhouette reads as a temple.
    const cap = BABYLON.MeshBuilder.CreateCylinder(
      `temple_cap_${def.id}`,
      { diameterTop: 0, diameterBottom: 5, height: 7, tessellation: 4 },
      this.scene,
    );
    cap.material = stoneMat;
    cap.position = new BABYLON.Vector3(0, y + 3.5, 0);
    cap.parent = root;

    // Glowing portal door on the inward face. We rotate the disc to lay
    // flush against the front of the bottom tier.
    const portalMat = new BABYLON.StandardMaterial(`templePortal_${def.id}`, this.scene);
    portalMat.diffuseColor = new BABYLON.Color3(0.15, 0.05, 0.0);
    portalMat.emissiveColor = new BABYLON.Color3(1.0, 0.55, 0.15);
    portalMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const portal = BABYLON.MeshBuilder.CreateDisc(
      `temple_portal_${def.id}`,
      { radius: 2.2, tessellation: 24 },
      this.scene,
    );
    portal.material = portalMat;
    // Stand it upright on the front face (radius=15 from center, just in
    // front of the bottom tier so it's visible without z-fighting).
    portal.rotation.x = Math.PI / 2;
    portal.position = def.facing.scale(15.05).add(new BABYLON.Vector3(0, 3, 0));
    // Face the disc back toward the city (away from the temple body).
    const yaw = Math.atan2(def.facing.x, def.facing.z);
    portal.rotation.y = yaw;
    portal.parent = root;

    // Floating beacon above the temple (always visible from far) so the
    // player can find them without a map marker.
    const beaconMat = new BABYLON.StandardMaterial(`templeBeacon_${def.id}`, this.scene);
    beaconMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    beaconMat.emissiveColor = new BABYLON.Color3(1.0, 0.8, 0.3);
    beaconMat.specularColor = new BABYLON.Color3(0, 0, 0);
    const beacon = BABYLON.MeshBuilder.CreateSphere(
      `temple_beacon_${def.id}`,
      { diameter: 3.5, segments: 12 },
      this.scene,
    );
    beacon.material = beaconMat;
    beacon.position = new BABYLON.Vector3(0, y + 14, 0);
    beacon.parent = root;

    return {
      def,
      root,
      portal,
      portalMat,
      beacon,
      beaconMat,
      looted: this.lootedTempleIds.has(def.id),
    };
  }

  /** Visually "extinguish" a looted temple — kills the portal glow and
   *  drops the beacon to a dim grey. Used both immediately after looting
   *  and on rebuild for a temple that's already in lootedTempleIds. */
  private markLootedVisuals(t: ActiveTemple): void {
    t.portalMat.emissiveColor = new BABYLON.Color3(0.08, 0.07, 0.06);
    t.portalMat.diffuseColor = new BABYLON.Color3(0.1, 0.09, 0.08);
    t.beaconMat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    t.looted = true;
  }

  /** Tint the mountain ring to match the level's sky. Soft blend so the
   *  ring still reads as rock at any time of day. */
  private applyLevelTheme(tint: { r: number; g: number; b: number } | undefined): void {
    const t = tint ?? { r: 1, g: 1, b: 1 };
    // Base grey blended toward the sky tint.
    const r = 0.42 * t.r;
    const g = 0.4 * t.g;
    const b = 0.45 * t.b;
    this.mountainMat.diffuseColor = new BABYLON.Color3(
      Math.min(0.85, r),
      Math.min(0.85, g),
      Math.min(0.85, b),
    );
  }

  // -------------------------------------------------------------- gameplay

  /** Per-frame: pick the closest unlooted temple within range, and
   *  position the HTML prompt above its portal. Bobs the beacons. */
  private tick(): void {
    const dt = this.scene.getEngine().getDeltaTime() / 1000;
    // Beacon bob.
    const tNow = performance.now() * 0.001;
    for (const t of this.temples) {
      if (!t.looted) {
        t.beacon.scaling.setAll(1 + Math.sin(tNow * 2 + t.def.position.x * 0.01) * 0.08);
      }
    }

    // Find closest unlooted temple within INTERACT_RADIUS.
    let nearest: ActiveTemple | null = null;
    let nearestD = Infinity;
    for (const t of this.temples) {
      if (t.looted) continue;
      const dx = t.def.position.x - this.playerPos.x;
      const dz = t.def.position.z - this.playerPos.z;
      // Use the door position — temples are big, so prompt should appear
      // when the player is at the entrance, not on top of the spire.
      const door = t.def.position.add(t.def.facing.scale(15));
      const ddx = door.x - this.playerPos.x;
      const ddz = door.z - this.playerPos.z;
      const d = Math.min(Math.hypot(dx, dz), Math.hypot(ddx, ddz));
      if (d < nearestD) {
        nearestD = d;
        nearest = t;
      }
    }
    if (nearest && nearestD <= MountainRingSystem.INTERACT_RADIUS + 12 && !this.inputBlockedProvider()) {
      this.focused = nearest;
      this.showPromptFor(nearest, nearestD <= MountainRingSystem.INTERACT_RADIUS + 4);
    } else {
      this.focused = null;
      this.hidePrompt();
    }
    void dt;
  }

  /** Project the temple's portal anchor to screen-space and render the
   *  HTML prompt there. `inRange` toggles the prompt text between
   *  "PRESS E" and "TEMPLE FOUND" so the player has a hint at distance. */
  private showPromptFor(t: ActiveTemple, inRange: boolean): void {
    const camera = this.scene.activeCamera;
    if (!camera) {
      this.hidePrompt();
      return;
    }
    const anchor = t.def.position.add(t.def.facing.scale(15)).add(new BABYLON.Vector3(0, 8, 0));
    const engine = this.scene.getEngine();
    const screen = BABYLON.Vector3.Project(
      anchor,
      BABYLON.Matrix.Identity(),
      this.scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    );
    if (screen.z < 0 || screen.z > 1) {
      this.hidePrompt();
      return;
    }
    this.promptEl.textContent = inRange
      ? `PRESS E — RAID HIDDEN TEMPLE`
      : `HIDDEN TEMPLE NEARBY`;
    this.promptEl.style.borderColor = inRange ? "#ffcc55" : "#9a8855";
    this.promptEl.style.left = `${screen.x}px`;
    this.promptEl.style.top = `${screen.y}px`;
    this.promptEl.style.display = "block";
    this.promptVisible = true;
  }

  private hidePrompt(): void {
    if (!this.promptVisible) return;
    this.promptEl.style.display = "none";
    this.promptVisible = false;
  }

  /** Award the loot bundle, spawn the guardian creature beside the door,
   *  mark the temple as looted, persist the id, and emit a UI message. */
  private lootTemple(t: ActiveTemple): void {
    if (t.looted) return;
    t.looted = true;
    this.lootedTempleIds.add(t.def.id);
    this.markLootedVisuals(t);

    // Scale loot quantities with world level. L1 = base, L2 = +50%, L3 = +100%.
    const mult = this.currentLevel === 1 ? 1 : this.currentLevel === 2 ? 1.5 : 2;
    const grantedSummary: string[] = [];
    for (const entry of TEMPLE_LOOT_BASE) {
      const def = ITEM_DEFINITIONS[entry.itemId];
      if (!def) continue;
      const amount = Math.max(1, Math.round(entry.amount * mult));
      this.inventory.addItem(def, amount);
      grantedSummary.push(`${amount} ${def.name}`);
    }

    // Spawn the guardian creature in front of the portal so the player
    // sees it immediately. Falls back gracefully if the species id has
    // somehow gone missing (legacy save mismatch).
    const species = getSpeciesById(t.def.guardianId) ?? BIO_SPECIES[0];
    const spawnPos = t.def.position.add(t.def.facing.scale(18)).add(new BABYLON.Vector3(0, 1, 0));
    this.bioSystem.spawnCreature(species, spawnPos);

    // Emit a HUD message so the player gets feedback. Game.tsx already
    // listens for this generic toast pattern.
    this.bus.emit(
      GameEvents.UI_MESSAGE,
      `TEMPLE LOOTED — ${species.name.toUpperCase()} GUARDIAN APPEARS!`,
    );

    console.log(
      `[MountainRingSystem] Looted ${t.def.id} — guardian=${species.id} grants=${grantedSummary.join(", ")}`,
    );
  }

  // ------------------------------------------------------------ persistence

  /** Snapshot of all temple ids the player has ever looted, across all
   *  levels. Persisted as a flat array for simple JSON shape. */
  getLootedTempleIds(): string[] {
    return Array.from(this.lootedTempleIds);
  }

  /** Restore the looted set. Validates entries against the L1..L3 id
   *  prefix so unrelated junk in older saves can't corrupt the set. */
  loadLootedTempleIds(ids: string[] | undefined | null): void {
    this.lootedTempleIds.clear();
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (typeof id !== "string") continue;
      // Accept both the new compass keys and any historical save that used
       // the original ne/nw/sw/se diagonal keys, so older saves still
       // resolve cleanly (entries that no longer match a built temple are
       // simply held in the looted set without visual effect).
      if (!/^L[1-3]_temple_(e|n|w|s|ne|nw|sw|se)$/.test(id)) continue;
      this.lootedTempleIds.add(id);
    }
    // Refresh visuals for the currently-built temples so any matching id
    // dims immediately, without waiting for a level-restart.
    for (const t of this.temples) {
      if (this.lootedTempleIds.has(t.def.id)) this.markLootedVisuals(t);
    }
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    window.removeEventListener("keydown", this.keydownHandler);
    this.bus.off(GameEvents.LEVEL_STARTED, this.levelStartedHandler);
    if (this.promptEl.parentNode) this.promptEl.parentNode.removeChild(this.promptEl);
    for (const t of this.temples) t.root.dispose(false, true);
    this.temples = [];
    this.mountainRoot.dispose(false, true);
    this.templeRoot.dispose(false, true);
  }
}

