import React from "react";
import { PlayerStats } from "./PlayerController";
import { Weapon, WeaponUpgradeInfo } from "./WeaponsSystem";
import { ArmorUpgrade } from "./ArmorCapsuleSystem";
import { ShopDefinition, ShopItem } from "./ShopSystem";
import { BlockType, BlockDefinition } from "./BuildingSystem";
import { PrefabSummary } from "./PrefabSystem";
import { CompanionUpgradeInfo } from "./CompanionSystem";
import { CapturedCreature } from "./BioCreatureSystem";
import { UpgradeMenu } from "./UpgradeMenu";
import { LabUI, LabBlueprint } from "./LabUI";
import { GardenCaptureUI } from "./GardenCaptureUI";

const BLOCK_LABELS: Record<string, string> = {
  metal_wall: "Wall", glass: "Glass", platform: "Platform", ramp: "Ramp",
  door: "Door", light: "Light", cube: "Cube", sphere: "Sphere",
  pyramid: "Pyramid", pillar: "Pillar", foundation: "Foundation",
  fence: "Fence", neon_strip: "Neon", brick: "Brick", stairs: "Stairs",
  window: "Window", tower: "Tower", cone_roof: "Roof", turret: "Turret",
};

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
  specialWeapons?: { slot: number; name: string; ammo: number; maxAmmo: number; cooldownRemaining: number; level: number }[];
  beamSabreActive?: boolean;
  beamSabreLevel?: number;
  activeElement?: string | null;
  armorDefense?: number;
  companions?: { name: string; type: string; health: number; maxHealth: number }[];
  isFlying?: boolean;
  armorEnergy?: number;
  maxArmorEnergy?: number;
  hasFlightArmor?: boolean;
  capsuleOpen?: boolean;
  capsuleUpgrades?: ArmorUpgrade[];
  onCapsuleUpgrade?: (upgradeId: string) => void;
  shopOpen?: boolean;
  activeShop?: ShopDefinition | null;
  onShopBuy?: (itemId: string) => void;
  buildMode?: boolean;
  planMode?: boolean;
  prefabHotbar?: PrefabSummary[];
  selectedPrefabIndex?: number;
  hotbarBlocks?: BlockType[];
  selectedBlock?: BlockType | null;
  selectedBlockDef?: BlockDefinition | null;
  upgradeMenuOpen?: boolean;
  upgradeMenuWeapons?: WeaponUpgradeInfo[];
  upgradeMenuCompanions?: CompanionUpgradeInfo[];
  upgradeMenuResources?: { gears: number; scrap: number; cores: number; circuits: number; nanofiber: number };
  upgradeMenuPartCounts?: Record<string, number>;
  onUpgradeMenuClose?: () => void;
  onUpgradeWeapon?: (type: string) => void;
  onUpgradeCompanion?: (id: string) => void;
  labOpen?: boolean;
  labLevel?: number;
  labBlueprints?: LabBlueprint[];
  labResources?: { gears: number; scrap: number; cores: number; circuits: number };
  labCapacityUsed?: number;
  labCapacityMax?: number;
  labUpgradeCost?: { gears: number; cores: number; circuits: number } | null;
  labCanUpgrade?: boolean;
  onLabBuild?: (presetName: string) => void;
  onLabUpgrade?: () => void;
  onLabClose?: () => void;
  gardenOpen?: boolean;
  gardenLevel?: number;
  gardenCaptureBonus?: number;
  gardenCapacityMax?: number;
  gardenCaptured?: CapturedCreature[];
  bioEssenceCount?: number;
  gardenUpgradeCost?: { gears: number; nano: number; cores: number } | null;
  gardenCanUpgrade?: boolean;
  onGardenDeploy?: (id: string) => void;
  onGardenUpgrade?: () => void;
  onGardenClose?: () => void;
  onSaveLevel?: () => void;
  onLoadLevel?: () => void;
  onClearLevel?: () => void;
  username?: string | null;
  multiplayerConnected?: boolean;
  inRoom?: boolean;
  roomCode?: string | null;
  isHost?: boolean;
  remotePlayerCount?: number;
  chatMessages?: { username: string; message: string; time: number }[];
  lobbyRooms?: any[];
  showLobby?: boolean;
  onCreateRoom?: () => void;
  onJoinRoom?: (code: string) => void;
  onLeaveRoom?: () => void;
  onRefreshRooms?: () => void;
  onSendChat?: (message: string) => void;
  onToggleLobby?: () => void;
  onLogout?: () => void;
}

