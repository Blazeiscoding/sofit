import { describe, expect, it } from '@jest/globals';

import type { DailyRow } from '@/db/types';

import { evaluateRules } from '../rules';

const settings = {
  enabled: true,
  rhrRiseBpm: 5,
  hrvDropSd: 1.5,
  spo2Min: 93,
  respRise: 2,
  tempDevC: 1,
  batteryMin: 15,
  noSyncHours: 24,
};

function day(i: number, patch: Partial<DailyRow> = {}): DailyRow {
  return {
    date: `2026-10-${String(i).padStart(2, '0')}`,
    rhr: 60,
    hrv: i % 2 ? 48 : 52,
    hrv_deep: null,
    spo2: 96,
    spo2_low: null,
    resp: i % 2 ? 14.8 : 15.2,
    temp_nightly: 33.5,
    temp_baseline: 33.5,
    vo2max: null,
    cardio_fitness: null,
    steps: 8000,
    distance_m: null,
    calories: null,
    azm_fat: null,
    azm_cardio: null,
    azm_peak: null,
    ...patch,
  };
}

const history = Array.from({ length: 22 }, (_, i) => day(i + 1));

describe('evaluateRules', () => {
  it('stays quiet on a normal day', () => {
    expect(evaluateRules([...history, day(23)], null, settings)).toEqual([]);
  });

  it('flags resting HR only when elevated two days running', () => {
    const once = evaluateRules([...history, day(23, { rhr: 67 })], null, settings);
    expect(once.find((a) => a.kind === 'rhr')).toBeUndefined();
    const twice = evaluateRules([...history, day(23, { rhr: 66 }), day(24, { rhr: 67 })], null, settings);
    expect(twice.find((a) => a.kind === 'rhr')?.key).toBe('rhr:2026-10-24');
  });

  it('flags an HRV crash, low SpO2, high breathing rate and a temperature swing', () => {
    const alerts = evaluateRules(
      [...history, day(23, { hrv: 30, spo2: 91.5, resp: 18, temp_nightly: 34.8 })],
      null,
      settings,
    );
    expect(alerts.map((a) => a.kind).sort()).toEqual(['hrv', 'resp', 'spo2', 'temp']);
  });

  it('flags low battery and a stale band sync', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    const alerts = evaluateRules(
      [...history],
      { name: 'd', batteryLevel: 10, lastSyncTime: '2026-10-24T06:00:00Z' },
      settings,
      now,
    );
    expect(alerts.map((a) => a.kind).sort()).toEqual(['battery', 'sync']);
  });
});
