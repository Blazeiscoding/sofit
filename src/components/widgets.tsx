import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { addDays, friendlyDate, today } from '@/lib/date';
import { useAppStore } from '@/store/settings';

import { IconButton, Row, T } from './ui';

/** Day switcher shared by the Overview, Sleep and Strain tabs. */
export function DateNav({ title }: { title: string }) {
  const date = useAppStore((s) => s.selectedDate);
  const setDate = useAppStore((s) => s.setSelectedDate);
  const isToday = date >= today();
  return (
    <View style={styles.dateNav}>
      <T variant="title">{title}</T>
      <Row gap={4}>
        <IconButton icon="chevron-back" size={18} onPress={() => setDate(addDays(date, -1))} />
        <Pressable onPress={() => setDate(today())} style={styles.datePill}>
          <T variant="caption" color={Colors.text} style={{ fontWeight: '700' }}>
            {friendlyDate(date)}
          </T>
        </Pressable>
        <IconButton
          icon="chevron-forward"
          size={18}
          color={isToday ? Colors.textMuted : Colors.text}
          onPress={() => !isToday && setDate(addDays(date, 1))}
        />
      </Row>
    </View>
  );
}

export type Trend = 'up' | 'down' | 'flat';

/**
 * Metric tile with the change against a baseline. `goodWhen` sets whether a rise is
 * green (HRV) or red (resting HR).
 */
export function StatTile({
  label,
  value,
  unit,
  baseline,
  current,
  goodWhen = 'up',
  metric,
  digits = 0,
}: {
  label: string;
  value: string;
  unit?: string;
  baseline?: number | null;
  current?: number | null;
  goodWhen?: 'up' | 'down' | 'neutral';
  metric?: string;
  digits?: number;
}) {
  let delta: number | null = null;
  if (baseline != null && current != null) delta = current - baseline;
  const threshold = 10 ** -digits / 2;
  const trend: Trend = delta == null || Math.abs(delta) < threshold ? 'flat' : delta > 0 ? 'up' : 'down';
  const good = goodWhen === 'neutral' || trend === 'flat' ? null : (trend === 'up') === (goodWhen === 'up');
  const color = good == null ? Colors.textSecondary : good ? Colors.recoveryHigh : Colors.recoveryLow;

  return (
    <Pressable
      disabled={!metric}
      onPress={() => metric && router.push({ pathname: '/metric/[key]', params: { key: metric } })}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}>
      <T variant="label" numberOfLines={1}>
        {label}
      </T>
      <Row gap={4} style={{ alignItems: 'baseline', marginTop: 6 }}>
        <T variant="metric">{value}</T>
        {unit ? <T variant="caption">{unit}</T> : null}
      </Row>
      {delta != null && (
        <Row gap={2} style={{ marginTop: 2 }}>
          <Ionicons
            name={trend === 'up' ? 'arrow-up' : trend === 'down' ? 'arrow-down' : 'remove'}
            size={12}
            color={color}
          />
          <T variant="caption" color={color} style={{ fontSize: 12 }}>
            {Math.abs(delta).toFixed(digits)} vs 30d
          </T>
        </Row>
      )}
    </Pressable>
  );
}

export function TileGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  dateNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  datePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.card,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: {
    flexBasis: '31%',
    flexGrow: 1,
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
});
