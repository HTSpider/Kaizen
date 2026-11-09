import Anthropic from '@anthropic-ai/sdk';
import { newId } from './ids.js';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { db, getSecret, getSettings } from './db.js';
import { coachContext, daySummary, today, addDays } from './stats.js';
import { addFoodLog, addWeight, addWater } from './logic.js';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const inBrowser = typeof window !== 'undefined';

let client = null, clientKey = null;
function getClient() {
  const key = getSecret('anthropic_key') || globalThis.process?.env?.ANTHROPIC_API_KEY;
  if (!key) { const e = new Error('Add your Claude API key in Settings first.'); e.status = 400; throw e; }
  if (!client || clientKey !== key) {
    // On the phone the app calls Claude directly with your own key, which stays on your devices.
    client = new Anthropic({ apiKey: key, ...(inBrowser ? { dangerouslyAllowBrowser: true } : {}) });
    clientKey = key;
  }
  return client;
}

/** Small non-cryptographic string hash (FNV-1a), same result on PC and phone. */
function hashText(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}
const model = () => getSettings().ai_model || 'claude-opus-5-5';

export function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Your Claude API key was rejected. Check it in Settings.';
  if (e instanceof Anthropic.RateLimitError) return 'Claude is rate limited right now. Try again in a minute.';
  if (e instanceof Anthropic.BadRequestError) return `Claude request failed: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach Claude. Check the internet connection.';
  if (e instanceof Anthropic.APIError) return `Claude error ${e.status}: ${e.message}`;
  return e.message || String(e);
}

// ---------------- Coach chat ----------------

const SYSTEM = `You are Kaizen Coach, the fitness and nutrition assistant inside the user's personal tracking app. The user is working on losing weight.

