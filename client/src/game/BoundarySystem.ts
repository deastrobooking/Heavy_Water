import * as BABYLON from "@babylonjs/core";

/** Per-level playable-area definition: a circular boundary centered on the
 *  zone. Levels absent from this table (space, interior labs/lairs) manage
 *  their own enclosure and get no barrier or clamping. */
interface BoundaryDef {
  cx: number;
  cz: number;
  radius: number;
  /** Base Y of the barrier wall (terrain zones sit higher/lower). */
  baseY: number;
  wallHeight: number;
}

const BOUNDS: Record<number, BoundaryDef> = {
  // Detroit campaign levels share the same city footprint.
  1: { cx: 0, cz: 0, radius: 640, baseY: -2, wallHeight: 120 },
  2: { cx: 0, cz: 0, radius: 640, baseY: -2, wallHeight: 120 },
  3: { cx: 0, cz: 0, radius: 640, baseY: -2, wallHeight: 120 },
  // Ashur Sanctuary — 2300-wide rolling terrain around (-480,-480).
  4: { cx: -480, cz: -480, radius: 1050, baseY: -4, wallHeight: 140 },
  // Saginaw / Zug Island / Ann Arbor — 1500-wide grounds around their centers.
  8: { cx: 1500, cz: -1500, radius: 700, baseY: -2, wallHeight: 120 },
  9: { cx: -1500, cz: -1500, radius: 700, baseY: -2, wallHeight: 120 },
  10: { cx: -3000, cz: 0, radius: 700, baseY: -2, wallHeight: 120 },
  // Michigan Wilds — huge heightmap terrain; keep inside the sampled area.
  11: { cx: 3000, cz: 1500, radius: 2500, baseY: -30, wallHeight: 220 },
  // Luna Bastion (villain campaign) — flat cratered moon plain far NORTH.
  12: { cx: 0, cz: 3000, radius: 700, baseY: -2, wallHeight: 120 },
};

/** How far inside the barrier the player is held (soft margin). */
const CLAMP_MARGIN = 2;

/**
 * Glowing energy barrier at the edge of each level's playable area, plus a
 * per-frame soft clamp so the player (on foot, flying, or fast-traveled) can
 * never leave the zone geometry and end up in featureless off-map space.
 *
 * The wall is a tall open cylinder with a custom translucent shader: cyan
 * hex-scan bands that fade out with height, pulse slowly, and brighten as
 * the player gets close — invisible from the middle of the map, unmistakable
 * at the edge.
 */
