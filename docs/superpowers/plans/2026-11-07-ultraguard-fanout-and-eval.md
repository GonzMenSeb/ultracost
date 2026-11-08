# ultraguard 0.4.7: fan-out rules and ultraguard-eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap Opus at 3 concurrent agents and move investigation and simple reviews to Sonnet in the gate, log every gate decision, and add a live ultraguard-eval indicator that proves each running workflow followed the approved plan.

**Architecture:** The classic `PreToolUse` gate gains a static fan-out analysis (`src/fanout.mjs`), new class rules, and a per-launch record file. A hooks module in the same plugin (`hooks/eval.tsx`) watches workflow spawns and requests, judges each run with four deterministic checks kept in a pure core (`src/eval.mjs`), draws a band and a pane, and writes a per-run record.

**Tech Stack:** Plain ESM JavaScript on Node 18 (no Node 20+ APIs, no dependencies), vendored acorn 8.19.0, Claude Code 2.1.319 mod API (TypeScript hooks module).

**Spec:** `docs/superpowers/specs/2026-11-07-ultraguard-fanout-and-eval-design.md`

## Global Constraints

- Node 18 runtime for hooks and CI; tests run with `npm test` (`node --test tests/*.test.js`).
- No dependencies, no build step. Keep comments to the absolute minimum.
- Version `0.4.7` in `package.json`, `.claude-plugin/plugin.json` and the `ultraguard` entry of `.claude-plugin/marketplace.json`.
- Limits: `maxConcurrentOpus: 3`, `bigFanout: 3`.
- Efforts are `medium`, `high`, `xhigh` only; models are the aliases `opus`, `sonnet`, `haiku`.
- Record files: `<configDir>/ultraguard/sessions/<session>/<id>.gate.json` and `.eval.json`, built with `recordPath` from `src/record.mjs`. `<configDir>` is `CLAUDE_CONFIG_DIR` trimmed, else `~/.claude`.
- ultraguard makes no model call anywhere.
- Tests must never write under the real `~/.claude`: every gate test sets `CLAUDE_CONFIG_DIR` to a temp dir.

## Review Focus

1. A script with more than 3 Opus agents running at once that the fan-out analysis counts as 3 or fewer (a soundness hole is a silent cost leak). Owner: Task 1, adversarial tests.
2. A compliant script that the analysis denies (`.then` chains, batching loops, helpers passed by name, nested parallel/pipeline). Owner: Task 1, positive tests.
3. The gate passing but the mod showing red "not approved" (record path or fingerprint mismatch between gate and mod, `scriptPath` launches, a `CLAUDE_CONFIG_DIR` set for one and not the other). Owner: Tasks 2 and 3, a shared fingerprint and path test.
4. A run that never leaves the band (completion notice missed, killed run, `/clear`). Owner: Task 3, run-end tests.
5. Sessions running Sonnet or Haiku: FANOUT must not fire, `judge:` must not demand a verdict schema. Owner: Task 2.

---

### Task 0 (done): shared helpers

`src/fingerprint.mjs` exports `sha256Hex(text: string): string` (pure JS, matches `node:crypto`). `src/record.mjs` exports `RECORD_VERSION = 1`, `ID_RE`, and `recordPath(configDir, sessionId, id, kind: 'gate'|'eval'): string|null`. Tests in `tests/fingerprint.test.js`, `tests/record.test.js`.

### Task 1: fan-out analysis

**Files:**
- Create: `src/fanout.mjs`
- Test: `tests/fanout.test.js`

**Interfaces:**
- Consumes: an acorn `Program` and the `agent()` `CallExpression` nodes in stage order (Task 2 makes `analyze()` return them as `calls`), the analyzer's `stages` (only `model` and `label` are read).
- Produces: `fanout(ast, calls, stages, limits) -> { maxOpus: number, maxAll: number, stages: Array<{ inFanout: boolean, bigFanout: boolean }>, errors: Array<{ code: 'FANOUT', line: number|null, label: string|null, message: string, stage: number }> }`. `Infinity` means unknown. `errors` is empty when `maxOpus <= limits.maxConcurrentOpus`.

