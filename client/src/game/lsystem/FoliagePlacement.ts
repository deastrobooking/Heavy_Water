import * as BABYLON from "@babylonjs/core";

/**
 * Shared placement helpers used by AlienFoliageSystem and
 * EarthFoliageSystem so the two scatter passes never claim the exact
 * same XZ point and never need to keep their keep-out anchor lists in
 * sync by hand.
 *
 * Two pieces:
 *   1. `KEEPOUT_ANCHORS` — single source of truth for spawn / fortress
 *      / temple positions both foliage systems must avoid. If a level
 *      capstone moves, edit it once here.
 *
 *   2. `FoliageOccupancy` — static registry of every plant XZ already
 *      placed by any foliage system. Each system pushes the points it
 *      placed and queries this registry (in addition to its own local
 *      list) when validating a new candidate. Keeps wilderness scatter
 *      legible even when both systems run side-by-side with disjoint
 *      seeds.
 *
 * The registry is intentionally module-level (not scene-scoped) because
 * both foliage systems are constructed once per scene by Game.tsx and
 * their dispose paths call `FoliageOccupancy.clear()` so a hot-restart
 * doesn't carry stale points across scenes.
 */

/** Spawn road, level fortresses, and 4 hidden temples (cardinals @ 480 m).
 *  Mirrors the constant lists previously inlined in both foliage systems —
 *  centralised so a level capstone move only needs editing in one place. */
export const KEEPOUT_ANCHORS: ReadonlyArray<BABYLON.Vector3> = (() => {
  const anchors: BABYLON.Vector3[] = [
    // Spawn / start area.
    new BABYLON.Vector3(0, 0, 0),
    // Level fortresses (L1/L2/L3) — approximate centres.
    new BABYLON.Vector3(380, 0, -120),
    new BABYLON.Vector3(-360, 0, -360),
    new BABYLON.Vector3(-120, 0, 420),
  ];
  // Hidden temples — 4 cardinal off-diagonals at radius 480.
  // Mirrors MountainRingSystem.TEMPLE_ANGLES_DEG.
  const r = 480;
  for (const deg of [30, 120, 210, 300]) {
    const a = (deg * Math.PI) / 180;
    anchors.push(new BABYLON.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return anchors;
})();

/** Squared keep-out distance for any anchor — both systems used 32 m. */
export const KEEPOUT_RADIUS = 32;

/** Shared XZ occupancy across every foliage system. Each entry is a
 *  flat (x, z) pair; we don't bother with full Vector3s because foliage
 *  placement is purely 2-D. */
class _FoliageOccupancy {
  private xs: number[] = [];
  private zs: number[] = [];

  /** Register a placed point so other systems will see it. */
  register(x: number, z: number): void {
    this.xs.push(x);
    this.zs.push(z);
  }

  /** Returns true if any registered point sits within `minDist` (XZ
   *  metres) of the candidate. */
  tooCloseTo(x: number, z: number, minDist: number): boolean {
    const md2 = minDist * minDist;
    for (let i = 0; i < this.xs.length; i++) {
      const dx = x - this.xs[i];
      const dz = z - this.zs[i];
      if (dx * dx + dz * dz < md2) return true;
    }
    return false;
  }

  /** Drop a previously-registered point (best-effort — used when a
   *  scatterZone disposer removes plants on side-zone teardown). */
  unregister(x: number, z: number): void {
    for (let i = 0; i < this.xs.length; i++) {
      if (this.xs[i] === x && this.zs[i] === z) {
        this.xs.splice(i, 1);
        this.zs.splice(i, 1);
        return;
      }
    }
  }

  /** Wipe every registered point — call from the foliage system's
   *  dispose path that owned the points so a fresh scene starts clean. */
  clear(): void {
    this.xs.length = 0;
    this.zs.length = 0;
  }

  size(): number {
    return this.xs.length;
  }
}

export const FoliageOccupancy = new _FoliageOccupancy();
