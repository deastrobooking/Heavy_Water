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

interface Room {
  code: string;
  hostId: string;
  players: Map<string, ConnectedPlayer>;
  maxPlayers: number;
  wave: number;
  createdAt: number;
  mode: RoomMode;
}

interface ConnectedPlayer {
  ws: WebSocket;
  id: string;
  username: string;
  roomCode: string | null;
  state: PlayerState;
  lastUpdate: number;
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
  | { type: "ping" };

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

function removePlayerFromRoom(playerId: string): void {
  const player = players.get(playerId);
  if (!player || !player.roomCode) return;

  const room = rooms.get(player.roomCode);
  if (!room) return;

  room.players.delete(playerId);
  player.roomCode = null;

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
              // Per-room cap. Position updates broadcast every 50ms scale as
              // N*(N-1) messages/tick; at 16 that's 4 800 msgs/sec/room which
              // is comfortable on the naive broadcast (no spatial culling /
              // delta encoding). Raising further would need those optimisations.
              maxPlayers: 16,
              wave: 0,
              createdAt: Date.now(),
              mode,
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
      if (now - player.lastUpdate > staleTimeout) {
        log(`Removing stale player: ${player.username}`);
        removePlayerFromRoom(id);
        players.delete(id);
        if (player.ws.readyState === WebSocket.OPEN) {
          player.ws.close();
        }
      }
    });
  }, 30000);
}
