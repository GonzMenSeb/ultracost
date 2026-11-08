import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, effectivePairs, formatPairs } from '../src/rules.mjs';
import { sha256Hex } from '../src/fingerprint.mjs';
import { RECORD_VERSION, recordPath } from '../src/record.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HARNESS = join(ROOT, 'tests', 'harness');
const GATE = join(ROOT, 'hooks', 'gate.mjs');
const LAST_LINE = 'If this is your second deny for the same workflow, stop and ask the user.';
const NAME_MESSAGE =
  'Launching a workflow by name is not allowed. For a saved workflow, relaunch with scriptPath pointing at its file. For a built-in workflow, write your own compliant workflow for the same job and launch it with script.';
const BLOCKED_ON = "blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }";

const OVERRIDE_VARS = ['CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE', 'CLAUDE_CODE_EFFORT_LEVEL'];
const cleanEnv = (extra = {}) => {
  const e = { ...process.env, ...extra };
  for (const k of OVERRIDE_VARS) if (!(k in extra)) delete e[k];
  return e;
};

const transcript = (name) => join(HARNESS, 'transcripts', `${name}.jsonl`);

function fixture(name, patch = {}) {
  const raw = readFileSync(join(HARNESS, `${name}.json`), 'utf8').split('${HARNESS}').join(HARNESS);
  return { ...JSON.parse(raw), ...patch };
}

const configDirs = [];
test.after(() => {
  for (const d of configDirs) rmSync(d, { recursive: true, force: true });
});

function freshConfigDir() {
  const d = mkdtempSync(join(tmpdir(), 'ultraguard-config-'));
  configDirs.push(d);
  return d;
}

function run(stdin, { env = cleanEnv(), gate = GATE, configDir = freshConfigDir() } = {}) {
  const input = typeof stdin === 'string' ? stdin : JSON.stringify(stdin);
  const r = spawnSync(process.execPath, [gate], { input, env: { ...env, CLAUDE_CONFIG_DIR: configDir }, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, configDir };
}

function denied(r) {
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  const h = out.hookSpecificOutput;
  assert.equal(h.hookEventName, 'PreToolUse');
  assert.equal(h.permissionDecision, 'deny');
  assert.equal(typeof h.permissionDecisionReason, 'string');
  assert.ok(h.permissionDecisionReason.endsWith(LAST_LINE), 'reason ends with the fixed last line');
  return h.permissionDecisionReason;
}

function clean(r) {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
}

test('clean inline script: exit 0 and no output', () => {
  clean(run(fixture('clean')));
});

test('clean scriptPath resolved against cwd: exit 0 and no output', () => {
  clean(run(fixture('clean-scriptpath')));
});

test('input whose tool_name is not Workflow is malformed: exit 2, no stdout', () => {
  const variants = [
    fixture('not-workflow'),
    { tool_input: { name: 'x' } },
    {},
    { tool_name: 'workflow', tool_input: { name: 'x' } },
  ];
  for (const input of variants) {
    const r = run(input);
    assert.equal(r.status, 2, JSON.stringify(input));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /ultraguard gate internal error/);
  }
});

test('SOURCE: no source', () => {
  const reason = denied(run(fixture('source-none')));
  assert.match(reason, /SOURCE/);
});

test('SOURCE: bare resumeFromRunId', () => {
  const reason = denied(run(fixture('source-resume')));
  assert.match(reason, /SOURCE/);
});

test('SOURCE: launch by name carries the exact message', () => {
  const reason = denied(run(fixture('source-name')));
  assert.match(reason, /SOURCE/);
  assert.ok(reason.includes(NAME_MESSAGE));
});

test('SOURCE: mixed sources', () => {
  const reason = denied(run(fixture('source-mixed')));
  assert.match(reason, /SOURCE/);
});

test('SOURCE: unreadable scriptPath', () => {
  const reason = denied(run(fixture('source-unreadable')));
  assert.match(reason, /SOURCE/);
  assert.match(reason, /does-not-exist\.js/);
});

test('PARSE: syntax error', () => {
  const reason = denied(run(fixture('parse-error')));
  assert.match(reason, /PARSE/);
  assert.match(reason, /^ultraguard/);
  assert.ok(reason.split('\n').some((l) => /^script:\d+ PARSE /.test(l)), reason);
});

test('SHAPE: missing effort is named with file, line and label', () => {
  const reason = denied(run(fixture('shape-missing-effort')));
  const line = reason.split('\n').find((l) => l.includes('SHAPE'));
  assert.ok(line, reason);
  assert.match(line, /^script:1 /);
  assert.match(line, /\[build: x\]/);
});

test('SHAPE: scriptPath is reported as given, not as the absolute path', () => {
  const reason = denied(run(fixture('bad-scriptpath')));
  assert.match(reason, /^scripts\/bad\.js:1 /m);
  assert.ok(!reason.includes(HARNESS));
});

test('SHAPE: missing schema adds the fixed blocked_on snippet', () => {
  const reason = denied(
    run(fixture('clean', { tool_input: { script: "await agent('x', { label: 'build: x', model: 'sonnet', effort: 'high' })\n" } })),
  );
  assert.ok(reason.includes(BLOCKED_ON), reason);
});

test('blocked_on snippet is omitted for an opus stage that already has an inline blocked_on', () => {
  const opts = "label: 'decide: x', model: 'opus', effort: 'high'";
  const schema = `, schema: { type: 'object', properties: { ${BLOCKED_ON} } }`;
  const on = (script) => denied(run(fixture('clean', { transcript_path: transcript('sonnet'), tool_input: { script } })));
  const withIt = on(`await agent('x', { ${opts}${schema} })\n`);
  assert.match(withIt, /does not allow model "opus"/);
  assert.ok(!withIt.includes('blocked_on'), withIt);
  assert.ok(on(`await agent('x', { ${opts} })\n`).includes(BLOCKED_ON));
});

test('blocked_on snippet says it goes inline in the stage schema and a shared const is not accepted', () => {
  const reason = denied(
    run(fixture('clean', { tool_input: { script: "await agent('x', { label: 'build: x', model: 'sonnet', effort: 'high' })\n" } })),
  );
  const line = reason.split('\n').find((l) => l.includes(BLOCKED_ON));
  assert.match(line, /inline/);
  assert.match(line, /schema object literal/);
  assert.match(line, /shared schema const is not accepted/);
});

test('PAIR: low effort lists the class pairs', () => {
  const reason = denied(run(fixture('pair-low-effort')));
  assert.match(reason, /PAIR/);
  assert.match(reason, /^decide: opus × \{medium, high, xhigh\}$/m);
});

test('PAIR: unknown class adds the all-classes table', () => {
  const reason = denied(run(fixture('pair-unknown-class')));
  assert.match(reason, /PAIR/);
  assert.match(reason, /Allowed pairs by class:/);
  assert.match(reason, /decide, judge, synth, design: opus × \{medium, high, xhigh\}/);
});

