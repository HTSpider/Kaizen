// Claude through Claude Code on this PC, so Kaizen uses the user's Claude subscription (no API key).
// Same approach as Anki Card Miner: no tools, no project settings, API-key variables removed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REMOVED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ELECTRON_RUN_AS_NODE'];
const BASE_ARGS = ['--tools', '', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'];

let cachedPath;
export function findClaude() {
  if (cachedPath !== undefined && (cachedPath === null || fs.existsSync(cachedPath))) return cachedPath;
  const home = os.homedir();
  const candidates = [];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of ['claude.exe', 'claude.cmd', 'claude']) candidates.push(path.join(dir, name));
  }
  candidates.push(path.join(home, '.local', 'bin', 'claude.exe'), path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'));
  const ext = path.join(home, '.vscode', 'extensions');
  try {
    const found = fs.readdirSync(ext).filter(d => d.startsWith('anthropic.claude-code-'))
      .map(d => path.join(ext, d, 'resources', 'native-binary', 'claude.exe'))
      .filter(p => fs.existsSync(p))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    candidates.push(...found);
  } catch {}
  cachedPath = candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
  return cachedPath;
}

function run(args, stdin, timeoutMs) {
  const program = findClaude();
  if (!program) return Promise.reject(Object.assign(new Error("Claude Code wasn't found on this PC."), { status: 400 }));
  const env = { ...process.env };
  for (const k of REMOVED_ENV) delete env[k];
  // An empty folder, so Claude Code doesn't pick up any project's instructions
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'kaizen-cc-'));
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, windowsHide: true, shell: program.endsWith('.cmd') });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error('Claude took too long to answer. Please try again.'), { status: 504 })); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', () => { clearTimeout(timer); reject(Object.assign(new Error("Claude Code couldn't be started."), { status: 500 })); });
    child.on('close', code => {
      clearTimeout(timer);
      fs.rm(cwd, { recursive: true, force: true }, () => {});
      resolve({ code, out, err });
    });
    child.stdin.end(stdin || '');
  });
}

function friendly(message = '') {
  const m = message.toLowerCase();
  if (m.includes('limit')) return "You've reached your Claude usage limit. It resets later (it's shared with Claude Code).";
  if (m.includes('log in') || m.includes('login') || m.includes('authenticat')) return "Claude Code isn't signed in. Sign in to it first.";
  if (m.includes('network') || m.includes('connection') || m.includes('offline')) return "Can't reach Claude. Check the internet connection.";
  return 'Claude had a problem. Please try again.';
}

let statusCache = { at: 0, value: null };
/** {available, plan, problem}. Only reads the sign-in state; sends nothing to Claude. */
export async function status() {
  if (Date.now() - statusCache.at < 60000 && statusCache.value) return statusCache.value;
  let value;
  try {
    const r = await run(['auth', 'status'], '', 20000);
    const s = JSON.parse(r.out);
    if (!s.loggedIn) value = { available: false, plan: null, problem: "Claude Code isn't signed in. Sign in to it first." };
    else if (s.authMethod !== 'claude.ai') value = { available: false, plan: null, problem: "Claude Code isn't using your subscription, so requests could be billed separately." };
    else value = { available: true, plan: s.subscriptionType || null, problem: null };
  } catch (e) {
    value = { available: false, plan: null, problem: e.message || "Couldn't read Claude Code's sign-in status." };
  }
  statusCache = { at: Date.now(), value };
  return value;
}

/**
 * One request. Returns { text, structured }.
 * image: optional data URL; schema: optional JSON schema for a structured answer.
 */
export async function ask({ system, prompt, model = 'haiku', schema = null, image = null, effort = 'low', timeoutMs = 180000 }) {
  const args = ['-p', '--system-prompt', system, ...BASE_ARGS, '--model', model, '--effort', effort];
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  let r;
  if (image) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(image);
    if (!m) throw Object.assign(new Error('Unsupported image'), { status: 400 });
    const msg = { type: 'user', message: { role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
      { type: 'text', text: prompt },
    ] } };
    r = await run([...args, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], JSON.stringify(msg) + '\n', timeoutMs);
    const line = r.out.split('\n').reverse().find(l => l.includes('"type":"result"'));
    if (!line) throw Object.assign(new Error(friendly(r.err || r.out)), { status: 502 });
    const res = JSON.parse(line);
    if (res.is_error) throw Object.assign(new Error(friendly(String(res.result || r.err))), { status: 502 });
    return { text: String(res.result || ''), structured: res.structured_output ?? null };
  }
  r = await run([...args, '--output-format', 'json'], prompt, timeoutMs);
  let res;
  try { res = JSON.parse(r.out); } catch { throw Object.assign(new Error(friendly(r.err || r.out)), { status: 502 }); }
  if (res.is_error || r.code !== 0) throw Object.assign(new Error(friendly(String(res.result || res.errors || r.err))), { status: 502 });
  return { text: String(res.result || ''), structured: res.structured_output ?? null };
}
