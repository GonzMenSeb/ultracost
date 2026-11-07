import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, effectivePairs, formatPairs } from '../src/rules.mjs';

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

function run(stdin, { env = cleanEnv(), gate = GATE } = {}) {
  const input = typeof stdin === 'string' ? stdin : JSON.stringify(stdin);
  const r = spawnSync(process.execPath, [gate], { input, env, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
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
    assert.match(r.stderr, /tierguard gate internal error/);
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
  assert.match(reason, /^tierguard/);
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
  const tmp = mkdtempSync(join(tmpdir(), 'tierguard-gate-'));
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
    assert.match(r.stderr, /tierguard gate internal error/);
  }
});

test('broken policy is an internal error: exit 2', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tierguard-gate-'));
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
