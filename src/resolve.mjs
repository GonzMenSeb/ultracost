import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const NAME_MESSAGE =
  'Launching a workflow by name is not allowed. For a saved workflow, relaunch with scriptPath pointing at its file. For a built-in workflow, write your own compliant workflow for the same job and launch it with script.';

const fail = (message) => ({
  source: null,
  path: null,
  errors: [{ code: 'SOURCE', line: null, label: null, message, stage: null }],
});

const present = (v) => v !== undefined && v !== null;

export function resolve(input, cwd) {
  if (input === null || typeof input !== 'object') {
    return fail('Workflow input is missing; pass exactly one of script or scriptPath.');
  }
  const given = ['script', 'scriptPath', 'name'].filter((k) => present(input[k]));
  if (given.length === 0) {
    return fail('No workflow source: pass exactly one of script or scriptPath.');
  }
  if (given.length > 1) {
    return fail(`Mixed workflow sources (${given.join(', ')}): pass exactly one of script or scriptPath.`);
  }
  const [kind] = given;
  if (kind === 'name') return fail(NAME_MESSAGE);
  if (typeof input[kind] !== 'string') return fail(`${kind} must be a string.`);
  if (kind === 'script') return { source: input.script, path: null, errors: [] };

  const path = resolvePath(typeof cwd === 'string' && cwd ? cwd : process.cwd(), input.scriptPath);
  try {
    return { source: readFileSync(path, 'utf8'), path, errors: [] };
  } catch (e) {
    return fail(`scriptPath ${input.scriptPath} cannot be read (${e.code || e.message}).`);
  }
}
