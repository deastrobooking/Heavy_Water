import {
  RobotDescriptor, deserializeRobot, serializeRobot, validateStyle,
} from "./RobotDesigner";

/**
 * CreatorDesigns — persistence + validation layer for the player Creator
 * Suite. Designs are stored locally (so the editor works straight from the
 * main menu, before any game systems exist) and mirrored into the
 * ProgressSnapshot (`creatorDesigns`) so they ride along with the cloud save.
 *
 * Robot/pet/enemy designs are stored as a serialized `RobotDescriptor`
 * (the same shape RobotFactory consumes); character designs store the
 * CharacterEditor's SavedCharacter shape. Everything is re-validated
 * (clamped via `validateStyle`) on load and on import, so a hand-edited
 * JSON file can never produce out-of-range geometry.
 */

export type DesignCategory = "robot" | "pet" | "character" | "enemy";

export interface CreatorDesign {
  id: string;
  name: string;
  category: DesignCategory;
  createdAt: number;
  updatedAt: number;
  /** Serialized RobotDescriptor JSON — robot / pet / enemy categories. */
  robotJson?: string;
  /** SavedCharacter-shaped payload — character category. */
  character?: unknown;
}

const STORE_KEY = "hw_creator_designs_v1";
const DEPLOY_KEY = "hw_creator_deploy_v1";

// Hard quotas so the design store can never bloat the cloud-save payload
// past the API body limit: capped design count, capped per-design bytes
// (a valid descriptor is ~1-2 KB; anything bigger is garbage), and a total
// byte budget for the snapshot mirror (newest designs win).
export const MAX_DESIGNS = 50;
const MAX_DESIGN_BYTES = 16 * 1024;
const SNAPSHOT_BYTE_BUDGET = 192 * 1024;

export interface DeployRequest {
  designId: string;
  /** companion = add robot/pet to the player's squad; enemy = spawn a
   *  hostile test unit near the player. */
  action: "companion" | "enemy";
}

// ------------------------------------------------------------------ store

export function listDesigns(): CreatorDesign[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidDesignShape);
  } catch {
    return [];
  }
}

function writeAll(designs: CreatorDesign[]): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(designs)); } catch {}
}

/** Upsert a design. Returns false (and saves nothing) when the design is
 *  oversized or the store is at its cap — callers surface the message. */
export function saveDesign(design: CreatorDesign): boolean {
  if (JSON.stringify(design).length > MAX_DESIGN_BYTES) return false;
  const all = listDesigns();
  const i = all.findIndex(d => d.id === design.id);
  if (i < 0 && all.length >= MAX_DESIGNS) return false;
  design.updatedAt = Date.now();
  if (i >= 0) all[i] = design; else all.push(design);
  writeAll(all);
  return true;
}

export function deleteDesign(id: string): void {
  writeAll(listDesigns().filter(d => d.id !== id));
}

export function getDesign(id: string): CreatorDesign | null {
  return listDesigns().find(d => d.id === id) ?? null;
}

