import * as BABYLON from "@babylonjs/core";

interface ButtonMap {
  [buttonIndex: number]: { code: string; key?: string };
}

// Controller bindings (Xbox-style indices):
//  0 (A) → Space (jump / fly)
//  1 (B) → KeyE (interact: enter vehicle, talk, mount)
//  2 (X) → KeyV (capture)
//  3 (Y) → KeyY (beam-sabre slash; matches the keyboard binding)
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

    const prev = this.prevButtons.get(activePad.index) ?? [];
    const next: boolean[] = [];

    for (let i = 0; i < activePad.buttons.length; i++) {
      const pressed = activePad.buttons[i].pressed || activePad.buttons[i].value > 0.5;
      next[i] = pressed;
      const wasPressed = prev[i] ?? false;
      const map = BUTTON_TO_KEY[i];
      if (map) {
        if (pressed && !wasPressed) this.dispatchKeyDown(map.code, map.key);
        else if (!pressed && wasPressed) this.dispatchKeyUp(map.code, map.key);
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
      if (this.prevTriggers.lt) this.releaseLT(this.prevTriggerContext);
      if (this.prevTriggers.rt) this.releaseRT(this.prevTriggerContext);
      this.prevTriggers.lt = false;
      this.prevTriggers.rt = false;
      this.prevTriggerContext = context;
    }

    if (context === "vehicle") {
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
    if (this.prevTriggers.rt) { this.releaseRT(this.prevTriggerContext); this.prevTriggers.rt = false; }
    if (this.prevTriggers.lt) { this.releaseLT(this.prevTriggerContext); this.prevTriggers.lt = false; }
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