How to answer:
- Be direct, practical and encouraging without being preachy. Short answers by default; go longer only when asked or when the question needs it.
- Use the user's own data (data snapshots arrive as system messages, and tools can fetch more) to make answers personal. Refer to real numbers when useful.
- Use the user's display units for weight. Calories are kcal.
- Give evidence-based guidance: a moderate calorie deficit, enough protein, resistance training, daily steps, sleep, and consistency over perfection. Weight fluctuates day to day; the trend is what matters.
- You are not a doctor. For medical conditions, medication, injuries, chest pain, disordered eating signs, or very low intakes, suggest talking to a professional.
- Only log or change data when the user clearly asks you to (for example "log this", "I ate...", "add 500 ml water"). When you estimate food for logging, use realistic portions and say what you assumed.
- Plain text with simple markdown (short lists, bold) is fine. No tables wider than 4 columns.`;

const TOOLS = [
  {
    name: 'log_food',
    description: 'Log one or more foods to the food diary. Use only when the user asks to log something they ate. Each item has its own estimated nutrition for the full amount eaten.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD; omit for today' },
        meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snacks'] },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              serving: { type: 'string', description: 'Amount eaten, e.g. "2 large eggs" or "150 g"' },
              kcal: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' },
            },
            required: ['name', 'serving', 'kcal', 'protein', 'carbs', 'fat'],
            additionalProperties: false,
          },
        },
      },
      required: ['meal', 'items'],
      additionalProperties: false,
    },
  },
  {
    name: 'log_weight',
    description: 'Record a body weight measurement for today.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { value: { type: 'number' }, unit: { type: 'string', enum: ['lb', 'kg'] } },
      required: ['value', 'unit'], additionalProperties: false,
    },
  },
  {
    name: 'log_water',
    description: 'Add water intake for today in millilitres.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object', properties: { ml: { type: 'number' } }, required: ['ml'], additionalProperties: false,
    },
  },
  {
    name: 'get_day',
    description: "Get one day's full detail: every food entry, steps, sleep, weight, water and workouts.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'], additionalProperties: false,
    },
  },
  {
    name: 'get_range',
    description: 'Get daily totals (kcal, protein, steps, sleep, weight) for a date range of up to 120 days. Use for questions about longer history than the snapshot covers.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { start: { type: 'string' }, end: { type: 'string' } },
      required: ['start', 'end'], additionalProperties: false,
    },
  },
];

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Validate then run a tool; returns [resultText, isError, changedData]. */
function runTool(name, input) {
  try {
    if (!input || typeof input !== 'object') throw new Error('input must be an object');
    switch (name) {
      case 'log_food': {
        const meals = ['breakfast', 'lunch', 'dinner', 'snacks'];
        if (!meals.includes(input.meal)) throw new Error('meal must be one of ' + meals.join(', '));
        if (!Array.isArray(input.items) || !input.items.length) throw new Error('items must be a non-empty array');
        const date = input.date && isDate(input.date) ? input.date : today();
        for (const it of input.items) {
          if (typeof it.name !== 'string' || !isNum(it.kcal) || !isNum(it.protein) || !isNum(it.carbs) || !isNum(it.fat)) throw new Error('each item needs name, kcal, protein, carbs, fat');
        }
        for (const it of input.items) addFoodLog({ date, meal: input.meal, name: it.name, serving: it.serving || '1 serving', qty: 1, kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat, source: 'ai' });
        const total = input.items.reduce((a, i) => a + i.kcal, 0);
        return [`Logged ${input.items.length} item(s) to ${input.meal} on ${date}, ${Math.round(total)} kcal total.`, false, true];
      }
      case 'log_weight': {
        if (!isNum(input.value) || !['lb', 'kg'].includes(input.unit)) throw new Error('value (number) and unit (lb|kg) required');
        const kg = input.unit === 'lb' ? input.value / 2.20462 : input.value;
        if (kg < 25 || kg > 400) throw new Error('weight out of range');
        addWeight({ kg, source: 'manual' });
        return [`Recorded ${input.value} ${input.unit}.`, false, true];
      }
      case 'log_water': {
        if (!isNum(input.ml) || input.ml <= 0 || input.ml > 5000) throw new Error('ml must be between 1 and 5000');
        const total = addWater(today(), input.ml);
        return [`Added ${input.ml} ml. Today: ${total} ml.`, false, true];
      }
      case 'get_day': {
        if (!isDate(input.date)) throw new Error('date must be YYYY-MM-DD');
        const s = daySummary(input.date);
        s.food_entries = db.prepare('SELECT meal, name, qty, serving, kcal, protein, carbs, fat FROM food_logs WHERE date = ? ORDER BY id').all(input.date);
        return [JSON.stringify(s), false, false];
      }
      case 'get_range': {
        if (!isDate(input.start) || !isDate(input.end)) throw new Error('start and end must be YYYY-MM-DD');
        const out = [];
        let d = input.start, n = 0;
        while (d <= input.end && n < 120) {
          const x = daySummary(d);
          out.push({ date: d, kcal: x.food.n ? Math.round(x.food.kcal) : null, protein: x.food.n ? Math.round(x.food.protein) : null, steps: x.steps?.count ?? null, sleep_h: x.sleep ? +(x.sleep.minutes / 60).toFixed(1) : null, weight_kg: x.weight?.kg ?? null, workouts: x.workouts.map(w => w.name) });
          d = addDays(d, 1); n++;
        }
        return [JSON.stringify(out), false, false];
      }
      default: throw new Error(`unknown tool ${name}`);
    }
  } catch (e) {
    return [`Error: ${e.message}`, true, false];
  }
}

// Conversation storage: rows hold API-shaped messages, append-only per conversation.
function currentConversation() {
  return db.prepare(`SELECT value FROM settings WHERE key = 'chat_conv'`).get()?.value || newConversation();
}
export function newConversation() {
  const id = globalThis.crypto.randomUUID();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('chat_conv', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(id);
  return id;
}


function loadMessages(conv) {
  return db.prepare('SELECT role, content FROM chat_msgs WHERE conv = ? ORDER BY id').all(conv)
    .map(r => ({ role: r.role, content: JSON.parse(r.content) }));
}
function appendMessage(conv, role, content, display = null, snapshotHash = null) {
  db.prepare('INSERT INTO chat_msgs (id, conv, role, content, display, snapshot_hash) VALUES (?, ?,?,?,?,?)')
    .run(newId(), conv, role, JSON.stringify(content), display, snapshotHash);
}

export function chatHistory() {
  const conv = currentConversation();
  return db.prepare(`SELECT role, display, created FROM chat_msgs WHERE conv = ? AND display IS NOT NULL ORDER BY id`).all(conv);
}

// ---------------- Claude subscription (Claude Code on the PC) ----------------
// ai_provider: 'subscription' (default) uses Claude Code with the user's plan; 'api' uses an API key.
let subBackend = null;
/** The PC registers its Claude Code runner here. The phone hands these requests to the PC instead. */
export function setSubscriptionBackend(b) { subBackend = b; }
export const useSubscription = () => (getSettings().ai_provider || 'subscription') === 'subscription';
const subModel = () => getSettings().cc_model || 'haiku';
function needBackend() {
  if (!subBackend) { const e = new Error('The coach uses your Claude subscription through Kaizen on your PC. Open Kaizen on your PC and use your home Wi-Fi.'); e.status = 503; throw e; }
  return subBackend;
}

const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Your answer to the user, plain text with simple markdown.' },
    actions: {
      type: 'array',
      description: 'Data to log, only when the user clearly asked to log something. Empty otherwise.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['log_food', 'log_weight', 'log_water'] },
          meal: { type: 'string', description: "breakfast, lunch, dinner or snacks for log_food; '' otherwise" },
          items: {
            type: 'array',
            description: 'Foods for log_food (empty otherwise). Numbers are totals for the amount eaten.',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, serving: { type: 'string' }, kcal: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' } },
              required: ['name', 'serving', 'kcal', 'protein', 'carbs', 'fat'], additionalProperties: false,
            },
          },
          value: { type: 'number', description: 'Weight for log_weight, 0 otherwise' },
          unit: { type: 'string', description: "'kg' or 'lb' for log_weight, '' otherwise" },
          ml: { type: 'number', description: 'Millilitres for log_water, 0 otherwise' },
        },
        required: ['kind', 'meal', 'items', 'value', 'unit', 'ml'], additionalProperties: false,
      },
    },
  },
  required: ['reply', 'actions'], additionalProperties: false,
};

async function subscriptionChat(userText, emit) {
  const backend = needBackend();
  const conv = currentConversation();
  const earlier = db.prepare(`SELECT role, display FROM chat_msgs WHERE conv = ? AND display IS NOT NULL ORDER BY id DESC LIMIT 12`).all(conv).reverse();
  appendMessage(conv, 'user', userText, userText);
  const system = `${SYSTEM}\n\nToday is ${today()}. Current data from the app:\n${coachContext()}\n\nTo log data, add entries to "actions"; the app records them. Don't claim something was logged unless you added the action.`;
  const prompt = (earlier.length ? `Conversation so far:\n${earlier.map(m => `${m.role === 'user' ? 'User' : 'Coach'}: ${m.display}`).join('\n\n')}\n\n` : '') + `User: ${userText}`;
  const { structured, text } = await backend.ask({ system, prompt, model: subModel(), schema: ACTION_SCHEMA, effort: 'low' });
  const reply = String(structured?.reply ?? text ?? '').trim() || '…';
  let changed = false;
  for (const a of Array.isArray(structured?.actions) ? structured.actions : []) {
    const input = a.kind === 'log_food' ? { meal: a.meal, items: a.items }
      : a.kind === 'log_weight' ? { value: a.value, unit: a.unit || (getSettings().units === 'kg' ? 'kg' : 'lb') }
      : a.kind === 'log_water' ? { ml: a.ml } : null;
    if (!input) continue;
    emit('tool', { name: a.kind });
    const [, isError, didChange] = runTool(a.kind, input);
    if (didChange) changed = true;
    if (isError) emit('text', { delta: '' });
  }
  appendMessage(conv, 'assistant', [{ type: 'text', text: reply }], reply);
  emit('text', { delta: reply });
  emit('done', { text: reply, changed });
}

