# Vehicles

Heavy Water has parametrically generated **ATVs** and **space fighters**.
Both are described by a single `VehicleDescriptor` and built by a
shared factory.

## Components

| File | Role |
|---|---|
| [`VehicleDesigner.ts`](../../client/src/game/VehicleDesigner.ts) | The `VehicleStyle` schema (kind, body dims, wheels-or-wings, colors, options) plus `VEHICLE_PRESETS`. |
| [`VehicleFactory.ts`](../../client/src/game/VehicleFactory.ts) | Builds the actual mesh hierarchy from a `VehicleStyle`. Per-scene material cache. |
| [`VehicleSystem.ts`](../../client/src/game/VehicleSystem.ts) | Owns the live roster, mount/dismount, drive/fly behavior, Turbo Boost, altitude clamping. |

## VehicleStyle in one screen

```ts
interface VehicleStyle {
  kind: "atv" | "spaceFighter";
  bodyLength, bodyWidth, bodyHeight: number;
  primaryColor, secondaryColor, accentColor, emissiveColor: RGB;

  // ATV-only
  wheelCount?: number;
  wheelRadius?, wheelWidth?: number;
  hasRollCage?, hasFenders?, hasHeadlights?, hasExhaust?: boolean;

  // Space-fighter-only
  wingSpan?, wingChord?, wingTaper?, wingTipFinHeight?, tailFinHeight?: number;
  cannonCount?, thrusterCount?: number;
  cockpitStyle?: "bubble" | "wedge" | "flat";
}
```

The factory branches on `kind`, ignores the irrelevant fields, and emits
a `VehicleMeshes` bundle (root + body + wheels-or-wings + extras).

## Material caching

`VehicleFactory` uses a **`WeakMap<Scene, Map<key, StandardMaterial>>`**.
Two reasons:

1. **Per-scene isolation.** A previous global cache survived scene
   disposal and handed out materials belonging to the dead scene on
   the next vehicle build, leaving the new mesh fully transparent.
2. **Auto-cleanup.** A scene `onDisposeObservable` listener drops the
   per-scene map when the scene goes away, so the WeakMap never holds
   live material references past their useful life.

There is also an `isDisposed` guard on each cached material for the
narrower case of a single material being disposed while its scene
lives on.

## Driving / flying

`VehicleSystem` reads `PlayerController` input but bypasses the
humanoid's WASD code path while a vehicle is `active`. ATVs are
pinned to the ground; space fighters clamp to
`[FIGHTER_MIN_ALTITUDE, FIGHTER_MAX_ALTITUDE]`.

**Turbo Boost** is a short-duration speed multiplier with a cooldown,
shared by both kinds. The mechanic is intentionally identical so
players don't have to relearn it per vehicle.

## Aim provider integration

When a vehicle is active, `CombatSystem.aimProvider` switches to
`"vehicle gunner"` (see [`combat-and-damage.md`](combat-and-damage.md)).
The vehicle drives the aim direction; player mouse-look becomes camera
gimbal only. Switching back on dismount is automatic.

## Adding a vehicle preset

1. Add the preset to `VEHICLE_PRESETS` in `VehicleDesigner.ts`.
2. Pick `kind: "atv"` or `kind: "spaceFighter"` and fill the relevant
   block of fields. Leave the irrelevant block as defaults.
3. Spawn it via `VehicleSystem.spawnPreset(name, position)` from
   wherever you want it placed (`CityGenerator`, a side-zone system,
   `BaseSystem`).
4. Test mount → drive → Turbo Boost → dismount.

If you need a new `kind` (boat, hover-skiff, mech), it's a
`VehicleFactory` change, not just a preset — branch the `build()`
method on the new kind.
