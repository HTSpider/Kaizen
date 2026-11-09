// Cloud sync through the user's own Supabase project, end-to-end encrypted.
// Each device pushes its changes as encrypted batches and pulls everyone else's.
// Supabase only ever stores ciphertext; the key lives on the user's devices.
import { db, getSecret, setSetting } from './db.js';
import { collectChanges, markSent, applyChanges, queueEverything, pendingCount } from './syncdb.js';

export const SETUP_SQL = `create table if not exists public.kaizen_sync (
  id bigint generated always as identity primary key,
  vault text not null,
  device text not null,
  blob text not null,
  created_at timestamptz not null default now()
);
create index if not exists kaizen_sync_vault_id on public.kaizen_sync (vault, id);
alter table public.kaizen_sync enable row level security;
drop policy if exists "kaizen read" on public.kaizen_sync;
drop policy if exists "kaizen add" on public.kaizen_sync;
create policy "kaizen read" on public.kaizen_sync for select to anon using (true);
create policy "kaizen add" on public.kaizen_sync for insert to anon with check (length(blob) < 4000000);
grant select, insert on public.kaizen_sync to anon;`;

const S = k => getSecret('sync_' + k);
const setS = (k, v) => setSetting('sync_' + k, v);

// ---------- base64 + AES-GCM (WebCrypto works on both Node and the phone) ----------
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) { const s = atob(str); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
const subtle = () => globalThis.crypto.subtle;
let keyCache = { raw: null, key: null };
async function aesKey() {
  const raw = S('key');
  if (keyCache.raw !== raw) keyCache = { raw, key: await subtle().importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']) };
  return keyCache.key;
}
async function encrypt(obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await aesKey(), data));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
async function decrypt(blob) {
  const all = unb64(blob);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, await aesKey(), all.subarray(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
const randomB64 = n => b64(globalThis.crypto.getRandomValues(new Uint8Array(n)));
const randomId = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

// ---------- Supabase REST ----------
async function rest(path, { method = 'GET', body, url = S('url'), key = S('anon') } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/${path}`, {
      method, signal: ctl.signal,
      headers: { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const e = new Error(r.status === 404 || /relation .* does not exist|Could not find the table/i.test(text)
        ? 'The kaizen_sync table is missing. Run the setup SQL in Supabase.'
        : r.status === 401 ? 'Supabase rejected the key. Use the publishable (anon) key.' : `Supabase error ${r.status}: ${text.slice(0, 200)}`);
      e.status = r.status; throw e;
    }
    return method === 'GET' ? r.json() : null;
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof TypeError) { const x = new Error('Could not reach Supabase. Check the internet connection.'); x.offline = true; throw x; }
    throw e;
  } finally { clearTimeout(t); }
}

// ---------- public API ----------
export function isLinked() { return !!(S('url') && S('anon') && S('vault') && S('key')); }

export function status() {
  return {
    linked: isLinked(),
    url: S('url') || null,
    last_sync: S('last_ok') || null,
    last_error: S('last_error') || null,
    pending: pendingCount(db),
    device: S('device') || null,
  };
}

/** First device: check the project works, create the vault + key, queue all data. */
export async function setup({ url, key }) {
  url = String(url || '').trim().replace(/\/+$/, '');
  key = String(key || '').trim();
  if (!/^(https:\/\/.+|http:\/\/localhost[:/].*)/.test(url) || !key) { const e = new Error('Enter the Project URL and publishable key from Supabase.'); e.status = 400; throw e; }
  await rest('kaizen_sync?select=id&limit=1', { url, key });
  setS('url', url); setS('anon', key);
  if (!S('vault')) { setS('vault', randomId()); setS('key', randomB64(32)); }
  if (!S('device')) setS('device', randomId().slice(0, 12));
  setS('pulled', '0');
  queueEverything(db);
  return syncNow();
}

/** Link code for another device: everything it needs to join this vault. */
export function linkCode(extra = {}) {
  if (!isLinked()) return null;
  return 'KZ1.' + b64(new TextEncoder().encode(JSON.stringify({ u: S('url'), k: S('anon'), v: S('vault'), e: S('key'), ...extra })));
}

/** Second device: join the vault from a link code. Local data is merged in. */
export async function join(code) {
  let p;
  try { p = JSON.parse(new TextDecoder().decode(unb64(String(code).trim().replace(/^KZ1\./, '')))); }
  catch { const e = new Error("That isn't a Kaizen sync code."); e.status = 400; throw e; }
  if (!p.u || !p.k || !p.v || !p.e) { const e = new Error("That isn't a Kaizen sync code."); e.status = 400; throw e; }
  await rest('kaizen_sync?select=id&limit=1', { url: p.u, key: p.k });
  queueEverything(db); // anything already on this device gets merged up
  setS('url', p.u); setS('anon', p.k); setS('vault', p.v); setS('key', p.e);
  if (!S('device')) setS('device', randomId().slice(0, 12));
  if (p.l) setS('lan', p.l);
  if (p.p) setS('lan_key', p.p);
  setS('pulled', '0');
  return syncNow();
}

export function unlink() {
  for (const k of ['url', 'anon', 'vault', 'key', 'pulled', 'last_ok', 'last_error']) db.prepare('DELETE FROM settings WHERE key = ?').run('sync_' + k);
  db.exec('DELETE FROM sync_out');
}

let running = null;
/** Pull then push. Safe to call often; concurrent calls share one run. */
export function syncNow() {
  if (!isLinked()) return Promise.resolve(status());
  if (running) return running;
  running = (async () => {
    let pulled = 0, pushed = 0;
    try {
      // Pull everything newer than what we've seen
      const vault = S('vault'), me = S('device');
      for (;;) {
        const since = Number(S('pulled') || 0);
        const rows = await rest(`kaizen_sync?select=id,device,blob&vault=eq.${vault}&id=gt.${since}&order=id.asc&limit=100`);
        if (!rows.length) break;
        for (const row of rows) {
          if (row.device !== me) {
            let ops = null;
            try { ops = await decrypt(row.blob); } catch { /* not ours / corrupted: skip */ }
            if (Array.isArray(ops)) { applyChanges(db, ops); pulled += ops.length; }
          }
          setS('pulled', String(row.id));
        }
        if (rows.length < 100) break;
      }
      // Push our changes in batches
      for (;;) {
        const { ops, upTo } = collectChanges(db);
        if (!ops.length) break;
        await rest('kaizen_sync', { method: 'POST', body: { vault, device: me, blob: await encrypt(ops) } });
        markSent(db, upTo);
        pushed += ops.length;
      }
      setS('last_ok', new Date().toISOString());
      db.prepare("DELETE FROM settings WHERE key = 'sync_last_error'").run();
    } catch (e) {
      setS('last_error', e.message);
      throw e;
    } finally { running = null; }
    return { ...status(), pulled, pushed };
  })();
  return running;
}

/** Schedule a sync shortly after local changes. */
let timer = null;
export function syncSoon(ms = 15000) {
  if (!isLinked()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), ms);
}
