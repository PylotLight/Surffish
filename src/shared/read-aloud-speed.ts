/**
 * Read Aloud speed: how a rate (0.75–3×) is split between Phonon itself and a time stretch.
 *
 * Phonon 31M's `duration_delta` conditioner (config.json: continuous, scale_factor 1000, no range
 * given) only moves the speaking rate a little. Measured with phonon-tts 0.4.0, q8, default voice,
 * seed and temperature, on two texts (5.9 s and 10.6 s of audio at 0):
 *
 *   delta   +0.5   +0.3   +0.2    0    -0.2   -0.4   -0.5   -0.6   -0.8   -1    ≤ -2
 *   rate    0.87   0.87   0.90   1.00  1.15   1.25   1.23–1.33  1.28  1.16  1.16  broken (max-length audio)
 *
 * so past about 1.25× (and below about 0.87×) the model stops following it, and beyond -1 it falls
 * apart. Phonon is asked for at most MODEL_MAX_RATE (delta −0.4, steady on both texts) and at least
 * MODEL_MIN_RATE; the remaining factor is a WSOLA time stretch of its audio
 * (read-aloud-stretch.ts), which keeps the pitch. Pure, shared by main (the speak command) and tests.
 */
import { normalizeSpeed } from "./read-aloud";

export const MODEL_MAX_RATE = 1.25;
export const MODEL_MIN_RATE = 0.87;

/** Measured rate → delta points (ascending rate), interpolated linearly between them. */
const CALIBRATION: ReadonlyArray<readonly [rate: number, delta: number]> = [
  [0.87, 0.3],
  [0.9, 0.2],
  [1, 0],
  [1.15, -0.2],
  [1.25, -0.4],
];

/** Phonon's `duration_delta` for a model-native rate (clamped to what the model follows). */
export function rateToDurationDelta(rate: number): number {
  const target = Math.min(MODEL_MAX_RATE, Math.max(MODEL_MIN_RATE, rate));
  for (let index = 1; index < CALIBRATION.length; index += 1) {
    const [rateHigh, deltaHigh] = CALIBRATION[index]!;
    const [rateLow, deltaLow] = CALIBRATION[index - 1]!;
    if (target <= rateHigh) {
      const t = (target - rateLow) / (rateHigh - rateLow);
      return Math.round((deltaLow + t * (deltaHigh - deltaLow)) * 1000) / 1000;
    }
  }
  return CALIBRATION[CALIBRATION.length - 1]![1];
}

export interface SpeedSplit {
  /** The rate asked for, normalized (0.75–3, 0.05 steps). */
  speed: number;
  /** Rate Phonon speaks at through `duration_delta`. */
  modelRate: number;
  durationDelta: number;
  /** Time-stretch factor applied to Phonon's audio (1 = none; 2 = twice as fast). */
  stretch: number;
}

/** `modelRate × stretch = speed`. 1× is untouched (delta 0, no stretch). */
export function splitSpeed(value: number): SpeedSplit {
  const speed = normalizeSpeed(value);
  const modelRate = Math.min(MODEL_MAX_RATE, Math.max(MODEL_MIN_RATE, speed));
  const stretch = Math.round((speed / modelRate) * 10_000) / 10_000;
  return {
    speed,
    modelRate,
    durationDelta: rateToDurationDelta(modelRate),
    stretch: Math.abs(stretch - 1) < 0.001 ? 1 : stretch,
  };
}

/** Sentences generated ahead of the one playing: more at high speed, where each one is short. */
export function lookaheadFor(speed: number): number {
  return speed > 2 ? 3 : speed > 1.4 ? 2 : 1;
}
