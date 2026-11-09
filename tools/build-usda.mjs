// Builds server/core/usda-foods.json from USDA FoodData Central CSVs (FNDDS + SR Legacy).
// Usage: node tools/build-usda.mjs <survey_csv_dir> <sr_legacy_csv_dir>
// Per food: { n: name, k: kcal, p: protein, c: carbs, f: fat (per 100 g), u: [[portion label, grams], ...] }
import fs from 'node:fs';
import path from 'node:path';

const [surveyDir, srDir] = process.argv.slice(2);
if (!surveyDir || !srDir) { console.error('usage: node tools/build-usda.mjs <survey_dir> <sr_dir>'); process.exit(1); }

function* csvRows(file) {
  const text = fs.readFileSync(file, 'utf8');
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; yield row; row = []; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); yield row; }
}
function table(file) {
  const it = csvRows(file);
  const head = it.next().value;
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  return { idx, rows: it };
}

// SR Legacy uses nutrient ids (1008…); the FNDDS file uses the old nutrient numbers (208…)
const NUT = { 1008: 'k', 1003: 'p', 1005: 'c', 1004: 'f', 208: 'k', 203: 'p', 205: 'c', 204: 'f' };
const r1 = v => Math.round(v * 10) / 10;

function load(dir, kind) {
  const foods = new Map();
  let t = table(path.join(dir, 'food.csv'));
  for (const r of t.rows) {
    if (r.length < 3) continue;
    foods.set(r[t.idx.fdc_id], { id: r[t.idx.fdc_id], n: r[t.idx.description], u: [] });
  }
  t = table(path.join(dir, 'food_nutrient.csv'));
  for (const r of t.rows) {
    const key = NUT[r[t.idx.nutrient_id]];
    const f = key && foods.get(r[t.idx.fdc_id]);
    if (f && f[key] == null) f[key] = r1(parseFloat(r[t.idx.amount]) || 0);
  }
  const units = new Map();
  t = table(path.join(dir, 'measure_unit.csv'));
  for (const r of t.rows) if (r.length > 1) units.set(r[t.idx.id], r[t.idx.name]);
  t = table(path.join(dir, 'food_portion.csv'));
  for (const r of t.rows) {
    const f = foods.get(r[t.idx.fdc_id]);
    const g = parseFloat(r[t.idx.gram_weight]);
    if (!f || !(g > 0)) continue;
    let label;
    if (kind === 'survey') label = r[t.idx.portion_description];
    else {
      const unit = units.get(r[t.idx.measure_unit_id]);
      const amount = r[t.idx.amount] || '1';
      label = [amount, unit && unit !== 'undetermined' ? unit : '', r[t.idx.modifier]].filter(Boolean).join(' ');
    }
    label = String(label || '').trim();
    if (!label || /quantity not specified|^1 ?g$|^100 ?g/i.test(label)) continue;
    if (f.u.length < 6 && !f.u.some(([l]) => l.toLowerCase() === label.toLowerCase())) f.u.push([label, r1(g)]);
  }
  return [...foods.values()].filter(f => f.k != null);
}

const all = [...load(surveyDir, 'survey'), ...load(srDir, 'sr')].map(f => ({ n: f.n, k: f.k, p: f.p ?? 0, c: f.c ?? 0, f: f.f ?? 0, u: f.u, i: f.id }));
const out = path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, '$1'), '..', 'server', 'core', 'usda-foods.json');
fs.writeFileSync(out, JSON.stringify(all));
console.log(`${all.length} foods → ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
