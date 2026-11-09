// All app routes, shared by the PC server and the phone app (which runs this in-process).
import { db, getSettings, setSetting, getSecret, tx } from './db.js';
import { targets, daySummary, logStreak, goalProjection, weightTrend, today, addDays, localDate } from './stats.js';
import { localSearch, onlineSearch, barcodeLookup, saveFood } from './food.js';
import { searchBuiltIn } from './usda.js';
import {
  addFoodLog, logFood, addWater, addWeight, ingestHealth, workoutDetail, previousPerformance,
  personalRecords, finishWorkout, startWorkout, addExerciseToWorkout,
} from './logic.js';
import { chatHistory, newConversation, estimateFood, friendlyError, weeklyCheckin } from './ai.js';
import { newId } from './ids.js';
import * as Sync from './sync.js';
import { syncHevy, hevyStatus } from './hevy.js';
import { importHealthWorkouts, importHevyCsv } from './workoutimport.js';

const envKey = () => globalThis.process?.env?.ANTHROPIC_API_KEY;
/** AI works with your Claude subscription (through Kaizen on the PC) or with an API key. */
const aiReady = () => (getSettings().ai_provider || 'subscription') === 'subscription' || !!(getSecret('anthropic_key') || envKey());
// ---------------- tiny router ----------------
export const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};
export const GET = (p, h) => route('GET', p, h);
export const POST = (p, h) => route('POST', p, h);
const PATCH = (p, h) => route('PATCH', p, h);
const DEL = (p, h) => route('DELETE', p, h);

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const need = (cond, msg = 'Bad request') => { if (!cond) throw new HttpError(400, msg); };
const num = v => (v === '' || v == null ? null : Number(v));

// ---------------- state ----------------
GET('/api/state', ({ query }) => {
  const date = query.date || today();
  const logs = db.prepare('SELECT * FROM food_logs WHERE date = ? ORDER BY id').all(date);
  const fast = db.prepare('SELECT * FROM fasts WHERE end IS NULL ORDER BY id DESC LIMIT 1').get() ?? null;
  const active = db.prepare('SELECT id, name, started FROM workouts WHERE done = 0 ORDER BY id DESC LIMIT 1').get() ?? null;
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(date, -i);
    const s = daySummary(d);
    week.push({ date: d, kcal: s.food.n ? Math.round(s.food.kcal) : null, steps: s.steps?.count ?? null, sleep_min: s.sleep?.minutes ?? null });
  }
  const trend = weightTrend();
  return {
    today: today(), date, settings: getSettings(), targets: targets(), summary: daySummary(date), logs, week,
    streak: logStreak(), projection: goalProjection(), fast, active_workout: active,
    weight: trend.slice(-60),
    last_health_sync: getSecret('last_health_sync'),
    has_ai_key: aiReady(), ai_provider: getSettings().ai_provider || 'subscription', has_api_key: !!(getSecret('anthropic_key') || envKey()),
    sync: Sync.status(),
    checkin: db.prepare('SELECT week, text FROM checkins ORDER BY week DESC LIMIT 1').get() ?? null,
  };
});

// ---------------- foods ----------------
GET('/api/foods/search', ({ query }) => localSearch(query.q || ''));
// Built-in database: instant and offline
GET('/api/foods/db', ({ query }) => (query.q || '').trim().length >= 2 ? searchBuiltIn(query.q, 25) : []);
GET('/api/foods/online', async ({ query }) => {
  const q = (query.q || '').trim();
  if (q.length < 2) return [];
  return onlineSearch(q, getSecret('usda_key'));
});
GET('/api/foods/barcode/:code', async ({ params }) => {
  const f = await barcodeLookup(params.code);
  if (!f) throw new HttpError(404, 'Not found');
  return f;
});
POST('/api/foods', ({ body }) => {
  need(body.name && body.kcal != null, 'Name and calories are required');
  return saveFood({ ...body, source: 'custom', ext_id: null });
});
PATCH('/api/foods/:id', ({ params, body }) => {
  const allowed = ['name', 'brand', 'serving', 'serving_g', 'kcal', 'protein', 'carbs', 'fat', 'favorite', 'barcode'];
  for (const k of allowed) if (k in body) db.prepare(`UPDATE foods SET ${k} = ? WHERE id = ?`).run(body[k], params.id);
  return db.prepare('SELECT * FROM foods WHERE id = ?').get(params.id);
});
DEL('/api/foods/:id', ({ params }) => { db.prepare('DELETE FROM foods WHERE id = ?').run(params.id); return { ok: true }; });

