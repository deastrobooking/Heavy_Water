# How to add a new game event

The EventBus is the only sanctioned way for systems to talk to each
other. Adding a new event is cheap and is almost always the right call
when you find yourself wanting one system to import another.

## 1. Declare the event

File: [`client/src/game/EventBus.ts`](../../client/src/game/EventBus.ts)

```ts
export const GameEvents = {
  // …existing…
  /** Fired when the player crafts a Power Jewel.
   *  Payload: { tier: "rough" | "cut" | "flawless", x: number, z: number }. */
  JEWEL_CRAFTED: "jewel:crafted",
};
```

**Use a JSDoc comment** above every new event describing the payload
shape. That comment is the only contract listeners will see, so make it
exact.

## 2. Emit it

From the producing system:

```ts
import { EventBus, GameEvents } from "./EventBus";
EventBus.getInstance().emit(GameEvents.JEWEL_CRAFTED, {
  tier: "rough",
  x: pos.x,
  z: pos.z,
});
```

## 3. Listen for it

From the consuming system, in its constructor:

```ts
this.onJewel = (data: any) => this.handleJewel(data);
this.bus.on(GameEvents.JEWEL_CRAFTED, this.onJewel);
```

In `dispose`:

```ts
this.bus.off(GameEvents.JEWEL_CRAFTED, this.onJewel);
```

**Always unsubscribe in dispose.** Forgetting this is the #1 cause of
ghost behavior across level transitions.

## 4. Reflect cross-cutting concerns

If the event needs to:

- **Persist** → add a field to `ProgressSnapshot` and snapshot/restore it
  in `ProgressSync.ts`.
- **Save immediately** → call `forceSaveRef.current?.()` from the
  Game.tsx-level listener so the player can't lose the change to a
  crash. Most "milestone" events do this.
- **Render in HUD** → emit a `UI_MESSAGE` alongside or have the HUD
  component subscribe directly.

## 5. Document it

Add a row to [`reference/game-events.md`](../reference/game-events.md)
with the payload shape and the producers / consumers.

## Patterns to copy

| Need | Look at |
|---|---|
| One-shot milestone with persistence | `LEGENDARY_COMPANION_GRANTED` flow in `Game.tsx` |
| Boss-defeat radius gating | `SWARMS_GENERAL_DEFEATED` in `SwarmsLairSystem.handleEnemyKilled` |
| Player progression event | `PLAYER_LEVEL_UP` consumers across UI + ProgressSync |
| UI-only ephemeral message | `UI_MESSAGE` (just a short string) |

## Anti-patterns

- ❌ Don't emit events from inside an event handler synchronously without
  thinking — you can re-enter the same handler. If you need to fan out,
  use `queueMicrotask(...)` or store and emit on the next tick.
- ❌ Don't pass mesh references through events. Pass IDs or coordinates.
  Listeners may be in a different scene state than the emitter expects.
- ❌ Don't add system-private events to `GameEvents`. Keep the bus for
  **cross-system** comms; use direct method calls within a single system.
