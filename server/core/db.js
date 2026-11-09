// Database setup shared by the PC (node:sqlite) and the phone (sql.js). Call initDb(handle) once.
import { EXERCISES } from './seed.js';
import { installSync } from './syncdb.js';

export let db = null;

export function initDb(handle) {
  db = handle;
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Columns added after release
  for (const sql of ['ALTER TABLE foods ADD COLUMN portions TEXT', 'ALTER TABLE workouts ADD COLUMN ext_id TEXT', 'ALTER TABLE sleep ADD COLUMN stages TEXT', 'ALTER TABLE sleep ADD COLUMN in_bed REAL']) {
    try { db.exec(sql); } catch { /* already there */ }
  }
  // Seed the exercise library once (same ids on every device)
  if (db.prepare('SELECT COUNT(*) AS n FROM exercises').get().n === 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO exercises (name, muscle, kind) VALUES (?, ?, ?)');
    for (const [name, muscle, kind] of EXERCISES) ins.run(name, muscle, kind);
  }
  installSync(db);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS chat_msgs (
  id INTEGER PRIMARY KEY, conv TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  display TEXT, snapshot_hash TEXT, created TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS chat_msgs_conv ON chat_msgs(conv);

CREATE TABLE IF NOT EXISTS weights (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,            -- ISO timestamp
  date TEXT NOT NULL,          -- local YYYY-MM-DD
  kg REAL NOT NULL,
  fat_pct REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  ext_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS weights_date ON weights(date);

CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  serving TEXT NOT NULL DEFAULT '1 serving',
  serving_g REAL,
  kcal REAL NOT NULL DEFAULT 0,
  protein REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  fiber REAL,
  sugar REAL,
  sodium REAL,
  barcode TEXT,
  portions TEXT,               -- JSON [{label, g}] household measures, e.g. 1 medium
  source TEXT NOT NULL DEFAULT 'custom',
  ext_id TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0,
  last_used TEXT,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS foods_ext ON foods(source, ext_id) WHERE ext_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS foods_barcode ON foods(barcode);

CREATE TABLE IF NOT EXISTS food_logs (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  meal TEXT NOT NULL,          -- breakfast | lunch | dinner | snacks
  food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  serving TEXT,
  qty REAL NOT NULL DEFAULT 1,
  kcal REAL NOT NULL,
  protein REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS food_logs_date ON food_logs(date);

CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  items TEXT NOT NULL,         -- JSON array of {name, serving, qty, kcal, protein, carbs, fat, food_id}
  created TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS water (
  date TEXT PRIMARY KEY,
  ml REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  muscle TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'strength'   -- strength | cardio | bodyweight
);

CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  started TEXT,
  minutes REAL,
  kcal REAL,
  notes TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS workouts_date ON workouts(date);

CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  pos INTEGER NOT NULL DEFAULT 0,
  reps INTEGER,
  kg REAL,
  minutes REAL,
  km REAL,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sets_workout ON sets(workout_id);
CREATE INDEX IF NOT EXISTS sets_exercise ON sets(exercise_id);

CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  items TEXT NOT NULL          -- JSON array of {exercise_id, sets, reps}
);

CREATE TABLE IF NOT EXISTS steps (
  date TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  active_kcal REAL,
  source TEXT NOT NULL DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS sleep (
  date TEXT PRIMARY KEY,       -- the morning you woke up
  start TEXT,
  end TEXT,
  minutes REAL NOT NULL,       -- time asleep
  deep REAL, light REAL, rem REAL, awake REAL,
  source TEXT NOT NULL DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS heart (
  date TEXT PRIMARY KEY,
  resting REAL
);

CREATE TABLE IF NOT EXISTS checkins (
  week TEXT PRIMARY KEY,       -- the Sunday the week ends on
  text TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  pose TEXT NOT NULL DEFAULT 'front',  -- front | side | back
  note TEXT,
  thumb TEXT,                 -- small JPEG data URL for the grid
  data TEXT NOT NULL,         -- full JPEG data URL (about 1000 px)
  created TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS photos_date ON photos(date);

CREATE TABLE IF NOT EXISTS vitals (
  date TEXT PRIMARY KEY,         -- the morning after the night
  hrv REAL, spo2 REAL, resp REAL
);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  waist REAL, hips REAL, chest REAL, arm REAL, thigh REAL, neck REAL  -- cm
);

CREATE TABLE IF NOT EXISTS fasts (
  id INTEGER PRIMARY KEY,
  start TEXT NOT NULL,
  end TEXT,
  goal_h REAL NOT NULL DEFAULT 16
);

`;

// ---- settings helpers ----
const DEFAULTS = {
  units: 'lb',               // lb | kg
  sex: 'male',
  birth_year: '',
  height_cm: '',
  goal_kg: '',
  activity: '1.375',         // multiplier
  rate_kg_week: '0.45',      // ~1 lb/week
  step_goal: '8000',
  water_goal_ml: '2500',
  sleep_goal_h: '8',
  calorie_override: '',      // fixed target if set
  protein_override: '',
  fast_goal_h: '16',
  ai_model: 'claude-opus-5-5',
};

// Never sent to the UI
const SECRET = /^(anthropic_key|usda_key|hevy_key|pair_key|sync_.*)$/;

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULTS };
  for (const r of rows) if (!SECRET.test(r.key)) out[r.key] = r.value;
  return out;
}

export function getSecret(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value ?? ''));
}

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