// ---------------- food log ----------------
POST('/api/log/food', ({ body }) => {
  if (body.food) return logFood(body);
  need(body.name && body.kcal != null, 'Name and calories are required');
  return addFoodLog(body);
});
POST('/api/log/food/bulk', ({ body }) => {
  need(Array.isArray(body.items) && body.items.length, 'No items');
  return tx(() => body.items.map(it => addFoodLog({ ...it, date: body.date, meal: body.meal })));
});
PATCH('/api/log/food/:id', ({ params, body }) => {
  const row = db.prepare('SELECT * FROM food_logs WHERE id = ?').get(params.id);
  if (!row) throw new HttpError(404, 'Not found');
  if (body.qty != null && Number(body.qty) > 0 && row.qty > 0) {
    const f = Number(body.qty) / row.qty;
    db.prepare('UPDATE food_logs SET qty = ?, kcal = kcal * ?, protein = protein * ?, carbs = carbs * ?, fat = fat * ? WHERE id = ?')
      .run(Number(body.qty), f, f, f, f, params.id);
  }
  for (const k of ['meal', 'date', 'name', 'kcal', 'protein', 'carbs', 'fat']) {
    if (k in body && !(k === 'qty')) db.prepare(`UPDATE food_logs SET ${k} = ? WHERE id = ?`).run(body[k], params.id);
  }
  return db.prepare('SELECT * FROM food_logs WHERE id = ?').get(params.id);
});
DEL('/api/log/food/:id', ({ params }) => { db.prepare('DELETE FROM food_logs WHERE id = ?').run(params.id); return { ok: true }; });
POST('/api/log/copy', ({ body }) => {
  need(body.from && body.to, 'from and to required');
  const rows = db.prepare(`SELECT * FROM food_logs WHERE date = ? ${body.meal ? 'AND meal = ?' : ''} ORDER BY id`).all(...[body.from, body.meal].filter(Boolean));
  return tx(() => rows.map(r => addFoodLog({ ...r, date: body.to, meal: body.to_meal || r.meal })));
});

// Saved meals
GET('/api/meals', () => db.prepare('SELECT * FROM meals ORDER BY name').all().map(m => ({ ...m, items: JSON.parse(m.items) })));
POST('/api/meals', ({ body }) => {
  let items = body.items;
  if (!items && body.date && body.meal) {
    items = db.prepare('SELECT food_id, name, serving, qty, kcal, protein, carbs, fat FROM food_logs WHERE date = ? AND meal = ?').all(body.date, body.meal);
  }
  need(body.name && items?.length, 'Name and items required');
  const r = db.prepare('INSERT INTO meals (id, name, items) VALUES (?, ?, ?)').run(newId(), body.name, JSON.stringify(items));
  return { id: Number(r.lastInsertRowid) };
});
POST('/api/meals/:id/log', ({ params, body }) => {
  const m = db.prepare('SELECT * FROM meals WHERE id = ?').get(params.id);
  if (!m) throw new HttpError(404, 'Not found');
  return tx(() => JSON.parse(m.items).map(it => addFoodLog({ ...it, date: body.date, meal: body.meal })));
});
DEL('/api/meals/:id', ({ params }) => { db.prepare('DELETE FROM meals WHERE id = ?').run(params.id); return { ok: true }; });

