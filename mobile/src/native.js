// Native bridge for the Android app: Health Connect sync + barcode scanner.
// Bundled into web/native.bundle.js by esbuild and only loaded inside the app.
import { Health } from '@capgo/capacitor-health';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import * as Local from './local.js';
import { App } from '@capacitor/app';

const READ = ['steps', 'calories', 'sleep', 'weight', 'bodyFat', 'restingHeartRate', 'heartRateVariability', 'oxygenSaturation', 'respiratoryRate', 'workouts'];
const LS = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

let K = null, A = null, toast = () => {};
let status = { available: null, authorized: LS.get('kz_hc_ok') === '1' };
let syncing = false;

const localDate = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const daysAgo = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };

async function checkAvailable() {
  try { const r = await Health.isAvailable(); status.available = !!r.available; }
  catch { status.available = false; }
  return status.available;
}

async function connect() {
  if (!(await checkAvailable())) { toast('Health Connect is not available on this phone'); return false; }
  try {
    const r = await Health.requestAuthorization({ read: READ, write: [] });
    status.authorized = (r.readAuthorized || []).length > 0;
    LS.set('kz_hc_ok', status.authorized ? '1' : '0');
    if (!status.authorized) toast('No Health Connect access was granted');
    else await sync(true);
    return status.authorized;
  } catch (e) { toast('Could not open Health Connect'); return false; }
}

async function readAll(dataType, start, end) {
  try { return (await Health.readSamples({ dataType, startDate: start.toISOString(), endDate: end.toISOString(), limit: 1000, ascending: true })).samples || []; }
  catch { return []; }
}
async function daily(dataType, start, end) {
  try { return (await Health.queryAggregated({ dataType, startDate: start.toISOString(), endDate: end.toISOString(), bucket: 'day', aggregation: 'sum' })).samples || []; }
  catch { return []; }
}

