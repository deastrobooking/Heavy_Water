import React, { useEffect, useState } from "react";

interface GameplayGuideProps {
  onClose: () => void;
}

interface Section {
  id: string;
  title: string;
  body: { label?: string; keys?: string; text?: string }[];
}

const SECTIONS: Section[] = [
  {
    id: "movement",
    title: "MOVEMENT",
    body: [
      { label: "Move", keys: "WASD" },
      { label: "Sprint", keys: "SHIFT" },
      { label: "Jump / Triple-Jump", keys: "SPACE" },
      { label: "Boost Dash", keys: "SHIFT + SPACE (mid-air)" },
      { label: "Look", keys: "MOUSE" },
      { label: "Rocket Skates flight", text: "Triple-jump in the air to enter flight. WASD steers, SPACE climbs, CTRL dives." },
    ],
  },
  {
    id: "ranged",
    title: "RANGED COMBAT",
    body: [
      { label: "Fire", keys: "LEFT MOUSE" },
      { label: "Reload", keys: "R" },
      { label: "Cycle weapon", keys: "MOUSE WHEEL" },
      { label: "Switch weapon", keys: "1 – 6" },
      { text: "All ranged weapons have unlimited ammo. Reload only resets the magazine." },
    ],
  },
  {
    id: "melee",
    title: "MELEE & BEAM SABRE",
    body: [
      { label: "Light slash", keys: "V" },
      { label: "Heavy slash", keys: "B" },
      { label: "Dodge", keys: "Q" },
      { label: "Parry", keys: "F" },
      { text: "Beam Sabre slashes chain into combos. Time the next press to keep the chain alive — finishers deal bonus damage." },
    ],
  },
  {
    id: "specials",
    title: "BEAM SABRE COMBOS",
    body: [
      { label: "Mega Beam Cannon", keys: "LT + RT  ·  (homing missiles + Kamehameha laser)" },
      { label: "Fury Slash", keys: "LT + Y   /   ;   ·  5 wide rapid slashes, 1.4× damage" },
      { label: "Smash Lash", keys: "LT + X   /   '   ·  heavy smash + 12 cyan waves radiating omnidirectionally" },
      { text: "Combos preempt any in-flight regular slash, so the natural \"hold trigger, tap face button\" order works reliably on both keyboard and gamepad." },
    ],
  },
  {
    id: "travel",
    title: "FAST TRAVEL & SANCTUARY",
    body: [
      { label: "Open menu", keys: "TAB" },
      { text: "Switch to the TRAVEL tab to warp between six zones: three combat fronts (Star City, Hold the Line, Purge the Void), the peaceful Ashur Sanctuary, the Orbital Front (starfield combat with Earth on the horizon, drifting asteroids, and drone-orbited motherships), and the Pontiac Secret Lab (a covert pre-war research bunker with cryo pods, server racks, holo terminals and Dr. Cynthia You). Inventory, upgrades and built structures are preserved across warps." },
      { text: "Default helper-bot loadout cap is 3. Upgrade the Lab to raise it. The Sanctuary now has a glowing cyan plinth that opens the deploy / capture UI directly — no need to build a Garden first." },
      { text: "After signing in, the main menu shows a Cloud Save card under the buttons with your level, credits, kills, current zone and last-saved time so you know exactly what START MISSION will resume." },
      { label: "Plant / harvest", keys: "E (sanctuary plots)" },
      { text: "The sanctuary has 5 farm plots, three NPCs and a signpost. Plant a bio_seed, wait through 3 growth stages, harvest a bio_crop. You receive 5 starter bio_seeds the first time you enter." },
    ],
  },
  {
    id: "elements",
    title: "ELEMENTAL CASTING",
    body: [
      { label: "Cast element", keys: "U  I  O  P  K  L" },
      { text: "Six elements unlock as you progress: Inferno, Frost, Storm, Earth, Light, Void. Each fires a Tracking Strike (homes in on enemies) and triggers Dome Explosions on impact." },
    ],
  },
  {
    id: "creatures",
    title: "BIO-CREATURES",
    body: [
      { label: "Throw Capture Orb", keys: "H" },
      { text: "125+ collectible robotic creatures roam the world. Weaken one to low HP, then throw a Capture Orb. Rarer creatures need stronger orbs and lower HP thresholds." },
    ],
  },
  {
    id: "world",
    title: "WORLD & TRAVERSAL",
    body: [
      { label: "Interact / Mount vehicle", keys: "E" },
      { label: "Map", keys: "M" },
      { label: "Inventory & Upgrades", keys: "TAB" },
      { text: "1200×1200 open world: central city, four biomes, mountain ring, and four hidden stepped-pyramid temples. ATVs and space fighters are mountable when you find them." },
    ],
  },
  {
    id: "base",
    title: "BASE BUILDING",
    body: [
      { text: "Open the upgrade menu (TAB) to unlock build mode. Structures are grid-snapped, multi-level, and serialized into prefabs you can save / share." },
    ],
  },
  {
    id: "music",
    title: "MUSIC",
    body: [
      { label: "Previous / Next track", keys: "[   ]" },
      { label: "Play / Pause", keys: "\\" },
    ],
  },
  {
    id: "graphics",
    title: "GRAPHICS (advanced)",
    body: [
      { text: "WebGPU backend is opt-in and EXPERIMENTAL. Open the browser console and run:" },
      { label: "Enable", keys: "localStorage.setItem('heavywater:webgpu','1')" },
      { label: "Disable", keys: "localStorage.removeItem('heavywater:webgpu')" },
      { text: "Then refresh. Several custom shaders (ink outline, sky, city) are still GLSL-ES-1.0 and will not render — and may throw — on WebGPU. Bloom, FXAA, sharpen, and chromatic aberration all work. If WebGPU init fails the game falls back to WebGL2 automatically." },
    ],
  },
];

