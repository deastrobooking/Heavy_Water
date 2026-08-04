import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./index";

interface PlayerState {
  id: string;
  username: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  state: string;
  health: number;
  weaponId: number;
  isFlying: boolean;
}

/** "coop" = standard PvE campaign session. "versus" = PvP-only arena room
 *  used by the home-screen Versus mode. The mode is informational on the
 *  server (room list filtering, future enforcement) — gameplay rules are
 *  still authoritative on the client. */
export type RoomMode = "coop" | "versus";

interface ArenaScore {
  kills: number;
  deaths: number;
}

interface Room {
  code: string;
  hostId: string;
  players: Map<string, ConnectedPlayer>;
  maxPlayers: number;
  wave: number;
  createdAt: number;
  lastActivity: number;
  mode: RoomMode;
  /** Versus-only match state (playerId → score). Kept for the whole room
   *  lifetime; reset when a match ends. */
  scores: Map<string, ArenaScore>;
  matchOver: boolean;
}

interface ConnectedPlayer {
  ws: WebSocket;
  id: string;
  username: string;
  roomCode: string | null;
  state: PlayerState;
  lastUpdate: number;
  /** Anti-spoof bookkeeping for versus PvP (server-validated hits). */
  lastHitSentAt: Map<string, number>;      // targetId → last accepted pvp_hit ms
  lastHitBy: { attackerId: string; at: number } | null; // most recent hit taken
}

type ClientMessage =
  | { type: "auth"; username: string; userId: number }
  | { type: "create_room"; mode?: RoomMode }
  | { type: "join_room"; roomCode: string }
  | { type: "leave_room" }
  | { type: "list_rooms" }
  | { type: "position_update"; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; state: string; health: number; weaponId: number; isFlying: boolean }
  | { type: "action"; action: string; data: any }
  | { type: "chat"; message: string }
  | { type: "enemy_damage"; enemyId: string; damage: number; damageType: string }
  | { type: "pvp_hit"; targetId: string; damage: number }
  | { type: "pvp_death"; killerId?: string }
  | { type: "ping" };

// ---- Versus arena rules (server-authoritative) ---------------------------
const ARENA_KILL_TARGET = 10;      // first to N KOs wins the match
const ARENA_HIT_MIN_MS = 150;      // per attacker→target accept rate
const ARENA_HIT_MAX_DAMAGE = 90;   // matches the client's own clamp
const ARENA_HIT_MAX_DIST = 160;    // generous (rockets/lasers) sanity range
const ARENA_KILL_CREDIT_MS = 10000; // a death credits the last hitter within 10s
const ARENA_RESET_DELAY_MS = 8000; // scoreboard freeze before the next match

