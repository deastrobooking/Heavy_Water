import * as BABYLON from "@babylonjs/core";

interface ButtonMap {
  [buttonIndex: number]: { code: string; key?: string };
}

// Controller bindings (Xbox-style indices):
//  0 (A) → Space (jump / fly)
//  1 (B) → KeyE (interact: enter vehicle, talk, mount)
//  2 (X) → KeyV (capture)        — but if LT is held → Quote (Smash Lash combo)
//  3 (Y) → KeyY (beam-sabre slash) — but if LT is held → Semicolon (Fury Slash combo)
//  4 (LB) → KeyL (boost dash with i-frames)
//  5 (RB) → KeyK (cast currently-selected elemental special)
//  8 (Select / View) → Tab (upgrade menu)
//  9 (Start / Menu) → KeyG (build mode)
// 10 (L3) → ShiftLeft (sprint)
// 11 (R3) → KeyC (toggle 1st/3rd person)
// 12 (D-Pad Up) → KeyO (cycle current elemental special UP)
// 13 (D-Pad Down) → Period (cycle current elemental special DOWN)
// 14 (D-Pad Left) → Comma (cycle weapon LEFT)
// 15 (D-Pad Right) → Slash (cycle weapon RIGHT)
const BUTTON_TO_KEY: ButtonMap = {
  0: { code: "Space", key: " " },
  1: { code: "KeyE", key: "e" },
  2: { code: "KeyV", key: "v" },
  3: { code: "KeyY", key: "y" },
  4: { code: "KeyL", key: "l" },
  5: { code: "KeyK", key: "k" },
  8: { code: "Tab", key: "Tab" },
  9: { code: "KeyG", key: "g" },
  10: { code: "ShiftLeft", key: "Shift" },
  11: { code: "KeyC", key: "c" },
  12: { code: "KeyO", key: "o" },
  13: { code: "Period", key: "." },
  14: { code: "Comma", key: "," },
  15: { code: "Slash", key: "/" },
};

const TRIGGER_THRESHOLD = 0.5;
const STICK_DEADZONE = 0.22;
const LOOK_SENSITIVITY_YAW = 2.4;
const LOOK_SENSITIVITY_PITCH = 1.6;
const PITCH_LIMIT = 1.4;

type ConnectionListener = (connected: boolean, padId: string) => void;

export class GamepadInput {
  private camera: BABYLON.FreeCamera;
  private rafHandle: number | null = null;
  private prevButtons = new Map<number, boolean[]>();
  private prevAxisKeys = { w: false, a: false, s: false, d: false };
  private prevTriggers = { lt: false, rt: false };
  // Per-button combo override: when Y/X is pressed while LT is held we
  // dispatch a combo key (KeyU / KeyI). We must remember which combo key
  // was sent on the press so the matching key-up is sent on release even
  // if LT was released first.
  private comboOverride: Record<number, { code: string; key?: string } | null> = {
    2: null,
    3: null,
  };
  // Track the last context the triggers were dispatched for so we can
  // release the previous mapping cleanly when the player enters/exits
  // a vehicle while a trigger is held.
  private prevTriggerContext: "foot" | "vehicle" = "foot";
  private lastTime = performance.now();
  private listeners: ConnectionListener[] = [];
  private onConnect = (e: GamepadEvent) => this.notify(true, e.gamepad.id);
  private onDisconnect = (e: GamepadEvent) => this.notify(false, e.gamepad.id);
  private isActive = false;
  // When the player is driving a vehicle, LT/RT should drive the throttle
  // and reverse instead of firing the weapon / beam slash. The host wires
  // this provider so the gamepad can ask which context to use each frame.
  private contextProvider: (() => "foot" | "vehicle") | null = null;
  // Hard override: when true (set by SpaceLevelSystem on warp-in), BOTH
  // triggers re-route to the on-foot firing bindings so the player can
  // shoot from the orbital fighter — the spacecraft locks throttle on
  // anyway, so the vehicle KeyW/KeyS mapping isn't useful in space. RT
  // dispatches LMB (primary fire) and LT dispatches LMB + KeyJ together,
  // which trips the existing combo window and fires the Mega Beam Cannon
  // alongside the regular shot. Cleared on warp-out.
  private spacecraftMode: boolean = false;
  // While the upgrade menu (or other modal that registers itself as menu)
  // is open, the gamepad swaps into pure-navigation mode: D-Pad cycles
  // tabs / rows, A activates the selected row, B closes. ALL gameplay
  // bindings are suppressed for the duration so the player can't keep
  // shooting / moving the camera through the menu, and nothing leaks
  // when the menu opens with a button held.
  private menuOpenProvider: (() => boolean) | null = null;
  private prevMenuOpen: boolean = false;