// ---------------- water, weight, steps, sleep ----------------
POST('/api/water', ({ body }) => ({ ml: addWater(body.date || today(), Number(body.ml) || 0) }));

GET('/api/weights', () => {
  const entries = db.prepare('SELECT * FROM weights ORDER BY ts DESC LIMIT 400').all();
  return { entries, trend: weightTrend(), projection: goalProjection() };
});
POST('/api/weights', ({ body }) => {
  const s = getSettings();
  const v = Number(body.value);
  need(v > 0, 'Weight required');
  const kg = s.units === 'lb' ? v / 2.20462 : v;
  const ts = body.date && body.date !== today() ? new Date(body.date + 'T08:00:00').toISOString() : new Date().toISOString();
  const r = addWeight({ kg, fat_pct: num(body.fat_pct), ts, source: 'manual' });
  return r;
});
DEL('/api/weights/:id', ({ params }) => { db.prepare('DELETE FROM weights WHERE id = ?').run(params.id); return { ok: true }; });

POST('/api/steps', ({ body }) => {
  need(body.date && Number(body.count) >= 0);
  db.prepare(`INSERT INTO steps (date, count, source) VALUES (?, ?, 'manual') ON CONFLICT(date) DO UPDATE SET count = excluded.count, source = 'manual'`).run(body.date, Math.round(body.count));
  return { ok: true };
});
POST('/api/sleep', ({ body }) => {
  need(body.date && Number(body.hours) > 0);
  db.prepare(`INSERT INTO sleep (date, minutes, source) VALUES (?, ?, 'manual') ON CONFLICT(date) DO UPDATE SET minutes = excluded.minutes, deep = NULL, light = NULL, rem = NULL, awake = NULL, source = 'manual'`)
    .run(body.date, Math.round(Number(body.hours) * 60));
  return { ok: true };
});

