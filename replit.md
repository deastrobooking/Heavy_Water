# Heavy Water

## Overview
Heavy Water is a 3D futuristic sci-fi action game developed with Babylon.js, set in a far-future Detroit. It features anime-style cell-shaded graphics, offering immersive ground and aerial combat, DBZ-style flight mechanics, and open-world exploration. The game's core purpose is to defend the city from an invasion of insane hybrid organoids, encompassing both ground swarms and hostile aerial forces. Key capabilities include deep exploration, dynamic combat, character customization, crafting, and base building, aiming to deliver a rich and engaging player experience. The business vision is to target the niche market of anime-style sci-fi game enthusiasts.

## User Preferences
- Design choice: Anime retro 80's sci-fi cell-shaded graphics style
- Design choice: Use Babylon.js (not React Three Fiber)
- Note: All mesh positioning must use height/2 to rest on ground
- Communication: Concise updates; documentation must always reflect changes.

## System Architecture
The game utilizes Babylon.js v8.x for WebGL/WebGPU rendering, focusing on an anime cell-shaded aesthetic with advanced post-processing effects. The frontend is built with React, TypeScript, and Vite. Core systems include an EventBus for decoupled communication, a generic StateMachine for entity behaviors, and a unified DamageSystem for combat.

**Rendering & Graphics:**
- Babylon.js handles 3D rendering with a fallback from WebGPU to WebGL2.
- Custom GLSL-ES-1.0 cell-shading with ink outlines, bloom, chromatic aberration, and FXAA.
- SkySystem manages a custom-shader gradient skybox, day/night cycle, and weather.
- LODCullSystem batches per-mesh distance culling at ~6 Hz: registers the city's buildings/platforms (1150/950 m radius — pushed past the 5%-visible Exp2 fog band at d≈1150 m so disables read as fog falloff, not popping; earlier 600/450 m sat inside the visible band and produced obvious wink-outs), enemy bases (320 m, turrets 260 m), and the boss fortress (700 m). A 15 m hysteresis band separates the enable and disable thresholds so on-the-edge meshes don't strobe as the player jitters across the boundary, and `getAbsolutePosition()` is used so future parented containers report world-space centres correctly. The system also exposes `setSuppressed(bool)` — sanctuary, space, and lab side-zones flip it on after `CityGenerator.setVisible(false)` so a previously-culled city wall can't pop back into a hidden world when the player walks within range. Lamp posts and rooftop neon center-lines stay always-on. Foliage and environment props keep their own per-system culling at 200–220 m. Mesh materials for projectiles are cached/frozen per-weapon-type and projectile spawn math reuses scratch vectors to avoid per-shot GC.

