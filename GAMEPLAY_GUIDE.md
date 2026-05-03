# Heavy Water — Gameplay Guide

Welcome to Heavy Water. You are a pilot defending far-future Detroit from the
Insane Hybrid Organoids. This guide is your full pilot's reference: every
control, every system, every combat tool. The same content is available
in-game from the **GUIDE** button on the main menu.

---

## 1. Movement

| Action | Keys |
|---|---|
| Move | `W A S D` |
| Sprint | `SHIFT` |
| Jump / Triple-Jump | `SPACE` |
| Boost Dash (mid-air) | `SHIFT + SPACE` |
| Look | Mouse |

**Triple-jump → Rocket Skates flight.** Press `SPACE` three times in the air to
enter DBZ-style flight. While flying, `WASD` steers, `SPACE` climbs, `CTRL`
dives.

---

## 2. Ranged Combat

| Action | Keys |
|---|---|
| Fire | Left Mouse |
| Reload | `R` |
| Cycle weapon | Mouse Wheel |
| Switch weapon directly | `1` – `6` |

All ranged weapons have **unlimited ammo**. Reload just resets your magazine.

---

## 3. Melee & Beam Sabre

| Action | Keys |
|---|---|
| Light slash | `V` |
| Heavy slash | `B` |
| Dodge | `Q` |
| Parry | `F` |

Slashes chain into combos. Time the next press to keep the chain alive — the
finisher deals bonus damage.

---

## 4. Beam Sabre Combos

| Combo | Gamepad | Keyboard | Effect |
|---|---|---|---|
| **Mega Beam Cannon** | `LT + RT` | — | Homing missiles + Kamehameha laser |
| **Fury Slash** | `LT + Y` | `;` | 5 wide rapid slashes · 1.4× damage |
| **Smash Lash** | `LT + X` | `'` | Heavy smash + 12 cyan waves radiating omnidirectionally |

Combos preempt any in-flight regular slash, so the natural *"hold trigger,
tap face button"* order works reliably on both keyboard and gamepad.

---

## 5. Elemental Casting

| Element | Key |
|---|---|
| Inferno | `U` |
| Ice | `I` |
| Storm | `O` |
| Earth | `P` |
| Light | `K` |
| Void | `L` |

Six elements unlock as you progress. Each fires a **Tracking Strike** (homes
on enemies) and triggers **Dome Explosions** on impact.

---

## 5b. Fast Travel & Ashur Sanctuary

Open the upgrade menu (`TAB`) and switch to the **TRAVEL** tab. Six
destinations are listed:

| Level | Zone |
|---|---|
| 1 | Star City Front |
| 2 | Hold the Line |
| 3 | Purge the Void |
| 4 | **Ashur Sanctuary** — peaceful |
| 5 | **Orbital Front** — starfield combat (Earth, asteroids, motherships) |
| 6 | **Pontiac Secret Lab** — covert pre-war research wing (peaceful, lore) |

Click **WARP** on any row to instantly relocate. Your inventory, weapons,
upgrades and built structures are preserved.

**Ashur Sanctuary** is a peaceful corner of the world. There are no enemies,
no fortress, no wave timer. Three sanctuary NPCs (Theta, Sergio Wolfrim, Ion)
greet you. Five **farm plots** are arranged in a row near the spawn —
press `E` near a plot with a `bio_seed` in your inventory to plant; wait
through 3 growth stages (~90 s) and press `E` again to harvest a `bio_crop`.

You start with 5 `bio_seed`s the first time you enter the sanctuary.

**Pontiac Secret Lab** (Level 6) is a covert pre-war research facility just
north of Detroit, hidden inside a 60×60 m enclosed bunker. The world is
swapped wholesale on entry — dark metallic floor with a cyan tech grid,
glowing wall trim, six pulsing cryo pods along the east wall (each with a
captured Animaton silhouette), four diagnostic-LED server racks along the
west wall, three holographic command terminals on the north, and a central
command desk. Two NPCs greet you: **Dr. Cynthia You** (the original
Animaton-bonding researcher) and **ZIRCON**, the lab's node-locked
research AI. Peaceful zone — no waves, no fortress.

---

## 6. Bio-Creature Capture

| Action | Keys |
|---|---|
| Throw Capture Orb | `H` |

The Bio-Creature Dex contains **125+ collectible robotic-Pokemon-style
creatures** with archetypes, elemental types, and rarity tiers. To capture one:

1. Weaken it to low HP.
2. Throw a Capture Orb (`H`) at it.
3. Rarer creatures need stronger orbs and lower HP thresholds.

---

## 7. World & Traversal

| Action | Keys |
|---|---|
| Interact / Mount vehicle | `E` |
| Map | `M` |
| Inventory & Upgrades | `TAB` |

A **1200×1200 open world** with a central city and four biomes. A ring of
nine mountain ranges surrounds the wilderness. Four stepped-pyramid hidden
temples house level-scaled rare-item bundles guarded by spawned creatures.

ATVs and space fighters are mountable when you find them — walk up and press
`E`.

---

## 8. Base Building

Open the upgrade menu with `TAB` to unlock build mode. Structures are
grid-snapped, multi-level, and serialized into **prefabs** you can save and
share.

---

## 9. Music

| Action | Keys |
|---|---|
| Previous / Next track | `[` `]` |
| Play / Pause | `\` |

---

## 10. Graphics (advanced)

The **WebGPU** backend is opt-in for this build. Open your browser console:

```js
// Enable WebGPU on next refresh:
localStorage.setItem("heavywater:webgpu", "1");

// Disable / return to WebGL2:
localStorage.removeItem("heavywater:webgpu");
```

Then refresh the page. The active backend is logged on startup as
`[BabylonEngine] WebGPU backend active` or `WebGL2 backend active`.

**Note:** the WebGPU path is currently **experimental**. Several custom
shaders are still GLSL-ES-1.0 and only compile on WebGL2:

- The cell-shading ink-outline post-process (gated off automatically on WebGPU).
- The sky gradient/day-night shader (`SkySystem`).
- The city neon-stripe shader (`CityGenerator`).

The first is gated; the latter two are not yet — they may render
incorrectly or throw on WebGPU until they're ported to WGSL. Bloom, FXAA,
sharpen, and chromatic aberration all work on both backends.

If WebGPU init fails for any reason (no adapter, driver issue, browser
support), the engine automatically falls back to WebGL2 — you won't end up
with a black screen.

---

## 11. Multiplayer

Up to 16 players can join a session via WebSocket. The lobby is reachable
from the main menu after auth. Enemy damage and chat are synchronized.