GET('/api/trends', ({ query }) => {
  const days = Math.min(Number(query.days) || 90, 730);
  const start = addDays(today(), -days + 1);
  const food = Object.fromEntries(db.prepare(`SELECT date, SUM(kcal) kcal, SUM(protein) protein, SUM(carbs) carbs, SUM(fat) fat FROM food_logs WHERE date >= ? GROUP BY date`).all(start).map(r => [r.date, r]));
  const steps = Object.fromEntries(db.prepare('SELECT date, count, active_kcal FROM steps WHERE date >= ?').all(start).map(r => [r.date, r]));
  const sleep = Object.fromEntries(db.prepare('SELECT * FROM sleep WHERE date >= ?').all(start).map(r => [r.date, r]));
  const heart = Object.fromEntries(db.prepare('SELECT * FROM heart WHERE date >= ?').all(start).map(r => [r.date, r.resting]));
  const trend = Object.fromEntries(weightTrend().filter(p => p.date >= start).map(p => [p.date, p]));
  const workouts = Object.fromEntries(db.prepare('SELECT date, COUNT(*) n FROM workouts WHERE done = 1 AND date >= ? GROUP BY date').all(start).map(r => [r.date, r.n]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    out.push({
      date: d, kcal: food[d]?.kcal ?? null, protein: food[d]?.protein ?? null, carbs: food[d]?.carbs ?? null, fat: food[d]?.fat ?? null,
      steps: steps[d]?.count ?? null, sleep_min: sleep[d]?.minutes ?? null, deep: sleep[d]?.deep ?? null, rem: sleep[d]?.rem ?? null,
      sleep_start: sleep[d]?.start ?? null, sleep_end: sleep[d]?.end ?? null,
      kg: trend[d]?.kg ?? null, trend: trend[d]?.trend ?? null, resting_hr: heart[d] ?? null, workouts: workouts[d] ?? 0,
    });
  }
  return out;
});

// ---------------- workouts ----------------
GET('/api/exercises', () => db.prepare('SELECT * FROM exercises ORDER BY name').all());
POST('/api/exercises', ({ body }) => {
  need(body.name, 'Name required');
  const r = db.prepare('INSERT INTO exercises (id, name, muscle, kind) VALUES (?, ?, ?, ?)').run(newId(), body.name.trim(), body.muscle || 'Other', body.kind || 'strength');
  return db.prepare('SELECT * FROM exercises WHERE id = ?').get(r.lastInsertRowid);
});
GET('/api/exercises/:id/history', ({ params }) => {
  const rows = db.prepare(`SELECT w.date, s.reps, s.kg, s.minutes, s.km FROM sets s JOIN workouts w ON w.id = s.workout_id
    WHERE s.exercise_id = ? AND s.done = 1 AND w.done = 1 ORDER BY w.date DESC, s.pos LIMIT 300`).all(params.id);
  return rows;
});
GET('/api/workouts', ({ query }) => {
  const rows = db.prepare(`SELECT w.*, (SELECT COUNT(*) FROM sets s WHERE s.workout_id = w.id AND s.done = 1) AS set_count,
    (SELECT COALESCE(SUM(s.kg * s.reps), 0) FROM sets s WHERE s.workout_id = w.id AND s.done = 1) AS volume
    FROM workouts w WHERE w.done = 1 ORDER BY w.date DESC, w.id DESC LIMIT ?`).all(Number(query.limit) || 50);
  return rows;
});
GET('/api/workouts/:id', ({ params }) => workoutDetail(params.id) ?? (() => { throw new HttpError(404, 'Not found'); })());
POST('/api/workouts', ({ body }) => startWorkout(body));
POST('/api/workouts/:id/exercises', ({ params, body }) => addExerciseToWorkout(Number(params.id), Number(body.exercise_id)));
POST('/api/workouts/:id/sets', ({ params, body }) => {
  const last = db.prepare('SELECT * FROM sets WHERE workout_id = ? AND exercise_id = ? ORDER BY pos DESC, id DESC LIMIT 1').get(params.id, body.exercise_id);
  db.prepare('INSERT INTO sets (id, workout_id, exercise_id, pos, reps, kg, minutes, km) VALUES (?, ?,?,?,?,?,?,?)')
    .run(newId(), params.id, body.exercise_id, last?.pos ?? 0, last?.reps ?? null, last?.kg ?? null, last?.minutes ?? null, last?.km ?? null);
  return workoutDetail(params.id);
});
DEL('/api/workouts/:id/exercises/:ex', ({ params }) => {
  db.prepare('DELETE FROM sets WHERE workout_id = ? AND exercise_id = ?').run(params.id, params.ex);
  return workoutDetail(params.id);
});
PATCH('/api/sets/:id', ({ params, body }) => {
  for (const k of ['reps', 'kg', 'minutes', 'km', 'done']) {
    if (k in body) db.prepare(`UPDATE sets SET ${k} = ? WHERE id = ?`).run(body[k] === '' ? null : body[k], params.id);
  }
  return db.prepare('SELECT * FROM sets WHERE id = ?').get(params.id);
});
DEL('/api/sets/:id', ({ params }) => { db.prepare('DELETE FROM sets WHERE id = ?').run(params.id); return { ok: true }; });
PATCH('/api/workouts/:id', ({ params, body }) => {
  for (const k of ['name', 'notes', 'date']) if (k in body) db.prepare(`UPDATE workouts SET ${k} = ? WHERE id = ?`).run(body[k], params.id);
  return workoutDetail(params.id);
});
POST('/api/workouts/:id/finish', ({ params, body }) => {
  // Drop sets never marked done
  db.prepare('DELETE FROM sets WHERE workout_id = ? AND done = 0').run(params.id);
  return finishWorkout(Number(params.id), body.minutes);
});
DEL('/api/workouts/:id', ({ params }) => { db.prepare('DELETE FROM workouts WHERE id = ?').run(params.id); return { ok: true }; });

GET('/api/routines', () => db.prepare('SELECT * FROM routines ORDER BY name').all().map(r => {
  const items = JSON.parse(r.items);
  const names = items.map(i => db.prepare('SELECT name FROM exercises WHERE id = ?').get(i.exercise_id)?.name).filter(Boolean);
  return { ...r, items, names };
}));
POST('/api/routines', ({ body }) => {
  need(body.name && Array.isArray(body.items) && body.items.length, 'Name and exercises required');
  const r = db.prepare('INSERT INTO routines (id, name, items) VALUES (?, ?, ?)').run(newId(), body.name, JSON.stringify(body.items));
  return { id: Number(r.lastInsertRowid) };
});
POST('/api/routines/from-workout/:id', ({ params, body }) => {
  const w = workoutDetail(params.id);
  if (!w) throw new HttpError(404, 'Not found');
  const items = w.exercises.map(g => ({ exercise_id: g.exercise_id, sets: g.sets.length, reps: g.sets[0]?.reps ?? null, minutes: g.sets[0]?.minutes ?? null }));
  const r = db.prepare('INSERT INTO routines (id, name, items) VALUES (?, ?, ?)').run(newId(), body.name || w.name, JSON.stringify(items));
  return { id: Number(r.lastInsertRowid) };
});
DEL('/api/routines/:id', ({ params }) => { db.prepare('DELETE FROM routines WHERE id = ?').run(params.id); return { ok: true }; });
GET('/api/records', () => personalRecords());
// Workouts overview (training logged in Hevy): weekly totals and strength trends for the main lifts
GET('/api/training', ({ query }) => {
  const weeksBack = Math.min(Number(query.weeks) || 12, 52);
  const monday = d => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return localDate(x); };
  const first = monday(addDays(today(), -7 * (weeksBack - 1)));
  const rows = db.prepare('SELECT date, minutes, kcal FROM workouts WHERE done = 1 AND date >= ?').all(first);
  const weeks = [];
  for (let i = 0; i < weeksBack; i++) weeks.push({ week: addDays(first, i * 7), count: 0, minutes: 0, kcal: 0 });
  for (const w of rows) {
    const k = weeks.find(x => x.week === monday(w.date));
    if (k) { k.count++; k.minutes += w.minutes || 0; k.kcal += w.kcal || 0; }
  }
  const since = addDays(today(), -180);
  const top = db.prepare(`SELECT e.id, e.name, COUNT(DISTINCT w.id) n FROM sets s JOIN workouts w ON w.id = s.workout_id JOIN exercises e ON e.id = s.exercise_id
    WHERE w.done = 1 AND s.kg > 0 AND s.reps > 0 AND w.date >= ? GROUP BY e.id ORDER BY n DESC LIMIT 4`).all(since);
  const lifts = top.map(e => ({
    exercise_id: e.id, name: e.name, sessions: e.n,
    points: db.prepare(`SELECT w.date, MAX(s.kg * (1 + s.reps / 30.0)) e1rm, MAX(s.kg) top_kg FROM sets s JOIN workouts w ON w.id = s.workout_id
      WHERE s.exercise_id = ? AND s.kg > 0 AND s.reps > 0 AND w.done = 1 AND w.date >= ? GROUP BY w.id ORDER BY w.date`).all(e.id, since),
  }));
  return { weeks, lifts };
});

