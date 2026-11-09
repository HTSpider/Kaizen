import { esc, icon, md, toast, readImage } from './ui.js';
import * as A from './api.js';
import { photoEstimate, defaultMeal } from './food.js';

let busy = false;
let messages = null; // [{role:'user'|'assistant', display}]

const TOOL_LABEL = { log_food: 'Logging food', log_weight: 'Saving weight', log_water: 'Adding water', get_day: 'Checking your log', get_range: 'Looking at your history' };
const SUGGEST = ["How's my week going?", 'What should I eat for dinner?', 'Why did my weight go up?', 'Give me a 30-minute workout', 'Am I eating enough protein?'];

export function mount(view, K) {
  if (!messages) messages = A.cached('/api/chat') || [];
  const hasKey = K.state?.has_ai_key;
  view.innerHTML = `
  <div class="page" style="min-height:100%;max-width:880px">
    <div class="page-head"><h1 class="page-title">Coach</h1><button class="btn" data-act="new">New chat</button></div>
    ${!hasKey ? `<a href="#/settings" class="card tap" style="text-decoration:none;color:inherit;border:1.5px solid var(--accent-line)"><span style="font-weight:600">Add your Claude API key</span></a>` : ''}
    <div class="chat" id="chat" style="flex:1"></div>
    <div class="composer">
      <div class="chips" id="sugg"></div>
      <form class="row" id="form" style="gap:8px">
        <button type="button" class="round" data-act="photo" aria-label="Log a meal from a photo">${icon('camera', 20)}</button>
        <input id="msg" placeholder="Ask anything" autocomplete="off" aria-label="Message" ${hasKey ? '' : 'disabled'}>
        <button class="round primary" aria-label="Send" ${hasKey ? '' : 'disabled'}>${icon('send', 20, 2.4)}</button>
      </form>
    </div>
  </div>`;
  const chat = view.querySelector('#chat');
  const paint = () => {
    chat.innerHTML = messages.length ? messages.map(m => m.role === 'user'
      ? `<div class="msg user">${esc(m.display)}</div>`
      : m.tool ? `<div class="tool-chip">${icon('check', 16, 2.6)} ${esc(m.display)}</div>`
      : `<div class="msg bot">${m.display ? md(m.display) : '<span class="typing"><i></i><i></i><i></i></span>'}</div>`).join('')
      : '';
    view.querySelector('#sugg').innerHTML = !busy && hasKey ? SUGGEST.map(s => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join('') : '';
    view.scrollTop = view.scrollHeight;
  };
  paint();
  if (!busy) A.get('/api/chat').then(h => { if (!busy && K.tab === 'coach') { messages = h; paint(); } }).catch(() => {});

  const send = async text => {
    if (!text || busy) return;
    busy = true;
    messages.push({ role: 'user', display: text });
    const bot = { role: 'assistant', display: '' };
    messages.push(bot);
    paint();
    let changed = false;
    try {
      await A.streamChat(text, (ev, data) => {
        if (ev === 'text') {
          bot.display += data.delta;
          const el = chat.lastElementChild;
          if (el?.classList.contains('bot')) el.innerHTML = md(bot.display);
          view.scrollTop = view.scrollHeight;
        } else if (ev === 'tool') {
          const label = TOOL_LABEL[data.name] || 'Working';
          messages.splice(messages.indexOf(bot), 0, { role: 'assistant', tool: true, display: label });
          paint();
        } else if (ev === 'done') {
          changed = data.changed;
        } else if (ev === 'error') {
          bot.display = data.message;
          paint();
        }
      });
    } catch (e) {
      bot.display = e instanceof A.OfflineError || e instanceof TypeError ? "Can't reach your PC right now." : e.message;
    }
    busy = false;
    // Tool chips become past tense once done
    messages.forEach(m => { if (m.tool) m.display = m.display.replace(/^Logging food$/, 'Logged food').replace(/^Saving weight$/, 'Saved weight').replace(/^Adding water$/, 'Added water'); });
    if (!bot.display) bot.display = '…';
    if (K.tab === 'coach') paint();
    if (changed) K.load();
  };

  view.querySelector('#form').onsubmit = e => {
    e.preventDefault();
    const inp = view.querySelector('#msg');
    const t = inp.value.trim();
    inp.value = '';
    send(t);
  };
  view.onclick = async e => {
    const s = e.target.closest('[data-s]');
    if (s) return send(s.dataset.s);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'new') {
      if (busy) return;
      try { await A.post('/api/chat/new', {}, { queue: false }); messages = []; paint(); } catch (err) { toast(err.message); }
    }
    if (act === 'photo') photoEstimate(K, { date: K.state?.today, meal: defaultMeal() });
  };
}
