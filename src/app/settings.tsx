import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { fetchModels, type ModelInfo } from '@/ai/openrouter';
import { signOut } from '@/api/auth';
import { ProfileForm } from '@/components/profile-form';
import { Button, Card, Chip, Divider, Row, SectionHeader, Screen, T } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { resetDatabase } from '@/db/db';
import { addDays, relativeTime, today } from '@/lib/date';
import { useSync } from '@/lib/hooks';
import { getSecret, SecretKeys, setSecret } from '@/lib/secrets';
import { MONITOR_TASK, registerMonitorTask, unregisterMonitorTask } from '@/monitor/backgroundTask';
import { recomputeScores } from '@/scores/compute';
import { type AlertSettings, DEFAULT_MODEL, useAppStore } from '@/store/settings';
import { getLastSync } from '@/sync/syncEngine';

const QUICK_MODELS = [DEFAULT_MODEL, 'deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4-flash', 'anthropic/claude-sonnet-5.5'];

export default function SettingsScreen() {
  const { profile, settings, setProfile, updateSettings, setSignedIn, bumpData } = useAppStore();
  const { syncing, sync } = useSync();
  const [editingProfile, setEditingProfile] = useState(false);

  return (
    <Screen>
      <SectionHeader title="Profile" />
      <Card style={{ gap: Spacing.sm }}>
        {editingProfile ? (
          <ProfileForm
            initial={profile}
            onSave={(p) => {
              setProfile(p);
              recomputeScores(addDays(today(), -89), today(), p);
              bumpData();
              setEditingProfile(false);
            }}
          />
        ) : (
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="body">
              {profile?.birthDate} · {profile?.sex} · {profile?.heightCm} cm · {profile?.weightKg} kg
            </T>
            <Pressable onPress={() => setEditingProfile(true)} hitSlop={10}>
              <T variant="caption" color={Colors.text}>
                Edit
              </T>
            </Pressable>
          </Row>
        )}
      </Card>

      <SectionHeader title="AI coach" />
      <AiSettings model={settings.aiModel} onModel={(aiModel) => updateSettings({ aiModel })} />
      <Card>
        <ToggleRow
          label="Morning brief"
          caption="Generate a short AI summary after last night’s sleep syncs"
          value={settings.morningBrief}
          onChange={(morningBrief) => updateSettings({ morningBrief })}
        />
      </Card>

      <SectionHeader title="Monitoring" />
      <MonitoringSettings alerts={settings.alerts} onChange={(alerts) => updateSettings({ alerts })} />

      <SectionHeader title="Data" />
      <Card style={{ gap: Spacing.sm }}>
        <T variant="caption">Last app sync {relativeTime(getLastSync()?.at)}</T>
        <Button title="Sync now" kind="secondary" loading={syncing} onPress={() => sync()} />
        <Button
          title="Re-download 90 days"
          kind="secondary"
          disabled={syncing}
          onPress={() => sync({ full: true })}
        />
        <Button
          title="Clear local data"
          kind="danger"
          onPress={() =>
            Alert.alert('Clear local data?', 'Deletes synced metrics, scores, alerts and chat from this phone. Your Google Health data is untouched.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Clear',
                style: 'destructive',
                onPress: () => {
                  resetDatabase();
                  bumpData();
                },
              },
            ])
          }
        />
        <Button
          title="Sign out of Google"
          kind="danger"
          onPress={() =>
            Alert.alert('Sign out?', 'You will need to sign in again to sync.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Sign out',
                style: 'destructive',
                onPress: async () => {
                  await signOut();
                  await unregisterMonitorTask().catch(() => {});
                  setSignedIn(false);
                },
              },
            ])
          }
        />
      </Card>
    </Screen>
  );
}

