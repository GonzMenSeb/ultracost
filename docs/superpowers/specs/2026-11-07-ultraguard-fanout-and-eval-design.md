# ultraguard 0.4.7: fan-out rules and ultraguard-eval

## Why

On 2026-11-07 a workflow launched 10 Opus agents at once: six web-research and four code-mapping agents, all labeled `synth:`. ultraguard 0.4.6 almost certainly passed it, because `synth:` allows Opus and the gate cannot tell research from synthesis. Nothing proved the gate had run at all: a passing gate prints nothing and writes nothing, so a pass and a bypass leave the same trace.

Two goals:

1. Opus is for design, decisions, synthesis and complex reviews. Investigation and the simpler agents of a big fan-out run on Sonnet. No more than 3 Opus agents run at once.
2. Know for a fact, while a workflow runs, whether ultraguard's rules were applied to it: a log on disk and a live indicator in the terminal.

Anti-goals: ultraguard must not spend tokens to save tokens. Everything here is plain code. There is no model call anywhere in ultraguard, and none is added (the user declined a Haiku label check).

## Part 1: policy

### Classes

| Class | Change | Allowed pairs (Opus session) |
|---|---|---|
| `investigate:` | **New.** Web research, code mapping, any reading that reports findings. | sonnet × {medium, high, xhigh} |
| `judge:` | Sonnet allowed for a single yes/no review (see verdict schema). Any other review stays Opus. | opus × {medium, high, xhigh}; sonnet × {medium, high, xhigh} only with a verdict schema |
| `decide:`, `synth:`, `design:` | May drop to Sonnet for the simpler agents of a big fan-out. `synth:` keeps research synthesis. | opus × {medium, high, xhigh}; sonnet × {medium, high, xhigh} only in a big fan-out |
| `build:`, `fix:`, `combine:`, `code:`, `grunt:` | Unchanged. | as in 0.4.6 |

`judge:`'s `owns` text drops "and any reading whose output feeds a verdict" (that reading is `investigate:`).

### Verdict schema (judge on Sonnet)

A `judge:` stage may run on Sonnet only when its inline `schema.properties` has exactly three keys, in any order:

- `pass`: an object literal whose `type` is the string `'boolean'`
- `evidence`: an object literal whose `type` is the string `'string'`
- `blocked_on`: exactly as today

Each of `pass` and `evidence` must be a literal tree (a `description` is allowed). `required` is not checked. Anything else (findings lists, scores, several verdicts) needs Opus. The rule applies everywhere, inside a fan-out too.

### Fan-out and the Opus cap

The gate computes, from the script alone, an upper bound on how many Opus agents can run at the same time. If the bound is above 3, or cannot be computed, every Opus stage that contributes is denied with the new code `FANOUT`.

It also marks each stage `inFanout` (the stage can run concurrently with other agents) and `bigFanout` (the fan-out construct around it can run more than 3 agents at once, all models counted, or its size is unknown). `decide:`, `synth:` and `design:` may use Sonnet only when `bigFanout` is true.

Semantics, as an abstract evaluation over the acorn AST. `conc(node)` is the most Opus agents running at once while `node` is evaluated to completion; `concAll` is the same counting every agent.