// ---------------- measurements & fasting ----------------
GET('/api/measurements', () => db.prepare('SELECT * FROM measurements ORDER BY date DESC').all());
POST('/api/measurements', ({ body }) => {
  const s = getSettings();
  const toCm = v => (v === '' || v == null ? null : s.units === 'lb' ? Number(v) * 2.54 : Number(v));
  db.prepare('INSERT INTO measurements (id, date, waist, hips, chest, arm, thigh, neck) VALUES (?, ?,?,?,?,?,?,?)')
    .run(newId(), body.date || today(), toCm(body.waist), toCm(body.hips), toCm(body.chest), toCm(body.arm), toCm(body.thigh), toCm(body.neck));
  return { ok: true };
});
DEL('/api/measurements/:id', ({ params }) => { db.prepare('DELETE FROM measurements WHERE id = ?').run(params.id); return { ok: true }; });

GET('/api/fasts', () => db.prepare('SELECT * FROM fasts ORDER BY id DESC LIMIT 30').all());
POST('/api/fasts/start', ({ body }) => {
  db.prepare('UPDATE fasts SET end = ? WHERE end IS NULL').run(new Date().toISOString());
  db.prepare('INSERT INTO fasts (id, start, goal_h) VALUES (?, ?, ?)').run(newId(), body.start || new Date().toISOString(), Number(body.goal_h) || Number(getSettings().fast_goal_h) || 16);
  return { ok: true };
});
POST('/api/fasts/stop', () => { db.prepare('UPDATE fasts SET end = ? WHERE end IS NULL').run(new Date().toISOString()); return { ok: true }; });
DEL('/api/fasts/:id', ({ params }) => { db.prepare('DELETE FROM fasts WHERE id = ?').run(params.id); return { ok: true }; });

