import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadPolicy, limitsOf, rules, effectivePairs, formatPairs } from '../src/rules.mjs';
import { analyze } from '../src/analyze.mjs';
import { fanout } from '../src/fanout.mjs';
import { sha256Hex } from '../src/fingerprint.mjs';
import { RECORD_VERSION, recordPath } from '../src/record.mjs';
import { env } from '../src/env.mjs';
import { resolve } from '../src/resolve.mjs';
import { sessionModel } from '../src/sessionModel.mjs';

const LAST_LINE = 'If this is your second deny for the same workflow, stop and ask the user.';
const BLOCKED_ON_LINE =
  "Put exactly this in schema.properties of the inline schema object literal in each sonnet and haiku agent() call (a shared schema const is not accepted): blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }";
const SHAPE_LINE =
  "Each agent() takes exactly (prompt, { label: 'class: name', model, effort, ... }) where the label starts with a class prefix such as 'grunt: ', with no spreads, a quoted string literal for model and effort, no agentType, and an inline schema with blocked_on for sonnet and haiku stages.";
const USER_ONLY = 'Only the user can clear this; tell them and do not relaunch until they have:';
const MIXED = 'Fix the script problems below. The ENV lines and the Haiku session line only the user can clear: tell them, and do not relaunch until they have:';
const MAX_CHARS = 2000;
const MAX_LINES = 20;
const MAX_ITEM = 280;
const MAX_FILE = 200;
const HAIKU_NONE = 'This session runs Haiku and no Haiku pair is allowed; switch with /model sonnet or /model opus.';

const hasClass = (policy, cls) => typeof cls === 'string' && Object.prototype.hasOwnProperty.call(policy.classes, cls);
const spans = (nums) => {
  const out = [];
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j - i >= 2 ? `${nums[i]}-${nums[j]}` : nums.slice(i, j + 1).join(','));
    i = j + 1;
  }
  return out.join(',');
};
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s) => String(s).replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ');
const sentence = (m) => (/[.!?;:]$/.test(m) ? m : `${m}.`);
const withoutAllowed = (m) => m.replace(/\s*Allowed: .*$/s, '');
const withoutValid = (m) => m.replace(/\s*Valid classes: .*$/s, '');

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function buildItems(errors, stages, tableShown) {
  const nonStage = [];
  const byStage = new Map();
  for (const e of errors) {
    if (Number.isInteger(e.stage) && stages[e.stage]) {
      if (!byStage.has(e.stage)) byStage.set(e.stage, []);
      byStage.get(e.stage).push(e);
    } else {
      nonStage.push(e);
    }
  }
  const items = [];
  for (const e of nonStage) {
    items.push({ classes: [], codes: [e.code], stageBound: false, lines: e.line != null ? [e.line] : [], body: oneLine(`${e.code} ${e.message}`) });
  }
  const fanoutSeen = new Map();
  const textOf = (e, line) => {
    if (e.code === 'FANOUT') {
      if (fanoutSeen.has(e.message)) return `Same as line ${fanoutSeen.get(e.message)}.`;
      fanoutSeen.set(e.message, line);
    }
    return sentence(tableShown ? withoutValid(withoutAllowed(e.message)) : withoutAllowed(e.message));
  };
  for (const idx of [...byStage.keys()].sort((a, b) => a - b)) {
    const errs = byStage.get(idx);
    const st = stages[idx];
    const line = errs.find((e) => e.line != null)?.line ?? st.line;
    const label = errs.find((e) => e.label != null)?.label ?? st.label;
    const codes = [...new Set(errs.map((e) => e.code))].join('+');
    const body = `${codes} [${label != null ? clip(String(label), 50) : 'no label'}] ${errs.map((e) => textOf(e, e.line ?? st.line)).join(' ')}`;
    items.push({ classes: [st.class], codes: [...new Set(errs.map((e) => e.code))], stageBound: true, lines: line != null ? [line] : [], body: oneLine(body) });
  }
  return items;
}

function groupItems(errors, stages, tableShown) {
  const items = [];
  const groups = new Map();
  for (const e of errors) {
    if (!(Number.isInteger(e.stage) && stages[e.stage])) {
      items.push({ classes: [], codes: [e.code], stageBound: false, lines: e.line != null ? [e.line] : [], body: oneLine(`${e.code} ${e.message}`) });
      continue;
    }
    const st = stages[e.stage];
    const text = oneLine(sentence(tableShown ? withoutValid(withoutAllowed(e.message)) : withoutAllowed(e.message)));
    const key = `${e.code}\u0000${text}`;
    if (!groups.has(key)) {
      const g = { classes: [], codes: [e.code], stageBound: true, lines: [], body: `${e.code} ${text}` };
      groups.set(key, g);
      items.push(g);
    }
    const g = groups.get(key);
    const line = e.line ?? st.line;
    if (line != null && !g.lines.includes(line)) g.lines.push(line);
    if (!g.classes.includes(st.class)) g.classes.push(st.class);
  }
  for (const g of items) g.lines.sort((a, b) => a - b);
  return items;
}