- `agent(p, o)`: 1 if its `model` is `'opus'`, else 0 (for `concAll`, 1).
- `await E`: `conc(E)`.
- Statement lists, `if`, `?:`, `&&`/`||`/`??`, `try`, loops (`for`, `for…of`, `for…in`, `while`, `do`): the max over their parts. Loop iterations are sequential.
- `parallel(A)` where `A` is an array literal of thunks: sum over elements of `conc(thunk body)`; a spread element `...X.map(cb)` counts as `size(X) × conc(body of the thunk cb returns)`.
- `parallel(X.map(cb))`, `parallel(X.flatMap(cb))`, `parallel(Array.from(X, cb))`: `size(X) × conc(body of the thunk cb returns)`. `cb` must be a function whose body is, or returns, a function expression (`x => () => …`, `x => async () => { … }`).
- `pipeline(X, s1, …, sn)`: `size(X) × max(conc(body of si))`.
- `Promise.allSettled(A)`: as `parallel`, but elements are promise expressions (calls), and a mapped `cb` returns the promise itself. `Promise.all`, `race` and `any` with more than one element and an Opus agent inside are unknown: they settle on the first rejection or result while the other agents keep running (review finding).
- A call to a local function (a function declaration, or a `const` bound to a function expression): `conc(body)`, inlined; recursion is unknown.
- `size(X)`: an array literal's length (spreads add their sizes); a `const` identifier bound to an array literal that is never the object of `push`, `unshift`, `splice` or a `length` assignment; `Array.from({ length: N })` with literal `N` (or a `const` bound to a numeric literal); `X.slice(a, b)` with literals as `max(0, b - a)`, clamped to `size(X)` when known; `X.slice(a)` as `size(X) - a`; `X.filter(…)` and `X.map(…)` as `size(X)`. Anything else, including `args`, is unknown.
- Escapes: an Opus-bearing call (an `agent()` or a local function that reaches one) whose promise is neither awaited, returned from the function it is in, nor an element of a recognised combinator makes the bound unknown. So does a function expression containing an Opus `agent()` that is used anywhere other than the positions above (pushed into an array, passed to an unknown function, assigned).

Also recognised, because the workflow guidance teaches them (builder call, all sound):

- `P.then(cb)`, `P.catch(cb)`, `P.finally(cb)`: `max(conc(P), conc(body of cb))`; the result is a promise consumed like `P` itself.
- `X.slice(e, e + K)` with a literal `K` and the same expression `e` on both sides: size `K` (clamped to `size(X)` when known). This counts the batching loop `for (let i = 0; i < items.length; i += 3) await parallel(items.slice(i, i + 3).map(…))` as 3.
- A local function passed by name where a callback or thunk is expected (`pipeline(files, review)`): its body, as if written inline.

Unknown is infinity. The cap only counts Opus, so a Sonnet fan-out of any shape stays allowed.

Opus work over a list whose size is only known at run time is written as the batching loop above, 3 at a time; the guidance teaches it.

The pattern the guidance teaches for "the 3 most complex on Opus, the rest on Sonnet":

```js
const ranked = [ /* most complex first */ ]
await parallel([
  ...ranked.slice(0, 3).map(t => () => agent(`…${t.key}`, { label: `design: ${t.key}`, model: 'opus', effort: 'high' })),
  ...ranked.slice(3).map(t => () => agent(`…${t.key}`, { label: `design: ${t.key}`, model: 'sonnet', effort: 'high', schema: { /* with blocked_on */ } })),
])
```

### Label word check (added after the vps-infrastructure run `whgu91mby`)

A run launched at 2026-11-08 03:55Z passed ultraguard 0.4.6 with 6 Opus agents, two of them investigation labeled `decide: ovh extra ip research` and `judge: migration readiness`. The rules above alone would pass it too (never more than 3 Opus at once). The user chose a deterministic word check over a model-based label check:

- A `decide:`, `judge:` or `design:` label whose name (after the prefix, with `${…}` removed) contains, as a whole word, research, investigate, map, explore, survey, scan, search, find, audit, inventory or readiness is denied with the new code `LABEL`, on any session model.
- `synth:` is checked only when the stage is in a fan-out, so a single `synth: research synthesis` passes (Opus synthesizes research).
- Configured as `labelCheck: { words, classes, fanoutClasses, use }` in `policy/default.json`.

### Policy file

`policy/default.json` gains, per class, optional `fanoutPairs` and `verdictPairs` (same shape as `pairs`), and a top-level `limits: { "maxConcurrentOpus": 3, "bigFanout": 3 }`. `loadPolicy` validates them like `pairs`. On an Opus session a stage's allowed pairs are `pairs`, plus `fanoutPairs` when it is in a big fan-out, plus `verdictPairs` when its schema is a verdict schema. The session cap works as today: on a Sonnet session, a class left with no pair after the cap runs on sonnet × all efforts (so a Sonnet session's `judge:` needs no verdict schema).

