import { esc, icon, fmtInt, addDays, dayLabel, localDate, toast, undoable, openSheet, closeSheet, debounce, readImage, $ } from './ui.js';
import * as A from './api.js';

const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snacks']];
const mealName = m => (MEALS.find(x => x[0] === m) || [, 'Snacks'])[1];
export function defaultMeal() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  return h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snacks';
}
const r0 = n => Math.round(n || 0);

// ---------------- Food page ----------------
export function mount(view, K) {
  const st = K.state;
  if (!st) { view.innerHTML = '<div class="page"><div class="empty">Loading…</div></div>'; return; }
  if (st.date !== K.date) { K.load().then(() => K.render()); }
  const logs = st.date === K.date ? st.logs : [];
  const total = logs.reduce((a, l) => a + l.kcal, 0);
  const tot = k => logs.reduce((a, l) => a + (l[k] || 0), 0);

  const mealCard = ([key, name]) => {
    const items = logs.filter(l => l.meal === key);
    if (!items.length) return `<button class="btn dashed" data-act="add" data-meal="${key}" style="justify-content:space-between;padding:0 16px;color:var(--text)"><span>${name}</span><span class="good">+ Log food</span></button>`;
    return `<div class="card">
      <div class="between"><span style="font-weight:600">${name}</span>
        <span class="row" style="gap:4px"><span class="num">${fmtInt(items.reduce((a, l) => a + l.kcal, 0))}</span>
        <button class="btn ghost small" data-act="add" data-meal="${key}" aria-label="Add to ${name}">${icon('plus', 16, 2.4)}</button>
        <button class="btn ghost small" data-act="mealmenu" data-meal="${key}" aria-label="${name} options" style="color:var(--muted)">•••</button></span></div>
      ${items.map(l => `<button class="list-row" data-act="entry" data-id="${l.id}">
        <span class="stack" style="gap:2px;min-width:0"><span style="overflow:hidden;text-overflow:ellipsis">${esc(l.name)}</span><span class="sub">${esc(l.qty !== 1 ? `${+l.qty.toFixed(2)} × ` : '')}${esc(l.serving || '')}${l.protein ? ` · ${r0(l.protein)} g protein` : ''}</span></span>
        <span class="val">${fmtInt(l.kcal)}</span></button>`).join('')}
    </div>`;
  };

  view.innerHTML = `
  <div class="page">
    <div class="page-head" style="padding-left:0;padding-right:0">
      <button class="icon-btn" data-act="prev" aria-label="Previous day">${icon('left', 18, 2.2)}</button>
      <div class="stack" style="gap:2px;align-items:center">
        <h1 class="page-title" style="font-size:22px">Food</h1>
        <span class="subtle">${dayLabel(K.date)} · ${fmtInt(total)} / ${fmtInt(st.targets.kcal)} kcal</span>
      </div>
      <button class="icon-btn" data-act="next" aria-label="Next day" ${K.date >= localDate() ? 'disabled style="opacity:.35"' : ''}>${icon('right', 18, 2.2)}</button>
    </div>
    <div class="row" style="gap:8px">
      <button class="search" data-act="search" style="border:0;text-align:left;color:var(--muted)">${icon('search', 18)}<span style="font-size:15px">Search foods</span></button>
      <button class="icon-btn square" data-act="barcode" aria-label="Scan barcode">${icon('barcode')}</button>
      <button class="icon-btn square" data-act="photo" aria-label="Photo of meal">${icon('camera')}</button>
    </div>
    <div class="chips mobile-only" id="recentchips"></div>
    <div class="wide-2" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
      <div class="col">
        ${MEALS.map(mealCard).join('')}
        <div class="between subtle" style="padding:0 4px"><span>Protein ${r0(tot('protein'))} g</span><span>Carbs ${r0(tot('carbs'))} g</span><span>Fat ${r0(tot('fat'))} g</span></div>
        <button class="btn ghost" data-act="copy" style="color:var(--muted)">Copy ${K.date === localDate() ? 'yesterday' : 'previous day'}</button>
      </div>
      <div class="col desktop-only">
        <div class="card">
          <span style="font-weight:600">${dayLabel(K.date)}</span>
          ${[['Calories', total, st.targets.kcal, 'var(--accent)', ''], ['Protein', tot('protein'), st.targets.protein, 'var(--protein)', ' g'], ['Carbs', tot('carbs'), st.targets.carbs, 'var(--carbs)', ' g'], ['Fat', tot('fat'), st.targets.fat, 'var(--fat)', ' g']].map(([n, v, g, c, u]) => `
            <div class="stack" style="gap:4px"><div class="between" style="font-size:13px"><span class="label">${n}</span><span>${fmtInt(v)}${g ? ` / ${fmtInt(g)}` : ''}${u}</span></div>
            <div class="bar"><i style="width:${g ? Math.min(100, v / g * 100) : 0}%;background:${c}"></i></div></div>`).join('')}
        </div>
        <div class="card" id="recent"><span style="font-weight:600">Recent foods</span><span class="subtle">Loading…</span></div>
      </div>
    </div>
  </div>`;

  // Phone: one-tap row of recent foods
  const chips = view.querySelector('#recentchips');
  if (chips && getComputedStyle(chips).display !== 'none') {
    const paintChips = list => {
      const top = (list || []).slice(0, 12);
      chips.innerHTML = top.map((f, i) => `<button class="chip" data-chip="${i}" style="min-height:40px">${esc(f.name.length > 22 ? f.name.slice(0, 21) + '…' : f.name)}</button>`).join('');
      chips.style.display = top.length ? '' : 'none';
      chips.onclick = e => { const b = e.target.closest('[data-chip]'); if (b) openAmount(K, top[Number(b.dataset.chip)], { date: K.date, meal: defaultMeal() }); };
    };
    paintChips(A.cached('/api/foods/search?q='));
    A.get('/api/foods/search?q=').then(paintChips).catch(() => {});
  }

  // PC: one-click add from recent foods
  const recentBox = view.querySelector('#recent');
  if (recentBox && getComputedStyle(recentBox.parentElement).display !== 'none') {
    const paintRecent = list => {
      recentBox.innerHTML = `<span style="font-weight:600">Recent foods</span>` + (list.length
        ? list.slice(0, 10).map((f, i) => {
            const p = Array.isArray(f.portions) && f.portions[0] && f.serving_g ? f.portions[0] : null;
            const m = p ? p.g / f.serving_g : 1;
            return `<button class="list-row" data-recent="${i}"><span class="stack" style="gap:2px;min-width:0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span><span class="sub">${esc(p ? p.label : f.serving)}</span></span><span class="val">${fmtInt(f.kcal * m)}</span></button>`;
          }).join('')
        : '<span class="subtle">Foods you log show up here.</span>');
      recentBox.onclick = e => { const b = e.target.closest('[data-recent]'); if (b) openAmount(K, list[Number(b.dataset.recent)], { date: K.date, meal: defaultMeal() }); };
    };
    paintRecent(A.cached('/api/foods/search?q=') || []);
    A.get('/api/foods/search?q=').then(paintRecent).catch(() => {});
  }

  view.onclick = async e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'prev' || act === 'next') { K.date = addDays(K.date, act === 'prev' ? -1 : 1); await K.load(); K.render(); }
    if (act === 'search') openAddFood(K, { date: K.date });
    if (act === 'add') openAddFood(K, { date: K.date, meal: el.dataset.meal });
    if (act === 'barcode') scanBarcode(K, { date: K.date });
    if (act === 'photo') photoEstimate(K, { date: K.date });
    if (act === 'entry') openEntry(K, logs.find(l => l.id === Number(el.dataset.id)));
    if (act === 'mealmenu') mealMenu(K, el.dataset.meal);
    if (act === 'copy') {
      try { const r = await A.post('/api/log/copy', { from: addDays(K.date, -1), to: K.date }); toast(r.length ? `Copied ${r.length} item${r.length > 1 ? 's' : ''}` : 'Nothing logged that day'); }
      catch (err) { if (!err.queued) toast(err.message); }
      K.refresh();
    }
  };
}

