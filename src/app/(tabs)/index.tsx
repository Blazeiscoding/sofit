import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { type Brief, ensureMorningBrief, getCachedBrief } from '@/ai/brief';
import { BarChart } from '@/components/charts';
import { Markdown } from '@/components/markdown';
import { Ring } from '@/components/ring';
import { Card, IconButton, Row, SectionHeader, Screen, T } from '@/components/ui';
import { DateNav, StatTile, TileGrid } from '@/components/widgets';
import { Colors, recoveryColor, Spacing } from '@/constants/theme';
import { getDaily, getDailyRange, getMainSleep, getRecentAlerts, getScore, getScoresRange } from '@/db/repo';
import { addDays, formatDuration, relativeTime, shortDay, today } from '@/lib/date';
import { useData, useSync } from '@/lib/hooks';
import { getSecret, SecretKeys } from '@/lib/secrets';
import { mean, round } from '@/lib/stats';
import { parseDetails } from '@/scores/compute';
import { useAppStore } from '@/store/settings';
import { getLastSync, getStoredDevice } from '@/sync/syncEngine';

const FOREGROUND_SYNC_MIN_GAP = 10 * 60_000;

export default function Overview() {
  const date = useAppStore((s) => s.selectedDate);
  const { syncing, sync } = useSync();

  // Sync on open and whenever the app returns to the foreground, at most every 10 minutes.
  useEffect(() => {
    const maybeSync = () => {
      const last = getLastSync();
      if (!last || Date.now() - last.at > FOREGROUND_SYNC_MIN_GAP) sync({ quiet: true });
    };
    maybeSync();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && maybeSync());
    return () => sub.remove();
  }, [sync]);

  const data = useData(() => {
    const score = getScore(date);
    const day = getDaily(date);
    const history = getDailyRange(addDays(date, -30), addDays(date, -1));
    const week = getScoresRange(addDays(date, -6), date);
    return {
      score,
      details: parseDetails(score?.details_json),
      day,
      sleep: getMainSleep(date),
      base: {
        hrv: mean(history.map((h) => h.hrv)),
        rhr: mean(history.map((h) => h.rhr)),
        resp: mean(history.map((h) => h.resp)),
        spo2: mean(history.map((h) => h.spo2)),
        steps: mean(history.map((h) => h.steps)),
      },
      week: Array.from({ length: 7 }, (_, i) => {
        const d = addDays(date, i - 6);
        return { label: shortDay(d), value: week.find((w) => w.date === d)?.recovery ?? null };
      }),
      device: getStoredDevice(),
      lastSync: getLastSync(),
      alerts: getRecentAlerts(3).filter((a) => Date.now() - a.ts < 3 * 86_400_000),
    };
  });

  const { score, details, day, sleep, base } = data;
  const recovery = score?.recovery ?? null;
  const tempDev = day?.temp_nightly != null && day.temp_baseline != null ? day.temp_nightly - day.temp_baseline : null;

  return (
    <Screen refreshing={syncing} onRefresh={() => sync()}>
      <Row style={{ justifyContent: 'flex-end', marginBottom: -Spacing.sm }}>
        <IconButton icon="alarm-outline" onPress={() => router.push('/alarm')} />
        <IconButton icon="settings-outline" onPress={() => router.push('/settings')} />
      </Row>
      <DateNav title="Overview" />

      <Card style={{ paddingVertical: Spacing.lg }}>
        <View style={styles.rings}>
          <Pressable onPress={() => router.push('/sleep')} style={styles.ringCol}>
            <Ring size={92} stroke={8} progress={(score?.sleep_perf ?? 0) / 100} color={Colors.sleep}>
              <T variant="metric">{score?.sleep_perf != null ? `${score.sleep_perf}%` : '–'}</T>
            </Ring>
            <T variant="label">Sleep</T>
          </Pressable>
          <Pressable onPress={() => router.push({ pathname: '/metric/[key]', params: { key: 'recovery' } })} style={styles.ringCol}>
            <Ring size={128} stroke={11} progress={(recovery ?? 0) / 100} color={recoveryColor(recovery)}>
              <T variant="title" style={{ fontSize: 34 }} color={recoveryColor(recovery)}>
                {recovery != null ? `${recovery}%` : '–'}
              </T>
            </Ring>
            <T variant="label">Recovery</T>
          </Pressable>
          <Pressable onPress={() => router.push('/strain')} style={styles.ringCol}>
            <Ring size={92} stroke={8} progress={(score?.strain ?? 0) / 21} color={Colors.strain}>
              <T variant="metric">{score?.strain != null ? score.strain.toFixed(1) : '–'}</T>
            </Ring>
            <T variant="label">Strain</T>
          </Pressable>
        </View>
        <T variant="caption" style={{ textAlign: 'center', marginTop: Spacing.md }}>
          {recoveryCaption(recovery, details.recovery?.baselineDays ?? 0, details.recovery?.hrvZ ?? null)}
        </T>
      </Card>

      {date === today() && <BriefCard />}

      {data.alerts.map((a) => (
        <Card key={a.id} style={{ borderColor: Colors.recoveryMid, gap: 4 }}>
          <Row>
            <Ionicons name="warning-outline" size={16} color={Colors.recoveryMid} />
            <T variant="heading" style={{ fontSize: 15 }}>
              {a.title}
            </T>
          </Row>
          <T variant="caption">{a.body}</T>
        </Card>
      ))}

      <SectionHeader title="Vitals" right={<T variant="caption">vs 30-day average</T>} />
      <TileGrid>
        <StatTile label="HRV" value={day?.hrv != null ? String(Math.round(day.hrv)) : '–'} unit="ms" current={day?.hrv} baseline={base.hrv} metric="hrv" />
        <StatTile label="Resting HR" value={day?.rhr != null ? String(Math.round(day.rhr)) : '–'} unit="bpm" current={day?.rhr} baseline={base.rhr} goodWhen="down" metric="rhr" />
        <StatTile label="Breathing" value={day?.resp != null ? day.resp.toFixed(1) : '–'} unit="/min" current={day?.resp} baseline={base.resp} goodWhen="down" metric="resp" digits={1} />
        <StatTile label="SpO₂" value={day?.spo2 != null ? day.spo2.toFixed(1) : '–'} unit="%" current={day?.spo2} baseline={base.spo2} metric="spo2" digits={1} />
        <StatTile
          label="Skin temp"
          value={tempDev != null ? `${tempDev > 0 ? '+' : ''}${tempDev.toFixed(1)}` : '–'}
          unit="°C"
          goodWhen="neutral"
          metric="temp_nightly"
        />
        <StatTile label="VO₂ max" value={day?.vo2max != null ? String(round(day.vo2max, 1)) : '–'} unit="" metric="vo2max" />
      </TileGrid>

      <SectionHeader title="Activity" />
      <TileGrid>
        <StatTile label="Steps" value={day?.steps != null ? day.steps.toLocaleString() : '–'} current={day?.steps} baseline={base.steps} metric="steps" />
        <StatTile label="Calories" value={day?.calories != null ? Math.round(day.calories).toLocaleString() : '–'} unit="kcal" metric="calories" />
        <StatTile
          label="Zone min"
          value={day ? String((day.azm_fat ?? 0) + (day.azm_cardio ?? 0) + (day.azm_peak ?? 0)) : '–'}
          unit="AZM"
          metric="azm"
        />
      </TileGrid>

      <SectionHeader title="Last night" />
      <Card onPress={() => router.push('/sleep')}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <T variant="metric">{formatDuration(sleep?.minutes_asleep)}</T>
            <T variant="caption">asleep · need {formatDuration(score?.sleep_need)}</T>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
        </Row>
      </Card>

      <SectionHeader title="Recovery this week" />
      <Card>
        <BarChart data={data.week} colors={recoveryColor} max={100} />
      </Card>

      <DeviceCard device={data.device} lastSyncAt={data.lastSync?.at ?? null} errors={data.lastSync?.errors ?? []} syncing={syncing} />
    </Screen>
  );
}

