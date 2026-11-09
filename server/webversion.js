// Versioning + zip packaging of the web UI, so the phone app can update itself from the PC.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { zipSync } from 'fflate';

function files(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  }).filter(f => f !== 'bundle-version.txt').sort();
}

/** Content hash of every file in the web folder (same result on any machine). */
export function webVersion(dir) {
  const h = crypto.createHash('sha1');
  for (const f of files(dir)) { h.update(f); h.update('\0'); h.update(fs.readFileSync(path.join(dir, f))); }
  return h.digest('hex').slice(0, 12);
}

let cache = { version: null, zip: null };
/** Zip of the web folder with bundle-version.txt added; cached per version. */
export function webZip(dir) {
  const version = webVersion(dir);
  if (cache.version !== version) {
    const entries = { 'bundle-version.txt': new TextEncoder().encode(version) };
    for (const f of files(dir)) entries[f] = fs.readFileSync(path.join(dir, f));
    const zip = Buffer.from(zipSync(entries, { level: 6 }));
    cache = { version, zip, checksum: crypto.createHash('sha256').update(zip).digest('hex') };
  }
  return cache;
}
