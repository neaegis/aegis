export const EQ_BAND_FREQUENCIES = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;

export const EQ_BAND_COUNT = EQ_BAND_FREQUENCIES.length;

export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;

export type EqPresetId =
  | "flat"
  | "pop"
  | "rock"
  | "jazz"
  | "classical"
  | "hiphop"
  | "bass"
  | "vocal"
  | "electronic"
  | "water"
  | "custom";

export const EQ_PRESET_IDS: Exclude<EqPresetId, "custom">[] = [
  "flat",
  "pop",
  "rock",
  "jazz",
  "classical",
  "hiphop",
  "bass",
  "vocal",
  "electronic",
  "water",
];

export type EqBands = number[];

export const EQ_PRESETS: Record<Exclude<EqPresetId, "custom">, EqBands> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pop: [1, 2, 3, 2, 1, 1, 2, 3, 4, 3],
  rock: [5, 4, 2, 0, -1, 1, 3, 3, 2, 2],
  jazz: [3, 2, 1, 1, -1, 2, 2, 1, 0, -1],
  classical: [3, 2, 1, 0, -1, -1, 0, 2, 3, 3],
  hiphop: [6, 5, 3, 1, -1, -1, 1, 2, 3, 3],
  bass: [7, 6, 4, 2, 0, -1, 0, 1, 1, 1],
  vocal: [0, 0, 1, 2, 3, 4, 4, 2, 1, 0],
  electronic: [3, 4, 2, 1, 1, 2, 3, 4, 4, 5],
  water: [3, 5, 6, 4, 3, 1, -3, -6, -8, -8],
};

export const EQ_FLAT_BANDS: EqBands = EQ_PRESETS.flat;

export function isEqPresetId(value: string): value is EqPresetId {
  return (
    value === "custom" ||
    (EQ_PRESET_IDS as string[]).includes(value)
  );
}

export function clampEqBands(bands: number[]): EqBands {
  return EQ_BAND_FREQUENCIES.map((_, i) => {
    const raw = Number.isFinite(bands[i]) ? bands[i] : 0;
    return Math.min(EQ_MAX_DB, Math.max(EQ_MIN_DB, raw));
  });
}

export function isWaterEq(preset: EqPresetId): boolean {
  return preset === "water";
}

interface WaterNodes {
  direct: GainNode;
  wet: GainNode;
  feedback: GainNode;
  lfoDepth: GainNode;
  cutoffDepth: GainNode;
  lowpass: BiquadFilterNode;
}

export class EqualizerEngine {
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private input: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private water: WaterNodes | null = null;
  private attached = false;
  private currentProfile: EqBands | null = null;
  private waterOn = false;

  public get isAttached(): boolean {
    return this.attached;
  }

  private clampDb(value: number): number {
    return Math.min(EQ_MAX_DB, Math.max(EQ_MIN_DB, value));
  }

  public async attach(audio: HTMLAudioElement): Promise<boolean> {
    if (this.attached) return true;
    const AudioContextCtor: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext
        : undefined;
    if (!AudioContextCtor) return false;

    try {
      const context = new AudioContextCtor();
      const source = context.createMediaElementSource(audio);
      const input = context.createGain();
      input.gain.value = 1;
      source.connect(input);

      const filters = EQ_BAND_FREQUENCIES.map((frequency) => {
        const filter = context.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = frequency;
        filter.Q.value = 0.8;
        filter.gain.value = 0;
        return filter;
      });

      let tail: AudioNode = input;
      for (const filter of filters) {
        tail.connect(filter);
        tail = filter;
      }

      const waterIn = context.createGain();
      waterIn.gain.value = 1;
      tail.connect(waterIn);

      const direct = context.createGain();
      direct.gain.value = 1;
      waterIn.connect(direct);
      direct.connect(context.destination);

      const lowpass = context.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 1000;
      lowpass.Q.value = 0.4;
      waterIn.connect(lowpass);

      const delay = context.createDelay(1);
      delay.delayTime.value = 0.05;
      lowpass.connect(delay);

      const feedback = context.createGain();
      feedback.gain.value = 0;
      delay.connect(feedback);
      feedback.connect(delay);

      const wet = context.createGain();
      wet.gain.value = 0;
      delay.connect(wet);
      wet.connect(context.destination);

      const lfo = context.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.16;
      const lfoDepth = context.createGain();
      lfoDepth.gain.value = 0;
      lfo.connect(lfoDepth);
      lfoDepth.connect(delay.delayTime);
      lfo.start();

      const cutoffLfo = context.createOscillator();
      cutoffLfo.type = "sine";
      cutoffLfo.frequency.value = 0.07;
      const cutoffDepth = context.createGain();
      cutoffDepth.gain.value = 0;
      cutoffLfo.connect(cutoffDepth);
      cutoffDepth.connect(lowpass.frequency);
      cutoffLfo.start();

      this.context = context;
      this.source = source;
      this.input = input;
      this.filters = filters;
      this.water = { direct, wet, feedback, lfoDepth, cutoffDepth, lowpass };
      this.attached = true;

      if (this.currentProfile) this.applyBands(this.currentProfile);
      if (this.waterOn) this.setWater(true);

      if (context.state === "suspended") {
        await context.resume().catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  public async resume(): Promise<void> {
    if (this.context && this.context.state === "suspended") {
      await this.context.resume().catch(() => {});
    }
  }

  public apply(profile: EqBands, water: boolean): void {
    this.currentProfile = clampEqBands(profile);
    if (this.attached) {
      this.applyBands(this.currentProfile);
    }
    if (this.waterOn !== water) {
      this.waterOn = water;
      if (this.attached) this.setWater(this.waterOn);
    }
  }

  private applyBands(profile: EqBands): void {
    if (!this.context) return;
    const t = this.context.currentTime;
    this.filters.forEach((filter, i) => {
      filter.gain.setTargetAtTime(this.clampDb(profile[i]), t, 0.03);
    });
    // makeup gain: shave off the average boost so voiced presets stay away
    // from clipping while keeping their character
    if (this.input) {
      const sumBoost = profile.reduce((acc, value) => acc + Math.max(0, value), 0);
      const makeup = Math.pow(10, -sumBoost / 200);
      this.input.gain.setTargetAtTime(Math.min(1, Math.max(0.6, makeup)), t, 0.06);
    }
  }

  private setWater(on: boolean): void {
    if (!this.context || !this.water) return;
    const t = this.context.currentTime;
    const { direct, wet, feedback, lfoDepth, cutoffDepth } = this.water;
    direct.gain.setTargetAtTime(on ? 0.8 : 1, t, 0.06);
    wet.gain.setTargetAtTime(on ? 0.22 : 0, t, 0.06);
    feedback.gain.setTargetAtTime(on ? 0.16 : 0, t, 0.08);
    lfoDepth.gain.setTargetAtTime(on ? 0.006 : 0, t, 0.12);
    cutoffDepth.gain.setTargetAtTime(on ? 250 : 0, t, 0.25);
  }
}

export const equalizer = new EqualizerEngine();