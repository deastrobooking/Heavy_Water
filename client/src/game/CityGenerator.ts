import * as BABYLON from "@babylonjs/core";

interface BuildingConfig {
  minHeight: number;
  maxHeight: number;
  minWidth: number;
  maxWidth: number;
  density: number;
}

export class CityGenerator {
  private scene: BABYLON.Scene;
  private buildings: BABYLON.Mesh[] = [];
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
        if (intensity > 0.8) cellShade = 1.0;
        else if (intensity > 0.5) cellShade = 0.7;
        else if (intensity > 0.2) cellShade = 0.5;
        else cellShade = 0.3;
        
        vec3 finalColor = baseColor * cellShade;
        
        float edgeFactor = 1.0 - abs(dot(vNormal, normalize(vec3(0.0, 0.0, 1.0) - vPosition)));
        finalColor += glowColor * pow(edgeFactor, 3.0) * 0.5;
        
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
  }

  private createGround(): void {
    const ground = BABYLON.MeshBuilder.CreateGround(
      "ground",
      { width: 500, height: 500, subdivisions: 50 },
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
    const riverPath: BABYLON.Vector3[] = [];
    for (let i = -250; i <= 250; i += 10) {
      const z = -200 + Math.sin(i * 0.02) * 20;
      riverPath.push(new BABYLON.Vector3(i, 0.1, z));
    }

    const river = BABYLON.MeshBuilder.CreateRibbon(
      "river",
      {
        pathArray: [
          riverPath.map((p) => new BABYLON.Vector3(p.x, p.y, p.z - 30)),
          riverPath.map((p) => new BABYLON.Vector3(p.x, p.y, p.z + 30)),
        ],
      },
      this.scene
    );

    const riverMat = new BABYLON.StandardMaterial("riverMat", this.scene);
    riverMat.diffuseColor = new BABYLON.Color3(0.0, 0.2, 0.4);
    riverMat.specularColor = new BABYLON.Color3(0.5, 0.7, 1.0);
    riverMat.emissiveColor = new BABYLON.Color3(0.0, 0.1, 0.2);
    riverMat.alpha = 0.8;
    river.material = riverMat;
  }

  private createDowntown(): void {
    const colors = [
      { base: new BABYLON.Color3(0.15, 0.15, 0.2), glow: new BABYLON.Color3(0, 1, 1) },
      { base: new BABYLON.Color3(0.12, 0.12, 0.18), glow: new BABYLON.Color3(1, 0, 1) },
      { base: new BABYLON.Color3(0.18, 0.15, 0.2), glow: new BABYLON.Color3(1, 0.5, 0) },
      { base: new BABYLON.Color3(0.1, 0.15, 0.2), glow: new BABYLON.Color3(0, 1, 0.5) },
    ];

    for (let x = -100; x <= 100; x += 25) {
      for (let z = -80; z <= 80; z += 25) {
        if (Math.abs(z) > 150) continue;
        
        const height = 30 + Math.random() * 120;
        const width = 8 + Math.random() * 12;
        const depth = 8 + Math.random() * 12;

        const building = BABYLON.MeshBuilder.CreateBox(
          `downtown_${x}_${z}`,
          { height, width, depth },
          this.scene
        );
        building.position = new BABYLON.Vector3(x + (Math.random() - 0.5) * 10, height / 2, z + (Math.random() - 0.5) * 10);

        const colorSet = colors[Math.floor(Math.random() * colors.length)];
        building.material = this.createBuildingMaterial(colorSet.base, colorSet.glow);
        this.buildings.push(building);

        if (height > 80) {
          this.addBuildingDetails(building, height, width, depth);
        }
      }
    }
  }

  private addBuildingDetails(parent: BABYLON.Mesh, height: number, width: number, depth: number): void {
    const antennaHeight = 5 + Math.random() * 15;
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
    for (let x = 120; x <= 220; x += 40) {
      for (let z = -150; z <= 50; z += 40) {
        const height = 20 + Math.random() * 15;
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

        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
          const chimneyHeight = 25 + Math.random() * 15;
          const chimney = BABYLON.MeshBuilder.CreateCylinder(
            "chimney",
            { height: chimneyHeight, diameter: 4 },
            this.scene
          );
          chimney.position = new BABYLON.Vector3(
            x + (Math.random() - 0.5) * 20,
            chimneyHeight / 2,
            z + (Math.random() - 0.5) * 20
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
    for (let x = -220; x <= -120; x += 20) {
      for (let z = -100; z <= 100; z += 20) {
        const height = 15 + Math.random() * 25;
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
      }
    }
  }

  private createHighways(): void {
    const highwayMat = new BABYLON.StandardMaterial("highwayMat", this.scene);
    highwayMat.diffuseColor = new BABYLON.Color3(0.15, 0.15, 0.18);
    highwayMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.03);

    const mainHighway = BABYLON.MeshBuilder.CreateBox(
      "mainHighway",
      { height: 2, width: 500, depth: 20 },
      this.scene
    );
    mainHighway.position = new BABYLON.Vector3(0, 15, 0);
    mainHighway.material = highwayMat;

    const crossHighway = BABYLON.MeshBuilder.CreateBox(
      "crossHighway",
      { height: 2, width: 20, depth: 400 },
      this.scene
    );
    crossHighway.position = new BABYLON.Vector3(0, 20, 0);
    crossHighway.material = highwayMat;

    for (let i = -240; i <= 240; i += 30) {
      const pillar = BABYLON.MeshBuilder.CreateCylinder(
        "pillar",
        { height: 15, diameter: 3 },
        this.scene
      );
      pillar.position = new BABYLON.Vector3(i, 7.5, 0);
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

    for (let i = 0; i < 50; i++) {
      const x = (Math.random() - 0.5) * 400;
      const z = (Math.random() - 0.5) * 300;
      const y = 5 + Math.random() * 30;

      const neonSign = BABYLON.MeshBuilder.CreateBox(
        `neon_${i}`,
        { height: 3, width: 8 + Math.random() * 5, depth: 0.5 },
        this.scene
      );
      neonSign.position = new BABYLON.Vector3(x, y, z);
      neonSign.rotation.y = Math.random() * Math.PI;

      const neonMat = new BABYLON.StandardMaterial(`neonMat_${i}`, this.scene);
      const color = neonColors[Math.floor(Math.random() * neonColors.length)];
      neonMat.emissiveColor = color;
      neonMat.diffuseColor = color;
      neonSign.material = neonMat;

      const neonLight = new BABYLON.PointLight(
        `neonLight_${i}`,
        new BABYLON.Vector3(x, y, z),
        this.scene
      );
      neonLight.diffuse = color;
      neonLight.intensity = 0.3;
      neonLight.range = 20;
    }
  }

  private createSpaceports(): void {
    const spaceportPositions = [
      new BABYLON.Vector3(-180, 0, -150),
      new BABYLON.Vector3(180, 0, 120),
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

  getBuildings(): BABYLON.Mesh[] {
    return this.buildings;
  }
}
