import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders";

export interface OutlineConfig {
  thickness: number;
  color: BABYLON.Color3;
  enabled: boolean;
}

export class BabylonEngine {
  private canvas: HTMLCanvasElement;
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;
  private outlinePostProcess: BABYLON.PostProcess | null = null;
  private ambientLight: BABYLON.HemisphericLight | null = null;
  private sunLight: BABYLON.DirectionalLight | null = null;
  private boostedMats: WeakSet<BABYLON.StandardMaterial> = new WeakSet();
  private outlineConfig: OutlineConfig = {
    thickness: 1.0,
    color: new BABYLON.Color3(0, 0, 0),
    enabled: true,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = canvas.clientWidth || window.innerWidth;
      canvas.height = canvas.clientHeight || window.innerHeight;
    }

    this.engine = new BABYLON.Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });

    this.scene = new BABYLON.Scene(this.engine);
    this.camera = this.createCamera();
    this.setupLighting();

    try {
      this.setupPostProcessing();
    } catch (e) {
      console.warn("Post-processing setup failed, continuing without it:", e);
    }

    try {
      this.setupCellShadingOutline();
    } catch (e) {
      console.warn("Cell-shading outline setup failed, continuing without it:", e);
    }

    this.boostMaterialBrightness();
  }

  private createCamera(): BABYLON.FreeCamera {
    const camera = new BABYLON.FreeCamera(
      "playerCamera",
      new BABYLON.Vector3(350, 15, 150),
      this.scene
    );
    camera.setTarget(new BABYLON.Vector3(300, 10, 100));
    camera.attachControl(this.canvas, true);
    camera.speed = 0.5;
    camera.angularSensibility = 2000;
    camera.keysUp = [87];
    camera.keysDown = [83];
    camera.keysLeft = [65];
    camera.keysRight = [68];
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
    const defaultPipeline = new BABYLON.DefaultRenderingPipeline(
      "default",
      true,
      this.scene,
      [this.camera]
    );
    
    defaultPipeline.bloomEnabled = true;
    defaultPipeline.bloomThreshold = 0.5;
    defaultPipeline.bloomWeight = 0.25;
    defaultPipeline.bloomKernel = 32;
    defaultPipeline.bloomScale = 0.3;

    defaultPipeline.chromaticAberrationEnabled = true;
    defaultPipeline.chromaticAberration.aberrationAmount = 1.5;

    defaultPipeline.fxaaEnabled = true;
    defaultPipeline.sharpenEnabled = true;
    defaultPipeline.sharpen.edgeAmount = 0.15;

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

  getEngine(): BABYLON.Engine {
    return this.engine;
  }

  start(renderLoop: () => void): void {
    this.engine.runRenderLoop(() => {
      renderLoop();
      this.scene.render();
    });

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  dispose(): void {
    if (this.outlinePostProcess) {
      this.outlinePostProcess.dispose();
    }
    this.scene.dispose();
    this.engine.dispose();
  }
}