test('SHAPE: a stage with no class gets the all-classes table', () => {
  const reason = denied(
    run(fixture('clean', { tool_input: { script: "await agent('x', { model: 'opus', effort: 'high' })\n" } })),
  );
  assert.match(reason, /Allowed pairs by class:/);
});

test('ENV: each runtime override is denied', () => {
  for (const [name, value] of [
    ['CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL', 'haiku'],
    ['CLAUDE_CODE_SUBAGENT_MODEL_FORCE', '1'],
    ['CLAUDE_CODE_EFFORT_LEVEL', 'low'],
  ]) {
    const reason = denied(run(fixture('clean'), { env: cleanEnv({ [name]: value }) }));
    assert.match(reason, /ENV/);
    assert.ok(reason.includes(name), `${name} named in: ${reason}`);
  }
});

test('ENV: auto effort level is denied; blank effort level and an empty or inherit model override are not', () => {
  assert.match(denied(run(fixture('clean'), { env: cleanEnv({ CLAUDE_CODE_EFFORT_LEVEL: 'auto' }) })), /CLAUDE_CODE_EFFORT_LEVEL/);
  clean(run(fixture('clean'), { env: cleanEnv({ CLAUDE_CODE_EFFORT_LEVEL: ' ', CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: '' }) }));
  clean(run(fixture('clean'), { env: cleanEnv({ CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL: 'Inherit' }) }));
});

test('combined problems share one deny with ENV and stage lines', () => {
  const reason = denied(run(fixture('shape-missing-effort'), { env: cleanEnv({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: 'true' }) }));
  assert.match(reason, /ENV/);
  assert.match(reason, /SHAPE/);
});

test('session cap: opus stage denied on a sonnet session, passes on an opus session', () => {
  const onSonnet = denied(run(fixture('cap-opus-stage', { transcript_path: transcript('sonnet') })));
  assert.match(onSonnet, /PAIR/);
  assert.match(onSonnet, /sonnet/);
  assert.match(onSonnet, /This session runs sonnet/);
  clean(run(fixture('cap-opus-stage', { transcript_path: transcript('opus') })));
});

test('session cap: sonnet decide stage passes on a sonnet session', () => {
  clean(run(fixture('cap-sonnet-stage', { transcript_path: transcript('sonnet') })));
});

test('session cap: missing transcript counts as sonnet and says so', () => {
  const noTranscript = fixture('cap-opus-stage');
  delete noTranscript.transcript_path;
  const reason = denied(run(noTranscript));
  assert.match(reason, /PAIR/);
  assert.match(reason, /treated as sonnet/);
  const unreadable = denied(run(fixture('cap-opus-stage', { transcript_path: join(HARNESS, 'transcripts', 'nope.jsonl') })));
  assert.match(unreadable, /treated as sonnet/);
});

test('session cap: sidechain entries are ignored when reading the session model', () => {
  denied(run(fixture('cap-opus-stage', { transcript_path: transcript('sonnet-with-opus-sidechain') })));
});

const HAIKU_NONE = 'This session runs Haiku and no Haiku pair is allowed; switch with /model sonnet or /model opus.';

function withPolicy(mutate, fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'ultraguard-gate-'));
  try {
    for (const d of ['hooks', 'src', 'vendor', 'policy']) cpSync(join(ROOT, d), join(tmp, d), { recursive: true });
    const file = join(tmp, 'policy', 'default.json');
    const policy = JSON.parse(readFileSync(file, 'utf8'));
    mutate(policy);
    writeFileSync(file, JSON.stringify(policy));
    return fn(join(tmp, 'hooks', 'gate.mjs'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const withoutHaiku = (policy) => {
  for (const c of Object.values(policy.classes)) delete c.pairs.haiku;
};

test('session cap: haiku session follows the shipped policy', () => {
  const reason = denied(run(fixture('cap-sonnet-stage', { transcript_path: transcript('haiku') })));
  const policy = loadPolicy();
  if (Object.values(policy.classes).some((c) => 'haiku' in c.pairs)) {
    assert.ok(reason.includes(`decide: ${formatPairs(effectivePairs(policy, 'decide', 'haiku'))}`), reason);
    assert.ok(!reason.includes(HAIKU_NONE), reason);
  } else {
    assert.ok(reason.includes(HAIKU_NONE), reason);
  }
});

test('session cap: haiku session with no haiku pair states the message once', () => {
  withPolicy(withoutHaiku, (gate) => {
    const script = stagesScript([['decide', 'sonnet', 'high'], ['judge', 'sonnet', 'high']]);
    const reason = denied(run(fixture('clean', { transcript_path: transcript('haiku'), tool_input: { script } }), { gate }));
    assert.equal(reason.split(HAIKU_NONE).length - 1, 1, reason);
    assert.ok(!/^\w+: none$/m.test(reason), reason);
  });
});

test('a class named like an Object.prototype member is unknown and gets the all-classes table', () => {
  const script = "await agent('y', { label: 'constructor: b', model: 'opus', effort: 'high' })\n";
  const reason = denied(run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { script } })));
  assert.match(reason, /Allowed pairs by class:/);
  assert.ok(!/^constructor: none$/m.test(reason), reason);
});

test('malformed stdin is an internal error: exit 2, stderr, no stdout', () => {
  for (const bad of ['', '{not json', 'null', '[]']) {
    const r = run(bad);
    assert.equal(r.status, 2, `input ${JSON.stringify(bad)}`);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /ultraguard gate internal error/);
  }
});