export class BoundarySystem {
  private scene: BABYLON.Scene;
  private wall: BABYLON.Mesh | null = null;
  private mat: BABYLON.ShaderMaterial | null = null;
  private def: BoundaryDef | null = null;
  private time = 0;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.registerShader();
  }

  private registerShader(): void {
    if (BABYLON.Effect.ShadersStore["boundaryWallVertexShader"]) return;
    BABYLON.Effect.ShadersStore["boundaryWallVertexShader"] = `
      precision highp float;
      attribute vec3 position;
      attribute vec2 uv;
      uniform mat4 worldViewProjection;
      uniform mat4 world;
      varying vec2 vUV;
      varying vec3 vWorldPos;
      void main(){
        vUV = uv;
        vWorldPos = (world * vec4(position, 1.0)).xyz;
        gl_Position = worldViewProjection * vec4(position, 1.0);
      }
    `;
    BABYLON.Effect.ShadersStore["boundaryWallFragmentShader"] = `
      precision highp float;
      varying vec2 vUV;
      varying vec3 vWorldPos;
      uniform float time;
      uniform vec3 playerPos;
      uniform float proximity; // 0 = far from edge, 1 = at the edge
      void main(){
        // Vertical fade: solid at the base, gone at the top.
        float vFade = 1.0 - vUV.y;
        vFade *= vFade;

        // Horizontal scan bands drifting upward + fine hex-ish grid.
        float bands = 0.5 + 0.5 * sin((vUV.y * 30.0 - time * 0.6) * 6.2831);
        float grid = step(0.94, fract(vUV.x * 160.0)) + step(0.92, fract(vUV.y * 40.0));
        grid = clamp(grid, 0.0, 1.0);

        // Local brightening near the player so the wall reads as a surface.
        float d = distance(vWorldPos.xz, playerPos.xz);
        float local = 1.0 - clamp(d / 90.0, 0.0, 1.0);

        vec3 col = mix(vec3(0.1, 0.9, 1.0), vec3(0.5, 1.0, 1.0), local);
        float pulse = 0.85 + 0.15 * sin(time * 2.0);
        float alpha = vFade * (0.10 + bands * 0.10 + grid * 0.25)
                    * (0.35 + 0.65 * proximity) * pulse
                    + local * local * 0.30 * vFade;
        gl_FragColor = vec4(col * (0.8 + local), clamp(alpha, 0.0, 0.85));
      }
    `;
  }

  /** Rebuild (or remove) the barrier for the given level. */
  setLevel(level: number): void {
    this.disposeWall();
    const def = BOUNDS[level] ?? null;
    this.def = def;
    if (!def) return;

    const wall = BABYLON.MeshBuilder.CreateCylinder(
      "boundaryWall",
      {
        diameter: def.radius * 2,
        height: def.wallHeight,
        tessellation: 96,
        cap: BABYLON.Mesh.NO_CAP,
        sideOrientation: BABYLON.Mesh.DOUBLESIDE,
      },
      this.scene,
    );
    wall.position.set(def.cx, def.baseY + def.wallHeight / 2, def.cz);
    wall.isPickable = false;
    wall.applyFog = false;

    const mat = new BABYLON.ShaderMaterial(
      "boundaryWallMat",
      this.scene,
      { vertex: "boundaryWall", fragment: "boundaryWall" },
      {
        attributes: ["position", "uv"],
        uniforms: ["worldViewProjection", "world", "time", "playerPos", "proximity"],
        needAlphaBlending: true,
      },
    );
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.setFloat("time", 0);
    mat.setVector3("playerPos", new BABYLON.Vector3(def.cx, 0, def.cz));
    mat.setFloat("proximity", 0);
    wall.material = mat;
    // Draw after opaque world geometry but with depth-test on, so the wall
    // correctly sits behind buildings/terrain that occlude it.
    wall.alphaIndex = 10;

    this.wall = wall;
    this.mat = mat;
  }

  /**
   * Advance the shader animation and softly clamp `playerPos` inside the
   * boundary. Returns the clamped position if the player crossed the edge
   * (caller should apply it), or null when no correction was needed.
   */
  update(dt: number, playerPos: BABYLON.Vector3): BABYLON.Vector3 | null {
    const def = this.def;
    if (!def) return null;
    this.time += dt;

    const dx = playerPos.x - def.cx;
    const dz = playerPos.z - def.cz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (this.mat) {
      this.mat.setFloat("time", this.time);
      this.mat.setVector3("playerPos", playerPos);
      // Start revealing the wall in the outer 15% of the play area.
      const proximity = BABYLON.Scalar.Clamp(
        (dist - def.radius * 0.85) / (def.radius * 0.15),
        0,
        1,
      );
      this.mat.setFloat("proximity", proximity);
    }

    const limit = def.radius - CLAMP_MARGIN;
    if (dist > limit && dist > 0.001) {
      const scale = limit / dist;
      return new BABYLON.Vector3(
        def.cx + dx * scale,
        playerPos.y,
        def.cz + dz * scale,
      );
    }
    return null;
  }

  private disposeWall(): void {
    if (this.wall) {
      this.wall.dispose();
      this.wall = null;
    }
    if (this.mat) {
      this.mat.dispose();
      this.mat = null;
    }
  }

  dispose(): void {
    this.disposeWall();
    this.def = null;
  }
}
