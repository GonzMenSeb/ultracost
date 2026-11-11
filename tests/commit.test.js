import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGitCommit, hasHaikuCodeStage, readGateRecords, REMINDER } from '../hooks/commit.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = join(ROOT, 'hooks', 'commit.mjs');
const EXPECTED_REMINDER =
  "ultraguard: this session ran Haiku code: stages, which can leave scratch files. Check the commit's file list (git show --stat HEAD) and git status for files no stage meant to change, and remove them in a follow-up commit.";

const MATCH = [
  'git commit -m x',
  '/usr/bin/git commit -m x',
  'git -C /p commit -am x',
  'git add . && git commit -m "x"',
  'cd /p; git commit',
  'git -c user.name=a commit -m x',
  'rtk git commit -m x',
  'GIT_AUTHOR_NAME=a git commit -m x',
  'git --no-pager commit -m x',
  'git --git-dir=/p/.git commit -m x',
  'git status\ngit commit -m x',
  'false || git commit -m x',
];
const NO_MATCH = [
  'git commit-tree abc',
  'git log --grep commit',
  'git status',
  'echo git commit',
  'git show HEAD',
  'npm run commit',
  '',
];

for (const c of MATCH) test(`matches: ${JSON.stringify(c)}`, () => assert.equal(isGitCommit(c), true));
for (const c of NO_MATCH) test(`does not match: ${JSON.stringify(c)}`, () => assert.equal(isGitCommit(c), false));
test('non-string command does not match', () => assert.equal(isGitCommit(undefined), false));

const rec = (decision, stages) => ({ decision, stages });
const stage = (cls, model) => ({ class: cls, model });

test('reminder text is exact', () => assert.equal(REMINDER, EXPECTED_REMINDER));

test('pass with a haiku code stage fires', () => {
  assert.equal(hasHaikuCodeStage([rec('pass', [stage('grunt', 'haiku'), stage('code', 'haiku')])]), true);
});
test('deny record does not fire', () => {
  assert.equal(hasHaikuCodeStage([rec('deny', [stage('code', 'haiku')])]), false);
});
test('sonnet code does not fire', () => {
  assert.equal(hasHaikuCodeStage([rec('pass', [stage('code', 'sonnet')])]), false);
});
test('haiku grunt does not fire', () => {
  assert.equal(hasHaikuCodeStage([rec('pass', [stage('grunt', 'haiku')])]), false);
});
test('malformed records do not fire or throw', () => {
  assert.equal(hasHaikuCodeStage([null, {}, { decision: 'pass' }, { decision: 'pass', stages: [null] }]), false);
});

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'ultraguard-commit-'));
  const sessionDir = (sid) => join(dir, 'ultraguard', 'sessions', sid);
  const write = (sid, name, data) => {
    mkdirSync(sessionDir(sid), { recursive: true });
    writeFileSync(join(sessionDir(sid), name), typeof data === 'string' ? data : JSON.stringify(data));
  };
  return { dir, write, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('readGateRecords: missing dir, invalid id and invalid JSON', () => {
  const sb = sandbox();
  try {
    assert.deepEqual(readGateRecords(sb.dir, 's1'), []);
    sb.write('s1', 'a.gate.json', '{not json');
    sb.write('s1', 'b.gate.json', rec('pass', [stage('code', 'haiku')]));
    sb.write('s1', 'c.eval.json', rec('pass', [stage('code', 'haiku')]));
    const records = readGateRecords(sb.dir, 's1');
    assert.equal(records.length, 1);
    assert.equal(hasHaikuCodeStage(records), true);
    assert.deepEqual(readGateRecords(sb.dir, '../s1'), []);
    assert.deepEqual(readGateRecords(sb.dir, undefined), []);
  } finally {
    sb.cleanup();
  }
});

function runHook(input, configDir) {
  const r = spawnSync(process.execPath, [HOOK], {
    input,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const payload = (over = {}) =>
  JSON.stringify({
    hook_event_name: 'PostToolUse',
    session_id: 'sess-1',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m x' },
    ...over,
  });

test('end to end: fires with the exact output shape', () => {
  const sb = sandbox();
  try {
    sb.write('sess-1', 'toolu_1.gate.json', rec('pass', [stage('code', 'haiku')]));
    const out = runHook(payload(), sb.dir);
    assert.deepEqual(JSON.parse(out), {
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: EXPECTED_REMINDER },
    });
    assert.ok(!out.includes('permissionDecision'));
  } finally {
    sb.cleanup();
  }
});

test('end to end: silent for a non-commit command, non-Bash tool, other session, no record and garbage', () => {
  const sb = sandbox();
  try {
    sb.write('sess-1', 'toolu_1.gate.json', rec('pass', [stage('code', 'haiku')]));
    assert.equal(runHook(payload({ tool_input: { command: 'git status' } }), sb.dir), '');
    assert.equal(runHook(payload({ tool_name: 'Edit' }), sb.dir), '');
    assert.equal(runHook(payload({ session_id: 'other' }), sb.dir), '');
    assert.equal(runHook(payload({ session_id: '../sess-1' }), sb.dir), '');
    assert.equal(runHook('not json', sb.dir), '');
    assert.equal(runHook('', sb.dir), '');
  } finally {
    sb.cleanup();
  }
});

test('hooks.json registers the PostToolUse Bash hook without an if field', () => {
  const h = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks.PostToolUse;
  assert.equal(h.length, 1);
  assert.equal(h[0].matcher, 'Bash');
  assert.deepEqual(h[0].hooks, [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/commit.mjs"', timeout: 5 }]);
});
