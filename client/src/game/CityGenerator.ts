import * as BABYLON from "@babylonjs/core";

interface BuildingConfig {
  minHeight: number;
  maxHeight: number;
  minWidth: number;
  maxWidth: number;
  density: number;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export class CityGenerator {
  private scene: BABYLON.Scene;
  private buildings: BABYLON.Mesh[] = [];
  private platforms: BABYLON.Mesh[] = [];
  private cellShadeMaterial: BABYLON.ShaderMaterial | null = null;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.createCellShadeMaterial();
  }

  private createCellShadeMaterial(): void {
    BABYLON.Effect.ShadersStore["cellVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      attribute vec3 normal;
      uniform mat4 worldViewProjection;
      uniform mat4 world;
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        gl_Position = worldViewProjection * vec4(position, 1.0);
        vNormal = normalize((world * vec4(normal, 0.0)).xyz);
        vPosition = (world * vec4(position, 1.0)).xyz;
      }
    `;

    BABYLON.Effect.ShadersStore["cellFragmentShader"] = `
      precision highp float;
      varying vec3 vNormal;
      varying vec3 vPosition;
      uniform vec3 lightDirection;
      uniform vec3 baseColor;
      uniform vec3 glowColor;
      void main() {
        float intensity = dot(vNormal, -lightDirection);
        float cellShade;
        if (intensity > 0.85) cellShade = 1.0;
        else if (intensity > 0.6) cellShade = 0.75;
        else if (intensity > 0.35) cellShade = 0.55;
        else if (intensity > 0.1) cellShade = 0.35;
        else cellShade = 0.2;
        
        vec3 finalColor = baseColor * cellShade;
        
        vec3 viewDir = normalize(-vPosition);
        float rim = 1.0 - max(dot(vNormal, viewDir), 0.0);
        rim = smoothstep(0.6, 1.0, rim);
        finalColor += glowColor * rim * 0.6;
        
        float outline = smoothstep(0.15, 0.2, abs(dot(vNormal, viewDir)));
        finalColor *= outline;
        
        float panelLine = step(0.98, fract(vPosition.y * 0.15)) + step(0.98, fract(vPosition.x * 0.1));
        finalColor += glowColor * panelLine * 0.15;
        
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;
  }

  private createBuildingMaterial(color: BABYLON.Color3, glowColor: BABYLON.Color3): BABYLON.ShaderMaterial {
    const material = new BABYLON.ShaderMaterial(
      "cellMat_" + Math.random(),
      this.scene,
      { vertex: "cell", fragment: "cell" },
      {
        attributes: ["position", "normal"],
        uniforms: ["worldViewProjection", "world", "lightDirection", "baseColor", "glowColor"],
      }
    );
    material.setVector3("lightDirection", new BABYLON.Vector3(-0.5, -1, 0.5).normalize());
    material.setColor3("baseColor", color);
    material.setColor3("glowColor", glowColor);
    material.backFaceCulling = true;
    return material;
  }

  generateCity(): void {
    this.createGround();
    this.createRiver();
    this.createDowntown();
    this.createIndustrialZone();
    this.createResidentialBlocks();
    this.createHighways();
    this.createNeonLights();
    this.createSpaceports();
    this.createStreetLights();
    this.createMountainZone();
    this.createNatureZone();
    this.createSkyCities();
    this.createSkyBridges();
    this.createOuterDistricts();
  }

  private createGround(): void {
    const ground = BABYLON.MeshBuilder.CreateGround(
      "ground",
      { width: 1200, height: 1200, subdivisions: 80 },
      this.scene
    );
    
    const groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.12);
    groundMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.3);
    groundMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.05);
    ground.material = groundMat;
    ground.receiveShadows = true;
  }

  private createRiver(): void {
    BABYLON.Effect.ShadersStore["waterVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      attribute vec2 uv;
      uniform mat4 worldViewProjection;
      uniform mat4 world;
      uniform float time;
      varying vec2 vUV;
      varying vec3 vPosition;
      varying float vWave;
      void main() {
        vec3 pos = position;
        float wave1 = sin(pos.x * 0.15 + time * 1.5) * 0.3;
        float wave2 = sin(pos.x * 0.08 + pos.z * 0.1 + time * 0.8) * 0.2;
        float wave3 = cos(pos.z * 0.12 + time * 1.2) * 0.15;
        pos.y += wave1 + wave2 + wave3;
        vWave = (wave1 + wave2 + wave3) * 0.5 + 0.5;
        gl_Position = worldViewProjection * vec4(pos, 1.0);
        vUV = uv;
        vPosition = (world * vec4(pos, 1.0)).xyz;
      }
    `;

    BABYLON.Effect.ShadersStore["waterFragmentShader"] = `
      precision highp float;
      varying vec2 vUV;
      varying vec3 vPosition;
      varying float vWave;
      uniform float time;
      void main() {
        vec3 deepColor = vec3(0.0, 0.08, 0.2);
        vec3 shallowColor = vec3(0.0, 0.3, 0.5);
        vec3 foamColor = vec3(0.2, 0.6, 0.8);
        float foam = smoothstep(0.6, 0.8, vWave);
        vec3 waterColor = mix(deepColor, shallowColor, vWave);
        waterColor = mix(waterColor, foamColor, foam * 0.4);
        float sparkle = pow(sin(vPosition.x * 2.0 + time * 3.0) * sin(vPosition.z * 2.5 + time * 2.0), 8.0) * 0.3;
        waterColor += vec3(sparkle * 0.5, sparkle * 0.8, sparkle);
        float neonReflect = sin(vPosition.x * 0.05 + time * 0.5) * 0.5 + 0.5;
        waterColor += vec3(neonReflect * 0.05, neonReflect * 0.02, neonReflect * 0.08);
        gl_FragColor = vec4(waterColor, 0.85);
      }
    `;

    const riverPath: BABYLON.Vector3[] = [];
    for (let i = -600; i <= 600; i += 5) {
      const z = -200 + Math.sin(i * 0.015) * 30 + Math.sin(i * 0.005) * 50;
      riverPath.push(new BABYLON.Vector3(i, 0.1, z));
    }

    const river = BABYLON.MeshBuilder.CreateRibbon(
      "river",
      {
        pathArray: [
          riverPath.map((p) => new BABYLON.Vector3(p.x, p.y, p.z - 35)),
          riverPath.map((p) => new BABYLON.Vector3(p.x, p.y, p.z + 35)),
        ],
        sideOrientation: BABYLON.Mesh.DOUBLESIDE,
      },
      this.scene
    );

    const waterMat = new BABYLON.ShaderMaterial(
      "waterShader",
      this.scene,
      { vertex: "water", fragment: "water" },
      {
        attributes: ["position", "uv"],
        uniforms: ["worldViewProjection", "world", "time"],
      }
    );
    waterMat.setFloat("time", 0);
    waterMat.alpha = 0.85;
    waterMat.backFaceCulling = false;
    river.material = waterMat;

    this.scene.onBeforeRenderObservable.add(() => {
      waterMat.setFloat("time", performance.now() / 1000);
    });
  }

  private createStreetLights(): void {
    const lightColorOptions = [
      new BABYLON.Color3(0, 1, 1),
      new BABYLON.Color3(1, 0, 1),
      new BABYLON.Color3(1, 0.7, 0),
    ];

    let seed = 42;
    for (let x = -200; x <= 200; x += 30) {
      for (let z = -200; z <= 200; z += 60) {
        if (Math.abs(z + 200) < 40) continue;

        const poleHeight = 8;
        const pole = BABYLON.MeshBuilder.CreateCylinder(
          "streetPole",
          { height: poleHeight, diameter: 0.3 },
          this.scene
        );
        pole.position = new BABYLON.Vector3(x, poleHeight / 2, z);

        const poleMat = new BABYLON.StandardMaterial("poleMat", this.scene);
        poleMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.2);
        poleMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.03);
        pole.material = poleMat;

        const lamp = BABYLON.MeshBuilder.CreateSphere("streetLamp", { diameter: 0.8 }, this.scene);
        lamp.position = new BABYLON.Vector3(x, poleHeight + 0.2, z);

        seed++;
        const colorIdx = Math.floor(seededRandom(seed) * lightColorOptions.length);
        const color = lightColorOptions[colorIdx];
        const lampMat = new BABYLON.StandardMaterial("lampMat", this.scene);
        lampMat.emissiveColor = color;
        lampMat.diffuseColor = color;
        lamp.material = lampMat;

        if ((x + z) % 90 === 0) {
          const light = new BABYLON.PointLight("streetLight", new BABYLON.Vector3(x, poleHeight + 0.5, z), this.scene);
          light.diffuse = color;
          light.intensity = 0.6;
          light.range = 25;
        }
      }
    }
  }

  private createDowntown(): void {
    const colors = [
      { base: new BABYLON.Color3(0.15, 0.15, 0.2), glow: new BABYLON.Color3(0, 1, 1) },
      { base: new BABYLON.Color3(0.12, 0.12, 0.18), glow: new BABYLON.Color3(1, 0, 1) },
      { base: new BABYLON.Color3(0.18, 0.15, 0.2), glow: new BABYLON.Color3(1, 0.5, 0) },
      { base: new BABYLON.Color3(0.1, 0.15, 0.2), glow: new BABYLON.Color3(0, 1, 0.5) },
    ];

    let seed = 100;
    for (let x = -100; x <= 100; x += 25) {
      for (let z = -80; z <= 80; z += 25) {
        if (Math.abs(z) > 150) continue;
        
        seed++;
        const height = 30 + seededRandom(seed) * 120;
        const width = 8 + seededRandom(seed + 1000) * 12;
        const depth = 8 + seededRandom(seed + 2000) * 12;

        const building = BABYLON.MeshBuilder.CreateBox(
          `downtown_${x}_${z}`,
          { height, width, depth },
          this.scene
        );
        building.position = new BABYLON.Vector3(
          x + (seededRandom(seed + 3000) - 0.5) * 10,
          height / 2,
          z + (seededRandom(seed + 4000) - 0.5) * 10
        );

        const colorSet = colors[Math.floor(seededRandom(seed + 5000) * colors.length)];
        building.material = this.createBuildingMaterial(colorSet.base, colorSet.glow);
        this.buildings.push(building);

        this.addRooftopPlatform(building.position.x, height, building.position.z, width, depth);

        if (height > 80) {
          this.addBuildingDetails(building, height, width, depth);
        }
      }
    }
  }

  private addRooftopPlatform(x: number, height: number, z: number, width: number, depth: number): void {
    const platW = width + 4;
    const platD = depth + 4;
    const rooftop = BABYLON.MeshBuilder.CreateBox(
      `rooftop_${x}_${z}`,
      { height: 1, width: platW, depth: platD },
      this.scene
    );
    rooftop.position = new BABYLON.Vector3(x, height + 0.5, z);

    const rooftopMat = new BABYLON.StandardMaterial("rooftopMat", this.scene);
    rooftopMat.diffuseColor = new BABYLON.Color3(0.15, 0.18, 0.22);
    rooftopMat.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.05);
    rooftop.material = rooftopMat;

    const edgeMat = new BABYLON.StandardMaterial("roofEdgeMat", this.scene);
    edgeMat.emissiveColor = new BABYLON.Color3(0, 0.5, 0.7);
    edgeMat.diffuseColor = new BABYLON.Color3(0, 0.2, 0.3);

    const edgeN = BABYLON.MeshBuilder.CreateBox(`roofEdge`, { height: 0.3, width: platW, depth: 0.3 }, this.scene);
    edgeN.position = new BABYLON.Vector3(x, height + 1.15, z + platD / 2);
    edgeN.material = edgeMat;
    const edgeS = BABYLON.MeshBuilder.CreateBox(`roofEdge`, { height: 0.3, width: platW, depth: 0.3 }, this.scene);
    edgeS.position = new BABYLON.Vector3(x, height + 1.15, z - platD / 2);
    edgeS.material = edgeMat;
    const edgeE = BABYLON.MeshBuilder.CreateBox(`roofEdge`, { height: 0.3, width: 0.3, depth: platD }, this.scene);
    edgeE.position = new BABYLON.Vector3(x + platW / 2, height + 1.15, z);
    edgeE.material = edgeMat;
    const edgeW = BABYLON.MeshBuilder.CreateBox(`roofEdge`, { height: 0.3, width: 0.3, depth: platD }, this.scene);
    edgeW.position = new BABYLON.Vector3(x - platW / 2, height + 1.15, z);
    edgeW.material = edgeMat;

    this.platforms.push(rooftop);
  }

  private addBuildingDetails(parent: BABYLON.Mesh, height: number, width: number, depth: number): void {
    const antennaHeight = 5 + seededRandom(height * 7.3) * 15;
    const antenna = BABYLON.MeshBuilder.CreateCylinder(
      "antenna",
      { height: antennaHeight, diameter: 0.5 },
      this.scene
    );
    antenna.position = new BABYLON.Vector3(
      parent.position.x,
      height + antennaHeight / 2,
      parent.position.z
    );
    
    const antennaMat = new BABYLON.StandardMaterial("antennaMat", this.scene);
    antennaMat.emissiveColor = new BABYLON.Color3(1, 0, 0);
    antenna.material = antennaMat;

    for (let i = 0; i < 3; i++) {
      const ledge = BABYLON.MeshBuilder.CreateBox(
        "ledge",
        { height: 2, width: width + 2, depth: depth + 2 },
        this.scene
      );
      ledge.position = new BABYLON.Vector3(
        parent.position.x,
        (height / 4) * (i + 1),
        parent.position.z
      );
      const ledgeMat = new BABYLON.StandardMaterial("ledgeMat", this.scene);
      ledgeMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.25);
      ledge.material = ledgeMat;
    }
  }

  private createIndustrialZone(): void {
    let seed = 200;
    for (let x = 120; x <= 220; x += 40) {
      for (let z = -150; z <= 50; z += 40) {
        seed++;
        const height = 20 + seededRandom(seed) * 15;
        const factory = BABYLON.MeshBuilder.CreateBox(
          `factory_${x}_${z}`,
          { height, width: 30, depth: 30 },
          this.scene
        );
        factory.position = new BABYLON.Vector3(x, height / 2, z);
        
        const factoryMat = this.createBuildingMaterial(
          new BABYLON.Color3(0.2, 0.15, 0.1),
          new BABYLON.Color3(1, 0.5, 0)
        );
        factory.material = factoryMat;
        this.buildings.push(factory);
        this.addRooftopPlatform(x, height, z, 30, 30);

        const chimneyCount = 2 + Math.floor(seededRandom(seed + 500) * 3);
        for (let i = 0; i < chimneyCount; i++) {
          const chimneyHeight = 25 + seededRandom(seed + i * 100) * 15;
          const chimney = BABYLON.MeshBuilder.CreateCylinder(
            "chimney",
            { height: chimneyHeight, diameter: 4 },
            this.scene
          );
          chimney.position = new BABYLON.Vector3(
            x + (seededRandom(seed + i * 200) - 0.5) * 20,
            chimneyHeight / 2,
            z + (seededRandom(seed + i * 300) - 0.5) * 20
          );
          
          const chimneyMat = new BABYLON.StandardMaterial("chimneyMat", this.scene);
          chimneyMat.diffuseColor = new BABYLON.Color3(0.3, 0.25, 0.2);
          chimneyMat.emissiveColor = new BABYLON.Color3(0.1, 0.05, 0);
          chimney.material = chimneyMat;
        }
      }
    }
  }

  private createResidentialBlocks(): void {
    let seed = 300;
    for (let x = -220; x <= -120; x += 20) {
      for (let z = -100; z <= 100; z += 20) {
        seed++;
        const height = 15 + seededRandom(seed) * 25;
        const building = BABYLON.MeshBuilder.CreateBox(
          `residential_${x}_${z}`,
          { height, width: 12, depth: 12 },
          this.scene
        );
        building.position = new BABYLON.Vector3(x, height / 2, z);
        
        const material = this.createBuildingMaterial(
          new BABYLON.Color3(0.15, 0.18, 0.2),
          new BABYLON.Color3(0, 0.8, 1)
        );
        building.material = material;
        this.buildings.push(building);
        this.addRooftopPlatform(x, height, z, 12, 12);
      }
    }
  }

  private createHighways(): void {
    const highwayMat = new BABYLON.StandardMaterial("highwayMat", this.scene);
    highwayMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.18);
    highwayMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.03);

    const mainHighway = BABYLON.MeshBuilder.CreateBox(
      "mainHighway",
      { height: 2, width: 1200, depth: 20 },
      this.scene
    );
    mainHighway.position = new BABYLON.Vector3(0, 15, 0);
    mainHighway.material = highwayMat;

    const crossHighway = BABYLON.MeshBuilder.CreateBox(
      "crossHighway",
      { height: 2, width: 20, depth: 1000 },
      this.scene
    );
    crossHighway.position = new BABYLON.Vector3(0, 20, 0);
    crossHighway.material = highwayMat;

    for (let i = -580; i <= 580; i += 30) {
      const pillar = BABYLON.MeshBuilder.CreateCylinder(
        "pillar",
        { height: 15, diameter: 3 },
        this.scene
      );
      pillar.position = new BABYLON.Vector3(i, 7.5, 0);
      pillar.material = highwayMat;
    }

    for (let i = -480; i <= 480; i += 30) {
      const pillar = BABYLON.MeshBuilder.CreateCylinder(
        "crossPillar",
        { height: 20, diameter: 3 },
        this.scene
      );
      pillar.position = new BABYLON.Vector3(0, 10, i);
      pillar.material = highwayMat;
    }
  }

  private createNeonLights(): void {
    const neonColors = [
      new BABYLON.Color3(0, 1, 1),
      new BABYLON.Color3(1, 0, 1),
      new BABYLON.Color3(1, 0.5, 0),
      new BABYLON.Color3(0, 1, 0.5),
      new BABYLON.Color3(1, 0, 0.5),
    ];

    let seed = 400;
    for (let i = 0; i < 70; i++) {
      seed++;
      const x = (seededRandom(seed) - 0.5) * 600;
      const z = (seededRandom(seed + 1000) - 0.5) * 500;
      const y = 5 + seededRandom(seed + 2000) * 30;

      const neonSign = BABYLON.MeshBuilder.CreateBox(
        `neon_${i}`,
        { height: 3, width: 8 + seededRandom(seed + 3000) * 5, depth: 0.5 },
        this.scene
      );
      neonSign.position = new BABYLON.Vector3(x, y, z);
      neonSign.rotation.y = seededRandom(seed + 4000) * Math.PI;

      const neonMat = new BABYLON.StandardMaterial(`neonMat_${i}`, this.scene);
      const color = neonColors[Math.floor(seededRandom(seed + 5000) * neonColors.length)];
      neonMat.emissiveColor = color;
      neonMat.diffuseColor = color;
      neonSign.material = neonMat;

      if (i % 5 === 0) {
        const neonLight = new BABYLON.PointLight(
          `neonLight_${i}`,
          new BABYLON.Vector3(x, y, z),
          this.scene
        );
        neonLight.diffuse = color;
        neonLight.intensity = 0.5;
        neonLight.range = 30;
      }
    }
  }

  private createSpaceports(): void {
    const spaceportPositions = [
      new BABYLON.Vector3(-180, 0, -150),
      new BABYLON.Vector3(180, 0, 120),
      new BABYLON.Vector3(-400, 0, 200),
      new BABYLON.Vector3(350, 0, -300),
    ];

    for (const pos of spaceportPositions) {
      const platform = BABYLON.MeshBuilder.CreateCylinder(
        "spaceport",
        { height: 3, diameter: 60 },
        this.scene
      );
      platform.position = new BABYLON.Vector3(pos.x, 25, pos.z);
      
      const platformMat = new BABYLON.StandardMaterial("platformMat", this.scene);
      platformMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.25);
      platformMat.emissiveColor = new BABYLON.Color3(0, 0.1, 0.2);
      platform.material = platformMat;

      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const pillar = BABYLON.MeshBuilder.CreateCylinder(
          "spPillar",
          { height: 25, diameter: 4 },
          this.scene
        );
        pillar.position = new BABYLON.Vector3(
          pos.x + Math.cos(angle) * 25,
          12.5,
          pos.z + Math.sin(angle) * 25
        );
        pillar.material = platformMat;
      }

      const tower = BABYLON.MeshBuilder.CreateCylinder(
        "controlTower",
        { height: 40, diameterTop: 8, diameterBottom: 4 },
        this.scene
      );
      tower.position = new BABYLON.Vector3(pos.x, 45, pos.z);
      
      const towerMat = new BABYLON.StandardMaterial("towerMat", this.scene);
      towerMat.diffuseColor = new BABYLON.Color3(0.1, 0.15, 0.2);
      towerMat.emissiveColor = new BABYLON.Color3(0, 0.2, 0.3);
      tower.material = towerMat;
    }
  }

  private createMountainZone(): void {
    const rockMat = new BABYLON.StandardMaterial("rockMat", this.scene);
    rockMat.diffuseColor = new BABYLON.Color3(0.25, 0.22, 0.2);
    rockMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

    const snowMat = new BABYLON.StandardMaterial("snowMat", this.scene);
    snowMat.diffuseColor = new BABYLON.Color3(0.85, 0.88, 0.95);
    snowMat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.15);

    const darkRockMat = new BABYLON.StandardMaterial("darkRockMat", this.scene);
    darkRockMat.diffuseColor = new BABYLON.Color3(0.18, 0.16, 0.15);

    const mountainConfigs = [
      { cx: 450, cz: 350, peaks: 6, baseRadius: 120, label: "NE" },
      { cx: -450, cz: 350, peaks: 5, baseRadius: 100, label: "NW" },
      { cx: 500, cz: -400, peaks: 7, baseRadius: 130, label: "SE" },
      { cx: -500, cz: -350, peaks: 4, baseRadius: 90, label: "SW" },
    ];

    let seed = 600;
    for (const config of mountainConfigs) {
      for (let p = 0; p < config.peaks; p++) {
        seed++;
        const angle = (p / config.peaks) * Math.PI * 2 + seededRandom(seed) * 0.5;
        const dist = seededRandom(seed + 100) * config.baseRadius * 0.7;
        const px = config.cx + Math.cos(angle) * dist;
        const pz = config.cz + Math.sin(angle) * dist;

        const peakHeight = 40 + seededRandom(seed + 200) * 80;
        const baseSize = 20 + seededRandom(seed + 300) * 30;

        const mountain = BABYLON.MeshBuilder.CreateCylinder(
          `mountain_${config.label}_${p}`,
          {
            height: peakHeight,
            diameterTop: 2 + seededRandom(seed + 400) * 5,
            diameterBottom: baseSize,
            tessellation: 6 + Math.floor(seededRandom(seed + 500) * 4),
          },
          this.scene
        );
        mountain.position = new BABYLON.Vector3(px, peakHeight / 2, pz);
        mountain.rotation.y = seededRandom(seed + 600) * Math.PI;

        if (peakHeight > 80) {
          mountain.material = snowMat;

          const snowCap = BABYLON.MeshBuilder.CreateCylinder(
            `snowcap_${config.label}_${p}`,
            {
              height: peakHeight * 0.3,
              diameterTop: 1,
              diameterBottom: baseSize * 0.4,
              tessellation: 6,
            },
            this.scene
          );
          snowCap.position = new BABYLON.Vector3(px, peakHeight * 0.85, pz);
          snowCap.material = snowMat;
        } else {
          mountain.material = rockMat;
        }

        const boulderCount = 3 + Math.floor(seededRandom(seed + 700) * 5);
        for (let b = 0; b < boulderCount; b++) {
          const bAngle = seededRandom(seed + b * 50 + 800) * Math.PI * 2;
          const bDist = baseSize * 0.6 + seededRandom(seed + b * 50 + 900) * baseSize * 0.5;
          const bSize = 3 + seededRandom(seed + b * 50 + 1000) * 8;

          const boulder = BABYLON.MeshBuilder.CreateSphere(
            `boulder_${config.label}_${p}_${b}`,
            { diameter: bSize, segments: 4 },
            this.scene
          );
          boulder.position = new BABYLON.Vector3(
            px + Math.cos(bAngle) * bDist,
            bSize / 2,
            pz + Math.sin(bAngle) * bDist
          );
          boulder.scaling = new BABYLON.Vector3(
            1 + seededRandom(seed + b * 50 + 1100) * 0.5,
            0.6 + seededRandom(seed + b * 50 + 1200) * 0.4,
            1 + seededRandom(seed + b * 50 + 1300) * 0.5
          );
          boulder.material = darkRockMat;
        }
      }

      const ridgeCount = 2 + Math.floor(seededRandom(seed + 2000) * 3);
      for (let r = 0; r < ridgeCount; r++) {
        seed++;
        const ridgeLen = 30 + seededRandom(seed) * 60;
        const ridgeH = 15 + seededRandom(seed + 100) * 25;
        const ridge = BABYLON.MeshBuilder.CreateBox(
          `ridge_${config.label}_${r}`,
          { height: ridgeH, width: ridgeLen, depth: 8 + seededRandom(seed + 200) * 8 },
          this.scene
        );
        ridge.position = new BABYLON.Vector3(
          config.cx + (seededRandom(seed + 300) - 0.5) * config.baseRadius,
          ridgeH / 2,
          config.cz + (seededRandom(seed + 400) - 0.5) * config.baseRadius
        );
        ridge.rotation.y = seededRandom(seed + 500) * Math.PI;
        ridge.material = rockMat;
      }
    }
  }

  private createNatureZone(): void {
    const trunkMat = new BABYLON.StandardMaterial("trunkMat", this.scene);
    trunkMat.diffuseColor = new BABYLON.Color3(0.3, 0.2, 0.1);

    const leafMat = new BABYLON.StandardMaterial("leafMat", this.scene);
    leafMat.diffuseColor = new BABYLON.Color3(0.05, 0.35, 0.1);
    leafMat.emissiveColor = new BABYLON.Color3(0.01, 0.05, 0.02);

    const glowLeafMat = new BABYLON.StandardMaterial("glowLeafMat", this.scene);
    glowLeafMat.diffuseColor = new BABYLON.Color3(0.0, 0.5, 0.3);
    glowLeafMat.emissiveColor = new BABYLON.Color3(0.0, 0.2, 0.1);

    const cyanLeafMat = new BABYLON.StandardMaterial("cyanLeafMat", this.scene);
    cyanLeafMat.diffuseColor = new BABYLON.Color3(0.0, 0.3, 0.4);
    cyanLeafMat.emissiveColor = new BABYLON.Color3(0.0, 0.1, 0.15);

    const leafMats = [leafMat, glowLeafMat, cyanLeafMat];

    const grassMat = new BABYLON.StandardMaterial("grassMat", this.scene);
    grassMat.diffuseColor = new BABYLON.Color3(0.05, 0.2, 0.05);
    grassMat.emissiveColor = new BABYLON.Color3(0.01, 0.03, 0.01);

    const bushMat = new BABYLON.StandardMaterial("bushMat", this.scene);
    bushMat.diffuseColor = new BABYLON.Color3(0.08, 0.3, 0.08);
    bushMat.emissiveColor = new BABYLON.Color3(0.0, 0.05, 0.02);

    const pondMat = new BABYLON.StandardMaterial("pondMat", this.scene);
    pondMat.diffuseColor = new BABYLON.Color3(0.0, 0.15, 0.3);
    pondMat.emissiveColor = new BABYLON.Color3(0.0, 0.05, 0.1);
    pondMat.alpha = 0.7;

    const natureZones = [
      { cx: 350, cz: 150, radius: 100, label: "E" },
      { cx: -350, cz: 150, radius: 90, label: "W" },
      { cx: 0, cz: 400, radius: 120, label: "N" },
      { cx: -300, cz: -350, radius: 80, label: "S" },
    ];

    let seed = 1000;
    for (const zone of natureZones) {
      const grassPatch = BABYLON.MeshBuilder.CreateGround(
        `grass_${zone.label}`,
        { width: zone.radius * 2.2, height: zone.radius * 2.2 },
        this.scene
      );
      grassPatch.position = new BABYLON.Vector3(zone.cx, 0.05, zone.cz);
      grassPatch.material = grassMat;

      const treeCount = 15 + Math.floor(seededRandom(seed++) * 15);
      for (let t = 0; t < treeCount; t++) {
        seed++;
        const angle = seededRandom(seed) * Math.PI * 2;
        const dist = seededRandom(seed + 100) * zone.radius * 0.9;
        const tx = zone.cx + Math.cos(angle) * dist;
        const tz = zone.cz + Math.sin(angle) * dist;

        const trunkHeight = 6 + seededRandom(seed + 200) * 10;
        const trunk = BABYLON.MeshBuilder.CreateCylinder(
          `trunk_${zone.label}_${t}`,
          { height: trunkHeight, diameter: 1 + seededRandom(seed + 300) * 1.5 },
          this.scene
        );
        trunk.position = new BABYLON.Vector3(tx, trunkHeight / 2, tz);
        trunk.material = trunkMat;

        const canopyLayers = 1 + Math.floor(seededRandom(seed + 400) * 3);
        const chosenLeafMat = leafMats[Math.floor(seededRandom(seed + 500) * leafMats.length)];
        for (let c = 0; c < canopyLayers; c++) {
          const canopySize = 4 + seededRandom(seed + c * 100 + 600) * 6;
          const canopy = BABYLON.MeshBuilder.CreateSphere(
            `canopy_${zone.label}_${t}_${c}`,
            { diameter: canopySize, segments: 6 },
            this.scene
          );
          canopy.position = new BABYLON.Vector3(
            tx + (seededRandom(seed + c * 100 + 700) - 0.5) * 3,
            trunkHeight + canopySize * 0.3 + c * 2,
            tz + (seededRandom(seed + c * 100 + 800) - 0.5) * 3
          );
          canopy.scaling.y = 0.6 + seededRandom(seed + c * 100 + 900) * 0.3;
          canopy.material = chosenLeafMat;
        }
      }

      const bushCount = 10 + Math.floor(seededRandom(seed++) * 10);
      for (let b = 0; b < bushCount; b++) {
        seed++;
        const angle = seededRandom(seed) * Math.PI * 2;
        const dist = seededRandom(seed + 100) * zone.radius;
        const bushSize = 2 + seededRandom(seed + 200) * 3;

        const bush = BABYLON.MeshBuilder.CreateSphere(
          `bush_${zone.label}_${b}`,
          { diameter: bushSize, segments: 5 },
          this.scene
        );
        bush.position = new BABYLON.Vector3(
          zone.cx + Math.cos(angle) * dist,
          bushSize * 0.3,
          zone.cz + Math.sin(angle) * dist
        );
        bush.scaling.y = 0.5;
        bush.material = bushMat;
      }

      const pondCount = 1 + Math.floor(seededRandom(seed++) * 2);
      for (let p = 0; p < pondCount; p++) {
        seed++;
        const pondSize = 8 + seededRandom(seed) * 15;
        const pond = BABYLON.MeshBuilder.CreateDisc(
          `pond_${zone.label}_${p}`,
          { radius: pondSize, tessellation: 24 },
          this.scene
        );
        pond.rotation.x = Math.PI / 2;
        pond.position = new BABYLON.Vector3(
          zone.cx + (seededRandom(seed + 100) - 0.5) * zone.radius * 0.6,
          0.15,
          zone.cz + (seededRandom(seed + 200) - 0.5) * zone.radius * 0.6
        );
        pond.material = pondMat;
      }

      const rockCount = 5 + Math.floor(seededRandom(seed++) * 8);
      for (let r = 0; r < rockCount; r++) {
        seed++;
        const rAngle = seededRandom(seed) * Math.PI * 2;
        const rDist = seededRandom(seed + 100) * zone.radius;
        const rSize = 1 + seededRandom(seed + 200) * 4;

        const rock = BABYLON.MeshBuilder.CreateSphere(
          `rock_${zone.label}_${r}`,
          { diameter: rSize, segments: 4 },
          this.scene
        );
        rock.position = new BABYLON.Vector3(
          zone.cx + Math.cos(rAngle) * rDist,
          rSize * 0.3,
          zone.cz + Math.sin(rAngle) * rDist
        );
        rock.scaling = new BABYLON.Vector3(
          1 + seededRandom(seed + 300) * 0.6,
          0.4 + seededRandom(seed + 400) * 0.4,
          1 + seededRandom(seed + 500) * 0.6
        );
        const rockMat = new BABYLON.StandardMaterial(`naturerockmat_${r}`, this.scene);
        rockMat.diffuseColor = new BABYLON.Color3(0.3, 0.28, 0.25);
        rock.material = rockMat;
      }
    }
  }

  private createSkyCities(): void {
    const skyPlatforms = [
      { x: 0, y: 80, z: 200, size: 80, label: "Central", tier: "main" },
      { x: -200, y: 120, z: 100, size: 60, label: "West", tier: "main" },
      { x: 200, y: 100, z: -100, size: 70, label: "East", tier: "main" },
      { x: 0, y: 160, z: -200, size: 55, label: "South", tier: "high" },
      { x: -100, y: 200, z: 0, size: 50, label: "Upper", tier: "high" },
      { x: 150, y: 180, z: 200, size: 45, label: "NE_Sky", tier: "high" },
      { x: -250, y: 60, z: -150, size: 40, label: "Low_W", tier: "step" },
      { x: 100, y: 50, z: 150, size: 35, label: "Low_E", tier: "step" },
      { x: -50, y: 40, z: -100, size: 30, label: "Step1", tier: "step" },
      { x: 80, y: 55, z: -50, size: 30, label: "Step2", tier: "step" },
      { x: -150, y: 45, z: 50, size: 28, label: "Step3", tier: "step" },
      { x: 50, y: 250, z: 0, size: 40, label: "Apex", tier: "apex" },
    ];

    const platformMat = new BABYLON.StandardMaterial("skyPlatMat", this.scene);
    platformMat.diffuseColor = new BABYLON.Color3(0.12, 0.14, 0.2);
    platformMat.emissiveColor = new BABYLON.Color3(0.02, 0.04, 0.08);
    platformMat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.4);

    const glowEdgeMat = new BABYLON.StandardMaterial("glowEdgeMat", this.scene);
    glowEdgeMat.emissiveColor = new BABYLON.Color3(0, 0.8, 1);
    glowEdgeMat.diffuseColor = new BABYLON.Color3(0, 0.3, 0.5);

    const apexMat = new BABYLON.StandardMaterial("apexMat", this.scene);
    apexMat.diffuseColor = new BABYLON.Color3(0.1, 0.05, 0.15);
    apexMat.emissiveColor = new BABYLON.Color3(0.15, 0.0, 0.3);
    apexMat.specularColor = new BABYLON.Color3(0.5, 0.2, 0.8);

    let seed = 2000;
    for (const plat of skyPlatforms) {
      const chosenMat = plat.tier === "apex" ? apexMat : platformMat;

      const platform = BABYLON.MeshBuilder.CreateCylinder(
        `skyPlat_${plat.label}`,
        { height: 4, diameter: plat.size, tessellation: 32 },
        this.scene
      );
      platform.position = new BABYLON.Vector3(plat.x, plat.y, plat.z);
      platform.material = chosenMat;
      this.platforms.push(platform);

      const edgeRing = BABYLON.MeshBuilder.CreateTorus(
        `skyEdge_${plat.label}`,
        { diameter: plat.size, thickness: 0.5, tessellation: 32 },
        this.scene
      );
      edgeRing.position = new BABYLON.Vector3(plat.x, plat.y + 2.1, plat.z);
      edgeRing.material = glowEdgeMat;

      const edgeLight = new BABYLON.PointLight(
        `skyPlatLight_${plat.label}`,
        new BABYLON.Vector3(plat.x, plat.y + 5, plat.z),
        this.scene
      );
      edgeLight.diffuse = new BABYLON.Color3(0, 0.8, 1);
      edgeLight.intensity = 0.6;
      edgeLight.range = plat.size * 0.8;

      const pillarCount = plat.tier === "step" ? 3 : 6;
      for (let i = 0; i < pillarCount; i++) {
        const angle = (i / pillarCount) * Math.PI * 2;
        const pillarH = plat.y;
        const pillar = BABYLON.MeshBuilder.CreateCylinder(
          `skyPillar_${plat.label}_${i}`,
          { height: pillarH, diameter: 3 + plat.size * 0.02 },
          this.scene
        );
        pillar.position = new BABYLON.Vector3(
          plat.x + Math.cos(angle) * (plat.size * 0.4),
          pillarH / 2,
          plat.z + Math.sin(angle) * (plat.size * 0.4)
        );
        pillar.material = chosenMat;
      }

      if (plat.tier === "main" || plat.tier === "high") {
        const buildingCount = plat.tier === "main" ? 6 : 4;
        for (let b = 0; b < buildingCount; b++) {
          seed++;
          const bAngle = seededRandom(seed) * Math.PI * 2;
          const bDist = seededRandom(seed + 100) * (plat.size * 0.3);
          const bHeight = 10 + seededRandom(seed + 200) * 30;
          const bWidth = 5 + seededRandom(seed + 300) * 8;

          const skyBuilding = BABYLON.MeshBuilder.CreateBox(
            `skyBld_${plat.label}_${b}`,
            { height: bHeight, width: bWidth, depth: bWidth },
            this.scene
          );
          skyBuilding.position = new BABYLON.Vector3(
            plat.x + Math.cos(bAngle) * bDist,
            plat.y + 2 + bHeight / 2,
            plat.z + Math.sin(bAngle) * bDist
          );

          const skyBldMat = this.createBuildingMaterial(
            new BABYLON.Color3(0.1, 0.12, 0.18),
            new BABYLON.Color3(
              seededRandom(seed + 400) * 0.5,
              seededRandom(seed + 500) * 0.5 + 0.5,
              1
            )
          );
          skyBuilding.material = skyBldMat;
          this.buildings.push(skyBuilding);
        }

        const towerHeight = 20 + seededRandom(seed + 600) * 20;
        const centralTower = BABYLON.MeshBuilder.CreateCylinder(
          `skyTower_${plat.label}`,
          { height: towerHeight, diameterTop: 4, diameterBottom: 6 },
          this.scene
        );
        centralTower.position = new BABYLON.Vector3(plat.x, plat.y + 2 + towerHeight / 2, plat.z);
        const towerMat = this.createBuildingMaterial(
          new BABYLON.Color3(0.08, 0.1, 0.15),
          new BABYLON.Color3(0, 1, 1)
        );
        centralTower.material = towerMat;

        const beacon = BABYLON.MeshBuilder.CreateSphere(
          `beacon_${plat.label}`,
          { diameter: 3 },
          this.scene
        );
        beacon.position = new BABYLON.Vector3(plat.x, plat.y + 2 + towerHeight + 2, plat.z);
        const beaconMat = new BABYLON.StandardMaterial(`beaconMat_${plat.label}`, this.scene);
        beaconMat.emissiveColor = new BABYLON.Color3(0, 1, 1);
        beacon.material = beaconMat;
      }

      if (plat.tier === "apex") {
        const spire = BABYLON.MeshBuilder.CreateCylinder(
          `apexSpire`,
          { height: 50, diameterTop: 1, diameterBottom: 8 },
          this.scene
        );
        spire.position = new BABYLON.Vector3(plat.x, plat.y + 27, plat.z);
        const spireMat = this.createBuildingMaterial(
          new BABYLON.Color3(0.15, 0.05, 0.25),
          new BABYLON.Color3(0.8, 0, 1)
        );
        spire.material = spireMat;

        const orbMat = new BABYLON.StandardMaterial("orbMat", this.scene);
        orbMat.emissiveColor = new BABYLON.Color3(1, 0, 1);
        orbMat.diffuseColor = new BABYLON.Color3(0.5, 0, 0.8);

        const orb = BABYLON.MeshBuilder.CreateSphere("apexOrb", { diameter: 5 }, this.scene);
        orb.position = new BABYLON.Vector3(plat.x, plat.y + 55, plat.z);
        orb.material = orbMat;

        const orbLight = new BABYLON.PointLight(
          "apexOrbLight",
          new BABYLON.Vector3(plat.x, plat.y + 55, plat.z),
          this.scene
        );
        orbLight.diffuse = new BABYLON.Color3(1, 0, 1);
        orbLight.intensity = 2;
        orbLight.range = 80;

        for (let ring = 0; ring < 3; ring++) {
          const floatingRing = BABYLON.MeshBuilder.CreateTorus(
            `apexRing_${ring}`,
            { diameter: 15 + ring * 5, thickness: 0.8, tessellation: 24 },
            this.scene
          );
          floatingRing.position = new BABYLON.Vector3(plat.x, plat.y + 40 + ring * 8, plat.z);
          floatingRing.material = orbMat;

          this.scene.onBeforeRenderObservable.add(() => {
            floatingRing.rotation.y += 0.005 * (ring + 1);
            floatingRing.rotation.x = Math.sin(performance.now() / 2000 + ring) * 0.3;
          });
        }
      }
    }
  }

  private createSkyBridges(): void {
    const bridgeMat = new BABYLON.StandardMaterial("bridgeMat", this.scene);
    bridgeMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.2);
    bridgeMat.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.06);

    const railMat = new BABYLON.StandardMaterial("railMat", this.scene);
    railMat.emissiveColor = new BABYLON.Color3(0, 0.6, 0.8);
    railMat.diffuseColor = new BABYLON.Color3(0, 0.2, 0.3);

    const connections: Array<{ from: BABYLON.Vector3; to: BABYLON.Vector3; width: number }> = [
      { from: new BABYLON.Vector3(-50, 40, -100), to: new BABYLON.Vector3(80, 55, -50), width: 6 },
      { from: new BABYLON.Vector3(80, 55, -50), to: new BABYLON.Vector3(200, 100, -100), width: 6 },
      { from: new BABYLON.Vector3(-150, 45, 50), to: new BABYLON.Vector3(-200, 120, 100), width: 5 },
      { from: new BABYLON.Vector3(-200, 120, 100), to: new BABYLON.Vector3(-100, 200, 0), width: 5 },
      { from: new BABYLON.Vector3(100, 50, 150), to: new BABYLON.Vector3(0, 80, 200), width: 6 },
      { from: new BABYLON.Vector3(0, 80, 200), to: new BABYLON.Vector3(150, 180, 200), width: 5 },
      { from: new BABYLON.Vector3(-100, 200, 0), to: new BABYLON.Vector3(50, 250, 0), width: 4 },
      { from: new BABYLON.Vector3(200, 100, -100), to: new BABYLON.Vector3(150, 180, 200), width: 4 },
      { from: new BABYLON.Vector3(0, 160, -200), to: new BABYLON.Vector3(-100, 200, 0), width: 5 },

      { from: new BABYLON.Vector3(0, 0, 0), to: new BABYLON.Vector3(-50, 40, -100), width: 8 },
      { from: new BABYLON.Vector3(0, 0, 100), to: new BABYLON.Vector3(100, 50, 150), width: 8 },
      { from: new BABYLON.Vector3(-100, 0, 0), to: new BABYLON.Vector3(-150, 45, 50), width: 8 },
      { from: new BABYLON.Vector3(-250, 60, -150), to: new BABYLON.Vector3(0, 160, -200), width: 5 },
    ];

    for (const conn of connections) {
      const dir = conn.to.subtract(conn.from);
      const length = dir.length();
      const mid = conn.from.add(dir.scale(0.5));

      const segmentCount = Math.max(3, Math.floor(length / 15));
      for (let s = 0; s <= segmentCount; s++) {
        const t = s / segmentCount;
        const segPos = BABYLON.Vector3.Lerp(conn.from, conn.to, t);

        const arcHeight = Math.sin(t * Math.PI) * length * 0.05;
        segPos.y += arcHeight;

        if (s < segmentCount) {
          const nextT = (s + 1) / segmentCount;
          const nextPos = BABYLON.Vector3.Lerp(conn.from, conn.to, nextT);
          nextPos.y += Math.sin(nextT * Math.PI) * length * 0.05;

          const segDir = nextPos.subtract(segPos);
          const segLen = segDir.length();

          const segment = BABYLON.MeshBuilder.CreateBox(
            `bridge_seg_${conn.from.x}_${s}`,
            { height: 1.5, width: conn.width, depth: segLen + 1 },
            this.scene
          );

          const segMid = segPos.add(segDir.scale(0.5));
          segment.position = segMid;

          const yaw = Math.atan2(segDir.x, segDir.z);
          const pitch = -Math.asin(segDir.y / segLen);
          segment.rotation = new BABYLON.Vector3(pitch, yaw, 0);
          segment.material = bridgeMat;
        }

        if (s % 2 === 0) {
          for (const side of [-1, 1]) {
            const railPost = BABYLON.MeshBuilder.CreateCylinder(
              `railPost_${conn.from.x}_${s}_${side}`,
              { height: 3, diameter: 0.3 },
              this.scene
            );

            const perpDir = BABYLON.Vector3.Cross(dir.normalize(), BABYLON.Vector3.Up()).normalize();
            railPost.position = segPos.add(perpDir.scale(side * conn.width * 0.45));
            railPost.position.y += 2;
            railPost.material = railMat;
          }
        }
      }
    }

    const stairConfigs = [
      { base: new BABYLON.Vector3(0, 0, 0), target: new BABYLON.Vector3(-50, 40, -100), steps: 20, width: 5 },
      { base: new BABYLON.Vector3(0, 0, 100), target: new BABYLON.Vector3(100, 50, 150), steps: 20, width: 5 },
      { base: new BABYLON.Vector3(-100, 0, 0), target: new BABYLON.Vector3(-150, 45, 50), steps: 20, width: 5 },
    ];

    const stepMat = new BABYLON.StandardMaterial("stepMat", this.scene);
    stepMat.diffuseColor = new BABYLON.Color3(0.18, 0.18, 0.22);
    stepMat.emissiveColor = new BABYLON.Color3(0.02, 0.04, 0.06);

    for (const stair of stairConfigs) {
      for (let s = 0; s < stair.steps; s++) {
        const t = s / stair.steps;
        const pos = BABYLON.Vector3.Lerp(stair.base, stair.target, t);

        const step = BABYLON.MeshBuilder.CreateBox(
          `step_${stair.base.x}_${s}`,
          { height: 1, width: stair.width, depth: 3 },
          this.scene
        );
        step.position = pos;
        step.position.y += 0.5;
        step.material = stepMat;

        if (s % 3 === 0) {
          const glowStrip = BABYLON.MeshBuilder.CreateBox(
            `stepGlow_${stair.base.x}_${s}`,
            { height: 0.2, width: stair.width + 0.5, depth: 0.5 },
            this.scene
          );
          glowStrip.position = step.position.clone();
          glowStrip.position.y += 0.6;

          const glowMat = new BABYLON.StandardMaterial(`stepGlowMat`, this.scene);
          glowMat.emissiveColor = new BABYLON.Color3(0, 0.7, 1);
          glowStrip.material = glowMat;
        }
      }
    }
  }

  private createOuterDistricts(): void {
    let seed = 3000;
    const outerColors = [
      { base: new BABYLON.Color3(0.1, 0.12, 0.18), glow: new BABYLON.Color3(0.5, 0, 1) },
      { base: new BABYLON.Color3(0.12, 0.1, 0.15), glow: new BABYLON.Color3(1, 0, 0.5) },
      { base: new BABYLON.Color3(0.08, 0.12, 0.15), glow: new BABYLON.Color3(0, 1, 0.8) },
    ];

    const districts = [
      { cx: 350, cz: -150, count: 12, label: "FarEast" },
      { cx: -350, cz: -100, count: 10, label: "FarWest" },
      { cx: 0, cz: -350, count: 14, label: "FarSouth" },
      { cx: 250, cz: 300, count: 10, label: "FarNE" },
      { cx: -250, cz: 300, count: 8, label: "FarNW" },
    ];

    for (const dist of districts) {
      for (let b = 0; b < dist.count; b++) {
        seed++;
        const angle = seededRandom(seed) * Math.PI * 2;
        const radius = seededRandom(seed + 100) * 80;
        const bx = dist.cx + Math.cos(angle) * radius;
        const bz = dist.cz + Math.sin(angle) * radius;
        const height = 10 + seededRandom(seed + 200) * 40;
        const width = 6 + seededRandom(seed + 300) * 10;

        const building = BABYLON.MeshBuilder.CreateBox(
          `outer_${dist.label}_${b}`,
          { height, width, depth: width },
          this.scene
        );
        building.position = new BABYLON.Vector3(bx, height / 2, bz);

        const colorSet = outerColors[Math.floor(seededRandom(seed + 400) * outerColors.length)];
        building.material = this.createBuildingMaterial(colorSet.base, colorSet.glow);
        this.buildings.push(building);
        this.addRooftopPlatform(bx, height, bz, width, width);
      }
    }
  }

  getBuildings(): BABYLON.Mesh[] {
    return this.buildings;
  }

  getPlatforms(): BABYLON.Mesh[] {
    return this.platforms;
  }
}
