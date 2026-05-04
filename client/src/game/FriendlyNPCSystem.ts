import * as BABYLON from "@babylonjs/core";
import { EventBus, GameEvents } from "./EventBus";
import { HumanoidCharacter, HumanoidDefinition } from "./HumanoidCharacter";

/**
 * FriendlyNPCSystem
 * ------------------
 * Drops a small cast of brightly-coloured friendly humanoids around the world.
 * Each one carries a story / objective dialogue. Walk within ~5 m and an HTML
 * "Press E" prompt floats above their head; pressing E pops a speech bubble
 * that advances through their dialogue lines. Walking away auto-closes the
 * bubble. Their colours are intentionally cheerful (sunshine yellow, pink,
 * cyan, lime, magenta, orange) so they read instantly as non-hostile against
 * the gritty Detroit palette.
 *
 * Shop conflict avoidance: NPCs are placed >12 m from any shop building, and
 * the E-keydown handler skips when a shop dialog is open (`shopOpenProvider`).
 */

export interface NPCDialogue {
  /** Display name shown in the bubble header. */
  name: string;
  /** Ordered story / objective lines — repeats from the start once exhausted. */
  lines: string[];
}

export interface FriendlyNPCDef {
  id: string;
  position: BABYLON.Vector3;
  dialogue: NPCDialogue;
  /** Colour kit — picked from BRIGHT_PALETTES if omitted. */
  primary?: BABYLON.Color3;
  secondary?: BABYLON.Color3;
  hair?: BABYLON.Color3;
  /** Bobbing speed (rad/s) for the idle float. */
  bobSpeed?: number;
}

interface NPCInstance {
  def: FriendlyNPCDef;
  humanoid: HumanoidCharacter;
  baseY: number;
  bobPhase: number;
  /** 0-indexed pointer into def.dialogue.lines. */
  dialogueIndex: number;
}

const BRIGHT_PALETTES: Array<{ primary: BABYLON.Color3; secondary: BABYLON.Color3; hair: BABYLON.Color3 }> = [
  { // Sunshine
    primary: new BABYLON.Color3(1.0, 0.85, 0.15),
    secondary: new BABYLON.Color3(1.0, 0.55, 0.15),
    hair: new BABYLON.Color3(1.0, 0.95, 0.55),
  },
  { // Bubblegum
    primary: new BABYLON.Color3(1.0, 0.45, 0.75),
    secondary: new BABYLON.Color3(1.0, 0.85, 0.95),
    hair: new BABYLON.Color3(1.0, 0.7, 0.95),
  },
  { // Aqua
    primary: new BABYLON.Color3(0.25, 0.95, 0.95),
    secondary: new BABYLON.Color3(0.6, 1.0, 0.85),
    hair: new BABYLON.Color3(0.5, 0.95, 1.0),
  },
  { // Lime
    primary: new BABYLON.Color3(0.55, 1.0, 0.35),
    secondary: new BABYLON.Color3(1.0, 1.0, 0.35),
    hair: new BABYLON.Color3(0.8, 1.0, 0.3),
  },
  { // Magenta
    primary: new BABYLON.Color3(0.95, 0.35, 1.0),
    secondary: new BABYLON.Color3(0.55, 0.35, 1.0),
    hair: new BABYLON.Color3(1.0, 0.55, 1.0),
  },
  { // Orange
    primary: new BABYLON.Color3(1.0, 0.55, 0.2),
    secondary: new BABYLON.Color3(1.0, 0.85, 0.4),
    hair: new BABYLON.Color3(1.0, 0.7, 0.3),
  },
];

export class FriendlyNPCSystem {
  private scene: BABYLON.Scene;
  private camera: BABYLON.Camera;
  private bus: EventBus;
  private npcs: NPCInstance[] = [];

  private playerPosProvider: () => BABYLON.Vector3 = () => BABYLON.Vector3.Zero();
  private shopOpenProvider: () => boolean = () => false;
  /** Lets the system suppress its own E-handler while another modal owns input. */
  private inputBlockedProvider: () => boolean = () => false;

