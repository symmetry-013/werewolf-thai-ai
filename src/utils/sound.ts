// Procedural Web Audio API sound effects for Ultimate Werewolf

class SoundController {
  private ctx: AudioContext | null = null;
  public muted: boolean = false;

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public playNightTransition() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.65);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.72);
  }

  public playDayTransition() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [330, 440, 554.37, 659.25];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);

      gain.gain.setValueAtTime(0.001, now + idx * 0.09);
      gain.gain.linearRampToValueAtTime(0.1, now + idx * 0.09 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.42);
    });
  }

  public playMessagePop(isModerator = false) {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isModerator ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(isModerator ? 520 : 380, now);
    osc.frequency.exponentialRampToValueAtTime(isModerator ? 640 : 440, now + 0.08);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playNightAction(
    role:
      | 'WEREWOLF'
      | 'WOLF_CUB'
      | 'HUMAN_WOLF'
      | 'SEER'
      | 'BODYGUARD'
      | 'BEGGAR'
      | 'VILLAGER'
  ) {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (role === 'WEREWOLF' || role === 'WOLF_CUB' || role === 'HUMAN_WOLF') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(75, now + 0.28);
    } else if (role === 'SEER') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.25);
    } else if (role === 'BODYGUARD') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(261.63, now);
      osc.frequency.setValueAtTime(392.0, now + 0.08);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(293.66, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.2);
    }

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  public playExecutionImpact() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.45);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  public playVictory(villagersWon: boolean) {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const chord = villagersWon ? [261.63, 329.63, 392.0, 523.25] : [196.0, 233.08, 293.66, 370.0];
    chord.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = villagersWon ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + i * 0.11);

      gain.gain.setValueAtTime(0.001, now + i * 0.11);
      gain.gain.linearRampToValueAtTime(0.1, now + i * 0.11 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.11 + 0.75);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.11);
      osc.stop(now + i * 0.11 + 0.78);
    });
  }

  // 1. Werewolf Blocked: metallic shield clang + sharp energy deflection
  public playShieldBlock() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Metallic ring partials (inharmonic metal ratios)
    const freqs = [310, 682, 1140, 1785];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx % 2 === 0 ? 'triangle' : 'square';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.88, now + 0.42);

      const peak = idx === 0 ? 0.16 : 0.08 / idx;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.48);
    });

    // Sub impact thump
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(140, now);
    sub.frequency.exponentialRampToValueAtTime(48, now + 0.24);
    subGain.gain.setValueAtTime(0.22, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.28);
  }

  // 2. Victim Saved: radiant uplifting golden chime chord
  public playShieldSaved() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + idx * 0.075;
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.11, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.85);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.88);
    });
  }

  // 3. Bodyguard Success: triumphant heroic golden brass/bell fanfare
  public playBodyguardSuccess() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const fanfare = [
      { freq: 392.0, offset: 0, dur: 0.22 },
      { freq: 523.25, offset: 0.12, dur: 0.24 },
      { freq: 659.25, offset: 0.24, dur: 0.3 },
      { freq: 783.99, offset: 0.36, dur: 0.85 },
      { freq: 1046.5, offset: 0.36, dur: 0.85 },
    ];
    fanfare.forEach((note) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + note.offset;
      osc.frequency.setValueAtTime(note.freq, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + note.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + note.dur + 0.04);
    });
  }

  // 4. Bodyguard Failed (Wrong Target): low somber dull thud + faint crack
  public playBodyguardFailed() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(115, now);
    thud.frequency.exponentialRampToValueAtTime(42, now + 0.42);
    thudGain.gain.setValueAtTime(0.2, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    thud.connect(thudGain);
    thudGain.connect(ctx.destination);
    thud.start(now);
    thud.stop(now + 0.48);

    // Somber descending minor interval
    [220, 185].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + 0.08 + idx * 0.16;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.92, t + 0.55);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.075, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.64);
    });
  }

  // 5. Other Player Killed by Werewolves: eerie distant howl sweep + sharp claw slash
  public playOtherWolfKill() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Eerie wolf howl pitch sweep
    const howl = ctx.createOscillator();
    const howlFilter = ctx.createBiquadFilter();
    const howlGain = ctx.createGain();
    howl.type = 'sawtooth';
    howl.frequency.setValueAtTime(195, now);
    howl.frequency.exponentialRampToValueAtTime(340, now + 0.28);
    howl.frequency.exponentialRampToValueAtTime(270, now + 0.62);
    howl.frequency.exponentialRampToValueAtTime(155, now + 0.95);

    howlFilter.type = 'bandpass';
    howlFilter.frequency.setValueAtTime(520, now);
    howlFilter.Q.setValueAtTime(3.2, now);

    howlGain.gain.setValueAtTime(0.001, now);
    howlGain.gain.linearRampToValueAtTime(0.11, now + 0.14);
    howlGain.gain.exponentialRampToValueAtTime(0.001, now + 0.98);

    howl.connect(howlFilter);
    howlFilter.connect(howlGain);
    howlGain.connect(ctx.destination);
    howl.start(now);
    howl.stop(now + 1.0);

    // Sharp claw slash burst (filtered white noise)
    const slashLen = Math.floor(ctx.sampleRate * 0.24);
    const buffer = ctx.createBuffer(1, slashLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < slashLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (slashLen * 0.35));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, now + 0.08);
    bp.frequency.exponentialRampToValueAtTime(650, now + 0.3);
    bp.Q.setValueAtTime(1.5, now + 0.08);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.001, now + 0.08);
    nGain.gain.linearRampToValueAtTime(0.24, now + 0.1);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now + 0.08);
  }

  // 6. Other Player Executed by Villagers: fire crackle + dramatic gavel/torch boom
  public playOtherExecution() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Deep dramatic torch/boom impact
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'sawtooth';
    boom.frequency.setValueAtTime(130, now);
    boom.frequency.exponentialRampToValueAtTime(38, now + 0.45);
    boomGain.gain.setValueAtTime(0.18, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    boom.connect(boomGain);
    boomGain.connect(ctx.destination);
    boom.start(now);
    boom.stop(now + 0.52);

    // Crackling fire burst
    const fireLen = Math.floor(ctx.sampleRate * 0.9);
    const buffer = ctx.createBuffer(1, fireLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < fireLen; i++) {
      const env = Math.exp(-i / (fireLen * 0.55));
      const crackle = Math.random() > 0.965 ? (Math.random() * 2 - 1) * 1.8 : (Math.random() * 2 - 1) * 0.28;
      data[i] = crackle * env;
    }
    const fireNoise = ctx.createBufferSource();
    fireNoise.buffer = buffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(900, now);
    const fGain = ctx.createGain();
    fGain.gain.setValueAtTime(0.16, now);
    fGain.gain.exponentialRampToValueAtTime(0.001, now + 0.92);

    fireNoise.connect(hp);
    hp.connect(fGain);
    fGain.connect(ctx.destination);
    fireNoise.start(now);
  }

  // 7. Beggar/Idiot Survived Execution: cheeky mischievous ascending flourish
  public playBeggarReveal() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [392.0, 466.16, 523.25, 622.25, 783.99];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.065;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.11, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  // 8. Peaceful Night: calm dawn/moonlight chime
  public playPeacefulNight() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + idx * 0.1;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.085, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.84);
    });
  }
}

export const soundFX = new SoundController();
