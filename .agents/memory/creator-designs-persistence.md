---
name: Creator Suite design persistence
description: How player-made designs (robots/pets/characters/enemies) persist and deploy, and the size quotas protecting the cloud save.
---

**Rule:** Creator designs live in a localStorage store that is *mirrored* into the ProgressSnapshot (`creatorDesigns`) and merged back on load (newest `updatedAt` wins per id). Anything mirrored into the snapshot must respect hard quotas — capped design count, capped per-design bytes, and a total byte budget applied when building the snapshot — or the save POST can outgrow the API body limit and silently break cloud saves.

**Why:** An architect review flagged that unbounded design mirroring (plus per-companion serialized descriptors) could exceed `express.json()` default body limits and fail every save.

**How to apply:**
- Any new player-authored content that rides the save snapshot needs the same treatment: count cap + per-item byte cap + snapshot byte budget (newest-first).
- Imported JSON payloads are untrusted: robot descriptors round-trip through `validateStyle`; character payloads go through a shape+range sanitizer before ever touching character storage.
- Deploys are decoupled via a localStorage queue drained by the game loop (polled), because the editor runs on the main menu before game systems exist. Companions persist a serialized descriptor per save entry (self-contained, re-clamped on load); enemies reuse an existing stat template ("heavy") with custom visuals.
