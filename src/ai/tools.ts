import {
  getDailyRange,
  getHrMinutes,
  getRecentAlerts,
  getScoresRange,
  getSleepRange,
  getWorkoutsRange,
} from '@/db/repo';
import type { SleepStage } from '@/db/types';
import { addDays, ageFrom, daysBetween, parseIsoDate, today } from '@/lib/date';
import { round } from '@/lib/stats';
import { getAgeSummary, parseDetails } from '@/scores/compute';
import type { Profile } from '@/store/settings';
import { getStoredDevice } from '@/sync/syncEngine';

import type { ToolDefinition } from './openrouter';

const range = {
  type: 'object',
  properties: {
    from: { type: 'string', description: 'Start date, YYYY-MM-DD (inclusive)' },
    to: { type: 'string', description: 'End date, YYYY-MM-DD (inclusive)' },
  },
  required: ['from', 'to'],
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_daily_metrics',
      description:
        'Per-day metrics and scores: recovery %, strain (0 to 21), sleep performance %, sleep need, resting HR, HRV (ms), SpO2 %, breathing rate, skin temp, VO2 max, steps, calories, active zone minutes. Max 120 days per call.',
      parameters: range,
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sleep',
      description:
        'Sleep sessions ending in the date range: bed/wake times, minutes asleep/awake, deep/light/REM minutes, latency, naps. Set include_stages for a single night to get the stage timeline.',
      parameters: {
        ...range,
        properties: { ...range.properties, include_stages: { type: 'boolean' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_workouts',
      description: 'Recorded exercises with type, duration, calories, average HR, AZM and time in HR zones.',
      parameters: range,
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_heart_rate_day',
      description: 'Hourly average/max/min heart rate for one day. Only the last 14 days are available.',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_bio_age',
      description:
        'SoFit Age (biological age estimate) with each contributing factor, its value, target and years added or removed, plus pace of aging.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_alerts_and_device',
      description: 'Recent health alerts raised by background monitoring, and the band battery level and last sync time.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

function clampRange(args: Record<string, unknown>, maxDays: number): [string, string] {
  const to = typeof args.to === 'string' ? args.to : today();
  let from = typeof args.from === 'string' ? args.from : addDays(to, -6);
  if (daysBetween(from, to) > maxDays) from = addDays(to, -maxDays);
  return [from, to];
}

export function runTool(name: string, args: Record<string, unknown>, profile: Profile): unknown {
  switch (name) {
    case 'get_daily_metrics': {
      const [from, to] = clampRange(args, 120);
      const scores = new Map(getScoresRange(from, to).map((s) => [s.date, s]));
      return getDailyRange(from, to).map((d) => {
        const s = scores.get(d.date);
        const details = parseDetails(s?.details_json);
        return {
          date: d.date,
          recovery_pct: s?.recovery ?? null,
          strain: s?.strain ?? null,
          strain_source: details.strain?.source ?? null,
          sleep_performance_pct: s?.sleep_perf ?? null,
          sleep_need_min: s?.sleep_need ?? null,
          resting_hr: d.rhr,
          hrv_ms: round(d.hrv, 1),
          spo2_pct: round(d.spo2, 1),
          breathing_rate: round(d.resp, 1),
          skin_temp_dev_c:
            d.temp_nightly != null && d.temp_baseline != null ? round(d.temp_nightly - d.temp_baseline, 2) : null,
          vo2max: round(d.vo2max, 1),
          steps: d.steps,
          calories: round(d.calories),
          azm: { fat_burn: d.azm_fat, cardio: d.azm_cardio, peak: d.azm_peak },
        };
      });
    }
    case 'get_sleep': {
      const [from, to] = clampRange(args, 60);
      const includeStages = args.include_stages === true && from === to;
      return getSleepRange(from, to, false).map((s) => ({
        date: s.date,
        main: !!s.is_main,
        bedtime: new Date(s.start).toLocaleTimeString(),
        wake: new Date(s.end).toLocaleTimeString(),
        asleep_min: s.minutes_asleep,
        awake_min: s.minutes_awake,
        in_bed_min: s.minutes_in_period,
        latency_min: s.latency,
        deep_min: s.deep,
        light_min: s.light,
        rem_min: s.rem,
        stages: includeStages && s.stages_json
          ? (JSON.parse(s.stages_json) as SleepStage[]).map((st) => ({
              type: st.type,
              start: new Date(st.start).toLocaleTimeString(),
              minutes: Math.round((new Date(st.end).getTime() - new Date(st.start).getTime()) / 60000),
            }))
          : undefined,
      }));
    }
    case 'get_workouts': {
      const [from, to] = clampRange(args, 120);
      return getWorkoutsRange(from, to).map((w) => ({
        date: w.date,
        type: w.name ?? w.type,
        start: new Date(w.start).toLocaleString(),
        minutes: w.duration_s != null ? Math.round(w.duration_s / 60) : null,
        calories: round(w.calories),
        avg_hr: w.avg_hr,
        azm: w.azm,
        distance_km: w.distance_m != null ? round(w.distance_m / 1000, 2) : null,
        zone_minutes: {
          light: w.zone_light_s != null ? Math.round(w.zone_light_s / 60) : null,
          moderate: w.zone_moderate_s != null ? Math.round(w.zone_moderate_s / 60) : null,
          vigorous: w.zone_vigorous_s != null ? Math.round(w.zone_vigorous_s / 60) : null,
          peak: w.zone_peak_s != null ? Math.round(w.zone_peak_s / 60) : null,
        },
      }));
    }
    case 'get_heart_rate_day': {
      const date = typeof args.date === 'string' ? args.date : today();
      const start = parseIsoDate(date).getTime() / 1000;
      const minutes = getHrMinutes(start, start + 86400);
      const hours: { hour: number; avg: number; max: number; min: number }[] = [];
      for (let h = 0; h < 24; h++) {
        const bucket = minutes.filter((m) => m.ts >= start + h * 3600 && m.ts < start + (h + 1) * 3600);
        if (!bucket.length) continue;
        const bpms = bucket.map((b) => b.bpm);
        hours.push({
          hour: h,
          avg: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
          max: Math.round(Math.max(...bucket.map((b) => b.bpm_max ?? b.bpm))),
          min: Math.round(Math.min(...bpms)),
        });
      }
      return { date, minutes_recorded: minutes.length, hours };
    }
    case 'get_bio_age':
      return getAgeSummary(profile);
    case 'get_alerts_and_device':
      return {
        device: getStoredDevice(),
        alerts: getRecentAlerts(15).map((a) => ({
          when: new Date(a.ts).toLocaleString(),
          title: a.title,
          body: a.body,
        })),
      };
    default:
      return { error: `Unknown tool ${name}` };
  }
}

export function profileSummary(profile: Profile): string {
  const bmi = profile.weightKg / (profile.heightCm / 100) ** 2;
  return `${ageFrom(profile.birthDate)} y/o ${profile.sex}, ${profile.heightCm} cm, ${profile.weightKg} kg (BMI ${bmi.toFixed(1)}), sleep baseline ${Math.round(profile.sleepBaselineMin / 6) / 10} h`;
}
