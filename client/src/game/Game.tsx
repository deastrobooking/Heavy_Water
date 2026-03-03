import React, { useEffect, useRef, useState, useCallback } from "react";
import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders";
import { BabylonEngine } from "./BabylonEngine";
import { CityGenerator } from "./CityGenerator";
import { PlayerController, PlayerStats } from "./PlayerController";
import { WeaponsSystem, Weapon } from "./WeaponsSystem";
import { EnemySystem } from "./EnemySystem";
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
import { BuildingSystem } from "./BuildingSystem";
import { EventBus, GameEvents } from "./EventBus";
import { DamageType } from "./DamageSystem";
import { GameUI } from "./GameUI";
import { MainMenu } from "./MainMenu";

type GamePhase = "menu" | "playing" | "paused" | "gameover";

export const Game: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BabylonEngine | null>(null);
  const playerRef = useRef<PlayerController | null>(null);
  const weaponsRef = useRef<WeaponsSystem | null>(null);
  const enemySystemRef = useRef<EnemySystem | null>(null);
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
  const buildingRef = useRef<BuildingSystem | null>(null);

  const [gamePhase, setGamePhase] = useState<GamePhase>("menu");
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

    setStats(player.getStats());
  }, [showMessage]);

  const initializeGame = useCallback(() => {
    if (!canvasRef.current) return;

    const bus = EventBus.getInstance();
    bus.clear();

    const engine = new BabylonEngine(canvasRef.current);
    engineRef.current = engine;

    const scene = engine.getScene();

    const cityGenerator = new CityGenerator(scene);
    cityGenerator.generateCity();

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

    const buildingSystem = new BuildingSystem(scene, engine.getCamera(), inventory);
    buildingRef.current = buildingSystem;

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

      capsuleSystem.update(dt, playerPos);
      shopSystem.update();
      buildingSystem.update(dt);

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

      uiThrottleTimer += dt;
      if (uiThrottleTimer >= 0.5) {
        uiThrottleTimer = 0;
        setCompanionCount(companionSystem.getCompanionCount());
        setCompanionInfo(companionSystem.getCompanions());
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

    setGamePhase("playing");
  }, [handleLootCollected, showMessage]);

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
    if (buildingRef.current) buildingRef.current.dispose();
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
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

  useEffect(() => {
    return () => {
      if (combatSystemRef.current) combatSystemRef.current.dispose();
      if (specialWeaponsRef.current) specialWeaponsRef.current.dispose();
      if (beamSabreRef.current) beamSabreRef.current.dispose();
      if (companionRef.current) companionRef.current.dispose();
      if (capsuleRef.current) capsuleRef.current.dispose();
      if (shopRef.current) shopRef.current.dispose();
      if (buildingRef.current) buildingRef.current.dispose();
      if (engineRef.current) engineRef.current.dispose();
      EventBus.getInstance().clear();
    };
  }, []);

  return (
    <div className="w-full h-full bg-black">
      {gamePhase === "menu" && <MainMenu onStart={handleStart} />}

      <canvas
        ref={canvasRef}
        className={`w-full h-full ${gamePhase === "menu" ? "hidden" : ""}`}
        style={{ touchAction: "none" }}
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
