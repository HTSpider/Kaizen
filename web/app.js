import * as A from './js/api.js';
import { icon, localDate, toast, closeSheet, sheetOpen } from './js/ui.js';
import * as Today from './js/today.js';
import * as Food from './js/food.js';
import * as Train from './js/train.js';
import * as Body from './js/body.js';
import * as Sleep from './js/sleep.js';
import * as Coach from './js/coach.js';
import * as Settings from './js/settings.js';

const TABS = [
  ['today', 'Today', Today], ['food', 'Food', Food], ['train', 'Workouts', Train],
  ['body', 'Body', Body], ['sleep', 'Sleep', Sleep], ['coach', 'Coach', Coach],
];
const PAGES = Object.fromEntries([...TABS.map(([k, , m]) => [k, m]), ['settings', Settings]]);

// Shared app context handed to every page
export const K = {
  state: null,          // /api/state payload
  date: localDate(),    // date the Food page shows
  tab: 'today',
  native: null,         // native bridge (phone app only)

  get s() { return this.state?.settings || {}; },

  async load(date = this.date) {
    const path = `/api/state?date=${date}`;
    try { this.state = await A.get(path); this.loadError = null; }
    catch (e) {
      this.loadError = e;
      if (!this.state) this.state = A.cached(path) || A.cached(`/api/state?date=${localDate()}`);
    }
    return this.state;
  },

  /**
   * Re-fetch state and re-render the current page.
   * Automatic refreshes (timer, window focus, sync) never redraw over something you're typing.
   */
  async refresh({ auto = false } = {}) {
    await this.load();
    if (auto && (hasUnsavedTyping() || sheetOpen())) return;
    this.render();
  },

  render() {
    const page = PAGES[this.tab] || Today;
    const view = document.getElementById('view');
    const keepScroll = view.dataset.tab === this.tab ? view.scrollTop : 0;
    view.dataset.tab = this.tab;
    page.mount(view, this);
    view.scrollTop = keepScroll;
    renderNav();
  },

  go(tab) { location.hash = '#/' + tab; },

  /** Android back: close an open panel, then go back to Today. Returns false when there's nothing left to close. */
  back() {
    if (sheetOpen()) { closeSheet(); return true; }
    if (this.tab !== 'today') { this.go('today'); return true; }
    return false;
  },
};
window.K = K;

// Fields you've typed in since the page was drawn (cleared on every redraw)
document.addEventListener('input', e => { if (e.target.matches?.('#view input, #view textarea, #view select')) e.target.dataset.typed = '1'; }, true);
function hasUnsavedTyping() {
  const a = document.activeElement;
  if (a && a.closest?.('#view') && a.matches('input, textarea, select')) return true;
  return !!document.querySelector('#view [data-typed]');
}

function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = `<span class="brand">Kaizen</span>` + TABS.map(([k, label]) =>
    `<a href="#/${k}" class="${K.tab === k || (K.tab === 'settings' && k === 'today') ? 'on' : ''}" ${K.tab === k ? 'aria-current="page"' : ''}>${icon(k)}${label}</a>`).join('');
}

function route() {
  const tab = (location.hash.replace(/^#\/?/, '') || 'today').split('?')[0];
  if (sheetOpen()) closeSheet();
  K.tab = PAGES[tab] ? tab : 'today';
  if (!A.isConfigured() && K.tab !== 'settings') { K.tab = 'settings'; }
  document.getElementById('view').scrollTop = 0;
  K.render();
}

// Offline banner
function offlineBar(isOnline) {
  let bar = document.querySelector('.offline-bar');
  if (isOnline) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'offline-bar';
    document.getElementById('view').prepend(bar);
  }
  const n = A.pendingCount();
  bar.textContent = A.isNative ? `Can't reach your PC${n ? ` · ${n} change${n > 1 ? 's' : ''} waiting to sync` : ''}` : `Server not running${n ? ` · ${n} waiting` : ''}`;
}
// The PC refused this device: show the pair screen instead of loading forever
A.onNeedsPair(() => route());

A.onConnection(async online => {
  offlineBar(online);
  if (online) { const n = await A.flushOutbox(); if (n) { toast(`Synced ${n} offline change${n > 1 ? 's' : ''}`); K.refresh({ auto: true }); } }
});

async function start() {
  // Phone app: open its own database first, so every screen works without the PC
  if (A.isNative) {
    try {
      K.native = await import('./native.bundle.js').then(m => m.native);
      await K.native.init(K, A, toast);
    } catch (e) { console.error('native init failed', e); toast('Kaizen could not open its data: ' + (e.message || e)); }
  }
  // Render from cache instantly, then fetch fresh data
  K.state = A.cached(`/api/state?date=${K.date}`);
  route();
  window.addEventListener('hashchange', route);
  if (A.isConfigured()) { await K.load(); K.render(); }

  // Keep "Today" fresh when the date rolls over or the window regains focus
  let lastDay = localDate();
  const tick = async () => {
    if (!A.isConfigured()) return;
    await A.flushOutbox();
    if (localDate() !== lastDay) { lastDay = localDate(); K.date = lastDay; }
    if (!sheetOpen() && document.visibilityState === 'visible' && K.tab !== 'coach') K.refresh({ auto: true });
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  setInterval(tick, 60000);
}

start();
