// Workouts: an overview of training logged in Hevy (no logging here).
import { esc, icon, fmtInt, toast, undoable, openSheet, closeSheet, niceDate, LB, bars, sparkline } from './ui.js';
import * as A from './api.js';

const isLb = K => K.s.units !== 'kg';
const toDisp = (K, kg) => kg == null ? '' : +(isLb(K) ? kg * LB : kg).toFixed(1);
const wu = K => isLb(K) ? 'lb' : 'kg';
const hidden = new Set(); // deleted, waiting for Undo to run out

export function mount(view, K) {
  const draw = (training, history, records) => {
    const weeks = training?.weeks || [];
    const thisWeek = weeks[weeks.length - 1] || { count: 0, minutes: 0, kcal: 0 };
    const past = weeks.slice(0, -1).filter(w => w.count);
    const avgCount = past.length ? past.reduce((a, w) => a + w.count, 0) / past.length : null;
    const list = (history || []).filter(w => !hidden.has(w.id));
    const lifts = training?.lifts || [];

    view.innerHTML = `
    <div class="page">
      <div class="page-head"><h1 class="page-title">Workouts</h1><button class="btn" data-act="hevy">Import from Hevy</button></div>
      <div class="wide-2">
        <div class="col">
          <div class="card big">
            <span class="label">This week</span>
            <div class="grid2" style="grid-template-columns:repeat(3,minmax(0,1fr))">
              <div class="stack" style="gap:2px"><span class="num-xl">${thisWeek.count}</span><span class="label">workout${thisWeek.count === 1 ? '' : 's'}${avgCount != null ? ` · avg ${avgCount.toFixed(1)}` : ''}</span></div>
              <div class="stack" style="gap:2px"><span class="num-xl">${fmtInt(thisWeek.minutes)}</span><span class="label">minutes</span></div>
              <div class="stack" style="gap:2px"><span class="num-xl">${fmtInt(thisWeek.kcal)}</span><span class="label">kcal</span></div>
            </div>
          </div>
          <div class="card">
            <div class="between"><span style="font-weight:600">Workouts per week</span><span class="label">12 weeks</span></div>
            ${bars(weeks.map(w => ({ label: new Date(w.week + 'T12:00:00').getDate() + '', v: w.count, color: 'var(--accent)' })), { h: 80, label: 'Workouts each week' })}
          </div>
          ${lifts.length ? `<div class="section-title">Strength</div>` + lifts.map(l => {
            const pts = l.points.map(p => p.e1rm);
            const first = pts[0], last = pts[pts.length - 1];
            const change = first && last ? last - first : null;
            return `<div class="card" style="flex-direction:row;align-items:center;justify-content:space-between;gap:12px">
              <div class="stack" style="gap:2px;min-width:0"><span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.name)}</span>
                <span class="label">est. max ${toDisp(K, last)} ${wu(K)}${change != null && Math.abs(change) >= 0.5 ? ` · <span class="${change > 0 ? 'good' : ''}">${change > 0 ? '+' : '−'}${Math.abs(toDisp(K, change))}</span>` : ''}</span></div>
              ${sparkline(pts, 110, 32)}</div>`;
          }).join('') : ''}
        </div>
        <div class="col">
          ${(records || []).length ? `<div class="section-title">Best lifts</div><div class="card divided" style="padding:4px 18px;gap:0">${records.slice(0, 10).map(r => `<div class="between"><span style="font-size:14px">${esc(r.name)}</span><span class="subtle">${toDisp(K, r.top_kg)} ${wu(K)}</span></div>`).join('')}</div>` : ''}
          <div class="section-title">History</div>
          ${list.length ? list.map(w => `<button class="card tap" data-act="view" data-id="${w.id}">
              <div class="between"><span style="font-weight:600">${esc(w.name)}</span><span class="subtle">${niceDate(w.date, { weekday: false })}</span></div>
              <span class="subtle">${[w.minutes ? `${Math.round(w.minutes)} min` : '', w.set_count ? `${w.set_count} sets` : '', w.volume ? `${fmtInt(toDisp(K, w.volume))} ${wu(K)}` : '', w.kcal ? `${w.kcal} kcal` : ''].filter(Boolean).join(' · ')}</span></button>`).join('')
            : `<div class="card"><span style="font-weight:600">No workouts yet</span></div>`}
        </div>
      </div>
    </div>`;
  };

  const paths = ['/api/training?weeks=12', '/api/workouts?limit=40', '/api/records'];
  draw(...paths.map(p => A.cached(p)));
  Promise.all(paths.map(p => A.get(p).catch(() => A.cached(p)))).then(d => { if (K.tab === 'train') draw(...d); });

  view.onclick = e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'hevy') hevyImport(K, () => mount(view, K));
    if (el.dataset.act === 'view') viewWorkout(K, Number(el.dataset.id), () => mount(view, K));
  };
}

