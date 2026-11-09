// Copies ../web into www for the APK and stamps it with the same version the PC server reports.
import fs from 'node:fs';
import { webVersion } from '../server/webversion.js';

fs.rmSync('www', { recursive: true, force: true });
fs.cpSync('../web', 'www', { recursive: true });
const v = webVersion('../web');
fs.writeFileSync('www/bundle-version.txt', v);
console.log('web bundle', v);
