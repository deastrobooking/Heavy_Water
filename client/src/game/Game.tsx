import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders";
import { BabylonEngine } from "./BabylonEngine";
import { CityGenerator } from "./CityGenerator";
import { PlayerController, PlayerStats, PlayerUpgradeInfo } from "./PlayerController";
import { WeaponsSystem, Weapon } from "./WeaponsSystem";
import { EnemySystem } from "./EnemySystem";
import { AerialEnemySystem } from "./AerialEnemySystem";
import { EnemyHealthBarSystem, EnemyLike } from "./EnemyHealthBarSystem";
import { GamepadInput } from "./GamepadInput";
import { ChestSystem, Loot } from "./ChestSystem";
import { CombatSystem } from "./CombatSystem";
import { SpecialWeaponsSystem } from "./SpecialWeaponsSystem";
import { BeamSabreSystem } from "./BeamSabreSystem";
import { ArmorSystem } from "./ArmorSystem";
import { CraftingSystem } from "./CraftingSystem";
import { InventorySystem, ITEM_DEFINITIONS } from "./InventorySystem";
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
import { VehicleSystem } from "./VehicleSystem";
import { EnvironmentPropSystem, PropHitboxMetadata } from "./EnvironmentPropSystem";
import { MusicSystem } from "./MusicSystem";
import { MusicPlayerUI } from "./MusicPlayerUI";
import { WeaponUpgradeInfo } from "./WeaponsSystem";
import { CompanionUpgradeInfo } from "./CompanionSystem";
import { LabBlueprint } from "./LabUI";
import { LevelSerializer } from "./LevelSerializer";
import { MultiplayerSystem } from "./MultiplayerSystem";
import { EffectsSystem } from "./EffectsSystem";
import { PropAudioSystem } from "./PropAudioSystem";
import { SoundSystem } from "./SoundSystem";
import { SkySystem } from "./SkySystem";
import { MiningSystem } from "./MiningSystem";
import { EnemyBaseSystem } from "./EnemyBaseSystem";
import { loadProgress, saveProgress, ProgressSnapshot } from "./ProgressSync";
import { EventBus, GameEvents } from "./EventBus";
import { DamageType } from "./DamageSystem";
import { GameUI } from "./GameUI";
import { MainMenu } from "./MainMenu";
import { CharacterEditor } from "./CharacterEditor";
import AuthUI from "./AuthUI";

type GamePhase = "auth" | "menu" | "playing" | "paused" | "gameover";

