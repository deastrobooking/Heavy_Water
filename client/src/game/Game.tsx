import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders";
import { BabylonEngine } from "./BabylonEngine";
import { CityGenerator } from "./CityGenerator";
import { LODCullSystem } from "./LODCullSystem";
import { PlayerController, PlayerStats, PlayerUpgradeInfo } from "./PlayerController";
import { WeaponsSystem, Weapon } from "./WeaponsSystem";
import { EnemySystem } from "./EnemySystem";
import { AerialEnemySystem } from "./AerialEnemySystem";
import { SmashAttackSystem } from "./SmashAttackSystem";
import { EnemyHealthBarSystem, EnemyLike } from "./EnemyHealthBarSystem";
import { FriendlyNPCSystem } from "./FriendlyNPCSystem";
import { RescueSystem } from "./RescueSystem";
import { GamepadInput } from "./GamepadInput";
import { ChestSystem, Loot } from "./ChestSystem";
import { CombatSystem } from "./CombatSystem";
import { SpecialWeaponsSystem } from "./SpecialWeaponsSystem";
import { ElementalSpecialsSystem, ElementalDisplay, ElementalKind, type ElementalUpgradeInfo } from "./ElementalSpecialsSystem";
import { BeamSabreSystem } from "./BeamSabreSystem";
import { MeleeArsenalSystem, type ArsenalWeaponId } from "./MeleeArsenalSystem";
import { MegaBeamCannonSystem } from "./MegaBeamCannonSystem";
import { ArmorSystem } from "./ArmorSystem";
import { CraftingSystem } from "./CraftingSystem";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";
import { JewelSystem, JEWEL_DEFS, JEWEL_MOUNTABLE_WEAPONS, type JewelTier } from "./JewelSystem";
import { CRAFTING_MATERIALS } from "./CraftingSystem";
import { CompanionSystem } from "./CompanionSystem";
import { ArmorCapsuleSystem, ArmorUpgrade } from "./ArmorCapsuleSystem";
import { ShopSystem, ShopDefinition } from "./ShopSystem";
import { GardenSystem } from "./GardenSystem";
import { MapSystem } from "./MapSystem";
import { BuildingSystem, BlockType, BlockDefinition } from "./BuildingSystem";
import { PrefabSystem, PrefabSummary } from "./PrefabSystem";
import { PickupSystem } from "./PickupSystem";
import { BaseSystem, BaseStructure } from "./BaseSystem";
import { BioCreatureSystem, CapturedCreature } from "./BioCreatureSystem";
import { MountainRingSystem } from "./MountainRingSystem";
import { AlienFoliageSystem } from "./AlienFoliageSystem";
import { EarthFoliageSystem } from "./EarthFoliageSystem";
import { VehicleSystem } from "./VehicleSystem";
import { EnvironmentPropSystem, PropHitboxMetadata } from "./EnvironmentPropSystem";
import { MusicSystem } from "./MusicSystem";
import { MusicPlayerUI } from "./MusicPlayerUI";
import { WeaponUpgradeInfo } from "./WeaponsSystem";
import { CompanionUpgradeInfo } from "./CompanionSystem";
import { LabBlueprint } from "./LabUI";
import { LevelSerializer } from "./LevelSerializer";
import { MultiplayerSystem } from "./MultiplayerSystem";
import { VersusArena } from "./VersusArena";
import type { StartPayload } from "./MainMenu";
import { EffectsSystem } from "./EffectsSystem";
import { ExplosionSystem } from "./ExplosionSystem";
import { PropAudioSystem } from "./PropAudioSystem";
import { SoundSystem } from "./SoundSystem";
import { SkySystem } from "./SkySystem";
import { MiningSystem } from "./MiningSystem";
import { EnemyBaseSystem } from "./EnemyBaseSystem";
import { LevelSystem, WorldLevel } from "./LevelSystem";
import { SanctuarySystem } from "./SanctuarySystem";
import { PontiacLabSystem } from "./PontiacLabSystem";
import { SpaceLevelSystem } from "./SpaceLevelSystem";
import { SwarmsLairSystem } from "./SwarmsLairSystem";
import { SaginawLabSystem } from "./SaginawLabSystem";
import { ZugIslandSystem } from "./ZugIslandSystem";
import { AnnArborSystem } from "./AnnArborSystem";
import { MichiganTerrainSystem } from "./MichiganTerrainSystem";
import { setPlayerIsFlyingProvider as setEnemyPlayerIsFlyingProvider } from "./EnemySystem";
import { RESCUE_DEFS } from "./RescueSystem";
import { loadProgress, saveProgress, ProgressSnapshot } from "./ProgressSync";
import { EventBus, GameEvents } from "./EventBus";
import { DamageType } from "./DamageSystem";
import { GameUI } from "./GameUI";
import { MainMenu, SaveSummary } from "./MainMenu";
import { CharacterEditor, refreshEnemyStyleOverrides } from "./CharacterEditor";
import AuthUI from "./AuthUI";
import type { TravelWarpPoint } from "./UpgradeMenu";

type GamePhase = "auth" | "menu" | "playing" | "paused" | "gameover";
const MAX_FRAME_DELTA_MS = 100;

// One source of truth for the SPECIALS-tab unlocks. Used both for
// affordability checks in `specialsList` and for charging in
// `handleUnlockSpecial`, so prices can never drift between the two.
type SpecialId = "sabreSpin" | "sabreTwin" | "sabreGiant" | "sabreGold" | "autoLoot" | "roboDragon" | "autoTarget" | "supermanFlight"
  | "glaiveOwn" | "glaiveCombo" | "glaiveSpecial"
  | "daggersOwn" | "daggersCombo" | "daggersSpecial"
  | "axeOwn" | "axeCombo" | "axeSpecial"
  | "whipOwn" | "whipCombo" | "whipSpecial";
interface SpecialDef {
  id: SpecialId;
  name: string;
  description: string;
  cost: { gears: number; cores: number; nanofiber: number; circuits?: number; credits?: number };
}
const SPECIALS_DEFS: readonly SpecialDef[] = [
  { id: "sabreSpin",  name: "Spinning Blade",   description: "Hold sabre slash for ~0.5s, release for a 360° spin AoE.",
    cost: { gears: 80,  cores: 12, nanofiber: 8 } },
  { id: "sabreTwin",  name: "Twin Wave",        description: "Every arc wave is shadowed by a much larger trailing red wave.",
    cost: { gears: 100, cores: 18, nanofiber: 12 } },
  { id: "sabreGiant", name: "Giant Blade",      description: "Sabre grows 1.6× longer, +50% damage and reach.",
    cost: { gears: 120, cores: 25, nanofiber: 18 } },
  { id: "autoLoot",   name: "Auto-Loot Drones", description: "Companions vacuum nearby pickups in addition to you.",
    cost: { gears: 60,  cores: 10, nanofiber: 6 } },
  { id: "roboDragon", name: "Robot Dragon",     description: "Summon the elite Robot Dragon companion (third slot).",
    cost: { gears: 250, cores: 60, nanofiber: 35, circuits: 30, credits: 1500 } },
  // Premium aim-assist module. Priced higher than every other SPECIAL because
  // it is a permanent, always-on combat modifier that benefits every weapon
  // the player owns from the moment of purchase forward.
  { id: "autoTarget", name: "Auto-Target Module", description: "Magnetizes primary fire toward the nearest enemy in a 25° cone (range 140 m). Works on every weapon.",
    cost: { gears: 300, cores: 75, nanofiber: 45, circuits: 35, credits: 3000 } },
  // Superman Flight — premium movement upgrade. While airborne, press
  // dash + jump together to enter free-flight; hold Space to boost
  // (~3× cruise) and outrun aerial chase enemies. No energy drain;
  // weapons fire normally. Press X (or the combo again) to land.
  { id: "supermanFlight", name: "Superman Flight", description: "While airborne, press dash + jump to free-fly. Hold Space to boost (~3× cruise). Press X to land.",
    cost: { gears: 350, cores: 90, nanofiber: 55, circuits: 40, credits: 4000 } },
  // Final-tier Beam Sabre. Inner blue / middle red / outer gold layered
  // blade; every energy-wave launch fires three stacked waves
  // (blue → red → largest gold). Top-shelf SPECIALS pricing — even
  // pricier than the Superman Flight upgrade above.
  { id: "sabreGold",      name: "Gold Sabre (Final)", description: "Final-tier blade — inner blue, middle red, outer gold halo. Every energy wave fires three stacked waves: blue, red, then a giant gold finisher.",
    cost: { gears: 800, cores: 200, nanofiber: 120, circuits: 80, credits: 12000 } },
  // -------- Melee Arsenal — alternate melee weapons. Each weapon has three
  // -------- SPECIALS tiers: OWN (unlock the weapon + cycle slot), COMBO
  // -------- (chain / pull-in / upper-swing on the primary), SPECIAL (the
  // -------- signature super-move bound to KeyN). Cycle with KeyB.
  { id: "glaiveOwn",      name: "Beam Glaive",          description: "Long polearm beam — wide horizontal sweep arc. Cycle with KeyB to equip in place of the Beam Sabre.",
    cost: { gears: 60,  cores: 10, nanofiber: 6 } },
  { id: "glaiveCombo",    name: "Glaive Combo: Triple Sweep", description: "Glaive primary becomes a 3-sweep chain that fans across the front cone.",
    cost: { gears: 110, cores: 20, nanofiber: 14 } },
  { id: "glaiveSpecial",  name: "Glaive Special: Comet Spin", description: "KeyN spawns a green crescent that orbits the player at 6 m for 1.4 s, slicing anything it crosses.",
    cost: { gears: 160, cores: 30, nanofiber: 22, circuits: 10 } },
  { id: "daggersOwn",     name: "Twin Beam Daggers",    description: "Twin pink beam blades — fast 4-stab front-cone primary attack. Cycle with KeyB.",
    cost: { gears: 70,  cores: 12, nanofiber: 8 } },
  { id: "daggersCombo",   name: "Daggers Combo: Phantom Step", description: "Stab count rises 4 → 6 and a phantom-step sparkle fires forward at the start of every chain.",
    cost: { gears: 120, cores: 22, nanofiber: 16 } },
  { id: "daggersSpecial", name: "Daggers Special: Phantom Storm", description: "KeyN strikes the 3 nearest enemies in 18 m for huge damage, leaving an afterimage at each.",
    cost: { gears: 170, cores: 32, nanofiber: 24, circuits: 10 } },
  { id: "axeOwn",         name: "Plasma War Axe",       description: "Heavy two-hander — slow, hard cleave with massive knockback. Cycle with KeyB.",
    cost: { gears: 90,  cores: 16, nanofiber: 10 } },
  { id: "axeCombo",       name: "Axe Combo: Cleave + Upper", description: "Primary cleave is followed automatically by a wider upper-swing return.",
    cost: { gears: 140, cores: 26, nanofiber: 18, circuits: 8 } },
  { id: "axeSpecial",     name: "Axe Special: Ground Slam", description: "KeyN slams the ground — an expanding shockwave ring (radius 14 m) damages and knocks up everything it touches.",
    cost: { gears: 200, cores: 38, nanofiber: 28, circuits: 14 } },
  { id: "whipOwn",        name: "Spiked Chain Whip",    description: "Long-reach spiked chain — narrow 16 m lash that hits enemies in a forward line. Cycle with KeyB.",
    cost: { gears: 80,  cores: 14, nanofiber: 9 } },
  { id: "whipCombo",      name: "Whip Combo: Pull-In Lash", description: "On hit, the whip yanks the closest target ~3 m closer to you for follow-up melee.",
    cost: { gears: 130, cores: 24, nanofiber: 17, circuits: 8 } },
  { id: "whipSpecial",    name: "Whip Special: Flail Spin", description: "KeyN spins the whip in a 360° flail around you — 4 ticks over 1 s in a 9 m radius.",
    cost: { gears: 190, cores: 36, nanofiber: 26, circuits: 12 } },
];

