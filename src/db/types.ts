export type DailyRow = {
  date: string;
  rhr: number | null;
  hrv: number | null;
  hrv_deep: number | null;
  spo2: number | null;
  spo2_low: number | null;
  resp: number | null;
  temp_nightly: number | null;
  temp_baseline: number | null;
  vo2max: number | null;
  cardio_fitness: string | null;
  steps: number | null;
  distance_m: number | null;
  calories: number | null;
  azm_fat: number | null;
  azm_cardio: number | null;
  azm_peak: number | null;
};

export type DailyField = Exclude<keyof DailyRow, 'date'>;

export type SleepStageType = 'AWAKE' | 'LIGHT' | 'DEEP' | 'REM' | 'ASLEEP' | 'RESTLESS';
export type SleepStage = { start: string; end: string; type: SleepStageType };

export type SleepRow = {
  id: string;
  /** Local date the sleep ended (the morning after). */
  date: string;
  start: string;
  end: string;
  is_main: number;
  minutes_asleep: number | null;
  minutes_awake: number | null;
  minutes_in_period: number | null;
  latency: number | null;
  deep: number | null;
  light: number | null;
  rem: number | null;
  awake: number | null;
  stages_json: string | null;
};

export type WorkoutRow = {
  id: string;
  date: string;
  start: string;
  end: string;
  type: string | null;
  name: string | null;
  duration_s: number | null;
  calories: number | null;
  avg_hr: number | null;
  azm: number | null;
  distance_m: number | null;
  zone_light_s: number | null;
  zone_moderate_s: number | null;
  zone_vigorous_s: number | null;
  zone_peak_s: number | null;
};

/** One minute of heart rate; ts is epoch seconds at the start of the minute. */
export type HrMinute = { ts: number; bpm: number; bpm_max: number | null };

export type RecoveryDetails = {
  hrvZ: number | null;
  rhrZ: number | null;
  respZ: number | null;
  tempDev: number | null;
  sleepPerf: number | null;
  baselineDays: number;
};

export type StrainDetails = {
  trimp: number;
  source: 'heart-rate' | 'estimated';
  /** Minutes in %HRmax zones 1–5 (50–60, 60–70, 70–80, 80–90, 90+). */
  zoneMinutes: number[];
  maxHr: number;
};

export type SleepDetails = {
  asleep: number | null;
  need: number;
  debt: number;
  efficiency: number | null;
  consistency: number | null;
};

export type ScoreDetails = {
  recovery?: RecoveryDetails;
  strain?: StrainDetails;
  sleep?: SleepDetails;
};

export type ScoreRow = {
  date: string;
  recovery: number | null;
  strain: number | null;
  sleep_perf: number | null;
  sleep_need: number | null;
  details_json: string | null;
};