function setText(K, g, s) {
  if (g.kind === 'cardio') return [s.minutes ? `${+s.minutes} min` : '', s.km ? `${+s.km} km` : ''].filter(Boolean).join(' · ') || '—';
  return `${s.kg != null ? `${toDisp(K, s.kg)} ${wu(K)} × ` : ''}${s.reps ?? '—'}${s.kg == null ? ' reps' : ''}`;
}

async function viewWorkout(K, id, after) {
  let w;
  try { w = await A.get(`/api/workouts/${id}`); } catch (e) { return toast(e.message); }
  openSheet(`<div class="stack" style="gap:2px"><h2>${esc(w.name)}</h2><span class="subtle">${niceDate(w.date)}${w.minutes ? ` · ${Math.round(w.minutes)} min` : ''}${w.kcal ? ` · ${w.kcal} kcal` : ''}</span></div>
    ${w.exercises.length ? w.exercises.map(g => `<div class="card"><span style="font-weight:600">${esc(g.exercise)}</span>${g.sets.map((s, i) => `<div class="between subtle"><span>Set ${i + 1}</span><span>${setText(K, g, s)}</span></div>`).join('')}</div>`).join('')
      : `<div class="card"><span class="subtle">Sets come in with Import from Hevy.</span></div>`}
    <button class="btn danger" id="vdel">${icon('trash', 16)} Delete</button>`, {
    bind: sh => {
      sh.querySelector('#vdel').onclick = () => {
        closeSheet(); hidden.add(id); after?.();
        undoable('Deleted workout', () => A.del(`/api/workouts/${id}`, { queue: false }).then(() => { hidden.delete(id); after?.(); }), () => { hidden.delete(id); after?.(); });
      };
    },
  });
}

// ---------------- Hevy ----------------
function hevyImport(K, after) {
  openSheet(`<h2>Import from Hevy</h2>
    <div class="card" style="gap:6px"><span style="font-weight:600">Automatic</span>
      <span class="subtle">Hevy → Profile → Settings → Integrations → Health Connect</span></div>
    <div class="card" style="gap:8px"><span style="font-weight:600">Sets and reps</span>
      <span class="subtle">Hevy → Profile → Settings → Export &amp; Import Data → Export Workouts</span>
      <label class="btn primary" style="cursor:pointer">Choose the export file<input type="file" id="hevyfile" accept=".csv,text/csv,text/comma-separated-values,text/plain" style="display:none"></label>
      <span id="hevymsg" class="subtle" role="status"></span></div>`, {
    bind: sh => {
      sh.querySelector('#hevyfile').onchange = async e => {
        const f = e.target.files?.[0];
        const msg = sh.querySelector('#hevymsg');
        if (!f) return;
        msg.style.color = ''; msg.textContent = 'Importing…';
        try {
          const r = await A.post('/api/import/hevy-csv', { csv: await f.text() }, { queue: false });
          toast(`Imported ${r.imported} workout${r.imported === 1 ? '' : 's'} from Hevy`);
          closeSheet(); after?.();
        } catch (err) { msg.style.color = 'var(--danger)'; msg.textContent = err.message; }
      };
    },
  });
}
