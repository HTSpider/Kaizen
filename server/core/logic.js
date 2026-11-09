import { db, tx, getSettings } from './db.js';
import { newId } from './ids.js';
import { localDate, today, latestWeightKg } from './stats.js';
import { saveFood, markUsed } from './food.js';
import { MET, STRENGTH_MET } from './seed.js';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

export function addFoodLog(e) {
  const meal = MEALS.includes(e.meal) ? e.meal : 'snacks';
  const r = db.prepare(`INSERT INTO food_logs (id, date, meal, food_id, name, serving, qty, kcal, protein, carbs, fat) VALUES (?, ?,?,?,?,?,?,?,?,?,?)`)
    .run(newId(), e.date || today(), meal, e.food_id ?? null, e.name, e.serving ?? null, Number(e.qty) || 1,
      Number(e.kcal) || 0, Number(e.protein) || 0, Number(e.carbs) || 0, Number(e.fat) || 0);
  if (e.food_id) markUsed(e.food_id);
  return db.prepare('SELECT * FROM food_logs WHERE id = ?').get(r.lastInsertRowid);
}

/**
 * Log a food from the database. `amount` + `unit` ('serving' | 'g').
 * `food` may be an existing row (with id) or an online result to save first.
 */
export function logFood({ food, date, meal, amount, unit, unit_g, unit_label }) {
  // unit: 'serving' (amount × the food's serving) or 'weight' (amount × unit_g grams,
  // e.g. 2 × "1 medium" of 119 g, 150 × "g" of 1 g, 3 × "oz" of 28.35 g)
  const row = saveFood(food);
  const amt = Number(amount) || 1;
  const ug = Number(unit_g) || (unit === 'g' ? 1 : 0);
  let mult, serving, qty;
  if (ug > 0 && row.serving_g) {
    mult = (amt * ug) / row.serving_g;
    if (ug === 1) { serving = `${amt} g`; qty = 1; }
    else { serving = String(unit_label || `${ug} g`).replace(/^1\s+/, ''); qty = amt; }
  } else {
    mult = amt; serving = row.serving; qty = amt;
  }
  return addFoodLog({
    date, meal, food_id: row.id, name: row.brand ? `${row.name} (${row.brand})` : row.name,
    serving, qty,
    kcal: row.kcal * mult, protein: row.protein * mult, carbs: row.carbs * mult, fat: row.fat * mult,
  });
}

export function addWater(date, ml) {
  db.prepare(`INSERT INTO water (date, ml) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET ml = MAX(0, ml + excluded.ml)`).run(date, ml);
  return db.prepare('SELECT ml FROM water WHERE date = ?').get(date).ml;
}

/** Add a weigh-in, skipping near-duplicates (same reading arriving via two apps). */
export function addWeight({ kg, fat_pct = null, ts = new Date().toISOString(), source = 'manual', ext_id = null }) {
  if (ext_id && db.prepare('SELECT 1 FROM weights WHERE ext_id = ?').get(ext_id)) return { skipped: true };
  const t = new Date(ts).getTime();
  const near = db.prepare(`SELECT id, ts, kg, fat_pct FROM weights WHERE ts BETWEEN ? AND ?`).all(
    new Date(t - 15 * 60000).toISOString(), new Date(t + 15 * 60000).toISOString());
  const dup = near.find(w => Math.abs(w.kg - kg) < 0.25);
  if (dup) {
    if (fat_pct != null && dup.fat_pct == null) db.prepare('UPDATE weights SET fat_pct = ? WHERE id = ?').run(fat_pct, dup.id);
    return { skipped: true };
  }
  db.prepare('INSERT INTO weights (id, ts, date, kg, fat_pct, source, ext_id) VALUES (?, ?,?,?,?,?,?)')
    .run(newId(), new Date(ts).toISOString(), localDate(new Date(ts)), kg, fat_pct, source, ext_id);
  return { added: true };
}

/**
 * Data pushed from the phone (Health Connect).
 * { steps: [{date, count, active_kcal?}], sleep: [{date, start, end, minutes, deep, light, rem, awake}],
 *   weight: [{ts, kg, id?}], body_fat: [{ts, pct}], resting_hr: [{date, bpm}] }
 */
