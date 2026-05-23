import * as BABYLON from "@babylonjs/core";

export const TERRAIN_TEXTURES = {
  asphalt: "/textures/asphalt.png",
  brick: "/textures/brick.png",
  grass: "/textures/grass.png",
  rock: "/textures/rock.png",
  rockGrass: "/textures/rock_grass.png",
  rockSnow: "/textures/rock_snow.png",
  stone: "/textures/stone.png",
} as const;

export function createRetroTexture(
  scene: BABYLON.Scene,
  url: string,
  tiling: number,
  name?: string,
): BABYLON.Texture {
  const texture = new BABYLON.Texture(url, scene, {
    noMipmap: true,
    invertY: false,
    samplingMode: BABYLON.Texture.NEAREST_SAMPLINGMODE,
    onError: (message) => {
      console.warn(`[TerrainTextureMaterials] Failed to load ${url}`, message);
    },
  });
  if (name) texture.name = name;
  texture.uScale = tiling;
  texture.vScale = tiling;
  texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 1;
  return texture;
}

export function createRetroGroundMaterial(
  scene: BABYLON.Scene,
  name: string,
  url: string,
  tiling: number,
  fallbackDiffuse: BABYLON.Color3,
  emissiveStrength: number = 0.08,
): BABYLON.StandardMaterial {
  const material = new BABYLON.StandardMaterial(name, scene);
  material.diffuseColor = fallbackDiffuse;
  material.emissiveColor = fallbackDiffuse.scale(emissiveStrength);
  material.specularColor = new BABYLON.Color3(0, 0, 0);
  material.diffuseTexture = createRetroTexture(scene, url, tiling, `${name}Tex`);
  return material;
}
