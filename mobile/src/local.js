// The phone's own Kaizen: the same core logic as the PC, on a local SQLite database (sql.js),
// saved to the phone's storage. Works with no PC and no internet; cloud sync merges later.
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import { initDb, getSettings, getSecret } from '../../server/core/db.js';
import { handle as route } from '../../server/core/routes.js';
import { chatTurn, friendlyError } from '../../server/core/ai.js';
import * as Sync from '../../server/core/sync.js';

let sdb = null;

// ---------- IndexedDB persistence ----------
const IDB = 'kaizen', STORE = 'files', KEY = 'kaizen.db';
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function loadBytes() {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const q = d.transaction(STORE).objectStore(STORE).get(KEY);
    q.onsuccess = () => resolve(q.result || null);
    q.onerror = () => reject(q.error);
  });
}
async function saveBytes(bytes) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(bytes, KEY);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

// ---------- node:sqlite-style wrapper around sql.js, so the core code runs unchanged ----------
const clean = p => p.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
function wrap(d) {
  return {
    exec: sql => { d.exec(sql); },
    prepare: sql => ({
      get(...p) {
        const st = d.prepare(sql);
        try { st.bind(clean(p)); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
      },
      all(...p) {
        const st = d.prepare(sql);
        const out = [];
        try { st.bind(clean(p)); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
        return out;
      },
      run(...p) {
        d.run(sql, clean(p));
        const changes = d.getRowsModified();
        const id = d.exec('SELECT last_insert_rowid()')[0]?.values[0][0];
        return { lastInsertRowid: id, changes };
      },
    }),
  };
}

// ---------- save on change ----------
let saving = null;
function changedSinceSave() {
  try { return d0().exec('SELECT total_changes()')[0].values[0][0] > 0; } catch { return false; }
}
const d0 = () => sdb;
export async function saveNow() {
  if (!sdb || saving) return saving;
  if (!changedSinceSave()) return;
  saving = (async () => {
    try {
      const bytes = sdb.export(); // closes and reopens the database internally
      sdb.exec('PRAGMA foreign_keys = ON;');
      await saveBytes(bytes);
    } finally { saving = null; }
  })();
  return saving;
}

export async function open() {
  const SQL = await initSqlJs({ locateFile: f => f });
  const bytes = await loadBytes().catch(() => null);
  sdb = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
  initDb(wrap(sdb));
  await saveNow();
  setInterval(() => { saveNow().catch(() => {}); }, 4000);
}

// ---------- Claude subscription: AI runs through Kaizen on the PC (Claude Code), over home Wi-Fi ----------
const usingSubscription = () => (getSettings().ai_provider || 'subscription') === 'subscription';
const NEED_PC = "The coach uses your Claude subscription through Kaizen on your PC. Open Kaizen on your PC and connect to your home Wi-Fi.";
function lanPc() {
  const url = getSecret('sync_lan') || localStorage.getItem('kz_server');
  const key = getSecret('sync_lan_key') || localStorage.getItem('kz_key') || '';
  return url ? { url: url.replace(/\/+$/, ''), key } : null;
}
async function pcFetch(path, init = {}, timeoutMs = 120000) {
  const pc = lanPc();
  if (!pc) { const e = new Error(NEED_PC); e.status = 503; throw e; }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(pc.url + path, { ...init, signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'X-Kaizen-Key': pc.key, ...(init.headers || {}) } });
  } catch { const e = new Error(NEED_PC); e.status = 503; throw e; }
  finally { clearTimeout(t); }
}

/** Same contract as the PC server's HTTP API, but in-process. */
export async function handle(method, pathWithQuery, body) {
  const u = new URL(pathWithQuery, 'http://local');
  try {
    if ((u.pathname === '/api/ai/estimate' || u.pathname === '/api/checkins/now') && usingSubscription()) {
      const r = await pcFetch(u.pathname, { method: 'POST', body: JSON.stringify(body || {}) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(data.error || NEED_PC); e.status = r.status; throw e; }
      return data;
    }
    return await route({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: body || {} });
  } catch (e) {
    const err = new Error(e.message || 'Error'); err.status = e.status || 500; throw err;
  }
}

/** Coach chat, streamed through the same events as the PC server. */
export async function chat(text, on) {
  if (usingSubscription()) {
    try {
      // The PC stores the conversation; it reaches this phone with the next sync
      await Sync.syncNow().catch(() => {});
      const r = await pcFetch('/api/chat', { method: 'POST', body: JSON.stringify({ text }) }, 180000);
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || NEED_PC); }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(chunk)?.[1], data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (ev && data) on(ev, JSON.parse(data));
        }
      }
      setTimeout(() => Sync.syncNow().catch(() => {}), 3000);
    } catch (e) { on('error', { message: e.message || NEED_PC }); }
    return;
  }
  try { await chatTurn(text, on); Sync.syncSoon(); }
  catch (e) { on('error', { message: friendlyError(e) }); }
}

export { Sync };
