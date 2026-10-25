import { getDb } from './db';
import type { DailyField, DailyRow, HrMinute, ScoreRow, SleepRow, WorkoutRow } from './types';

// ---- key/value ----

export function kvGet<T>(key: string, fallback: T): T {
  const row = getDb().getFirstSync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function kvSet(key: string, value: unknown) {
  getDb().runSync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}

export function kvDelete(key: string) {
  getDb().runSync('DELETE FROM kv WHERE key = ?', key);
}

// ---- daily metrics ----

/** Merges the given fields into a day's row, leaving other columns untouched. */
export function upsertDaily(date: string, fields: Partial<Record<DailyField, number | string | null>>) {
  const keys = Object.keys(fields) as DailyField[];
  if (!keys.length) return;
  const cols = keys.join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  const updates = keys.map((k) => `${k} = excluded.${k}`).join(', ');
  getDb().runSync(
    `INSERT INTO daily (date, ${cols}, updated_at) VALUES (?, ${placeholders}, ?)
     ON CONFLICT(date) DO UPDATE SET ${updates}, updated_at = excluded.updated_at`,
    date,
    ...keys.map((k) => fields[k] ?? null),
    Date.now(),
  );
}

export function getDailyRange(from: string, to: string): DailyRow[] {
  return getDb().getAllSync<DailyRow>('SELECT * FROM daily WHERE date >= ? AND date <= ? ORDER BY date', from, to);
}

export function getDaily(date: string): DailyRow | null {
  return getDb().getFirstSync<DailyRow>('SELECT * FROM daily WHERE date = ?', date);
}

export function latestDailyValue(field: DailyField, onOrBefore: string): { date: string; value: number } | null {
  return getDb().getFirstSync<{ date: string; value: number }>(
    `SELECT date, ${field} AS value FROM daily WHERE ${field} IS NOT NULL AND date <= ? ORDER BY date DESC LIMIT 1`,
    onOrBefore,
  );
}

// ---- sleep ----

export function upsertSleep(row: SleepRow) {
  getDb().runSync(
    `INSERT OR REPLACE INTO sleep (id, date, start, end, is_main, minutes_asleep, minutes_awake, minutes_in_period,
      latency, deep, light, rem, awake, stages_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.date, row.start, row.end, row.is_main, row.minutes_asleep, row.minutes_awake,
    row.minutes_in_period, row.latency, row.deep, row.light, row.rem, row.awake, row.stages_json,
  );
}

/** The main sleep that ended on the given date (the night before it). */
export function getMainSleep(date: string): SleepRow | null {
  return getDb().getFirstSync<SleepRow>(
    'SELECT * FROM sleep WHERE date = ? ORDER BY is_main DESC, minutes_asleep DESC LIMIT 1',
    date,
  );
}

export function getSleepRange(from: string, to: string, mainOnly = true): SleepRow[] {
  return getDb().getAllSync<SleepRow>(
    `SELECT * FROM sleep WHERE date >= ? AND date <= ? ${mainOnly ? 'AND is_main = 1' : ''} ORDER BY start`,
    from,
    to,
  );
}

// ---- workouts ----

export function upsertWorkout(row: WorkoutRow) {
  getDb().runSync(
    `INSERT OR REPLACE INTO workouts (id, date, start, end, type, name, duration_s, calories, avg_hr, azm, distance_m,
      zone_light_s, zone_moderate_s, zone_vigorous_s, zone_peak_s) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.date, row.start, row.end, row.type, row.name, row.duration_s, row.calories, row.avg_hr,
    row.azm, row.distance_m, row.zone_light_s, row.zone_moderate_s, row.zone_vigorous_s, row.zone_peak_s,
  );
}

export function getWorkoutsRange(from: string, to: string): WorkoutRow[] {
  return getDb().getAllSync<WorkoutRow>(
    'SELECT * FROM workouts WHERE date >= ? AND date <= ? ORDER BY start DESC',
    from,
    to,
  );
}

// ---- heart rate minutes ----

export function insertHrMinutes(rows: HrMinute[]) {
  if (!rows.length) return;
  const db = getDb();
  db.withTransactionSync(() => {
    for (const r of rows) {
      db.runSync('INSERT OR REPLACE INTO hr_minutes (ts, bpm, bpm_max) VALUES (?, ?, ?)', r.ts, r.bpm, r.bpm_max);
    }
  });
}

export function getHrMinutes(fromTs: number, toTs: number): HrMinute[] {
  return getDb().getAllSync<HrMinute>('SELECT * FROM hr_minutes WHERE ts >= ? AND ts < ? ORDER BY ts', fromTs, toTs);
}

export function latestHrTs(): number | null {
  return getDb().getFirstSync<{ ts: number | null }>('SELECT MAX(ts) AS ts FROM hr_minutes')?.ts ?? null;
}

export function pruneHrMinutes(beforeTs: number) {
  getDb().runSync('DELETE FROM hr_minutes WHERE ts < ?', beforeTs);
}

// ---- scores ----

export function upsertScore(row: ScoreRow) {
  getDb().runSync(
    `INSERT OR REPLACE INTO scores (date, recovery, strain, sleep_perf, sleep_need, details_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    row.date, row.recovery, row.strain, row.sleep_perf, row.sleep_need, row.details_json,
  );
}

export function getScore(date: string): ScoreRow | null {
  return getDb().getFirstSync<ScoreRow>('SELECT * FROM scores WHERE date = ?', date);
}

export function getScoresRange(from: string, to: string): ScoreRow[] {
  return getDb().getAllSync<ScoreRow>('SELECT * FROM scores WHERE date >= ? AND date <= ? ORDER BY date', from, to);
}

// ---- alerts ----

export type AlertRow = { id: number; ts: number; key: string; kind: string; title: string; body: string };

/** Returns false when an alert with this key was already recorded, so each alert fires once. */
export function recordAlert(key: string, kind: string, title: string, body: string): boolean {
  const res = getDb().runSync(
    'INSERT OR IGNORE INTO alerts (ts, key, kind, title, body) VALUES (?, ?, ?, ?, ?)',
    Date.now(), key, kind, title, body,
  );
  return res.changes > 0;
}

export function getRecentAlerts(limit = 20): AlertRow[] {
  return getDb().getAllSync<AlertRow>('SELECT * FROM alerts ORDER BY ts DESC LIMIT ?', limit);
}

// ---- chat ----

export type ChatRow = { id: number; ts: number; role: 'user' | 'assistant'; content: string };

export function addChatMessage(role: ChatRow['role'], content: string) {
  getDb().runSync('INSERT INTO chat (ts, role, content) VALUES (?, ?, ?)', Date.now(), role, content);
}

export function getChatHistory(limit = 50): ChatRow[] {
  return getDb()
    .getAllSync<ChatRow>('SELECT * FROM chat ORDER BY id DESC LIMIT ?', limit)
    .reverse();
}

export function clearChat() {
  getDb().runSync('DELETE FROM chat');
}
