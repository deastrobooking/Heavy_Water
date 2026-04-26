import { EventBus } from "./EventBus";
import type { PropKind } from "./EnvironmentPropSystem";
import { useAudio } from "@/lib/stores/useAudio";

interface MaterialProfile {
  /** Base playback rate (1 = original pitch). Higher = sharper/brighter. */
  rate: number;
  /** Random ± jitter applied to playbackRate per shot. */
  rateJitter: number;
  /** Base volume (0..1). */
  volume: number;
}

interface BreakProfile extends MaterialProfile {
  /** Optional second layer played a few ms later for a richer "crunch". */
  layerRate?: number;
  /** Volume scalar applied to the layer (relative to `volume`). */
  layerVolume?: number;
}

/** Per-prop "material" profiles for impact sounds. We re-use a single
 *  hit.mp3 sample and shift playbackRate / volume to fake material
 *  variety (metal ping vs wood thud vs glass tinkle vs heavy boom). */
const HIT_PROFILES: Record<PropKind, MaterialProfile> = {
  // Wood crate → low-mid thud
  crate:          { rate: 0.85, rateJitter: 0.10, volume: 0.45 },
  // Metal barrel → sharper, brighter ping
  barrel:         { rate: 1.35, rateJitter: 0.12, volume: 0.40 },
  // Smaller metal canister → highest ping
  canister:       { rate: 1.55, rateJitter: 0.12, volume: 0.36 },
  // Big shipping container → deep, heavy boom
  container:      { rate: 0.65, rateJitter: 0.08, volume: 0.55 },
  // Glass holo-sign → very high "tinkle"
  holo_sign:      { rate: 1.80, rateJitter: 0.15, volume: 0.32 },
  // Open container — same metal-crate feel as crate
  open_container: { rate: 0.95, rateJitter: 0.10, volume: 0.42 },
};

/** Destruction profiles. We layer two pitched copies of hit.mp3 a few ms
 *  apart so the break reads as a heavier, multi-component crash. */
const BREAK_PROFILES: Record<PropKind, BreakProfile> = {
  crate:          { rate: 0.55, rateJitter: 0.08, volume: 0.65, layerRate: 0.95, layerVolume: 0.7 },
  barrel:         { rate: 0.50, rateJitter: 0.08, volume: 0.70, layerRate: 1.30, layerVolume: 0.6 },
  canister:       { rate: 0.55, rateJitter: 0.08, volume: 0.65, layerRate: 1.50, layerVolume: 0.55 },
  container:      { rate: 0.40, rateJitter: 0.06, volume: 0.85, layerRate: 0.80, layerVolume: 0.75 },
  holo_sign:      { rate: 0.75, rateJitter: 0.10, volume: 0.55, layerRate: 1.85, layerVolume: 0.65 },
  open_container: { rate: 0.55, rateJitter: 0.08, volume: 0.60, layerRate: 1.10, layerVolume: 0.65 },
};

interface PropSoundEvent {
  kind: PropKind;
  propId: number;
}

/**
 * PropAudioSystem: plays per-material impact thuds and destruction crashes
 * for environment props. Mirrors the event-driven `EffectsSystem` pattern —
 * gameplay code (EnvironmentPropSystem) emits `sound:propHit` /
 * `sound:propBreak` and this listener owns the audio side.
 *
 * Throttling rules:
 *   - Per-prop: at most one hit sound per ~70ms for the same prop, so
 *     rapid contact damage from the ATV doesn't machine-gun the speaker.
 *   - Global:  cap on simultaneous hit-thuds within a short window to
 *     keep busy combat readable.
 *   - Destruction sounds bypass the throttle (they're a one-shot climax).
 */
export class PropAudioSystem {
  private bus: EventBus;
  private hitBuffer: HTMLAudioElement | null = null;

  /** Per-prop last-played timestamp (performance.now() ms). */
  private lastPropHitAt: Map<number, number> = new Map();
  private propHitMinIntervalMs = 70;