export const Game: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BabylonEngine | null>(null);
  const initializingRef = useRef(false);
  const playerRef = useRef<PlayerController | null>(null);
  const weaponsRef = useRef<WeaponsSystem | null>(null);
  const enemySystemRef = useRef<EnemySystem | null>(null);
  const aerialEnemyRef = useRef<AerialEnemySystem | null>(null);
  const enemyHealthBarsRef = useRef<EnemyHealthBarSystem | null>(null);
  const gamepadRef = useRef<GamepadInput | null>(null);
  const chestSystemRef = useRef<ChestSystem | null>(null);
  const combatSystemRef = useRef<CombatSystem | null>(null);
  const specialWeaponsRef = useRef<SpecialWeaponsSystem | null>(null);
  const beamSabreRef = useRef<BeamSabreSystem | null>(null);
  const armorSystemRef = useRef<ArmorSystem | null>(null);
  const craftingSystemRef = useRef<CraftingSystem | null>(null);
  const inventoryRef = useRef<InventorySystem | null>(null);
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
  const vehicleRef = useRef<VehicleSystem | null>(null);
  const propSystemRef = useRef<EnvironmentPropSystem | null>(null);
  const atvHitCooldownRef = useRef<Map<number, number>>(new Map());
  const levelSerializerRef = useRef<LevelSerializer | null>(null);
  const loadInputRef = useRef<HTMLInputElement | null>(null);
  const multiplayerRef = useRef<MultiplayerSystem | null>(null);
  const effectsRef = useRef<EffectsSystem | null>(null);
  const propAudioRef = useRef<PropAudioSystem | null>(null);
  const soundRef = useRef<SoundSystem | null>(null);
  const skyRef = useRef<SkySystem | null>(null);
  const miningRef = useRef<MiningSystem | null>(null);
  const enemyBaseRef = useRef<EnemyBaseSystem | null>(null);
  const respawnTimeoutRef = useRef<number | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const lastSaveAtRef = useRef<number>(0);

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
  const [resourceCounts, setResourceCounts] = useState({ gears: 0, scrap: 0, cores: 0, circuits: 0, nanofiber: 0, bioEssence: 0 });
  const [partCounts, setPartCounts] = useState<Record<string, number>>({});
  const [labOpen, setLabOpen] = useState(false);
  const [labStructure, setLabStructure] = useState<BaseStructure | null>(null);
  const [gardenOpen, setGardenOpen] = useState(false);
  const [gardenStructure, setGardenStructure] = useState<BaseStructure | null>(null);
  const [capturedCreatures, setCapturedCreatures] = useState<CapturedCreature[]>([]);
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
  const [inVehicle, setInVehicle] = useState(false);
  const [currentWeapon, setCurrentWeapon] = useState<Weapon | null>(null);
  const [ammo, setAmmo] = useState(50);
  const [maxAmmo, setMaxAmmo] = useState(50);
  const [enemyCount, setEnemyCount] = useState(0);
  const [waveNumber, setWaveNumber] = useState(1);
  const [chestCount, setChestCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [jetpackFuel, setJetpackFuel] = useState(200);
  const [maxJetpackFuel, setMaxJetpackFuel] = useState(200);
  const [playerState, setPlayerState] = useState("idle");
  const [comboInfo, setComboInfo] = useState<{ name: string; index: number } | null>(null);
  const [specialWeaponInfo, setSpecialWeaponInfo] = useState<any[]>([]);
  const [beamSabreActive, setBeamSabreActive] = useState(false);
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

  const handleAuthenticated = useCallback((user: any) => {
    setCurrentUser(user);
    setGamePhase("menu");
  }, []);

  const handlePlayOffline = useCallback(() => {
    setCurrentUser(null);
    setGamePhase("menu");
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

    setGamePhase("playing");

    setTimeout(() => {
      try {
        if (!canvasRef.current) {
          throw new Error("Canvas not available");
        }

        const bus = EventBus.getInstance();
        bus.clear();

        const engine = new BabylonEngine(canvasRef.current);
        engineRef.current = engine;

        const scene = engine.getScene();

        const cityGenerator = new CityGenerator(scene);
        cityGenerator.generateCity();

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
        playerRef.current = player;

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

        const beamSabre = new BeamSabreSystem(scene, engine.getCamera());
        beamSabreRef.current = beamSabre;

        const aimOrigin = () => player.getAimOrigin();
        weapons.setAimOriginProvider(aimOrigin);
        specialWeapons.setAimOriginProvider(aimOrigin);
        combatSystem.setAimOriginProvider(aimOrigin);
        beamSabre.setAimOriginProvider(aimOrigin);

        const inventory = new InventorySystem();
        inventoryRef.current = inventory;

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

        const bioSystem = new BioCreatureSystem(scene, inventory);
        bioRef.current = bioSystem;
        bioSystem.setHooks(
          () => baseSystem.getGardenCaptureBonus(),
          () => Math.max(6, baseSystem.getGardenCaptureCap()),
        );
        bioSystem.spawnInitialCreatures();

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

        const effects = new EffectsSystem(scene, engine.getCamera());
        effectsRef.current = effects;

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

        const enemySystem = new EnemySystem(scene);
        enemySystemRef.current = enemySystem;

        const aerialEnemySystem = new AerialEnemySystem(scene);
        aerialEnemyRef.current = aerialEnemySystem;
        // Seed initial sky combat
        const initialPos = player.getPosition();
        aerialEnemySystem.spawnFighter(initialPos);
        aerialEnemySystem.spawnFighter(initialPos);
        aerialEnemySystem.spawnBattleship(initialPos);

        const miningSystem = new MiningSystem(scene);
        miningRef.current = miningSystem;
        miningSystem.seedWorld(28);

        const enemyBaseSystem = new EnemyBaseSystem(scene);
        enemyBaseRef.current = enemyBaseSystem;
        enemyBaseSystem.seedWorld([
          new BABYLON.Vector3(250, 0, 250),
          new BABYLON.Vector3(-250, 0, 250),
          new BABYLON.Vector3(0, 0, -280),
        ]);

        const enemyHealthBars = new EnemyHealthBarSystem(scene, engine.getCamera());
        enemyHealthBars.setEnemyProvider(() => {
          const ground: EnemyLike[] = enemySystem.getActiveEnemies();
          const aerial: EnemyLike[] = aerialEnemySystem.getActiveUnits();
          const baseUnits: EnemyLike[] = enemyBaseSystem.getEnemyLikes();
          return ground.concat(aerial).concat(baseUnits);
        });
        enemyHealthBarsRef.current = enemyHealthBars;

        const gamepad = new GamepadInput(engine.getCamera());
        gamepad.onConnectionChange((connected, padId) => {
          showMessage(connected ? `CONTROLLER CONNECTED: ${padId}` : "CONTROLLER DISCONNECTED", 2500);
        });
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
        // and on the sky racetrack ring — the city generator's analytic
        // surface query handles all three.
        vehicleSystem.setGroundHeightFn((x, z, currentY) =>
          cityGenerator.getDriveableHeight(x, z, currentY ?? Infinity),
        );
        vehicleSystem.setBuildingColliders(cityGenerator.getWallColliders());
        vehicleRef.current = vehicleSystem;
        vehicleSystem.spawnPreset("RaiderATV", new BABYLON.Vector3(-6, 0.6, -10));
        vehicleSystem.spawnPreset("CometFighter", new BABYLON.Vector3(8, 1.2, -10));

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
          return {
            stats: player.getStats(),
            weaponLevels: weapons.getWeaponLevels(),
            playerUpgrades: player.getPlayerUpgradeLevels(),
            inventoryCounts,
            hasFlightArmor: player.getHasFlightArmor(),
            totalKills: totalKillsLocal,
            highestWave: Math.max(highestWaveLocal, enemySystem.getWaveNumber()),
            capturedCreatures: captures as any[],
            savedAt: Date.now(),
          };
        };

        const doSaveProgress = async (): Promise<void> => {
          if (!currentUser) return;
          const now = performance.now();
          if (now - lastSaveAtRef.current < 2000) return; // throttle
          lastSaveAtRef.current = now;
          await saveProgress(buildSnapshot());
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
                  const def = ITEM_DEFINITIONS[itemId];
                  if (def && qty > 0) inventory.addItem(def, qty);
                }
              }
              totalKillsLocal = snap.totalKills || 0;
              highestWaveLocal = snap.highestWave || 1;
              showMessage(`PROGRESS LOADED — LVL ${snap.stats.level} | ${snap.stats.credits}cr`, 2500);
            } catch (err) {
              console.warn("[ProgressSync] apply failed:", err);
            }
          });
        }

        // Autosave every 15s
        if (currentUser) {
          if (autosaveTimerRef.current !== null) window.clearInterval(autosaveTimerRef.current);
          autosaveTimerRef.current = window.setInterval(() => { void doSaveProgress(); }, 15000);
        }

        bus.on(GameEvents.PLAYER_LEVEL_UP, () => { void doSaveProgress(); });
        bus.on(GameEvents.WEAPON_UPGRADED, () => { void doSaveProgress(); });
        bus.on(GameEvents.CREATURE_CAPTURED, () => { void doSaveProgress(); });

        bus.on(GameEvents.PLAYER_DIED, () => {
          if (vehicleSystem.getActive()) {
            vehicleSystem.exit();
            player.setMounted(null);
          }
          // Trigger save before respawn so progression survives crash/disconnect
          if (currentUser) void doSaveProgress();
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

        let lastTime = performance.now();
        let waveTimer = 0;
        let uiThrottleTimer = 0;

        engine.start(() => {
          const now = performance.now();
          const deltaTime = now - lastTime;
          lastTime = now;
          const dt = deltaTime / 1000;

          vehicleSystem.update(dt);
          player.update(dt);
          // Amplify weapons while mounted in a vehicle (1.5x size/damage/explosion).
          const mounted = player.isMounted();
          weapons.setVehicleMode(mounted);
          const playerPos = player.getPosition();

          combatSystem.update(dt);

          const groundEnemyMeshes = enemySystem.getEnemyMeshes();
          const aerialMeshes = aerialEnemySystem.getMeshes();
          const miningMeshes = miningSystem.getActiveMeshes();
          const baseMeshes = enemyBaseSystem.getActiveMeshes();
          const propMeshes = propSystem.getHitboxMeshes();
          const enemyMeshes = groundEnemyMeshes.concat(aerialMeshes).concat(miningMeshes).concat(baseMeshes).concat(propMeshes);
          const hits = weapons.update(enemyMeshes);

          const isPropMeta = (m: unknown): m is PropHitboxMetadata =>
            !!m && typeof m === "object" && (m as PropHitboxMetadata).isProp === true;

          const routeHit = (mesh: BABYLON.AbstractMesh, dmg: number) => {
            // Props use the standard mesh.metadata.damageable interface
            const meta = mesh.metadata;
            if (isPropMeta(meta)) {
              meta.damageable.takeDamage({
                amount: dmg,
                damageType: DamageType.Kinetic,
                hitPoint: mesh.getAbsolutePosition().clone(),
              });
              return;
            }
            // Try mining first (cheap), then enemy bases, then aerial, then ground
            if (miningSystem.damageNode(mesh, dmg)) return;
            if (enemyBaseSystem.damageStructure(mesh, dmg)) return;
            if (aerialEnemySystem.damageEnemy(mesh as BABYLON.Mesh, dmg)) return;
            enemySystem.damageEnemy(mesh as BABYLON.Mesh, dmg);
          };

          for (const hit of hits) {
            const modifiedDamage = armorSystem.getModifiedOutgoingDamage(hit.damage);
            routeHit(hit.hitEnemy, modifiedDamage);
          }

          const specialHits = specialWeapons.update(dt, enemyMeshes, playerPos);
          for (const hit of specialHits) {
            routeHit(hit.hitEnemy, hit.damage);
          }

          beamSabre.update(dt, enemyMeshes);

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
          if (baseResult.damage > 0) {
            const reducedBase = armorSystem.calculateDamageReduction(baseResult.damage, DamageType.Plasma);
            player.takeDamageSimple(reducedBase);
            showMessage(`-${Math.floor(reducedBase)} TURRET FIRE!`, 600);
          }

          chestSystem.update(playerPos);
          pickupSystem.setPlayerPosition(playerPos);
          bioSystem.setPlayerPosition(playerPos);
          propSystem.setPlayerPosition(playerPos);

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
          sky.update(dt);
          multiplayer.update(dt);

          mapSystem.updatePlayerPosition(playerPos);
          const mapEnemyMeshes = enemySystem.getEnemyMeshes();
          mapSystem.updateEnemies(mapEnemyMeshes.map(m => m.position));
          // Bases + supply caches: snapshots refreshed each frame so the map
          // reflects newly-cleared bases and looted caches without any extra
          // event wiring. Both calls are O(numBases + numOpenContainers) — a
          // few dozen entries at most — so the per-frame cost is negligible.
          mapSystem.setEnemyBases(enemyBaseSystem.getBasePositions());
          mapSystem.setSupplyCaches(propSystem.getOpenContainers());
          mapSystem.draw();
          setRemotePlayerCount(multiplayer.getRemotePlayerCount());

          setStats(player.getStats());
          setPlayerUpgradeInfo(player.getPlayerUpgradeInfo());
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

          uiThrottleTimer += dt;
          if (uiThrottleTimer >= 0.5) {
            uiThrottleTimer = 0;
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
            setCapturedCreatures(bioSystem.getCaptured());
          }

          if (player.getStats().health <= 0) {
            setGamePhase("gameover");
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

        initializingRef.current = false;
      } catch (error) {
        console.error("Failed to initialize game:", error);
        if (engineRef.current) {
          try { engineRef.current.dispose(); } catch {}
          engineRef.current = null;
        }
        playerRef.current = null;
        weaponsRef.current = null;
        if (enemyHealthBarsRef.current) { try { enemyHealthBarsRef.current.dispose(); } catch {} }
        enemyHealthBarsRef.current = null;
        if (gamepadRef.current) { try { gamepadRef.current.dispose(); } catch {} }
        gamepadRef.current = null;
        enemySystemRef.current = null;
        if (aerialEnemyRef.current) { try { aerialEnemyRef.current.dispose(); } catch {} }
        aerialEnemyRef.current = null;
        chestSystemRef.current = null;
        combatSystemRef.current = null;
        specialWeaponsRef.current = null;
        beamSabreRef.current = null;
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
        if (miningRef.current) { try { miningRef.current.dispose(); } catch {} }
        miningRef.current = null;
        if (enemyBaseRef.current) { try { enemyBaseRef.current.dispose(); } catch {} }
        enemyBaseRef.current = null;
        if (autosaveTimerRef.current !== null) { window.clearInterval(autosaveTimerRef.current); autosaveTimerRef.current = null; }
        if (respawnTimeoutRef.current !== null) { window.clearTimeout(respawnTimeoutRef.current); respawnTimeoutRef.current = null; }
        baseRef.current = null;
        multiplayerRef.current = null;
        initializingRef.current = false;
        const errorMsg = error instanceof Error ? error.message : String(error);
        setMessage(`CRITICAL ERROR: ${errorMsg}`);
        setGamePhase("menu");
      }
    }, 150);
  }, [handleLootCollected, showMessage, currentUser]);

  const handleStart = useCallback(() => {
    void MusicSystem.init().then(() => MusicSystem.startGameMusic());
    initializeGame();
  }, [initializeGame]);

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
    // CRITICAL: dispose player FIRST to remove window keydown/keyup listeners.
    // Without this, the stale PlayerController keeps responding to input
    // against disposed Babylon meshes, causing the post-restart freeze.
    if (playerRef.current) { try { playerRef.current.dispose(); } catch {} playerRef.current = null; }
    weaponsRef.current = null;
    if (combatSystemRef.current) { try { combatSystemRef.current.dispose(); } catch {} combatSystemRef.current = null; }
    if (specialWeaponsRef.current) { try { specialWeaponsRef.current.dispose(); } catch {} specialWeaponsRef.current = null; }
    if (beamSabreRef.current) { try { beamSabreRef.current.dispose(); } catch {} beamSabreRef.current = null; }
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
    if (miningRef.current) { try { miningRef.current.dispose(); } catch {} miningRef.current = null; }
    if (enemyBaseRef.current) { try { enemyBaseRef.current.dispose(); } catch {} enemyBaseRef.current = null; }
    if (enemyHealthBarsRef.current) { try { enemyHealthBarsRef.current.dispose(); } catch {} enemyHealthBarsRef.current = null; }
    if (gamepadRef.current) { try { gamepadRef.current.dispose(); } catch {} gamepadRef.current = null; }
    if (aerialEnemyRef.current) { try { aerialEnemyRef.current.dispose(); } catch {} aerialEnemyRef.current = null; }
    enemySystemRef.current = null;
    chestSystemRef.current = null;
    armorSystemRef.current = null;
    craftingSystemRef.current = null;
    inventoryRef.current = null;
    baseRef.current = null;
    atvHitCooldownRef.current.clear();
    if (autosaveTimerRef.current !== null) { window.clearInterval(autosaveTimerRef.current); autosaveTimerRef.current = null; }
    if (respawnTimeoutRef.current !== null) { window.clearTimeout(respawnTimeoutRef.current); respawnTimeoutRef.current = null; }
    if (multiplayerRef.current) { try { multiplayerRef.current.dispose(); } catch {} multiplayerRef.current = null; }
    if (engineRef.current) {
      try { engineRef.current.dispose(); } catch {}
      engineRef.current = null;
    }
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
    setBeamSabreActive(false);
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
    if (comp) setCompanionUpgradeInfo(comp.getAllUpgradeInfo(() => gears, () => cores));
    if (bio) setCapturedCreatures(bio.getCaptured());
  }, []);

  const handleUpgradeWeapon = useCallback((type: string) => {
    if (!weaponsRef.current) return;
    const ok = weaponsRef.current.upgradeWeapon(type as any);
    if (ok) showMessage(`UPGRADED ${type.toUpperCase()}`, 1500);
    else showMessage("UPGRADE FAILED — INSUFFICIENT RESOURCES", 1500);
    syncResourcesNow();
  }, [showMessage, syncResourcesNow]);

  const handleUpgradePlayer = useCallback((id: string) => {
    if (!playerRef.current) return;
    const ok = playerRef.current.upgradePlayerStat(id);
    if (ok) showMessage(`UPGRADED ${id.toUpperCase()}`, 1500);
    else showMessage("UPGRADE FAILED — INSUFFICIENT CREDITS", 1500);
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
    if (ok) showMessage("ROBOT UPGRADED", 1500);
    else showMessage("ROBOT UPGRADE FAILED", 1500);
    syncResourcesNow();
  }, [showMessage, syncResourcesNow]);

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
    } else {
      showMessage("DEPLOY FAILED", 1500);
    }
  }, [showMessage]);

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
        // Priority: exit vehicle > enter vehicle > base structures
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
      } else if (e.code === "Escape") {
        if (upgradeMenuOpen) setUpgradeMenuOpen(false);
        if (labOpen) setLabOpen(false);
        if (gardenOpen) setGardenOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gamePhase, upgradeMenuOpen, labOpen, gardenOpen, showMessage]);

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
      if (!vehicleRef.current?.getActive()) return;
      const k = codeToInput[code];
      if (!k) return;
      vehicleRef.current.setInput({ [k]: down } as any);
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
      if (combatSystemRef.current) combatSystemRef.current.dispose();
      if (specialWeaponsRef.current) specialWeaponsRef.current.dispose();
      if (beamSabreRef.current) beamSabreRef.current.dispose();
      if (companionRef.current) companionRef.current.dispose();
      if (capsuleRef.current) capsuleRef.current.dispose();
      if (shopRef.current) shopRef.current.dispose();
      if (buildingRef.current) buildingRef.current.dispose();
      if (prefabRef.current) prefabRef.current.dispose();
      if (pickupRef.current) pickupRef.current.dispose();
      if (bioRef.current) bioRef.current.dispose();
      if (vehicleRef.current) vehicleRef.current.dispose();
      if (propSystemRef.current) propSystemRef.current.dispose();
      atvHitCooldownRef.current.clear();
      if (baseRef.current) baseRef.current.dispose();
      if (miningRef.current) miningRef.current.dispose();
      if (enemyBaseRef.current) enemyBaseRef.current.dispose();
      if (autosaveTimerRef.current !== null) window.clearInterval(autosaveTimerRef.current);
      if (respawnTimeoutRef.current !== null) window.clearTimeout(respawnTimeoutRef.current);
      if (effectsRef.current) effectsRef.current.dispose();
      if (propAudioRef.current) propAudioRef.current.dispose();
      if (soundRef.current) soundRef.current.dispose();
      if (skyRef.current) skyRef.current.dispose();
      if (enemyHealthBarsRef.current) enemyHealthBarsRef.current.dispose();
      if (aerialEnemyRef.current) aerialEnemyRef.current.dispose();
      if (gamepadRef.current) gamepadRef.current.dispose();
      if (multiplayerRef.current) multiplayerRef.current.dispose();
      if (engineRef.current) engineRef.current.dispose();
      MusicSystem.pause();
      EventBus.getInstance().clear();
    };
  }, []);

  return (
    <div className="w-full h-full bg-black">
      {gamePhase === "auth" && (
        <AuthUI onAuthenticated={handleAuthenticated} onPlayOffline={handlePlayOffline} />
      )}

      {gamePhase === "menu" && (
        <MainMenu onStart={handleStart} onCustomize={() => setShowCustomizer(true)} />
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
          jetpackFuel={jetpackFuel}
          maxJetpackFuel={maxJetpackFuel}
          playerState={playerState}
          comboInfo={comboInfo}
          specialWeapons={specialWeaponInfo}
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
          gardenCapacityMax={Math.max(6, baseRef.current?.getGardenCaptureCap() ?? 6)}
          gardenCaptured={capturedCreatures}
          bioEssenceCount={resourceCounts.bioEssence}
          gardenUpgradeCost={gardenUpgradeCost}
          gardenCanUpgrade={gardenCanUpgrade}
          onGardenDeploy={handleGardenDeploy}
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