const ELEMENT_COLORS: Record<string, { text: string; border: string; bg: string }> = {
  Fire: { text: "text-orange-400", border: "border-orange-500", bg: "bg-orange-900/50" },
  Ice: { text: "text-sky-400", border: "border-sky-500", bg: "bg-sky-900/50" },
  Electric: { text: "text-yellow-300", border: "border-yellow-400", bg: "bg-yellow-900/50" },
  DarkEnergy: { text: "text-purple-400", border: "border-purple-500", bg: "bg-purple-900/50" },
  Insectoid: { text: "text-lime-400", border: "border-lime-500", bg: "bg-lime-900/50" },
};

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
  specialWeapons = [],
  beamSabreActive = false,
  beamSabreLevel = 1,
  activeElement = null,
  armorDefense = 0,
  companions = [],
  isFlying = false,
  armorEnergy = 0,
  maxArmorEnergy = 200,
  hasFlightArmor = false,
  capsuleOpen = false,
  capsuleUpgrades = [],
  onCapsuleUpgrade,
  shopOpen = false,
  activeShop = null,
  onShopBuy,
  buildMode = false,
  planMode = false,
  prefabHotbar = [],
  selectedPrefabIndex = 0,
  hotbarBlocks = [],
  selectedBlock = null,
  selectedBlockDef = null,
  upgradeMenuOpen = false,
  upgradeMenuWeapons = [],
  upgradeMenuCompanions = [],
  upgradeMenuResources = { gears: 0, scrap: 0, cores: 0, circuits: 0, nanofiber: 0 },
  upgradeMenuPartCounts = {},
  onUpgradeMenuClose,
  onUpgradeWeapon,
  onUpgradeCompanion,
  labOpen = false,
  labLevel = 1,
  labBlueprints = [],
  labResources = { gears: 0, scrap: 0, cores: 0, circuits: 0 },
  labCapacityUsed = 0,
  labCapacityMax = 3,
  labUpgradeCost = null,
  labCanUpgrade = false,
  onLabBuild,
  onLabUpgrade,
  onLabClose,
  gardenOpen = false,
  gardenLevel = 1,
  gardenCaptureBonus = 0,
  gardenCapacityMax = 3,
  gardenCaptured = [],
  bioEssenceCount = 0,
  gardenUpgradeCost = null,
  gardenCanUpgrade = false,
  onGardenDeploy,
  onGardenUpgrade,
  onGardenClose,
  onSaveLevel,
  onLoadLevel,
  onClearLevel,
  username = null,
  multiplayerConnected = false,
  inRoom = false,
  roomCode = null,
  isHost = false,
  remotePlayerCount = 0,
  chatMessages = [],
  lobbyRooms = [],
  showLobby = false,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onRefreshRooms,
  onSendChat,
  onToggleLobby,
  onLogout,
}) => {
  const [joinCode, setJoinCode] = React.useState("");
  const [chatInput, setChatInput] = React.useState("");
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
          <div className="text-blue-400 text-xs mb-1">ARMOR {armorDefense > 0 && <span className="text-blue-300">DEF:{armorDefense}</span>}</div>
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

        {hasFlightArmor && (
          <div className="mb-2">
            <div className="text-fuchsia-400 text-xs mb-1">ARMOR ENERGY</div>
            <div className="w-48 h-3 bg-gray-800 border border-fuchsia-500 rounded">
              <div
                className="h-full bg-gradient-to-r from-fuchsia-600 to-fuchsia-400 rounded transition-all"
                style={{ width: `${(armorEnergy / maxArmorEnergy) * 100}%` }}
              />
            </div>
          </div>
        )}

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

        {activeElement && (
          <div className="mt-2">
            <span className={`text-xs px-2 py-1 rounded border ${ELEMENT_COLORS[activeElement]?.text || "text-gray-400"} ${ELEMENT_COLORS[activeElement]?.border || "border-gray-500"} ${ELEMENT_COLORS[activeElement]?.bg || "bg-gray-900/50"}`}>
              {activeElement.toUpperCase()} ELEMENT
            </span>
          </div>
        )}

        {(playerState !== "idle" && playerState !== "moving") && (
          <div className="mt-2">
            <span className={`text-xs px-2 py-1 rounded ${
              playerState === "sprinting" ? "bg-green-900 text-green-400 border border-green-500" :
              playerState === "dodging" ? "bg-cyan-900 text-cyan-400 border border-cyan-500" :
              playerState === "attacking" ? "bg-red-900 text-red-400 border border-red-500" :
              playerState === "jetpack" ? "bg-yellow-900 text-yellow-400 border border-yellow-500" :
              playerState === "flying" ? "bg-fuchsia-900 text-fuchsia-400 border border-fuchsia-500" :
              playerState === "hovering" ? "bg-fuchsia-900 text-fuchsia-300 border border-fuchsia-400" :
              playerState === "stunned" ? "bg-orange-900 text-orange-400 border border-orange-500" :
              "bg-gray-900 text-gray-400 border border-gray-500"
            }`}>
              {playerState.toUpperCase()}
            </span>
          </div>
        )}

        {isFlying && (
          <div className="mt-1">
            <span className="text-xs px-2 py-1 rounded bg-fuchsia-900/80 text-fuchsia-300 border border-fuchsia-400 animate-pulse">
              FLIGHT ACTIVE
            </span>
          </div>
        )}

        {buildMode && (
          <div className="mt-1">
            <span className="text-xs px-2 py-1 rounded bg-amber-900/80 text-amber-300 border border-amber-400 animate-pulse">
              BUILD MODE [G]
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          width: 24,
          height: 24,
          zIndex: 30,
        }}
      >
        <div style={{ position: "absolute", top: 11, left: 0, width: 24, height: 2, background: "rgba(0,255,255,0.85)", boxShadow: "0 0 4px rgba(0,255,255,0.9)" }} />
        <div style={{ position: "absolute", top: 0, left: 11, width: 2, height: 24, background: "rgba(0,255,255,0.85)", boxShadow: "0 0 4px rgba(0,255,255,0.9)" }} />
        <div style={{ position: "absolute", top: 10, left: 10, width: 4, height: 4, borderRadius: "50%", background: "rgba(255,255,255,0.95)", boxShadow: "0 0 4px rgba(0,255,255,1)" }} />
      </div>

      {buildMode && (
        <div
          style={{
            position: "absolute",
            top: "55%",
            left: "50%",
            transform: "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 30,
            background: "rgba(0,0,0,0.7)",
            border: "1px solid rgba(255, 200, 0, 0.7)",
            color: "#ffd866",
            padding: "6px 12px",
            borderRadius: 6,
            fontSize: 11,
            letterSpacing: 0.5,
            whiteSpace: "nowrap",
          }}
        >
          LMB: place • RMB: mine • R: rotate • 1-9 / 0 / - / =: select block
        </div>
      )}

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

        {beamSabreActive && (
          <div className="mt-2 text-xs">
            <span className="text-cyan-300 px-2 py-1 rounded border border-cyan-400 bg-cyan-900/50">
              BEAM SABRE LV{beamSabreLevel}
            </span>
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

      {specialWeapons.length > 0 && (
        <div className="absolute bottom-4 left-72 bg-black/80 border-2 border-pink-400 p-3 rounded-lg">
          <div className="text-pink-400 text-xs mb-2">SPECIAL WEAPONS</div>
          <div className="space-y-1">
            {specialWeapons.map((sw) => (
              <div key={sw.slot} className="flex items-center gap-2 text-xs">
                <span className={`${sw.cooldownRemaining > 0 ? "text-gray-500" : "text-pink-300"}`}>
                  {sw.slot}:{sw.name}
                </span>
                <span className="text-gray-400">
                  {sw.ammo}/{sw.maxAmmo}
                </span>
                {sw.cooldownRemaining > 0 && (
                  <span className="text-red-400">{sw.cooldownRemaining.toFixed(1)}s</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {companions && companions.length > 0 && (
        <div className="absolute left-4 bottom-32 bg-black/80 border-2 border-emerald-600 p-3 rounded-lg text-xs min-w-[140px]">
          <div className="text-emerald-400 font-bold mb-2">COMPANIONS</div>
          {companions.map((c, i) => (
            <div key={i} className="mb-1">
              <div className="flex justify-between text-gray-300">
                <span>{c.name}</span>
                <span className="text-emerald-300">{c.type === "ally" ? "ALLY" : "PET"}</span>
              </div>
              <div className="w-full h-1.5 bg-gray-700 rounded mt-0.5">
                <div
                  className="h-full bg-emerald-500 rounded"
                  style={{ width: `${(c.health / c.maxHealth) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="absolute bottom-4 right-4 bg-black/80 border-2 border-gray-600 p-3 rounded-lg text-xs">
        <div className="text-gray-400 mb-2">CONTROLS</div>
        <div className="text-gray-300 space-y-1">
          <div>WASD - Move | SHIFT - Sprint</div>
          <div>MOUSE - Look | LMB - Fire</div>
          <div>1-6 - Weapons | R - Reload</div>
          <div>7-0 - Special Weapons</div>
          <div>SPACE - Jump (x3 = Fly)</div>
          <div>X - Toggle Flight | G - Build</div>
          <div>Q - Dodge | F - Parry</div>
          <div>V - Melee | B - Heavy Melee</div>
          <div>T - Beam Sabre | E - Interact</div>
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

      {planMode && prefabHotbar && prefabHotbar.length > 0 && (
        <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2">
          <div className="bg-black/85 border-2 border-fuchsia-400/70 rounded-lg px-3 py-2 shadow-lg shadow-fuchsia-500/30 max-w-[90vw]">
            <div className="text-fuchsia-300 text-xs text-center mb-1.5 font-bold tracking-wider">
              PLAN MODE — Wheel/[ ] cycles · LMB Place · RMB Remove · R Rotate · P Exit
            </div>
            <div className="flex gap-1.5 overflow-x-auto">
              {prefabHotbar.map((p, i) => {
                const active = i === selectedPrefabIndex;
                const catColor =
                  p.category === "Defense" ? "text-red-300" :
                  p.category === "Housing" ? "text-emerald-300" :
                  p.category === "Industry" ? "text-cyan-300" : "text-amber-300";
                return (
                  <div
                    key={p.id}
                    className={`min-w-[88px] px-1.5 py-1 text-center text-xs border rounded transition-all flex-shrink-0 ${
                      active
                        ? "border-fuchsia-400 text-white bg-fuchsia-500/30 scale-110 shadow shadow-fuchsia-400/50"
                        : "border-gray-700 text-gray-400 bg-gray-900/60"
                    }`}
                  >
                    <div className={`text-[9px] opacity-80 ${catColor}`}>{p.category.toUpperCase()}</div>
                    <div className="font-semibold text-[11px] leading-tight">{p.name}</div>
                    <div className="text-[8px] opacity-60 mt-0.5">
                      {p.cost.map(c => `${c.quantity}×${c.materialId.split("_")[0]}`).join(" ")}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {(buildMode || planMode) && (onSaveLevel || onLoadLevel || onClearLevel) && (
        <div className="absolute top-4 right-4 pointer-events-auto">
          <div className="bg-black/85 border-2 border-amber-400/70 rounded-lg px-3 py-2 shadow-lg shadow-amber-500/30 flex flex-col gap-1.5">
            <div className="text-amber-300 text-[10px] font-bold tracking-wider text-center">
              LEVEL FILE
            </div>
            <div className="flex gap-1.5">
              {onSaveLevel && (
                <button
                  onClick={onSaveLevel}
                  className="px-2 py-1 text-xs font-bold text-emerald-200 bg-emerald-900/60 border border-emerald-500 rounded hover:bg-emerald-700/60 transition-colors"
                >
                  SAVE
                </button>
              )}
              {onLoadLevel && (
                <button
                  onClick={onLoadLevel}
                  className="px-2 py-1 text-xs font-bold text-cyan-200 bg-cyan-900/60 border border-cyan-500 rounded hover:bg-cyan-700/60 transition-colors"
                >
                  LOAD
                </button>
              )}
              {onClearLevel && (
                <button
                  onClick={onClearLevel}
                  className="px-2 py-1 text-xs font-bold text-red-200 bg-red-900/60 border border-red-500 rounded hover:bg-red-700/60 transition-colors"
                >
                  CLEAR
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {buildMode && hotbarBlocks && hotbarBlocks.length > 0 && (
        <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 max-w-[95vw]">
          <div className="bg-black/85 border-2 border-emerald-400/70 rounded-lg px-3 py-2 shadow-lg shadow-emerald-500/30">
            <div className="text-emerald-300 text-xs text-center mb-1.5 font-bold tracking-wider">
              BUILD HOTBAR — Wheel/1-9 to switch · LMB Place · RMB Mine · R Rotate · GRID-SNAP ON
            </div>
            {selectedBlockDef && (
              <div className="text-center mb-1.5 px-2 py-1 bg-emerald-950/60 border border-emerald-700 rounded">
                <span className="text-emerald-200 font-bold text-sm tracking-wider">
                  {selectedBlockDef.name.toUpperCase()}
                </span>
                <span className="text-zinc-300 text-[11px] ml-2">
                  — {selectedBlockDef.materialCost.map(c => `${c.quantity} ${c.materialId.replace(/_/g, " ")}`).join(", ")}
                </span>
                <span className="text-amber-300 text-[11px] ml-2">· {selectedBlockDef.health} HP</span>
              </div>
            )}
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {hotbarBlocks.map((bt, i) => {
                const active = bt === selectedBlock;
                const keyHint = i < 9 ? `${i + 1}` : i === 9 ? "0" : i === 10 ? "-" : "=";
                return (
                  <div
                    key={bt}
                    className={`min-w-[58px] px-1 py-1 text-center text-xs border rounded transition-all ${
                      active
                        ? "border-emerald-400 text-emerald-200 bg-emerald-500/30 scale-110 shadow shadow-emerald-400/50"
                        : "border-gray-700 text-gray-400 bg-gray-900/60"
                    }`}
                  >
                    <div className="text-[10px] opacity-70">[{keyHint}]</div>
                    <div className="font-semibold">{BLOCK_LABELS[bt] || bt}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <UpgradeMenu
        open={upgradeMenuOpen}
        weapons={upgradeMenuWeapons}
        companions={upgradeMenuCompanions}
        resources={upgradeMenuResources}
        partCounts={upgradeMenuPartCounts}
        onUpgradeWeapon={(t) => onUpgradeWeapon?.(t)}
        onUpgradeCompanion={(id) => onUpgradeCompanion?.(id)}
        onClose={() => onUpgradeMenuClose?.()}
      />

      <LabUI
        open={labOpen}
        level={labLevel}
        maxLevel={3}
        blueprints={labBlueprints}
        resources={labResources}
        capacityUsed={labCapacityUsed}
        capacityMax={labCapacityMax}
        upgradeCost={labUpgradeCost}
        canUpgrade={labCanUpgrade}
        onBuild={(p) => onLabBuild?.(p)}
        onUpgradeLab={() => onLabUpgrade?.()}
        onClose={() => onLabClose?.()}
      />

      <GardenCaptureUI
        open={gardenOpen}
        level={gardenLevel}
        maxLevel={3}
        captureBonus={gardenCaptureBonus}
        capacityMax={gardenCapacityMax}
        captured={gardenCaptured}
        bioEssenceCount={bioEssenceCount}
        upgradeCost={gardenUpgradeCost}
        canUpgradeGarden={gardenCanUpgrade}
        onDeploy={(id) => onGardenDeploy?.(id)}
        onUpgradeGarden={() => onGardenUpgrade?.()}
        onClose={() => onGardenClose?.()}
      />

      {capsuleOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-auto">
          <div className="bg-black/95 border-2 border-cyan-400 rounded-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="text-cyan-400 text-lg font-bold mb-4 text-center">ARMOR CAPSULE LAB</div>
            <div className="text-gray-400 text-xs mb-4 text-center">Select an upgrade to apply</div>
            <div className="space-y-3">
              {capsuleUpgrades.map((upgrade) => (
                <div
                  key={upgrade.id}
                  className={`border rounded-lg p-3 cursor-pointer transition-all hover:bg-gray-800 ${
                    upgrade.applied
                      ? "border-green-600 bg-green-900/30"
                      : stats.credits >= upgrade.cost
                      ? "border-cyan-500 hover:border-cyan-300"
                      : "border-gray-700 opacity-60"
                  }`}
                  onClick={() => !upgrade.applied && onCapsuleUpgrade?.(upgrade.id)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-white text-sm font-bold">{upgrade.name}</div>
                      <div className="text-gray-400 text-xs mt-1">{upgrade.description}</div>
                      <div className="text-xs mt-1">
                        <span className="text-yellow-400">Tier {upgrade.tier}</span>
                        {upgrade.effects?.flightCapability && (
                          <span className="ml-2 text-fuchsia-400">GRANTS FLIGHT</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      {upgrade.applied ? (
                        <span className="text-green-400 text-xs">APPLIED</span>
                      ) : (
                        <span className={`text-xs ${stats.credits >= upgrade.cost ? "text-yellow-400" : "text-red-400"}`}>
                          {upgrade.cost === 0 ? "FREE" : `${upgrade.cost} CR`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-gray-500 text-xs mt-4 text-center">Press ESC to close</div>
          </div>
        </div>
      )}

      {shopOpen && activeShop && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-auto">
          <div className="bg-black/95 border-2 border-emerald-400 rounded-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="text-emerald-400 text-lg font-bold mb-2 text-center">{activeShop.name}</div>
            <div className="text-gray-400 text-xs mb-4 text-center">Credits: {stats.credits}</div>
            <div className="space-y-2">
              {activeShop.items.map((si: ShopItem, idx: number) => (
                <div
                  key={si.item.id + idx}
                  className={`border rounded-lg p-2 cursor-pointer transition-all hover:bg-gray-800 ${
                    si.stock <= 0
                      ? "border-gray-700 opacity-40"
                      : stats.credits >= si.buyPrice
                      ? "border-emerald-600 hover:border-emerald-400"
                      : "border-gray-700 opacity-60"
                  }`}
                  onClick={() => si.stock > 0 && onShopBuy?.(activeShop.id + ":" + idx)}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-white text-xs">{si.item.name}</span>
                      {si.stock <= 0 && <span className="text-red-400 text-xs ml-2">SOLD OUT</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 text-xs">x{si.stock}</span>
                      <span className={`text-xs ${stats.credits >= si.buyPrice ? "text-yellow-400" : "text-red-400"}`}>
                        {si.buyPrice} CR
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-gray-500 text-xs mt-4 text-center">Press E or ESC to close</div>
          </div>
        </div>
      )}

      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 flex items-center gap-3">
        {username && (
          <div className="bg-black/80 border border-cyan-600 px-3 py-1.5 rounded text-xs">
            <span className="text-gray-400">PILOT: </span>
            <span className="text-cyan-400">{username}</span>
          </div>
        )}
        {multiplayerConnected && (
          <div className="bg-black/80 border border-green-600 px-3 py-1.5 rounded text-xs flex items-center gap-2">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-green-400">ONLINE</span>
          </div>
        )}
        {inRoom && roomCode && (
          <div className="bg-black/80 border border-fuchsia-600 px-3 py-1.5 rounded text-xs">
            <span className="text-gray-400">ROOM: </span>
            <span className="text-fuchsia-400">{roomCode}</span>
            <span className="text-gray-500 ml-2">{remotePlayerCount + 1}P</span>
            {isHost && <span className="text-yellow-400 ml-2">HOST</span>}
          </div>
        )}
        {multiplayerConnected && (
          <button
            className="bg-black/80 border border-cyan-600 px-3 py-1.5 rounded text-xs text-cyan-400 pointer-events-auto cursor-pointer hover:bg-cyan-900/30"
            onClick={onToggleLobby}
          >
            {showLobby ? "CLOSE" : "LOBBY"}
          </button>
        )}
        {username && (
          <button
            className="bg-black/80 border border-red-700 px-3 py-1.5 rounded text-xs text-red-400 pointer-events-auto cursor-pointer hover:bg-red-900/30"
            onClick={onLogout}
          >
            LOGOUT
          </button>
        )}
      </div>

      {showLobby && (
        <div className="fixed top-16 left-1/2 transform -translate-x-1/2 w-96 bg-black/95 border-2 border-cyan-500 rounded-xl p-5 z-50 pointer-events-auto">
          <div className="text-cyan-400 text-sm font-bold mb-4 text-center">MULTIPLAYER LOBBY</div>

          {!inRoom ? (
            <>
              <div className="flex gap-2 mb-4">
                <button
                  className="flex-1 bg-cyan-900/40 border border-cyan-500 text-cyan-400 py-2 rounded text-xs hover:bg-cyan-800/60 cursor-pointer"
                  onClick={onCreateRoom}
                >
                  CREATE ROOM
                </button>
                <button
                  className="flex-1 bg-gray-800 border border-gray-600 text-gray-400 py-2 rounded text-xs hover:bg-gray-700 cursor-pointer"
                  onClick={onRefreshRooms}
                >
                  REFRESH
                </button>
              </div>

              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ROOM CODE"
                  maxLength={6}
                  className="flex-1 bg-gray-900 border border-gray-600 text-cyan-400 px-3 py-2 rounded text-xs outline-none"
                />
                <button
                  className="bg-cyan-900/40 border border-cyan-500 text-cyan-400 px-4 py-2 rounded text-xs hover:bg-cyan-800/60 cursor-pointer"
                  onClick={() => { if (joinCode.length >= 4) { onJoinRoom?.(joinCode); setJoinCode(""); } }}
                >
                  JOIN
                </button>
              </div>

              <div className="text-gray-500 text-xs mb-2">AVAILABLE ROOMS</div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {lobbyRooms.length === 0 ? (
                  <div className="text-gray-600 text-xs text-center py-4">No rooms available</div>
                ) : (
                  lobbyRooms.map((room) => (
                    <div
                      key={room.code}
                      className="flex justify-between items-center bg-gray-900 border border-gray-700 rounded p-2 cursor-pointer hover:border-cyan-600"
                      onClick={() => onJoinRoom?.(room.code)}
                    >
                      <div>
                        <span className="text-cyan-400 text-xs">{room.code}</span>
                        <span className="text-gray-500 text-xs ml-2">W{room.wave}</span>
                      </div>
                      <span className="text-gray-400 text-xs">{room.players}/{room.maxPlayers}</span>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-center mb-3">
                <div className="text-fuchsia-400 text-lg">{roomCode}</div>
                <div className="text-gray-500 text-xs">{remotePlayerCount + 1} player(s) connected</div>
              </div>
              <button
                className="w-full bg-red-900/40 border border-red-500 text-red-400 py-2 rounded text-xs hover:bg-red-800/60 cursor-pointer mb-3"
                onClick={onLeaveRoom}
              >
                LEAVE ROOM
              </button>

              <div className="border-t border-gray-700 pt-3">
                <div className="text-gray-500 text-xs mb-2">CHAT</div>
                <div className="max-h-28 overflow-y-auto space-y-1 mb-2">
                  {chatMessages.slice(-10).map((msg, i) => (
                    <div key={i} className="text-xs">
                      <span className="text-cyan-400">{msg.username}: </span>
                      <span className="text-gray-300">{msg.message}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && chatInput.trim()) {
                        onSendChat?.(chatInput.trim());
                        setChatInput("");
                      }
                    }}
                    placeholder="Type message..."
                    maxLength={200}
                    className="flex-1 bg-gray-900 border border-gray-600 text-gray-300 px-2 py-1 rounded text-xs outline-none"
                  />
                  <button
                    className="bg-cyan-900/40 border border-cyan-500 text-cyan-400 px-3 py-1 rounded text-xs cursor-pointer"
                    onClick={() => { if (chatInput.trim()) { onSendChat?.(chatInput.trim()); setChatInput(""); } }}
                  >
                    SEND
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
