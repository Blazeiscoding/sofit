import type { RecoveryDetails } from '@/db/types';
import { clamp, mean, present, stdDev } from '@/lib/stats';

export type RecoveryInput = {
  hrv: number | null;
  rhr: number | null;
  resp: number | null;
  /** Nightly skin temperature minus personal baseline, °C. */
  tempDev: number | null;
  sleepPerf: number | null;
};

export type RecoveryBaseline = {
  hrv: (number | null)[];
  rhr: (number | null)[];
  resp: (number | null)[];
};

const MIN_BASELINE_DAYS = 4;

function zScore(value: number | null, history: number[], minSd: number, invert = false): number | null {
  if (value == null || history.length < MIN_BASELINE_DAYS) return null;
  const m = mean(history)!;
  const sd = Math.max(stdDev(history) ?? minSd, minSd);
  const z = (value - m) / sd;
  return clamp(invert ? -z : z, -3, 3);
}

/**
 * Recovery 0–100 from HRV (log-scaled), resting HR and breathing rate against the previous
 * 30 days, plus sleep performance and a skin-temperature penalty. Returns null while there
 * is too little HRV history to form a baseline.
 */
export function computeRecovery(input: RecoveryInput, baseline: RecoveryBaseline) {
  const hrvHistory = present(baseline.hrv).filter((v) => v > 0).map(Math.log);
  const hrvZ = input.hrv != null && input.hrv > 0 ? zScore(Math.log(input.hrv), hrvHistory, 0.05) : null;
  const rhrZ = zScore(input.rhr, present(baseline.rhr), 1, true);
  const respZ = zScore(input.resp, present(baseline.resp), 0.3, true);
  const sleepZ = input.sleepPerf != null ? clamp((input.sleepPerf - 85) / 12, -3, 1.5) : null;

  const details: RecoveryDetails = {
    hrvZ,
    rhrZ,
    respZ,
    tempDev: input.tempDev,
    sleepPerf: input.sleepPerf,
    baselineDays: hrvHistory.length,
  };
  if (hrvZ == null) return { score: null, details };

  const parts: [number | null, number][] = [
    [hrvZ, 0.5],
    [rhrZ, 0.25],
    [respZ, 0.1],
    [sleepZ, 0.15],
  ];
  let weighted = 0;
  let totalWeight = 0;
  for (const [z, w] of parts) {
    if (z == null) continue;
    weighted += z * w;
    totalWeight += w;
  }
  let combined = weighted / totalWeight;
  if (input.tempDev != null && Math.abs(input.tempDev) > 0.5) {
    combined -= Math.abs(input.tempDev) - 0.5;
  }
  // Logistic map: an average day (combined = 0) lands around 62%.
  const score = 100 / (1 + Math.exp(-1.6 * (combined + 0.3)));
  return { score: Math.round(clamp(score, 1, 99)), details };
}
