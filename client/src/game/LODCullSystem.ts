import * as BABYLON from "@babylonjs/core";

/**
 * LODCullSystem — distance-based mesh activation for the open world.
 *
 * Why this exists: Babylon's frustum culling only removes meshes that are
 * outside the camera's view; a building 800 m behind you that happens to be
 * inside the 1 km maxZ sphere still gets walked, world-matrix-checked and
 * (if visible) submitted to the GPU. With the city + foliage + props +
 * enemy bases all live, that's a lot of per-frame busywork.
 *
 * This system holds a flat list of `{ mesh, r2 }` registrations. Every few
 * frames it computes squared distance from the player to each mesh and
 * toggles `setEnabled`. When a mesh is disabled, Babylon completely skips
 * it — no draw call, no material binding, no world-matrix work.
 *
 * Notes:
 *  - We tick at ~6 Hz (every 160 ms) instead of every frame. Cull radii
 *    are big enough (>= 200 m) that 160 ms of player movement at top
 *    sprint speed is well within the hysteresis band.
 *  - Squared distance — never call Math.sqrt in the loop.
 *  - Registered meshes can be either `BABYLON.Mesh` or `TransformNode`
 *    (both expose `setEnabled` and a `position` accessor we can read).
 *  - Mountains, the giant fortress mesh, and other intentional-skyline
 *    objects should NOT be registered here.
 */

interface CullEntry {
  node: BABYLON.TransformNode;
  /** Squared cull radius. Outside this distance the node is disabled. */
  r2: number;
  /** Cached last enabled-state so we only call setEnabled on change.
   *  Babylon's setEnabled walks the children list — cheap, but still
   *  worth skipping when nothing changed. */
  enabled: boolean;
}

export class LODCullSystem {
  private entries: CullEntry[] = [];
  private playerPos: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private accum: number = 0;
  /** Tick interval in ms. 160 ms ≈ 6 Hz. Player walking speed ~6 m/s, so
   *  worst-case position drift between ticks is ~1 m — far inside the
   *  hysteresis band of any sensible cull radius. */
  private static readonly TICK_MS = 160;

  /** Register a mesh / transform-node for distance culling.
   *  @param node       The mesh or container to toggle.
   *  @param radius     Distance in metres. Beyond this the node is hidden. */
  register(node: BABYLON.TransformNode | null | undefined, radius: number): void {
    if (!node) return;
    this.entries.push({ node, r2: radius * radius, enabled: true });
  }

  /** Remove an entry — call this when a mesh is destroyed (e.g. a player
   *  block is removed) so the dead reference doesn't pile up. */
  unregister(node: BABYLON.TransformNode): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].node === node) {
        this.entries.splice(i, 1);
        return;
      }
    }
  }

  /** Update the player position used for distance checks. Call this once
   *  per frame from the main loop with the camera/player target position. */
  setPlayerPos(p: BABYLON.Vector3): void {
    this.playerPos.copyFrom(p);
  }

  /** Tick the system. Pass the frame deltaTime in milliseconds — the
   *  system batches work at ~6 Hz internally so calling every frame is
   *  cheap. */
  update(deltaMs: number): void {
    this.accum += deltaMs;
    if (this.accum < LODCullSystem.TICK_MS) return;
    this.accum = 0;

    const px = this.playerPos.x;
    const py = this.playerPos.y;
    const pz = this.playerPos.z;
    const list = this.entries;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const np = e.node.position;
      const dx = np.x - px;
      const dy = np.y - py;
      const dz = np.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const want = d2 <= e.r2;
      if (want !== e.enabled) {
        e.node.setEnabled(want);
        e.enabled = want;
      }
    }
  }

  /** Wipe all entries. Used when the world is regenerated (e.g. switching
   *  levels) so we don't keep references to disposed meshes. */
  clear(): void {
    this.entries.length = 0;
  }

  getCount(): number {
    return this.entries.length;
  }

  dispose(): void {
    this.clear();
  }
}
