import { AuthRequiredError } from '@/api/auth';
import {
  type DataPoint,
  dailyRollUp,
  getPairedDevices,
  listDataPoints,
  type PairedDevice,
  type RollupPoint,
  rollUp,
  WEARABLES,
} from '@/api/googleHealth';
import {
  insertHrMinutes,
  kvGet,
  kvSet,
  latestHrTs,
  pruneHrMinutes,
  upsertDaily,
  upsertSleep,
  upsertWorkout,
} from '@/db/repo';
import type { DailyField, SleepStage } from '@/db/types';
import { addDays, daysBetween, fromApiDate, isoDate, today } from '@/lib/date';
import { recomputeScores } from '@/scores/compute';
import { loadProfile } from '@/store/settings';

const BACKFILL_DAYS = 90;
/** Days re-fetched on every incremental sync, since the band can upload late. */
const OVERLAP_DAYS = 3;
const HR_DAYS = 14;

export type SyncResult = { from: string; to: string; errors: string[]; at: number };

/** Parses a protobuf Duration string such as "1830s" or "12.5s" into seconds. */
export function durationSeconds(d: string | undefined | null): number | null {
  if (!d) return null;
  const n = parseFloat(d.replace(/s$/, ''));
  return isFinite(n) ? n : null;
}

const num = (v: string | number | undefined | null): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return isFinite(n) ? n : null;
};

// ---- per-type mappers ----

type DailySpec = {
  dataType: string;
  filterField: string;
  map: (p: DataPoint) => { date: string | null; fields: Partial<Record<DailyField, number | string | null>> } | undefined;
};

const DAILY_SPECS: DailySpec[] = [
  {
    dataType: 'daily-resting-heart-rate',
    filterField: 'daily_resting_heart_rate.date',
    map: (p) =>
      p.dailyRestingHeartRate && {
        date: fromApiDate(p.dailyRestingHeartRate.date),
        fields: { rhr: num(p.dailyRestingHeartRate.beatsPerMinute) },
      },
  },
  {
    dataType: 'daily-heart-rate-variability',
    filterField: 'daily_heart_rate_variability.date',
    map: (p) =>
      p.dailyHeartRateVariability && {
        date: fromApiDate(p.dailyHeartRateVariability.date),
        fields: {
          hrv: num(p.dailyHeartRateVariability.averageHeartRateVariabilityMilliseconds),
          hrv_deep: num(p.dailyHeartRateVariability.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds),
        },
      },
  },
  {
    dataType: 'daily-oxygen-saturation',
    filterField: 'daily_oxygen_saturation.date',
    map: (p) =>
      p.dailyOxygenSaturation && {
        date: fromApiDate(p.dailyOxygenSaturation.date),
        fields: {
          spo2: num(p.dailyOxygenSaturation.averagePercentage),
          spo2_low: num(p.dailyOxygenSaturation.lowerBoundPercentage),
        },
      },
  },
  {
    dataType: 'daily-respiratory-rate',
    filterField: 'daily_respiratory_rate.date',
    map: (p) =>
      p.dailyRespiratoryRate && {
        date: fromApiDate(p.dailyRespiratoryRate.date),
        fields: { resp: num(p.dailyRespiratoryRate.breathsPerMinute) },
      },
  },
  {
    dataType: 'daily-sleep-temperature-derivations',
    filterField: 'daily_sleep_temperature_derivations.date',
    map: (p) =>
      p.dailySleepTemperatureDerivations && {
        date: fromApiDate(p.dailySleepTemperatureDerivations.date),
        fields: {
          temp_nightly: num(p.dailySleepTemperatureDerivations.nightlyTemperatureCelsius),
          temp_baseline: num(p.dailySleepTemperatureDerivations.baselineTemperatureCelsius),
        },
      },
  },
  {
    dataType: 'daily-vo2-max',
    filterField: 'daily_vo2_max.date',
    map: (p) =>
      p.dailyVo2Max && {
        date: fromApiDate(p.dailyVo2Max.date),
        fields: { vo2max: num(p.dailyVo2Max.vo2Max), cardio_fitness: p.dailyVo2Max.cardioFitnessLevel ?? null },
      },
  },
];

async function syncDailyMetrics(start: string, endExcl: string, errors: string[]) {
  await Promise.all(
    DAILY_SPECS.map(async (spec) => {
      try {
        const filter = `${spec.filterField} >= "${start}" AND ${spec.filterField} < "${endExcl}"`;
        const points = await listDataPoints(spec.dataType, filter);
        for (const p of points) {
          const mapped = spec.map(p);
          if (mapped?.date) upsertDaily(mapped.date, mapped.fields);
        }
      } catch (e) {
        if (e instanceof AuthRequiredError) throw e;
        errors.push(`${spec.dataType}: ${(e as Error).message}`);
      }
    }),
  );
}

