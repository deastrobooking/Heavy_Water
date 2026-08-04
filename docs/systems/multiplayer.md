# Multiplayer

Heavy Water supports up to **16 players per coop room / 24 per versus room**
with two room kinds:

- **`coop`** — campaign / wave-defense in the open world.
- **`versus`** — PvP arena on a compact 640×640 walled map with a
  server-scored, first-to-10-KOs match loop.

## Components

| File | Role |
|---|---|
| [`server/multiplayer.ts`](../../server/multiplayer.ts) | `ws` WebSocketServer in `noServer` mode, manual upgrade routing on `/ws`. Owns rooms, broadcast, message dispatch, PvP hit validation, and arena match scoring. |
| [`client/src/game/MultiplayerSystem.ts`](../../client/src/game/MultiplayerSystem.ts) | Client connection, room state, position broadcast, action mirroring, chat, enemy-damage sync, remote-player interpolation. |
| [`client/src/game/VersusArena.ts`](../../client/src/game/VersusArena.ts) | Deterministic PvP arena geometry (client-built). |
| [`shared/schema.ts`](../../shared/schema.ts) | `gameSessions` table — persisted room metadata. |

## Authority model (assessment)

The architecture is **client-authoritative with selective server validation**:

| Domain | Authority | Notes |
|---|---|---|
| Player position/rotation/state | **Client** | Server records last-known state per player (used for hit range checks) but never corrects it. |
| Player health | **Client** (owner) | Each client owns its own health; peers see it via `position_update`. |
| PvP damage (versus) | **Server-validated** | `pvp_hit` is clamped (≤90), rate-limited (≥150 ms per attacker→target pair), same-room + versus-mode checked, and range-checked (≤160 u between last-known positions) before being forwarded **to the victim only**. |
| Kill credit / scoreboard (versus) | **Server** | The victim reports its own death (`pvp_death`); the server grants the kill only to a rival whose hit it *itself accepted* within the last 10 s. Clients cannot inflate kills. |
| Match lifecycle (versus) | **Server** | First to 10 KOs → `arena_match_over` broadcast, 8 s scoreboard freeze, then `arena_reset` + zeroed `arena_score`. |
| Coop enemies / waves | **Client (host-ish)** | `enemy_damage` is fanned out untrusted; each client simulates its own world. |

### What is synced

- Position, Y-rotation, animation `state`, `health`, `weaponId`, `isFlying`
  (via `position_update` → `player_update`).
- PvP hits and match score (versus, server-validated).
- Chat (truncated to 200 chars), room presence, host migration.
- Coop `enemy_damage` mirroring (best-effort, untrusted).

### What is NOT synced

- Enemies, props, chests, loot, companions, vehicles, world state — every
  client simulates its own world. Coop is therefore "shared presence", not a
  shared simulation.
- Weapon projectiles: only the *result* (a hit) crosses the wire.
- Player loadout/stats beyond `weaponId`/`health`.

## Tick / interpolation strategy

- Client polls its own position on a **50 ms tick** but **change-gates**
  sends: a packet goes out only if the player moved >0.05 m, turned >0.01 rad
  on Y, a discrete field changed, or the ~1 s heartbeat is due. Idle players
  emit ~1 packet/s instead of 20.
- Receivers **lerp** remote players toward the latest snapshot
  (`min(1, dt·10)` factor). There is no velocity extrapolation — at normal
  latency (<150 ms) this reads as light smoothing, not lag.
- **Teleport snap**: if the new target is >20 m from the rendered position
  (respawn, warp), the mesh snaps instantly instead of streaking across the
  map.
- **Ghost hiding**: a remote player silent >5 s (heartbeat is 1 s) is hidden
  client-side; the server kicks fully-stale players at 60 s and closes dead
  sockets on its 30 s sweep.

## Room lifecycle

```
create_room → server allocates 6-char roomCode (mode coop|versus)
join_room  → roster add, presence broadcast, versus scoreboard broadcast
position_update / action / pvp_hit / enemy_damage → fan out (pvp_hit: victim only)
leave_room / socket close / 60s silence → remove, host migration, scoreboard update
empty room → deleted immediately; defensive sweep also removes empty/2h-idle rooms
```

`VersusLobby.tsx` is intentionally **server-silent**: it only collects
"host new" / "join code" intent; `Game.tsx` performs the real
`create_room`/`join_room` on its single gameplay socket (avoids the
lobby-socket-closes-empty-room race).

## Versus arena rules

- Map: deterministic 640×640 walled city (`VersusArena.ts`), 24 spawn ring.
- **Match**: continuous rounds. First player to **10 KOs** wins.
- **Respawn**: 3 s countdown, random spawn-ring point, full stats preserved.
- **Scoreboard**: server-broadcast `arena_score` (kills/deaths per player)
  rendered as a HUD panel; updates on join/leave/death.
- **Match over**: `arena_match_over` shows the winner banner; after 8 s the
  server zeroes scores and broadcasts `arena_reset` ("NEW MATCH — FIGHT!").

## Known cheat surfaces (residual risk)

Server validation closes the worst gaps (damage forging, kill inflation,
cross-room hits, hit spam), but these remain — acceptable for friend-group
play, must be addressed before public deployment:

1. **Position spoofing** — clients self-report position; a hacked client can
   teleport (range check uses the *reported* positions).
2. **Health/god-mode** — victims own their health; a client can ignore
   `pvp_hit` entirely. Mitigation path: server-tracked HP with hit → HP
   deduction → server-declared death.
3. **Death suppression** — a client can simply never send `pvp_death`
   (inverse of kill inflation; can't fake wins, but can avoid losing).
4. **Rate floor, not hit validation** — the server doesn't verify line-of-
   sight or that a weapon could plausibly do N damage per hit.

## Recommended path (future)

1. Server-owned HP for versus (removes surfaces 2 & 3).
2. Movement plausibility check (max speed envelope) on `position_update`.
3. Public matchmaking: quick-join queue on top of the existing room list
   (rooms already carry `mode` for filtering).
4. Interest management / binary packets only if room sizes grow past ~24.

## Why `noServer: true`

`ws`'s `{ server, path }` shorthand registers a global `upgrade` listener
that rejects every non-matching path with 400 — which collides with Vite
HMR. Heavy Water uses `noServer: true` and routes upgrades manually so the
two coexist on the same port. Full background in
[`how-to/debug-hmr-and-websockets.md`](../how-to/debug-hmr-and-websockets.md).

## Adding a new message type

1. Extend the `ClientMessage` union in `server/multiplayer.ts` and add a
   `case` in the dispatcher (validate inputs — see `pvp_hit` as the model).
2. On the client, add a typed `send(...)` helper + a `case` in
   `MultiplayerSystem.handleMessage`.
3. Document it in [`reference/websocket-protocol.md`](../reference/websocket-protocol.md).