  /** Global rolling window of recent hit-thuds for flood control. */
  private recentHitTimestamps: number[] = [];
  private globalWindowMs = 120;
  private globalMaxInWindow = 6;

  /** Pending delayed-layer setTimeout handles, so we can cancel them on dispose
   *  and avoid stray break-layer playback after teardown. */
  private pendingTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();

  private hitHandler: (data: PropSoundEvent) => void;
  private breakHandler: (data: PropSoundEvent) => void;

  constructor() {
    this.bus = EventBus.getInstance();
    // Single shared "template" element — we cloneNode() per shot so
    // overlapping playback works without restarting the source.
    this.hitBuffer = new Audio("/sounds/hit.mp3");
    this.hitBuffer.preload = "auto";

    this.hitHandler = (data) => this.playHit(data);
    this.breakHandler = (data) => this.playBreak(data);

    this.bus.on("sound:propHit", this.hitHandler);
    this.bus.on("sound:propBreak", this.breakHandler);

    console.log("[PropAudioSystem] Initialized");
  }

  private isMuted(): boolean {
    return useAudio.getState().isMuted;
  }

  private withinGlobalLimit(now: number): boolean {
    while (
      this.recentHitTimestamps.length > 0 &&
      now - this.recentHitTimestamps[0] > this.globalWindowMs
    ) {
      this.recentHitTimestamps.shift();
    }
    return this.recentHitTimestamps.length < this.globalMaxInWindow;
  }

  private playClone(template: HTMLAudioElement, rate: number, volume: number): void {
    const clone = template.cloneNode() as HTMLAudioElement;
    clone.playbackRate = Math.max(0.25, Math.min(4, rate));
    clone.volume = Math.max(0, Math.min(1, volume));
    clone.play().catch(() => {
      // Autoplay-blocked or unsupported playbackRate — silently ignore.
    });
  }

  private playHit(data: PropSoundEvent): void {
    if (this.isMuted() || !this.hitBuffer) return;
    const profile = HIT_PROFILES[data.kind];
    if (!profile) return;

    const now = performance.now();
    const last = this.lastPropHitAt.get(data.propId) ?? 0;
    if (now - last < this.propHitMinIntervalMs) return;
    if (!this.withinGlobalLimit(now)) return;

    this.lastPropHitAt.set(data.propId, now);
    this.recentHitTimestamps.push(now);

    const jitter = (Math.random() - 0.5) * 2 * profile.rateJitter;
    const volJitter = 0.85 + Math.random() * 0.3;
    this.playClone(this.hitBuffer, profile.rate + jitter, profile.volume * volJitter);
  }

  private playBreak(data: PropSoundEvent): void {
    if (this.isMuted() || !this.hitBuffer) return;
    const profile = BREAK_PROFILES[data.kind];
    if (!profile) return;

    // Destruction is the climax — bypass throttle and clear pending state.
    this.lastPropHitAt.delete(data.propId);

    const jitter = (Math.random() - 0.5) * 2 * profile.rateJitter;
    this.playClone(this.hitBuffer, profile.rate + jitter, profile.volume);

    if (profile.layerRate !== undefined) {
      const layerJitter = (Math.random() - 0.5) * 0.2;
      const layerRate = profile.layerRate + layerJitter;
      const layerVol = profile.volume * (profile.layerVolume ?? 0.7);
      const delay = 50 + Math.random() * 50;
      const handle = setTimeout(() => {
        this.pendingTimeouts.delete(handle);
        // After dispose() the buffer is cleared — no-op rather than play.
        if (this.hitBuffer) this.playClone(this.hitBuffer, layerRate, layerVol);
      }, delay);
      this.pendingTimeouts.add(handle);
    }
  }

  dispose(): void {
    this.bus.off("sound:propHit", this.hitHandler);
    this.bus.off("sound:propBreak", this.breakHandler);
    this.pendingTimeouts.forEach(handle => clearTimeout(handle));
    this.pendingTimeouts.clear();
    this.lastPropHitAt.clear();
    this.recentHitTimestamps = [];
    this.hitBuffer = null;
  }
}
