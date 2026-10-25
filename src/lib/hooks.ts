import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { ensureMorningBrief } from '@/ai/brief';
import { AuthRequiredError } from '@/api/auth';
import { runMonitorChecks } from '@/monitor/backgroundTask';
import { useAppStore } from '@/store/settings';
import { syncAll } from '@/sync/syncEngine';

/**
 * Runs a synchronous SQLite read and re-runs it whenever a sync finishes. The read closure
 * is recreated when what it captures changes, which also triggers a re-read.
 */
export function useData<T>(read: (version: number) => T): T {
  const version = useAppStore((s) => s.dataVersion);
  return useMemo(() => read(version), [read, version]);
}

export function useSync() {
  const [syncing, setSyncing] = useState(false);
  const bumpData = useAppStore((s) => s.bumpData);
  const setSignedIn = useAppStore((s) => s.setSignedIn);

  const sync = useCallback(
    async (opts: { full?: boolean; quiet?: boolean } = {}) => {
      setSyncing(true);
      try {
        const result = await syncAll({ full: opts.full });
        bumpData();
        await runMonitorChecks().catch(() => 0);
        const { profile, settings } = useAppStore.getState();
        if (profile) {
          ensureMorningBrief(profile, settings)
            .then((b) => b && bumpData())
            .catch(() => {});
        }
        if (!opts.quiet && result.errors.length) {
          Alert.alert('Some data could not sync', result.errors.slice(0, 4).join('\n'));
        }
        return result;
      } catch (e) {
        if (e instanceof AuthRequiredError) {
          setSignedIn(false);
        } else if (!opts.quiet) {
          Alert.alert('Sync failed', (e as Error).message);
        }
        return null;
      } finally {
        setSyncing(false);
      }
    },
    [bumpData, setSignedIn],
  );

  return { syncing, sync };
}
