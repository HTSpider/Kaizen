// API client: same-origin on the PC, configured server address in the phone app.
export const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
export { store };

export function serverUrl() { return (store.get('kz_server') || '').replace(/\/+$/, ''); }
export function pairKey() { return store.get('kz_key') || ''; }
export function setServer(url, key) { store.set('kz_server', url.trim()); store.set('kz_key', key.trim()); needsPair = false; }

// Set when the PC answers 401: this device has no (or a wrong) pair code.
let needsPair = false;
const pairListeners = new Set();
export function onNeedsPair(fn) { pairListeners.add(fn); }
/** The phone app needs an address; any device that isn't the PC itself needs a pair code. */
export function isConfigured() { return local ? true : (!isNative || !!serverUrl()) && !needsPair; }

// The phone app runs Kaizen itself: requests go to the in-app engine instead of the network.
let local = null;
export function setLocal(backend) { local = backend; }
export function isLocal() { return !!local; }

function base() { return isNative ? serverUrl() : ''; }
function headers(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  if (pairKey()) h['X-Kaizen-Key'] = pairKey();
  return h;
}

export class OfflineError extends Error {}
export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

let online = true;
const listeners = new Set();
export function onConnection(fn) { listeners.add(fn); }
function setOnline(v) { if (online !== v) { online = v; listeners.forEach(f => f(v)); } }
export function isOnline() { return online; }

async function request(path, { method = 'GET', body, timeout = 15000 } = {}) {
  if (local) {
    try { return await local.handle(method, path, body); }
    catch (e) { throw new ApiError(e.status || 500, e.message); }
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(base() + path, { method, headers: headers(), body: body != null ? JSON.stringify(body) : undefined, signal: ctl.signal });
  } catch (e) {
    setOnline(false);
    throw new OfflineError('Offline');
  } finally { clearTimeout(t); }
  setOnline(true);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !needsPair) { needsPair = true; pairListeners.forEach(f => f()); }
  if (!res.ok) throw new ApiError(res.status, data.error || `Error ${res.status}`);
  return data;
}

// ---- GET with a local cache so screens render instantly ----
export function cached(path) {
  const v = store.get('kz_c:' + path);
  try { return v ? JSON.parse(v) : null; } catch { return null; }
}
export async function get(path) {
  const data = await request(path);
  store.set('kz_c:' + path, JSON.stringify(data));
  return data;
}

// ---- writes, queued when offline ----
function outbox() { try { return JSON.parse(store.get('kz_outbox') || '[]'); } catch { return []; } }
function saveOutbox(q) { store.set('kz_outbox', JSON.stringify(q)); }
export function pendingCount() { return outbox().length; }

export async function send(method, path, body, { queue = true } = {}) {
  try {
    return await request(path, { method, body });
  } catch (e) {
    if (e instanceof OfflineError && queue) {
      const q = outbox(); q.push({ method, path, body, at: Date.now() }); saveOutbox(q);
      e.queued = true;
    }
    throw e;
  }
}
export const post = (p, b, o) => send('POST', p, b ?? {}, o);
export const patch = (p, b, o) => send('PATCH', p, b ?? {}, o);
export const del = (p, o) => send('DELETE', p, undefined, o);

let flushing = false;
export async function flushOutbox() {
  if (flushing) return 0;
  const q = outbox();
  if (!q.length) return 0;
  flushing = true;
  let done = 0;
  try {
    while (q.length) {
      const item = q[0];
      try { await request(item.path, { method: item.method, body: item.body }); }
      catch (e) { if (e instanceof OfflineError) break; /* drop requests the server rejects */ }
      q.shift(); done++; saveOutbox(q);
    }
  } finally { flushing = false; }
  return done;
}

// ---- streaming chat (Server-Sent Events over fetch) ----
export async function streamChat(text, on) {
  if (local) return local.chat(text, on);
  const res = await fetch(base() + '/api/chat', { method: 'POST', headers: headers(), body: JSON.stringify({ text }) });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(res.status, d.error || 'Chat failed'); }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (ev && data) on(ev, JSON.parse(data));
    }
  }
}