function recoveryCaption(recovery: number | null, baselineDays: number, hrvZ: number | null): string {
  if (recovery == null) {
    return baselineDays < 4
      ? `Calibrating: recovery needs at least 4 nights of HRV (${baselineDays} so far).`
      : 'No HRV for this night yet. Wear the band to sleep and sync.';
  }
  const hrvNote = hrvZ == null ? '' : hrvZ > 0.5 ? ' HRV is above your baseline.' : hrvZ < -0.5 ? ' HRV is below your baseline.' : ' HRV is near your baseline.';
  if (recovery >= 67) return `You're primed for strain today.${hrvNote}`;
  if (recovery >= 34) return `Moderate recovery: train, but don't redline.${hrvNote}`;
  return `Low recovery: prioritise rest and sleep today.${hrvNote}`;
}

function BriefCard() {
  const profile = useAppStore((s) => s.profile);
  const settings = useAppStore((s) => s.settings);
  const bumpData = useAppStore((s) => s.bumpData);
  const brief = useData<Brief | null>(() => getCachedBrief());
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSecret(SecretKeys.openRouterKey).then((k) => setHasKey(!!k));
  }, []);

  if (!settings.morningBrief || hasKey === null) return null;

  const generate = async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const b = await ensureMorningBrief(profile, settings, true);
      if (!b) setError('Last night’s sleep hasn’t synced yet.');
      bumpData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={{ gap: Spacing.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={6}>
          <Ionicons name="sparkles" size={14} color={Colors.recoveryHigh} />
          <T variant="label">Morning brief</T>
        </Row>
        {hasKey && (
          <Pressable onPress={generate} disabled={loading} hitSlop={10}>
            <T variant="caption" color={Colors.text}>
              {loading ? 'Thinking…' : brief ? 'Refresh' : 'Generate'}
            </T>
          </Pressable>
        )}
      </Row>
      {!hasKey ? (
        <Pressable onPress={() => router.push('/settings')}>
          <T variant="caption">Add your OpenRouter key in Settings to get a daily AI brief.</T>
        </Pressable>
      ) : brief ? (
        <>
          <Markdown text={brief.text} />
          <T variant="caption" style={{ fontSize: 11 }}>
            {relativeTime(brief.at)}
          </T>
        </>
      ) : (
        <T variant="caption">{error ?? 'Generated after last night’s sleep syncs.'}</T>
      )}
      {brief && error ? <T variant="caption" color={Colors.danger}>{error}</T> : null}
    </Card>
  );
}