export const GameplayGuide: React.FC<GameplayGuideProps> = ({ onClose }) => {
  const [active, setActive] = useState<string>(SECTIONS[0].id);

  // ESC closes — convenience for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const activeSection = SECTIONS.find(s => s.id === active) ?? SECTIONS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl max-h-[88vh] flex flex-col bg-gradient-to-br from-[#06091a] to-[#0a0420]
                   border-2 border-cyan-400/60 rounded-2xl shadow-2xl shadow-cyan-500/30 overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ boxShadow: "0 0 60px rgba(0,200,255,0.25)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-400/30 bg-black/40">
          <div>
            <div
              className="text-cyan-300 text-sm tracking-[0.5em]"
              style={{ fontFamily: "'Press Start 2P', monospace", textShadow: "0 0 10px rgba(0,200,255,0.6)" }}
            >
              FIELD MANUAL
            </div>
            <div className="text-cyan-100/70 text-xs mt-1 tracking-wider">
              Heavy Water — Pilot's Reference
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-cyan-200 border-2 border-cyan-400/60 rounded-lg
                       hover:bg-cyan-500/15 hover:border-cyan-300 transition-colors text-sm font-bold tracking-widest"
          >
            CLOSE  ✕
          </button>
        </div>

        {/* Body: nav + content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Section nav */}
          <nav className="w-56 shrink-0 overflow-y-auto bg-black/40 border-r border-cyan-400/20 py-3">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={
                  "block w-full text-left px-5 py-2.5 text-xs tracking-wider transition-colors " +
                  (active === s.id
                    ? "text-cyan-200 bg-cyan-500/15 border-l-4 border-cyan-300"
                    : "text-gray-400 hover:text-cyan-300 hover:bg-cyan-500/5 border-l-4 border-transparent")
                }
                style={{ fontFamily: "'Press Start 2P', monospace", fontSize: "10px" }}
              >
                {s.title}
              </button>
            ))}
          </nav>

          {/* Active section content */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            <h2
              className="text-cyan-200 mb-5 tracking-[0.3em]"
              style={{ fontFamily: "'Press Start 2P', monospace", fontSize: "16px", textShadow: "0 0 8px rgba(0,200,255,0.5)" }}
            >
              ▸ {activeSection.title}
            </h2>
            <div className="space-y-3">
              {activeSection.body.map((row, i) => (
                <div
                  key={i}
                  className={
                    row.keys
                      ? "flex items-baseline gap-4 py-2 border-b border-cyan-400/10"
                      : "py-2 text-gray-300 leading-relaxed text-sm"
                  }
                >
                  {row.keys ? (
                    <>
                      <span className="text-gray-300 text-sm flex-1">{row.label}</span>
                      <span
                        className="text-cyan-300 font-bold text-xs px-3 py-1 bg-cyan-500/10 border border-cyan-400/40 rounded"
                        style={{ fontFamily: "'Press Start 2P', monospace" }}
                      >
                        {row.keys}
                      </span>
                    </>
                  ) : (
                    <span>{row.text}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer hint */}
        <div className="px-6 py-3 border-t border-cyan-400/20 bg-black/40 text-center">
          <span className="text-amber-300/80 text-[10px] tracking-[0.3em]"
                style={{ fontFamily: "'Press Start 2P', monospace" }}>
            ESC to close · Click outside to dismiss
          </span>
        </div>
      </div>
    </div>
  );
};
