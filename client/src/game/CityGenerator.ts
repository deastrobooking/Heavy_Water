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

export interface WallCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

/**
 * A flat horizontal surface (building floor, roof, ramp landing, etc.) that
 * the player can stand on. Faster to query analytically than to raycast against
 * thousands of pickable meshes — see PlayerController.getBuildingFloorYAt().
 */
export interface FloorPlatform {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number; // top surface Y
}

export class CityGenerator {
  private scene: BABYLON.Scene;
  private buildings: BABYLON.Mesh[] = [];
  private platforms: BABYLON.Mesh[] = [];
  private wallColliders: WallCollider[] = [];
  private floorPlatforms: FloorPlatform[] = [];
  // Sky-racetrack ramp parameters — saved so getDriveableHeight() can sample
  // each ramp's tilted surface analytically (much faster + reliable than
  // raycasting against a rotated box). Stored as a list of low/high endpoints
  // so we can have multiple cardinal-direction ramps onto the ring.
  private rampParams: Array<{
    lowX: number; lowZ: number;   // ground end (y=0)
    highX: number; highZ: number; // landing end (y=rise) — sits on the ring
    width: number;
    rise: number;
  }> = [];
  private cellShadeMaterial: BABYLON.ShaderMaterial | null = null;
  /** The 1200×1200 ground plane — kept so we can hide it (along with the
   *  rest of the city geometry) when the player warps to the space level. */
  private groundMesh: BABYLON.Mesh | null = null;
  /** River + street lights — tracked here so `setVisible` can hide them
   *  alongside the building/platform/ground when the player warps to the
   *  orbital level. They aren't part of `buildings` or `platforms`. */
  private extraSurfaceMeshes: BABYLON.AbstractMesh[] = [];
  private extraSurfaceLights: BABYLON.PointLight[] = [];
  /** Every cell-shaded building material we've created, kept here so
   *  `setLevelTheme` can re-tint the whole city in O(n) without rebuilding
   *  geometry. Each entry stores its original baseColor + glowColor on the
   *  `metadata` slot the first time it's tinted. */
  private cellMaterials: BABYLON.ShaderMaterial[] = [];
  /** Ground material — kept so per-level theming can recolor the asphalt. */
  private groundMaterial: BABYLON.StandardMaterial | null = null;
  /** Original ground diffuse — captured first time setLevelTheme runs so
   *  warping back to L1 restores the default Detroit asphalt. */
  private groundDiffuseOrig: BABYLON.Color3 | null = null;

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
    // Stash originals so setLevelTheme can multiply against them on each
    // call without drift. We use the BABYLON metadata slot to avoid having
    // to maintain a parallel Map<material, colors>.
    material.metadata = {
      baseColorOrig: color.clone(),
      glowColorOrig: glowColor.clone(),
    };
    this.cellMaterials.push(material);
    return material;
  }

  /** Re-tint every cell-shaded building + the ground in-place to give the
   *  player the impression that they've warped to a different city. Cheap
   *  (O(n) over ~hundreds of materials, no geometry touched) and idempotent
   *  — calling with a new theme overwrites the previous tint via the stored
   *  originals on each material's metadata. */
  setLevelTheme(theme: { tint: BABYLON.Color3; glowTint: BABYLON.Color3; ground: BABYLON.Color3 }): void {
    for (const mat of this.cellMaterials) {
      const meta = mat.metadata as
        | { baseColorOrig: BABYLON.Color3; glowColorOrig: BABYLON.Color3 }
        | null;
      if (!meta) continue;
      const tinted = meta.baseColorOrig.multiply(theme.tint);
      const glow = meta.glowColorOrig.multiply(theme.glowTint);
      mat.setColor3("baseColor", tinted);
      mat.setColor3("glowColor", glow);
    }
    if (this.groundMaterial) {
      if (!this.groundDiffuseOrig) {
        this.groundDiffuseOrig = this.groundMaterial.diffuseColor.clone();
      }
      this.groundMaterial.diffuseColor = this.groundDiffuseOrig.multiply(theme.ground);
    }
  }

  /**
   * Creates a hollow building shell at (x, z) with footprint width × depth and given height.
   * The shell has solid floor + roof + 4 walls. The +Z (front) wall has a door cutout
   * so the player can walk in. For tall buildings, an additional door + external ramp can
   * be placed on the +X side at mid-height. All wall pieces register AABB colliders so the
   * player physically bumps into them on foot.
   */
  private createHollowShell(
    name: string,
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    material: BABYLON.Material,
    addSideRamp: boolean = false,
    baseY: number = 0,
  ): void {
    const wt = 0.4; // wall thickness
    const doorW = 4;
    const doorH = 5;
    const halfW = width / 2;
    const halfD = depth / 2;
    const safeDoorW = Math.min(doorW, Math.max(2, width - 2));
    const halfDoor = safeDoorW / 2;

    // Floor (thin slab just above the base so player walks onto it cleanly).
    // Marked non-pickable; ground detection uses an analytic AABB lookup
    // (see floorPlatforms below) for speed.
    const floor = BABYLON.MeshBuilder.CreateBox(
      `${name}_floor`,
      { height: 0.2, width, depth },
      this.scene,
    );
    floor.position = new BABYLON.Vector3(x, baseY + 0.1, z);
    floor.material = material;
    floor.isPickable = false;
    floor.freezeWorldMatrix();
    this.buildings.push(floor);
    this.floorPlatforms.push({
      minX: x - halfW,
      maxX: x + halfW,
      minZ: z - halfD,
      maxZ: z + halfD,
      y: baseY + 0.2,
    });

    // Roof — non-pickable; rooftop platform (added separately) covers walking on top.
    const roof = BABYLON.MeshBuilder.CreateBox(
      `${name}_roof`,
      { height: 0.4, width, depth },
      this.scene,
    );
    roof.position = new BABYLON.Vector3(x, baseY + height - 0.2, z);
    roof.material = material;
    roof.isPickable = false;
    roof.freezeWorldMatrix();
    this.buildings.push(roof);
    // Roof underside doesn't need a floor platform entry; player can't stand
    // on the inside of the roof. The exterior rooftop platform (where added)
    // remains pickable as before.

    const pushWall = (
      n: string,
      cx: number,
      cy: number,
      cz: number,
      w: number,
      h: number,
      d: number,
    ) => {
      const wy = baseY + cy;
      const wall = BABYLON.MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, this.scene);
      wall.position = new BABYLON.Vector3(cx, wy, cz);
      wall.material = material;
      wall.isPickable = false;
      wall.freezeWorldMatrix();
      this.buildings.push(wall);
      this.wallColliders.push({
        minX: cx - w / 2,
        maxX: cx + w / 2,
        minZ: cz - d / 2,
        maxZ: cz + d / 2,
        minY: wy - h / 2,
        maxY: wy + h / 2,
      });
    };

    // Back wall (-Z, full)
    pushWall(`${name}_wallBack`, x, height / 2, z - halfD + wt / 2, width, height, wt);

    // Side ramp + door on +X side (only for tall buildings)
    const sideDoorY = Math.min(Math.max(height * 0.45, 12), height - doorH - 4);
    const enableSideDoor = addSideRamp && sideDoorY > 6;

    // Left wall (-X, full)
    pushWall(`${name}_wallLeft`, x - halfW + wt / 2, height / 2, z, wt, height, depth);

    // Right wall (+X) — split if side door present
    if (enableSideDoor) {
      const sdwHalf = halfDoor;
      // bottom slab below door
      pushWall(
        `${name}_wallR_bot`,
        x + halfW - wt / 2,
        sideDoorY / 2,
        z,
        wt,
        sideDoorY,
        depth,
      );
      // top slab above door
      const topH = height - (sideDoorY + doorH);
      if (topH > 0) {
        pushWall(
          `${name}_wallR_top`,
          x + halfW - wt / 2,
          sideDoorY + doorH + topH / 2,
          z,
          wt,
          topH,
          depth,
        );
      }
      // back-of-door strip (toward -Z)
      const backStripD = halfD - sdwHalf;
      if (backStripD > 0) {
        pushWall(
          `${name}_wallR_back`,
          x + halfW - wt / 2,
          sideDoorY + doorH / 2,
          z - halfD + backStripD / 2,
          wt,
          doorH,
          backStripD,
        );
      }
      // front-of-door strip (toward +Z)
      const frontStripD = halfD - sdwHalf;
      if (frontStripD > 0) {
        pushWall(
          `${name}_wallR_front`,
          x + halfW - wt / 2,
          sideDoorY + doorH / 2,
          z + halfD - frontStripD / 2,
          wt,
          doorH,
          frontStripD,
        );
      }
    } else {
      pushWall(`${name}_wallRight`, x + halfW - wt / 2, height / 2, z, wt, height, depth);
    }

    // Front wall (+Z) split into 3 pieces around the ground door
    const frontZ = z + halfD - wt / 2;
    const sideStripW = (width - safeDoorW) / 2;
    if (sideStripW > 0) {
      pushWall(
        `${name}_wallFL`,
        x - halfW + sideStripW / 2,
        height / 2,
        frontZ,
        sideStripW,
        height,
        wt,
      );
      pushWall(
        `${name}_wallFR`,
        x + halfW - sideStripW / 2,
        height / 2,
        frontZ,
        sideStripW,
        height,
        wt,
      );
    }
    const topPieceH = height - doorH;
    if (topPieceH > 0) {
      pushWall(`${name}_wallFT`, x, doorH + topPieceH / 2, frontZ, safeDoorW, topPieceH, wt);
    }

    // Door frame trim (cosmetic) on the front door
    const frameMat = new BABYLON.StandardMaterial(`${name}_frameMat`, this.scene);
    frameMat.emissiveColor = new BABYLON.Color3(0.2, 0.9, 1.2);
    frameMat.diffuseColor = new BABYLON.Color3(0.05, 0.2, 0.3);
    frameMat.freeze();
    const frameTop = BABYLON.MeshBuilder.CreateBox(
      `${name}_doorFrameTop`,
      { width: safeDoorW + 0.4, height: 0.25, depth: 0.5 },
      this.scene,
    );
    frameTop.position = new BABYLON.Vector3(x, baseY + doorH, frontZ + 0.05);
    frameTop.material = frameMat;
    frameTop.freezeWorldMatrix();

    // Side ramp + landing if requested
    if (enableSideDoor) {
      this.addExteriorRamp(x + halfW, baseY + sideDoorY, z, safeDoorW, material, frameMat);

      const sideFrame = BABYLON.MeshBuilder.CreateBox(
        `${name}_sideDoorFrame`,
        { width: 0.5, height: 0.25, depth: safeDoorW + 0.4 },
        this.scene,
      );
      sideFrame.position = new BABYLON.Vector3(x + halfW + 0.05, baseY + sideDoorY + doorH, z);
      sideFrame.material = frameMat;
      sideFrame.freezeWorldMatrix();
    }
  }

  /**
   * Adds an external ramp leading up the +X side of a building to a landing platform
   * at door height (doorBaseY). Ramp pitches gently so the player can walk up.
   */
  private addExteriorRamp(
    doorX: number,
    doorBaseY: number,
    doorZ: number,
    doorW: number,
    bodyMat: BABYLON.Material,
    accentMat: BABYLON.Material,
  ): void {
    const landingW = doorW + 2;
    const landingD = 4;
    const landing = BABYLON.MeshBuilder.CreateBox(
      `extRampLanding`,
      { width: landingD, height: 0.4, depth: landingW },
      this.scene,
    );
    landing.position = new BABYLON.Vector3(doorX + landingD / 2 - 0.2, doorBaseY - 0.2, doorZ);
    landing.material = bodyMat;
    landing.freezeWorldMatrix();
    this.platforms.push(landing);
    this.floorPlatforms.push({
      minX: landing.position.x - landingD / 2,
      maxX: landing.position.x + landingD / 2,
      minZ: landing.position.z - landingW / 2,
      maxZ: landing.position.z + landingW / 2,
      y: doorBaseY,
    });

    const rampLength = doorBaseY * 1.8;
    const slabL = Math.sqrt(rampLength * rampLength + doorBaseY * doorBaseY);
    const ramp = BABYLON.MeshBuilder.CreateBox(
      `extRampSlab`,
      { width: slabL, height: 0.4, depth: landingW },
      this.scene,
    );
    const rampMidX = doorX + landingD + rampLength / 2;
    ramp.position = new BABYLON.Vector3(rampMidX, doorBaseY / 2, doorZ);
    ramp.rotation.z = Math.atan2(doorBaseY, rampLength);
    ramp.material = bodyMat;
    ramp.freezeWorldMatrix();
    this.platforms.push(ramp);

    // Glow strip along ramp edge
    const strip = BABYLON.MeshBuilder.CreateBox(
      `extRampGlow`,
      { width: slabL, height: 0.15, depth: 0.3 },
      this.scene,
    );
    strip.position = new BABYLON.Vector3(rampMidX, doorBaseY / 2 + 0.25, doorZ + landingW / 2 - 0.15);
    strip.rotation.z = Math.atan2(doorBaseY, rampLength);
    strip.material = accentMat;
    strip.freezeWorldMatrix();
  }

  getWallColliders(): WallCollider[] {
    return this.wallColliders;
  }

  getFloorPlatforms(): FloorPlatform[] {
    return this.floorPlatforms;
  }

  /**
   * Returns the highest driveable Y at (x, z) for a vehicle whose chassis is
   * currently at `currentY`. Used by VehicleSystem to keep ATVs sticking to
   * the ground, the racetrack ramp, and the sky-track segments. The
   * `currentY + headroom` filter prevents a vehicle on the ground from being
   * yanked up onto a building rooftop just because its (x,z) happens to be
   * inside the rooftop's footprint.
   */
  getDriveableHeight(x: number, z: number, currentY: number = Infinity): number {
    let best = 0;
    const headroom = 3.0;

    // Sky-racetrack ramps (tilted planes in arbitrary cardinal directions).
    // Project (x,z) onto the ramp's low→high vector, sample linearly along
    // the run, and clamp by lateral half-width.
    for (let r = 0; r < this.rampParams.length; r++) {
      const rp = this.rampParams[r];
      const dirX = rp.highX - rp.lowX;
      const dirZ = rp.highZ - rp.lowZ;
      const runSq = dirX * dirX + dirZ * dirZ;
      if (runSq < 0.01) continue;
      const run = Math.sqrt(runSq);
      const ux = dirX / run;
      const uz = dirZ / run;
      const px = x - rp.lowX;
      const pz = z - rp.lowZ;
      const along = px * ux + pz * uz;          // 0 at low end, run at high end
      if (along < 0 || along > run) continue;
      const perp = Math.abs(px * (-uz) + pz * ux);
      if (perp > rp.width / 2) continue;
      const rampY = (along / run) * rp.rise;
      if (rampY <= currentY + headroom && rampY > best) best = rampY;
    }

    // Floor platforms (track segments, ramp landing pad, building roofs/floors).
    for (let i = 0; i < this.floorPlatforms.length; i++) {
      const f = this.floorPlatforms[i];
      if (f.y > currentY + headroom) continue;
      if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
      if (f.y > best) best = f.y;
    }
    return best;
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
    this.createMountainBiome();
    this.createJungleBiome();
    this.createDesertBiome();
    this.createJunkyardBiome();
    this.createSkyCities();
    this.createSkyBridges();
    this.createOuterDistricts();
    this.createSkyRacetrack();
  }

  /**
   * Builds a giant sky racetrack — a flat ring at high altitude encircling the
   * downtown core — plus four long connection ramps leading up to it from the
   * north, east, south and west cardinal sides. The track is segmented (so
   * cars can lean into the curve) with low neon barriers. Each ramp slab and
   * the track segments are registered as floor platforms so ATVs and players
   * cleanly land on them; getDriveableHeight() samples each tilted ramp
   * analytically.
   */
  private createSkyRacetrack(): void {
    const trackY = 80;
    const trackRadius = 280;
    const trackWidth = 22;
    const segments = 56;

    const trackMat = new BABYLON.StandardMaterial("racetrackMat", this.scene);
    trackMat.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.12);
    trackMat.emissiveColor = new BABYLON.Color3(0.05, 0.05, 0.08);
    trackMat.freeze();

    const lineMat = new BABYLON.StandardMaterial("racetrackLineMat", this.scene);
    lineMat.diffuseColor = new BABYLON.Color3(0.05, 0.4, 0.5);
    lineMat.emissiveColor = new BABYLON.Color3(0.1, 1.2, 1.6);
    lineMat.freeze();

    const barrierMat = new BABYLON.StandardMaterial("racetrackBarrierMat", this.scene);
    barrierMat.diffuseColor = new BABYLON.Color3(0.4, 0.05, 0.3);
    barrierMat.emissiveColor = new BABYLON.Color3(1.6, 0.2, 1.2);
    barrierMat.freeze();

    const segmentArc = (Math.PI * 2) / segments;
    const segmentLen = 2 * trackRadius * Math.tan(segmentArc / 2);

    for (let i = 0; i < segments; i++) {
      const theta = i * segmentArc + segmentArc / 2;
      const cx = Math.cos(theta) * trackRadius;
      const cz = Math.sin(theta) * trackRadius;
      // outward normal yaw — segment's depth axis points inward/outward, width axis is tangent
      const yaw = -theta + Math.PI / 2;

      const slab = BABYLON.MeshBuilder.CreateBox(
        `rt_seg_${i}`,
        { width: segmentLen + 0.5, height: 0.6, depth: trackWidth },
        this.scene,
      );
      slab.position = new BABYLON.Vector3(cx, trackY, cz);
      slab.rotation.y = yaw;
      slab.material = trackMat;
      slab.freezeWorldMatrix();
      this.platforms.push(slab);

      // Inner + outer neon barriers (low, so vehicles bump back)
      const barrierH = 1.5;
      const innerR = trackRadius - trackWidth / 2 + 0.3;
      const outerR = trackRadius + trackWidth / 2 - 0.3;
      const inner = BABYLON.MeshBuilder.CreateBox(
        `rt_barIn_${i}`,
        { width: segmentLen + 0.5, height: barrierH, depth: 0.5 },
        this.scene,
      );
      inner.position = new BABYLON.Vector3(
        Math.cos(theta) * innerR,
        trackY + barrierH / 2 + 0.3,
        Math.sin(theta) * innerR,
      );
      inner.rotation.y = yaw;
      inner.material = barrierMat;
      inner.isPickable = false;
      inner.freezeWorldMatrix();

      const outer = BABYLON.MeshBuilder.CreateBox(
        `rt_barOut_${i}`,
        { width: segmentLen + 0.5, height: barrierH, depth: 0.5 },
        this.scene,
      );
      outer.position = new BABYLON.Vector3(
        Math.cos(theta) * outerR,
        trackY + barrierH / 2 + 0.3,
        Math.sin(theta) * outerR,
      );
      outer.rotation.y = yaw;
      outer.material = barrierMat;
      outer.isPickable = false;
      outer.freezeWorldMatrix();

      // Wall colliders for the barriers — subdivide the curve into many
      // SHORT chord pieces so each AABB tightly hugs the rotated barrier. A
      // single big AABB per segment over-approximates badly at diagonal
      // angles (an at-45° box has a √2× AABB swelling), causing vehicles to
      // ricochet from empty air. With 6 sub-pieces per segment, each piece's
      // AABB stays under ~5u even at the worst rotation.
      const subDivs = 6;
      const subArc = segmentArc / subDivs;
      for (let s = 0; s < subDivs; s++) {
        const subTheta = (i * segmentArc) + (s + 0.5) * subArc;
        const subChord = 2 * trackRadius * Math.tan(subArc / 2) + 0.3;
        const inX = Math.cos(subTheta) * innerR;
        const inZ = Math.sin(subTheta) * innerR;
        const outX = Math.cos(subTheta) * outerR;
        const outZ = Math.sin(subTheta) * outerR;
        // Tangent direction (unit): perpendicular to radial.
        const tX = -Math.sin(subTheta);
        const tZ = Math.cos(subTheta);
        const halfChord = subChord / 2;
        // Inner barrier sub-piece
        const inMinX = Math.min(inX - tX * halfChord, inX + tX * halfChord);
        const inMaxX = Math.max(inX - tX * halfChord, inX + tX * halfChord);
        const inMinZ = Math.min(inZ - tZ * halfChord, inZ + tZ * halfChord);
        const inMaxZ = Math.max(inZ - tZ * halfChord, inZ + tZ * halfChord);
        this.wallColliders.push({
          minX: inMinX - 0.25,
          maxX: inMaxX + 0.25,
          minZ: inMinZ - 0.25,
          maxZ: inMaxZ + 0.25,
          minY: trackY,
          maxY: trackY + barrierH + 0.5,
        });
        // Outer barrier sub-piece
        const outMinX = Math.min(outX - tX * halfChord, outX + tX * halfChord);
        const outMaxX = Math.max(outX - tX * halfChord, outX + tX * halfChord);
        const outMinZ = Math.min(outZ - tZ * halfChord, outZ + tZ * halfChord);
        const outMaxZ = Math.max(outZ - tZ * halfChord, outZ + tZ * halfChord);
        this.wallColliders.push({
          minX: outMinX - 0.25,
          maxX: outMaxX + 0.25,
          minZ: outMinZ - 0.25,
          maxZ: outMaxZ + 0.25,
          minY: trackY,
          maxY: trackY + barrierH + 0.5,
        });
      }

      // Neon center line every other segment for a sense of speed.
      if (i % 2 === 0) {
        const line = BABYLON.MeshBuilder.CreateBox(
          `rt_line_${i}`,
          { width: segmentLen * 0.55, height: 0.1, depth: 0.6 },
          this.scene,
        );
        line.position = new BABYLON.Vector3(cx, trackY + 0.4, cz);
        line.rotation.y = yaw;
        line.material = lineMat;
        line.isPickable = false;
        line.freezeWorldMatrix();
      }

      // Segment AABB floor entry (over-approximation; adjacent segments
      // overlap slightly so the player never falls through a seam).
      const halfDiag = Math.max(segmentLen, trackWidth) / 2;
      this.floorPlatforms.push({
        minX: cx - halfDiag,
        maxX: cx + halfDiag,
        minZ: cz - halfDiag,
        maxZ: cz + halfDiag,
        y: trackY + 0.3,
      });
    }

    // ─── Four giant ramps from the ground onto the ring (N / E / S / W) ───
    // Each ramp lands just outside the ring's barrier on its cardinal side
    // and runs out away from the city center, so players and vehicles can
    // jump on the track from any approach.
    const rampMat = new BABYLON.StandardMaterial("racetrackRampMat", this.scene);
    rampMat.diffuseColor = new BABYLON.Color3(0.1, 0.1, 0.14);
    rampMat.emissiveColor = new BABYLON.Color3(0.04, 0.06, 0.1);
    rampMat.freeze();

    const rampOpts = {
      width: 18,
      rise: trackY,
      run: 220, // ~20° incline
      mat: rampMat,
      barrierMat,
    };
    const landingOffset = 8; // sit the ramp's top just outside the barrier
    const ringEdge = trackRadius + landingOffset;

    // outwardX/outwardZ point AWAY from ring center toward where the ramp's
    // ground end will be. The "endX/endZ" lands on the ring at that side.
    this.addRacetrackRamp({ endX: 0, endZ: ringEdge, outwardX: 0, outwardZ: 1, ...rampOpts });   // SOUTH (original)
    this.addRacetrackRamp({ endX: 0, endZ: -ringEdge, outwardX: 0, outwardZ: -1, ...rampOpts }); // NORTH
    this.addRacetrackRamp({ endX: ringEdge, endZ: 0, outwardX: 1, outwardZ: 0, ...rampOpts });   // EAST
    this.addRacetrackRamp({ endX: -ringEdge, endZ: 0, outwardX: -1, outwardZ: 0, ...rampOpts }); // WEST
  }

  /**
   * Build one racetrack ramp from the ground up to the ring. The ramp is a
   * tilted box oriented by `outwardX/outwardZ` (unit vector pointing away from
   * the ring center), with its top end at (endX, endZ, rise) and ground end
   * `run` units further outward.
   */
  private addRacetrackRamp(opts: {
    endX: number; endZ: number;
    outwardX: number; outwardZ: number;
    width: number; rise: number; run: number;
    mat: BABYLON.Material; barrierMat: BABYLON.Material;
  }): void {
    const { endX, endZ, outwardX, outwardZ, width, rise, run, mat, barrierMat } = opts;

    const lowX = endX + outwardX * run;
    const lowZ = endZ + outwardZ * run;
    const midX = (endX + lowX) / 2;
    const midZ = (endZ + lowZ) / 2;
    const midY = rise / 2;
    const rampLen = Math.sqrt(rise * rise + run * run);
    const pitch = Math.atan2(rise, run);
    const yaw = Math.atan2(outwardX, outwardZ);

    // Compose yaw (around world Y) then pitch (around the post-yaw local-X
    // axis) so the box's depth axis lies along outward and its high end sits
    // at y=rise above (endX, endZ).
    const yawQuat = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Up(), yaw);
    const pitchAxis = new BABYLON.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const pitchQuat = BABYLON.Quaternion.RotationAxis(pitchAxis, pitch);
    const rampQuat = pitchQuat.multiply(yawQuat);

    const tag = `${endX.toFixed(0)}_${endZ.toFixed(0)}`;

    const ramp = BABYLON.MeshBuilder.CreateBox(
      `rt_ramp_${tag}`,
      { width, height: 0.6, depth: rampLen },
      this.scene,
    );
    ramp.position = new BABYLON.Vector3(midX, midY, midZ);
    ramp.rotationQuaternion = rampQuat.clone();
    ramp.material = mat;
    ramp.freezeWorldMatrix();
    this.platforms.push(ramp);

    // Save analytic params: low-end (ground) and high-end (ring) endpoints.
    this.rampParams.push({
      lowX, lowZ,
      highX: endX, highZ: endZ,
      width,
      rise,
    });

    // Side glow strips. Lateral axis (perpendicular to outward in XZ).
    const sideAxisX = -outwardZ;
    const sideAxisZ = outwardX;
    for (const side of [-1, 1]) {
      const strip = BABYLON.MeshBuilder.CreateBox(
        `rt_rampGlow_${tag}_${side}`,
        { width: 0.4, height: 0.2, depth: rampLen },
        this.scene,
      );
      const stripCenterX = midX + side * (width / 2 - 0.3) * sideAxisX;
      const stripCenterZ = midZ + side * (width / 2 - 0.3) * sideAxisZ;
      strip.position = new BABYLON.Vector3(stripCenterX, midY + 0.5, stripCenterZ);
      strip.rotationQuaternion = rampQuat.clone();
      strip.material = barrierMat;
      strip.isPickable = false;
      strip.freezeWorldMatrix();
    }

    // Ground landing pad just past the ramp's low end so vehicles can drive
    // straight onto the slope without a step.
    const padDist = run + 6;
    const padX = endX + outwardX * padDist;
    const padZ = endZ + outwardZ * padDist;
    const pad = BABYLON.MeshBuilder.CreateBox(
      `rt_rampPad_${tag}`,
      { width: width + 4, height: 0.4, depth: 12 },
      this.scene,
    );
    pad.position = new BABYLON.Vector3(padX, 0.2, padZ);
    pad.rotation.y = yaw;
    pad.material = mat;
    pad.freezeWorldMatrix();
    this.platforms.push(pad);

    // Floor AABB for the pad (axis-aligned approximation that's a bit wider
    // than the rotated box so the player always lands on it).
    const padHalf = (width + 4) / 2 + 4;
    this.floorPlatforms.push({
      minX: padX - padHalf, maxX: padX + padHalf,
      minZ: padZ - padHalf, maxZ: padZ + padHalf,
      y: 0.4,
    });

    // Beacon pylon next to each pad — visible from far away.
    const beaconOffsetX = sideAxisX * (width / 2 + 6);
    const beaconOffsetZ = sideAxisZ * (width / 2 + 6);
    const beacon = BABYLON.MeshBuilder.CreateCylinder(
      `rt_beacon_${tag}`,
      { height: 30, diameter: 1.5 },
      this.scene,
    );
    beacon.position = new BABYLON.Vector3(padX + beaconOffsetX, 15, padZ + beaconOffsetZ);
    beacon.material = barrierMat;
    beacon.freezeWorldMatrix();
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
    this.groundMaterial = groundMat;
    this.groundMesh = ground;
  }

  /** Returns every static building + walkable platform mesh so the
   *  LODCullSystem can register them for distance culling. The ground
   *  plane and skyline-decoration extra surfaces (river, lamp poles) are
   *  intentionally excluded — the ground is one giant mesh and the river
   *  / lamps are visual reference at distance.
   *
   *  These meshes are already `freezeWorldMatrix()`-ed at generation
   *  time, so toggling `setEnabled` is the cheapest possible operation
   *  Babylon offers — no transform recompute on re-show. */
  getCullableBuildings(): BABYLON.Mesh[] {
    return this.buildings;
  }
  getCullablePlatforms(): BABYLON.Mesh[] {
    return this.platforms;
  }

  /** Toggle visibility of the entire city (buildings, walkable platforms,
   *  ground plane). Used by SpaceLevelSystem to ensure the orbital level
   *  shows nothing but stars + Earth + asteroids. We use `setEnabled` so
   *  the meshes are also skipped during render culling, not just hidden. */
  setVisible(visible: boolean): void {
    for (let i = 0; i < this.buildings.length; i++) {
      this.buildings[i].setEnabled(visible);
    }
    for (let i = 0; i < this.platforms.length; i++) {
      this.platforms[i].setEnabled(visible);
    }
    if (this.groundMesh) this.groundMesh.setEnabled(visible);
    for (let i = 0; i < this.extraSurfaceMeshes.length; i++) {
      this.extraSurfaceMeshes[i].setEnabled(visible);
    }
    // Toggle PointLights via setEnabled — Babylon respects this so the
    // light no longer contributes to lighting calc when disabled.
    for (let i = 0; i < this.extraSurfaceLights.length; i++) {
      this.extraSurfaceLights[i].setEnabled(visible);
    }
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
    this.extraSurfaceMeshes.push(river);

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
        this.extraSurfaceMeshes.push(pole);

        const lamp = BABYLON.MeshBuilder.CreateSphere("streetLamp", { diameter: 0.8 }, this.scene);
        lamp.position = new BABYLON.Vector3(x, poleHeight + 0.2, z);

        seed++;
        const colorIdx = Math.floor(seededRandom(seed) * lightColorOptions.length);
        const color = lightColorOptions[colorIdx];
        const lampMat = new BABYLON.StandardMaterial("lampMat", this.scene);
        lampMat.emissiveColor = color;
        lampMat.diffuseColor = color;
        lamp.material = lampMat;
        this.extraSurfaceMeshes.push(lamp);

        if ((x + z) % 90 === 0) {
          const light = new BABYLON.PointLight("streetLight", new BABYLON.Vector3(x, poleHeight + 0.5, z), this.scene);
          light.diffuse = color;
          light.intensity = 0.6;
          light.range = 25;
          this.extraSurfaceLights.push(light);
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

    // Wider grid + smaller jitter + slightly smaller footprints than before so
    // there are real road-width gaps between downtown buildings (~14-18u clear).
    let seed = 100;
    for (let x = -130; x <= 130; x += 32) {
      for (let z = -100; z <= 100; z += 32) {
        if (Math.abs(z) > 150) continue;

        seed++;
        const height = 30 + seededRandom(seed) * 120;
        const width = 8 + seededRandom(seed + 1000) * 8;
        const depth = 8 + seededRandom(seed + 2000) * 8;

        const bx = x + (seededRandom(seed + 3000) - 0.5) * 4;
        const bz = z + (seededRandom(seed + 4000) - 0.5) * 4;

        // Keep a clear ring around the player spawn (0,0,-15) so the player
        // never wakes up inside a wall.
        const dxs = bx - 0;
        const dzs = bz - -15;
        const halfW = Math.max(width, depth) / 2;
        if (dxs * dxs + dzs * dzs < (halfW + 18) * (halfW + 18)) continue;

        const colorSet = colors[Math.floor(seededRandom(seed + 5000) * colors.length)];
        const mat = this.createBuildingMaterial(colorSet.base, colorSet.glow);

        this.createHollowShell(`downtown_${x}_${z}`, bx, bz, width, depth, height, mat, height > 40);
        this.addRooftopPlatform(bx, height, bz, width, depth);

        if (height > 80) {
          const proxy = { position: new BABYLON.Vector3(bx, height / 2, bz) } as BABYLON.Mesh;
          this.addBuildingDetails(proxy, height, width, depth);
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
    // Wider step leaves ~15u road gap between 30u-wide factories.
    for (let x = 130; x <= 230; x += 45) {
      for (let z = -150; z <= 50; z += 45) {
        seed++;
        const height = 20 + seededRandom(seed) * 15;
        const factoryMat = this.createBuildingMaterial(
          new BABYLON.Color3(0.2, 0.15, 0.1),
          new BABYLON.Color3(1, 0.5, 0)
        );
        this.createHollowShell(`factory_${x}_${z}`, x, z, 30, 30, height, factoryMat, false);
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
    // Wider step leaves ~12u road gap between 12u-wide residential towers.
    for (let x = -230; x <= -120; x += 24) {
      for (let z = -108; z <= 108; z += 24) {
        seed++;
        const height = 15 + seededRandom(seed) * 25;
        const material = this.createBuildingMaterial(
          new BABYLON.Color3(0.15, 0.18, 0.2),
          new BABYLON.Color3(0, 0.8, 1)
        );
        this.createHollowShell(`residential_${x}_${z}`, x, z, 12, 12, height, material, height > 30);
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

  private createMountainBiome(): void {
    const rockMat = new BABYLON.StandardMaterial("mtnRockMat", this.scene);
    rockMat.diffuseColor = new BABYLON.Color3(0.3, 0.27, 0.22);
    rockMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

    const snowMat = new BABYLON.StandardMaterial("mtnSnowMat", this.scene);
    snowMat.diffuseColor = new BABYLON.Color3(0.9, 0.92, 0.98);
    snowMat.emissiveColor = new BABYLON.Color3(0.12, 0.12, 0.18);

    const darkRockMat = new BABYLON.StandardMaterial("mtnDarkRockMat", this.scene);
    darkRockMat.diffuseColor = new BABYLON.Color3(0.18, 0.16, 0.14);

    const pathMat = new BABYLON.StandardMaterial("mtnPathMat", this.scene);
    pathMat.diffuseColor = new BABYLON.Color3(0.35, 0.3, 0.25);
    pathMat.emissiveColor = new BABYLON.Color3(0.03, 0.02, 0.01);

    const caveMat = new BABYLON.StandardMaterial("mtnCaveMat", this.scene);
    caveMat.diffuseColor = new BABYLON.Color3(0.08, 0.07, 0.06);
    caveMat.emissiveColor = new BABYLON.Color3(0.02, 0.01, 0.0);

    const groundPatch = BABYLON.MeshBuilder.CreateGround(
      "mtnGround",
      { width: 500, height: 500 },
      this.scene
    );
    groundPatch.position = new BABYLON.Vector3(0, 0.06, 450);
    const mtnGroundMat = new BABYLON.StandardMaterial("mtnGroundMat", this.scene);
    mtnGroundMat.diffuseColor = new BABYLON.Color3(0.22, 0.2, 0.18);
    mtnGroundMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.01);
    groundPatch.material = mtnGroundMat;

    let seed = 5000;
    const peaks = [
      { cx: -80, cz: 380, label: "NW" },
      { cx: 60, cz: 420, label: "NC" },
      { cx: -30, cz: 520, label: "NF" },
      { cx: 120, cz: 500, label: "NE" },
      { cx: -150, cz: 480, label: "NWF" },
      { cx: 0, cz: 600, label: "NFar" },
      { cx: 180, cz: 400, label: "NEn" },
      { cx: -100, cz: 550, label: "NWFar" },
      { cx: 80, cz: 580, label: "NEFar" },
    ];

    for (const peak of peaks) {
      seed++;
      const peakHeight = 60 + seededRandom(seed) * 100;
      const baseSize = 30 + seededRandom(seed + 100) * 40;

      const mountain = BABYLON.MeshBuilder.CreateCylinder(
        `mtn_${peak.label}`,
        {
          height: peakHeight,
          diameterTop: 2 + seededRandom(seed + 200) * 6,
          diameterBottom: baseSize,
          tessellation: 6 + Math.floor(seededRandom(seed + 300) * 4),
        },
        this.scene
      );
      mountain.position = new BABYLON.Vector3(peak.cx, peakHeight / 2, peak.cz);
      mountain.rotation.y = seededRandom(seed + 400) * Math.PI;

      if (peakHeight > 90) {
        mountain.material = snowMat;
        const snowCap = BABYLON.MeshBuilder.CreateCylinder(
          `mtnSnow_${peak.label}`,
          { height: peakHeight * 0.3, diameterTop: 1, diameterBottom: baseSize * 0.4, tessellation: 6 },
          this.scene
        );
        snowCap.position = new BABYLON.Vector3(peak.cx, peakHeight * 0.85, peak.cz);
        snowCap.material = snowMat;
      } else {
        mountain.material = rockMat;
      }

      const boulderCount = 4 + Math.floor(seededRandom(seed + 500) * 6);
      for (let b = 0; b < boulderCount; b++) {
        seed++;
        const bAngle = seededRandom(seed) * Math.PI * 2;
        const bDist = baseSize * 0.5 + seededRandom(seed + 100) * baseSize * 0.6;
        const bSize = 3 + seededRandom(seed + 200) * 8;
        const boulder = BABYLON.MeshBuilder.CreateSphere(
          `mtnBoulder_${peak.label}_${b}`, { diameter: bSize, segments: 4 }, this.scene
        );
        boulder.position = new BABYLON.Vector3(
          peak.cx + Math.cos(bAngle) * bDist, bSize / 2, peak.cz + Math.sin(bAngle) * bDist
        );
        boulder.scaling = new BABYLON.Vector3(
          1 + seededRandom(seed + 300) * 0.5, 0.5 + seededRandom(seed + 400) * 0.5, 1 + seededRandom(seed + 500) * 0.5
        );
        boulder.material = darkRockMat;
      }
    }

    for (let r = 0; r < 6; r++) {
      seed++;
      const ridgeLen = 40 + seededRandom(seed) * 80;
      const ridgeH = 15 + seededRandom(seed + 100) * 30;
      const ridge = BABYLON.MeshBuilder.CreateBox(
        `mtnRidge_${r}`, { height: ridgeH, width: ridgeLen, depth: 8 + seededRandom(seed + 200) * 10 }, this.scene
      );
      ridge.position = new BABYLON.Vector3(
        (seededRandom(seed + 300) - 0.5) * 300, ridgeH / 2, 350 + seededRandom(seed + 400) * 250
      );
      ridge.rotation.y = seededRandom(seed + 500) * Math.PI;
      ridge.material = rockMat;
    }

    for (let c = 0; c < 3; c++) {
      seed++;
      const cx = (seededRandom(seed) - 0.5) * 200;
      const cz = 380 + seededRandom(seed + 100) * 200;
      const caveW = 12 + seededRandom(seed + 200) * 8;
      const caveH = 8 + seededRandom(seed + 300) * 6;

      const caveEntrance = BABYLON.MeshBuilder.CreateBox(
        `mtnCave_${c}`, { height: caveH, width: caveW, depth: 10 }, this.scene
      );
      caveEntrance.position = new BABYLON.Vector3(cx, caveH / 2, cz);
      caveEntrance.material = caveMat;

      const caveArch = BABYLON.MeshBuilder.CreateCylinder(
        `mtnCaveArch_${c}`, { height: caveW, diameter: caveH, tessellation: 8 }, this.scene
      );
      caveArch.rotation.z = Math.PI / 2;
      caveArch.position = new BABYLON.Vector3(cx, caveH, cz - 5);
      caveArch.material = darkRockMat;

      const glowOrb = BABYLON.MeshBuilder.CreateSphere(`mtnCaveGlow_${c}`, { diameter: 1.5 }, this.scene);
      glowOrb.position = new BABYLON.Vector3(cx, caveH * 0.6, cz + 2);
      const glowMat = new BABYLON.StandardMaterial(`mtnCaveGlowMat_${c}`, this.scene);
      glowMat.emissiveColor = new BABYLON.Color3(0.2, 0.6, 0.8);
      glowOrb.material = glowMat;
    }

    for (let p = 0; p < 15; p++) {
      seed++;
      const t = p / 15;
      const px = -100 + t * 200 + (seededRandom(seed) - 0.5) * 30;
      const pz = 320 + t * 250;
      const pathSeg = BABYLON.MeshBuilder.CreateBox(
        `mtnPath_${p}`, { height: 0.3, width: 6, depth: 20 }, this.scene
      );
      pathSeg.position = new BABYLON.Vector3(px, 0.2, pz);
      pathSeg.rotation.y = seededRandom(seed + 100) * 0.5;
      pathSeg.material = pathMat;
    }

    this.createMountainTemple(0, 400, seed);
    seed += 100;
    this.createMountainVillage(-120, 360, seed);
  }

  private createMountainTemple(x: number, z: number, seed: number): void {
    const templeMat = new BABYLON.StandardMaterial("mtnTempleMat", this.scene);
    templeMat.diffuseColor = new BABYLON.Color3(0.5, 0.48, 0.42);
    templeMat.emissiveColor = new BABYLON.Color3(0.05, 0.04, 0.03);

    const glowMat = new BABYLON.StandardMaterial("mtnTempleGlow", this.scene);
    glowMat.emissiveColor = new BABYLON.Color3(0.3, 0.7, 1.0);
    glowMat.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.5);

    const base = BABYLON.MeshBuilder.CreateBox("mtnTempleBase", { height: 4, width: 30, depth: 30 }, this.scene);
    base.position = new BABYLON.Vector3(x, 2, z);
    base.material = templeMat;

    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const pillar = BABYLON.MeshBuilder.CreateCylinder(
        `mtnTemplePillar_${i}`, { height: 18, diameter: 2.5 }, this.scene
      );
      pillar.position = new BABYLON.Vector3(x + Math.cos(angle) * 12, 13, z + Math.sin(angle) * 12);
      pillar.material = templeMat;
    }

    const roof = BABYLON.MeshBuilder.CreateCylinder(
      "mtnTempleRoof", { height: 8, diameterTop: 1, diameterBottom: 35, tessellation: 4 }, this.scene
    );
    roof.position = new BABYLON.Vector3(x, 26, z);
    roof.material = templeMat;

    const altar = BABYLON.MeshBuilder.CreateSphere("mtnTempleAltar", { diameter: 3 }, this.scene);
    altar.position = new BABYLON.Vector3(x, 6, z);
    altar.material = glowMat;

    const altarLight = new BABYLON.PointLight("mtnTempleLight", new BABYLON.Vector3(x, 8, z), this.scene);
    altarLight.diffuse = new BABYLON.Color3(0.3, 0.7, 1.0);
    altarLight.intensity = 1.0;
    altarLight.range = 30;
  }

  private createMountainVillage(x: number, z: number, seed: number): void {
    const hutMat = new BABYLON.StandardMaterial("mtnHutMat", this.scene);
    hutMat.diffuseColor = new BABYLON.Color3(0.35, 0.28, 0.2);
    hutMat.emissiveColor = new BABYLON.Color3(0.03, 0.02, 0.01);

    const roofMat = new BABYLON.StandardMaterial("mtnHutRoof", this.scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.25, 0.2, 0.15);

    for (let h = 0; h < 6; h++) {
      seed++;
      const hx = x + (seededRandom(seed) - 0.5) * 60;
      const hz = z + (seededRandom(seed + 100) - 0.5) * 60;
      const hutH = 5 + seededRandom(seed + 200) * 4;
      const hutW = 6 + seededRandom(seed + 300) * 4;

      const hut = BABYLON.MeshBuilder.CreateBox(
        `mtnHut_${h}`, { height: hutH, width: hutW, depth: hutW }, this.scene
      );
      hut.position = new BABYLON.Vector3(hx, hutH / 2, hz);
      hut.material = hutMat;

      const roof = BABYLON.MeshBuilder.CreateCylinder(
        `mtnHutRoof_${h}`, { height: 4, diameterTop: 0.5, diameterBottom: hutW * 1.5, tessellation: 4 }, this.scene
      );
      roof.position = new BABYLON.Vector3(hx, hutH + 2, hz);
      roof.material = roofMat;
    }

    const firePit = BABYLON.MeshBuilder.CreateCylinder("mtnFirePit", { height: 1, diameter: 4 }, this.scene);
    firePit.position = new BABYLON.Vector3(x, 0.5, z);
    const fireMat = new BABYLON.StandardMaterial("mtnFireMat", this.scene);
    fireMat.emissiveColor = new BABYLON.Color3(1.0, 0.4, 0.0);
    fireMat.diffuseColor = new BABYLON.Color3(0.8, 0.3, 0.0);
    firePit.material = fireMat;

    const fireLight = new BABYLON.PointLight("mtnFireLight", new BABYLON.Vector3(x, 3, z), this.scene);
    fireLight.diffuse = new BABYLON.Color3(1.0, 0.5, 0.1);
    fireLight.intensity = 0.8;
    fireLight.range = 25;
  }

  private createJungleBiome(): void {
    const jungleTrunkMat = new BABYLON.StandardMaterial("jngTrunkMat", this.scene);
    jungleTrunkMat.diffuseColor = new BABYLON.Color3(0.2, 0.15, 0.08);
    jungleTrunkMat.emissiveColor = new BABYLON.Color3(0.01, 0.02, 0.0);

    const jungleLeafMat = new BABYLON.StandardMaterial("jngLeafMat", this.scene);
    jungleLeafMat.diffuseColor = new BABYLON.Color3(0.0, 0.4, 0.1);
    jungleLeafMat.emissiveColor = new BABYLON.Color3(0.0, 0.08, 0.02);

    const bioGlowMat = new BABYLON.StandardMaterial("jngBioGlow", this.scene);
    bioGlowMat.diffuseColor = new BABYLON.Color3(0.0, 0.6, 0.4);
    bioGlowMat.emissiveColor = new BABYLON.Color3(0.0, 0.4, 0.25);

    const cyberLeafMat = new BABYLON.StandardMaterial("jngCyberLeaf", this.scene);
    cyberLeafMat.diffuseColor = new BABYLON.Color3(0.0, 0.3, 0.5);
    cyberLeafMat.emissiveColor = new BABYLON.Color3(0.0, 0.15, 0.3);

    const vineMat = new BABYLON.StandardMaterial("jngVineMat", this.scene);
    vineMat.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.05);
    vineMat.emissiveColor = new BABYLON.Color3(0.0, 0.05, 0.01);

    const ruinMat = new BABYLON.StandardMaterial("jngRuinMat", this.scene);
    ruinMat.diffuseColor = new BABYLON.Color3(0.3, 0.32, 0.28);
    ruinMat.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.02);

    const leafMats = [jungleLeafMat, bioGlowMat, cyberLeafMat];

    const groundPatch = BABYLON.MeshBuilder.CreateGround(
      "jngGround", { width: 500, height: 500 }, this.scene
    );
    groundPatch.position = new BABYLON.Vector3(450, 0.06, 0);
    const jngGroundMat = new BABYLON.StandardMaterial("jngGroundMat", this.scene);
    jngGroundMat.diffuseColor = new BABYLON.Color3(0.05, 0.15, 0.05);
    jngGroundMat.emissiveColor = new BABYLON.Color3(0.01, 0.03, 0.01);
    groundPatch.material = jngGroundMat;

    let seed = 6000;

    for (let t = 0; t < 40; t++) {
      seed++;
      const tx = 300 + seededRandom(seed) * 300;
      const tz = (seededRandom(seed + 100) - 0.5) * 400;
      const trunkH = 10 + seededRandom(seed + 200) * 20;
      const trunkD = 1.5 + seededRandom(seed + 300) * 3;

      const trunk = BABYLON.MeshBuilder.CreateCylinder(
        `jngTrunk_${t}`, { height: trunkH, diameter: trunkD }, this.scene
      );
      trunk.position = new BABYLON.Vector3(tx, trunkH / 2, tz);
      trunk.material = jungleTrunkMat;

      const canopyCount = 2 + Math.floor(seededRandom(seed + 400) * 3);
      const chosenLeaf = leafMats[Math.floor(seededRandom(seed + 500) * leafMats.length)];
      for (let c = 0; c < canopyCount; c++) {
        const cSize = 6 + seededRandom(seed + c * 100 + 600) * 10;
        const canopy = BABYLON.MeshBuilder.CreateSphere(
          `jngCanopy_${t}_${c}`, { diameter: cSize, segments: 6 }, this.scene
        );
        canopy.position = new BABYLON.Vector3(
          tx + (seededRandom(seed + c * 100 + 700) - 0.5) * 5,
          trunkH + cSize * 0.2 + c * 2,
          tz + (seededRandom(seed + c * 100 + 800) - 0.5) * 5
        );
        canopy.scaling.y = 0.5 + seededRandom(seed + c * 100 + 900) * 0.3;
        canopy.material = chosenLeaf;
      }

      if (seededRandom(seed + 1000) > 0.5) {
        const vineCount = 2 + Math.floor(seededRandom(seed + 1100) * 3);
        for (let v = 0; v < vineCount; v++) {
          const vineH = 5 + seededRandom(seed + v * 50 + 1200) * trunkH * 0.6;
          const vine = BABYLON.MeshBuilder.CreateCylinder(
            `jngVine_${t}_${v}`, { height: vineH, diameter: 0.2 }, this.scene
          );
          const vAngle = seededRandom(seed + v * 50 + 1300) * Math.PI * 2;
          vine.position = new BABYLON.Vector3(
            tx + Math.cos(vAngle) * trunkD * 0.8, trunkH - vineH / 2, tz + Math.sin(vAngle) * trunkD * 0.8
          );
          vine.material = vineMat;
        }
      }
    }

    for (let cp = 0; cp < 8; cp++) {
      seed++;
      const px = 320 + seededRandom(seed) * 260;
      const pz = (seededRandom(seed + 100) - 0.5) * 350;
      const py = 12 + seededRandom(seed + 200) * 18;
      const platSize = 8 + seededRandom(seed + 300) * 12;
      const platform = BABYLON.MeshBuilder.CreateBox(
        `jngPlatform_${cp}`, { height: 1, width: platSize, depth: platSize }, this.scene
      );
      platform.position = new BABYLON.Vector3(px, py, pz);
      platform.material = jungleLeafMat;
      this.platforms.push(platform);
    }

    for (let bp = 0; bp < 20; bp++) {
      seed++;
      const bx = 300 + seededRandom(seed) * 300;
      const bz = (seededRandom(seed + 100) - 0.5) * 400;
      const bSize = 1.5 + seededRandom(seed + 200) * 2;
      const bioPlant = BABYLON.MeshBuilder.CreateSphere(
        `jngBio_${bp}`, { diameter: bSize, segments: 6 }, this.scene
      );
      bioPlant.position = new BABYLON.Vector3(bx, bSize * 0.4, bz);
      bioPlant.material = bioGlowMat;

      if (bp % 4 === 0) {
        const bioLight = new BABYLON.PointLight(`jngBioLight_${bp}`, new BABYLON.Vector3(bx, bSize, bz), this.scene);
        bioLight.diffuse = new BABYLON.Color3(0, 0.8, 0.5);
        bioLight.intensity = 0.4;
        bioLight.range = 15;
      }
    }

    for (let r = 0; r < 3; r++) {
      seed++;
      const rx = 350 + seededRandom(seed) * 200;
      const rz = (seededRandom(seed + 100) - 0.5) * 300;

      const ruinBase = BABYLON.MeshBuilder.CreateBox(
        `jngRuin_${r}`, { height: 3, width: 20, depth: 20 }, this.scene
      );
      ruinBase.position = new BABYLON.Vector3(rx, 1.5, rz);
      ruinBase.material = ruinMat;

      for (let p = 0; p < 4; p++) {
        const pAngle = (p / 4) * Math.PI * 2 + 0.4;
        const pillarH = 6 + seededRandom(seed + p * 100 + 200) * 8;
        const pillar = BABYLON.MeshBuilder.CreateCylinder(
          `jngRuinPillar_${r}_${p}`, { height: pillarH, diameter: 1.5 }, this.scene
        );
        pillar.position = new BABYLON.Vector3(rx + Math.cos(pAngle) * 8, 3 + pillarH / 2, rz + Math.sin(pAngle) * 8);
        pillar.material = ruinMat;

        if (seededRandom(seed + p * 100 + 300) > 0.4) {
          pillar.scaling.y = 0.4 + seededRandom(seed + p * 100 + 400) * 0.5;
        }
      }

      const ruinGlyph = BABYLON.MeshBuilder.CreateBox(
        `jngRuinGlyph_${r}`, { height: 4, width: 5, depth: 0.5 }, this.scene
      );
      ruinGlyph.position = new BABYLON.Vector3(rx, 5, rz);
      const glyphMat = new BABYLON.StandardMaterial(`jngGlyphMat_${r}`, this.scene);
      glyphMat.emissiveColor = new BABYLON.Color3(0.0, 0.5, 0.3);
      ruinGlyph.material = glyphMat;
    }

    this.createJungleTemple(480, 0, seed);
    seed += 100;
    this.createJungleVillage(380, -120, seed);
  }

  private createJungleTemple(x: number, z: number, seed: number): void {
    const templeMat = new BABYLON.StandardMaterial("jngTempleMat", this.scene);
    templeMat.diffuseColor = new BABYLON.Color3(0.25, 0.3, 0.2);
    templeMat.emissiveColor = new BABYLON.Color3(0.02, 0.04, 0.02);

    const glowMat = new BABYLON.StandardMaterial("jngTempleGlow", this.scene);
    glowMat.emissiveColor = new BABYLON.Color3(0.0, 1.0, 0.5);
    glowMat.diffuseColor = new BABYLON.Color3(0.0, 0.4, 0.2);

    for (let tier = 0; tier < 4; tier++) {
      const size = 30 - tier * 6;
      const h = 5;
      const step = BABYLON.MeshBuilder.CreateBox(
        `jngTempleStep_${tier}`, { height: h, width: size, depth: size }, this.scene
      );
      step.position = new BABYLON.Vector3(x, tier * h + h / 2, z);
      step.material = templeMat;
    }

    const altar = BABYLON.MeshBuilder.CreateSphere("jngTempleAltar", { diameter: 4 }, this.scene);
    altar.position = new BABYLON.Vector3(x, 22, z);
    altar.material = glowMat;

    const altarLight = new BABYLON.PointLight("jngTempleLight", new BABYLON.Vector3(x, 24, z), this.scene);
    altarLight.diffuse = new BABYLON.Color3(0, 1.0, 0.5);
    altarLight.intensity = 1.2;
    altarLight.range = 40;
  }

  private createJungleVillage(x: number, z: number, seed: number): void {
    const hutMat = new BABYLON.StandardMaterial("jngHutMat", this.scene);
    hutMat.diffuseColor = new BABYLON.Color3(0.2, 0.15, 0.08);

    const roofMat = new BABYLON.StandardMaterial("jngHutRoof", this.scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.05, 0.25, 0.08);
    roofMat.emissiveColor = new BABYLON.Color3(0.0, 0.03, 0.01);

    for (let h = 0; h < 5; h++) {
      seed++;
      const hx = x + (seededRandom(seed) - 0.5) * 50;
      const hz = z + (seededRandom(seed + 100) - 0.5) * 50;

      const stilts = 4 + seededRandom(seed + 200) * 4;
      for (let s = 0; s < 4; s++) {
        const sx = hx + (s % 2 === 0 ? -3 : 3);
        const sz = hz + (s < 2 ? -3 : 3);
        const stilt = BABYLON.MeshBuilder.CreateCylinder(
          `jngStilt_${h}_${s}`, { height: stilts, diameter: 0.5 }, this.scene
        );
        stilt.position = new BABYLON.Vector3(sx, stilts / 2, sz);
        stilt.material = hutMat;
      }

      const hutFloor = BABYLON.MeshBuilder.CreateBox(
        `jngHutFloor_${h}`, { height: 0.5, width: 8, depth: 8 }, this.scene
      );
      hutFloor.position = new BABYLON.Vector3(hx, stilts, hz);
      hutFloor.material = hutMat;

      const hutWalls = BABYLON.MeshBuilder.CreateBox(
        `jngHutWall_${h}`, { height: 4, width: 7, depth: 7 }, this.scene
      );
      hutWalls.position = new BABYLON.Vector3(hx, stilts + 2.5, hz);
      hutWalls.material = hutMat;

      const roof = BABYLON.MeshBuilder.CreateCylinder(
        `jngHutRoof_${h}`, { height: 4, diameterTop: 0.5, diameterBottom: 12, tessellation: 4 }, this.scene
      );
      roof.position = new BABYLON.Vector3(hx, stilts + 6.5, hz);
      roof.material = roofMat;
    }
  }

  private createDesertBiome(): void {
    const sandMat = new BABYLON.StandardMaterial("dstSandMat", this.scene);
    sandMat.diffuseColor = new BABYLON.Color3(0.76, 0.65, 0.42);
    sandMat.emissiveColor = new BABYLON.Color3(0.08, 0.06, 0.03);
    sandMat.specularColor = new BABYLON.Color3(0.3, 0.25, 0.15);

    const darkSandMat = new BABYLON.StandardMaterial("dstDarkSand", this.scene);
    darkSandMat.diffuseColor = new BABYLON.Color3(0.55, 0.45, 0.3);

    const rockMat = new BABYLON.StandardMaterial("dstRockMat", this.scene);
    rockMat.diffuseColor = new BABYLON.Color3(0.5, 0.4, 0.3);
    rockMat.emissiveColor = new BABYLON.Color3(0.03, 0.02, 0.01);

    const oasisWaterMat = new BABYLON.StandardMaterial("dstOasisMat", this.scene);
    oasisWaterMat.diffuseColor = new BABYLON.Color3(0.0, 0.3, 0.5);
    oasisWaterMat.emissiveColor = new BABYLON.Color3(0.0, 0.1, 0.2);
    oasisWaterMat.alpha = 0.75;

    const oasisPlantMat = new BABYLON.StandardMaterial("dstPlantMat", this.scene);
    oasisPlantMat.diffuseColor = new BABYLON.Color3(0.1, 0.4, 0.1);
    oasisPlantMat.emissiveColor = new BABYLON.Color3(0.01, 0.05, 0.01);

    const buriedMat = new BABYLON.StandardMaterial("dstBuriedMat", this.scene);
    buriedMat.diffuseColor = new BABYLON.Color3(0.4, 0.35, 0.28);
    buriedMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.01);

    const groundPatch = BABYLON.MeshBuilder.CreateGround(
      "dstGround", { width: 500, height: 500 }, this.scene
    );
    groundPatch.position = new BABYLON.Vector3(0, 0.06, -450);
    groundPatch.material = sandMat;

    let seed = 7000;

    for (let d = 0; d < 20; d++) {
      seed++;
      const dx = (seededRandom(seed) - 0.5) * 400;
      const dz = -300 - seededRandom(seed + 100) * 300;
      const duneW = 30 + seededRandom(seed + 200) * 60;
      const duneH = 5 + seededRandom(seed + 300) * 20;

      const dune = BABYLON.MeshBuilder.CreateSphere(
        `dstDune_${d}`, { diameter: duneW, segments: 8 }, this.scene
      );
      dune.position = new BABYLON.Vector3(dx, duneH * 0.3, dz);
      dune.scaling = new BABYLON.Vector3(1 + seededRandom(seed + 400) * 1.5, duneH / duneW, 1 + seededRandom(seed + 500) * 0.8);
      dune.rotation.y = seededRandom(seed + 600) * Math.PI;
      dune.material = sandMat;
    }

    for (let rf = 0; rf < 12; rf++) {
      seed++;
      const rx = (seededRandom(seed) - 0.5) * 350;
      const rz = -320 - seededRandom(seed + 100) * 250;
      const rockH = 8 + seededRandom(seed + 200) * 25;
      const rockW = 5 + seededRandom(seed + 300) * 12;

      const formation = BABYLON.MeshBuilder.CreateCylinder(
        `dstRock_${rf}`, {
          height: rockH, diameterTop: rockW * (0.3 + seededRandom(seed + 400) * 0.5),
          diameterBottom: rockW, tessellation: 5 + Math.floor(seededRandom(seed + 500) * 4)
        }, this.scene
      );
      formation.position = new BABYLON.Vector3(rx, rockH / 2, rz);
      formation.rotation.y = seededRandom(seed + 600) * Math.PI;
      formation.material = rockMat;
    }

    const oasisPositions = [
      { x: -80, z: -400 },
      { x: 120, z: -520 },
      { x: -180, z: -550 },
    ];
    for (let o = 0; o < oasisPositions.length; o++) {
      seed++;
      const op = oasisPositions[o];
      const oasisSize = 12 + seededRandom(seed) * 10;
      const water = BABYLON.MeshBuilder.CreateDisc(
        `dstOasis_${o}`, { radius: oasisSize, tessellation: 24 }, this.scene
      );
      water.rotation.x = Math.PI / 2;
      water.position = new BABYLON.Vector3(op.x, 0.15, op.z);
      water.material = oasisWaterMat;

      for (let pt = 0; pt < 4; pt++) {
        seed++;
        const pAngle = seededRandom(seed) * Math.PI * 2;
        const pDist = oasisSize * 0.8 + seededRandom(seed + 100) * 5;
        const palmH = 8 + seededRandom(seed + 200) * 6;
        const palmTrunk = BABYLON.MeshBuilder.CreateCylinder(
          `dstPalm_${o}_${pt}`, { height: palmH, diameterTop: 0.5, diameterBottom: 1.2 }, this.scene
        );
        palmTrunk.position = new BABYLON.Vector3(
          op.x + Math.cos(pAngle) * pDist, palmH / 2, op.z + Math.sin(pAngle) * pDist
        );
        const trunkMat = new BABYLON.StandardMaterial(`dstPalmTrunk_${o}_${pt}`, this.scene);
        trunkMat.diffuseColor = new BABYLON.Color3(0.35, 0.25, 0.12);
        palmTrunk.material = trunkMat;

        for (let f = 0; f < 5; f++) {
          const frondAngle = (f / 5) * Math.PI * 2;
          const frond = BABYLON.MeshBuilder.CreateBox(
            `dstFrond_${o}_${pt}_${f}`, { height: 0.3, width: 4, depth: 1 }, this.scene
          );
          frond.position = new BABYLON.Vector3(
            op.x + Math.cos(pAngle) * pDist + Math.cos(frondAngle) * 2.5,
            palmH + 0.5,
            op.z + Math.sin(pAngle) * pDist + Math.sin(frondAngle) * 2.5
          );
          frond.rotation.z = 0.5;
          frond.rotation.y = frondAngle;
          frond.material = oasisPlantMat;
        }
      }
    }

    for (let bs = 0; bs < 5; bs++) {
      seed++;
      const bx = (seededRandom(seed) - 0.5) * 350;
      const bz = -350 - seededRandom(seed + 100) * 250;
      const buriedH = 4 + seededRandom(seed + 200) * 8;
      const buriedW = 8 + seededRandom(seed + 300) * 15;

      const buried = BABYLON.MeshBuilder.CreateBox(
        `dstBuried_${bs}`, { height: buriedH, width: buriedW, depth: buriedW }, this.scene
      );
      buried.position = new BABYLON.Vector3(bx, buriedH * 0.3, bz);
      buried.rotation.y = seededRandom(seed + 400) * Math.PI;
      buried.rotation.x = (seededRandom(seed + 500) - 0.5) * 0.3;
      buried.material = buriedMat;

      if (seededRandom(seed + 600) > 0.5) {
        const doorway = BABYLON.MeshBuilder.CreateBox(
          `dstDoor_${bs}`, { height: 3, width: 2, depth: 1 }, this.scene
        );
        doorway.position = new BABYLON.Vector3(bx, buriedH * 0.4, bz + buriedW / 2);
        const doorMat = new BABYLON.StandardMaterial(`dstDoorMat_${bs}`, this.scene);
        doorMat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.05);
        doorway.material = doorMat;
      }
    }

    this.createDesertTemple(-50, -480, seed);
    seed += 100;
    this.createDesertVillage(100, -380, seed);
    seed += 100;
    this.createDesertSecret(0, -560, seed);
  }

  private createDesertTemple(x: number, z: number, seed: number): void {
    const templeMat = new BABYLON.StandardMaterial("dstTempleMat", this.scene);
    templeMat.diffuseColor = new BABYLON.Color3(0.65, 0.55, 0.38);
    templeMat.emissiveColor = new BABYLON.Color3(0.05, 0.04, 0.02);

    const goldMat = new BABYLON.StandardMaterial("dstTempleGold", this.scene);
    goldMat.diffuseColor = new BABYLON.Color3(0.85, 0.7, 0.2);
    goldMat.emissiveColor = new BABYLON.Color3(0.3, 0.2, 0.05);

    const base = BABYLON.MeshBuilder.CreateBox("dstTempleBase", { height: 6, width: 40, depth: 40 }, this.scene);
    base.position = new BABYLON.Vector3(x, 3, z);
    base.material = templeMat;

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const pillar = BABYLON.MeshBuilder.CreateCylinder(
        `dstTemplePillar_${i}`, { height: 20, diameter: 2.5 }, this.scene
      );
      pillar.position = new BABYLON.Vector3(x + Math.cos(angle) * 16, 16, z + Math.sin(angle) * 16);
      pillar.material = templeMat;
    }

    const pyramid = BABYLON.MeshBuilder.CreateCylinder(
      "dstTemplePyramid", { height: 15, diameterTop: 2, diameterBottom: 45, tessellation: 4 }, this.scene
    );
    pyramid.position = new BABYLON.Vector3(x, 13.5, z);
    pyramid.material = templeMat;

    const capstone = BABYLON.MeshBuilder.CreateCylinder(
      "dstTempleCap", { height: 3, diameterTop: 0.5, diameterBottom: 4, tessellation: 4 }, this.scene
    );
    capstone.position = new BABYLON.Vector3(x, 22, z);
    capstone.material = goldMat;

    const capLight = new BABYLON.PointLight("dstTempleLight", new BABYLON.Vector3(x, 24, z), this.scene);
    capLight.diffuse = new BABYLON.Color3(1.0, 0.8, 0.3);
    capLight.intensity = 1.5;
    capLight.range = 40;
  }

  private createDesertVillage(x: number, z: number, seed: number): void {
    const wallMat = new BABYLON.StandardMaterial("dstVillageMat", this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.6, 0.52, 0.38);

    const tentMat = new BABYLON.StandardMaterial("dstTentMat", this.scene);
    tentMat.diffuseColor = new BABYLON.Color3(0.65, 0.5, 0.3);
    tentMat.emissiveColor = new BABYLON.Color3(0.04, 0.03, 0.01);

    for (let h = 0; h < 7; h++) {
      seed++;
      const hx = x + (seededRandom(seed) - 0.5) * 80;
      const hz = z + (seededRandom(seed + 100) - 0.5) * 80;
      const hutH = 4 + seededRandom(seed + 200) * 4;
      const hutW = 5 + seededRandom(seed + 300) * 5;

      const hut = BABYLON.MeshBuilder.CreateBox(
        `dstHut_${h}`, { height: hutH, width: hutW, depth: hutW }, this.scene
      );
      hut.position = new BABYLON.Vector3(hx, hutH / 2, hz);
      hut.material = wallMat;

      const flatRoof = BABYLON.MeshBuilder.CreateBox(
        `dstRoof_${h}`, { height: 0.5, width: hutW + 1, depth: hutW + 1 }, this.scene
      );
      flatRoof.position = new BABYLON.Vector3(hx, hutH + 0.25, hz);
      flatRoof.material = wallMat;
    }

    for (let t = 0; t < 3; t++) {
      seed++;
      const tx = x + (seededRandom(seed) - 0.5) * 60;
      const tz = z + (seededRandom(seed + 100) - 0.5) * 60;
      const tent = BABYLON.MeshBuilder.CreateCylinder(
        `dstTent_${t}`, { height: 5, diameterTop: 0.5, diameterBottom: 8, tessellation: 6 }, this.scene
      );
      tent.position = new BABYLON.Vector3(tx, 2.5, tz);
      tent.material = tentMat;
    }
  }

  private createDesertSecret(x: number, z: number, seed: number): void {
    const secretMat = new BABYLON.StandardMaterial("dstSecretMat", this.scene);
    secretMat.diffuseColor = new BABYLON.Color3(0.3, 0.28, 0.22);
    secretMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.01);

    const glowMat = new BABYLON.StandardMaterial("dstSecretGlow", this.scene);
    glowMat.emissiveColor = new BABYLON.Color3(0.8, 0.5, 0.0);
    glowMat.diffuseColor = new BABYLON.Color3(0.6, 0.4, 0.1);

    const chamber = BABYLON.MeshBuilder.CreateBox("dstSecret", { height: 8, width: 15, depth: 15 }, this.scene);
    chamber.position = new BABYLON.Vector3(x, -2, z);
    chamber.material = secretMat;

    const entrance = BABYLON.MeshBuilder.CreateBox("dstSecretEntrance", { height: 3, width: 3, depth: 1 }, this.scene);
    entrance.position = new BABYLON.Vector3(x, 0.5, z + 7.5);
    const entranceMat = new BABYLON.StandardMaterial("dstSecretEntMat", this.scene);
    entranceMat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    entrance.material = entranceMat;

    const relic = BABYLON.MeshBuilder.CreateSphere("dstSecretRelic", { diameter: 2 }, this.scene);
    relic.position = new BABYLON.Vector3(x, 0, z);
    relic.material = glowMat;

    const relicLight = new BABYLON.PointLight("dstSecretLight", new BABYLON.Vector3(x, 2, z), this.scene);
    relicLight.diffuse = new BABYLON.Color3(1.0, 0.7, 0.2);
    relicLight.intensity = 0.8;
    relicLight.range = 20;
  }

  private createJunkyardBiome(): void {
    const scrapMat = new BABYLON.StandardMaterial("jnkScrapMat", this.scene);
    scrapMat.diffuseColor = new BABYLON.Color3(0.3, 0.28, 0.25);
    scrapMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.01);
    scrapMat.specularColor = new BABYLON.Color3(0.2, 0.18, 0.15);

    const rustMat = new BABYLON.StandardMaterial("jnkRustMat", this.scene);
    rustMat.diffuseColor = new BABYLON.Color3(0.45, 0.25, 0.12);
    rustMat.emissiveColor = new BABYLON.Color3(0.05, 0.02, 0.0);

    const metalMat = new BABYLON.StandardMaterial("jnkMetalMat", this.scene);
    metalMat.diffuseColor = new BABYLON.Color3(0.35, 0.35, 0.38);
    metalMat.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4);

    const trashMat = new BABYLON.StandardMaterial("jnkTrashMat", this.scene);
    trashMat.diffuseColor = new BABYLON.Color3(0.2, 0.22, 0.18);

    const robotMat = new BABYLON.StandardMaterial("jnkRobotMat", this.scene);
    robotMat.diffuseColor = new BABYLON.Color3(0.25, 0.3, 0.35);
    robotMat.emissiveColor = new BABYLON.Color3(0.02, 0.04, 0.06);

    const robotGlowMat = new BABYLON.StandardMaterial("jnkRobotGlow", this.scene);
    robotGlowMat.emissiveColor = new BABYLON.Color3(0.0, 0.8, 0.6);
    robotGlowMat.diffuseColor = new BABYLON.Color3(0.0, 0.3, 0.2);

    const groundPatch = BABYLON.MeshBuilder.CreateGround(
      "jnkGround", { width: 500, height: 500 }, this.scene
    );
    groundPatch.position = new BABYLON.Vector3(-450, 0.06, 0);
    const jnkGroundMat = new BABYLON.StandardMaterial("jnkGroundMat", this.scene);
    jnkGroundMat.diffuseColor = new BABYLON.Color3(0.15, 0.14, 0.12);
    jnkGroundMat.emissiveColor = new BABYLON.Color3(0.01, 0.01, 0.01);
    groundPatch.material = jnkGroundMat;

    let seed = 8000;

    for (let sp = 0; sp < 25; sp++) {
      seed++;
      const sx = -300 - seededRandom(seed) * 300;
      const sz = (seededRandom(seed + 100) - 0.5) * 400;
      const pileH = 5 + seededRandom(seed + 200) * 20;
      const pileW = 10 + seededRandom(seed + 300) * 25;

      const pile = BABYLON.MeshBuilder.CreateSphere(
        `jnkPile_${sp}`, { diameter: pileW, segments: 5 }, this.scene
      );
      pile.position = new BABYLON.Vector3(sx, pileH * 0.3, sz);
      pile.scaling = new BABYLON.Vector3(
        1 + seededRandom(seed + 400) * 0.8, pileH / pileW * 2, 1 + seededRandom(seed + 500) * 0.8
      );
      pile.material = seededRandom(seed + 600) > 0.5 ? scrapMat : rustMat;

      const debrisCount = 3 + Math.floor(seededRandom(seed + 700) * 5);
      for (let db = 0; db < debrisCount; db++) {
        seed++;
        const dbAngle = seededRandom(seed) * Math.PI * 2;
        const dbDist = pileW * 0.4 + seededRandom(seed + 100) * pileW * 0.3;
        const dbSize = 1 + seededRandom(seed + 200) * 4;

        const debris = BABYLON.MeshBuilder.CreateBox(
          `jnkDebris_${sp}_${db}`, {
            height: dbSize * (0.3 + seededRandom(seed + 300) * 0.7),
            width: dbSize, depth: dbSize * (0.5 + seededRandom(seed + 400) * 0.5)
          }, this.scene
        );
        debris.position = new BABYLON.Vector3(
          sx + Math.cos(dbAngle) * dbDist, dbSize * 0.3, sz + Math.sin(dbAngle) * dbDist
        );
        debris.rotation = new BABYLON.Vector3(
          seededRandom(seed + 500) * Math.PI * 0.5,
          seededRandom(seed + 600) * Math.PI,
          seededRandom(seed + 700) * Math.PI * 0.3
        );
        debris.material = metalMat;
      }
    }

    for (let rp = 0; rp < 10; rp++) {
      seed++;
      const rx = -320 - seededRandom(seed) * 250;
      const rz = (seededRandom(seed + 100) - 0.5) * 350;

      const body = BABYLON.MeshBuilder.CreateBox(
        `jnkRoboPart_${rp}`, {
          height: 3 + seededRandom(seed + 200) * 5,
          width: 2 + seededRandom(seed + 300) * 4,
          depth: 2 + seededRandom(seed + 400) * 3
        }, this.scene
      );
      body.position = new BABYLON.Vector3(rx, 1 + seededRandom(seed + 500) * 3, rz);
      body.rotation = new BABYLON.Vector3(
        (seededRandom(seed + 600) - 0.5) * Math.PI * 0.5,
        seededRandom(seed + 700) * Math.PI,
        (seededRandom(seed + 800) - 0.5) * Math.PI * 0.3
      );
      body.material = robotMat;

      if (seededRandom(seed + 900) > 0.5) {
        const limb = BABYLON.MeshBuilder.CreateCylinder(
          `jnkRoboLimb_${rp}`, { height: 4, diameter: 0.8 }, this.scene
        );
        limb.position = new BABYLON.Vector3(rx + 2, 0.5, rz);
        limb.rotation.z = Math.PI * 0.3;
        limb.material = metalMat;
      }
    }

    for (let tb = 0; tb < 8; tb++) {
      seed++;
      const tx = -330 - seededRandom(seed) * 230;
      const tz = (seededRandom(seed + 100) - 0.5) * 350;
      const tbH = 6 + seededRandom(seed + 200) * 10;
      const tbW = 8 + seededRandom(seed + 300) * 10;

      const trashBld = BABYLON.MeshBuilder.CreateBox(
        `jnkTrashBld_${tb}`, { height: tbH, width: tbW, depth: tbW }, this.scene
      );
      trashBld.position = new BABYLON.Vector3(tx, tbH / 2, tz);
      trashBld.material = trashMat;
      this.buildings.push(trashBld);

      const patchCount = 2 + Math.floor(seededRandom(seed + 400) * 3);
      for (let pc = 0; pc < patchCount; pc++) {
        const patchSize = 2 + seededRandom(seed + pc * 100 + 500) * 3;
        const patch = BABYLON.MeshBuilder.CreateBox(
          `jnkPatch_${tb}_${pc}`, { height: patchSize, width: patchSize, depth: 0.3 }, this.scene
        );
        const side = Math.floor(seededRandom(seed + pc * 100 + 600) * 4);
        const patchX = tx + (side === 0 ? tbW / 2 : side === 1 ? -tbW / 2 : (seededRandom(seed + pc * 100 + 700) - 0.5) * tbW * 0.8);
        const patchZ = tz + (side === 2 ? tbW / 2 : side === 3 ? -tbW / 2 : (seededRandom(seed + pc * 100 + 800) - 0.5) * tbW * 0.8);
        patch.position = new BABYLON.Vector3(patchX, tbH * 0.3 + seededRandom(seed + pc * 100 + 900) * tbH * 0.5, patchZ);
        patch.material = rustMat;
      }
    }

    for (let npc = 0; npc < 6; npc++) {
      seed++;
      const nx = -350 - seededRandom(seed) * 200;
      const nz = (seededRandom(seed + 100) - 0.5) * 300;

      const npcBody = BABYLON.MeshBuilder.CreateBox(
        `jnkNPC_${npc}`, { height: 3, width: 1.5, depth: 1 }, this.scene
      );
      npcBody.position = new BABYLON.Vector3(nx, 2, nz);
      npcBody.material = robotMat;

      const npcHead = BABYLON.MeshBuilder.CreateSphere(
        `jnkNPCHead_${npc}`, { diameter: 1.2 }, this.scene
      );
      npcHead.position = new BABYLON.Vector3(nx, 4, nz);
      npcHead.material = robotMat;

      const npcEye = BABYLON.MeshBuilder.CreateSphere(
        `jnkNPCEye_${npc}`, { diameter: 0.3 }, this.scene
      );
      npcEye.position = new BABYLON.Vector3(nx, 4.1, nz + 0.5);
      npcEye.material = robotGlowMat;

      if (npc % 3 === 0) {
        const npcLight = new BABYLON.PointLight(
          `jnkNPCLight_${npc}`, new BABYLON.Vector3(nx, 4.5, nz), this.scene
        );
        npcLight.diffuse = new BABYLON.Color3(0, 0.8, 0.6);
        npcLight.intensity = 0.4;
        npcLight.range = 10;
      }
    }

    for (let sa = 0; sa < 5; sa++) {
      seed++;
      const sax = -340 - seededRandom(seed) * 220;
      const saz = (seededRandom(seed + 100) - 0.5) * 320;

      const salvageZone = BABYLON.MeshBuilder.CreateDisc(
        `jnkSalvage_${sa}`, { radius: 8 + seededRandom(seed + 200) * 6, tessellation: 16 }, this.scene
      );
      salvageZone.rotation.x = Math.PI / 2;
      salvageZone.position = new BABYLON.Vector3(sax, 0.12, saz);
      const salvageMat = new BABYLON.StandardMaterial(`jnkSalvageMat_${sa}`, this.scene);
      salvageMat.emissiveColor = new BABYLON.Color3(0.15, 0.1, 0.0);
      salvageMat.diffuseColor = new BABYLON.Color3(0.3, 0.25, 0.1);
      salvageMat.alpha = 0.6;
      salvageZone.material = salvageMat;
    }

    this.createJunkyardTemple(-480, 50, seed);
    seed += 100;
    this.createJunkyardVillage(-400, -100, seed);
    seed += 100;
    this.createJunkyardSecret(-520, 150, seed);
  }

  private createJunkyardTemple(x: number, z: number, seed: number): void {
    const templeMat = new BABYLON.StandardMaterial("jnkTempleMat", this.scene);
    templeMat.diffuseColor = new BABYLON.Color3(0.3, 0.32, 0.35);
    templeMat.emissiveColor = new BABYLON.Color3(0.03, 0.04, 0.05);

    const coreMat = new BABYLON.StandardMaterial("jnkTempleCore", this.scene);
    coreMat.emissiveColor = new BABYLON.Color3(0.0, 1.0, 0.7);
    coreMat.diffuseColor = new BABYLON.Color3(0.0, 0.4, 0.3);

    const base = BABYLON.MeshBuilder.CreateCylinder("jnkTempleBase", { height: 5, diameter: 35, tessellation: 8 }, this.scene);
    base.position = new BABYLON.Vector3(x, 2.5, z);
    base.material = templeMat;

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const pillar = BABYLON.MeshBuilder.CreateBox(
        `jnkTemplePillar_${i}`, { height: 16, width: 3, depth: 3 }, this.scene
      );
      pillar.position = new BABYLON.Vector3(x + Math.cos(angle) * 14, 13, z + Math.sin(angle) * 14);
      pillar.material = templeMat;
    }

    const dome = BABYLON.MeshBuilder.CreateSphere("jnkTempleDome", { diameter: 20, segments: 8 }, this.scene);
    dome.position = new BABYLON.Vector3(x, 22, z);
    dome.scaling.y = 0.5;
    dome.material = templeMat;

    const core = BABYLON.MeshBuilder.CreateSphere("jnkTempleCore", { diameter: 4 }, this.scene);
    core.position = new BABYLON.Vector3(x, 8, z);
    core.material = coreMat;

    const coreLight = new BABYLON.PointLight("jnkTempleLight", new BABYLON.Vector3(x, 10, z), this.scene);
    coreLight.diffuse = new BABYLON.Color3(0, 1.0, 0.7);
    coreLight.intensity = 1.5;
    coreLight.range = 35;
  }

  private createJunkyardVillage(x: number, z: number, seed: number): void {
    const shelterMat = new BABYLON.StandardMaterial("jnkShelterMat", this.scene);
    shelterMat.diffuseColor = new BABYLON.Color3(0.25, 0.22, 0.2);

    const roofMat = new BABYLON.StandardMaterial("jnkShelterRoof", this.scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.35, 0.3, 0.25);

    for (let h = 0; h < 8; h++) {
      seed++;
      const hx = x + (seededRandom(seed) - 0.5) * 80;
      const hz = z + (seededRandom(seed + 100) - 0.5) * 80;
      const sH = 4 + seededRandom(seed + 200) * 5;
      const sW = 5 + seededRandom(seed + 300) * 6;

      const shelter = BABYLON.MeshBuilder.CreateBox(
        `jnkShelter_${h}`, { height: sH, width: sW, depth: sW }, this.scene
      );
      shelter.position = new BABYLON.Vector3(hx, sH / 2, hz);
      shelter.material = shelterMat;

      const roof = BABYLON.MeshBuilder.CreateBox(
        `jnkShelterRoof_${h}`, { height: 1, width: sW + 2, depth: sW + 2 }, this.scene
      );
      roof.position = new BABYLON.Vector3(hx, sH + 0.5, hz);
      roof.rotation.y = seededRandom(seed + 400) * 0.3;
      roof.material = roofMat;
    }

    const workshopSign = BABYLON.MeshBuilder.CreateBox("jnkWorkshopSign", { height: 2, width: 6, depth: 0.3 }, this.scene);
    workshopSign.position = new BABYLON.Vector3(x, 8, z);
    const signMat = new BABYLON.StandardMaterial("jnkSignMat", this.scene);
    signMat.emissiveColor = new BABYLON.Color3(0.8, 0.4, 0.0);
    workshopSign.material = signMat;
  }

  private createJunkyardSecret(x: number, z: number, seed: number): void {
    const secretMat = new BABYLON.StandardMaterial("jnkSecretMat", this.scene);
    secretMat.diffuseColor = new BABYLON.Color3(0.2, 0.22, 0.25);
    secretMat.emissiveColor = new BABYLON.Color3(0.02, 0.03, 0.04);

    const glowMat = new BABYLON.StandardMaterial("jnkSecretGlow", this.scene);
    glowMat.emissiveColor = new BABYLON.Color3(0.5, 0.0, 1.0);
    glowMat.diffuseColor = new BABYLON.Color3(0.2, 0.0, 0.4);

    const bunker = BABYLON.MeshBuilder.CreateBox("jnkSecret", { height: 6, width: 12, depth: 12 }, this.scene);
    bunker.position = new BABYLON.Vector3(x, 3, z);
    bunker.material = secretMat;

    const hatch = BABYLON.MeshBuilder.CreateCylinder("jnkSecretHatch", { height: 1, diameter: 4 }, this.scene);
    hatch.position = new BABYLON.Vector3(x, 6.5, z);
    const hatchMat = new BABYLON.StandardMaterial("jnkHatchMat", this.scene);
    hatchMat.diffuseColor = new BABYLON.Color3(0.4, 0.38, 0.35);
    hatch.material = hatchMat;

    const relic = BABYLON.MeshBuilder.CreateSphere("jnkSecretRelic", { diameter: 2.5 }, this.scene);
    relic.position = new BABYLON.Vector3(x, 4, z);
    relic.material = glowMat;

    const relicLight = new BABYLON.PointLight("jnkSecretLight", new BABYLON.Vector3(x, 5, z), this.scene);
    relicLight.diffuse = new BABYLON.Color3(0.5, 0.0, 1.0);
    relicLight.intensity = 0.8;
    relicLight.range = 20;
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

          const sbX = plat.x + Math.cos(bAngle) * bDist;
          const sbZ = plat.z + Math.sin(bAngle) * bDist;
          const skyBldMat = this.createBuildingMaterial(
            new BABYLON.Color3(0.1, 0.12, 0.18),
            new BABYLON.Color3(
              seededRandom(seed + 400) * 0.5,
              seededRandom(seed + 500) * 0.5 + 0.5,
              1
            )
          );
          this.createHollowShell(
            `skyBld_${plat.label}_${b}`,
            sbX,
            sbZ,
            bWidth,
            bWidth,
            bHeight,
            skyBldMat,
            false,
            plat.y + 2,
          );
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

        const colorSet = outerColors[Math.floor(seededRandom(seed + 400) * outerColors.length)];
        const mat = this.createBuildingMaterial(colorSet.base, colorSet.glow);
        this.createHollowShell(`outer_${dist.label}_${b}`, bx, bz, width, width, height, mat, height > 35);
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