const noClassHasPairs = (policy, sm) =>
  Object.keys(policy.classes).every((c) => Object.keys(effectivePairs(policy, c, sm)).length === 0);

const haikuNoneSession = (policy, sm) => sm === 'haiku' && noClassHasPairs(policy, sm);

function collapseHaikuNone(errors, stages, policy, sm) {
  if (sm !== 'haiku') return errors;
  const isNone = (e) =>
    e.code === 'PAIR' &&
    Number.isInteger(e.stage) &&
    stages[e.stage] &&
    hasClass(policy, stages[e.stage].class) &&
    Object.keys(effectivePairs(policy, stages[e.stage].class, sm)).length === 0;
  const first = errors.find(isNone);
  if (!first && !noClassHasPairs(policy, sm)) return errors;
  const session = { code: 'PAIR', message: first ? first.message : HAIKU_NONE, line: null, label: null, stage: null };
  return [session, ...errors.filter((e) => !isNone(e))];
}

function buildReason(allErrors, stages, rawFile, policy, sm, analyzed) {
  const oneFile = oneLine(rawFile);
  const file = oneFile.length > MAX_FILE ? `…${oneFile.slice(-(MAX_FILE - 1))}` : oneFile;
  const haikuNone = haikuNoneSession(policy, sm);
  const effSession = haikuNone ? 'opus' : (sm ?? 'sonnet');
  const errors = haikuNone ? allErrors : collapseHaikuNone(allErrors, stages, policy, sm);
  const userOnlyErrors = errors.filter((e) => e.code === 'ENV' || e.sessionNone === true);
  const header = userOnlyErrors.length === 0 ? 'Fix and relaunch:' : userOnlyErrors.length === errors.length ? USER_ONLY : MIXED;
  const blind = !analyzed;
  const perStage = buildItems(errors, stages, true);
  const grouped = groupItems(errors, stages, true);
  const classNames = Object.keys(policy.classes);
  const unstaged = errors.some((e) => e.code === 'SHAPE' && !(Number.isInteger(e.stage) && stages[e.stage]));
  const needsTable = blind || unstaged || perStage.some((i) => i.stageBound && i.classes.some((c) => !hasClass(policy, c)));
  const needsBlockedOn = blind || errors.some((e) => e.needsBlockedOn);
  const capChanges = !(haikuNone && userOnlyErrors.length === errors.length) && classNames.some(
    (c) => formatPairs(effectivePairs(policy, c, haikuNone ? 'sonnet' : effSession)) !== formatPairs(effectivePairs(policy, c, 'opus')),
  );

  const tableLines = () => {
    const groups = new Map();
    for (const c of classNames) {
      const key = formatPairs(effectivePairs(policy, c, effSession));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    return ['Allowed pairs by class:', ...[...groups].map(([pairs, cs]) => `${cs.join(', ')}: ${pairs}`)];
  };
  const noteLine = haikuNone
    ? 'Pairs shown are for an opus session; on a sonnet session no stage may use a model above sonnet.'
    : sm
    ? `This session runs ${sm}; no stage may use a model above it.`
    : 'The session model could not be read from the transcript; it is treated as sonnet, so opus is denied and opus-class stages run on sonnet.';

  const compose = (items, k, withPairs, mode) => {
    const shown = items.slice(0, k);
    const full = mode === 'full';
    const lines = [
      `tierguard blocked this Workflow launch (${errors.length} problem${errors.length === 1 ? '' : 's'})${full ? '' : ` in ${file}`}. ${header}`,
    ];
    for (const i of shown) {
      const loc = i.lines.length ? `${full ? file : ''}:${spans(i.lines)}` : full && i.stageBound ? file : '';
      const text = `${loc} ${i.body}`.trimStart();
      lines.push(mode === 'clip' ? clip(text, MAX_ITEM) : text);
    }
    if (k < items.length) {
      const hidden = items.slice(k);
      const nums = [...new Set(hidden.flatMap((i) => i.lines))].sort((a, b) => a - b);
      const at = nums.length ? ` at lines ${spans(nums)}` : '';
      lines.push(`…and ${hidden.length} more${at} (${[...new Set(hidden.flatMap((i) => i.codes))].join(', ')})`);
    }
    if (withPairs) {
      const groups = new Map();
      for (const i of items) {
        for (const c of i.classes) {
          if (!hasClass(policy, c)) continue;
          const pairs = formatPairs(effectivePairs(policy, c, effSession));
          if (pairs === 'none') continue;
          if (!groups.has(pairs)) groups.set(pairs, new Set());
          groups.get(pairs).add(c);
        }
      }
      for (const [pairs, cs] of groups) lines.push(`${[...cs].join(', ')}: ${pairs}`);
    }
    if (needsBlockedOn) lines.push(BLOCKED_ON_LINE);
    if (blind || unstaged) lines.push(SHAPE_LINE);
    if (needsTable) lines.push(...tableLines());
    if (capChanges) lines.push(noteLine);
    lines.push(LAST_LINE);
    return lines;
  };
  const fits = (lines) => {
    const text = lines.join('\n');
    return text.split('\n').length <= MAX_LINES && text.length <= MAX_CHARS;
  };

  const withPairs = !needsTable;
  for (const list of [perStage, grouped]) {
    for (const mode of ['full', 'short']) {
      const lines = compose(list, list.length, withPairs, mode);
      if (fits(lines)) return lines.join('\n');
    }
  }
  for (let k = grouped.length; k >= 1; k--) {
    const lines = compose(grouped, k, withPairs, 'clip');
    if (fits(lines)) return lines.join('\n');
  }
  const lines = compose(grouped, Math.min(1, grouped.length), false, 'clip');
  while (!fits(lines) && lines.length > 3) lines.splice(lines.length - 2, 1);
  const reason = lines.join('\n');
  if (fits(lines)) return reason;
  return [lines[0], LAST_LINE].join('\n');
}

function gateRecord({ input, toolInput, resolved, analysis, fan, sm, errors, decision }) {
  const stages = fan
    ? analysis.stages.map((st, index) => ({
        index,
        line: st.line,
        label: st.label,
        class: st.class,
        model: st.model,
        effort: st.effort,
        inFanout: fan.stages[index].inFanout,
        bigFanout: fan.stages[index].bigFanout,
        verdict: st.verdict === true,
      }))
    : [];
  return {
    v: RECORD_VERSION,
    kind: 'gate',
    at: new Date().toISOString(),
    session_id: typeof input.session_id === 'string' ? input.session_id : null,
    tool_use_id: typeof input.tool_use_id === 'string' ? input.tool_use_id : null,
    decision,
    fingerprint: resolved.source !== null ? sha256Hex(resolved.source) : null,
    scriptPath: typeof toolInput?.scriptPath === 'string' ? toolInput.scriptPath : null,
    sessionModel: sm ?? null,
    maxOpus: fan && Number.isFinite(fan.maxOpus) ? fan.maxOpus : null,
    stages,
    errors: errors.map((e) => ({ code: e.code, line: e.line ?? null, message: e.message })),
  };
}

function writeRecord(input, record) {
  const dir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  const path = recordPath(dir, input.session_id, input.tool_use_id, 'gate');
  if (path === null) {
    return { path: null, error: new Error(`tool_use_id ${JSON.stringify(input.tool_use_id)} is missing or invalid`) };
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(record));
    return { path, error: null };
  } catch (e) {
    return { path, error: e };
  }
}