## Part 2: the gate's record (traceability)

The gate (classic `PreToolUse` hook, `hooks/gate.mjs`) writes one JSON file per decision, pass or deny, to `<configDir>/ultraguard/sessions/<session_id>/<tool_use_id>.gate.json`, where `<configDir>` is `CLAUDE_CONFIG_DIR` (trimmed) or `~/.claude`. One small file per launch keeps every file far below the mod's 4 MiB `$.fs` limit, and the mod reads exactly the file it needs. `session_id` and `tool_use_id` must match `^[A-Za-z0-9_-]{1,128}$`; otherwise the gate uses `unknown` for the directory or fails closed on a pass (it cannot write a record the mod can find). This replaces "keeps no state and writes no files".

```json
{"v":1,"kind":"gate","at":"<ISO>","session_id":"…","tool_use_id":"toolu_…","decision":"pass"|"deny",
 "fingerprint":"<sha256 hex of the resolved script source, or null>","scriptPath":"…"|null,
 "sessionModel":"opus"|"sonnet"|"haiku"|null,"maxOpus":3|null,
 "stages":[{"index":0,"line":12,"label":"synth: research ${…}","class":"synth","model":"opus","effort":"high","inFanout":true,"bigFanout":true,"verdict":false}],
 "errors":[{"code":"FANOUT","line":12,"message":"…"}]}
```

- `fingerprint` is SHA-256 over the UTF-8 source, computed by a pure-JS function in `src/fingerprint.mjs` so the mod computes the same value. A Node test checks it against `node:crypto`.
- If the write fails on a pass, the gate fails closed (exit 2, stderr names the path and error). On a deny the deny stands and the write error is ignored.
- Writes create the directory. Nothing is rotated or deleted.

## Part 3: ultraguard-eval (the mod)

The same plugin gains a hooks module. `hooks/hooks.json` keeps its `hooks` and adds `"modules": ["./eval.tsx"]` (verified on 2.1.319: both kinds load from one plugin, and a module can import the plugin's `.mjs` files). `plugin.json` gains `"types": "./types/index.d.ts"` for the module's `$.state` contract.

Pure logic lives in `src/eval.mjs` (no `$`, testable with `node --test`); `hooks/eval.tsx` is glue and drawing. The mod never denies or rewrites anything: it observes, judges, draws and logs.

### What it observes

- `tool.call` on `Workflow`: before `next(e)`, note the `tool_use_id` and the fingerprint of what is about to run (`input.script`, or the file at `input.scriptPath` read with `$.fs`). After `next(e)`: an errored result is a refused launch; otherwise read `taskId` and `runId` from the result's fields (the Workflow tool's result carries both).
- `agent.spawn` with `e.workflow`: the agent's run (`e.tool_use_id`, else `e.workflow.runId`), its label (`e.description`), the model it asked for (`e.model`) and, after `next(e)`, the model it resolved to and its `agentId`. Spawns can arrive before the `tool.call` hook's `next` settles; the gate's record is already on disk by then, because the gate runs before the tool.
- `turn.step` with an `agentId` of a known workflow agent: the model and effort each request actually sends.
- `turn.complete` with such an `agentId`: the agent finished.
- `session.append` rows carrying a `<task-notification>` whose `<tool-use-id>` is a known launch and whose `<status>` is `completed`, `failed` or `killed`: the run ended. Also hook the queue door so the end is seen when the notification is queued, not only when it is delivered.
- Workflows still being designed are not shown: nothing reliably marks when drafting starts or ends (Claude often drafts without loading the authoring skill), so the user dropped that idea. A refused launch is not a run and is not shown either; it is in the gate's log.

### The four checks (deterministic)