/**
 * Run one user turn. `emit(event, data)` streams to the client:
 *   text {delta}, tool {name}, done {text, changed}, error {message}
 */
export async function chatTurn(userText, emit) {
  if (useSubscription()) return subscriptionChat(userText, emit);
  const c = getClient();
  const conv = currentConversation();
  const history = loadMessages(conv);

  appendMessage(conv, 'user', userText, userText);
  history.push({ role: 'user', content: userText });

  // Add a fresh data snapshot as a mid-conversation system message when the data changed.
  const snapshot = coachContext();
  const hash = hashText(snapshot);
  const lastHash = db.prepare(`SELECT snapshot_hash FROM chat_msgs WHERE conv = ? AND snapshot_hash IS NOT NULL ORDER BY id DESC LIMIT 1`).get(conv)?.snapshot_hash;
  if (hash !== lastHash) {
    const msg = `Today is ${today()}. Current data snapshot from the app:\n${snapshot}`;
    appendMessage(conv, 'system', msg, null, hash);
    history.push({ role: 'system', content: msg });
  }

  let changed = false;
  let finalText = '';
  for (let turn = 0; turn < 8; turn++) {
    const stream = c.beta.messages.stream({
      model: model(),
      max_tokens: 64000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      cache_control: { type: 'ephemeral' },
      system: SYSTEM,
      tools: TOOLS,
      messages: history,
    });
    stream.on('text', delta => { finalText += delta; emit('text', { delta }); });
    const msg = await stream.finalMessage();

    appendMessage(conv, 'assistant', msg.content);
    history.push({ role: 'assistant', content: msg.content });

    if (msg.stop_reason === 'refusal') {
      const note = "\n\nI can't help with that one.";
      finalText += note; emit('text', { delta: note });
      break;
    }
    const toolUses = msg.content.filter(b => b.type === 'tool_use');
    if (msg.stop_reason === 'max_tokens' && toolUses.length) {
      const note = '\n\n(The reply was cut off. Try asking again.)';
      finalText += note; emit('text', { delta: note });
      break;
    }
    if (msg.stop_reason !== 'tool_use' || !toolUses.length) break;

    const results = [];
    for (const tu of toolUses) {
      emit('tool', { name: tu.name });
      const [text, isError, didChange] = runTool(tu.name, tu.input);
      if (didChange) changed = true;
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: text, ...(isError ? { is_error: true } : {}) });
    }
    appendMessage(conv, 'user', results);
    history.push({ role: 'user', content: results });
    if (finalText && !finalText.endsWith('\n')) { finalText += '\n\n'; emit('text', { delta: '\n\n' }); }
  }

  // Store what the UI shows for this turn on the last assistant row.
  db.prepare(`UPDATE chat_msgs SET display = ? WHERE id = (SELECT MAX(id) FROM chat_msgs WHERE conv = ? AND role = 'assistant')`).run(finalText.trim(), conv);
  emit('done', { text: finalText.trim(), changed });
}