**Core Gameplay Mechanics:**
- **Combat:** Features a unified ExplosionSystem, melee combo chains, elemental casting (6 elements), Beam Sabre with special attacks, and unlimited ammo for ranged weapons. WeaponsSystem supports both on-foot and vehicle aim providers, plus a `setSpecialFireHandler(type, fn)` hook so tool-style "weapons" (Capture Net) route their primary fire to a custom handler instead of spawning a projectile (cooldown still applies). `TOOL_WEAPONS` tags those slots so they're filtered out of the upgrade UI/shop. The premium **Auto-Target Module** SPECIALS unlock (300 gears / 75 cores / 45 nano / 35 circuits / 3000 credits) installs a per-shot aim-bend in `WeaponsSystem.getAimForward()`: when enabled and an enemy-target provider is registered, the shot direction is slerp-blended (pull = 0.55) toward the nearest enemy whose direction from the firing origin sits inside a 25° cone and within 140 m. Capture Net + grenade arc are excluded so player intent reads cleanly. Game.tsx wires the provider once with a reused scratch array (no per-shot GC) that combines `EnemySystem.getEnemyMeshes()` + `AerialEnemySystem.getActiveUnits()` so ground swarms and dogfight targets both magnetize. Owned-flag persists in `SpecialsOwnedSnapshot.autoTarget` and is restored on save load.
- **Movement:** Player characters have complex state machines, a triple-jump flight system, Rocket Skates, and Boost Dash.
- **Spinning Downward Smash:** Hold KeyJ (gamepad LT in foot context) for 1 s while airborne to commit a dive-bomb. `SmashAttackSystem` charges the move, calls `PlayerController.startAirSmash()` which locks the capsule into a pure straight-down plunge at terminal velocity (-1.4 m/frame, gravity + horizontal input both suppressed in `updatePhysics()`), and spins the player mesh ~1030°/s for the cosmetic blade-rotor look. Enemies the player passes through take 25 melee chip damage (per-id de-dupe so a single dive can't multi-tick the same target). On landing, the player's `airSmashLandCb` fires once: emits a `tier:"large"` cyan shockwave through the unified `ExplosionSystem` (radius 9 m, ground ring on, shake 0.45) and AoE-damages every enemy in radius — 140 explosive to ground (linear falloff to 35% at the edge), 70% of that to aerial units within a vertically-generous 1.6× column. 1.5 s cooldown after landing prevents spam; charge cancels if the player lands, jetpacks, or releases KeyJ before the 1 s threshold (a smash that already triggered is committed).
- **Vehicles:** Parametrically generated ATVs and space fighters managed by VehicleFactory and VehicleSystem.
- **Inventory & Crafting:** A 24-slot InventorySystem and recipe-based CraftingSystem.
- **Loot & Pickups:** Handled by a PickupSystem with enemy-specific drop tables.
- **Progression:** Per-weapon leveling, companion upgrades, and a comprehensive UpgradeMenu.

**World & Environment:**
- A 1200x1200 open world with a central city and four biomes, generated by CityGenerator.
- Procedural L-system foliage in two flavours: `AlienFoliageSystem` (bio-luminescent alien plants — alienTree/alienBush/alienCoral) and `EarthFoliageSystem` (realistic terrestrial trees + shrubs — oak, pine, birch, willow, shrub, fern). Both share `lsystem/LSystemRenderer` (turtle interpreter that emits one merged trunk mesh + one merged leaf mesh per plant), per-preset materials, scatter the same wilderness band [90 m, 540 m] with seeded RNG and anti-overlap, expose `setVisible(bool)` so side-zones can hide them wholesale, and have their own ~220 m per-plant distance culler with hysteresis. Earth presets live in `lsystem/EarthLSystemPresets.ts`; per-preset trunk colours (dark brown for oak/pine, white-grey for birch, green stem for fern) and leaf tints (deep forest green, dark blue-green, yellow-green, sage, fresh green) keep mixed stands legible at distance. Cross-system placement is coordinated by `lsystem/FoliagePlacement.ts` — a single `KEEPOUT_ANCHORS` list (spawn + L1/L2/L3 fortresses + 4 cardinal temples @ r=480) and a module-level `FoliageOccupancy` registry both systems push to and query, so an alien plant and an earth plant never claim the same XZ point regardless of seeds; cleared on dispose so a hot-restart starts fresh.
- A MountainRingSystem.
- Accessible building interiors and a sky racetrack.
- Destructible glowing resource nodes managed by the MiningSystem.

**Base Building:**
- BaseSystem and BuildingSystem enable player-placed, multi-level structures with grid-snapped placement and serialization via PrefabSystem.

**Enemies & NPCs:**
- EnemySystem includes a wave spawner, Commander enemies, aerial enemies, Hostile Enemy Bases with turrets, Boss Fortresses, and Tank ground units. Tanks are slow heavily-armoured siege vehicles that spawn on the city outskirts (90–130 m from the player) on a dedicated 22 s cadence from wave 2 onward, fire long-range tracer shells, and drop scrap-heavy loot.
- Bio-Creature Dex defines 125+ collectible robotic creatures with archetypes, elemental types, and rarity tiers. Elemental types are `normal / flame / water / grass / electric / ice / psychic / evil / steel / crystal / dragon` (renamed `fire`→`flame` and `dark`→`evil` so the dex stops collapsing onto the obvious franchise; saves are unaffected because they store `speciesId`, not type strings). Each type drives a distinct silhouette via `BioCreatureSystem.applyTypeAccents()` (e.g. flame = horns + cinder tail + asymmetry; evil = dense panel lines + shoulder asymmetry + jagged horn; water = side fins + flow-cell backpack; grass = leafy ear-antennae + back tuft; electric = whip antennae; ice = rime plating + chest plate; crystal = heavy plating + cone horns; psychic = full visor + tall antenna; steel = boxy plating + box arms; dragon = wings + horns + armoured tail; normal = clean utility chassis), and a new `applyRarityFlair()` pass scales rare mons up ~1.08× / legendary ~1.18× and adds shoulder pads + plating + denser panel lines so boss-tier captures read as boss-tier at a glance.
- FriendlyNPCSystem scatters NPCs with interactive dialogue.

**Levels & Zones:**
- LevelSystem defines six distinct world levels: three combat fronts (Star City, Hold the Line, Purge the Void), a peaceful sanctuary side-zone (Ashur Sanctuary), an off-canon spacelike combat zone (Orbital Front), and a peaceful indoor lore side-zone (Pontiac Secret Lab). Each level has unique time of day and city themes.
- Ashur Sanctuary (Level 4) is a distinct world with a village, farming system, NPCs, and a garden plinth for creature deployment. The valley is ringed by 12 stylized snow-capped mountain peaks, has an alien crystal cave on its eastern edge (torus arch + rocky shell + glowing crystal cluster + stalagmites), is densely populated with two L-system foliage clusters (~120 added plants via `AlienFoliageSystem.scatterZone`, disposed on warp-out), and hosts 12 wandering peaceful cosmetic bio-critters (parametric body + head + 4 legs + glowing eyes) that bob along Lissajous wander loops around their home positions. On mount the sanctuary also spawns 8 *real* `BioCreatureSystem` creatures (huntable capture targets — tracked ids, despawned on warp-out so they don't linger in the world), tops up Bio Essence to a floor of 5, and auto-equips the **Capture Net** tool weapon (Digit8); the previously-equipped weapon is restored on dispose. Primary fire (LMB / RT) and the H key both throw a capture orb at the nearest bio-creature in 22 m via `BioCreatureSystem.attemptCaptureNearest`. The Capture Net is also reachable from the gamepad D-pad L/R (last slot in the weapon cycle) and the wildlife observer trickles +1 Bio Essence every 6 s up to a cap of 10 so a hunting player can never run dry mid-session inside the sanctuary. `GameEvents.UI_MESSAGE` is now subscribed in `Game.tsx` and routed through the on-screen banner, so silent-failure paths ("No bio-creature in range", "Need 1 Bio Essence", crafting/shop errors, etc.) finally surface to the player.
- Orbital Front (Level 5) is a vacuum-only zone focused on aerial combat. The player drops in already mounted in a CometFighter at `SPAWN_ALTITUDE = 300 m` (well above the hidden city/ground/foliage so any residual props read as tiny dots far below) with Earth parked on the horizon at the same altitude. The asteroid field is now a true spherical shell (64 rocks distributed via Marsaglia uniform-direction sampling, radius band 90–350 m around spawn) so coverage stays dense whether the player pitches up or down. Cruise speed is throttled by passing a slower override into `VehicleSystem.setForceForward(true, 28)` — the orbital ship locks at 28 m/s (boost cap 49 m/s) instead of the ground default 55/95 so dogfights are readable; `forcedCruiseSpeed` replaces the old `FORCED_CRUISE_SPEED` constant and is restored to default on warp-out. Because the throttle is locked on (perpetual cruise), `GamepadInput.setSpacecraftMode(true)` is flipped on warp-in so RT and LT both fire the primary weapon (instead of throttle/brake); LT additionally dispatches `KeyJ` on the same edge so the existing LMB+J Mega Beam Cannon combo window trips and the cannon fires alongside the regular shot. Mode is cleared on warp-out (releasing any stuck triggers under the spacecraft binding before swapping back to vehicle/foot mappings).
- Pontiac Secret Lab (Level 6) is a peaceful indoor side-zone owned by `PontiacLabSystem`. It hides the city + mountains + foliage + props and builds a 60×60 m bunker interior: dark metallic floor with cyan tech grid, glowing wall trim, six pulsing cryo pods, four LED-strip server racks, three holographic terminals, a central command desk, and two NPCs (Dr. Cynthia You and the ZIRCON research AI). Reached from the TRAVEL tab.

**Player Systems:**
- Character customization includes procedural generation, modular body parts, and a HumanoidCharacter system.
- ProgressSync.ts handles player progress, stats, inventory, and upgrades with auto-save.
- A ShopSystem manages in-game commerce.
- CompanionSystem manages digital companions, with a default maximum of 3.
- MapSystem provides a real-time minimap.

**Multiplayer:**
- MultiplayerSystem provides client-side WebSocket integration for up to 16 players per room, supporting room management, synchronization, chat, and enemy damage syncing.

**UI/UX:**
- Redesigned HUD, AuthUI, GameUI, shop interfaces, upgrade interfaces, multiplayer lobby, contextual build hotbar, MainMenu with character customization, and an EnemyHealthBarSystem for HTML overlays.
- A cloud-save summary card is displayed in the main menu for authenticated players.
- GamepadInput provides seamless controller integration.
- EffectsSystem drives visual effects.

## External Dependencies
- **PostgreSQL**: Primary database with Drizzle ORM.
- **Passport.js**: User authentication with local strategy and scrypt hashing.
- **Express-session with connect-pg-simple**: Persistent session management.
- **ws library**: WebSocket server for multiplayer.