# How to debug HMR and WebSocket issues

Heavy Water runs **two** WebSocket servers on the same HTTP server:

- Multiplayer at `/ws` ([`server/multiplayer.ts`](../../server/multiplayer.ts))
- Vite HMR at `/vite-hmr` ([`server/vite.ts`](../../server/vite.ts), dev only)

This is the most fragile part of the dev setup. Here is the playbook.

## Symptom: `wss://localhost:undefined/?token=…` in the console

This is **Vite's reconnect-fallback path** firing. It means the Vite
client lost its primary HMR connection and tried a fallback URL. The
URL is malformed because, in middleware mode, Vite doesn't inject
`__HMR_PORT__` and the fallback uses `import.meta.url` which has no
explicit port on the Replit dev domain.

If it's a **single, transient** warning — the page loaded, then the
primary HMR re-established. Annoying but harmless.

If it's **followed by reconnect cycling** ("server connection lost.
Polling for restart…") — the primary HMR is broken and a real fix is
required.

## Root cause for the cycling case

The `ws` library's `WebSocketServer({ server, path })` shorthand
registers a global `upgrade` listener that calls `abortHandshake(socket, 400)`
for **any** non-matching path. If two WSS instances both use the
shorthand on the same http server, whichever is registered first
swallows every upgrade and rejects it with 400 — including the other
instance's traffic.

In Heavy Water, multiplayer is registered first (inside `registerRoutes`),
then Vite. So pre-fix, multiplayer was rejecting `/vite-hmr` upgrades
with 400 before Vite's listener could see them.

## The fix (already applied)

[`server/multiplayer.ts`](../../server/multiplayer.ts) uses
`{ noServer: true }` and routes upgrades manually:

```ts
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  let pathname: string;
  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return; // malformed — let other listeners handle it
  }
  if (pathname !== "/ws") return; // not ours, fall through to Vite HMR
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});
```

The key is `return;` for non-matching paths — it lets the upgrade event
flow to Vite's listener instead of aborting the socket.

## Future-proofing

If you ever add a **third** WebSocket endpoint:

- Use `{ noServer: true }` for it.
- Add a path check that `return`s on mismatch.
- Do **not** use the `{ server, path }` shorthand on the shared http
  server.

## What we tried that failed

For posterity (so the next person doesn't repeat them):

- ❌ **`hmr.clientPort = 443` + `hmr.protocol = "wss"`.** The Replit
  dev proxy refuses WS upgrades with an explicit `:443` in the URL.
  Only the implicit-port form `wss://host/vite-hmr` works.
- ❌ **`hmr.host = REPLIT_DEV_DOMAIN`.** Causes Vite to try to rebind
  the HMR server on that hostname, which never accepts the proxied
  connection.

A comment block in [`server/vite.ts`](../../server/vite.ts) records
both dead-ends so they don't get tried again.

## Diagnostic checklist

1. Open the browser console. Expect:
   ```
   [vite] connecting...
   [vite] connected.
   ```
   Anything else is a regression.
2. Test multiplayer: connect from two windows, create + join a room.
   Both should connect; the server should log `WebSocket multiplayer
   server started on /ws`.
3. Edit a `.tsx` file. Save. The browser should hot-reload without a
   full page refresh.
4. Restart the workflow. The browser should reconnect within 1-2
   seconds (Vite's auto-reconnect) without errors.

If any of these fail, the most likely cause is a recently-added third
WebSocket endpoint using the `{ server, path }` shorthand. Find it and
convert it.
