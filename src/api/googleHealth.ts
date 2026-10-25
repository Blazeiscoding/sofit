import { type ApiDate, toApiDate } from '@/lib/date';
import { getAccessToken } from './auth';

const BASE = 'https://health.googleapis.com/v4';

export const WEARABLES = 'users/me/dataSourceFamilies/google-wearables';
export const ALL_SOURCES = 'users/me/dataSourceFamilies/all-sources';

export class HealthApiError extends Error {
  constructor(
    public status: number,
    public reason: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'HealthApiError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

async function request<T>(path: string, opts: RequestOptions = {}, attempt = 0): Promise<T> {
  const token = await getAccessToken(attempt > 0);
  const qs = Object.entries(opts.query ?? {})
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ''}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.ok) return (await res.json()) as T;

  if (res.status === 401 && attempt === 0) return request<T>(path, opts, 1);
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return request<T>(path, opts, attempt + 1);
  }
  let reason: string | null = null;
  let message = `Google Health API ${res.status}`;
  try {
    const err = (await res.json()) as {
      error?: { message?: string; details?: { reason?: string }[] };
    };
    message = err.error?.message ?? message;
    reason = err.error?.details?.find((d) => d.reason)?.reason ?? null;
  } catch {
    // Non-JSON error body; keep the status message.
  }
  throw new HealthApiError(res.status, reason, message);
}

// ---- shared shapes ----

export type CivilDateTime = { date: ApiDate; time?: { hours?: number; minutes?: number; seconds?: number } };

export type Interval = {
  startTime: string;
  endTime: string;
  startUtcOffset?: string;
  endUtcOffset?: string;
  civilStartTime?: CivilDateTime;
  civilEndTime?: CivilDateTime;
};

export type SampleTime = { physicalTime: string; utcOffset?: string; civilTime?: CivilDateTime };

/** A data point; exactly one of the type-specific fields is set. */
export type DataPoint = {
  name?: string;
  dataPointName?: string;
  dailyRestingHeartRate?: { date: ApiDate; beatsPerMinute: string };
  dailyHeartRateVariability?: {
    date: ApiDate;
    averageHeartRateVariabilityMilliseconds?: number;
    deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds?: number;
    nonRemHeartRateBeatsPerMinute?: string;
  };
  dailyOxygenSaturation?: {
    date: ApiDate;
    averagePercentage: number;
    lowerBoundPercentage?: number;
    upperBoundPercentage?: number;
  };
  dailyRespiratoryRate?: { date: ApiDate; breathsPerMinute: number };
  dailySleepTemperatureDerivations?: {
    date: ApiDate;
    nightlyTemperatureCelsius: number;
    baselineTemperatureCelsius?: number;
  };
  dailyVo2Max?: { date: ApiDate; vo2Max: number; cardioFitnessLevel?: string; estimated?: boolean };
  sleep?: {
    interval: Interval;
    type?: 'CLASSIC' | 'STAGES' | 'SLEEP_TYPE_UNSPECIFIED';
    stages?: { startTime: string; endTime: string; type: string }[];
    metadata?: { nap?: boolean; mainSleep?: boolean; processed?: boolean };
    summary?: {
      stagesSummary?: { type: string; minutes: string; count?: string }[];
      minutesInSleepPeriod?: string;
      minutesAfterWakeUp?: string;
      minutesToFallAsleep?: string;
      minutesAsleep?: string;
      minutesAwake?: string;
    };
  };
  exercise?: {
    interval: Interval;
    exerciseType?: string;
    displayName?: string;
    activeDuration?: string;
    metricsSummary?: {
      caloriesKcal?: number;
      distanceMillimeters?: number;
      averageHeartRateBeatsPerMinute?: string;
      activeZoneMinutes?: string;
      heartRateZoneDurations?: {
        lightTime?: string;
        moderateTime?: string;
        vigorousTime?: string;
        peakTime?: string;
      };
    };
  };
};

export type RollupPoint = {
  startTime?: string;
  endTime?: string;
  civilStartTime?: CivilDateTime;
  civilEndTime?: CivilDateTime;
  steps?: { countSum?: string };
  heartRate?: { beatsPerMinuteAvg?: number; beatsPerMinuteMax?: number; beatsPerMinuteMin?: number };
  totalCalories?: { kcalSum?: number };
  distance?: { millimetersSum?: string };
  activeZoneMinutes?: {
    sumInFatBurnHeartZone?: string;
    sumInCardioHeartZone?: string;
    sumInPeakHeartZone?: string;
  };
};

// ---- endpoints ----

type ListOptions = { reconcile?: boolean; family?: string; pageSize?: number };

/** Lists every data point that matches the filter, following pagination. */
export async function listDataPoints(dataType: string, filter: string, opts: ListOptions = {}): Promise<DataPoint[]> {
  const path = `/users/me/dataTypes/${dataType}/dataPoints${opts.reconcile ? ':reconcile' : ''}`;
  const out: DataPoint[] = [];
  let pageToken: string | undefined;
  do {
    const res = await request<{ dataPoints?: DataPoint[]; nextPageToken?: string }>(path, {
      query: {
        filter,
        pageSize: opts.pageSize,
        pageToken,
        dataSourceFamily: opts.reconcile ? opts.family : undefined,
      },
    });
    out.push(...(res.dataPoints ?? []));
    pageToken = res.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

/** Physical-time rollup (e.g. 60s heart-rate buckets). Max range 14 days for heart-rate. */
export async function rollUp(
  dataType: string,
  startTime: string,
  endTime: string,
  windowSize: string,
  family = WEARABLES,
): Promise<RollupPoint[]> {
  const out: RollupPoint[] = [];
  let pageToken: string | undefined;
  do {
    const res = await request<{ rollupDataPoints?: RollupPoint[]; nextPageToken?: string }>(
      `/users/me/dataTypes/${dataType}/dataPoints:rollUp`,
      {
        method: 'POST',
        body: { range: { startTime, endTime }, windowSize, dataSourceFamily: family, pageSize: 10000, pageToken },
      },
    );
    out.push(...(res.rollupDataPoints ?? []));
    pageToken = res.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

/** One value per civil day. `end` is exclusive. */
export async function dailyRollUp(
  dataType: string,
  start: string,
  end: string,
  family = WEARABLES,
): Promise<RollupPoint[]> {
  const civil = (d: string) => ({ date: toApiDate(d), time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } });
  const out: RollupPoint[] = [];
  let pageToken: string | undefined;
  do {
    const res = await request<{ rollupDataPoints?: RollupPoint[]; nextPageToken?: string }>(
      `/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`,
      {
        method: 'POST',
        body: { range: { start: civil(start), end: civil(end) }, windowSizeDays: 1, dataSourceFamily: family, pageToken },
      },
    );
    out.push(...(res.rollupDataPoints ?? []));
    pageToken = res.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

export type Identity = { legacyUserId?: string; healthUserId?: string };

export function getIdentity(): Promise<Identity> {
  return request<Identity>('/users/me/identity');
}

export type PairedDevice = {
  name: string;
  deviceType?: string;
  batteryStatus?: string;
  batteryLevel?: number;
  lastSyncTime?: string;
  deviceVersion?: string;
  features?: string[];
};

export async function getPairedDevices(): Promise<PairedDevice[]> {
  const res = await request<{ pairedDevices?: PairedDevice[] }>('/users/me/pairedDevices', { query: { pageSize: 20 } });
  return res.pairedDevices ?? [];
}
