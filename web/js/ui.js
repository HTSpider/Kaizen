// Shared UI helpers: escaping, formatting, icons, charts, sheets, toasts.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- formatting ----------
export const fmtInt = n => n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US');
export const LB = 2.20462;
export function wUnit(s) { return s?.units === 'kg' ? 'kg' : 'lb'; }
export function fmtW(kg, s, digits = 1) { if (kg == null) return '—'; const v = s?.units === 'kg' ? kg : kg * LB; return v.toFixed(digits); }
export function toDisplayW(kg, s) { return kg == null ? null : s?.units === 'kg' ? kg : kg * LB; }
export function fmtDur(min) { if (min == null) return '—'; const h = Math.floor(min / 60), m = Math.round(min % 60); return `${h}h ${String(m).padStart(2, '0')}m`; }
export function fmtL(ml) { return (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1) + ' L'; }
export function localDate(d = new Date()) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
export function addDays(date, n) { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return localDate(d); }
export function niceDate(date, { weekday = true } = {}) {
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: weekday ? 'long' : undefined, month: 'short', day: 'numeric' });
}
export function dayLabel(date) {
  const t = localDate();
  if (date === t) return 'Today';
  if (date === addDays(t, -1)) return 'Yesterday';
  return niceDate(date);
}
export function clock(iso) { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
export function pct(a, b) { return b ? Math.max(0, Math.min(100, (a / b) * 100)) : 0; }

// ---------- icons (stroke, 24 grid) ----------
const P = {
  today: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  food: '<path d="M5 3v8a3 3 0 0 0 6 0V3M8 3v18M17 3c-2 0-3 3-3 7h3v11"/>',
  train: '<path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12"/>',
  body: '<path d="M3 17l5-5 4 3 8-8"/>',
  coach: '<path d="M4 5h16v11H9l-5 4z"/>',
  sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  barcode: '<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 8v8M11 8v8M14 8v8M17 8v8"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  flame: '<path d="M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4M9 2h6"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  water: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
};
export function icon(name, size = 22, stroke = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---------- charts ----------
export function ring(frac, size = 150, color = 'var(--accent)', label = '') {
  const r = 78, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
  const over = frac > 1;
  return `<svg width="${size}" height="${size}" viewBox="0 0 180 180" role="img" aria-label="${esc(label)}">
    <circle cx="90" cy="90" r="${r}" fill="none" stroke="var(--line)" stroke-width="14"/>
    <circle cx="90" cy="90" r="${r}" fill="none" stroke="${over ? 'var(--carbs)' : color}" stroke-width="14" stroke-linecap="round"
      stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 90 90)"/></svg>`;
}

export function sparkline(values, w = 140, h = 28, color = 'var(--accent)') {
  const v = values.filter(x => x != null);
  if (v.length < 2) return `<svg width="${w}" height="${h}" aria-hidden="true"></svg>`;
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 3 - (x - min) / span * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Weight chart: dots = daily weigh-ins, line = trend. points: [{date, v, t}] */
export function weightChart(points, { w = 340, h = 160, goal = null, label = '' } = {}) {
  if (points.length < 2) return `<div class="empty">Log a few weigh-ins to see your trend.</div>`;
  const vals = points.flatMap(p => [p.v, p.t]).filter(x => x != null);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (goal != null && goal > min - (max - min) * 0.6) min = Math.min(min, goal);
  const pad = (max - min) * 0.12 || 1; min -= pad; max += pad;
  const t0 = new Date(points[0].date).getTime(), t1 = new Date(points[points.length - 1].date).getTime() || t0 + 1;
  const X = d => 8 + (new Date(d).getTime() - t0) / (t1 - t0 || 1) * (w - 16);
  const Y = v => 8 + (max - v) / (max - min) * (h - 16);
  const grid = [0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${w}" y1="${(h * f).toFixed(0)}" y2="${(h * f).toFixed(0)}" stroke="var(--line)"/>`).join('');
  const dots = points.filter(p => p.v != null).map(p => `<circle cx="${X(p.date).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3" fill="#5C6470"/>`).join('');
  const line = points.filter(p => p.t != null).map(p => `${X(p.date).toFixed(1)},${Y(p.t).toFixed(1)}`).join(' ');
  const goalLine = goal != null && goal >= min && goal <= max ? `<line x1="0" x2="${w}" y1="${Y(goal).toFixed(1)}" y2="${Y(goal).toFixed(1)}" stroke="var(--accent)" stroke-dasharray="4 5" opacity=".6"/>` : '';
  return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${grid}${goalLine}${dots}
    <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Simple bars. items: [{label, v}], target line optional */
export function bars(items, { h = 90, target = null, color = 'var(--accent)', label = '' } = {}) {
  const max = Math.max(target || 0, ...items.map(i => i.v || 0)) * 1.08 || 1;
  const cols = items.map(i => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0">
      <div style="height:${h}px;width:100%;display:flex;align-items:flex-end"><div style="width:100%;height:${i.v ? Math.max(3, i.v / max * h) : 0}px;background:${i.color || color};border-radius:4px 4px 0 0;opacity:${i.v ? 1 : .25}"></div></div>
      <span style="font-size:11px;color:var(--muted)">${esc(i.label)}</span></div>`).join('');
  const tl = target ? `<div style="position:absolute;left:0;right:0;bottom:${(target / max * h + 17).toFixed(0)}px;border-top:1.5px dashed var(--line-2)"></div>` : '';
  return `<div role="img" aria-label="${esc(label)}" style="position:relative;display:flex;gap:6px">${tl}${cols}</div>`;
}

// ---------- toast ----------
let toastTimer;
export function toast(msg, ms = 2600) {
  flushUndo();
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

// ---------- delete with Undo (no "are you sure?") ----------
// The item disappears right away; the real delete runs after a few seconds unless Undo is pressed.
let pendingUndo = null;
function flushUndo() {
  if (!pendingUndo) return;
  const p = pendingUndo; pendingUndo = null;
  clearTimeout(p.timer); p.commit();
}
export function undoable(message, commit, undo, ms = 5000) {
  flushUndo();
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast undo'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(message)}</span><button type="button">Undo</button>`;
  document.body.appendChild(el);
  const entry = {
    commit: () => { el.remove(); Promise.resolve().then(commit).catch(() => {}); },
    timer: setTimeout(() => { if (pendingUndo === entry) { pendingUndo = null; entry.commit(); } }, ms),
  };
  pendingUndo = entry;
  el.querySelector('button').onclick = () => {
    if (pendingUndo !== entry) return;
    clearTimeout(entry.timer); pendingUndo = null; el.remove(); undo?.();
  };
}
// Finish a pending delete if the app is hidden or closed
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUndo(); });

// ---------- bottom sheet ----------
let sheetClose = null;
export function openSheet(html, { onClose, bind } = {}) {
  closeSheet();
  const root = document.getElementById('sheet-root');
  root.innerHTML = `<div class="sheet-back"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const back = root.firstElementChild;
  const sheet = back.firstElementChild;
  back.addEventListener('click', e => { if (e.target === back) closeSheet(); });
  sheetClose = () => { root.innerHTML = ''; sheetClose = null; onClose?.(); };
  bind?.(sheet);
  const first = sheet.querySelector('[autofocus]');
  if (first && window.matchMedia('(min-width: 900px)').matches) first.focus();
  return sheet;
}
export function closeSheet() { sheetClose?.(); }
export function sheetOpen() { return !!sheetClose; }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetClose) closeSheet(); });

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/** Tiny markdown: paragraphs, **bold**, lists. Input is escaped first. */
export function md(text) {
  const lines = esc(text).split('\n');
  let out = '', list = false;
  for (const l of lines) {
    const m = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(l);
    if (m) { if (!list) { out += '<ul>'; list = true; } out += `<li>${m[1]}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    if (l.trim()) out += `<p>${l}</p>`;
  }
  if (list) out += '</ul>';
  return out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

export function readImage(file, maxSide = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}