function mealMenu(K, meal) {
  openSheet(`<h2>${mealName(meal)}</h2>
    <div class="card" style="gap:10px"><span style="font-weight:600">Copy from another day</span>
      <div class="field-row">
        <label class="field"><span>Day</span><input id="cday" type="date" value="${addDays(K.date, -1)}" max="${localDate()}"></label>
        <label class="field"><span>Meal</span><select id="cmeal">${MEALS.map(([k, n]) => `<option value="${k}" ${k === meal ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <button class="btn primary" id="ccopy">Copy to ${mealName(meal)}</button></div>
    <div class="card" style="gap:10px"><span style="font-weight:600">Save as a meal</span>
      <input id="mname" placeholder="Meal name" aria-label="Meal name">
      <button class="btn" id="msave">Save meal</button></div>`, {
    bind: sh => {
      sh.querySelector('#ccopy').onclick = async () => {
        const from = sh.querySelector('#cday').value, fromMeal = sh.querySelector('#cmeal').value;
        try {
          const r = await A.post('/api/log/copy', { from, to: K.date, meal: fromMeal, to_meal: meal });
          toast(r.length ? `Copied ${r.length} item${r.length > 1 ? 's' : ''}` : `No ${mealName(fromMeal).toLowerCase()} logged that day`);
        } catch (e) { if (!e.queued) return toast(e.message); }
        closeSheet(); K.refresh();
      };
      sh.querySelector('#msave').onclick = async () => {
        const name = sh.querySelector('#mname').value.trim();
        if (!name) return sh.querySelector('#mname').focus();
        try { await A.post('/api/meals', { name, date: K.date, meal }); toast('Meal saved'); closeSheet(); }
        catch (e) { toast(e.message); }
      };
    },
  });
}

// ---------------- Add food sheet ----------------
export function openAddFood(K, { date = localDate(), meal = defaultMeal(), query = '' } = {}) {
  const ctx = { date, meal };
  const hasAi = K.state?.has_ai_key;
  const sheet = openSheet(`
    <div class="between"><h2>Log food</h2>
      <select id="ameal" aria-label="Meal" style="width:auto;min-height:38px">${MEALS.map(([k, n]) => `<option value="${k}" ${k === meal ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="row" style="gap:8px">
      <label class="search" style="background:var(--card-2)">${icon('search', 18)}<input id="aq" placeholder="Search, or describe what you ate" autocomplete="off" autofocus value="${esc(query)}"></label>
      <button class="icon-btn square" id="abar" aria-label="Scan barcode" style="background:var(--card-2)">${icon('barcode')}</button>
      <button class="icon-btn square" id="aphoto" aria-label="Photo of meal" style="background:var(--card-2)">${icon('camera')}</button>
    </div>
    <div id="ares" class="stack" style="gap:6px;min-height:240px"></div>`, {
    bind: sh => {
      sh.querySelector('#ameal').onchange = e => { ctx.meal = e.target.value; };
      sh.querySelector('#abar').onclick = () => scanBarcode(K, ctx);
      sh.querySelector('#aphoto').onclick = () => photoEstimate(K, ctx);
    },
  });
  const res = sheet.querySelector('#ares');
  const input = sheet.querySelector('#aq');
  let seq = 0;
  const foodRow = (f, i, src) => {
    // Show it per piece when there is one ("1 medium"), otherwise per serving
    const p = Array.isArray(f.portions) && f.portions[0] && f.serving_g ? f.portions[0] : null;
    const m = p ? p.g / f.serving_g : 1;
    const per = p ? `${p.label} (${Math.round(p.g)} g)` : f.serving;
    return `<button class="result" data-src="${src}" data-i="${i}">
      <span class="stack" style="gap:2px;min-width:0;flex:1"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.favorite ? `<span class="good">${icon('star', 13, 2.4)}</span> ` : ''}${esc(f.name)}</span>
      <span class="sub">${esc([f.brand, per].filter(Boolean).join(' · '))}</span></span>
      <span class="stack" style="gap:2px;align-items:flex-end"><span class="num">${fmtInt(f.kcal * m)}</span><span class="sub">${r0(f.protein * m)}p ${r0(f.carbs * m)}c ${r0(f.fat * m)}f</span></span></button>`;
  };

  const lists = { local: [], online: [], db: [], meals: [] };
  async function show(q) {
    const my = ++seq;
    q = q.trim();
    // Local results first: instant
    const localPath = `/api/foods/search?q=${encodeURIComponent(q)}`;
    lists.local = A.cached(localPath) || [];
    let meals = [];
    const paint = (onlineState) => {
      if (my !== seq) return;
      const parts = [];
      if (q && hasAi) parts.push(`<button class="result" data-src="ai" style="color:var(--accent)">
        <span class="row">${icon('sparkle', 18)}<span>Estimate “${esc(q.length > 40 ? q.slice(0, 40) + '…' : q)}” with AI</span></span></button>`);
      if (!q) {
        parts.push(`<div class="row" style="gap:8px"><button class="btn" style="flex:1" data-src="quick">Quick add</button><button class="btn" style="flex:1" data-src="create">Create food</button></div><button class="btn" data-src="copy">Copy from another day</button>`);
        if (lists.meals.length) parts.push(`<div class="section-title">Saved meals</div>` + lists.meals.map((m, i) => `<button class="result" data-src="meal" data-i="${i}"><span class="stack" style="gap:2px"><span>${esc(m.name)}</span><span class="sub">${m.items.length} items</span></span><span class="num">${fmtInt(m.items.reduce((a, x) => a + x.kcal, 0))}</span></button>`).join(''));
      }
      if (lists.local.length) parts.push(`<div class="section-title">${q ? 'Your foods' : 'Recent'}</div>` + lists.local.map((f, i) => foodRow(f, i, 'local')).join(''));
      if (q) {
        if (lists.db.length) parts.push(`<div class="section-title">Food database</div>` + lists.db.map((f, i) => foodRow(f, i, 'db')).join(''));
        if (lists.online.length) parts.push(`<div class="section-title">Products</div>` + lists.online.map((f, i) => foodRow(f, i, 'online')).join(''));
        else if (onlineState === 'loading') parts.push(`<div class="row subtle" style="padding:8px 4px"><span class="spin"></span>Searching shop products</div>`);
        else if (onlineState === 'done' && !lists.local.length && !lists.db.length) parts.push(`<div class="empty">No matches</div>`);
        const short = esc(q.length > 30 ? q.slice(0, 30) + '…' : q);
        parts.push(`<button class="result" data-src="custom" style="color:var(--accent)"><span class="row">${icon('plus', 18, 2.4)}<span>Add “${short}” as a custom food</span></span></button>
          <button class="result" data-src="quickq" style="color:var(--muted)"><span>Quick add “${short}”</span></button>`);
      }
      
      res.innerHTML = parts.join('');
    };
    lists.online = []; lists.db = [];
    paint(q.length >= 2 ? 'loading' : null);
    const [local, db] = await Promise.all([
      A.get(localPath).catch(() => lists.local),
      q.length >= 2 ? A.get(`/api/foods/db?q=${encodeURIComponent(q)}`).catch(() => []) : [],
    ]);
    lists.local = local || []; lists.db = db || [];
    if (!q) { try { lists.meals = await A.get('/api/meals'); } catch { lists.meals = A.cached('/api/meals') || []; } }
    paint(q.length >= 2 ? 'loading' : null);
    if (q.length >= 2) {
      try { lists.online = await A.get(`/api/foods/online?q=${encodeURIComponent(q)}`); } catch {}
      paint('done');
    }
  }
  const later = debounce(v => show(v), 280);
  input.addEventListener('input', e => { if (!e.target.value.trim()) show(''); else later(e.target.value); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); show(input.value); } });
  res.addEventListener('click', async e => {
    const el = e.target.closest('[data-src]');
    if (!el) return;
    const src = el.dataset.src, i = Number(el.dataset.i);
    if (src === 'local') openAmount(K, lists.local[i], ctx);
    if (src === 'online') openAmount(K, lists.online[i], ctx);
    if (src === 'db') openAmount(K, lists.db[i], ctx);
    if (src === 'ai') aiEstimate(K, ctx, { text: input.value.trim() });
    if (src === 'quick') quickAdd(K, ctx);
    if (src === 'create') createFood(K, ctx);
    if (src === 'custom') createFood(K, ctx, '', input.value.trim());
    if (src === 'quickq') quickAdd(K, ctx, input.value.trim());
    if (src === 'copy') mealMenu(K, ctx.meal);
    if (src === 'meal') {
      const m = lists.meals[i];
      try { await A.post(`/api/meals/${m.id}/log`, { date: ctx.date, meal: ctx.meal }); toast(`Logged ${m.name}`); }
      catch (err) { if (!err.queued) return toast(err.message); toast('Saved offline'); }
      closeSheet(); K.refresh();
    }
  });
  show(query);
}

// ---------------- amount picker ----------------
// All the ways to say how much: pieces/household measures first, then serving, then weights.
function unitOptions(food) {
  const out = [];
  const portions = Array.isArray(food.portions) ? food.portions : [];
  for (const p of portions) out.push({ id: `p${out.length}`, label: `${p.label.replace(/^1\s+/, '')} (${Math.round(p.g)} g)`, g: p.g, name: p.label, count: true });
  const servingIsWeight = /^\s*\d+(\.\d+)?\s*g\s*$/i.test(food.serving || '');
  if (!servingIsWeight || !food.serving_g) out.push({ id: 'serving', label: food.serving_g ? `serving: ${food.serving} (${Math.round(food.serving_g)} g)` : `serving: ${food.serving}`, g: food.serving_g || null, serving: true, count: true });
  if (food.serving_g) {
    out.push({ id: 'g', label: 'grams', g: 1, name: 'g' });
    out.push({ id: 'oz', label: 'ounces (28 g)', g: 28.35, name: '1 oz' });
    out.push({ id: '100g', label: '100 g', g: 100, name: '100 g' });
  }
  return out;
}

function openAmount(K, food, ctx) {
  const units = unitOptions(food);
  const remembered = (() => { try { return localStorage.getItem('kz_unit:' + (food.id || food.ext_id || food.name)); } catch { return null; } })();
  const first = units.find(u => u.id === remembered) || units[0];
  const state = { amount: first.id === 'g' ? Math.round(food.serving_g || 100) : 1, unit: first, meal: ctx.meal };
  const calc = () => {
    const amt = Number(state.amount) || 0;
    const m = state.unit.serving || !food.serving_g ? amt : (amt * state.unit.g) / food.serving_g;
    return { kcal: food.kcal * m, protein: food.protein * m, carbs: food.carbs * m, fat: food.fat * m };
  };
  const sheet = openSheet(`
    <div class="stack" style="gap:2px"><h2 style="font-size:20px">${esc(food.name)}</h2><span class="subtle">${esc([food.brand, `${fmtInt(food.kcal)} kcal per ${food.serving}`].filter(Boolean).join(' · '))}</span></div>
    <div class="field-row">
      <label class="field"><span>Amount</span>
        <span class="row" style="gap:6px"><button type="button" class="btn" id="minus" aria-label="Less" style="min-width:44px;padding:0">−</button>
        <input id="amt" type="number" inputmode="decimal" step="any" value="${state.amount}" style="text-align:center">
        <button type="button" class="btn" id="plus" aria-label="More" style="min-width:44px;padding:0">+</button></span></label>
      <label class="field"><span>Unit</span><select id="unit">${units.map(u => `<option value="${u.id}" ${u === first ? 'selected' : ''}>${esc(u.label)}</option>`).join('')}</select></label>
    </div>
    <div class="card" id="prev" style="flex-direction:row;justify-content:space-between;text-align:center"></div>
    <label class="field"><span>Meal</span><select id="meal">${MEALS.map(([k, n]) => `<option value="${k}" ${k === ctx.meal ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <button class="btn primary big" id="log">Log food</button>
    ${food.id ? `<button class="btn ghost" id="fav">${icon('star', 16, 2.2)} ${food.favorite ? 'Remove from favorites' : 'Add to favorites'}</button>` : ''}`, {
    bind: sh => {
      const paint = () => {
        const c = calc();
        sh.querySelector('#prev').innerHTML = [['kcal', c.kcal, ''], ['Protein', c.protein, 'g'], ['Carbs', c.carbs, 'g'], ['Fat', c.fat, 'g']]
          .map(([l, v, u]) => `<div class="stack" style="gap:2px"><span class="num" style="font-size:20px">${fmtInt(v)}${u}</span><span class="label">${l}</span></div>`).join('');
      };
      const amtEl = sh.querySelector('#amt');
      amtEl.oninput = e => { state.amount = e.target.value; paint(); };
      // − / + step by 1 for counts, 10 g for grams, 1 for the rest
      const step = () => (state.unit.id === 'g' ? 10 : state.unit.count ? (Number(state.amount) < 1 ? 0.25 : 1) : 1);
      sh.querySelector('#minus').onclick = () => { state.amount = Math.max(0, +(Number(state.amount || 0) - step()).toFixed(2)); amtEl.value = state.amount; paint(); };
      sh.querySelector('#plus').onclick = () => { state.amount = +(Number(state.amount || 0) + step()).toFixed(2); amtEl.value = state.amount; paint(); };
      sh.querySelector('#unit').onchange = e => {
        const prev = state.unit, next = units.find(u => u.id === e.target.value);
        // Keep the same total weight when switching units, rounded sensibly
        const grams = (Number(state.amount) || 0) * (prev.g || food.serving_g || 0);
        let amount = next.g && grams ? grams / next.g : 1;
        amount = next.id === 'g' ? Math.round(amount) : Math.max(0.25, Math.round(amount * 4) / 4);
        state.unit = next; state.amount = amount; amtEl.value = amount; paint();
      };
      sh.querySelector('#meal').onchange = e => { state.meal = e.target.value; };
      sh.querySelector('#log').onclick = async () => {
        if (!(Number(state.amount) > 0)) return;
        try { localStorage.setItem('kz_unit:' + (food.id || food.ext_id || food.name), state.unit.id); } catch {}
        const u = state.unit;
        const body = u.serving ? { unit: 'serving' } : { unit: 'weight', unit_g: u.g, unit_label: u.name };
        try { await A.post('/api/log/food', { food, date: ctx.date, meal: state.meal, amount: Number(state.amount), ...body }); toast(`Logged to ${mealName(state.meal)}`); }
        catch (e) { if (!e.queued) return toast(e.message); toast('Saved offline'); }
        closeSheet(); K.refresh();
      };
      sh.querySelector('#fav')?.addEventListener('click', async () => {
        await A.patch(`/api/foods/${food.id}`, { favorite: food.favorite ? 0 : 1 }).catch(() => {});
        food.favorite = food.favorite ? 0 : 1; toast(food.favorite ? 'Added to favorites' : 'Removed from favorites');
      });
      paint();
    },
  });
  return sheet;
}

// ---------------- edit a logged entry ----------------
function openEntry(K, l) {
  if (!l) return;
  openSheet(`
    <div class="stack" style="gap:2px"><h2 style="font-size:20px">${esc(l.name)}</h2><span class="subtle">${esc(l.serving || '')} · ${fmtInt(l.kcal)} kcal · ${r0(l.protein)}p ${r0(l.carbs)}c ${r0(l.fat)}f</span></div>
    <div class="field-row">
      <label class="field"><span>Servings</span><input id="eq" type="number" inputmode="decimal" step="any" value="${+l.qty.toFixed(2)}"></label>
      <label class="field"><span>Meal</span><select id="em">${MEALS.map(([k, n]) => `<option value="${k}" ${k === l.meal ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>
    <button class="btn primary big" id="esave">Save</button>
    <button class="btn danger" id="edel">${icon('trash', 16)} Delete</button>`, {
    bind: sh => {
      sh.querySelector('#esave').onclick = async () => {
        const qty = Number(sh.querySelector('#eq').value);
        try { await A.patch(`/api/log/food/${l.id}`, { qty: qty > 0 ? qty : l.qty, meal: sh.querySelector('#em').value }); }
        catch (e) { if (!e.queued) return toast(e.message); }
        closeSheet(); K.refresh();
      };
      sh.querySelector('#edel').onclick = () => {
        closeSheet();
        K.state.logs = K.state.logs.filter(x => x.id !== l.id); K.render();
        undoable(`Deleted ${l.name}`, () => A.del(`/api/log/food/${l.id}`).catch(() => {}).then(() => K.refresh({ auto: true })), () => K.refresh());
      };
    },
  });
}

// ---------------- quick add / create ----------------
function quickAdd(K, ctx, name = '') {
  openSheet(`<h2>Quick add</h2>
    <label class="field"><span>Name</span><input id="qn" value="${esc(name)}" ${name ? '' : 'autofocus'}></label>
    <div class="field-row"><label class="field"><span>Calories</span><input id="qk" type="number" inputmode="numeric" ${name ? 'autofocus' : ''}></label><label class="field"><span>Protein g</span><input id="qp" type="number" inputmode="decimal"></label></div>
    <div class="field-row"><label class="field"><span>Carbs g</span><input id="qc" type="number" inputmode="decimal"></label><label class="field"><span>Fat g</span><input id="qf" type="number" inputmode="decimal"></label></div>
    <button class="btn primary big" id="qsave">Log food</button>`, {
    bind: sh => {
      sh.querySelector('#qsave').onclick = async () => {
        const v = id => Number(sh.querySelector(id).value) || 0;
        if (!v('#qk')) return sh.querySelector('#qk').focus();
        try { await A.post('/api/log/food', { date: ctx.date, meal: ctx.meal, name: sh.querySelector('#qn').value.trim() || 'Quick add', serving: '1 serving', kcal: v('#qk'), protein: v('#qp'), carbs: v('#qc'), fat: v('#qf') }); }
        catch (e) { if (!e.queued) return toast(e.message); }
        toast(`Logged to ${mealName(ctx.meal)}`); closeSheet(); K.refresh();
      };
    },
  });
}

function createFood(K, ctx, barcode = '', name = '') {
  openSheet(`<h2>Create food</h2>
    <label class="field"><span>Name</span><input id="cn" value="${esc(name)}" ${name ? '' : 'autofocus'}></label>
    <div class="field-row"><label class="field"><span>Brand</span><input id="cb"></label><label class="field"><span>Serving</span><input id="cs" placeholder="1 piece"></label></div>
    <div class="field-row"><label class="field"><span>Serving weight g</span><input id="cg" type="number" inputmode="decimal"></label><label class="field"><span>Calories</span><input id="ck" type="number" inputmode="numeric" ${name ? 'autofocus' : ''}></label></div>
    <div class="field-row three"><label class="field"><span>Protein g</span><input id="cp" type="number" inputmode="decimal"></label><label class="field"><span>Carbs g</span><input id="cc" type="number" inputmode="decimal"></label><label class="field"><span>Fat g</span><input id="cf" type="number" inputmode="decimal"></label></div>
    <label class="field"><span>Barcode</span><input id="cbar" value="${esc(barcode)}" inputmode="numeric"></label>
    <button class="btn primary big" id="csave">Save and log</button>`, {
    bind: sh => {
      sh.querySelector('#csave').onclick = async () => {
        const g = id => sh.querySelector(id).value.trim();
        if (!g('#cn') || !g('#ck')) return toast('Name and calories are required');
        try {
          const food = await A.post('/api/foods', { name: g('#cn'), brand: g('#cb') || null, serving: g('#cs') || '1 serving', serving_g: Number(g('#cg')) || null, kcal: Number(g('#ck')), protein: Number(g('#cp')) || 0, carbs: Number(g('#cc')) || 0, fat: Number(g('#cf')) || 0, barcode: g('#cbar') || null }, { queue: false });
          openAmount(K, food, ctx);
        } catch (e) { toast(e.message); }
      };
    },
  });
}

// ---------------- barcode ----------------
export async function scanBarcode(K, ctx) {
  let code = null;
  if (K.native?.scanBarcode) {
    try { code = await K.native.scanBarcode(); } catch (e) { toast(e.message || 'Scanner unavailable'); }
    if (!code) return;
    return lookupBarcode(K, ctx, code);
  }
  // Browser: live camera with BarcodeDetector where supported, typed code otherwise
  const canDetect = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
  let stream = null, stop = false;
  const sheet = openSheet(`<h2>Scan barcode</h2>
    ${canDetect ? `<video id="bv" playsinline muted style="width:100%;border-radius:16px;background:#000;max-height:50vh;object-fit:cover"></video>` : ''}
    <label class="field"><span>${canDetect ? 'Or type the number' : 'Barcode number'}</span><input id="bc" inputmode="numeric" ${canDetect ? '' : 'autofocus'}></label>
    <button class="btn primary big" id="bgo">Look up</button>`, {
    onClose: () => { stop = true; stream?.getTracks().forEach(t => t.stop()); },
    bind: sh => {
      sh.querySelector('#bgo').onclick = () => { const v = sh.querySelector('#bc').value.trim(); if (v) lookupBarcode(K, ctx, v); };
    },
  });
  if (!canDetect) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = sheet.querySelector('#bv'); v.srcObject = stream; await v.play();
    const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    while (!stop) {
      const found = await det.detect(v).catch(() => []);
      if (found[0]?.rawValue) { lookupBarcode(K, ctx, found[0].rawValue); break; }
      await new Promise(r => setTimeout(r, 250));
    }
  } catch { sheet.querySelector('#bv')?.remove(); }
}

async function lookupBarcode(K, ctx, code) {
  toast('Looking up barcode…', 1500);
  try {
    const food = await A.get(`/api/foods/barcode/${encodeURIComponent(code)}`);
    openAmount(K, food, ctx);
  } catch (e) {
    if (e.status === 404) { toast('Barcode not found'); createFood(K, ctx, code); }
    else toast(e instanceof A.OfflineError ? "Can't reach your PC" : e.message);
  }
}

// ---------------- AI estimate (text or photo) ----------------
export function photoEstimate(K, ctx) {
  if (!K.state?.has_ai_key) return toast('Add your Claude API key in Settings to use photo logging');
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    const image = await readImage(f);
    aiEstimate(K, ctx, { image });
  };
  inp.click();
}

async function aiEstimate(K, ctx, { text, image }) {
  const sheet = openSheet(`<h2>AI estimate</h2>
    ${image ? `<img src="${image}" alt="Your meal" style="width:100%;max-height:220px;object-fit:cover;border-radius:16px">` : ''}
    ${image ? `<label class="field"><span>Anything to add? (optional)</span><input id="xt" placeholder="e.g. large portion, cooked in butter"></label>` : ''}
    <div id="xres" class="stack"><div class="row subtle" style="padding:12px 4px"><span class="spin"></span>Working out the calories…</div></div>`);
  const run = async (extra = '') => {
    const out = sheet.querySelector('#xres');
    out.innerHTML = `<div class="row subtle" style="padding:12px 4px"><span class="spin"></span>Working out the calories…</div>`;
    let r;
    try { r = await A.post('/api/ai/estimate', { text: [text, extra].filter(Boolean).join('. '), image }, { queue: false }); }
    catch (e) { out.innerHTML = `<div class="empty">${esc(e instanceof A.OfflineError ? "Can't reach your PC" : e.message)}</div>`; return; }
    const items = r.items.map(x => ({ ...x, on: true }));
    const paint = () => {
      const tot = items.filter(i => i.on).reduce((a, i) => a + i.kcal, 0);
      out.innerHTML = `
        ${items.map((it, i) => `<div class="card" style="padding:12px 14px;gap:6px">
          <div class="between"><label class="row" style="gap:10px;min-width:0"><input type="checkbox" data-i="${i}" ${it.on ? 'checked' : ''} style="width:20px;min-height:20px;accent-color:var(--accent)"><span style="font-weight:600">${esc(it.name)}</span></label>
          <input type="number" data-k="${i}" value="${r0(it.kcal)}" aria-label="Calories for ${esc(it.name)}" style="width:84px;text-align:right;min-height:36px"></div>
          <span class="subtle">${esc(it.serving)} · ${r0(it.protein)}p ${r0(it.carbs)}c ${r0(it.fat)}f</span></div>`).join('')}
        ${r.note ? `<span class="subtle">${esc(r.note)}</span>` : ''}
        <button class="btn primary big" id="xlog">Log ${fmtInt(tot)} kcal to ${mealName(ctx.meal)}</button>`;
      out.querySelectorAll('[data-i]').forEach(cb => cb.onchange = () => { items[cb.dataset.i].on = cb.checked; paint(); });
      out.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
        const it = items[inp.dataset.k]; const nk = Number(inp.value) || 0; const f = it.kcal ? nk / it.kcal : 1;
        it.kcal = nk; it.protein *= f; it.carbs *= f; it.fat *= f; paint();
      });
      out.querySelector('#xlog').onclick = async () => {
        const chosen = items.filter(i => i.on);
        if (!chosen.length) return;
        try { await A.post('/api/log/food/bulk', { date: ctx.date, meal: ctx.meal, items: chosen.map(i => ({ name: i.name, serving: i.serving, qty: 1, kcal: i.kcal, protein: i.protein, carbs: i.carbs, fat: i.fat })) }); }
        catch (e) { if (!e.queued) return toast(e.message); }
        toast(`Logged to ${mealName(ctx.meal)}`); closeSheet(); K.refresh();
      };
    };
    paint();
  };
  const xt = sheet.querySelector('#xt');
  if (xt) xt.addEventListener('change', () => run(xt.value.trim()));
  run();
}