  constructor(camera: BABYLON.FreeCamera) {
    this.camera = camera;
    window.addEventListener("gamepadconnected", this.onConnect);
    window.addEventListener("gamepaddisconnected", this.onDisconnect);
    this.tick = this.tick.bind(this);
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  onConnectionChange(fn: ConnectionListener): void {
    this.listeners.push(fn);
  }

  isPadActive(): boolean {
    return this.isActive;
  }

  /** Tell the gamepad whether the player is on foot or driving a vehicle.
   *  In "vehicle" context, LT becomes reverse/brake (KeyS) and RT becomes
   *  throttle (KeyW). In "foot" context, LT slashes (KeyJ) and RT fires
   *  the weapon (LMB). */
  setContextProvider(fn: () => "foot" | "vehicle"): void {
    this.contextProvider = fn;
  }

  /** Register a predicate that returns whether a menu / modal is currently
   *  open. While open, the gamepad enters pure-navigation mode (D-Pad +
   *  A/B fire `gamepad-menu` CustomEvents on `window`) and suppresses all
   *  gameplay bindings (sticks, triggers, face buttons, D-Pad keys). */
  setMenuOpenProvider(fn: () => boolean): void {
    this.menuOpenProvider = fn;
  }

  /** Flip spacecraft trigger overrides on/off. Called by SpaceLevelSystem
   *  when the orbital fighter is mounted/unmounted so LT and RT both fire
   *  weapons (and LT additionally drives the Mega Beam Cannon combo). */
  setSpacecraftMode(active: boolean): void {
    if (this.spacecraftMode === active) return;
    // Release whatever was held under the OLD mapping before switching so
    // we don't leave a stuck KeyW / KeyS / LMB / KeyJ across the swap.
    if (this.spacecraftMode) {
      this.releaseSpacecraftTriggers();
    } else {
      if (this.prevTriggers.lt) this.releaseLT(this.prevTriggerContext);
      if (this.prevTriggers.rt) this.releaseRT(this.prevTriggerContext);
    }
    this.prevTriggers.lt = false;
    this.prevTriggers.rt = false;
    this.spacecraftMode = active;
  }

  /** Lift any LMB / KeyJ that the spacecraft trigger mapping latched.
   *  LMB is ref-counted on (lt OR rt) so it's released exactly once if
   *  either trigger was down. KeyJ tracks LT alone. Used by mode swap,
   *  context change, and gamepad-disconnect cleanup. */
  private releaseSpacecraftTriggers(): void {
    if (this.prevTriggers.lt || this.prevTriggers.rt) {
      this.dispatchMouseButton(false, 0);
    }
    if (this.prevTriggers.lt) {
      this.dispatchKeyUp("KeyJ", "j");
    }
  }

  private notify(connected: boolean, id: string): void {
    for (const fn of this.listeners) fn(connected, id);
  }

  private dispatchKeyDown(code: string, key?: string): void {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, key: key ?? code, bubbles: true }));
  }
  private dispatchKeyUp(code: string, key?: string): void {
    window.dispatchEvent(new KeyboardEvent("keyup", { code, key: key ?? code, bubbles: true }));
  }

  private dispatchMouseButton(down: boolean, button: 0 | 2): void {
    const type = down ? "mousedown" : "mouseup";
    const ptype = down ? "pointerdown" : "pointerup";
    const init = {
      bubbles: true,
      cancelable: true,
      button,
      buttons: down ? (button === 0 ? 1 : 2) : 0,
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight / 2,
    } as MouseEventInit & PointerEventInit;
    window.dispatchEvent(new MouseEvent(type, init));
    try {
      window.dispatchEvent(new PointerEvent(ptype, { ...init, pointerId: 1, pointerType: "mouse" }));
    } catch {
      // PointerEvent constructor may not be supported in some test envs
    }
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let activePad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        activePad = p;
        break;
      }
    }

    if (!activePad) {
      if (this.isActive) {
        this.isActive = false;
        this.releaseAll();
      }
      this.rafHandle = requestAnimationFrame(this.tick);
      return;
    }
    this.isActive = true;

    // Menu-mode swap. On the open transition we lift every held gameplay
    // key/mouse so nothing stays stuck behind the modal; on the close
    // transition we snapshot the current button state so a button held
    // during menu nav doesn't fire as a fresh gameplay press the moment
    // the menu closes.
    const menuOpen = this.menuOpenProvider ? this.menuOpenProvider() : false;
    if (menuOpen !== this.prevMenuOpen) {
      this.releaseAll();
      const snap: boolean[] = [];
      for (let i = 0; i < activePad.buttons.length; i++) {
        snap[i] = activePad.buttons[i].pressed || activePad.buttons[i].value > 0.5;
      }
      this.prevButtons.set(activePad.index, snap);
      this.prevMenuOpen = menuOpen;
    }
    if (menuOpen) {
      this.handleMenuMode(activePad);
      this.rafHandle = requestAnimationFrame(this.tick);
      return;
    }

    const prev = this.prevButtons.get(activePad.index) ?? [];
    const next: boolean[] = [];

    // Pre-read LT so we can re-route Y/X press transitions into combo keys
    // (KeyU / KeyI) when LT is currently held. We still dispatch the normal
    // mapping if LT is not held.
    const ltHeldNow = (activePad.buttons[6]?.value ?? (activePad.buttons[6]?.pressed ? 1 : 0)) >= TRIGGER_THRESHOLD;
    const footCtxNow: "foot" | "vehicle" = this.contextProvider ? this.contextProvider() : "foot";

    for (let i = 0; i < activePad.buttons.length; i++) {
      const pressed = activePad.buttons[i].pressed || activePad.buttons[i].value > 0.5;
      next[i] = pressed;
      const wasPressed = prev[i] ?? false;
      const map = BUTTON_TO_KEY[i];
      if (map) {
        // Combo override: while LT is held on foot, Y/X fire beam-sabre
        // specials (Fury / Smash) instead of their normal bindings. Track
        // the override per-button so the matching key-up is dispatched even
        // if LT is released before the face button.
        let dispatchCode = map.code;
        let dispatchKey = map.key;
        const isComboButton = (i === 3 || i === 2) && footCtxNow === "foot";
        if (isComboButton) {
          // On press: if LT is held now, route to combo key. On release:
          // route to whichever code was pressed at down-time.
          if (pressed && !wasPressed) {
            if (ltHeldNow) {
              dispatchCode = i === 3 ? "Semicolon" : "Quote";
              dispatchKey = i === 3 ? ";" : "'";
              this.comboOverride[i] = { code: dispatchCode, key: dispatchKey };
            } else {
              this.comboOverride[i] = null;
            }
          } else if (!pressed && wasPressed) {
            const ov = this.comboOverride[i];
            if (ov) {
              dispatchCode = ov.code;
              dispatchKey = ov.key;
              this.comboOverride[i] = null;
            }
          }
        }
        if (pressed && !wasPressed) this.dispatchKeyDown(dispatchCode, dispatchKey);
        else if (!pressed && wasPressed) this.dispatchKeyUp(dispatchCode, dispatchKey);
      }
    }
    this.prevButtons.set(activePad.index, next);

    const ltVal = activePad.buttons[6]?.value ?? (activePad.buttons[6]?.pressed ? 1 : 0);
    const rtVal = activePad.buttons[7]?.value ?? (activePad.buttons[7]?.pressed ? 1 : 0);
    const ltDown = ltVal >= TRIGGER_THRESHOLD;
    const rtDown = rtVal >= TRIGGER_THRESHOLD;

    const context: "foot" | "vehicle" = this.contextProvider ? this.contextProvider() : "foot";

    // If the context changed while a trigger is held, release the old
    // binding before dispatching the new one so we don't leave a "stuck"
    // KeyW/KeyS/LMB after entering or exiting a vehicle.
    if (context !== this.prevTriggerContext) {
      // Spacecraft mode owns its own LMB/KeyJ mapping regardless of the
      // foot/vehicle context, so use the spacecraft release path when
      // it's active — otherwise we'd send KeyW/KeyS up while the player
      // is actually firing LMB and leak a stuck mouse button.
      if (this.spacecraftMode) {
        this.releaseSpacecraftTriggers();
      } else {
        if (this.prevTriggers.lt) this.releaseLT(this.prevTriggerContext);
        if (this.prevTriggers.rt) this.releaseRT(this.prevTriggerContext);
      }
      this.prevTriggers.lt = false;
      this.prevTriggers.rt = false;
      this.prevTriggerContext = context;
    }

    if (this.spacecraftMode) {
      // Orbital fighter: throttle is locked by SpaceLevelSystem so RT/LT
      // are repurposed for combat. Either trigger fires the primary
      // weapon (LMB), and LT additionally pulses KeyJ on the same edge so
      // the existing LMB+J combo window triggers the Mega Beam Cannon
      // alongside the regular shot.
      //
      // LMB is ref-counted on the COMBINED trigger intent (lt OR rt) so
      // releasing one trigger while the other is still held doesn't
      // prematurely send mouseup and stop the fire stream.
      const wantFire = ltDown || rtDown;
      const hadFire = this.prevTriggers.lt || this.prevTriggers.rt;
      if (wantFire && !hadFire) this.dispatchMouseButton(true, 0);
      else if (!wantFire && hadFire) this.dispatchMouseButton(false, 0);
      // KeyJ tracks LT alone — it's the combo half that drives the Mega
      // Beam Cannon and the Beam Sabre slash.
      if (ltDown && !this.prevTriggers.lt) this.dispatchKeyDown("KeyJ", "j");
      else if (!ltDown && this.prevTriggers.lt) this.dispatchKeyUp("KeyJ", "j");
    } else if (context === "vehicle") {
      // Vehicle: RT → throttle (KeyW), LT → reverse / brake (KeyS).
      if (rtDown && !this.prevTriggers.rt) this.dispatchKeyDown("KeyW", "w");
      else if (!rtDown && this.prevTriggers.rt) this.dispatchKeyUp("KeyW", "w");
      if (ltDown && !this.prevTriggers.lt) this.dispatchKeyDown("KeyS", "s");
      else if (!ltDown && this.prevTriggers.lt) this.dispatchKeyUp("KeyS", "s");
    } else {
      // On foot: RT → primary fire (LMB), LT → beam slash (KeyJ).
      if (rtDown && !this.prevTriggers.rt) this.dispatchMouseButton(true, 0);
      else if (!rtDown && this.prevTriggers.rt) this.dispatchMouseButton(false, 0);
      if (ltDown && !this.prevTriggers.lt) this.dispatchKeyDown("KeyJ", "j");
      else if (!ltDown && this.prevTriggers.lt) this.dispatchKeyUp("KeyJ", "j");
    }
    this.prevTriggers.lt = ltDown;
    this.prevTriggers.rt = rtDown;

    const lx = this.applyDeadzone(activePad.axes[0] ?? 0);
    const ly = this.applyDeadzone(activePad.axes[1] ?? 0);
    const wantW = ly < -0.05;
    const wantS = ly > 0.05;
    const wantA = lx < -0.05;
    const wantD = lx > 0.05;
    this.toggleAxisKey("w", wantW, "KeyW");
    this.toggleAxisKey("s", wantS, "KeyS");
    this.toggleAxisKey("a", wantA, "KeyA");
    this.toggleAxisKey("d", wantD, "KeyD");

    const rx = this.applyDeadzone(activePad.axes[2] ?? 0);
    const ry = this.applyDeadzone(activePad.axes[3] ?? 0);
    if (rx !== 0 || ry !== 0) {
      this.camera.rotation.y += rx * LOOK_SENSITIVITY_YAW * dt;
      this.camera.rotation.x += ry * LOOK_SENSITIVITY_PITCH * dt;
      this.camera.rotation.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.camera.rotation.x));
    }

    this.rafHandle = requestAnimationFrame(this.tick);
  }

  /** Pure-navigation mode: only edge-fire CustomEvents for the 6 nav
   *  buttons (D-Pad + A + B). All other inputs (sticks, triggers, face
   *  combo overrides) are suppressed so the menu can't leak gameplay
   *  side-effects like camera spin or weapon fire. */
  private handleMenuMode(pad: Gamepad): void {
    const NAV: Record<number, "activate" | "close" | "up" | "down" | "left" | "right"> = {
      0: "activate", // A — confirm / press selected button
      1: "close",    // B — close the menu
      12: "up",      // D-Pad Up — previous row
      13: "down",    // D-Pad Down — next row
      14: "left",    // D-Pad Left — previous tab
      15: "right",   // D-Pad Right — next tab
    };
    const prev = this.prevButtons.get(pad.index) ?? [];
    const next: boolean[] = [];
    for (let i = 0; i < pad.buttons.length; i++) {
      const pressed = pad.buttons[i].pressed || pad.buttons[i].value > 0.5;
      next[i] = pressed;
      const wasPressed = prev[i] ?? false;
      const action = NAV[i];
      if (action && pressed && !wasPressed) {
        window.dispatchEvent(new CustomEvent("gamepad-menu", { detail: { action } }));
      }
    }
    this.prevButtons.set(pad.index, next);
  }

  private releaseLT(ctx: "foot" | "vehicle"): void {
    if (ctx === "vehicle") this.dispatchKeyUp("KeyS", "s");
    else this.dispatchKeyUp("KeyJ", "j");
  }

  private releaseRT(ctx: "foot" | "vehicle"): void {
    if (ctx === "vehicle") this.dispatchKeyUp("KeyW", "w");
    else this.dispatchMouseButton(false, 0);
  }

  private applyDeadzone(v: number): number {
    if (Math.abs(v) < STICK_DEADZONE) return 0;
    const sign = Math.sign(v);
    return sign * (Math.abs(v) - STICK_DEADZONE) / (1 - STICK_DEADZONE);
  }

  private toggleAxisKey(slot: "w" | "a" | "s" | "d", want: boolean, code: string): void {
    const prev = this.prevAxisKeys[slot];
    if (want && !prev) this.dispatchKeyDown(code, code.replace("Key", "").toLowerCase());
    else if (!want && prev) this.dispatchKeyUp(code, code.replace("Key", "").toLowerCase());
    this.prevAxisKeys[slot] = want;
  }

  private releaseAll(): void {
    for (const slot of ["w", "a", "s", "d"] as const) {
      if (this.prevAxisKeys[slot]) {
        const code = "Key" + slot.toUpperCase();
        this.dispatchKeyUp(code, slot);
        this.prevAxisKeys[slot] = false;
      }
    }
    if (this.spacecraftMode) {
      this.releaseSpacecraftTriggers();
      this.prevTriggers.lt = false;
      this.prevTriggers.rt = false;
    } else {
      if (this.prevTriggers.rt) { this.releaseRT(this.prevTriggerContext); this.prevTriggers.rt = false; }
      if (this.prevTriggers.lt) { this.releaseLT(this.prevTriggerContext); this.prevTriggers.lt = false; }
    }
    this.prevButtons.forEach((prev, padIndex) => {
      for (let i = 0; i < prev.length; i++) {
        const map = BUTTON_TO_KEY[i];
        if (map && prev[i]) this.dispatchKeyUp(map.code, map.key);
      }
      this.prevButtons.set(padIndex, []);
    });
  }

  dispose(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    this.releaseAll();
    window.removeEventListener("gamepadconnected", this.onConnect);
    window.removeEventListener("gamepaddisconnected", this.onDisconnect);
    this.listeners = [];
    this.prevButtons.clear();
  }
}
