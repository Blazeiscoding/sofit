import { router } from 'expo-router';
import { View } from 'react-native';

import { BarChart, Hypnogram, StackBar } from '@/components/charts';
import { Ring } from '@/components/ring';
import { Button, Card, EmptyState, Row, SectionHeader, Screen, T } from '@/components/ui';
import { DateNav, StatTile, TileGrid } from '@/components/widgets';
import { Colors, Spacing } from '@/constants/theme';
import { getMainSleep, getScore, getSleepRange } from '@/db/repo';
import type { SleepStage } from '@/db/types';
import { addDays, formatClock, formatDuration, minutesOfDay, shortDay } from '@/lib/date';
import { useData, useSync } from '@/lib/hooks';
import { mean } from '@/lib/stats';
import { parseDetails } from '@/scores/compute';
import { useAppStore } from '@/store/settings';

export default function SleepScreen() {
  const date = useAppStore((s) => s.selectedDate);
  const { syncing, sync } = useSync();

  const data = useData(() => {
    const sleep = getMainSleep(date);
    const score = getScore(date);
    const twoWeeks = getSleepRange(addDays(date, -13), date);
    const naps = getSleepRange(date, date, false).filter((s) => !s.is_main);
    return {
      sleep,
      score,
      details: parseDetails(score?.details_json).sleep,
      stages: sleep?.stages_json ? (JSON.parse(sleep.stages_json) as SleepStage[]) : [],
      naps,
      chart: Array.from({ length: 14 }, (_, i) => {
        const d = addDays(date, i - 13);
        const night = twoWeeks.find((s) => s.date === d);
        return { label: i % 2 === 1 ? shortDay(d) : '', value: night?.minutes_asleep != null ? night.minutes_asleep / 60 : null };
      }),
      avgBed: mean(twoWeeks.map((s) => (minutesOfDay(s.start) + 720) % 1440)),
      avgWake: mean(twoWeeks.map((s) => minutesOfDay(s.end))),
    };
  });

  const { sleep, score, details, stages } = data;
  const perf = score?.sleep_perf ?? null;

  return (
    <Screen refreshing={syncing} onRefresh={() => sync()}>
      <DateNav title="Sleep" />
      {!sleep ? (
        <EmptyState
          icon="moon-outline"
          title="No sleep recorded"
          body="Wear your Fitbit Air to bed, then open the Google Health app so it syncs."
        />
      ) : (
        <>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.lg }}>
            <Ring size={110} stroke={10} progress={(perf ?? 0) / 100} color={Colors.sleep}>
              <T variant="title" style={{ fontSize: 26 }}>
                {perf != null ? `${perf}%` : '–'}
              </T>
              <T variant="caption" style={{ fontSize: 11 }}>
                performance
              </T>
            </Ring>
            <View style={{ flex: 1, gap: 6 }}>
              <T variant="label">Hours vs need</T>
              <T variant="metric">
                {formatDuration(sleep.minutes_asleep)}
                <T variant="caption"> / {formatDuration(score?.sleep_need)}</T>
              </T>
              <T variant="caption">
                {formatClock(minutesOfDay(sleep.start))} – {formatClock(minutesOfDay(sleep.end))}
              </T>
              {details?.debt ? <T variant="caption" color={Colors.recoveryMid}>Sleep debt {formatDuration(details.debt)}</T> : null}
            </View>
          </Card>

          {stages.length > 0 && (
            <>
              <SectionHeader title="Stages" />
              <Card style={{ gap: Spacing.md }}>
                <Hypnogram stages={stages} start={sleep.start} end={sleep.end} />
                <StackBar
                  parts={[
                    { value: sleep.awake ?? 0, color: Colors.stageAwake },
                    { value: sleep.rem ?? 0, color: Colors.stageRem },
                    { value: sleep.light ?? 0, color: Colors.stageLight },
                    { value: sleep.deep ?? 0, color: Colors.stageDeep },
                  ]}
                />
                <Row style={{ justifyContent: 'space-between' }}>
                  <StageStat label="Awake" minutes={sleep.awake} color={Colors.stageAwake} total={sleep.minutes_in_period} />
                  <StageStat label="REM" minutes={sleep.rem} color={Colors.stageRem} total={sleep.minutes_in_period} />
                  <StageStat label="Light" minutes={sleep.light} color={Colors.stageLight} total={sleep.minutes_in_period} />
                  <StageStat label="Deep" minutes={sleep.deep} color={Colors.stageDeep} total={sleep.minutes_in_period} />
                </Row>
              </Card>
            </>
          )}

          <SectionHeader title="Details" />
          <TileGrid>
            <StatTile label="Efficiency" value={details?.efficiency != null ? String(details.efficiency) : '–'} unit="%" />
            <StatTile label="Consistency" value={details?.consistency != null ? String(details.consistency) : '–'} unit="%" />
            <StatTile label="Fell asleep" value={sleep.latency != null ? String(sleep.latency) : '–'} unit="min" />
            <StatTile label="In bed" value={formatDuration(sleep.minutes_in_period)} />
            <StatTile label="Awake" value={formatDuration(sleep.minutes_awake)} />
            <StatTile label="Naps" value={data.naps.length ? formatDuration(data.naps.reduce((s, n) => s + (n.minutes_asleep ?? 0), 0)) : '–'} />
          </TileGrid>
        </>
      )}

      <SectionHeader title="Last 14 nights" />
      <Card style={{ gap: Spacing.sm }}>
        <BarChart data={data.chart} colors={(h) => (h >= 7 ? Colors.sleep : h >= 6 ? Colors.recoveryMid : Colors.recoveryLow)} format={(v) => v.toFixed(1)} />
        <T variant="caption">
          Average bedtime {data.avgBed != null ? formatClock(data.avgBed - 720) : '–'} · wake {data.avgWake != null ? formatClock(data.avgWake) : '–'}
        </T>
      </Card>

      <Button title="Plan tonight & alarms" kind="secondary" icon="alarm-outline" onPress={() => router.push('/alarm')} />
    </Screen>
  );
}

function StageStat({ label, minutes, color, total }: { label: string; minutes: number | null; color: string; total: number | null }) {
  const pct = minutes != null && total ? Math.round((minutes / total) * 100) : null;
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <T variant="caption">{label}</T>
      <T variant="heading" style={{ fontSize: 15 }}>
        {formatDuration(minutes)}
      </T>
      <T variant="caption" style={{ fontSize: 11 }}>
        {pct != null ? `${pct}%` : ''}
      </T>
    </View>
  );
}