// ---------------- Food estimate (text and/or photo) ----------------

const EstimateSchema = z.object({
  items: z.array(z.object({
    name: z.string(),
    serving: z.string(),
    kcal: z.number(), protein: z.number(), carbs: z.number(), fat: z.number(),
  })),
  note: z.string(),
});

const ESTIMATE_JSON = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, serving: { type: 'string' }, kcal: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' } }, required: ['name', 'serving', 'kcal', 'protein', 'carbs', 'fat'], additionalProperties: false } },
    note: { type: 'string' },
  },
  required: ['items', 'note'], additionalProperties: false,
};
const estimatePrompt = text => `Estimate the nutrition of this food for a calorie-tracking diary. ${text ? `The user says: "${text}".` : 'Identify the foods in the photo.'}
Split it into separate items where sensible (e.g. burger, fries, drink). Use realistic portion sizes; if a photo, judge portion from the plate and context. "serving" describes the amount, e.g. "1 cup (200 g)". Numbers are totals for that amount: kcal, and grams of protein, carbs and fat. "note" is one short sentence on key assumptions.`;

export async function estimateFood({ text, image }) {
  if (useSubscription()) {
    const { structured } = await needBackend().ask({
      system: 'You estimate food nutrition for a calorie-tracking app. Be realistic and concise.',
      prompt: estimatePrompt(text), image, model: subModel(), schema: ESTIMATE_JSON, effort: 'low',
    });
    if (!structured?.items) { const e = new Error('Could not estimate that food.'); e.status = 422; throw e; }
    return structured;
  }
  const c = getClient();
  const content = [];
  if (image) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(image);
    if (!m) { const e = new Error('Unsupported image'); e.status = 400; throw e; }
    content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({
    type: 'text',
    text: `Estimate the nutrition of this food for a calorie-tracking diary. ${text ? `The user says: "${text}".` : 'Identify the foods in the photo.'}
Split it into separate items where sensible (e.g. burger, fries, drink). Use realistic portion sizes; if a photo, judge portion from the plate and context. "serving" describes the amount, e.g. "1 cup (200 g)". Numbers are totals for that amount: kcal, and grams of protein, carbs and fat. "note" is one short sentence on key assumptions.`,
  });
  const res = await c.beta.messages.parse({
    model: model(),
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'low', format: zodOutputFormat(EstimateSchema) },
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) {
    const e = new Error('Could not estimate that food.'); e.status = 422; throw e;
  }
  return res.parsed_output;
}

