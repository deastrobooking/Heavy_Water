import React, { useEffect, useMemo, useState } from "react";
import { MusicSystem } from "./MusicSystem";
import { MusicPlayerUI } from "./MusicPlayerUI";
import { GameplayGuide } from "./GameplayGuide";
import { VersusLobby, VersusJoinPayload } from "./VersusLobby";

/** High-level summary of the player's cloud save — surfaced on the main
 *  menu so the player can see exactly what's been persisted before they
 *  press START MISSION. Sourced from ProgressSync.loadProgress() on auth. */
export interface SaveSummary {
  level: number;
  credits: number;
  totalKills: number;
  highestWave: number;
  worldLevel: number;
  savedAt: number;
  bioDexCount?: number;
  companionCount?: number;
}

/** What gets handed to Game.tsx when the player presses START or joins a
 *  Versus room. `mode === "versus"` skips the open-world city + all enemies
 *  and mounts the compact PvP arena instead, auto-joining the given room. */
export interface StartPayload {
  mode: "campaign" | "versus";
  versus?: { roomCode: string; isHost: boolean };
}

interface MainMenuProps {
  onStart: (payload: StartPayload) => void;
  onCustomize?: () => void;
  saveSummary?: SaveSummary | null;
}

const WORLD_LEVEL_NAMES: Record<number, string> = {
  1: "Star City Front",
  2: "Hold the Line",
  3: "Purge the Void",
  4: "Ashur Sanctuary",
  5: "Orbital Front",
};

const formatSavedAt = (ts: number): string => {
  if (!ts) return "—";
  const ms = Date.now() - ts;
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
};

