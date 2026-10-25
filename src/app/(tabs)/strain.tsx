import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { BarChart, LineChart, StackBar } from '@/components/charts';
import { Ring } from '@/components/ring';
import { Card, Row, SectionHeader, Screen, T } from '@/components/ui';
import { DateNav, StatTile, TileGrid } from '@/components/widgets';
import { Colors, Spacing } from '@/constants/theme';
import { getDaily, getHrMinutes, getScore, getScoresRange, getWorkoutsRange } from '@/db/repo';
import { addDays, formatClock, formatDuration, minutesOfDay, parseIsoDate, shortDay } from '@/lib/date';
import { useData, useSync } from '@/lib/hooks';
import { parseDetails } from '@/scores/compute';
import { useAppStore } from '@/store/settings';

const ZONE_COLORS = ['#5B6B7F', '#21D4B4', '#0093E7', '#F5A524', '#FF4D5E'];
const ZONE_NAMES = ['Z1 50–60%', 'Z2 60–70%', 'Z3 70–80%', 'Z4 80–90%', 'Z5 90%+'];

export default function StrainScreen() {
  const date = useAppStore((s) => s.selectedDate);
  const { syncing, sync } = useSync();

  const data = useData(() => {
    const score = getScore(date);
    const start = parseIsoDate(date).getTime() / 1000;
    const minutes = getHrMinutes(start, start + 86400);
    // Five-minute averages keep the chart readable.
    const buckets: { label: string; value: number | null }[] = [];
    for (let t = start; t < start + 86400; t += 300) {
      const inBucket = minutes.filter((m) => m.ts >= t && m.ts < t + 300);
      const hour = Math.floor((t - start) / 3600);
      buckets.push({
        label: (t - start) % (6 * 3600) === 0 ? `${hour}h` : '',
        value: inBucket.length ? inBucket.reduce((s, m) => s + m.bpm, 0) / inBucket.length : null,
      });
    }
    const lastData = buckets.map((b) => b.value).findLastIndex((v) => v != null);
    const scores = getScoresRange(addDays(date, -13), date);
    return {
      score,
      details: parseDetails(score?.details_json).strain,
      day: getDaily(date),
      hr: lastData >= 0 ? buckets.slice(0, lastData + 1) : [],
      maxBpm: minutes.length ? Math.max(...minutes.map((m) => m.bpm_max ?? m.bpm)) : null,
      workouts: getWorkoutsRange(date, date),
      chart: Array.from({ length: 14 }, (_, i) => {
        const d = addDays(date, i - 13);
        return { label: i % 2 === 1 ? shortDay(d) : '', value: scores.find((s) => s.date === d)?.strain ?? null };
      }),
    };
  });

  const { score, details, day } = data;
  const strain = score?.strain ?? null;
  const zoneTotal = details?.zoneMinutes.reduce((a, b) => a + b, 0) ?? 0;

  return (
    <Screen refreshing={syncing} onRefresh={() => sync()}>
      <DateNav title="Strain" />
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.lg }}>
        <Ring size={110} stroke={10} progress={(strain ?? 0) / 21} color={Colors.strain}>
          <T variant="title" style={{ fontSize: 30 }}>
            {strain != null ? strain.toFixed(1) : '–'}
          </T>
        </Ring>
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="label">Day strain</T>
          <T variant="heading">{strainLabel(strain)}</T>
          <T variant="caption">
            {details?.source === 'estimated'
              ? 'Estimated from zone minutes and steps (minute-level heart rate covers only the last 14 days).'
              : details
                ? `From ${zoneTotal} minutes above 50% of max HR (${details.maxHr} bpm).`
                : 'No activity data yet.'}
          </T>
        </View>
      </Card>

      {details?.source === 'heart-rate' && zoneTotal > 0 && (
        <>
          <SectionHeader title="Heart-rate zones" />
          <Card style={{ gap: Spacing.sm }}>
            <StackBar parts={details.zoneMinutes.map((v, i) => ({ value: v, color: ZONE_COLORS[i] }))} />
            {details.zoneMinutes.map((m, i) => (
              <Row key={i} style={{ justifyContent: 'space-between' }}>
                <Row gap={6}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ZONE_COLORS[i] }} />
                  <T variant="caption">{ZONE_NAMES[i]}</T>
                </Row>
                <T variant="body">{formatDuration(m)}</T>
              </Row>
            ))}
          </Card>
        </>
      )}

      {data.hr.length > 0 && (
        <>
          <SectionHeader title="Heart rate" right={data.maxBpm ? <T variant="caption">max {Math.round(data.maxBpm)} bpm</T> : null} />
          <Card>
            <LineChart data={data.hr} color={Colors.danger} height={150} baseline={day?.rhr ?? null} />
          </Card>
        </>
      )}

      <SectionHeader title="Activity" />
      <TileGrid>
        <StatTile label="Steps" value={day?.steps != null ? day.steps.toLocaleString() : '–'} metric="steps" />
        <StatTile label="Calories" value={day?.calories != null ? Math.round(day.calories).toLocaleString() : '–'} unit="kcal" metric="calories" />
        <StatTile label="Distance" value={day?.distance_m != null ? (day.distance_m / 1000).toFixed(1) : '–'} unit="km" />
        <StatTile label="Fat burn" value={String(day?.azm_fat ?? '–')} unit="AZM" />
        <StatTile label="Cardio" value={String(day?.azm_cardio ?? '–')} unit="AZM" />
        <StatTile label="Peak" value={String(day?.azm_peak ?? '–')} unit="AZM" />
      </TileGrid>

      <SectionHeader title="Workouts" />
      {data.workouts.length === 0 ? (
        <Card>
          <T variant="caption">No workouts recorded on this day.</T>
        </Card>
      ) : (
        data.workouts.map((w) => (
          <Card key={w.id} style={{ gap: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row>
                <Ionicons name="fitness-outline" size={18} color={Colors.strain} />
                <T variant="heading" style={{ fontSize: 15 }}>
                  {w.name ?? prettyType(w.type)}
                </T>
              </Row>
              <T variant="caption">{formatClock(minutesOfDay(w.start))}</T>
            </Row>
            <T variant="caption">
              {formatDuration(w.duration_s != null ? w.duration_s / 60 : null)}
              {w.avg_hr ? ` · avg ${Math.round(w.avg_hr)} bpm` : ''}
              {w.calories ? ` · ${Math.round(w.calories)} kcal` : ''}
              {w.distance_m ? ` · ${(w.distance_m / 1000).toFixed(2)} km` : ''}
              {w.azm ? ` · ${w.azm} AZM` : ''}
            </T>
          </Card>
        ))
      )}

      <SectionHeader title="Last 14 days" />
      <Card>
        <BarChart data={data.chart} colors={Colors.strain} max={21} format={(v) => v.toFixed(0)} />
      </Card>
    </Screen>
  );
}

function strainLabel(strain: number | null): string {
  if (strain == null) return '–';
  if (strain < 8) return 'Light';
  if (strain < 14) return 'Moderate';
  if (strain < 18) return 'Strenuous';
  return 'All out';
}

function prettyType(type: string | null): string {
  if (!type) return 'Workout';
  return type
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
