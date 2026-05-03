import * as BABYLON from "@babylonjs/core";
import { LSystemConfig } from "./LSystem";

/**
 * Branch segment emitted by the turtle interpreter. We collect the full
 * list first and then build geometry in one pass so we can merge into a
 * minimal number of draw calls.
 */
interface BranchSegment {
  start: BABYLON.Vector3;
  end: BABYLON.Vector3;
  radiusStart: number;
  radiusEnd: number;
}

interface LeafPoint {
  position: BABYLON.Vector3;
  radius: number;
}

interface TurtleState {
  position: BABYLON.Vector3;
  rotation: BABYLON.Quaternion;
  radius: number;
}

export interface LSystemRenderResult {
  /** Parent transform that owns the merged trunk + leaf meshes. */
  root: BABYLON.TransformNode;
  /** Merged trunk mesh (cylinders), or null if there were no F symbols. */
  trunkMesh: BABYLON.Mesh | null;
  /** Merged leaf mesh (orbs), or null if there were no L symbols. */
  leafMesh: BABYLON.Mesh | null;
  /** Number of branch segments rendered (for diagnostics / budgeting). */
  segmentCount: number;
}

export interface LSystemRendererOptions {
  /** Trunk material — shared across plants by the foliage system. */
  trunkMaterial: BABYLON.StandardMaterial;
  /** Leaf/orb material — shared across plants by the foliage system. */
  leafMaterial: BABYLON.StandardMaterial;
  /** Stable name prefix used for the merged meshes (e.g. "alien_plant_12"). */
  namePrefix: string;
  /** Optional deterministic random for angle jitter (returns 0..1). */
  rng?: () => number;
  /** ± radians of jitter added to every turn. Default 0.18. */
  angleJitter?: number;
  /** Tessellation for branch cylinders. 5 keeps tri count low. */
  branchTessellation?: number;
  /** Subdivisions on leaf spheres. 2 = octahedron-ish. */
  leafSubdivisions?: number;
  /** Leaf radius multiplier relative to current branch radius. Default 1.6. */
  leafRadiusScale?: number;
}

/**
 * Turtle interpreter that walks an L-system string and produces merged
 * Babylon meshes. Emits at most two meshes per plant (trunk + leaves),
 * which keeps draw calls predictable when scattering many plants.
 *
 * Coordinate convention: the turtle starts pointing along +Y (up), so a
 * fresh state with no rotations grows straight up out of the origin —
 * same as you'd expect from a tree.
 */
export class LSystemRenderer {
  constructor(private scene: BABYLON.Scene, private config: LSystemConfig) {}

  render(
    instructions: string,
    origin: BABYLON.Vector3,
    options: LSystemRendererOptions,
  ): LSystemRenderResult {
    const root = new BABYLON.TransformNode(`${options.namePrefix}_root`, this.scene);
    root.position.copyFrom(origin);

    const segments: BranchSegment[] = [];
    const leaves: LeafPoint[] = [];
    const stack: TurtleState[] = [];
    const rng = options.rng ?? Math.random;
    const jitterRange = options.angleJitter ?? 0.18;

    let state: TurtleState = {
      position: BABYLON.Vector3.Zero(),
      rotation: BABYLON.Quaternion.Identity(),
      radius: this.config.branchRadius,
    };
    const angle = BABYLON.Tools.ToRadians(this.config.angleDeg);

    const jitteredAngle = (sign: number) =>
      sign * (angle + (rng() * 2 - 1) * jitterRange);

    for (const symbol of instructions) {
      switch (symbol) {
        case "F": {
          const end = this.forwardEnd(state);
          segments.push({
            start: state.position.clone(),
            end,
            radiusStart: state.radius,
            radiusEnd: state.radius * 0.85,
          });
          state.position = end;
          break;
        }
        case "f":
          state.position = this.forwardEnd(state);
          break;
        case "+":
          state.rotation = this.rotate(state.rotation, BABYLON.Axis.Y, jitteredAngle(1));
          break;
        case "-":
          state.rotation = this.rotate(state.rotation, BABYLON.Axis.Y, jitteredAngle(-1));
          break;
        case "&":
          state.rotation = this.rotate(state.rotation, BABYLON.Axis.X, jitteredAngle(1));
          break;
        case "^":
          state.rotation = this.rotate(state.rotation, BABYLON.Axis.X, jitteredAngle(-1));
          break;
        case "\\":
          state.rotation = this.rotate(state.rotation, BABYLON.Axis.Z, jitteredAngle(1));
          break;
        case "/":
          state.rotation = this.rotate(state.rotation, BABYLON.Axis.Z, jitteredAngle(-1));
          break;
        case "[":
          stack.push({
            position: state.position.clone(),
            rotation: state.rotation.clone(),
            radius: state.radius,
          });
          state.radius *= this.config.radiusDecay;
          break;
        case "]": {
          const prev = stack.pop();
          if (prev) state = prev;
          break;
        }
        case "L":
          leaves.push({
            position: state.position.clone(),
            radius: state.radius * (options.leafRadiusScale ?? 1.6),
          });
          break;
        // Any other character is ignored (acts as a non-terminal placeholder).
      }
    }

    const trunkMesh = this.buildTrunk(segments, options);
    const leafMesh = this.buildLeaves(leaves, options);
    if (trunkMesh) trunkMesh.parent = root;
    if (leafMesh) leafMesh.parent = root;

    return { root, trunkMesh, leafMesh, segmentCount: segments.length };
  }

