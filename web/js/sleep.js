import { esc, icon, fmtDur, bars, clock, niceDate, toast, openSheet, closeSheet, localDate } from './ui.js';
import * as A from './api.js';

let range = 14;
const STAGE = {
  awake: { label: 'Awake', color: 'var(--carbs)', row: 0, typical: 'Brief wake-ups are normal; under 10% of the night is typical.' },
  rem: { label: 'REM', color: 'var(--rem)', row: 1, typical: 'Typically 20–25%. Dreaming sleep that helps memory and mood.' },
  light: { label: 'Light', color: '#6F8CA8', row: 2, typical: 'Typically 50–60%. The bulk of a normal night.' },
  deep: { label: 'Deep', color: 'var(--deep)', row: 3, typical: 'Typically 13–23%. Physical recovery; most of it comes early in the night.' },
};
const stageOf = t => (t === 'inBed' ? 'awake' : STAGE[t] ? t : t === 'asleep' ? 'light' : 'light');

const mins = iso => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
// Bedtimes around midnight: measure from noon so 23:30 and 00:30 are 60 min apart, not 23 h
const fromNoon = iso => (mins(iso) - 720 + 1440) % 1440;
const clockFromNoon = m => { const t = (m + 720) % 1440; const d = new Date(); d.setHours(Math.floor(t / 60), Math.round(t % 60), 0, 0); return clock(d.toISOString()); };
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sd = a => { const m = avg(a); return a.length > 1 ? Math.sqrt(avg(a.map(x => (x - m) ** 2))) : 0; };

function score(n, goalMin) {
  if (!n) return null;
  const inBed = n.in_bed || (n.start && n.end ? (new Date(n.end) - new Date(n.start)) / 60000 : null);
  const eff = inBed ? Math.min(1, n.minutes / inBed) : 0.9;
  const dur = Math.min(1, n.minutes / goalMin);
  if (n.deep == null) return Math.round(dur * 70 + Math.min(1, eff / 0.9) * 30);
  const quality = Math.min(1, ((n.deep || 0) + (n.rem || 0)) / Math.max(1, n.minutes) / 0.4);
  const restful = Math.max(0, 1 - (n.awake || 0) / 60);
  return Math.round(dur * 50 + Math.min(1, eff / 0.9) * 20 + quality * 20 + restful * 10);
}
const scoreWord = s => s >= 85 ? 'Excellent' : s >= 70 ? 'Good' : s >= 55 ? 'Fair' : 'Poor';

function hypnogram(n) {
  if (!n.stages?.length) return '';
  const t0 = new Date(n.stages[0].s).getTime(), t1 = new Date(n.stages[n.stages.length - 1].e).getTime();
  const W = 600, H = 120, rowH = H / 4, span = t1 - t0 || 1;
  const rects = n.stages.map(st => {
    const k = stageOf(st.t), x = (new Date(st.s) - t0) / span * W, w = Math.max(1, (new Date(st.e) - new Date(st.s)) / span * W);
    return `<rect x="${x.toFixed(1)}" y="${(STAGE[k].row * rowH + 4).toFixed(1)}" width="${w.toFixed(1)}" height="${(rowH - 8).toFixed(1)}" rx="3" fill="${STAGE[k].color}"/>`;
  }).join('');
  const hours = [];
  const first = new Date(t0); first.setMinutes(0, 0, 0); first.setHours(first.getHours() + 1);
  for (let t = first.getTime(); t < t1; t += 3600e3) hours.push(t);
  const ticks = hours.map(t => `<line x1="${((t - t0) / span * W).toFixed(1)}" x2="${((t - t0) / span * W).toFixed(1)}" y1="0" y2="${H}" stroke="var(--line)"/>`).join('');
  const labels = Object.values(STAGE).map(s => `<span style="height:${rowH}px;display:flex;align-items:center">${s.label}</span>`).join('');
  return `<div class="row" style="gap:8px;align-items:stretch">
      <div class="label" style="display:flex;flex-direction:column;width:44px;flex-shrink:0">${labels}</div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" height="${H}" style="flex:1;min-width:0;width:100%;display:block" role="img" aria-label="Sleep stages through the night">${ticks}${rects}</svg>
    </div>
    <div class="between label" style="padding-left:52px"><span>${clock(n.stages[0].s)}</span><span>${clock(n.stages[n.stages.length - 1].e)}</span></div>`;
}

