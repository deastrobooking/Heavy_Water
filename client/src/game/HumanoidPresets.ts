import * as BABYLON from "@babylonjs/core";
import { HumanoidDefinition } from "./HumanoidCharacter";

/**
 * Sub-root visual scale that turns the original ~18-unit "mech" body
 * authoring into a ~2 m humanoid silhouette that actually fits the player's
 * 2 m collision capsule and 2.2 m camera height. Applied uniformly via
 * `HumanoidCharacter.visualRoot.scaling`. Tuning this in one place keeps
 * every preset (player, captains, friendly NPCs) consistent.
 */
const HUMANOID_VISUAL_SCALE = 0.12;

export const HUMANOID_PRESETS: Record<string, HumanoidDefinition> = {
  PlayerDefault: {
    height: 18,
    headScale: 2.2,
    shoulderWidth: 6,
    chestWidth: 6,
    armLength: 9,
    legLength: 10,
    bodyType: "athletic",
    colors: {
      primary: new BABYLON.Color3(0.18, 0.55, 0.95),
      secondary: new BABYLON.Color3(0.06, 0.18, 0.42),
      skin: new BABYLON.Color3(0.92, 0.78, 0.68),
      hair: new BABYLON.Color3(0.08, 0.08, 0.08),
    },
    hasArmor: false,
    armorType: "humanoid",
    visualScale: HUMANOID_VISUAL_SCALE,
  },

  HumanoidCaptainAlpha: {
    height: 20,
    headScale: 2.4,
    shoulderWidth: 6.8,
    chestWidth: 6.6,
    armLength: 10,
    legLength: 11,
    bodyType: "heavy",
    colors: {
      primary: new BABYLON.Color3(0.7, 0.1, 0.1),
      secondary: new BABYLON.Color3(0.4, 0.05, 0.05),
      skin: new BABYLON.Color3(0.85, 0.7, 0.6),
      hair: new BABYLON.Color3(0.2, 0.2, 0.2),
    },
    hasArmor: true,
    armorType: "heavy",
    visualScale: HUMANOID_VISUAL_SCALE,
  },

  HumanoidCaptainBeta: {
    height: 21,
    headScale: 2.3,
    shoulderWidth: 7,
    chestWidth: 6.8,
    armLength: 10.5,
    legLength: 11.5,
    bodyType: "athletic",
    colors: {
      primary: new BABYLON.Color3(0.1, 0.5, 0.2),
      secondary: new BABYLON.Color3(0.05, 0.25, 0.1),
      skin: new BABYLON.Color3(0.88, 0.72, 0.62),
      hair: new BABYLON.Color3(0.3, 0.25, 0.2),
    },
    hasArmor: true,
    armorType: "captain",
    visualScale: HUMANOID_VISUAL_SCALE,
  },

  HumanoidCaptainGamma: {
    height: 19,
    headScale: 2.5,
    shoulderWidth: 6.5,
    chestWidth: 6.3,
    armLength: 9.5,
    legLength: 10.5,
    bodyType: "lean",
    colors: {
      primary: new BABYLON.Color3(0.3, 0.1, 0.5),
      secondary: new BABYLON.Color3(0.15, 0.05, 0.25),
      skin: new BABYLON.Color3(0.92, 0.8, 0.7),
      hair: new BABYLON.Color3(0.4, 0.2, 0.1),
    },
    hasArmor: true,
    armorType: "captain",
    visualScale: HUMANOID_VISUAL_SCALE,
  },

  HumanoidCaptainOmega: {
    height: 22,
    headScale: 2.6,
    shoulderWidth: 7.5,
    chestWidth: 7,
    armLength: 11,
    legLength: 12,
    bodyType: "heavy",
    colors: {
      primary: new BABYLON.Color3(0.2, 0.2, 0.2),
      secondary: new BABYLON.Color3(0.7, 0.6, 0.0),
      skin: new BABYLON.Color3(0.85, 0.72, 0.62),
      hair: new BABYLON.Color3(0.05, 0.05, 0.05),
    },
    hasArmor: true,
    armorType: "captain",
    visualScale: HUMANOID_VISUAL_SCALE,
  },
};
