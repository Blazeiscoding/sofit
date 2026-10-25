import {
  getDaily,
  getDailyRange,
  getHrMinutes,
  getMainSleep,
  getScore,
  getSleepRange,
  latestDailyValue,
  upsertScore,
} from '@/db/repo';
import type { ScoreDetails } from '@/db/types';
import { addDays, ageFrom, daysBetween, parseIsoDate, today } from '@/lib/date';
import { mean, present } from '@/lib/stats';
import type { Profile } from '@/store/settings';

import { type AgeResult, computeBioAge, paceOfAging } from './age';
import { computeRecovery } from './recovery';
import { sleepConsistency, sleepDebt, sleepEfficiency, sleepNeed, sleepPerformance } from './sleep';
import { estimateTrimpFromDaily, maxHeartRate, strainFromTrimp, trimpFromMinutes } from './strain';

/** Minimum minutes of heart-rate data in a day before we trust it over the AZM estimate. */
const MIN_HR_MINUTES = 60;

function dayBounds(date: string): [number, number] {
  const start = parseIsoDate(date).getTime() / 1000;
  return [start, parseIsoDate(addDays(date, 1)).getTime() / 1000];
}

function computeStrainFor(date: string, profile: Profile) {
  const age = ageFrom(profile.birthDate);
  const maxHr = maxHeartRate(age);
  const restingHr = getDaily(date)?.rhr ?? latestDailyValue('rhr', date)?.value ?? 60;
  const [from, to] = dayBounds(date);
  const minutes = getHrMinutes(from, to);
  if (minutes.length >= MIN_HR_MINUTES) {
    const { trimp, zoneMinutes } = trimpFromMinutes(
      minutes.map((m) => m.bpm),
      restingHr,
      maxHr,
      profile.sex,
    );
    return { strain: strainFromTrimp(trimp), details: { trimp, source: 'heart-rate' as const, zoneMinutes, maxHr } };
  }
  const daily = getDaily(date);
  if (!daily || (daily.steps == null && daily.azm_fat == null)) return null;
  const trimp = estimateTrimpFromDaily(daily);
  return {
    strain: strainFromTrimp(trimp),
    details: { trimp, source: 'estimated' as const, zoneMinutes: [0, 0, 0, 0, 0], maxHr },
  };
}

function computeSleepFor(date: string, profile: Profile) {
  const main = getMainSleep(date);
  const previous = [1, 2, 3].map((i) => getMainSleep(addDays(date, -i))?.minutes_asleep ?? null);
  const debt = sleepDebt(profile.sleepBaselineMin, previous);
  const prevStrain = getScore(addDays(date, -1))?.strain ?? null;
  const naps = getSleepRange(addDays(date, -1), addDays(date, -1), false).filter((s) => !s.is_main);
  const napMin = naps.reduce((sum, s) => sum + (s.minutes_asleep ?? 0), 0);
  const need = sleepNeed({ baselineMin: profile.sleepBaselineMin, dayStrain: prevStrain, debtMin: debt, napMin });
  const asleep = main?.minutes_asleep ?? null;
  const recent = getSleepRange(addDays(date, -3), date);
  return {
    performance: sleepPerformance(asleep, need),
    need,
    details: {
      asleep,
      need,
      debt,
      efficiency: sleepEfficiency(asleep, main?.minutes_in_period ?? null),
      consistency: sleepConsistency(recent),
    },
  };
}

function computeRecoveryFor(date: string, sleepPerf: number | null) {
  const day = getDaily(date);
  if (!day) return null;
  const history = getDailyRange(addDays(date, -30), addDays(date, -1));
  const tempBaseline = day.temp_baseline ?? mean(history.map((h) => h.temp_nightly));
  const tempDev = day.temp_nightly != null && tempBaseline != null ? day.temp_nightly - tempBaseline : null;
  return computeRecovery(
    { hrv: day.hrv, rhr: day.rhr, resp: day.resp, tempDev, sleepPerf },
    { hrv: history.map((h) => h.hrv), rhr: history.map((h) => h.rhr), resp: history.map((h) => h.resp) },
  );
}

/** Recomputes and stores scores for each date in [from, to], oldest first so strain feeds the next night's need. */
export function recomputeScores(from: string, to: string, profile: Profile) {
  const days = daysBetween(from, to);
  for (let i = 0; i <= days; i++) {
    const date = addDays(from, i);
    const strain = computeStrainFor(date, profile);
    const sleep = computeSleepFor(date, profile);
    const recovery = computeRecoveryFor(date, sleep.performance);
    const details: ScoreDetails = {
      strain: strain?.details,
      sleep: sleep.details,
      recovery: recovery?.details,
    };
    upsertScore({
      date,
      recovery: recovery?.score ?? null,
      strain: strain?.strain ?? null,
      sleep_perf: sleep.performance,
      sleep_need: sleep.need,
      details_json: JSON.stringify(details),
    });
  }
}

export function parseDetails(json: string | null | undefined): ScoreDetails {
  if (!json) return {};
  try {
    return JSON.parse(json) as ScoreDetails;
  } catch {
    return {};
  }
}

// ---- biological age ----

type AgeWindow = { result: AgeResult; daysWithData: number };

function ageForWindow(end: string, days: number, profile: Profile): AgeWindow {
  const start = addDays(end, -(days - 1));
  const rows = getDailyRange(start, end);
  const nights = getSleepRange(start, end);
  const azmDays = rows.filter((r) => r.azm_fat != null || r.azm_cardio != null || r.azm_peak != null);
  const perWeek = (sum: number) => (azmDays.length ? (sum / azmDays.length) * 7 : null);
  const heightM = profile.heightCm / 100;
  const sleepMinutes = present(nights.map((n) => n.minutes_asleep));

  const result = computeBioAge({
    age: ageFrom(profile.birthDate, parseIsoDate(end)),
    sex: profile.sex,
    vo2max: mean(rows.map((r) => r.vo2max)),
    rhr: mean(rows.map((r) => r.rhr)),
    hrv: mean(rows.map((r) => r.hrv)),
    sleepHours: sleepMinutes.length ? mean(sleepMinutes)! / 60 : null,
    sleepConsistency: sleepConsistency(nights),
    stepsPerDay: mean(rows.map((r) => r.steps)),
    moderateMinPerWeek: perWeek(azmDays.reduce((s, r) => s + (r.azm_fat ?? 0), 0)),
    vigorousMinPerWeek: perWeek(azmDays.reduce((s, r) => s + ((r.azm_cardio ?? 0) + (r.azm_peak ?? 0)) / 2, 0)),
    bmi: heightM > 0 && profile.weightKg > 0 ? profile.weightKg / (heightM * heightM) : null,
  });
  const daysWithData = rows.filter((r) => r.rhr != null || r.steps != null).length;
  return { result, daysWithData };
}

export type AgeSummary = AgeResult & { pace: number | null; daysWithData: number };

/** SoFit Age from the last 30 days, with pace of aging against the six months before that. */
export function getAgeSummary(profile: Profile, end = today()): AgeSummary {
  const recent = ageForWindow(end, 30, profile);
  const prior = ageForWindow(addDays(end, -30), 180, profile);
  const pace = prior.daysWithData >= 14 ? paceOfAging(recent.result.offset, prior.result.offset) : null;
  return { ...recent.result, pace, daysWithData: recent.daysWithData };
}
