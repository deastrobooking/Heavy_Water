import * as BABYLON from "@babylonjs/core";

export type ArmorMaterialKey = "metal" | "black" | "ceramic" | "gold" | "neon" | "trim";

export interface ArmorPalette {
  primary: BABYLON.Color3;
  secondary: BABYLON.Color3;
  trim: BABYLON.Color3;
  glow: BABYLON.Color3;
}

export class ArmorMaterialFactory {
  private scene: BABYLON.Scene;
  private cache: Map<string, BABYLON.StandardMaterial> = new Map();
  private palette: ArmorPalette;
  private salt: string;

  constructor(scene: BABYLON.Scene, palette: ArmorPalette, salt: string = "default") {
    this.scene = scene;
    this.palette = palette;
    this.salt = salt;
  }

  metal(): BABYLON.StandardMaterial {
    return this.getOrCreate("metal", () => {
      const m = new BABYLON.StandardMaterial(`armor_metal_${this.salt}`, this.scene);
      m.diffuseColor = this.palette.primary;
      m.specularColor = new BABYLON.Color3(0.85, 0.85, 0.95);
      m.specularPower = 96;
      m.emissiveColor = this.palette.primary.scale(0.05);
      return m;
    });
  }

  black(): BABYLON.StandardMaterial {
    return this.getOrCreate("black", () => {
      const m = new BABYLON.StandardMaterial(`armor_black_${this.salt}`, this.scene);
      m.diffuseColor = new BABYLON.Color3(0.06, 0.06, 0.08);
      m.specularColor = new BABYLON.Color3(0.3, 0.3, 0.35);
      m.specularPower = 64;
      return m;
    });
  }

  ceramic(): BABYLON.StandardMaterial {
    return this.getOrCreate("ceramic", () => {
      const m = new BABYLON.StandardMaterial(`armor_ceramic_${this.salt}`, this.scene);
      m.diffuseColor = this.palette.secondary;
      m.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
      m.specularPower = 8;
      return m;
    });
  }

  gold(): BABYLON.StandardMaterial {
    return this.getOrCreate("gold", () => {
      const m = new BABYLON.StandardMaterial(`armor_gold_${this.salt}`, this.scene);
      m.diffuseColor = this.palette.trim;
      m.specularColor = new BABYLON.Color3(1.0, 0.9, 0.5);
      m.emissiveColor = this.palette.trim.scale(0.25);
      m.specularPower = 128;
      return m;
    });
  }

  neon(): BABYLON.StandardMaterial {
    return this.getOrCreate("neon", () => {
      const m = new BABYLON.StandardMaterial(`armor_neon_${this.salt}`, this.scene);
      m.diffuseColor = this.palette.glow;
      m.emissiveColor = this.palette.glow;
      m.disableLighting = true;
      return m;
    });
  }

  trim(): BABYLON.StandardMaterial {
    return this.getOrCreate("trim", () => {
      const m = new BABYLON.StandardMaterial(`armor_trim_${this.salt}`, this.scene);
      m.diffuseColor = this.palette.trim;
      m.emissiveColor = this.palette.trim.scale(0.3);
      m.specularColor = new BABYLON.Color3(0.7, 0.7, 0.7);
      return m;
    });
  }

  get(key: ArmorMaterialKey): BABYLON.StandardMaterial {
    switch (key) {
      case "metal": return this.metal();
      case "black": return this.black();
      case "ceramic": return this.ceramic();
      case "gold": return this.gold();
      case "neon": return this.neon();
      case "trim": return this.trim();
    }
  }

  private getOrCreate(key: string, factory: () => BABYLON.StandardMaterial): BABYLON.StandardMaterial {
    const existing = this.cache.get(key);
    if (existing) return existing;
    const created = factory();
    this.cache.set(key, created);
    return created;
  }

  dispose(): void {
    this.cache.forEach((m) => m.dispose());
    this.cache.clear();
  }
}
