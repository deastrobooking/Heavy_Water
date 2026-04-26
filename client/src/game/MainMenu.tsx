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
    <div className="fixed inset-0 bg-gradient-to-b from-black via-purple-950 to-black flex flex-col items-center overflow-hidden">
      {/* Star field */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 140 }).map((_, i) => (
          <div
            key={i}
            className="absolute bg-white rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              width: `${Math.random() < 0.85 ? 1 : 2}px`,
              height: `${Math.random() < 0.85 ? 1 : 2}px`,
              animationDelay: `${Math.random() * 3}s`,
              opacity: 0.3 + Math.random() * 0.7,
            }}
          />
        ))}
      </div>

      {/* Distant nebula glow */}
      <div className="absolute inset-x-0 top-0 h-[60vh] pointer-events-none"
           style={{
             background:
               "radial-gradient(ellipse at 30% 40%, rgba(0,180,255,0.18), transparent 55%), " +
               "radial-gradient(ellipse at 75% 25%, rgba(255,80,140,0.15), transparent 55%), " +
               "radial-gradient(ellipse at 50% 70%, rgba(120,60,255,0.20), transparent 60%)",
           }} />

      {/* Bottom horizon glow */}
      <div className="absolute inset-x-0 bottom-0 h-48 pointer-events-none"
           style={{
             background:
               "linear-gradient(to top, rgba(0,255,255,0.18), transparent), " +
               "radial-gradient(ellipse at 50% 100%, rgba(255,80,0,0.25), transparent 65%)",
           }} />

      {/* === HERO ART: animated dogfight scene === */}
      <div className="relative z-10 w-full max-w-5xl mt-12 px-6">
        <h1
          className="text-7xl font-black text-center tracking-[0.18em] bg-gradient-to-b from-cyan-200 via-cyan-400 to-blue-700 bg-clip-text text-transparent"
          style={{
            filter: "drop-shadow(0 0 24px rgba(0,200,255,0.55)) drop-shadow(0 4px 0 rgba(0,40,80,0.4))",
            fontFamily: "'Press Start 2P', monospace",
            letterSpacing: "0.15em",
          }}
        >
          HEAVY WATER
        </h1>
        <h2 className="text-center text-cyan-200/80 text-base tracking-[0.5em] mt-3"
            style={{ fontFamily: "'Press Start 2P', monospace" }}>
          ◢ DEFEND THE SKIES ◣
        </h2>

        {/* Animated SVG scene */}
        <div className="relative w-full h-72 mt-4 mb-2">
          <svg viewBox="0 0 800 280" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="bshipBody" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#1a1140" />
                <stop offset="50%" stopColor="#0a0820" />
                <stop offset="100%" stopColor="#000" />
              </linearGradient>
              <linearGradient id="cityGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#0a2540" />
                <stop offset="100%" stopColor="#000" />
              </linearGradient>
              <radialGradient id="engineGlow">
                <stop offset="0%" stopColor="#fff5b0" stopOpacity="1" />
                <stop offset="40%" stopColor="#ff9900" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#ff3300" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="muzzleFlash">
                <stop offset="0%" stopColor="#fff" stopOpacity="1" />
                <stop offset="60%" stopColor="#ff5544" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#ff5544" stopOpacity="0" />
              </radialGradient>
              <filter id="bloom">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Distant city skyline silhouette */}
            <g opacity="0.85">
              <rect x="0" y="225" width="800" height="55" fill="url(#cityGradient)" />
              {[40, 100, 160, 230, 290, 360, 430, 500, 560, 630, 700, 760].map((x, i) => {
                const h = 28 + ((i * 13) % 38);
                const w = 22 + ((i * 7) % 18);
                return (
                  <g key={i}>
                    <rect x={x} y={225 - h} width={w} height={h} fill="#06121f" stroke="#0a2540" strokeWidth="1" />
                    {/* Window lights */}
                    {Array.from({ length: Math.floor(h / 6) }).map((_, j) => (
                      <rect
                        key={j}
                        x={x + 3 + ((j * 5) % (w - 5))}
                        y={225 - h + 3 + j * 6}
                        width="2"
                        height="2"
                        fill={j % 3 === 0 ? "#ffcc44" : "#88ccff"}
                        opacity={0.7 + ((j * 7) % 3) * 0.1}
                      />
                    ))}
                  </g>
                );
              })}
              {/* Antennae */}
              <line x1="105" y1="195" x2="105" y2="180" stroke="#ff3344" strokeWidth="1" />
              <circle cx="105" cy="180" r="2" fill="#ff3344">
                <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" />
              </circle>
              <line x1="565" y1="190" x2="565" y2="172" stroke="#ff3344" strokeWidth="1" />
              <circle cx="565" cy="172" r="2" fill="#ff3344">
                <animate attributeName="opacity" values="1;0.2;1" dur="0.9s" repeatCount="indefinite" />
              </circle>
            </g>

            {/* === BATTLESHIP (slow drift) === */}
            <g>
              <animateTransform attributeName="transform" type="translate"
                values="-40,0; 40,4; -40,0" dur="14s" repeatCount="indefinite" />
              <g transform="translate(280,80)">
                {/* Main hull */}
                <polygon points="-130,0 110,-8 140,0 110,8 -130,0" fill="url(#bshipBody)" stroke="#3a2a60" strokeWidth="1" />
                {/* Bow nose */}
                <polygon points="110,-8 165,-2 165,2 110,8" fill="#1a0a30" stroke="#3a2a60" strokeWidth="1" />
                {/* Bridge tower */}
                <polygon points="-60,-8 30,-8 20,-22 -50,-22" fill="#1a1240" stroke="#3a2a60" strokeWidth="1" />
                {/* Bridge windows (glowing red) */}
                <rect x="-48" y="-19" width="68" height="3" fill="#ff2244" filter="url(#bloom)">
                  <animate attributeName="opacity" values="1;0.6;1" dur="2.5s" repeatCount="indefinite" />
                </rect>
                {/* Turrets */}
                {[-90, -40, 10, 60].map((tx, i) => (
                  <g key={i}>
                    <ellipse cx={tx} cy="-6" rx="8" ry="4" fill="#1a1030" stroke="#3a2a60" strokeWidth="0.8" />
                    <line x1={tx} y1="-6" x2={tx + 12} y2="-6" stroke="#3a2a60" strokeWidth="2" />
                  </g>
                ))}
                {/* Underside lights */}
                {[-100, -60, -20, 20, 60, 100].map((lx, i) => (
                  <circle key={i} cx={lx} cy="6" r="1.6" fill="#ffaa44" filter="url(#bloom)">
                    <animate attributeName="opacity" values="0.4;1;0.4" dur={`${1.4 + i * 0.2}s`} repeatCount="indefinite" />
                  </circle>
                ))}
                {/* Rear engines */}
                <circle cx="-130" cy="-3" r="6" fill="url(#engineGlow)" filter="url(#bloom)" />
                <circle cx="-130" cy="3" r="6" fill="url(#engineGlow)" filter="url(#bloom)" />
                {/* Turret muzzle flash */}
                <circle cx="22" cy="-6" r="6" fill="url(#muzzleFlash)" filter="url(#bloom)">
                  <animate attributeName="opacity" values="0;1;0;0;0" dur="2.2s" repeatCount="indefinite" />
                  <animate attributeName="r" values="2;9;2;2;2" dur="2.2s" repeatCount="indefinite" />
                </circle>
              </g>
            </g>

            {/* === FIGHTER 1 — fast strafe across screen === */}
            <g>
              <animateTransform attributeName="transform" type="translate"
                values="850,140; -120,170" dur="6s" repeatCount="indefinite" />
              <g transform="rotate(180)">
                <polygon points="-22,0 12,-5 18,0 12,5" fill="#2a0a10" stroke="#5a1a25" strokeWidth="0.8" />
                <polygon points="-2,-3 14,0 -2,3" fill="#ff4455" filter="url(#bloom)" opacity="0.9" />
                <polygon points="-8,-2 -22,-12 -28,-12 -10,-1" fill="#1a0510" stroke="#5a1a25" strokeWidth="0.6" />
                <polygon points="-8,2 -22,12 -28,12 -10,1" fill="#1a0510" stroke="#5a1a25" strokeWidth="0.6" />
                <circle cx="-22" cy="0" r="3" fill="#ff8833" filter="url(#bloom)" />
                {/* Tracer */}
                <line x1="14" y1="0" x2="80" y2="0" stroke="#ffdd44" strokeWidth="1.6" filter="url(#bloom)" opacity="0.9">
                  <animate attributeName="opacity" values="0;1;0;0" dur="0.5s" repeatCount="indefinite" />
                </line>
              </g>
            </g>

            {/* === FIGHTER 2 — opposite direction higher altitude === */}
            <g>
              <animateTransform attributeName="transform" type="translate"
                values="-100,55; 880,80" dur="7.5s" repeatCount="indefinite" />
              <g>
                <polygon points="-22,0 12,-5 18,0 12,5" fill="#2a0a10" stroke="#5a1a25" strokeWidth="0.8" />
                <polygon points="-2,-3 14,0 -2,3" fill="#ff4455" filter="url(#bloom)" opacity="0.9" />
                <polygon points="-8,-2 -22,-12 -28,-12 -10,-1" fill="#1a0510" stroke="#5a1a25" strokeWidth="0.6" />
                <polygon points="-8,2 -22,12 -28,12 -10,1" fill="#1a0510" stroke="#5a1a25" strokeWidth="0.6" />
                <circle cx="-22" cy="0" r="3" fill="#ff8833" filter="url(#bloom)" />
              </g>
            </g>

            {/* === PLAYER FIGHTER returning fire (blue) — diving across center === */}
            <g>
              <animateTransform attributeName="transform" type="translate"
                values="900,200; -100,30" dur="9s" repeatCount="indefinite" />
              <g transform="rotate(195)">
                <polygon points="-22,0 12,-5 18,0 12,5" fill="#0a1a30" stroke="#3388cc" strokeWidth="0.8" />
                <polygon points="-2,-3 14,0 -2,3" fill="#44ddff" filter="url(#bloom)" opacity="0.95" />
                <polygon points="-8,-2 -22,-10 -26,-10 -10,-1" fill="#08111e" stroke="#3388cc" strokeWidth="0.6" />
                <polygon points="-8,2 -22,10 -26,10 -10,1" fill="#08111e" stroke="#3388cc" strokeWidth="0.6" />
                <circle cx="-22" cy="0" r="3" fill="#44ccff" filter="url(#bloom)" />
                <line x1="14" y1="0" x2="120" y2="0" stroke="#66eeff" strokeWidth="2" filter="url(#bloom)" opacity="0.95">
                  <animate attributeName="opacity" values="0;1;1;0" dur="0.45s" repeatCount="indefinite" />
                </line>
              </g>
            </g>

            {/* Falling sparks / debris */}
            {[160, 320, 480, 640].map((sx, i) => (
              <circle key={i} cx={sx} cy="120" r="1.5" fill="#ffaa44" filter="url(#bloom)">
                <animate attributeName="cy" values="100;240" dur={`${2 + i * 0.4}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="1;0" dur={`${2 + i * 0.4}s`} repeatCount="indefinite" />
              </circle>
            ))}
          </svg>
        </div>

        {/* Status indicators */}
        <div className="flex justify-center gap-8 text-xs text-gray-400 mt-1"
             style={{ fontFamily: "'Press Start 2P', monospace" }}>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
            <span>AI ONLINE</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span>THREAT: CRITICAL</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span>ARMS READY</span>
          </div>
        </div>

        {/* === ACTION BUTTONS === */}
        <div className="flex gap-4 justify-center mt-6">
          <button
            onClick={onStart}
            className="px-12 py-4 text-xl font-bold text-black bg-gradient-to-r from-cyan-300 to-blue-500
                       rounded-lg transform hover:scale-105 transition-all duration-300
                       shadow-lg shadow-cyan-500/50 hover:shadow-blue-500/60
                       border-2 border-white/30"
          >
            START MISSION
          </button>
          {onCustomize && (
            <button
              onClick={onCustomize}
              className="px-8 py-4 text-xl font-bold text-cyan-300 bg-black/40 border-2 border-cyan-400
                         rounded-lg transform hover:scale-105 transition-all duration-300
                         shadow-lg shadow-cyan-500/30 hover:bg-cyan-500/15"
            >
              CUSTOMIZE
            </button>
          )}
        </div>
      </div>

      {/* === GAMEPLAY INSTRUCTIONS — reserved space at bottom === */}
      <div className="relative z-10 w-full max-w-4xl mt-auto mb-6 px-6">
        <div className="bg-black/55 border-2 border-cyan-500/40 rounded-xl p-5 backdrop-blur-sm"
             style={{ boxShadow: "0 0 24px rgba(0,200,255,0.18)" }}>
          <div className="text-cyan-300 text-xs tracking-[0.4em] mb-3 text-center"
               style={{ fontFamily: "'Press Start 2P', monospace", textShadow: "0 0 8px rgba(0,200,255,0.5)" }}>
            ▸ FIELD MANUAL ◂
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-[11px] text-gray-200">
            <div><span className="text-cyan-400 font-bold">WASD</span> Move</div>
            <div><span className="text-cyan-400 font-bold">SHIFT</span> Sprint</div>
            <div><span className="text-cyan-400 font-bold">SPACE</span> Jump / Jetpack</div>
            <div><span className="text-cyan-400 font-bold">MOUSE</span> Look</div>
            <div><span className="text-cyan-400 font-bold">LMB</span> Fire</div>
            <div><span className="text-cyan-400 font-bold">R</span> Reload</div>
            <div><span className="text-cyan-400 font-bold">1–6</span> Switch Weapon</div>
            <div><span className="text-cyan-400 font-bold">V / B</span> Melee / Heavy</div>
            <div><span className="text-cyan-400 font-bold">Q</span> Dodge</div>
            <div><span className="text-cyan-400 font-bold">F</span> Parry</div>
            <div><span className="text-cyan-400 font-bold">E</span> Interact / Mount</div>
            <div><span className="text-cyan-400 font-bold">TAB</span> Upgrades</div>
            <div><span className="text-cyan-400 font-bold">[ / ]</span> Prev / Next Track</div>
            <div><span className="text-cyan-400 font-bold">\</span> Play / Pause Music</div>
            <div><span className="text-cyan-400 font-bold">H</span> Capture Orb</div>
            <div><span className="text-cyan-400 font-bold">M</span> Map</div>
          </div>
          <div className="text-center text-amber-300/90 text-[10px] mt-3 tracking-wider"
               style={{ fontFamily: "'Press Start 2P', monospace" }}>
            ★ NEW THREAT: Enemy battleships and fighters now patrol the skies — aim up. ★
          </div>
        </div>
      </div>

      <MusicPlayerUI variant="menu" />
    </div>
  );
};
