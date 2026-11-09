import { db, getSettings } from './db.js';

export const KCAL_PER_KG = 7700;

export function today() { return localDate(new Date()); }
export function localDate(d) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDate(d);
}

/** Exponentially smoothed weight trend (alpha 0.1), one point per day that has a weigh-in. */
export function weightTrend() {
  const rows = db.prepare(`SELECT date, AVG(kg) AS kg FROM weights GROUP BY date ORDER BY date`).all();
  let trend = null;
  return rows.map(r => {
    trend = trend == null ? r.kg : trend + 0.1 * (r.kg - trend);
    return { date: r.date, kg: r.kg, trend };
  });
}

export function latestWeightKg() {
  const t = weightTrend();
  return t.length ? t[t.length - 1].trend : null;
}

/** Mifflin-St Jeor BMR × activity, the formula-based estimate. */
export function formulaTdee(s, kg) {
  const age = s.birth_year ? new Date().getFullYear() - Number(s.birth_year) : 30;
  const h = Number(s.height_cm) || 175;
  if (!kg) return null;
  const bmr = 10 * kg + 6.25 * h - 5 * age + (s.sex === 'female' ? -161 : 5);
  return Math.round(bmr * Number(s.activity || 1.375));
}

/**
 * Adaptive TDEE from real data: average intake minus the energy implied by the trend change.
 * Needs at least 14 days with both food logs and weigh-ins in the last 28 days.
 */
export function adaptiveTdee() {
  const end = today();
  const start = addDays(end, -28);
  const trend = weightTrend().filter(p => p.date >= start);
  const intake = db.prepare(`SELECT date, SUM(kcal) AS kcal FROM food_logs WHERE date >= ? AND date < ? GROUP BY date HAVING SUM(kcal) > 600`).all(start, end);
  if (trend.length < 8 || intake.length < 14) return null;
  const first = trend[0], last = trend[trend.length - 1];
  const days = (new Date(last.date) - new Date(first.date)) / 86400000;
  if (days < 13) return null;
  const avgIntake = intake.reduce((a, r) => a + r.kcal, 0) / intake.length;
  const kgPerDay = (last.trend - first.trend) / days;
  return Math.round(avgIntake - kgPerDay * KCAL_PER_KG);
}

export function targets() {
  const s = getSettings();
  const kg = latestWeightKg();
  const formula = formulaTdee(s, kg);
  const adaptive = adaptiveTdee();
  const tdee = adaptive ?? formula;
  const floor = s.sex === 'female' ? 1200 : 1500;
  let kcal = null;
  if (s.calorie_override) kcal = Number(s.calorie_override);
  else if (tdee) {
    const goalKg = Number(s.goal_kg) || null;
    const losing = !goalKg || !kg || goalKg < kg;
    const deficit = losing ? Number(s.rate_kg_week) * KCAL_PER_KG / 7 : 0;
    kcal = Math.max(floor, Math.round((tdee - deficit) / 10) * 10);
  }
  // Protein ~1.8 g per kg of goal (or current) weight, fat 27% of calories, carbs the rest.
  const refKg = Number(s.goal_kg) || kg || 80;
  const protein = s.protein_override ? Number(s.protein_override) : Math.round(refKg * 1.8);
  const fat = kcal ? Math.round(kcal * 0.27 / 9) : null;
  const carbs = kcal ? Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4)) : null;
  return {
    kcal, protein, fat, carbs,
    tdee, tdee_source: adaptive ? 'adaptive' : formula ? 'formula' : null,
    formula_tdee: formula, adaptive_tdee: adaptive,
    steps: Number(s.step_goal), water_ml: Number(s.water_goal_ml), sleep_h: Number(s.sleep_goal_h),
  };
}

export function daySummary(date) {
  const food = db.prepare(`SELECT COALESCE(SUM(kcal),0) kcal, COALESCE(SUM(protein),0) protein, COALESCE(SUM(carbs),0) carbs, COALESCE(SUM(fat),0) fat, COUNT(*) n FROM food_logs WHERE date = ?`).get(date);
  const steps = db.prepare('SELECT count, active_kcal FROM steps WHERE date = ?').get(date);
  const sleep = db.prepare('SELECT * FROM sleep WHERE date = ?').get(date);
  const water = db.prepare('SELECT ml FROM water WHERE date = ?').get(date);
  const weight = db.prepare('SELECT kg, fat_pct, ts FROM weights WHERE date = ? ORDER BY ts DESC LIMIT 1').get(date);
  const heart = db.prepare('SELECT resting FROM heart WHERE date = ?').get(date);
  const workouts = db.prepare(`SELECT id, name, minutes, kcal FROM workouts WHERE date = ? AND done = 1`).all(date);
  return { date, food, steps: steps ?? null, sleep: sleep ?? null, water_ml: water?.ml ?? 0, weight: weight ?? null, resting_hr: heart?.resting ?? null, workouts };
}

