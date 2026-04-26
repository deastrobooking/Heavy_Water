import React, { useEffect } from "react";
import { MusicSystem } from "./MusicSystem";
import { MusicPlayerUI } from "./MusicPlayerUI";

interface MainMenuProps {
  onStart: () => void;
  onCustomize?: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({ onStart, onCustomize }) => {
  useEffect(() => {
    let cancelled = false;
    void MusicSystem.init().then(() => {
      if (!cancelled) void MusicSystem.playMenu();
    });
    const tryStart = () => { if (!cancelled) void MusicSystem.playMenu(); };
    window.addEventListener("pointerdown", tryStart, { once: true });
    window.addEventListener("keydown", tryStart, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", tryStart);
      window.removeEventListener("keydown", tryStart);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-gray-900 via-purple-900 to-black flex flex-col items-center justify-center">
      <div className="absolute inset-0 overflow-hidden">
        {Array.from({ length: 100 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 2}s`,
              opacity: Math.random() * 0.8,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 text-center">
        <h1 className="text-6xl font-bold mb-2 bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-transparent animate-pulse">
          DETROIT 3026
        </h1>
        <h2 className="text-2xl text-cyan-300 mb-8">THE FIRST ATTACK</h2>
        
        <div className="text-gray-400 text-sm mb-12 max-w-lg mx-auto leading-relaxed">
          <p className="mb-4">
            The year is 3026. Humanity has colonized the Moon, Mars, and Venus alongside 
            their AI partners. But in the ruins of Detroit, something sinister stirs...
          </p>
          <p className="mb-4">
            Hybrid organoids - AI fused with human and tardigrade DNA - have gone insane. 
            Their secret experiments on insects and mammals threaten all of civilization.
          </p>
          <p>
            You are humanity's last hope. Take up arms and defend Detroit against the 
            first wave of the invasion!
          </p>
        </div>

        <div className="flex gap-4 justify-center">
          <button
            onClick={onStart}
            className="px-12 py-4 text-xl font-bold text-black bg-gradient-to-r from-cyan-400 to-purple-500 
                       rounded-lg transform hover:scale-105 transition-all duration-300
                       shadow-lg shadow-cyan-500/50 hover:shadow-purple-500/50
                       border-2 border-white/20"
          >
            START MISSION
          </button>
          {onCustomize && (
            <button
              onClick={onCustomize}
              className="px-8 py-4 text-xl font-bold text-cyan-300 bg-black/40 border-2 border-cyan-400
                         rounded-lg transform hover:scale-105 transition-all duration-300
                         shadow-lg shadow-cyan-500/30 hover:bg-cyan-500/20"
            >
              CUSTOMIZE
            </button>
          )}
        </div>

        <div className="mt-12 text-gray-500 text-xs">
          <p>WASD - Move | SHIFT - Sprint | Mouse - Look | LMB - Fire</p>
          <p className="mt-1">1-6 - Weapons | R - Reload | SPACE - Jump/Jetpack</p>
          <p className="mt-1">Q - Dodge | F - Parry | V - Melee | B - Heavy Melee</p>
        </div>

        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 mb-8">
          <div className="flex gap-8 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-cyan-500 rounded-full animate-pulse" />
              <span>AI SYSTEMS ONLINE</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span>THREAT LEVEL: CRITICAL</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              <span>WEAPONS READY</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-cyan-900/30 to-transparent" />
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-purple-900/30 to-transparent" />

      <MusicPlayerUI variant="menu" />
    </div>
  );
};
