import * as BABYLON from "@babylonjs/core";

export type WeatherType = "clear" | "overcast" | "storm";

interface SkyPalette {
  zenith: BABYLON.Color3;
  horizon: BABYLON.Color3;
  sunDisc: BABYLON.Color3;
  sunLight: BABYLON.Color3;
  ambient: BABYLON.Color3;
  ambientGround: BABYLON.Color3;
  fog: BABYLON.Color3;
  sunIntensity: number;
  ambientIntensity: number;
}

const PALETTES: Record<string, SkyPalette> = {
  midnight: {
    zenith: new BABYLON.Color3(0.01, 0.01, 0.05),
    horizon: new BABYLON.Color3(0.05, 0.05, 0.18),
    sunDisc: new BABYLON.Color3(0.6, 0.7, 1.0),
    sunLight: new BABYLON.Color3(0.25, 0.3, 0.6),
    ambient: new BABYLON.Color3(0.25, 0.3, 0.55),
    ambientGround: new BABYLON.Color3(0.1, 0.05, 0.2),
    fog: new BABYLON.Color3(0.04, 0.04, 0.12),
    sunIntensity: 0.3,
    ambientIntensity: 0.35,
  },
  dawn: {
    zenith: new BABYLON.Color3(0.15, 0.2, 0.45),
    horizon: new BABYLON.Color3(1.0, 0.55, 0.35),
    sunDisc: new BABYLON.Color3(1.0, 0.7, 0.4),
    sunLight: new BABYLON.Color3(1.0, 0.65, 0.45),
    ambient: new BABYLON.Color3(0.85, 0.65, 0.7),
    ambientGround: new BABYLON.Color3(0.4, 0.2, 0.25),
    fog: new BABYLON.Color3(0.55, 0.4, 0.4),
    sunIntensity: 0.85,
    ambientIntensity: 0.5,
  },
  day: {
    zenith: new BABYLON.Color3(0.25, 0.55, 0.95),
    horizon: new BABYLON.Color3(0.7, 0.85, 1.0),
    sunDisc: new BABYLON.Color3(1.0, 0.95, 0.85),
    sunLight: new BABYLON.Color3(1.0, 0.95, 0.85),
    ambient: new BABYLON.Color3(0.7, 0.85, 1.0),
    ambientGround: new BABYLON.Color3(0.35, 0.3, 0.4),
    fog: new BABYLON.Color3(0.55, 0.7, 0.9),
    sunIntensity: 1.4,
    ambientIntensity: 0.55,
  },
  dusk: {
    zenith: new BABYLON.Color3(0.25, 0.15, 0.4),
    horizon: new BABYLON.Color3(1.0, 0.4, 0.55),
    sunDisc: new BABYLON.Color3(1.0, 0.55, 0.5),
    sunLight: new BABYLON.Color3(1.0, 0.55, 0.55),
    ambient: new BABYLON.Color3(0.8, 0.55, 0.7),
    ambientGround: new BABYLON.Color3(0.35, 0.15, 0.3),
    fog: new BABYLON.Color3(0.5, 0.3, 0.45),
    sunIntensity: 0.75,
    ambientIntensity: 0.5,
  },
};

export class SkySystem {
  private scene: BABYLON.Scene;
  private skyMesh: BABYLON.Mesh | null = null;
  private skyMat: BABYLON.ShaderMaterial | null = null;
  private sunLight: BABYLON.DirectionalLight | null;
  private ambientLight: BABYLON.HemisphericLight | null;
  private camera: BABYLON.Camera | null;

  private timeOfDay = 8.0;
  private secondsPerDay = 300;
  private weather: WeatherType = "clear";
  private paused = false;
  /** When true, the sky renders a starfield-only "deep space" look — owned
   *  by SpaceLevelSystem (Level 5). Overrides the day/night palette and the
   *  sun disc for as long as the orbital level is active. */
  private spaceMode = false;
  /** Multiplicative RGB tint applied on top of the palette. (1,1,1) = neutral.
   *  Used by LevelSystem to shift the world (e.g. red sky for Level 2). */
  private levelTint: BABYLON.Color3 = new BABYLON.Color3(1, 1, 1);