function insights(nights, goalMin) {
  const out = [];
  const last7 = nights.slice(-7);
  if (last7.length >= 3) {
    const a = avg(last7.map(n => n.minutes));
    const diff = a - goalMin;
    out.push(diff >= -10 ? `You're averaging ${fmtDur(a)} this week, right on your ${goalMin / 60} h goal.`
      : `You're averaging ${fmtDur(a)} this week, ${fmtDur(-diff)} a night under your ${goalMin / 60} h goal.`);
    const beds = last7.filter(n => n.start).map(n => fromNoon(n.start));
    if (beds.length >= 3) {
      const spread = sd(beds);
      if (spread > 45) out.push(`Your bedtime varies by about ±${Math.round(spread)} min. Going to bed within the same half hour each night tends to improve sleep quality.`);
      else out.push(`Your bedtime is steady (about ±${Math.round(spread)} min). Consistency like this helps deep sleep.`);
    }
  }
  const staged = nights.filter(n => n.deep != null && n.minutes > 0).slice(-7);
  if (staged.length >= 3) {
    const deepPct = avg(staged.map(n => n.deep / n.minutes)) * 100;
    const remPct = avg(staged.map(n => n.rem / n.minutes)) * 100;
    if (deepPct < 12) out.push(`Deep sleep has been low (${Math.round(deepPct)}% of the night). Alcohol late in the evening, a warm room and late heavy meals all reduce it; regular exercise increases it.`);
    if (remPct < 18) out.push(`REM sleep has been on the low side (${Math.round(remPct)}%). REM mostly comes in the last hours of the night, so short nights cut it first.`);
  }
  const hrvs = nights.map(n => n.hrv).filter(Boolean);
  if (hrvs.length >= 5) {
    const recent = avg(hrvs.slice(-3)), base = avg(hrvs.slice(0, -3));
    if (base && recent < base * 0.85) out.push(`Your HRV is ${Math.round((1 - recent / base) * 100)}% below your usual. That often means stress, illness or not enough recovery, so consider an easier training day.`);
  }
  const rhrs = nights.map(n => n.resting_hr).filter(Boolean);
  if (rhrs.length >= 5) {
    const recent = avg(rhrs.slice(-3)), base = avg(rhrs.slice(0, -3));
    if (base && recent > base + 4) out.push(`Resting heart rate is up ${Math.round(recent - base)} bpm on your usual. Poor sleep, alcohol or getting ill can all do this.`);
  }
  if (!out.length) out.push('A few more nights of data will unlock trends and tips.');
  return out;
}

