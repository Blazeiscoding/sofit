import * as SQLite from 'expo-sqlite';

let instance: SQLite.SQLiteDatabase | null = null;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS daily (
    date TEXT PRIMARY KEY NOT NULL,
    rhr REAL, hrv REAL, hrv_deep REAL, spo2 REAL, spo2_low REAL, resp REAL,
    temp_nightly REAL, temp_baseline REAL, vo2max REAL, cardio_fitness TEXT,
    steps INTEGER, distance_m REAL, calories REAL,
    azm_fat INTEGER, azm_cardio INTEGER, azm_peak INTEGER,
    updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sleep (
    id TEXT PRIMARY KEY NOT NULL,
    date TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    is_main INTEGER NOT NULL DEFAULT 1,
    minutes_asleep INTEGER, minutes_awake INTEGER, minutes_in_period INTEGER, latency INTEGER,
    deep INTEGER, light INTEGER, rem INTEGER, awake INTEGER,
    stages_json TEXT
  );
  CREATE INDEX IF NOT EXISTS sleep_date ON sleep(date);
  CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY NOT NULL,
    date TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    type TEXT, name TEXT,
    duration_s REAL, calories REAL, avg_hr REAL, azm INTEGER, distance_m REAL,
    zone_light_s REAL, zone_moderate_s REAL, zone_vigorous_s REAL, zone_peak_s REAL
  );
  CREATE INDEX IF NOT EXISTS workouts_date ON workouts(date);
  CREATE TABLE IF NOT EXISTS hr_minutes (
    ts INTEGER PRIMARY KEY NOT NULL,
    bpm REAL NOT NULL,
    bpm_max REAL
  );
  CREATE TABLE IF NOT EXISTS scores (
    date TEXT PRIMARY KEY NOT NULL,
    recovery REAL, strain REAL, sleep_perf REAL, sleep_need REAL,
    details_json TEXT
  );
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL
  );
  `,
];

function migrate(db: SQLite.SQLiteDatabase) {
  db.execSync('PRAGMA journal_mode = WAL;');
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const next = version + 1;
    db.withTransactionSync(() => {
      db.execSync(MIGRATIONS[next - 1]);
      db.execSync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
}

/** Shared connection. Opened lazily so the background task can use it without React. */
export function getDb(): SQLite.SQLiteDatabase {
  if (!instance) {
    instance = SQLite.openDatabaseSync('sofit.db');
    migrate(instance);
  }
  return instance;
}

export function resetDatabase() {
  getDb().execSync(`
    DELETE FROM daily; DELETE FROM sleep; DELETE FROM workouts; DELETE FROM hr_minutes;
    DELETE FROM scores; DELETE FROM alerts; DELETE FROM chat;
    DELETE FROM kv WHERE key LIKE 'sync:%' OR key LIKE 'brief:%' OR key = 'device';
  `);
}