type RollupSpec = {
  dataType: string;
  map: (p: RollupPoint) => Partial<Record<DailyField, number | null>> | null;
};

const ROLLUP_SPECS: RollupSpec[] = [
  { dataType: 'steps', map: (p) => (p.steps ? { steps: num(p.steps.countSum) } : null) },
  {
    dataType: 'distance',
    map: (p) => (p.distance ? { distance_m: (num(p.distance.millimetersSum) ?? 0) / 1000 } : null),
  },
  { dataType: 'total-calories', map: (p) => (p.totalCalories ? { calories: num(p.totalCalories.kcalSum) } : null) },
  {
    dataType: 'active-zone-minutes',
    map: (p) =>
      p.activeZoneMinutes
        ? {
            azm_fat: num(p.activeZoneMinutes.sumInFatBurnHeartZone) ?? 0,
            azm_cardio: num(p.activeZoneMinutes.sumInCardioHeartZone) ?? 0,
            azm_peak: num(p.activeZoneMinutes.sumInPeakHeartZone) ?? 0,
          }
        : null,
  },
];

async function syncDailyRollups(start: string, endExcl: string, errors: string[]) {
  // total-calories allows at most 14 days per request; use that chunk size for all types.
  const chunks: [string, string][] = [];
  for (let s = start; s < endExcl; s = addDays(s, 14)) {
    const e = addDays(s, 14);
    chunks.push([s, e < endExcl ? e : endExcl]);
  }
  await Promise.all(
    ROLLUP_SPECS.map(async (spec) => {
      try {
        for (const [s, e] of chunks) {
          const points = await dailyRollUp(spec.dataType, s, e);
          for (const p of points) {
            const date = fromApiDate(p.civilStartTime?.date);
            const fields = spec.map(p);
            if (date && fields) upsertDaily(date, fields);
          }
        }
      } catch (e) {
        if (e instanceof AuthRequiredError) throw e;
        errors.push(`${spec.dataType}: ${(e as Error).message}`);
      }
    }),
  );
}

const STAGE_TYPES = new Set(['AWAKE', 'LIGHT', 'DEEP', 'REM', 'ASLEEP', 'RESTLESS']);

export function mapSleep(p: DataPoint) {
  const s = p.sleep;
  if (!s?.interval) return null;
  const stageMinutes = (type: string) =>
    num(s.summary?.stagesSummary?.find((st) => st.type === type)?.minutes) ?? null;
  const stages: SleepStage[] = (s.stages ?? [])
    .filter((st) => STAGE_TYPES.has(st.type))
    .map((st) => ({ start: st.startTime, end: st.endTime, type: st.type as SleepStage['type'] }));
  return {
    id: p.dataPointName ?? p.name ?? s.interval.startTime,
    date: fromApiDate(s.interval.civilEndTime?.date) ?? isoDate(new Date(s.interval.endTime)),
    start: s.interval.startTime,
    end: s.interval.endTime,
    is_main: (s.metadata?.mainSleep ?? !s.metadata?.nap) ? 1 : 0,
    minutes_asleep: num(s.summary?.minutesAsleep),
    minutes_awake: num(s.summary?.minutesAwake),
    minutes_in_period: num(s.summary?.minutesInSleepPeriod),
    latency: num(s.summary?.minutesToFallAsleep),
    deep: stageMinutes('DEEP'),
    light: stageMinutes('LIGHT'),
    rem: stageMinutes('REM'),
    awake: stageMinutes('AWAKE'),
    stages_json: stages.length ? JSON.stringify(stages) : null,
  };
}

async function syncSleep(start: string, endExcl: string, errors: string[]) {
  try {
    const filter = `sleep.interval.civil_end_time >= "${start}" AND sleep.interval.civil_end_time < "${endExcl}"`;
    const points = await listDataPoints('sleep', filter, { reconcile: true, family: WEARABLES, pageSize: 25 });
    for (const p of points) {
      const row = mapSleep(p);
      if (row) upsertSleep(row);
    }
  } catch (e) {
    if (e instanceof AuthRequiredError) throw e;
    errors.push(`sleep: ${(e as Error).message}`);
  }
}

