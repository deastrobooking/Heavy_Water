# WebSocket protocol reference

Endpoint: `wss://<host>/ws` (or `ws://localhost:5000/ws` in dev).

Server: [`server/multiplayer.ts`](../../server/multiplayer.ts) — `ws`
WebSocketServer in `noServer` mode, dispatched manually so it coexists
with Vite HMR (see [`how-to/debug-hmr-and-websockets.md`](../how-to/debug-hmr-and-websockets.md)).

Client: [`client/src/game/MultiplayerSystem.ts`](../../client/src/game/MultiplayerSystem.ts).

All messages are JSON: `{ type: string, ...payload }`. The exact
TypeScript union for client messages lives at the top of
`server/multiplayer.ts` as `type ClientMessage`.

## Client → server

| `type` | Payload | Effect |
|---|---|---|
| `auth` | `{ username: string, userId: number }` | Identify socket. Must be first message. Server replies `auth_ok`. |
| `create_room` | `{ mode?: "coop" \| "versus" }` (default `"coop"`) | Server allocates an 8-char `roomCode`, makes the caller host, replies `room_created`. |
| `join_room` | `{ roomCode: string }` | Add player to room roster, broadcast `player_joined`, reply `room_joined` to the joiner. |
| `leave_room` | — | Remove player from room, broadcast `player_left`, delete room if empty (or rotate host with `host_changed`). |
| `list_rooms` | — | Reply with `room_list`. |
| `position_update` | `{ position: {x,y,z}, rotation: {x,y,z}, state: string, health: number, weaponId: number, isFlying: boolean }` | Updates server-side player state, fans out as `player_update` to peers. Throttle ~10 Hz. |
| `action` | `{ action: string, data: any }` | Generic action mirror (weapon fire, melee swing, FX trigger). Fans out as `player_action`. |
| `chat` | `{ message: string }` (capped at 200 chars server-side) | Fans out as `chat_message`. |
| `enemy_damage` | `{ enemyId: string, damage: number, damageType: string }` | Fans out as `enemy_damage` so all clients agree on enemy HP. |
| `pvp_hit` | `{ targetId: string, damage: number }` | Versus only. Server validates (clamp ≤90, ≥150 ms per attacker→target pair, same versus room, ≤160 u range from last-known positions) then forwards `pvp_hit` **to the victim only**. |
| `pvp_death` | — | Versus only. Victim reports its own death. Server credits the kill only if the claimed killer landed a server-accepted hit within 10 s; broadcasts `arena_score` / `arena_match_over`. |
| `ping` | — | Server replies `pong { time }`. |

## Server → client

| `type` | Payload | When |
|---|---|---|
| `auth_ok` | `{ playerId: string }` | After successful `auth` |
| `room_created` | `{ roomCode: string, isHost: true, mode: "coop" \| "versus" }` | After `create_room` |
| `room_joined` | `{ roomCode: string, isHost: boolean, players: PlayerState[], mode }` | After `join_room` (only sent to the joiner) |
| `room_list` | `{ rooms: Array<{ code, players, maxPlayers, host, wave, mode }> }` | After `list_rooms` |
| `player_joined` | broadcast — full player state | A new player joined your room |
| `player_left` | `{ playerId, playerCount }` | Peer disconnected or left |
| `host_changed` | `{ newHostId }` | Host left and host role rotated |
| `player_update` | `{ playerId, position, rotation, state, health, weaponId, isFlying }` | Forwarded `position_update` |
| `player_action` | `{ playerId, action, data }` | Forwarded `action` |
| `chat_message` | `{ playerId, username, message }` | Forwarded chat |
| `enemy_damage` | `{ playerId, enemyId, damage, damageType }` | Forwarded enemy damage from another player |
| `pvp_hit` | `{ attackerId, attacker, damage }` | Server-validated PvP hit — sent to the victim only |
| `arena_score` | `{ killTarget, matchOver, scoreboard: Array<{ playerId, username, kills, deaths }> }` | Versus scoreboard — on join/leave/death and after resets |
| `arena_match_over` | `{ winnerId, winnerName, killTarget, scoreboard }` | A player reached the kill target |
| `arena_reset` | `{ killTarget }` | 8 s after match over — scores zeroed, next match begins |
| `pong` | `{ time: number }` | Response to `ping` |
| `error` | `{ message: string }` | Anything went wrong (room full, not in a room, etc.) |

## Room kinds

- **`coop`** — open-world campaign + wave defense. Default.
- **`versus`** — PvP arena on a deterministic 640×640 walled map. Both
  clients build the same layout from a shared per-room procedural seed
  (computed client-side from `roomCode`, not sent over the wire).

## Lifecycle invariants

- The first message on a new socket **must** be `auth`. Anything else is
  ignored. Replies after `auth_ok` are tied to the `playerId` the
  server allocated.
- A player can only be in one room at a time. `join_room` while in a
  room is rejected with `error`.
- When the host disconnects, the server promotes the next player and
  broadcasts `host_changed`. The room only deletes when empty.
- Versus PvP damage and kill credit are server-validated (`pvp_hit` /
  `pvp_death`). Position and coop `enemy_damage` remain client-trusted —
  residual risks and the hardening path are documented in
  [`systems/multiplayer.md`](../systems/multiplayer.md#known-cheat-surfaces-residual-risk).
- Stale players are kicked after 60 s of silence; dead sockets and
  empty/2 h-idle rooms are swept every 30 s.

## Adding a message type

See [`systems/multiplayer.md`](../systems/multiplayer.md#adding-a-new-message-type).
