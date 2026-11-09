// Makes desktop\app\Kaizen.exe: a real app with Kaizen's name and icon that you can pin.
// It runs the code in the desktop folder, so changes show up without running this again.
// Run again only after updating Electron:  npm run make-app
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.noAsar = true;

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'app');
const ICON_PNG = path.join(ROOT, 'icon.png');
const ICON_ICO = path.join(ROOT, 'kaizen-app.ico');
const LOGO = fs.readFileSync(path.join(ROOT, '..', 'web', 'icon.svg'), 'utf8');

function renderLogo() {
  return new Promise(resolve => {
    const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
    win.webContents.setFrameRate(5);
    let done = false;
    win.webContents.on('paint', (_e, _d, image) => {
      if (done || image.getSize().width < 256) return;
      done = true; resolve(image); win.destroy();
    });
    win.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${LOGO.replace('<svg ', '<svg width="256" height="256" ')}</body></html>`));
  });
}

function writeIco(image, file) {
  const sizes = [256, 128, 64, 48, 32, 24, 16];
  const pngs = sizes.map(s => (s === 256 ? image : image.resize({ width: s, height: s, quality: 'best' })).toPNG());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(s === 256 ? 0 : s, at); header.writeUInt8(s === 256 ? 0 : s, at + 1);
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(pngs[i].length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(file, Buffer.concat([header, ...pngs]));
}

app.whenReady().then(async () => {
  const logo = await renderLogo();
  fs.writeFileSync(ICON_PNG, logo.toPNG());
  writeIco(logo, ICON_ICO);

  const dist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(dist, OUT, { recursive: true });
  fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, 'Kaizen.exe'));
  fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });
  const version = require(path.join(ROOT, 'package.json')).version;
  execFileSync(path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'), [
    path.join(OUT, 'Kaizen.exe'),
    '--set-icon', ICON_ICO,
    '--set-version-string', 'ProductName', 'Kaizen',
    '--set-version-string', 'FileDescription', 'Kaizen',
    '--set-version-string', 'CompanyName', 'Kaizen',
    '--set-version-string', 'OriginalFilename', 'Kaizen.exe',
    '--set-version-string', 'InternalName', 'Kaizen',
    '--set-file-version', version,
    '--set-product-version', version,
  ]);

  const inner = path.join(OUT, 'resources', 'app');
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, 'package.json'), JSON.stringify({ name: 'kaizen', productName: 'Kaizen', version, main: 'start.js', type: 'module' }, null, 2));
  fs.writeFileSync(path.join(inner, 'start.js'), "// Runs Kaizen's desktop code from the main folder, so the app always has the latest version.\nimport '../../../main.js'\n");
  console.log('made', path.join(OUT, 'Kaizen.exe'));
  app.quit();
});