export const MainMenu: React.FC<MainMenuProps> = ({ onStart, onCustomize, saveSummary }) => {
  const [showGuide, setShowGuide] = useState(false);
  const [showVersus, setShowVersus] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
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

  const buttons = useMemo(
    () => ([
      { id: "start", label: "START MISSION", activate: () => onStart({ mode: "campaign" }) },
      ...(onCustomize ? [{ id: "customize", label: "CUSTOMIZE", activate: onCustomize }] : []),
      { id: "versus", label: "VERSUS", activate: () => setShowVersus(true) },
      { id: "guide", label: "GUIDE", activate: () => setShowGuide(true) },
    ]),
    [onStart, onCustomize],
  );

  useEffect(() => {
    setSelectedIdx((prev) => Math.min(prev, Math.max(0, buttons.length - 1)));
  }, [buttons.length]);

  useEffect(() => {
    const nav = (action: "up" | "down" | "activate" | "close") => {
      if (action === "close") {
        if (showGuide) { setShowGuide(false); return; }
        if (showVersus) { setShowVersus(false); return; }
        return;
      }
      // Block background nav while a sub-dialog (Guide / Versus) owns
      // the foreground — otherwise D-Pad / arrows would silently move
      // the underlying menu cursor and Enter could activate START
      // beneath the open modal.
      if (showGuide || showVersus) return;
      if (action === "up" || action === "down") {
        // Wrap-around so a controller can ring through the row in
        // either direction without hitting a hard end-stop.
        setSelectedIdx((prev) => {
          const len = buttons.length;
          if (len === 0) return 0;
          const delta = action === "down" ? 1 : -1;
          return ((prev + delta) % len + len) % len;
        });
        return;
      }
      buttons[selectedIdx]?.activate();
    };
    const keyHandler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      if (e.repeat) return;
      // Left/Right behave like Up/Down so the four buttons sit on a
      // single linear ring whether the player thinks of them as a
      // horizontal or vertical strip.
      if (e.code === "ArrowUp" || e.code === "ArrowLeft") { e.preventDefault(); nav("up"); }
      else if (e.code === "ArrowDown" || e.code === "ArrowRight") { e.preventDefault(); nav("down"); }
      else if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); nav("activate"); }
      else if (e.code === "Escape" || e.code === "Backspace") { e.preventDefault(); nav("close"); }
    };
    const padHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { action?: string } | null;
      if (!detail?.action) return;
      if (detail.action === "left" || detail.action === "up") nav("up");
      else if (detail.action === "right" || detail.action === "down") nav("down");
      else if (detail.action === "activate") nav("activate");
      else if (detail.action === "close") nav("close");
    };
    window.addEventListener("keydown", keyHandler);
    window.addEventListener("gamepad-menu", padHandler);
    return () => {
      window.removeEventListener("keydown", keyHandler);
      window.removeEventListener("gamepad-menu", padHandler);
    };
  }, [buttons, selectedIdx, showGuide, showVersus]);

  // Pre-computed star positions for star field — stable across renders
  const stars = useMemo(
    () =>
      Array.from({ length: 140 }, () => ({
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: Math.random() < 0.85 ? 1 : 2,
        delay: Math.random() * 3,
        opacity: 0.3 + Math.random() * 0.7,
      })),
    [],
  );

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-black via-purple-950 to-black flex flex-col items-center overflow-hidden">
      {/* Star field */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {stars.map((s, i) => (
          <div
            key={i}
            className="absolute bg-white rounded-full animate-pulse"
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: `${s.size}px`,
              height: `${s.size}px`,
              animationDelay: `${s.delay}s`,
              opacity: s.opacity,
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

      {/* === HERO ART: blackletter title + CRT scene === */}
      <div className="relative z-10 w-full max-w-5xl mt-10 px-6">
        <h1
          className="text-center"
          style={{
            fontFamily: "'UnifrakturMaguntia', 'UnifrakturCook', 'Old English Text MT', 'Times New Roman', serif",
            fontSize: "clamp(64px, 9vw, 128px)",
            lineHeight: 1.0,
            letterSpacing: "0.04em",
            color: "#e7fbff",
            textShadow:
              "0 0 18px rgba(0,220,255,0.85), 0 0 38px rgba(255,80,200,0.55), 0 4px 0 rgba(0,40,80,0.6)",
            filter: "drop-shadow(0 0 24px rgba(0,200,255,0.45))",
          }}
        >
          HEAVY WATER
        </h1>

        {/* === CRT MONITOR + NEON PLANET + BOSS SILHOUETTE === */}
        <CrtBossScene />

        {/* Status indicators */}
        <div className="flex justify-center gap-8 text-xs text-gray-400 mt-3"
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

        {/* === SAVE SUMMARY (only when a cloud save exists) === */}
        {saveSummary && (
          <div className="mt-5 mx-auto max-w-2xl bg-black/60 border-2 border-cyan-400/50 rounded-lg p-4 backdrop-blur-sm"
               style={{ boxShadow: "0 0 20px rgba(0,200,255,0.25)" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-cyan-300 text-[11px] tracking-[0.3em]"
                   style={{ fontFamily: "'Press Start 2P', monospace", textShadow: "0 0 6px rgba(0,200,255,0.6)" }}>
                ▸ CLOUD SAVE
              </div>
              <div className="text-amber-300/90 text-[10px] tracking-wider"
                   style={{ fontFamily: "'Press Start 2P', monospace" }}>
                {formatSavedAt(saveSummary.savedAt)}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-[11px] text-gray-100">
              <div><span className="text-cyan-400">LVL</span> {saveSummary.level}</div>
              <div><span className="text-cyan-400">CREDITS</span> {saveSummary.credits.toLocaleString()}</div>
              <div><span className="text-cyan-400">KILLS</span> {saveSummary.totalKills.toLocaleString()}</div>
              <div><span className="text-cyan-400">WAVE</span> {saveSummary.highestWave}</div>
              <div className="col-span-2 md:col-span-2"><span className="text-cyan-400">ZONE</span> {WORLD_LEVEL_NAMES[saveSummary.worldLevel] ?? "Unknown"}</div>
              {saveSummary.companionCount != null && (
                <div><span className="text-cyan-400">HELPERS</span> {saveSummary.companionCount}</div>
              )}
              {saveSummary.bioDexCount != null && (
                <div><span className="text-cyan-400">BIO-DEX</span> {saveSummary.bioDexCount}</div>
              )}
            </div>
            <div className="text-center text-gray-400 text-[10px] mt-2 tracking-wider"
                 style={{ fontFamily: "'Press Start 2P', monospace" }}>
              START MISSION resumes from this save.
            </div>
          </div>
        )}

        {/* === ACTION BUTTONS === */}
        <div className="flex gap-4 justify-center mt-6">
          {buttons.map((btn, idx) => (
          <button
            key={btn.id}
            onClick={btn.activate}
            onMouseEnter={() => setSelectedIdx(idx)}
            className="px-12 py-4 text-xl font-bold text-black bg-gradient-to-r from-cyan-300 to-blue-500
                       rounded-lg transform hover:scale-105 transition-all duration-300
                       shadow-lg shadow-cyan-500/50 hover:shadow-blue-500/60
                       border-2 border-white/30"
            style={selectedIdx === idx ? { outline: "2px solid #22d3ee", outlineOffset: "3px" } : undefined}
          >
            {btn.label}
          </button>
          ))}
        </div>
      </div>

      {showGuide && <GameplayGuide onClose={() => setShowGuide(false)} />}
      {showVersus && (
        <VersusLobby
          onJoined={(p: VersusJoinPayload) => {
            setShowVersus(false);
            onStart({ mode: "versus", versus: p });
          }}
          onClose={() => setShowVersus(false)}
        />
      )}

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

/**
 * Retro CRT-monitor hero scene: bezel + scanlines + neon wireframe planet on
 * a grid horizon, with a silhouetted boss looming next to it watching the
 * screen. All built with SVG/CSS, no 3D model dependencies.
 */
const CrtBossScene: React.FC = () => {
  // Pre-computed star positions for the CRT screen
  const screenStars = useMemo(
    () =>
      Array.from({ length: 38 }, () => ({
        x: 60 + Math.random() * 480,
        y: 30 + Math.random() * 110,
        r: Math.random() < 0.8 ? 0.6 : 1.1,
        d: 1.5 + Math.random() * 2.5,
      })),
    [],
  );

  return (
    <div className="relative w-full mt-6 mb-2" style={{ height: 320 }}>
      <svg
        viewBox="0 0 800 320"
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="crtBezel" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1a1530" />
            <stop offset="50%" stopColor="#0b0820" />
            <stop offset="100%" stopColor="#05030f" />
          </linearGradient>
          <linearGradient id="crtScreen" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#020920" />
            <stop offset="60%" stopColor="#020715" />
            <stop offset="100%" stopColor="#03040a" />
          </linearGradient>
          <radialGradient id="crtVignette" cx="50%" cy="50%" r="60%">
            <stop offset="60%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.85)" />
          </radialGradient>
          <radialGradient id="crtGlow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="rgba(0,220,255,0.20)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          <linearGradient id="planetFill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#04243a" />
            <stop offset="100%" stopColor="#01060f" />
          </linearGradient>
          <radialGradient id="planetSheen" cx="35%" cy="35%" r="55%">
            <stop offset="0%" stopColor="rgba(120,230,255,0.55)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          <linearGradient id="bossGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0a0316" />
            <stop offset="100%" stopColor="#000" />
          </linearGradient>
          <pattern id="scanlines" width="2" height="3" patternUnits="userSpaceOnUse">
            <rect width="2" height="1.5" fill="rgba(0,0,0,0)" />
            <rect y="1.5" width="2" height="1.5" fill="rgba(0,0,0,0.45)" />
          </pattern>
          <filter id="bossBlur" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="0.8" />
          </filter>
          <filter id="neonBloom" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* === CRT MONITOR FRAME === */}
        {/* Outer bezel */}
        <rect
          x="40"
          y="20"
          width="540"
          height="280"
          rx="22"
          fill="url(#crtBezel)"
          stroke="#3a2a60"
          strokeWidth="2"
        />
        {/* Inner bezel */}
        <rect
          x="56"
          y="36"
          width="508"
          height="248"
          rx="14"
          fill="#000"
          stroke="#5a3aa0"
          strokeWidth="1"
        />
        {/* Screen */}
        <rect
          x="64"
          y="44"
          width="492"
          height="232"
          rx="10"
          fill="url(#crtScreen)"
        />
        {/* Outer ambient glow */}
        <rect
          x="40"
          y="20"
          width="540"
          height="280"
          rx="22"
          fill="url(#crtGlow)"
          pointerEvents="none"
        />

        {/* === SCREEN CONTENT === */}
        {/* Stars on the screen */}
        <g clipPath="url(#screenClip)">
          {screenStars.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#9be7ff" opacity="0.8">
              <animate
                attributeName="opacity"
                values="0.2;1;0.2"
                dur={`${s.d}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
        </g>
        <clipPath id="screenClip">
          <rect x="64" y="44" width="492" height="232" rx="10" />
        </clipPath>

        {/* Grid horizon */}
        <g clipPath="url(#screenClip)" opacity="0.85">
          <line x1="64" y1="200" x2="556" y2="200" stroke="#ff48d6" strokeWidth="1.2" filter="url(#neonBloom)" />
          {/* Receding grid lines */}
          {Array.from({ length: 8 }).map((_, i) => {
            const t = (i + 1) / 9;
            const y = 200 + t * 76;
            const stroke = `rgba(255,72,214,${0.7 - t * 0.55})`;
            return <line key={i} x1="64" y1={y} x2="556" y2={y} stroke={stroke} strokeWidth="1" />;
          })}
          {/* Vertical perspective lines */}
          {Array.from({ length: 13 }).map((_, i) => {
            const x = 64 + i * 41;
            const dx = (x - 310) * 1.6 + 310;
            return <line key={i} x1={x} y1="200" x2={dx} y2="276" stroke="rgba(255,72,214,0.45)" strokeWidth="0.9" />;
          })}
          <line x1="64" y1="276" x2="556" y2="276" stroke="rgba(255,72,214,0.65)" strokeWidth="1" />
        </g>

        {/* === NEON WIREFRAME PLANET === */}
        <g clipPath="url(#screenClip)" transform="translate(310, 158)">
          {/* Planet halo */}
          <circle cx="0" cy="0" r="74" fill="url(#planetSheen)" opacity="0.7" />
          <circle cx="0" cy="0" r="60" fill="url(#planetFill)" stroke="#22d3ee" strokeWidth="1.6" filter="url(#neonBloom)" />
          {/* Latitude rings (give it volume) */}
          <ellipse cx="0" cy="0" rx="60" ry="10" fill="none" stroke="#22d3ee" strokeWidth="0.9" opacity="0.85" />
          <ellipse cx="0" cy="-22" rx="55" ry="8" fill="none" stroke="#22d3ee" strokeWidth="0.7" opacity="0.6" />
          <ellipse cx="0" cy="22" rx="55" ry="8" fill="none" stroke="#22d3ee" strokeWidth="0.7" opacity="0.6" />
          {/* Rotating longitude lines */}
          <g>
            <animateTransform attributeName="transform" type="rotate" values="0;360" dur="22s" repeatCount="indefinite" />
            <ellipse cx="0" cy="0" rx="14" ry="60" fill="none" stroke="#22d3ee" strokeWidth="0.7" opacity="0.7" />
            <ellipse cx="0" cy="0" rx="32" ry="60" fill="none" stroke="#22d3ee" strokeWidth="0.6" opacity="0.55" />
            <ellipse cx="0" cy="0" rx="48" ry="60" fill="none" stroke="#22d3ee" strokeWidth="0.5" opacity="0.4" />
          </g>
          {/* Continent blobs (subtle) */}
          <g opacity="0.65">
            <path d="M -28,-14 q 12,-8 22,2 q 6,8 -6,12 q -16,4 -16,-14 z" fill="rgba(34,211,238,0.18)" stroke="rgba(34,211,238,0.4)" strokeWidth="0.6" />
            <path d="M 8,18 q 14,-2 18,8 q 2,10 -10,10 q -14,0 -8,-18 z" fill="rgba(34,211,238,0.18)" stroke="rgba(34,211,238,0.4)" strokeWidth="0.6" />
          </g>
          {/* Equator orbiting ring */}
          <g>
            <animateTransform attributeName="transform" type="rotate" values="0;-360" dur="14s" repeatCount="indefinite" />
            <ellipse cx="0" cy="0" rx="78" ry="14" fill="none" stroke="#ff48d6" strokeWidth="0.9" opacity="0.7" filter="url(#neonBloom)" />
          </g>
        </g>

        {/* "RADAR" target reticle */}
        <g clipPath="url(#screenClip)" opacity="0.7">
          <circle cx="120" cy="80" r="14" fill="none" stroke="#22d3ee" strokeWidth="0.8" />
          <line x1="106" y1="80" x2="134" y2="80" stroke="#22d3ee" strokeWidth="0.6" />
          <line x1="120" y1="66" x2="120" y2="94" stroke="#22d3ee" strokeWidth="0.6" />
          <text x="140" y="84" fontFamily="'Press Start 2P', monospace" fontSize="6" fill="#22d3ee">
            TGT-01
          </text>
          <text x="74" y="60" fontFamily="'Press Start 2P', monospace" fontSize="6" fill="#22d3ee">
            SCAN..
          </text>
        </g>

        {/* Scanlines overlay */}
        <rect x="64" y="44" width="492" height="232" rx="10" fill="url(#scanlines)" pointerEvents="none">
          <animate attributeName="y" values="44;47;44" dur="2.6s" repeatCount="indefinite" />
        </rect>
        {/* Vignette */}
        <rect x="64" y="44" width="492" height="232" rx="10" fill="url(#crtVignette)" pointerEvents="none" />

        {/* Occasional flicker */}
        <rect x="64" y="44" width="492" height="232" rx="10" fill="rgba(180,230,255,0.06)" pointerEvents="none">
          <animate attributeName="opacity" values="0.0;0.0;0.5;0.0;0.0;0.0" dur="6.5s" repeatCount="indefinite" />
        </rect>

        {/* CRT chassis details — base + power LED */}
        <rect x="120" y="296" width="380" height="14" rx="4" fill="#10082a" stroke="#3a2a60" strokeWidth="1" />
        <rect x="280" y="296" width="60" height="6" rx="2" fill="#000" />
        <circle cx="540" cy="290" r="2.5" fill="#22d3ee" filter="url(#neonBloom)">
          <animate attributeName="opacity" values="0.5;1;0.5" dur="1.6s" repeatCount="indefinite" />
        </circle>

        {/* === BOSS SILHOUETTE — looming next to monitor, watching === */}
        <g filter="url(#bossBlur)">
          <g transform="translate(660, 305)">
            {/* Subtle breathing sway */}
            <animateTransform
              attributeName="transform"
              type="translate"
              values="660,305; 660,300; 660,305"
              dur="4.5s"
              repeatCount="indefinite"
              additive="replace"
            />
            {/* Body / cloak */}
            <path
              d="M -78,0 L -68,-130 L -54,-180 L -30,-210 L 30,-210 L 54,-180 L 68,-130 L 78,0 Z"
              fill="url(#bossGrad)"
              stroke="#1a0a2a"
              strokeWidth="1"
            />
            {/* Shoulder pauldrons */}
            <path d="M -68,-130 L -92,-150 L -86,-110 L -68,-110 Z" fill="#03020a" />
            <path d="M 68,-130 L 92,-150 L 86,-110 L 68,-110 Z" fill="#03020a" />
            {/* Spiked horns */}
            <path d="M -22,-218 L -34,-256 L -8,-228 Z" fill="#03020a" />
            <path d="M 22,-218 L 34,-256 L 8,-228 Z" fill="#03020a" />
            {/* Head */}
            <ellipse cx="0" cy="-208" rx="24" ry="22" fill="#03020a" />
            {/* Glowing eyes — looking at the monitor (left) */}
            <ellipse cx="-9" cy="-208" rx="3.6" ry="1.6" fill="#ff2a55" filter="url(#neonBloom)">
              <animate attributeName="opacity" values="1;0.55;1" dur="2.2s" repeatCount="indefinite" />
            </ellipse>
            <ellipse cx="6" cy="-208" rx="3.6" ry="1.6" fill="#ff2a55" filter="url(#neonBloom)">
              <animate attributeName="opacity" values="0.7;1;0.7" dur="2.2s" repeatCount="indefinite" />
            </ellipse>
            {/* Chest core */}
            <circle cx="0" cy="-150" r="6" fill="#ff2a55" filter="url(#neonBloom)">
              <animate attributeName="opacity" values="0.5;1;0.5" dur="2.0s" repeatCount="indefinite" />
            </circle>
            {/* Arm reaching toward screen */}
            <path d="M -54,-180 L -120,-150 L -160,-100 L -150,-95 L -118,-130 L -68,-130 Z" fill="#03020a" />
            {/* Claw */}
            <path d="M -160,-100 L -172,-94 L -168,-90 L -160,-93 Z" fill="#03020a" />
            <path d="M -160,-93 L -172,-86 L -168,-82 L -160,-86 Z" fill="#03020a" />
          </g>
        </g>

        {/* Boss eye-glow reflection on monitor (subtle) */}
        <ellipse cx="540" cy="160" rx="14" ry="40" fill="rgba(255,42,85,0.06)" pointerEvents="none">
          <animate attributeName="opacity" values="0.04;0.10;0.04" dur="4.5s" repeatCount="indefinite" />
        </ellipse>
      </svg>
    </div>
  );
};
