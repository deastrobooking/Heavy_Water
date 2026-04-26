import { EventBus } from "./EventBus";

interface PlayOptions {
  volume?: number;
  playbackRate?: number;
}

interface SoundPlayRequest {
  url: string;
  volume?: number;
  playbackRate?: number;
}

const POOL_SIZE = 4;

export class SoundSystem {
  private bus: EventBus;
  private pools: Map<string, HTMLAudioElement[]> = new Map();
  private cursors: Map<string, number> = new Map();
  private masterVolume: number = 0.7;
  private playHandler: (data: SoundPlayRequest) => void;
  private enabled: boolean = true;

  constructor() {
    this.bus = EventBus.getInstance();
    this.playHandler = (data: SoundPlayRequest) => {
      if (!data || !data.url) return;
      this.play(data.url, { volume: data.volume, playbackRate: data.playbackRate });
    };
    this.bus.on("sound:play", this.playHandler);
    console.log("[SoundSystem] Initialized");
  }

  preload(url: string): void {
    if (this.pools.has(url)) return;
    const pool: HTMLAudioElement[] = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio(url);
      a.preload = "auto";
      a.volume = this.masterVolume;
      pool.push(a);
    }
    this.pools.set(url, pool);
    this.cursors.set(url, 0);
  }

  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  play(url: string, opts: PlayOptions = {}): void {
    if (!this.enabled) return;
    if (!this.pools.has(url)) this.preload(url);
    const pool = this.pools.get(url)!;
    const idx = (this.cursors.get(url) || 0) % pool.length;
    this.cursors.set(url, idx + 1);
    const a = pool[idx];
    try {
      a.pause();
      a.currentTime = 0;
      a.volume = Math.max(0, Math.min(1, (opts.volume ?? 1) * this.masterVolume));
      a.playbackRate = Math.max(0.25, Math.min(4, opts.playbackRate ?? 1));
      a.play().catch(() => {
        // Autoplay restrictions or other errors — swallow silently
      });
    } catch {
      // ignore playback failures
    }
  }

  dispose(): void {
    this.bus.off("sound:play", this.playHandler);
    this.pools.forEach((pool) => {
      for (const a of pool) {
        try {
          a.pause();
          a.src = "";
        } catch {
          // ignore
        }
      }
    });
    this.pools.clear();
    this.cursors.clear();
  }
}
