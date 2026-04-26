import * as BABYLON from "@babylonjs/core";
import { BuildingSystem, BlockType, SerializedBlock } from "./BuildingSystem";
import { PrefabSystem, SerializedPrefab } from "./PrefabSystem";
import { EventBus, GameEvents } from "./EventBus";

export interface SerializedLevel {
  version: 1;
  name: string;
  saved: number;
  blocks: SerializedBlock[];
  prefabs: SerializedPrefab[];
}

export class LevelSerializer {
  private building: BuildingSystem;
  private prefab: PrefabSystem;
  private bus: EventBus;

  constructor(building: BuildingSystem, prefab: PrefabSystem) {
    this.building = building;
    this.prefab = prefab;
    this.bus = EventBus.getInstance();
  }

  serialize(name = "Detroit Build"): SerializedLevel {
    return {
      version: 1,
      name,
      saved: Date.now(),
      blocks: this.building.exportPlaced(),
      prefabs: this.prefab.exportPlaced(),
    };
  }

  toJson(name = "Detroit Build"): string {
    return JSON.stringify(this.serialize(name), null, 2);
  }

  download(filename?: string): void {
    const data = this.serialize();
    const file = filename ?? `detroit-level-${data.saved}.json`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.bus.emit(
      GameEvents.UI_MESSAGE,
      `Saved level: ${data.blocks.length} blocks, ${data.prefabs.length} structures`
    );
    console.log("[LevelSerializer] Downloaded", file, data);
  }

  restore(data: SerializedLevel): { blocks: number; prefabs: number } {
    if (!data || typeof data !== "object" || data.version !== 1) {
      throw new Error("Invalid level data: bad version");
    }
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    const prefabs = Array.isArray(data.prefabs) ? data.prefabs : [];
    if (!Array.isArray(data.blocks) || !Array.isArray(data.prefabs)) {
      console.warn("[LevelSerializer] Missing or non-array blocks/prefabs; treating as empty");
    }
    this.building.clearAll();
    this.prefab.clearAll();
    let bc = 0;
    let pc = 0;
    for (const b of blocks) {
      try {
        if (
          !b ||
          typeof b.type !== "string" ||
          !Array.isArray(b.pos) ||
          b.pos.length !== 3 ||
          typeof b.rot !== "number"
        ) continue;
        const v = new BABYLON.Vector3(b.pos[0], b.pos[1], b.pos[2]);
        if (this.building.placeAt(b.type as BlockType, v, b.rot)) bc++;
      } catch (e) {
        console.warn("[LevelSerializer] Skipped invalid block:", b, e);
      }
    }
    for (const p of prefabs) {
      try {
        if (
          !p ||
          typeof p.defId !== "string" ||
          !Array.isArray(p.pos) ||
          p.pos.length !== 3 ||
          typeof p.rot !== "number"
        ) continue;
        const v = new BABYLON.Vector3(p.pos[0], p.pos[1], p.pos[2]);
        if (this.prefab.placeAt(p.defId, v, p.rot)) pc++;
      } catch (e) {
        console.warn("[LevelSerializer] Skipped invalid prefab:", p, e);
      }
    }
    this.bus.emit(
      GameEvents.UI_MESSAGE,
      `Loaded level "${data.name}": ${bc} blocks, ${pc} structures`
    );
    console.log("[LevelSerializer] Restored", { blocks: bc, prefabs: pc });
    return { blocks: bc, prefabs: pc };
  }

  async loadFromFile(file: File): Promise<{ blocks: number; prefabs: number }> {
    const text = await file.text();
    let data: SerializedLevel;
    try {
      data = JSON.parse(text) as SerializedLevel;
    } catch (e) {
      this.bus.emit(GameEvents.UI_MESSAGE, "Load failed: invalid JSON");
      throw e;
    }
    return this.restore(data);
  }
}