async function main() {
  const input = JSON.parse(await readStdin());
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('hook input is not a JSON object');
  }
  if (input.tool_name !== 'Workflow') throw new Error(`hook input tool_name is not Workflow: ${JSON.stringify(input.tool_name)}`);

  const policy = loadPolicy();
  const toolInput = input.tool_input;
  const sm = sessionModel(input.transcript_path);

  const resolved = resolve(toolInput, input.cwd);
  const analysis = resolved.source !== null ? analyze(resolved.source) : { ast: null, stages: [], calls: [], errors: [] };
  const fan = analysis.ast ? fanout(analysis.ast, analysis.calls, analysis.stages, limitsOf(policy)) : null;
  const fanErrors = sm === 'opus' && fan
    ? fan.errors.map((e) => (analysis.stages[e.stage].hasBlockedOn === true ? e : { ...e, needsBlockedOn: true }))
    : [];
  const errors = [
    ...env(process.env),
    ...resolved.errors,
    ...analysis.errors,
    ...rules(analysis.stages, policy, { sessionModel: haikuNoneSession(policy, sm) ? 'opus' : sm, fanout: fan }),
    ...fanErrors,
  ];
  if (haikuNoneSession(policy, sm) && (analysis.stages.length > 0 || errors.length > 0)) {
    errors.unshift({ code: 'PAIR', message: HAIKU_NONE, line: null, label: null, stage: null, sessionNone: true });
  }

  const decision = errors.length === 0 ? 'pass' : 'deny';
  const written = writeRecord(input, gateRecord({ input, toolInput, resolved, analysis, fan, sm, errors, decision }));
  if (decision === 'pass') {
    if (written.error) {
      throw new Error(`cannot write the gate record${written.path ? ` ${written.path}` : ''}: ${written.error.message}`);
    }
    return;
  }

  const file = typeof toolInput?.scriptPath === 'string' ? toolInput.scriptPath : 'script';
  const analyzed = resolved.source !== null && !analysis.errors.some((e) => e.code === 'PARSE');
  const reason = buildReason(errors, analysis.stages, file, policy, sm, analyzed);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
}

try {
  await main();
} catch (e) {
  process.stderr.write(`tierguard gate internal error: ${e && e.stack ? e.stack : e}\n`);
  process.exitCode = 2;
}
