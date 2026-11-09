import { db } from './db.js';
import { newId } from './ids.js';
import { buildPortions } from './portions.js';

/** Rows from the database carry portions as JSON; older rows get the built-in ones. */
export function withPortions(row) {
  if (!row) return row;
  let p = [];
  try { p = row.portions ? JSON.parse(row.portions) : []; } catch {}
  return { ...row, portions: p.length ? p : buildPortions(row.name) };
}

const UA = 'Kaizen/1.0 (personal fitness tracker)';
const cache = new Map(); // query -> { at, items }

async function getJson(url, ms = 4500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

const r1 = n => n == null || Number.isNaN(Number(n)) ? null : Math.round(Number(n) * 10) / 10;

export function localSearch(q, limit = 25) {
  q = (q || '').trim();
  if (!q) {
    return db.prepare(`SELECT * FROM foods WHERE uses > 0 OR favorite = 1 ORDER BY favorite DESC, last_used DESC LIMIT ?`).all(limit).map(withPortions);
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const where = words.map(() => `(LOWER(name) LIKE ? OR LOWER(COALESCE(brand,'')) LIKE ?)`).join(' AND ');
  const args = words.flatMap(w => [`%${w}%`, `%${w}%`]);
  return db.prepare(`SELECT * FROM foods WHERE ${where} ORDER BY favorite DESC, uses DESC, LENGTH(name) LIMIT ?`).all(...args, limit).map(withPortions);
}

function fromOff(p) {
  const n = p.nutriments || {};
  const per100 = {
    kcal: n['energy-kcal_100g'] ?? (n['energy_100g'] != null ? n['energy_100g'] / 4.184 : null),
    protein: n.proteins_100g, carbs: n.carbohydrates_100g, fat: n.fat_100g,
    fiber: n.fiber_100g, sugar: n.sugars_100g, sodium: n.sodium_100g != null ? n.sodium_100g * 1000 : null,
  };
  if (per100.kcal == null) return null;
  const sq = Number(p.serving_quantity);
  const useServing = sq > 0 && sq < 2000 && p.serving_size;
  const f = useServing ? sq / 100 : 1;
  const name = (Array.isArray(p.product_name) ? p.product_name[0] : p.product_name) || p.generic_name;
  if (!name) return null;
  const brand = Array.isArray(p.brands) ? p.brands[0] : (p.brands || '').split(',')[0];
  return {
    name: String(name).trim(), brand: brand?.trim() || null,
    serving: useServing ? String(p.serving_size) : '100 g', serving_g: useServing ? sq : 100,
    kcal: r1(per100.kcal * f), protein: r1((per100.protein ?? 0) * f), carbs: r1((per100.carbs ?? 0) * f), fat: r1((per100.fat ?? 0) * f),
    fiber: r1(per100.fiber != null ? per100.fiber * f : null), sugar: r1(per100.sugar != null ? per100.sugar * f : null), sodium: r1(per100.sodium != null ? per100.sodium * f : null),
    barcode: p.code || null, source: 'off', ext_id: p.code || null,
    portions: buildPortions(String(name), useServing && !/^\s*100\s*g/i.test(String(p.serving_size)) ? [{ label: String(p.serving_size), g: sq }] : []),
  };
}

async function offSearch(q) {
  const fields = 'code,product_name,generic_name,brands,nutriments,serving_size,serving_quantity';
  try {
    const j = await getJson(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=15&fields=${fields}`);
    return (j.hits || []).map(fromOff).filter(Boolean);
  } catch {
    const j = await getJson(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&json=1&page_size=15&fields=${fields}`);
    return (j.products || []).map(fromOff).filter(Boolean);
  }
}

const USDA_NUM = { '208': 'kcal', '203': 'protein', '205': 'carbs', '204': 'fat', '291': 'fiber', '269': 'sugar', '307': 'sodium' };

async function usdaSearch(q, key) {
  const types = encodeURIComponent('Foundation,SR Legacy,Survey (FNDDS)');
  const j = await getJson(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key || 'DEMO_KEY'}&query=${encodeURIComponent(q)}&pageSize=12&dataType=${types}`);
  return (j.foods || []).map(f => {
    const v = {};
    for (const n of f.foodNutrients || []) {
      const k = USDA_NUM[String(n.nutrientNumber)];
      if (k && v[k] == null && (k !== 'kcal' || (n.unitName || '').toUpperCase() === 'KCAL')) v[k] = n.value;
    }
    if (v.kcal == null) return null;
    const name = f.description.charAt(0) + f.description.slice(1).toLowerCase();
    return {
      name, brand: null, serving: '100 g', serving_g: 100,
      kcal: r1(v.kcal), protein: r1(v.protein ?? 0), carbs: r1(v.carbs ?? 0), fat: r1(v.fat ?? 0),
      fiber: r1(v.fiber), sugar: r1(v.sugar), sodium: r1(v.sodium),
      barcode: null, source: 'usda', ext_id: String(f.fdcId),
      portions: buildPortions(name, f.foodMeasures || []),
    };
  }).filter(Boolean);
}

const ODD = /\b(dehydrated|powder|dried|baby ?food|infant|canned|syrup|frozen|concentrate|freeze)/;

/** Rank so "banana" finds "Bananas, raw" before "banana powder". */
function relevance(item, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const name = item.name.toLowerCase();
  const first = name.split(/[,(]/)[0].trim();
  let s = 0;
  for (const w of words) {
    const stem = w.replace(/e?s$/, '');
    if (name.includes(stem)) s += 2; else s -= 3;
    if (first.startsWith(stem)) s += 2;
  }
  if (words.length && first.replace(/e?s$/, '') === words.join(' ').replace(/e?s$/, '')) s += 3;
  if (ODD.test(name) && !ODD.test(q.toLowerCase())) s -= 4;
  if (/\braw\b/.test(name) && words.length <= 2) s += 1.5;
  s -= name.length / 40;
  if (item.source === 'off' && !item.brand) s -= 1;
  return s;
}

export async function onlineSearch(q, usdaKey) {
  const key = q.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.items;
  // Generic foods and dishes come from the built-in database; online is for branded products
  const off = await offSearch(q).catch(() => []);
  const items = off;
  // Skip ones already saved locally
  const known = new Set(db.prepare(`SELECT source || ':' || ext_id k FROM foods WHERE ext_id IS NOT NULL`).all().map(r => r.k));
  const out = items.filter(i => !known.has(`${i.source}:${i.ext_id}`))
    .map((i, idx) => ({ i, s: relevance(i, q) - idx * 0.01 }))
    .sort((a, b) => b.s - a.s).map(x => x.i);
  if (out.length) cache.set(key, { at: Date.now(), items: out });
  return out;
}

export async function barcodeLookup(code) {
  const local = db.prepare('SELECT * FROM foods WHERE barcode = ? ORDER BY uses DESC LIMIT 1').get(code);
  if (local) return withPortions(local);
  const j = await getJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,generic_name,brands,nutriments,serving_size,serving_quantity`, 8000);
  if (j.status !== 1 || !j.product) return null;
  const f = fromOff(j.product);
  if (!f) return null;
  return withPortions(saveFood(f));
}

/** Insert or reuse a food row; returns the row. */
export function saveFood(f) {
  if (f.id) return db.prepare('SELECT * FROM foods WHERE id = ?').get(f.id);
  if (f.ext_id) {
    const ex = db.prepare('SELECT * FROM foods WHERE source = ? AND ext_id = ?').get(f.source, f.ext_id);
    if (ex) return ex;
  }
  const r = db.prepare(`INSERT INTO foods (id, name, brand, serving, serving_g, kcal, protein, carbs, fat, fiber, sugar, sodium, barcode, source, ext_id, portions)
    VALUES (?, ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId(), 
    f.name, f.brand ?? null, f.serving || '1 serving', f.serving_g ?? null,
    Number(f.kcal) || 0, Number(f.protein) || 0, Number(f.carbs) || 0, Number(f.fat) || 0,
    f.fiber ?? null, f.sugar ?? null, f.sodium ?? null, f.barcode ?? null, f.source || 'custom', f.ext_id ?? null,
    Array.isArray(f.portions) && f.portions.length ? JSON.stringify(f.portions) : null);
  return db.prepare('SELECT * FROM foods WHERE id = ?').get(r.lastInsertRowid);
}

export function markUsed(foodId) {
  db.prepare(`UPDATE foods SET uses = uses + 1, last_used = datetime('now') WHERE id = ?`).run(foodId);
}
