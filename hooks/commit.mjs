import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ID_RE } from '../src/record.mjs';

export const REMINDER =
  'ultraguard: this session ran Haiku code: stages, which can leave scratch files. Check the commit\'s file list (git show --stat HEAD) and git status for files no stage meant to change, and remove them in a follow-up commit.';

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);

function tokenize(segment) {
  return (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^(["'])(.*)\1$/, '$2'));
}

function segmentCommits(segment) {
  const tokens = tokenize(segment);
  let i = 0;
  while (i < tokens.length && ASSIGNMENT.test(tokens[i])) i++;
  if (tokens[i] === 'rtk') i++;
  const bin = tokens[i];
  if (bin !== 'git' && !(typeof bin === 'string' && bin.endsWith('/git'))) return false;
  i++;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    i += VALUE_OPTIONS.has(tokens[i]) ? 2 : 1;
  }
  return tokens[i] === 'commit';
}

export function isGitCommit(command) {
  if (typeof command !== 'string' || !command.includes('commit')) return false;
  return command.split(/&&|\|\||;|\||\n/).some(segmentCommits);
}

export function hasHaikuCodeStage(records) {
  return records.some(
    (r) =>
      r &&
      r.decision === 'pass' &&
      Array.isArray(r.stages) &&
      r.stages.some((s) => s && s.class === 'code' && s.model === 'haiku'),
  );
}

export function readGateRecords(configDir, sessionId) {
  if (typeof sessionId !== 'string' || !ID_RE.test(sessionId)) return [];
  const dir = join(configDir, 'ultraguard', 'sessions', sessionId);
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.gate.json'));
  } catch {
    return [];
  }
  const records = [];
  for (const n of names) {
    try {
      records.push(JSON.parse(readFileSync(join(dir, n), 'utf8')));
    } catch {}
  }
  return records;
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

async function run() {
  const raw = await readStdin();
  const input = raw.trim() ? JSON.parse(raw) : null;
  if (!input || input.tool_name !== 'Bash' || !isGitCommit(input.tool_input?.command)) return null;
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  if (!hasHaikuCodeStage(readGateRecords(configDir, input.session_id))) return null;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: REMINDER } };
}

function isMain() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    const out = await run();
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {}
  process.exit(0);
}
