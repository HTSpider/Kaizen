import { esc, icon, toast, undoable, LB, fmtW, wUnit } from './ui.js';
import * as A from './api.js';

const ACTIVITY = [['1.2', 'Mostly sitting'], ['1.375', 'Lightly active'], ['1.55', 'Active'], ['1.725', 'Very active']];

export function mount(view, K) {
  // Phone app not paired yet: only show the connection form
  if (!A.isConfigured()) { view.innerHTML = pairPage(); bindPair(view, K); return; }

  const s = K.s;
  const lb = s.units !== 'kg';
  const t = K.state?.targets || {};
  const rateOpts = lb ? [[0.23, '0.5 lb / week'], [0.45, '1 lb / week'], [0.68, '1.5 lb / week'], [0.91, '2 lb / week']]
    : [[0.25, '0.25 kg / week'], [0.5, '0.5 kg / week'], [0.75, '0.75 kg / week'], [1, '1 kg / week']];
  const rate = Number(s.rate_kg_week);
  const nearestRate = rateOpts.reduce((a, b) => Math.abs(b[0] - rate) < Math.abs(a[0] - rate) ? b : a)[0];
  const heightFt = s.height_cm ? Math.floor(s.height_cm / 2.54 / 12) : '';
  const heightIn = s.height_cm ? Math.round(s.height_cm / 2.54 % 12) : '';
  const last = (K.state?.weight || []).slice(-1)[0];

  view.innerHTML = `
  <div class="page">
    <div class="page-head"><h1 class="page-title">Settings</h1><a href="#/today" class="btn">Done</a></div>
    <div class="wide-2">
    <div class="col stack" style="gap:12px">
      <div class="section-title">Profile</div>
      <div class="card">
        <div class="field-row">
          <label class="field"><span>Sex</span><select data-k="sex"><option value="male" ${s.sex === 'male' ? 'selected' : ''}>Male</option><option value="female" ${s.sex === 'female' ? 'selected' : ''}>Female</option></select></label>
          <label class="field"><span>Birth year</span><input data-k="birth_year" type="number" inputmode="numeric" value="${esc(s.birth_year)}" placeholder="1995"></label>
        </div>
        ${lb ? `<div class="field-row"><label class="field"><span>Height ft</span><input id="hft" type="number" inputmode="numeric" value="${heightFt}"></label><label class="field"><span>Height in</span><input id="hin" type="number" inputmode="numeric" value="${heightIn}"></label></div>`
          : `<label class="field"><span>Height cm</span><input data-k="height_cm" type="number" inputmode="numeric" value="${esc(s.height_cm)}"></label>`}
        <div class="field-row">
          <label class="field"><span>Current weight (${wUnit(s)})</span><input id="curw" type="number" inputmode="decimal" step="0.1" value="${last ? fmtW(last.kg, s) : ''}" placeholder="From your scale"></label>
          <label class="field"><span>Goal weight (${wUnit(s)})</span><input id="goalw" type="number" inputmode="decimal" step="0.1" value="${s.goal_kg ? fmtW(Number(s.goal_kg), s) : ''}"></label>
        </div>
        <label class="field"><span>Activity outside workouts</span><select data-k="activity">${ACTIVITY.map(([v, l]) => `<option value="${v}" ${s.activity === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Pace</span><select data-k="rate_kg_week">${rateOpts.map(([v, l]) => `<option value="${v}" ${v === nearestRate ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>

      <div class="section-title">Targets</div>
      <div class="card">
        <div class="between"><span>Daily calories</span><span class="num">${t.kcal ?? '—'}</span></div>
        <span class="subtle">${t.tdee_source === 'adaptive' ? `Based on your real burn of ${t.adaptive_tdee} kcal, measured from your weight trend and food logs.` : t.tdee ? `Estimated burn ${t.tdee} kcal. After about 2 weeks of logging food and weight this switches to your real measured burn.` : 'Fill in your profile to get a target.'}</span>
        <div class="field-row">
          <label class="field"><span>Set calories yourself</span><input data-k="calorie_override" type="number" inputmode="numeric" value="${esc(s.calorie_override)}" placeholder="Automatic"></label>
          <label class="field"><span>Protein g</span><input data-k="protein_override" type="number" inputmode="numeric" value="${esc(s.protein_override)}" placeholder="${t.protein ?? ''}"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Steps</span><input data-k="step_goal" type="number" inputmode="numeric" value="${esc(s.step_goal)}"></label>
          <label class="field"><span>Sleep h</span><input data-k="sleep_goal_h" type="number" inputmode="decimal" value="${esc(s.sleep_goal_h)}"></label>
        </div>
        <label class="field"><span>Units</span><select data-k="units"><option value="lb" ${lb ? 'selected' : ''}>Pounds, inches</option><option value="kg" ${!lb ? 'selected' : ''}>Kilograms, cm</option></select></label>
      </div>
    </div>

    <div class="col stack" style="gap:12px">
      ${A.isNative ? healthCard(K) : ''}
      <div class="section-title">AI coach</div>
      <div class="card">
        <label class="field"><span>Use</span><select data-k="ai_provider">
          <option value="subscription" ${(s.ai_provider || 'subscription') === 'subscription' ? 'selected' : ''}>My Claude subscription (through Claude Code on my PC)</option>
          <option value="api" ${s.ai_provider === 'api' ? 'selected' : ''}>An API key (works anywhere, billed per use)</option></select></label>
        ${(s.ai_provider || 'subscription') === 'subscription' ? `
          <label class="field"><span>Model</span><select data-k="cc_model">
            <option value="haiku" ${(s.cc_model || 'haiku') === 'haiku' ? 'selected' : ''}>Haiku (fast, lightest on your limit)</option>
            <option value="sonnet" ${s.cc_model === 'sonnet' ? 'selected' : ''}>Sonnet (middle)</option>
            <option value="opus" ${s.cc_model === 'opus' ? 'selected' : ''}>Opus (most capable, uses your limit fastest)</option></select></label>
          ${A.isNative ? '' : '<span class="subtle" id="ccstatus"></span>'}`
        : `
          <label class="field"><span>Claude API key ${s.has_api_key || K.state?.has_api_key ? '<span class="good">· saved</span>' : ''}</span><input id="aikey" type="password" placeholder="Paste your key here (sk-ant-…)" autocomplete="off"></label>
          <button class="btn" id="savekey">Save key</button>`}
      </div>

      <div class="section-title">Sync</div>
      <div id="syncbox" class="card"><span class="subtle">Loading…</span></div>
      ${A.isNative ? '' : '<div id="pair"></div>'}

      <div class="section-title">Hevy</div>
      <div class="card" id="hevybox">
        
        <label class="field"><span>Hevy Pro API key ${s.has_hevy_key || K.state?.settings?.has_hevy_key ? '<span class="good">· saved</span>' : ''}</span><input id="hevykey" type="password" placeholder="Paste your Hevy API key here" autocomplete="off"></label>
        <div class="field-row"><button class="btn" id="savehevy">Save key</button><button class="btn" id="hevynow">${icon('sync', 16)} Import now</button></div>
        <span class="subtle" id="hevystatus"></span>
      </div>

      <div class="section-title">Data</div>
      <div class="card">
        <button class="btn" id="export">Export all data</button>
      </div>
    </div>
    </div>
  </div>`;

  // Save simple fields on change
  view.querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', async () => {
    try { await A.post('/api/settings', { [el.dataset.k]: el.value }, { queue: false }); await K.load(); if (el.dataset.k === 'units' || el.dataset.k !== '') K.render(); }
    catch (e) { toast(e.message); }
  }));
  const saveHeight = async () => {
    const ft = Number(view.querySelector('#hft').value) || 0, inch = Number(view.querySelector('#hin').value) || 0;
    if (!ft) return;
    await A.post('/api/settings', { height_cm: Math.round((ft * 12 + inch) * 2.54) }, { queue: false }).catch(e => toast(e.message));
    await K.load(); K.render();
  };
  view.querySelector('#hft')?.addEventListener('change', saveHeight);
  view.querySelector('#hin')?.addEventListener('change', saveHeight);
  view.querySelector('#goalw').addEventListener('change', async e => {
    const v = Number(e.target.value);
    const kg = v ? (lb ? v / LB : v) : '';
    await A.post('/api/settings', { goal_kg: kg ? kg.toFixed(2) : '' }, { queue: false }).catch(err => toast(err.message));
    await K.load(); K.render();
  });
  view.querySelector('#curw').addEventListener('change', async e => {
    const v = Number(e.target.value);
    if (!(v > 0)) return;
    await A.post('/api/weights', { value: v }).catch(err => { if (!err.queued) toast(err.message); });
    toast('Weight saved'); await K.load(); K.render();
  });
  if (!A.isNative && view.querySelector('#ccstatus')) {
    A.get('/api/ai/status').then(r => {
      const el = view.querySelector('#ccstatus'); if (!el) return;
      const c = r.subscription;
      el.innerHTML = c.available ? `<span class="good">Claude Code signed in${c.plan ? ` · ${esc(c.plan)}` : ''}</span>` : esc(c.problem || 'Claude Code is not available.');
    }).catch(() => {});
  }
  view.querySelector('#savekey')?.addEventListener('click', async () => {
    const v = view.querySelector('#aikey').value.trim();
    if (!v) return view.querySelector('#aikey').focus();
    await A.post('/api/settings', { anthropic_key: v }, { queue: false }).then(() => toast('Key saved')).catch(e => toast(e.message));
    await K.load(); K.render();
  });
  // Hevy
  const hevyLine = async () => {
    const el = view.querySelector('#hevystatus'); if (!el) return;
    try {
      const h = await A.get('/api/hevy');
      el.textContent = !h.enabled ? '' : h.last?.error ? h.last.error
        : h.last ? `Last checked ${ago(h.last.at)}${h.last.imported ? ` · ${h.last.imported} workout${h.last.imported > 1 ? 's' : ''} imported` : ''}` : 'Not checked yet';
    } catch {}
  };
  hevyLine();
  view.querySelector('#savehevy').onclick = async () => {
    const v = view.querySelector('#hevykey').value.trim();
    if (!v) return view.querySelector('#hevykey').focus();
    try {
      await A.post('/api/settings', { hevy_key: v }, { queue: false });
      toast('Hevy key saved, importing…');
      const r = await A.post('/api/hevy/sync', {}, { queue: false });
      toast(`Imported ${r.imported} workout${r.imported === 1 ? '' : 's'} from Hevy`);
    } catch (e) { toast(e.message); }
    hevyLine();
  };
  view.querySelector('#hevynow').onclick = async e => {
    e.target.disabled = true;
    try {
      const r = await A.post('/api/hevy/sync', {}, { queue: false });
      toast(r.enabled === false ? 'Add your Hevy API key first' : `Imported ${r.imported} workout${r.imported === 1 ? '' : 's'}`);
    } catch (err) { toast(err.message); }
    e.target.disabled = false; hevyLine();
  };
  view.querySelector('#export').onclick = async () => {
    try {
      const data = await A.get('/api/export');
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `kaizen-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast(e.message); }
  };
  view.querySelector('#hsync')?.addEventListener('click', () => K.native?.sync(true).then(() => K.render()));
  view.querySelector('#hperm')?.addEventListener('click', () => K.native?.connect().then(() => K.render()));
  K.native?.appVersion?.().then(v => { const el = view.querySelector('#appver'); if (el) el.textContent = v; });
  view.querySelector('#updnow')?.addEventListener('click', async e => {
    e.target.disabled = true;
    const m = await K.native.checkForUpdate();
    const el = view.querySelector('#updmsg'); if (el && m) el.textContent = m;
    e.target.disabled = false;
  });
  if (!A.isNative) loadPairing(view);
  renderSync(view.querySelector('#syncbox'), K);
}

const ago = iso => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

async function renderSync(box, K) {
  if (!box) return;
  let st;
  try { st = await A.get('/api/sync'); } catch (e) { box.innerHTML = `<span class="subtle">${esc(e.message)}</span>`; return; }
  const phone = A.isNative;

  if (st.linked) {
    box.innerHTML = `
      <div class="between"><span>${phone ? 'Synced with your PC' : 'Sync is on'}</span><span class="${st.last_error ? '' : 'good'}">${st.last_error ? 'Problem' : 'On'}</span></div>
      <span class="subtle" id="syncline">${st.last_error ? esc(st.last_error) : `Last sync ${ago(st.last_sync)}${st.pending ? ` · ${st.pending} change${st.pending > 1 ? 's' : ''} waiting` : ''}`}</span>
      <button class="btn primary" id="syncnow">${icon('sync', 16)} Sync now</button>
      ${phone ? '' : `<div class="section-title" style="padding-left:0">Link your phone</div>
        <span class="subtle">In the Kaizen phone app, go to Settings → Sync → Scan code.</span>
        <div id="qr" style="background:#fff;border-radius:16px;padding:12px;width:220px;max-width:100%;align-self:center"></div>
        <button class="btn" id="copycode">Copy code instead</button>`}
      <button class="btn danger" id="unlink" style="align-self:flex-start;padding:0">Turn off sync on this ${phone ? 'phone' : 'PC'}</button>`;
    box.querySelector('#syncnow').onclick = async e => {
      e.target.disabled = true; e.target.textContent = 'Syncing…';
      try { const r = await A.post('/api/sync/now', {}, { queue: false }); toast(r.pulled || r.pushed ? `Synced · ${r.pulled} in, ${r.pushed} out` : 'Already up to date'); await K.load(); }
      catch (err) { toast(err.message); }
      renderSync(box, K);
    };
    box.querySelector('#unlink').onclick = () => {
      box.style.opacity = '.4';
      undoable('Sync turned off', async () => { await A.post('/api/sync/unlink', {}, { queue: false }).catch(e => toast(e.message)); renderSync(box, K); box.style.opacity = ''; }, () => { box.style.opacity = ''; });
    };
    if (!phone) {
      A.get('/api/sync/qr').then(q => { const el = box.querySelector('#qr'); if (el) el.innerHTML = q.svg; box.dataset.code = q.code; }).catch(() => box.querySelector('#qr')?.remove());
      box.querySelector('#copycode').onclick = async () => {
        try { await navigator.clipboard.writeText(box.dataset.code || (await A.get('/api/sync/code')).code); toast('Code copied'); } catch { toast("Couldn't copy"); }
      };
    }
    return;
  }

  if (phone) {
    box.innerHTML = `
      <span>Link with your PC</span>
      <button class="btn primary" id="scan">${icon('camera', 16)} Scan code</button>
      <label class="field"><span>Or paste the code</span><input id="joincode" autocomplete="off" autocapitalize="off" placeholder="KZ1.…"></label>
      <button class="btn" id="join">Link</button>
      <span id="joinmsg" class="subtle" role="status"></span>`;
    const join = async code => {
      const msg = box.querySelector('#joinmsg');
      if (!code) return;
      msg.style.color = ''; msg.textContent = 'Linking and syncing…';
      try { const r = await A.post('/api/sync/join', { code: code.trim() }, { queue: false }); toast(`Linked · ${r.pulled} items synced`); await K.load(); K.render(); }
      catch (e) { msg.style.color = 'var(--danger)'; msg.textContent = e.message; }
    };
    box.querySelector('#scan').onclick = async () => { try { join(await K.native.scanQr()); } catch (e) { toast(e.message || 'Scanner unavailable'); } };
    box.querySelector('#join').onclick = () => join(box.querySelector('#joincode').value);
    return;
  }

  // PC, not set up yet: guided Supabase setup
  box.innerHTML = `
    <span>Sync your phone and PC through your own free Supabase database. Data is encrypted on your devices before upload.</span>
    <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--muted)">
      <li>Create a free account at <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">supabase.com</a> and make a <b style="color:var(--text)">New project</b> (any name and password, nearest region).</li>
      <li>In the project, open <b style="color:var(--text)">SQL Editor</b>, paste the setup code and press <b style="color:var(--text)">Run</b>. <button class="btn small" id="copysql" style="margin-top:6px">Copy setup code</button></li>
      <li>Open <b style="color:var(--text)">Project Settings → API Keys</b> (or <b style="color:var(--text)">Data API</b>). Copy the <b style="color:var(--text)">Project URL</b> and the <b style="color:var(--text)">publishable</b> (anon) key below.</li>
    </ol>
    <label class="field"><span>Project URL</span><input id="sburl" placeholder="Paste your Project URL here" autocomplete="off"></label>
    <label class="field"><span>Publishable key</span><input id="sbkey" placeholder="Paste your publishable key here" autocomplete="off"></label>
    <button class="btn primary" id="sbgo">Turn on sync</button>
    <span id="sbmsg" class="subtle" role="status"></span>`;
  box.querySelector('#copysql').onclick = async () => {
    try { await navigator.clipboard.writeText((await A.get('/api/sync/sql')).sql); toast('Setup code copied'); } catch { toast("Couldn't copy"); }
  };
  box.querySelector('#sbgo').onclick = async e => {
    const msg = box.querySelector('#sbmsg');
    e.target.disabled = true; msg.style.color = ''; msg.textContent = 'Checking your project and uploading your data…';
    try {
      const r = await A.post('/api/sync/setup', { url: box.querySelector('#sburl').value, key: box.querySelector('#sbkey').value }, { queue: false });
      toast(`Sync is on · ${r.pushed} items uploaded`);
      renderSync(box, K);
    } catch (err) { e.target.disabled = false; msg.style.color = 'var(--danger)'; msg.textContent = err.message; }
  };
}

function healthCard(K) {
  const last = K.state?.last_health_sync;
  const ok = K.native?.status?.() || {};
  return `<div class="section-title">Health Connect</div>
    <div class="card">
      <div class="between"><span>Health Connect</span><span class="${ok.authorized ? 'good' : 'subtle'}">${ok.authorized ? 'Connected' : ok.available === false ? 'Not available' : 'Not connected'}</span></div>
      <span class="subtle">${last ? `Last sync ${new Date(last).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Never synced'}</span>
      ${diagRows(K.native?.healthDiag?.())}
      <div class="field-row"><button class="btn" id="hperm">${ok.authorized ? 'Permissions' : 'Connect'}</button><button class="btn primary" id="hsync">${icon('sync', 16)} Refresh health data</button></div>
    </div>
    <div class="section-title">App</div>
    <div class="card">
      <div class="between"><span>Version</span><span class="subtle" id="appver">…</span></div>
      <span class="subtle" id="updmsg">${esc(K.native?.updateMessage?.() || '')}</span>
      <button class="btn" id="updnow">${icon('sync', 16)} Check for updates</button>
    </div>`;
}

async function loadPairing(view) {
  const box = view.querySelector('#pair');
  if (!box) return;
  try {
    const p = await A.get('/api/pair');
    if (!p.apk || !p.urls[0]) { box.remove(); return; }
    box.outerHTML = `<div class="section-title">Phone app</div>
      <div class="card">
        <div class="between"><span>Install</span><span class="subtle">${esc(p.urls[0])}/install.html</span></div>
      </div>`;
  } catch { box.remove(); }
}

function pairPage() {
  return `<div class="page">
    <div class="page-head"><h1 class="page-title">Connect to your PC</h1></div>
    <div class="card">
      <span class="subtle">Open Kaizen on your PC, go to Settings, and copy the ${A.isNative ? 'address and pair code' : 'pair code'} shown under Phone.</span>
      ${A.isNative ? `<label class="field"><span>PC address</span><input id="purl" placeholder="http://192.168.0.10:5177" value="${esc(A.serverUrl())}" inputmode="url" autocapitalize="off"></label>` : ''}
      <label class="field"><span>Pair code</span><input id="pkey" value="${esc(A.pairKey())}" autocapitalize="off" autocomplete="off"></label>
      <button class="btn primary big" id="pgo">Connect</button>
      <span id="pmsg" class="subtle" role="status" style="min-height:20px"></span>
    </div>
    ${A.isNative ? '' : `<div class="card"><span style="font-weight:600">Get the phone app</span>
      <span class="subtle">This page works in your browser, but only the Kaizen app can read your scale, Fitbit steps and sleep from Health Connect.</span>
      <a class="btn" href="/kaizen.apk">Download the app</a></div>`}
  </div>`;
}

function bindPair(view, K) {
  const msg = view.querySelector('#pmsg');
  const btn = view.querySelector('#pgo');
  btn.onclick = async () => {
    document.activeElement?.blur(); // close the keyboard so messages are visible
    let url = '';
    if (A.isNative) {
      url = view.querySelector('#purl').value.trim().replace(/\s+/g, '').replace(/^(https?:\/\/)+/i, '');
      url = 'http://' + url.replace(/\/+$/, '');
      if (!/:\d+$/.test(url.replace(/^http:\/\//, ''))) url += ':5177';
      const host = url.replace(/^http:\/\//, '').replace(/:\d+$/, '');
      if (/^[\d.]+$/.test(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        msg.style.color = 'var(--danger)';
        msg.textContent = `"${host}" looks incomplete. A PC address has four numbers, like 192.168.0.10.`;
        return;
      }
    }
    const key = view.querySelector('#pkey').value.trim();
    A.setServer(url, key);
    btn.disabled = true; btn.textContent = 'Connecting…';
    msg.style.color = ''; msg.textContent = A.isNative ? `Trying ${url}` : '';
    try {
      await A.get('/api/settings');
      msg.textContent = 'Connected';
      toast('Connected');
      await K.load();
      K.native?.connect?.();
      K.tab = 'today';
      if (location.hash !== '#/today') location.hash = '#/today'; else K.render();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Connect';
      msg.style.color = 'var(--danger)';
      msg.textContent = e.status === 401 ? 'Wrong pair code. Check it in Kaizen on your PC under Settings → Phone.'
        : `Can't reach ${url || 'your PC'}. Make sure Kaizen is open on your PC and your phone is on the same Wi-Fi.`;
    }
  };
}

// Newest entry Health Connect returned for each type, and the app that wrote it
function diagRows(d) {
  if (!d) return '';
  const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const app = s => String(s || '').replace(/^com\.(google\.android\.apps\.)?/, '').replace(/\.android$/, '') || '';
  const row = (label, x) => `<div class="between" style="font-size:13px"><span class="subtle">${label}</span><span>${x ? `${when(x.at)}${app(x.from) ? ` · ${esc(app(x.from))}` : ''}` : `<span class="subtle">none in ${d.days} days</span>`}</span></div>`;
  return `<div class="divided" style="display:flex;flex-direction:column">${row('Sleep', d.sleep)}${row('Weight', d.weight)}${row('Steps', d.steps)}${row('Workouts', d.workouts)}</div>`;
}
