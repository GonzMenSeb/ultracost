import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from '../src/resolve.mjs';

const NAME_MESSAGE =
  'Launching a workflow by name is not allowed. For a saved workflow, relaunch with scriptPath pointing at its file. For a built-in workflow, write your own compliant workflow for the same job and launch it with script.';

const dir = mkdtempSync(join(tmpdir(), 'ultraguard-resolve-'));
mkdirSync(join(dir, 'sub'));
writeFileSync(join(dir, 'sub', 'w.js'), 'const x = 1;\n');

test.after(() => rmSync(dir, { recursive: true, force: true }));

const assertSource = (r) => {
  assert.equal(r.source, null);
  assert.equal(r.errors.length, 1);
  const e = r.errors[0];
  assert.equal(e.code, 'SOURCE');
  assert.equal(e.line, null);
  assert.equal(e.label, null);
  assert.equal(e.stage, null);
  return e;
};

test('inline script resolves with null path', () => {
  const r = resolve({ script: 'abc' }, dir);
  assert.deepEqual(r, { source: 'abc', path: null, errors: [] });
});

test('empty inline script is still a source', () => {
  const r = resolve({ script: '' }, dir);
  assert.equal(r.source, '');
  assert.deepEqual(r.errors, []);
});

test('scriptPath resolves relative to cwd and reads UTF-8', () => {
  const r = resolve({ scriptPath: 'sub/w.js' }, dir);
  assert.equal(r.source, 'const x = 1;\n');
  assert.equal(r.path, join(dir, 'sub', 'w.js'));
  assert.deepEqual(r.errors, []);
});

test('absolute scriptPath ignores cwd', () => {
  const r = resolve({ scriptPath: join(dir, 'sub', 'w.js') }, '/nonexistent');
  assert.equal(r.source, 'const x = 1;\n');
});

test('unreadable scriptPath is SOURCE', () => {
  const e = assertSource(resolve({ scriptPath: 'missing.js' }, dir));
  assert.match(e.message, /missing\.js/);
});

test('scriptPath pointing at a directory is SOURCE', () => {
  assertSource(resolve({ scriptPath: 'sub' }, dir));
});

test('name is denied with the fixed message', () => {
  const e = assertSource(resolve({ name: 'anything' }, dir));
  assert.equal(e.message, NAME_MESSAGE);
});

test('no source is SOURCE, including a bare resumeFromRunId', () => {
  assertSource(resolve({}, dir));
  assertSource(resolve({ resumeFromRunId: 'abc' }, dir));
});

test('null and undefined count as absent', () => {
  assertSource(resolve({ script: null, scriptPath: undefined, name: null }, dir));
  assert.equal(resolve({ script: 'a', scriptPath: null, name: null }, dir).source, 'a');
});

test('more than one source is SOURCE', () => {
  assertSource(resolve({ script: 'a', scriptPath: 'sub/w.js' }, dir));
  assertSource(resolve({ script: 'a', name: 'n' }, dir));
  assertSource(resolve({ scriptPath: 'sub/w.js', name: 'n' }, dir));
  assertSource(resolve({ script: 'a', scriptPath: 'b', name: 'n' }, dir));
});

test('non-string script and scriptPath are SOURCE', () => {
  assertSource(resolve({ script: 5 }, dir));
  assertSource(resolve({ scriptPath: ['a'] }, dir));
});

test('non-object input is SOURCE', () => {
  assertSource(resolve(null, dir));
  assertSource(resolve(undefined, dir));
  assertSource(resolve('x', dir));
});
