import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { HumanoidCharacter, HumanoidDefinition } from "./HumanoidCharacter";
import type { WorldLevel } from "./LevelSystem";

/**
 * RescueSystem
 * ------------
 * Scatters captured humanoid synthetics in glowing red containment cages
 * across each combat level. Walking up and pressing **E** breaks the cage,
 * frees the synthetic, and plays a centered "story bubble" moment with the
 * rescuee's name + 3–4 lines of personal backstory. After the player
 * acknowledges the bubble the rescuee waves, fades out, and is permanently
 * marked as rescued (persisted to ProgressSync) so re-entering the level
 * never respawns them.
 *
 * Skips peaceful zones (Level 4 Sanctuary, Level 6 Pontiac Lab) — those are
 * the *destinations* the rescued synthetics are headed to.
 *
 * Does not register with EnemySystem so cages + humanoids cannot be targeted
 * or damaged by enemies / auto-target / friendly fire.
 */

export interface RescueDef {
  id: string;
  /** Short display name shown as the bubble header. */
  name: string;
  /** One-line role / title shown under the name. */
  title: string;
  /** World position. `y` defaults to 0 for ground levels; Level 5 (space)
   *  uses non-zero y so the cages float at varying altitudes around spawn. */
  position: { x: number; y?: number; z: number };
  /** Story lines played in order on rescue. The last line auto-closes. */
  lines: string[];
  primary: BABYLON.Color3;
  secondary: BABYLON.Color3;
  hair: BABYLON.Color3;
}

interface ActiveRescue {
  def: RescueDef;
  humanoid: HumanoidCharacter;
  cageRoot: BABYLON.TransformNode;
  cageMeshes: BABYLON.Mesh[];
  shimmer: BABYLON.Mesh;
  basePos: BABYLON.Vector3;
  bobPhase: number;
  freed: boolean;
  /** Wall-clock ms when the freed humanoid should despawn. 0 while caged. */
  vanishAt: number;
  /** Wall-clock ms while the freed humanoid is fading; alpha tween source. */
  fadeStartAt: number;
}

const c = (r: number, g: number, b: number) => new BABYLON.Color3(r, g, b);

/** Per-level rescue rosters. Each combat level gets 3 rescuees so the player
 *  encounters a steady cadence of story moments without flooding the map.
 *  Coordinates are picked to sit on the corridors between the level's spawn
 *  point and its boss fortress, well away from the FriendlyNPCSystem cast in
 *  the central plaza so the two E-key handlers don't fight for focus. */
