import { describe, expect, it } from '@jest/globals';

import { computeBioAge, paceOfAging } from '../age';
import { computeRecovery } from '../recovery';
import { sleepConsistency, sleepDebt, sleepNeed, sleepPerformance } from '../sleep';
import { estimateTrimpFromDaily, maxHeartRate, strainFromTrimp, trimpFromMinutes } from '../strain';

describe('strain', () => {
  it('estimates max heart rate from age', () => {
    expect(maxHeartRate(30)).toBe(187);
  });

  it('maps TRIMP onto the 0–21 scale', () => {
    expect(strainFromTrimp(0)).toBe(0);
    expect(strainFromTrimp(150)).toBe(13.3);
    expect(strainFromTrimp(10_000)).toBe(21);
  });

  it('ignores minutes below 50% of max HR and buckets the rest into zones', () => {
    const { trimp, zoneMinutes } = trimpFromMinutes([80, 100, 170], 60, 187, 'male');
    expect(trimp).toBeCloseTo(3.2932, 3);
    expect(zoneMinutes).toEqual([1, 0, 0, 0, 1]);
  });

  it('weights female TRIMP with the female coefficients', () => {
    const male = trimpFromMinutes([150], 60, 187, 'male').trimp;
    const female = trimpFromMinutes([150], 60, 187, 'female').trimp;
    expect(female).not.toBeCloseTo(male, 3);
  });

  it('estimates TRIMP from zone minutes and steps', () => {
    expect(estimateTrimpFromDaily({ steps: 10_000, azm_fat: 20, azm_cardio: 20, azm_peak: 0 })).toBe(47);
  });
});

describe('sleep', () => {
  it('weights recent shortfalls most', () => {
    expect(sleepDebt(450, [390, 450, 300])).toBe(51);
    expect(sleepDebt(450, [null, null, null])).toBe(0);
  });

  it('raises need after hard days and with debt', () => {
    expect(sleepNeed({ baselineMin: 450, dayStrain: 14, debtMin: 51 })).toBe(485);
    expect(sleepNeed({ baselineMin: 450, dayStrain: 5, debtMin: 0 })).toBe(450);
    expect(sleepNeed({ baselineMin: 450, dayStrain: null, debtMin: 0, napMin: 30 })).toBe(420);
  });

  it('caps performance at 100%', () => {
    expect(sleepPerformance(400, 480)).toBe(83);
    expect(sleepPerformance(500, 480)).toBe(100);
    expect(sleepPerformance(null, 480)).toBeNull();
  });

  const night = (bedH: number, wakeH: number, day: number) => ({
    start: new Date(2026, 0, day, bedH, 0).toISOString(),
    end: new Date(2026, 0, day + 1, wakeH, 0).toISOString(),
  });

  it('scores identical schedules at 100 and an hour of spread around 46', () => {
    expect(sleepConsistency([night(23, 7, 1), night(23, 7, 2), night(23, 7, 3)])).toBe(100);
    expect(sleepConsistency([night(22, 6, 1), night(0, 8, 2), night(23, 7, 3)])).toBe(46);
  });

  it('treats bedtimes either side of midnight as close together', () => {
    const nights = [
      { start: new Date(2026, 0, 1, 23, 50).toISOString(), end: new Date(2026, 0, 2, 7, 0).toISOString() },
      { start: new Date(2026, 0, 3, 0, 10).toISOString(), end: new Date(2026, 0, 3, 7, 0).toISOString() },
      { start: new Date(2026, 0, 4, 0, 0).toISOString(), end: new Date(2026, 0, 4, 7, 0).toISOString() },
    ];
    expect(sleepConsistency(nights)).toBe(100);
  });

  it('needs at least three nights', () => {
    expect(sleepConsistency([night(23, 7, 1), night(23, 7, 2)])).toBeNull();
  });
});

