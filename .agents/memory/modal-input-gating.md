---
name: Modal & input gating contract
description: How pause-style UI must gate gameplay input, and stuck-key defenses
---

Rule: every pause-style modal (upgrade, lab, garden, capsule, shop, lobby, and
any future one) must be included in the single `isAnyModalOpen()` predicate in
Game.tsx. All input-block providers (NPCs, rescue, mountain ring, side-zones,
gamepad menu mode) and the gameplay keydown/mousedown/vehicle handlers consume
that one predicate — never write a bespoke ref list again.

**Why:** capsule/lobby were once missing from ad-hoc gate lists, letting players
shoot/capture/turbo through open menus and stack modals (Tab opened upgrade on
top of shop).

**How to apply:** when adding a modal: add its ref + sync effect, include it in
`isAnyModalOpen`, close it in `closeAllModals` (via its owning system's public
`close()` if a Babylon system owns its state — e.g. ArmorCapsuleSystem/ShopSystem
must be closed through the system, not just React state, or their internal
isOpen flag desyncs).

Stuck-key defense: PlayerController.releaseAllKeys() fires on blur,
visibilitychange(hidden), pointer-lock exit, and any modal open. GamepadInput
releaseAll() must also release comboOverride synthetic keys and run immediately
on gamepad disconnect (RAF polling never fires in a backgrounded tab).

Sky note: SkySystem uniforms must update per-frame (allocation-free scratch
objects) — a 10Hz throttle visibly steps sun/fog at fast day speeds
(secondsPerDay can be 10s).