export const RESCUE_DEFS: Record<number, RescueDef[]> = {
  1: [
    {
      id: "L1_archivist_trace",
      name: "ARCHIVIST TRACE",
      title: "Keeper of the Star City Memories",
      position: { x: 230, z: -60 },
      lines: [
        "You came back. I — I had stopped counting the days.",
        "Their captain caught me trying to wire the city memories off-site.",
        "Take the archive key. If Detroit falls, at least its songs survive.",
      ],
      primary: c(0.95, 0.85, 0.30),
      secondary: c(1.0, 0.55, 0.20),
      hair: c(1.0, 0.95, 0.55),
    },
    {
      id: "L1_dock_runner_vee",
      name: "DOCK RUNNER VEE",
      title: "Supply Hauler, North Pier",
      position: { x: 320, z: -200 },
      lines: [
        "Ribcage cracked, comms gone — three of my haulers got reduced to scrap.",
        "I was running med-gel to the spire when the swarm folded over me.",
        "Tell the medics I'll walk back. Slowly. But I'll walk.",
      ],
      primary: c(1.0, 0.45, 0.75),
      secondary: c(1.0, 0.85, 0.95),
      hair: c(1.0, 0.7, 0.95),
    },
    {
      id: "L1_sister_rho",
      name: "SISTER RHO",
      title: "Spire Medic, Order of the Quiet Hand",
      position: { x: 440, z: -50 },
      lines: [
        "Five wounded behind that door. I refused to leave them.",
        "The captain laughed and welded me into this cage as 'incentive.'",
        "Get them home. I'll handle the captain — with my bare hands if I must.",
      ],
      primary: c(0.95, 0.95, 1.0),
      secondary: c(0.45, 0.85, 1.0),
      hair: c(0.6, 0.95, 1.0),
    },
  ],
  2: [
    {
      id: "L2_ranger_obsidian",
      name: "RANGER OBSIDIAN",
      title: "Long-Range Scout, Ash Border",
      position: { x: -270, z: -260 },
      lines: [
        "I got too close to a captain's command tent. Won't make that mistake twice.",
        "Their second wave is built different — armored, organized, *patient*.",
        "Push fast. The longer the line holds, the more they bleed in to break it.",
      ],
      primary: c(0.30, 0.30, 0.40),
      secondary: c(0.95, 0.55, 0.20),
      hair: c(0.85, 0.85, 0.95),
    },
    {
      id: "L2_smith_kira",
      name: "SMITH KIRA",
      title: "Field Weapons-Forger",
      position: { x: -420, z: -300 },
      lines: [
        "They wanted my schematics. They got my left forearm instead.",
        "I'll build you something for that — pick me up at the sanctuary.",
        "And tell whoever's running this assault: red sky, red rifles. I prefer matching gear.",
      ],
      primary: c(0.85, 0.30, 0.25),
      secondary: c(1.0, 0.65, 0.30),
      hair: c(1.0, 0.45, 0.30),
    },
    {
      id: "L2_yan_lost_twin",
      name: "YAN — LOST TWIN",
      title: "Survivor of the Second Wave",
      position: { x: -360, z: -460 },
      lines: [
        "My sister Lan — she's still out there. The void took her.",
        "We held the line at the second tower. She covered my retreat.",
        "If you reach the third front, find her. Tell her Yan is alive.",
      ],
      primary: c(0.35, 0.65, 1.0),
      secondary: c(0.55, 0.85, 1.0),
      hair: c(0.45, 0.55, 1.0),
    },
  ],
  3: [
    {
      id: "L3_lan_lost_twin",
      name: "LAN — LOST TWIN",
      title: "Lost in the Void Front",
      position: { x: -50, z: 320 },
      lines: [
        "Yan… you found Yan? She's *alive*?",
        "I dreamed her voice. The void shows you what you can't bear to lose.",
        "I'm going home. Tell her I never stopped covering her retreat.",
      ],
      primary: c(0.55, 0.45, 1.0),
      secondary: c(0.85, 0.55, 1.0),
      hair: c(0.45, 0.55, 1.0),
    },
    {
      id: "L3_dr_inkwell",
      name: "DR. INKWELL",
      title: "Synthetic-Origin Researcher",
      position: { x: -160, z: 480 },
      lines: [
        "I know who built the hybrids. I have the files. They knew I'd talk.",
        "Char's lab — the Animatons came from there too. The same hands.",
        "Burn the command tower. Then come find me. We have work to do.",
      ],
      primary: c(0.95, 0.35, 1.0),
      secondary: c(0.55, 0.35, 1.0),
      hair: c(1.0, 0.55, 1.0),
    },
    {
      id: "L3_pilot_zeph",
      name: "PILOT ZEPH",
      title: "Cruiser Wing 3 — KIA Status: Recanted",
      position: { x: -230, z: 380 },
      lines: [
        "I rode my fighter all the way into the void mothership's belly.",
        "Punched out before the burn. They scooped me up before I hit dirt.",
        "I'm flying again. Get me a frame and I'll meet you in orbit.",
      ],
      primary: c(0.95, 0.95, 0.95),
      secondary: c(0.30, 0.75, 1.0),
      hair: c(0.85, 0.55, 0.30),
    },
  ],
  5: [
    {
      id: "L5_ensign_helio",
      name: "ENSIGN HELIO",
      title: "Cruiser ASHUR — Survival Pod 7",
      position: { x: 90, y: 14, z: -40 },
      lines: [
        "Pod nav locked the moment my ship cracked open. I've been drifting for days.",
        "There's a third mothership behind the asteroid band — they're hiding it.",
        "Get me back to a hull. I can crew anything that flies.",
      ],
      primary: c(0.30, 0.85, 1.0),
      secondary: c(0.95, 0.95, 1.0),
      hair: c(0.55, 0.95, 1.0),
    },
    {
      id: "L5_captain_nova",
      name: "CAPTAIN NOVA",
      title: "Last Officer of the Orbital Fleet",
      position: { x: -120, y: -8, z: 30 },
      lines: [
        "My fleet is gone. I logged every ship as it fell. Take the records.",
        "Earth doesn't know yet. Earth needs to know.",
        "I'll take command of whatever you can spare. We are not done.",
      ],
      primary: c(0.95, 0.85, 0.30),
      secondary: c(0.30, 0.30, 0.45),
      hair: c(0.95, 0.85, 0.55),
    },
    {
      id: "L5_navigator_ix",
      name: "NAVIGATOR IX",
      title: "Fold-Drive Navigator",
      position: { x: 40, y: 22, z: 80 },
      lines: [
        "I memorized the fold-coordinates home before my ship was breached.",
        "If you give me a console — any console — we can fold a relief wave in.",
        "Don't look at the void too long out here. It looks back. It remembers.",
      ],
      primary: c(0.65, 0.30, 1.0),
      secondary: c(0.95, 0.55, 1.0),
      hair: c(0.85, 0.70, 1.0),
    },
  ],
  11: [
    {
      id: "L11_ranger_maple",
      name: "RANGER MAPLE",
      title: "MI Wilds Rescue Scout",
      position: { x: 2590, y: 8, z: 1765 },
      lines: [
        "The labs are moving through the treeline. Every night, a new tower wakes up.",
        "I marked the power blooms before they caged me. Follow the cyan flare.",
        "Those giant walkers are not patrols. They're hunting rare Animatons.",
      ],
      primary: c(0.35, 0.85, 0.45),
      secondary: c(0.85, 0.95, 0.45),
      hair: c(0.72, 0.95, 0.55),
    },
    {
      id: "L11_dr_heron",
      name: "DR. HERON",
      title: "Sanctuary Field Surgeon",
      position: { x: 3235, y: 8, z: 1140 },
      lines: [
        "They were cutting bond cores out of rescued pets. I tried to stop them.",
        "The clinic at Ashur can reverse the damage, but it needs Bio Crop and feed.",
        "Bring the rare ones home. They remember who helped them.",
      ],
      primary: c(0.80, 0.95, 1.0),
      secondary: c(0.20, 0.75, 0.90),
      hair: c(0.90, 0.95, 1.0),
    },
    {
      id: "L11_pilot_cedar",
      name: "PILOT CEDAR",
      title: "Downed Mothership Cartographer",
      position: { x: 3520, y: 10, z: 1760 },
      lines: [
        "I got inside the mothership before it tore itself open over the wilds.",
        "There are more carriers above the clouds. The wrecks here are only scouts.",
        "Free me and I'll mark their flight lanes for the sanctuary.",
      ],
      primary: c(0.95, 0.65, 0.25),
      secondary: c(0.45, 0.55, 0.95),
      hair: c(1.0, 0.85, 0.40),
    },
  ],
};