  /** Throttle for the sky/light uniform recompute. Time-of-day drifts slowly
   *  (a full day is >= 10 real seconds) so re-lerping the palette and pushing
   *  uniforms every frame is wasteful — ~10Hz is visually identical. The
   *  camera-follow position update stays per-frame in update(). */

  // Reusable scratch objects so update()/applyTimeOfDay() don't allocate a
  // fresh Color3/Vector3 every frame. All are mutated in place via
  // copyFrom / set / LerpToRef before being pushed to uniforms.
  private scratchZenith = new BABYLON.Color3();
  private scratchHorizon = new BABYLON.Color3();
  private scratchSunDisc = new BABYLON.Color3();
  private scratchSunLight = new BABYLON.Color3();
  private scratchAmbient = new BABYLON.Color3();
  private scratchAmbientGround = new BABYLON.Color3();
  private scratchFog = new BABYLON.Color3();
  private scratchSunDir = new BABYLON.Vector3();
  private scratchLightDir = new BABYLON.Vector3();
  private scratchClear = new BABYLON.Color4(0, 0, 0, 1);
  // Intermediate palette reused every call by getPaletteInto / applyLevelTint.
  private scratchPalette: SkyPalette = {
    zenith: new BABYLON.Color3(),
    horizon: new BABYLON.Color3(),
    sunDisc: new BABYLON.Color3(),
    sunLight: new BABYLON.Color3(),
    ambient: new BABYLON.Color3(),
    ambientGround: new BABYLON.Color3(),
    fog: new BABYLON.Color3(),
    sunIntensity: 0,
    ambientIntensity: 0,
  };

  constructor(
    scene: BABYLON.Scene,
    sunLight: BABYLON.DirectionalLight | null,
    ambientLight: BABYLON.HemisphericLight | null,
    camera: BABYLON.Camera | null,
  ) {
    this.scene = scene;
    this.sunLight = sunLight;
    this.ambientLight = ambientLight;
    this.camera = camera;
    this.buildSkybox();
    this.applyTimeOfDay();
    console.log("[SkySystem] Initialized at hour", this.timeOfDay.toFixed(1));
  }