// ---------------- health sync from phone ----------------
POST('/api/health/sync', ({ body }) => ({ ...ingestHealth(body), workouts: importHealthWorkouts(body.workouts) }));
POST('/api/import/hevy-csv', ({ body }) => importHevyCsv(body.csv));

// ---------------- settings ----------------
GET('/api/settings', () => ({ ...getSettings(), has_ai_key: aiReady(), ai_provider: getSettings().ai_provider || 'subscription', has_api_key: !!(getSecret('anthropic_key') || envKey()), has_usda_key: !!getSecret('usda_key'), has_hevy_key: !!getSecret('hevy_key') }));
POST('/api/settings', ({ body }) => {
  const allowed = ['ai_provider', 'cc_model', 'hevy_auto', 'units', 'sex', 'birth_year', 'height_cm', 'goal_kg', 'activity', 'rate_kg_week', 'step_goal', 'water_goal_ml', 'sleep_goal_h', 'calorie_override', 'protein_override', 'fast_goal_h', 'ai_model', 'name'];
  for (const k of allowed) if (k in body) setSetting(k, body[k]);
  for (const k of ['anthropic_key', 'usda_key', 'hevy_key']) if (k in body && body[k] !== undefined) setSetting(k, String(body[k]).trim());
  return getSettings();
});

// ---------------- AI ----------------
GET('/api/chat', () => chatHistory());
GET('/api/checkins', () => db.prepare('SELECT week, text, created FROM checkins ORDER BY week DESC LIMIT 12').all());
POST('/api/checkins/now', async () => { try { return await weeklyCheckin(); } catch (e) { throw new HttpError(e.status && e.status < 500 ? e.status : 502, friendlyError(e)); } });
POST('/api/chat/new', () => { newConversation(); return { ok: true }; });
POST('/api/ai/estimate', async ({ body }) => {
  need(body.text || body.image, 'Describe the food or add a photo');
  try { return await estimateFood(body); }
  catch (e) { throw new HttpError(e.status && e.status < 500 ? e.status : 502, friendlyError(e)); }
});

GET('/api/export', () => {
  const tables = ['weights', 'foods', 'food_logs', 'meals', 'water', 'exercises', 'workouts', 'sets', 'routines', 'steps', 'sleep', 'heart', 'measurements', 'fasts'];
  return Object.fromEntries([['exported', new Date().toISOString()], ['settings', getSettings()], ...tables.map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()])]);
});


