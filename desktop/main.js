// Kaizen on the PC: a real window you can pin. It makes sure the Kaizen server is running
// (the server keeps running after you close the window, so your phone can still sync).
import { app, BrowserWindow, shell, nativeImage } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const URL = 'http://localhost:5177';
const ICON = path.join(here, 'icon.png');

app.setAppUserModelId('com.kaizen.desktop');
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function serverUp() {
  try { const r = await fetch(URL + '/api/ping', { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

async function ensureServer() {
  if (await serverUp()) return true;
  // Start it detached and hidden, so it outlives this window
  spawn('wscript.exe', [path.join(ROOT, 'kaizen-server.vbs')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 40; i++) { await sleep(250); if (await serverUp()) return true; }
  return false;
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600,
    title: 'Kaizen', backgroundColor: '#121417', autoHideMenuBar: true,
    show: !process.env.KAIZEN_TEST_CLOSE_MS, // test mode: hidden, closes itself
    icon: nativeImage.createFromPath(ICON),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Closing: hide right away, upload any changes (up to 6 s), then quit
  let closing = false;
  win.on('close', e => {
    if (closing) return;
    e.preventDefault(); closing = true; win.hide();
    fetch(URL + '/api/sync/now', { method: 'POST', signal: AbortSignal.timeout(6000) }).catch(() => {}).finally(() => win?.destroy());
  });
  win.on('closed', () => { win = null; app.quit(); });
  if (process.env.KAIZEN_TEST_CLOSE_MS) setTimeout(() => win?.close(), Number(process.env.KAIZEN_TEST_CLOSE_MS));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(URL)) { e.preventDefault(); shell.openExternal(url); } });
  win.loadURL(`data:text/html,<body style="background:%23121417;color:%239AA3AD;font:15px system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">Starting Kaizen…</body>`);
  const ok = await ensureServer();
  if (ok) {
    win.loadURL(URL);
    // Opening: pull the phone's latest changes in the background, then refresh what's on screen
    fetch(URL + '/api/sync/now', { method: 'POST', signal: AbortSignal.timeout(20000) })
      .then(r => r.json()).then(r => { if (r?.pulled) win?.webContents.executeJavaScript('window.K && K.refresh({ auto: true })').catch(() => {}); })
      .catch(() => {});
  }
  else win.loadURL(`data:text/html,<body style="background:%23121417;color:%23F2F4F5;font:15px system-ui;padding:40px">Kaizen's server didn't start. Check data\\server.log in the Kaizen folder.</body>`);
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
