import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

test('package.json, plugin.json, and the marketplace entry share one version', () => {
  const pkg = read('package.json').version;
  const plugin = read('.claude-plugin/plugin.json').version;
  const marketplace = read('.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'ultraguard').version;

  assert.equal(plugin, pkg, `plugin.json (${plugin}) must match package.json (${pkg})`);
  assert.equal(marketplace, pkg, `marketplace entry (${marketplace}) must match package.json (${pkg})`);
});
