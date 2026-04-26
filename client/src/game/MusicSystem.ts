export interface MusicTrack {
  id: string;
  title: string;
  url: string;
  available: boolean;
}

export const TRACK_TITLES: string[] = [
  "Track 01",
  "Track 02",
  "Track 03",
  "Track 04",
  "Track 05",
  "Track 06",
  "Track 07",
  "Track 08",
  "Track 09",
  "Track 10",
  "Track 11",
  "Track 12",
];

export type MusicListener = (state: MusicState) => void;

export interface MusicState {
  tracks: MusicTrack[];
  currentIndex: number;
  isPlaying: boolean;
  volume: number;
  context: "menu" | "game";
}

class MusicSystemImpl {
  private menuAudio: HTMLAudioElement | null = null;
  private gameAudio: HTMLAudioElement | null = null;
  private tracks: MusicTrack[] = [];
  private currentIndex: number = 0;
  private isPlaying: boolean = false;
  private volume: number = 0.55;
  private context: "menu" | "game" = "menu";
  private listeners: Set<MusicListener> = new Set();
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    // Build expected list and probe HEAD
    const expected: MusicTrack[] = [];
    for (let i = 1; i <= 12; i++) {
      const num = String(i).padStart(2, "0");
      expected.push({
        id: `track_${num}`,
        title: TRACK_TITLES[i - 1] ?? `Track ${num}`,
        url: `/music/track_${num}.mp3`,
        available: false,
      });
    }

    const probes = expected.map(async t => {
      try {
        const res = await fetch(t.url, { method: "HEAD" });
        t.available = res.ok;
      } catch {
        t.available = false;
      }
      return t;
    });
    await Promise.all(probes);
    this.tracks = expected;

    // Pre-create audio elements (volume only, no src yet)
    this.menuAudio = new Audio();
    this.menuAudio.loop = true;
    this.menuAudio.volume = this.volume;
    this.gameAudio = new Audio();
    this.gameAudio.loop = false;
    this.gameAudio.volume = this.volume;
    this.gameAudio.addEventListener("ended", () => {
      if (this.context === "game") this.next();
    });

    this.emit();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.menuAudio) this.menuAudio.volume = this.volume;
    if (this.gameAudio) this.gameAudio.volume = this.volume;
    this.emit();
  }

  getVolume(): number { return this.volume; }

  async playMenu(): Promise<void> {
    this.context = "menu";
    if (this.gameAudio && !this.gameAudio.paused) this.gameAudio.pause();
    if (!this.menuAudio) return;
    if (!this.menuAudio.src) this.menuAudio.src = "/music/menu.mp3";
    try {
      await this.menuAudio.play();
      this.isPlaying = true;
    } catch {
      // Autoplay blocked — will need a user gesture
      this.isPlaying = false;
    }
    this.emit();
  }

  stopMenu(): void {
    if (this.menuAudio) {
      this.menuAudio.pause();
      this.menuAudio.currentTime = 0;
    }
  }

  async startGameMusic(): Promise<void> {
    this.context = "game";
    if (this.menuAudio && !this.menuAudio.paused) this.menuAudio.pause();
    const available = this.tracks.findIndex(t => t.available);
    if (available < 0) {
      this.isPlaying = false;
      this.emit();
      return;
    }
    this.currentIndex = available;
    await this.playCurrent();
  }

  private async playCurrent(): Promise<void> {
    if (!this.gameAudio) return;
    const t = this.tracks[this.currentIndex];
    if (!t || !t.available) return;
    this.gameAudio.src = t.url;
    try {
      await this.gameAudio.play();
      this.isPlaying = true;
    } catch {
      this.isPlaying = false;
    }
    this.emit();
  }

  async play(): Promise<void> {
    if (this.context === "menu") {
      await this.playMenu();
    } else {
      if (this.gameAudio?.src) {
        try { await this.gameAudio.play(); this.isPlaying = true; } catch { this.isPlaying = false; }
      } else {
        await this.startGameMusic();
      }
    }
    this.emit();
  }

  pause(): void {
    if (this.context === "menu" && this.menuAudio) this.menuAudio.pause();
    else if (this.gameAudio) this.gameAudio.pause();
    this.isPlaying = false;
    this.emit();
  }

  togglePlay(): void {
    if (this.isPlaying) this.pause();
    else void this.play();
  }

  async selectTrack(index: number): Promise<void> {
    if (index < 0 || index >= this.tracks.length) return;
    if (!this.tracks[index].available) return;
    this.context = "game";
    if (this.menuAudio && !this.menuAudio.paused) this.menuAudio.pause();
    this.currentIndex = index;
    await this.playCurrent();
  }

  next(): void {
    const n = this.tracks.length;
    if (n === 0) return;
    let i = this.currentIndex;
    for (let step = 0; step < n; step++) {
      i = (i + 1) % n;
      if (this.tracks[i].available) {
        this.currentIndex = i;
        void this.playCurrent();
        return;
      }
    }
  }

  prev(): void {
    const n = this.tracks.length;
    if (n === 0) return;
    let i = this.currentIndex;
    for (let step = 0; step < n; step++) {
      i = (i - 1 + n) % n;
      if (this.tracks[i].available) {
        this.currentIndex = i;
        void this.playCurrent();
        return;
      }
    }
  }

  subscribe(fn: MusicListener): () => void {
    this.listeners.add(fn);
    fn(this.getState());
    return () => { this.listeners.delete(fn); };
  }

  getState(): MusicState {
    return {
      tracks: this.tracks.slice(),
      currentIndex: this.currentIndex,
      isPlaying: this.isPlaying,
      volume: this.volume,
      context: this.context,
    };
  }

  private emit(): void {
    const state = this.getState();
    this.listeners.forEach(l => l(state));
  }

  dispose(): void {
    if (this.menuAudio) { this.menuAudio.pause(); this.menuAudio.src = ""; this.menuAudio = null; }
    if (this.gameAudio) { this.gameAudio.pause(); this.gameAudio.src = ""; this.gameAudio = null; }
    this.listeners.clear();
    this.initPromise = null;
    this.isPlaying = false;
  }
}

export const MusicSystem = new MusicSystemImpl();