A run is **green** only while all four hold; otherwise **red**, naming the first failure:

1. **Approved by the gate**: a `pass` record exists for the launch's `tool_use_id`, and its `fingerprint` equals the one the mod computed.
2. **Every agent matches the plan**: its label matches an approved stage's label (each `${…}` matches any text) and its resolved model's family (`opus`/`sonnet`/`haiku` in the id) equals that stage's model.
3. **Every request as approved**: each `turn.step` of the agent sends that model family and exactly the approved effort. Effort lowered by Claude Code itself (Haiku `xhigh` sent as `high`) counts as a failure.
4. **At most 3 Opus at once**: running Opus agents in the run never exceed `limits.maxConcurrentOpus`.

A spawn for a run with no known launch is red with "not approved by the gate".

### What it draws

- **Band** (`ui.render` on `AbovePrompt`): shown only while at least one workflow run is active; it yields to a survey. One `Button`: a square and the bold title `ultraguard-eval`, followed by a dim summary (`2 running · 1 red`). The square is red if any active run is red, else green.
- **Pane** (`$.ui.open({ id: 'ultraguard', title: 'ultraguard-eval' })`), opened by the button or `/ultraguard`:
  - Level 2: a flat list, one row per active run: square, workflow summary, short run id, Opus and Sonnet counts, and `as approved` or the first failure. All rows at the same indentation; the selected row is highlighted.
  - Level 3 (enter on a row): the four checks with ✓/✗, then one row per agent: square, label, approved model · effort, ran on model · effort, and the reason when red. Esc goes back, then closes.
- Colors: green and red; secondary text dim.
- When a run ends it leaves the band and the list.

### What it logs

`<configDir>/ultraguard/sessions/<session_id>/<tool_use_id>.eval.json`, one file per run, rewritten whole on every change (`$.fs.write` has no append): the run's checks, failures, agents and end status. Next to the gate's `.gate.json` for the same launch, this is the trace. A run seen with no known launch is written under its run id (`<runId>.eval.json`).

## Part 4: guidance, docs, version

- `policy/guidance.md`: the new classes, the verdict schema with an example, the 3-Opus cap and the `slice` pattern, "Opus is for design, decisions, synthesis and complex reviews; investigation runs on Sonnet".
- README: new deny code `FANOUT`, the record files, ultraguard-eval, updated limits ("writes files").
- CHANGELOG entry, version `0.4.7` in `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`.
- `.gitignore`: `.superpowers/`.

## Tests and verification

- `node --test` (Node 18): fan-out bounds for every construct above and the unknown cases; verdict schema accept/reject; the new classes and pair sets; policy validation of the new keys; the gate record (pass, deny, write failure on pass blocks); fingerprint against `node:crypto`; `src/eval.mjs` checks for green, each red cause, run end.
- `claude plugin validate .` and `claude plugin test .` for the module.
- The existing good fixtures `tests/fixtures/good/parallel.js` (4 Opus judges at once) and `pipeline.js` (an Opus judge over a list of unknown size) become `FANOUT` denies; rewrite them to stay good and add the old shapes as bad fixtures.
- Live, per CLAUDE.md: load the working copy with `--plugin-dir`, ultracode on, and confirm with prompts: a compliant launch passes and logs; a 10-Opus fan-out is denied with `FANOUT`; a `slice(0, 3)` Opus + Sonnet fan-out passes; the band and pane show green for a compliant run and red for a run with no gate record (gate disabled in a test copy).

## Calls made without the user (check these)

- `judge:` on Opus keeps any schema, including yes/no ones (the user said Sonnet *can* do yes/no reviews).
- The 3-Opus cap is per workflow run, statically over the whole script, and at runtime per run.
- The band's square is red if any active run is red.
- Gate fails closed when it cannot write a pass record.
- Ended runs vanish from the band and pane but stay in the log.
- Log files are one per launch under a per-session folder, never rotated (builder-check finding: `$.fs` refuses files over 4 MiB).