describe('recovery', () => {
  // ln-mean of HRV is ln(50), RHR mean 60, breathing mean 15: today's values sit exactly on baseline.
  const baseline = {
    hrv: [40, 62.5, 40, 62.5],
    rhr: [55, 65, 55, 65],
    resp: [14, 16, 14, 16],
  };
  const onBaseline = { hrv: 50, rhr: 60, resp: 15, tempDev: 0, sleepPerf: 85 };

  it('puts an on-baseline day at about 62%', () => {
    expect(computeRecovery(onBaseline, baseline).score).toBe(62);
  });

  it('rises with HRV and falls with resting HR', () => {
    const base = computeRecovery(onBaseline, baseline).score!;
    expect(computeRecovery({ ...onBaseline, hrv: 65 }, baseline).score!).toBeGreaterThan(base);
    expect(computeRecovery({ ...onBaseline, rhr: 68 }, baseline).score!).toBeLessThan(base);
  });

  it('penalises a skin temperature swing', () => {
    const base = computeRecovery(onBaseline, baseline).score!;
    expect(computeRecovery({ ...onBaseline, tempDev: 1.2 }, baseline).score!).toBeLessThan(base);
  });

  it('waits for four nights of HRV before scoring', () => {
    const result = computeRecovery(onBaseline, { ...baseline, hrv: [50, 52, 48] });
    expect(result.score).toBeNull();
    expect(result.details.baselineDays).toBe(3);
  });

  it('stays within 1–99', () => {
    const bad = computeRecovery({ hrv: 10, rhr: 90, resp: 22, tempDev: 3, sleepPerf: 20 }, baseline).score!;
    const good = computeRecovery({ hrv: 200, rhr: 40, resp: 10, tempDev: 0, sleepPerf: 100 }, baseline).score!;
    expect(bad).toBeGreaterThanOrEqual(1);
    expect(good).toBeLessThanOrEqual(99);
  });
});

describe('bio age', () => {
  const empty = {
    age: 30,
    sex: 'male' as const,
    vo2max: null,
    rhr: null,
    hrv: null,
    sleepHours: null,
    sleepConsistency: null,
    stepsPerDay: null,
    moderateMinPerWeek: null,
    vigorousMinPerWeek: null,
    bmi: null,
  };

  it('equals chronological age with no data', () => {
    const r = computeBioAge(empty);
    expect(r.bioAge).toBe(30);
    expect(r.factors).toHaveLength(0);
  });

  it('takes 4.5 years off for VO2 max 10 above the age norm', () => {
    // Male norm at 30 is 45 − 0.33 × 5 = 43.35.
    const r = computeBioAge({ ...empty, vo2max: 53.35 });
    expect(r.factors[0].years).toBe(-4.5);
    expect(r.bioAge).toBe(25.5);
  });

  it('clamps the total offset to ±10 years', () => {
    const r = computeBioAge({
      ...empty,
      vo2max: 15,
      rhr: 95,
      hrv: 10,
      sleepHours: 4,
      sleepConsistency: 10,
      stepsPerDay: 500,
      moderateMinPerWeek: 0,
      vigorousMinPerWeek: 0,
      bmi: 38,
    });
    expect(r.offset).toBe(10);
    expect(r.bioAge).toBe(40);
  });

  it('rewards a fit profile', () => {
    const r = computeBioAge({
      ...empty,
      vo2max: 52,
      rhr: 50,
      hrv: 75,
      sleepHours: 7.8,
      sleepConsistency: 90,
      stepsPerDay: 12_000,
      moderateMinPerWeek: 300,
      vigorousMinPerWeek: 120,
      bmi: 22.5,
    });
    expect(r.bioAge).toBeLessThan(25);
    expect(r.factors.every((f) => f.status === 'good')).toBe(true);
  });

  it('computes pace of aging from the change in offset', () => {
    expect(paceOfAging(0, 0)).toBe(1);
    expect(paceOfAging(-1, -0.5)).toBe(0.1);
    expect(paceOfAging(5, -5)).toBe(3);
  });
});
