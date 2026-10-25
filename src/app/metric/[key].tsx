import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { LineChart } from '@/components/charts';
import { Card, Chip, Row, Screen, T } from '@/components/ui';
import { StatTile, TileGrid } from '@/components/widgets';
import { Colors, Spacing } from '@/constants/theme';
import { getDailyRange, getScoresRange } from '@/db/repo';
import type { DailyRow, ScoreRow } from '@/db/types';
import { addDays, parseIsoDate, today } from '@/lib/date';
import { useData } from '@/lib/hooks';
import { mean, present, round } from '@/lib/stats';

type MetricDef = {
  title: string;
  unit: string;
  color: string;
  digits: number;
  about: string;
  value: (d: DailyRow | undefined, s: ScoreRow | undefined) => number | null | undefined;
};

const METRICS: Record<string, MetricDef> = {
  recovery: { title: 'Recovery', unit: '%', color: Colors.recoveryHigh, digits: 0, about: 'HRV, resting HR, breathing rate, sleep and skin temperature against your 30-day baseline.', value: (_, s) => s?.recovery },
  strain: { title: 'Strain', unit: '', color: Colors.strain, digits: 1, about: 'Cardiovascular load on a 0–21 scale.', value: (_, s) => s?.strain },
  sleep_perf: { title: 'Sleep performance', unit: '%', color: Colors.sleep, digits: 0, about: 'Hours asleep as a share of what you needed.', value: (_, s) => s?.sleep_perf },
  hrv: { title: 'Heart rate variability', unit: 'ms', color: Colors.hrv, digits: 0, about: 'Average RMSSD during sleep. Higher than your baseline usually means you are well recovered.', value: (d) => d?.hrv },
  rhr: { title: 'Resting heart rate', unit: 'bpm', color: Colors.danger, digits: 0, about: 'Lower is generally better. A jump of 5+ bpm can signal illness, stress or alcohol.', value: (d) => d?.rhr },
  resp: { title: 'Breathing rate', unit: '/min', color: Colors.sleep, digits: 1, about: 'Average breaths per minute during sleep. Very stable night to night; a rise often precedes illness.', value: (d) => d?.resp },
  spo2: { title: 'Blood oxygen (SpO₂)', unit: '%', color: Colors.strain, digits: 1, about: 'Average overnight oxygen saturation. 95–100% is typical.', value: (d) => d?.spo2 },
  temp_nightly: { title: 'Skin temperature', unit: '°C', color: Colors.age, digits: 2, about: 'Nightly skin temperature deviation from your baseline.', value: (d) => (d?.temp_nightly != null && d.temp_baseline != null ? d.temp_nightly - d.temp_baseline : null) },
  vo2max: { title: 'VO₂ max', unit: 'ml/kg/min', color: Colors.recoveryHigh, digits: 1, about: 'Cardio fitness estimate. The single strongest factor in SoFit Age.', value: (d) => d?.vo2max },
  steps: { title: 'Steps', unit: '', color: Colors.strain, digits: 0, about: 'Total steps per day.', value: (d) => d?.steps },
  calories: { title: 'Calories', unit: 'kcal', color: Colors.age, digits: 0, about: 'Total calories burned, including BMR.', value: (d) => d?.calories },
  azm: { title: 'Active Zone Minutes', unit: '', color: Colors.recoveryMid, digits: 0, about: 'Fat burn minutes count once; cardio and peak minutes count double.', value: (d) => (d ? (d.azm_fat ?? 0) + (d.azm_cardio ?? 0) + (d.azm_peak ?? 0) : null) },
};

const RANGES = [7, 30, 90];

export default function MetricScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const def = METRICS[key] ?? METRICS.recovery;
  const [days, setDays] = useState(30);

  const series = useData(() => {
    const from = addDays(today(), -(days - 1));
    const daily = getDailyRange(from, today());
    const scores = getScoresRange(from, today());
    return Array.from({ length: days }, (_, i) => {
      const date = addDays(from, i);
      const v = def.value(
        daily.find((d) => d.date === date),
        scores.find((s) => s.date === date),
      );
      const label = parseIsoDate(date).toLocaleDateString(undefined, days <= 7 ? { weekday: 'short' } : { month: 'numeric', day: 'numeric' });
      return { label, value: v ?? null };
    });
  });

  const values = present(series.map((s) => s.value));
  const latest = [...series].reverse().find((s) => s.value != null)?.value ?? null;
  const avg = mean(values);
  const fmt = (v: number | null) => (v == null ? '–' : (round(v, def.digits) ?? 0).toLocaleString());

  return (
    <Screen>
      <Stack.Screen options={{ title: def.title }} />
      <Row>
        {RANGES.map((r) => (
          <Chip key={r} label={`${r}D`} active={days === r} onPress={() => setDays(r)} />
        ))}
      </Row>
      <Card>
        <LineChart data={series} color={def.color} height={200} baseline={avg} format={(v) => fmt(v)} />
      </Card>
      <TileGrid>
        <StatTile label="Latest" value={fmt(latest)} unit={def.unit} />
        <StatTile label="Average" value={fmt(avg)} unit={def.unit} />
        <StatTile label="Range" value={values.length ? `${fmt(Math.min(...values))}–${fmt(Math.max(...values))}` : '–'} />
      </TileGrid>
      <Card style={{ gap: Spacing.xs }}>
        <T variant="label">About</T>
        <T variant="body" color={Colors.textSecondary}>
          {def.about}
        </T>
      </Card>
    </Screen>
  );
}
