// Registers the background monitor task at module scope, before any UI mounts.
import '@/monitor/backgroundTask';

import * as Notifications from 'expo-notifications';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { snooze } from '@/alarm/alarms';
import { isSignedIn } from '@/api/auth';
import { Colors } from '@/constants/theme';
import { getDb } from '@/db/db';
import { configureNotifications } from '@/lib/notifications';
import { seedOpenRouterKeyFromEnv } from '@/lib/secrets';
import { useAppStore } from '@/store/settings';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: Colors.background, card: Colors.card, primary: Colors.text },
};

export default function RootLayout() {
  const hydrated = useAppStore((s) => s.hydrated);
  const ready = useAppStore((s) => s.signedIn && s.profile != null);

  useEffect(() => {
    getDb();
    configureNotifications().catch(() => {});
    seedOpenRouterKeyFromEnv()
      .catch(() => {})
      .then(isSignedIn)
      .then((signedIn) => useAppStore.getState().hydrate(signedIn))
      .finally(() => SplashScreen.hideAsync());

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const { actionIdentifier, notification } = response;
      const data = notification.request.content.data as { kind?: string; alarmId?: string };
      if (data?.kind !== 'alarm') return;
      if (actionIdentifier === 'snooze') snooze(data.alarmId).catch(() => {});
      Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => {});
    });
    return () => sub.remove();
  }, []);

  if (!hydrated) return null;

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
        <Stack.Protected guard={ready} redirectTo="/onboarding">
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="settings"
            options={{ headerShown: true, title: 'Settings', headerStyle: { backgroundColor: Colors.background } }}
          />
          <Stack.Screen
            name="alarm"
            options={{ headerShown: true, title: 'Alarms & sleep plan', headerStyle: { backgroundColor: Colors.background } }}
          />
          <Stack.Screen
            name="metric/[key]"
            options={{ headerShown: true, title: '', headerStyle: { backgroundColor: Colors.background } }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!ready} redirectTo="/">
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