export function ingestHealth(p) {
  const res = { steps: 0, sleep: 0, weight: 0, resting_hr: 0 };
  tx(() => {
    for (const s of p.steps || []) {
      if (!s.date || !(s.count >= 0)) continue;
      db.prepare(`INSERT INTO steps (date, count, active_kcal, source) VALUES (?,?,?, 'health')
        ON CONFLICT(date) DO UPDATE SET count = excluded.count, active_kcal = COALESCE(excluded.active_kcal, steps.active_kcal), source = 'health'
        WHERE steps.source != 'manual' OR excluded.count > steps.count`).run(s.date, Math.round(s.count), s.active_kcal ?? null);
      res.steps++;
    }
    for (const s of p.sleep || []) {
      if (!s.date || !(s.minutes > 0)) continue;
      db.prepare(`INSERT INTO sleep (date, start, end, minutes, deep, light, rem, awake, stages, in_bed, source) VALUES (?,?,?,?,?,?,?,?,?,?, 'health')
        ON CONFLICT(date) DO UPDATE SET start=excluded.start, end=excluded.end, minutes=excluded.minutes, deep=excluded.deep, light=excluded.light, rem=excluded.rem, awake=excluded.awake, stages=excluded.stages, in_bed=excluded.in_bed, source='health'
        WHERE sleep.source != 'manual'`)
        .run(s.date, s.start ?? null, s.end ?? null, s.minutes, s.deep ?? null, s.light ?? null, s.rem ?? null, s.awake ?? null,
          Array.isArray(s.stages) && s.stages.length ? JSON.stringify(s.stages) : null, s.in_bed ?? null);
      res.sleep++;
    }
    const fats = (p.body_fat || []).map(f => ({ t: new Date(f.ts).getTime(), pct: f.pct }));
    for (const w of p.weight || []) {
      if (!(w.kg > 25 && w.kg < 400) || !w.ts) continue;
      const t = new Date(w.ts).getTime();
      const fat = fats.find(f => Math.abs(f.t - t) < 10 * 60000)?.pct ?? null;
      const r = addWeight({ kg: w.kg, fat_pct: fat, ts: w.ts, source: 'health', ext_id: w.id ? `hc:${w.id}` : null });
      if (r.added) res.weight++;
    }
    for (const h of p.resting_hr || []) {
      if (!h.date || !(h.bpm > 20)) continue;
      db.prepare(`INSERT INTO heart (date, resting) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET resting = excluded.resting`).run(h.date, h.bpm);
      res.resting_hr++;
    }
    // Overnight vitals from the watch (HRV ms, blood oxygen %, breaths per minute)
    for (const v of p.vitals || []) {
      if (!v.date) continue;
      db.prepare(`INSERT INTO vitals (date, hrv, spo2, resp) VALUES (?,?,?,?) ON CONFLICT(date) DO UPDATE SET hrv = COALESCE(excluded.hrv, vitals.hrv), spo2 = COALESCE(excluded.spo2, vitals.spo2), resp = COALESCE(excluded.resp, vitals.resp)`)
        .run(v.date, v.hrv ?? null, v.spo2 ?? null, v.resp ?? null);
    }
  });
  db.prepare(`INSERT INTO settings (key, value) VALUES ('last_health_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(new Date().toISOString());
  return res;
}

// ---------------- Workouts ----------------

export function workoutDetail(id) {
  const w = db.prepare('SELECT * FROM workouts WHERE id = ?').get(id);
  if (!w) return null;
  const sets = db.prepare(`SELECT s.*, e.name AS exercise, e.kind, e.muscle FROM sets s JOIN exercises e ON e.id = s.exercise_id WHERE workout_id = ? ORDER BY s.pos, s.id`).all(id);
  // Group by exercise in order of first appearance; attach last-time performance
  const groups = [];
  const byEx = new Map();
  for (const s of sets) {
    if (!byEx.has(s.exercise_id)) {
      const g = { exercise_id: s.exercise_id, exercise: s.exercise, kind: s.kind, muscle: s.muscle, sets: [], previous: previousPerformance(s.exercise_id, id) };
      byEx.set(s.exercise_id, g); groups.push(g);
    }
    byEx.get(s.exercise_id).sets.push(s);
  }
  return { ...w, exercises: groups };
}

export function previousPerformance(exerciseId, excludeWorkoutId = 0) {
  const last = db.prepare(`SELECT w.id, w.date FROM workouts w JOIN sets s ON s.workout_id = w.id
    WHERE s.exercise_id = ? AND w.id != ? AND w.done = 1 AND s.done = 1 ORDER BY w.date DESC, w.id DESC LIMIT 1`).get(exerciseId, excludeWorkoutId);
  if (!last) return null;
  const sets = db.prepare('SELECT reps, kg, minutes, km FROM sets WHERE workout_id = ? AND exercise_id = ? AND done = 1 ORDER BY pos, id').all(last.id, exerciseId);
  return { date: last.date, sets };
}

/** Best estimated 1RM (Epley) per exercise. */
export function personalRecords() {
  return db.prepare(`
    SELECT e.id, e.name, MAX(s.kg * (1 + s.reps / 30.0)) AS e1rm, MAX(s.kg) AS top_kg
    FROM sets s JOIN exercises e ON e.id = s.exercise_id JOIN workouts w ON w.id = s.workout_id
    WHERE s.done = 1 AND s.kg > 0 AND s.reps > 0 AND w.done = 1
    GROUP BY e.id ORDER BY e.name`).all();
}

export function finishWorkout(id, minutes) {
  const w = workoutDetail(id);
  if (!w) return null;
  const kg = latestWeightKg() || 80;
  let kcal = 0;
  let cardioMin = 0;
  for (const g of w.exercises) {
    if (g.kind === 'cardio') {
      for (const s of g.sets.filter(s => s.done)) {
        const m = s.minutes || 0;
        cardioMin += m;
        kcal += (MET[g.exercise] || 6) * kg * (m / 60);
      }
    }
  }
  const mins = Number(minutes) || (w.started ? Math.round((Date.now() - new Date(w.started).getTime()) / 60000) : 45);
  const strengthMin = Math.max(0, mins - cardioMin);
  kcal += STRENGTH_MET * kg * (strengthMin / 60) * (w.exercises.some(g => g.kind !== 'cardio') ? 1 : 0);
  db.prepare('UPDATE workouts SET done = 1, minutes = ?, kcal = ? WHERE id = ?').run(mins, Math.round(kcal), id);
  return workoutDetail(id);
}

export function startWorkout({ name, routine_id, date }) {
  return tx(() => {
    let title = name || 'Workout';
    let items = [];
    if (routine_id) {
      const r = db.prepare('SELECT * FROM routines WHERE id = ?').get(routine_id);
      if (r) { title = r.name; items = JSON.parse(r.items); }
    }
    const res = db.prepare(`INSERT INTO workouts (id, date, name, started) VALUES (?, ?, ?, ?)`).run(newId(), date || today(), title, new Date().toISOString());
    const wid = res.lastInsertRowid;
    let pos = 0;
    for (const it of items) {
      const prev = previousPerformance(it.exercise_id);
      for (let i = 0; i < (it.sets || 3); i++) {
        const p = prev?.sets[i] || prev?.sets[prev.sets.length - 1];
        db.prepare('INSERT INTO sets (id, workout_id, exercise_id, pos, reps, kg, minutes) VALUES (?, ?,?,?,?,?,?)')
          .run(newId(), wid, it.exercise_id, pos++, p?.reps ?? it.reps ?? null, p?.kg ?? null, p?.minutes ?? it.minutes ?? null);
      }
    }
    return workoutDetail(wid);
  });
}

export function addExerciseToWorkout(workoutId, exerciseId) {
  const ex = db.prepare('SELECT * FROM exercises WHERE id = ?').get(exerciseId);
  const prev = previousPerformance(exerciseId, workoutId);
  const pos = (db.prepare('SELECT MAX(pos) p FROM sets WHERE workout_id = ?').get(workoutId).p ?? -1) + 1;
  const n = ex.kind === 'cardio' ? 1 : Math.max(prev?.sets.length || 3, 1);
  for (let i = 0; i < n; i++) {
    const p = prev?.sets[i] || prev?.sets[prev?.sets.length - 1];
    db.prepare('INSERT INTO sets (id, workout_id, exercise_id, pos, reps, kg, minutes, km) VALUES (?, ?,?,?,?,?,?,?)')
      .run(newId(), workoutId, exerciseId, pos, p?.reps ?? (ex.kind === 'cardio' ? null : 10), p?.kg ?? null, p?.minutes ?? (ex.kind === 'cardio' ? 20 : null), p?.km ?? null);
  }
  return workoutDetail(workoutId);
}

export function unitsKg(v) {
  return getSettings().units === 'lb' ? v / 2.20462 : v;
}