function DeviceCard({
  device,
  lastSyncAt,
  errors,
  syncing,
}: {
  device: ReturnType<typeof getStoredDevice>;
  lastSyncAt: number | null;
  errors: string[];
  syncing: boolean;
}) {
  const battery = device?.batteryLevel ?? null;
  const batteryIcon = battery == null ? 'battery-dead-outline' : battery > 60 ? 'battery-full' : battery > 20 ? 'battery-half' : 'battery-dead';
  return (
    <Card style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <Ionicons name="watch-outline" size={18} color={Colors.text} />
          <T variant="heading" style={{ fontSize: 15 }}>
            {device?.deviceVersion ?? 'Fitbit Air'}
          </T>
        </Row>
        <Row gap={4}>
          <Ionicons name={batteryIcon} size={18} color={battery != null && battery <= 20 ? Colors.danger : Colors.textSecondary} />
          <T variant="caption">{battery != null ? `${battery}%` : '–'}</T>
        </Row>
      </Row>
      <T variant="caption">
        Band synced {relativeTime(device?.lastSyncTime)} · App synced {syncing ? 'now…' : relativeTime(lastSyncAt)}
      </T>
      {errors.length > 0 && (
        <T variant="caption" color={Colors.recoveryMid} numberOfLines={2}>
          {errors.length} data type{errors.length > 1 ? 's' : ''} failed last sync: {errors[0]}
        </T>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  rings: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  ringCol: { alignItems: 'center', gap: 8 },
});
