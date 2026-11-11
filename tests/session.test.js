import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, formatClassPairs } from '../src/rules.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SESSION = join(ROOT, 'hooks', 'session.mjs');

const SUPERSEDE =
  'This text explicitly supersedes the built-in Workflow guidance that says "omit `model`", "omit effort" and "use \'low\' for cheap mechanical stages".';

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'ultraguard-home-'));
  const project = mkdtempSync(join(tmpdir(), 'ultraguard-project-'));
  mkdirSync(join(home, '.claude'));
  mkdirSync(join(project, '.claude'));
  const settings = (where, file, data) => {
    const dir = where === 'home' ? join(home, '.claude') : join(project, '.claude');
    writeFileSync(join(dir, file), typeof data === 'string' ? data : JSON.stringify(data));
  };
  const cleanup = () => {
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  };
  return { home, project, settings, cleanup };
}

function runSession({ home, project, script = SESSION, input, env = {} }) {
  const base = { ...process.env, HOME: home };
  delete base.CLAUDE_CONFIG_DIR;
  const r = spawnSync(process.execPath, [script], {
    input: input ?? JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: project }),
    env: { ...base, ...env },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('guidance.md carries the supersede sentence', () => {
  assert.ok(readFileSync(join(ROOT, 'policy', 'guidance.md'), 'utf8').includes(SUPERSEDE));
});

test('guidance.md tells to replace a rejected model with the next lower one at xhigh', () => {
  const guidance = readFileSync(join(ROOT, 'policy', 'guidance.md'), 'utf8');
  assert.match(guidance, /A rejected model gives way to the next lower one at xhigh/);
});

test('guidance.md says blocked_on is settled by the orchestrating session', () => {
  const guidance = readFileSync(join(ROOT, 'policy', 'guidance.md'), 'utf8');
  assert.ok(guidance.includes("`blocked_on` is yours to settle as the orchestrating session, never the user's and never a new `decide:` stage:"));
  assert.ok(!guidance.includes('re-run that stage as a `decide:`'));
});

test('guidance.md names the Haiku-first workflow and the Haiku start sentence', () => {
  const guidance = readFileSync(join(ROOT, 'policy', 'guidance.md'), 'utf8');
  assert.match(guidance, /^## Haiku first for fully specified work$/m);
  assert.ok(!guidance.includes('Haiku first for fixed-shape work'));
  assert.ok(guidance.includes('You are running inside an automated workflow, not an interactive conversation: no one will answer questions, so finish the task and report anything undecided in `blocked_on`.'));
  assert.ok(guidance.includes("(Haiku at its class's highest Haiku effort)"));
});

test('additionalContext is guidance plus the pairs table rendered from the policy', () => {
  const sb = sandbox();
  try {
    const out = runSession(sb);
    const h = out.hookSpecificOutput;
    assert.equal(h.hookEventName, 'SessionStart');
    assert.ok(h.additionalContext.includes(readFileSync(join(ROOT, 'policy', 'guidance.md'), 'utf8').trimEnd()));
    assert.match(h.additionalContext, /authoritative/);
    const policy = loadPolicy();
    for (const [cls, def] of Object.entries(policy.classes)) {
      const row = `| \`${cls}:\` | ${def.owns} | ${formatClassPairs(policy, cls)} |`;
      assert.ok(h.additionalContext.includes(row), row);
    }
  } finally {
    sb.cleanup();
  }
});

test('the pairs table lists investigate and marks the conditional pairs', () => {
  const sb = sandbox();
  try {
    const { additionalContext } = runSession(sb).hookSpecificOutput;
    const rows = Object.fromEntries(
      additionalContext
        .split('\n')
        .filter((l) => /^\| `\w+:` \|/.test(l))
        .map((l) => [/^\| `(\w+):`/.exec(l)[1], l.split(' | ').pop().replace(/ \|$/, '')]),
    );
    assert.equal(rows.investigate, 'sonnet × {medium, high, xhigh}');
    assert.equal(
      rows.judge,
      'opus × {medium, high, xhigh}; sonnet × {medium, high, xhigh} (yes/no verdict schema only)',
    );
    for (const cls of ['decide', 'synth', 'design']) {
      assert.equal(
        rows[cls],
        'opus × {medium, high, xhigh}; sonnet × {medium, high, xhigh} (in a fan-out of more than 3 only)',
        cls,
      );
    }
    assert.equal(rows.build, 'sonnet × {medium, high, xhigh}; opus × {medium, high, xhigh}');
    assert.equal(rows.code, 'haiku × {medium}; sonnet × {medium, high, xhigh}');
    assert.equal(rows.grunt, 'haiku × {medium, high}; sonnet × {medium, high, xhigh}');
  } finally {
    sb.cleanup();
  }
});

test('the pairs table of a custom policy follows its limits', () => {
  const sb = sandbox();
  const tmp = copyPlugin();
  try {
    const file = join(tmp, 'policy', 'default.json');
    const policy = JSON.parse(readFileSync(file, 'utf8'));
    policy.limits = { maxConcurrentOpus: 2, bigFanout: 6 };
    writeFileSync(file, JSON.stringify(policy));
    const { additionalContext } = runSession({ ...sb, script: join(tmp, 'hooks', 'session.mjs') }).hookSpecificOutput;
    assert.match(additionalContext, /\(in a fan-out of more than 6 only\)/);
    assert.doesNotMatch(additionalContext, /more than 3 only/);
  } finally {
    sb.cleanup();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('additionalContext fits 9000 characters and 200 lines', () => {
  const sb = sandbox();
  try {
    const { additionalContext } = runSession(sb).hookSpecificOutput;
    assert.ok(additionalContext.length <= 8600, `${additionalContext.length} characters leaves under 400 before the 9000 clamp, which cuts the table`);
    assert.ok(additionalContext.split('\n').length < 200);
    const lastClass = Object.keys(loadPolicy().classes).at(-1);
    assert.match(additionalContext.split('\n').at(-1), new RegExp(`^\\| \`${lastClass}:\` \\|.*\\|$`), 'the context ends with the whole last table row');
  } finally {
    sb.cleanup();
  }
});

test('no systemMessage when there is nothing to warn about', () => {
  const sb = sandbox();
  try {
    assert.equal('systemMessage' in runSession(sb), false);
  } finally {
    sb.cleanup();
  }
});

test('dontAsk without a Workflow allow rule warns', () => {
  const sb = sandbox();
  try {
    sb.settings('project', 'settings.json', { permissions: { defaultMode: 'dontAsk', allow: ['Bash(ls)'] } });
    const out = runSession(sb);
    assert.match(out.systemMessage, /dontAsk/);
    assert.match(out.systemMessage, /Workflow/);
    assert.match(out.systemMessage, /add "Workflow" to permissions\.allow/);
    assert.match(out.systemMessage, /Ignore this if you start Claude Code in another permission mode/);
    assert.ok(out.systemMessage.length <= 4000 && out.systemMessage.split('\n').length <= 20);
    assert.ok(out.hookSpecificOutput.additionalContext.length > 0);
  } finally {
    sb.cleanup();
  }
});

test('dontAsk in each of the three settings files warns', () => {
  for (const [where, file] of [['home', 'settings.json'], ['project', 'settings.json'], ['project', 'settings.local.json']]) {
    const sb = sandbox();
    try {
      sb.settings(where, file, { permissions: { defaultMode: 'dontAsk' } });
      assert.match(runSession(sb).systemMessage, /dontAsk/, `${where}/${file}`);
    } finally {
      sb.cleanup();
    }
  }
});

test('dontAsk in CLAUDE_CONFIG_DIR settings warns, and ~/.claude is ignored then', () => {
  const sb = sandbox();
  try {
    const cfg = join(sb.home, 'cfg');
    mkdirSync(cfg);
    writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'dontAsk' } }));
    assert.match(runSession({ ...sb, env: { CLAUDE_CONFIG_DIR: cfg } }).systemMessage, /dontAsk/);
    assert.match(runSession({ ...sb, env: { CLAUDE_CONFIG_DIR: `  ${cfg}  ` } }).systemMessage, /dontAsk/);
    sb.settings('home', 'settings.json', { permissions: { defaultMode: 'dontAsk' } });
    assert.equal('systemMessage' in runSession({ ...sb, env: { CLAUDE_CONFIG_DIR: join(sb.home, 'empty') } }), false);
    assert.match(runSession({ ...sb, env: { CLAUDE_CONFIG_DIR: '  ' } }).systemMessage, /dontAsk/);
  } finally {
    sb.cleanup();
  }
});

test('the highest-precedence defaultMode wins over a lower dontAsk', () => {
  const cases = [
    [['home', 'settings.json'], ['project', 'settings.json']],
    [['home', 'settings.json'], ['project', 'settings.local.json']],
    [['project', 'settings.json'], ['project', 'settings.local.json']],
  ];
  for (const [low, high] of cases) {
    const sb = sandbox();
    try {
      sb.settings(low[0], low[1], { permissions: { defaultMode: 'dontAsk' } });
      sb.settings(high[0], high[1], { permissions: { defaultMode: 'acceptEdits' } });
      assert.equal('systemMessage' in runSession(sb), false, `${low.join('/')} overridden by ${high.join('/')}`);
    } finally {
      sb.cleanup();
    }
  }
});

test('a higher scope that sets no defaultMode does not override a lower dontAsk', () => {
  const sb = sandbox();
  try {
    sb.settings('home', 'settings.json', { permissions: { defaultMode: 'dontAsk' } });
    sb.settings('project', 'settings.local.json', { permissions: { allow: ['Bash(ls)'] } });
    assert.match(runSession(sb).systemMessage, /dontAsk/);
  } finally {
    sb.cleanup();
  }
});

test('a Workflow allow rule in any settings file suppresses the warning', () => {
  for (const rule of ['Workflow', 'Workflow()', 'Workflow(*)']) {
    for (const [where, file] of [['home', 'settings.json'], ['project', 'settings.json'], ['project', 'settings.local.json']]) {
      const sb = sandbox();
      try {
        sb.settings('project', 'settings.json', { permissions: { defaultMode: 'dontAsk' } });
        sb.settings(where, file, { permissions: { defaultMode: 'dontAsk', allow: [rule] } });
        assert.equal('systemMessage' in runSession(sb), false, `${rule} in ${where}/${file}`);
      } finally {
        sb.cleanup();
      }
    }
  }
});

test('a name-scoped Workflow rule does not count as a Workflow allow rule', () => {
  const sb = sandbox();
  try {
    sb.settings('home', 'settings.json', { permissions: { defaultMode: 'dontAsk' } });
    sb.settings('project', 'settings.local.json', { permissions: { allow: ['Workflow(deep-audit)'] } });
    assert.match(runSession(sb).systemMessage, /dontAsk/);
  } finally {
    sb.cleanup();
  }
});

test('a lookalike rule does not count as a Workflow allow rule', () => {
  const sb = sandbox();
  try {
    sb.settings('home', 'settings.json', { permissions: { defaultMode: 'dontAsk', allow: ['WorkflowX', 'mcp__Workflow'] } });
    assert.match(runSession(sb).systemMessage, /dontAsk/);
  } finally {
    sb.cleanup();
  }
});

test('other permission modes do not warn', () => {
  const sb = sandbox();
  try {
    sb.settings('project', 'settings.json', { permissions: { defaultMode: 'acceptEdits' } });
    assert.equal('systemMessage' in runSession(sb), false);
  } finally {
    sb.cleanup();
  }
});

test('invalid or non-object settings files are skipped', () => {
  const sb = sandbox();
  try {
    sb.settings('home', 'settings.json', '{ not json');
    sb.settings('project', 'settings.json', '[]');
    sb.settings('project', 'settings.local.json', JSON.stringify({ permissions: 'dontAsk' }));
    assert.equal('systemMessage' in runSession(sb), false);
  } finally {
    sb.cleanup();
  }
});

test('missing or invalid stdin falls back to the process cwd and still exits 0', () => {
  const sb = sandbox();
  try {
    for (const input of ['', '{ nope']) {
      const out = runSession({ ...sb, input });
      assert.ok(out.hookSpecificOutput.additionalContext.length > 0);
    }
  } finally {
    sb.cleanup();
  }
});

function copyPlugin() {
  const tmp = mkdtempSync(join(tmpdir(), 'ultraguard-session-'));
  for (const d of ['hooks', 'src', 'vendor', 'policy']) cpSync(join(ROOT, d), join(tmp, d), { recursive: true });
  return tmp;
}

test('a broken policy still emits guidance and warns how to disable', () => {
  const sb = sandbox();
  const tmp = copyPlugin();
  try {
    writeFileSync(join(tmp, 'policy', 'default.json'), '{ not json');
    const out = runSession({ ...sb, script: join(tmp, 'hooks', 'session.mjs') });
    assert.match(out.systemMessage, /\/plugin disable ultraguard/);
    assert.match(out.systemMessage, /blocked/);
    assert.ok(out.hookSpecificOutput.additionalContext.includes('ultraguard delegation policy'));
    assert.ok(!out.hookSpecificOutput.additionalContext.includes('Allowed (model, effort) pairs'));
  } finally {
    sb.cleanup();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('a broken src module and a missing guidance file never crash the hook', () => {
  const sb = sandbox();
  const tmp = copyPlugin();
  try {
    writeFileSync(join(tmp, 'src', 'rules.mjs'), 'export const = ;');
    rmSync(join(tmp, 'policy', 'guidance.md'));
    const out = runSession({ ...sb, script: join(tmp, 'hooks', 'session.mjs') });
    assert.match(out.systemMessage, /ultraguard/);
  } finally {
    sb.cleanup();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('hooks.json wires SessionStart and the Workflow PreToolUse gate', () => {
  const h = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const start = h.hooks.SessionStart[0];
  assert.equal(start.matcher, 'startup|resume|clear|compact');
  assert.equal(start.hooks[0].type, 'command');
  assert.equal(start.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session.mjs"');
  const pre = h.hooks.PreToolUse[0];
  assert.equal(pre.matcher, 'Workflow');
  assert.equal(pre.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs"');
  assert.equal(pre.hooks[0].timeout, 15);
  assert.equal(pre.hooks[0].onFailure, 'block');
});
