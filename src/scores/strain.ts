import type { Sex } from '@/store/settings';

/** Tanaka-style estimate: 208 − 0.7 × age. */
export function maxHeartRate(age: number): number {
  return Math.round(208 - 0.7 * age);
}

// Strain = 21 · (1 − e^(−TRIMP / K)). K is tuned so an easy day lands around 4–7,
// a 45-minute hard run around 12, and only very long hard days approach 21.
const STRAIN_K = 150;

/** Zone lower bounds as a fraction of max HR (zones 1–5). */
const ZONE_BOUNDS = [0.5, 0.6, 0.7, 0.8, 0.9];

export function strainFromTrimp(trimp: number): number {
  return Math.round(21 * (1 - Math.exp(-Math.max(0, trimp) / STRAIN_K)) * 10) / 10;
}

/**
 * Banister TRIMP over one-minute heart-rate samples. Minutes below 50% of max HR are
 * ignored so a resting day doesn't accumulate strain from baseline heart rate.
 */
export function trimpFromMinutes(bpms: number[], restingHr: number, maxHr: number, sex: Sex) {
  const [a, b] = sex === 'female' ? [0.86, 1.67] : [0.64, 1.92];
  const zoneMinutes = [0, 0, 0, 0, 0];
  let trimp = 0;
  const reserve = Math.max(1, maxHr - restingHr);
  for (const bpm of bpms) {
    const pct = bpm / maxHr;
    if (pct < ZONE_BOUNDS[0]) continue;
    let zone = 0;
    while (zone < 4 && pct >= ZONE_BOUNDS[zone + 1]) zone++;
    zoneMinutes[zone]++;
    const hrr = Math.min(1, Math.max(0, (bpm - restingHr) / reserve));
    trimp += hrr * a * Math.exp(b * hrr);
  }
  return { trimp, zoneMinutes };
}

/**
 * Fallback when minute-level heart rate isn't available (older than 14 days).
 * Active Zone Minutes count 1 per fat-burn minute and 2 per cardio/peak minute.
 */
export function estimateTrimpFromDaily(d: {
  steps: number | null;
  azm_fat: number | null;
  azm_cardio: number | null;
  azm_peak: number | null;
}): number {
  const fat = d.azm_fat ?? 0;
  const cardio = (d.azm_cardio ?? 0) / 2;
  const peak = (d.azm_peak ?? 0) / 2;
  const walking = ((d.steps ?? 0) / 100) * 0.2;
  return fat * 0.6 + cardio * 1.5 + peak * 2.8 + walking;
}