export function newDesignId(): string {
  return `design_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

// ------------------------------------------------------------- validation

function isValidDesignShape(d: any): d is CreatorDesign {
  return d && typeof d.id === "string" && typeof d.name === "string"
    && ["robot", "pet", "character", "enemy"].includes(d.category)
    && (typeof d.robotJson === "string" || d.character !== undefined);
}

/** Parse + clamp a robot design's descriptor. Returns null if corrupt. */
export function descriptorFromDesign(design: CreatorDesign): RobotDescriptor | null {
  if (!design.robotJson) return null;
  try {
    const desc = deserializeRobot(design.robotJson);
    if (!desc?.style?.colors) return null;
    desc.style = validateStyle(desc.style);
    desc.name = design.name || desc.name || "Custom Unit";
    return desc;
  } catch {
    return null;
  }
}

/** Validate + normalize an imported design JSON string. Throws on garbage. */
export function importDesign(json: string): CreatorDesign {
  const obj = JSON.parse(json);
  if (!isValidDesignShape(obj)) throw new Error("Not a valid design file");
  const design: CreatorDesign = {
    id: newDesignId(), // never trust an imported id — avoid collisions
    name: String(obj.name).slice(0, 40) || "Imported Design",
    category: obj.category,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (obj.robotJson) {
    // Round-trip through the validator so out-of-range values are clamped.
    const desc = deserializeRobot(obj.robotJson);
    desc.style = validateStyle(desc.style);
    design.robotJson = serializeRobot(desc);
  }
  if (obj.character) {
    const c = sanitizeCharacterPayload(obj.character);
    if (!c) throw new Error("Invalid character payload");
    design.character = c;
  }
  if (!design.robotJson && !design.character) throw new Error("Design has no payload");
  if (JSON.stringify(design).length > MAX_DESIGN_BYTES) throw new Error("Design file too large");
  return design;
}

/** Runtime shape + range validation for a character design payload —
 *  imported JSON is untrusted, and this payload eventually gets written to
 *  the player's character storage on deploy. Returns null when unusable. */
export function sanitizeCharacterPayload(raw: any): {
  height: number; headScale: number; shoulderWidth: number;
  armLength: number; legLength: number;
  bodyType: "lean" | "athletic" | "heavy";
  armorType: "light" | "heavy" | "captain" | "humanoid";
  colors: { primary: [number, number, number]; secondary: [number, number, number]; skin: [number, number, number]; hair: [number, number, number] };
} | null {
  if (!raw || typeof raw !== "object") return null;
  const num = (v: any, min: number, max: number, fallback: number) =>
    typeof v === "number" && isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  const col = (v: any): [number, number, number] => {
    if (Array.isArray(v) && v.length === 3 && v.every(x => typeof x === "number" && isFinite(x))) {
      return [num(v[0], 0, 1, 0.5), num(v[1], 0, 1, 0.5), num(v[2], 0, 1, 0.5)];
    }
    return [0.5, 0.5, 0.5];
  };
  const bodyTypes = ["lean", "athletic", "heavy"] as const;
  const armorTypes = ["light", "heavy", "captain", "humanoid"] as const;
  return {
    height: num(raw.height, 12, 26, 18),
    headScale: num(raw.headScale, 1.2, 3.5, 2.2),
    shoulderWidth: num(raw.shoulderWidth, 3, 9, 6),
    armLength: num(raw.armLength, 5, 13, 9),
    legLength: num(raw.legLength, 6, 14, 10),
    bodyType: bodyTypes.includes(raw.bodyType) ? raw.bodyType : "athletic",
    armorType: armorTypes.includes(raw.armorType) ? raw.armorType : "humanoid",
    colors: {
      primary: col(raw.colors?.primary),
      secondary: col(raw.colors?.secondary),
      skin: col(raw.colors?.skin),
      hair: col(raw.colors?.hair),
    },
  };
}

// ----------------------------------------------------- save-snapshot mirror

/** Compact form persisted inside ProgressSnapshot. */
export type CreatorDesignSaved = CreatorDesign;

export function designsForSnapshot(): CreatorDesignSaved[] {
  // Newest-first, then take designs until the byte budget is exhausted so
  // the snapshot payload can never outgrow the save API's body limit.
  const sorted = [...listDesigns()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const out: CreatorDesignSaved[] = [];
  let bytes = 0;
  for (const d of sorted) {
    const size = JSON.stringify(d).length;
    if (bytes + size > SNAPSHOT_BYTE_BUDGET) break;
    bytes += size;
    out.push(d);
  }
  return out;
}

/** Merge designs loaded from the cloud save into the local store —
 *  newest `updatedAt` wins per id, nothing is dropped. */
export function mergeDesignsFromSnapshot(saved: unknown[] | undefined): void {
  if (!saved || !Array.isArray(saved) || saved.length === 0) return;
  const local = listDesigns();
  const byId = new Map(local.map(d => [d.id, d]));
  for (const s of saved) {
    if (!isValidDesignShape(s)) continue;
    const existing = byId.get(s.id);
    if (!existing || (s.updatedAt || 0) > (existing.updatedAt || 0)) byId.set(s.id, s);
  }
  writeAll(Array.from(byId.values()));
}

// ------------------------------------------------------------ deploy queue
// The editor lives on the main menu; the game consumes these when playing.

export function queueDeploy(req: DeployRequest): void {
  try {
    const raw = localStorage.getItem(DEPLOY_KEY);
    const arr: DeployRequest[] = raw ? JSON.parse(raw) : [];
    arr.push(req);
    localStorage.setItem(DEPLOY_KEY, JSON.stringify(arr));
  } catch {}
}

export function drainDeployQueue(): DeployRequest[] {
  try {
    const raw = localStorage.getItem(DEPLOY_KEY);
    localStorage.removeItem(DEPLOY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