test('broken policy is an internal error: exit 2', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ultraguard-gate-'));
  try {
    for (const d of ['hooks', 'src', 'vendor', 'policy']) cpSync(join(ROOT, d), join(tmp, d), { recursive: true });
    const gate = join(tmp, 'hooks', 'gate.mjs');
    for (const corrupt of ['{ not json', '{"classes":{}}']) {
      writeFileSync(join(tmp, 'policy', 'default.json'), corrupt);
      const r = run(fixture('clean'), { gate });
      assert.equal(r.status, 2, r.stderr);
      assert.equal(r.stdout, '');
      assert.ok(r.stderr.length > 0);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

const schema = `schema: { type: 'object', properties: { result: { type: 'string' }, ${BLOCKED_ON} } }`;
function stageScript(cls, model, effort) {
  const parts = [`label: '${cls}: stage'`, `model: '${model}'`, `effort: '${effort}'`];
  if (model !== 'opus') parts.push(schema);
  return `await agent('Do the work.', { ${parts.join(', ')} })\n`;
}

test('every (class, model, effort) pair in the shipped policy passes on an opus session', () => {
  const policy = loadPolicy();
  let n = 0;
  for (const [cls, def] of Object.entries(policy.classes)) {
    for (const [model, efforts] of Object.entries(def.pairs)) {
      for (const effort of efforts) {
        const r = run(fixture('clean', { tool_input: { script: stageScript(cls, model, effort) } }));
        assert.equal(r.status, 0, `${cls} ${model} ${effort}: ${r.stderr}`);
        assert.equal(r.stdout, '', `${cls} ${model} ${effort}: ${r.stdout}`);
        n++;
      }
    }
  }
  assert.ok(n > 0);
});

test('pairs outside the policy are denied for every class', () => {
  const policy = loadPolicy();
  for (const cls of Object.keys(policy.classes)) {
    for (const [model, effort] of [['opus', 'low'], ['sonnet', 'max'], ['fable', 'high'], ['haiku', 'low']]) {
      const r = run(fixture('clean', { tool_input: { script: stageScript(cls, model, effort) } }));
      denied(r);
    }
  }
});

function longestScript(count) {
  const classes = Object.keys(loadPolicy().classes);
  const stages = [];
  for (let i = 0; i < count; i++) {
    const cls = i % 4 === 3 ? `unknown${i}` : classes[i % classes.length];
    const model = i % 2 === 0 ? 'sonnet' : 'opus';
    stages.push(
      `await agent('Work item ${i}.', { label: '${cls}: a rather long descriptive label for stage number ${i} of the audit', model: '${model}', effort: 'low' })`,
    );
  }
  return `${stages.join('\n')}\n`;
}

test('longest realistic deny fits 2000 chars and 20 lines and keeps the last line', () => {
  const transcripts = ['sonnet', 'opus', 'haiku', null];
  for (const t of transcripts) {
    const patch = t ? { transcript_path: transcript(t) } : {};
    const input = fixture('clean', { ...patch, tool_input: { script: longestScript(30) } });
    if (!t) delete input.transcript_path;
    const reason = denied(run(input, { env: cleanEnv({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }) }));
    assert.ok(reason.length <= 2000, `${t}: ${reason.length} chars`);
    assert.ok(reason.split('\n').length <= 20, `${t}: ${reason.split('\n').length} lines`);
    const covered = coveredLines(reason);
    if (t !== 'haiku') for (let n = 1; n <= 30; n++) assert.ok(covered.has(n), `${t}: line ${n} missing:\n${reason}`);
  }
});

test('deny with few stages lists every stage and no truncation marker', () => {
  const reason = denied(run(fixture('clean', { transcript_path: transcript('sonnet'), tool_input: { script: longestScript(3) } })));
  assert.ok(!/…and \d+ more/.test(reason));
  assert.equal(reason.split('\n').filter((l) => /^script:\d+ /.test(l)).length, 3);
});

test('gate never emits allow, ask or updatedInput', () => {
  for (const name of ['source-none', 'parse-error', 'pair-low-effort', 'shape-missing-effort']) {
    const r = run(fixture(name));
    assert.ok(!/"allow"|"ask"|updatedInput/.test(r.stdout), name);
  }
});


function stagesScript(specs) {
  return `${specs.map(([cls, model, effort], i) => `await agent('W${i}.', { label: '${cls}: s${i}', model: '${model}', effort: '${effort}' })`).join('\n')}\n`;
}

test('multi-stage deny states each class pairs string once', () => {
  const policy = loadPolicy();
  const script = stagesScript([['decide', 'opus', 'low'], ['decide', 'opus', 'low'], ['build', 'sonnet', 'max'], ['grunt', 'haiku', 'xhigh']]);
  const reason = denied(run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { script } })));
  for (const cls of ['decide', 'build', 'grunt']) {
    const pairs = formatPairs(effectivePairs(policy, cls, 'opus'));
    assert.equal(reason.split('\n').filter((l) => l === `${cls}: ${pairs}`).length, 1, `${cls}: ${reason}`);
  }
  assert.ok(!reason.includes('Allowed:'), reason);
});

test('a stage with several problems separates them with a period or semicolon', () => {
  const script = "await agent('x', { label: 'build: z', model: 'sonnet', effort: 'low' })\n";
  const reason = denied(run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { script } })));
  const line = reason.split('\n').find((l) => l.includes('SHAPE'));
  assert.ok(line, reason);
  assert.ok(!/[^.;:]\s+Class "/.test(line), line);
});

test('newlines in a label cannot push the reason past 20 lines or hide the last line', () => {
  const label = `build: a${'\n'.repeat(25)}b`;
  const script = `await agent('x', { label: \`${label}\`, model: 'sonnet', effort: 'low' })\n`;
  const reason = denied(run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { script } })));
  assert.ok(reason.split('\n').length <= 20, `${reason.split('\n').length} lines`);
  assert.ok(reason.length <= 2000);
});

function longPathScript(body) {
  const dir = join(mkdtempSync(join(tmpdir(), 'tg-')), 'a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'review.workflow.js');
  writeFileSync(file, body);
  assert.ok(file.length >= 100, `${file.length}`);
  return file;
}

test('long scriptPath: multi-problem stages keep every message and no stage is dropped while the reason fits', () => {
  const specs = [['build', 'sonnet', 'low'], ['fix', 'sonnet', 'max'], ['build', 'sonnet', 'max']];
  const body = `${specs.map(([c, m, e], i) => `await agent('W${i}.', { label: '${c}: implement the parser module ${i}', model: '${m}', effort: '${e}', agentType: 'x' })`).join('\n')}\n`;
  const scriptPath = longPathScript(body);
  try {
    const reason = denied(run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { scriptPath } })));
    assert.ok(!reason.includes('…'), reason);
    assert.equal(reason.split('\n').filter((l) => l.includes(' SHAPE') || l.includes(' PAIR')).length, 3, reason);
  } finally {
    rmSync(dirname(dirname(dirname(dirname(scriptPath)))), { recursive: true, force: true });
  }
});

test('long scriptPath: eight stages missing effort are all listed unclipped', () => {
  const body = `${Array.from({ length: 8 }, (_, i) => `await agent('W${i}.', { label: 'build: stage ${i}', model: 'sonnet' })`).join('\n')}\n`;
  const scriptPath = longPathScript(body);
  try {
    const reason = denied(run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { scriptPath } })));
    assert.ok(!/…and \d+ more/.test(reason), reason);
    assert.ok(!reason.includes('…'), reason);
    assert.ok(reason.length <= 2000 && reason.split('\n').length <= 20);
  } finally {
    rmSync(dirname(dirname(dirname(dirname(scriptPath)))), { recursive: true, force: true });
  }
});

function pairsLineFor(reason, cls, sm) {
  const p = formatPairs(effectivePairs(loadPolicy(), cls, sm));
  return reason.split('\n').some((l) => {
    if (!l.endsWith(`: ${p}`) || l.startsWith('script')) return false;
    return l.slice(0, -(p.length + 2)).split(', ').includes(cls);
  });
}

test('17 stages missing effort on an opus session still carry every listed class pairs', () => {
  const classes = ['decide', 'judge', 'synth'];
  const script = `${Array.from({ length: 17 }, (_, i) => `await agent('W${i}.', { label: '${classes[i % 3]}: s${i}', model: 'opus' })`).join('\n')}\n`;
  const reason = denied(run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { script } })));
  assert.ok(reason.length <= 2000 && reason.split('\n').length <= 20, reason);
  for (const cls of classes) assert.ok(pairsLineFor(reason, cls, 'opus'), `${cls}: ${reason}`);
});

