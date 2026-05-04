# Audio & music

Three systems split the responsibilities:

| File | Role |
|---|---|
| [`SoundSystem.ts`](../../client/src/game/SoundSystem.ts) | Pooled sound-effect player. Listens for `bus.emit("sound:play", { url, volume?, playbackRate? })` and routes to a pool of `HTMLAudioElement`s. |
| [`MusicSystem.ts`](../../client/src/game/MusicSystem.ts) | Singleton background-music controller. Two contexts (`menu`, `game`), 12 tracks, subscribe-based React integration. |
| [`PropAudioSystem.ts`](../../client/src/game/PropAudioSystem.ts) | Pitches a single `hit.mp3` sample per material (wood / metal / glass / heavy) so destructible props feel distinct without per-prop assets. |
| [`MusicPlayerUI.tsx`](../../client/src/game/MusicPlayerUI.tsx) | The compact player widget. Two variants: bottom-right pill on the menu, collapsible tab in-game. |
| [`client/src/lib/stores/useAudio`](../../client/src/lib/stores/useAudio.tsx) | Zustand store the systems read for master gain / mute. |

## SoundSystem

Pooled to avoid the "first-play stutter" of allocating an `Audio`
element on each shot. Pool size is **4** per URL — enough to overlap
fast weapons (rifle, twin daggers) without sounding flammed.

Anyone can play a sound by emitting on the bus:

```ts
bus.emit("sound:play", { url: "/sounds/laser.mp3", volume: 0.8 });
```

There's no direct API by design — keeping it bus-only means systems
don't need a SoundSystem reference and can be torn down independently.

`PropAudioSystem` builds on this — it picks a profile based on the
prop kind being damaged, jitters the playback rate within the profile,
and emits `sound:play` with the chosen rate/volume. Result: one
`hit.mp3` sample sounds like 6 different impact materials.

## MusicSystem

Singleton (`MusicSystem` is the exported instance). Two audio elements
under the hood:

- `menuAudio` — plays `menu.mp3` while the player is on the main menu.
- `gameAudio` — cycles through the 12 game tracks.

The list is provisional — `TRACK_TITLES` carries placeholder names
("Track 01" … "Track 12") so the UI can list them even when the audio
files aren't all present (`available` is computed at preload time). The
`MusicPlayerUI` filters by `available` so missing tracks don't break
the next/previous controls.

State updates broadcast via `MusicSystem.subscribe(listener)`. The UI
calls this in a `useEffect` and re-renders when state changes.

## Adding sounds

1. Drop the asset in `client/public/sounds/`.
2. Trigger it from anywhere with `bus.emit("sound:play", { url, … })`.
3. If it's a recurring effect, give the URL a constant in your system
   so refactors are cheap.

> Don't generate base64 audio. The bundler is configured for static
> URL serving from `public/sounds`, and base64 audio defeats the
> SoundSystem's pool.

## Adding a music track

1. Drop the file in `client/public/music/` named `track_NN.mp3`
   (underscore, not hyphen — matches `MusicSystem`'s URL convention,
   and `NN` is the 1-based position in `TRACK_TITLES`).
2. If you want a friendlier name, edit `TRACK_TITLES`.
3. The `MusicPlayerUI` will pick it up automatically next time
   `MusicSystem` rebuilds its track list.

## Master gain / mute

The Zustand `useAudio` store owns the master volume and mute state.
Both `SoundSystem` and `MusicSystem` read from it, and the
`MusicPlayerUI` writes to it. Don't duplicate this state anywhere
else.
