import { minutesOfDay } from '@/lib/date';
import { circularMinuteStdDev, clamp } from '@/lib/stats';

/** Weights for sleep shortfall over the previous nights, most recent first. */
const DEBT_WEIGHTS = [0.6, 0.3, 0.1];

/** Weighted shortfall vs baseline over the last three nights, capped at 2 hours. */
export function sleepDebt(baselineMin: number, previousAsleep: (number | null)[]): number {
  let debt = 0;
  DEBT_WEIGHTS.forEach((w, i) => {
    const asleep = previousAsleep[i];
    if (asleep != null) debt += Math.max(0, baselineMin - asleep) * w;
  });
  return Math.round(Math.min(120, debt));
}

/** Tonight's need: baseline, plus extra after hard days, plus a third of the debt, minus naps. */
export function sleepNeed(opts: { baselineMin: number; dayStrain: number | null; debtMin: number; napMin?: number }) {
  const strainAdj = opts.dayStrain != null && opts.dayStrain > 8 ? (opts.dayStrain - 8) * 3 : 0;
  const need = opts.baselineMin + strainAdj + opts.debtMin / 3 - (opts.napMin ?? 0);
  return Math.round(clamp(need, 300, 660));
}

export function sleepPerformance(asleepMin: number | null, needMin: number): number | null {
  if (asleepMin == null || needMin <= 0) return null;
  return Math.round(clamp((asleepMin / needMin) * 100, 0, 100));
}

export function sleepEfficiency(asleepMin: number | null, inPeriodMin: number | null): number | null {
  if (!asleepMin || !inPeriodMin) return null;
  return Math.round(clamp((asleepMin / inPeriodMin) * 100, 0, 100));
}

/**
 * Consistency from the spread of bed and wake times across recent nights.
 * A 15-minute standard deviation scores 100; an hour scores about 46.
 */
export function sleepConsistency(nights: { start: string; end: string }[]): number | null {
  if (nights.length < 3) return null;
  const sdBed = circularMinuteStdDev(nights.map((n) => minutesOfDay(n.start)));
  const sdWake = circularMinuteStdDev(nights.map((n) => minutesOfDay(n.end)));
  if (sdBed == null || sdWake == null) return null;
  const sd = (sdBed + sdWake) / 2;
  return Math.round(clamp(100 - (sd - 15) * 1.2, 0, 100));
}
