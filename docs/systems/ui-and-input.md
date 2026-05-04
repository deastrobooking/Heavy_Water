# UI & input

## Two render layers

Heavy Water has two parallel UI layers:

| Layer | Where | Used for |
|---|---|---|
| **React HTML** | `client/src/game/*.tsx` + `client/src/components/ui/` | Menus, hotbars, dialogs, HUD chrome |
| **Babylon canvas** | `client/src/game/*.ts` (the systems) | Everything in the 3D scene |

These render on the same DOM node — the React HTML sits on top of the
Babylon `<canvas>` via z-index. The HUD reaches into world-space when
needed (see `EnemyHealthBarSystem`).

## Major React components

| Component | File |
|---|---|
| Auth screen | [`AuthUI.tsx`](../../client/src/game/AuthUI.tsx) |
| Main menu (with cloud-save card) | [`MainMenu.tsx`](../../client/src/game/MainMenu.tsx) |
| Character editor (Body / Armor / Colors / Boss Style) | [`CharacterEditor.tsx`](../../client/src/game/CharacterEditor.tsx) |
| In-game HUD | [`GameUI.tsx`](../../client/src/game/GameUI.tsx) |
| Upgrade menu (WEAPONS, MELEE, ARMOR, COMPANIONS, SHOP, …) | [`UpgradeMenu.tsx`](../../client/src/game/UpgradeMenu.tsx) |
| Lab UI (crafting) | [`LabUI.tsx`](../../client/src/game/LabUI.tsx) |
| Garden capture UI | [`GardenCaptureUI.tsx`](../../client/src/game/GardenCaptureUI.tsx) |
| Music player | [`MusicPlayerUI.tsx`](../../client/src/game/MusicPlayerUI.tsx) |
| Gameplay guide | [`GameplayGuide.tsx`](../../client/src/game/GameplayGuide.tsx) |

The shadcn/ui primitives in `client/src/components/ui/` are vanilla and
can be used anywhere.

## HUD overlays in screen space

[`EnemyHealthBarSystem.ts`](../../client/src/game/EnemyHealthBarSystem.ts)
positions HTML HP bars in screen space from world-space target meshes.
It re-projects every frame and culls off-screen targets. Use this
pattern when you need an HTML overlay anchored to a 3D object.

[`MapSystem.ts`](../../client/src/game/MapSystem.ts) renders the
real-time minimap as an HTML canvas, sampled from the player position
and registered enemy/structure positions.

## Input

| File | Role |
|---|---|
| [`PlayerController.ts`](../../client/src/game/PlayerController.ts) | Keyboard + mouse → movement / jump / flight. |
| [`CombatSystem.ts`](../../client/src/game/CombatSystem.ts) | Mouse buttons + `1`–`8` → fire / weapon switch. |
| [`GamepadInput.ts`](../../client/src/game/GamepadInput.ts) | Standard Gamepad API → maps to the same intents as keyboard/mouse. |

The full keymap lives in [`reference/controls.md`](../reference/controls.md).

## State stores

Two zustand stores in [`client/src/lib/stores/`](../../client/src/lib/stores):

- `useAudio.tsx` — master mute, current track.
- `useGame.tsx` — top-level UI mode (menu / playing / paused).

Most game state is **not** in zustand — it lives in the system classes
under `client/src/game/`. The stores are only for state React HTML
needs to react to.

## UI conventions

- Dark backgrounds with light text (or vice-versa) — readability against
  the 3D scene varies wildly so contrast must be high.
- Cyan / orange / red are the brand colours (see `MainMenu.tsx`).
- Components in `client/src/components/ui/` are unmodified shadcn —
  don't fork them; restyle via Tailwind classes at the call site.