  // --- internals ---

  private forwardEnd(state: TurtleState): BABYLON.Vector3 {
    const dir = new BABYLON.Vector3(0, 1, 0).rotateByQuaternionToRef(
      state.rotation,
      new BABYLON.Vector3(),
    );
    return state.position.add(dir.scale(this.config.segmentLength));
  }

  private rotate(
    current: BABYLON.Quaternion,
    axis: BABYLON.Vector3,
    angle: number,
  ): BABYLON.Quaternion {
    const q = BABYLON.Quaternion.RotationAxis(axis, angle);
    return q.multiply(current).normalize();
  }

  /** Build one cylinder per segment, then merge them into a single trunk
   *  mesh. We merge with disposeSource=true so the per-segment meshes are
   *  cleaned up and only the merged result remains in the scene. */
  private buildTrunk(
    segments: BranchSegment[],
    options: LSystemRendererOptions,
  ): BABYLON.Mesh | null {
    if (segments.length === 0) return null;
    const tess = options.branchTessellation ?? 5;
    const parts: BABYLON.Mesh[] = [];
    for (const seg of segments) {
      const len = BABYLON.Vector3.Distance(seg.start, seg.end);
      if (len < 1e-4) continue;
      const cyl = BABYLON.MeshBuilder.CreateCylinder(
        `${options.namePrefix}_branch`,
        {
          height: len,
          diameterTop: Math.max(0.02, seg.radiusEnd * 2),
          diameterBottom: Math.max(0.02, seg.radiusStart * 2),
          tessellation: tess,
        },
        this.scene,
      );
      this.alignCylinder(cyl, seg.start, seg.end);
      parts.push(cyl);
    }
    if (parts.length === 0) return null;
    const merged = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!merged) return null;
    merged.name = `${options.namePrefix}_trunk`;
    merged.material = options.trunkMaterial;
    merged.isPickable = false;
    return merged;
  }

  private buildLeaves(
    leaves: LeafPoint[],
    options: LSystemRendererOptions,
  ): BABYLON.Mesh | null {
    if (leaves.length === 0) return null;
    const subs = options.leafSubdivisions ?? 2;
    const parts: BABYLON.Mesh[] = [];
    for (const leaf of leaves) {
      const sphere = BABYLON.MeshBuilder.CreateSphere(
        `${options.namePrefix}_leaf`,
        { diameter: leaf.radius * 2, segments: subs },
        this.scene,
      );
      sphere.position.copyFrom(leaf.position);
      parts.push(sphere);
    }
    const merged = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
    if (!merged) return null;
    merged.name = `${options.namePrefix}_leaves`;
    merged.material = options.leafMaterial;
    merged.isPickable = false;
    return merged;
  }

  private alignCylinder(
    cyl: BABYLON.Mesh,
    start: BABYLON.Vector3,
    end: BABYLON.Vector3,
  ): void {
    const mid = start.add(end).scale(0.5);
    cyl.position = mid;
    const direction = end.subtract(start).normalize();
    const up = BABYLON.Axis.Y;
    const axis = BABYLON.Vector3.Cross(up, direction);
    if (axis.lengthSquared() < 1e-6) {
      // Either same direction as up (no rotation) or directly opposite (flip).
      const dot = BABYLON.Vector3.Dot(up, direction);
      cyl.rotationQuaternion = dot < 0
        ? BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, Math.PI)
        : BABYLON.Quaternion.Identity();
      return;
    }
    const angle = Math.acos(
      Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(up, direction))),
    );
    cyl.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis.normalize(), angle);
  }
}
