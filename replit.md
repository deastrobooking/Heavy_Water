# Heavy Water

Heavy Water is a 3D futuristic sci-fi action game where players defend a cell-shaded Detroit from alien invasion through immersive ground and aerial combat, exploration, and customization.

## Run & Operate
_Populate as you build_

## Stack
- **Frameworks**: React, Express
- **Runtime**: Node.js
- **Rendering**: Babylon.js v8.x (WebGPU/WebGL2)
- **ORM**: Drizzle ORM
- **Authentication**: Passport.js (local strategy, scrypt hashing)
- **Session Management**: express-session with connect-pg-simple
- **Realtime**: `ws` library
- **Build Tool**: Vite
- **Language**: TypeScript

## Where things live
- `src/`: Main application source code
- `docs/`: Canonical developer documentation (39 markdown files)
- `public/`: Static assets
- `server/`: Backend server logic
- `schema.ts`: Database schema (via Drizzle ORM)
- `interface.ts`: API contracts and WebSocket protocols
- `theme.ts`: UI theme and styling

## Architecture decisions
- **Babylon.js for rendering**: Chosen over React Three Fiber for direct WebGL/WebGPU control and specific rendering pipeline requirements.
- **EventBus**: Decouples game systems for better maintainability and scalability.
- **Generic StateMachine**: Standardizes entity behavior management across diverse game elements.
- **Unified DamageSystem**: Centralizes all combat damage calculations and effects.
- **JSONB for Player Progress**: Utilizes PostgreSQL's JSONB for flexible and schema-less storage of player progress, inventory, and upgrades, avoiding frequent DB migrations.

## Product
- Immersive open-world exploration of a futuristic Detroit.
- Dynamic ground and aerial combat with DBZ-style flight mechanics.
- Character customization, crafting, and base building.
- Player progression through weapon leveling, companion upgrades, and a comprehensive upgrade menu.
- Multiplayer support for up to 16 players in co-op campaigns or PvP arenas.
- Rich lore through collectible robotic creatures and interactive NPCs.

## User preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground
- Communication: Concise updates; documentation must always reflect changes.