async function syncWorkouts(start: string, endExcl: string, errors: string[]) {
  try {
    const filter = `exercise.interval.civil_start_time >= "${start}" AND exercise.interval.civil_start_time < "${endExcl}"`;
    const points = await listDataPoints('exercise', filter, { reconcile: true, family: WEARABLES, pageSize: 25 });
    for (const p of points) {
      const x = p.exercise;
      if (!x?.interval) continue;
      const m = x.metricsSummary;
      const zones = m?.heartRateZoneDurations;
      upsertWorkout({
        id: p.dataPointName ?? p.name ?? x.interval.startTime,
        date: fromApiDate(x.interval.civilStartTime?.date) ?? isoDate(new Date(x.interval.startTime)),
        start: x.interval.startTime,
        end: x.interval.endTime,
        type: x.exerciseType ?? null,
        name: x.displayName ?? null,
        duration_s:
          durationSeconds(x.activeDuration) ??
          (new Date(x.interval.endTime).getTime() - new Date(x.interval.startTime).getTime()) / 1000,
        calories: num(m?.caloriesKcal),
        avg_hr: num(m?.averageHeartRateBeatsPerMinute),
        azm: num(m?.activeZoneMinutes),
        distance_m: m?.distanceMillimeters != null ? m.distanceMillimeters / 1000 : null,
        zone_light_s: durationSeconds(zones?.lightTime),
        zone_moderate_s: durationSeconds(zones?.moderateTime),
        zone_vigorous_s: durationSeconds(zones?.vigorousTime),
        zone_peak_s: durationSeconds(zones?.peakTime),
      });
    }
  } catch (e) {
    if (e instanceof AuthRequiredError) throw e;
    errors.push(`exercise: ${(e as Error).message}`);
  }
}

async function syncHeartRate(errors: string[]) {
  const now = Math.floor(Date.now() / 1000);
  const floor = now - HR_DAYS * 86400;
  const latest = latestHrTs();
  // Always re-read at least the last 24h, because the band uploads in batches.
  let from = latest == null ? floor : Math.max(floor, Math.min(latest, now - 86400));
  from -= from % 60;
  try {
    while (from < now) {
      const to = Math.min(now, from + 86400);
      const points = await rollUp(
        'heart-rate',
        new Date(from * 1000).toISOString(),
        new Date(to * 1000).toISOString(),
        '60s',
      );
      insertHrMinutes(
        points
          .filter((p) => p.startTime && p.heartRate?.beatsPerMinuteAvg != null)
          .map((p) => ({
            ts: Math.floor(new Date(p.startTime!).getTime() / 1000),
            bpm: p.heartRate!.beatsPerMinuteAvg!,
            bpm_max: p.heartRate!.beatsPerMinuteMax ?? null,
          })),
      );
      from = to;
    }
    pruneHrMinutes(floor - 86400);
  } catch (e) {
    if (e instanceof AuthRequiredError) throw e;
    errors.push(`heart-rate: ${(e as Error).message}`);
  }
}

async function syncDevice(errors: string[]) {
  try {
    const devices = await getPairedDevices();
    // Prefer the most recently synced tracker if several are paired.
    const device = devices.sort((a, b) => (b.lastSyncTime ?? '').localeCompare(a.lastSyncTime ?? ''))[0];
    if (device) kvSet('device', device);
  } catch (e) {
    if (e instanceof AuthRequiredError) throw e;
    errors.push(`devices: ${(e as Error).message}`);
  }
}

export function getStoredDevice(): PairedDevice | null {
  return kvGet<PairedDevice | null>('device', null);
}

export function getLastSync(): SyncResult | null {
  return kvGet<SyncResult | null>('sync:last', null);
}

let running: Promise<SyncResult> | null = null;

/**
 * Pulls Google Health data into SQLite and recomputes scores. The first run backfills
 * 90 days; later runs start a few days before the last synced date.
 */
export function syncAll(opts: { full?: boolean } = {}): Promise<SyncResult> {
  running ??= doSync(opts).finally(() => {
    running = null;
  });
  return running;
}

async function doSync({ full }: { full?: boolean }): Promise<SyncResult> {
  const to = today();
  const last = kvGet<string | null>('sync:lastDate', null);
  let from = full || !last ? addDays(to, -(BACKFILL_DAYS - 1)) : addDays(last, -OVERLAP_DAYS);
  if (daysBetween(from, to) > BACKFILL_DAYS) from = addDays(to, -(BACKFILL_DAYS - 1));
  const endExcl = addDays(to, 1);
  const errors: string[] = [];

  await Promise.all([
    syncDailyMetrics(from, endExcl, errors),
    syncDailyRollups(from, endExcl, errors),
    syncSleep(from, endExcl, errors),
    syncWorkouts(from, endExcl, errors),
    syncHeartRate(errors),
    syncDevice(errors),
  ]);

  const profile = loadProfile();
  if (profile) recomputeScores(from, to, profile);

  const result: SyncResult = { from, to, errors, at: Date.now() };
  kvSet('sync:lastDate', to);
  kvSet('sync:last', result);
  return result;
}
