import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { getDailyRange, recordAlert } from '@/db/repo';
import { addDays, today } from '@/lib/date';
import { notifyNow } from '@/lib/notifications';
import { getStoredDevice, syncAll } from '@/sync/syncEngine';
import { loadSettings } from '@/store/settings';

import { evaluateRules } from './rules';

export const MONITOR_TASK = 'sofit-monitor';

/** Runs the alert rules over stored data and posts a notification for each new alert. */
export async function runMonitorChecks(): Promise<number> {
  const settings = loadSettings();
  if (!settings.alerts.enabled) return 0;
  const days = getDailyRange(addDays(today(), -31), today());
  const alerts = evaluateRules(days, getStoredDevice(), settings.alerts);
  let sent = 0;
  for (const a of alerts) {
    if (recordAlert(a.key, a.kind, a.title, a.body)) {
      await notifyNow(a.title, a.body);
      sent++;
    }
  }
  return sent;
}

// Must be defined at module scope so the OS can run it while the app is in the background.
TaskManager.defineTask(MONITOR_TASK, async () => {
  try {
    await syncAll();
    await runMonitorChecks();
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
  return BackgroundTask.BackgroundTaskResult.Success;
});

export async function registerMonitorTask() {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  await BackgroundTask.registerTaskAsync(MONITOR_TASK, { minimumInterval: 15 });
  return true;
}

export async function unregisterMonitorTask() {
  if (await TaskManager.isTaskRegisteredAsync(MONITOR_TASK)) {
    await BackgroundTask.unregisterTaskAsync(MONITOR_TASK);
  }
}