## Side-Zones
- **Level 10 — Ann Arbor Apocalypse**: Medium-sized city at the pure WEST corner `(-3000, 0, 0)` — west of every other map section. A giant alien mothership (~320 m saucer with central dome, ring of glowing purple under-lights, antenna spires) hovers at y=130 having crashed through 5 leaning, broken downtown towers. Combat: 10 maxed-out captains (healthMultiplier 2.6 — well above Zug's 1.4×) ring the saucer's upper deck around the dome; ground swarm includes one of every robot type at warp-in (drones, soldiers, heavies, insectoids, hybrids, commanders, tanks, titans, spider tanks) and the wave director maintains a live count of ~70 from the same pool (excluding captains/titans). Outer ring of ~18 intact city buildings with glowing windows for skyline. Difficulty 5.0 (highest in the roster). Hardest level — captains don't respawn, so picking them off the saucer is the primary objective.
- **Level 11 — Michigan Wilds**: Heightmap terrain side-zone at `(3000, 0, 1500)` using `MIHEIGHTMAP.png` served as `/textures/miheightmap.png`. Built with Babylon `CreateGroundFromHeightMap` and `TerrainMaterial`: low elevations become flooded lowlands under a sea-level water plane, mid elevations blend to grass foothills, and high elevations blend to generated rock texture. It hides the existing city/mountain/foliage props on mount so Detroit city materials remain untouched. Encounter layer: rare/legendary bio-creatures, collectible power blooms, rogue labs with L11 rescue cages, giant base landmarks, mothership wreck/patrol visuals, and new active `wilds_titan` / `wilds_transformer` enemy classes mixed with existing villains and ships.
- **Level 4 — Ashur Sanctuary**: Peaceful side-zone now uses a real rolling `sanctuaryTerrain` mesh, an expanded village/house kit, a visible pet clinic/hospital, farm harvests that can produce Animaton Feed, and pet-care bonding from the Bio Garden. Direct fast-travel from Ashur to Detroit L1/L2/L3 is blocked; route out through another outpost/wilds hop.
- **Level 7 — Swarms Lair**: Indoor cave; General Voidcrown.
- **Level 8 — Saginaw Underwater Lab**: Flooded arena; captains-only + spider-tank mid-bosses. Lives in its OWN map section at far SE corner `(1500, -1500)`, well beyond the mountain ring (r=560).
- **Level 9 — Zug Island Legion**: Open industrial wasteland; sustained waves of titans + captains + spider tanks (live target ~60, lifetime cap ~600). Hardest combat zone. Lives in its OWN map section at far SW corner `(-1500, -1500)`, opposite Saginaw. Both side-zones still hide the city + mountains on mount for visual clarity, but their fast-travel coords are now distinct corners of the expanded open world rather than the previous shared `(0,0,0)` "under the city" overlap. Decor: 4 giant evil-industrial factory complexes form a SOUTH skyline at z=c.z+380 (axis-aligned, 150 m apart, all facing north toward the player); a toxic-green river runs E-W along the FAR NORTH edge at z=c.z-360 with a big steel truss bridge (50 m pylons + suspension cables + red beacons) crossing it. Existing slag heaps / blast furnaces / smokestacks were pushed outside the combat ring (radii ≥ 220 m, east+west clusters only) so the arena floor stays wide open and the east/west sides are clear airspace for combat.

## Gotchas
- **Ghost Ride the Whip**: Ejecting from a vehicle (B key/controller) while boosting leaves it driverless but still active; it will explode after 6 seconds or on first contact with enemies/structures.
- **Grounded-elite fix**: Commanders/captains/titans no longer fly upward indefinitely when the player is grounded.
- **Power Jewels**: Very rare drops, specific sources (vaults, bosses, aerial battleships), mounted via Upgrade Menu's WEAPONS tab; persist via `ProgressSync.jewelMounts`.
- **Level Cap**: Player level capped at 100; `addExperience` handles multi-level gains and residual XP.
- **Capsule Upgrades**: Force-save immediately upon purchase to prevent loss from crashes.
- **Legendary Companion**: Grant conditions (General Voidcrown defeated, all 12 synthetics freed, all 4 lab animals freed) are re-evaluated on each relevant event.
- **Sticky SPECIALS unlocks**: Save snapshot for `sabreGold`, `supermanFlight`, `roboDragon` (and the other one-time SPECIALS) is OR-ed against `specialsOwnedRef.current` so a transient live-state regression (dragon dying before respawn-revive, sabre/player system being re-instantiated mid-session) can never wipe a paid unlock from disk.
- **Elemental Upgrades**: Elemental specials (RB / DPad ↑↓) now scale L1→L20 — damage +35%/lvl, cooldown ×0.92/lvl (floor 800ms), tracking volley grows from 1 → 8 projectiles per target every 2 lvls, dome radius +20%/lvl (psychic ≈ 70m at L20). Upgraded from credits in the PLAYER tab of the Tab/Select menu; persisted via `ProgressSync.elementalLevels`.
- **Tracking elementals as beams**: Lightning / Ice / Fireball each fire ONE big colored mega-beam-style shaft (3 coaxial cylinders + muzzle orb + 1 light) instead of spawning per-target volleys. The old per-target tracker storm (up to ~80 self-homing projectiles per cast at high levels) was crashing/slowing the scene. Total damage = `scaledDamage × targets × volley` so upgrade levels still pay off. Dome elementals (Inferno / Windstorm / Psychic) are unchanged.

## Pointers
- **Developer Hub**: [`docs/`](docs/)
- **Player-facing Guides**: `README.md`, `GAMEPLAY_GUIDE.md`
- **Historical Developer Guide**: `Docs/DEVELOPERS_GUIDE.md`
- **Babylon.js Documentation**: [babylonjs.com](https://doc.babylonjs.com/)
- **Drizzle ORM Documentation**: [orm.drizzle.team](https://orm.drizzle.team/docs/overview)
- **Passport.js Documentation**: [www.passportjs.org](http://www.passportjs.org/docs/)
