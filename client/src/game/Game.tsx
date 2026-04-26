import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders";
import { BabylonEngine } from "./BabylonEngine";
import { CityGenerator } from "./CityGenerator";
import { PlayerController, PlayerStats } from "./PlayerController";
import { WeaponsSystem, Weapon } from "./WeaponsSystem";
import { EnemySystem } from "./EnemySystem";
import { EnemyHealthBarSystem } from "./EnemyHealthBarSystem";
import { GamepadInput } from "./GamepadInput";
import { ChestSystem, Loot } from "./ChestSystem";
import { CombatSystem } from "./CombatSystem";
import { SpecialWeaponsSystem } from "./SpecialWeaponsSystem";
import { BeamSabreSystem } from "./BeamSabreSystem";
import { ArmorSystem } from "./ArmorSystem";
import { CraftingSystem } from "./CraftingSystem";
import { InventorySystem } from "./InventorySystem";
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
import { WeaponUpgradeInfo } from "./WeaponsSystem";
import { CompanionUpgradeInfo } from "./CompanionSystem";
import { LabBlueprint } from "./LabUI";
import { LevelSerializer } from "./LevelSerializer";
import { MultiplayerSystem } from "./MultiplayerSystem";
import { EffectsSystem } from "./EffectsSystem";
import { SkySystem } from "./SkySystem";
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
  const levelSerializerRef = useRef<LevelSerializer | null>(null);
  const loadInputRef = useRef<HTMLInputElement | null>(null);
  const multiplayerRef = useRef<MultiplayerSystem | null>(null);
  const effectsRef = useRef<EffectsSystem | null>(null);
  const skyRef = useRef<SkySystem | null>(null);

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
    health: 100,
    maxHealth: 100,
    armor: 50,
    maxArmor: 100,
    stamina: 100,
    maxStamina: 100,
    credits: 0,
    experience: 0,
    level: 1,
  });
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

        const effects = new EffectsSystem(scene);
        effectsRef.current = effects;

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

        const enemyHealthBars = new EnemyHealthBarSystem(scene, engine.getCamera());
        enemyHealthBars.setEnemyProvider(() => enemySystem.getActiveEnemies());
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

          player.update(dt);
          const playerPos = player.getPosition();

          combatSystem.update(dt);

          const enemyMeshes = enemySystem.getEnemyMeshes();
          const hits = weapons.update(enemyMeshes);

          for (const hit of hits) {
            const modifiedDamage = armorSystem.getModifiedOutgoingDamage(hit.damage);
            enemySystem.damageEnemy(hit.hitEnemy, modifiedDamage);
          }

          const specialHits = specialWeapons.update(dt, enemyMeshes, playerPos);
          for (const hit of specialHits) {
            enemySystem.damageEnemy(hit.hitEnemy, hit.damage);
          }

          beamSabre.update(dt, enemyMeshes);

          const companionResult = companionSystem.update(dt, playerPos, enemyMeshes);
          if (companionResult.healed > 0) {
            player.heal(companionResult.healed);
          }
          for (const hit of companionResult.attackHits) {
            enemySystem.damageEnemy(hit.mesh as BABYLON.Mesh, hit.damage);
          }

          const enemyResult = enemySystem.update(playerPos, deltaTime);
          if (enemyResult.damage > 0) {
            const reducedDamage = armorSystem.calculateDamageReduction(enemyResult.damage, DamageType.Melee);
            player.takeDamageSimple(reducedDamage);
            showMessage(`-${Math.floor(reducedDamage)} DAMAGE!`, 500);
          }

          chestSystem.update(playerPos);
          pickupSystem.setPlayerPosition(playerPos);
          bioSystem.setPlayerPosition(playerPos);

          capsuleSystem.update(dt, playerPos);
          shopSystem.update();
          buildingSystem.update(dt);
          effects.update(dt);
          sky.update(dt);
          multiplayer.update(dt);

          mapSystem.updatePlayerPosition(playerPos);
          const mapEnemyMeshes = enemySystem.getEnemyMeshes();
          mapSystem.updateEnemies(mapEnemyMeshes.map(m => m.position));
          mapSystem.draw();
          setRemotePlayerCount(multiplayer.getRemotePlayerCount());

          setStats(player.getStats());
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
        if (bioRef.current) { try { bioRef.current.dispose(); } catch {} }
        bioRef.current = null;
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
    initializeGame();
  }, [initializeGame]);

  const handleRestart = useCallback(() => {
    if (combatSystemRef.current) combatSystemRef.current.dispose();
    if (specialWeaponsRef.current) specialWeaponsRef.current.dispose();
    if (beamSabreRef.current) beamSabreRef.current.dispose();
    if (companionRef.current) companionRef.current.dispose();
    if (capsuleRef.current) capsuleRef.current.dispose();
    if (shopRef.current) shopRef.current.dispose();
    if (gardenRef.current) gardenRef.current.dispose();
    if (mapRef.current) mapRef.current.dispose();
    if (buildingRef.current) buildingRef.current.dispose();
    if (prefabRef.current) prefabRef.current.dispose();
    if (pickupRef.current) pickupRef.current.dispose();
    if (bioRef.current) bioRef.current.dispose();
    if (multiplayerRef.current) multiplayerRef.current.dispose();
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
    initializingRef.current = false;
    EventBus.getInstance().clear();
    setStats({
      health: 100, maxHealth: 100, armor: 50, maxArmor: 100,
      stamina: 100, maxStamina: 100, credits: 0, experience: 0, level: 1,
    });
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
      } else if (e.code === "KeyE") {
        if (!baseRef.current || !playerRef.current) return;
        const pos = playerRef.current.getPosition();
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
      if (baseRef.current) baseRef.current.dispose();
      if (effectsRef.current) effectsRef.current.dispose();
      if (skyRef.current) skyRef.current.dispose();
      if (enemyHealthBarsRef.current) enemyHealthBarsRef.current.dispose();
      if (gamepadRef.current) gamepadRef.current.dispose();
      if (multiplayerRef.current) multiplayerRef.current.dispose();
      if (engineRef.current) engineRef.current.dispose();
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
          hotbarBlocks={hotbarBlocks}
          selectedBlock={selectedBlock}
          selectedBlockDef={selectedBlockDef}
          upgradeMenuOpen={upgradeMenuOpen}
          upgradeMenuWeapons={weaponUpgradeInfo}
          upgradeMenuCompanions={companionUpgradeInfo}
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
