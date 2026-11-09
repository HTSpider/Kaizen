// Workouts from other apps without needing Hevy Pro:
//  - Health Connect sessions (Hevy writes name-less sessions with time + calories), imported automatically
//  - Hevy's free CSV export (every set), imported on demand
// Both key the workout by its start minute, so the CSV fills sets into the same workout, never a duplicate.
import { db, tx } from './db.js';
import { finishWorkout } from './logic.js';
import { localDate } from './stats.js';
import { stableId } from './ids.js';
import { exerciseFor } from './hevy.js';

const minuteKey = iso => new Date(iso).toISOString().slice(0, 16);
export const workoutIdFor = startIso => stableId('workout-start:' + minuteKey(startIso));

const TYPE_NAMES = {
  strengthTraining: 'Strength workout', traditionalStrengthTraining: 'Strength workout', functionalStrengthTraining: 'Strength workout',
  weightlifting: 'Weightlifting', running: 'Run', walking: 'Walk', cycling: 'Ride', hiking: 'Hike', swimming: 'Swim',
  highIntensityIntervalTraining: 'HIIT', yoga: 'Yoga', other: 'Workout',
};

/** Health Connect sessions: [{id, start, end, kcal, type, source}] */
export function importHealthWorkouts(list) {
  let n = 0;
  for (const w of list || []) {
    if (!w.start || !w.end) continue;
    const id = workoutIdFor(w.start);
    const minutes = Math.max(1, Math.round((new Date(w.end) - new Date(w.start)) / 60000));
    const kcal = w.kcal ? Math.round(w.kcal) : null;
    const name = /hevy/i.test(w.source || '') ? 'Hevy workout' : TYPE_NAMES[w.type] || 'Workout';
    const existing = db.prepare('SELECT id, kcal FROM workouts WHERE id = ?').get(id);
    if (existing) {
      // Keep names and sets from a CSV import; fill in the watch/app's calories
      if (kcal) db.prepare('UPDATE workouts SET kcal = ? WHERE id = ?').run(kcal, id);
    } else {
      db.prepare('INSERT INTO workouts (id, date, name, started, minutes, kcal, done, ext_id) VALUES (?,?,?,?,?,?,1,?)')
        .run(id, localDate(new Date(w.start)), name, new Date(w.start).toISOString(), minutes, kcal, w.id ? 'hc:' + w.id : null);
      n++;
    }
  }
  return n;
}

// ---------- Hevy CSV ----------
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** Hevy dates look like "8 Nov 2026, 09:05" (local time); ISO also accepted. */
function parseDate(s) {
  s = String(s || '').trim();
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()] != null) return new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function importHevyCsv(text) {
  const rows = parseCsv(String(text || '').replace(/^﻿/, ''));
  if (rows.length < 2) throw Object.assign(new Error('That file has no workouts in it.'), { status: 400 });
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const C = {
    title: col('title', 'workout name'), start: col('start_time', 'date', 'start time'), end: col('end_time', 'end time'),
    desc: col('description'), exercise: col('exercise_title', 'exercise name', 'exercise'),
    index: col('set_index', 'set order'), type: col('set_type'),
    kg: col('weight_kg', 'weight (kg)'), lbs: col('weight_lbs', 'weight (lbs)'), reps: col('reps'),
    km: col('distance_km', 'distance (km)'), miles: col('distance_miles'), meters: col('distance (m)', 'distance_meters'),
    secs: col('duration_seconds', 'duration (s)'),
  };
  if (C.start < 0 || C.exercise < 0) throw Object.assign(new Error("This doesn't look like a Hevy workout export (CSV)."), { status: 400 });
  const num = (r, i) => { if (i < 0) return null; const v = parseFloat(String(r[i]).replace(',', '.')); return Number.isFinite(v) ? v : null; };

  // Group rows into workouts (by start time), then exercises (in order of appearance)
  const workouts = new Map();
  for (const r of rows.slice(1)) {
    const start = parseDate(r[C.start]);
    if (!start) continue;
    const key = minuteKey(start.toISOString());
    if (!workouts.has(key)) workouts.set(key, { start, end: C.end >= 0 ? parseDate(r[C.end]) : null, title: C.title >= 0 ? r[C.title] : 'Workout', desc: C.desc >= 0 ? r[C.desc] : null, exercises: new Map() });
    const w = workouts.get(key);
    const exName = String(r[C.exercise] || '').trim() || 'Exercise';
    if (!w.exercises.has(exName)) w.exercises.set(exName, []);
    const kg = C.kg >= 0 ? num(r, C.kg) : C.lbs >= 0 && num(r, C.lbs) != null ? num(r, C.lbs) * 0.453592 : null;
    const km = C.km >= 0 ? num(r, C.km) : C.miles >= 0 && num(r, C.miles) != null ? num(r, C.miles) * 1.60934 : C.meters >= 0 && num(r, C.meters) != null ? num(r, C.meters) / 1000 : null;
    w.exercises.get(exName).push({ index: num(r, C.index) ?? w.exercises.get(exName).length, type: C.type >= 0 ? r[C.type] : 'normal', weight_kg: kg, reps: num(r, C.reps), distance_meters: km != null ? km * 1000 : null, duration_seconds: num(r, C.secs) });
  }

  let imported = 0;
  for (const [key, w] of workouts) {
    const id = stableId('workout-start:' + key);
    const end = w.end && w.end > w.start ? w.end : null;
    const minutes = end ? Math.max(1, Math.round((end - w.start) / 60000)) : null;
    const prior = db.prepare('SELECT kcal FROM workouts WHERE id = ?').get(id);
    tx(() => {
      db.prepare('DELETE FROM sets WHERE workout_id = ?').run(id);
      db.prepare(`INSERT INTO workouts (id, date, name, started, minutes, notes, done, ext_id) VALUES (?,?,?,?,?,?,1,?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, date = excluded.date, started = excluded.started, minutes = COALESCE(excluded.minutes, workouts.minutes), notes = COALESCE(excluded.notes, workouts.notes), done = 1`)
        .run(id, localDate(w.start), w.title || 'Workout', w.start.toISOString(), minutes, w.desc || null, 'hevycsv:' + key);
      let exIndex = 0;
      for (const [name, sets] of w.exercises) {
        const exId = exerciseFor(name, sets);
        sets.sort((a, b) => a.index - b.index).forEach((s, i) => {
          db.prepare('INSERT INTO sets (id, workout_id, exercise_id, pos, reps, kg, minutes, km, done) VALUES (?,?,?,?,?,?,?,?,1)')
            .run(stableId(`hevycsv:${key}:${exIndex}:${i}`), id, exId, exIndex * 1000 + i, s.reps, s.weight_kg,
              s.duration_seconds ? Math.round(s.duration_seconds / 6) / 10 : null, s.distance_meters ? Math.round(s.distance_meters / 10) / 100 : null);
        });
        exIndex++;
      }
    });
    if (!prior?.kcal) finishWorkout(id, minutes || 60); // estimate calories unless Health Connect gave them
    imported++;
  }
  return { imported };
}
