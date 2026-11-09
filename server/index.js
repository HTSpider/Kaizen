// Kaizen on the PC: opens the local database, serves the app to the PC window,
// syncs with the cloud, and serves app updates to the phone on the home network.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { initDb, getSecret, setSetting } from './core/db.js';
import { GET, HttpError, handle, setLinkExtras } from './core/routes.js';
import { chatTurn, friendlyError, setSubscriptionBackend, maybeWeeklyCheckin } from './core/ai.js';
import * as ClaudeCode from './claudecode.js';
import * as Sync from './core/sync.js';
import { syncHevy } from './core/hevy.js';
import { webVersion, webZip } from './webversion.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(here, '..', 'web');
const PORT = Number(process.env.KAIZEN_PORT || 5177);
export const DATA_DIR = process.env.KAIZEN_DATA || path.join(here, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new DatabaseSync(path.join(DATA_DIR, 'kaizen.db'));
sqlite.exec('PRAGMA journal_mode = WAL;');
initDb(sqlite);

// Key for phones on the home network (used for app updates and the old direct mode)
let PAIR = getSecret('pair_key');
if (!PAIR) { PAIR = crypto.randomBytes(5).toString('hex'); setSetting('pair_key', PAIR); }

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}
// A phone linked through the PC's QR code can also pull app updates from this PC
setLinkExtras(() => ({ l: lanUrls()[0], p: PAIR }));

// The coach and food estimates use the Claude subscription through Claude Code on this PC
setSubscriptionBackend({ ask: ClaudeCode.ask });

// PC-only routes
GET('/api/ai/status', async () => ({ subscription: await ClaudeCode.status() }));
GET('/api/pair', ({ req }) => {
  if (!isLocal(req)) throw new HttpError(403, 'Only available on the PC');
  return { code: PAIR, urls: lanUrls(), apk: fs.existsSync(path.join(DATA_DIR, 'kaizen.apk')) };
});
GET('/api/ping', () => ({ ok: true, app: 'kaizen' }));
// checksum: SHA-256 of the update zip, which the phone's updater requires before installing it
GET('/api/app-version', () => { const { version, checksum } = webZip(WEB); return { version, checksum }; });
GET('/api/sync/qr', async ({ req }) => {
  if (!isLocal(req)) throw new HttpError(403, 'Only available on the PC');
  const code = Sync.linkCode({ l: lanUrls()[0], p: PAIR });
  if (!code) throw new HttpError(400, 'Set up sync first');
  return { code, svg: await QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#121417', light: '#FFFFFF' } }) };
});

// ---------------- HTTP plumbing ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.apk': 'application/vnd.android.package-archive' };

function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': typeof data === 'object' && !Buffer.isBuffer(data) ? 'application/json' : 'text/plain', ...headers });
  res.end(body);
}

function readBody(req, limit = 15e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  if (pathname === '/app-bundle.zip') {
    const { zip, version } = webZip(WEB);
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zip.length, 'X-Bundle-Version': version, 'Cache-Control': 'no-store' });
    return res.end(zip);
  }
  if (pathname === '/bundle-version.txt') return send(res, 200, webVersion(WEB));
  if (pathname === '/kaizen.apk') {
    const apk = path.join(DATA_DIR, 'kaizen.apk');
    if (!fs.existsSync(apk)) return send(res, 404, 'Not built yet');
    res.writeHead(200, { 'Content-Type': MIME['.apk'], 'Content-Disposition': 'attachment; filename="kaizen.apk"', 'Content-Length': fs.statSync(apk).size });
    return fs.createReadStream(apk).pipe(res);
  }
  let file = path.normalize(path.join(WEB, decodeURIComponent(pathname)));
  if (!file.startsWith(WEB)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Kaizen-Key',
  'Access-Control-Max-Age': '86400',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  if (!isLocal(req)) {
    res.on('finish', () => console.log(`${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${pathname} ${res.statusCode}`));
  }
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  if (pathname !== '/api/ping' && !isLocal(req) && req.headers['x-kaizen-key'] !== PAIR) {
    return send(res, 401, { error: 'Not paired. Enter the pair code from the PC app.' });
  }

  try {
    if (req.method === 'POST' && pathname === '/api/chat') {
      const body = await readBody(req);
      if (!body.text?.trim()) throw new HttpError(400, 'Message required');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      try { await chatTurn(body.text.trim(), emit); Sync.syncSoon(); }
      catch (e) { console.error(e); emit('error', { message: friendlyError(e) }); }
      return res.end();
    }
    const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const result = await handle({ method: req.method, path: pathname, query: Object.fromEntries(url.searchParams), body, req });
    send(res, 200, result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    send(res, status, { error: e.message || 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kaizen running on http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  phone: ${u}  (pair code ${PAIR})`);
});

// Sync with the cloud on start and every 5 minutes while running
const quietSync = () => Sync.syncNow().catch(e => console.log('sync:', e.message));
setTimeout(quietSync, 2000);
setInterval(quietSync, 5 * 60 * 1000);

// Hevy: check every 20 minutes (at an odd second, as Hevy asks) and soon after start
const hevyNow = () => syncHevy().then(r => { if (r.imported || r.deleted) Sync.syncSoon(3000); }).catch(e => console.log('hevy:', e.message));
setTimeout(hevyNow, 8000 + Math.random() * 20000);
setInterval(hevyNow, 20 * 60 * 1000 + Math.floor(Math.random() * 60000));

// Sunday check-in: written once a week (Sunday from 6 pm, or the next time the PC is on)
const checkinNow = () => maybeWeeklyCheckin().then(r => { if (r) { console.log('check-in written for', r.week); Sync.syncSoon(3000); } }).catch(e => console.log('check-in:', e.message));
setTimeout(checkinNow, 60000);
setInterval(checkinNow, 30 * 60 * 1000);