// ---------------- progress photos ----------------
// Listing returns thumbnails only; the full photo loads when opened.
GET('/api/photos', () => {
  const trend = weightTrend();
  const weightOn = date => { let w = null; for (const p of trend) { if (p.date <= date) w = p.trend; else break; } return w; };
  return db.prepare('SELECT id, date, pose, note, thumb FROM photos ORDER BY date DESC, id DESC').all().map(p => ({ ...p, weight_kg: weightOn(p.date) }));
});
GET('/api/photos/:id', ({ params }) => {
  const p = db.prepare('SELECT id, date, pose, note, data FROM photos WHERE id = ?').get(params.id);
  if (!p) throw new HttpError(404, 'Not found');
  return p;
});
POST('/api/photos', ({ body }) => {
  need(typeof body.data === 'string' && body.data.startsWith('data:image/'), 'Photo required');
  need(body.data.length < 1_500_000, 'Photo is too large');
  const id = newId();
  db.prepare('INSERT INTO photos (id, date, pose, note, thumb, data) VALUES (?,?,?,?,?,?)')
    .run(id, body.date || today(), ['front', 'side', 'back'].includes(body.pose) ? body.pose : 'front', body.note || null, body.thumb || null, body.data);
  return { id };
});
DEL('/api/photos/:id', ({ params }) => { db.prepare('DELETE FROM photos WHERE id = ?').run(params.id); return { ok: true }; });

// ---------------- sleep ----------------
GET('/api/sleep', ({ query }) => {
  const days = Math.min(Number(query.days) || 30, 365);
  const start = addDays(today(), -days + 1);
  const vit = Object.fromEntries(db.prepare('SELECT * FROM vitals WHERE date >= ?').all(start).map(v => [v.date, v]));
  const rhr = Object.fromEntries(db.prepare('SELECT date, resting FROM heart WHERE date >= ?').all(start).map(h => [h.date, h.resting]));
  const nights = db.prepare('SELECT * FROM sleep WHERE date >= ? ORDER BY date').all(start).map(n => {
    let stages = [];
    try { stages = n.stages ? JSON.parse(n.stages) : []; } catch {}
    return { ...n, stages, hrv: vit[n.date]?.hrv ?? null, spo2: vit[n.date]?.spo2 ?? null, resp: vit[n.date]?.resp ?? null, resting_hr: rhr[n.date] ?? null };
  });
  return { goal_h: Number(getSettings().sleep_goal_h) || 8, nights, vitals: Object.values(vit), resting: rhr };
});

// ---------------- Hevy ----------------
GET('/api/hevy', () => hevyStatus());
POST('/api/hevy/sync', async () => { try { return await syncHevy(); } catch (e) { throw new HttpError(e.status || 502, e.message); } });

// ---------------- cloud sync ----------------
let linkExtras = () => ({});
/** The PC adds its LAN address so a linked phone can also fetch app updates from it. */
export function setLinkExtras(fn) { linkExtras = fn; }
const syncErr = e => new HttpError(e.status && e.status < 500 ? 400 : 502, e.message);
GET('/api/sync', () => Sync.status());
GET('/api/sync/sql', () => ({ sql: Sync.SETUP_SQL }));
POST('/api/sync/setup', async ({ body }) => { try { return await Sync.setup(body); } catch (e) { throw syncErr(e); } });
POST('/api/sync/now', async () => { try { return await Sync.syncNow(); } catch (e) { throw syncErr(e); } });
POST('/api/sync/join', async ({ body }) => { try { return await Sync.join(body.code); } catch (e) { throw syncErr(e); } });
POST('/api/sync/unlink', () => { Sync.unlink(); return Sync.status(); });
GET('/api/sync/lan', () => ({ url: getSecret('sync_lan'), key: getSecret('sync_lan_key') }));
GET('/api/sync/code', () => ({ code: Sync.linkCode(linkExtras()) }));

/** Dispatch one API call. Returns the JSON result or throws HttpError. */
export async function handle({ method, path, query = {}, body = {}, req = null }) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const result = await r.handler({ req, params, query, body });
    if (method !== 'GET' && !path.startsWith('/api/sync')) Sync.syncSoon();
    return result ?? { ok: true };
  }
  throw new HttpError(404, 'Not found');
}