export function mount(view, K) {
  const draw = data => {
    const goalMin = (data?.goal_h || 8) * 60;
    const nights = (data?.nights || []).filter(n => n.minutes > 0);
    const last = nights[nights.length - 1];
    const recent = nights.slice(-range);
    const sc = score(last, goalMin);
    const debt = nights.slice(-7).reduce((a, n) => a + Math.max(0, goalMin - n.minutes), 0);
    const beds = recent.filter(n => n.start).map(n => fromNoon(n.start));
    const wakes = recent.filter(n => n.end).map(n => fromNoon(n.end));
    const inBed = last ? (last.in_bed || (last.start && last.end ? (new Date(last.end) - new Date(last.start)) / 60000 : null)) : null;
    const eff = last && inBed ? Math.round(Math.min(1, last.minutes / inBed) * 100) : null;
    const vitalsAvg = k => avg(nights.map(n => n[k]).filter(v => v != null));
    const vital = (label, k, unit, digits = 0, better = 'up') => {
      const v = last?.[k], a = vitalsAvg(k);
      if (v == null && a == null) return '';
      const diff = v != null && a != null ? v - a : null;
      const good = diff == null ? null : better === 'up' ? diff >= 0 : diff <= 0;
      return `<div class="card"><span class="label">${label}</span><span class="num-l">${v != null ? v.toFixed(digits) : '—'}<span style="font-size:14px;color:var(--muted)"> ${unit}</span></span>
        <span class="label ${good === true ? 'good' : ''}">${a != null ? `avg ${a.toFixed(digits)}${diff != null && Math.abs(diff) >= (digits ? 0.1 : 1) ? ` · ${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(digits)}` : ''}` : ''}</span></div>`;
    };

    view.innerHTML = `
    <div class="page">
      <div class="page-head"><h1 class="page-title">Sleep</h1><button class="btn" data-act="manual">Add manually</button></div>
      ${!last ? `<div class="card"><span style="font-weight:600">No sleep data yet</span>
</div>` : `
      <div class="wide-2">
        <div class="col">
          <div class="card big">
            <div class="between" style="align-items:flex-start">
              <div class="stack" style="gap:2px">
                <span class="label">${last.date === localDate() ? 'Last night' : niceDate(last.date)}</span>
                <span class="num-xl">${fmtDur(last.minutes)}</span>
                <span class="subtle">${last.start && last.end ? `${clock(last.start)} – ${clock(last.end)}` : 'Asleep'}${inBed ? ` · ${fmtDur(inBed)} in bed` : ''}</span>
              </div>
              <div class="stack" style="align-items:center;gap:0">
                <span class="num" style="font-size:40px;color:${sc >= 70 ? 'var(--accent)' : sc >= 55 ? 'var(--carbs)' : 'var(--danger)'}">${sc}</span>
                <span class="label">${scoreWord(sc)}</span>
              </div>
            </div>
            ${hypnogram(last)}
            <div class="grid2" style="gap:8px">
              <div class="stack" style="gap:2px"><span class="label">Efficiency</span><span class="num">${eff != null ? eff + '%' : '—'}</span></div>
              <div class="stack" style="gap:2px"><span class="label">Goal</span><span class="num">${Math.round(last.minutes / goalMin * 100)}% of ${goalMin / 60} h</span></div>
            </div>
          </div>
          ${last.deep != null ? `<div class="card">
            <span style="font-weight:600">Stages</span>
            ${['deep', 'rem', 'light', 'awake'].map(k => {
              const m = last[k] || 0, pct = Math.round(m / Math.max(1, k === 'awake' ? (last.minutes + m) : last.minutes) * 100);
              return `<div class="stack" style="gap:4px"><div class="between" style="font-size:14px"><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${STAGE[k].color};margin-right:8px"></i>${STAGE[k].label}</span><span>${fmtDur(m)} · ${pct}%</span></div>
                <div class="bar"><i style="width:${Math.min(100, pct * 2)}%;background:${STAGE[k].color}"></i></div></div>`;
            }).join('')}
          </div>` : ''}
        </div>
        <div class="col">
          <div class="grid2">
            ${vital('Resting heart rate', 'resting_hr', 'bpm', 0, 'down')}
            ${vital('HRV', 'hrv', 'ms', 0, 'up')}
            ${vital('Blood oxygen', 'spo2', '%', 1, 'up')}
            ${vital('Breathing rate', 'resp', '/min', 1, 'down')}
          </div>
          <div class="card">
            <div class="between"><span style="font-weight:600">Time asleep</span>
              <div class="tabs">${[[7, '7 nights'], [14, '14'], [30, '30']].map(([d, l]) => `<button data-range="${d}" class="${range === d ? 'on' : ''}">${l}</button>`).join('')}</div></div>
            ${bars(recent.map(n => ({ label: range > 14 ? '' : new Date(n.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' }), v: n.minutes / 60, color: n.minutes >= goalMin * 0.95 ? 'var(--rem)' : '#6F5FB0' })), { h: 90, target: goalMin / 60, label: 'Hours asleep per night' })}
            <div class="grid2" style="gap:8px">
              <div class="stack" style="gap:2px"><span class="label">Average</span><span class="num">${fmtDur(avg(recent.map(n => n.minutes)))}</span></div>
              <div class="stack" style="gap:2px"><span class="label">Sleep debt (7 nights)</span><span class="num ${debt < 60 ? 'good' : ''}">${fmtDur(debt)}</span></div>
              <div class="stack" style="gap:2px"><span class="label">Usual bedtime</span><span class="num">${beds.length ? clockFromNoon(avg(beds)) : '—'}</span><span class="label">${beds.length > 2 ? `±${Math.round(sd(beds))} min` : ''}</span></div>
              <div class="stack" style="gap:2px"><span class="label">Usual wake time</span><span class="num">${wakes.length ? clockFromNoon(avg(wakes)) : '—'}</span><span class="label">${wakes.length > 2 ? `±${Math.round(sd(wakes))} min` : ''}</span></div>
            </div>
          </div>
          <div class="card"><span style="font-weight:600">Insights</span>
            ${insights(nights, goalMin).map(t => `<div class="row" style="align-items:flex-start;gap:10px;font-size:14px;line-height:1.45"><span class="good" style="margin-top:2px">${icon('sparkle', 16)}</span><span>${esc(t)}</span></div>`).join('')}
          </div>
        </div>
      </div>`}
    </div>`;
  };
  const path = '/api/sleep?days=90';
  draw(A.cached(path));
  A.get(path).then(d => { if (K.tab === 'sleep') draw(d); }).catch(() => {});

  view.onclick = e => {
    const r = e.target.closest('[data-range]');
    if (r) { range = Number(r.dataset.range); draw(A.cached(path)); return; }
    if (e.target.closest('[data-act=manual]')) {
      openSheet(`<h2>Add sleep</h2>
        <label class="field"><span>Morning you woke up</span><input id="sd" type="date" value="${localDate()}" max="${localDate()}"></label>
        <label class="field"><span>Hours asleep</span><input id="sh" type="number" inputmode="decimal" step="0.25" autofocus></label>
        <button class="btn primary big" id="ss">Save</button>`, {
        bind: sh => sh.querySelector('#ss').onclick = async () => {
          const h = Number(sh.querySelector('#sh').value);
          if (!(h > 0)) return;
          try { await A.post('/api/sleep', { date: sh.querySelector('#sd').value, hours: h }); } catch (err) { if (!err.queued) return toast(err.message); }
          closeSheet(); mount(view, K);
        },
      });
    }
  };
}