function AiSettings({ model, onModel }: { model: string; onModel: (m: string) => void }) {
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [query, setQuery] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    getSecret(SecretKeys.openRouterKey).then((k) => setHasKey(!!k));
  }, []);

  const matches = (models ?? []).filter((m) => m.id.toLowerCase().includes(query.toLowerCase())).slice(0, 12);

  return (
    <Card style={{ gap: Spacing.sm }}>
      <T variant="label">OpenRouter key</T>
      {hasKey ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="body">Saved in secure storage</T>
          <Pressable
            hitSlop={10}
            onPress={async () => {
              await setSecret(SecretKeys.openRouterKey, null);
              setHasKey(false);
            }}>
            <T variant="caption" color={Colors.danger}>
              Remove
            </T>
          </Pressable>
        </Row>
      ) : (
        <Row>
          <TextInput
            value={key}
            onChangeText={setKey}
            placeholder="sk-or-v1-…"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={[styles.input, { flex: 1 }]}
          />
          <Chip
            label="Save"
            active={key.trim().startsWith('sk-')}
            onPress={async () => {
              if (!key.trim().startsWith('sk-')) return;
              await setSecret(SecretKeys.openRouterKey, key.trim());
              setKey('');
              setHasKey(true);
            }}
          />
        </Row>
      )}
      <Divider />
      <T variant="label">Model</T>
      <T variant="body" style={{ fontWeight: '700' }}>
        {model}
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {QUICK_MODELS.map((m) => (
          <Chip key={m} label={m.split('/')[1]} active={m === model} onPress={() => onModel(m)} />
        ))}
      </View>
      <TextInput
        value={query}
        onChangeText={(q) => {
          setQuery(q);
          if (!models && !loadingModels) {
            setLoadingModels(true);
            fetchModels()
              .then(setModels)
              .catch(() => setModels([]))
              .finally(() => setLoadingModels(false));
          }
        }}
        placeholder="Search all OpenRouter models…"
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      {query.length > 0 &&
        (loadingModels ? (
          <T variant="caption">Loading models…</T>
        ) : (
          matches.map((m) => (
            <Pressable key={m.id} onPress={() => { onModel(m.id); setQuery(''); }} style={{ paddingVertical: 6 }}>
              <T variant="body">{m.id}</T>
              <T variant="caption">
                ${m.promptPrice.toFixed(2)}/M input · {Math.round(m.contextLength / 1000)}k context
              </T>
            </Pressable>
          ))
        ))}
    </Card>
  );
}

function MonitoringSettings({ alerts, onChange }: { alerts: AlertSettings; onChange: (a: AlertSettings) => void }) {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    TaskManager.isTaskRegisteredAsync(MONITOR_TASK).then(setRegistered);
    BackgroundTask.getStatusAsync().then((s) => setAvailable(s === BackgroundTask.BackgroundTaskStatus.Available));
  }, []);

  const set = (patch: Partial<AlertSettings>) => onChange({ ...alerts, ...patch });

  return (
    <Card style={{ gap: Spacing.sm }}>
      <ToggleRow
        label="Background monitoring"
        caption={
          !available
            ? 'Background tasks are restricted on this device.'
            : 'Syncs about every 15–30 min (the OS decides) and alerts you on unusual readings.'
        }
        value={!!registered && alerts.enabled}
        onChange={async (on) => {
          set({ enabled: on });
          if (on) setRegistered(await registerMonitorTask());
          else {
            await unregisterMonitorTask();
            setRegistered(false);
          }
        }}
      />
      <Divider />
      <Threshold label="Resting HR above baseline by" value={alerts.rhrRiseBpm} unit="bpm" step={1} onChange={(rhrRiseBpm) => set({ rhrRiseBpm })} />
      <Threshold label="HRV below baseline by" value={alerts.hrvDropSd} unit="SD" step={0.5} onChange={(hrvDropSd) => set({ hrvDropSd })} />
      <Threshold label="SpO₂ average below" value={alerts.spo2Min} unit="%" step={1} onChange={(spo2Min) => set({ spo2Min })} />
      <Threshold label="Breathing rate up by" value={alerts.respRise} unit="/min" step={0.5} onChange={(respRise) => set({ respRise })} />
      <Threshold label="Skin temp change of" value={alerts.tempDevC} unit="°C" step={0.1} onChange={(tempDevC) => set({ tempDevC })} />
      <Threshold label="Band battery at" value={alerts.batteryMin} unit="%" step={5} onChange={(batteryMin) => set({ batteryMin })} />
      <Threshold label="No band sync for" value={alerts.noSyncHours} unit="h" step={6} onChange={(noSyncHours) => set({ noSyncHours })} />
      {__DEV__ && (
        <Button
          title="Run background task now (debug)"
          kind="secondary"
          onPress={() => BackgroundTask.triggerTaskWorkerForTestingAsync()}
        />
      )}
    </Card>
  );
}

function ToggleRow({ label, caption, value, onChange }: { label: string; caption?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="body">{label}</T>
        {caption ? <T variant="caption">{caption}</T> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: Colors.recoveryHigh }} />
    </Row>
  );
}

function Threshold({ label, value, unit, step, onChange }: { label: string; value: number; unit: string; step: number; onChange: (v: number) => void }) {
  const fmt = (v: number) => (step < 1 ? v.toFixed(1) : String(v));
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <T variant="caption" style={{ flex: 1 }}>
        {label}
      </T>
      <Row gap={6}>
        <Chip label="−" onPress={() => onChange(Math.max(0, Math.round((value - step) * 10) / 10))} />
        <T variant="body" style={{ minWidth: 64, textAlign: 'center', fontWeight: '700' }}>
          {fmt(value)} {unit}
        </T>
        <Chip label="+" onPress={() => onChange(Math.round((value + step) * 10) / 10)} />
      </Row>
    </Row>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: Colors.cardRaised,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Colors.text,
    fontSize: 15,
  },
});
