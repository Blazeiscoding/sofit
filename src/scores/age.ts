import { clamp, round } from '@/lib/stats';
import type { Sex } from '@/store/settings';

export type AgeInputs = {
  age: number;
  sex: Sex;
  vo2max: number | null;
  rhr: number | null;
  hrv: number | null;
  sleepHours: number | null;
  sleepConsistency: number | null;
  stepsPerDay: number | null;
  /** Fat-burn zone (roughly HR zones 1–3) minutes per week. */
  moderateMinPerWeek: number | null;
  /** Cardio + peak zone (roughly HR zones 4–5) minutes per week. */
  vigorousMinPerWeek: number | null;
  bmi: number | null;
};

export type AgeFactorKey =
  | 'vo2max'
  | 'rhr'
  | 'hrv'
  | 'sleepHours'
  | 'sleepConsistency'
  | 'steps'
  | 'moderate'
  | 'vigorous'
  | 'bmi';

export type AgeFactor = {
  key: AgeFactorKey;
  label: string;
  value: number;
  unit: string;
  target: string;
  /** Years added (+) or removed (−) from chronological age. */
  years: number;
  status: 'good' | 'neutral' | 'poor';
};

export type AgeResult = {
  chronological: number;
  bioAge: number;
  offset: number;
  factors: AgeFactor[];
};

/** Each factor converts a measurement into a year offset. Tune the norms here. */
export const AGE_NORMS = {
  vo2Expected: (age: number, sex: Sex) => (sex === 'female' ? 38 - 0.28 * (age - 25) : 45 - 0.33 * (age - 25)),
  rhrExpected: (sex: Sex) => (sex === 'female' ? 65 : 62),
  hrvExpected: (age: number) => Math.max(18, 62 - 0.85 * (age - 20)),
  stepsTarget: 8000,
  moderateTarget: 150,
  vigorousTarget: 75,
  maxOffset: 10,
};

function status(years: number): AgeFactor['status'] {
  if (years <= -0.25) return 'good';
  if (years >= 0.25) return 'poor';
  return 'neutral';
}

export function computeBioAge(i: AgeInputs): AgeResult {
  const factors: AgeFactor[] = [];
  const add = (f: Omit<AgeFactor, 'status' | 'years'> & { years: number }) =>
    factors.push({ ...f, years: round(f.years, 2)!, status: status(f.years) });

  if (i.vo2max != null) {
    const expected = AGE_NORMS.vo2Expected(i.age, i.sex);
    add({
      key: 'vo2max',
      label: 'VO₂ max',
      value: round(i.vo2max, 1)!,
      unit: 'ml/kg/min',
      target: `> ${Math.round(expected)}`,
      years: clamp(-(i.vo2max - expected) * 0.45, -5, 5),
    });
  }
  if (i.rhr != null) {
    const expected = AGE_NORMS.rhrExpected(i.sex);
    add({
      key: 'rhr',
      label: 'Resting heart rate',
      value: Math.round(i.rhr),
      unit: 'bpm',
      target: `< ${expected}`,
      years: clamp((i.rhr - expected) * 0.15, -2, 2),
    });
  }
  if (i.hrv != null) {
    const expected = AGE_NORMS.hrvExpected(i.age);
    add({
      key: 'hrv',
      label: 'Heart rate variability',
      value: Math.round(i.hrv),
      unit: 'ms',
      target: `> ${Math.round(expected)}`,
      years: clamp((-(i.hrv - expected) / expected) * 4, -2, 2),
    });
  }
  if (i.sleepHours != null) {
    const h = i.sleepHours;
    const years = h < 7 ? (7 - h) * 1.2 : h > 9 ? (h - 9) * 0.6 : -0.5;
    add({ key: 'sleepHours', label: 'Hours of sleep', value: round(h, 1)!, unit: 'h', target: '7–9', years: clamp(years, -0.5, 2) });
  }
  if (i.sleepConsistency != null) {
    add({
      key: 'sleepConsistency',
      label: 'Sleep consistency',
      value: Math.round(i.sleepConsistency),
      unit: '%',
      target: '> 75',
      years: clamp((75 - i.sleepConsistency) / 25, -1, 1),
    });
  }
  if (i.stepsPerDay != null) {
    add({
      key: 'steps',
      label: 'Daily steps',
      value: Math.round(i.stepsPerDay),
      unit: 'steps',
      target: `> ${AGE_NORMS.stepsTarget.toLocaleString()}`,
      years: clamp(((AGE_NORMS.stepsTarget - i.stepsPerDay) / 2000) * 0.5, -1.5, 1.5),
    });
  }
  if (i.moderateMinPerWeek != null) {
    add({
      key: 'moderate',
      label: 'Zone 1–3 time',
      value: Math.round(i.moderateMinPerWeek),
      unit: 'min/wk',
      target: `> ${AGE_NORMS.moderateTarget}`,
      years: clamp((AGE_NORMS.moderateTarget - i.moderateMinPerWeek) / AGE_NORMS.moderateTarget, -1.5, 1),
    });
  }
  if (i.vigorousMinPerWeek != null) {
    add({
      key: 'vigorous',
      label: 'Zone 4–5 time',
      value: Math.round(i.vigorousMinPerWeek),
      unit: 'min/wk',
      target: `> ${AGE_NORMS.vigorousTarget}`,
      years: clamp((AGE_NORMS.vigorousTarget - i.vigorousMinPerWeek) / AGE_NORMS.vigorousTarget, -1.5, 1),
    });
  }
  if (i.bmi != null) {
    const distance = i.bmi < 18.5 ? 18.5 - i.bmi : i.bmi > 25 ? i.bmi - 25 : 0;
    add({
      key: 'bmi',
      label: 'BMI',
      value: round(i.bmi, 1)!,
      unit: '',
      target: '18.5–25',
      years: distance === 0 ? -0.3 : clamp(distance * 0.3, 0, 2),
    });
  }

  const raw = factors.reduce((sum, f) => sum + f.years, 0);
  const offset = round(clamp(raw, -AGE_NORMS.maxOffset, AGE_NORMS.maxOffset), 1)!;
  return { chronological: i.age, bioAge: round(i.age + offset, 1)!, offset, factors };
}

/**
 * Pace of aging: how many "biological years" pass per calendar year, judged by how the
 * age offset moved between the prior 6 months and the last 30 days (about 0.29 years apart
 * between window midpoints). Damped by half to keep it from swinging wildly.
 */
export function paceOfAging(recentOffset: number, priorOffset: number): number {
  const elapsedYears = 0.29;
  return round(clamp(1 + ((recentOffset - priorOffset) / elapsedYears) * 0.5, -1, 3), 1)!;
}