export const Game: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BabylonEngine | null>(null);
  const initializingRef = useRef(false);
  // One-shot guard so we only pause music once per death (the death check
  // runs every render frame). Reset on initializeGame / handleRestart.
  const deathHandledRef = useRef(false);
  const playerRef = useRef<PlayerController | null>(null);
  const weaponsRef = useRef<WeaponsSystem | null>(null);
  const enemySystemRef = useRef<EnemySystem | null>(null);
  const aerialEnemyRef = useRef<AerialEnemySystem | null>(null);
  const smashAttackRef = useRef<SmashAttackSystem | null>(null);
  const enemyHealthBarsRef = useRef<EnemyHealthBarSystem | null>(null);
  const friendlyNPCsRef = useRef<FriendlyNPCSystem | null>(null);
  const rescueSystemRef = useRef<RescueSystem | null>(null);
  const sanctuarySystemRef = useRef<SanctuarySystem | null>(null);
  const pontiacLabSystemRef = useRef<PontiacLabSystem | null>(null);
  const spaceLevelSystemRef = useRef<SpaceLevelSystem | null>(null);
  const swarmsLairSystemRef = useRef<SwarmsLairSystem | null>(null);
  const saginawLabSystemRef = useRef<SaginawLabSystem | null>(null);
  const zugIslandSystemRef = useRef<ZugIslandSystem | null>(null);
  const annArborSystemRef = useRef<AnnArborSystem | null>(null);
  const michiganTerrainSystemRef = useRef<MichiganTerrainSystem | null>(null);
  // Long-lived progress mirrors for the Pontiac Lab → Swarms Lair chain.
  // PontiacLabSystem is rebuilt on every L6 entry, so the freed-animal id
  // set must outlive it here in Game.tsx (read on next mount, written on
  // ANIMAL_FREED). swarmsGeneralDefeated + legendaryGranted similarly need
  // to persist across LEVEL_STARTED swaps so the grant check can fire from
  // either condition's listener regardless of which fired last.
  const freedLabAnimalIdsRef = useRef<Set<string>>(new Set());
  const swarmsGeneralDefeatedRef = useRef<boolean>(false);
  const legendaryCompanionGrantedRef = useRef<boolean>(false);
  // Mirror modal-open React state into refs so systems wired during the
  // single mount-time `initializeGame` (which captures stale state) can poll
  // the live values from their per-frame closures.
  const upgradeMenuOpenRef = useRef(false);
  // Mirrors `shopOpen` so the gamepad menu-mode provider (which runs
  // every frame and can't depend on React state) can OR shop modals
  // alongside upgrade / garden / dialogue. Without this, the
  // controller's D-Pad / A / B do nothing inside the shop dialog and
  // the player can't pick items like nano fiber off the shelf.
  const shopOpenRef = useRef(false);
  const labOpenRef = useRef(false);
  const gardenOpenRef = useRef(false);
  const gamepadRef = useRef<GamepadInput | null>(null);
  const chestSystemRef = useRef<ChestSystem | null>(null);
  const combatSystemRef = useRef<CombatSystem | null>(null);
  const specialWeaponsRef = useRef<SpecialWeaponsSystem | null>(null);
  const elementalSpecialsRef = useRef<ElementalSpecialsSystem | null>(null);
  const beamSabreRef = useRef<BeamSabreSystem | null>(null);
  const meleeArsenalRef = useRef<MeleeArsenalSystem | null>(null);
  const megaCannonRef = useRef<MegaBeamCannonSystem | null>(null);
  // Combo input timestamps for the Mega Beam Cannon (beam + weapon press
  // within the window). Held flags let us also fire when one input is
  // pressed while the other is already down.
  const beamPressTimeRef = useRef<number>(0);
  const weaponPressTimeRef = useRef<number>(0);
  const beamHeldRef = useRef<boolean>(false);
  const weaponHeldRef = useRef<boolean>(false);
  const armorSystemRef = useRef<ArmorSystem | null>(null);
  const craftingSystemRef = useRef<CraftingSystem | null>(null);
  const inventoryRef = useRef<InventorySystem | null>(null);
  const jewelRef = useRef<JewelSystem | null>(null);
  const companionRef = useRef<CompanionSystem | null>(null);
  const capsuleRef = useRef<ArmorCapsuleSystem | null>(null);
  const shopRef = useRef<ShopSystem | null>(null);
  const gardenRef = useRef<GardenSystem | null>(null);
  const mapRef = useRef<MapSystem | null>(null);
  const buildingRef = useRef<BuildingSystem | null>(null);
  const prefabRef = useRef<PrefabSystem | null>(null);
  const pickupRef = useRef<PickupSystem | null>(null);
  const baseRef = useRef<BaseSystem | null>(null);
  const bioRef = useRef<BioCreatureSystem | null>(null);
  const mountainRingRef = useRef<MountainRingSystem | null>(null);
  const alienFoliageRef = useRef<AlienFoliageSystem | null>(null);
  const earthFoliageRef = useRef<EarthFoliageSystem | null>(null);
  const vehicleRef = useRef<VehicleSystem | null>(null);
  const propSystemRef = useRef<EnvironmentPropSystem | null>(null);
  const atvHitCooldownRef = useRef<Map<number, number>>(new Map());
  const levelSerializerRef = useRef<LevelSerializer | null>(null);
  const loadInputRef = useRef<HTMLInputElement | null>(null);
  const multiplayerRef = useRef<MultiplayerSystem | null>(null);
  // Versus PvP-mode state. `versusModeRef` is read inside the long-lived
  // init closure so it must be set BEFORE initializeGame() runs (handleStart
  // does this). `versusArenaRef` holds the compact arena geometry mounted
  // in place of the open-world city when versus mode is active.
  const versusModeRef = useRef<{
    active: boolean;
    roomCode: string | null;
    isHost: boolean;
  }>({ active: false, roomCode: null, isHost: false });
  const versusArenaRef = useRef<VersusArena | null>(null);
  const effectsRef = useRef<EffectsSystem | null>(null);
  const explosionsRef = useRef<ExplosionSystem | null>(null);
  const propAudioRef = useRef<PropAudioSystem | null>(null);
  const soundRef = useRef<SoundSystem | null>(null);
  const skyRef = useRef<SkySystem | null>(null);
  const miningRef = useRef<MiningSystem | null>(null);
  const enemyBaseRef = useRef<EnemyBaseSystem | null>(null);
  // World-level progression (Level 1 → Level 2). Owned outside the engine
  // closure so the GameUI props + persistence layer can read it.
  const levelSystemRef = useRef<LevelSystem | null>(null);
  const respawnTimeoutRef = useRef<number | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const lastSaveAtRef = useRef<number>(0);
  // Bridges the engine's local `doSaveProgress` (closure) out to React-scope
  // handlers (handleUnlockSpecial, helper-bot upgrade) so a SPECIALS unlock
  // or a paid-for helper-weapon upgrade triggers an immediate forced save —
  // even if the 2s save throttle would normally skip it.
  const forceSaveRef = useRef<(() => void) | null>(null);
  // Forward-refs so EventBus listeners wired inside the single mount-time
  // `initializeGame` (which closes over earlier scope) can call helpers
  // that are defined LATER in React-scope (handleFastTravel) or built
  // alongside doSaveProgress (tryGrantLegendaryCompanion).
  const handleFastTravelRef = useRef<((level: number, warpPoint?: TravelWarpPoint) => void) | null>(null);
  const tryGrantLegendaryCompanionRef = useRef<(() => void) | null>(null);

  const [gamePhase, setGamePhase] = useState<GamePhase>("auth");
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [multiplayerConnected, setMultiplayerConnected] = useState(false);
  const [inRoom, setInRoom] = useState(false);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [remotePlayerCount, setRemotePlayerCount] = useState(0);
  const [chatMessages, setChatMessages] = useState<{ username: string; message: string; time: number }[]>([]);
  const [lobbyRooms, setLobbyRooms] = useState<any[]>([]);
  const [showLobby, setShowLobby] = useState(false);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<BlockType | null>(null);
  const [selectedBlockDef, setSelectedBlockDef] = useState<BlockDefinition | null>(null);
  const [hotbarBlocks, setHotbarBlocks] = useState<BlockType[]>([]);
  const [upgradeMenuOpen, setUpgradeMenuOpen] = useState(false);
  const [weaponUpgradeInfo, setWeaponUpgradeInfo] = useState<WeaponUpgradeInfo[]>([]);
  const [companionUpgradeInfo, setCompanionUpgradeInfo] = useState<CompanionUpgradeInfo[]>([]);
  // Helper-bot weapon-tier rows for the SPECIALS / HELPER ROBOTS tabs.
  const [companionWeaponInfo, setCompanionWeaponInfo] = useState<{ id: string; name: string; weaponLevel: number; maxLevel: number; cost: { gears: number; cores: number } | null; affordable: boolean }[]>([]);
  // Persisted owned-flags for one-time SPECIALS unlocks.
  const [specialsOwned, setSpecialsOwned] = useState<{
    sabreSpin: boolean; sabreTwin: boolean; sabreGiant: boolean; sabreGold: boolean;
    autoLoot: boolean; roboDragon: boolean; autoTarget: boolean;
    supermanFlight: boolean;
    glaiveOwn: boolean; glaiveCombo: boolean; glaiveSpecial: boolean;
    daggersOwn: boolean; daggersCombo: boolean; daggersSpecial: boolean;
    axeOwn: boolean; axeCombo: boolean; axeSpecial: boolean;
    whipOwn: boolean; whipCombo: boolean; whipSpecial: boolean;
  }>({
    sabreSpin: false, sabreTwin: false, sabreGiant: false, sabreGold: false,
    autoLoot: false, roboDragon: false, autoTarget: false, supermanFlight: false,
    glaiveOwn: false, glaiveCombo: false, glaiveSpecial: false,
    daggersOwn: false, daggersCombo: false, daggersSpecial: false,
    axeOwn: false, axeCombo: false, axeSpecial: false,
    whipOwn: false, whipCombo: false, whipSpecial: false,
  });
  // Mirror of `specialsOwned` for use inside long-lived bus.on closures
  // (e.g. PLAYER_DIED) where the latest React state isn't directly visible.
  // Kept in sync via a useEffect below.
  const specialsOwnedRef = useRef(specialsOwned);
  useEffect(() => { specialsOwnedRef.current = specialsOwned; }, [specialsOwned]);
  // Tracks SPECIALS that have already passed the unlock gate this tick.
  // Synchronous companion to the async `specialsOwned` React state — flips
  // before any side-effect/charge runs so a rapid double-click cannot
  // double-charge before React commits the new owned-flag.
  const specialsUnlockInFlightRef = useRef<Set<string>>(new Set());
  const [resourceCounts, setResourceCounts] = useState({ gears: 0, scrap: 0, cores: 0, circuits: 0, nanofiber: 0, bioEssence: 0 });
  const [partCounts, setPartCounts] = useState<Record<string, number>>({});
  const [labOpen, setLabOpen] = useState(false);
  const [labStructure, setLabStructure] = useState<BaseStructure | null>(null);
  const [gardenOpen, setGardenOpen] = useState(false);
  const [gardenStructure, setGardenStructure] = useState<BaseStructure | null>(null);
  const [capturedCreatures, setCapturedCreatures] = useState<CapturedCreature[]>([]);
  const [petBondSummary, setPetBondSummary] = useState("Pet Bonds: +0% DMG, +0% FIRE, -0% DMG TAKEN");
  // Persistent "ever caught" species ids for the dex completion UI. Only
  // grows; survives DEPLOY which removes a creature from the live roster.
  const [dexCaughtIds, setDexCaughtIds] = useState<string[]>([]);
  const [planMode, setPlanMode] = useState(false);
  const [prefabHotbar, setPrefabHotbar] = useState<PrefabSummary[]>([]);
  const [selectedPrefabIndex, setSelectedPrefabIndex] = useState(0);
  const [stats, setStats] = useState<PlayerStats>({
    health: 250,
    maxHealth: 250,
    armor: 100,
    maxArmor: 100,
    shield: 75,
    maxShield: 75,
    shieldRegenRate: 30,
    shieldRegenDelay: 1.2,
    stamina: 100,
    maxStamina: 100,
    credits: 0,
    experience: 0,
    level: 1,
  });
  const [playerUpgradeInfo, setPlayerUpgradeInfo] = useState<PlayerUpgradeInfo[]>([]);
  const [elementalUpgradeInfo, setElementalUpgradeInfo] = useState<ElementalUpgradeInfo[]>([]);
  // Mirror the LevelSystem's current level into React state so the upgrade-menu
  // TRAVEL tab can highlight "you are here" without re-querying every render.
  const [currentWorldLevel, setCurrentWorldLevel] = useState<WorldLevel>(1);
  const [inVehicle, setInVehicle] = useState(false);
  const [currentWeapon, setCurrentWeapon] = useState<Weapon | null>(null);
  const [ammo, setAmmo] = useState(50);
  const [maxAmmo, setMaxAmmo] = useState(50);
  const [enemyCount, setEnemyCount] = useState(0);
  const [waveNumber, setWaveNumber] = useState(1);
  const [chestCount, setChestCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  // ---- Level / objective UI (driven by LevelSystem events) ----
  const [levelBanner, setLevelBanner] = useState<string>("LEVEL 1 — RESCUE THE ALLY");
  const [levelObjective, setLevelObjective] = useState<string>(
    "Breach the enemy fortress and rescue the captured ally."
  );
  const [levelCompleteOverlay, setLevelCompleteOverlay] =
    useState<{ title: string; subtitle?: string } | null>(null);
  const [jetpackFuel, setJetpackFuel] = useState(200);
  const [maxJetpackFuel, setMaxJetpackFuel] = useState(200);
  const [playerState, setPlayerState] = useState("idle");
  const [comboInfo, setComboInfo] = useState<{ name: string; index: number } | null>(null);
  const [specialWeaponInfo, setSpecialWeaponInfo] = useState<any[]>([]);
  const [elementalSpecialsInfo, setElementalSpecialsInfo] = useState<ElementalDisplay[]>([]);
  const [beamSabreActive, setBeamSabreActive] = useState(true);
  const [beamSabreLevel, setBeamSabreLevel] = useState(1);
  const [activeElement, setActiveElement] = useState<string | null>(null);
  const [armorDefense, setArmorDefense] = useState(0);
  const [companionCount, setCompanionCount] = useState(0);
  const [companionInfo, setCompanionInfo] = useState<{ name: string; type: string; health: number; maxHealth: number }[]>([]);

  const [isFlying, setIsFlying] = useState(false);
  const [armorEnergy, setArmorEnergy] = useState(0);
  const [maxArmorEnergy, setMaxArmorEnergy] = useState(200);
  const [hasFlightArmor, setHasFlightArmor] = useState(false);
  const [jumpCount, setJumpCount] = useState(0);

  const [capsuleOpen, setCapsuleOpen] = useState(false);
  const [capsuleUpgrades, setCapsuleUpgrades] = useState<ArmorUpgrade[]>([]);

  const [shopOpen, setShopOpen] = useState(false);
  const [activeShop, setActiveShop] = useState<ShopDefinition | null>(null);

  const [buildMode, setBuildMode] = useState(false);

  const showMessage = useCallback((msg: string, duration: number = 2000) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), duration);
  }, []);

  // Save summary surfaced on the main menu so the player can see at a
  // glance what their cloud save will resume into. Loaded on auth and
  // refreshed any time we transition back to the menu phase.
  const [saveSummary, setSaveSummary] = useState<SaveSummary | null>(null);
  const refreshSaveSummary = useCallback(() => {
    void loadProgress().then((snap) => {
      if (!snap || !snap.stats) {
        setSaveSummary(null);
        return;
      }
      setSaveSummary({
        level: snap.stats.level,
        credits: snap.stats.credits,
        totalKills: snap.totalKills,
        highestWave: snap.highestWave,
        worldLevel: snap.worldLevel ?? 1,
        savedAt: snap.savedAt,
        bioDexCount: snap.bioDexCaughtIds?.length,
        companionCount: snap.companions?.length,
      });
    }).catch(() => setSaveSummary(null));
  }, []);

  const handleAuthenticated = useCallback((user: any) => {
    setCurrentUser(user);
    setGamePhase("menu");
    refreshSaveSummary();
  }, [refreshSaveSummary]);

  const handlePlayOffline = useCallback(() => {
    setCurrentUser(null);
    setGamePhase("menu");
    setSaveSummary(null); // offline play has no cloud save to surface.
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.ok ? res.json() : null)
      .then((user) => {
        if (user) {
          setCurrentUser(user);
          setGamePhase("menu");
        }
      })
      .catch(() => {});
  }, []);

  const handleLootCollected = useCallback((loot: Loot) => {
    const player = playerRef.current;
    const weapons = weaponsRef.current;
    if (!player || !weapons) return;

    switch (loot.type) {
      case "credits":
        player.addCredits(loot.amount);
        showMessage(`+${loot.amount} CREDITS`, 1500);
        break;
      case "health":
        player.heal(loot.amount);
        showMessage(`+${loot.amount} HEALTH`, 1500);
        break;
      case "armor":
        player.addArmor(loot.amount);
        showMessage(`+${loot.amount} ARMOR`, 1500);
        break;
      case "ammo":
        if (loot.weaponType) {
          weapons.addAmmo(loot.weaponType, loot.amount);
          showMessage(`+${loot.amount} ${loot.weaponType.toUpperCase()} AMMO`, 1500);
        }
        break;
      case "weapon_upgrade":
        showMessage("WEAPON UPGRADED!", 2000);
        break;
    }

    if (player) {
      setStats(player.getStats());
    }
  }, [showMessage]);

  const initializeGame = useCallback(() => {
    if (!canvasRef.current || initializingRef.current) {
      return;
    }
    initializingRef.current = true;
    // Reset death-music guard so the next death can pause music again.
    deathHandledRef.current = false;

    setGamePhase("playing");

    setTimeout(async () => {
      try {
        if (!canvasRef.current) {
          throw new Error("Canvas not available");
        }

        const bus = EventBus.getInstance();
        bus.clear();

        // `BabylonEngine.create()` is async because it may spin up a
        // WebGPU backend (which requires `await initAsync()`). It always
        // resolves to a fully-initialized engine, falling back to WebGL2
        // if WebGPU is opted-out / unsupported / fails to init.
        const engine = await BabylonEngine.create(canvasRef.current);
        engineRef.current = engine;

        const scene = engine.getScene();

        const cityGenerator = new CityGenerator(scene);
        cityGenerator.generateCity();

        // ---- Distance LOD culling ---------------------------------------
        // Open-world with hundreds of city meshes + dozens of bases. The
        // camera's maxZ already prunes beyond 1 km, but everything inside
        // that sphere is walked every frame. The LODCullSystem toggles
        // far-away static meshes via setEnabled, which Babylon completely
        // skips during render. Registered radius is per-mesh so iconic
        // skyline shapes (boss fortress) stay visible from far while
        // small interior platforms drop out at ~250 m.
        const lodCull = new LODCullSystem();
        // Cull radii are deliberately set BEYOND the fog visibility band so
        // disabling a mesh reads as continued fog falloff rather than a
        // pop. Earlier 600 m was inside the visible band — at Exp2 fog
        // density 0.0015 a 600 m mesh is only ~44% absorbed (still very
        // legible), so users were watching whole rows of buildings wink
        // out as they walked. Solving exp(-(d*0.0015)^2) ≤ 0.05 puts the
        // 5%-visible threshold at ~1150 m, so we register buildings at
        // 1150 m and platforms (smaller, less iconic shapes) at 950 m.
        // Babylon's default camera maxZ is 10 km so there's no near-clip
        // worry. Per-mesh setEnabled at this scale is still cheap because
        // the system batches at ~6 Hz and registered meshes are
        // freezeWorldMatrix'd at generation time.
        for (const m of cityGenerator.getCullableBuildings()) lodCull.register(m, 1150);
        for (const m of cityGenerator.getCullablePlatforms()) lodCull.register(m, 950);

        const sky = new SkySystem(
          scene,
          engine.getSunLight(),
          engine.getAmbientLight(),
          engine.getCamera(),
        );
        skyRef.current = sky;

        const player = new PlayerController(scene, engine.getCamera());
        player.setBuildingColliders(cityGenerator.getWallColliders());
        player.setFloorPlatforms(cityGenerator.getFloorPlatforms());
        player.setTerrainHeightProvider((x, z, currentY) =>
          michiganTerrainSystemRef.current?.getHeightAt(x, z) ?? null,
        );
        player.setWaterSurfaceProvider((x, z) =>
          michiganTerrainSystemRef.current?.getWaterSurfaceAt(x, z) ?? null,
        );
        playerRef.current = player;
        // Wire the EnemySystem flying-state provider so commanders /
        // captains / titans only chase upward when the player is
        // actually airborne. Fixes the "every hit makes them rise"
        // bug where the target-Y re-add stacked endlessly on grounded
        // hits and the elite would float into the skybox.
        try {
          setEnemyPlayerIsFlyingProvider(() => player.getIsFlying() || (player as any).isSupermanFlight === true);
        } catch {}

        const weapons = new WeaponsSystem(scene, engine.getCamera());
        weaponsRef.current = weapons;

        weapons.setOnAmmoChange((a, m) => {
          setAmmo(a);
          setMaxAmmo(m);
        });

        weapons.setOnWeaponChange((w) => {
          setCurrentWeapon(w);
        });

        const initialWeapon = weapons.getCurrentWeapon();
        if (initialWeapon) {
          setCurrentWeapon(initialWeapon);
          setAmmo(initialWeapon.ammo);
          setMaxAmmo(initialWeapon.maxAmmo);
        }

        const combatSystem = new CombatSystem(scene, engine.getCamera());
        combatSystemRef.current = combatSystem;

        player.setMeleeCallbacks(
          () => combatSystem.onLightAttack(),
          () => combatSystem.onHeavyAttack()
        );

        const specialWeapons = new SpecialWeaponsSystem(scene, engine.getCamera());
        specialWeaponsRef.current = specialWeapons;
        specialWeapons.setOnSpecialWeaponChange(() => {
          setSpecialWeaponInfo(specialWeapons.getActiveSpecialWeapons());
        });

        const elementalSpecials = new ElementalSpecialsSystem(
          scene,
          engine.getCamera(),
          () => player.getPosition(),
        );
        elementalSpecialsRef.current = elementalSpecials;
        elementalSpecials.setOnChange((list) => {
          setElementalSpecialsInfo(list);
        });
        // Brief upper-body cast pose whenever the player triggers a special.
        elementalSpecials.setOnCast(() => {
          try { player.triggerAttackAnimation(false); } catch {}
        });

        const beamSabre = new BeamSabreSystem(scene, engine.getCamera());
        beamSabreRef.current = beamSabre;

        // Melee Arsenal — alternate melee weapons (Glaive / Daggers / Axe /
        // Whip). Cycled in via KeyB (KeyN fires the active weapon's
        // signature special). The system stays dormant until at least one
        // weapon is unlocked from the SPECIALS tab.
        const meleeArsenal = new MeleeArsenalSystem(scene, engine.getCamera());
        meleeArsenalRef.current = meleeArsenal;
        meleeArsenal.setDamageRouter(() => { /* replaced once render loop starts */ });

        const megaCannon = new MegaBeamCannonSystem(scene, engine.getCamera());
        megaCannonRef.current = megaCannon;
        megaCannon.setDamageRouter(() => { /* replaced once render loop starts */ });
        // Initial no-op router so that even an attack pressed before the
        // render loop is wired uses the routed code path.
        beamSabre.setDamageRouter(() => { /* replaced once render loop starts */ });
        // Wire the dash → slash chain. The Beam Sabre asks the player how
        // long ago the boost-dash button was pressed; if it's recent, the
        // attack short-circuits to fire an energy wave immediately.
        beamSabre.setDashChecker(() => {
          const p = playerRef.current;
          return p ? p.getMsSinceLastBoostDash() : Number.POSITIVE_INFINITY;
        });

        const aimOrigin = () => player.getAimOrigin();
        weapons.setAimOriginProvider(aimOrigin);
        specialWeapons.setAimOriginProvider(aimOrigin);
        combatSystem.setAimOriginProvider(aimOrigin);
        beamSabre.setAimOriginProvider(aimOrigin);
        megaCannon.setAimOriginProvider(aimOrigin);
        meleeArsenal.setAimOriginProvider(aimOrigin);

        // Vehicle "nose gun": when the player is mounted on a non-ATV vehicle
        // (the orbital fighter, primarily) override the weapons-fire path so
        // projectiles spawn at the vehicle's nose and travel along the
        // vehicle's forward vector instead of the player camera. This is
        // what makes shooting in space-fighter mode actually do something —
        // the camera tracks the player, but the player rides the vehicle, so
        // the camera's "forward" wasn't aligned with the vehicle's heading.
        // Returning null falls through to the normal camera-aim pipeline.
        weapons.setVehicleAimProvider(() => {
          const v = vehicleSystem.getActive();
          if (!v || v.kind === "atv") return null;
          if (!playerRef.current?.isMounted()) return null;
          const root = v.meshes.root;
          // Aim along the CAMERA's forward, not the ship's, so projectiles
          // track the crosshair exactly. The ship lerps toward camera yaw/
          // pitch with smoothing so its own forward lags the crosshair —
          // using camera forward removes the aim drift the user reported.
          const camFwd = scene.activeCamera!.getDirection(BABYLON.Vector3.Forward()).normalize();
          // Still spawn a few metres ahead of the ship's nose so the shot
          // doesn't clip through the fighter mesh on frame 1.
          const shipFwd = root.getDirection(BABYLON.Vector3.Forward()).normalize();
          const origin = root.position.add(shipFwd.scale(5));
          return { origin, forward: camFwd };
        });

        const inventory = new InventorySystem();
        inventoryRef.current = inventory;

        // Power-Jewel mounts. Constructed here (before WeaponsSystem reads
        // jewel multipliers in createProjectile) and wired to push every
        // mount/unmount into WeaponsSystem.weaponJewelMul. notifyAll() seeds
        // the multiplier map for any mount restored from a save before the
        // first shot is fired.
        const jewelSystem = new JewelSystem(inventory);
        jewelRef.current = jewelSystem;
        jewelSystem.setOnMountChanged((type, mul) => {
          weaponsRef.current?.setWeaponJewelMul(type, mul);
        });

        const armorSystem = new ArmorSystem();
        armorSystemRef.current = armorSystem;

        const craftingSystem = new CraftingSystem(inventory);
        craftingSystemRef.current = craftingSystem;

        const companionSystem = new CompanionSystem(scene);
        companionRef.current = companionSystem;

        companionSystem.addCompanion("GuardianUnit", player.getPosition());
        companionSystem.addCompanion("SparkPup", player.getPosition());

        const capsuleSystem = new ArmorCapsuleSystem(scene, armorSystem);
        capsuleRef.current = capsuleSystem;

        capsuleSystem.setUIToggleCallback((open, upgrades) => {
          setCapsuleOpen(open);
          setCapsuleUpgrades(upgrades);
        });

        capsuleSystem.setUpgradeAppliedCallback((upgrade) => {
          if (upgrade.effects?.flightCapability) {
            player.grantFlightArmor();
            setHasFlightArmor(true);
            showMessage("FLIGHT ARMOR ACQUIRED! Triple-jump to fly!", 4000);
          } else {
            showMessage(`UPGRADE: ${upgrade.name}`, 3000);
          }
        });

        const shopSystem = new ShopSystem(scene, engine.getCamera(), inventory);
        shopRef.current = shopSystem;
        // Bind the shop's currency to the real player wallet. Credits live on
        // PlayerController.stats.credits — without this accessor the shop
        // looks at `inventory.getItemCount("credits")` (always 0) and every
        // purchase silently fails with "Not enough credits!".
        shopSystem.setCreditsAccessor(
          () => player.getCredits(),
          (n) => player.spendCredits(n),
          (n) => player.addCredits(n),
        );

        shopSystem.setOnShopOpen((shop) => {
          setShopOpen(true);
          setActiveShop(shop);
        });

        shopSystem.setOnShopClose(() => {
          setShopOpen(false);
          setActiveShop(null);
        });

        shopSystem.setOnTransactionComplete((msg) => {
          showMessage(msg, 1500);
        });

        shopSystem.createShopBuildings();

        const gardenSystem = new GardenSystem(scene, engine.getCamera(), companionSystem);
        gardenRef.current = gardenSystem;

        gardenSystem.setOnGardenOpen((gardenId) => {
          showMessage(`Entered ${gardenId}`, 1500);
        });

        gardenSystem.setOnGardenClose(() => {
          showMessage("Left garden", 1000);
        });

        gardenSystem.createGardenBuildings();

        const mapSystem = new MapSystem(scene);
        mapRef.current = mapSystem;
        mapSystem.setShops(shopSystem.getShops ? shopSystem.getShops() : []);
        mapSystem.setGardens(gardenSystem.getGardens ? gardenSystem.getGardens() : []);

        const buildingSystem = new BuildingSystem(scene, engine.getCamera(), inventory);
        buildingRef.current = buildingSystem;
        setHotbarBlocks(buildingSystem.getHotbar());
        setSelectedBlock(buildingSystem.getSelectedBlockType());

        const prefabSystem = new PrefabSystem(scene, engine.getCamera(), inventory);
        prefabRef.current = prefabSystem;
        setPrefabHotbar(prefabSystem.getHotbar());

        const baseSystem = new BaseSystem(inventory);
        baseRef.current = baseSystem;

        const pickupSystem = new PickupSystem(scene, inventory);
        pickupRef.current = pickupSystem;
        // Live companion-position provider for the auto-loot magnet.
        pickupSystem.setCompanionPositionsProvider(() =>
          companionRef.current ? companionRef.current.getCompanionPositions() : []
        );

        const bioSystem = new BioCreatureSystem(scene, inventory);
        bioRef.current = bioSystem;
        bioSystem.setHooks(
          () => baseSystem.getGardenCaptureBonus(),
          // Floor matches the new tier-1 garden cap (15). The floor only
          // matters when no garden has been built yet — without it a
          // pre-garden player couldn't capture any creature at all,
          // which would block the early game. Keep this in sync with
          // GARDEN_LEVEL_CAPTURE_CAP[0] in BaseSystem.ts.
          () => Math.max(15, baseSystem.getGardenCaptureCap()),
        );
        bioSystem.spawnInitialCreatures();

        // Wire the Capture Net tool weapon: when the player has it
        // equipped, primary fire (LMB / RT) is intercepted by WeaponsSystem
        // and routed here, which throws a capture orb at the nearest
        // bio-creature exactly like the H-key fallback does.
        weapons.setSpecialFireHandler("capture_net", () => {
          bioRef.current?.attemptCaptureNearest();
        });

        // Nature ring: 28 mountains around the world rim plus 4 hidden
        // temples that grant a one-time bundle of rare items + a guaranteed
        // legendary creature. Looted state is per-level + persistent.
        const mountainRing = new MountainRingSystem(scene, inventory, bioSystem);
        mountainRingRef.current = mountainRing;
        mountainRing.setInputBlockedProvider(() => {
          if (labOpenRef.current) return true;
          if (gardenOpenRef.current) return true;
          if (upgradeMenuOpenRef.current) return true;
          if (shopRef.current?.isOpen()) return true;
          if (gardenRef.current?.isGardenOpenCheck()) return true;
          return false;
        });

        weapons.setInventory(inventory);

        const prefabToBaseId = new Map<string, string>();
        prefabSystem.setOnPlacedCallback((placed, def) => {
          if (def.baseStructureKind) {
            const s = baseSystem.registerStructure(def.baseStructureKind, placed.position);
            prefabToBaseId.set(placed.id, s.id);
            companionSystem.setMaxCompanions(Math.max(3, baseSystem.getLabCompanionCap()));
          }
        });

        prefabSystem.setOnRemovedCallback((prefabId: string) => {
          const baseId = prefabToBaseId.get(prefabId);
          if (baseId) {
            const target = baseSystem.getStructures().find(s => s.id === baseId);
            if (target) baseSystem.removeStructureAt(target.position, 0.25);
            prefabToBaseId.delete(prefabId);
            companionSystem.setMaxCompanions(Math.max(3, baseSystem.getLabCompanionCap()));
          }
        });

        levelSerializerRef.current = new LevelSerializer(buildingSystem, prefabSystem);

        bus.on("building:modeChanged", (on: boolean) => {
          if (on && prefabRef.current?.isPlanMode()) prefabRef.current.togglePlanMode();
        });
        bus.on("prefab:modeChanged", (on: boolean) => {
          if (on && buildingRef.current?.isBuildMode()) buildingRef.current.toggleBuildMode();
        });
        // Surface UI_MESSAGE bus events to the on-screen banner. Many
        // systems emit user-facing feedback ("No bio-creature in range",
        // "Need 1 Bio Essence", "Crafted X", shop errors, etc.) via this
        // event but nothing was subscribed before — so the player saw
        // silent failures (notably: failed capture-net throws). Accepts
        // either a plain string payload or a `{text|message, duration}`
        // object so we don't have to touch every caller.
        bus.on(GameEvents.UI_MESSAGE, (payload: any) => {
          let text: string | null = null;
          let duration = 2000;
          if (typeof payload === "string") {
            text = payload;
          } else if (payload && typeof payload === "object") {
            text = payload.text ?? payload.message ?? null;
            if (typeof payload.duration === "number") {
              // BeamSabreSystem uses seconds (1.2), most others use ms.
              duration = payload.duration < 20 ? payload.duration * 1000 : payload.duration;
            }
          }
          if (text) showMessage(text, duration);
        });

        const effects = new EffectsSystem(scene, engine.getCamera());
        effectsRef.current = effects;

        const explosions = new ExplosionSystem(scene);
        explosionsRef.current = explosions;

        const propAudio = new PropAudioSystem();
        propAudioRef.current = propAudio;

        const sound = new SoundSystem();
        sound.preload("/sounds/hit.mp3");
        soundRef.current = sound;

        const multiplayer = new MultiplayerSystem(scene);
        multiplayerRef.current = multiplayer;

        if (currentUser) {
          multiplayer.connect(currentUser.username, currentUser.id);
          multiplayer.on("connected", () => setMultiplayerConnected(true));
          multiplayer.on("disconnected", () => {
            setMultiplayerConnected(false);
            setInRoom(false);
            setRoomCode(null);
          });
          multiplayer.on("room_joined", (data: any) => {
            setInRoom(true);
            setRoomCode(data.roomCode);
            setIsHost(data.isHost);
            setShowLobby(false);
            showMessage(`Joined room ${data.roomCode}`, 2000);
          });
          multiplayer.on("room_left", () => {
            setInRoom(false);
            setRoomCode(null);
            setIsHost(false);
          });
          multiplayer.on("room_list", (data: any) => setLobbyRooms(data.rooms));
          multiplayer.on("player_joined", (data: any) => showMessage(`${data.player.username} joined!`, 2000));
          multiplayer.on("player_left", (data: any) => showMessage(`${data.username} left`, 1500));
          multiplayer.on("chat_message", (data: any) => setChatMessages(multiplayer.getChatMessages().slice(-20)));
          multiplayer.on("error", (data: any) => showMessage(data.message, 2000));
          multiplayer.on("request_position", () => {
            const pos = player.getPosition();
            const rot = player.getRotation();
            multiplayer.sendPositionUpdate(
              { x: pos.x, y: pos.y, z: pos.z },
              { x: rot.x, y: rot.y, z: rot.z },
              player.getPlayerState(),
              player.getStats().health,
              1,
              player.getIsFlying()
            );
          });
        }

        BABYLON.SceneLoader.ImportMeshAsync("", "/models/", "swarm_drone.glb", scene).then((result) => {
          if (result.meshes.length > 0) {
            const droneRoot = result.meshes[0];
            droneRoot.name = "swarmDroneModel";
            droneRoot.scaling.setAll(2.5);
            droneRoot.position = new BABYLON.Vector3(355, 8, 155);

            scene.registerBeforeRender(() => {
              if (droneRoot && !droneRoot.isDisposed()) {
                droneRoot.position.y = 8 + Math.sin(Date.now() * 0.002) * 1.5;
                droneRoot.rotation.y += 0.01;
              }
            });
          }
        }).catch((err) => {
          console.log("Drone GLB not loaded:", err);
        });

        // Seed the enemy-style override cache before the first wave spawns
        // so the player's saved Boss-Style picks (Captain body / tint /
        // Titan body) are honored on the very first enemy that appears.
        refreshEnemyStyleOverrides();

        const enemySystem = new EnemySystem(scene);
        enemySystemRef.current = enemySystem;

        const aerialEnemySystem = new AerialEnemySystem(scene);
        aerialEnemyRef.current = aerialEnemySystem;
        // Hand the city wall AABBs to the aerial squadron so it can do
        // line-of-sight checks before firing — drones never shoot through
        // buildings.
        aerialEnemySystem.setWallColliders(cityGenerator.getWallColliders());
        // Seed a few flying fortresses patrolling overhead. They float in
        // the sky as silent landmarks until the player attacks an enemy
        // base or any aerial unit, at which point the squadron engages.
        const initialPos = player.getPosition();
        aerialEnemySystem.spawnFortress(initialPos);
        aerialEnemySystem.spawnFortress(initialPos);
        aerialEnemySystem.spawnFortress(initialPos);

        const miningSystem = new MiningSystem(scene);
        miningRef.current = miningSystem;
        miningSystem.seedWorld(28);

        const enemyBaseSystem = new EnemyBaseSystem(scene);
        enemyBaseRef.current = enemyBaseSystem;
        // Hook the registrar BEFORE seeding so initial bases get culled too.
        enemyBaseSystem.setCullRegistrar((node, r) => lodCull.register(node, r));
        enemyBaseSystem.seedWorld([
          new BABYLON.Vector3(250, 0, 250),
          new BABYLON.Vector3(-250, 0, 250),
          new BABYLON.Vector3(0, 0, -280),
        ]);
        // The Level-1 boss objective: one giant fortress holding the captured
        // ally. Coordinate is owned by LevelSystem so per-level fortress
        // placement stays in one place.
        const l1Center = LevelSystem.getFortressCenterFor(1);
        enemyBaseSystem.spawnBossFortress(new BABYLON.Vector3(l1Center.x, 0, l1Center.z));

        // Wire the Auto-Target Module's enemy source. The provider is
        // called once per shot when the module is enabled; it returns the
        // world-space positions of every live ground + aerial enemy. The
        // scratch array is reused so an automatic-fire weapon doesn't
        // allocate a fresh array dozens of times per second.
        {
          const autoAimScratch: BABYLON.Vector3[] = [];
          // Spinning Downward Smash: hold KeyJ (gamepad LT in foot context)
          // for 1 s while airborne to dive-bomb straight down and detonate
          // a circular shockwave on landing.
          smashAttackRef.current = new SmashAttackSystem(player, enemySystem, aerialEnemySystem, bus);

          weapons.setEnemyTargetProvider(() => {
            autoAimScratch.length = 0;
            const ground = enemySystem.getEnemyMeshes();
            for (let i = 0; i < ground.length; i++) {
              const m = ground[i];
              if (m.isDisposed()) continue;
              autoAimScratch.push(m.position);
            }
            const air = aerialEnemySystem.getActiveUnits();
            for (let i = 0; i < air.length; i++) {
              const u = air[i];
              if (!u.isAlive) continue;
              autoAimScratch.push(u.hitbox.position);
            }
            return autoAimScratch;
          });
        }

        // Level system — drives Level 1 → 2 → 3 progression, sky tint,
        // boss-variant assignment, and per-level fortress placement.
        const levelSystem = new LevelSystem();
        levelSystemRef.current = levelSystem;

        // BOSS FORTRESS turret-clear → spawn the BossCaptain at the spire,
        // themed to the *current* level's variant (inferno / plague / void).
        bus.on(GameEvents.BOSS_FORTRESS_TURRETS_CLEARED, (payload: any) => {
          const pos = (payload?.captainSpawnPosition as BABYLON.Vector3 | undefined)
            ?? (payload?.spirePosition as BABYLON.Vector3 | undefined);
          if (!pos) return;
          const variantId = levelSystemRef.current?.getBossVariantId();
          enemySystem.spawnCaptain(pos.clone(), { isBossCaptain: true, variantId });
        });

        // ENEMY_SPAWNED for boss captains → flash the variant taunt so the
        // player reads the threat (e.g. "PLAGUE WARDEN — BREATHE DEEP…").
        bus.on(GameEvents.ENEMY_SPAWNED, (payload: any) => {
          if (!payload?.isBossCaptain) return;
          const name = payload.variantName as string | undefined;
          const taunt = payload.taunt as string | undefined;
          if (name && taunt) showMessage(`${name} — ${taunt}`, 4500);
        });

        // LEVEL_COMPLETED → show the full-screen overlay. The final clear
        // gets a slightly longer hold so the win screen lingers.
        bus.on(GameEvents.LEVEL_COMPLETED, (payload: any) => {
          const isFinal = !!payload?.final;
          setLevelCompleteOverlay({
            title: isFinal ? "VICTORY" : "LEVEL COMPLETE",
            subtitle: payload?.subtitle || payload?.banner || "Stand by — the war isn't over.",
          });
          window.setTimeout(() => setLevelCompleteOverlay(null), isFinal ? 6000 : 3200);
        });

        // LEVEL_STARTED → swap banner + objective; re-apply sky/spawn rules
        // and seed the next level's fortress at its assigned coordinate.
        bus.on(GameEvents.LEVEL_STARTED, (payload: any) => {
          if (payload?.banner) setLevelBanner(payload.banner);
          if (payload?.objective) setLevelObjective(payload.objective);
          if (typeof payload?.level === "number") setCurrentWorldLevel(payload.level as WorldLevel);
          // Sky tint per level (red shift on L2, cold violet shift on L3,
          // warm dawn for the sanctuary).
          if (payload?.skyTint && skyRef.current) {
            skyRef.current.setLevelTint(payload.skyTint);
          }
          // Per-level time-of-day so the three combat fronts and the
          // sanctuary actually look distinct (morning / sunset / night /
          // dawn) even though they share the same world geometry. Level 5
          // ignores this — its skybox is owned by SpaceLevelSystem.
          if (typeof payload?.timeOfDay === "number" && skyRef.current) {
            skyRef.current.setTimeOfDay(payload.timeOfDay);
          }
          // Per-level city palette swap — re-tints every cell-shaded
          // building + the ground in-place so each combat front reads as
          // a different city even though the geometry is shared.
          if (payload?.cityTheme) {
            try {
              cityGenerator.setLevelTheme({
                tint: new BABYLON.Color3(
                  payload.cityTheme.tint.r,
                  payload.cityTheme.tint.g,
                  payload.cityTheme.tint.b,
                ),
                glowTint: new BABYLON.Color3(
                  payload.cityTheme.glowTint.r,
                  payload.cityTheme.glowTint.g,
                  payload.cityTheme.glowTint.b,
                ),
                ground: new BABYLON.Color3(
                  payload.cityTheme.ground.r,
                  payload.cityTheme.ground.g,
                  payload.cityTheme.ground.b,
                ),
              });
            } catch (err) {
              console.warn("[Game] setLevelTheme failed:", err);
            }
          }

          // Mount/dispose the sanctuary side-zone based on the peaceful flag.
          // Idempotent on re-entry: while peaceful=true, leaving the dispose
          // alone re-uses the live system; we only build/tear down on edge.
          // Fall back to the static `LevelSystem.isPeaceful` lookup if a
          // legacy payload (e.g. from an older event source) omits the flag.
          const isPeaceful = !!payload?.peaceful
            || (typeof payload?.level === "number"
                && LevelSystem.isPeaceful(payload.level as WorldLevel));
          // Silence the wave spawner + clear lingering enemies when
          // entering a peaceful zone, and re-arm it when leaving. Without
          // this gate the timer-based drip-spawn keeps fanning out drones
          // around the player even inside the sanctuary.
          if (isPeaceful) {
            enemySystem.setSpawningEnabled(false);
            enemySystem.clearAllEnemies();
            aerialEnemySystem.disengageAndClear();
          } else {
            enemySystem.setSpawningEnabled(true);
          }

          // Refresh the rescue roster for the new level. RescueSystem skips
          // levels with no roster (peaceful zones), and prunes any rescuees
          // already freed in a prior run. setLevel is idempotent — calling
          // it with the same level twice (e.g. on a fast-travel re-warp)
          // is a no-op.
          if (rescueSystemRef.current && typeof payload?.level === "number") {
            rescueSystemRef.current.setLevel(payload.level as WorldLevel);
          }

          // Sanctuary mounts ONLY for Level 4. Other peaceful zones (e.g.
           // Level 6 Pontiac Secret Lab) share the `peaceful` flag for
           // wave-spawn suppression but own their own world-swap system,
           // so we MUST NOT also mount the sanctuary on top of them — that
           // would double-hide the city and stack two distinct world-swap
           // restorations on dispose.
          const isSanctuary = typeof payload?.level === "number"
            && (payload.level as WorldLevel) === 4;
          if (isSanctuary && !sanctuarySystemRef.current) {
            sanctuarySystemRef.current = new SanctuarySystem(
              scene,
              engine.getCamera(),
              inventory,
              () => player.getPosition(),
              () => labOpenRef.current
                || gardenOpenRef.current
                || upgradeMenuOpenRef.current
                || (gardenRef.current?.isGardenOpenCheck() ?? false),
              baseSystem,
              {
                // Mirrors the SpaceLevelSystem handles bag — sanctuary hides
                // the city + mountains + foliage + props on mount and
                // restores them on warp-out so Level 4 is a truly distinct
                // green-plains village world rather than dressing on top of
                // Detroit. Each handle is null-tolerant.
                city: cityGenerator,
                worldVisibles: [
                  mountainRingRef.current,
                  alienFoliageRef.current,
                  earthFoliageRef.current,
                  propSystemRef.current,
                ],
                // Pass the foliage system directly so the sanctuary can
                // densely scatter L-system plants of its own around the
                // village (and dispose only those plants on warp-out).
                foliage: alienFoliageRef.current,
                // Bio + weapons handles let the sanctuary spawn huntable
                // creatures on mount and auto-equip the Capture Net so
                // the right trigger captures right out of the gate.
                bio: bioRef.current,
                weapons: weaponsRef.current,
                lodCull,
              },
            );
          } else if (!isSanctuary && sanctuarySystemRef.current) {
            try { sanctuarySystemRef.current.dispose(); } catch {}
            sanctuarySystemRef.current = null;
          }

          // Mount/dispose the Pontiac Secret Lab side-zone (Level 6).
          // Same handles bag as the sanctuary so the lab swaps the world
          // wholesale (city, mountains, foliage, props all hidden), but
          // it's a separate system because the lab interior + dressing
          // is completely different from the sanctuary's village.
          const isLab = typeof payload?.level === "number"
            && LevelSystem.isLab(payload.level as WorldLevel);
          if (isLab && !pontiacLabSystemRef.current) {
            pontiacLabSystemRef.current = new PontiacLabSystem(
              scene,
              engine.getCamera(),
              () => player.getPosition(),
              () => labOpenRef.current
                || gardenOpenRef.current
                || upgradeMenuOpenRef.current
                || (gardenRef.current?.isGardenOpenCheck() ?? false),
              {
                city: cityGenerator,
                worldVisibles: [
                  mountainRingRef.current,
                  alienFoliageRef.current,
                  earthFoliageRef.current,
                  propSystemRef.current,
                ],
                lodCull,
              },
              // Pre-freed roster — PontiacLabSystem skips building cages
              // whose ids are in this set, so re-entries after a prior
              // playthrough don't respawn animals the player already freed.
              freedLabAnimalIdsRef.current,
            );
          } else if (!isLab && pontiacLabSystemRef.current) {
            try { pontiacLabSystemRef.current.dispose(); } catch {}
            pontiacLabSystemRef.current = null;
          }

          // Mount/dispose the Swarms Lair side-zone (Level 7) — a self-
          // contained underground combat arena reachable from the Pontiac
          // Lab's cave hatch (or directly from TRAVEL once the player has
          // it on their map). Same handles bag as the lab + sanctuary.
          const isLair = typeof payload?.level === "number"
            && LevelSystem.isLair(payload.level as WorldLevel);
          if (isLair && !swarmsLairSystemRef.current) {
            swarmsLairSystemRef.current = new SwarmsLairSystem(
              scene,
              enemySystem,
              () => player.getPosition(),
              {
                city: cityGenerator,
                worldVisibles: [
                  mountainRingRef.current,
                  alienFoliageRef.current,
                  earthFoliageRef.current,
                  propSystemRef.current,
                ],
                lodCull,
              },
              // Persisted defeat flag — when true the lair skips the
              // General spawn AND the kill-listener so the boss doesn't
              // resurrect on revisit and the legendary grant doesn't
              // re-fire after a stale captain death in the arena.
              swarmsGeneralDefeatedRef.current,
            );
          } else if (!isLair && swarmsLairSystemRef.current) {
            try { swarmsLairSystemRef.current.dispose(); } catch {}
            swarmsLairSystemRef.current = null;
          }

          // Mount/dispose the Saginaw Underwater Lab side-zone (Level 8) —
          // hardest combat zone in the game. Captains-only spawns + 2
          // spider-tank mid-bosses. Mirrors the SwarmsLair mount block
          // exactly (same handles bag, same dispose pattern).
          const isSaginawLab = typeof payload?.level === "number"
            && LevelSystem.isSaginawLab(payload.level as WorldLevel);
          if (isSaginawLab && !saginawLabSystemRef.current) {
            saginawLabSystemRef.current = new SaginawLabSystem(
              scene,
              enemySystem,
              () => player.getPosition(),
              {
                city: cityGenerator,
                worldVisibles: [
                  mountainRingRef.current,
                  alienFoliageRef.current,
                  earthFoliageRef.current,
                  propSystemRef.current,
                ],
                lodCull,
              },
            );
          } else if (!isSaginawLab && saginawLabSystemRef.current) {
            try { saginawLabSystemRef.current.dispose(); } catch {}
            saginawLabSystemRef.current = null;
          }

          // Mount/dispose the Zug Island Legion side-zone (Level 9) —
          // open industrial arena with sustained waves of titans,
          // captains, and spider tanks. Same handles bag + dispose
          // pattern as the SaginawLab block above.
          const isZugIsland = typeof payload?.level === "number"
            && LevelSystem.isZugIsland(payload.level as WorldLevel);
          if (isZugIsland && !zugIslandSystemRef.current) {
            zugIslandSystemRef.current = new ZugIslandSystem(
              scene,
              enemySystem,
              () => player.getPosition(),
              {
                city: cityGenerator,
                worldVisibles: [
                  mountainRingRef.current,
                  alienFoliageRef.current,
                  earthFoliageRef.current,
                  propSystemRef.current,
                ],
                lodCull,
              },
            );
          } else if (!isZugIsland && zugIslandSystemRef.current) {
            try { zugIslandSystemRef.current.dispose(); } catch {}
            zugIslandSystemRef.current = null;
          }

          // Mount/dispose the Ann Arbor Apocalypse side-zone (Level 10) —
          // medium-sized city with a giant alien mothership crashed into
          // its downtown towers. 10 maxed captains atop the saucer + a
          // continuous ground swarm of every robot type. Same handles bag
          // + dispose pattern as the ZugIsland block above.
          const isAnnArbor = typeof payload?.level === "number"
            && LevelSystem.isAnnArbor(payload.level as WorldLevel);
          if (isAnnArbor && !annArborSystemRef.current) {
            annArborSystemRef.current = new AnnArborSystem(
              scene,
              enemySystem,
              () => player.getPosition(),
              {
                city: cityGenerator,
                worldVisibles: [
                  mountainRingRef.current,
                  alienFoliageRef.current,
                  earthFoliageRef.current,
                  propSystemRef.current,
                ],
                lodCull,
              },
            );
          } else if (!isAnnArbor && annArborSystemRef.current) {
            try { annArborSystemRef.current.dispose(); } catch {}
            annArborSystemRef.current = null;
          }

          // Mount/dispose the orbital side-zone (Level 5) on the same edge
          // as the sanctuary. SpaceLevelSystem owns the skybox swap, the
          // Earth backdrop, the asteroid field, and pre-engages
          // AerialEnemySystem so the player drops into a live dogfight.
          const isSpacelike = typeof payload?.level === "number"
            && LevelSystem.isSpacelike(payload.level as WorldLevel);
          if (isSpacelike && !spaceLevelSystemRef.current && skyRef.current) {
            // Defensive guard: only mount once both the sky and the aerial
            // systems are live. In practice both are constructed in
            // initializeGame before LEVEL_STARTED can fire, but a hot-restart
            // could in theory re-emit a buffered event before skyRef is set.
            spaceLevelSystemRef.current = new SpaceLevelSystem(
              scene,
              skyRef.current,
              aerialEnemySystem,
              () => player.getPosition(),
              vehicleRef.current,
              {
                city: cityGenerator,
                weapons: weaponsRef.current,
                specialWeapons: specialWeaponsRef.current,
                megaCannon: megaCannonRef.current,
                player: player,
                worldVisibles: [
                  mountainRingRef.current,
                  alienFoliageRef.current,
                  earthFoliageRef.current,
                  propSystemRef.current,
                ],
                lodCull,
                gamepad: gamepadRef.current,
              },
            );
          } else if (!isSpacelike && spaceLevelSystemRef.current) {
            try { spaceLevelSystemRef.current.dispose(); } catch {}
            spaceLevelSystemRef.current = null;
          }

          // Mount/dispose the Michigan Wilds heightmap side-zone (Level 11).
          // It owns the MIHEIGHTMAP terrain + TerrainMaterial tiering and
          // hides the city so existing city-level materials stay untouched.
          const isMichiganTerrain = typeof payload?.level === "number"
            && LevelSystem.isMichiganTerrain(payload.level as WorldLevel);
          if (isMichiganTerrain && !michiganTerrainSystemRef.current) {
            player.setBuildingColliders([]);
            player.setFloorPlatforms([]);
            michiganTerrainSystemRef.current = new MichiganTerrainSystem(
              scene,
              {
                city: cityGenerator,
                worldVisibles: [
                  mountainRingRef.current,
                  alienFoliageRef.current,
                  earthFoliageRef.current,
                  propSystemRef.current,
                ],
                lodCull,
                bio: bioRef.current,
                inventory,
                playerPos: () => player.getPosition(),
                enemy: enemySystem,
                aerial: aerialEnemySystem,
              },
            );
          } else if (!isMichiganTerrain && michiganTerrainSystemRef.current) {
            const targetKeepsWorldHidden =
              isSanctuary || isLab || isLair || isSaginawLab ||
              isZugIsland || isAnnArbor || isSpacelike;
            try { michiganTerrainSystemRef.current.dispose(!targetKeepsWorldHidden); } catch {}
            michiganTerrainSystemRef.current = null;
            player.setBuildingColliders(cityGenerator.getWallColliders());
            player.setFloorPlatforms(cityGenerator.getFloorPlatforms());
          }

          // Combat-only progression: bump waves + seed the next fortress.
          // Skipped while peaceful (sanctuary), spacelike (orbital combat
          // is owned by AerialEnemySystem, no ground fortresses), or in
          // the Swarms Lair (its own self-contained arena — boss + minions
          // are spawned by SwarmsLairSystem itself, no city fortress to
          // seed).
          if (!isPeaceful && !isSpacelike && !isLair && !isSaginawLab && !isZugIsland && !isAnnArbor && !isMichiganTerrain && payload?.level >= 2) {
            const baseWave = enemySystem.getWaveNumber() + 2;
            const targetWave = payload.level === 3 ? Math.max(baseWave, 9) : Math.max(baseWave, 5);
            enemySystem.jumpToWave(targetWave);
            const center = payload.fortressCenter as { x: number; z: number } | undefined;
            if (center) {
              const target = new BABYLON.Vector3(center.x, 0, center.z);
              const existing = enemyBaseSystem.getBossFortresses();
              const has = existing.some(b => b.position.subtract(target).length() <= 5);
              if (!has) enemyBaseSystem.spawnBossFortress(target);
            }
            const banner = payload.level === 3
              ? "LEVEL 3 — VOID STALKER INCOMING"
              : "LEVEL 2 — CAPTAINS INVADING";
            showMessage(banner, 4000);
          }
        });

        // ALLY_RESCUED → small UI cue (the spire-clear UI message already fires
        // from EnemyBaseSystem; this keeps a dedicated slot for future hooks).
        bus.on(GameEvents.ALLY_RESCUED, () => {
          showMessage("ALLY RESCUED", 3000);
        });

        // SYNTHETIC_RESCUED → toast + immediate forced save so the rescued id
        // is persisted before the player can die or close the tab. The
        // RescueSystem itself opens the centered story bubble; we just
        // mirror a short HUD toast, flush the save, and re-check the
        // legendary-companion grant (rescuing the final synthetic could
        // be the trigger that unlocks it).
        bus.on(GameEvents.SYNTHETIC_RESCUED, (data: any) => {
          const name = (data && typeof data.name === "string") ? data.name : "SYNTHETIC";
          showMessage(`${name} RESCUED`, 2500);
          if (forceSaveRef.current) forceSaveRef.current();
          tryGrantLegendaryCompanionRef.current?.();
        });

        // ANIMAL_FREED → toast + persist the freed id + force-save +
        // re-check the legendary-companion grant. PontiacLabSystem fires
        // this once per E-press inside an animal cage (it does the visual
        // shatter + linger fade itself); we own the persistent set here.
        bus.on(GameEvents.ANIMAL_FREED, (data: any) => {
          const id = data?.id;
          const name = (data && typeof data.name === "string") ? data.name : "ANIMAL";
          if (typeof id === "string" && id.length > 0) {
            freedLabAnimalIdsRef.current.add(id);
          }
          showMessage(`${name} FREED`, 2500);
          if (forceSaveRef.current) forceSaveRef.current();
          tryGrantLegendaryCompanionRef.current?.();
        });

        // LAB_CAVE_ENTERED → fast-travel to the Swarms Lair (Level 7).
        // Fired by PontiacLabSystem when the player presses E on the
        // glowing cave hatch in the lab floor.
        bus.on(GameEvents.LAB_CAVE_ENTERED, () => {
          if (handleFastTravelRef.current) handleFastTravelRef.current(7);
        });

        // SWARMS_GENERAL_DEFEATED → flag the defeat in the long-lived
        // ref, force-save, banner, then re-check the legendary-companion
        // grant. SwarmsLairSystem handles the kill detection (matched on
        // isBossCaptain + proximity to the General spawn point).
        bus.on(GameEvents.SWARMS_GENERAL_DEFEATED, () => {
          if (swarmsGeneralDefeatedRef.current) return; // idempotent
          swarmsGeneralDefeatedRef.current = true;
          showMessage("GENERAL VOIDCROWN — DEFEATED", 4500);
          if (forceSaveRef.current) forceSaveRef.current();
          tryGrantLegendaryCompanionRef.current?.();
        });

        const enemyHealthBars = new EnemyHealthBarSystem(scene, engine.getCamera());
        const healthBarEnemyScratch: EnemyLike[] = [];
        enemyHealthBars.setEnemyProvider(() => {
          const ground: EnemyLike[] = enemySystem.getActiveEnemies();
          const aerial: EnemyLike[] = aerialEnemySystem.getActiveUnits();
          const baseUnits: EnemyLike[] = enemyBaseSystem.getEnemyLikes();
          healthBarEnemyScratch.length = 0;
          healthBarEnemyScratch.push(...ground, ...aerial, ...baseUnits);
          return healthBarEnemyScratch;
        });
        enemyHealthBarsRef.current = enemyHealthBars;

        // Brightly-coloured friendly NPCs scattered around spawn — pop-up
        // dialogue bubbles introduce the major systems (combat, shops, helper
        // bots, rocket skates, elementals, biome dangers).
        const friendlyNPCs = new FriendlyNPCSystem(scene, engine.getCamera());
        friendlyNPCs.setPlayerPositionProvider(() => player.getPosition());
        friendlyNPCs.setShopOpenProvider(() => shopRef.current?.isOpen() ?? false);
        // Defer to other modals too — lab, garden, upgrade menu, base UI all
        // own KeyE / interaction. Without this gate, pressing E inside any of
        // those would also advance NPC dialogue in the background.
        friendlyNPCs.setInputBlockedProvider(() => {
          if (labOpenRef.current) return true;
          if (gardenOpenRef.current) return true;
          if (upgradeMenuOpenRef.current) return true;
          if (gardenRef.current?.isGardenOpenCheck()) return true;
          // Defer to RescueSystem while a story bubble is mid-flight so the
          // E press that advances the rescue line can't also pop / advance
          // an adjacent friendly-NPC dialogue. (Cages and NPCs don't share
          // map regions today, but this keeps the contract robust if either
          // roster ever moves.)
          if (rescueSystemRef.current?.isStoryBubbleOpen()) return true;
          return false;
        });
        friendlyNPCs.spawnDefaults();
        friendlyNPCsRef.current = friendlyNPCs;

        // Captured-synthetic rescues — caged humanoids scattered through
        // each combat level (L1, L2, L3, L5). Press E inside a cage to free
        // the rescuee and trigger a centered story-bubble moment. Mounted
        // here once; the LEVEL_STARTED handler below calls `setLevel` to
        // (re)spawn the per-level roster, skipping any rescuees the player
        // has already freed in a prior run (restored from ProgressSync).
        const rescueSystem = new RescueSystem(scene, engine.getCamera());
        rescueSystem.setPlayerPositionProvider(() => player.getPosition());
        rescueSystem.setInputBlockedProvider(() => {
          if (labOpenRef.current) return true;
          if (gardenOpenRef.current) return true;
          if (upgradeMenuOpenRef.current) return true;
          if (gardenRef.current?.isGardenOpenCheck()) return true;
          if (shopRef.current?.isOpen()) return true;
          return false;
        });
        rescueSystemRef.current = rescueSystem;
        // Seed the initial roster for the level we're on right now.
        // LevelSystem doesn't fire LEVEL_STARTED at construction, AND its
        // `applyLoadedState` early-returns without re-emitting when the
        // saved level is 1 — so without this call, fresh boots and L1
        // saves would never spawn rescue cages. For L2/L3/L5/L6 saves the
        // load handler's subsequent LEVEL_STARTED emit will swap to the
        // correct roster (setLevel disposes the L1 roster first).
        rescueSystem.setLevel(levelSystem.getCurrentLevel());

        const gamepad = new GamepadInput(engine.getCamera());
        gamepad.onConnectionChange((connected, padId) => {
          showMessage(connected ? `CONTROLLER CONNECTED: ${padId}` : "CONTROLLER DISCONNECTED", 2500);
        });
        // Triggers re-route based on context: while driving, RT becomes
        // throttle and LT becomes reverse/brake; on foot they fire and slash.
        gamepad.setContextProvider(() => (vehicleRef.current?.getActive() ? "vehicle" : "foot"));
        // Whenever ANY pause-style modal is open, the gamepad enters
        // pure navigation mode — D-Pad cycles tabs/rows, A activates
        // the selected row, B closes — and ALL gameplay bindings are
        // suppressed so the player can't shoot or look-around through
        // the menu. We OR every modal that has gamepad-aware UI so
        // the shop, garden, NPC dialogue, and upgrade bay all share
        // the same controller treatment.
        gamepad.setMenuOpenProvider(() =>
          upgradeMenuOpenRef.current
            || shopOpenRef.current
            || gardenOpenRef.current
            || (friendlyNPCsRef.current?.isDialogueOpen() ?? false),
        );
        gamepadRef.current = gamepad;

        const chestSystem = new ChestSystem(scene);
        chestSystemRef.current = chestSystem;
        chestSystem.setOnLootCollected(handleLootCollected);
        chestSystem.spawnChests(30);

        const vehicleSystem = new VehicleSystem(
          scene,
          () => player.getCameraYaw(),
          () => player.getCameraPitch(),
        );
        // Vehicles drive on the ground, on the racetrack ramp (tilted slab),
        // on the sky racetrack ring, and on side-zone heightmap terrain.
        vehicleSystem.setGroundHeightFn((x, z, currentY) =>
          michiganTerrainSystemRef.current?.getDriveableHeight(x, z)
            ?? cityGenerator.getDriveableHeight(x, z, currentY ?? Infinity),
        );
        vehicleSystem.setBuildingColliders(cityGenerator.getWallColliders());
        vehicleRef.current = vehicleSystem;
        // Spawn vehicles in a side parking spot — not in front of the player.
        // Player starts at (0, 2, -15) looking toward +Z so we park vehicles
        // to the west so they're out of the opening field of view.
        vehicleSystem.spawnPreset("RaiderATV", new BABYLON.Vector3(-40, 0.6, -15));
        vehicleSystem.spawnPreset("CometFighter", new BABYLON.Vector3(-55, 2, -15));

        // GHOST RIDE wiring. VehicleSystem doesn't know about the enemy
        // / aerial / base systems directly — we hand it live getters so
        // the ghost-ride collision scan always sees the up-to-date alive
        // lists (including enemies spawned by waves after the ride starts).
        // damageStructure is routed through enemyBaseRef so it picks up
        // any in-place rebind on a level swap (the bound `enemyBaseSystem`
        // local would otherwise stale out).
        vehicleSystem.setGhostRideTargets({
          getGroundEnemyMeshes: () => enemySystemRef.current?.getEnemyMeshes() ?? [],
          getAerialUnits: () => aerialEnemyRef.current?.getActiveUnits() ?? [],
          getBaseStructureMeshes: () => enemyBaseRef.current?.getActiveMeshes() ?? [],
          damageBaseStructure: (mesh, amount) =>
            enemyBaseRef.current?.damageStructure(mesh, amount) ?? false,
          getPlayerPosition: () => player.getPosition(),
        });

        // === EnvironmentPropSystem: scattered destructible/lootable sci-fi props ===
        const propSystem = new EnvironmentPropSystem(scene);
        propSystemRef.current = propSystem;
        atvHitCooldownRef.current.clear();

        // Cluster locations: spawn-area, dense rings around each enemy base,
        // roadside caches at true ~150-180m intervals along main approaches,
        // plus a few scattered industrial dumps. Themes keep areas distinct:
        //   - "industrial" near spawn / roadside (crates+barrels+canisters)
        //   - "military"   ringing each enemy base (containers+crates)
        //   - "holo"       at base approaches / signage points
        //
        // Each base has at least one cluster with `requiredKinds` that
        // deterministically guarantees a mix of crates, barrels, and an
        // open container ("supply cache"). Total prop count is also bounded
        // by EnvironmentPropSystem.MAX_PROPS as a perf guardrail.
        type ClusterOpts = NonNullable<Parameters<typeof propSystem.spawnCluster>[1]>;
        // Guaranteed "supply cache" composition for each base: open container
        // + 2 crates + 2 barrels, then theme-random fills remaining slots.
        const baseSupplyCacheKinds: ("crate" | "barrel" | "open_container")[] = [
          "open_container", "crate", "crate", "barrel", "barrel",
        ];
        const clusterCenters: Array<{ pos: BABYLON.Vector3; opts?: ClusterOpts }> = [
          // === Spawn-area industrial scatter ===
          { pos: new BABYLON.Vector3(18, 0, 22),  opts: { count: 5, radius: 4.5, theme: "industrial" } },
          { pos: new BABYLON.Vector3(-22, 0, 14), opts: { count: 4, radius: 4,   theme: "industrial" } },
          { pos: new BABYLON.Vector3(40, 0, -18), opts: { count: 6, radius: 5,   theme: "industrial", forceOpenContainer: true } },
          { pos: new BABYLON.Vector3(-46, 0, -32),opts: { count: 5, radius: 5,   theme: "industrial" } },

          // === NE Base @ (250,250) — military ring + guaranteed supply cache + holo signage ===
          { pos: new BABYLON.Vector3(232, 0, 232), opts: { count: 7, radius: 6, theme: "military", requiredKinds: baseSupplyCacheKinds } },
          { pos: new BABYLON.Vector3(272, 0, 228), opts: { count: 5, radius: 5, theme: "military" } },
          { pos: new BABYLON.Vector3(228, 0, 272), opts: { count: 5, radius: 5, theme: "military", forceOpenContainer: true } },
          { pos: new BABYLON.Vector3(218, 0, 218), opts: { count: 4, radius: 4, theme: "holo" } },

          // === NW Base @ (-250,250) — military ring + guaranteed supply cache + holo signage ===
          { pos: new BABYLON.Vector3(-232, 0, 232), opts: { count: 7, radius: 6, theme: "military", requiredKinds: baseSupplyCacheKinds } },
          { pos: new BABYLON.Vector3(-272, 0, 228), opts: { count: 5, radius: 5, theme: "military" } },
          { pos: new BABYLON.Vector3(-228, 0, 272), opts: { count: 5, radius: 5, theme: "military", forceOpenContainer: true } },
          { pos: new BABYLON.Vector3(-218, 0, 218), opts: { count: 4, radius: 4, theme: "holo" } },

          // === South Base @ (0,-280) — military ring + guaranteed supply cache + holo signage ===
          { pos: new BABYLON.Vector3(0, 0, -262),   opts: { count: 7, radius: 6, theme: "military", requiredKinds: baseSupplyCacheKinds } },
          { pos: new BABYLON.Vector3(-26, 0, -300), opts: { count: 5, radius: 5, theme: "military" } },
          { pos: new BABYLON.Vector3(26, 0, -255),  opts: { count: 5, radius: 5, theme: "military", forceOpenContainer: true } },
          { pos: new BABYLON.Vector3(0, 0, -232),   opts: { count: 4, radius: 4, theme: "holo" } },

          // === Roadside supply caches at true ~150-180m intervals along main routes ===
          // Spawn -> NE base (route length ~354m): caches at ~155m and ~310m.
          { pos: new BABYLON.Vector3(110, 0, 110), opts: { count: 4, radius: 4, theme: "industrial" } }, // ~155m from origin
          { pos: new BABYLON.Vector3(220, 0, 220), opts: { count: 5, radius: 4.5, theme: "industrial", forceOpenContainer: true } }, // ~155m gap
          // Spawn -> NW base (mirror)
          { pos: new BABYLON.Vector3(-110, 0, 110), opts: { count: 4, radius: 4, theme: "industrial" } },
          { pos: new BABYLON.Vector3(-220, 0, 220), opts: { count: 5, radius: 4.5, theme: "industrial", forceOpenContainer: true } },
          // Spawn -> South base (route length ~280m): one cache at ~160m.
          { pos: new BABYLON.Vector3(0, 0, -160),  opts: { count: 5, radius: 4.5, theme: "industrial", forceOpenContainer: true } }, // 160m from origin

          // === Scattered industrial dumps off main routes ===
          { pos: new BABYLON.Vector3(120, 0, 60),   opts: { count: 4, radius: 4, theme: "industrial" } },
          { pos: new BABYLON.Vector3(-110, 0, -80), opts: { count: 4, radius: 4, theme: "industrial", forceOpenContainer: true } },
          { pos: new BABYLON.Vector3(180, 0, -140), opts: { count: 5, radius: 5, theme: "industrial" } },
          { pos: new BABYLON.Vector3(-160, 0, 120), opts: { count: 4, radius: 4, theme: "industrial" } },
        ];
        for (const c of clusterCenters) {
          propSystem.spawnCluster(c.pos, c.opts);
        }
        // A handful of standalone holo-signs as roadside markers along main approaches
        propSystem.spawn("holo_sign", new BABYLON.Vector3(0, 0, 30));
        propSystem.spawn("holo_sign", new BABYLON.Vector3(60, 0, -10));
        propSystem.spawn("holo_sign", new BABYLON.Vector3(-60, 0, -10));
        propSystem.spawn("holo_sign", new BABYLON.Vector3(120, 0, 120));
        propSystem.spawn("holo_sign", new BABYLON.Vector3(-120, 0, 120));
        propSystem.spawn("holo_sign", new BABYLON.Vector3(0, 0, -140));
        // Diagnostic: log final placed prop count vs. MAX_PROPS budget.
        // Helps validate perf budgets as world content grows.
        console.log(`[Game] Environment props placed: ${propSystem.getActiveProps().length} (cap ${EnvironmentPropSystem.MAX_PROPS})`);

        // === AlienFoliageSystem: L-system procedural alien plants in the
        //     wilderness ring between the city and the mountain ring. ===
        const alienFoliage = new AlienFoliageSystem(scene);
        alienFoliageRef.current = alienFoliage;

        // === EarthFoliageSystem: realistic terrestrial trees + shrubs.
        //     Same wilderness band as the alien plants, but a different
        //     PRNG seed so the two systems' anti-overlap loops settle into
        //     non-conflicting placements. Hidden alongside the alien
        //     foliage in side-zones via worldVisibles. ===
        const earthFoliage = new EarthFoliageSystem(scene);
        earthFoliageRef.current = earthFoliage;

        let totalKillsLocal = 0;
        let highestWaveLocal = 1;

        const buildSnapshot = (): ProgressSnapshot => {
          const inventoryCounts: Record<string, number> = {};
          const slots = inventory.getSlots();
          for (const slot of slots) {
            if (slot) {
              inventoryCounts[slot.item.id] = (inventoryCounts[slot.item.id] || 0) + slot.quantity;
            }
          }
          const captures = bioSystem.getCaptured ? bioSystem.getCaptured() : [];
          // Pull premium / upgrade state straight from each owning system so
          // helper-bot upgrades and SPECIALS unlocks survive a hard restart.
          const sabreState = beamSabre.getSpecialsState();
          const arsenalSnap = meleeArsenal.getSnapshot();
          const companions = companionSystem.serializeForSave();
          const elementalLevels = elementalSpecials.getLevels() as Record<string, number>;
          // Sticky-OR every "once unlocked = always owned" flag against the
          // React mirror so the save snapshot can NEVER regress to false.
          // Three concrete regressions this guards against, all observed in
          // the wild:
          //   • Robot Dragon dies → roster.splice removes it → an autosave
          //     fires before the PLAYER_DIED revive timer re-adds it → snap
          //     writes roboDragon=false and the next reload thinks the
          //     player never bought it.
          //   • Beam-sabre system gets recreated on a failed-init retry and
          //     boots back up with hasGoldSabre=false before applyLoadedState
          //     can run → next snap clobbers the gold-sabre unlock.
          //   • Superman Flight: same risk if PlayerController is ever
          //     re-instantiated mid-session (level transition, debug flow).
          // The React `specialsOwned` state is the single source of truth
          // for "the player paid for this", so OR live-state with the
          // sticky mirror to keep the unlock once it's been earned.
          const owned = specialsOwnedRef.current;
          const specialsOwnedSnap = {
            sabreSpin: sabreState.hasSpinAttack || owned.sabreSpin,
            sabreTwin: sabreState.hasTwinWave || owned.sabreTwin,
            sabreGiant: sabreState.hasGiantBlade || owned.sabreGiant,
            sabreGold: sabreState.hasGoldSabre || owned.sabreGold,
            autoLoot: pickupSystem.isAutoLootEnabled() || owned.autoLoot,
            // Dragon presence in the live roster is volatile (death, level
            // transition, lab dismiss). The unlock itself is sticky.
            roboDragon: owned.roboDragon || companions.some(c => c.presetName === "RoboDragon"),
            autoTarget: weapons.isAutoTargetEnabled() || owned.autoTarget,
            supermanFlight: player.getHasSupermanFlight() || owned.supermanFlight,
            glaiveOwn: arsenalSnap.glaive.unlocked,
            glaiveCombo: arsenalSnap.glaive.comboUnlocked,
            glaiveSpecial: arsenalSnap.glaive.specialUnlocked,
            daggersOwn: arsenalSnap.daggers.unlocked,
            daggersCombo: arsenalSnap.daggers.comboUnlocked,
            daggersSpecial: arsenalSnap.daggers.specialUnlocked,
            axeOwn: arsenalSnap.axe.unlocked,
            axeCombo: arsenalSnap.axe.comboUnlocked,
            axeSpecial: arsenalSnap.axe.specialUnlocked,
            whipOwn: arsenalSnap.whip.unlocked,
            whipCombo: arsenalSnap.whip.comboUnlocked,
            whipSpecial: arsenalSnap.whip.specialUnlocked,
          };
          return {
            stats: player.getStats(),
            weaponLevels: weapons.getWeaponLevels(),
            playerUpgrades: player.getPlayerUpgradeLevels(),
            inventoryCounts,
            hasFlightArmor: player.getHasFlightArmor(),
            totalKills: totalKillsLocal,
            highestWave: Math.max(highestWaveLocal, enemySystem.getWaveNumber()),
            capturedCreatures: captures as any[],
            // Persistent dex history — preserves the "ever caught" set even
            // after DEPLOY removes a creature from the live roster.
            bioDexCaughtIds: bioSystem.getDexCaughtIds(),
            savedAt: Date.now(),

            companions,
            maxCompanions: companionSystem.getMaxCompanions(),
            specialsOwned: specialsOwnedSnap,
            beamSabreLevel: sabreState.level,
            elementalLevels,
            // World-level progression so reloading puts the player back in
            // Level 2 (red sky, harder spawns, second fortress) if they
            // already cleared the first boss fortress.
            worldLevel: levelSystemRef.current?.getSnapshot().worldLevel ?? 1,
            lootedTempleIds: mountainRingRef.current?.getLootedTempleIds() ?? [],
            // Per-weapon Power-Jewel mounts (omitted entirely when nothing
            // is mounted to keep older clients unconfused).
            jewelMounts: jewelSystem.serialize(),
            // Captured-synthetic rescues already played out — re-entering a
            // level never spawns a rescuee whose story moment is finished.
            rescuedSyntheticIds: rescueSystemRef.current?.serialize() ?? [],
            // Pontiac Lab caged-animal frees — preserved across reloads so
            // the animal cages don't reappear and the legendary-companion
            // grant condition stays satisfied.
            freedLabAnimalIds: Array.from(freedLabAnimalIdsRef.current),
            // Swarms Lair boss kill + legendary-companion grant flags.
            // Both are one-way latches; saving them keeps the grant from
            // being re-issued on next boot (and the boss from being
            // counted as alive again for the grant gate).
            swarmsGeneralDefeated: swarmsGeneralDefeatedRef.current,
            legendaryCompanionGranted: legendaryCompanionGrantedRef.current,
            // Armor-capsule one-time purchases — without this the shop
            // re-offered (and could re-charge for) every previously-
            // bought capsule upgrade on each reload.
            appliedCapsuleUpgradeIds: capsuleSystem.serialize(),
            // Per-kind base-structure level (lab / garden). These cost
            // gears + scrap + energy cores to upgrade and drive the
            // companion cap + garden capture cap/bonus, so losing them
            // on reload silently downgraded the player's whole base.
            baseStructureLevels: baseSystem.serialize(),
            // Full equipped-armor loadout (every slot) + active element.
            // Round-trips both capsule-bought pieces and looted armor
            // so defense / health / stamina bonuses + the elemental
            // aura survive a reload.
            equippedArmor: armorSystem.serialize() as unknown as ProgressSnapshot["equippedArmor"],
          };
        };

        const doSaveProgress = async (force: boolean = false): Promise<void> => {
          if (!currentUser) return;
          const now = performance.now();
          // The 2s throttle protects against per-frame spam, but death + unlock
          // saves opt-in to bypass it so we never lose the most recent gain.
          if (!force && now - lastSaveAtRef.current < 2000) return;
          lastSaveAtRef.current = now;
          await saveProgress(buildSnapshot());
        };
        // Expose for handleUnlockSpecial (defined in outer React scope) so
        // SPECIALS unlocks can request an immediate forced save.
        forceSaveRef.current = () => { void doSaveProgress(true); };

        // Legendary-companion grant — re-evaluated on every progression
        // edge that could complete the gate (synthetic rescued, animal
        // freed, General defeated). Idempotent: the flag-check at the
        // top short-circuits once granted, so duplicate event fans don't
        // duplicate the companion. Total caged-synthetic count is read
        // from RESCUE_DEFS so adding a new level's roster later
        // automatically tightens the gate (no magic 12 hard-coded).
        const TOTAL_SYNTHETICS = (() => {
          let n = 0;
          // Object.values is the type-safe path here — RESCUE_DEFS uses
          // numeric keys, so the Object.keys(...) → number cast wouldn't
          // typecheck even though the runtime would have worked.
          for (const roster of Object.values(RESCUE_DEFS)) {
            n += (roster ?? []).length;
          }
          return n;
        })();
        const TOTAL_LAB_ANIMALS = 4; // PontiacLabSystem.ANIMAL_DEFS roster size
        tryGrantLegendaryCompanionRef.current = () => {
          if (legendaryCompanionGrantedRef.current) return;
          if (!swarmsGeneralDefeatedRef.current) return;
          if (freedLabAnimalIdsRef.current.size < TOTAL_LAB_ANIMALS) return;
          const rescuedCount = rescueSystemRef.current?.serialize().length ?? 0;
          if (rescuedCount < TOTAL_SYNTHETICS) return;
          // All conditions met — grant the legendary mini-General. The
          // companion is just another ALLY_PRESETS entry tuned to a tall
          // biped silhouette, so the standard addCompanion path applies.
          // We bump maxCompanions if the player is at cap so the grant
          // never silently fails on a full roster.
          const needed = companionSystem.getCompanionCount() + 1;
          if (companionSystem.getMaxCompanions() < needed) {
            companionSystem.setMaxCompanions(needed);
          }
          const ok = companionSystem.addCompanion(
            "MiniGeneralVoidcrown",
            player.getPosition(),
            { allowDuplicate: true },
          );
          if (!ok) return; // roster still full for some other reason; try again on next event
          legendaryCompanionGrantedRef.current = true;
          showMessage("LEGENDARY COMPANION — MINI-GENERAL JOINS YOU", 5000);
          // Match the EventBus contract: payload is `{ presetName }` so
          // listeners can route on which legendary just landed.
          bus.emit(GameEvents.LEGENDARY_COMPANION_GRANTED, { presetName: "MiniGeneralVoidcrown" });
          if (forceSaveRef.current) forceSaveRef.current();
        };

        // Start the periodic autosave only after the initial load completes
        // (or fails). If we started it eagerly, a 5s timer could fire *before*
        // the load resolves on a slow connection and write a fresh level-1
        // snapshot over the player's real cloud save.
        const startAutosaveTimer = () => {
          if (!currentUser) return;
          if (autosaveTimerRef.current !== null) return; // already running
          // Autosave cadence: 30 s. The previous 5 s interval was firing a
          // full state serialization + POST every five seconds, which both
          // burned main-thread time on JSON.stringify and triggered visible
          // sluggishness as the game grew. Event-driven saves (level-up,
          // weapon upgrade, pickup, etc.) still fire immediately, so the
          // user never loses meaningful progress to the wider interval.
          autosaveTimerRef.current = window.setInterval(() => { void doSaveProgress(); }, 30000);
        };

        // Initial load + apply
        if (currentUser) {
          void loadProgress().then((snap) => {
            if (!snap) return;
            try {
              player.applyLoadedSnapshot({ stats: snap.stats as any, hasFlightArmor: snap.hasFlightArmor, playerUpgrades: snap.playerUpgrades });
              if (snap.weaponLevels) weapons.setWeaponLevels(snap.weaponLevels);
              if (snap.inventoryCounts) {
                inventory.clear();
                for (const [itemId, qty] of Object.entries(snap.inventoryCounts)) {
                  // Crafting materials (energy_core, circuit_board, nano_fiber,
                  // scrap_metal, …) live in CRAFTING_MATERIALS, NOT
                  // ITEM_DEFINITIONS. Without the fallback they were silently
                  // dropped on load — which is why cores/nano/circuits "reset"
                  // every time the player died and the page reloaded.
                  const def = ITEM_DEFINITIONS[itemId] || CRAFTING_MATERIALS[itemId];
                  if (def && qty > 0) inventory.addItem(def, qty);
                }
              }
              totalKillsLocal = snap.totalKills || 0;
              highestWaveLocal = snap.highestWave || 1;

              // Restore SPECIALS unlocks + their system-side side-effects.
              if (snap.specialsOwned) {
                setSpecialsOwned(prev => ({ ...prev, ...snap.specialsOwned! }));
                if (snap.specialsOwned.autoLoot) pickupSystem.setAutoLootEnabled(true);
                // Restore the Auto-Target Module side-effect on load so the
                // module is live from frame one of the new session, not just
                // the first time the player re-opens the SPECIALS tab.
                if (snap.specialsOwned.autoTarget) weapons.setAutoTargetEnabled(true);
                // Restore Superman Flight unlock so the dash+jump combo
                // is live from the first airborne frame after load —
                // otherwise the player would have to re-buy the SPECIAL.
                if (snap.specialsOwned.supermanFlight) player.unlockSupermanFlight();
              }
              // Beam sabre level + sabre special unlocks.
              if (snap.beamSabreLevel || snap.specialsOwned) {
                beamSabre.applyLoadedState({
                  level: snap.beamSabreLevel,
                  hasSpinAttack: snap.specialsOwned?.sabreSpin,
                  hasTwinWave: snap.specialsOwned?.sabreTwin,
                  hasGiantBlade: snap.specialsOwned?.sabreGiant,
                  hasGoldSabre: snap.specialsOwned?.sabreGold,
                });
                setBeamSabreLevel(beamSabre.getLevel);
              }
              // Restore melee-arsenal SPECIALS unlocks. Equipped slot is
              // intentionally NOT restored — players cycle in via KeyB
              // each session so the sabre remains the default on spawn.
              if (snap.specialsOwned) {
                const so = snap.specialsOwned;
                meleeArsenal.applyLoadedState({
                  glaive:  { unlocked: !!so.glaiveOwn,  comboUnlocked: !!so.glaiveCombo,  specialUnlocked: !!so.glaiveSpecial  },
                  daggers: { unlocked: !!so.daggersOwn, comboUnlocked: !!so.daggersCombo, specialUnlocked: !!so.daggersSpecial },
                  axe:     { unlocked: !!so.axeOwn,    comboUnlocked: !!so.axeCombo,    specialUnlocked: !!so.axeSpecial    },
                  whip:    { unlocked: !!so.whipOwn,   comboUnlocked: !!so.whipCombo,   specialUnlocked: !!so.whipSpecial   },
                });
              }
              // Elemental specials per-element levels.
              if (snap.elementalLevels) elementalSpecials.setLevels(snap.elementalLevels as any);
              // Companion roster + per-companion level + weaponLevel. Restore
              // the cap *before* the roster so the dragon (which raised the
              // cap when first unlocked) fits back in.
              if (typeof snap.maxCompanions === "number" && snap.maxCompanions > 0) {
                companionSystem.setMaxCompanions(snap.maxCompanions);
              }
              if (snap.companions && snap.companions.length > 0) {
                companionSystem.applyLoadedCompanions(snap.companions, player.getPosition());
              }
              // Permanent-helper backfill: even if the save was captured at a
              // moment when Spark Pup or the unlocked Robot Dragon were dead,
              // we re-issue them on reload so "once unlocked = always with you"
              // holds across sessions. We read the dragon flag straight off
              // the snap (specialsOwnedRef is React state and won't have
              // refreshed yet inside this load handler).
              const dragonUnlockedSaved = !!snap.specialsOwned?.roboDragon;
              const backfill: string[] = [];
              if (!companionSystem.hasCompanionByPreset("SparkPup")) backfill.push("SparkPup");
              if (dragonUnlockedSaved && !companionSystem.hasCompanionByPreset("RoboDragon")) {
                backfill.push("RoboDragon");
              }
              if (backfill.length > 0) {
                const needed = companionSystem.getCompanionCount() + backfill.length;
                if (companionSystem.getMaxCompanions() < needed) companionSystem.setMaxCompanions(needed);
                for (const preset of backfill) {
                  companionSystem.addCompanion(preset, player.getPosition(), { allowDuplicate: true });
                }
              }
              // Re-push armor-mod boosts to WeaponsSystem after restoring the
              // player upgrade levels, so the player's saved damage / fire-rate
              // mods take effect immediately after a reload.
              weapons.setPlayerBoosts(player.getPlayerBoosts());
              // Push per-level damage multiplier (level 1 → 1.0 baseline,
              // up to 1.99 at the level-100 cap) so saved high-level
              // characters keep their attack scaling on reload.
              weapons.setPlayerLevelMul(player.getLevelDamageMul());
              // Per-level damage scaling reaches melee combat (sabre,
              // alternate arsenal, base combo) the same way it reaches
              // ranged via WeaponsSystem.
              try { combatSystemRef.current?.setDamageMultiplier(player.getLevelDamageMul()); } catch {}
              try { beamSabreRef.current?.setPlayerLevelMul(player.getLevelDamageMul()); } catch {}
              try { meleeArsenalRef.current?.setPlayerLevelMul(player.getLevelDamageMul()); } catch {}
              // Restore Power-Jewel mounts AFTER inventoryCounts has been
              // applied. Mounted jewels are NOT in inventoryCounts (they were
              // consumed when mounted), so this pass simply rebuilds the
              // mount map and pushes the per-weapon multiplier into
              // WeaponsSystem via the onMountChanged callback we wired above.
              jewelSystem.applyLoadedState(snap.jewelMounts);
              // Restore the rescued-synthetic id set BEFORE LevelSystem
              // re-emits LEVEL_STARTED, so the cage roster spawned by the
              // resulting setLevel call already prunes anyone the player
              // has freed in a prior run.
              if (rescueSystemRef.current) {
                rescueSystemRef.current.applyLoadedState(snap.rescuedSyntheticIds);
              }
              // Restore the Pontiac Lab → Swarms Lair progression flags.
              // These mirror into Game.tsx-owned refs because the systems
              // that read them (PontiacLabSystem ctor, the legendary-
              // grant helper) are constructed lazily on level entry.
              if (snap.freedLabAnimalIds && snap.freedLabAnimalIds.length > 0) {
                freedLabAnimalIdsRef.current = new Set(snap.freedLabAnimalIds);
              }
              if (snap.swarmsGeneralDefeated) {
                swarmsGeneralDefeatedRef.current = true;
              }
              if (snap.legendaryCompanionGranted) {
                legendaryCompanionGrantedRef.current = true;
              }
              // Restore world-level progression. For L2, applyLoadedState
              // re-emits LEVEL_STARTED, which our listener uses to swap
              // banner/objective, tint the sky, seed the second fortress,
              // and bump enemy difficulty.
              if (snap.worldLevel && levelSystemRef.current) {
                levelSystemRef.current.applyLoadedState({ worldLevel: snap.worldLevel });
              }
              // Restore captured pets and dex history. loadCaptured silently
              // skips entries whose speciesId no longer resolves, so legacy
              // saves don't crash on unknown ids.
              if (bioRef.current) {
                bioRef.current.loadCaptured(snap.capturedCreatures);
                bioRef.current.loadDexCaughtIds(snap.bioDexCaughtIds);
                setCapturedCreatures(bioRef.current.getCaptured());
                setDexCaughtIds(bioRef.current.getDexCaughtIds());
                const petBondBoosts = bioRef.current.getPetBondBonuses();
                setPetBondSummary(petBondBoosts.summary);
                player.setPetBondBoosts(petBondBoosts);
                weapons.setPlayerBoosts(player.getPlayerBoosts());
              }
              // Hidden-temple looted state — keep raided temples dimmed
              // across reloads and (per-level) across deaths.
              if (mountainRingRef.current) {
                mountainRingRef.current.loadLootedTempleIds(snap.lootedTempleIds);
              }
              // Restore the equipped-armor loadout BEFORE flipping the
              // capsule applied flags. ArmorSystem owns the actual
              // pieces + active element; ArmorCapsuleSystem just bookkeeps
              // which one-time upgrades have been bought so the shop
              // doesn't re-offer them. Doing armor first means a
              // future change to capsule-replay can never clobber loot.
              if (snap.equippedArmor) {
                armorSystem.applyLoadedState({
                  pieces: snap.equippedArmor.pieces as any,
                  element: snap.equippedArmor.element as any,
                });
              }
              if (snap.appliedCapsuleUpgradeIds && snap.appliedCapsuleUpgradeIds.length > 0) {
                capsuleSystem.applyLoadedState(snap.appliedCapsuleUpgradeIds);
              }
              // Restore per-kind base-structure levels BEFORE any level
              // system re-emits LEVEL_STARTED — SanctuarySystem.onMount
              // is what calls `baseSystem.registerStructure(...)`, and
              // `registerStructure` reads `savedLevels` to pre-bump the
              // newly-spawned structure to the saved tier. Wiring this
              // after worldLevel restore would race past that mount.
              if (snap.baseStructureLevels) {
                baseSystem.applyLoadedLevels(snap.baseStructureLevels);
                // Companion cap is derived from lab level — re-sync it
                // here so the load doesn't briefly show a stale cap
                // before the next structure-upgrade event recomputes.
                const labCap = baseSystem.getLabCompanionCap();
                if (labCap > companionSystem.getMaxCompanions()) {
                  companionSystem.setMaxCompanions(labCap);
                }
              }

              showMessage(`PROGRESS LOADED — LVL ${snap.stats.level} | ${snap.stats.credits}cr`, 2500);
            } catch (err) {
              console.warn("[ProgressSync] apply failed:", err);
            }
          }).catch((err) => {
            console.warn("[ProgressSync] load failed:", err);
          }).finally(() => {
            // Autosave only AFTER load resolves, so the timer can never write
            // a default snapshot on top of the real cloud save during a slow
            // network round-trip. 5s is the new cadence (was 15s — too wide
            // to catch resources/helper-bot upgrades earned right before death).
            if (autosaveTimerRef.current !== null) window.clearInterval(autosaveTimerRef.current);
            startAutosaveTimer();
          });
        } else {
          // No user logged in — still run autosave so an eventual login flow
          // doesn't get stuck without one. (No-op until currentUser exists.)
          startAutosaveTimer();
        }

        bus.on(GameEvents.PLAYER_LEVEL_UP, () => {
          // Per-level damage scaling is pushed every time the player
          // levels up so the next shot fired uses the new multiplier.
          try { weapons.setPlayerLevelMul(player.getLevelDamageMul()); } catch {}
          try { combatSystemRef.current?.setDamageMultiplier(player.getLevelDamageMul()); } catch {}
          try { beamSabreRef.current?.setPlayerLevelMul(player.getLevelDamageMul()); } catch {}
          try { meleeArsenalRef.current?.setPlayerLevelMul(player.getLevelDamageMul()); } catch {}
          void doSaveProgress();
        });
        bus.on(GameEvents.WEAPON_UPGRADED, () => { void doSaveProgress(); });
        // Push the player's armor-mod boosts to WeaponsSystem any time the
        // player buys an upgrade. Save the new state too.
        bus.on(GameEvents.PLAYER_UPGRADED, () => {
          weapons.setPlayerBoosts(player.getPlayerBoosts());
          void doSaveProgress();
        });
        bus.on(GameEvents.CREATURE_CAPTURED, () => { void doSaveProgress(); });
        // Helper-bot roster + helper-bot upgrades must persist or paid-for
        // upgrades evaporate on the next death.
        bus.on(GameEvents.COMPANION_BUILT, () => { void doSaveProgress(); });
        bus.on(GameEvents.COMPANION_UPGRADED, () => { void doSaveProgress(); });
        // Resource pickups (SCRAP / CORES / CIRCUITS / NANO) are why the
        // player grinds — autosave the inventory whenever any pickup lands.
        // The 2s throttle inside doSaveProgress dampens the per-frame pickup
        // bursts so we don't spam the backend.
        bus.on(GameEvents.PICKUP_COLLECTED, () => { void doSaveProgress(); });

        bus.on(GameEvents.PLAYER_DIED, () => {
          if (vehicleSystem.getActive()) {
            vehicleSystem.exit();
            player.setMounted(null);
          }
          // Force-save (bypassing the throttle) so the very last loot pickup
          // before death is captured. Without `force=true` a recent autosave
          // could swallow this call and the player loses everything earned in
          // the last few seconds.
          if (currentUser) void doSaveProgress(true);
          // Friendly respawn flow — preserve all stats/inventory/weapons
          showMessage("YOU FELL — RESPAWNING IN 3...", 1100);
          if (respawnTimeoutRef.current !== null) {
            window.clearTimeout(respawnTimeoutRef.current);
          }
          window.setTimeout(() => showMessage("RESPAWNING IN 2...", 1100), 1000);
          window.setTimeout(() => showMessage("RESPAWNING IN 1...", 1100), 2000);
          respawnTimeoutRef.current = window.setTimeout(() => {
            respawnTimeoutRef.current = null;
            const cur = playerRef.current;
            if (!cur) return;
            // Respawn at the safe initial spawn area (cleared of buildings),
            // not (0,0,0) which can be inside a downtown building.
            const spawn = new BABYLON.Vector3(0, 2, -15);
            cur.respawn(spawn);
            // Restore the player's permanent helper roster after death. Two
            // helpers should never be lost to a single death:
            //   - Spark Pup: the free starter pet that ships with every run.
            //   - Robot Dragon: a paid SPECIALS unlock that, once acquired,
            //     should follow the player forever.
            // Both are re-added with allowDuplicate so the "already collected"
            // guard inside CompanionSystem doesn't silently block them, and
            // the cap is grown to fit if needed (we never SHRINK it).
            const compSys = companionRef.current;
            if (compSys) {
              const dragonUnlocked = !!specialsOwnedRef.current.roboDragon;
              const reviveList: { preset: string; banner: string }[] = [];
              if (!compSys.hasCompanionByPreset("SparkPup")) {
                reviveList.push({ preset: "SparkPup", banner: "SPARK PUP REJOINS YOU" });
              }
              if (dragonUnlocked && !compSys.hasCompanionByPreset("RoboDragon")) {
                reviveList.push({ preset: "RoboDragon", banner: "ROBOT DRAGON RETURNS" });
              }
              if (reviveList.length > 0) {
                const needed = compSys.getCompanionCount() + reviveList.length;
                if (compSys.getMaxCompanions() < needed) compSys.setMaxCompanions(needed);
                let delay = 200;
                for (const r of reviveList) {
                  const ok = compSys.addCompanion(r.preset, spawn, { allowDuplicate: true });
                  if (ok) window.setTimeout(() => showMessage(r.banner, 2000), delay);
                  delay += 900;
                }
              }
            }
            showMessage("RESPAWNED — YOUR PROGRESS IS SAFE", 2500);
          }, 3000);
        });

        for (let i = 0; i < 5; i++) {
          enemySystem.spawnEnemy(player.getPosition());
        }

        bus.on(GameEvents.COMBO_HIT, (data: any) => {
          setComboInfo({ name: data.comboName, index: data.comboIndex });
          setTimeout(() => setComboInfo(null), 1000);
        });

        bus.on(GameEvents.ENEMY_KILLED, (data: any) => {
          player.addCredits(data.credits);
          player.addExperience(data.experience);
          totalKillsLocal += 1;
          showMessage(`+${data.credits} CREDITS | +${data.experience} XP`, 1000);
          // Remove dead enemy from ATV cooldown map so it never grows unbounded.
          if (data?.meshUniqueId != null) atvHitCooldownRef.current.delete(data.meshUniqueId);
        });

        bus.on(GameEvents.PLAYER_DODGE, () => {
          showMessage("DODGE!", 500);
        });

        bus.on(GameEvents.PLAYER_PARRY, (data: any) => {
          if (data?.success) {
            showMessage("PARRY!", 500);
          }
        });

        bus.on(GameEvents.PLAYER_LEVEL_UP, (data: any) => {
          showMessage(`LEVEL UP! LVL ${data.level}`, 3000);
        });

        bus.on(GameEvents.PLAYER_FLIGHT_ENTER, () => {
          showMessage("FLIGHT MODE ACTIVATED", 1500);
        });

        bus.on(GameEvents.PLAYER_FLIGHT_EXIT, () => {
          showMessage("FLIGHT MODE DEACTIVATED", 1000);
        });

        const isPropMeta = (m: unknown): m is PropHitboxMetadata =>
          !!m && typeof m === "object" && (m as PropHitboxMetadata).isProp === true;

        const routeHit = (mesh: BABYLON.AbstractMesh, dmg: number) => {
          const meta = mesh.metadata;
          if (isPropMeta(meta)) {
            meta.damageable.takeDamage({
              amount: dmg,
              damageType: DamageType.Kinetic,
              hitPoint: mesh.getAbsolutePosition().clone(),
            });
            return;
          }
          if (miningSystem.damageNode(mesh, dmg)) return;
          if (enemyBaseSystem.damageStructure(mesh, dmg)) {
            aerialEnemySystem.engage();
            return;
          }
          if (aerialEnemySystem.damageEnemy(mesh as BABYLON.Mesh, dmg)) {
            aerialEnemySystem.engage();
            return;
          }
          enemySystem.damageEnemy(mesh as BABYLON.Mesh, dmg);
        };

        beamSabre.setDamageRouter(routeHit);
        meleeArsenal.setDamageRouter(routeHit);
        megaCannon.setDamageRouter(routeHit);

        // Both melee systems now query a curated list instead of scanning
        // the full scene.meshes array on every slash/swing/special hit check.
        beamSabre.setHittableMeshProvider(() => enemyMeshScratch);
        meleeArsenal.setHittableMeshProvider(() => enemyMeshScratch);

        let lastTime = performance.now();
        let waveTimer = 0;
        let mapThrottleTimer = 0;
        let hudThrottleTimer = 0;
        let inventoryThrottleTimer = 0;
        const enemyMeshScratch: BABYLON.Mesh[] = [];
        const playerPositionScratch = new BABYLON.Vector3();

        engine.start(() => {
          const now = performance.now();
          const deltaTime = Math.min(now - lastTime, MAX_FRAME_DELTA_MS);
          lastTime = now;
          const dt = deltaTime / 1000;

          vehicleSystem.update(dt);
          player.update(dt);
          // Smash dive runs after the player physics tick so its visual
          // spin and per-frame land-check see the up-to-date isGrounded
          // state.
          smashAttackRef.current?.update(dt);
          // Amplify weapons while mounted in a vehicle (1.5x size/damage/explosion).
          const mounted = player.isMounted();
          weapons.setVehicleMode(mounted);
          const playerPos = player.copyPositionToRef(playerPositionScratch);

          combatSystem.update(dt);

          const groundEnemyMeshes = enemySystem.getEnemyMeshes();
          const aerialMeshes = aerialEnemySystem.getMeshes();
          const miningMeshes = miningSystem.getActiveMeshes();
          const baseMeshes = enemyBaseSystem.getActiveMeshes();
          const propMeshes = propSystem.getHitboxMeshes();
          const enemyMeshes = enemyMeshScratch;
          enemyMeshes.length = 0;
          enemyMeshes.push(
            ...groundEnemyMeshes,
            ...aerialMeshes,
            ...miningMeshes,
            ...baseMeshes,
            ...propMeshes,
          );
          const hits = weapons.update(enemyMeshes, dt);

          for (const hit of hits) {
            const modifiedDamage = armorSystem.getModifiedOutgoingDamage(hit.damage);
            routeHit(hit.hitEnemy, modifiedDamage);
          }

          const specialHits = specialWeapons.update(dt, enemyMeshes, playerPos);
          for (const hit of specialHits) {
            routeHit(hit.hitEnemy, hit.damage);
          }

          // Elemental specials (Lightning/Ice/Fireball tracking + Inferno/Wind/Psychic dome)
          // route through the same hit pipeline so they damage every category
          // and engage the aerial squadron just like normal weapon fire.
          const elementalHits = elementalSpecials.update(dt, enemyMeshes, playerPos);
          for (const hit of elementalHits) {
            routeHit(hit.hitEnemy, hit.damage);
          }

          // Beam Sabre damage flows through the same router so slashes and
          // energy waves correctly hurt aerial fortresses, enemy bases,
          // mining nodes and props (not just ground enemies).
          beamSabre.update(dt, enemyMeshes);
          // Melee Arsenal — same damage router so alt melee weapons hit
          // every damageable mesh class (enemies, aerial units, turrets,
          // bases, mining nodes, props) with no per-system gates.
          meleeArsenal.update(dt);

          // Mega Beam Cannon (beam + weapon combo). Routes through the same
          // hit pipeline so the missiles + Kamehameha beam damage every
          // category and engage the aerial squadron just like normal fire.
          const cannonHits = megaCannon.update(dt, enemyMeshes, playerPos);
          for (const hit of cannonHits) {
            // routeHit already invoked inside the system's damageRouter;
            // re-routing here would double-hit. We only use the returned
            // list to flag aerial engagement when an aerial unit was struck.
            const meta: any = hit.hitEnemy.metadata;
            if (meta?.aerialUnit) aerialEnemySystem.engage();
          }

          const companionResult = companionSystem.update(dt, playerPos, enemyMeshes);
          if (companionResult.healed > 0) {
            player.heal(companionResult.healed);
          }
          for (const hit of companionResult.attackHits) {
            const m = hit.mesh as BABYLON.Mesh;
            routeHit(m, hit.damage);
          }

          const enemyResult = enemySystem.update(playerPos, deltaTime);
          if (enemyResult.damage > 0) {
            const reducedDamage = armorSystem.calculateDamageReduction(enemyResult.damage, DamageType.Melee);
            player.takeDamageSimple(reducedDamage);
            showMessage(`-${Math.floor(reducedDamage)} DAMAGE!`, 500);
          }

          const aerialResult = aerialEnemySystem.update(dt, playerPos);
          if (aerialResult.damage > 0) {
            const reducedAerial = armorSystem.calculateDamageReduction(aerialResult.damage, DamageType.Plasma);
            player.takeDamageSimple(reducedAerial);
            showMessage(`-${Math.floor(reducedAerial)} AIR STRIKE!`, 600);
          }

          enemyBaseSystem.setPlayerPosition(playerPos);
          const baseResult = enemyBaseSystem.update(dt);

          // LOD distance-cull pass. The system internally batches at ~6 Hz
          // so calling it every frame is essentially free.
          lodCull.setPlayerPos(playerPos);
          lodCull.update(deltaTime);
          if (baseResult.damage > 0) {
            const reducedBase = armorSystem.calculateDamageReduction(baseResult.damage, DamageType.Plasma);
            player.takeDamageSimple(reducedBase);
            showMessage(`-${Math.floor(reducedBase)} TURRET FIRE!`, 600);
          }

          chestSystem.update(playerPos);
          pickupSystem.setPlayerPosition(playerPos);
          bioSystem.setPlayerPosition(playerPos);
          mountainRing.setPlayerPosition(playerPos);
          propSystem.setPlayerPosition(playerPos);
          alienFoliage.setPlayerPosition(playerPos);
          earthFoliage.setPlayerPosition(playerPos);

          // === ATV contact damage ===
          // While the player is driving the ATV, treat fast vehicle contact
          // with enemies as a "ramming" attack scaled to current speed.
          const activeVehicle = vehicleSystem.getActive();
          if (activeVehicle && activeVehicle.kind === "atv") {
            const speed = Math.abs(activeVehicle.speed);
            // Below ~6 m/s we don't want gentle nudges to deal damage
            if (speed > 6) {
              const cooldownMap = atvHitCooldownRef.current;
              const nowMs = now;
              // Per-enemy cooldown so a single brush doesn't shred everyone
              const enemyCooldownMs = 350;
              // Ram damage scales linearly with speed; capped both ways
              const ramDamage = Math.min(140, Math.max(35, speed * 4.0));
              const vpos = activeVehicle.position;

              for (const enemy of enemySystem.getActiveEnemies()) {
                const epos = enemy.mesh.position;
                const dx = epos.x - vpos.x;
                const dz = epos.z - vpos.z;
                const distSq = dx * dx + dz * dz;
                // ATV ram radius ~2.6 m
                if (distSq > 2.6 * 2.6) continue;

                const enemyId = enemy.mesh.uniqueId;
                const last = cooldownMap.get(enemyId) || 0;
                if (nowMs - last < enemyCooldownMs) continue;
                cooldownMap.set(enemyId, nowMs);

                // Categorize toughness — small bots die in 1-2 hits, larger
                // ones take chip damage and stagger the ATV.
                const isSmall = enemy.type === "drone" || enemy.type === "soldier" || enemy.type === "insectoid";
                const isLarge = enemy.type === "heavy" || enemy.type === "commander" || enemy.type === "hybrid";

                let dmg = ramDamage;
                if (isSmall) {
                  dmg = Math.max(80, ramDamage * 1.5);
                } else if (isLarge) {
                  dmg = Math.min(60, ramDamage * 0.5);
                  // Stagger the ATV — bleed off speed sharply on heavy contact
                  activeVehicle.speed *= 0.45;
                }

                const hitPoint = new BABYLON.Vector3(
                  (vpos.x + epos.x) * 0.5,
                  Math.max(vpos.y, epos.y) + 0.6,
                  (vpos.z + epos.z) * 0.5,
                );
                // takeDamage handles its own death/loot via ENEMY_KILLED bus event
                enemy.takeDamage({
                  amount: dmg,
                  damageType: DamageType.Collision,
                  hitPoint,
                  attacker: activeVehicle,
                  knockbackForce: 600 + speed * 20,
                });

                // === Ram impact feedback (gated by per-target cooldown above) ===
                // Spark/dust burst at the contact point. Bigger, redder, longer
                // for heavies; small yellow pop for light bots.
                const impactScale = isLarge ? 1.8 : isSmall ? 0.9 : 1.2;
                const impactColor = isLarge
                  ? new BABYLON.Color3(1.0, 0.45, 0.25) // orange-red
                  : new BABYLON.Color3(1.0, 0.85, 0.3); // yellow-orange
                bus.emit("effect:hitImpact", { position: hitPoint, color: impactColor, scale: impactScale });

                // Camera shake — scales with damage / target weight, capped
                const shakeAmp = Math.min(0.65, 0.12 + speed * 0.012 + (isLarge ? 0.18 : 0));
                const shakeDur = isLarge ? 0.32 : 0.18;
                bus.emit("effect:cameraShake", { intensity: shakeAmp, duration: shakeDur });

                // Metallic crunch sound — lower pitch for big targets, higher
                // for small bots so players can feel the difference.
                const enemyPitch = isLarge ? 0.7 : isSmall ? 1.15 : 0.9;
                const enemyVol = Math.min(1.0, 0.55 + speed * 0.015);
                bus.emit("sound:play", { url: "/sounds/hit.mp3", volume: enemyVol, playbackRate: enemyPitch });
              }

              // Garbage-collect cooldown entries older than 5 s
              if (cooldownMap.size > 64) {
                cooldownMap.forEach((t, k) => {
                  if (nowMs - t > 5000) cooldownMap.delete(k);
                });
              }

              // ATV vs. props — ram destroys crates/barrels/canisters
              for (const propMesh of propSystem.getHitboxMeshes()) {
                const wpos = propMesh.getAbsolutePosition();
                const dx = wpos.x - vpos.x;
                const dz = wpos.z - vpos.z;
                const distSq = dx * dx + dz * dz;
                if (distSq > 2.6 * 2.6) continue;
                const propKey = -propMesh.uniqueId; // negative to avoid clash with enemy ids
                const last = cooldownMap.get(propKey) || 0;
                if (nowMs - last < enemyCooldownMs) continue;
                cooldownMap.set(propKey, nowMs);
                const meta = propMesh.metadata;
                if (!isPropMeta(meta)) continue;
                const propHitPoint = wpos.clone();
                propHitPoint.y += 0.5;
                meta.damageable.takeDamage({
                  amount: Math.max(60, ramDamage),
                  damageType: DamageType.Collision,
                  hitPoint: propHitPoint,
                });

                // === Prop ram impact feedback ===
                // Lighter, dustier burst than enemy hits — tan/grey palette
                bus.emit("effect:hitImpact", {
                  position: propHitPoint,
                  color: new BABYLON.Color3(0.85, 0.78, 0.55),
                  scale: 1.0,
                });
                bus.emit("effect:cameraShake", {
                  intensity: Math.min(0.45, 0.08 + speed * 0.01),
                  duration: 0.14,
                });
                // Higher pitch than enemies — wood/metal "clatter" feel
                bus.emit("sound:play", {
                  url: "/sounds/hit.mp3",
                  volume: Math.min(0.9, 0.45 + speed * 0.012),
                  playbackRate: 1.4,
                });
              }
            }
          }

          capsuleSystem.update(dt, playerPos);
          shopSystem.update();
          buildingSystem.update(dt);
          effects.update(dt);
          explosions.update(dt);
          sky.update(dt);
          multiplayer.update(dt);

          mapThrottleTimer += dt;
          if (mapThrottleTimer >= 0.2) {
            mapThrottleTimer = 0;
            mapSystem.updatePlayerPosition(playerPos);
            const mapEnemyMeshes = enemySystem.getEnemyMeshes();
            mapSystem.updateEnemies(mapEnemyMeshes.map(m => m.position));
            // Bases + supply caches are UI snapshots, not gameplay inputs, so
            // refreshing them at 5 Hz keeps the minimap responsive without
            // rebuilding canvas markers every render frame.
            mapSystem.setEnemyBases(enemyBaseSystem.getBasePositions());
            mapSystem.setSupplyCaches(propSystem.getOpenContainers());
            mapSystem.setBossFortresses(enemyBaseSystem.getBossFortresses());
            mapSystem.draw();
          }

          hudThrottleTimer += dt;
          if (hudThrottleTimer >= 0.1) {
            hudThrottleTimer = 0;
            setRemotePlayerCount(multiplayer.getRemotePlayerCount());
            setStats(player.getStats());
            setPlayerUpgradeInfo(player.getPlayerUpgradeInfo());
            if (elementalSpecialsRef.current) {
              setElementalUpgradeInfo(elementalSpecialsRef.current.getUpgradeInfo(player.getCredits()));
            }
            setInVehicle(mounted);
            setEnemyCount(enemySystem.getEnemyCount());
            setChestCount(chestSystem.getChestCount());
            setJetpackFuel(player.getJetpackFuel());
            setMaxJetpackFuel(player.getMaxJetpackFuel());
            setPlayerState(player.getPlayerState());
            setBeamSabreActive(beamSabre.active);
            setBeamSabreLevel(beamSabre.getLevel);
            setActiveElement(armorSystem.getActiveElement());
            setArmorDefense(armorSystem.getTotalDefense());
            setIsFlying(player.getIsFlying());
            setArmorEnergy(player.getArmorEnergy());
            setMaxArmorEnergy(player.getMaxArmorEnergy());
            setHasFlightArmor(player.getHasFlightArmor());
            setBuildMode(buildingSystem.isBuildMode());
            const sel = buildingSystem.getSelectedBlockType();
            setSelectedBlock(sel);
            const defs = buildingSystem.getBlockDefinitions();
            setSelectedBlockDef(sel ? defs[sel] ?? null : null);
            setPlanMode(prefabSystem.isPlanMode());
            setSelectedPrefabIndex(prefabSystem.getSelectedIndex());
          }

          inventoryThrottleTimer += dt;
          if (inventoryThrottleTimer >= 0.5) {
            inventoryThrottleTimer = 0;
            setCompanionCount(companionSystem.getCompanionCount());
            setCompanionInfo(companionSystem.getCompanions());
            const gears = inventory.getItemCount("gear");
            const cores = inventory.getItemCount("energy_core");
            setResourceCounts({
              gears,
              scrap: inventory.getItemCount("scrap_metal"),
              cores,
              circuits: inventory.getItemCount("circuit_board"),
              nanofiber: inventory.getItemCount("nano_fiber"),
              bioEssence: inventory.getItemCount("bio_essence"),
            });
            setPartCounts({
              pistol: inventory.getItemCount("weapon_part_pistol"),
              rifle: inventory.getItemCount("weapon_part_rifle"),
              shotgun: inventory.getItemCount("weapon_part_shotgun"),
              rocket: inventory.getItemCount("weapon_part_rocket"),
              laser: inventory.getItemCount("weapon_part_laser"),
              grenade: inventory.getItemCount("weapon_part_grenade"),
            });
            setWeaponUpgradeInfo(weapons.getAllUpgradeInfo());
            setCompanionUpgradeInfo(companionSystem.getAllUpgradeInfo(() => gears, () => cores));
            // Helper-bot weapon-tier rows must follow companion roster + resource changes.
            const cwRows = companionSystem.getCompanions()
              .map(c => companionSystem.getWeaponUpgradeInfo(c.id, () => gears, () => cores))
              .filter((r): r is NonNullable<typeof r> => !!r);
            setCompanionWeaponInfo(cwRows);
            setCapturedCreatures(bioSystem.getCaptured());
            setDexCaughtIds(bioSystem.getDexCaughtIds());
            const petBondBoosts = bioSystem.getPetBondBonuses();
            setPetBondSummary(petBondBoosts.summary);
            player.setPetBondBoosts(petBondBoosts);
            weapons.setPlayerBoosts(player.getPlayerBoosts());
          }

          if (player.getHealth() <= 0 && !deathHandledRef.current) {
            deathHandledRef.current = true;
            setGamePhase("gameover");
            // Pause music so the menu/game-over screen isn't drowned in track audio.
            try { MusicSystem.pause(); } catch {}
          }

          waveTimer += deltaTime;
          if (waveTimer >= 60000) {
            waveTimer = 0;
            enemySystem.nextWave();
            setWaveNumber(enemySystem.getWaveNumber());
            showMessage(`WAVE ${enemySystem.getWaveNumber()} INCOMING!`, 3000);
          }
        });

        canvasRef.current.onclick = () => {
          canvasRef.current?.requestPointerLock();
        };

        // ====================================================================
        // VERSUS MODE OVERRIDE
        // --------------------------------------------------------------------
        // PvP-only home-screen game mode. Triggered when handleStart was
        // called with `{ mode: "versus" }`. Hides the open-world city and
        // enemy systems and mounts the compact `VersusArena` in their place,
        // then auto-creates / -joins the multiplayer room the lobby picked.
        //
        // We intentionally let everything spawn first (city, enemies, bases,
        // foliage, mountains) and *then* hide / disable them rather than
        // gating each constructor on `versus` — the open-world systems have
        // dozens of cross-references and skipping any one tends to cause a
        // null-deref deep in the render loop. Hiding meshes + flipping
        // spawn flags is cheap and keeps every invariant intact.
        // ====================================================================
        if (versusModeRef.current.active) {
          // 1. Hide the entire open-world city, foliage, mountains, bases,
          //    mining nodes, NPCs, chests, and ambient flying fortresses.
          try { cityGenerator.setVisible(false); } catch {}
          try { mountainRing.setVisible(false); } catch {}
          try { alienFoliage.setVisible(false); } catch {}
          try { earthFoliage.setVisible(false); } catch {}
          // Stop all enemy spawning + clear anything already spawned.
          try {
            enemySystem.setSpawningEnabled(false);
            enemySystem.clearAllEnemies();
          } catch {}
          try {
            // setSpawningEnabled(false) is the HARD gate — without it the
            // drip-spawn loop in AerialEnemySystem.update() re-creates the
            // patrolling fortresses every few seconds, so the arena would
            // slowly fill with flying fortresses again after disengage.
            aerialEnemySystem.setSpawningEnabled(false);
            aerialEnemySystem.disengageAndClear();
          } catch {}
          // Hostile EnemyBaseSystem turrets keep updating + dealing damage
          // even with no enemies spawned — dispose it entirely so a versus
          // arena fight isn't randomly chipped by stray laser fire.
          try {
            if (enemyBaseRef.current) {
              enemyBaseRef.current.dispose();
              enemyBaseRef.current = null;
            }
          } catch {}

          // 2. Build the compact PvP arena and swap in its colliders /
          //    floor platforms so the player physically interacts with it.
          const arena = new VersusArena(scene);
          versusArenaRef.current = arena;
          player.setBuildingColliders(arena.getWallColliders());
          player.setFloorPlatforms(arena.getFloorPlatforms());

          // 3. Teleport the player to a spawn point inside the arena.
          //    Slot picked from the multiplayer player id so simultaneous
          //    joins are unlikely to collide. Falls back to random.
          const myId = multiplayer.getPlayerId() ?? "";
          const hashStr = (s: string): number => {
            let h = 0;
            for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
            return h;
          };
          const slot = myId ? Math.abs(hashStr(myId)) % 16 : Math.floor(Math.random() * 16);
          const spawn = arena.getSpawnPoint(slot);
          player.setPosition(new BABYLON.Vector3(spawn.x, spawn.y, spawn.z));

          // 4. Auto-create (host) or auto-join (joiner) the multiplayer
          //    room. This is the SINGLE site that performs the room op for
          //    versus mode — the lobby intentionally never touched the
          //    server, which avoids a race where a lobby socket closing
          //    on `room_created` would cause the server to delete the
          //    empty room before this gameplay socket re-joined it.
          const vm = versusModeRef.current;
          const enterRoom = () => {
            if (vm.isHost) multiplayer.createRoom("versus");
            else if (vm.roomCode) multiplayer.joinRoom(vm.roomCode);
          };
          // For authenticated players the campaign-auth connect ran at
          // init time. It may still be mid-handshake — wait for `connected`
          // either way. For Guests no connect ran, so do it now.
          //   - MultiplayerSystem.connect() is idempotent (guards against
          //     double WS), so calling it here is safe even if someone
          //     already started the handshake.
          if (multiplayer.isConnected()) {
            enterRoom();
          } else {
            multiplayer.on("connected", () => enterRoom());
            const guestName = currentUser?.username ?? `Guest${Math.floor(Math.random() * 9000) + 1000}`;
            const guestId = currentUser?.id ?? Math.floor(Math.random() * 1_000_000);
            try { multiplayer.connect(guestName, guestId); } catch {}
          }

          showMessage("VERSUS — PVP ARENA", 2400);
        }

        initializingRef.current = false;
      } catch (error) {
        console.error("Failed to initialize game:", error);
        if (engineRef.current) {
          try { engineRef.current.dispose(); } catch {}
          engineRef.current = null;
        }
        playerRef.current = null;
        if (weaponsRef.current) { try { weaponsRef.current.dispose(); } catch {} }
        weaponsRef.current = null;
        if (enemyHealthBarsRef.current) { try { enemyHealthBarsRef.current.dispose(); } catch {} }
        enemyHealthBarsRef.current = null;
        // Side-zone systems (sanctuary, lab, space, lair) and the
        // listener-owning friendly NPCs / rescue / multiplayer trees all
        // hold EventBus subscriptions + scene refs. Without explicit
        // dispose here they'd leak listeners across a failed-init retry.
        if (sanctuarySystemRef.current) { try { sanctuarySystemRef.current.dispose(); } catch {} sanctuarySystemRef.current = null; }
        if (pontiacLabSystemRef.current) { try { pontiacLabSystemRef.current.dispose(); } catch {} pontiacLabSystemRef.current = null; }
        if (spaceLevelSystemRef.current) { try { spaceLevelSystemRef.current.dispose(); } catch {} spaceLevelSystemRef.current = null; }
        if (swarmsLairSystemRef.current) { try { swarmsLairSystemRef.current.dispose(); } catch {} swarmsLairSystemRef.current = null; }
        if (saginawLabSystemRef.current) { try { saginawLabSystemRef.current.dispose(); } catch {} saginawLabSystemRef.current = null; }
        if (zugIslandSystemRef.current) { try { zugIslandSystemRef.current.dispose(); } catch {} zugIslandSystemRef.current = null; }
        if (annArborSystemRef.current) { try { annArborSystemRef.current.dispose(); } catch {} annArborSystemRef.current = null; }
        if (michiganTerrainSystemRef.current) { try { michiganTerrainSystemRef.current.dispose(); } catch {} michiganTerrainSystemRef.current = null; }
        if (friendlyNPCsRef.current) { try { friendlyNPCsRef.current.dispose(); } catch {} friendlyNPCsRef.current = null; }
        if (rescueSystemRef.current) { try { rescueSystemRef.current.dispose(); } catch {} rescueSystemRef.current = null; }
        if (multiplayerRef.current) { try { multiplayerRef.current.dispose(); } catch {} }
        if (gamepadRef.current) { try { gamepadRef.current.dispose(); } catch {} }
        gamepadRef.current = null;
        enemySystemRef.current = null;
        if (aerialEnemyRef.current) { try { aerialEnemyRef.current.dispose(); } catch {} }
        aerialEnemyRef.current = null;
        if (smashAttackRef.current) { try { smashAttackRef.current.dispose(); } catch {} }
        smashAttackRef.current = null;
        chestSystemRef.current = null;
        combatSystemRef.current = null;
        specialWeaponsRef.current = null;
        if (elementalSpecialsRef.current) { try { elementalSpecialsRef.current.dispose(); } catch {} }
        elementalSpecialsRef.current = null;
        beamSabreRef.current = null;
        if (meleeArsenalRef.current) { try { meleeArsenalRef.current.dispose(); } catch {} meleeArsenalRef.current = null; }
        if (megaCannonRef.current) { try { megaCannonRef.current.dispose(); } catch {} megaCannonRef.current = null; }
        armorSystemRef.current = null;
        craftingSystemRef.current = null;
        inventoryRef.current = null;
        companionRef.current = null;
        capsuleRef.current = null;
        shopRef.current = null;
        gardenRef.current = null;
        mapRef.current = null;
        if (buildingRef.current) { try { buildingRef.current.dispose(); } catch {} }
        buildingRef.current = null;
        if (prefabRef.current) { try { prefabRef.current.dispose(); } catch {} }
        prefabRef.current = null;
        if (pickupRef.current) { try { pickupRef.current.dispose(); } catch {} }
        pickupRef.current = null;
        if (propSystemRef.current) { try { propSystemRef.current.dispose(); } catch {} }
        propSystemRef.current = null;
        atvHitCooldownRef.current.clear();
        if (bioRef.current) { try { bioRef.current.dispose(); } catch {} }
        bioRef.current = null;
        if (mountainRingRef.current) { try { mountainRingRef.current.dispose(); } catch {} }
        mountainRingRef.current = null;
        if (alienFoliageRef.current) { try { alienFoliageRef.current.dispose(); } catch {} }
        alienFoliageRef.current = null;
        if (earthFoliageRef.current) { try { earthFoliageRef.current.dispose(); } catch {} }
        earthFoliageRef.current = null;
        if (miningRef.current) { try { miningRef.current.dispose(); } catch {} }
        miningRef.current = null;
        if (enemyBaseRef.current) { try { enemyBaseRef.current.dispose(); } catch {} }
        enemyBaseRef.current = null;
        if (levelSystemRef.current) { try { levelSystemRef.current.dispose(); } catch {} levelSystemRef.current = null; }
        if (autosaveTimerRef.current !== null) { window.clearInterval(autosaveTimerRef.current); autosaveTimerRef.current = null; }
        if (respawnTimeoutRef.current !== null) { window.clearTimeout(respawnTimeoutRef.current); respawnTimeoutRef.current = null; }
        // Match handleRestart — these systems also need explicit dispose so
        // their EventBus subscriptions / scene refs don't leak between
        // failed-init retries.
        if (effectsRef.current) { try { effectsRef.current.dispose(); } catch {} effectsRef.current = null; }
        if (explosionsRef.current) { try { explosionsRef.current.dispose(); } catch {} explosionsRef.current = null; }
        if (propAudioRef.current) { try { propAudioRef.current.dispose(); } catch {} propAudioRef.current = null; }
        if (soundRef.current) { try { soundRef.current.dispose(); } catch {} soundRef.current = null; }
        if (vehicleRef.current) { try { vehicleRef.current.dispose(); } catch {} vehicleRef.current = null; }
        if (skyRef.current) { try { skyRef.current.dispose(); } catch {} skyRef.current = null; }
        if (baseRef.current) { try { baseRef.current.dispose(); } catch {} baseRef.current = null; }
        if (versusArenaRef.current) { try { versusArenaRef.current.dispose(); } catch {} versusArenaRef.current = null; }
        versusModeRef.current = { active: false, roomCode: null, isHost: false };
        multiplayerRef.current = null;
        // Drop closures captured by the failed-init scope (force-save +
        // legendary-grant both bind disposed systems) and clear the bus
        // so a retry doesn't fan stale listeners onto fresh systems.
        forceSaveRef.current = null;
        tryGrantLegendaryCompanionRef.current = null;
        EventBus.getInstance().clear();
        initializingRef.current = false;
        const errorMsg = error instanceof Error ? error.message : String(error);
        setMessage(`CRITICAL ERROR: ${errorMsg}`);
        setGamePhase("menu");
      }
    }, 150);
  }, [handleLootCollected, showMessage, currentUser]);

  const handleStart = useCallback((payload: StartPayload = { mode: "campaign" }) => {
    versusModeRef.current = {
      active: payload.mode === "versus",
      roomCode: payload.versus?.roomCode ?? null,
      isHost: payload.versus?.isHost ?? false,
    };
    void MusicSystem.init().then(() => MusicSystem.startGameMusic());
    initializeGame();
  }, [initializeGame]);

  /**
   * GHOST RIDE THE WHIP. While mounted in a vehicle AND boosting (turbo
   * window OR Shift held), pressing B (or controller B / KeyE) ejects
   * the player in a sideways somersault while the unmanned vehicle
   * keeps barreling forward at locked speed. The vehicle detonates on
   * impact with any enemy, aerial unit, base structure, or wall — or
   * after a ~6 s fuse if it never hits anything. The actual collision
   * scan + AoE damage live inside VehicleSystem; this callback just
   * triggers the eject + plays the player-side bail animation.
   */
  const tryGhostRide = useCallback(() => {
    if (!vehicleRef.current || !playerRef.current) return;
    const result = vehicleRef.current.startGhostRide();
    if (!result) {
      // Mounted but not boosting — give the player a hint instead of
      // silently swallowing the keypress so they learn the gate.
      if (vehicleRef.current.getActive()) {
        showMessage("BOOST FIRST TO GHOST RIDE", 1200);
      }
      return;
    }
    // Pop the player off the vehicle's transform BEFORE applying the
    // somersault so PlayerController.updatePhysics() takes over again.
    // setMounted(null) restores visibility on the humanoid mesh.
    playerRef.current.setMounted(null);
    // Plant the player one body-width above the vehicle so the dive-out
    // doesn't intersect the now-moving mesh. The eject velocity itself
    // carries them sideways and up; this is just the spawn pose.
    const v = result.vehicle;
    const dropPos = v.position.add(new BABYLON.Vector3(0, 2.0, 0));
    playerRef.current.setPosition(dropPos);
    playerRef.current.triggerSomersaultEject(result.ejectVelocity);
    showMessage("GHOST RIDE THE WHIP!", 1500);
  }, [showMessage]);

  const handleRespawnVehicles = useCallback(() => {
    if (!playerRef.current || !vehicleRef.current) return;
    const pos = playerRef.current.getPosition();
    const offsetA = new BABYLON.Vector3(pos.x - 6, 0.6, pos.z - 4);
    const offsetB = new BABYLON.Vector3(pos.x + 6, 1.2, pos.z - 4);
    const a = vehicleRef.current.respawnVehicle("atv", "RaiderATV", offsetA);
    const b = vehicleRef.current.respawnVehicle("spaceFighter", "CometFighter", offsetB);
    if (a || b) showMessage("VEHICLES RESPAWNED", 1500);
    else showMessage("CANNOT RESPAWN — DISMOUNT FIRST", 1800);
  }, [showMessage]);

  const handleRestart = useCallback(() => {
    // Restart in-game music — it was paused on death by the gameover guard.
    try { void MusicSystem.init().then(() => MusicSystem.startGameMusic()); } catch {}
    // CRITICAL: dispose player FIRST to remove window keydown/keyup listeners.
    // Without this, the stale PlayerController keeps responding to input
    // against disposed Babylon meshes, causing the post-restart freeze.
    if (playerRef.current) { try { playerRef.current.dispose(); } catch {} playerRef.current = null; }
    if (weaponsRef.current) { try { weaponsRef.current.dispose(); } catch {} weaponsRef.current = null; }
    if (combatSystemRef.current) { try { combatSystemRef.current.dispose(); } catch {} combatSystemRef.current = null; }
    if (specialWeaponsRef.current) { try { specialWeaponsRef.current.dispose(); } catch {} specialWeaponsRef.current = null; }
    if (elementalSpecialsRef.current) { try { elementalSpecialsRef.current.dispose(); } catch {} elementalSpecialsRef.current = null; }
    if (beamSabreRef.current) { try { beamSabreRef.current.dispose(); } catch {} beamSabreRef.current = null; }
    if (meleeArsenalRef.current) { try { meleeArsenalRef.current.dispose(); } catch {} meleeArsenalRef.current = null; }
    if (megaCannonRef.current) { try { megaCannonRef.current.dispose(); } catch {} megaCannonRef.current = null; }
    if (companionRef.current) { try { companionRef.current.dispose(); } catch {} companionRef.current = null; }
    if (capsuleRef.current) { try { capsuleRef.current.dispose(); } catch {} capsuleRef.current = null; }
    if (shopRef.current) { try { shopRef.current.dispose(); } catch {} shopRef.current = null; }
    if (gardenRef.current) { try { gardenRef.current.dispose(); } catch {} gardenRef.current = null; }
    if (mapRef.current) { try { mapRef.current.dispose(); } catch {} mapRef.current = null; }
    if (buildingRef.current) { try { buildingRef.current.dispose(); } catch {} buildingRef.current = null; }
    if (prefabRef.current) { try { prefabRef.current.dispose(); } catch {} prefabRef.current = null; }
    if (pickupRef.current) { try { pickupRef.current.dispose(); } catch {} pickupRef.current = null; }
    if (propSystemRef.current) { try { propSystemRef.current.dispose(); } catch {} propSystemRef.current = null; }
    if (bioRef.current) { try { bioRef.current.dispose(); } catch {} bioRef.current = null; }
    if (mountainRingRef.current) { try { mountainRingRef.current.dispose(); } catch {} mountainRingRef.current = null; }
    if (alienFoliageRef.current) { try { alienFoliageRef.current.dispose(); } catch {} alienFoliageRef.current = null; }
    if (earthFoliageRef.current) { try { earthFoliageRef.current.dispose(); } catch {} earthFoliageRef.current = null; }
    if (miningRef.current) { try { miningRef.current.dispose(); } catch {} miningRef.current = null; }
    if (enemyBaseRef.current) { try { enemyBaseRef.current.dispose(); } catch {} enemyBaseRef.current = null; }
    if (levelSystemRef.current) { try { levelSystemRef.current.dispose(); } catch {} levelSystemRef.current = null; }
    if (enemyHealthBarsRef.current) { try { enemyHealthBarsRef.current.dispose(); } catch {} enemyHealthBarsRef.current = null; }
    if (friendlyNPCsRef.current) { try { friendlyNPCsRef.current.dispose(); } catch {} friendlyNPCsRef.current = null; }
    if (rescueSystemRef.current) { try { rescueSystemRef.current.dispose(); } catch {} rescueSystemRef.current = null; }
    if (sanctuarySystemRef.current) { try { sanctuarySystemRef.current.dispose(); } catch {} sanctuarySystemRef.current = null; }
    if (pontiacLabSystemRef.current) { try { pontiacLabSystemRef.current.dispose(); } catch {} pontiacLabSystemRef.current = null; }
    if (spaceLevelSystemRef.current) { try { spaceLevelSystemRef.current.dispose(); } catch {} spaceLevelSystemRef.current = null; }
    if (swarmsLairSystemRef.current) { try { swarmsLairSystemRef.current.dispose(); } catch {} swarmsLairSystemRef.current = null; }
    if (saginawLabSystemRef.current) { try { saginawLabSystemRef.current.dispose(); } catch {} saginawLabSystemRef.current = null; }
    if (zugIslandSystemRef.current) { try { zugIslandSystemRef.current.dispose(); } catch {} zugIslandSystemRef.current = null; }
    if (annArborSystemRef.current) { try { annArborSystemRef.current.dispose(); } catch {} annArborSystemRef.current = null; }
    if (michiganTerrainSystemRef.current) { try { michiganTerrainSystemRef.current.dispose(); } catch {} michiganTerrainSystemRef.current = null; }
    if (gamepadRef.current) { try { gamepadRef.current.dispose(); } catch {} gamepadRef.current = null; }
    if (aerialEnemyRef.current) { try { aerialEnemyRef.current.dispose(); } catch {} aerialEnemyRef.current = null; }
    if (smashAttackRef.current) { try { smashAttackRef.current.dispose(); } catch {} smashAttackRef.current = null; }
    // CRITICAL: these systems also subscribe to EventBus / hold scene state.
    // Skipping their dispose was the root cause of the multi-restart freeze:
    // every restart left a fresh listener stack on the bus, so each event
    // fanned out to N stale handlers that walked dead meshes.
    if (effectsRef.current) { try { effectsRef.current.dispose(); } catch {} effectsRef.current = null; }
    if (explosionsRef.current) { try { explosionsRef.current.dispose(); } catch {} explosionsRef.current = null; }
    if (propAudioRef.current) { try { propAudioRef.current.dispose(); } catch {} propAudioRef.current = null; }
    if (soundRef.current) { try { soundRef.current.dispose(); } catch {} soundRef.current = null; }
    if (vehicleRef.current) { try { vehicleRef.current.dispose(); } catch {} vehicleRef.current = null; }
    if (skyRef.current) { try { skyRef.current.dispose(); } catch {} skyRef.current = null; }
    if (baseRef.current) { try { baseRef.current.dispose(); } catch {} baseRef.current = null; }
    if (versusArenaRef.current) { try { versusArenaRef.current.dispose(); } catch {} versusArenaRef.current = null; }
    versusModeRef.current = { active: false, roomCode: null, isHost: false };
    enemySystemRef.current = null;
    chestSystemRef.current = null;
    armorSystemRef.current = null;
    craftingSystemRef.current = null;
    inventoryRef.current = null;
    atvHitCooldownRef.current.clear();
    if (autosaveTimerRef.current !== null) { window.clearInterval(autosaveTimerRef.current); autosaveTimerRef.current = null; }
    if (respawnTimeoutRef.current !== null) { window.clearTimeout(respawnTimeoutRef.current); respawnTimeoutRef.current = null; }
    if (multiplayerRef.current) { try { multiplayerRef.current.dispose(); } catch {} multiplayerRef.current = null; }
    if (engineRef.current) {
      try { engineRef.current.dispose(); } catch {}
      engineRef.current = null;
    }
    // Drop the previous run's force-save closure — it captures disposed
    // systems and would crash if a late handler fired during reinit.
    // Also drop the legendary-grant closure (same reason: it captures
    // companionSystem + player from the disposed run).
    forceSaveRef.current = null;
    tryGrantLegendaryCompanionRef.current = null;
    initializingRef.current = false;
    EventBus.getInstance().clear();
    setStats({
      health: 250, maxHealth: 250, armor: 100, maxArmor: 100,
      shield: 75, maxShield: 75, shieldRegenRate: 30, shieldRegenDelay: 1.2,
      stamina: 100, maxStamina: 100, credits: 0, experience: 0, level: 1,
    });
    setPlayerUpgradeInfo([]);
    setInVehicle(false);
    setWaveNumber(1);
    setComboInfo(null);
    setSpecialWeaponInfo([]);
    setElementalSpecialsInfo([]);
    setBeamSabreActive(true);
    setBeamSabreLevel(1);
    setActiveElement(null);
    setArmorDefense(0);
    setCompanionCount(0);
    setCompanionInfo([]);
    setIsFlying(false);
    setArmorEnergy(0);
    setHasFlightArmor(false);
    setCapsuleOpen(false);
    setCapsuleUpgrades([]);
    setShopOpen(false);
    setActiveShop(null);
    setBuildMode(false);
    setMultiplayerConnected(false);
    setInRoom(false);
    setRoomCode(null);
    initializeGame();
  }, [initializeGame]);

  const handleCapsuleUpgrade = useCallback((upgradeId: string) => {
    const capsule = capsuleRef.current;
    const player = playerRef.current;
    if (!capsule || !player) return;
    const result = capsule.applyUpgrade(upgradeId, player.getStats().credits);
    if (result.success && result.upgrade) {
      player.addCredits(-result.upgrade.cost);
      // Force an immediate save so a crash or rage-quit between buy
      // and the next 30s autosave can never lose a 5000-credit
      // purchase like the Quantum Exo-Suit.
      forceSaveRef.current?.();
    }
    showMessage(result.message, 2000);
  }, [showMessage]);

  const handleShopBuy = useCallback((key: string) => {
    const shop = shopRef.current;
    if (!shop) return;
    const [shopId, indexStr] = key.split(":");
    shop.buyItem(shopId, parseInt(indexStr, 10));
  }, []);

  const handleCreateRoom = useCallback(() => {
    multiplayerRef.current?.createRoom();
  }, []);

  const handleJoinRoom = useCallback((code: string) => {
    multiplayerRef.current?.joinRoom(code);
  }, []);

  const handleLeaveRoom = useCallback(() => {
    multiplayerRef.current?.leaveRoom();
  }, []);

  const handleRefreshRooms = useCallback(() => {
    multiplayerRef.current?.listRooms();
  }, []);

  const handleSendChat = useCallback((msg: string) => {
    multiplayerRef.current?.sendChat(msg);
  }, []);

  const handleToggleLobby = useCallback(() => {
    setShowLobby((prev) => {
      if (!prev) multiplayerRef.current?.listRooms();
      return !prev;
    });
  }, []);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    if (multiplayerRef.current) multiplayerRef.current.dispose();
    setMultiplayerConnected(false);
    setInRoom(false);
    setRoomCode(null);
    setGamePhase("auth");
  }, []);

  const labBlueprints = useMemo<LabBlueprint[]>(() => [
    { id: "scout", presetName: "ScoutPrime", displayName: "Scout Prime", type: "ally", description: "Fast recon ally", cost: { gears: 12, scrap: 8, cores: 1, circuits: 1 }, unlockTier: 1 },
    { id: "brute", presetName: "BruteForge", displayName: "Brute Forge", type: "ally", description: "Heavy melee bruiser", cost: { gears: 18, scrap: 14, cores: 2, circuits: 1 }, unlockTier: 1 },
    { id: "medic", presetName: "MedicDrone", displayName: "Medic Drone", type: "ally", description: "Healing companion", cost: { gears: 16, scrap: 6, cores: 2, circuits: 2 }, unlockTier: 1 },
    { id: "spark", presetName: "SparkPup", displayName: "Spark Pup", type: "pet", description: "Loyal energy pet", cost: { gears: 10, scrap: 4, cores: 1, circuits: 1 }, unlockTier: 1 },
    { id: "jet", presetName: "JetWarden", displayName: "Jet Warden", type: "ally", description: "Aerial guardian", cost: { gears: 24, scrap: 16, cores: 3, circuits: 2 }, unlockTier: 2 },
    { id: "tank", presetName: "TankTitan", displayName: "Tank Titan", type: "ally", description: "Walking fortress", cost: { gears: 30, scrap: 24, cores: 4, circuits: 2 }, unlockTier: 2 },
    { id: "guardian", presetName: "GuardianUnit", displayName: "Guardian Unit", type: "ally", description: "Defensive specialist", cost: { gears: 22, scrap: 18, cores: 3, circuits: 3 }, unlockTier: 2 },
    { id: "optimus", presetName: "OptimusForge", displayName: "Optimus Forge", type: "ally", description: "Elite leader", cost: { gears: 40, scrap: 28, cores: 6, circuits: 4 }, unlockTier: 3 },
    { id: "apex", presetName: "HybridApex", displayName: "Hybrid Apex", type: "ally", description: "Apex hybrid unit", cost: { gears: 50, scrap: 32, cores: 8, circuits: 5 }, unlockTier: 3 },
    { id: "mega", presetName: "MegaUnitX", displayName: "Mega Unit X", type: "ally", description: "Boss-class robot", cost: { gears: 60, scrap: 40, cores: 10, circuits: 6 }, unlockTier: 3 },
  ], []);

  const syncResourcesNow = useCallback(() => {
    const inv = inventoryRef.current;
    const weapons = weaponsRef.current;
    const comp = companionRef.current;
    const bio = bioRef.current;
    if (!inv) return;
    const gears = inv.getItemCount("gear");
    const cores = inv.getItemCount("energy_core");
    setResourceCounts({
      gears,
      scrap: inv.getItemCount("scrap_metal"),
      cores,
      circuits: inv.getItemCount("circuit_board"),
      nanofiber: inv.getItemCount("nano_fiber"),
      bioEssence: inv.getItemCount("bio_essence"),
    });
    setPartCounts({
      pistol: inv.getItemCount("weapon_part_pistol"),
      rifle: inv.getItemCount("weapon_part_rifle"),
      shotgun: inv.getItemCount("weapon_part_shotgun"),
      rocket: inv.getItemCount("weapon_part_rocket"),
      laser: inv.getItemCount("weapon_part_laser"),
      grenade: inv.getItemCount("weapon_part_grenade"),
    });
    if (weapons) setWeaponUpgradeInfo(weapons.getAllUpgradeInfo());
    if (comp) {
      setCompanionUpgradeInfo(comp.getAllUpgradeInfo(() => gears, () => cores));
      // Helper-bot weapon-tier rows: one per active companion.
      const all = comp.getCompanions();
      const rows = all
        .map(c => comp.getWeaponUpgradeInfo(c.id, () => gears, () => cores))
        .filter((r): r is NonNullable<typeof r> => !!r);
      setCompanionWeaponInfo(rows);
    }
    if (bio) {
      setCapturedCreatures(bio.getCaptured());
      setDexCaughtIds(bio.getDexCaughtIds());
      const petBondBoosts = bio.getPetBondBonuses();
      setPetBondSummary(petBondBoosts.summary);
      const player = playerRef.current;
      if (player && weapons) {
        player.setPetBondBoosts(petBondBoosts);
        weapons.setPlayerBoosts(player.getPlayerBoosts());
      }
    }
  }, []);

  const handleUpgradeWeapon = useCallback((type: string) => {
    if (!weaponsRef.current) return;
    const ok = weaponsRef.current.upgradeWeapon(type as any);
    if (ok) showMessage(`UPGRADED ${type.toUpperCase()}`, 1500);
    else showMessage("UPGRADE FAILED — INSUFFICIENT RESOURCES", 1500);
    syncResourcesNow();
  }, [showMessage, syncResourcesNow]);

  // Mount a Power Jewel onto a ranged weapon. Consumes one of the matching
  // jewel from the inventory; if a different tier was already mounted it's
  // returned to the inventory before the new one is consumed. Force-saves
  // so the (rare!) jewel can't be lost to the next death.
  const handleMountJewel = useCallback((type: string, tier: JewelTier) => {
    if (!jewelRef.current) return;
    const ok = jewelRef.current.mount(type as any, tier);
    if (ok) {
      const def = JEWEL_DEFS[tier];
      showMessage(`MOUNTED ${def.shortName} JEWEL ON ${type.toUpperCase()} (+${Math.round(def.bonusMul * 100)}% DMG)`, 2000);
      forceSaveRef.current?.();
    } else {
      showMessage("CAN'T MOUNT JEWEL", 1500);
    }
    syncResourcesNow();
  }, [showMessage, syncResourcesNow]);

  // Pop the mounted jewel back into the inventory. Fails silently if the
  // inventory is full — the jewel stays mounted rather than being deleted.
  const handleUnmountJewel = useCallback((type: string) => {
    if (!jewelRef.current) return;
    const ok = jewelRef.current.unmount(type as any);
    if (ok) {
      showMessage(`UNMOUNTED JEWEL FROM ${type.toUpperCase()}`, 1500);
      forceSaveRef.current?.();
    } else {
      showMessage("INVENTORY FULL — CAN'T UNMOUNT", 1500);
    }
    syncResourcesNow();
  }, [showMessage, syncResourcesNow]);

  const handleUpgradePlayer = useCallback((id: string) => {
    if (!playerRef.current) return;
    const ok = playerRef.current.upgradePlayerStat(id);
    if (ok) showMessage(`UPGRADED ${id.toUpperCase()}`, 1500);
    else showMessage("UPGRADE FAILED — INSUFFICIENT CREDITS", 1500);
  }, [showMessage]);

  const handleUpgradeElemental = useCallback((kind: string) => {
    const player = playerRef.current;
    const elemental = elementalSpecialsRef.current;
    if (!player || !elemental) return;
    const cost = elemental.getUpgradeCost(kind as ElementalKind);
    if (cost <= 0) {
      showMessage("ELEMENT MAXED OR INVALID", 1200);
      return;
    }
    if (!player.spendCredits(cost)) {
      showMessage("UPGRADE FAILED — INSUFFICIENT CREDITS", 1500);
      return;
    }
    const ok = elemental.upgrade(kind as ElementalKind);
    if (!ok) {
      // Refund if the underlying upgrade refused (race / max).
      player.addCredits(cost);
      return;
    }
    showMessage(`${kind.toUpperCase()} EMPOWERED`, 1500);
    // Reuse PLAYER_UPGRADED so existing save listener picks it up.
    EventBus.getInstance().emit(GameEvents.PLAYER_UPGRADED, { id: `elemental:${kind}` });
  }, [showMessage]);

  const handleUpgradeCompanion = useCallback((id: string) => {
    if (!companionRef.current || !inventoryRef.current) return;
    const inv = inventoryRef.current;
    const ok = companionRef.current.upgradeCompanion(id, (g, c) => {
      if (inv.getItemCount("gear") < g || inv.getItemCount("energy_core") < c) return false;
      if (g > 0) inv.removeItem("gear", g);
      if (c > 0) inv.removeItem("energy_core", c);
      return true;
    });
    if (ok) {
      showMessage("ROBOT UPGRADED", 1500);
      // Force-save the new helper level immediately so it can't be lost to the
      // next death.
      forceSaveRef.current?.();
    } else showMessage("ROBOT UPGRADE FAILED", 1500);
    syncResourcesNow();
  }, [showMessage, syncResourcesNow]);

  const handleUpgradeCompanionWeapon = useCallback((id: string) => {
    if (!companionRef.current || !inventoryRef.current) return;
    const inv = inventoryRef.current;
    const ok = companionRef.current.upgradeCompanionWeapon(id, (g, c) => {
      if (inv.getItemCount("gear") < g || inv.getItemCount("energy_core") < c) return false;
      if (g > 0) inv.removeItem("gear", g);
      if (c > 0) inv.removeItem("energy_core", c);
      return true;
    });
    if (ok) {
      showMessage("HELPER WEAPON UPGRADED", 1500);
      // Force-save the new helper-weapon tier immediately. The base
      // upgradeCompanionWeapon path doesn't emit COMPANION_UPGRADED, so the
      // event-driven save trigger doesn't catch this one.
      forceSaveRef.current?.();
    } else showMessage("HELPER WEAPON UPGRADE FAILED", 1500);
    syncResourcesNow();
  }, [showMessage, syncResourcesNow]);

  // One-time SPECIALS unlocks. Cost source is SPECIALS_DEFS so affordability
  // and charging stay in lockstep. Side-effects are validated *before* charging
  // so a missing system never silently consumes resources.
  const handleUnlockSpecial = useCallback((id: string) => {
    const inv = inventoryRef.current;
    const player = playerRef.current;
    if (!inv || !player) return;
    if (specialsOwned[id as SpecialId]) return;
    // Synchronous in-flight guard. The React `specialsOwned` check above is
    // async-stale between rapid clicks, so a fast double-tap could pass it
    // twice and double-charge. The ref flips immediately and resets after
    // setSpecialsOwned schedules its update, blocking re-entry within the
    // same tick.
    if (specialsUnlockInFlightRef.current.has(id)) return;
    specialsUnlockInFlightRef.current.add(id);
    // Single exit point so EVERY early-return path (insufficient
    // resources, missing system, parse failure, runEffect failure)
    // releases the in-flight guard. Without this, a single failed
    // purchase attempt would soft-lock the SPECIAL for the rest of
    // the session — a soft-lock the architect review flagged HIGH.
    let committed = false;
    try {
    const def = SPECIALS_DEFS.find(d => d.id === id);
    if (!def) return;
    const c = def.cost;
    // Resource gate.
    if (inv.getItemCount("gear") < c.gears
        || inv.getItemCount("energy_core") < c.cores
        || inv.getItemCount("nano_fiber") < c.nanofiber
        || (c.circuits != null && inv.getItemCount("circuit_board") < c.circuits)) {
      showMessage("INSUFFICIENT RESOURCES", 1500);
      return;
    }
    // Credits live on player.stats (combat/shop currency), matching the UI.
    if (c.credits != null && player.getStats().credits < c.credits) {
      showMessage("INSUFFICIENT CREDITS", 1500);
      return;
    }
    // Pre-validate side-effect targets so we never charge for a no-op.
    let runEffect: (() => boolean) | null = null;
    if (id === "sabreSpin" || id === "sabreTwin" || id === "sabreGiant" || id === "sabreGold") {
      const sabre = beamSabreRef.current;
      if (!sabre) { showMessage("SABRE OFFLINE", 1500); return; }
      runEffect = () => {
        if (id === "sabreSpin")  { sabre.unlockSpinAttack();  showMessage("SPINNING BLADE UNLOCKED", 2000); }
        if (id === "sabreTwin")  { sabre.unlockTwinWave();    showMessage("TWIN WAVE UNLOCKED",       2000); }
        if (id === "sabreGiant") { sabre.unlockGiantBlade();  showMessage("GIANT BLADE UNLOCKED",     2000); }
        if (id === "sabreGold")  { sabre.unlockGoldSabre();   showMessage("GOLD SABRE UNLOCKED — TRIPLE WAVE", 2400); }
        return true;
      };
    } else if (id === "autoLoot") {
      const pickup = pickupRef.current;
      if (!pickup) { showMessage("PICKUP SYSTEM OFFLINE", 1500); return; }
      runEffect = () => { pickup.setAutoLootEnabled(true); showMessage("AUTO-LOOT ENGAGED", 2000); return true; };
    } else if (id === "autoTarget") {
      const weapons = weaponsRef.current;
      if (!weapons) { showMessage("WEAPONS OFFLINE", 1500); return; }
      runEffect = () => { weapons.setAutoTargetEnabled(true); showMessage("AUTO-TARGET MODULE ONLINE", 2200); return true; };
    } else if (id === "supermanFlight") {
      // Pure player-controller flag flip; no other system needs to be
      // online for the unlock to take effect, so the only failure mode
      // is the player ref itself which we already checked above.
      runEffect = () => { player.unlockSupermanFlight(); showMessage("SUPERMAN FLIGHT UNLOCKED — DASH+JUMP IN AIR", 2400); return true; };
    } else if (
      id === "glaiveOwn"   || id === "glaiveCombo"   || id === "glaiveSpecial"   ||
      id === "daggersOwn"  || id === "daggersCombo"  || id === "daggersSpecial"  ||
      id === "axeOwn"      || id === "axeCombo"      || id === "axeSpecial"      ||
      id === "whipOwn"     || id === "whipCombo"     || id === "whipSpecial"
    ) {
      // Melee Arsenal unlocks — map the 12 SPECIALS-tab ids onto the
      // arsenal's own / combo / special tiers per weapon. The COMBO and
      // SPECIAL tiers also imply OWN (the arsenal idempotently sets the
      // owned flag inside unlockCombo / unlockSpecial), so the player
      // can buy any tier in any order without the weapon getting stuck
      // in a half-unlocked state.
      const arsenal = meleeArsenalRef.current;
      if (!arsenal) { showMessage("ARSENAL OFFLINE", 1500); return; }
      const parse = (sid: string): { weapon: ArsenalWeaponId; tier: "own" | "combo" | "special" } | null => {
        for (const w of ["glaive", "daggers", "axe", "whip"] as ArsenalWeaponId[]) {
          if (sid === `${w}Own`) return { weapon: w, tier: "own" };
          if (sid === `${w}Combo`) return { weapon: w, tier: "combo" };
          if (sid === `${w}Special`) return { weapon: w, tier: "special" };
        }
        return null;
      };
      const parsed = parse(id);
      if (!parsed) return;
      runEffect = () => {
        const cfg = SPECIALS_DEFS.find(d => d.id === id);
        const niceName = cfg?.name ?? id;
        if (parsed.tier === "own")     arsenal.unlockWeapon(parsed.weapon);
        if (parsed.tier === "combo")   arsenal.unlockCombo(parsed.weapon);
        if (parsed.tier === "special") arsenal.unlockSpecial(parsed.weapon);
        showMessage(`${niceName.toUpperCase()} UNLOCKED`, 2200);
        return true;
      };
    } else if (id === "roboDragon") {
      const comp = companionRef.current;
      if (!comp) { showMessage("HELPER SYSTEM OFFLINE", 1500); return; }
      runEffect = () => {
        // The dragon is a premium SPECIALS unlock and must always summon —
        // it cannot be blocked by the Lab cap or by the player having a full
        // helper roster. Bump the max up to (current count + 1) at minimum
        // so the addCompanion call below can never fail on capacity. We use
        // Math.max with the existing max so we never SHRINK the cap (the
        // previous version did, which silently broke the buy whenever the
        // Lab cap was lower than the live roster count).
        const needed = comp.getCompanionCount() + 1;
        if (comp.getMaxCompanions() < needed) comp.setMaxCompanions(needed);
        const ok = comp.addCompanion("RoboDragon", player.getPosition(), { allowDuplicate: true });
        if (!ok) { showMessage("DRAGON SUMMON FAILED", 2000); return false; }
        showMessage("ROBOT DRAGON DESCENDS", 2400);
        return true;
      };
    }
    if (!runEffect || !runEffect()) return;
    // Charge only after the side-effect succeeds.
    if (c.gears > 0)     inv.removeItem("gear", c.gears);
    if (c.cores > 0)     inv.removeItem("energy_core", c.cores);
    if (c.nanofiber > 0) inv.removeItem("nano_fiber", c.nanofiber);
    if (c.circuits)      inv.removeItem("circuit_board", c.circuits);
    if (c.credits)       player.spendCredits(c.credits);
    setSpecialsOwned(prev => ({ ...prev, [id]: true }));
    // Mark the purchase committed so the finally below KEEPS the in-flight
    // flag set — `specialsOwned[id]` will be true on the next render, so
    // the guard above will hold. Clearing it here would let a rapid re-buy
    // slip through during the React commit gap.
    committed = true;
    syncResourcesNow();
    // Force a save immediately so the unlock can never be lost to a crash or
    // the death/restart cycle that prompted this whole fix.
    forceSaveRef.current?.();
    } finally {
      // Only release the in-flight guard if the purchase didn't commit,
      // so EVERY early-return path (insufficient resources, missing
      // system, parse failure, runEffect false, etc.) lets the player
      // retry the SPECIAL on a later click.
      if (!committed) specialsUnlockInFlightRef.current.delete(id);
    }
  }, [specialsOwned, showMessage, syncResourcesNow]);

  const handleLabBuild = useCallback((presetName: string) => {
    if (!companionRef.current || !playerRef.current || !inventoryRef.current || !baseRef.current) return;
    const bp = labBlueprints.find(b => b.presetName === presetName);
    if (!bp) return;
    const cap = baseRef.current.getLabCompanionCap();
    if (companionRef.current.getCompanionCount() >= cap) {
      showMessage("LAB AT CAPACITY — UPGRADE LAB", 1800);
      return;
    }
    const inv = inventoryRef.current;
    if (inv.getItemCount("gear") < bp.cost.gears || inv.getItemCount("scrap_metal") < bp.cost.scrap ||
        inv.getItemCount("energy_core") < bp.cost.cores || inv.getItemCount("circuit_board") < bp.cost.circuits) {
      showMessage("INSUFFICIENT RESOURCES", 1500);
      return;
    }
    inv.removeItem("gear", bp.cost.gears);
    inv.removeItem("scrap_metal", bp.cost.scrap);
    inv.removeItem("energy_core", bp.cost.cores);
    inv.removeItem("circuit_board", bp.cost.circuits);
    const pos = playerRef.current.getPosition();
    const ok = companionRef.current.addCompanion(presetName, pos, { allowDuplicate: true });
    if (ok) {
      showMessage(`BUILT ${bp.displayName.toUpperCase()}`, 1800);
      EventBus.getInstance().emit("effect:sparkle", { position: pos });
    } else {
      showMessage("BUILD FAILED", 1500);
    }
    syncResourcesNow();
  }, [labBlueprints, showMessage, syncResourcesNow]);

  const handleLabUpgrade = useCallback(() => {
    if (!baseRef.current) return;
    const lab = baseRef.current.getStructures().find(s => s.kind === "lab");
    if (!lab) return;
    const ok = baseRef.current.upgradeStructure(lab.id);
    if (ok) {
      showMessage(`LAB UPGRADED → LVL ${lab.level}`, 1800);
      if (companionRef.current) companionRef.current.setMaxCompanions(Math.max(3, baseRef.current.getLabCompanionCap()));
    } else {
      showMessage("LAB UPGRADE FAILED", 1500);
    }
    syncResourcesNow();
  }, [showMessage, syncResourcesNow]);

  const handleGardenUpgrade = useCallback(() => {
    if (!baseRef.current) return;
    const g = baseRef.current.getStructures().find(s => s.kind === "garden");
    if (!g) return;
    const ok = baseRef.current.upgradeStructure(g.id);
    if (ok) showMessage(`GARDEN UPGRADED → LVL ${g.level}`, 1800);
    else showMessage("GARDEN UPGRADE FAILED", 1500);
    syncResourcesNow();
  }, [showMessage, syncResourcesNow]);

  const handleGardenDeploy = useCallback((id: string) => {
    if (!bioRef.current || !companionRef.current || !playerRef.current || !baseRef.current) return;
    const cap = baseRef.current.getLabCompanionCap();
    if (companionRef.current.getCompanionCount() >= cap) {
      showMessage("ROSTER FULL — UPGRADE LAB FIRST", 1800);
      return;
    }
    const captured = bioRef.current.getCaptured().find(c => c.id === id);
    if (!captured) return;
    const presetMap: Record<string, string> = {
      robofox: "ScoutCompanion",
      crystalbeetle: "TankTitan",
      hoverserpent: "JetWarden",
      neonowl: "InsectoidStalker",
      voltfrog: "SparkPup",
    };
    const preset = presetMap[captured.speciesId] || "ScoutCompanion";
    const ok = companionRef.current.addCompanion(preset, playerRef.current.getPosition(), { allowDuplicate: true });
    if (ok) {
      showMessage(`DEPLOYED ${captured.name.toUpperCase()}`, 1800);
      bioRef.current.removeCaptured(id);
      syncResourcesNow();
      forceSaveRef.current?.();
    } else {
      showMessage("DEPLOY FAILED", 1500);
    }
  }, [showMessage, syncResourcesNow]);

  const handleGardenCare = useCallback((id: string) => {
    const bio = bioRef.current;
    if (!bio) return;
    const result = bio.careForCaptured(id);
    showMessage(result.message.toUpperCase(), result.ok ? 1500 : 1800);
    syncResourcesNow();
    if (result.ok) forceSaveRef.current?.();
  }, [showMessage, syncResourcesNow]);

  useEffect(() => {
    if (gamePhase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Tab") {
        e.preventDefault();
        setUpgradeMenuOpen(v => !v);
        if (labOpen) setLabOpen(false);
        if (gardenOpen) setGardenOpen(false);
        if (document.pointerLockElement) document.exitPointerLock();
      } else if (e.code === "KeyH") {
        if (bioRef.current) {
          const ok = bioRef.current.attemptCaptureNearest();
          if (!ok) showMessage("NO CREATURE IN RANGE", 1200);
        }
      } else if (e.code === "BracketLeft") {
        MusicSystem.prev();
      } else if (e.code === "BracketRight") {
        MusicSystem.next();
      } else if (e.code === "Backslash") {
        MusicSystem.togglePlay();
      } else if (e.code === "KeyE") {
        if (!playerRef.current) return;
        const pos = playerRef.current.getPosition();
        // Priority: ghost-ride (controller B mid-boost) > exit vehicle
        // > enter vehicle > base structures. We deliberately gate the
        // ghost-ride branch on `!e.isTrusted` so ONLY the synthetic
        // KeyE dispatched by GamepadInput (Xbox B → KeyE) hijacks
        // the exit. Real keyboard E always falls through to the
        // normal exit path even while boosting, since keyboard players
        // already have a dedicated KeyB binding for the ghost ride.
        if (
          !e.isTrusted &&
          vehicleRef.current?.getActive() &&
          vehicleRef.current.isBoosting()
        ) {
          tryGhostRide();
          return;
        }
        if (vehicleRef.current?.getActive()) {
          const v = vehicleRef.current.exit();
          if (v) {
            playerRef.current.setMounted(null);
            const dropPos = v.position.add(new BABYLON.Vector3(2.5, 1, 0));
            playerRef.current.setPosition(dropPos);
            showMessage(`EXITED ${v.descriptor.name.toUpperCase()}`, 1500);
          }
          return;
        }
        const nearVehicle = vehicleRef.current?.getNearest(pos, 5.5) ?? null;
        if (nearVehicle) {
          vehicleRef.current?.enter(nearVehicle);
          playerRef.current.setMounted(nearVehicle.meshes.root);
          showMessage(`ENTERED ${nearVehicle.descriptor.name.toUpperCase()}`, 1500);
          return;
        }
        if (!baseRef.current) return;
        const lab = baseRef.current.getNearestStructure(pos, "lab", 6);
        const garden = baseRef.current.getNearestStructure(pos, "garden", 6);
        if (lab) {
          setLabStructure(lab);
          setLabOpen(true);
          if (document.pointerLockElement) document.exitPointerLock();
        } else if (garden) {
          setGardenStructure(garden);
          setGardenOpen(true);
          if (document.pointerLockElement) document.exitPointerLock();
        }
      } else if (e.code === "KeyB") {
        // Context-sensitive:
        //   in vehicle → GHOST RIDE THE WHIP (only fires while boosting)
        //   on foot    → cycle equipped melee weapon
        // Keeping both bindings on KeyB is safe because they're
        // mutually exclusive: meleeArsenal.cycle is meaningless while
        // mounted (the player can't swing), and ghost-ride's gate
        // (isBoosting) refuses the trigger on foot.
        if (!e.repeat) {
          if (vehicleRef.current?.getActive()) {
            tryGhostRide();
          } else if (meleeArsenalRef.current) {
            const name = meleeArsenalRef.current.cycle(1);
            showMessage(`MELEE: ${name.toUpperCase()}`, 1200);
          }
        }
      } else if (e.code === "KeyN") {
        // Fire the active arsenal weapon's signature special. No-op if the
        // sabre is equipped or the active weapon's special tier is not yet
        // unlocked. Keeps the Beam Sabre's own combo keys (`;` / `'`)
        // untouched — those still drive Fury Slash / Smash Lash.
        if (!e.repeat && meleeArsenalRef.current?.isEquipped()) {
          const fired = meleeArsenalRef.current.fireSpecial();
          if (!fired) showMessage("SPECIAL ON COOLDOWN", 1000);
        }
      } else if (e.code === "KeyY" || e.code === "KeyJ") {
        // The Beam Sabre is always active. Y (keyboard) and J (controller LT)
        // both trigger a slash. KeyB cycles the equipped MELEE weapon (sabre /
        // glaive / daggers / axe / whip); KeyG stays reserved for build mode.
        // startCharge only matters once the Spinning Blade upgrade is owned —
        // otherwise it just calls attack() like before.
        if (!e.repeat) {
          const now = performance.now();
          beamPressTimeRef.current = now;
          beamHeldRef.current = true;
          // Combo: if the weapon attack was pressed (or is held) within the
          // combo window, trigger the Mega Beam Cannon. The lone slash + shot
          // still fire alongside it; the cannon adds on top.
          const COMBO_WINDOW_MS = 220;
          if (megaCannonRef.current && (weaponHeldRef.current || now - weaponPressTimeRef.current < COMBO_WINDOW_MS)) {
            megaCannonRef.current.fire();
          }
          // Melee Arsenal intercept — when an alt melee weapon is equipped,
          // the slash key fires THAT weapon's primary attack instead of the
          // sabre's, and we skip startCharge entirely so the sabre charge
          // bar can't accidentally interfere with the alt swing.
          if (meleeArsenalRef.current?.isEquipped()) {
            meleeArsenalRef.current.attack();
          } else if (beamSabreRef.current) {
            beamSabreRef.current.startCharge();
          }
          // Smash combo: KeyJ held + Space held + airborne for 1 s. The
          // sabre still owns the key on its own — the smash only fires
          // when Space is also held, so dogfighting in the air with
          // sabre slashes stays untouched.
          smashAttackRef.current?.notifyAttackDown();
        }
      } else if (e.code === "Space") {
        // Track Space for the smash combo. We don't preventDefault here
        // because PlayerController owns the actual jump impulse via its
        // own keydown listener — we're just mirroring the held state.
        if (!e.repeat) {
          smashAttackRef.current?.notifyJumpDown();
          // Jump-press turbo. While mounted in any vehicle, a Space tap
          // delivers a punchy speed kick (with a built-in cooldown so the
          // player can't just hold for permanent overdrive). Doesn't
          // suppress the existing Space→up vertical-thrust mapping for
          // fighters — both effects layer cleanly.
          if (vehicleRef.current?.getActive()) {
            const fired = vehicleRef.current.triggerTurbo();
            if (fired) showMessage("TURBO!", 700);
          }
        }
      } else if (e.code === "Semicolon") {
        // Fury Slash — LT + Y combo (gamepad) or `;` (keyboard).
        // Note: these combo keys are intentionally rare codes — KeyU/KeyI
        // are taken by elemental hotkeys (Inferno / Ice).
        if (!e.repeat && beamSabreRef.current) {
          beamSabreRef.current.performFurySlash();
        }
      } else if (e.code === "Quote") {
        // Smash Lash — LT + X combo (gamepad) or `'` (keyboard).
        if (!e.repeat && beamSabreRef.current) {
          beamSabreRef.current.performSmashLash();
        }
      } else if (e.code === "KeyK") {
        // Cast the currently-selected elemental special (controller RB).
        if (elementalSpecialsRef.current) {
          elementalSpecialsRef.current.castCurrent();
        }
      } else if (e.code === "KeyO") {
        // Cycle currently-selected elemental UP (D-pad up).
        if (elementalSpecialsRef.current) {
          elementalSpecialsRef.current.cycleCurrent(-1);
        }
      } else if (e.code === "Period") {
        // Cycle currently-selected elemental DOWN (D-pad down).
        if (elementalSpecialsRef.current) {
          elementalSpecialsRef.current.cycleCurrent(1);
        }
      } else if (e.code === "Comma") {
        // Cycle equipped weapon LEFT (D-pad left).
        if (weaponsRef.current) {
          weaponsRef.current.cycleWeapon(-1);
        }
      } else if (e.code === "Slash") {
        // Cycle equipped weapon RIGHT (D-pad right).
        if (weaponsRef.current) {
          weaponsRef.current.cycleWeapon(1);
        }
      } else if (e.code === "Escape") {
        if (upgradeMenuOpen) setUpgradeMenuOpen(false);
        if (labOpen) setLabOpen(false);
        if (gardenOpen) setGardenOpen(false);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "KeyY" || e.code === "KeyJ") {
        beamHeldRef.current = false;
        // The beam-sabre release is essential for air combat (Spinning
        // Blade), so it always fires alongside the smash combo's
        // attack-key tracking — the two systems are independent. When an
        // alt melee weapon is equipped, the sabre's release-charge path
        // is skipped (the alt weapon's primary fired on key-down and
        // doesn't use a charge model).
        if (beamSabreRef.current && !meleeArsenalRef.current?.isEquipped()) {
          beamSabreRef.current.releaseCharge();
        }
        smashAttackRef.current?.notifyAttackUp();
      } else if (e.code === "Space") {
        smashAttackRef.current?.notifyJumpUp();
      }
    };
    // Mouse left button drives the Mega Beam Cannon combo too: pressing it
    // while the beam button is held (or freshly pressed) fires the cannon.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const now = performance.now();
      weaponPressTimeRef.current = now;
      weaponHeldRef.current = true;
      const COMBO_WINDOW_MS = 220;
      if (megaCannonRef.current && (beamHeldRef.current || now - beamPressTimeRef.current < COMBO_WINDOW_MS)) {
        megaCannonRef.current.fire();
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) weaponHeldRef.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [gamePhase, upgradeMenuOpen, labOpen, gardenOpen, showMessage]);

  // Keep modal-open refs in sync with their React state so non-React systems
  // (e.g. FriendlyNPCSystem) can poll the live values without re-binding.
  useEffect(() => { upgradeMenuOpenRef.current = upgradeMenuOpen; }, [upgradeMenuOpen]);
  useEffect(() => { shopOpenRef.current = shopOpen; }, [shopOpen]);
  useEffect(() => { labOpenRef.current = labOpen; }, [labOpen]);
  useEffect(() => { gardenOpenRef.current = gardenOpen; }, [gardenOpen]);

  useEffect(() => {
    if (gamePhase !== "playing") return;
    const codeToInput: Record<string, keyof import("./VehicleSystem").VehicleInputState> = {
      KeyW: "forward",
      KeyS: "back",
      KeyA: "left",
      KeyD: "right",
      Space: "up",
      ControlLeft: "down",
      ShiftLeft: "boost",
    };
    const setKey = (code: string, down: boolean) => {
      const k = codeToInput[code];
      if (!k) return;
      // We always FORWARD keyup events even when no vehicle is active
      // so a Shift release that happens after a ghost-ride / dismount
      // can clear the latched `input.boost` flag — otherwise the next
      // mount inherits a stuck boost state and is immediately eligible
      // for a tap-B ghost ride from a standstill. Keydown is still
      // gated to avoid accumulating phantom inputs while on foot.
      if (down && !vehicleRef.current?.getActive()) return;
      vehicleRef.current?.setInput({ [k]: down } as any);
    };
    const onDown = (e: KeyboardEvent) => setKey(e.code, true);
    const onUp = (e: KeyboardEvent) => setKey(e.code, false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [gamePhase]);

  const labLevel = labStructure ? (baseRef.current?.getStructures().find(s => s.id === labStructure.id)?.level ?? labStructure.level) : 0;
  const labRawCost = labStructure ? baseRef.current?.getUpgradeCost(labStructure.id) ?? null : null;
  const labUpgradeCost = labRawCost ? { gears: labRawCost.gears, cores: labRawCost.energyCores, circuits: labRawCost.scrap } : null;
  const labCanUpgrade = !!labRawCost && !!baseRef.current?.canAfford(labRawCost);

  const gardenLevel = gardenStructure ? (baseRef.current?.getStructures().find(s => s.id === gardenStructure.id)?.level ?? gardenStructure.level) : 0;
  const gardenRawCost = gardenStructure ? baseRef.current?.getUpgradeCost(gardenStructure.id) ?? null : null;
  const gardenUpgradeCost = gardenRawCost ? { gears: gardenRawCost.gears, nano: gardenRawCost.scrap, cores: gardenRawCost.energyCores } : null;
  const gardenCanUpgrade = !!gardenRawCost && !!baseRef.current?.canAfford(gardenRawCost);

  useEffect(() => {
    return () => {
      if (vehicleRef.current?.getActive() && playerRef.current) {
        vehicleRef.current.exit();
        playerRef.current.setMounted(null);
      }
      if (playerRef.current) playerRef.current.dispose();
      if (weaponsRef.current) weaponsRef.current.dispose();
      if (combatSystemRef.current) combatSystemRef.current.dispose();
      if (specialWeaponsRef.current) specialWeaponsRef.current.dispose();
      if (elementalSpecialsRef.current) elementalSpecialsRef.current.dispose();
      if (beamSabreRef.current) beamSabreRef.current.dispose();
      if (meleeArsenalRef.current) meleeArsenalRef.current.dispose();
      if (megaCannonRef.current) megaCannonRef.current.dispose();
      if (companionRef.current) companionRef.current.dispose();
      if (capsuleRef.current) capsuleRef.current.dispose();
      if (shopRef.current) shopRef.current.dispose();
      if (gardenRef.current) gardenRef.current.dispose();
      if (mapRef.current) mapRef.current.dispose();
      if (buildingRef.current) buildingRef.current.dispose();
      if (prefabRef.current) prefabRef.current.dispose();
      if (pickupRef.current) pickupRef.current.dispose();
      if (bioRef.current) bioRef.current.dispose();
      if (mountainRingRef.current) { try { mountainRingRef.current.dispose(); } catch {} mountainRingRef.current = null; }
      if (alienFoliageRef.current) { try { alienFoliageRef.current.dispose(); } catch {} alienFoliageRef.current = null; }
      if (earthFoliageRef.current) { try { earthFoliageRef.current.dispose(); } catch {} earthFoliageRef.current = null; }
      if (vehicleRef.current) vehicleRef.current.dispose();
      if (propSystemRef.current) propSystemRef.current.dispose();
      atvHitCooldownRef.current.clear();
      if (baseRef.current) baseRef.current.dispose();
      if (miningRef.current) miningRef.current.dispose();
      if (enemyBaseRef.current) enemyBaseRef.current.dispose();
      if (levelSystemRef.current) { try { levelSystemRef.current.dispose(); } catch {} levelSystemRef.current = null; }
      if (autosaveTimerRef.current !== null) window.clearInterval(autosaveTimerRef.current);
      if (respawnTimeoutRef.current !== null) window.clearTimeout(respawnTimeoutRef.current);
      if (effectsRef.current) effectsRef.current.dispose();
      if (explosionsRef.current) explosionsRef.current.dispose();
      if (propAudioRef.current) propAudioRef.current.dispose();
      if (soundRef.current) soundRef.current.dispose();
      if (skyRef.current) skyRef.current.dispose();
      if (enemyHealthBarsRef.current) enemyHealthBarsRef.current.dispose();
      if (friendlyNPCsRef.current) friendlyNPCsRef.current.dispose();
      if (rescueSystemRef.current) { try { rescueSystemRef.current.dispose(); } catch {} rescueSystemRef.current = null; }
      if (sanctuarySystemRef.current) { try { sanctuarySystemRef.current.dispose(); } catch {} sanctuarySystemRef.current = null; }
      if (pontiacLabSystemRef.current) { try { pontiacLabSystemRef.current.dispose(); } catch {} pontiacLabSystemRef.current = null; }
      if (spaceLevelSystemRef.current) { try { spaceLevelSystemRef.current.dispose(); } catch {} spaceLevelSystemRef.current = null; }
      if (swarmsLairSystemRef.current) { try { swarmsLairSystemRef.current.dispose(); } catch {} swarmsLairSystemRef.current = null; }
      if (saginawLabSystemRef.current) { try { saginawLabSystemRef.current.dispose(); } catch {} saginawLabSystemRef.current = null; }
      if (zugIslandSystemRef.current) { try { zugIslandSystemRef.current.dispose(); } catch {} zugIslandSystemRef.current = null; }
      if (annArborSystemRef.current) { try { annArborSystemRef.current.dispose(); } catch {} annArborSystemRef.current = null; }
      if (michiganTerrainSystemRef.current) { try { michiganTerrainSystemRef.current.dispose(); } catch {} michiganTerrainSystemRef.current = null; }
      if (aerialEnemyRef.current) aerialEnemyRef.current.dispose();
      if (smashAttackRef.current) { try { smashAttackRef.current.dispose(); } catch {} smashAttackRef.current = null; }
      if (gamepadRef.current) gamepadRef.current.dispose();
      if (multiplayerRef.current) multiplayerRef.current.dispose();
      if (engineRef.current) engineRef.current.dispose();
      MusicSystem.pause();
      EventBus.getInstance().clear();
    };
  }, []);

  // ---- Fast travel + travel destinations ----------------------------------
  // Players warp between Detroit's three combat fronts and the Ashur Sanctuary
  // from the new TRAVEL tab on the upgrade menu. Warping calls
  // `LevelSystem.forceStart` which re-fires `LEVEL_STARTED` — that handler
  // applies sky tint, mounts/dismantles the sanctuary, and clears boss-spawn
  // gates. We then teleport the player to the level's `spawnPoint`.
  const handleFastTravel = useCallback((level: number, warpPoint?: TravelWarpPoint) => {
    const ls = levelSystemRef.current;
    const player = playerRef.current;
    if (!ls || !player) return;
    if (level < 1 || level > 11) return;
    if (ls.getCurrentLevel() === 4 && level >= 1 && level <= 3) {
      showMessage("ASHUR SANCTUARY DOES NOT OPEN DIRECTLY TO DETROIT", 2200);
      return;
    }
    const sp = LevelSystem.getSpawnPointFor(level as WorldLevel);
    const targetX = warpPoint?.x ?? sp.x;
    const targetZ = warpPoint?.z ?? sp.z;
    // Spacelike levels need a high spawn Y so the player wakes up amid the
    // 25–105 m asteroid band (the orbital fighter is auto-entered there);
    // ground levels (including the indoor Swarms Lair) keep the slight 2 m
    // nudge above terrain so they don't fall through if they don't have
    // flight armor.
    const miHeight = LevelSystem.isMichiganTerrain(level as WorldLevel)
      ? michiganTerrainSystemRef.current?.getHeightAt(targetX, targetZ)
      : null;
    const spawnY = LevelSystem.isSpacelike(level as WorldLevel)
      ? 60
      : LevelSystem.isMichiganTerrain(level as WorldLevel)
      ? (warpPoint?.y ?? ((miHeight ?? MichiganTerrainSystem.getDefaultSpawnY()) + 3))
      : 2;
    // CRITICAL ORDER: teleport BEFORE forceStart. `forceStart` synchronously
    // emits LEVEL_STARTED, which mounts SpaceLevelSystem; that system reads
    // `playerPosProvider()` immediately to spawn/auto-mount the orbital
    // fighter, build the asteroid field, and seed nearby aerial enemies.
    // If we forceStart first, all of those things spawn at the player's
    // *previous* world position, then we teleport away and the level reads
    // empty.
    player.teleportTo(new BABYLON.Vector3(targetX, spawnY, targetZ));
    ls.forceStart(level as WorldLevel);
    if (LevelSystem.isMichiganTerrain(level as WorldLevel)) {
      requestAnimationFrame(() => {
        const p = playerRef.current;
        const mi = michiganTerrainSystemRef.current;
        if (!p || !mi) return;
        const h = mi.getHeightAt(targetX, targetZ);
        if (h == null) return;
        const cur = p.getPosition();
        p.teleportTo(new BABYLON.Vector3(targetX, Math.max(cur.y, h + 3), targetZ));
      });
    }
    setUpgradeMenuOpen(false);
    showMessage(`WARPED TO ${warpPoint ? "MI WILDS WARP POINT" : LevelSystem.getDisplayNameFor(level as WorldLevel)}`, 2200);
  }, [showMessage]);

  // Bridge handleFastTravel into a ref so EventBus listeners wired
  // inside the engine init closure (e.g. LAB_CAVE_ENTERED → warp to L7)
  // can call the React-scope callback without re-binding on every event.
  useEffect(() => {
    handleFastTravelRef.current = handleFastTravel;
    return () => { handleFastTravelRef.current = null; };
  }, [handleFastTravel]);

  // Travel-tab rows — derived from LevelSystem so adding a level later only
  // requires extending LEVEL_DEFS. Ashur intentionally avoids direct city
  // routes so the sanctuary keeps its protected, out-of-the-way feel.
  const travelDestinations = useMemo(() => {
    const levelRows = LevelSystem.getAllLevels().map((lvl) => {
      const blocksDetroitFromAshur = currentWorldLevel === 4 && lvl >= 1 && lvl <= 3;
      return {
        level: lvl,
        name: LevelSystem.getDisplayNameFor(lvl),
        description: lvl === 4
        ? "Peaceful side-zone. Rehab rescued Animatons, farm bio-crops, help the Village of Earth."
        : lvl === 5
        ? "Orbital Front — starfield combat. Asteroids, evil ships, drone-orbited motherships."
        : lvl === 6
        ? "Pontiac Secret Lab — Dr. You's covert pre-war research wing. Cryo subjects, holo terminals, lore."
        : lvl === 7
        ? "Swarms Lair — underground cave arena. Insectoid swarms guard General Voidcrown."
        : lvl === 8
        ? "Saginaw Underwater Lab — flooded endgame arena. Captains only, plus spider-tank missile mid-bosses."
        : lvl === 9
        ? "Zug Island — Legion stronghold. Endless waves of titans, captains, and spider tanks. Hardest zone in the game."
        : lvl === 10
        ? "Ann Arbor Apocalypse — mothership crash site with maxed captains and a full ground swarm."
        : lvl === 11
        ? "Michigan Wilds — MIHEIGHTMAP terrain with flooded lowlands, grass foothills, and rocky peaks."
        : lvl === 1
        ? "Star City Front — first-stage Detroit defense. Rescue the captured ally."
        : lvl === 2
        ? "Hold the Line — captains have invaded. Take the second fortress."
        : "Purge the Void — the final command tower.",
        locked: blocksDetroitFromAshur,
        lockReason: blocksDetroitFromAshur
          ? "Ashur keeps Detroit gates closed. Travel through the wilds or another outpost."
          : undefined,
      };
    });
    const miWarpRows = MichiganTerrainSystem.getWarpPoints().map((wp) => ({
      id: `mi-${wp.id}`,
      level: 11,
      name: `MI WILDS - ${wp.name}`,
      description: `${wp.kind.toUpperCase()} WARP - ${wp.description}`,
      warpPoint: { x: wp.x, z: wp.z } satisfies TravelWarpPoint,
    }));
    return [...levelRows, ...miWarpRows];
  }, [currentWorldLevel]);

  // Per-weapon Power-Jewel rows for the WEAPONS tab. Re-derives whenever
  // any inventory count changes (which the WEAPONS tab already triggers
  // on every weapon-part / resource update). The map is keyed by
  // WeaponType string so UpgradeMenu can look up entries by `w.type`
  // without importing the WeaponType union.
  const weaponJewelInfo = useMemo(() => {
    const inv = inventoryRef.current;
    const jewels = jewelRef.current;
    if (!inv || !jewels) return undefined;
    const out: Record<string, { weaponType: string; mounted: JewelTier | null; available: Record<JewelTier, number> }> = {};
    for (const w of JEWEL_MOUNTABLE_WEAPONS) {
      out[w] = {
        weaponType: w,
        mounted: jewels.getMount(w),
        available: {
          rough:    inv.getItemCount(JEWEL_DEFS.rough.itemId),
          cut:      inv.getItemCount(JEWEL_DEFS.cut.itemId),
          flawless: inv.getItemCount(JEWEL_DEFS.flawless.itemId),
        },
      };
    }
    return out;
    // weaponUpgradeInfo refreshes on the same inventory pulse the jewel
    // counts change on, so depending on it keeps this map fresh without
    // adding a second listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weaponUpgradeInfo, partCounts]);

  // Build the SPECIALS rows from the single SPECIALS_DEFS source. Affordability
  // re-evaluates whenever resources or owned-flags change.
  const specialsList = useMemo(() => {
    const r = resourceCounts;
    const credits = playerRef.current?.getStats().credits ?? 0;
    return SPECIALS_DEFS.map(d => {
      const c = d.cost;
      const affordable = r.gears >= c.gears
        && r.cores >= c.cores
        && r.nanofiber >= c.nanofiber
        && (c.circuits == null || r.circuits >= c.circuits)
        && (c.credits  == null || credits   >= c.credits);
      return {
        id: d.id,
        name: d.name,
        description: d.description,
        owned: specialsOwned[d.id],
        cost: c,
        affordable,
      };
    });
  }, [resourceCounts, specialsOwned]);

  return (
    <div className="w-full h-full bg-black">
      {gamePhase === "auth" && (
        <AuthUI onAuthenticated={handleAuthenticated} onPlayOffline={handlePlayOffline} />
      )}

      {gamePhase === "menu" && (
        <MainMenu
          onStart={handleStart}
          onCustomize={() => setShowCustomizer(true)}
          saveSummary={saveSummary}
        />
      )}

      {showCustomizer && (
        <CharacterEditor onClose={() => setShowCustomizer(false)} />
      )}

      <canvas
        ref={canvasRef}
        className="w-full h-full absolute inset-0"
        style={{ 
          touchAction: "none", 
          zIndex: gamePhase === "playing" || gamePhase === "gameover" ? 1 : -1,
          visibility: gamePhase === "auth" ? "hidden" : "visible"
        }}
      />

      <input
        ref={loadInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || !levelSerializerRef.current) return;
          try {
            await levelSerializerRef.current.loadFromFile(file);
          } catch (err) {
            console.error("[Game] Failed to load level:", err);
            setMessage(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          e.target.value = "";
        }}
      />

      {gamePhase === "playing" && (
        <GameUI
          stats={stats}
          weapon={currentWeapon}
          ammo={ammo}
          maxAmmo={maxAmmo}
          enemyCount={enemyCount}
          waveNumber={waveNumber}
          chestCount={chestCount}
          showMessage={message}
          levelBanner={levelBanner}
          levelObjective={levelObjective}
          levelCompleteOverlay={levelCompleteOverlay}
          jetpackFuel={jetpackFuel}
          maxJetpackFuel={maxJetpackFuel}
          playerState={playerState}
          comboInfo={comboInfo}
          specialWeapons={specialWeaponInfo}
          elementalSpecials={elementalSpecialsInfo}
          beamSabreActive={beamSabreActive}
          beamSabreLevel={beamSabreLevel}
          activeElement={activeElement}
          armorDefense={armorDefense}
          companions={companionInfo}
          isFlying={isFlying}
          armorEnergy={armorEnergy}
          maxArmorEnergy={maxArmorEnergy}
          hasFlightArmor={hasFlightArmor}
          capsuleOpen={capsuleOpen}
          capsuleUpgrades={capsuleUpgrades}
          onCapsuleUpgrade={handleCapsuleUpgrade}
          shopOpen={shopOpen}
          activeShop={activeShop}
          onShopBuy={handleShopBuy}
          buildMode={buildMode}
          inVehicle={inVehicle}
          hotbarBlocks={hotbarBlocks}
          selectedBlock={selectedBlock}
          selectedBlockDef={selectedBlockDef}
          upgradeMenuOpen={upgradeMenuOpen}
          upgradeMenuWeapons={weaponUpgradeInfo}
          upgradeMenuCompanions={companionUpgradeInfo}
          upgradeMenuPlayer={playerUpgradeInfo}
          upgradeMenuElemental={elementalUpgradeInfo}
          onUpgradeElemental={handleUpgradeElemental}
          upgradeMenuResources={{
            gears: resourceCounts.gears,
            scrap: resourceCounts.scrap,
            cores: resourceCounts.cores,
            circuits: resourceCounts.circuits,
            nanofiber: resourceCounts.nanofiber,
          }}
          upgradeMenuPartCounts={partCounts}
          onUpgradeWeapon={handleUpgradeWeapon}
          onUpgradeCompanion={handleUpgradeCompanion}
          onUpgradePlayer={handleUpgradePlayer}
          weaponJewelInfo={weaponJewelInfo}
          onMountJewel={handleMountJewel}
          onUnmountJewel={handleUnmountJewel}
          upgradeMenuSpecials={specialsList}
          upgradeMenuCompanionWeapons={companionWeaponInfo}
          upgradeMenuTravel={travelDestinations}
          upgradeMenuCurrentLevel={currentWorldLevel}
          onUnlockSpecial={handleUnlockSpecial}
          onUpgradeCompanionWeapon={handleUpgradeCompanionWeapon}
          onFastTravel={handleFastTravel}
          onUpgradeMenuClose={() => setUpgradeMenuOpen(false)}
          labOpen={labOpen}
          labLevel={labLevel}
          labBlueprints={labBlueprints}
          labResources={{
            gears: resourceCounts.gears,
            scrap: resourceCounts.scrap,
            cores: resourceCounts.cores,
            circuits: resourceCounts.circuits,
          }}
          labCapacityUsed={companionInfo.length}
          labCapacityMax={Math.max(3, baseRef.current?.getLabCompanionCap() ?? 3)}
          labUpgradeCost={labUpgradeCost}
          labCanUpgrade={labCanUpgrade}
          onLabBuild={handleLabBuild}
          onLabUpgrade={handleLabUpgrade}
          onLabClose={() => setLabOpen(false)}
          gardenOpen={gardenOpen}
          gardenLevel={gardenLevel}
          gardenCaptureBonus={baseRef.current?.getGardenCaptureBonus() ?? 0}
          gardenCapacityMax={Math.max(15, baseRef.current?.getGardenCaptureCap() ?? 15)}
          gardenCaptured={capturedCreatures}
          gardenDexCaughtIds={dexCaughtIds}
          petBondSummary={petBondSummary}
          bioEssenceCount={resourceCounts.bioEssence}
          gardenUpgradeCost={gardenUpgradeCost}
          gardenCanUpgrade={gardenCanUpgrade}
          onGardenDeploy={handleGardenDeploy}
          onGardenCare={handleGardenCare}
          onGardenUpgrade={handleGardenUpgrade}
          onGardenClose={() => setGardenOpen(false)}
          planMode={planMode}
          prefabHotbar={prefabHotbar}
          selectedPrefabIndex={selectedPrefabIndex}
          onSaveLevel={() => levelSerializerRef.current?.download()}
          onLoadLevel={() => loadInputRef.current?.click()}
          onClearLevel={() => {
            buildingRef.current?.clearAll();
            prefabRef.current?.clearAll();
          }}
          username={currentUser?.username || null}
          multiplayerConnected={multiplayerConnected}
          inRoom={inRoom}
          roomCode={roomCode}
          isHost={isHost}
          remotePlayerCount={remotePlayerCount}
          chatMessages={chatMessages}
          lobbyRooms={lobbyRooms}
          showLobby={showLobby}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onLeaveRoom={handleLeaveRoom}
          onRefreshRooms={handleRefreshRooms}
          onSendChat={handleSendChat}
          onToggleLobby={handleToggleLobby}
          onLogout={handleLogout}
        />
      )}

      {gamePhase === "playing" && (
        <>
          <MusicPlayerUI variant="game" />
          <button
            onClick={handleRespawnVehicles}
            className="fixed bottom-4 right-4 z-40 px-4 py-2 bg-black/70 border border-amber-500/60 text-amber-200 text-xs font-bold rounded-lg hover:bg-amber-500/20 backdrop-blur-md shadow-lg shadow-amber-500/20"
            title="Respawn ATV + Fighter near you"
          >
            ⟳ RESPAWN VEHICLES
          </button>
        </>
      )}

      {gamePhase === "gameover" && (
        <div className="fixed inset-0 bg-black/80 flex flex-col items-center justify-center z-50">
          <h1 className="text-6xl font-bold text-red-500 mb-4">GAME OVER</h1>
          <div className="text-white text-xl mb-8">
            <p>Final Score: {stats.credits} Credits</p>
            <p>Level Reached: {stats.level}</p>
            <p>Waves Survived: {waveNumber}</p>
          </div>
          <button
            onClick={handleRestart}
            className="px-8 py-3 text-lg font-bold text-black bg-cyan-400 rounded-lg
                       hover:bg-cyan-300 transition-colors"
          >
            TRY AGAIN
          </button>
        </div>
      )}
    </div>
  );
};
