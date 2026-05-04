# Troubleshooting

Common problems and their fixes.

## "Cannot connect to DB" / `ECONNREFUSED` on boot

`DATABASE_URL` is missing or wrong. Set it (see
[`getting-started.md`](getting-started.md)). On Replit, use the
built-in Postgres which exports `DATABASE_URL` automatically.

## `npm run db:push` reports a destructive change

Drizzle is protecting you from data loss. Either:

- Adjust the schema so the change is non-destructive (add nullable
  columns instead of dropping; rename via two-step), or
- If you accept the loss, run `npm run db:push -- --force`.

## Browser shows "server connection lost. Polling for restart…"

Vite HMR is broken. Most likely cause: a new WebSocket endpoint was
added with the `{ server, path }` shorthand and is rejecting Vite's
upgrades. See [`how-to/debug-hmr-and-websockets.md`](how-to/debug-hmr-and-websockets.md).

## `wss://localhost:undefined/?token=…` in the console

Vite's reconnect-fallback URL. Single transient occurrence is harmless.
If it cycles, see the same HMR/WebSocket guide.

## Login succeeds but `/api/auth/me` returns 401 immediately after

The session cookie isn't being sent. Causes:

- `credentials: "include"` missing on a fetch call.
- Cross-origin: the client and server are on different origins. They
  must share an origin or you must configure CORS + `SameSite=None;
  Secure` cookies.
- `SESSION_SECRET` changed between the cookie's issue and the read —
  invalidates all sessions.

## Save data loaded but a system shows defaults

Either:

- The system isn't reading from `ProgressSnapshot` — it should, in
  the `Game.tsx` load handler.
- The snapshot was saved before the field existed. Always default
  with `??` when restoring: `snapshot.myField ?? defaultValue`.

## Mesh sinks into the ground

The mesh wasn't placed at `height/2`. This is a project-wide invariant
(see `replit.md`). Fix: add `height/2` to the y-component in your
position math.

## Boss respawns every time the player re-enters a side-zone

You forgot to read the persisted "defeated" flag in the side-zone
system's constructor. Pattern: accept `alreadyDefeated: boolean` and
short-circuit the boss spawn + the kill listener registration when
true. See `SwarmsLairSystem` for a reference.

## Listeners fire after a level transition

The previous level's system didn't `bus.off()` in `dispose`. Audit:
every `bus.on(...)` in the system must have a matching `bus.off(...)`
in `dispose`. Save the handler reference at the top of the constructor
so you can pass the same fn to `off`.

## "Maximum call stack" in EventBus

You emitted an event from inside its own handler synchronously, causing
infinite recursion. Wrap the re-emit in `queueMicrotask(...)` or guard
against re-entry with a flag.

## TypeScript fails after pulling main

The schema or `ProgressSnapshot` shape changed. Run:

```bash
npm install
npm run check
```

If errors persist, your local node_modules is stale; nuke and reinstall:

```bash
rm -rf node_modules package-lock.json
npm install
```

## Workflow restarts but the page doesn't reload

Vite's auto-reconnect handles this within ~1-2 seconds. If it hangs,
hard-refresh. If hard-refresh hangs, the server didn't actually start —
check the workflow logs.

## "DOMException: The play() request was interrupted"

Browser audio autoplay restrictions. The player must click anything on
the page before audio plays. The auth screen click satisfies this in
practice.

## Debug helpers

- `console.log` from any system shows up in the browser devtools.
- `window.__GAME__` is **not** exposed by default; if you want a debug
  handle, set `(window as any).__GAME__ = { engine, scene, …}` from
  inside `Game.tsx#initializeGame`.
- For server-side debugging, the workflow logs include every Express
  request line — read them with the workflow log tools.

If your problem isn't here, open an issue with the smallest reproducer
you can provide and what you've already tried.
