import React, { useState } from "react";

export interface VersusJoinPayload {
  /** Empty when the user wants to host a fresh arena (Game.tsx will
   *  create the room via its own MultiplayerSystem). Set when the user
   *  typed a 4–6 char join code. */
  roomCode: string;
  /** True if this player is creating the room. The actual `create_room`
   *  call happens inside Game.tsx so there's exactly one WebSocket per
   *  player and no race between a lobby socket closing and a gameplay
   *  socket re-joining. */
  isHost: boolean;
}

interface VersusLobbyProps {
  onJoined: (p: VersusJoinPayload) => void;
  onClose: () => void;
}

/**
 * VersusLobby — minimal create / join modal for the PvP "Versus" game mode.
 *
 * INTENTIONALLY DOES NOT TALK TO THE SERVER. It only collects the user's
 * intent — "host a new arena" or "join code XYZ" — and hands that to
 * Game.tsx, which performs the real `create_room` / `join_room` over its
 * own MultiplayerSystem socket. This avoids a race where the lobby's
 * socket closing on `room_created` would cause the server to delete the
 * empty room before the gameplay socket re-joined.
 */
export const VersusLobby: React.FC<VersusLobbyProps> = ({ onJoined, onClose }) => {
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    setError(null);
    onJoined({ roomCode: "", isHost: true });
  };
  const join = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) { setError("Enter a room code (4–6 chars)"); return; }
    setError(null);
    onJoined({ roomCode: code, isHost: false });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className="relative w-full max-w-md mx-4 rounded-xl border-2 border-fuchsia-500/60 bg-gradient-to-b from-black via-purple-950 to-black p-6"
        style={{ boxShadow: "0 0 40px rgba(255,72,214,0.45)" }}
      >
        <div className="text-fuchsia-300 text-[11px] tracking-[0.45em] mb-1 text-center"
             style={{ fontFamily: "'Press Start 2P', monospace", textShadow: "0 0 8px rgba(255,72,214,0.6)" }}>
          ▸ VERSUS LOBBY ◂
        </div>
        <h2 className="text-3xl font-bold text-white text-center mb-1"
            style={{ fontFamily: "'UnifrakturMaguntia', serif", textShadow: "0 0 12px rgba(255,72,214,0.7)" }}>
          PVP ARENA
        </h2>
        <p className="text-center text-cyan-200/80 text-xs mb-4 tracking-wider"
           style={{ fontFamily: "'Press Start 2P', monospace" }}>
          UP TO 16 PLAYERS · MELEE FOCUS · NO ENEMIES
        </p>

        {error && (
          <div className="bg-red-950/70 border border-red-500/60 rounded p-2 text-red-200 text-sm mb-3 text-center">
            {error}
          </div>
        )}

        <button
          onClick={create}
          className="w-full py-3 mb-3 rounded-lg text-lg font-bold text-black bg-gradient-to-r from-fuchsia-400 to-pink-500 border-2 border-white/30 shadow-lg shadow-fuchsia-500/40 hover:scale-[1.02] transition"
        >
          CREATE NEW ARENA
        </button>

        <div className="flex items-center gap-2 my-3">
          <div className="h-px flex-1 bg-fuchsia-500/30" />
          <span className="text-fuchsia-300 text-[10px] tracking-widest" style={{ fontFamily: "'Press Start 2P', monospace" }}>OR</span>
          <div className="h-px flex-1 bg-fuchsia-500/30" />
        </div>

        <label className="block text-cyan-300 text-xs tracking-widest mb-1"
               style={{ fontFamily: "'Press Start 2P', monospace" }}>
          JOIN BY CODE
        </label>
        <div className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
            onKeyDown={(e) => { if (e.key === "Enter") join(); }}
            placeholder="ABC123"
            className="flex-1 px-3 py-2 bg-black/60 border-2 border-cyan-500/50 rounded text-cyan-100 text-lg tracking-[0.4em] text-center font-mono focus:outline-none focus:border-cyan-300"
          />
          <button
            onClick={join}
            disabled={joinCode.trim().length < 4}
            className="px-4 py-2 rounded-lg font-bold text-black bg-gradient-to-r from-cyan-300 to-blue-500 border-2 border-white/30 hover:scale-[1.02] transition disabled:opacity-40"
          >
            JOIN
          </button>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full py-2 rounded text-xs text-gray-300 border border-gray-600 hover:bg-gray-800/40"
          style={{ fontFamily: "'Press Start 2P', monospace" }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
};
