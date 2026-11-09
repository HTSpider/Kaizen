// Built-in food database (USDA FNDDS dishes + SR Legacy basics, ~13k foods), searched instantly
// and offline on both PC and phone. Includes household portions like "1 shishkabob".
import FOODS from './usda-foods.json' with { type: 'json' };
import { buildPortions } from './portions.js';

// UK and everyday words → the words USDA uses
const SYNONYMS = {
  kebab: ['kabob'], kebabs: ['kabob'], doner: ['gyro'], pitta: ['pita'], pittas: ['pita'],
  yoghurt: ['yogurt'], courgette: ['zucchini'], courgettes: ['zucchini'], aubergine: ['eggplant'],
  crisps: ['potato chips'], chips: ['french fries', 'chips'], mince: ['ground'], minced: ['ground'],
  prawn: ['shrimp'], prawns: ['shrimp'], biscuit: ['cookie', 'biscuit'], biscuits: ['cookie', 'biscuit'],
  porridge: ['oatmeal'], coriander: ['cilantro', 'coriander'], rocket: ['arugula'], sweetcorn: ['corn'],
  beetroot: ['beets'], chickpea: ['chickpeas'], gammon: ['ham'], rasher: ['bacon'], sultanas: ['raisins'],
  mangetout: ['snow peas'], swede: ['rutabaga'], 'jacket potato': ['baked potato'], 'spring onion': ['green onion', 'scallions'],
  'fizzy drink': ['soft drink'], fizzy: ['carbonated'], 'double cream': ['heavy cream'], 'single cream': ['light cream'],
  'icing sugar': ['powdered sugar'], lolly: ['popsicle'], 'broad beans': ['fava beans'], 'fish fingers': ['fish sticks'],
  'chip shop': ['fried'], takeaway: [], 'baked beans': ['baked beans'], 'cottage pie': ['shepherd'], 'shepherds pie': ['shepherd'],
  burger: ['burger', 'hamburger', 'cheeseburger'], burgers: ['burger', 'hamburger', 'cheeseburger'],
  jam: ['jam', 'preserves'], muesli: ['muesli'], 'peanut butter': ['peanut butter'], wrap: ['tortilla', 'wrap'], wraps: ['tortilla', 'wrap'],
};

const LOWER = FOODS.map(f => f.n.toLowerCase());
const stem = w => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
const ODD = /\b(dehydrated|powder|dried|baby ?food|infant|canned|syrup|frozen|concentrate|freeze|formula)/;

/** Turn a query into groups of alternatives; every group must match. */
function groups(q) {
  let text = q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const out = [];
  // Multi-word synonyms first
  for (const [k, alts] of Object.entries(SYNONYMS)) {
    if (k.includes(' ') && text.includes(k)) { out.push(alts.length ? alts : [k]); text = text.replace(k, ' '); }
  }
  for (const w of text.split(' ').filter(Boolean)) {
    if (['a', 'an', 'the', 'of', 'with', 'and', 'some', 'my'].includes(w)) continue;
    const alts = SYNONYMS[w];
    if (alts && !alts.length) continue;
    out.push(alts || [w]); // UK words map to the USDA word (the original only if listed)
  }
  return out;
}

export function searchBuiltIn(q, limit = 25) {
  const gs = groups(q);
  if (!gs.length) return [];
  const words = gs.map(g => g.map(stem));
  const hits = [];
  for (let i = 0; i < LOWER.length; i++) {
    const name = LOWER[i];
    let score = 0, ok = true;
    for (const alts of words) {
      let best = -1;
      for (const a of alts) {
        const at = name.indexOf(a);
        if (at < 0) continue;
        const startOk = at === 0 || /[ ,(]/.test(name[at - 1]);
        const rest = name.slice(at + a.length);
        const endOk = !/^[a-z]/.test(rest) || /^(s|es|ed|ing)?([^a-z]|$)/.test(rest);
        const s = (at === 0 ? 4 : startOk ? 2 : 0.3) * (endOk ? 1 : 0.15);
        if (s > best) best = s;
      }
      if (best < 0) { ok = false; break; }
      score += best;
    }
    if (!ok) continue;
    const f = FOODS[i];
    score -= name.length / 45;
    if (/[A-Z]{3,}[A-Z' ]*,/.test(f.n) && !q.match(/[A-Z]{3,}/)) score -= 2; // brand items (BURGER KING, …) after generic foods
    if (ODD.test(name) && !ODD.test(q.toLowerCase())) score -= 4;
    if (/\braw\b/.test(name) && gs.length <= 2) score += 1;
    if (f.u.length) score += 0.5; // has household portions
    hits.push([score, i]);
  }
  hits.sort((a, b) => b[0] - a[0]);
  return hits.slice(0, limit).map(([, i]) => toFood(FOODS[i]));
}

function toFood(f) {
  const name = f.n.charAt(0) + f.n.slice(1);
  return {
    name, brand: null, serving: '100 g', serving_g: 100,
    kcal: f.k, protein: f.p, carbs: f.c, fat: f.f,
    source: 'usda', ext_id: String(f.i),
    portions: buildPortions(name, f.u.map(([label, g]) => ({ label, g }))),
  };
}
