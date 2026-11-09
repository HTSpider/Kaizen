import { md, esc, icon, ring, sparkline, bars, fmtInt, fmtW, wUnit, fmtDur, fmtL, pct, niceDate, localDate, toast, openSheet, closeSheet, toDisplayW, clock } from './ui.js';
import * as A from './api.js';
import { openAddFood } from './food.js';

export function mount(view, K) {
  const st = K.state;
  if (!st) {
    const err = K.loadError;
    view.innerHTML = `<div class="page"><div class="page-head"><h1 class="page-title">Today</h1></div>
      ${err ? `<div class="card"><span style="font-weight:600">Can't load your data</span>
        <span class="subtle">${err instanceof A.OfflineError ? "Kaizen on your PC isn't reachable. Make sure it's open and this device is on the same Wi-Fi." : esc(err.message)}</span>
        <div class="field-row"><button class="btn primary" data-act="retry">Try again</button><a class="btn" href="#/settings">Connection</a></div></div>`
      : '<div class="empty">Loading…</div>'}</div>`;
    view.onclick = e => { if (e.target.closest('[data-act=retry]')) { view.innerHTML = '<div class="page"><div class="empty">Loading…</div></div>'; K.refresh(); } };
    return;
  }
  // Today always shows today, even if Food was browsing another day
  if (st.date !== st.today || K.date !== st.today) {
    K.date = localDate();
    if (st.date !== K.date) { K.load().then(() => K.render()); view.innerHTML = `<div class="page"><div class="page-head"><h1 class="page-title">Today</h1></div><div class="empty">Loading…</div></div>`; return; }
  }
  const s = st.settings, t = st.targets, sum = st.summary;
  const food = sum.food;
  const left = t.kcal != null ? t.kcal - food.kcal : null;
  const steps = sum.steps?.count ?? 0;
  const sleep = sum.sleep;
  // Calories burned today: Fitbit activity plus workouts
  const activeKcal = Math.round(sum.steps?.active_kcal || 0);
  const workoutKcal = Math.round((sum.workouts || []).reduce((a, w) => a + (w.kcal || 0), 0));
  const burned = activeKcal + workoutKcal;
  const wpts = st.weight || [];
  const last = wpts[wpts.length - 1];
  const weekAgo = wpts.filter(p => new Date(p.date) <= new Date(Date.now() - 7 * 864e5)).pop();
  const delta = last && weekAgo ? last.trend - weekAgo.trend : null;
  const logged = (st.week || []).filter(d => d.kcal);
  const weekAvg = logged.length ? logged.reduce((a, d) => a + d.kcal, 0) / logged.length : null;
  // Show the latest weekly check-in for a week after it's written
  const showCheckin = st.checkin && (new Date(st.today) - new Date(st.checkin.week)) / 864e5 <= 7;
  const needsProfile = !s.height_cm || !s.birth_year || !wpts.length;

  const macro = (name, val, goal, color) => `
    <div class="stack" style="gap:4px">
      <div class="between" style="font-size:12px"><span class="label">${name}</span><span>${fmtInt(val)} / ${goal != null ? fmtInt(goal) : '—'} g</span></div>
      <div class="bar"><i style="width:${pct(val, goal)}%;background:${color}"></i></div>
    </div>`;

  const sleepSeg = sleep && sleep.deep != null ? (() => {
    const total = (sleep.deep || 0) + (sleep.light || 0) + (sleep.rem || 0) + (sleep.awake || 0) || 1;
    return `<div class="seg"><i style="width:${sleep.deep / total * 100}%;background:var(--deep)"></i><i style="width:${(sleep.rem || 0) / total * 100}%;background:var(--rem)"></i><i style="width:${(sleep.light || 0) / total * 100}%;background:var(--line-2)"></i><i style="width:${(sleep.awake || 0) / total * 100}%;background:var(--carbs)"></i></div>`;
  })() : `<div class="bar"><i style="width:${pct(sleep?.minutes || 0, (t.sleep_h || 8) * 60)}%;background:var(--rem)"></i></div>`;

  const fast = st.fast;
  const fastH = fast ? (Date.now() - new Date(fast.start).getTime()) / 3600e3 : 0;

  view.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div class="stack" style="gap:4px">
        <span class="subtle">${niceDate(st.today)}</span>
        <h1 class="page-title">Today</h1>
      </div>
      <div class="row">
        ${st.streak ? `<span class="pill">${icon('flame', 16)} ${st.streak} day${st.streak > 1 ? 's' : ''}</span>` : ''}
        <a href="#/settings" class="icon-btn" aria-label="Settings">${icon('gear', 20)}</a>
      </div>
    </div>

    ${needsProfile ? (s.height_cm && s.birth_year
      ? `<button class="card tap" data-act="weigh" style="border:1.5px solid var(--accent-line)">
          <span style="font-weight:600">Weigh-in</span>
          <span class="subtle">Needed for your calorie target</span></button>`
      : `<button class="card tap" data-act="setup" style="border:1.5px solid var(--accent-line)">
          <span style="font-weight:600">Set up your profile</span></button>`) : ''}

    ${showCheckin ? `<button class="card tap" data-act="checkin" style="border:1.5px solid var(--accent-line)">
      <div class="between"><span style="font-weight:600">${icon('sparkle', 16)} Weekly check-in</span><span class="label">${niceDate(st.checkin.week, { weekday: false })}</span></div>
      <span class="subtle" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(st.checkin.text.replace(/[*#]/g, '').split(/\n/).filter(Boolean)[0] || '')}</span></button>` : ''}

    <div class="wide-2">
      <div class="col stack" style="gap:12px">
        <div class="card big" style="flex-direction:row;align-items:center;gap:20px">
          <div class="ring-wrap">
            ${ring(t.kcal ? food.kcal / t.kcal : 0, 150, 'var(--accent)', `${fmtInt(food.kcal)} of ${fmtInt(t.kcal)} kcal eaten`)}
            <div class="ring-center">
              <span class="num" style="font-size:34px">${left != null ? fmtInt(Math.abs(left)) : fmtInt(food.kcal)}</span>
              <span class="label">${left == null ? 'kcal eaten' : left >= 0 ? 'kcal left' : 'kcal over'}</span>
            </div>
          </div>
          <div class="stack" style="gap:12px;flex:1;min-width:0">
            ${macro('Protein', food.protein, t.protein, 'var(--protein)')}
            ${macro('Carbs', food.carbs, t.carbs, 'var(--carbs)')}
            ${macro('Fat', food.fat, t.fat, 'var(--fat)')}
          </div>
        </div>
        <button class="btn primary big" data-act="log">${icon('plus', 18, 2.4)} Log food</button>
        <div class="card">
          <div class="between"><span style="font-weight:600">This week</span><span class="label">${weekAvg != null ? `avg ${fmtInt(weekAvg)} kcal` : 'kcal per day'}</span></div>
          ${bars(st.week.map(d => ({ label: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' }), v: d.kcal, color: t.kcal && d.kcal > t.kcal * 1.05 ? 'var(--carbs)' : 'var(--accent)' })), { h: 70, target: t.kcal, label: 'Calories eaten each day this week' })}
        </div>
      </div>

      <div class="col stack" style="gap:12px">
        <div class="grid2">
          <button class="card tap" data-act="steps">
            <span class="label">Steps</span>
            <span class="num-l">${fmtInt(steps)}</span>
            <div class="bar"><i style="width:${pct(steps, t.steps)}%"></i></div>
            <span class="label">of ${fmtInt(t.steps)}</span>
          </button>
          <button class="card tap" data-act="sleep">
            <span class="label">Sleep</span>
            <span class="num-l">${sleep ? fmtDur(sleep.minutes) : '—'}</span>
            ${sleepSeg}
            <span class="label">${sleep?.deep != null ? `Deep ${fmtDur(sleep.deep)} · REM ${fmtDur(sleep.rem || 0)}` : sleep?.start ? `${clock(sleep.start)} – ${clock(sleep.end)}` : `Goal ${t.sleep_h}h`}</span>
          </button>
          <a href="#/train" class="card tap" style="text-decoration:none;color:inherit;grid-column:1 / -1">
            <span class="label">Burned</span>
            <span class="num-l">${fmtInt(burned)} <span style="font-size:14px;color:var(--muted)">kcal</span></span>
            <div class="seg"><i style="width:${burned ? activeKcal / burned * 100 : 0}%;background:var(--accent)"></i><i style="width:${burned ? workoutKcal / burned * 100 : 0}%;background:var(--carbs)"></i></div>
            <span class="label">${burned ? `Activity ${fmtInt(activeKcal)}${workoutKcal ? ` · workouts ${fmtInt(workoutKcal)}` : ''}` : 'Activity and workouts'}</span>
          </a>
        </div>
        ${fast ? `<button class="card tap" data-act="fast" style="flex-direction:row;justify-content:space-between;align-items:center">
          <span class="row">${icon('timer', 20)}<span style="font-weight:600">Fasting</span></span>
          <span class="num ${fastH >= fast.goal_h ? 'good' : ''}">${Math.floor(fastH)}h ${String(Math.floor(fastH % 1 * 60)).padStart(2, '0')}m / ${fast.goal_h}h</span></button>` : ''}
        ${sum.workouts.length ? `<div class="card"><span class="label">Workouts</span>${sum.workouts.map(w => `<div class="between"><span>${esc(w.name)}</span><span class="subtle">${w.minutes ? Math.round(w.minutes) + ' min' : ''}${w.kcal ? ` · ${w.kcal} kcal` : ''}</span></div>`).join('')}</div>` : ''}
      </div>
    </div>
  </div>`;

  view.onclick = async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'log') openAddFood(K, { date: st.today });
    if (act === 'setup') K.go('settings');
    if (act === 'checkin') openSheet(`<div class="between"><h2>Weekly check-in</h2><span class="label">${niceDate(st.checkin.week, { weekday: false })}</span></div><div class="msg bot" style="max-width:100%">${md(st.checkin.text)}</div>`);
    if (act === 'weigh') import('./body.js').then(m => m.weighIn(K, () => K.refresh()));
    if (act === 'steps') manualSheet(K, 'steps');
    if (act === 'sleep') K.go('sleep');
    if (act === 'fast') K.go('body');
  };
}

function manualSheet(K, kind) {
  const st = K.state;
  const synced = K.state.last_health_sync;
  openSheet(`
    <h2>${kind === 'steps' ? 'Steps' : 'Sleep'}</h2>
    <span class="subtle">${synced ? `Synced from Health Connect ${new Date(synced).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not synced from your phone yet'}</span>
    <label class="field"><span>${kind === 'steps' ? 'Steps today' : 'Hours slept last night'}</span>
      <input id="mval" type="number" inputmode="decimal" autofocus value="${kind === 'steps' ? (st.summary.steps?.count ?? '') : st.summary.sleep ? (st.summary.sleep.minutes / 60).toFixed(1) : ''}"></label>
    <button class="btn primary big" id="msave">Save</button>
    ${K.native ? `<button class="btn big" id="msync">${icon('sync', 18)} Refresh health data</button>` : ''}`,
    {
      bind: sh => {
        sh.querySelector('#msave').onclick = async () => {
          const v = Number(sh.querySelector('#mval').value);
          if (!(v >= 0)) return;
          try {
            if (kind === 'steps') await A.post('/api/steps', { date: st.today, count: v });
            else await A.post('/api/sleep', { date: st.today, hours: v });
          } catch (e) { if (!e.queued) return toast(e.message); }
          closeSheet(); K.refresh();
        };
        sh.querySelector('#msync')?.addEventListener('click', async () => { closeSheet(); await K.native.sync(true); });
      },
    });
}