  /** HTML overlay root; one per system, holds prompt + bubble. */
  private root: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private bubbleEl: HTMLDivElement;
  private bubbleHeaderEl: HTMLDivElement;
  private bubbleBodyEl: HTMLDivElement;
  private bubbleHintEl: HTMLDivElement;

  private observer: BABYLON.Observer<BABYLON.Scene> | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  /** Mirror of `keydownHandler` for the gamepad — listens for the
   *  same `gamepad-menu` CustomEvents the upgrade menu does so the
   *  controller's A advances dialogue and B closes it. Keeps E and
   *  the controller in lock-step instead of forcing players to
   *  switch input devices mid-conversation. */
  private gamepadHandler: ((e: Event) => void) | null = null;

  /** Currently focused NPC (closest within range) — drives prompt / bubble. */
  private focused: NPCInstance | null = null;
  /** When true, the bubble is open and E advances/closes dialogue. */
  private bubbleOpen: boolean = false;
  /** Tied to focused — if the player walks away, bubble auto-closes. */
  private readonly INTERACT_RANGE = 5.5;
  private readonly STAY_RANGE = 9.0;

  constructor(scene: BABYLON.Scene, camera: BABYLON.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.bus = EventBus.getInstance();

    // Build the HTML overlay layer up-front. Containers stay hidden until a
    // tick decides to show them, which avoids any first-frame flicker.
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "22",
      overflow: "hidden",
    } as CSSStyleDeclaration);

    this.promptEl = document.createElement("div");
    Object.assign(this.promptEl.style, {
      position: "absolute",
      transform: "translate(-50%, -100%)",
      padding: "4px 10px",
      background: "rgba(0,0,0,0.78)",
      border: "1px solid #ffd84a",
      borderRadius: "4px",
      color: "#ffd84a",
      fontFamily: "'Press Start 2P', monospace",
      fontSize: "10px",
      letterSpacing: "1px",
      whiteSpace: "nowrap",
      textShadow: "0 0 6px #ffb000",
      boxShadow: "0 0 10px rgba(255, 200, 70, 0.55)",
      display: "none",
    } as CSSStyleDeclaration);
    this.promptEl.textContent = "PRESS E TO TALK";
    this.root.appendChild(this.promptEl);

    this.bubbleEl = document.createElement("div");
    Object.assign(this.bubbleEl.style, {
      position: "absolute",
      transform: "translate(-50%, -100%)",
      minWidth: "240px",
      maxWidth: "360px",
      padding: "10px 14px",
      background: "rgba(255, 255, 250, 0.96)",
      border: "3px solid #1a1a2e",
      borderRadius: "12px",
      color: "#1a1a2e",
      fontFamily: "'Press Start 2P', monospace",
      boxShadow: "0 0 18px rgba(255, 230, 120, 0.7), 0 6px 0 rgba(0,0,0,0.35)",
      display: "none",
    } as CSSStyleDeclaration);

    this.bubbleHeaderEl = document.createElement("div");
    Object.assign(this.bubbleHeaderEl.style, {
      fontSize: "11px",
      letterSpacing: "1.5px",
      color: "#c2410c",
      marginBottom: "6px",
    } as CSSStyleDeclaration);
    this.bubbleEl.appendChild(this.bubbleHeaderEl);

    this.bubbleBodyEl = document.createElement("div");
    Object.assign(this.bubbleBodyEl.style, {
      fontSize: "11px",
      lineHeight: "1.65",
      letterSpacing: "0.5px",
      color: "#1a1a2e",
    } as CSSStyleDeclaration);
    this.bubbleEl.appendChild(this.bubbleBodyEl);

    this.bubbleHintEl = document.createElement("div");
    Object.assign(this.bubbleHintEl.style, {
      marginTop: "8px",
      fontSize: "8px",
      letterSpacing: "1px",
      color: "#6b7280",
      textAlign: "right",
    } as CSSStyleDeclaration);
    this.bubbleHintEl.textContent = "[E] CONTINUE";
    this.bubbleEl.appendChild(this.bubbleHintEl);

    // Speech-bubble tail — a small downward triangle hanging off the bottom.
    const tail = document.createElement("div");
    Object.assign(tail.style, {
      position: "absolute",
      bottom: "-14px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "0",
      height: "0",
      borderLeft: "12px solid transparent",
      borderRight: "12px solid transparent",
      borderTop: "14px solid #1a1a2e",
    } as CSSStyleDeclaration);
    this.bubbleEl.appendChild(tail);

    this.root.appendChild(this.bubbleEl);
    document.body.appendChild(this.root);

    this.observer = this.scene.onBeforeRenderObservable.add(() => this.tick());

    // Shared body for both the keyboard-E and the gamepad-A entry
    // points so the two stay perfectly in sync — opens the bubble if
    // closed, advances if open, closes after the last line.
    const advance = () => {
      if (this.shopOpenProvider() || this.inputBlockedProvider()) return;
      if (!this.focused) return;
      if (!this.bubbleOpen) {
        this.bubbleOpen = true;
        this.focused.dialogueIndex = 0;
        this.renderBubble();
      } else {
        this.focused.dialogueIndex += 1;
        if (this.focused.dialogueIndex >= this.focused.def.dialogue.lines.length) {
          this.closeBubble();
        } else {
          this.renderBubble();
        }
      }
    };

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.code !== "KeyE") return;
      advance();
    };
    window.addEventListener("keydown", this.keydownHandler);

    // Controller pathway. GamepadInput dispatches `gamepad-menu` with
    // `action: "activate" | "close" | "up" | "down" | "left" | "right"`
    // ONLY when the global menu-mode provider returns true — Game.tsx
    // ORs `isDialogueOpen()` into that provider so this listener only
    // ever fires while a bubble owns the screen.
    this.gamepadHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { action?: string } | null;
      if (!detail?.action) return;
      if (detail.action === "activate") advance();
      else if (detail.action === "close" && this.bubbleOpen) this.closeBubble();
    };
    window.addEventListener("gamepad-menu", this.gamepadHandler);
  }

  /** Public accessor so Game.tsx can treat an open dialogue bubble
   *  as a modal for menu-mode purposes (controller nav + suppressed
   *  gameplay bindings). */
  isDialogueOpen(): boolean {
    return this.bubbleOpen;
  }

  setPlayerPositionProvider(fn: () => BABYLON.Vector3): void {
    this.playerPosProvider = fn;
  }

  setShopOpenProvider(fn: () => boolean): void {
    this.shopOpenProvider = fn;
  }

  setInputBlockedProvider(fn: () => boolean): void {
    this.inputBlockedProvider = fn;
  }

  /** Spawn the default cast. Call after CityGenerator so positions land
   *  in walkable areas. */
  spawnDefaults(): void {
    // Each of these introduces or explains a system the player will encounter.
    // Lines are kept short — Press Start 2P is wide and the bubble narrow.
    const cast: FriendlyNPCDef[] = [
      {
        id: "captain_iris",
        position: new BABYLON.Vector3(20, 0, 20),
        dialogue: {
          name: "CAPT. IRIS",
          lines: [
            "Welcome to Heavy Water, pilot.",
            "Detroit is overrun with hybrid organoids — ground swarms, aerial fortresses, the works.",
            "Your job: defend the city. Push back, level up, get strong.",
            "Open the upgrade bay with TAB. Buy resources at any shop with E.",
          ],
        },
      },
      {
        id: "merchant_bex",
        position: new BABYLON.Vector3(345, 0, 100),
        dialogue: {
          name: "MERCHANT BEX",
          lines: [
            "Looking to spend some hard-earned credits?",
            "General shop sells gears, scrap, cores, circuits, nano fiber — every upgrade material.",
            "Weapon shop stocks the parts your guns need to level up.",
            "Sell what you don't need from the inventory tab.",
          ],
        },
      },
      {
        id: "engineer_juno",
        position: new BABYLON.Vector3(-15, 0, 60),
        dialogue: {
          name: "ENGINEER JUNO",
          lines: [
            "Helper bots not pulling their weight?",
            "Open TAB → ROBOTS to level them up with gears + cores.",
            "Each bot also has a HELPER WEAPON tier — separate upgrade, much faster fire.",
            "Build new bots at the lab once you've got materials.",
          ],
        },
      },
      {
        id: "rider_kazu",
        position: new BABYLON.Vector3(60, 0, -40),
        dialogue: {
          name: "RIDER KAZU",
          lines: [
            "Hold SHIFT for two seconds — rocket skates engage.",
            "Top speed nearly doubles. Great for crossing the open biomes.",
            "Triple-jump tap into free flight. The sky racetrack is ringed with ramps.",
            "Press Y for the beam sabre — dash → slash for a signature combo.",
          ],
        },
      },
      {
        id: "mystic_ori",
        position: new BABYLON.Vector3(-45, 0, -25),
        dialogue: {
          name: "MYSTIC ORI",
          lines: [
            "Six elementals sleep in your hands.",
            "Lightning, ice, fireball — they track. Flame, wind, psychic — they erupt around you.",
            "Cycle with the elemental hotkeys, cast with the dedicated trigger.",
            "Level them up in TAB → SPECIALS for radius and damage.",
          ],
        },
      },
      {
        id: "scout_pip",
        position: new BABYLON.Vector3(140, 0, 200),
        dialogue: {
          name: "SCOUT PIP",
          lines: [
            "Beyond the city: four biomes, all hostile.",
            "Hybrid organoid bases, loot vaults, mining nodes — and flying fortresses overhead.",
            "Don't aggro the sky unless you're ready. Once routed, fortresses regroup for five minutes.",
            "Watch your minimap. Stay sharp out there.",
          ],
        },
      },
    ];

    cast.forEach((def, i) => this.spawnNPC(def, i));
  }

  private spawnNPC(def: FriendlyNPCDef, idx: number): void {
    const palette = BRIGHT_PALETTES[idx % BRIGHT_PALETTES.length];
    const colors = {
      primary: def.primary ?? palette.primary,
      secondary: def.secondary ?? palette.secondary,
      // Friendly cartoon skin tone — biased warm.
      skin: new BABYLON.Color3(1.0, 0.82, 0.7),
      hair: def.hair ?? palette.hair,
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
    // Place feet at y=0; HumanoidCharacter is built with pelvis at h*0.48 and
    // feet hanging from the leg pivot, so root.position.y is the ground anchor.
    root.position.copyFrom(def.position);

    // Bump emissive on the colorful materials so the friendlies pop visually
    // even at night / in shadow.
    humanoid.getMeshes().forEach((mesh) => {
      const mat = mesh.material as BABYLON.StandardMaterial | null;
      if (!mat || !mat.diffuseColor) return;
      // Boost emissive but keep the diffuse — gives the cell-shaded "happy"
      // pop without washing out completely.
      mat.emissiveColor = mat.diffuseColor.scale(0.45);
    });

    // Tiny golden halo / hover ring under the feet to mark them as friendly
    // and easy to spot from a distance.
    const halo = BABYLON.MeshBuilder.CreateTorus(`npcHalo_${def.id}`, {
      diameter: 1.4,
      thickness: 0.08,
      tessellation: 24,
    }, this.scene);
    halo.position.y = 0.08;
    const haloMat = new BABYLON.StandardMaterial(`npcHaloMat_${def.id}`, this.scene);
    haloMat.diffuseColor = new BABYLON.Color3(1.0, 0.85, 0.25);
    haloMat.emissiveColor = new BABYLON.Color3(1.0, 0.7, 0.2);
    haloMat.specularColor = new BABYLON.Color3(0, 0, 0);
    halo.material = haloMat;
    halo.parent = root;

    this.npcs.push({
      def,
      humanoid,
      baseY: def.position.y,
      bobPhase: Math.random() * Math.PI * 2,
      dialogueIndex: 0,
    });
  }

  /** Per-frame: bob NPCs, find closest in range, position prompt + bubble. */
  private tick(): void {
    const dt = this.scene.getEngine().getDeltaTime() / 1000;
    const playerPos = this.playerPosProvider();

    // Bob and face the player (gentle yaw only).
    let nearest: NPCInstance | null = null;
    let nearestDistSq = Infinity;
    for (const npc of this.npcs) {
      const root = npc.humanoid.getRoot() as BABYLON.TransformNode;
      npc.bobPhase += dt * (npc.def.bobSpeed ?? 1.6);
      root.position.y = npc.baseY + Math.sin(npc.bobPhase) * 0.06;

      const dx = playerPos.x - root.position.x;
      const dz = playerPos.z - root.position.z;
      const distSq = dx * dx + dz * dz;
      // Face the player when they're nearby (no abrupt snapping).
      if (distSq < 400) {
        const targetYaw = Math.atan2(dx, dz);
        // Lerp toward the target yaw to avoid spinning.
        const cur = root.rotation.y;
        let diff = targetYaw - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        root.rotation.y = cur + diff * Math.min(1, dt * 4);
      }
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = npc;
      }
    }

    const dist = Math.sqrt(nearestDistSq);
    // Acquire focus when entering INTERACT_RANGE; release once outside STAY_RANGE.
    if (this.focused) {
      if (this.focused !== nearest || dist > this.STAY_RANGE) {
        this.closeBubble();
        this.focused = null;
      }
    }
    if (!this.focused && nearest && dist <= this.INTERACT_RANGE) {
      this.focused = nearest;
    }

    // Prompt + bubble positioning. Hide everything if a shop modal owns input.
    const shopBlocking = this.shopOpenProvider() || this.inputBlockedProvider();
    if (this.focused && !shopBlocking) {
      const root = this.focused.humanoid.getRoot() as BABYLON.TransformNode;
      // Project a point above the head into screen space.
      const headWorld = new BABYLON.Vector3(root.position.x, root.position.y + 2.1, root.position.z);
      const engine = this.scene.getEngine();
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const transform = this.scene.getTransformMatrix();
      const viewport = this.camera.viewport.toGlobal(w, h);
      const screen = BABYLON.Vector3.Project(headWorld, BABYLON.Matrix.Identity(), transform, viewport);
      // Cull when the head projects behind the camera.
      if (screen.z < 0 || screen.z > 1) {
        this.promptEl.style.display = "none";
        this.bubbleEl.style.display = "none";
      } else if (this.bubbleOpen) {
        this.bubbleEl.style.left = `${screen.x}px`;
        this.bubbleEl.style.top = `${screen.y}px`;
        this.bubbleEl.style.display = "block";
        this.promptEl.style.display = "none";
      } else {
        this.promptEl.style.left = `${screen.x}px`;
        this.promptEl.style.top = `${screen.y}px`;
        this.promptEl.style.display = "block";
        this.bubbleEl.style.display = "none";
      }
    } else {
      this.promptEl.style.display = "none";
      this.bubbleEl.style.display = "none";
    }
  }

  private renderBubble(): void {
    if (!this.focused) return;
    const dlg = this.focused.def.dialogue;
    const idx = this.focused.dialogueIndex;
    this.bubbleHeaderEl.textContent = `${dlg.name}  ·  ${idx + 1}/${dlg.lines.length}`;
    this.bubbleBodyEl.textContent = dlg.lines[idx] ?? "";
    this.bubbleHintEl.textContent = idx + 1 < dlg.lines.length ? "[E] CONTINUE" : "[E] CLOSE";
    // Mirror to the in-game UI message log too — handy if the bubble scrolls
    // off screen during a dodge.
    this.bus.emit(GameEvents.UI_MESSAGE, `${dlg.name}: ${dlg.lines[idx]}`);
  }

  private closeBubble(): void {
    this.bubbleOpen = false;
    this.bubbleEl.style.display = "none";
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
    if (this.gamepadHandler) {
      window.removeEventListener("gamepad-menu", this.gamepadHandler);
      this.gamepadHandler = null;
    }
    for (const npc of this.npcs) {
      try { npc.humanoid.dispose(); } catch {}
    }
    this.npcs = [];
    this.root.remove();
  }
}
