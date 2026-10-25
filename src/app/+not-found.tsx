import { router, usePathname } from 'expo-router';

import { Button, Screen, T } from '@/components/ui';
import { Colors } from '@/constants/theme';

export default function NotFound() {
  const path = usePathname();
  return (
    <Screen>
      <T variant="title">Page not found</T>
      <T variant="body" color={Colors.textSecondary}>
        The app tried to open “{path}”, which doesn’t exist.
      </T>
      <Button title="Go home" onPress={() => router.replace('/')} />
    </Screen>
  );
}
