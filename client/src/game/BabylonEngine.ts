import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders";

export class BabylonEngine {
  private canvas: HTMLCanvasElement;
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera: BABYLON.FreeCamera;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = new BABYLON.Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });
    this.scene = new BABYLON.Scene(this.engine);
    this.camera = this.createCamera();
    this.setupLighting();
    this.setupPostProcessing();
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
    camera.keysUp = [87]; // W
    camera.keysDown = [83]; // S
    camera.keysLeft = [65]; // A
    camera.keysRight = [68]; // D
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

    const sunLight = new BABYLON.DirectionalLight(
      "sunLight",
      new BABYLON.Vector3(-0.5, -1, 0.5),
      this.scene
    );
    sunLight.intensity = 1.2;
    sunLight.diffuse = new BABYLON.Color3(1, 0.9, 0.7);

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
    defaultPipeline.chromaticAberration.aberrationAmount = 8;

    defaultPipeline.fxaaEnabled = true;
    defaultPipeline.sharpenEnabled = true;
    defaultPipeline.sharpen.edgeAmount = 0.15;

    this.scene.clearColor = new BABYLON.Color4(0.02, 0.02, 0.08, 1);
    this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.0015;
    this.scene.fogColor = new BABYLON.Color3(0.05, 0.05, 0.15);
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
    this.scene.dispose();
    this.engine.dispose();
  }
}