export class RescueSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.Camera;
  private bus: EventBus;

  private active: ActiveRescue[] = [];
  /** Materials owned per active rescue. Tracked separately so `clearActive`
   *  can `dispose()` each one explicitly — Babylon mesh-dispose alone does
   *  not free the material, so failing to do this leaks GPU memory across
   *  every level swap. */
  private activeMaterials: BABYLON.Material[][] = [];
  private rescuedIds: Set<string> = new Set();
  private currentLevel: WorldLevel | null = null;

  private playerPosProvider: () => BABYLON.Vector3 = () => BABYLON.Vector3.Zero();
  private inputBlockedProvider: () => boolean = () => false;

  /** HTML overlay roots. Two layers: the floating "PRESS E TO FREE" prompt
   *  anchored above the nearest cage, and the centered story-bubble moment
   *  that appears once a rescue is triggered. */
  private root: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private bubbleBackdropEl: HTMLDivElement;
  private bubbleEl: HTMLDivElement;
  private bubbleHeaderEl: HTMLDivElement;
  private bubbleTitleEl: HTMLDivElement;
  private bubbleBodyEl: HTMLDivElement;
  private bubbleHintEl: HTMLDivElement;

  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Currently focused (in-range) cage. */
  private focused: ActiveRescue | null = null;
  /** While the bubble is open this rescue owns the E-key. */
  private bubbleFor: ActiveRescue | null = null;
  private bubbleLineIdx = 0;

  private static readonly INTERACT_RANGE = 4.5;
  private static readonly STAY_RANGE = 7.5;
  /** Time after the last bubble line closes until the freed humanoid fades. */
  private static readonly POST_FREE_LINGER_MS = 1500;
  private static readonly FADE_DURATION_MS = 1200;

  constructor(scene: BABYLON.Scene, camera: BABYLON.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.bus = EventBus.getInstance();

    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "23",
      overflow: "hidden",
    } as CSSStyleDeclaration);

    // Floating world-anchored "PRESS E TO FREE" prompt, mirrored from
    // FriendlyNPCSystem's prompt style but tinted alarm-red so the
    // captured-synth read is unmistakable.
    this.promptEl = document.createElement("div");
    Object.assign(this.promptEl.style, {
      position: "absolute",
      transform: "translate(-50%, -100%)",
      padding: "5px 12px",
      background: "rgba(0,0,0,0.82)",
      border: "1px solid #ff4a6a",
      borderRadius: "4px",
      color: "#ff4a6a",
      fontFamily: "'Press Start 2P', monospace",
      fontSize: "10px",
      letterSpacing: "1px",
      whiteSpace: "nowrap",
      textShadow: "0 0 6px #ff2050",
      boxShadow: "0 0 14px rgba(255, 60, 100, 0.6)",
      display: "none",
    } as CSSStyleDeclaration);
    this.promptEl.textContent = "PRESS E TO FREE";
    this.root.appendChild(this.promptEl);

    // Dimming backdrop while a story-bubble moment is active. Subtle so the
    // freed humanoid + cage shatter can still be seen behind it.
    this.bubbleBackdropEl = document.createElement("div");
    Object.assign(this.bubbleBackdropEl.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      background: "radial-gradient(ellipse at center, rgba(0,0,0,0.05), rgba(0,0,0,0.55))",
      display: "none",
    } as CSSStyleDeclaration);
    this.root.appendChild(this.bubbleBackdropEl);

    // Centered story bubble. Larger + more dramatic than the floating
    // FriendlyNPC bubble — these are one-shot story moments.
    this.bubbleEl = document.createElement("div");
    Object.assign(this.bubbleEl.style, {
      position: "absolute",
      left: "50%",
      bottom: "18%",
      transform: "translateX(-50%)",
      minWidth: "420px",
      maxWidth: "640px",
      padding: "18px 22px 14px 22px",
      background: "rgba(252, 250, 230, 0.97)",
      border: "4px solid #1a1a2e",
      borderRadius: "14px",
      color: "#1a1a2e",
      fontFamily: "'Press Start 2P', monospace",
      boxShadow: "0 0 28px rgba(255, 200, 70, 0.85), 0 8px 0 rgba(0,0,0,0.45)",
      display: "none",
    } as CSSStyleDeclaration);

    this.bubbleHeaderEl = document.createElement("div");
    Object.assign(this.bubbleHeaderEl.style, {
      fontSize: "13px",
      letterSpacing: "1.8px",
      color: "#c2410c",
      marginBottom: "2px",
    } as CSSStyleDeclaration);
    this.bubbleEl.appendChild(this.bubbleHeaderEl);

    this.bubbleTitleEl = document.createElement("div");
    Object.assign(this.bubbleTitleEl.style, {
      fontSize: "9px",
      letterSpacing: "1.2px",
      color: "#7c2d12",
      marginBottom: "10px",
      opacity: "0.85",
    } as CSSStyleDeclaration);
    this.bubbleEl.appendChild(this.bubbleTitleEl);

    this.bubbleBodyEl = document.createElement("div");
    Object.assign(this.bubbleBodyEl.style, {
      fontSize: "12px",
      lineHeight: "1.7",
      letterSpacing: "0.5px",
      color: "#1a1a2e",
      minHeight: "72px",
    } as CSSStyleDeclaration);
    this.bubbleEl.appendChild(this.bubbleBodyEl);

    this.bubbleHintEl = document.createElement("div");
    Object.assign(this.bubbleHintEl.style, {
      marginTop: "12px",
      fontSize: "9px",
      letterSpacing: "1.5px",
      color: "#6b7280",
      textAlign: "right",
    } as CSSStyleDeclaration);
    this.bubbleHintEl.textContent = "[E] CONTINUE";
    this.bubbleEl.appendChild(this.bubbleHintEl);

    // Speech-bubble tail.
    const tail = document.createElement("div");
    Object.assign(tail.style, {
      position: "absolute",
      bottom: "-16px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "0",
      height: "0",
      borderLeft: "14px solid transparent",
      borderRight: "14px solid transparent",
      borderTop: "16px solid #1a1a2e",
    } as CSSStyleDeclaration);
    this.bubbleEl.appendChild(tail);

    this.root.appendChild(this.bubbleEl);
    document.body.appendChild(this.root);

    this.observer = this.scene.onBeforeRenderObservable.add(() => this.tick());

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.code !== "KeyE") return;
      if (this.bubbleFor) {
        // Bubble owns E while open — advance / close. stopImmediate so any
        // *later-registered* listener (FriendlyNPCSystem etc.) on `window`
        // can't also consume the same press and double-drive its dialogue.
        // Note: this only protects against listeners attached AFTER ours;
        // earlier ones already ran. The Game.tsx friendlyNPCs `inputBlocked`
        // provider gates the friendly-NPC handler the other direction.
        e.stopImmediatePropagation();
        this.advanceBubble();
        return;
      }
      if (this.inputBlockedProvider()) return;
      if (!this.focused || this.focused.freed) return;
      e.stopImmediatePropagation();
      this.freeRescue(this.focused);
    };
    window.addEventListener("keydown", this.keydownHandler);
  }

  /** Public probe so other systems (FriendlyNPCSystem via Game.tsx's
   *  inputBlockedProvider) can defer their own E-key handling while a
   *  rescue story bubble is mid-flight. */
  isStoryBubbleOpen(): boolean {
    return this.bubbleFor !== null;
  }

  setPlayerPositionProvider(fn: () => BABYLON.Vector3): void {
    this.playerPosProvider = fn;
  }

  /** Lets callers (Game.tsx) gate the E-handler whenever another modal —
   *  shop, upgrade menu, garden — owns input. Mirrors FriendlyNPCSystem. */
  setInputBlockedProvider(fn: () => boolean): void {
    this.inputBlockedProvider = fn;
  }

  /** Called whenever the world level changes. Disposes any prior rescues
   *  and spawns the new level's roster, skipping ids already in
   *  `rescuedIds`. Pass null to clear without spawning (e.g. on dispose). */
  setLevel(level: WorldLevel | null): void {
    if (this.currentLevel === level) return;
    this.clearActive();
    this.currentLevel = level;
    if (level === null) return;
    const roster = RESCUE_DEFS[level];
    if (!roster) return;
    for (const def of roster) {
      if (this.rescuedIds.has(def.id)) continue;
      this.spawnRescue(def);
    }
  }

  /** Persistence: returns the set of rescued ids for ProgressSync. */
  serialize(): string[] {
    return Array.from(this.rescuedIds);
  }

  /** Persistence: restores the rescued-id set from a save. Call BEFORE
   *  setLevel so already-rescued cages don't briefly flash into the world. */
  applyLoadedState(ids?: string[] | null): void {
    this.rescuedIds.clear();
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === "string" && id.length > 0) this.rescuedIds.add(id);
      }
    }
    // If a level is already mounted, refresh it so newly-loaded ids prune
    // any rescues that would otherwise be visible.
    if (this.currentLevel !== null) {
      const lvl = this.currentLevel;
      this.currentLevel = null;
      this.setLevel(lvl);
    }
  }

  private spawnRescue(def: RescueDef): void {
    const colors = {
      primary: def.primary,
      secondary: def.secondary,
      skin: c(1.0, 0.82, 0.7),
      hair: def.hair,
    };
    const definition: HumanoidDefinition = {
      height: 1.7,
      headScale: 0.42,
      shoulderWidth: 0.55,
      chestWidth: 0.6,
      armLength: 0.7,
      legLength: 0.85,
      bodyType: "athletic",
      colors,
      hasArmor: false,
    };
    const humanoid = new HumanoidCharacter(this.scene, definition);
    const root = humanoid.getRoot() as BABYLON.TransformNode;
    const y = def.position.y ?? 0;
    root.position.set(def.position.x, y, def.position.z);

    // Make the captured synthetic glow softly so the player can spot the
    // cage from a distance.
    humanoid.getMeshes().forEach((mesh) => {
      const mat = mesh.material as BABYLON.StandardMaterial | null;
      if (!mat || !mat.diffuseColor) return;
      mat.emissiveColor = mat.diffuseColor.scale(0.35);
    });

    // ---- Build the containment cage ----
    const cageRoot = new BABYLON.TransformNode(`rescueCage_${def.id}`, this.scene);
    cageRoot.position.set(def.position.x, y, def.position.z);

    const barMat = new BABYLON.StandardMaterial(`rescueBarMat_${def.id}`, this.scene);
    barMat.diffuseColor = new BABYLON.Color3(0.9, 0.15, 0.25);
    barMat.emissiveColor = new BABYLON.Color3(1.0, 0.25, 0.35);
    barMat.specularColor = new BABYLON.Color3(0, 0, 0);

    const cageMeshes: BABYLON.Mesh[] = [];
    const cageRadius = 1.2;
    const cageHeight = 2.4;
    // Four vertical bars at the corners of an X-shape, plus a thicker
    // base ring so the silhouette reads as a containment unit and not
    // just stray geometry.
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bar = BABYLON.MeshBuilder.CreateCylinder(`rescueBar_${def.id}_${i}`, {
        diameter: 0.12,
        height: cageHeight,
        tessellation: 8,
      }, this.scene);
      bar.position.set(Math.cos(ang) * cageRadius, cageHeight / 2, Math.sin(ang) * cageRadius);
      bar.material = barMat;
      bar.parent = cageRoot;
      bar.isPickable = false;
      cageMeshes.push(bar);
    }
    const ring = BABYLON.MeshBuilder.CreateTorus(`rescueRing_${def.id}`, {
      diameter: cageRadius * 2.3,
      thickness: 0.18,
      tessellation: 24,
    }, this.scene);
    ring.position.y = 0.1;
    ring.material = barMat;
    ring.parent = cageRoot;
    ring.isPickable = false;
    cageMeshes.push(ring);

    // Translucent shimmer plane on top — signals the active force-field roof.
    const shimmer = BABYLON.MeshBuilder.CreateDisc(`rescueShimmer_${def.id}`, {
      radius: cageRadius,
      tessellation: 24,
    }, this.scene);
    shimmer.rotation.x = Math.PI / 2;
    shimmer.position.y = cageHeight - 0.05;
    const shimmerMat = new BABYLON.StandardMaterial(`rescueShimmerMat_${def.id}`, this.scene);
    shimmerMat.diffuseColor = new BABYLON.Color3(1.0, 0.3, 0.5);
    shimmerMat.emissiveColor = new BABYLON.Color3(1.0, 0.4, 0.6);
    shimmerMat.alpha = 0.35;
    shimmerMat.specularColor = new BABYLON.Color3(0, 0, 0);
    shimmer.material = shimmerMat;
    shimmer.parent = cageRoot;
    shimmer.isPickable = false;

    this.active.push({
      def,
      humanoid,
      cageRoot,
      cageMeshes,
      shimmer,
      basePos: new BABYLON.Vector3(def.position.x, y, def.position.z),
      bobPhase: Math.random() * Math.PI * 2,
      freed: false,
      vanishAt: 0,
      fadeStartAt: 0,
    });
    // Track unique materials per rescue so clearActive can dispose them.
    this.activeMaterials.push([barMat, shimmerMat]);
  }

  /** Triggered when the player presses E inside a cage's interact range. */
  private freeRescue(rescue: ActiveRescue): void {
    rescue.freed = true;
    // Visually shatter the cage — quick burst expansion + dispose. Cheap
    // single-frame "explode" for a satisfying break without an effect
    // system dependency.
    for (const mesh of rescue.cageMeshes) {
      try { mesh.dispose(); } catch {}
    }
    rescue.cageMeshes = [];
    try { rescue.shimmer.dispose(); } catch {}
    // Cage materials are no longer referenced by any live mesh — drop them
    // here so the GPU buffers free immediately. The matching activeMaterials
    // entry is purged when the rescue is removed from `this.active`.
    const idx = this.active.indexOf(rescue);
    if (idx >= 0 && this.activeMaterials[idx]) {
      for (const mat of this.activeMaterials[idx]) {
        try { mat.dispose(); } catch {}
      }
      this.activeMaterials[idx] = [];
    }

    // Open the centered story bubble. Bubble owns E until it closes.
    this.bubbleFor = rescue;
    this.bubbleLineIdx = 0;
    this.renderBubble();

    // Mark rescued + persist via event so Game.tsx can fold the id into
    // the next save snapshot.
    this.rescuedIds.add(rescue.def.id);
    this.bus.emit(GameEvents.SYNTHETIC_RESCUED, {
      id: rescue.def.id,
      name: rescue.def.name,
      title: rescue.def.title,
      level: this.currentLevel,
      position: rescue.basePos.clone(),
    });
  }

  private advanceBubble(): void {
    if (!this.bubbleFor) return;
    const lines = this.bubbleFor.def.lines;
    this.bubbleLineIdx += 1;
    if (this.bubbleLineIdx >= lines.length) {
      this.closeBubble();
      // Schedule the freed humanoid to fade + despawn after a short linger.
      const now = Date.now();
      const rescue = this.active.find(r => r.def.id === this.bubbleFor?.def.id);
      if (rescue) {
        rescue.vanishAt = now + RescueSystem.POST_FREE_LINGER_MS + RescueSystem.FADE_DURATION_MS;
        rescue.fadeStartAt = now + RescueSystem.POST_FREE_LINGER_MS;
      }
      this.bubbleFor = null;
      this.focused = null; // Force a fresh focus probe next tick.
      return;
    }
    this.renderBubble();
  }

  private renderBubble(): void {
    if (!this.bubbleFor) return;
    const def = this.bubbleFor.def;
    const idx = this.bubbleLineIdx;
    this.bubbleHeaderEl.textContent = `${def.name}  ·  ${idx + 1}/${def.lines.length}`;
    this.bubbleTitleEl.textContent = def.title;
    this.bubbleBodyEl.textContent = `"${def.lines[idx] ?? ""}"`;
    this.bubbleHintEl.textContent = idx + 1 < def.lines.length ? "[E] CONTINUE" : "[E] CLOSE";
    this.bubbleEl.style.display = "block";
    this.bubbleBackdropEl.style.display = "block";
    // Mirror to the in-game UI message log so the line is recoverable if
    // the bubble is dismissed mid-combat.
    this.bus.emit(GameEvents.UI_MESSAGE, `${def.name}: ${def.lines[idx]}`);
  }

  private closeBubble(): void {
    this.bubbleEl.style.display = "none";
    this.bubbleBackdropEl.style.display = "none";
  }

  private clearActive(): void {
    if (this.bubbleFor) {
      this.closeBubble();
      this.bubbleFor = null;
    }
    for (const r of this.active) {
      try { r.humanoid.dispose(); } catch {}
      try { r.cageRoot.dispose(); } catch {}
      for (const m of r.cageMeshes) { try { m.dispose(); } catch {} }
      try { r.shimmer.dispose(); } catch {}
    }
    // Explicit material dispose — Babylon mesh-dispose does NOT free unique
    // materials by default, so leaving this out leaks one StandardMaterial
    // pair per rescue every time we swap levels.
    for (const matList of this.activeMaterials) {
      for (const mat of matList) {
        try { mat.dispose(); } catch {}
      }
    }
    this.activeMaterials = [];
    this.active = [];
    this.focused = null;
    this.promptEl.style.display = "none";
  }

  private tick(): void {
    if (this.active.length === 0) {
      this.promptEl.style.display = "none";
      return;
    }

    const dt = this.scene.getEngine().getDeltaTime() / 1000;
    const playerPos = this.playerPosProvider();
    const now = Date.now();

    let nearest: ActiveRescue | null = null;
    let nearestDistSq = Infinity;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const r = this.active[i];

      // Cage shimmer pulse + caged-humanoid bob.
      r.bobPhase += dt * 1.4;
      const root = r.humanoid.getRoot() as BABYLON.TransformNode;
      if (!r.freed) {
        root.position.y = r.basePos.y + Math.sin(r.bobPhase) * 0.05;
        const shimmerMat = r.shimmer.material as BABYLON.StandardMaterial | null;
        if (shimmerMat) {
          const t = (Math.sin(r.bobPhase * 1.6) + 1) * 0.5;
          shimmerMat.alpha = 0.25 + t * 0.25;
        }
      } else if (r.fadeStartAt > 0) {
        // Fading freed humanoid — lerp materials' alpha to 0, then dispose.
        const elapsed = now - r.fadeStartAt;
        if (elapsed > 0) {
          const a = Math.max(0, 1 - elapsed / RescueSystem.FADE_DURATION_MS);
          r.humanoid.getMeshes().forEach((mesh) => {
            const mat = mesh.material as BABYLON.StandardMaterial | null;
            if (mat) {
              mat.alpha = a;
              // StandardMaterial only enables alpha blending if needsAlpha
              // returns true; setting a separate transparency flag here is
              // a no-op, but lowering alpha + ensuring the mesh draws after
              // opaque geometry covers the simple fade case fine.
            }
          });
          // Subtle upward lift while fading — reads as "ascending home".
          root.position.y += dt * 0.5;
        }
        if (now >= r.vanishAt) {
          try { r.humanoid.dispose(); } catch {}
          try { r.cageRoot.dispose(); } catch {}
          this.active.splice(i, 1);
          // Drop the parallel materials slot — already disposed in freeRescue,
          // but the empty slot must shift in lockstep with `active` so future
          // index-based lookups (clearActive et al.) stay aligned.
          this.activeMaterials.splice(i, 1);
          continue;
        }
      }

      // Face the player gently when they approach a still-caged synth.
      if (!r.freed) {
        const dx = playerPos.x - root.position.x;
        const dz = playerPos.z - root.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < 200) {
          const targetYaw = Math.atan2(dx, dz);
          const cur = root.rotation.y;
          let diff = targetYaw - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          root.rotation.y = cur + diff * Math.min(1, dt * 4);
        }
        if (distSq < nearestDistSq) {
          nearestDistSq = distSq;
          nearest = r;
        }
      }
    }

    // Acquire / release focus for the prompt.
    const dist = Math.sqrt(nearestDistSq);
    if (this.focused) {
      if (this.focused.freed || this.focused !== nearest || dist > RescueSystem.STAY_RANGE) {
        this.focused = null;
      }
    }
    if (!this.focused && nearest && dist <= RescueSystem.INTERACT_RANGE) {
      this.focused = nearest;
    }

    // Project the prompt above the focused cage, but hide it while a
    // bubble is open or another modal owns input.
    const blocked = this.bubbleFor !== null || this.inputBlockedProvider();
    if (!blocked && this.focused) {
      const root = this.focused.humanoid.getRoot() as BABYLON.TransformNode;
      const headWorld = new BABYLON.Vector3(root.position.x, root.position.y + 2.7, root.position.z);
      const engine = this.scene.getEngine();
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const transform = this.scene.getTransformMatrix();
      const viewport = this.camera.viewport.toGlobal(w, h);
      const screen = BABYLON.Vector3.Project(headWorld, BABYLON.Matrix.Identity(), transform, viewport);
      if (screen.z < 0 || screen.z > 1) {
        this.promptEl.style.display = "none";
      } else {
        this.promptEl.style.left = `${screen.x}px`;
        this.promptEl.style.top = `${screen.y}px`;
        this.promptEl.style.display = "block";
      }
    } else {
      this.promptEl.style.display = "none";
    }
  }

  dispose(): void {
    if (this.observer) {
      this.scene.onBeforeRenderObservable.remove(this.observer);
      this.observer = null;
    }
    if (this.keydownHandler) {
      window.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
    this.clearActive();
    try { this.root.remove(); } catch {}
  }
}