  private buildSkybox(): void {
    BABYLON.Effect.ShadersStore["skyGradientVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      varying vec3 vPos;
      void main(){
        vPos = position;
        vec4 pos = worldViewProjection * vec4(position, 1.0);
        // Pin the sky to the far plane (classic skybox trick). Without this
        // the dome is a real 450-radius sphere: any building/floor farther
        // than ~450 units from the camera sat BEHIND the dome's depth, so
        // whenever the dome happened to draw after them (overcast/cloud
        // shading passing overhead made it obvious) the sky painted right
        // over distant geometry — "buildings lose their textures" and the
        // sky "impacting the floor". Forcing z to ~w puts every sky
        // fragment at max depth so real geometry always wins the depth test.
        pos.z = pos.w * 0.9999;
        gl_Position = pos;
      }
    `;
    BABYLON.Effect.ShadersStore["skyGradientFragmentShader"] = `
      precision highp float;
      varying vec3 vPos;
      uniform vec3 zenithColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      uniform float sunSize;
      uniform float starFactor;
      uniform float overcast;
      uniform float time;

      float hash(vec2 p){
        return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453);
      }

      void main(){
        vec3 dir = normalize(vPos);
        float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        float gradient = pow(h, 0.55);
        vec3 col = mix(horizonColor, zenithColor, gradient);

        float sunDot = max(dot(dir, normalize(-sunDir)), 0.0);
        float disc = pow(sunDot, sunSize);
        float halo = pow(sunDot, sunSize * 0.07) * 0.35;
        col += sunColor * (disc + halo);

        // The original dir.y > 0.0 gate stopped the lower hemisphere from
        // ever rendering stars; that's fine for ground levels (terrain
        // occludes them anyway) but the orbital level needs full-sphere
        // coverage. Removing the gate is harmless on the ground because the
        // floor mesh hides the lower hemisphere, but on Level 5 it gives us
        // a true 360° starfield around the player.
        if (starFactor > 0.01) {
          vec2 sUV = floor(dir.xz * 240.0);
          float n = hash(sUV);
          float star = step(0.997, n);
          float twinkle = 0.6 + 0.4 * sin(time * 2.0 + n * 30.0);
          col += vec3(star * twinkle * starFactor);
        }

        col = mix(col, vec3(0.55, 0.55, 0.6) * (0.4 + zenithColor.b * 0.5), overcast * 0.55);
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const sky = BABYLON.MeshBuilder.CreateSphere(
      "skyDome",
      { diameter: 900, segments: 32, sideOrientation: BABYLON.Mesh.BACKSIDE },
      this.scene,
    );
    sky.infiniteDistance = true;
    sky.applyFog = false;
    sky.isPickable = false;

    const mat = new BABYLON.ShaderMaterial(
      "skyGradientMat",
      this.scene,
      { vertex: "skyGradient", fragment: "skyGradient" },
      {
        attributes: ["position"],
        uniforms: [
          "worldViewProjection",
          "zenithColor",
          "horizonColor",
          "sunColor",
          "sunDir",
          "sunSize",
          "starFactor",
          "overcast",
          "time",
        ],
      },
    );
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    sky.material = mat;
    sky.renderingGroupId = 0;

    this.skyMesh = sky;
    this.skyMat = mat;
  }

  private getPalette(): { palette: SkyPalette; phase: string; nightFactor: number } {
    // Fills this.scratchPalette in place (no allocation). The returned object
    // is the shared scratch instance — callers must consume it before the
    // next getPalette() call. getPhase() only reads phase, so that's safe.
    const t = this.timeOfDay % 24;
    let from: SkyPalette;
    let to: SkyPalette;
    let blend: number;
    let phase: string;
    if (t < 5 || t >= 21) {
      from = PALETTES.midnight;
      to = PALETTES.midnight;
      blend = 0;
      phase = "night";
    } else if (t < 7) {
      from = PALETTES.midnight;
      to = PALETTES.dawn;
      blend = (t - 5) / 2;
      phase = "dawn";
    } else if (t < 9) {
      from = PALETTES.dawn;
      to = PALETTES.day;
      blend = (t - 7) / 2;
      phase = "morning";
    } else if (t < 17) {
      from = PALETTES.day;
      to = PALETTES.day;
      blend = 0;
      phase = "day";
    } else if (t < 19) {
      from = PALETTES.day;
      to = PALETTES.dusk;
      blend = (t - 17) / 2;
      phase = "dusk";
    } else {
      from = PALETTES.dusk;
      to = PALETTES.midnight;
      blend = (t - 19) / 2;
      phase = "evening";
    }
    const p = this.scratchPalette;
    BABYLON.Color3.LerpToRef(from.zenith, to.zenith, blend, p.zenith);
    BABYLON.Color3.LerpToRef(from.horizon, to.horizon, blend, p.horizon);
    BABYLON.Color3.LerpToRef(from.sunDisc, to.sunDisc, blend, p.sunDisc);
    BABYLON.Color3.LerpToRef(from.sunLight, to.sunLight, blend, p.sunLight);
    BABYLON.Color3.LerpToRef(from.ambient, to.ambient, blend, p.ambient);
    BABYLON.Color3.LerpToRef(from.ambientGround, to.ambientGround, blend, p.ambientGround);
    BABYLON.Color3.LerpToRef(from.fog, to.fog, blend, p.fog);
    p.sunIntensity = from.sunIntensity + (to.sunIntensity - from.sunIntensity) * blend;
    p.ambientIntensity = from.ambientIntensity + (to.ambientIntensity - from.ambientIntensity) * blend;
    const nightFactor = (t < 5 || t >= 21) ? 1.0 : (t < 6 ? 1.0 - (t - 5) : (t > 20 ? (t - 20) : 0));
    return { palette: p, phase, nightFactor };
  }

  private getSunDirectionInto(out: BABYLON.Vector3): BABYLON.Vector3 {
    const angle = ((this.timeOfDay - 6) / 24) * Math.PI * 2;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    out.set(x * 0.4, -Math.max(y, -0.95), 0.5);
    return out.normalize();
  }

  private getLightDirectionInto(skyDir: BABYLON.Vector3, out: BABYLON.Vector3): BABYLON.Vector3 {
    const y = Math.min(skyDir.y, -0.05);
    out.set(skyDir.x, y, skyDir.z);
    return out.normalize();
  }

  private getSunAltitude(): number {
    const angle = ((this.timeOfDay - 6) / 24) * Math.PI * 2;
    return Math.sin(angle);
  }

  private applyTimeOfDay(): void {
    if (!this.skyMat) return;

    // Deep-space override — owned by SpaceLevelSystem. Bypasses the
    // day/night palette entirely so the orbital level looks like vacuum
    // regardless of the underlying time-of-day clock.
    if (this.spaceMode) {
      this.applySpaceMode();
      return;
    }

    const { palette, nightFactor } = this.getPalette();
    this.applyLevelTintInPlace(palette);
    const sunDir = this.getSunDirectionInto(this.scratchSunDir);
    const overcast = this.weather === "clear" ? 0 : this.weather === "overcast" ? 0.7 : 1.0;

    // Copy palette colours into dedicated scratch so the shared scratchPalette
    // instance is free to be mutated again next call without the material
    // holding a live reference to it.
    this.scratchZenith.copyFrom(palette.zenith);
    this.scratchHorizon.copyFrom(palette.horizon);
    this.scratchSunDisc.copyFrom(palette.sunDisc);
    this.skyMat.setColor3("zenithColor", this.scratchZenith);
    this.skyMat.setColor3("horizonColor", this.scratchHorizon);
    this.skyMat.setColor3("sunColor", this.scratchSunDisc);
    this.skyMat.setVector3("sunDir", sunDir);
    this.skyMat.setFloat("sunSize", 220);
    this.skyMat.setFloat("starFactor", nightFactor * (1.0 - overcast));
    this.skyMat.setFloat("overcast", overcast);
    this.skyMat.setFloat("time", performance.now() / 1000);

    if (this.sunLight) {
      this.getLightDirectionInto(sunDir, this.scratchLightDir);
      this.sunLight.direction.copyFrom(this.scratchLightDir);
      this.scratchSunLight.copyFrom(palette.sunLight);
      this.sunLight.diffuse = this.scratchSunLight;
      const altitude = this.getSunAltitude();
      const horizonFade = BABYLON.Scalar.Clamp(altitude * 4 + 0.1, 0, 1);
      this.sunLight.intensity = palette.sunIntensity * (1.0 - overcast * 0.45) * horizonFade;
    }
    if (this.ambientLight) {
      this.scratchAmbient.copyFrom(palette.ambient);
      this.scratchAmbientGround.copyFrom(palette.ambientGround);
      this.ambientLight.diffuse = this.scratchAmbient;
      this.ambientLight.groundColor = this.scratchAmbientGround;
      this.ambientLight.intensity = palette.ambientIntensity + overcast * 0.1;
    }

    // fog = palette.fog * (1 - overcast*0.3) + (0.4,0.4,0.45) * (overcast*0.3)
    const fogScale = 1.0 - overcast * 0.3;
    const mixScale = overcast * 0.3;
    this.scratchFog.set(
      palette.fog.r * fogScale + 0.4 * mixScale,
      palette.fog.g * fogScale + 0.4 * mixScale,
      palette.fog.b * fogScale + 0.45 * mixScale,
    );
    this.scene.fogColor = this.scratchFog;
    this.scene.fogDensity = 0.0015 + overcast * 0.0025;
    this.scratchClear.set(palette.horizon.r, palette.horizon.g, palette.horizon.b, 1);
    this.scene.clearColor = this.scratchClear;
  }

  update(dtSeconds: number): void {
    if (!this.paused) {
      this.timeOfDay = (this.timeOfDay + (24 / this.secondsPerDay) * dtSeconds) % 24;
      if (this.timeOfDay < 0) this.timeOfDay += 24;
    }
    // Per-frame: the sky dome must track the camera every frame so it never
    // appears to lag behind fast movement. This is cheap (one copyFrom).
    if (this.skyMesh && this.camera) {
      this.skyMesh.position.copyFrom(this.camera.position);
    }
    // Per-frame on purpose: sun direction / light / fog must stay
    // frame-continuous (a 10Hz throttle produced visible stepping at fast
    // day speeds — secondsPerDay can go as low as 10s). The former per-frame
    // allocation cost is gone: applyTimeOfDay now writes exclusively into
    // reusable scratch objects, so this is cheap math + uniform sets.
    this.applyTimeOfDay();
  }

  /** Apply a per-level multiplicative RGB tint over the palette IN PLACE
   *  (mutates the passed scratch palette; no allocation). */
  private applyLevelTintInPlace(p: SkyPalette): void {
    const t = this.levelTint;
    if (t.r === 1 && t.g === 1 && t.b === 1) return;
    const mul = (c: BABYLON.Color3) => {
      c.set(
        Math.min(1, c.r * t.r),
        Math.min(1, c.g * t.g),
        Math.min(1, c.b * t.b),
      );
    };
    mul(p.zenith);
    mul(p.horizon);
    mul(p.sunDisc);
    mul(p.sunLight);
    mul(p.ambient);
    mul(p.ambientGround);
    mul(p.fog);
  }

  /** Hardcoded "deep space" sky — used by SpaceLevelSystem for Level 5.
   *  Renders a starfield against near-black with subtle blue cosmic light. */
  private applySpaceMode(): void {
    if (!this.skyMat) return;
    // Reuse the same scratch objects as the day/night path — space mode's
    // uniforms are constant, but we still avoid per-call allocation for the
    // (throttled) repeated invocations while the orbital level is active.
    this.scratchZenith.set(0.005, 0.008, 0.025);
    this.scratchHorizon.set(0.015, 0.020, 0.045);
    this.skyMat.setColor3("zenithColor", this.scratchZenith);
    this.skyMat.setColor3("horizonColor", this.scratchHorizon);
    // Hide the sun disc entirely — the Earth sphere owned by SpaceLevelSystem
    // takes its place as the "celestial body" the player orients against.
    this.scratchSunDisc.set(0, 0, 0);
    this.skyMat.setColor3("sunColor", this.scratchSunDisc);
    this.scratchSunDir.set(0, -1, 0);
    this.skyMat.setVector3("sunDir", this.scratchSunDir);
    this.skyMat.setFloat("sunSize", 220);
    this.skyMat.setFloat("starFactor", 1.5);
    this.skyMat.setFloat("overcast", 0);
    this.skyMat.setFloat("time", performance.now() / 1000);

    if (this.sunLight) {
      this.scratchLightDir.set(0.2, -0.3, 0.3);
      this.scratchLightDir.normalize();
      this.sunLight.direction.copyFrom(this.scratchLightDir);
      this.scratchSunLight.set(0.6, 0.7, 1.0);
      this.sunLight.diffuse = this.scratchSunLight;
      this.sunLight.intensity = 0.5;
    }
    if (this.ambientLight) {
      this.scratchAmbient.set(0.35, 0.4, 0.6);
      this.scratchAmbientGround.set(0.05, 0.05, 0.15);
      this.ambientLight.diffuse = this.scratchAmbient;
      this.ambientLight.groundColor = this.scratchAmbientGround;
      this.ambientLight.intensity = 0.45;
    }
    this.scratchFog.set(0.005, 0.008, 0.025);
    this.scene.fogColor = this.scratchFog;
    this.scene.fogDensity = 0.0001;
    this.scratchClear.set(0.005, 0.008, 0.025, 1);
    this.scene.clearColor = this.scratchClear;
  }

  /** Toggle deep-space mode — owned by SpaceLevelSystem (Level 5). */
  setSpaceMode(enabled: boolean): void {
    this.spaceMode = enabled;
    this.applyTimeOfDay();
  }

  /** Apply (or clear) the per-level RGB tint and re-render the sky. */
  setLevelTint(tint: { r: number; g: number; b: number }): void {
    this.levelTint = new BABYLON.Color3(tint.r, tint.g, tint.b);
    this.applyTimeOfDay();
  }

  setTimeOfDay(hours: number): void {
    this.timeOfDay = ((hours % 24) + 24) % 24;
    this.applyTimeOfDay();
  }

  getTimeOfDay(): number {
    return this.timeOfDay;
  }

  getPhase(): string {
    return this.getPalette().phase;
  }

  setSecondsPerDay(seconds: number): void {
    this.secondsPerDay = Math.max(10, seconds);
  }

  setWeather(weather: WeatherType): void {
    this.weather = weather;
    this.applyTimeOfDay();
  }

  getWeather(): WeatherType {
    return this.weather;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  dispose(): void {
    if (this.skyMesh) {
      this.skyMesh.dispose();
      this.skyMesh = null;
    }
    if (this.skyMat) {
      this.skyMat.dispose();
      this.skyMat = null;
    }
  }
}
