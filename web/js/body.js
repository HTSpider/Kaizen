import { esc, icon, fmtInt, fmtW, wUnit, toDisplayW, fmtDur, weightChart, bars, toast, undoable, openSheet, closeSheet, niceDate, localDate, addDays, clock } from './ui.js';
import * as A from './api.js';
import { openPhotos } from './photos.js';

let range = 30;

export function mount(view, K) {
  const s = K.s;
  const draw = (wdata, trends, meas, fasts) => {
    const trend = wdata?.trend || [];
    const start = addDays(localDate(), -range + 1);
    const pts = trend.filter(p => p.date >= start).map(p => ({ date: p.date, v: toDisplayW(p.kg, s), t: toDisplayW(p.trend, s) }));
    const last = trend[trend.length - 1];
    const weekAgo = trend.filter(p => p.date <= addDays(localDate(), -7)).pop();
    const delta = last && weekAgo ? last.trend - weekAgo.trend : null;
    const proj = wdata?.projection;
    const t = K.state?.targets || {};
    const days = trends || [];
    const avg = (k, filter = v => v != null) => { const v = days.map(d => d[k]).filter(filter); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const last14 = days.slice(-14);
    const dl = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' });
    const fast = fasts?.find(f => !f.end);
    const fastH = fast ? (Date.now() - new Date(fast.start).getTime()) / 3600e3 : 0;
    const lastM = meas?.[0];
    const cm = v => v == null ? null : s.units === 'kg' ? `${v.toFixed(1)} cm` : `${(v / 2.54).toFixed(1)} in`;

    view.innerHTML = `
    <div class="page">
      <div class="page-head"><h1 class="page-title">Body</h1><button class="btn primary" data-act="weigh">Weigh-in</button></div>
      <div class="wide-2">
        <div class="col stack" style="gap:12px">
          <div class="card big">
            <div class="between" style="align-items:flex-start">
              <div class="stack" style="gap:2px">
                <span class="label">Trend weight</span>
                <span class="num-xl">${last ? fmtW(last.trend, s) : '—'} <span style="font-size:16px;color:var(--muted)">${wUnit(s)}</span></span>
                <span class="${delta != null && delta < 0 ? 'good' : 'subtle'}" style="font-size:13px">${delta != null ? `${delta <= 0 ? '−' : '+'}${Math.abs(toDisplayW(delta, s)).toFixed(1)} ${wUnit(s)} this week` : ''}</span>
              </div>
              <div class="tabs">${[[30, '1M'], [90, '3M'], [365, '1Y']].map(([d, l]) => `<button data-range="${d}" class="${range === d ? 'on' : ''}">${l}</button>`).join('')}</div>
            </div>
            ${weightChart(pts, { goal: s.goal_kg ? toDisplayW(Number(s.goal_kg), s) : null, label: 'Weight trend chart' })}
            <div class="between label"><span>${pts[0] ? niceDate(pts[0].date, { weekday: false }) : ''}</span><span>${s.goal_kg ? `Goal ${fmtW(Number(s.goal_kg), s, 0)} ${wUnit(s)}${proj?.eta ? ` · about ${niceDate(proj.eta, { weekday: false })}` : ''}` : ''}</span><span>${pts.length ? niceDate(pts[pts.length - 1].date, { weekday: false }) : ''}</span></div>
          </div>
          <div class="grid2">
            <div class="card"><span class="label">Your real burn</span><span class="num-l">${fmtInt(t.adaptive_tdee ?? t.formula_tdee)}</span><span class="label">${t.adaptive_tdee ? 'kcal / day, from your data' : 'kcal / day, estimate'}</span></div>
            <div class="card"><span class="label">Avg eaten</span><span class="num-l">${fmtInt(avg('kcal'))}</span><span class="label">kcal / day, ${range === 30 ? '30' : range} days</span></div>
            <div class="card"><span class="label">Avg sleep</span><span class="num-l">${avg('sleep_min') != null ? fmtDur(avg('sleep_min')) : '—'}</span><span class="label">${avg('resting_hr') != null ? `Resting HR ${Math.round(avg('resting_hr'))}` : `Goal ${t.sleep_h || 8}h`}</span></div>
            <div class="card"><span class="label">Avg steps</span><span class="num-l">${fmtInt(avg('steps'))}</span><span class="label">Goal ${fmtInt(t.steps)}</span></div>
          </div>
        </div>
        <div class="col stack" style="gap:12px">
          <div class="card"><div class="between"><span style="font-weight:600">Steps</span><span class="label">last 14 days</span></div>
            ${bars(last14.map(d => ({ label: dl(d.date), v: d.steps, color: d.steps >= t.steps ? 'var(--accent)' : '#7E9A4A' })), { target: t.steps, label: 'Steps per day' })}</div>
          <div class="card"><div class="between"><span style="font-weight:600">Sleep</span><span class="label">last 14 days</span></div>
            ${bars(last14.map(d => ({ label: dl(d.date), v: d.sleep_min ? d.sleep_min / 60 : null, color: 'var(--rem)' })), { target: t.sleep_h, label: 'Hours slept per night' })}</div>
          <div class="card divided" style="padding:4px 16px;gap:0">
            <button class="list-row" data-act="photos"><span>Progress photos</span><span class="val">View</span></button>
            <button class="list-row" data-act="measure"><span>Measurements</span><span class="val">${lastM?.waist ? `Waist ${cm(lastM.waist)}` : 'Add'}</span></button>
            <button class="list-row" data-act="fast"><span>Fasting</span><span class="val ${fast && fastH >= fast.goal_h ? 'good' : ''}">${fast ? `${Math.floor(fastH)}h ${String(Math.floor(fastH % 1 * 60)).padStart(2, '0')}m of ${fast.goal_h}h` : 'Not running'}</span></button>
            <button class="list-row" data-act="history"><span>Weigh-ins</span><span class="val">${wdata?.entries?.length ? `${wdata.entries.length} logged` : 'None yet'}</span></button>
          </div>
        </div>
      </div>
    </div>`;
  };

  const paths = ['/api/weights', `/api/trends?days=${Math.max(range, 30)}`, '/api/measurements', '/api/fasts'];
  const data = paths.map(p => A.cached(p));
  draw(...data);
  Promise.all(paths.map(p => A.get(p).catch(() => A.cached(p)))).then(d => { data.splice(0, 4, ...d); if (K.tab === 'body') draw(...d); });

  view.onclick = async e => {
    const el = e.target.closest('[data-act],[data-range]');
    if (!el) return;
    if (el.dataset.range) { range = Number(el.dataset.range); mount(view, K); return; }
    const act = el.dataset.act;
    if (act === 'weigh') weighIn(K, () => mount(view, K));
    if (act === 'photos') openPhotos(K);
    if (act === 'measure') measurements(K, data[2] || [], () => mount(view, K));
    if (act === 'fast') fasting(K, data[3] || [], () => { mount(view, K); K.load(); });
    if (act === 'history') weighins(K, data[0]?.entries || [], () => mount(view, K));
  };
}

export function weighIn(K, after) {
  const s = K.s;
  openSheet(`<h2>Weigh-in</h2>
    <div class="field-row"><label class="field"><span>Weight (${wUnit(s)})</span><input id="wv" type="number" inputmode="decimal" step="0.1" autofocus></label>
    <label class="field"><span>Body fat % (optional)</span><input id="wf" type="number" inputmode="decimal" step="0.1"></label></div>
    <label class="field"><span>Date</span><input id="wd" type="date" value="${localDate()}" max="${localDate()}"></label>
    <button class="btn primary big" id="wsave">Save</button>`, {
    bind: sh => {
      sh.querySelector('#wsave').onclick = async () => {
        const v = Number(sh.querySelector('#wv').value);
        if (!(v > 0)) return sh.querySelector('#wv').focus();
        try { await A.post('/api/weights', { value: v, fat_pct: sh.querySelector('#wf').value, date: sh.querySelector('#wd').value }); }
        catch (e) { if (!e.queued) return toast(e.message); }
        toast('Weight saved'); closeSheet(); await K.load(); after?.();
      };
    },
  });
}

function weighins(K, entries, after) {
  const s = K.s;
  openSheet(`<h2>Weigh-ins</h2>
    <div class="card divided" style="padding:4px 16px;gap:0">${entries.slice(0, 60).map(w => `<div class="between"><span style="font-size:14px">${niceDate(w.date, { weekday: false })} <span class="subtle">${clock(w.ts)}${w.source === 'health' ? ' · scale' : ''}</span></span>
      <span class="row" style="gap:6px"><span>${fmtW(w.kg, s)} ${wUnit(s)}${w.fat_pct ? ` <span class="subtle">${w.fat_pct.toFixed(1)}%</span>` : ''}</span><button class="btn ghost small" data-del="${w.id}" aria-label="Delete" style="color:var(--muted)">${icon('trash', 15)}</button></span></div>`).join('') || '<div class="empty">None yet</div>'}</div>`, {
    bind: sh => sh.addEventListener('click', async e => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      const row = b.closest('.between'); row.style.display = 'none';
      undoable('Deleted weigh-in', async () => { await A.del(`/api/weights/${b.dataset.del}`).catch(() => {}); await K.load(); after?.(); }, () => { row.style.display = ''; });
    }),
  });
}

