# Multiplayer

Heavy Water supports up to **16 players per room** with two room kinds:

- **`coop`** — campaign / wave-defense in the open world.
- **`versus`** — PvP arena on a compact 320×320 walled map.

## Components

| File | Role |
|---|---|
| [`server/multiplayer.ts`](../../server/multiplayer.ts) | `ws` WebSocketServer in `noServer` mode, manual upgrade routing on `/ws`. Owns rooms, broadcast, and message dispatch. |
| [`client/src/game/MultiplayerSystem.ts`](../../client/src/game/MultiplayerSystem.ts) | Client connection, room state, position broadcast, action mirroring, chat, enemy-damage sync. |
| [`shared/schema.ts`](../../shared/schema.ts) | `gameSessions` table — persisted room metadata. |

## Wire protocol

JSON over WS. See [`reference/websocket-protocol.md`](../reference/websocket-protocol.md)
for the formatted message catalog. Categories:

- **Auth + lobby**: `auth`, `create_room`, `join_room`, `leave_room`,
  `list_rooms`.
- **Real-time sync**: `position_update`, `action`, `enemy_damage`.
- **Out-of-band**: `chat`, `ping`.

The server tracks each authenticated socket by an internal `playerId`
and routes broadcasts using the player's current `roomCode`. Most
inbound client messages are echoed back out as `player_*` events
(`player_joined`, `player_left`, `player_update`, `player_action`,
`chat_message`, `enemy_damage`).

## Room lifecycle

```
create_room → server allocates 8-char roomCode, stores in gameSessions
join_room  → server adds player to in-memory roster, broadcasts presence
position_update / action / enemy_damage → server fans out to room peers
leave_room (or socket close) → server removes, broadcasts; if empty, deletes room
```

The `gameSessions` table is mostly for listing rooms in the lobby UI;
the in-flight roster is in-memory.

## Versus mode specifics

The PvP map is deterministic — the seeded layout is built client-side
in `MultiplayerSystem` from a seed shared via `join_room`. Players
spawn at fixed points keyed by player index. Open-world meshes (city,
mountains, foliage, enemy spawner) are suppressed while in a versus
room.

## Why `noServer: true`

`ws`'s `{ server, path }` shorthand registers a global `upgrade`
listener that rejects every non-matching path with 400 — which
collides with Vite HMR. Heavy Water uses `noServer: true` and routes
upgrades manually so the two coexist on the same port. Full background
in [`how-to/debug-hmr-and-websockets.md`](../how-to/debug-hmr-and-websockets.md).

## Adding a new message type

1. Extend the `ClientMessage` (and/or server-side response) union in
   `server/multiplayer.ts`.
2. Add a `case "your_msg":` branch in the dispatcher.
3. On the client, add a typed `send(...)` helper to `MultiplayerSystem`.
4. Document it in [`reference/websocket-protocol.md`](../reference/websocket-protocol.md).

## Anti-cheat caveats

The server is intentionally light on validation — it trusts clients
for position and damage. This is fine for friend-group play but is the
single biggest correctness gap for any future public deployment.
Server-side authority belongs on a roadmap if/when that matters.
