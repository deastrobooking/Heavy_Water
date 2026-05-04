# EventBus & StateMachine

The two glue primitives every system in Heavy Water depends on.

## EventBus

File: [`client/src/game/EventBus.ts`](../../client/src/game/EventBus.ts)

A typed pub/sub singleton. Every cross-system message goes through it.

### API

```ts
const bus = EventBus.getInstance();

bus.on(GameEvents.ENEMY_KILLED, (data) => { /* … */ });
bus.off(GameEvents.ENEMY_KILLED, handlerRef);
bus.emit(GameEvents.ENEMY_KILLED, { enemyId, position });
bus.clear(); // wipe ALL listeners — used during init failure recovery
```

### `GameEvents` constants

The full event catalog lives in `EventBus.ts` as `GameEvents`. See
[`reference/game-events.md`](../reference/game-events.md) for the
formatted lookup table.

### Conventions

- **Producers**: any system can emit. Most events have multiple emitters.
- **Consumers**: every consumer must save its handler ref so it can
  `bus.off()` in `dispose()`. Forgetting this is the #1 cause of ghost
  behavior across level transitions.
- **Payloads**: documented as JSDoc above each event constant. That
  comment is the only contract — keep it accurate.
- **`bus.clear()`** is a sledgehammer. The only legitimate caller is
  `Game.tsx`'s init-failure recovery path. Never call it from a system.

### Why a custom bus instead of an existing lib

- One source of truth (`GameEvents`) keeps event names typed at the
  string level via const-as-const.
- No transitive dependency for one of the most-used primitives.
- Trivial to extend (adding `bus.once` or wildcard matching is a
  one-line change if needed later).

## StateMachine

File: [`client/src/game/StateMachine.ts`](../../client/src/game/StateMachine.ts)

A generic finite-state-machine reused by enemies, the player, vehicles,
and bosses.

### API

```ts
const sm = new StateMachine<EnemyState>("idle", {
  idle:    { onEnter, onUpdate, onExit },
  chase:   { onEnter, onUpdate, onExit },
  attack:  { onEnter, onUpdate, onExit },
  recover: { onEnter, onUpdate, onExit },
});

sm.transition("chase");      // fires exit → enter
sm.update(deltaSeconds);     // calls current state's onUpdate
sm.current;                  // read-only current state name
```

States are plain objects with optional `onEnter` / `onUpdate` / `onExit`
hooks. The machine handles transition guards (no-op transition to the
same state) and exit/enter ordering.

### Where it's used

| User | Purpose |
|---|---|
| `EnemySystem` | Per-enemy behavior FSM (idle → chase → attack → recover). |
| `PlayerController` | Movement modes (grounded → jumping → flying → smashing). |
| `VehicleSystem` | Vehicle modes (parked → driving → boosting → wrecked). |
| `EnemyBaseSystem` | Base lifecycle (active → turrets-cleared → vault-open). |
| Boss systems | Phase transitions. |

### Conventions

- Keep `onUpdate` cheap — it runs every frame.
- Push side-effects into `onEnter` / `onExit`, not `onUpdate`.
- Emit EventBus events from transitions when other systems need to
  react (e.g. `ENEMY_STATE_CHANGED`).