function measurements(K, list, after) {
  const s = K.s, u = s.units === 'kg' ? 'cm' : 'in';
  const fields = [['waist', 'Waist'], ['hips', 'Hips'], ['chest', 'Chest'], ['arm', 'Arm'], ['thigh', 'Thigh'], ['neck', 'Neck']];
  const disp = v => v == null ? '—' : (u === 'cm' ? v : v / 2.54).toFixed(1);
  openSheet(`<h2>Measurements</h2>
    <div class="field-row three">${fields.map(([k, l]) => `<label class="field"><span>${l} (${u})</span><input data-k="${k}" type="number" inputmode="decimal" step="0.1"></label>`).join('')}</div>
    <button class="btn primary big" id="msave">Save</button>
    ${list.length ? `<div class="section-title">History</div><div class="card divided" style="padding:4px 16px;gap:0">${list.slice(0, 20).map(m => `<div class="between" style="font-size:13px"><span>${niceDate(m.date, { weekday: false })}</span><span class="subtle">${fields.filter(([k]) => m[k] != null).map(([k, l]) => `${l} ${disp(m[k])}`).join(' · ')}</span></div>`).join('')}</div>` : ''}`, {
    bind: sh => {
      sh.querySelector('#msave').onclick = async () => {
        const body = {};
        sh.querySelectorAll('[data-k]').forEach(i => { if (i.value) body[i.dataset.k] = i.value; });
        if (!Object.keys(body).length) return;
        try { await A.post('/api/measurements', body); } catch (e) { if (!e.queued) return toast(e.message); }
        toast('Saved'); closeSheet(); after?.();
      };
    },
  });
}

