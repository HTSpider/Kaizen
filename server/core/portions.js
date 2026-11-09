// Typical weight of one piece of common foods, so you can log "1 pepper" instead of weighing it.
// [match words, label, grams]. First match wins, so more specific entries come first.
const PIECES = [
  [['bell pepper', 'sweet pepper', 'peppers, sweet', 'pepper, sweet', 'capsicum'], 'pepper', 120],
  [['pitta', 'pita'], 'pitta', 60],
  [['tortilla', 'wrap'], 'wrap', 60],
  [['bagel'], 'bagel', 100],
  [['english muffin'], 'muffin', 60],
  [['croissant'], 'croissant', 60],
  [['naan'], 'naan', 90],
  [['bread', 'toast'], 'slice', 30],
  [['bun', 'roll'], 'bun', 50],
  [['egg'], 'egg', 50],
  [['banana'], 'banana', 118],
  [['apple'], 'apple', 180],
  [['orange'], 'orange', 130],
  [['clementine', 'mandarin', 'tangerine'], 'fruit', 75],
  [['pear'], 'pear', 180],
  [['peach', 'nectarine'], 'fruit', 150],
  [['plum'], 'plum', 66],
  [['kiwi'], 'kiwi', 75],
  [['avocado'], 'avocado', 150],
  [['mango'], 'mango', 200],
  [['lemon', 'lime'], 'fruit', 60],
  [['date'], 'date', 8],
  [['strawberr'], 'strawberry', 12],
  [['tomato'], 'tomato', 120],
  [['cucumber'], 'cucumber', 300],
  [['carrot'], 'carrot', 60],
  [['onion'], 'onion', 110],
  [['potato'], 'potato', 170],
  [['sweet potato'], 'potato', 130],
  [['courgette', 'zucchini'], 'courgette', 200],
  [['mushroom'], 'mushroom', 18],
  [['garlic'], 'clove', 3],
  [['chicken breast'], 'breast', 170],
  [['chicken thigh'], 'thigh', 90],
  [['sausage'], 'sausage', 60],
  [['bacon'], 'rasher', 15],
  [['burger', 'patty'], 'patty', 110],
  [['salmon', 'cod', 'fish fillet', 'fillet'], 'fillet', 140],
  [['kebab', 'kabob', 'skewer', 'souvlaki', 'satay'], 'skewer', 150],
  [['falafel'], 'falafel', 17],
  [['cookie', 'biscuit'], 'biscuit', 15],
  [['muffin'], 'muffin', 110],
  [['donut', 'doughnut'], 'doughnut', 60],
  [['protein bar', 'bar'], 'bar', 50],
  [['yogurt', 'yoghurt'], 'pot', 150],
  [['cheese slice', 'slice of cheese'], 'slice', 20],
  [['can of', 'soda', 'cola'], 'can', 330],
];

/** A "1 piece" portion for common whole foods, or null. */
export function commonPiece(name) {
  const n = String(name || '').toLowerCase();
  for (const [words, label, g] of PIECES) {
    if (words.some(w => n.includes(w))) return { label: `1 ${label}`, g };
  }
  return null;
}

/** Clean USDA household measures into [{label, g}], with the common piece added if missing. */
export function buildPortions(name, measures = []) {
  const out = [];
  const seen = new Set();
  for (const m of measures) {
    const label = String(m.disseminationText || m.label || '').trim();
    const g = Number(m.gramWeight ?? m.g);
    if (!label || !(g > 0) || /quantity not specified|^1 g$|^1 gram/i.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: /^\d|^½|^¼/.test(label) ? label : `1 ${label}`, g: Math.round(g * 10) / 10 });
    if (out.length >= 6) break;
  }
  const piece = commonPiece(name);
  if (piece && !out.some(p => Math.abs(p.g - piece.g) < piece.g * 0.15)) out.push(piece);
  // Most natural first: "1 medium" / "1 banana" / "1 shishkabob" before cups, inches and ounces
  const words = String(name || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2).map(w => w.replace(/s$/, ''));
  const rank = l => { const t = l.toLowerCase(); let s = 0;
    if (/medium/.test(t)) s += 3;
    if (words.some(w => t.includes(w))) s += 2;
    if (/(large|small|whole|piece|fillet|breast|sandwich|slice|serving|order|patty|skewer)/.test(t)) s += 1;
    if (/inch|cubic|nfs/.test(t)) s -= 4;
    if (/(cup|tbsp|tablespoon|tsp|teaspoon|oz|ml|fl)/.test(t)) s -= 1;
    return s; };
  out.sort((a, b) => rank(b.label) - rank(a.label));
  return out;
}