async function sync(manual = false) {
  if (syncing || !status.authorized) { if (manual && !status.authorized) return connect(); return; }
  syncing = true;
  try {
    // New data types were added (sleep vitals): ask Health Connect once for the extra access
    if (LS.get('kz_hc_read') !== READ.join(',')) {
      try { await Health.requestAuthorization({ read: READ, write: [] }); } catch {}
      LS.set('kz_hc_read', READ.join(','));
      LS.set('kz_hc_last', '');
    }
    const last = LS.get('kz_hc_last');
    const back = last ? Math.min(30, Math.max(3, Math.ceil((Date.now() - Number(last)) / 864e5) + 2)) : 30;
    const start = daysAgo(back), end = new Date();

    const [steps, cals, sleep, weight, fat, rhr, hrv, spo2, resp] = await Promise.all([
      daily('steps', start, end), daily('calories', start, end),
      readAll('sleep', daysAgo(back + 1), end), readAll('weight', start, end),
      readAll('bodyFat', start, end), readAll('restingHeartRate', start, end),
      readAll('heartRateVariability', start, end), readAll('oxygenSaturation', start, end), readAll('respiratoryRate', start, end),
    ]);

    const kcalByDay = Object.fromEntries(cals.map(c => [localDate(new Date(c.startDate)), c.value]));
    const payload = {
      steps: steps.map(s => ({ date: localDate(new Date(s.startDate)), count: Math.round(s.value), active_kcal: kcalByDay[localDate(new Date(s.startDate))] ?? null })),
      weight: weight.map(w => ({ ts: w.startDate, kg: /pound|lb/i.test(w.unit || '') ? w.value / 2.20462 : w.value, id: w.platformId || null })),
      body_fat: fat.map(f => ({ ts: f.startDate, pct: f.value })),
      resting_hr: [],
      sleep: [],
    };

    // Resting heart rate: average per day
    const hr = {};
    for (const h of rhr) { const d = localDate(new Date(h.startDate)); (hr[d] ||= []).push(h.value); }
    payload.resting_hr = Object.entries(hr).map(([date, v]) => ({ date, bpm: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }));

    // Sleep: sessions grouped by the morning you woke up
    const nights = {};
    for (const s of sleep) {
      const date = localDate(new Date(s.endDate));
      const n = (nights[date] ||= { date, start: s.startDate, end: s.endDate, minutes: 0, deep: 0, light: 0, rem: 0, awake: 0, staged: false, stages: [] });
      if (s.startDate < n.start) n.start = s.startDate;
      if (s.endDate > n.end) n.end = s.endDate;
      if (s.stages?.length) {
        n.staged = true;
        for (const st of s.stages) {
          const m = st.durationMinutes || 0;
          n.stages.push({ s: st.startDate, e: st.endDate, t: st.stage });
          if (st.stage === 'awake' || st.stage === 'inBed') n.awake += st.stage === 'awake' ? m : 0;
          else { n.minutes += m; if (st.stage === 'deep') n.deep += m; else if (st.stage === 'rem') n.rem += m; else n.light += m; }
        }
      } else if (s.sleepState && s.sleepState !== 'awake' && s.sleepState !== 'inBed') {
        n.minutes += s.value || 0;
      } else if (!s.sleepState) {
        n.minutes += s.value || 0;
      }
    }
    payload.sleep = Object.values(nights).filter(n => n.minutes > 0).map(n => ({
      date: n.date, start: n.start, end: n.end, minutes: Math.round(n.minutes),
      deep: n.staged ? Math.round(n.deep) : null, light: n.staged ? Math.round(n.light) : null,
      rem: n.staged ? Math.round(n.rem) : null, awake: n.staged ? Math.round(n.awake) : null,
      stages: n.stages.sort((a, b) => a.s < b.s ? -1 : 1), in_bed: Math.round((new Date(n.end) - new Date(n.start)) / 60000),
    }));

    // Overnight vitals, averaged per morning
    const per = (list, key) => { for (const x of list) { const d = localDate(new Date(x.endDate || x.startDate)); ((vit[d] ||= {})[key] ||= []).push(x.value); } };
    const vit = {};
    per(hrv, 'hrv'); per(spo2, 'spo2'); per(resp, 'resp');
    const avg = a => a && a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null;
    // Workouts saved to Health Connect by Hevy (name, time and calories; sets come from Hevy's CSV export)
    try {
      const { workouts = [] } = await Health.queryWorkouts({ startDate: start.toISOString(), endDate: end.toISOString(), limit: 200, ascending: true });
      payload.workouts = workouts.filter(w => /hevy/i.test(w.sourceId || w.sourceName || '')).map(w => ({ id: w.platformId || null, start: w.startDate, end: w.endDate, kcal: w.totalEnergyBurned ?? null, type: w.workoutType, source: w.sourceId || w.sourceName }));
    } catch { payload.workouts = []; }
    payload.vitals = Object.entries(vit).map(([date, v]) => ({ date, hrv: avg(v.hrv), spo2: avg(v.spo2), resp: avg(v.resp) }));

    // What Health Connect actually gave us (newest entry + which app wrote it), shown in Settings
    const newest = (list, endKey = 'endDate') => {
      if (!list.length) return null;
      const x = list.reduce((a, b) => ((b[endKey] || b.startDate) > (a[endKey] || a.startDate) ? b : a));
      return { at: x[endKey] || x.startDate, from: x.sourceName || x.sourceId || '', n: list.length };
    };
    LS.set('kz_hc_diag', JSON.stringify({ checked: new Date().toISOString(), days: back,
      sleep: newest(sleep), weight: newest(weight), steps: newest(steps, 'startDate'), workouts: newest(payload.workouts || [], 'end') }));
    const res = await A.post('/api/health/sync', payload);
    LS.set('kz_hc_last', String(Date.now()));
    if (manual) toast(`Synced · ${res.steps} days of steps, ${res.sleep} nights, ${res.weight} new weigh-ins`);
    await K.refresh({ auto: true });
  } catch (e) {
    if (manual) toast(e.queued ? 'Saved, will sync when your PC is reachable' : `Sync failed: ${e.message}`);
  } finally { syncing = false; }
}

async function scanBarcode() {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    toast('Installing the barcode scanner, try again in a moment');
    await BarcodeScanner.installGoogleBarcodeScannerModule();
    return null;
  }
  const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE] });
  return barcodes[0]?.rawValue || null;
}

async function scanQr() {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    toast('Installing the scanner, try again in a moment');
    await BarcodeScanner.installGoogleBarcodeScannerModule();
    return null;
  }
  const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
  return barcodes[0]?.rawValue || null;
}