test('one low-effort stage per class on a sonnet session carries every listed class pairs', () => {
  const classes = Object.keys(loadPolicy().classes);
  const script = classes
    .map((c, i) => `await agent('W${i}.', { label: '${c}: s${i}', model: 'sonnet', effort: 'low', ${schema} })`)
    .join('\n');
  const reason = denied(run(fixture('clean', { transcript_path: transcript('sonnet'), tool_input: { script } })));
  for (const cls of classes) assert.ok(pairsLineFor(reason, cls, 'sonnet'), `${cls}: ${reason}`);
});

test('14 low-effort stages over 5 classes on an opus session carry every listed class pairs', () => {
  const plan = [['grunt', 6], ['build', 4], ['judge', 2], ['synth', 1], ['decide', 1]];
  const specs = plan.flatMap(([c, n]) => Array.from({ length: n }, () => [c, 'opus', 'low']));
  const reason = denied(run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { script: stagesScript(specs) } })));
  for (const [cls] of plan) assert.ok(pairsLineFor(reason, cls, 'opus'), `${cls}: ${reason}`);
});

test('haiku session with no haiku pair: unlabelled and unknown-class stages get the haiku message, not the none table', () => {
  withPolicy(withoutHaiku, (gate) => {
    for (const script of [
      "await agent('p', { model: 'opus', effort: 'high' })\n",
      "await agent('p', { label: 'review: x', model: 'opus', effort: 'high' })\n",
      'await agent(\n',
    ]) {
      const reason = denied(run(fixture('clean', { transcript_path: transcript('haiku'), tool_input: { script } }), { gate }));
      assert.equal(reason.split(HAIKU_NONE).length - 1, 1, reason);
      assert.ok(!/: none$/m.test(reason), reason);
    }
    const byName = denied(run(fixture('source-name', { transcript_path: transcript('haiku') }), { gate }));
    assert.ok(byName.includes(HAIKU_NONE), byName);
  });
});

test('newlines in scriptPath cannot push the reason past 20 lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tg-'));
  const file = join(dir, 'a\nb\nc.js');
  writeFileSync(file, `${Array.from({ length: 60 }, (_, i) => `this.x${i}`).join('\n')}\n`);
  try {
    for (const t of ['opus', 'haiku']) {
      const reason = denied(run(fixture('clean', { transcript_path: transcript(t), tool_input: { scriptPath: file } })));
      assert.ok(reason.split('\n').length <= 20, `${t}: ${reason.split('\n').length} lines\n${reason}`);
    }
    const mixed = longestScript(30);
    writeFileSync(file, mixed);
    const reason = denied(
      run(fixture('clean', { transcript_path: transcript('haiku'), tool_input: { scriptPath: file } }), { env: cleanEnv({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }) }),
    );
    assert.ok(reason.split('\n').length <= 20, `${reason.split('\n').length} lines\n${reason}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PAIR: unknown-class stages do not repeat the valid class list when the table is printed', () => {
  const script = Array.from(
    { length: 14 },
    (_, i) => `await agent('x', { label: 'review: check module ${i} for correctness', model: 'opus', effort: 'high' })\n`,
  ).join('');
  const reason = denied(run(fixture('clean', { tool_input: { script } })));
  assert.match(reason, /Allowed pairs by class:/);
  assert.doesNotMatch(reason, /Valid classes:/);
  assert.doesNotMatch(reason, /…and \d+ more/);
});

test('a very long scriptPath still yields a reason within 2000 chars with a problem line and the last line', () => {
  for (const n of [1000, 1200]) {
    const scriptPath = `${'a/'.repeat(n)}x.js`;
    const reason = denied(run(fixture('clean', { tool_input: { scriptPath } })));
    assert.ok(reason.length <= 2000, `${n}: ${reason.length} chars`);
    assert.match(reason, /\nSOURCE /);
  }
});

function coveredLines(reason) {
  const out = new Set();
  const add = (spec) => {
    for (const part of spec.split(',')) {
      const [a, b = a] = part.split('-').map(Number);
      for (let n = a; n <= b; n++) out.add(n);
    }
  };
  for (const l of reason.split('\n')) {
    const m = /^[^\s:]*:(\d[\d,-]*) [A-Z]+/.exec(l);
    if (m) add(m[1]);
    const h = /^…and \d+ more at lines (\d[\d,-]*)/.exec(l);
    if (h) add(h[1]);
  }
  return out;
}

const classLetters = (i) => `k${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;

test('truncated reason names the line of every hidden stage', () => {
  const script = `${Array.from({ length: 30 }, (_, i) => `await agent('x${i}', { label: '${classLetters(i)}: thing', model: 'opus', effort: 'high' })`).join('\n')}\n`;
  const reason = denied(run(fixture('clean', { tool_input: { script } })));
  assert.match(reason, /…and \d+ more/);
  assert.ok(reason.length <= 2000 && reason.split('\n').length <= 20, reason);
  const covered = coveredLines(reason);
  for (let n = 1; n <= 30; n++) assert.ok(covered.has(n), `line ${n} missing:\n${reason}`);
});

test('a decide stage after nine build stages is named in the deny even when the build items are many', () => {
  const build = Array.from({ length: 9 }, (_, i) => `await agent('b${i}', { label: 'build: item ${i}', model: 'sonnet', effort: 'low', schema: SHARED })`);
  const script = `const SHARED = { type: 'object' }\n${build.join('\n')}\nawait agent('d', { label: 'decide: pick', model: 'opus' })\n`;
  const reason = denied(run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { script } })));
  assert.ok(coveredLines(reason).has(11), reason);
  assert.ok(reason.length <= 2000 && reason.split('\n').length <= 20, reason);
});

test('a 7-stage omission-style draft repeats no sentence and lists every stage line with its pairs', () => {
  const labels = ['grunt', 'grunt', 'grunt', 'code', 'fix', 'combine', 'judge'];
  const body = labels.map((c, i) => `await agent('p${i}', { label: '${c}: s${i}', effort: 'low', schema: FINDINGS })`).join('\n');
  const script = `const FINDINGS = { type: 'object' }\n${body}\n`;
  const reason = denied(run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { script } })));
  assert.equal(reason.split('model is missing').length - 1, 1, reason);
  assert.equal(reason.split('a shared schema const is not allowed').length - 1, 1, reason);
  assert.doesNotMatch(reason, /…and \d+ more/);
  const covered = coveredLines(reason);
  for (let n = 2; n <= 8; n++) assert.ok(covered.has(n), `line ${n} missing:\n${reason}`);
  for (const cls of ['grunt', 'code', 'fix', 'combine', 'judge']) assert.ok(pairsLineFor(reason, cls, 'opus'), `${cls}: ${reason}`);
});

test('PARSE deny carries the all-classes table, the blocked_on snippet and the agent() shape', () => {
  const reason = denied(run(fixture('parse-error')));
  assert.match(reason, /Allowed pairs by class:/);
  assert.ok(reason.includes(BLOCKED_ON), reason);
  assert.match(reason, /Each agent\(\) takes exactly/);
});

