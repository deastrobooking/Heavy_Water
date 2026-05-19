import React from "react";
import { PlayerStats } from "./PlayerController";
import { Weapon, WeaponUpgradeInfo } from "./WeaponsSystem";
import { ArmorUpgrade } from "./ArmorCapsuleSystem";
import { ShopDefinition, ShopItem } from "./ShopSystem";
import { BlockType, BlockDefinition } from "./BuildingSystem";
import { PrefabSummary } from "./PrefabSystem";
import { CompanionUpgradeInfo } from "./CompanionSystem";
import { CapturedCreature } from "./BioCreatureSystem";
import { UpgradeMenu, type SpecialUpgradeInfo, type CompanionWeaponInfo, type TravelDestinationInfo, type TravelWarpPoint, type WeaponJewelInfo } from "./UpgradeMenu";
import type { JewelTier } from "./JewelSystem";
import type { PlayerUpgradeInfo } from "./PlayerController";
import type { ElementalUpgradeInfo } from "./ElementalSpecialsSystem";
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
  /** Top-center level banner ("LEVEL 1 — RESCUE THE ALLY"). */
  levelBanner?: string | null;
  /** Long-form objective text shown beneath the banner. */
  levelObjective?: string | null;
  /** When non-null, fades a full-screen "LEVEL COMPLETE" overlay in/out. */
  levelCompleteOverlay?: { title: string; subtitle?: string } | null;
  jetpackFuel?: number;
  maxJetpackFuel?: number;
  playerState?: string;
  comboInfo?: { name: string; index: number } | null;
  specialWeapons?: { slot: number; name: string; ammo: number; maxAmmo: number; cooldownRemaining: number; level: number }[];
  elementalSpecials?: { kind: string; name: string; category: string; key: string; level: number; maxLevel: number; cooldownMs: number; cooldownRemaining: number; damagePerHit: number; radius: number; maxTargets: number; isCurrent?: boolean }[];
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
  inVehicle?: boolean;
  prefabHotbar?: PrefabSummary[];
  selectedPrefabIndex?: number;
  hotbarBlocks?: BlockType[];
  selectedBlock?: BlockType | null;
  selectedBlockDef?: BlockDefinition | null;
  upgradeMenuOpen?: boolean;
  upgradeMenuWeapons?: WeaponUpgradeInfo[];
  upgradeMenuCompanions?: CompanionUpgradeInfo[];
  upgradeMenuPlayer?: PlayerUpgradeInfo[];
  upgradeMenuElemental?: ElementalUpgradeInfo[];
  onUpgradeElemental?: (kind: string) => void;
  upgradeMenuResources?: { gears: number; scrap: number; cores: number; circuits: number; nanofiber: number };
  upgradeMenuPartCounts?: Record<string, number>;
  upgradeMenuSpecials?: SpecialUpgradeInfo[];
  upgradeMenuCompanionWeapons?: CompanionWeaponInfo[];
  upgradeMenuTravel?: TravelDestinationInfo[];
  upgradeMenuCurrentLevel?: number;
  onUnlockSpecial?: (id: string) => void;
  onUpgradeCompanionWeapon?: (id: string) => void;
  onFastTravel?: (level: number, warpPoint?: TravelWarpPoint) => void;
  onUpgradeMenuClose?: () => void;
  onUpgradeWeapon?: (type: string) => void;
  onUpgradeCompanion?: (id: string) => void;
  onUpgradePlayer?: (id: string) => void;
  /** Per-weapon Power-Jewel state surfaced into UpgradeMenu's WEAPONS tab. */
  weaponJewelInfo?: Record<string, WeaponJewelInfo>;
  onMountJewel?: (type: string, tier: JewelTier) => void;
  onUnmountJewel?: (type: string) => void;
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
  gardenDexCaughtIds?: string[];
  bioEssenceCount?: number;
  petBondSummary?: string;
  gardenUpgradeCost?: { gears: number; nano: number; cores: number } | null;
  gardenCanUpgrade?: boolean;
  onGardenDeploy?: (id: string) => void;
  onGardenCare?: (id: string) => void;
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
  levelBanner = null,
  levelObjective = null,
  levelCompleteOverlay = null,
  jetpackFuel = 200,
  maxJetpackFuel = 200,
  playerState = "idle",
  comboInfo = null,
  specialWeapons = [],
  elementalSpecials = [],
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
  inVehicle = false,
  planMode = false,
  prefabHotbar = [],
  selectedPrefabIndex = 0,
  hotbarBlocks = [],
  selectedBlock = null,
  selectedBlockDef = null,
  upgradeMenuOpen = false,
  upgradeMenuWeapons = [],
  upgradeMenuCompanions = [],
  upgradeMenuPlayer = [],
  upgradeMenuElemental = [],
  onUpgradeElemental,
  upgradeMenuResources = { gears: 0, scrap: 0, cores: 0, circuits: 0, nanofiber: 0 },
  upgradeMenuPartCounts = {},
  upgradeMenuSpecials = [],
  upgradeMenuCompanionWeapons = [],
  upgradeMenuTravel = [],
  upgradeMenuCurrentLevel = 1,
  onUnlockSpecial,
  onUpgradeCompanionWeapon,
  onFastTravel,
  onUpgradeMenuClose,
  weaponJewelInfo,
  onMountJewel,
  onUnmountJewel,
  onUpgradeWeapon,
  onUpgradeCompanion,
  onUpgradePlayer,
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
  gardenDexCaughtIds = [],
  bioEssenceCount = 0,
  petBondSummary,
  gardenUpgradeCost = null,
  gardenCanUpgrade = false,
  onGardenDeploy,
  onGardenCare,
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

  // ----- Shop navigation (keyboard + gamepad) ------------------------
  // The shop dialog used to be mouse-only, which made it unreachable
  // for controller players (no on-screen cursor) and meant they
  // literally couldn't pick up materials like nano fiber off the
  // shelf. Mirrors the UpgradeMenu pattern: per-tab cursor index,
  // ring highlight, scrollIntoView on cursor move, and a single
  // navigation dispatcher that handles both keyboard (Arrows + Enter
  // + Escape) and gamepad (`gamepad-menu` CustomEvents from
  // GamepadInput's pure-nav menu mode).
  const [shopSelectedIdx, setShopSelectedIdx] = React.useState(0);
  const shopRowRefs = React.useRef<Map<number, HTMLDivElement | null>>(new Map());
  // Reset cursor whenever the shop opens or the active shop / item
  // count changes so we never point past the end of a freshly-loaded
  // shelf. Clamping below also defends against late prop changes.
  const shopItemCount = activeShop?.items.length ?? 0;
  React.useEffect(() => {
    if (shopOpen) setShopSelectedIdx(0);
  }, [shopOpen, activeShop?.id]);
  const shopCurIdx = Math.min(shopSelectedIdx, Math.max(0, shopItemCount - 1));
  React.useEffect(() => {
    if (!shopOpen || !activeShop) return;
    const nav = (action: "up" | "down" | "left" | "right" | "activate" | "close") => {
      if (action === "close") return; // shop close is owned by ShopSystem (E in world); B doesn't force-close here
      if (action === "up" || action === "down") {
        setShopSelectedIdx(prev => {
          const max = Math.max(0, shopItemCount - 1);
          const cur = Math.min(prev, max);
          return Math.max(0, Math.min(max, cur + (action === "down" ? 1 : -1)));
        });
        return;
      }
      if (action === "activate") {
        const item = activeShop.items[shopCurIdx];
        if (!item || item.stock <= 0) return;
        if (stats.credits < item.buyPrice) return;
        onShopBuy?.(activeShop.id + ":" + shopCurIdx);
      }
    };
    const padHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { action?: string } | null;
      if (!detail?.action) return;
      nav(detail.action as Parameters<typeof nav>[0]);
    };
    const keyHandler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      if (e.repeat) return;
      if (e.code === "ArrowUp")        { e.preventDefault(); nav("up"); }
      else if (e.code === "ArrowDown") { e.preventDefault(); nav("down"); }
      else if (e.code === "Enter")     { e.preventDefault(); nav("activate"); }
    };
    window.addEventListener("gamepad-menu", padHandler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("gamepad-menu", padHandler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [shopOpen, activeShop, shopItemCount, shopCurIdx, stats.credits, onShopBuy]);
  React.useEffect(() => {
    if (!shopOpen) return;
    const el = shopRowRefs.current.get(shopCurIdx);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [shopOpen, shopCurIdx]);

  const anyModalOpen =
    upgradeMenuOpen ||
    labOpen ||
    gardenOpen ||
    capsuleOpen ||
    shopOpen ||
    showLobby;
  const shieldRegenLow = stats.maxShield > 0 && stats.shield < stats.maxShield;
  const showCrosshair = !anyModalOpen && !buildMode && !planMode;
  const crosshairSize = inVehicle ? 36 : 24;
  const crosshairColor = inVehicle ? "#fbbf24" : "#67e8f9";
  return (
    <div className="fixed inset-0 pointer-events-none" style={{ fontFamily: "'Press Start 2P', monospace", zIndex: 20 }}>
      {showCrosshair && (
        <div
          className="absolute top-1/2 left-1/2"
          style={{
            transform: "translate(-50%, -50%)",
            width: crosshairSize,
            height: crosshairSize,
            pointerEvents: "none",
          }}
        >
          <svg width={crosshairSize} height={crosshairSize} viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="1.6" fill={crosshairColor} style={{ filter: `drop-shadow(0 0 3px ${crosshairColor})` }} />
            <line x1="18" y1="2" x2="18" y2="10" stroke={crosshairColor} strokeWidth="1.5" style={{ filter: `drop-shadow(0 0 2px ${crosshairColor})` }} />
            <line x1="18" y1="26" x2="18" y2="34" stroke={crosshairColor} strokeWidth="1.5" style={{ filter: `drop-shadow(0 0 2px ${crosshairColor})` }} />
            <line x1="2" y1="18" x2="10" y2="18" stroke={crosshairColor} strokeWidth="1.5" style={{ filter: `drop-shadow(0 0 2px ${crosshairColor})` }} />
            <line x1="26" y1="18" x2="34" y2="18" stroke={crosshairColor} strokeWidth="1.5" style={{ filter: `drop-shadow(0 0 2px ${crosshairColor})` }} />
            {inVehicle && (
              <circle cx="18" cy="18" r="14" fill="none" stroke={crosshairColor} strokeWidth="1" strokeDasharray="2,3" opacity="0.8" />
            )}
          </svg>
        </div>
      )}
      <div
        className="absolute top-4 left-4 bg-black/85 border-[3px] border-cyan-400 p-5 rounded-xl"
        style={{ boxShadow: "0 0 18px rgba(34,211,238,0.45), 0 4px 24px rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", transform: "scale(0.75)", transformOrigin: "top left" }}
      >
        <div className="text-cyan-300 text-sm font-bold mb-3 tracking-widest" style={{ textShadow: "0 0 8px rgba(34,211,238,0.7)" }}>
          HEAVY WATER
        </div>

        {stats.maxShield > 0 && (
          <div className="mb-3">
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-cyan-300 text-sm font-bold tracking-wider" style={{ textShadow: "0 0 6px rgba(103,232,249,0.7)" }}>
                SHIELD {shieldRegenLow && <span className="text-cyan-200 text-[10px] ml-1 animate-pulse">RECHARGING</span>}
              </div>
              <div className="text-cyan-200 text-base font-bold tabular-nums" style={{ textShadow: "0 0 4px rgba(0,0,0,0.9)" }}>
                {Math.floor(stats.shield)}<span className="text-cyan-500/70 text-xs">/{Math.floor(stats.maxShield)}</span>
              </div>
            </div>
            <div className="w-72 h-5 bg-gray-900 border-2 border-cyan-400 rounded-md overflow-hidden" style={{ boxShadow: "inset 0 0 6px rgba(0,0,0,0.7)" }}>
              <div
                className="h-full bg-gradient-to-r from-cyan-700 via-cyan-400 to-cyan-200 transition-all"
                style={{ width: `${(stats.shield / stats.maxShield) * 100}%`, boxShadow: "0 0 12px rgba(103,232,249,0.85)" }}
              />
            </div>
          </div>
        )}

        <div className="mb-3">
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-red-400 text-sm font-bold tracking-wider" style={{ textShadow: "0 0 6px rgba(248,113,113,0.6)" }}>HEALTH</div>
            <div className="text-red-300 text-base font-bold tabular-nums" style={{ textShadow: "0 0 4px rgba(0,0,0,0.9)" }}>
              {Math.floor(stats.health)}<span className="text-red-500/70 text-xs">/{stats.maxHealth}</span>
            </div>
          </div>
          <div className="w-72 h-6 bg-gray-900 border-2 border-red-500 rounded-md overflow-hidden" style={{ boxShadow: "inset 0 0 6px rgba(0,0,0,0.7)" }}>
            <div
              className="h-full bg-gradient-to-r from-red-700 via-red-500 to-red-300 transition-all"
              style={{ width: `${(stats.health / stats.maxHealth) * 100}%`, boxShadow: "0 0 10px rgba(248,113,113,0.7)" }}
            />
          </div>
        </div>

        <div className="mb-3">
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-blue-400 text-sm font-bold tracking-wider" style={{ textShadow: "0 0 6px rgba(96,165,250,0.6)" }}>
              ARMOR {armorDefense > 0 && <span className="text-blue-200 text-xs ml-1">DEF:{armorDefense}</span>}
            </div>
            <div className="text-blue-300 text-base font-bold tabular-nums" style={{ textShadow: "0 0 4px rgba(0,0,0,0.9)" }}>
              {Math.floor(stats.armor)}<span className="text-blue-500/70 text-xs">/{stats.maxArmor}</span>
            </div>
          </div>
          <div className="w-72 h-5 bg-gray-900 border-2 border-blue-500 rounded-md overflow-hidden" style={{ boxShadow: "inset 0 0 6px rgba(0,0,0,0.7)" }}>
            <div
              className="h-full bg-gradient-to-r from-blue-700 via-blue-500 to-blue-300 transition-all"
              style={{ width: `${(stats.armor / stats.maxArmor) * 100}%`, boxShadow: "0 0 10px rgba(96,165,250,0.7)" }}
            />
          </div>
        </div>

        <div className="mb-3">
          <div className="text-green-400 text-xs font-bold tracking-wider mb-1">STAMINA</div>
          <div className="w-72 h-4 bg-gray-900 border-2 border-green-500 rounded-md overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-700 via-green-500 to-green-300 transition-all"
              style={{ width: `${(stats.stamina / stats.maxStamina) * 100}%`, boxShadow: "0 0 8px rgba(74,222,128,0.6)" }}
            />
          </div>
        </div>

        <div className="mb-3">
          <div className="text-yellow-400 text-xs font-bold tracking-wider mb-1">JETPACK</div>
          <div className="w-72 h-4 bg-gray-900 border-2 border-yellow-500 rounded-md overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-yellow-700 via-yellow-500 to-yellow-300 transition-all"
              style={{ width: `${(jetpackFuel / maxJetpackFuel) * 100}%`, boxShadow: "0 0 8px rgba(250,204,21,0.6)" }}
            />
          </div>
        </div>

        {hasFlightArmor && (
          <div className="mb-3">
            <div className="text-fuchsia-400 text-xs font-bold tracking-wider mb-1">ARMOR ENERGY</div>
            <div className="w-72 h-4 bg-gray-900 border-2 border-fuchsia-500 rounded-md overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-fuchsia-700 via-fuchsia-500 to-fuchsia-300 transition-all"
                style={{ width: `${(armorEnergy / maxArmorEnergy) * 100}%`, boxShadow: "0 0 8px rgba(232,121,249,0.6)" }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-5 text-sm font-bold pt-1 border-t-2 border-cyan-500/30">
          <div>
            <span className="text-yellow-400 tracking-wider">CREDITS</span>
            <span className="text-white ml-2 tabular-nums" style={{ textShadow: "0 0 4px rgba(0,0,0,0.9)" }}>{stats.credits}</span>
          </div>
          <div>
            <span className="text-purple-400 tracking-wider">LVL</span>
            <span className="text-white ml-2 tabular-nums" style={{ textShadow: "0 0 4px rgba(0,0,0,0.9)" }}>{stats.level}</span>
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

      {elementalSpecials.length > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/85 border-2 border-cyan-400 p-2 rounded-lg">
          <div className="text-cyan-300 text-[10px] mb-1 text-center font-bold tracking-widest">ELEMENTAL SPECIALS</div>
          <div className="grid grid-cols-6 gap-1.5">
            {elementalSpecials.map((sp) => {
              const ready = sp.cooldownRemaining <= 0;
              const cdPct = ready ? 0 : Math.min(100, (sp.cooldownRemaining / sp.cooldownMs) * 100);
              const colorMap: Record<string, string> = {
                lightning: "border-sky-300 text-sky-200",
                ice: "border-cyan-300 text-cyan-200",
                fireball: "border-orange-400 text-orange-200",
                inferno: "border-red-500 text-red-300",
                windstorm: "border-emerald-300 text-emerald-200",
                psychic: "border-fuchsia-400 text-fuchsia-200",
              };
              const cls = colorMap[sp.kind] ?? "border-white text-white";
              const keyLabel = sp.key.startsWith("Key") ? sp.key.replace("Key", "") : sp.key;
              // Highlight the currently-selected elemental (controller RB
              // fires this one, D-pad Up/Down cycle through the row).
              const selectedRing = sp.isCurrent ? "ring-2 ring-yellow-300 shadow-[0_0_12px_rgba(253,224,71,0.7)]" : "";
              return (
                <div
                  key={sp.kind}
                  className={`relative w-20 h-16 border-2 rounded p-1 ${cls} ${ready ? "bg-black/60" : "bg-black/80 opacity-60"} ${selectedRing}`}
                  title={`${sp.name} — ${sp.category === "tracking" ? `tracks ${sp.maxTargets} targets` : `dome AoE r${sp.radius.toFixed(0)}`}, ${sp.damagePerHit} dmg`}
                >
                  <div className="text-[9px] font-bold leading-tight">{sp.name}</div>
                  <div className="text-[8px] mt-0.5 opacity-80">
                    L{sp.level}/{sp.maxLevel} · {sp.category === "tracking" ? `${sp.maxTargets}T` : `r${sp.radius.toFixed(0)}`}
                  </div>
                  <div className="absolute bottom-0.5 right-1 text-[9px] font-mono opacity-90">[{keyLabel}]</div>
                  {!ready && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-800 overflow-hidden">
                      <div className="h-full bg-cyan-400" style={{ width: `${100 - cdPct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
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

      {/* CONTROLS reference panel deliberately removed — the canonical
          stylish version lives inside the in-game map (`M` key, owned by
          MapSystem.buildControlsPanel) and is grouped by Movement /
          Combat / Build-World / Gamepad. Keeping a second HUD copy here
          duplicated keys and drifted out of sync as new bindings landed
          (e.g. flight toggle, prefab plan-mode, gamepad mappings). */}

      {!anyModalOpen && (
        <div
          className="pointer-events-none"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 30,
            width: 40,
            height: 40,
            filter: "drop-shadow(0 0 3px rgba(0,0,0,0.95)) drop-shadow(0 0 1px rgba(0,0,0,1))",
          }}
        >
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-[3px] h-3 bg-cyan-300" />
          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-[3px] h-3 bg-cyan-300" />
          <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-3 h-[3px] bg-cyan-300" />
          <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-3 h-[3px] bg-cyan-300" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-red-500 rounded-full ring-1 ring-white/80" />
        </div>
      )}

      {showMessage && (
        <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2 bg-black/90 border-2 border-cyan-400 px-6 py-3 rounded-lg animate-pulse">
          <div className="text-cyan-400 text-sm">{showMessage}</div>
        </div>
      )}

      {/* Level banner: top-center anime/sci-fi styled. Shown whenever
          there's an active level (always, after LevelSystem boots). */}
      {levelBanner && (
        <div className="absolute top-3 left-1/2 transform -translate-x-1/2 text-center">
          <div
            className="px-6 py-1.5 rounded-md border-[3px] bg-black/80"
            style={{
              borderColor: "rgba(255,210,90,0.95)",
              boxShadow: "0 0 14px rgba(255,180,40,0.55), inset 0 0 8px rgba(255,180,40,0.25)",
            }}
          >
            <div
              className="text-yellow-200 text-xs tracking-[0.35em] font-bold"
              style={{ textShadow: "0 0 6px rgba(255,200,40,0.85)" }}
            >
              {levelBanner}
            </div>
          </div>
          {levelObjective && (
            <div className="mt-1 text-[10px] text-cyan-200/80 tracking-widest"
                 style={{ textShadow: "0 0 4px rgba(0,0,0,0.9)" }}>
              {levelObjective}
            </div>
          )}
        </div>
      )}

      {/* Level-complete full-screen overlay — fades in for ~3 s when the
          player clears a fortress. Driven by Game.tsx via the prop. */}
      {levelCompleteOverlay && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/55"
          style={{ animation: "fadeInOut 3000ms ease-out forwards" }}
        >
          <div className="text-center">
            <div
              className="text-yellow-200 text-5xl font-extrabold tracking-[0.4em]"
              style={{ textShadow: "0 0 20px rgba(255,210,90,0.9), 0 0 40px rgba(255,160,40,0.6)" }}
            >
              {levelCompleteOverlay.title}
            </div>
            {levelCompleteOverlay.subtitle && (
              <div
                className="mt-4 text-cyan-200 text-sm tracking-[0.3em]"
                style={{ textShadow: "0 0 8px rgba(34,211,238,0.7)" }}
              >
                {levelCompleteOverlay.subtitle}
              </div>
            )}
          </div>
          <style>{`
            @keyframes fadeInOut {
              0%   { opacity: 0; }
              15%  { opacity: 1; }
              80%  { opacity: 1; }
              100% { opacity: 0; }
            }
          `}</style>
        </div>
      )}

      {/*
        Weapon hotbar lives above the elemental specials panel (which sits at
        bottom-4 with ~110px tall icons). bottom-32 keeps it clear of overlap.
        "MISSILE" is the Hunter Missile (`tracking_missile`) — special-cased
        because the label and weapon-type id don't share a stem.
      */}
      <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2">
        <div className="flex gap-2">
          {[
            { label: "1:PISTOL",   type: "pistol" },
            { label: "2:RIFLE",    type: "rifle" },
            { label: "3:SHOTGUN",  type: "shotgun" },
            { label: "4:ROCKET",   type: "rocket" },
            { label: "5:LASER",    type: "laser" },
            { label: "6:GRENADE",  type: "grenade" },
            { label: "P:MISSILE",  type: "tracking_missile" },
          ].map((w) => (
            <div
              key={w.type}
              className={`px-2 py-1 text-xs border rounded ${
                weapon?.type === w.type
                  ? "border-cyan-400 text-cyan-400 bg-cyan-900/50"
                  : "border-gray-600 text-gray-500"
              }`}
            >
              {w.label}
            </div>
          ))}
        </div>
      </div>

      {planMode && prefabHotbar && prefabHotbar.length > 0 && (
        <div className="absolute bottom-44 left-1/2 transform -translate-x-1/2">
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
        playerUpgrades={upgradeMenuPlayer}
        elementalUpgrades={upgradeMenuElemental}
        onUpgradeElemental={(k) => onUpgradeElemental?.(k)}
        playerCredits={stats.credits}
        resources={upgradeMenuResources}
        partCounts={upgradeMenuPartCounts}
        specials={upgradeMenuSpecials}
        companionWeapons={upgradeMenuCompanionWeapons}
        travelDestinations={upgradeMenuTravel}
        currentLevel={upgradeMenuCurrentLevel}
        onUpgradeWeapon={(t) => onUpgradeWeapon?.(t)}
        onUpgradeCompanion={(id) => onUpgradeCompanion?.(id)}
        onUpgradePlayer={(id) => onUpgradePlayer?.(id)}
        onUnlockSpecial={(id) => onUnlockSpecial?.(id)}
        onUpgradeCompanionWeapon={(id) => onUpgradeCompanionWeapon?.(id)}
        onFastTravel={(lvl, warpPoint) => onFastTravel?.(lvl, warpPoint)}
        onClose={() => onUpgradeMenuClose?.()}
        weaponJewelInfo={weaponJewelInfo}
        onMountJewel={onMountJewel}
        onUnmountJewel={onUnmountJewel}
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
        dexCaughtIds={gardenDexCaughtIds}
        bioEssenceCount={bioEssenceCount}
        petBondSummary={petBondSummary}
        upgradeCost={gardenUpgradeCost}
        canUpgradeGarden={gardenCanUpgrade}
        onDeploy={(id) => onGardenDeploy?.(id)}
        onCare={(id) => onGardenCare?.(id)}
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
            <div className="text-gray-400 text-xs mb-1 text-center">Credits: {stats.credits}</div>
            <div className="text-gray-500 text-[10px] mb-3 text-center">[↑/↓] or D-Pad · [Enter] / [A] to buy · [E] to leave</div>
            <div className="space-y-2">
              {activeShop.items.map((si: ShopItem, idx: number) => {
                const selected = idx === shopCurIdx;
                const canBuy = si.stock > 0 && stats.credits >= si.buyPrice;
                return (
                  <div
                    key={si.item.id + idx}
                    ref={(el) => {
                      if (el) shopRowRefs.current.set(idx, el);
                      else shopRowRefs.current.delete(idx);
                    }}
                    className={`border rounded-lg p-2 cursor-pointer transition-all hover:bg-gray-800 ${
                      si.stock <= 0
                        ? "border-gray-700 opacity-40"
                        : stats.credits >= si.buyPrice
                        ? "border-emerald-600 hover:border-emerald-400"
                        : "border-gray-700 opacity-60"
                    } ${selected ? "ring-2 ring-amber-400 ring-offset-1 ring-offset-zinc-900" : ""}`}
                    onClick={() => canBuy && onShopBuy?.(activeShop.id + ":" + idx)}
                    onMouseEnter={() => setShopSelectedIdx(idx)}
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
                );
              })}
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