// ---- self-update: pull new screens from the PC (home Wi-Fi) instead of reinstalling the APK ----
let lastUpdateCheck = 0;
async function lanServer() {
  // From the sync QR code, or the older direct pairing
  try {
    const s = await Local.handle('GET', '/api/sync/lan');
    if (s?.url) return s;
  } catch {}
  const url = LS.get('kz_server'), key = LS.get('kz_key');
  return url ? { url, key } : null;
}
async function localVersion() {
  try { return (await (await fetch('bundle-version.txt', { cache: 'no-store' })).text()).trim(); } catch { return '?'; }
}
/** Returns a short status message; manual checks also show it. */
async function checkForUpdate(manual = false) {
  if (!manual && Date.now() - lastUpdateCheck < 5 * 60 * 1000) return null;
  lastUpdateCheck = Date.now();
  const say = m => { LS.set('kz_update_msg', `${new Date().toLocaleString()}: ${m}`); if (manual) toast(m, 5000); return m; };
  try {
    const pc = await lanServer();
    if (!pc) return say('Not linked to your PC yet, so updates can\'t be fetched.');
    const local = await localVersion();
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 5000);
    let r;
    try { r = await fetch(`${pc.url}/api/app-version`, { headers: { 'X-Kaizen-Key': pc.key || '' }, signal: ctl.signal }); }
    catch { return say("Can't reach your PC. Updates come from Kaizen on your PC over home Wi-Fi."); }
    if (!r.ok) return say(`Your PC answered ${r.status}.`);
    const { version, checksum } = await r.json();
    if (!version || version === local) return say('Kaizen is up to date.');
    await Local.saveNow();
    toast('Updating Kaizen…', 4000);
    // The updater requires the zip's SHA-256 checksum before it installs anything
    const bundle = await CapacitorUpdater.download({ url: `${pc.url}/app-bundle.zip?v=${version}`, version, checksum: checksum || '' });
    await CapacitorUpdater.set({ id: bundle.id }); // reloads into the new screens
    return null;
  } catch (e) { return say(`Update failed: ${e?.message || e}`); }
}

// If this phone was paired with the PC directly before, join the PC's cloud sync automatically
// (no QR scan needed) the first time both are on the home Wi-Fi after sync is turned on.
let autoLinkTried = 0;
async function autoLink() {
  if (Local.Sync.isLinked() || Date.now() - autoLinkTried < 10 * 60 * 1000) return;
  autoLinkTried = Date.now();
  const url = LS.get('kz_server'), key = LS.get('kz_key');
  if (!url) return;
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`${url}/api/sync/code`, { headers: { 'X-Kaizen-Key': key || '' }, signal: ctl.signal });
    if (!r.ok) return;
    const { code } = await r.json();
    if (!code) return;
    const res = await Local.handle('POST', '/api/sync/join', { code });
    toast(`Linked to your PC · ${res.pulled} items synced`);
  } catch (e) { console.warn('auto link skipped', e?.message); }
}

// ---- cloud sync triggers: on open, on close, and shortly after changes ----
let lastHevy = 0;
async function cloudSync() {
  await autoLink();
  // Hevy workouts (does nothing without a Hevy key); at most every 20 minutes
  if (Date.now() - lastHevy > 20 * 60 * 1000) {
    lastHevy = Date.now();
    try { const h = await Local.handle('POST', '/api/hevy/sync'); if (h?.imported) K.refresh({ auto: true }); } catch {}
  }
  if (!Local.Sync.isLinked()) return;
  try {
    const r = await Local.Sync.syncNow();
    await Local.saveNow();
    if (r.pulled && document.visibilityState === 'visible') K.refresh({ auto: true });
  } catch (e) { console.warn('sync', e.message); }
}

export const native = {
  async init(ctx, api, toaster) {
    K = ctx; A = api; toast = toaster || toast;
    await Local.open();
    // Android back gesture/button: close panels, then go to Today, then minimise like other apps.
    // (Older installs without this component just skip it.)
    try {
      await App.addListener('backButton', () => { if (!K.back()) App.minimizeApp().catch(() => {}); });
      await App.addListener('pause', () => { Local.saveNow().then(cloudSync); });
    } catch (e) { console.warn('back button handler unavailable', e?.message); }
    A.setLocal({ handle: Local.handle, chat: Local.chat });
    // Confirms this bundle works; otherwise the updater rolls back to the last good one
    CapacitorUpdater.notifyAppReady().catch(() => {});
    setTimeout(() => { cloudSync().then(() => sync()); checkForUpdate(); }, 300);
    checkAvailable();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { sync().finally(cloudSync); checkForUpdate(); }
      else { Local.saveNow().then(cloudSync); } // closing the app: save and upload
    });
    setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 5 * 60 * 1000);
  },
  status: () => status,
  healthDiag: () => { try { return JSON.parse(LS.get('kz_hc_diag') || 'null'); } catch { return null; } },
  connect,
  sync,
  cloudSync,
  scanBarcode,
  scanQr,
  checkForUpdate: () => checkForUpdate(true),
  appVersion: localVersion,
  updateMessage: () => LS.get('kz_update_msg'),
};
