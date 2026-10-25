import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { getMainSleep, getScore, kvGet, kvSet } from '@/db/repo';
import { addDays, today } from '@/lib/date';
import { ALARM_CATEGORY, Channels } from '@/lib/notifications';
import { sleepDebt, sleepNeed } from '@/scores/sleep';
import type { Profile } from '@/store/settings';

export type Alarm = {
  id: string;
  hour: number;
  minute: number;
  /** 1 = Sunday … 7 = Saturday. Empty means ring once. */
  weekdays: number[];
  enabled: boolean;
  label: string;
  notificationIds: string[];
};

export type BedtimeReminder = { enabled: boolean; hour: number; minute: number; notificationId: string | null };

const SNOOZE_MINUTES = 9;

export function loadAlarms(): Alarm[] {
  return kvGet<Alarm[]>('alarms', []);
}

function saveAlarms(alarms: Alarm[]) {
  kvSet('alarms', alarms);
}

function alarmContent(alarm: Pick<Alarm, 'id' | 'label'>): Notifications.NotificationContentInput {
  return {
    title: 'Time to get up',
    body: alarm.label || 'SoFit alarm',
    sound: 'default',
    categoryIdentifier: ALARM_CATEGORY,
    interruptionLevel: 'timeSensitive',
    priority: Notifications.AndroidNotificationPriority.MAX,
    sticky: true,
    data: { alarmId: alarm.id, kind: 'alarm' },
  };
}

function nextOccurrence(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

async function cancelIds(ids: string[]) {
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

async function schedule(alarm: Alarm): Promise<string[]> {
  if (!alarm.enabled) return [];
  const content = alarmContent(alarm);
  if (!alarm.weekdays.length) {
    const id = await Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: nextOccurrence(alarm.hour, alarm.minute),
        channelId: Channels.alarm,
        delivery: 'alarmClock',
      },
    });
    return [id];
  }
  return Promise.all(
    alarm.weekdays.map((weekday) =>
      Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour: alarm.hour,
          minute: alarm.minute,
          channelId: Channels.alarm,
          delivery: 'alarmClock',
        },
      }),
    ),
  );
}

export async function saveAlarm(alarm: Alarm): Promise<Alarm[]> {
  const alarms = loadAlarms();
  const existing = alarms.find((a) => a.id === alarm.id);
  if (existing) await cancelIds(existing.notificationIds);
  const scheduled = { ...alarm, notificationIds: await schedule(alarm) };
  const next = existing ? alarms.map((a) => (a.id === alarm.id ? scheduled : a)) : [...alarms, scheduled];
  next.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  saveAlarms(next);
  return next;
}

export async function deleteAlarm(id: string): Promise<Alarm[]> {
  const alarms = loadAlarms();
  const target = alarms.find((a) => a.id === id);
  if (target) await cancelIds(target.notificationIds);
  const next = alarms.filter((a) => a.id !== id);
  saveAlarms(next);
  return next;
}

/** Re-creates every scheduled alarm, e.g. after notification permission is granted. */
export async function rescheduleAll() {
  for (const alarm of loadAlarms()) await saveAlarm(alarm);
}

export async function snooze(alarmId: string | undefined) {
  const alarm = loadAlarms().find((a) => a.id === alarmId) ?? { id: alarmId ?? 'snooze', label: 'Snoozed alarm' };
  await Notifications.scheduleNotificationAsync({
    content: alarmContent(alarm),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: Date.now() + SNOOZE_MINUTES * 60_000,
      channelId: Channels.alarm,
      delivery: 'alarmClock',
    },
  });
}

// ---- bedtime ----

export function loadBedtimeReminder(): BedtimeReminder {
  return kvGet<BedtimeReminder>('bedtime', { enabled: false, hour: 22, minute: 30, notificationId: null });
}

export async function saveBedtimeReminder(r: BedtimeReminder): Promise<BedtimeReminder> {
  const prev = loadBedtimeReminder();
  if (prev.notificationId) await cancelIds([prev.notificationId]);
  let notificationId: string | null = null;
  if (r.enabled) {
    notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Wind down',
        body: 'Bedtime in 30 minutes to hit tonight’s sleep need.',
        data: { kind: 'bedtime' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: r.hour,
        minute: r.minute,
        channelId: Channels.reminders,
      },
    });
  }
  const next = { ...r, notificationId };
  kvSet('bedtime', next);
  return next;
}

/** Tonight's sleep need from today's strain and the last three nights. */
export function tonightSleepNeed(profile: Profile): { need: number; debt: number; strain: number | null } {
  const date = today();
  const previous = [0, 1, 2].map((i) => getMainSleep(addDays(date, -i))?.minutes_asleep ?? null);
  const debt = sleepDebt(profile.sleepBaselineMin, previous);
  const strain = getScore(date)?.strain ?? null;
  return { need: sleepNeed({ baselineMin: profile.sleepBaselineMin, dayStrain: strain, debtMin: debt }), debt, strain };
}

/** Bedtime (minutes of day) so that `need` minutes asleep end at the wake time, allowing time to fall asleep. */
export function suggestedBedtime(wakeMinutes: number, needMinutes: number, latencyMinutes = 15): number {
  return (((wakeMinutes - needMinutes - latencyMinutes) % 1440) + 1440) % 1440;
}

/** Opens the Google Health (formerly Fitbit) app so the band's Smart Wake can be set there. */
export async function openGoogleHealthApp() {
  try {
    await Linking.openURL('fitbit://');
    return;
  } catch {
    // App not installed or scheme not handled; fall through to the store.
  }
  const store =
    Platform.OS === 'android'
      ? 'https://play.google.com/store/apps/details?id=com.fitbit.FitbitMobile'
      : 'https://apps.apple.com/app/id462638897';
  await Linking.openURL(store);
}
