// Progress photos: private, stored on your devices and synced encrypted.
import { esc, icon, toast, undoable, openSheet, closeSheet, niceDate, localDate, fmtW, wUnit, toDisplayW, readImage } from './ui.js';
import * as A from './api.js';

const POSES = [['front', 'Front'], ['side', 'Side'], ['back', 'Back']];
const full = new Map(); // id -> full data URL, cached while the sheet is open
const hidden = new Set(); // deleted, waiting for Undo to run out

async function fullPhoto(id) {
  if (!full.has(id)) full.set(id, (await A.get(`/api/photos/${id}`)).data);
  return full.get(id);
}

export function openPhotos(K) {
  let list = A.cached('/api/photos') || [];
  let pose = 'front';
  const s = K.s;
  const sheet = openSheet(`<div class="between"><h2>Progress photos</h2><button class="btn primary small" id="padd">${icon('camera', 16)} Add</button></div>
    <div class="chips" id="pposes"></div>
    <div id="pcompare"></div>
    <div id="pgrid"></div>`, { onClose: () => full.clear() });

  const paint = async () => {
    list = list.filter(p => !hidden.has(p.id));
    const mine = list.filter(p => p.pose === pose);
    sheet.querySelector('#pposes').innerHTML = POSES.map(([k, l]) => `<button class="chip ${k === pose ? 'on' : ''}" data-pose="${k}">${l} · ${list.filter(p => p.pose === k).length}</button>`).join('');
    const grid = sheet.querySelector('#pgrid');
    const cmp = sheet.querySelector('#pcompare');
    if (!mine.length) {
      cmp.innerHTML = '';
      grid.innerHTML = `<div class="empty">No ${pose} photos yet</div>`;
      return;
    }
    grid.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${mine.map(p => `
      <button data-open="${p.id}" style="border:0;padding:0;background:var(--card);border-radius:12px;overflow:hidden;cursor:pointer;color:var(--text);text-align:left">
        <img src="${p.thumb || ''}" alt="${esc(pose)} photo ${esc(p.date)}" style="width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:var(--card-2)">
        <span class="label" style="display:block;padding:6px 8px">${niceDate(p.date, { weekday: false })}</span></button>`).join('')}</div>`;

    if (mine.length < 2) { cmp.innerHTML = ''; return; }
    // Compare: oldest vs newest by default; both can be changed
    const opts = sel => mine.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${niceDate(p.date, { weekday: false })}</option>`).join('');
    const a = mine[mine.length - 1], b = mine[0];
    cmp.innerHTML = `<div class="card" style="gap:10px"><span style="font-weight:600">Compare</span>
      <div class="field-row"><select id="pca" aria-label="Before">${opts(a.id)}</select><select id="pcb" aria-label="After">${opts(b.id)}</select></div>
      <div class="field-row" id="pcimgs"></div><span class="subtle" id="pcdiff"></span></div>`;
    const draw = async () => {
      const pa = mine.find(p => p.id === Number(cmp.querySelector('#pca').value));
      const pb = mine.find(p => p.id === Number(cmp.querySelector('#pcb').value));
      const box = cmp.querySelector('#pcimgs');
      box.innerHTML = [pa, pb].map(p => `<div class="stack" style="gap:4px"><img src="${p.thumb}" data-full="${p.id}" alt="Photo from ${esc(p.date)}" style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:12px;background:var(--card-2)">
        <span class="label">${niceDate(p.date, { weekday: false })}${p.weight_kg ? ` · ${fmtW(p.weight_kg, s)} ${wUnit(s)}` : ''}</span></div>`).join('');
      const days = Math.round((new Date(pb.date) - new Date(pa.date)) / 864e5);
      const dw = pa.weight_kg && pb.weight_kg ? toDisplayW(pb.weight_kg - pa.weight_kg, s) : null;
      cmp.querySelector('#pcdiff').textContent = `${Math.abs(days)} days apart${dw != null ? ` · ${dw <= 0 ? '−' : '+'}${Math.abs(dw).toFixed(1)} ${wUnit(s)}` : ''}`;
      for (const img of box.querySelectorAll('img[data-full]')) fullPhoto(Number(img.dataset.full)).then(src => { img.src = src; }).catch(() => {});
    };
    cmp.querySelector('#pca').onchange = draw;
    cmp.querySelector('#pcb').onchange = draw;
    draw();
  };

  sheet.addEventListener('click', async e => {
    const p = e.target.closest('[data-pose]');
    if (p) { pose = p.dataset.pose; paint(); return; }
    const o = e.target.closest('[data-open]');
    if (o) { viewPhoto(K, list.find(x => x.id === Number(o.dataset.open)), () => refresh()); return; }
    if (e.target.closest('#padd')) addPhoto(K, pose, () => refresh());
  });
  const refresh = async () => { try { list = await A.get('/api/photos'); } catch {} paint(); };
  paint();
  refresh();
}

function addPhoto(K, pose, after) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'user';
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    const [data, thumb] = await Promise.all([readImage(f, 1100, 0.8), readImage(f, 260, 0.7)]);
    openSheet(`<h2>Add photo</h2>
      <img src="${data}" alt="New photo" style="width:100%;max-height:50vh;object-fit:contain;border-radius:16px;background:var(--card)">
      <div class="field-row">
        <label class="field"><span>Pose</span><select id="npose">${POSES.map(([k, l]) => `<option value="${k}" ${k === pose ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Date</span><input id="ndate" type="date" value="${localDate()}" max="${localDate()}"></label>
      </div>
      <button class="btn primary big" id="nsave">Save photo</button>`, {
      bind: sh => sh.querySelector('#nsave').onclick = async () => {
        try {
          await A.post('/api/photos', { data, thumb, pose: sh.querySelector('#npose').value, date: sh.querySelector('#ndate').value }, { queue: false });
          toast('Photo saved'); closeSheet(); openPhotos(K);
        } catch (e) { toast(e.message); }
      },
    });
  };
  inp.click();
}

async function viewPhoto(K, p, after) {
  if (!p) return;
  const sheet = openSheet(`<div class="between"><h2 style="font-size:18px">${niceDate(p.date)}</h2><span class="subtle">${esc(p.pose)}${p.weight_kg ? ` · ${fmtW(p.weight_kg, K.s)} ${wUnit(K.s)}` : ''}</span></div>
    <img id="pv" src="${p.thumb}" alt="Progress photo" style="width:100%;max-height:70vh;object-fit:contain;border-radius:16px;background:var(--card)">
    <div class="field-row"><button class="btn" id="pback">Back</button><button class="btn danger" id="pdel">${icon('trash', 16)} Delete</button></div>`, {
    bind: sh => {
      sh.querySelector('#pback').onclick = () => openPhotos(K);
      sh.querySelector('#pdel').onclick = () => {
        hidden.add(p.id); openPhotos(K);
        undoable('Deleted photo', () => A.del(`/api/photos/${p.id}`, { queue: false }).then(() => hidden.delete(p.id)), () => { hidden.delete(p.id); openPhotos(K); });
      };
    },
  });
  try { sheet.querySelector('#pv').src = await fullPhoto(p.id); } catch {}
}
