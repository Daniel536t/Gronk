// Phase 5 — audio system. A lightweight Web Audio manager with SEMANTIC
// methods (playFootstep / playHideStart / ... ) so real assets can replace the
// procedural placeholders later without touching call sites. All sounds are
// short, quiet, and fit the dark-fantasy identity — no sci-fi beeps.
//
// FAILURE SAFETY (spec #24): every entry point is guarded — if Web Audio is
// unavailable, throws, or is suspended by the browser autoplay policy, the
// game continues exactly as before. Audio can never break gameplay or the
// render loop.
//
// Autoplay policy (#8): `init()` must be called from a user gesture (the
// client wires pointerdown/keydown + the menu buttons). Until then every play
// method is a no-op.

type RoomKind = "cafeteria" | "library" | "reactor" | "storage";

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambGain: GainNode | null = null;
  private ambOsc: OscillatorNode | null = null;
  private ambOsc2: OscillatorNode | null = null;
  private ambFilter: BiquadFilterNode | null = null;
  private muted = false;

  // QA-visible stats (read-only, not gameplay).
  private totalPlays = 0;
  private lastSound = "";
  private counts = new Map<string, number>();
  // "" until the first setRoom applies a profile — so the initial cafeteria
  // call in startAmbience() is NOT short-circuited by the same-room early
  // return (the ambient bed must start audible).
  room: RoomKind | "" = "";

  // Per-sound cooldowns so events that fire at 60fps / 10Hz can never spam.
  private lastPlayAt = new Map<string, number>();

  /** Create (or resume) the AudioContext. Safe to call repeatedly. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.startAmbience();
      this.installQaHook();
    } catch {
      this.ctx = null; // failure-safe: audio simply stays off
    }
  }

  private installQaHook(): void {
    (window as unknown as {
      __ghAudio?: () => {
        initialized: boolean;
        muted: boolean;
        totalPlays: number;
        lastSound: string;
        room: string;
        counts: Record<string, number>;
      };
    }).__ghAudio = () => {
      const counts: Record<string, number> = {};
      for (const [k, v] of this.counts) counts[k] = v;
      return {
        initialized: this.ctx !== null,
        muted: this.muted,
        totalPlays: this.totalPlays,
        lastSound: this.lastSound,
        room: this.room,
        counts,
      };
    };
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.master) {
      try {
        this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
      } catch {
        /* failure-safe */
      }
    }
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  // ---- ambience: a very quiet per-room bed (hum + filtered air) ----------

  private startAmbience(): void {
    if (!this.ctx || !this.master) return;
    try {
      const g = this.ctx.createGain();
      g.gain.value = 0; // silent until a room is chosen
      g.connect(this.master);
      this.ambGain = g;

      this.ambOsc = this.ctx.createOscillator();
      this.ambOsc.type = "sine";
      this.ambOsc.frequency.value = 120;
      this.ambOsc2 = this.ctx.createOscillator();
      this.ambOsc2.type = "sine";
      this.ambOsc2.frequency.value = 120.7; // slight detune = warm beating
      this.ambFilter = this.ctx.createBiquadFilter();
      this.ambFilter.type = "lowpass";
      this.ambFilter.frequency.value = 500;
      const oscGain = this.ctx.createGain();
      oscGain.gain.value = 0.5;

      this.ambOsc.connect(oscGain);
      this.ambOsc2.connect(oscGain);
      oscGain.connect(this.ambFilter);
      this.ambFilter.connect(g);
      this.ambOsc.start();
      this.ambOsc2.start();

      this.setRoom("cafeteria");
    } catch {
      /* failure-safe */
    }
  }

  /** Crossfade the ambient bed to a room's character. Very subtle. */
  setRoom(room: RoomKind): void {
    if (!this.ctx || !this.ambGain) return;
    if (room === this.room) return;
    this.room = room;
    try {
      const t = this.ctx.currentTime;
      const profile: Record<RoomKind, { hum: number; cut: number; vol: number }> = {
        cafeteria: { hum: 150, cut: 520, vol: 0.5 }, // warm kitchen hum
        library: { hum: 105, cut: 900, vol: 0.4 }, // quiet air / paper
        reactor: { hum: 55, cut: 170, vol: 0.6 }, // low mechanical hum
        storage: { hum: 80, cut: 320, vol: 0.45 }, // hollow room tone
      };
      const p = profile[room];
      this.ambOsc!.frequency.setTargetAtTime(p.hum, t, 1.2);
      this.ambOsc2!.frequency.setTargetAtTime(p.hum * 1.006, t, 1.2);
      this.ambFilter!.frequency.setTargetAtTime(p.cut, t, 1.2);
      this.ambGain.gain.setTargetAtTime(p.vol, t, 2.5);
    } catch {
      /* failure-safe */
    }
  }

  // ---- primitive helpers --------------------------------------------------

  /** Cooldown gate: plays at most one of a key per `gapMs`. Only keys that
   *  have ALREADY played are throttled — the first-ever play of a sound (e.g.
   *  the game-start cue at t≈0, when performance.now() < gap) is never
   *  discarded. */
  private gate(key: string, gapMs: number): boolean {
    const now = performance.now();
    const last = this.lastPlayAt.get(key);
    if (last !== undefined && now - last < gapMs) return false;
    this.lastPlayAt.set(key, now);
    return true;
  }

  /** One enveloped oscillator. All params clamped; wrapped in try/catch. */
  private tone(
    freq: number,
    dur: number,
    opts: {
      type?: OscillatorType;
      gain?: number;
      endFreq?: number;
      delay?: number;
    } = {},
  ): void {
    if (!this.ctx || !this.master) return;
    try {
      const t0 = this.ctx.currentTime + (opts.delay ?? 0);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = opts.type ?? "sine";
      osc.frequency.setValueAtTime(Math.max(1, freq), t0);
      if (opts.endFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.endFreq), t0 + dur);
      }
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(opts.gain ?? 0.12, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch {
      /* failure-safe */
    }
  }

  /** Short filtered noise burst (whooshes, impacts). */
  private noise(dur: number, opts: { gain?: number; freq?: number; type?: BiquadFilterType; delay?: number } = {}): void {
    if (!this.ctx || !this.master) return;
    try {
      const t0 = this.ctx.currentTime + (opts.delay ?? 0);
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = opts.type ?? "bandpass";
      filter.frequency.value = opts.freq ?? 600;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(opts.gain ?? 0.08, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter).connect(g).connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    } catch {
      /* failure-safe */
    }
  }

  /** Record + run a semantic sound (gated, counted, failure-safe). */
  private play(key: string, gapMs: number, fn: () => void): void {
    if (!this.ctx) return; // not initialized (no gesture yet / unsupported)
    if (!this.gate(key, gapMs)) return;
    this.totalPlays++;
    this.lastSound = key;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    try {
      fn();
    } catch {
      /* failure-safe */
    }
  }

  // ---- semantic methods (the only public API the game uses) --------------

  playFootstep(): void {
    this.play("footstep", 130, () => {
      this.noise(0.06, { gain: 0.05, freq: 220, type: "lowpass" });
      this.tone(85 + Math.random() * 25, 0.05, { type: "triangle", gain: 0.03 });
    });
  }

  playInteraction(): void {
    this.play("interaction", 250, () => {
      this.tone(660, 0.09, { gain: 0.05 });
      this.tone(880, 0.1, { gain: 0.04, delay: 0.05 });
    });
  }

  playHideStart(): void {
    this.play("hide", 350, () => {
      this.noise(0.28, { gain: 0.05, freq: 500, type: "bandpass" });
      this.tone(320, 0.22, { gain: 0.05, endFreq: 140, type: "sine" });
    });
  }

  playHideComplete(): void {
    this.play("hideComplete", 400, () => {
      this.tone(220, 0.14, { gain: 0.03 });
    });
  }

  playEmerge(): void {
    this.play("emerge", 350, () => {
      this.noise(0.2, { gain: 0.045, freq: 800, type: "bandpass" });
      this.tone(180, 0.16, { gain: 0.045, endFreq: 340, type: "sine" });
    });
  }

  playReveal(): void {
    this.play("reveal", 400, () => {
      this.noise(0.12, { gain: 0.09, freq: 1800, type: "highpass" });
      this.tone(440, 0.14, { gain: 0.08, endFreq: 880, type: "triangle" });
    });
  }

  playStun(): void {
    this.play("stun", 500, () => {
      this.tone(130, 0.16, { gain: 0.1, endFreq: 60, type: "sine" });
      this.noise(0.1, { gain: 0.06, freq: 900, type: "highpass" });
      this.tone(1200, 0.08, { gain: 0.04, delay: 0.05 });
      this.tone(1600, 0.1, { gain: 0.035, delay: 0.09 });
    });
  }

  playTreasurePickup(): void {
    this.play("pickup", 400, () => {
      this.tone(880, 0.09, { gain: 0.06 });
      this.tone(1108, 0.09, { gain: 0.055, delay: 0.07 });
      this.tone(1318, 0.14, { gain: 0.05, delay: 0.14 });
    });
  }

  playTreasureDrop(): void {
    this.play("drop", 400, () => {
      this.tone(320, 0.11, { gain: 0.07, endFreq: 170, type: "triangle" });
    });
  }

  playGronkAlert(): void {
    this.play("gronk", 2000, () => {
      this.tone(72, 0.4, { gain: 0.09, endFreq: 48, type: "sawtooth" });
      this.noise(0.3, { gain: 0.04, freq: 140, type: "lowpass" });
    });
  }

  playGameStart(): void {
    this.play("gameStart", 1500, () => {
      this.tone(523.25, 0.22, { gain: 0.07 });
      this.tone(659.25, 0.22, { gain: 0.07, delay: 0.08 });
      this.tone(783.99, 0.3, { gain: 0.07, delay: 0.16 });
    });
  }

  playGameEnd(): void {
    this.play("gameEnd", 1500, () => {
      this.tone(392, 0.24, { gain: 0.07 });
      this.tone(523.25, 0.4, { gain: 0.07, delay: 0.16 });
      this.tone(659.25, 0.5, { gain: 0.05, delay: 0.3 });
    });
  }
}

/** Module-level singleton — the only audio instance the game uses. */
export const audio = new AudioManager();
