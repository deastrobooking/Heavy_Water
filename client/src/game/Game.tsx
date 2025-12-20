import React, { useEffect, useRef, useState, useCallback } from "react";
import { BabylonEngine } from "./BabylonEngine";
import { CityGenerator } from "./CityGenerator";
import { PlayerController, PlayerStats } from "./PlayerController";
import { WeaponsSystem, Weapon } from "./WeaponsSystem";
import { EnemySystem } from "./EnemySystem";
import { ChestSystem, Loot } from "./ChestSystem";
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

  const [gamePhase, setGamePhase] = useState<GamePhase>("menu");
  const [stats, setStats] = useState<PlayerStats>({
    health: 100,
    maxHealth: 100,
    armor: 50,
    maxArmor: 100,
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

    const engine = new BabylonEngine(canvasRef.current);
    engineRef.current = engine;

    const cityGenerator = new CityGenerator(engine.getScene());
    cityGenerator.generateCity();

    const player = new PlayerController(engine.getScene(), engine.getCamera());
    playerRef.current = player;

    const weapons = new WeaponsSystem(engine.getScene(), engine.getCamera());
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

    const enemySystem = new EnemySystem(engine.getScene());
    enemySystemRef.current = enemySystem;

    const chestSystem = new ChestSystem(engine.getScene());
    chestSystemRef.current = chestSystem;
    chestSystem.setOnLootCollected(handleLootCollected);
    chestSystem.spawnChests(30);

    for (let i = 0; i < 5; i++) {
      enemySystem.spawnEnemy(player.getPosition());
    }

    let lastTime = performance.now();
    let waveTimer = 0;

    engine.start(() => {
      const now = performance.now();
      const deltaTime = now - lastTime;
      lastTime = now;

      player.update();
      const playerPos = player.getPosition();

      const enemyMeshes = enemySystem.getEnemyMeshes();
      const hits = weapons.update(enemyMeshes);

      for (const hit of hits) {
        const result = enemySystem.damageEnemy(hit.hitEnemy, hit.damage);
        if (result.killed) {
          player.addCredits(result.credits);
          player.addExperience(result.experience);
          showMessage(`+${result.credits} CREDITS | +${result.experience} XP`, 1000);
        }
      }

      const enemyResult = enemySystem.update(playerPos, deltaTime);
      if (enemyResult.damage > 0) {
        player.takeDamage(enemyResult.damage);
        showMessage(`-${Math.floor(enemyResult.damage)} DAMAGE!`, 500);
      }

      chestSystem.update(playerPos);

      setStats(player.getStats());
      setEnemyCount(enemySystem.getEnemyCount());
      setChestCount(chestSystem.getChestCount());

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
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
    setStats({
      health: 100,
      maxHealth: 100,
      armor: 50,
      maxArmor: 100,
      credits: 0,
      experience: 0,
      level: 1,
    });
    setWaveNumber(1);
    initializeGame();
  }, [initializeGame]);

  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.dispose();
      }
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