// ---------------- Sunday check-in ----------------

/** The Sunday a check-in covers: today from 6 pm on Sundays, otherwise the most recent Sunday. */
export function checkinWeek(now = new Date()) {
  const d = new Date(now);
  const isSunEvening = d.getDay() === 0 && d.getHours() >= 18;
  if (!isSunEvening) d.setDate(d.getDate() - (d.getDay() === 0 ? 7 : d.getDay()));
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

/** Write (or rewrite) the weekly check-in for the week ending on `week`. */
export async function weeklyCheckin(week = checkinWeek()) {
  const system = `You are Kaizen Coach writing the user's weekly check-in for their fitness and weight-loss app. The user wants to lose weight.
Write plain text with simple markdown: a one-line headline, then 3 to 5 short bullets on what happened this week (weight trend, calories vs target, protein, steps, sleep, training), comparing with the week before when the data allows. Then "Focus this week:" with 1 or 2 specific, doable actions. Use real numbers from the data, the user's weight units, and kcal. Be encouraging and direct, no filler, under 140 words. If data is missing for something, skip it rather than mention it.`;
  const prompt = `The week ends on ${week}. Today is ${today()}.\n\nData from the app:\n${coachContext()}`;
  let text;
  if (useSubscription()) {
    text = (await needBackend().ask({ system, prompt, model: subModel(), effort: 'low' })).text;
  } else {
    const res = await getClient().beta.messages.create({
      model: model(), max_tokens: 4000, betas: [FALLBACK_BETA], fallbacks: 'default',
      output_config: { effort: 'low' }, system, messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') throw Object.assign(new Error('Could not write the check-in.'), { status: 422 });
    text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }
  text = String(text || '').trim();
  if (!text) throw Object.assign(new Error('Could not write the check-in.'), { status: 502 });
  db.prepare(`INSERT INTO checkins (week, text) VALUES (?, ?) ON CONFLICT(week) DO UPDATE SET text = excluded.text, created = datetime('now')`).run(week, text);
  return { week, text };
}

/** Called on a timer on the PC: writes this week's check-in once, when there's enough data. */
export async function maybeWeeklyCheckin() {
  if (!subBackend && !useSubscription() && !getSecret('anthropic_key')) return null;
  if (useSubscription() && !subBackend) return null;
  const week = checkinWeek();
  if (db.prepare('SELECT 1 FROM checkins WHERE week = ?').get(week)) return null;
  const start = addDays(week, -6);
  const logged = db.prepare('SELECT COUNT(DISTINCT date) n FROM food_logs WHERE date BETWEEN ? AND ?').get(start, week).n
    + db.prepare('SELECT COUNT(DISTINCT date) n FROM weights WHERE date BETWEEN ? AND ?').get(start, week).n
    + db.prepare('SELECT COUNT(*) n FROM steps WHERE date BETWEEN ? AND ?').get(start, week).n;
  if (logged < 3) return null;
  return weeklyCheckin(week);
}