- [ ] **Step 1: Write failing tests** in `tests/fanout.test.js`, parsing scripts with `acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true })` and collecting calls the way `analyze()` does. At minimum:
  - sequential awaited Opus agents (top level, inside `for`/`while`, inside an awaited helper): `maxOpus === 1`, no errors, `inFanout === false`.
  - `parallel([() => agent(opus), () => agent(opus), () => agent(opus)])` → 3, no errors; four thunks → 4 and 4 FANOUT errors.
  - `parallel(LIST.map(x => () => agent(opus)))` with `const LIST = [a, b]` → 2; with 4 items → error; with `args.items` → `Infinity` and error.
  - `parallel([...ranked.slice(0, 3).map(t => () => agent(opus)), ...ranked.slice(3).map(t => () => agent(sonnet))])` with `ranked` of unknown size → `maxOpus === 3`, no errors, sonnet stage `bigFanout === true`.
  - `for (let i = 0; i < items.length; i += 3) await parallel(items.slice(i, i + 3).map(x => () => agent(opus)))` → 3.
  - `pipeline(ITEMS, a => agent(opus), b => agent(opus))` with 2 items → 2; with unknown items → error.
  - `Promise.all([agent(opus), agent(opus)])` → 2; `Promise.all(xs.map(x => agent(opus)))` with 5 known → error.
  - `Array.from({ length: 3 }, () => () => agent(opus))` inside `parallel` → 3; `length: N` with `const N = 5` → error.
  - `parallel(...).then(vs => agent(opus))` with 3 Opus inside → 3 (max, not sum).
  - `pipeline(files, review)` with `async function review(f) { return agent(opus) }` and `const files = [1, 2]` → 2.
  - nested: `parallel(A.map(a => () => parallel(B.map(b => () => agent(opus)))))` with 2×2 → 4 → error.
  - escapes: `const p = agent(opus); await p` → `Infinity`; `thunks.push(() => agent(opus))` → `Infinity`; `items.forEach(async x => { await agent(opus) })` → `Infinity`.
  - `const LIST = [1, 2]; LIST.push(3); parallel(LIST.map(...opus...))` → `Infinity`.
  - recursion `async function f(n) { await agent(opus); if (n) await f(n - 1) }` called once awaited → `Infinity`.
  - Sonnet/Haiku-only fan-outs of any shape (including unknown size) → `maxOpus === 0`, no errors, `bigFanout === true` when unknown or above 3.
  - error messages: an over-limit message contains `Up to 4 opus agents can run at once` and `limit is 3`; an unknown message contains `cannot count how many opus agents run at once`.

- [ ] **Step 2: Run** `node --test tests/fanout.test.js`. Expected: FAIL (`src/fanout.mjs` missing).

- [ ] **Step 3: Implement `fanout(ast, calls, stages, limits)`** per the spec's semantics, including the three extra recognised forms (`.then/.catch/.finally`, `slice(e, e + K)`, functions passed by name). Recurse with a memo per function node and a visiting set for recursion. Any `agent()` call or Opus-bearing function value reached in no recognised position makes `maxOpus` `Infinity`. Message texts:
  - over limit: ``Up to ${n} opus agents can run at once here; the limit is ${limit}. Keep at most the ${limit} most complex on opus and run the rest on sonnet (items.slice(0, ${limit}) on opus, items.slice(${limit}) on sonnet), or batch them: for (let i = 0; i < items.length; i += ${limit}) await parallel(items.slice(i, i + ${limit}).map(...)).``
  - unknown: ``ultraguard cannot count how many opus agents run at once here (${why}). Give the opus part a literal list, a const array literal, Array.from({ length: N }), .slice(0, N) or .slice(i, i + N) with N at most ${limit}, or await the opus agents one at a time.``
  Report one error per Opus stage that contributes to the over-limit or unknown bound, with that stage's line and label.

- [ ] **Step 4: Run** `node --test tests/fanout.test.js`. Expected: PASS.

### Task 2: policy, rules, analyzer, gate and its record

**Files:**
- Modify: `policy/default.json`, `src/rules.mjs`, `src/analyze.mjs`, `hooks/gate.mjs`, `hooks/session.mjs`
- Modify fixtures: `tests/fixtures/good/parallel.js`, `tests/fixtures/good/pipeline.js` (rewrite to stay within the cap); add `tests/fixtures/bad/fanout-four-opus.js`, `tests/fixtures/bad/fanout-unknown-size.js`, `tests/fixtures/good/fanout-slice.js`, `tests/fixtures/good/judge-verdict.js`, `tests/fixtures/bad/judge-sonnet-findings.js`, `tests/fixtures/bad/decide-sonnet-alone.js`, `tests/fixtures/bad/investigate-opus.js`
- Test: `tests/policy.test.js`, `tests/rules.test.js`, `tests/analyze.test.js`, `tests/gate.test.js`, `tests/session.test.js`

