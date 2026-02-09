import React, { useState, useEffect } from "react";
import { PlayerStats } from "./PlayerController";
import { Weapon } from "./WeaponsSystem";

interface GameUIProps {
  stats: PlayerStats;
  weapon: Weapon | null;
  ammo: number;
  maxAmmo: number;
  enemyCount: number;
  waveNumber: number;
  chestCount: number;
  showMessage: string | null;
  jetpackFuel?: number;
  maxJetpackFuel?: number;
  playerState?: string;
  comboInfo?: { name: string; index: number } | null;
}

export const GameUI: React.FC<GameUIProps> = ({
  stats,
  weapon,
  ammo,
  maxAmmo,
  enemyCount,
  waveNumber,
  chestCount,
  showMessage,
  jetpackFuel = 200,
  maxJetpackFuel = 200,
  playerState = "idle",
  comboInfo = null,
}) => {
  return (
    <div className="fixed inset-0 pointer-events-none" style={{ fontFamily: "'Press Start 2P', monospace" }}>
      <div className="absolute top-4 left-4 bg-black/80 border-2 border-cyan-400 p-4 rounded-lg">
        <div className="text-cyan-400 text-xs mb-2">DETROIT 3026</div>

        <div className="mb-2">
          <div className="text-red-400 text-xs mb-1">HEALTH</div>
          <div className="w-48 h-4 bg-gray-800 border border-red-500 rounded">
            <div
              className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded transition-all"
              style={{ width: `${(stats.health / stats.maxHealth) * 100}%` }}
            />
          </div>
          <div className="text-red-400 text-xs mt-1">{Math.floor(stats.health)} / {stats.maxHealth}</div>
        </div>

        <div className="mb-2">
          <div className="text-blue-400 text-xs mb-1">ARMOR</div>
          <div className="w-48 h-3 bg-gray-800 border border-blue-500 rounded">
            <div
              className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded transition-all"
              style={{ width: `${(stats.armor / stats.maxArmor) * 100}%` }}
            />
          </div>
          <div className="text-blue-400 text-xs mt-1">{Math.floor(stats.armor)} / {stats.maxArmor}</div>
        </div>

        <div className="mb-2">
          <div className="text-green-400 text-xs mb-1">STAMINA</div>
          <div className="w-48 h-3 bg-gray-800 border border-green-500 rounded">
            <div
              className="h-full bg-gradient-to-r from-green-600 to-green-400 rounded transition-all"
              style={{ width: `${(stats.stamina / stats.maxStamina) * 100}%` }}
            />
          </div>
        </div>

        <div className="mb-2">
          <div className="text-yellow-400 text-xs mb-1">JETPACK</div>
          <div className="w-48 h-3 bg-gray-800 border border-yellow-500 rounded">
            <div
              className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 rounded transition-all"
              style={{ width: `${(jetpackFuel / maxJetpackFuel) * 100}%` }}
            />
          </div>
        </div>

        <div className="flex gap-4 text-xs">
          <div>
            <span className="text-yellow-400">CREDITS:</span>
            <span className="text-white ml-2">{stats.credits}</span>
          </div>
          <div>
            <span className="text-purple-400">LVL:</span>
            <span className="text-white ml-2">{stats.level}</span>
          </div>
        </div>

        {playerState !== "idle" && playerState !== "moving" && (
          <div className="mt-2">
            <span className={`text-xs px-2 py-1 rounded ${
              playerState === "sprinting" ? "bg-green-900 text-green-400 border border-green-500" :
              playerState === "dodging" ? "bg-cyan-900 text-cyan-400 border border-cyan-500" :
              playerState === "attacking" ? "bg-red-900 text-red-400 border border-red-500" :
              playerState === "jetpack" ? "bg-yellow-900 text-yellow-400 border border-yellow-500" :
              playerState === "stunned" ? "bg-orange-900 text-orange-400 border border-orange-500" :
              "bg-gray-900 text-gray-400 border border-gray-500"
            }`}>
              {playerState.toUpperCase()}
            </span>
          </div>
        )}
      </div>

      <div className="absolute top-4 right-4 bg-black/80 border-2 border-orange-400 p-4 rounded-lg">
        <div className="text-orange-400 text-xs mb-2">COMBAT STATUS</div>
        <div className="text-xs mb-2">
          <span className="text-red-400">ENEMIES:</span>
          <span className="text-white ml-2">{enemyCount}</span>
        </div>
        <div className="text-xs mb-2">
          <span className="text-cyan-400">WAVE:</span>
          <span className="text-white ml-2">{waveNumber}</span>
        </div>
        <div className="text-xs">
          <span className="text-yellow-400">CHESTS:</span>
          <span className="text-white ml-2">{chestCount}</span>
        </div>
        {comboInfo && (
          <div className="mt-2 text-xs">
            <span className="text-pink-400">COMBO:</span>
            <span className="text-white ml-2">{comboInfo.name} x{comboInfo.index + 1}</span>
          </div>
        )}
      </div>

      <div className="absolute bottom-4 left-4 bg-black/80 border-2 border-purple-400 p-4 rounded-lg">
        <div className="text-purple-400 text-xs mb-2">WEAPON</div>
        {weapon && (
          <>
            <div className="text-white text-sm mb-2">{weapon.name}</div>
            <div className="flex items-center gap-2">
              <div className="w-32 h-3 bg-gray-800 border border-purple-500 rounded">
                <div
                  className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded transition-all"
                  style={{ width: `${(ammo / maxAmmo) * 100}%` }}
                />
              </div>
              <span className="text-purple-400 text-xs">{ammo}/{maxAmmo}</span>
            </div>
          </>
        )}
      </div>

      <div className="absolute bottom-4 right-4 bg-black/80 border-2 border-gray-600 p-3 rounded-lg text-xs">
        <div className="text-gray-400 mb-2">CONTROLS</div>
        <div className="text-gray-300 space-y-1">
          <div>WASD - Move | SHIFT - Sprint</div>
          <div>MOUSE - Look | LMB - Fire</div>
          <div>1-6 - Weapons | R - Reload</div>
          <div>SPACE - Jump/Jetpack</div>
          <div>Q - Dodge | F - Parry</div>
          <div>V - Melee | B - Heavy Melee</div>
        </div>
      </div>

      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
        <div className="w-6 h-6 relative">
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-0.5 h-2 bg-cyan-400" />
          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-0.5 h-2 bg-cyan-400" />
          <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-2 h-0.5 bg-cyan-400" />
          <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-2 h-0.5 bg-cyan-400" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-red-500 rounded-full" />
        </div>
      </div>

      {showMessage && (
        <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2 bg-black/90 border-2 border-cyan-400 px-6 py-3 rounded-lg animate-pulse">
          <div className="text-cyan-400 text-sm">{showMessage}</div>
        </div>
      )}

      <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2">
        <div className="flex gap-2">
          {["1:PISTOL", "2:RIFLE", "3:SHOTGUN", "4:ROCKET", "5:LASER", "6:GRENADE"].map((w, i) => (
            <div
              key={i}
              className={`px-2 py-1 text-xs border rounded ${
                weapon?.type === w.split(":")[1].toLowerCase()
                  ? "border-cyan-400 text-cyan-400 bg-cyan-900/50"
                  : "border-gray-600 text-gray-500"
              }`}
            >
              {w}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