const rooms = new Map<string, Room>();
const players = new Map<string, ConnectedPlayer>();

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function broadcastToRoom(roomCode: string, message: any, excludeId?: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  const data = JSON.stringify(message);
  room.players.forEach((player, id) => {
    if (id !== excludeId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  });
}

function sendTo(ws: WebSocket, message: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function getRoomList(): { code: string; players: number; maxPlayers: number; host: string; wave: number; mode: RoomMode }[] {
  const list: any[] = [];
  rooms.forEach((room) => {
    list.push({
      code: room.code,
      players: room.players.size,
      maxPlayers: room.maxPlayers,
      host: room.hostId,
      wave: room.wave,
      mode: room.mode,
    });
  });
  return list;
}

function arenaScoreboard(room: Room): Array<{ playerId: string; username: string; kills: number; deaths: number }> {
  const board: Array<{ playerId: string; username: string; kills: number; deaths: number }> = [];
  room.players.forEach((p, id) => {
    const s = room.scores.get(id) ?? { kills: 0, deaths: 0 };
    board.push({ playerId: id, username: p.username, kills: s.kills, deaths: s.deaths });
  });
  board.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  return board;
}

function broadcastArenaScore(room: Room): void {
  if (room.mode !== "versus") return;
  broadcastToRoom(room.code, {
    type: "arena_score",
    killTarget: ARENA_KILL_TARGET,
    matchOver: room.matchOver,
    scoreboard: arenaScoreboard(room),
  });
}

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function removePlayerFromRoom(playerId: string): void {
  const player = players.get(playerId);
  if (!player || !player.roomCode) return;

  const room = rooms.get(player.roomCode);
  if (!room) return;

  room.players.delete(playerId);
  room.scores.delete(playerId);
  player.roomCode = null;
  // Reset PvP attribution so hits/kill-credit can never leak across
  // room boundaries, and prune the leaver from every peer's rate-limit map.
  player.lastHitBy = null;
  player.lastHitSentAt.clear();
  room.players.forEach((p) => { p.lastHitSentAt.delete(playerId); });

  broadcastToRoom(room.code, {
    type: "player_left",
    playerId,
    username: player.username,
    playerCount: room.players.size,
  });

  if (room.players.size === 0) {
    rooms.delete(room.code);
    log(`Room ${room.code} closed (empty)`);
  } else if (room.hostId === playerId) {
    const newHost = room.players.keys().next().value;
    if (newHost) {
      room.hostId = newHost;
      broadcastToRoom(room.code, { type: "host_changed", newHostId: newHost });
    }
  }
  if (room.players.size > 0) broadcastArenaScore(room);
}

export function setupMultiplayer(httpServer: Server): void {
  // IMPORTANT: use `noServer: true` and route upgrades manually instead
  // of `{ server, path: "/ws" }`. The shorthand registers a global
  // upgrade listener that calls `abortHandshake(socket, 400)` for ANY
  // non-matching path — which kills Vite's `/vite-hmr` upgrade before
  // Vite's own listener can handle it (causing the noisy
  // `wss://localhost:undefined/?token=…` fallback in dev). Manual
  // routing only consumes upgrades for `/ws` and leaves everything else
  // for downstream listeners (Vite HMR, future WSS endpoints).
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      return; // malformed URL — let other listeners decide / let it die naturally
    }
    if (pathname !== "/ws") return; // not ours; another listener (e.g. Vite HMR) owns it
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  log("WebSocket multiplayer server started on /ws");

  wss.on("connection", (ws) => {
    let playerId: string | null = null;

    ws.on("message", (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());

        switch (msg.type) {
          case "auth": {
            playerId = `player_${msg.userId}_${Date.now()}`;
            const player: ConnectedPlayer = {
              ws,
              id: playerId,
              username: msg.username,
              roomCode: null,
              state: {
                id: playerId,
                username: msg.username,
                position: { x: 0, y: 1, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                state: "idle",
                health: 100,
                weaponId: 1,
                isFlying: false,
              },
              lastUpdate: Date.now(),
              lastHitSentAt: new Map(),
              lastHitBy: null,
            };
            players.set(playerId, player);
            sendTo(ws, { type: "auth_ok", playerId });
            log(`Player connected: ${msg.username} (${playerId})`);
            break;
          }

          case "create_room": {
            if (!playerId) return sendTo(ws, { type: "error", message: "Not authenticated" });
            const player = players.get(playerId);
            if (!player) return;
            if (player.roomCode) removePlayerFromRoom(playerId);

            let code = generateRoomCode();
            while (rooms.has(code)) code = generateRoomCode();

            const mode: RoomMode = msg.mode === "versus" ? "versus" : "coop";
            const room: Room = {
              code,
              hostId: playerId,
              players: new Map([[playerId, player]]),
              // Per-room cap. Versus gets the larger city arena, so it can
              // support 24 players before the naive broadcast starts feeling
              // crowded. Coop stays at 16 to keep campaign rooms lightweight.
              maxPlayers: mode === "versus" ? 24 : 16,
              wave: 0,
              createdAt: Date.now(),
              lastActivity: Date.now(),
              mode,
              scores: new Map([[playerId, { kills: 0, deaths: 0 }]]),
              matchOver: false,
            };
            rooms.set(code, room);
            player.roomCode = code;
            sendTo(ws, { type: "room_created", roomCode: code, isHost: true, mode });
            log(`Room ${code} created by ${player.username} [${mode}]`);
            break;
          }

          case "join_room": {
            if (!playerId) return sendTo(ws, { type: "error", message: "Not authenticated" });
            const player = players.get(playerId);
            if (!player) return;
            if (player.roomCode) removePlayerFromRoom(playerId);

            const room = rooms.get(msg.roomCode);
            if (!room) return sendTo(ws, { type: "error", message: "Room not found" });
            if (room.players.size >= room.maxPlayers) return sendTo(ws, { type: "error", message: "Room is full" });

            room.players.set(playerId, player);
            if (!room.scores.has(playerId)) room.scores.set(playerId, { kills: 0, deaths: 0 });
            room.lastActivity = Date.now();
            player.roomCode = msg.roomCode;

            const existingPlayers: PlayerState[] = [];
            room.players.forEach((p, id) => {
              if (id !== playerId) existingPlayers.push(p.state);
            });

            sendTo(ws, { type: "room_joined", roomCode: msg.roomCode, isHost: false, players: existingPlayers, mode: room.mode });

            broadcastToRoom(msg.roomCode, {
              type: "player_joined",
              player: player.state,
              playerCount: room.players.size,
            }, playerId);

            log(`${player.username} joined room ${msg.roomCode}`);
            // Versus rooms: everyone (including the joiner) gets a fresh
            // scoreboard so the HUD is correct from second zero.
            broadcastArenaScore(room);
            break;
          }

          case "leave_room": {
            if (playerId) removePlayerFromRoom(playerId);
            sendTo(ws, { type: "room_left" });
            break;
          }

          case "list_rooms": {
            sendTo(ws, { type: "room_list", rooms: getRoomList() });
            break;
          }

          case "position_update": {
            if (!playerId) return;
            const player = players.get(playerId);
            if (!player || !player.roomCode) return;

            player.state.position = msg.position;
            player.state.rotation = msg.rotation;
            player.state.state = msg.state;
            player.state.health = msg.health;
            player.state.weaponId = msg.weaponId;
            player.state.isFlying = msg.isFlying;
            player.lastUpdate = Date.now();
            const posRoom = rooms.get(player.roomCode);
            if (posRoom) posRoom.lastActivity = Date.now();

            broadcastToRoom(player.roomCode, {
              type: "player_update",
              playerId,
              position: msg.position,
              rotation: msg.rotation,
              state: msg.state,
              health: msg.health,
              weaponId: msg.weaponId,
              isFlying: msg.isFlying,
            }, playerId);
            break;
          }

          case "action": {
            if (!playerId) return;
            const player = players.get(playerId);
            if (!player || !player.roomCode) return;
            broadcastToRoom(player.roomCode, {
              type: "player_action",
              playerId,
              action: msg.action,
              data: msg.data,
            }, playerId);
            break;
          }

          case "chat": {
            if (!playerId) return;
            const player = players.get(playerId);
            if (!player || !player.roomCode) return;
            broadcastToRoom(player.roomCode, {
              type: "chat_message",
              playerId,
              username: player.username,
              message: msg.message.slice(0, 200),
            });
            break;
          }

          case "enemy_damage": {
            if (!playerId) return;
            const player = players.get(playerId);
            if (!player || !player.roomCode) return;
            broadcastToRoom(player.roomCode, {
              type: "enemy_damage",
              playerId,
              enemyId: msg.enemyId,
              damage: msg.damage,
              damageType: msg.damageType,
            }, playerId);
            break;
          }

          case "pvp_hit": {
            // Server-validated PvP damage. The server does NOT trust the
            // attacker blindly: it clamps damage, rate-limits per pair,
            // requires a shared versus room, and sanity-checks the distance
            // between both players' last-known positions before forwarding
            // the hit to the victim ONLY.
            if (!playerId) return;
            const attacker = players.get(playerId);
            if (!attacker || !attacker.roomCode) return;
            const room = rooms.get(attacker.roomCode);
            if (!room || room.mode !== "versus" || room.matchOver) return;
            const target = players.get(String(msg.targetId ?? ""));
            if (!target || target.roomCode !== attacker.roomCode || target.id === attacker.id) return;

            const now = Date.now();
            const lastAt = attacker.lastHitSentAt.get(target.id) ?? 0;
            if (now - lastAt < ARENA_HIT_MIN_MS) return; // spam / macro guard
            const damage = Math.max(1, Math.min(ARENA_HIT_MAX_DAMAGE, Math.round(Number(msg.damage) || 0)));
            if (damage <= 0) return;
            if (dist3(attacker.state.position, target.state.position) > ARENA_HIT_MAX_DIST) return;

            attacker.lastHitSentAt.set(target.id, now);
            target.lastHitBy = { attackerId: attacker.id, at: now };
            sendTo(target.ws, {
              type: "pvp_hit",
              attackerId: attacker.id,
              attacker: attacker.username,
              damage,
            });
            room.lastActivity = now;
            break;
          }

          case "pvp_death": {
            // The VICTIM reports its own death (its client owns its health).
            // Kill credit is only granted if the claimed killer actually
            // landed a server-accepted hit on this victim recently — a
            // client cannot inflate a rival's (or its own) kill count.
            if (!playerId) return;
            const victim = players.get(playerId);
            if (!victim || !victim.roomCode) return;
            const room = rooms.get(victim.roomCode);
            if (!room || room.mode !== "versus" || room.matchOver) return;

            const now = Date.now();
            const vs = room.scores.get(victim.id) ?? { kills: 0, deaths: 0 };
            vs.deaths += 1;
            room.scores.set(victim.id, vs);

            const hit = victim.lastHitBy;
            victim.lastHitBy = null;
            let winner: ConnectedPlayer | null = null;
            if (hit && now - hit.at <= ARENA_KILL_CREDIT_MS && room.players.has(hit.attackerId)) {
              const ks = room.scores.get(hit.attackerId) ?? { kills: 0, deaths: 0 };
              ks.kills += 1;
              room.scores.set(hit.attackerId, ks);
              if (ks.kills >= ARENA_KILL_TARGET) winner = room.players.get(hit.attackerId) ?? null;
            }

            if (winner) {
              room.matchOver = true;
              broadcastToRoom(room.code, {
                type: "arena_match_over",
                winnerId: winner.id,
                winnerName: winner.username,
                killTarget: ARENA_KILL_TARGET,
                scoreboard: arenaScoreboard(room),
              });
              log(`Arena ${room.code}: ${winner.username} won the match`);
              const code = room.code;
              setTimeout(() => {
                const r = rooms.get(code);
                if (!r) return;
                r.scores = new Map();
                r.players.forEach((p, id) => {
                  r.scores.set(id, { kills: 0, deaths: 0 });
                  // New match = clean attribution slate.
                  p.lastHitBy = null;
                });
                r.matchOver = false;
                broadcastToRoom(code, { type: "arena_reset", killTarget: ARENA_KILL_TARGET });
                broadcastArenaScore(r);
              }, ARENA_RESET_DELAY_MS);
            } else {
              broadcastArenaScore(room);
            }
            room.lastActivity = now;
            break;
          }

          case "ping": {
            sendTo(ws, { type: "pong", time: Date.now() });
            break;
          }
        }
      } catch (err) {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      if (playerId) {
        const player = players.get(playerId);
        if (player) {
          log(`Player disconnected: ${player.username}`);
          removePlayerFromRoom(playerId);
          players.delete(playerId);
        }
      }
    });

    ws.on("error", () => {
      if (playerId) {
        const player = players.get(playerId);
        if (player) {
          removePlayerFromRoom(playerId);
          players.delete(playerId);
        }
      }
    });
  });

  setInterval(() => {
    const now = Date.now();
    const staleTimeout = 60000;
    players.forEach((player, id) => {
      // A player is stale if it went silent for 60s OR its socket is
      // already dead (closing/closed without a close event reaching us —
      // e.g. a hard network drop). Both would otherwise leave a ghost
      // in the room roster.
      const socketDead = player.ws.readyState === WebSocket.CLOSING || player.ws.readyState === WebSocket.CLOSED;
      if (socketDead || now - player.lastUpdate > staleTimeout) {
        log(`Removing stale player: ${player.username}`);
        removePlayerFromRoom(id);
        players.delete(id);
        if (player.ws.readyState === WebSocket.OPEN) {
          player.ws.close();
        }
      }
    });
    // Room hygiene: rooms should always die when their last player leaves,
    // but sweep defensively for empty or long-idle rooms so a bookkeeping
    // bug can never leak them forever.
    const roomIdleTimeout = 2 * 60 * 60 * 1000; // 2h with zero traffic
    rooms.forEach((room, code) => {
      if (room.players.size === 0 || now - room.lastActivity > roomIdleTimeout) {
        room.players.forEach((p) => { p.roomCode = null; });
        rooms.delete(code);
        log(`Room ${code} swept (${room.players.size === 0 ? "empty" : "idle"})`);
      }
    });
  }, 30000);
}
