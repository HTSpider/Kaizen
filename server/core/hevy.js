// Imports workouts from Hevy (needs Hevy Pro: key from hevy.com/settings?developer).
// Ids are derived from Hevy's ids, so the PC and the phone import a workout as the same rows.
import { db, getSecret, setSetting, tx } from './db.js';
import { finishWorkout } from './logic.js';
import { localDate } from './stats.js';
import { stableId } from './ids.js';

const BASE = 'https://api.hevyapp.com/v1';

const clean = t => String(t || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

export function exerciseFor(title, sets) {
  const want = clean(title);
  const all = db.prepare('SELECT id, name, kind FROM exercises').all();
  const hit = all.find(e => e.name.toLowerCase() === String(title).toLowerCase()) || all.find(e => clean(e.name) === want);
  if (hit) return hit.id;
  const cardio = sets.some(s => (s.distance_meters || s.duration_seconds) && !s.weight_kg && !s.reps);
  const bodyweight = !cardio && sets.every(s => !s.weight_kg);
  const id = stableId('hevy-ex:' + String(title).toLowerCase());
  db.prepare('INSERT OR IGNORE INTO exercises (id, name, muscle, kind) VALUES (?, ?, ?, ?)')
    .run(id, String(title), 'Other', cardio ? 'cardio' : bodyweight ? 'bodyweight' : 'strength');
  return db.prepare('SELECT id FROM exercises WHERE id = ? OR name = ?').get(id, String(title)).id;
}

function importWorkout(w) {
  const wid = stableId('hevy:' + w.id);
  const start = new Date(w.start_time), end = new Date(w.end_time || w.start_time);
  const minutes = Math.max(1, Math.round((end - start) / 60000));
  tx(() => {
    db.prepare('DELETE FROM sets WHERE workout_id = ?').run(wid);
    db.prepare(`INSERT INTO workouts (id, date, name, started, minutes, notes, done, ext_id) VALUES (?,?,?,?,?,?,1,?)
      ON CONFLICT(id) DO UPDATE SET date = excluded.date, name = excluded.name, started = excluded.started, minutes = excluded.minutes, notes = excluded.notes, done = 1, ext_id = excluded.ext_id`)
      .run(wid, localDate(start), w.title || 'Workout', start.toISOString(), minutes, w.description || null, 'hevy:' + w.id);
    for (const ex of [...(w.exercises || [])].sort((a, b) => a.index - b.index)) {
      const sets = ex.sets || [];
      const exId = exerciseFor(ex.title, sets);
      for (const s of [...sets].sort((a, b) => a.index - b.index)) {
        db.prepare('INSERT INTO sets (id, workout_id, exercise_id, pos, reps, kg, minutes, km, done) VALUES (?,?,?,?,?,?,?,?,1)')
          .run(stableId(`hevy:${w.id}:${ex.index}:${s.index}`), wid, exId, ex.index * 1000 + s.index,
            s.reps ?? null, s.weight_kg ?? null,
            s.duration_seconds ? Math.round(s.duration_seconds / 6) / 10 : null,
            s.distance_meters ? Math.round(s.distance_meters / 10) / 100 : null);
      }
    }
  });
  finishWorkout(wid, minutes); // calorie estimate, same as workouts logged in Kaizen
}

let running = null;
/** Pull new, changed and deleted Hevy workouts since the last check. */
export function syncHevy() {
  const key = getSecret('hevy_key');
  if (!key) return Promise.resolve({ enabled: false });
  if (running) return running;
  running = (async () => {
    const since = getSecret('sync_hevy_since') || '1970-01-01T00:00:00Z';
    const startedAt = new Date().toISOString();
    let imported = 0, deleted = 0;
    try {
      for (let page = 1; page <= 100; page++) {
        const r = await fetch(`${BASE}/workouts/events?page=${page}&pageSize=10&since=${encodeURIComponent(since)}`, { headers: { 'api-key': key, accept: 'application/json' } });
        if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Hevy rejected the API key. It needs Hevy Pro; get the key at hevy.com/settings?developer.'), { status: 400 });
        if (r.status === 404 && page > 1) break;
        if (!r.ok) throw Object.assign(new Error(`Hevy error ${r.status}`), { status: 502 });
        const j = await r.json();
        for (const ev of j.events || []) {
          if (ev.type === 'deleted' && ev.id) {
            db.prepare('DELETE FROM workouts WHERE ext_id = ?').run('hevy:' + ev.id); deleted++;
          } else if (ev.workout) { importWorkout(ev.workout); imported++; }
        }
        if (!j.page_count || page >= j.page_count) break;
      }
      setSetting('sync_hevy_since', startedAt);
      setSetting('sync_hevy_last', JSON.stringify({ at: startedAt, imported, deleted, error: null }));
      return { enabled: true, imported, deleted };
    } catch (e) {
      setSetting('sync_hevy_last', JSON.stringify({ at: new Date().toISOString(), imported, deleted, error: e.message }));
      throw e;
    } finally { running = null; }
  })();
  return running;
}

export function hevyStatus() {
  let last = null;
  try { last = JSON.parse(getSecret('sync_hevy_last') || 'null'); } catch {}
  return { enabled: !!getSecret('hevy_key'), last };
}