**Interfaces:**
- Consumes: `fanout()` (Task 1), `sha256Hex()`, `recordPath()`, `RECORD_VERSION` (Task 0).
- Produces: `analyze(source) -> { ast, stages, calls, errors }` where each stage gains `verdict: boolean`; `effectivePairs(policy, cls, sessionModel, ctx = {})` with `ctx = { bigFanout?: boolean, verdict?: boolean }`; `loadPolicy()` validating `fanoutPairs`, `verdictPairs` (same shape as `pairs`) and `limits` (`maxConcurrentOpus`, `bigFanout`: positive integers); `rules(stages, policy, { sessionModel, fanout })` where `fanout.stages[i]` supplies `bigFanout`. The gate record file (spec Part 2), one per decision at `recordPath(configDir, session_id, tool_use_id, 'gate')`, with `maxOpus: null` for unknown.

- [ ] **Step 1: Write failing tests:**
  - `policy.test.js`: `investigate` exists with only `sonnet × {medium, high, xhigh}`; `judge.verdictPairs.sonnet` and `decide|synth|design.fanoutPairs.sonnet` are `[medium, high, xhigh]`; `limits` is `{ maxConcurrentOpus: 3, bigFanout: 3 }`; `loadPolicy` throws on a bad `fanoutPairs` model, a bad `verdictPairs` effort, and a non-integer `limits` value.
  - `analyze.test.js`: `verdict === true` for `properties: { pass: { type: 'boolean' }, evidence: { type: 'string', description: 'x' }, blocked_on: … }` in any order; `false` with an extra key, `pass` typed `string`, a missing `evidence`, or a non-literal value; `calls.length === stages.length`.
  - `rules.test.js` on an Opus session: `judge` sonnet/high passes with `verdict: true`, fails without it and the message contains `single yes/no review`; `decide` sonnet/high passes with `bigFanout: true`, fails without and the message contains `more than 3 agents`; `investigate` opus fails; on a Sonnet session `judge` sonnet without verdict passes and `decide` sonnet without fan-out passes.
  - `gate.test.js`: every run sets `CLAUDE_CONFIG_DIR` to a fresh temp dir and passes `session_id` and `tool_use_id`. A clean launch writes `<dir>/ultraguard/sessions/<sid>/<tuid>.gate.json` with `decision: 'pass'` and `fingerprint === sha256Hex(script)` (for `scriptPath`, the file's text); a denied launch writes `decision: 'deny'` with its `errors`; the four-Opus fixture on an Opus transcript is denied with a `FANOUT` line; on a Sonnet transcript the same script reports `PAIR`, not `FANOUT`; when the record cannot be written (config dir is a file) a clean launch exits 2 with the path on stderr, while a deny still prints its deny.
  - `session.test.js`: the pairs table shows `investigate:` and marks the conditional pairs, e.g. `sonnet × {medium, high, xhigh} (yes/no verdict schema only)` for `judge:` and `(in a fan-out of more than 3 only)` for `decide:`.

- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** `policy/default.json` per the spec table (`judge.owns` loses "and any reading whose output feeds a verdict"; `investigate.owns`: "Investigation: web research, code mapping, and any reading that reports findings"). In `analyze.mjs` compute `verdict` from the inline schema and return `calls`. In `rules.mjs` add the conditional pairs on an Opus session only, keep the session-cap fallback, and explain a refused conditional pair. In `gate.mjs` run `fanout()` after `analyze()`, add its errors only when the session model is `opus`, build and write the record (`mkdirSync(recursive)` + `writeFileSync`), fail closed on a pass whose record cannot be written, and add `FANOUT` to the codes the reason builder knows. `session.mjs` renders the conditional pairs.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

### Task 3: ultraguard-eval mod

**Files:**
- Create: `src/eval.mjs`, `hooks/eval.tsx`, `types/index.d.ts`, `tests/eval.test.js`, `hooks/eval.test.tsx`
- Modify: `hooks/hooks.json` (add `"modules": ["./eval.tsx"]`, keep `hooks`), `.claude-plugin/plugin.json` (`"types": "./types/index.d.ts"`, version `0.4.7`)

**Interfaces:**
- Consumes: `sha256Hex`, `recordPath`, the gate record format (spec Part 2).
- Produces (`src/eval.mjs`, pure, JSON-serialisable state, no `$`):
  - `familyOf(modelId: string): 'opus'|'sonnet'|'haiku'|null`
  - `labelMatches(pattern: string, label: string): boolean` (`${…}` in the pattern matches any text, everything else literal)
  - `createState(): EvalState`
  - `noteLaunch(state, { toolUseId, fingerprint, at })`
  - `noteLaunchResult(state, { toolUseId, isError, taskId, runId })`
  - `noteGateRecord(state, toolUseId, record|null)`
  - `noteSpawn(state, { toolUseId, runId, agentId, label, askedModel, resolvedModel, at })`
  - `noteStep(state, { agentId, model, effort })`
  - `noteAgentDone(state, { agentId })`
  - `noteRunEnd(state, { toolUseId, status })`
  - `runChecks(run): Array<{ id: 'gate'|'plan'|'requests'|'opus', ok: boolean, reason: string|null }>`
  - `activeRuns(state): Run[]`, `bandView(state): null | { color: 'green'|'red', running: number, red: number }`
  - `evalRecord(state, run): object` (the `.eval.json` content)
  Each `note*` returns the new state.

- [ ] **Step 1: Write failing tests** in `tests/eval.test.js`: a run whose gate record passed with matching fingerprint, whose spawns match stage labels and models, whose steps send the approved model and effort, and that never has more than 3 Opus running is green; each of these is red with its own reason: no gate record (`not approved by the gate`), fingerprint mismatch, a `deny` record, an unknown label, a model family mismatch, a step with another effort (`xhigh` approved, `high` sent), a 4th concurrent Opus; a spawn whose run has no launch creates a red run keyed by `runId`; `noteRunEnd` removes the run from `activeRuns` but `evalRecord` still has it with its status; `bandView` is `null` with no active run and `red` when any active run is red; `labelMatches('synth: research ${…}', 'synth: research legal') === true`, `labelMatches('synth: map', 'synth: map x') === false`.

- [ ] **Step 2: Run** `node --test tests/eval.test.js`. Expected: FAIL.

- [ ] **Step 3: Implement `src/eval.mjs`.**

- [ ] **Step 4: Run** `node --test tests/eval.test.js`. Expected: PASS.

- [ ] **Step 5: Implement `hooks/eval.tsx`** against `/tmp/claude-1000/bundled-skills/2.1.319/5a6239da8691e5f3b60b76ae82fa02f6/plugin-authoring/types/claude-code.d.ts` and the examples next to it (`band.tsx`, `pane.tsx`, `pane.test.tsx`, `tool-call.ts`), with the hooks the spec's "What it observes" lists. Keep the state in one `atom` declared in `types/index.d.ts`. Config dir: `$.env.get('CLAUDE_CONFIG_DIR')` trimmed, else `$.env.get('HOME')` (or `USERPROFILE`) + `/.claude`. Read the gate record lazily on the first spawn or launch result of a run; write the `.eval.json` on every change of that run. The band and pane follow the spec's "What it draws"; `/ultraguard` opens the pane. Every hook passes its event on with `next(e)` and never denies or rewrites.

- [ ] **Step 6: Write `hooks/eval.test.tsx`** with `claude-code/testing`: a `tool.call` on `Workflow` followed by a workflow `agent.spawn` with a gate record on disk draws a band whose text contains `ultraguard-eval`; without the record the run is red.

- [ ] **Step 7: Run** `claude plugin validate .` and `claude plugin test .` from the repo root. Expected: validation passes; tests pass.

### Task 4: guidance, docs, version

**Files:**
- Modify: `policy/guidance.md`, `README.md`, `CHANGELOG.md`, `package.json` (version), `.claude-plugin/marketplace.json` (ultraguard version)

- [ ] **Step 1:** `policy/guidance.md`: the class table with `investigate:` and the conditional pairs; hard rules for the 3-Opus cap and verdict schema; a Judgment line "Opus is for design, decisions, synthesis and complex reviews; investigation and the simpler agents of a big fan-out run on Sonnet"; the `slice(0, 3)` pattern and the batching loop as code; the verdict schema as code. Keep the whole SessionStart context (guidance plus rendered table) under 8,000 characters.
- [ ] **Step 2:** README: `FANOUT` in the deny code table; the new rules in "The policy in brief"; a "Records" section with both file paths and their fields; a "ultraguard-eval" section (band, pane, four checks, what red means, that it only shows running workflows, and that no button while a workflow runs means ultraguard is not loaded); replace "It keeps no state and writes no files" with the record behaviour and the fail-closed write.
- [ ] **Step 3:** CHANGELOG `## 0.4.7` entry; versions to `0.4.7`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, including `tests/version-sync.test.js` (after Task 3 bumps `plugin.json`).

### Task 5: integrate, review, live-verify, ship

- [ ] `npm test`, `claude plugin validate .`, `claude plugin test .` all pass.
- [ ] Adversarial review of the fan-out analysis, the mod against the API, and the gate record path; fix what survives.
- [ ] Live, with `--plugin-dir` and ultracode: compliant launch passes and writes its `.gate.json`; a 10-Opus fan-out is denied with `FANOUT`; the `slice(0, 3)` pattern passes; in an interactive session the band shows green for a compliant run, the pane drills down, and a run launched with the gate disabled in a test copy shows red.
- [ ] Commit, push `ultraguard`, open the PR to `main`, merge.
