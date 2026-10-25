import { create } from 'zustand';

import { kvGet, kvSet } from '@/db/repo';
import { today } from '@/lib/date';

export type Sex = 'male' | 'female';

export type Profile = {
  birthDate: string;
  sex: Sex;
  heightCm: number;
  weightKg: number;
  /** Baseline nightly sleep need in minutes before strain and debt adjustments. */
  sleepBaselineMin: number;
};

export type AlertSettings = {
  enabled: boolean;
  rhrRiseBpm: number;
  hrvDropSd: number;
  spo2Min: number;
  respRise: number;
  tempDevC: number;
  batteryMin: number;
  noSyncHours: number;
};

export type Settings = {
  aiModel: string;
  morningBrief: boolean;
  alerts: AlertSettings;
};

export const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';

export const DEFAULT_SETTINGS: Settings = {
  aiModel: DEFAULT_MODEL,
  morningBrief: true,
  alerts: {
    enabled: true,
    rhrRiseBpm: 5,
    hrvDropSd: 1.5,
    spo2Min: 93,
    respRise: 2,
    tempDevC: 1,
    batteryMin: 15,
    noSyncHours: 24,
  },
};

export function loadProfile(): Profile | null {
  return kvGet<Profile | null>('profile', null);
}

export function loadSettings(): Settings {
  const saved = kvGet<Partial<Settings>>('settings', {});
  return { ...DEFAULT_SETTINGS, ...saved, alerts: { ...DEFAULT_SETTINGS.alerts, ...saved.alerts } };
}

type State = {
  hydrated: boolean;
  signedIn: boolean;
  profile: Profile | null;
  settings: Settings;
  /** Bumped after every sync so screens re-read SQLite. */
  dataVersion: number;
  /** Day shown on the Overview, Sleep and Strain tabs. */
  selectedDate: string;
  hydrate: (signedIn: boolean) => void;
  setSignedIn: (v: boolean) => void;
  setProfile: (p: Profile) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  bumpData: () => void;
  setSelectedDate: (date: string) => void;
};

export const useAppStore = create<State>((set, get) => ({
  hydrated: false,
  signedIn: false,
  profile: null,
  settings: DEFAULT_SETTINGS,
  dataVersion: 0,
  selectedDate: today(),
  hydrate: (signedIn) => set({ hydrated: true, signedIn, profile: loadProfile(), settings: loadSettings() }),
  setSignedIn: (signedIn) => set({ signedIn }),
  setProfile: (profile) => {
    kvSet('profile', profile);
    set({ profile });
  },
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    kvSet('settings', settings);
    set({ settings });
  },
  bumpData: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
  setSelectedDate: (selectedDate) => set({ selectedDate }),
}));
