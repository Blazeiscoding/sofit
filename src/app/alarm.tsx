import Ionicons from '@expo/vector-icons/Ionicons';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import {
  type Alarm,
  type BedtimeReminder,
  deleteAlarm,
  loadAlarms,
  loadBedtimeReminder,
  openGoogleHealthApp,
  saveAlarm,
  saveBedtimeReminder,
  suggestedBedtime,
  tonightSleepNeed,
} from '@/alarm/alarms';
import { Button, Card, Chip, IconButton, Row, SectionHeader, Screen, T } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatClock, formatDuration } from '@/lib/date';
import { ensureNotificationPermission } from '@/lib/notifications';
import { useAppStore } from '@/store/settings';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Next enabled alarm's wake time in minutes of day, or 7:00 by default. */
function nextWakeMinutes(alarms: Alarm[]): number {
  const enabled = alarms.filter((a) => a.enabled);
  if (!enabled.length) return 7 * 60;
  const tomorrow = ((new Date().getDay() + 1) % 7) + 1;
  const forTomorrow = enabled.find((a) => !a.weekdays.length || a.weekdays.includes(tomorrow)) ?? enabled[0];
  return forTomorrow.hour * 60 + forTomorrow.minute;
}

export default function AlarmScreen() {
  const profile = useAppStore((s) => s.profile)!;
  const [alarms, setAlarms] = useState<Alarm[]>(loadAlarms);
  const [reminder, setReminder] = useState<BedtimeReminder>(loadBedtimeReminder);
  const [editing, setEditing] = useState<Alarm | null>(null);
  const [exactOk, setExactOk] = useState(true);

  const plan = tonightSleepNeed(profile);
  const wake = nextWakeMinutes(alarms);
  const bedtime = suggestedBedtime(wake, plan.need);

  useEffect(() => {
    if (Platform.OS === 'android') {
      Notifications.getExactAlarmPermissionsAsync()
        .then((p) => setExactOk(p.granted))
        .catch(() => {});
    }
  }, []);

  const persist = async (alarm: Alarm) => {
    if (!(await ensureNotificationPermission())) {
      Alert.alert('Notifications are off', 'Allow notifications for SoFit so alarms can ring.');
      return;
    }
    setAlarms(await saveAlarm(alarm));
  };

  const newAlarm = (): Alarm => ({
    id: String(Date.now()),
    hour: Math.floor(wake / 60),
    minute: wake % 60,
    weekdays: [2, 3, 4, 5, 6],
    enabled: true,
    label: 'Wake up',
    notificationIds: [],
  });

  const setBedtimeReminder = async (enabled: boolean) => {
    if (enabled && !(await ensureNotificationPermission())) return;
    const at = (bedtime - 30 + 1440) % 1440;
    setReminder(await saveBedtimeReminder({ ...reminder, enabled, hour: Math.floor(at / 60), minute: at % 60 }));
  };

  return (
    <Screen>
      <Card style={{ gap: Spacing.sm }}>
        <T variant="label">Tonight’s plan</T>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <T variant="caption">Go to bed by</T>
            <T variant="title" color={Colors.sleep}>
              {formatClock(bedtime)}
            </T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T variant="caption">Wake</T>
            <T variant="title">{formatClock(wake)}</T>
          </View>
        </Row>
        <T variant="caption">
          Sleep need {formatDuration(plan.need)}
          {plan.debt ? ` (includes ${formatDuration(Math.round(plan.debt / 3))} of debt repayment)` : ''}
          {plan.strain != null && plan.strain > 8 ? `, raised for today’s strain of ${plan.strain.toFixed(1)}` : ''}. Allows 15 min to fall asleep.
        </T>
        <Row style={{ justifyContent: 'space-between', marginTop: Spacing.xs }}>
          <T variant="body">Remind me 30 min before</T>
          <Switch value={reminder.enabled} onValueChange={setBedtimeReminder} trackColor={{ true: Colors.sleep }} />
        </Row>
        {reminder.enabled && (
          <T variant="caption">Daily reminder at {formatClock(reminder.hour * 60 + reminder.minute)}. Toggle again to update it to tonight’s plan.</T>
        )}
      </Card>

      {!exactOk && (
        <Card style={{ borderColor: Colors.recoveryMid, gap: Spacing.sm }}>
          <T variant="body" color={Colors.recoveryMid}>
            Android is delaying alarms. Allow “Alarms & reminders” for SoFit so they ring on time.
          </T>
          <Button
            title="Open setting"
            kind="secondary"
            onPress={async () => {
              const res = await Notifications.requestExactAlarmPermissionsAsync().catch(() => null);
              if (res?.granted) {
                setExactOk(true);
                for (const a of alarms) await saveAlarm(a);
              }
            }}
          />
        </Card>
      )}

      <SectionHeader title="Phone alarms" right={<IconButton icon="add" size={20} onPress={() => setEditing(newAlarm())} />} />
      {alarms.length === 0 && !editing && (
        <Card>
          <T variant="caption">No alarms yet. Tap + to add one. It starts at your planned wake time.</T>
        </Card>
      )}
      {alarms.map((a) =>
        editing?.id === a.id ? null : (
          <Card key={a.id} onPress={() => setEditing(a)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <T variant="title" color={a.enabled ? Colors.text : Colors.textMuted}>
                  {formatClock(a.hour * 60 + a.minute)}
                </T>
                <T variant="caption">
                  {a.label} · {a.weekdays.length ? (a.weekdays.length === 7 ? 'Every day' : a.weekdays.map((d) => WEEKDAYS[d - 1]).join(' ')) : 'Once'}
                </T>
              </View>
              <Switch value={a.enabled} onValueChange={(enabled) => persist({ ...a, enabled })} trackColor={{ true: Colors.recoveryHigh }} />
            </Row>
          </Card>
        ),
      )}
      {editing && (
        <AlarmEditor
          alarm={editing}
          onCancel={() => setEditing(null)}
          onSave={async (a) => {
            await persist(a);
            setEditing(null);
          }}
          onDelete={async () => {
            setAlarms(await deleteAlarm(editing.id));
            setEditing(null);
          }}
        />
      )}

      <SectionHeader title="Band Smart Wake" />
      <Card style={{ gap: Spacing.sm }}>
        <T variant="caption">
          Google doesn’t let other apps set alarms on the Fitbit Air. To get the silent wrist vibration that wakes you in
          light sleep (up to 30 min early), set Smart Wake in the Google Health app to {formatClock(wake)}. The phone
          alarm above is your backup.
        </T>
        <Button title="Open Google Health" kind="secondary" icon="open-outline" onPress={() => openGoogleHealthApp()} />
      </Card>
    </Screen>
  );
}

function AlarmEditor({
  alarm,
  onSave,
  onCancel,
  onDelete,
}: {
  alarm: Alarm;
  onSave: (a: Alarm) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [a, setA] = useState(alarm);
  const shift = (minutes: number) => {
    const total = (((a.hour * 60 + a.minute + minutes) % 1440) + 1440) % 1440;
    setA({ ...a, hour: Math.floor(total / 60), minute: total % 60 });
  };
  const toggleDay = (d: number) =>
    setA({ ...a, weekdays: a.weekdays.includes(d) ? a.weekdays.filter((x) => x !== d) : [...a.weekdays, d].sort() });

  return (
    <Card style={{ gap: Spacing.md, borderColor: Colors.textMuted }}>
      <Row style={{ justifyContent: 'center', gap: Spacing.md }}>
        <Stepper label="−1h" onPress={() => shift(-60)} />
        <Stepper label="−5" onPress={() => shift(-5)} />
        <T variant="title" style={{ minWidth: 120, textAlign: 'center' }}>
          {formatClock(a.hour * 60 + a.minute)}
        </T>
        <Stepper label="+5" onPress={() => shift(5)} />
        <Stepper label="+1h" onPress={() => shift(60)} />
      </Row>
      <Row style={{ justifyContent: 'center' }}>
        {WEEKDAYS.map((d, i) => (
          <Chip key={i} label={d} active={a.weekdays.includes(i + 1)} onPress={() => toggleDay(i + 1)} />
        ))}
      </Row>
      <T variant="caption" style={{ textAlign: 'center' }}>
        {a.weekdays.length ? 'Repeats on selected days' : 'No days selected: rings once'}
      </T>
      <Row>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" kind="secondary" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Save" onPress={() => onSave({ ...a, enabled: true })} />
        </View>
      </Row>
      {alarm.notificationIds.length > 0 || loadAlarms().some((x) => x.id === alarm.id) ? (
        <Pressable onPress={onDelete} style={{ alignSelf: 'center' }}>
          <Row gap={4}>
            <Ionicons name="trash-outline" size={14} color={Colors.danger} />
            <T variant="caption" color={Colors.danger}>
              Delete alarm
            </T>
          </Row>
        </Pressable>
      ) : null}
    </Card>
  );
}

function Stepper({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.stepper, pressed && { opacity: 0.6 }]}>
      <T variant="caption" color={Colors.text} style={{ fontWeight: '700' }}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stepper: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    backgroundColor: Colors.cardRaised,
  },
});