/** Consecutive days (ending today or yesterday) with at least one food log. */
export function logStreak() {
  const dates = new Set(db.prepare('SELECT DISTINCT date FROM food_logs WHERE date >= ?').all(addDays(today(), -400)).map(r => r.date));
  let d = today();
  if (!dates.has(d)) d = addDays(d, -1);
  let n = 0;
  while (dates.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export function goalProjection() {
  const s = getSettings();
  const goal = Number(s.goal_kg);
  const trend = weightTrend();
  if (!goal || trend.length < 2) return null;
  const last = trend[trend.length - 1];
  const past = trend.filter(p => p.date >= addDays(last.date, -21));
  const first = past[0];
  const days = (new Date(last.date) - new Date(first.date)) / 86400000;
  const rate = days >= 7 ? (last.trend - first.trend) / days : null; // kg/day
  const remaining = last.trend - goal;
  let eta = null;
  if (rate && rate < 0 && remaining > 0) eta = addDays(today(), Math.round(remaining / -rate));
  return { goal_kg: goal, current_kg: last.trend, remaining_kg: remaining, kg_per_week: rate != null ? rate * 7 : null, eta };
}

/** Compact text summary the AI coach gets as context. */
export function coachContext() {
  const s = getSettings();
  const t = targets();
  const unit = s.units;
  const fmtW = kg => kg == null ? '—' : unit === 'lb' ? `${(kg * 2.20462).toFixed(1)} lb` : `${kg.toFixed(1)} kg`;
  const lines = [];
  const age = s.birth_year ? new Date().getFullYear() - Number(s.birth_year) : null;
  lines.push(`Profile: ${s.sex}${age ? `, ${age} y` : ''}${s.height_cm ? `, ${s.height_cm} cm` : ''}. Units shown to user: ${unit}.`);
  const proj = goalProjection();
  lines.push(`Weight trend: ${fmtW(latestWeightKg())}. Goal: ${s.goal_kg ? fmtW(Number(s.goal_kg)) : 'not set'}.` +
    (proj?.kg_per_week != null ? ` Recent rate: ${unit === 'lb' ? (proj.kg_per_week * 2.20462).toFixed(2) + ' lb' : proj.kg_per_week.toFixed(2) + ' kg'}/week.` : '') +
    (proj?.eta ? ` Projected goal date: ${proj.eta}.` : ''));
  lines.push(`Daily targets: ${t.kcal ?? '?'} kcal, ${t.protein} g protein, ${t.carbs ?? '?'} g carbs, ${t.fat ?? '?'} g fat. Estimated TDEE ${t.tdee ?? '?'} (${t.tdee_source ?? 'unknown'}). Step goal ${t.steps}.`);
  lines.push(`Food logging streak: ${logStreak()} days.`);
  lines.push('Last 14 days (date | kcal | protein g | steps | sleep h | weight | workouts):');
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today(), -i);
    const x = daySummary(d);
    lines.push(`${d} | ${x.food.n ? Math.round(x.food.kcal) : '—'} | ${x.food.n ? Math.round(x.food.protein) : '—'} | ${x.steps?.count ?? '—'} | ${x.sleep ? (x.sleep.minutes / 60).toFixed(1) : '—'} | ${x.weight ? fmtW(x.weight.kg) : '—'} | ${x.workouts.map(w => w.name).join(', ') || '—'}`);
  }
  const todayLogs = db.prepare('SELECT meal, name, qty, serving, kcal, protein FROM food_logs WHERE date = ? ORDER BY id').all(today());
  if (todayLogs.length) {
    lines.push("Today's food:");
    for (const f of todayLogs) lines.push(`- ${f.meal}: ${f.name} (${f.qty} × ${f.serving ?? 'serving'}) ${Math.round(f.kcal)} kcal, ${Math.round(f.protein)} g protein`);
  }
  const recentSets = db.prepare(`
    SELECT w.date, e.name, MAX(s.kg) kg, MAX(s.reps) reps, COUNT(*) n FROM sets s
    JOIN workouts w ON w.id = s.workout_id JOIN exercises e ON e.id = s.exercise_id
    WHERE w.date >= ? AND s.done = 1 GROUP BY w.date, e.name ORDER BY w.date DESC LIMIT 25`).all(addDays(today(), -21));
  if (recentSets.length) {
    lines.push('Recent training (date, exercise, sets, top weight kg × reps):');
    for (const r of recentSets) lines.push(`- ${r.date} ${r.name}: ${r.n} sets${r.kg ? `, ${r.kg} kg × ${r.reps}` : r.reps ? `, ${r.reps} reps` : ''}`);
  }
  return lines.join('\n');
}
