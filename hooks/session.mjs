import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUIDANCE_PATH = fileURLToPath(new URL('../policy/guidance.md', import.meta.url));
const MAX_CONTEXT_CHARS = 8000;
const MAX_CONTEXT_LINES = 200;
const MAX_MESSAGE_CHARS = 4000;
const MAX_MESSAGE_LINES = 20;

const WORKFLOW_WIDE_RULES = new Set(['Workflow', 'Workflow()', 'Workflow(*)']);

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ');

function pairsTable(policy, { formatClassPairs }) {
  const rows = Object.entries(policy.classes).map(
    ([cls, def]) => `| \`${cls}:\` | ${cell(def.owns)} | ${cell(formatClassPairs(policy, cls))} |`,
  );
  return [
    '## Allowed (model, effort) pairs',
    '',
    'This table is the authoritative list of allowed (model, effort) pairs per class, as enforced on an Opus session. On a Sonnet or Haiku session the session cap applies and stages may not use a model above the session model.',
    '',
    '| Class | Owns | Allowed pairs |',
    '|---|---|---|',
    ...rows,
  ].join('\n');
}

async function readStdin() {
  const read = (async () => {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8');
  })();
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(''), 3000).unref();
  });
  return Promise.race([read, timeout]);
}

function readSettings(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function dontAskWarning(cwd) {
  const files = [
    join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude'), 'settings.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ];
  let mode;
  let allowsWorkflow = false;
  for (const f of files) {
    const perms = readSettings(f)?.permissions;
    if (!perms || typeof perms !== 'object') continue;
    if (typeof perms.defaultMode === 'string') mode = perms.defaultMode;
    if (Array.isArray(perms.allow)) {
      for (const rule of perms.allow) {
        if (typeof rule === 'string' && WORKFLOW_WIDE_RULES.has(rule)) allowsWorkflow = true;
      }
    }
  }
  if (mode === 'dontAsk' && !allowsWorkflow) {
    return 'ultraguard: your settings set permissions.defaultMode to "dontAsk" and have no "Workflow" allow rule. ultraguard never allows a launch by itself, so in a dontAsk session every Workflow launch is refused: add "Workflow" to permissions.allow. Ignore this if you start Claude Code in another permission mode, such as bypassPermissions.';
  }
  return null;
}

function clampContext(text) {
  const lines = text.split('\n');
  let out = lines.length > MAX_CONTEXT_LINES ? lines.slice(0, MAX_CONTEXT_LINES).join('\n') : text;
  if (out.length > MAX_CONTEXT_CHARS) out = out.slice(0, MAX_CONTEXT_CHARS);
  return out;
}

function clampMessage(text) {
  let out = text.split('\n').slice(0, MAX_MESSAGE_LINES).join('\n');
  if (out.length > MAX_MESSAGE_CHARS) out = out.slice(0, MAX_MESSAGE_CHARS);
  return out;
}

async function run() {
  const warnings = [];
  let guidance = '';
  let table = '';
  let cwd = process.cwd();

  try {
    const raw = await readStdin();
    const input = raw.trim() ? JSON.parse(raw) : null;
    if (input && typeof input.cwd === 'string' && input.cwd) cwd = input.cwd;
  } catch {}

  try {
    guidance = readFileSync(GUIDANCE_PATH, 'utf8').trimEnd();
  } catch (e) {
    warnings.push(`ultraguard: policy/guidance.md could not be read (${e.message}).`);
  }

  try {
    const rulesModule = await import('../src/rules.mjs');
    table = pairsTable(rulesModule.loadPolicy(), rulesModule);
  } catch (e) {
    warnings.push(
      `ultraguard: the policy failed to load (${e.message}). Every Workflow launch will be blocked until it is fixed; to disable the gate run /plugin disable ultraguard.`,
    );
  }

  try {
    const w = dontAskWarning(cwd);
    if (w) warnings.push(w);
  } catch {}

  const out = {};
  const context = [guidance, table].filter(Boolean).join('\n\n');
  if (context) out.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: clampContext(context) };
  if (warnings.length) out.systemMessage = clampMessage(warnings.join('\n'));
  return out;
}

let output;
try {
  output = await run();
} catch (e) {
  output = { systemMessage: clampMessage(`ultraguard: the SessionStart hook failed (${e && e.message ? e.message : e}).`) };
}
process.stdout.write(JSON.stringify(output));
process.exit(0);
