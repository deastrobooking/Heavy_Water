---
name: Sky dome depth & level boundaries
description: Why the sky must be pinned to the far plane, and how playable-area bounds work
---

**Rule:** The SkySystem dome is a 450-radius BACKSIDE sphere with `disableDepthWrite`. Its vertex shader must pin depth to the far plane (`pos.z = pos.w * 0.9999`). Never remove that or shrink the dome without it — any geometry farther than the dome radius gets overdrawn by the sky depending on draw order (symptom: buildings/floor "lose textures" when overcast cloud shading passes).

**Why:** Depth-write off does not stop the dome from *winning* the depth test where it is closer than distant geometry; only far-plane pinning makes it a true background. Use 0.9999 (not 0.99999) so 16-bit depth buffers don't quantize to 1.0 and cull the sky.

**Boundaries:** `BoundarySystem.ts` owns per-level playable-area circles (BOUNDS table) + glowing barrier wall + per-frame clamp in Game.tsx's loop. When mounted, the vehicle position must be clamped too (player position is overwritten from vehicle each tick). Indoor/space levels (5,6,7) are intentionally absent from BOUNDS.

**How to apply:** New outdoor side-zones need a BOUNDS entry sized to their ground mesh; barrier is seeded on LEVEL_STARTED plus once at boot (LEVEL_STARTED doesn't fire at construction).
