---
name: WebGL "not supported" = context exhaustion, not a code bug
description: Why Heavy Water intermittently dies with "WebGL not supported" and how init must release contexts + auto-recover.
---

# "WebGL not supported" almost always means context exhaustion

`new BABYLON.Engine(canvas, ...)` throws the literal string `"WebGL not
supported"` when the browser cannot hand it a WebGL context. In this project
that does NOT mean the environment lacks WebGL — a fresh tab/login page renders
fine. It means the **tab has exhausted its live WebGL context budget** (browsers
cap ~16 simultaneous contexts).

**How contexts leak here:**
- Repeated game (re)inits: every successful init builds an engine/context;
  death/restart disposes it, but disposal must actually release the GL context.
- A workflow/server restart does NOT reload the user's browser tab, so contexts
  already leaked in that tab persist until a full page reload — restarting the
  dev server "to fix it" does nothing for the stuck user.
- HMR during development re-runs the module and can strand the previous engine's
  context, so a long dev session naturally drifts toward exhaustion.
- **Wrapper-throw leak (fixed):** the raw `BABYLON.Engine` acquires the context
  FIRST, then the `BabylonEngine` wrapper constructor builds scene/camera/post
  FX. If that constructor throws, `create()` threw before returning, so the
  caller never got a wrapper to dispose → the raw engine's context leaked on
  every failed init. `BabylonEngine.create` now wraps the wrapper construction
  in try/catch and disposes the raw engine on throw.

**Recovery contract (in Game.tsx init catch):**
- On any init failure, probe a throwaway canvas for `webgl2`/`webgl`. If the
  probe ALSO fails, the tab is exhausted → reload the page ONCE, guarded by a
  `sessionStorage` flag so a genuine deterministic crash can never reload-loop.
  The guard is cleared on a successful init (and when the probe succeeds) so a
  future real exhaustion can recover again.
- If the probe SUCCEEDS, it is a real code error — show `CRITICAL ERROR: <msg>`
  and do NOT reload.

**Diagnosis tip:** a thrown `Error` serializes to `{}` in the captured browser
console (message/stack are non-enumerable). Log `err.name`, `err.message`,
`err.stack` explicitly or you'll chase a blank `{}` forever.