test('SOURCE deny from resolve carries the all-classes table, the blocked_on snippet and the agent() shape', () => {
  for (const name of ['source-mixed', 'source-name', 'source-none']) {
    const reason = denied(run(fixture(name)));
    assert.match(reason, /Allowed pairs by class:/, name);
    assert.ok(reason.includes(BLOCKED_ON), name);
    assert.match(reason, /Each agent\(\) takes exactly/, name);
  }
});

test('a deny that inspected the stages does not carry the agent() shape line', () => {
  assert.doesNotMatch(denied(run(fixture('pair-low-effort'))), /Each agent\(\) takes exactly/);
});

test('user-only denies do not tell Claude to fix and relaunch', () => {
  const env = denied(run(fixture('clean'), { env: cleanEnv({ CLAUDE_CODE_EFFORT_LEVEL: 'high' }) }));
  assert.ok(!/Fix and relaunch/.test(env), env);
  const mixed = denied(run(fixture('shape-missing-effort'), { env: cleanEnv({ CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }) }));
  assert.ok(!/Fix and relaunch/.test(mixed), mixed);
  withPolicy(withoutHaiku, (gate) => {
    const script = stageScript('decide', 'opus', 'high');
    const reason = denied(run(fixture('clean', { transcript_path: transcript('haiku'), tool_input: { script } }), { gate }));
    assert.ok(!/Fix and relaunch/.test(reason), reason);
    assert.ok(!reason.includes('blocked_on'), reason);
    assert.ok(!reason.includes('above the session model'), reason);
    assert.ok(!reason.includes('no stage may use a model above it'), reason);
    assert.ok(reason.includes(HAIKU_NONE), reason);
  });
  const fixable = denied(run(fixture('shape-missing-effort')));
  assert.match(fixable, /Fix and relaunch/);
});

test('agent used as a value gets the class prefix rule and the all-classes table', () => {
  for (const script of ['const out = await Promise.all(prompts.map(agent))\n', 'const out = await pipeline(args, agent)\n']) {
    const reason = denied(run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { script } })));
    assert.match(reason, /Allowed pairs by class:/, reason);
    assert.match(reason, /class prefix such as 'grunt: '/, reason);
  }
});

const MIXED_SCRIPT =
  "await agent('x', { label: 'build: a', model: 'sonnet', effort: 'low' })\nawait agent('y', { label: 'decide: b', model: 'opus' })\n";
const USER_ONLY_HEADER = /Only the user can clear this; tell them and do not relaunch until they have:/;

test('ENV with fixable script problems does not label the script problems user-only', () => {
  const reason = denied(
    run(fixture('clean', { transcript_path: transcript('opus'), tool_input: { script: MIXED_SCRIPT } }), {
      env: cleanEnv({ CLAUDE_CODE_EFFORT_LEVEL: 'high' }),
    }),
  );
  assert.ok(!USER_ONLY_HEADER.test(reason), reason);
  assert.match(reason.split('\n')[0], /Fix/, reason);
  assert.match(reason.split('\n')[0], /user/, reason);
  assert.match(reason, /ENV/);
  assert.match(reason, /SHAPE/);
});

test('ENV alone keeps the user-only header', () => {
  const reason = denied(run(fixture('clean'), { env: cleanEnv({ CLAUDE_CODE_EFFORT_LEVEL: 'high' }) }));
  assert.match(reason, USER_ONLY_HEADER);
});

test('haiku session with no haiku pair keeps the session line first and still lists the script problems', () => {
  withPolicy(withoutHaiku, (gate) => {
    const reason = denied(run(fixture('clean', { transcript_path: transcript('haiku'), tool_input: { script: MIXED_SCRIPT } }), { gate }));
    const lines = reason.split('\n');
    assert.equal(lines[1].startsWith(`PAIR ${HAIKU_NONE}`), true, reason);
    assert.match(reason, /^script:1 SHAPE\+PAIR \[build: a\]/m, reason);
    assert.match(reason, /^script:2 SHAPE \[decide: b\] effort is missing/m, reason);
    assert.match(lines[0], /\(4 problems\)/, reason);
  });
});

test('haiku session with no haiku pair on a launch by name keeps the name message', () => {
  withPolicy(withoutHaiku, (gate) => {
    const reason = denied(run(fixture('source-name', { transcript_path: transcript('haiku') }), { gate }));
    assert.ok(reason.includes(NAME_MESSAGE), reason);
    assert.ok(reason.includes(HAIKU_NONE), reason);
  });
});

const FIXTURES = join(ROOT, 'tests', 'fixtures');
const fixtureScript = (kind, name) => readFileSync(join(FIXTURES, kind, name), 'utf8');
const launch = (script, t = 'opus', extra = {}) =>
  fixture('clean', { transcript_path: transcript(t), tool_input: { script }, ...extra });

