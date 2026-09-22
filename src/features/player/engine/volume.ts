const VOLUME_CURVE = 2;

// A just-audible floor applied at the audio output only. Kept out of the
// store curve so the slider always shows the value the user actually picked.
// Deliberately small so low percentages stay quiet and the taper is audible.
export const MIN_AUDIBLE_GAIN = 0.002;

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// maps linear web audio gain to perceptual slider curve
export function toVolumeLevel(gain: number): number {
  if (gain <= 0) return 0;
  return Math.pow(clamp(gain), 1 / VOLUME_CURVE);
}

// converts ui slider curve back to linear gain
export function toVolumeGain(level: number): number {
  if (level <= 0) return 0;
  return Math.pow(clamp(level), VOLUME_CURVE);
}