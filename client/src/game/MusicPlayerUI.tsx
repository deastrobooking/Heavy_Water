import React, { useEffect, useState } from "react";
import { MusicSystem, MusicState } from "./MusicSystem";

interface MusicPlayerUIProps {
  variant: "menu" | "game";
}

export const MusicPlayerUI: React.FC<MusicPlayerUIProps> = ({ variant }) => {
  const [state, setState] = useState<MusicState>(MusicSystem.getState());
  const [open, setOpen] = useState<boolean>(variant === "game" ? false : true);

  useEffect(() => {
    return MusicSystem.subscribe(setState);
  }, []);

  const availableCount = state.tracks.filter(t => t.available).length;
  const current = state.tracks[state.currentIndex];

  if (variant === "menu") {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-black/70 border border-cyan-500/50 rounded-lg px-4 py-3 backdrop-blur-md text-cyan-100 shadow-lg shadow-cyan-500/20 min-w-[260px]">
        <div className="text-[10px] uppercase tracking-widest text-cyan-400 mb-1">Now Playing — Menu</div>
        <div className="text-sm font-bold truncate">menu.mp3</div>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => MusicSystem.togglePlay()}
            className="px-3 py-1 text-xs bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/60 rounded"
          >
            {state.isPlaying ? "■ PAUSE" : "▶ PLAY"}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.volume}
            onChange={e => MusicSystem.setVolume(parseFloat(e.target.value))}
            className="flex-1 accent-cyan-400"
          />
        </div>
      </div>
    );
  }

  // In-game variant: collapsible drawer in the top-right
  return (
    <div className="fixed top-4 right-4 z-40 pointer-events-auto">
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="bg-black/70 border border-cyan-500/50 rounded-lg px-3 py-2 text-cyan-200 text-xs font-bold hover:bg-cyan-500/20"
          title="Open music player"
        >
          ♪ MUSIC {availableCount > 0 && `(${availableCount})`}
        </button>
      )}
      {open && (
        <div className="bg-black/80 border border-cyan-500/60 rounded-lg p-3 w-[280px] backdrop-blur-md text-cyan-100 shadow-lg shadow-cyan-500/20">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-widest text-cyan-400">Music Player</div>
            <button
              onClick={() => setOpen(false)}
              className="text-cyan-400 hover:text-cyan-200 text-xs"
              title="Hide"
            >
              ✕
            </button>
          </div>

          <div className="text-xs text-gray-400 mb-1">Now Playing</div>
          <div className="text-sm font-bold truncate text-white mb-2">
            {current?.available ? current.title : "— No track loaded —"}
          </div>

          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => MusicSystem.prev()}
              className="px-2 py-1 text-xs bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/60 rounded"
              disabled={availableCount === 0}
            >
              ⏮
            </button>
            <button
              onClick={() => MusicSystem.togglePlay()}
              className="px-3 py-1 text-xs bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/60 rounded font-bold"
              disabled={availableCount === 0}
            >
              {state.isPlaying ? "■" : "▶"}
            </button>
            <button
              onClick={() => MusicSystem.next()}
              className="px-2 py-1 text-xs bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/60 rounded"
              disabled={availableCount === 0}
            >
              ⏭
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.volume}
              onChange={e => MusicSystem.setVolume(parseFloat(e.target.value))}
              className="flex-1 accent-cyan-400"
              title="Volume"
            />
          </div>

          <div className="text-[10px] uppercase tracking-widest text-cyan-400 mb-1">Playlist</div>
          <div className="max-h-[260px] overflow-y-auto pr-1 space-y-0.5">
            {state.tracks.map((t, i) => (
              <button
                key={t.id}
                onClick={() => MusicSystem.selectTrack(i)}
                disabled={!t.available}
                className={`w-full text-left text-xs px-2 py-1 rounded flex items-center justify-between gap-2 ${
                  i === state.currentIndex && t.available
                    ? "bg-cyan-500/30 border border-cyan-400/80"
                    : t.available
                    ? "hover:bg-cyan-500/10 border border-transparent"
                    : "opacity-30 cursor-not-allowed border border-transparent"
                }`}
              >
                <span className="truncate">
                  {String(i + 1).padStart(2, "0")}. {t.title}
                </span>
                {!t.available && <span className="text-[9px] text-red-400">missing</span>}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-cyan-400/70 leading-tight">
            Shortcuts: <span className="text-cyan-200 font-bold">[</span> prev · <span className="text-cyan-200 font-bold">]</span> next · <span className="text-cyan-200 font-bold">\</span> play/pause
          </div>
          {availableCount === 0 && (
            <div className="mt-2 text-[10px] text-amber-300/80 leading-tight">
              No tracks found. Drop MP3s named <span className="text-amber-200 font-bold">track_01.mp3 … track_12.mp3</span> into <span className="text-amber-200 font-bold">client/public/music/</span> (and <span className="text-amber-200 font-bold">menu.mp3</span> for the title screen).
            </div>
          )}
        </div>
      )}
    </div>
  );
};
