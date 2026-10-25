import type { PairedDevice } from '@/api/googleHealth';
import type { DailyRow } from '@/db/types';
import { mean, round, stdDev } from '@/lib/stats';
import type { AlertSettings } from '@/store/settings';

export type Alert = { key: string; kind: string; title: string; body: string };

/**
 * Checks the latest days against the personal 30-day baseline.
 * `days` is ascending by date and should cover at least the last ~32 days.
 */
export function evaluateRules(
  days: DailyRow[],
  device: PairedDevice | null,
  s: AlertSettings,
  now = Date.now(),
): Alert[] {
  const alerts: Alert[] = [];
  const latest = days[days.length - 1];
  const history = days.slice(0, -1).slice(-30);

  if (latest) {
    const d = latest.date;
    const rhrBase = mean(history.map((h) => h.rhr));
    const prev = days[days.length - 2];
    if (
      rhrBase != null &&
      latest.rhr != null &&
      prev?.rhr != null &&
      latest.rhr >= rhrBase + s.rhrRiseBpm &&
      prev.rhr >= rhrBase + s.rhrRiseBpm
    ) {
      alerts.push({
        key: `rhr:${d}`,
        kind: 'rhr',
        title: 'Resting heart rate is elevated',
        body: `${Math.round(latest.rhr)} bpm, two days running vs your ${Math.round(rhrBase)} bpm baseline. Could be illness, stress, alcohol or overtraining. Take it easy today.`,
      });
    }

    const hrvHist = history.map((h) => h.hrv);
    const hrvMean = mean(hrvHist);
    const hrvSd = stdDev(hrvHist);
    if (hrvMean != null && hrvSd != null && latest.hrv != null && latest.hrv < hrvMean - s.hrvDropSd * hrvSd) {
      alerts.push({
        key: `hrv:${d}`,
        kind: 'hrv',
        title: 'HRV dropped well below baseline',
        body: `${Math.round(latest.hrv)} ms vs your ${Math.round(hrvMean)} ms average. Your body is under more strain than usual.`,
      });
    }

    if (latest.spo2 != null && latest.spo2 < s.spo2Min) {
      alerts.push({
        key: `spo2:${d}`,
        kind: 'spo2',
        title: 'Low overnight blood oxygen',
        body: `Average SpO₂ was ${round(latest.spo2, 1)}%. One low night is often a fit issue; if it repeats, talk to a doctor.`,
      });
    }

    const respBase = mean(history.map((h) => h.resp));
    if (respBase != null && latest.resp != null && latest.resp >= respBase + s.respRise) {
      alerts.push({
        key: `resp:${d}`,
        kind: 'resp',
        title: 'Breathing rate is up',
        body: `${round(latest.resp, 1)} breaths/min vs ${round(respBase, 1)} normally. This often shows up before you feel sick.`,
      });
    }

    const tempBase = latest.temp_baseline ?? mean(history.map((h) => h.temp_nightly));
    if (tempBase != null && latest.temp_nightly != null) {
      const dev = latest.temp_nightly - tempBase;
      if (Math.abs(dev) >= s.tempDevC) {
        alerts.push({
          key: `temp:${d}`,
          kind: 'temp',
          title: `Skin temperature ${dev > 0 ? 'higher' : 'lower'} than usual`,
          body: `${dev > 0 ? '+' : ''}${round(dev, 1)}°C vs your baseline overnight.`,
        });
      }
    }
  }

  if (device?.batteryLevel != null && device.batteryLevel <= s.batteryMin) {
    const day = new Date(now).toISOString().slice(0, 10);
    alerts.push({
      key: `battery:${day}`,
      kind: 'battery',
      title: 'Fitbit Air battery low',
      body: `${device.batteryLevel}% left. Charge it so tonight's sleep is tracked.`,
    });
  }

  if (device?.lastSyncTime) {
    const hours = (now - new Date(device.lastSyncTime).getTime()) / 3_600_000;
    if (hours >= s.noSyncHours) {
      alerts.push({
        key: `nosync:${device.lastSyncTime}`,
        kind: 'sync',
        title: "Your band hasn't synced",
        body: `Last sync was ${Math.round(hours)} hours ago. Open the Google Health app to push data from the band.`,
      });
    }
  }

  return alerts;
}