const gateRecordOf = (r, sid = 'harness', tuid = 'toolu_harness') => {
  const file = recordPath(r.configDir, sid, tuid, 'gate');
  assert.ok(existsSync(file), `no record at ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
};

const verdictSchema = `schema: { type: 'object', properties: { pass: { type: 'boolean' }, evidence: { type: 'string' }, ${BLOCKED_ON} } }`;
const agentCall = (label, model, effort = 'high', schemaText = schema) =>
  `agent('Work.', { label: '${label}', model: '${model}', effort: '${effort}'${model === 'opus' ? '' : `, ${schemaText}`} })`;
const thunkList = (n, make) => Array.from({ length: n }, (_, i) => `() => ${make(i)}`).join(', ');

test('a clean launch writes a pass record with the script fingerprint', () => {
  const script = stageScript('build', 'sonnet', 'high');
  const r = run(launch(script));
  clean(r);
  const rec = gateRecordOf(r);
  assert.equal(rec.v, RECORD_VERSION);
  assert.equal(rec.kind, 'gate');
  assert.equal(rec.decision, 'pass');
  assert.equal(rec.session_id, 'harness');
  assert.equal(rec.tool_use_id, 'toolu_harness');
  assert.equal(rec.fingerprint, sha256Hex(script));
  assert.equal(rec.scriptPath, null);
  assert.equal(rec.sessionModel, 'opus');
  assert.equal(rec.maxOpus, 0);
  assert.deepEqual(rec.errors, []);
  assert.ok(!Number.isNaN(Date.parse(rec.at)));
  assert.deepEqual(rec.stages, [
    { index: 0, line: 1, label: 'build: stage', class: 'build', model: 'sonnet', effort: 'high', inFanout: false, bigFanout: false, verdict: false, phase: null },
  ]);
  assert.deepEqual(rec.phases, []);
  assert.deepEqual(Object.keys(rec), ['v', 'kind', 'at', 'session_id', 'tool_use_id', 'decision', 'fingerprint', 'scriptPath', 'sessionModel', 'maxOpus', 'phases', 'stages', 'errors']);
});

test('the record carries each stage phase and the declared phases', () => {
  const script = [
    "export const meta = { name: 'x', description: 'y', phases: [{ title: 'Collect' }, { title: 'Decide' }] }",
    "phase('Collect')",
    `await agent('p', { label: 'build: one', model: 'sonnet', effort: 'high', ${schema} })`,
    `await agent('p', { label: 'build: two', model: 'sonnet', effort: 'high', phase: 'Decide', ${schema} })`,
    `await agent('p', { label: 'build: three', model: 'sonnet', effort: 'high', phase: name, ${schema} })`,
    '',
  ].join('\n');
  const r = run(launch(script));
  clean(r);
  const rec = gateRecordOf(r);
  assert.deepEqual(rec.phases, ['Collect', 'Decide']);
  assert.deepEqual(rec.stages.map((s) => [s.label, s.phase]), [['build: one', 'Collect'], ['build: two', 'Decide'], ['build: three', null]]);
});

test('the record is written exactly where recordPath says, one file per launch', () => {
  const r = run(launch(stageScript('build', 'sonnet', 'high'), 'opus', { session_id: 'sess_1', tool_use_id: 'toolu_A' }));
  clean(r);
  const dir = join(r.configDir, 'ultraguard', 'sessions', 'sess_1');
  assert.deepEqual(readdirSync(dir), ['toolu_A.gate.json']);
  assert.equal(recordPath(r.configDir, 'sess_1', 'toolu_A', 'gate'), join(dir, 'toolu_A.gate.json'));
});

test('a clean scriptPath launch fingerprints the text of the file and records the path as given', () => {
  const r = run(fixture('clean-scriptpath'));
  clean(r);
  const rec = gateRecordOf(r);
  assert.equal(rec.fingerprint, sha256Hex(readFileSync(join(HARNESS, 'scripts', 'clean.js'), 'utf8')));
  assert.equal(rec.scriptPath, 'scripts/clean.js');
  assert.equal(rec.decision, 'pass');
});

test('a denied launch writes a deny record with its errors', () => {
  const script = "await agent('x', { label: 'build: x', model: 'sonnet', effort: 'low' })\n";
  const r = run(launch(script));
  denied(r);
  const rec = gateRecordOf(r);
  assert.equal(rec.decision, 'deny');
  assert.equal(rec.fingerprint, sha256Hex(script));
  assert.ok(rec.errors.length >= 1);
  for (const e of rec.errors) {
    assert.deepEqual(Object.keys(e), ['code', 'line', 'message']);
    assert.equal(typeof e.message, 'string');
  }
  assert.ok(rec.errors.some((e) => e.code === 'PAIR' && e.line === 1));
  assert.equal(rec.stages.length, 1);
});

test('a deny before any script exists records a null fingerprint and no stages', () => {
  const r = run(fixture('source-none'));
  denied(r);
  const rec = gateRecordOf(r);
  assert.equal(rec.decision, 'deny');
  assert.equal(rec.fingerprint, null);
  assert.equal(rec.maxOpus, null);
  assert.deepEqual(rec.stages, []);
  assert.deepEqual(rec.errors.map((e) => e.code), ['SOURCE']);
});

test('a parse error records the source fingerprint, no stages and an unknown bound', () => {
  const r = run(fixture('parse-error'));
  denied(r);
  const rec = gateRecordOf(r);
  assert.equal(rec.decision, 'deny');
  assert.equal(typeof rec.fingerprint, 'string');
  assert.equal(rec.maxOpus, null);
  assert.deepEqual(rec.stages, []);
  assert.equal(rec.errors[0].code, 'PARSE');
});

test('the config dir is CLAUDE_CONFIG_DIR trimmed, else ~/.claude', () => {
  const base = mkdtempSync(join(tmpdir(), 'ultraguard-cfg-'));
  configDirs.push(base);
  const padded = run(fixture('clean'), { configDir: `  ${base}  ` });
  clean(padded);
  assert.ok(existsSync(recordPath(base, 'harness', 'toolu_harness', 'gate')));

  const home = mkdtempSync(join(tmpdir(), 'ultraguard-home-'));
  configDirs.push(home);
  for (const blank of ['', '   ']) {
    const r = run(fixture('clean'), { env: cleanEnv({ HOME: home }), configDir: blank });
    clean(r);
    assert.ok(existsSync(recordPath(join(home, '.claude'), 'harness', 'toolu_harness', 'gate')), JSON.stringify(blank));
  }
});

test('an invalid session_id writes under unknown; an invalid or missing tool_use_id on a pass fails closed', () => {
  const odd = run(launch(stageScript('build', 'sonnet', 'high'), 'opus', { session_id: '../escape' }));
  clean(odd);
  assert.ok(existsSync(recordPath(odd.configDir, 'unknown', 'toolu_harness', 'gate')));
  assert.ok(!existsSync(join(odd.configDir, 'escape')));

  for (const bad of ['a/b', '', 'x'.repeat(129), 7, null]) {
    const r = run(launch(stageScript('build', 'sonnet', 'high'), 'opus', { tool_use_id: bad }));
    assert.equal(r.status, 2, JSON.stringify(bad));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /ultraguard gate internal error/);
    assert.match(r.stderr, /cannot write the gate record/);
    assert.match(r.stderr, /tool_use_id/);
    assert.ok(!existsSync(join(r.configDir, 'ultraguard')), JSON.stringify(bad));
  }
  const missing = launch(stageScript('build', 'sonnet', 'high'));
  delete missing.tool_use_id;
  assert.equal(run(missing).status, 2);
});

test('a missing session_id writes under unknown', () => {
  const input = launch(stageScript('build', 'sonnet', 'high'));
  delete input.session_id;
  const r = run(input);
  clean(r);
  assert.ok(existsSync(recordPath(r.configDir, 'unknown', 'toolu_harness', 'gate')));
});

test('a FANOUT deny omits the blocked_on snippet when every opus stage already has one', () => {
  const withBlockedOn = (i) =>
    `() => agent('W${i}.', { label: 'decide: option ${i}', model: 'opus', effort: 'high', schema: { type: 'object', properties: { ${BLOCKED_ON} } } })`;
  const body = Array.from({ length: 4 }, (_, i) => withBlockedOn(i)).join(', ');
  const reason = denied(run(launch(`await parallel([${body}])\n`)));
  assert.match(reason, /FANOUT/);
  assert.ok(!reason.includes('blocked_on'), reason);
});

test('a deny with an invalid tool_use_id still denies and writes nothing', () => {
  const r = run(launch("await agent('x', { label: 'build: x', model: 'sonnet', effort: 'low' })\n", 'opus', { tool_use_id: 'a/b' }));
  denied(r);
  assert.ok(!existsSync(join(r.configDir, 'ultraguard')));
});

test('when the record cannot be written a clean launch exits 2 naming the path, and a deny still prints its deny', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ultraguard-blocked-'));
  configDirs.push(dir);
  const asFile = join(dir, 'config-is-a-file');
  writeFileSync(asFile, 'x');
  const passing = run(fixture('clean'), { configDir: asFile });
  assert.equal(passing.status, 2, passing.stderr);
  assert.equal(passing.stdout, '');
  assert.match(passing.stderr, /cannot write the gate record/);
  assert.ok(passing.stderr.includes(recordPath(asFile, 'harness', 'toolu_harness', 'gate')), passing.stderr);

  const denying = run(fixture('shape-missing-effort'), { configDir: asFile });
  assert.match(denied(denying), /SHAPE/);
  assert.equal(denying.stderr, '');
});

test('the four-opus fixture is denied with FANOUT on an opus session and names the stage line', () => {
  const r = run(launch(fixtureScript('bad', 'fanout-four-opus.js')));
  const reason = denied(r);
  assert.match(reason, /FANOUT/);
  assert.match(reason, /Up to 4 opus agents can run at once here; the limit is 3/);
  assert.match(reason, /^script:\d+ FANOUT /m);
  assert.ok(reason.includes(BLOCKED_ON), reason);
  const rec = gateRecordOf(r);
  assert.equal(rec.decision, 'deny');
  assert.equal(rec.maxOpus, 4);
  assert.ok(rec.errors.some((e) => e.code === 'FANOUT'));
  assert.deepEqual(rec.stages.map((st) => [st.inFanout, st.bigFanout]), [[true, true]]);
});

test('the same four-opus script on a sonnet session reports PAIR, not FANOUT', () => {
  const r = run(launch(fixtureScript('bad', 'fanout-four-opus.js'), 'sonnet'));
  const reason = denied(r);
  assert.match(reason, /PAIR/);
  assert.doesNotMatch(reason, /FANOUT/);
  assert.equal(gateRecordOf(r).maxOpus, 4);
  assert.ok(gateRecordOf(r).errors.every((e) => e.code !== 'FANOUT'));
});

test('FANOUT never fires on a haiku session or with no readable session model', () => {
  for (const t of ['haiku', null]) {
    const input = launch(fixtureScript('bad', 'fanout-four-opus.js'), t ?? 'opus');
    if (t === null) delete input.transcript_path;
    const r = run(input);
    assert.doesNotMatch(denied(r), /FANOUT/, String(t));
  }
});

test('an opus fan-out of unknown size is denied with FANOUT and a null bound in the record', () => {
  const r = run(launch(fixtureScript('bad', 'fanout-unknown-size.js')));
  const reason = denied(r);
  assert.match(reason, /FANOUT/);
  assert.match(reason, /cannot count how many opus agents run at once/);
  assert.equal(gateRecordOf(r).maxOpus, null);
});

test('FANOUT is reported next to a PAIR error on the same stage and keeps one line per stage', () => {
  const script = `await parallel([${thunkList(4, () => agentCall('decide: x', 'opus', 'low'))}])\n`;
  const reason = denied(run(launch(script)));
  assert.match(reason, /PAIR\+FANOUT/);
});

test('identical FANOUT sentences are stated once and later stages point at the first line', () => {
  const body = Array.from({ length: 4 }, (_, i) => `() => agent('W${i}.', { label: 'decide: option ${i}', model: 'opus', effort: 'high' })`).join(',\n  ');
  const reason = denied(run(launch(`await parallel([\n  ${body}\n])\n`)));
  assert.equal(reason.split('Up to 4 opus agents can run at once here').length - 1, 1, reason);
  assert.equal(reason.split('Same as line 2.').length - 1, 3, reason);
  const covered = coveredLines(reason);
  for (let n = 2; n <= 5; n++) assert.ok(covered.has(n), `line ${n}: ${reason}`);
});

test('the sonnet fixtures are denied for the right reason on an opus session', () => {
  const judge = denied(run(launch(fixtureScript('bad', 'judge-sonnet-findings.js'))));
  assert.match(judge, /single yes\/no review/);
  const decide = denied(run(launch(fixtureScript('bad', 'decide-sonnet-alone.js'))));
  assert.match(decide, /more than 3 agents/);
  const investigate = denied(run(launch(fixtureScript('bad', 'investigate-opus.js'))));
  assert.match(investigate, /does not allow model "opus"/);
  assert.match(investigate, /^investigate: sonnet × \{medium, high, xhigh\}$/m);
  assert.ok(investigate.includes(BLOCKED_ON), investigate);
});

test('those fixtures need no verdict schema or fan-out on a sonnet session', () => {
  for (const name of ['judge-sonnet-findings.js', 'decide-sonnet-alone.js']) {
    clean(run(launch(fixtureScript('bad', name), 'sonnet')));
  }
  assert.match(denied(run(launch(fixtureScript('bad', 'investigate-opus.js'), 'sonnet'))), /PAIR/);
});

test('every good fixture passes on an opus session and its record agrees with the fan-out analysis', () => {
  const bounds = { 'fanout-slice.js': 3, 'judge-verdict.js': 1, 'loops.js': 1, 'mixed-tiers.js': 1, 'parallel.js': 3, 'pipeline.js': 0 };
  const files = readdirSync(join(FIXTURES, 'good')).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(files, Object.keys(bounds).sort());
  for (const f of files) {
    const script = fixtureScript('good', f);
    const r = run(launch(script));
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    assert.equal(r.stdout, '', `${f}: ${r.stdout}`);
    const rec = gateRecordOf(r);
    assert.equal(rec.decision, 'pass', f);
    assert.equal(rec.maxOpus, bounds[f], f);
    assert.equal(rec.fingerprint, sha256Hex(script), f);
  }
});

test('good fixtures also pass when launched by scriptPath', () => {
  const r = run(fixture('clean', { tool_input: { scriptPath: join(FIXTURES, 'good', 'fanout-slice.js') } }));
  clean(r);
  assert.equal(gateRecordOf(r).fingerprint, sha256Hex(fixtureScript('good', 'fanout-slice.js')));
});

test('the slice fixture marks its sonnet designers as a big fan-out and passes', () => {
  const rec = gateRecordOf(run(launch(fixtureScript('good', 'fanout-slice.js'))));
  const designers = rec.stages.filter((st) => st.class === 'design');
  assert.deepEqual(designers.map((st) => st.model), ['opus', 'sonnet']);
  assert.ok(designers.every((st) => st.inFanout));
  assert.equal(designers[1].bigFanout, true);
  assert.equal(rec.stages.find((st) => st.class === 'investigate').inFanout, false);
});

test('the verdict fixture records verdict true for the sonnet judge only', () => {
  const rec = gateRecordOf(run(launch(fixtureScript('good', 'judge-verdict.js'))));
  assert.deepEqual(rec.stages.map((st) => [st.class, st.model, st.verdict]), [
    ['build', 'sonnet', false],
    ['judge', 'sonnet', true],
    ['judge', 'opus', false],
  ]);
});

test('every conditional pair of the shipped policy passes in its condition and is denied outside it', () => {
  const policy = loadPolicy();
  let n = 0;
  for (const [cls, def] of Object.entries(policy.classes)) {
    for (const [model, efforts] of Object.entries(def.verdictPairs ?? {})) {
      for (const effort of efforts) {
        const inside = `await ${agentCall(`${cls}: stage`, model, effort, verdictSchema)}\n`;
        const r = run(launch(inside));
        assert.equal(r.status, 0, `${cls} ${model} ${effort}: ${r.stderr}`);
        assert.equal(r.stdout, '');
        assert.match(denied(run(launch(stageScript(cls, model, effort)))), /single yes\/no review/, `${cls} ${model} ${effort}`);
        n++;
      }
    }
    for (const [model, efforts] of Object.entries(def.fanoutPairs ?? {})) {
      for (const effort of efforts) {
        const big = `await parallel([${thunkList(policy.limits.bigFanout + 1, () => agentCall(`${cls}: stage`, model, effort))}])\n`;
        const r = run(launch(big));
        assert.equal(r.status, 0, `${cls} ${model} ${effort}: ${r.stderr}`);
        assert.equal(r.stdout, '');
        const small = `await parallel([${thunkList(policy.limits.bigFanout, () => agentCall(`${cls}: stage`, model, effort))}])\n`;
        assert.match(denied(run(launch(small))), /more than 3 agents/, `${cls} ${model} ${effort}`);
        assert.match(denied(run(launch(stageScript(cls, model, effort)))), /more than 3 agents/, `${cls} ${model} ${effort}`);
        n++;
      }
    }
  }
  assert.ok(n > 0);
});

test('a fan-out of unknown size makes decide on sonnet legal and a sequential one does not', () => {
  const unknown = `await parallel(args.items.map((x) => () => ${agentCall('decide: pick', 'sonnet')}))\n`;
  clean(run(launch(unknown)));
  const loop = `for (const x of args.items) await ${agentCall('decide: pick', 'sonnet')}\n`;
  assert.match(denied(run(launch(loop))), /more than 3 agents/);
});

test('sonnet agents never trigger FANOUT, whatever the shape, on an opus session', () => {
  for (const script of [
    `await parallel(args.items.map((x) => () => ${agentCall('build: x', 'sonnet')}))\n`,
    `await pipeline(args.items, (x) => ${agentCall('grunt: x', 'sonnet')}, (y) => ${agentCall('build: y', 'sonnet')})\n`,
    `await parallel([${thunkList(12, () => agentCall('fix: x', 'sonnet'))}])\n`,
  ]) {
    const r = run(launch(script));
    clean(r);
    assert.equal(gateRecordOf(r).maxOpus, 0);
  }
});

test('three opus at once pass and four are denied; the slice and batching patterns pass', () => {
  const three = `await parallel([${thunkList(3, () => agentCall('decide: x', 'opus'))}])\n`;
  const r = run(launch(three));
  clean(r);
  assert.equal(gateRecordOf(r).maxOpus, 3);
  denied(run(launch(`await parallel([${thunkList(4, () => agentCall('decide: x', 'opus'))}])\n`)));
  const batch = `for (let i = 0; i < args.items.length; i += 3) await parallel(args.items.slice(i, i + 3).map((x) => () => ${agentCall('decide: x', 'opus')}))\n`;
  const b = run(launch(batch));
  clean(b);
  assert.equal(gateRecordOf(b).maxOpus, 3);
});

test('a sonnet session judge needs no verdict schema and passes with a record', () => {
  const script = `await ${agentCall('judge: x', 'sonnet')}\n`;
  const r = run(launch(script, 'sonnet'));
  clean(r);
  assert.equal(gateRecordOf(r).sessionModel, 'sonnet');
});

test('FANOUT denies stay within 2000 characters and 20 lines and cover every stage line', () => {
  for (const count of [4, 10, 30]) {
    for (const t of ['opus']) {
      const body = Array.from({ length: count }, (_, i) => `() => agent('W${i}.', { label: 'decide: option number ${i} of the audit', model: 'opus', effort: 'high' })`).join(',\n  ');
      const script = `await parallel([\n  ${body}\n])\n`;
      const reason = denied(run(launch(script, t)));
      assert.ok(reason.length <= 2000, `${count}: ${reason.length} chars`);
      assert.ok(reason.split('\n').length <= 20, `${count}: ${reason.split('\n').length} lines`);
      const covered = coveredLines(reason);
      for (let n = 2; n < 2 + count; n++) assert.ok(covered.has(n), `${count}: line ${n} missing:\n${reason}`);
    }
  }
});

test('a deny mixing FANOUT, PAIR and SHAPE over many stages keeps the limits and the last line', () => {
  const stages = Array.from({ length: 24 }, (_, i) => {
    const cls = ['decide', 'judge', 'synth', 'investigate', 'build'][i % 5];
    const effort = i % 3 === 0 ? 'low' : 'high';
    return `() => agent('W${i}.', { label: '${cls}: a long descriptive label for stage ${i}', model: 'opus', effort: '${effort}' })`;
  });
  for (const t of ['opus', 'sonnet', 'haiku']) {
    const reason = denied(run(launch(`await parallel([\n${stages.join(',\n')}\n])\n`, t)));
    assert.ok(reason.length <= 2000, `${t}: ${reason.length}`);
    assert.ok(reason.split('\n').length <= 20, `${t}: ${reason.split('\n').length}`);
  }
});

test('FANOUT with an unreadable script path style input still honours the 2000 character limit', () => {
  const script = `const out = []\nfor (const x of args.items) out.push(() => ${agentCall('decide: x', 'opus')})\nawait parallel(out)\n`;
  const reason = denied(run(launch(script)));
  assert.match(reason, /FANOUT/);
  assert.ok(reason.length <= 2000 && reason.split('\n').length <= 20, reason);
});

test('the session table of conditional pairs does not leak into a deny: pair lines show the base pairs', () => {
  const reason = denied(run(launch(fixtureScript('bad', 'decide-sonnet-alone.js'))));
  assert.match(reason, /^decide: opus × \{medium, high, xhigh\}$/m);
});

test('a gate run never writes outside CLAUDE_CONFIG_DIR/ultraguard', () => {
  const r = run(fixture('clean'));
  clean(r);
  assert.deepEqual(readdirSync(r.configDir), ['ultraguard']);
  assert.deepEqual(readdirSync(join(r.configDir, 'ultraguard')), ['sessions']);
});

test('investigation words in opus-class labels are denied with LABEL on any session', () => {
  for (const t of ['opus', 'sonnet']) {
    const r = run(launch(fixtureScript('bad', 'label-investigation.js'), t));
    const reason = denied(r);
    assert.match(reason, /LABEL[+A-Z]* \[decide: ovh extra ip research\] "decide: ovh extra ip research" reads like investigation \("research"\)/, t);
    assert.match(reason, /LABEL[+A-Z]* \[judge: migration readiness\]/, t);
    assert.doesNotMatch(reason, /LABEL[+A-Z]* \[decide: pc1 relay design\]/, t);
    assert.doesNotMatch(reason, /LABEL[+A-Z]* \[synth: research synthesis\]/, t);
    assert.ok(gateRecordOf(r).errors.filter((e) => e.code === 'LABEL').length === 2, t);
  }
});
