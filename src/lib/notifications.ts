import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { Platform } from 'react-native';

export const Channels = {
  alarm: 'alarm',
  health: 'health',
  reminders: 'reminders',
} as const;

export const ALARM_CATEGORY = 'alarm';

let configured = false;

/** Channels, categories and the foreground handler. Safe to call more than once. */
export async function configureNotifications() {
  if (configured) return;
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(Channels.alarm, {
      name: 'Alarms',
      // No `sound` here: channel sounds must be bundled files; omitting it uses the system default.
      importance: AndroidImportance.MAX,
      vibrationPattern: [0, 800, 400, 800, 400, 800],
      bypassDnd: true,
      lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync(Channels.health, {
      name: 'Health alerts',
      importance: AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(Channels.reminders, {
      name: 'Bedtime reminders',
      importance: AndroidImportance.DEFAULT,
    });
  }

  await Notifications.setNotificationCategoryAsync(ALARM_CATEGORY, [
    { identifier: 'snooze', buttonTitle: 'Snooze 9 min', options: { opensAppToForeground: false } },
    { identifier: 'dismiss', buttonTitle: 'Dismiss', options: { opensAppToForeground: false, isDestructive: true } },
  ]);
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const res = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return res.granted;
}

export async function notifyNow(title: string, body: string, channelId: string = Channels.health) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: Platform.OS === 'android' ? { channelId } : null,
  });
}
