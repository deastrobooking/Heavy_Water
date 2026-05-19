import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders";

export interface OutlineConfig {
  thickness: number;
  color: BABYLON.Color3;
  enabled: boolean;
}

/**
 * LocalStorage flag — set `localStorage.setItem("heavywater:webgpu", "1")`
 * to opt this session into the experimental WebGPU backend. Off by default
 * because our custom cell-shading outline shader is GLSL-ES-1.0 and only
 * compiles on the WebGL2 backend. High-quality post effects can be opted into
 * with `localStorage.setItem("heavywater:graphics", "high")`.
 */
const WEBGPU_FLAG_KEY = "heavywater:webgpu";
const GRAPHICS_QUALITY_KEY = "heavywater:graphics";

function getLocalStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export class BabylonEngine {
  private canvas: HTMLCanvasElement;
  private engine: BABYLON.AbstractEngine;
  private isWebGPU: boolean;
  private highQualityGraphics: boolean;
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private outlinePostProcess: BABYLON.PostProcess | null = null;
  private ambientLight: BABYLON.HemisphericLight | null = null;
  private sunLight: BABYLON.DirectionalLight | null = null;
  private boostedMats: WeakSet<BABYLON.StandardMaterial> = new WeakSet();
  private resizeHandler: (() => void) | null = null;
  private outlineConfig: OutlineConfig = {
    thickness: 1.0,
    color: new BABYLON.Color3(0, 0, 0),
    enabled: true,
  };

  /**
   * Async factory — picks the best supported backend.
   *
   * Order:
   *   1. If `localStorage["heavywater:webgpu"] === "1"` AND WebGPU is
   *      reported supported, try to spin up `BABYLON.WebGPUEngine`.
   *      `initAsync()` can still fail (no adapter, driver bug, etc), in
   *      which case we fall through.
   *   2. Otherwise (or on WebGPU failure), use the classic
   *      WebGL2/`BABYLON.Engine`.
   *
   * The constructor is sync and just stores the already-built engine.
   */
  static async create(canvas: HTMLCanvasElement): Promise<BabylonEngine> {
    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = canvas.clientWidth || window.innerWidth;
      canvas.height = canvas.clientHeight || window.innerHeight;
    }

    const wantsWebGPU =
      typeof window !== "undefined" &&
      getLocalStorageValue(WEBGPU_FLAG_KEY) === "1";

    let engine: BABYLON.AbstractEngine | null = null;
    let isWebGPU = false;

    if (wantsWebGPU) {
      try {
        const WG = (BABYLON as any).WebGPUEngine;
        const supported = WG && typeof WG.IsSupportedAsync !== "undefined"
          ? await WG.IsSupportedAsync
          : false;
        if (supported) {
          const wgEngine = new WG(canvas, {
            antialias: true,
            stencil: true,
          });
          await wgEngine.initAsync();
          engine = wgEngine;
          isWebGPU = true;
          console.log("[BabylonEngine] WebGPU backend active");
        } else {
          console.log("[BabylonEngine] WebGPU requested but not supported here — using WebGL2");
        }
      } catch (e) {
        console.warn("[BabylonEngine] WebGPU init failed, falling back to WebGL2:", e);
        engine = null;
        isWebGPU = false;
      }
    }

    if (!engine) {
      engine = new BABYLON.Engine(canvas, true, {
        preserveDrawingBuffer: false,
        stencil: true,
      });
      isWebGPU = false;
      console.log("[BabylonEngine] WebGL2 backend active");
    }

    return new BabylonEngine(canvas, engine, isWebGPU);
  }

  /**
   * Direct constructor — kept public for back-compat with tests/callers
   * that don't need the WebGPU path. Builds a classic WebGL2 engine.
   * Most callers should use `BabylonEngine.create()` instead so the
   * WebGPU opt-in is honored.
   */
  constructor(
    canvas: HTMLCanvasElement,
    prebuiltEngine?: BABYLON.AbstractEngine,
    isWebGPU: boolean = false,
  ) {
    this.canvas = canvas;
    this.highQualityGraphics = getLocalStorageValue(GRAPHICS_QUALITY_KEY) === "high";

    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = canvas.clientWidth || window.innerWidth;
      canvas.height = canvas.clientHeight || window.innerHeight;
    }

    if (prebuiltEngine) {
      this.engine = prebuiltEngine;
      this.isWebGPU = isWebGPU;
    } else {
      this.engine = new BABYLON.Engine(canvas, true, {
        preserveDrawingBuffer: false,
        stencil: true,
      });
      this.isWebGPU = false;
    }

    // Disable parallel shader compilation. With it on, a freshly-built
    // material can hit a render frame before its GLSL program is linked,
    // causing `effect._pipelineContext.program` to be null and the engine to
    // throw `Cannot read properties of null (reading 'program')` in
    // `bindSamplers`. We hit this consistently during scene rebuilds (death /
    // respawn / restart). Synchronous compile costs a one-off ~tens of ms per
    // rebuild but eliminates the dropped-frame errors entirely.
    // (WebGPU has its own async pipeline-compile flow; the WebGL hack is
    //  not applicable there.)
    if (!this.isWebGPU) {
      try {
        const caps = this.engine.getCaps();
        (caps as { parallelShaderCompile?: unknown }).parallelShaderCompile = undefined;
      } catch (e) {
        console.warn("Could not disable parallel shader compile:", e);
      }
    }

    this.scene = new BABYLON.Scene(this.engine);
    this.camera = this.createCamera();
    this.setupLighting();

    try {
      this.setupPostProcessing();
    } catch (e) {
      console.warn("Post-processing setup failed, continuing without it:", e);
    }

    // Custom GLSL-ES-1.0 cell-shading outline is a full-screen pass backed by
    // depth + normal textures, so keep it for the opt-in high-quality mode.
    if (!this.isWebGPU && this.highQualityGraphics) {
      try {
        this.setupCellShadingOutline();
      } catch (e) {
        console.warn("Cell-shading outline setup failed, continuing without it:", e);
      }
    } else if (this.isWebGPU) {
      console.log("[BabylonEngine] Skipping ink-outline post-process on WebGPU backend");
    }

    this.boostMaterialBrightness();
  }

  /** True if the active backend is WebGPU. Useful for UI badges and for
   *  GPU-only effect paths (GPU particles, compute-driven systems). */
  isUsingWebGPU(): boolean {
    return this.isWebGPU;
  }

  private createCamera(): BABYLON.FreeCamera {
    const camera = new BABYLON.FreeCamera(
      "playerCamera",
      new BABYLON.Vector3(350, 15, 150),
      this.scene
    );
    camera.setTarget(new BABYLON.Vector3(300, 10, 100));
    camera.attachControl(this.canvas, true);
    camera.speed = 0;
    // angularSensibility is INVERSE — larger numbers = LESS sensitive.
    // Bumped from 2000 → 2300 (~15% less sensitive) per player request so
    // aiming feels less twitchy without making the camera sluggish.
    camera.angularSensibility = 2300;
    camera.keysUp = [];
    camera.keysDown = [];
    camera.keysLeft = [];
    camera.keysRight = [];
    camera.minZ = 0.1;
    camera.maxZ = 1000;
    return camera;
  }

  private setupLighting(): void {
    const ambientLight = new BABYLON.HemisphericLight(
      "ambientLight",
      new BABYLON.Vector3(0, 1, 0),
      this.scene
    );
    ambientLight.intensity = 0.4;
    ambientLight.diffuse = new BABYLON.Color3(0.6, 0.7, 1.0);
    ambientLight.groundColor = new BABYLON.Color3(0.2, 0.1, 0.3);
    this.ambientLight = ambientLight;

    const sunLight = new BABYLON.DirectionalLight(
      "sunLight",
      new BABYLON.Vector3(-0.5, -1, 0.5),
      this.scene
    );
    sunLight.intensity = 1.2;
    sunLight.diffuse = new BABYLON.Color3(1, 0.9, 0.7);
    this.sunLight = sunLight;

    const neonGlow = new BABYLON.PointLight(
      "neonGlow",
      new BABYLON.Vector3(0, 20, 0),
      this.scene
    );
    neonGlow.diffuse = new BABYLON.Color3(0, 1, 1);
    neonGlow.intensity = 0.3;
    neonGlow.range = 100;
  }

  private setupPostProcessing(): void {
    const highQuality = this.highQualityGraphics;

    const defaultPipeline = new BABYLON.DefaultRenderingPipeline(
      "default",
      true,
      this.scene,
      [this.camera]
    );
    
    defaultPipeline.bloomEnabled = highQuality;
    if (highQuality) {
      defaultPipeline.bloomThreshold = 0.5;
      defaultPipeline.bloomWeight = 0.25;
      defaultPipeline.bloomKernel = 32;
      defaultPipeline.bloomScale = 0.3;
    }

    defaultPipeline.chromaticAberrationEnabled = highQuality;
    if (highQuality) {
      defaultPipeline.chromaticAberration.aberrationAmount = 1.5;
    }

    defaultPipeline.fxaaEnabled = true;
    defaultPipeline.sharpenEnabled = highQuality;
    if (highQuality) {
      defaultPipeline.sharpen.edgeAmount = 0.15;
    }

    this.scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.08, 1);
    this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.0015;
    this.scene.fogColor = new BABYLON.Color3(0.05, 0.05, 0.15);
  }

  private setupCellShadingOutline(): void {
    this.scene.enableDepthRenderer(this.camera, false);

    const geometryBufferRenderer = this.scene.enableGeometryBufferRenderer();
    if (geometryBufferRenderer) {
      geometryBufferRenderer.enableNormal = true;
    }

    const edgeDetectionFragmentSource = `
      precision highp float;

      varying vec2 vUV;
      uniform sampler2D textureSampler;
      uniform sampler2D depthSampler;
      uniform sampler2D normalSampler;
      uniform float screenWidth;
      uniform float screenHeight;
      uniform float outlineThickness;
      uniform vec3 outlineColor;
      uniform float outlineEnabled;

      float getDepth(vec2 uv) {
        return texture2D(depthSampler, uv).r;
      }

      vec3 getNormal(vec2 uv) {
        return texture2D(normalSampler, uv).rgb * 2.0 - 1.0;
      }

      void main(void) {
        vec4 baseColor = texture2D(textureSampler, vUV);

        if (outlineEnabled < 0.5) {
          gl_FragColor = baseColor;
          return;
        }

        float dx = outlineThickness / screenWidth;
        float dy = outlineThickness / screenHeight;

        float depthCenter = getDepth(vUV);
        float depthLeft   = getDepth(vUV + vec2(-dx, 0.0));
        float depthRight  = getDepth(vUV + vec2( dx, 0.0));
        float depthUp     = getDepth(vUV + vec2(0.0,  dy));
        float depthDown   = getDepth(vUV + vec2(0.0, -dy));
        float depthTL     = getDepth(vUV + vec2(-dx,  dy));
        float depthTR     = getDepth(vUV + vec2( dx,  dy));
        float depthBL     = getDepth(vUV + vec2(-dx, -dy));
        float depthBR     = getDepth(vUV + vec2( dx, -dy));

        float sobelHDepth = -1.0*depthTL + 1.0*depthTR - 2.0*depthLeft + 2.0*depthRight - 1.0*depthBL + 1.0*depthBR;
        float sobelVDepth = -1.0*depthTL - 2.0*depthUp - 1.0*depthTR + 1.0*depthBL + 2.0*depthDown + 1.0*depthBR;
        float depthEdge = sqrt(sobelHDepth * sobelHDepth + sobelVDepth * sobelVDepth);

        vec3 normalCenter = getNormal(vUV);
        vec3 normalLeft   = getNormal(vUV + vec2(-dx, 0.0));
        vec3 normalRight  = getNormal(vUV + vec2( dx, 0.0));
        vec3 normalUp     = getNormal(vUV + vec2(0.0,  dy));
        vec3 normalDown   = getNormal(vUV + vec2(0.0, -dy));

        float normalDiff = 0.0;
        normalDiff += length(normalCenter - normalLeft);
        normalDiff += length(normalCenter - normalRight);
        normalDiff += length(normalCenter - normalUp);
        normalDiff += length(normalCenter - normalDown);
        normalDiff *= 0.25;

        float depthThreshold = 0.002;
        float normalThreshold = 0.3;

        float edge = 0.0;
        if (depthEdge > depthThreshold) edge = 1.0;
        if (normalDiff > normalThreshold) edge = max(edge, 1.0);

        edge = clamp(edge, 0.0, 1.0);

        vec3 finalColor = mix(baseColor.rgb, outlineColor, edge);

        finalColor *= 1.15;

        gl_FragColor = vec4(finalColor, baseColor.a);
      }
    `;

    BABYLON.Effect.ShadersStore["cellOutlineFragmentShader"] = edgeDetectionFragmentSource;

    const depthRenderer = this.scene.enableDepthRenderer(this.camera, false);
    const depthTexture = depthRenderer.getDepthMap();

    let normalTexture: BABYLON.Nullable<BABYLON.BaseTexture> = null;
    if (geometryBufferRenderer) {
      try {
        normalTexture = geometryBufferRenderer.getGBuffer().textures[1];
      } catch (e) {
        console.warn("Could not get normal texture from geometry buffer");
      }
    }

    this.outlinePostProcess = new BABYLON.PostProcess(
      "cellOutline",
      "cellOutline",
      ["screenWidth", "screenHeight", "outlineThickness", "outlineColor", "outlineEnabled"],
      ["depthSampler", "normalSampler"],
      1.0,
      this.camera,
      BABYLON.Texture.BILINEAR_SAMPLINGMODE,
      this.engine,
      false
    );

    this.outlinePostProcess.onApply = (effect: BABYLON.Effect) => {
      effect.setFloat("screenWidth", this.engine.getRenderWidth());
      effect.setFloat("screenHeight", this.engine.getRenderHeight());
      effect.setFloat("outlineThickness", this.outlineConfig.thickness);
      effect.setFloat3("outlineColor", this.outlineConfig.color.r, this.outlineConfig.color.g, this.outlineConfig.color.b);
      effect.setFloat("outlineEnabled", this.outlineConfig.enabled ? 1.0 : 0.0);
      effect.setTexture("depthSampler", depthTexture);
      if (normalTexture) {
        effect.setTexture("normalSampler", normalTexture);
      }
    };
  }

  private boostMaterialBrightness(): void {
    this.scene.onNewMeshAddedObservable.add((mesh) => {
      if (mesh.material && mesh.material instanceof BABYLON.StandardMaterial) {
        const mat = mesh.material as BABYLON.StandardMaterial;
        if (this.boostedMats.has(mat)) return;
        this.boostedMats.add(mat);
        mat.emissiveColor = mat.emissiveColor.add(new BABYLON.Color3(0.08, 0.08, 0.08));
        mat.specularPower = Math.max(mat.specularPower * 0.7, 8);
      }
    });
  }

  getSunLight(): BABYLON.DirectionalLight | null {
    return this.sunLight;
  }

  getAmbientLight(): BABYLON.HemisphericLight | null {
    return this.ambientLight;
  }

  setOutlineConfig(config: Partial<OutlineConfig>): void {
    if (config.thickness !== undefined) this.outlineConfig.thickness = config.thickness;
    if (config.color !== undefined) this.outlineConfig.color = config.color;
    if (config.enabled !== undefined) this.outlineConfig.enabled = config.enabled;
  }

  getOutlineConfig(): OutlineConfig {
    return { ...this.outlineConfig };
  }

  getScene(): BABYLON.Scene {
    return this.scene;
  }

  getCamera(): BABYLON.FreeCamera {
    return this.camera;
  }

  getEngine(): BABYLON.AbstractEngine {
    return this.engine;
  }

  start(renderLoop: () => void): void {
    // Wrap each frame in a try/catch so a single transient Babylon render
    // error (e.g. a shader still parallel-compiling when a material first
    // appears, or a disposed mesh referenced for one frame after a system
    // restart) drops only that frame instead of killing the entire loop.
    // Only log the very first occurrence — these races are expected during
    // scene-rebuild settling and the catch already recovers automatically.
    let renderErrorLogged = false;
    this.engine.runRenderLoop(() => {
      try {
        renderLoop();
      } catch (e) {
        if (!renderErrorLogged) {
          renderErrorLogged = true;
          console.warn("[BabylonEngine] renderLoop callback threw — skipping frame (further errors silenced)", e);
        }
      }
      try {
        this.scene.render();
      } catch (e) {
        if (!renderErrorLogged) {
          renderErrorLogged = true;
          console.warn("[BabylonEngine] scene.render() threw — skipping frame (further errors silenced)", e);
        }
      }
    });

    this.resizeHandler = () => {
      this.engine.resize();
    };
    window.addEventListener("resize", this.resizeHandler);
  }

  dispose(): void {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.outlinePostProcess) {
      this.outlinePostProcess.dispose();
      this.outlinePostProcess = null;
    }
    this.scene.dispose();
    this.engine.dispose();
  }
}
