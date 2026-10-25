import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthRequiredError, signOut, useGoogleSignIn } from '@/api/auth';
import { getIdentity, HealthApiError } from '@/api/googleHealth';
import { ProfileForm } from '@/components/profile-form';
import { Button, Card, T } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { kvSet } from '@/db/repo';
import { ensureNotificationPermission } from '@/lib/notifications';
import { getSecret, SecretKeys, setSecret } from '@/lib/secrets';
import { registerMonitorTask, runMonitorChecks } from '@/monitor/backgroundTask';
import { type Profile, useAppStore } from '@/store/settings';
import { syncAll } from '@/sync/syncEngine';

type Step = 'connect' | 'profile' | 'ai' | 'sync';

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const signedIn = useAppStore((s) => s.signedIn);
  const existingProfile = useAppStore((s) => s.profile);
  const [step, setStep] = useState<Step>(signedIn ? (existingProfile ? 'sync' : 'profile') : 'connect');
  const [profile, setProfile] = useState<Profile | null>(existingProfile);
  const backToConnect = useCallback(() => setStep('connect'), []);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: Colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: Spacing.lg, paddingTop: insets.top + Spacing.xl, gap: Spacing.lg, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled">
        <View style={{ gap: 6 }}>
          <T variant="label" color={Colors.recoveryHigh}>
            SoFit
          </T>
          <T variant="title">
            {step === 'connect' && 'Connect your Fitbit Air'}
            {step === 'profile' && 'About you'}
            {step === 'ai' && 'AI coach'}
            {step === 'sync' && 'Pulling your history'}
          </T>
        </View>
        {step === 'connect' && <ConnectStep onDone={() => setStep(existingProfile ? 'sync' : 'profile')} />}
        {step === 'profile' && (
          <>
            <T variant="caption">Used for heart-rate zones, VO₂ max norms, sleep need and your SoFit Age.</T>
            <ProfileForm
              initial={profile}
              saveLabel="Continue"
              onSave={(p) => {
                setProfile(p);
                // Skip the key step when a key is already stored (e.g. seeded from .env).
                getSecret(SecretKeys.openRouterKey).then((k) => setStep(k ? 'sync' : 'ai'));
              }}
            />
          </>
        )}
        {step === 'ai' && <AiStep onDone={() => setStep('sync')} />}
        {step === 'sync' && profile && <SyncStep profile={profile} onAuthLost={backToConnect} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ConnectStep({ onDone }: { onDone: () => void }) {
  const { ready, configured, status, error, signIn } = useGoogleSignIn();
  const setSignedIn = useAppStore((s) => s.setSignedIn);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const verified = useRef(false);

  useEffect(() => {
    if (status !== 'done' || verified.current) return;
    verified.current = true;
    setChecking(true);
    getIdentity()
      .then(() => {
        setSignedIn(true);
        onDone();
      })
      .catch(async (e) => {
        if (e instanceof HealthApiError && e.reason === 'ACCOUNT_NOT_LINKED') {
          setCheckError(
            'Your Google Account isn’t linked to Google Health yet. Open the Google Health app, finish its setup with this account, then try again.',
          );
        } else {
          setCheckError((e as Error).message);
        }
        verified.current = false;
        await signOut();
      })
      .finally(() => setChecking(false));
  }, [status, onDone, setSignedIn]);

  return (
    <View style={{ gap: Spacing.md }}>
      <T variant="body" color={Colors.textSecondary}>
        SoFit reads your band’s data from Google Health: heart rate, HRV, sleep stages, SpO₂, breathing rate, skin
        temperature, VO₂ max, steps and workouts. Read-only; nothing is written back.
      </T>
      <Card style={{ gap: 10 }}>
        {[
          ['pulse', 'Recovery, Strain and Sleep scores'],
          ['hourglass-outline', 'SoFit Age: your biological age estimate'],
          ['sparkles-outline', 'AI coach on your OpenRouter key'],
          ['notifications-outline', 'Background alerts and smart phone alarms'],
        ].map(([icon, text]) => (
          <View key={text} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Ionicons name={icon as 'pulse'} size={18} color={Colors.recoveryHigh} />
            <T variant="body">{text}</T>
          </View>
        ))}
      </Card>
      {!configured && (
        <Card style={{ borderColor: Colors.recoveryMid }}>
          <T variant="body" color={Colors.recoveryMid}>
            EXPO_PUBLIC_GOOGLE_CLIENT_ID isn’t set. Add it to .env and rebuild (see README).
          </T>
        </Card>
      )}
      {(error || checkError) && (
        <Card style={{ borderColor: Colors.danger }}>
          <T variant="body" color={Colors.danger}>
            {checkError ?? error}
          </T>
        </Card>
      )}
      <Button
        title="Sign in with Google"
        icon="logo-google"
        disabled={!ready}
        loading={status === 'working' || checking}
        onPress={() => {
          setCheckError(null);
          signIn();
        }}
      />
    </View>
  );
}

function AiStep({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState('');
  return (
    <View style={{ gap: Spacing.md }}>
      <T variant="body" color={Colors.textSecondary}>
        Paste your OpenRouter API key to enable the coach and the morning brief. It stays in the device’s secure
        storage and is only sent to openrouter.ai. You can change the model later in Settings.
      </T>
      <TextInput
        value={key}
        onChangeText={setKey}
        placeholder="sk-or-v1-…"
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={styles.input}
      />
      <Button
        title="Save key"
        disabled={!key.trim().startsWith('sk-')}
        onPress={async () => {
          await setSecret(SecretKeys.openRouterKey, key.trim());
          onDone();
        }}
      />
      <Button title="Skip for now" kind="secondary" onPress={onDone} />
    </View>
  );
}

type InitialSyncOutcome = { kind: 'ok'; partialErrors: number } | { kind: 'auth' } | { kind: 'error'; message: string };

/** Backfills data, then switches on notifications and background monitoring. */
async function performInitialSync(profile: Profile): Promise<InitialSyncOutcome> {
  try {
    // The sync engine reads the profile from storage to compute scores.
    kvSet('profile', profile);
    const result = await syncAll({ full: true });
    await ensureNotificationPermission();
    await registerMonitorTask().catch(() => false);
    await runMonitorChecks().catch(() => 0);
    return { kind: 'ok', partialErrors: result.errors.length };
  } catch (e) {
    if (e instanceof AuthRequiredError) return { kind: 'auth' };
    return { kind: 'error', message: (e as Error).message };
  }
}

function SyncStep({ profile, onAuthLost }: { profile: Profile; onAuthLost: () => void }) {
  const [state, setState] = useState<'running' | 'error'>('running');
  const [message, setMessage] = useState('Backfilling the last 90 days. This takes a minute.');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    performInitialSync(profile).then((outcome) => {
      if (!active) return;
      if (outcome.kind === 'ok') {
        // Saving the profile flips the root guard and opens the app.
        useAppStore.getState().setProfile(profile);
        useAppStore.getState().bumpData();
      } else if (outcome.kind === 'auth') {
        useAppStore.getState().setSignedIn(false);
        onAuthLost();
      } else {
        setState('error');
        setMessage(outcome.message);
      }
    });
    return () => {
      active = false;
    };
  }, [profile, attempt, onAuthLost]);

  return (
    <View style={{ gap: Spacing.md }}>
      <T variant="body" color={state === 'error' ? Colors.danger : Colors.textSecondary}>
        {message}
      </T>
      {state === 'running' ? (
        <Button title="Syncing…" loading onPress={() => {}} />
      ) : (
        <Button
          title="Retry"
          onPress={() => {
            setState('running');
            setAttempt((a) => a + 1);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: Colors.cardRaised,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: Colors.text,
    fontSize: 16,
  },
});