function fasting(K, list, after) {
  const fast = list.find(f => !f.end);
  const goal = Number(K.s.fast_goal_h) || 16;
  openSheet(`<h2>Fasting</h2>
    ${fast ? `<div class="card big" style="align-items:center;text-align:center"><span class="label">Fasting since ${clock(fast.start)}</span><span class="num-xl" id="fclock"></span><span class="label">Goal ${fast.goal_h}h · ends ${clock(new Date(new Date(fast.start).getTime() + fast.goal_h * 3600e3).toISOString())}</span></div>
      <button class="btn primary big" id="fstop">End fast</button>`
    : `<div class="chips">${[12, 14, 16, 18, 20].map(h => `<button class="chip ${h === goal ? 'on' : ''}" data-h="${h}">${h}h</button>`).join('')}</div>
      <button class="btn primary big" id="fstart">Start fast</button>`}
    ${list.filter(f => f.end).length ? `<div class="section-title">Recent</div><div class="card divided" style="padding:4px 16px;gap:0">${list.filter(f => f.end).slice(0, 10).map(f => { const h = (new Date(f.end) - new Date(f.start)) / 3600e3; return `<div class="between" style="font-size:14px"><span>${niceDate(f.start.slice(0, 10), { weekday: false })}</span><span class="${h >= f.goal_h ? 'good' : 'subtle'}">${h.toFixed(1)}h of ${f.goal_h}h</span></div>`; }).join('')}</div>` : ''}`, {
    bind: sh => {
      let h = goal;
      sh.querySelectorAll('[data-h]').forEach(b => b.onclick = () => { h = Number(b.dataset.h); sh.querySelectorAll('[data-h]').forEach(x => x.classList.toggle('on', x === b)); });
      sh.querySelector('#fstart')?.addEventListener('click', async () => { await A.post('/api/fasts/start', { goal_h: h }).catch(e => toast(e.message)); closeSheet(); after?.(); });
      sh.querySelector('#fstop')?.addEventListener('click', async () => { await A.post('/api/fasts/stop', {}).catch(e => toast(e.message)); closeSheet(); after?.(); });
      const clk = sh.querySelector('#fclock');
      if (clk) {
        const paint = () => { if (!document.body.contains(clk)) return clearInterval(iv); const s = Math.floor((Date.now() - new Date(fast.start).getTime()) / 1000); clk.textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
        const iv = setInterval(paint, 1000); paint();
      }
    },
  });
}
