// Change tracking for sync: SQLite triggers record which rows changed, so every write
// (from any screen or feature) is picked up without each feature having to remember.

// Synced tables and their primary key.
export const SYNC_TABLES = {
  settings: 'key', weights: 'id', foods: 'id', food_logs: 'id', meals: 'id', water: 'date',
  exercises: 'id', workouts: 'id', sets: 'id', routines: 'id', steps: 'date', sleep: 'date',
  heart: 'date', vitals: 'date', photos: 'id', checkins: 'week', measurements: 'id', fasts: 'id', chat_msgs: 'id',
};

// Settings that belong to one device only (sync credentials, LAN pairing).
const LOCAL_SETTING = `(%s.key LIKE 'sync\\_%%' ESCAPE '\\' OR %s.key = 'pair_key')`;

export function installSync(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_out (id INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, pk TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_flag (applying INTEGER NOT NULL);
    INSERT INTO sync_flag (applying) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM sync_flag);
    UPDATE sync_flag SET applying = 0;
  `);
  for (const [t, pk] of Object.entries(SYNC_TABLES)) {
    for (const [ev, ref] of [['INSERT', 'NEW'], ['UPDATE', 'NEW'], ['DELETE', 'OLD']]) {
      const skip = t === 'settings' ? ` AND NOT ${LOCAL_SETTING.replaceAll('%s', ref).replaceAll('%%', '%')}` : '';
      db.exec(`CREATE TRIGGER IF NOT EXISTS sync_${t}_${ev.toLowerCase()} AFTER ${ev} ON ${t}
        WHEN (SELECT applying FROM sync_flag) = 0${skip}
        BEGIN INSERT INTO sync_out (tbl, pk) VALUES ('${t}', ${ref}.${pk}); END;`);
    }
  }
}

/** Queue every existing row, used the first time a device joins sync. */
export function queueEverything(db) {
  for (const [t, pk] of Object.entries(SYNC_TABLES)) {
    const where = t === 'settings' ? ` WHERE NOT ${LOCAL_SETTING.replaceAll('%s', 'settings').replaceAll('%%', '%')}`
      : t === 'exercises' ? ' WHERE id > 100000' // built-in exercises are identical on every device
      : '';
    db.exec(`INSERT INTO sync_out (tbl, pk) SELECT '${t}', ${pk} FROM ${t}${where}`);
  }
}

/** Collect pending changes as ops: {t, r: row} for upserts, {t, d: pk} for deletes. */
export function collectChanges(db, limit = 400, maxBytes = 2_500_000) {
  const rows = db.prepare(`SELECT tbl, pk, MAX(id) AS last FROM sync_out GROUP BY tbl, pk ORDER BY last LIMIT ?`).all(limit);
  if (!rows.length) return { ops: [], upTo: 0 };
  let bytes = 0, upTo = 0;
  const ops = [];
  for (const r of rows) {
    const pk = SYNC_TABLES[r.tbl];
    if (!pk) continue;
    const row = db.prepare(`SELECT * FROM ${r.tbl} WHERE ${pk} = ?`).get(r.pk);
    const op = row ? { t: r.tbl, r: { ...row } } : { t: r.tbl, d: r.pk };
    const size = JSON.stringify(op).length;
    if (ops.length && bytes + size > maxBytes) break; // the rest goes in the next batch
    ops.push(op); bytes += size; upTo = Math.max(upTo, r.last);
  }
  return { ops, upTo };
}

export function markSent(db, upTo) {
  // Rows changed again after this batch keep a newer entry and go in the next one
  db.prepare(`DELETE FROM sync_out WHERE id <= ?`).run(upTo);
}

export function pendingCount(db) {
  return db.prepare('SELECT COUNT(DISTINCT tbl || pk) AS n FROM sync_out').get().n;
}

/** Apply ops from another device without re-queueing them. Last writer wins. */
export function applyChanges(db, ops) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec('UPDATE sync_flag SET applying = 1');
    for (const op of ops) {
      const pk = SYNC_TABLES[op.t];
      if (!pk) continue;
      if (op.d != null) { db.prepare(`DELETE FROM ${op.t} WHERE ${pk} = ?`).run(op.d); continue; }
      const cols = Object.keys(op.r).filter(c => /^[a-z_]+$/.test(c));
      const sql = `INSERT INTO ${op.t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
        ON CONFLICT(${pk}) DO UPDATE SET ${cols.filter(c => c !== pk).map(c => `${c} = excluded.${c}`).join(', ') || `${pk} = excluded.${pk}`}`;
      const vals = cols.map(c => op.r[c]);
      try { db.prepare(sql).run(...vals); }
      catch (e) {
        // The same thing recorded on both devices under different ids (a weigh-in, an online food,
        // an exercise name): keep the incoming row and drop the local duplicate, then retry.
        const m = /UNIQUE constraint failed: ([\w., ]+)/.exec(String(e.message || e));
        const clashCols = m ? m[1].split(',').map(s => s.trim().split('.')[1]).filter(c => c && c !== pk && c in op.r) : [];
        try {
          if (!clashCols.length) throw e;
          db.prepare(`DELETE FROM ${op.t} WHERE ${clashCols.map(c => `${c} IS ?`).join(' AND ')} AND ${pk} != ?`)
            .run(...clashCols.map(c => op.r[c]), op.r[pk]);
          db.prepare(sql).run(...vals);
        } catch (e2) {
          // Never let one bad row block everything else from syncing
          console.warn(`sync: skipped a ${op.t} row`, e2.message || e2);
        }
      }
    }
    db.exec('UPDATE sync_flag SET applying = 0');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    db.exec('UPDATE sync_flag SET applying = 0');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
