# ultraguard reference

This is the complete reference for ultraguard 0.4.20. The [README](../README.md) explains what ultraguard is for and why the rules exist. This page lists every rule, code, file and limit, and it is written to match the code in `src/`, `hooks/` and `policy/`.

## Contents

1. [Prerequisites and install](#prerequisites-and-install)
2. [How a launch is checked](#how-a-launch-is-checked)
   - [Commit reminder](#commit-reminder)
3. [Policy](#policy)
   - [Classes](#classes)
   - [Models and efforts](#models-and-efforts)
   - [Sonnet exceptions for Opus classes](#sonnet-exceptions-for-opus-classes)
   - [Haiku evidence](#haiku-evidence)
   - [Label check](#label-check)
   - [Script shape](#script-shape)
   - [The policy file](#the-policy-file)
4. [Fan-out and the Opus cap](#fan-out-and-the-opus-cap)
5. [Session cap](#session-cap)
6. [Deny codes](#deny-codes)
   - [How a deny reason is built](#how-a-deny-reason-is-built)
   - [How a long reason is shortened](#how-a-long-reason-is-shortened)
   - [Launch by name](#launch-by-name)
   - [Child workflows](#child-workflows)
7. [Records](#records)
   - [Gate record](#gate-record)
   - [Eval record](#eval-record)
8. [ultraguard-eval](#ultraguard-eval)
9. [Savings](#savings)
   - [The estimator](#the-estimator)
   - [Where ratios come from](#where-ratios-come-from)
   - [Margin of error](#margin-of-error)
   - [Data files and calibration](#data-files-and-calibration)
   - [Dollars](#dollars)
   - [Limit percentages](#limit-percentages)
   - [What the pane shows](#what-the-pane-shows)
   - [Calibration results](#calibration-results)
   - [Savings limits](#savings-limits)
10. [Environment checks](#environment-checks)
11. [Scope and limits](#scope-and-limits)
12. [Threat model](#threat-model)
13. [Failure behavior](#failure-behavior)
14. [Changing the policy](#changing-the-policy)
15. [Development](#development)

## Prerequisites and install

- Claude Code 2.1.295 or later. The `onFailure` hook field needs it. The hook input shapes are pinned to Claude Code 2.1.319, and so is the ultraguard-eval module, which needs a Claude Code with hooks modules.
- Node 18 or later on `PATH`. Hooks run with whatever `node` is found there.
- If `permissions.defaultMode` is `dontAsk`, add a `Workflow` entry to `permissions.allow`. The gate never returns `allow`. On a clean script it returns no decision, and your permission rules decide. Without the rule, `dontAsk` refuses every launch.

The SessionStart hook checks for the `dontAsk` case. It reads `settings.json` in the config directory (`CLAUDE_CONFIG_DIR` or `~/.claude`), then `.claude/settings.json` and `.claude/settings.local.json` in the session's working directory. If the last `permissions.defaultMode` it finds is `dontAsk` and no `permissions.allow` entry is `Workflow`, `Workflow()` or `Workflow(*)`, it shows a warning. The warning says to ignore it when you start Claude Code in another permission mode, such as `bypassPermissions`.

Install from the marketplace:

```
/plugin marketplace add GonzMenSeb/ultraguard
/plugin install ultraguard@ultraguard
```

Install from a local copy:

```
claude --plugin-dir <path-to-this-repo>
```

Kill switch: `/plugin disable ultraguard`, or set `disableAllHooks`. Both are visible settings changes.

## How a launch is checked

ultraguard has three hooks and one hooks module. The plugin makes no model call anywhere.

| Part | File | When it runs | What it does |
|---|---|---|---|
| SessionStart hook | `hooks/session.mjs` | on `startup`, `resume`, `clear` and `compact` | Adds `policy/guidance.md` and a table of allowed pairs per class (rendered from `policy/default.json`) to the session context, clamped to 9,000 characters and 200 lines. Shows a `systemMessage` warning if the `dontAsk` rule is missing, if the guidance cannot be read, or if the policy fails to load. |
| PreToolUse hook (the gate) | `hooks/gate.mjs` | before every `Workflow` tool call, 15 second timeout, `onFailure: "block"` | Resolves the script, parses it, applies the rules, writes a gate record, and denies the launch or stays silent. |
| PostToolUse hook (commit reminder) | `hooks/commit.mjs` | after every successful `Bash` call | Stays silent unless the command was a `git commit` in a session whose gate records show a passed launch with a Haiku `code:` stage. Then it adds a reminder to Claude's context. It never blocks. See [Commit reminder](#commit-reminder). |
| ultraguard-eval module | `hooks/eval.tsx` | while workflows run | Observes only. Judges each running workflow against the gate record. See [ultraguard-eval](#ultraguard-eval). |

The gate collects problems from these stages and denies if the list is not empty. It reports all of them together, not only the first.

1. Environment (`ENV`): model and effort overrides in the environment.
2. Source (`SOURCE`): exactly one of `script` or `scriptPath`, and no `name`.
3. Parse and shape (`PARSE`, `SHAPE`, `SOURCE` for `workflow`): the script is parsed with the vendored acorn, and every `agent()` call is read for its label, model, effort and schema.
4. Rules (`PAIR`, `LABEL`): each stage's class, model and effort are checked against the allowed pairs for the session model, and the label word check runs.
5. Fan-out (`FANOUT`): the Opus concurrency bound. It runs only when the session model is Opus.

A clean script produces no output and exit code 0, plus a gate record on disk.

### Commit reminder

Haiku stages are the only ones that left scratch files in the repo in the replays, so ultraguard checks after a commit. The PostToolUse hook runs after a successful `Bash` call. It does nothing unless the command was a `git commit` and the session's gate records (`*.gate.json`, see [Records](#records)) include a launch that passed with a `code:` stage on `haiku`. Then it adds this to Claude's context:

```
ultraguard: this session ran Haiku code: stages, which can leave scratch files. Check the commit's file list (git show --stat HEAD) and git status for files no stage meant to change, and remove them in a follow-up commit.
```

The hook only adds context. It never denies, blocks or changes the command, and a missing or unreadable record means no reminder.

## Policy

The policy is in `policy/default.json`, and it is the only policy. The guidance Claude reads at session start is `policy/guidance.md`. It says it supersedes the built-in Workflow guidance that says to omit `model`, omit effort and use `low` for cheap mechanical stages.

### Classes

Every `agent()` label starts with a class prefix such as `build:`. The class says who owns the decision, and it decides which (model, effort) pairs are allowed. The table shows the pairs on an Opus session. Every listed model allows the efforts `medium`, `high` and `xhigh`.

| Class | Owns | Opus session allows |
|---|---|---|
| `investigate:` | Web research, code mapping, and any reading where the agent decides what the evidence means | `sonnet` |
| `decide:` | Open decisions: any choice, approach, software design, design of complex functionality, taste, diagnosing unclear or cross-cutting bugs | `opus`; `sonnet` only in a big fan-out |
| `judge:` | Adversarial review, verification and verdicts | `opus`; `sonnet` only with the verdict schema |
| `synth:` | Synthesizing complex, distributed, multi-faceted or conflicting work | `opus`; `sonnet` only in a big fan-out |
| `design:` | Visual and UI design | `opus`; `sonnet` only in a big fan-out |
| `build:` | Decided implementation that leaves details open: modules or ports from a plan or prototype, scoped UI implementation, "like this" examples, long build-test-debug loops | `sonnet` or `opus` |
| `fix:` | Fixes whose cause or repro is known; a fix spelled out file by file is `code:` | `sonnet` or `opus` |
| `combine:` | Merging groundwork toward one stated goal | `sonnet` or `opus` |
| `code:` | Fully specified implementation: the prompt names the files, the functions or interfaces and the test commands, and leaves nothing to decide; blind, well-specified UI implementation | `haiku` (`medium`) or `sonnet` |
| `grunt:` | Fixed-shape, zero-decision work: tabulate, count or extract named fields from named inputs, run a given command, checks, summaries, compaction | `haiku` (`medium`, `high`) or `sonnet` |

The Opus classes are `decide:`, `judge:`, `synth:` and `design:`. Opus is for design, decisions, synthesis and complex reviews. Haiku is for work where the prompt leaves nothing to decide. For `grunt:` that is fixed-shape work where two agents would produce the same output and a script can check the result: the spec names the inputs, the output fields and how to compute them. For `code:` it is implementation where the prompt names the files, the functions or interfaces and the test commands. Work that picks names, ownership rules or how stored state stays stable is `build:`, on Sonnet. Haiku is allowed at `xhigh` in no class. Discovery, open-ended review, multi-source web extraction and anything that weighs evidence stay on `investigate:` or above. See [Haiku evidence](#haiku-evidence).

A label that does not start with a known class prefix is denied (`PAIR`, "Unknown class") with the list of valid classes. A label with no usable prefix at all is denied as `SHAPE`.

### Models and efforts

- Models are the aliases `opus`, `sonnet` and `haiku` only. Full ids, Fable and Mythos are denied (`PAIR`).
- Efforts are `medium`, `high` or `xhigh`. `low` and `max` are denied (`PAIR`).
- `haiku` is allowed at the efforts a class lists for it (`medium` for `code:`, `medium` and `high` for `grunt:`; `xhigh` for no class), and on an Opus or Sonnet session only for classes whose pairs list it. A class that lists `haiku` must also list `sonnet`. Under the Haiku session cap, a class without its own Haiku pair also gets Haiku at every effort any class lists for it; see [Session cap](#session-cap).
- Every `agent()` names both a model and an effort, as quoted string literals.
- Every Sonnet and Haiku stage needs an inline `schema` with a `blocked_on` property, so the agent reports an open question instead of deciding it. This applies to any stage whose literal model is not `opus`, including the Opus classes when they run on Sonnet. See [Script shape](#script-shape).
- No stage may use a model above the session model. See [Session cap](#session-cap).

### Sonnet exceptions for Opus classes

Two conditions open Sonnet pairs for the Opus classes on an Opus session. Both come from the policy file keys `fanoutPairs` and `verdictPairs`.

**Big fan-out.** `decide:`, `synth:` and `design:` may run on Sonnet for the simpler agents of a big fan-out. A stage is in a big fan-out when the construct around it can run more than 3 agents at once, counting all models, or when the size of that construct is unknown. The limit is `limits.bigFanout`. A stage outside any fan-out, or inside a fan-out of 3 or fewer agents, may not use these Sonnet pairs.

**Verdict schema.** `judge:` may run on Sonnet for one yes/no review. Its inline `schema.properties` must have exactly three keys, in any order.

| Key | Required shape |
|---|---|
| `pass` | an object literal whose `type` is the string `'boolean'` |
| `evidence` | an object literal whose `type` is the string `'string'` |
| `blocked_on` | exactly the shape in [Script shape](#script-shape) |

`pass` and `evidence` must be literal trees (a `description` is allowed). `required` is not checked. Findings lists, scores and several verdicts need Opus. The rule applies inside a fan-out too. A `judge:` on Opus keeps any schema.

```js
schema: {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    evidence: { type: 'string' },
    blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
  },
  required: ['pass', 'evidence', 'blocked_on']
}
```

When a stage misses one of these conditions, the `PAIR` message says which condition would allow Sonnet for that class.

### Haiku evidence

The Haiku pairs for `code:` and `grunt:` come from two replays on Haiku 5.5. The first replayed the 10 latest real workflows on fixed-shape tasks. The answers were computed by script from the same inputs, then compared with each agent's output.

| Test | Haiku `xhigh` | Haiku `medium` | Sonnet `high` |
|---|---|---|---|
| 5 fixed-shape tasks (tabulate, extract, catalogue, check), 3 runs each, exact match | 15/15 | 15/15 | 15/15 |
| Mean cost per run | $0.015 | $0.008 | $0.092 |
| Verifier, 3 true findings | 9/9 | 6/6 | 9/9 |
| Verifier, 5 plainly false findings, 3 runs each | 15/15 | 15/15 | 15/15 |
| Verifier, 3 findings with the right place but wrong details | 3/9 strict-correct | not run | 9/9 |

On the last row Haiku passed the finding by correcting the wrong details itself instead of failing it. That is why `judge:` has no Haiku pair.

What the first replay does not show:

- Each cell is 3 runs, so a ceiling of 100% says little about rare failures.
- The specs named inputs, fields and the way to compute them. Open-ended work was not replayed and should not be expected to match.
- The agents read snapshots of the inputs, not live tools. Production-host probes, gate runs and web extraction were not replayed.
- The `medium` arm ran through the Agent tool, not through the gate.

The second replay re-ran 14 past Sonnet coding tasks on Haiku. It decided how `code:` is scoped and removed Haiku `xhigh`.

| Finding | Result |
|---|---|
| Prompts that left nothing to decide | Haiku `medium` failed 1 of 33 runs. Sonnet failed 0 of 22. Haiku cost 0.05 to 0.9 times Sonnet's cost. |
| Prompts that left names, ownership or state rules open | Haiku `medium` failed 5 of 8 runs. Sonnet failed 2 of 6. |
| Haiku `xhigh` against Sonnet | $0.675 per acceptable run against $0.580, with no gain in quality. |
| Scratch files left in the repo | Only Haiku did. See [Commit reminder](#commit-reminder). |
| `blocked_on` set | Haiku set it in 16 of 55 runs. Every one of those runs had finished its work. |

So `code:` is Haiku `medium` only and is limited to fully specified implementation. Work that leaves names, ownership or state rules open is `build:`. The 14 tasks are a small sample, and the replays ran through the Agent tool, not through the gate.

### Label check

A `decide:`, `judge:` or `design:` label whose name contains any of these words is denied with `LABEL`, on any session model:

`research`, `investigate`, `map`, `explore`, `survey`, `scan`, `search`, `find`, `audit`, `inventory`, `readiness`

The same applies to a `synth:` label, but only when the stage is inside a fan-out. A single `synth:` stage that names its research input, such as `synth: research synthesis`, is allowed, because Opus synthesizing research is the intended use.

How the check reads a label:

- It takes the text after the first `:`, replaces each `${…}` with a space, lowercases it, and splits it on anything that is not a letter.
- Words match as whole words. `finding` does not match `find`, and `mapping` does not match `map`.
- The message names the word it found and tells Claude to run that work as `investigate:` on Sonnet and to name a kept Opus stage by the decision, review, synthesis or design it owns. When `labelCheck.fixed` is set it adds that a fixed list, table or count over named inputs is `grunt:`, with that class's pairs.

The word list, the checked classes and the class to move to live in `labelCheck` in `policy/default.json`.

### Script shape

The gate reads the script text without running it. For that to be reliable, scripts must keep `agent()` calls in a plain, literal shape. Anything the gate cannot read is denied as `SHAPE` (or `SOURCE` for `workflow`).

- Call `agent` directly with exactly two arguments: a prompt and an object literal of options. No spread in the arguments or in the options.
- Never use `agent` as a value (`.map(agent)`, `const run = agent`, `agent?.()`, `new agent()`, a tagged template) and never name anything else `agent` (variable, parameter, function, class or destructuring target).
- `model` and `effort` are each defined once, as quoted string literals. A template literal, variable or expression does not pass.
- `label` is defined once, as a string or template literal whose literal text at the very start is the class prefix, which is lowercase letters and a colon, such as `'build: parser'` or `` `grunt: ${name}` ``. The label must be written in the `agent()` call itself. A variable or helper parameter cannot pass. Each `${…}` in a template is recorded as the text `${…}`.
- `agentType` is not allowed.
- `globalThis`, `eval`, `Function` and `this` are not allowed anywhere in the script.
- The name `workflow` must not appear anywhere (see [Child workflows](#child-workflows)).
- Every Sonnet and Haiku stage carries an inline `schema` object literal. Its inline `properties` object includes `blocked_on` in exactly this form, with no shared schema const, no spread and no computed keys in `schema` or `properties`:

```js
blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
```

  `blocked_on` must be a literal tree. Its `type` must be the array literal `['string', 'null']` and its `description` a non-empty quoted string. `properties` must not define a key twice. Other properties are free.

If a stage with a missing or unreadable model has an inline schema object whose `blocked_on` is not valid, the message starts with "If this stage runs on sonnet or haiku", because the gate cannot tell where the stage will run. A shared schema const on such a stage gets its own message, without that prefix.

If `blocked_on` is set in a stage's result, the guidance tells the orchestrating session to settle it. It is never the user's to answer and never a new `decide:` stage. A step the task defers goes in the final summary. A question the stage needed answered is decided by the session, and the stage is relaunched once with the answer. A contradiction the stage worked past is checked by the session, which accepts the result or relaunches with the fix.

### The policy file

`policy/default.json` has three kinds of keys.

| Key | Content |
|---|---|
| `classes` | One entry per class. `owns` is text for the guidance table. `pairs` maps a model to a list of efforts. Optional `fanoutPairs` and `verdictPairs` have the same shape and add pairs under the two conditions above. |
| `limits` | `maxConcurrentOpus` (3) and `bigFanout` (3). Positive integers. Missing keys default to 3. |
| `labelCheck` | `words` (lowercase letters only), `classes` (checked everywhere), `fanoutClasses` (checked only inside a fan-out), `use` (the class that investigation moves to), `fixed` (optional: the class the message names for a fixed list, table or count over named inputs). |

`loadPolicy` validates the file. Models must be `haiku`, `sonnet` or `opus`. Efforts must be `medium`, `high` or `xhigh`, with no duplicates and no empty lists. `limits` accepts only the two known keys. A class that lists `haiku` in `pairs` must also list `sonnet`, because on a Sonnet session the pairs above the session model are dropped and a Haiku-only class would be left with no pair. Every class named in `labelCheck` must exist. A policy that fails validation is an internal error and blocks every launch.

On an Opus session, a stage's allowed pairs are its class's `pairs`, plus `fanoutPairs` if the stage is in a big fan-out, plus `verdictPairs` if its schema is a verdict schema. On other sessions, see [Session cap](#session-cap).

## Fan-out and the Opus cap

At most 3 Opus agents may run at once in a workflow (`limits.maxConcurrentOpus`). The gate cannot watch the run, so it computes an upper bound from the script text alone. If the bound is above 3, or cannot be computed, every Opus stage involved is denied with `FANOUT`. Sonnet and Haiku fan-outs of any size are allowed, because only Opus agents are counted.

A stage counts as Opus unless its `model` is the literal `'sonnet'` or `'haiku'`. A stage with a missing or unreadable model counts as Opus. `FANOUT` is checked only when the session model is Opus. On a Sonnet or Haiku session, Opus stages are already denied by the session cap.

### How the gate counts

The gate evaluates the script abstractly. Loop iterations and awaited calls run one at a time, so a construct is only concurrent when it starts several agents before waiting for any of them. For each construct it computes the most Opus agents that can run at once, and separately the most agents of any model.

| Construct | Counted as |
|---|---|
| `agent(p, o)` | 1 if its model is Opus, else 0 |
| `await E` | whatever `E` counts |
| statement lists, `if`, `?:`, `&&`, `||`, `??`, `try` | the maximum over their parts |
| loops (`for`, `for…of`, `for…in`, `while`, `do`) | the maximum over one iteration, since iterations are sequential |
| `parallel([...])` over an array literal of thunks | the sum over the elements |
| a spread `...X.map(cb)` inside that array | `size(X)` times what the thunk `cb` returns counts |
| `parallel(X.map(cb))`, `parallel(X.flatMap(cb))`, `parallel(Array.from(X, cb))` | `size(X)` times what the thunk `cb` returns counts. `cb` must be a function whose body is or returns a function expression, such as `x => () => ...` |
| `pipeline(X, s1, ..., sn)` | `size(X)` times the most any stage `si` counts |
| `Promise.allSettled([...])` | like `parallel`, but the elements are promise expressions and a mapped `cb` returns the promise itself |
| `Promise.all`, `Promise.race`, `Promise.any` with more than one element | unknown, if an Opus agent is inside. The other agents keep running after the first one settles or fails |
| `P.then(cb)`, `P.catch(cb)`, `P.finally(cb)` | the maximum of `P` and the body of `cb`. The result is a promise consumed like `P` |
| a call to a local function (a declaration, or a `const` bound to a function expression) | what its body counts, inlined. Recursion is unknown. A generator function containing an Opus agent is unknown |
| a local function passed by name where a callback or thunk is expected, such as `pipeline(files, review)` | its body, as if written inline |

`parallel` and `pipeline` count only when they are the unshadowed global names. A `Promise.all` over a one-element array is counted normally.

### Sizes the gate can read

`size(X)` is known for:

- an array literal, including spreads of other known sizes
- a `const` identifier bound to an array literal that is used only in read-only ways: indexing, `.length`, read-only array methods with an inline callback or a known local function, spread, `for…of`, `Array.from` or `pipeline`. Any other use, including passing it to a function or calling a mutating method, makes the size unknown
- `Array.from({ length: N })`, with `N` a literal or a `const` bound to a numeric literal
- `X.slice(a, b)` with literal `a` and `b`, as `max(0, b - a)`, clamped to `size(X) - a` when `size(X)` is known
- `X.slice(a)` with a literal `a`, as `size(X) - a`
- `X.slice(e, e + K)` with a literal `K` and the same expression `e` on both sides, as `K` clamped to `size(X)` when known. `e` must be a number the gate can trace, such as a `let` or `const` loop counter; a `var` counter is not counted. This is how the batching loop below counts as 3
- `X.map(...)` and `X.filter(...)`, as `size(X)`

Anything else is unknown, including `args`. Unknown counts as infinity.

### What makes the bound unknown

- A size that is not readable, as above, when an Opus agent is in the body.
- An Opus-bearing call (an `agent()`, or a local function that reaches one) whose promise is neither awaited, returned from its function, nor an element of a recognised combinator.
- A function expression containing an Opus `agent()` that is used anywhere other than the positions above: pushed into an array, passed to an unknown function, assigned.
- `Promise.all`, `race` or `any` over more than one element with an Opus agent inside.
- Recursion.
- A script the gate cannot analyse. Every Opus stage is then denied.

The deny message says which case applied.

### Fan-out flags in the record

For each stage the gate also records `inFanout` (the stage can run concurrently with other agents) and `bigFanout` (the construct around it can run more than `limits.bigFanout` agents at once, all models counted, or its size is unknown). `bigFanout` is what opens the Sonnet pairs of `decide:`, `synth:` and `design:`.

### Patterns the gate accepts

Keep the 3 most complex on Opus and send the rest to Sonnet:

```js
await parallel([
  ...ranked.slice(0, 3).map(t => () => agent(`...${t.key}`, { label: `design: ${t.key}`, model: 'opus', effort: 'high' })),
  ...ranked.slice(3).map(t => () => agent(`...${t.key}`, { label: `design: ${t.key}`, model: 'sonnet', effort: 'high', schema: { /* with blocked_on */ } }))
])
```

Run Opus work over a list of unknown size, 3 at a time:

```js
for (let i = 0; i < items.length; i += 3)
  await parallel(items.slice(i, i + 3).map(x => () => agent(`...${x}`, { label: `decide: ${x}`, model: 'opus', effort: 'high' })))
```

## Session cap

No stage may use a model above the main session's model, ranked haiku < sonnet < opus. A Fable session counts as Opus.

### How the gate reads the session model

The gate reads the transcript at `transcript_path` from the end backwards, in 64 KiB chunks, looking only at main-thread rows (not sidechain, no `agentId`). Torn or unparsable lines are skipped, and the gate uses the last readable main-thread row.

1. If a main-thread `api-request` row was written after the last main-thread assistant row, its `params.model` is the session model. Claude Code writes that row when each request is built, so it names the model of the request in flight, including right after `/model`. A row counts if its `querySource` starts with `repl_main_thread` or is `sdk`.
2. Otherwise the gate uses the last main-thread assistant row, which is normally the previous response.
3. If a `/model` command comes after that assistant row, the gate uses the lower of the row's model and the command's model. A command counts only if its output row starts with "Set model to", so a failed or declined `/model` is ignored. The last such command wins. `opusplan` and `opusplan[1m]` map to Sonnet. A command that cannot be mapped, such as `default`, makes the model unreadable.
4. If the assistant row is `<synthetic>`, has an ambiguous model name or is absent, a `/model` command can only lower the result. The command's model is used if it is Haiku. Any other command model leaves the session model unreadable.

A model name maps to a tier when it contains exactly one of `opus`, `sonnet`, `haiku` or `fable`, ignoring case, and `fable` maps to Opus. A name with none of them (Mythos, for example) or with more than one is unreadable.

`api-request` rows depend on the flag `tengu_elegant_meadow` (env `CLAUDE_CODE_ELEGANT_MEADOW`, default true). Without them, the gate relies on steps 2 to 4.

An unreadable session model counts as Sonnet. That covers an empty or missing `transcript_path`, a transcript that cannot be opened, a diskless or remote session, and a `<synthetic>` row or ambiguous model name with no `api-request` row and no Haiku `/model` command. The model name Claude Code reports after a server-side refusal fallback is unverified.

### What the cap changes

| Session | Effect |
|---|---|
| Opus | The policy table applies as written. |
| Sonnet | Opus pairs are denied. A class left with no pair after that runs on `sonnet` at all three efforts, so `decide:`, `judge:`, `synth:` and `design:` run on Sonnet with no verdict schema or fan-out needed. `build:`, `fix:` and `combine:` run on Sonnet. `code:` and `grunt:` keep their Haiku and Sonnet pairs. `FANOUT` is not checked, because it counts only Opus agents. |
| Haiku | Only Haiku pairs are allowed. A class without its own Haiku pair uses `haiku` at every effort that any class lists for it (`medium` and `high`), as long as the policy lists a Haiku pair anywhere. If the policy lists none, every launch that has an `agent()` call is denied with one `PAIR` line that only the user can clear: "This session runs Haiku and no Haiku pair is allowed; switch with /model sonnet or /model opus." `FANOUT` is not checked. |

A `model` above the session model is denied as `PAIR`: `model "opus" is above the session model (sonnet).` The reason also says what the session runs, and when the model could not be read it says it is treated as Sonnet.

A rejected model gives way to the next lower one the class allows. When a stage names a model its class does not allow, the `PAIR` message adds `Relaunch on <model> with effort "<effort>".` before the allowed list. The model is the highest lower model in the class's effective pairs for the session. The effort is `xhigh` if that model lists `xhigh`, otherwise its highest listed effort, ordered `medium`, `high`, `xhigh`. It adds nothing when the model is allowed but the effort is not, or when no lower model is allowed. The guidance injected at session start says the same.

| Session | Stage | Message |
|---|---|---|
| Sonnet | `judge:`, `investigate:` or `code:` on `opus` | `Relaunch on sonnet with effort "xhigh".` |
| Haiku | `code:` on `sonnet` | `Relaunch on haiku with effort "medium".` |
| Haiku | `decide:` on `opus` | `Relaunch on haiku with effort "high".` |

On a Haiku session `decide:` has no Haiku pair of its own, so its effective pairs are the Haiku pairs any class lists, `medium` and `high`.

## Deny codes

| Code | Means |
|---|---|
| `SOURCE` | The script cannot be resolved or seen: no source, mixed sources, launch by name, `workflow` referenced, a source that is not a string, or a `scriptPath` that cannot be read. |
| `PARSE` | Parse error. The message is the parser's, with the line. |
| `SHAPE` | Misused `agent`, `globalThis`, `eval`, `Function` or `this`. Bad `agent()` arguments, options, literals, label, `agentType`, `schema` or `blocked_on`. |
| `PAIR` | Unknown class, model not allowed, effort `low`, `max` or not allowed for the class, `haiku` at an effort no class lists for it, model above the session model, or no pair allowed for the class on this session. |
| `LABEL` | An Opus-class label reads like investigation (see [Label check](#label-check)). |
| `FANOUT` | More than 3 Opus agents can run at once, or the gate cannot count them: unknown list size, `args`, an agent promise that is never awaited, an agent pushed into an array, recursion. |
| `ENV` | A runtime env value overrides the pinned model or effort. See [Environment checks](#environment-checks). |

Example, for a script that fans out four Opus judges over a list of four files:

```
ultraguard blocked this Workflow launch (1 problem). Fix and relaunch:
review.js:2 FANOUT [judge: ${…}] Up to 4 opus agents can run at once here; the limit is 3. Keep at most the 3 most complex on opus and run the rest on sonnet (items.slice(0, 3) on opus, items.slice(3) on sonnet), or batch them: for (let i = 0; i < items.length; i += 3) await parallel(items.slice(i, i + 3).map(...)).
judge: opus × {medium, high, xhigh}
Put exactly this in schema.properties of the inline schema object literal in each sonnet and haiku agent() call (a shared schema const is not accepted): blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
If this is your second deny for the same workflow, stop and ask the user.
```

### How a deny reason is built

The reason is addressed to Claude, so it gives what Claude needs to fix the script on the next try.

- **Header.** `ultraguard blocked this Workflow launch (N problems)`, then `Fix and relaunch:`. If any problem is an `ENV` line or the Haiku session line, which only the user can clear, the header says so. When every problem is of that kind it says "Only the user can clear this; tell them and do not relaunch until they have:". When the problems are mixed it says to fix the script problems, and that the `ENV` lines and the Haiku session line need the user.
- **One line per failing stage.** `file:line CODE [label] message`. A stage with several problems gets one line with the codes joined by `+`, such as `LABEL+FANOUT`. A label longer than 50 characters is clipped. A stage whose `FANOUT` message repeats an earlier one says `Same as line N.` Problems that belong to no stage (`ENV`, `SOURCE`, `PARSE`, script-wide `SHAPE`) get their own lines. `file` is the `scriptPath`, or `script` for an inline script, and it keeps only its last 200 characters if longer.
- **Allowed pairs.** One line for each failed class, such as `judge: opus × {medium, high, xhigh}`, listing the pairs for the session model. Classes with identical pairs share a line. The per-message `Allowed: ...` and `Valid classes: ...` tails are removed, because these lines or the table carry them.
- **Table of all classes.** Used instead of the per-class lines when the script could not be read (no source, parse error), when a `SHAPE` problem belongs to no stage, or when a stage has a class that is not in the policy. It groups the classes by identical pairs.
- **The `blocked_on` line.** The exact text for `schema.properties.blocked_on`. It is added when the script could not be read, or when fixing a problem may move a stage to Sonnet or Haiku and the stage has no valid `blocked_on` schema yet.
- **The shape line.** A reminder of the `agent()` shape (two arguments, quoted literals, class prefix, no `agentType`, inline schema). It is added when the script could not be read or a `SHAPE` problem belongs to no stage.
- **The session note.** "This session runs opus; no stage may use a model above it", or, when the model could not be read, that it is treated as Sonnet. It is added only when the cap changes what is allowed.
- **The closing line.** "If this is your second deny for the same workflow, stop and ask the user." Always last.

### How a long reason is shortened

The reason stays within 2,000 characters and 20 lines. The gate builds the most detailed form first and uses the first one that fits.

1. One line per stage, with the file name at the start of each line.
2. One line per stage, with the file name moved to the header and each line starting with `:line`.
3. Identical problems merged across stages into one line with no stage label, listing every line number or range. First with the file name on each line, then with it in the header.
4. The merged problems, each clipped to 280 characters. If they do not all fit, the gate keeps as many of the first ones as fit and adds `…and N more at lines X (CODES)`.
5. One merged problem with no allowed-pairs lines. If it still does not fit, the extra guidance lines are dropped, and as a last resort only the header and the closing line remain.

### Launch by name

Launches by `name` are always denied, because the gate cannot see the script. The message is:

> Launching a workflow by name is not allowed. For a saved workflow, relaunch with scriptPath pointing at its file. For a built-in workflow, write your own compliant workflow for the same job and launch it with script.

Exactly one of `script`, `scriptPath` or `name` may be given. No source, or more than one, is denied as `SOURCE` too. Claude Code itself rejects an unknown `name` and a bare `resumeFromRunId` before any hook runs.

### Child workflows

Any reference to `workflow` is denied as `SOURCE`, whether it is a call, a variable, a parameter, a property shorthand or a destructuring target. Inline the child instead. This closes child-file races, aliasing and cycles.

## Records

For every `Workflow` launch the gate writes one record, and ultraguard-eval writes one for every run it saw. Both are small JSON files, one per launch. That keeps every file well under the 4 MiB limit of the mod's file API. Nothing is rotated or deleted.

```
<configDir>/ultraguard/sessions/<session_id>/<tool_use_id>.gate.json
<configDir>/ultraguard/sessions/<session_id>/<tool_use_id>.eval.json
```

`<configDir>` is `CLAUDE_CONFIG_DIR` (trimmed) or `~/.claude`. `session_id` and `tool_use_id` must match `^[A-Za-z0-9_-]{1,128}$`. A bad `session_id` uses the directory `unknown`. A bad `tool_use_id` on a clean launch blocks it, because no record the mod can find could be written.

A passing gate prints nothing, so the gate record is the proof that the gate ran.

### Gate record

Written for every decision, pass or deny, including launches denied before the script is read.

| Field | Content |
|---|---|
| `v`, `kind` | `1` and `"gate"` |
| `at` | ISO time of the decision |
| `session_id`, `tool_use_id` | the ids from the hook input |
| `decision` | `"pass"` or `"deny"` |
| `fingerprint` | SHA-256 hex of the resolved script source (UTF-8), or `null` when no source could be resolved |
| `scriptPath` | the launch's `scriptPath`, or `null` |
| `sessionModel` | the session model the cap used: `opus`, `sonnet`, `haiku` or `null` when it could not be read |
| `maxOpus` | the computed Opus bound. `null` when unknown or when the script could not be analysed. `0` when there are no agents |
| `phases` | the titles in the script's `export const meta = { phases: [{ title }] }`, in order; only literal text titles, without duplicates. `[]` when there are none |
| `stages` | one entry per `agent()` in source order, with `index`, `line`, `label`, `class`, `model`, `effort`, `inFanout`, `bigFanout`, `verdict` and `phase` |
| `errors` | one entry per problem, with `code`, `line` and `message` |

`label` keeps each `${…}` of a template label as that literal text. `verdict` is true when the stage has a valid verdict schema. `phase` is the stage's phase: its literal `phase: '…'` option, else the title of the nearest earlier `phase('…')` call in source order, else `null`. A `phase` option or `phase()` argument that is not literal text gives `null`, because the title is only known when the script runs. The fingerprint is computed by a pure-JS SHA-256 in `src/fingerprint.mjs`, so the mod computes the same value, and a test checks it against `node:crypto`.

If the record of a clean launch cannot be written, the gate fails closed (see [Failure behavior](#failure-behavior)). On a deny, a write error is ignored.

### Eval record

ultraguard-eval writes this file for each workflow run it saw, next to the gate's file for the same launch. It is rewritten whole on every change, because the file API has no append. A run seen with no known launch is written as `<run id>.eval.json`. A run that ended stays in its file.

| Field | Content |
|---|---|
| `v`, `kind` | `1` and `"eval"` |
| `session_id` | the session id |
| `key`, `tool_use_id`, `run_id`, `task_id` | the run's key (the launch's `tool_use_id`, or the run id for an unknown launch) and its ids |
| `name` | the workflow's name, or the start of its summary |
| `launched` | whether the mod saw the launch |
| `status` | `running`, `completed`, `failed`, `killed` or `cleared` (the session was cleared) |
| `startedAt`, `endedAt` | ISO times, `endedAt` is `null` while running |
| `ok`, `reason` | green or red, and the first failure when red |
| `fingerprint` | the fingerprint the mod computed from the script |
| `gate` | `decision`, `fingerprint` and `maxOpus` from the gate record, or `null` if none was found |
| `limit`, `peakOpus` | the Opus limit used and the most Opus agents seen running at once |
| `checks` | the four checks, each with `id` (`gate`, `plan`, `requests`, `opus`), `ok` and `reason` |
| `failures` | the distinct failure reasons, check and agent |
| `agents` | one entry per agent, with `agent_id`, `label`, `askedModel`, `ranModel`, `approved` (the matched stage's model and effort), `sent` (each distinct model and effort the agent's requests used), `done`, `phase` (the agent's phase title, or `null`), `ok` and `reason` |
| `phases` | one entry per phase shown in the detail, with `title` (`null` for the "phase unknown" group), `state` and the `agents` ids in it. `null` when the run has no phases |
| `savings` | per-agent usage by configuration, the baseline configuration, each transition's source and ratio, the seed, and the results (see [Savings](#savings)) |
| `savings.saved.used` | optional. The limit use drawn as the used part of the bars: `{ five_hour, seven_day }`, each a percent (0 to 100) or `null` when there is no reading. Frozen at the last estimate. Absent on records written before 0.4.14, which draw the row without a bar |

## ultraguard-eval

ultraguard-eval is a hooks module in the same plugin (`hooks/eval.tsx`, with the logic in `src/eval.mjs`). It never denies or rewrites anything. It watches the agents a workflow spawns and the requests they send, and judges each running workflow with four deterministic checks. It uses no model.

### The four checks

A run is green only while all four hold. Otherwise it is red and names the first failure.

| # | Check | Passes when |
|---|---|---|
| 1 | Approved by the gate | A `pass` gate record exists for the launch and its fingerprint equals the one the mod computed from the script that ran. |
| 2 | Every agent matches the plan | Each agent's label matches an approved stage's label (each `${…}` matches any text), and the model family the agent resolved to (`opus`, `sonnet` or `haiku` in the model id) is that stage's model. |
| 3 | Every request as approved | Each distinct request the agent sends has the approved model family and exactly the approved effort. An effort lowered by Claude Code itself (for example Haiku sent at a lower effort than approved) counts as a failure. |
| 4 | At most 3 Opus at once | The Opus agents running in the run never exceed `limits.maxConcurrentOpus` from the policy (3 by default). |

If check 1 fails, checks 2 and 3 have no plan to compare against and report that. The reasons check 1 gives are "not approved by the gate" (no gate record, or the launch was not seen), "the gate denied this script", and "the script that ran is not the one the gate approved".

What red means: the run does not match what the gate approved. "Not approved by the gate" means no passing record exists for that launch, or the script that ran is not the script the gate saw. Look at the run's `.gate.json` and `.eval.json`.

An agent spawned for a run with no known launch is red with "not approved by the gate". The gate record is looked up by `tool_use_id`, with a few retries if the file is not there yet.

### What it observes

| Event | What the mod notes |
|---|---|
| `Workflow` tool call | The `tool_use_id`, and the fingerprint of what is about to run (the `script`, or the file at `scriptPath`). After the call, a refused launch is not a run. Otherwise it reads the task id, run id and name from the result. |
| agent spawn inside a workflow | The agent's run, its label, the model it asked for and the model it resolved to. |
| each model request of such an agent | The model and effort actually sent. |
| agent turn complete | The agent finished. |
| a `<task-notification>` for a known launch with status `completed`, `failed` or `killed`, or a resume notice saying `stopped` | The run ended. A `stopped` notice ends the run as stopped, like a TaskStop. A notice for a run this process no longer holds (after a restart the list starts empty) ends the run's entry in the session tally (still running, or settled as `cleared` by the restart) and its `.eval.json` record (still running) with the notice's status. The mod also checks the last rows of the session when the main thread completes a turn, in case it missed one. |
| `/clear` | Every running run ends as `cleared`. The overall tally swaps to the new session's own, which starts empty. |
| `/resume` | The overall tally swaps to the resumed session's stored tally, with runs that were still running counted as ended. |
| `TaskStop` whose `task_id` (or `shell_id`) matches a running workflow's task id | The run ends as stopped, with status `killed`, the status the host's own notification uses. It gets its final estimate, its record and a toast "ultraguard: <title> stopped". A denied or failed TaskStop, or one for another task, changes nothing. |

### What it shows

- A band above the prompt, only while at least one workflow run is active: a square (red if any active run is red, else green), the bold title `ultraguard-eval` and a dim summary such as `2 running  1 red`. Selecting it opens the pane. `/ultraguard` opens it too. The band yields to a survey.
- A pane that opens with the overall savings block, then the workflows. Every main section starts with a double rule such as `══ workflows  2 running ═══`. Subgroups use a thin rule such as `─ finished this session ───`. The workflows sit in a window of their own, so the overall section stays in view. Each run takes 2 lines, in aligned columns: a hollow square, the workflow's name, a short run id, the Opus, Sonnet and Haiku counts (the model in bold, in its color), and either the saved figure or the first failure. The focused row is drawn inside a rounded outline with a bold name and a filled square. Items are separated by spaces, never middle dots. "↑ N more" and "↓ N more" lines show the rows outside the window. The arrow keys move through every row and the window follows, keeping one row past the selection drawn. The focus starts on the drawn row, and going back from a run, reopening the pane and the pane's own focus stops keep the row and the window. Enter on a row shows the run's view: the saved block, then the phases with their agents (see [Phases in the detail](#phases-in-the-detail)), then the four checks with ✓ or ✗ (a passing check adds its detail: the gate's approval time, the agent and request counts, the peak Opus count). Each section starts with a double rule: `══ ultraguard saved ══`, `══ phases ══` and `══ checks ══`. Esc goes back, then closes.

### Limits

- Claude Code draws one plugin band above the prompt. A plugin whose hook draws its own band there without keeping the one beneath it (Cognee's memory row does) hides ultraguard's band; `/ultraguard` still opens the pane.
- The band counts running workflows. A run that ends leaves the band, stays in its `.eval.json`, and stays in the pane under "finished this session", or in the folded "stopped this session" row if it was stopped (see [Savings](#savings)). The mod keeps the 20 most recently ended runs in memory. A launch the gate refused is not a run: it is only in the gate's record. Workflows still being drafted are not shown, because nothing reliably marks when drafting starts or ends.
- If a workflow is running and there is no `ultraguard-eval` button, ultraguard is not loaded in that session.
- Check 1 compares the script's text at two moments, the gate's read and the mod's read. It cannot tell what a sibling hook or the runtime did to the script after that.
- It sees the models and efforts in requests that Claude Code sends. It does not see what a provider does after receiving them.

## Savings

For each tracked run, ultraguard shows what it saved against one counterfactual: every agent of the workflow running on the session's model at the session's effort. That is what Claude Code does when a stage pins nothing. The figures are the percent of the 5-hour and weekly limits (subscribers), dollars at API prices (API key users) and tokens. Percentages and dollars carry a range; the token figure is the median. A figure ultraguard cannot back is shown as unknown, never as 0. There is no model call, and nothing on the request path waits on the estimate.

Observed exactly, by the mod:

- Every request an agent sends: its model, effort and agent id, and the usage in the response (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`).
- The run an agent belongs to and the session model, from the agent's spawn.
- The session effort, as it was when the workflow launched.
- On a subscription, the `five_hour` and `seven_day` limits with `percentUsed` (0 to 100, whole percent) and `resetsAt`. The list is empty off a subscription, which is how ultraguard tells subscribers from API key users.

What the session model would have spent on the same task is not observable, so it is estimated. Pricing the same tokens again at the expensive rate is wrong in both directions: in the replays the real cost ratio ranged from 1.40 to 2.60 against a flat 2× price ratio.

### The estimator

The cost of a task on configuration B equals its observed cost on configuration A times a ratio between the two, learned from tasks run on both (Smékal, "probe-calibrated shared shape", arXiv 2608.25399, Sec 3.4). The observed run is the probe. With one probe the paper measured a median error of 36% and needed a ×1.9 allowance to cover 90% of cases. That figure is for a held-out task on the same model (Kimi K3, 5 tasks, 11 specs × 3 efforts), with errors measured against cell means, so ×1.9 is a lower bound for transitions between models.

- **Configuration:** a (model family, effort) pair, such as `sonnet:high`. A transition is actual to baseline, such as `sonnet:high>opus:xhigh`.
- **Buckets:** each transition has three token ratios, the same three the limit meter weighs: `output` (thinking included), `fresh` (input plus cache write, keeping the actual split between them) and `read` (cache reads).
- **Why not one context ratio:** a single context ratio overstated the measured dollars by 42%. In the Opus-at-high replays cache reads grew 2.3× from Sonnet to Opus while cache writes grew 1.15× and cost 25× more per token.
- **Ratio of totals:** `R = Σ baseline tokens / Σ actual tokens` over the paired agents, per bucket.
- **Identical configuration:** an agent already on the baseline configuration saves exactly 0.
- **Unknown:** an agent with no usage, a model with no price, an effort ultraguard cannot read, or a transition with no ratio is left out and counted, as in "from 5 of 6 agents". Nothing is extrapolated to it.

### Where ratios come from

In this order, first match wins:

1. **Measured**, from the paired replays.
2. **Chained:** a measured ratio into the same baseline family at another effort, times a published effort step within that family, bucket by bucket: each bucket adds its own step to its measured log ratio. Effort steps within one model agree across sources (Opus 5.5 xhigh ÷ high: 1.75, 2.55, 2.98 and 2.34 across four sources, log sd 0.22; the step carries the workload spread 0.37), unlike steps between models. Steps into and out of `max` come from the Artificial Analysis run alone (Opus max ÷ high: 2.90). The community CSV's `max` cells are left out: its Opus `max` cell needed a permission for an automated test and its Haiku `max` cell wrote its own test script.
3. **Prior:** no replay measured the pair and no chain reaches it. Between two of Opus, Sonnet and Haiku, each bucket's log ratio comes from Artificial Analysis's whole-index token counts, baseline configuration over the agent's: output is the output tokens, and read and fresh are both the total input tokens (reads are most of it; Artificial Analysis does not split the input of Opus and Haiku). The log sd of every bucket is max(0.6, spread between sources of the published cost ratio), and fresh, a proxy, adds 0.2 in quadrature, `√(sd² + 0.2²)`. This is the candidate the backtest below found closest. The old prior is kept beside the buckets as the scalar `{mu, sd, sources}`, and a pair where either configuration lacks Artificial Analysis token data (any pair with Fable) uses it for all three buckets: published cost per task for both configurations, divided by the input-price ratio, with log sd = max(0.6, spread between sources). The scalar assumes every priced class moves by the input-price ratio, which prices contradict for Haiku: its cache read costs 10× less than Sonnet's while its other classes cost 20× less, so by price arithmetic the scalar understates the reads of a Sonnet baseline for a Haiku agent (an inference: the replays have no Haiku pair to test it). An agent at another effort of the baseline's own model (an Opus agent at medium in an Opus session at high) uses the published effort step for that pair, each bucket its own, with the step's log sd (see [Margin of error](#margin-of-error)) and no between-run τ.

**Effort steps per bucket.** A step's level is the mean log cost ratio over every source that prices both efforts. Its shape comes from Artificial Analysis alone: each bucket's log step is the level plus `ln(AA bucket ratio) − ln(AA whole-run dollar ratio)`, where the whole-run ratio is the cost to run the whole index, not the cost per task. So the level stays the multi-source one and only the split between buckets is Artificial Analysis's. At Artificial Analysis's own Sonnet mix the three buckets give back the level within 2% in dollars.

- **Sonnet:** output is the output tokens, fresh is non-cache input plus cache write and read is cache read, each from the dollar components divided by the list price. Sonnet high to xhigh: output 2.21, fresh 2.11, read 3.28 against the level 2.49. Read grows fastest and fresh slowest at every step but xhigh to max.
- **Opus and Haiku:** Artificial Analysis publishes no cache split, so read takes the total input tokens (reads are most of it) and fresh is borrowed from Sonnet: `ln(fresh ratio) = 0.77 × ln(output ratio)`, Sonnet's mean over its ten steps (0.63 to 0.93). Opus high to xhigh: output 2.42, fresh 2.12, read 2.56 against 2.36.
- **No token data:** a family or pair with no Artificial Analysis token data (Fable) keeps one step for all three buckets.

Chaining passed its one test in dollars: measured Opus medium times the published Opus high ÷ medium (1.45) predicted 2.31 for the high transition, inside the measured 2.19 to 2.89. Per bucket the read prediction was low: the errors in log were −0.18 for output, +0.13 for fresh and −0.69 for read, because the measured read ratio grew 2.90 against the published 1.45, and the dollars came out right by cancellation. With bucket steps (output 1.44, fresh 1.35, read 1.59) the errors are −0.19, +0.05 and −0.60. The two cells are different workflows, so this is weak evidence.

### Margin of error

- **Shared ratio error:** each measured bucket ratio has a 90% Fieller interval with Student t at n − 1 degrees of freedom. Its log half-width ÷ 1.645 is the draw's standard deviation. If the interval is unbounded, that transition falls through to chained or prior.
- **Between-workflow error (τ):** the same transition saved 29% on long code mapping and 52% on short checks, so a workflow carries an error of its own: `τ² = Σ (ln R_workflow − ln R_transition)² / max(1, W − T)` over the replayed workflows, floored at 0.22, the shape-mismatch floor of Smékal's decomposition. Today τ = 0.30. It rests on 3 workflow cells and 2 transitions, one degree of freedom, so the floor protects the next recalibration.
- **Effort step error:** a step's log sd is the largest of three: the spread between sources (0.4 with one source), the spread of that step across Artificial Analysis's nine evaluations, and 0.25. The evaluation spread is Sonnet's cost per task, used for every family: 0.26 for low to medium, 0.37 for medium to high and high to xhigh, 0.70 for xhigh to max and up to 1.14 for low to max. It is the workload spread of a step, so Opus high to xhigh carries 0.37 although its four sources agree to 0.22. The floor 0.25 is for adjacent steps: Artificial Analysis's adjacent steps spread 0.26 to 0.37, and Smékal's five tasks 0.249. Every bucket takes the step's sd; a borrowed fresh bucket (Opus, Haiku) adds 0.2 of shape spread, `√(sd² + 0.2²)`.
- **Per-agent error:** the sample sd of the paired agents' log ratios, mean-corrected (`− s²/2`) so its multiplier averages 1. The pooled sd of each bucket (output 0.41, fresh 0.22, read 0.67) must stay at or above the single-run noise floor (0.16, 0.18 and 0.19): the log sd between two runs of one configuration in the HAL traces (0.227, 0.259, 0.273) divided by √2. A test checks it.
- **Monte Carlo:** 4,000 draws, seeded from the run key, so the pane shows the same numbers on every draw. Per draw: one deviate per run (τ), one per transition (shared ratio, all buckets) and one per agent (all buckets).
- **Shown as a range:** the pane shows the 5th to 95th percentile as low to high, such as `+30.1 (3.0 to 91.6)`, never as ±. The note under the figures reads "range = 9 times in 10".

### Data files and calibration

| File | Content |
|---|---|
| `data/replays.json` | The 22 measured pairs, as numbers only: workflow, task kind, `from` and `to` configuration, and the `input`, `output`, `cacheRead` and `cacheWrite` tokens of the actual and baseline run. No prompts, labels or paths. Records the Claude Code version (2.1.319) and the date. |
| `data/published.json` | Published cost per task by family and effort, from five sources, with their URLs: Artificial Analysis (Intelligence Index v5.0.1, which is in the source id because it re-baselines silently), Anthropic's SWE-bench Pro subset, Anthropic's 370-task agentic benchmark, Anthropic's 134-task Managed Agents run (Opus 5.5 low and medium, a source of its own) and the community CSV. Source ids are unique. The community CSV has no `max` cell, so every step and prior into or out of `max` comes from Artificial Analysis. Costs are compared only inside one source, never across sources. The Artificial Analysis source also carries `wholeIndex`, one whole-index run per family and effort: output and input tokens and the cost to run for Sonnet, Opus and Haiku, and for Sonnet the non-cache input, cache read and cache write dollars with the prices they were charged at (the non-cache, read and write tokens add up to the input tokens exactly). Opus and Haiku were read at 3 significant digits. It carries `evaluations` too: Sonnet's cost per task in each of the nine evaluations, from which the step spread is computed. Each block names the pages it comes from. |
| `data/prices.json` | List prices per million tokens by family and, for Opus 5, Sonnet 5 and Fable 5.2, by version (see [Dollars](#dollars)). |
| `data/ratios.json` | Generated from the three files above. It ships with the plugin: `tau`, `pooledAgentSd`, the `measured` transitions, the effort `steps` and the `priors`. A step is `{mu, sd, sources}` and, where Artificial Analysis has token data, `output`, `fresh` and `read`, each `{mu, sd}`; a prior has the same shape. |

```
node scripts/calibrate.mjs
node scripts/calibrate.mjs --check
```

The first rewrites `data/ratios.json` from the other three files. `--check` writes nothing and exits 1 with "data/ratios.json is stale: run node scripts/calibrate.mjs" when the file on disk differs from what the data would produce.

`node scripts/lowo.mjs` takes no arguments, writes nothing and checks the calibration with Smékal's protocol, holding out one workflow at a time. It fits the measured ratios (per bucket and in dollars) from the other workflows' pairs of the same transition, predicts the held-out workflow's baseline tokens and dollars from its actual totals, and prints the log error, the median error, the share within ±50% and the multiplier that reaches the measured baseline in 90% of cases, against a no-probe prediction of ratio 1 (and, for dollars, ratio 1 per token repriced at the baseline model). A workflow whose transition no other workflow measured, or whose fit has no usable ratio, is reported as not predictable. On the 2026-11-08 replays the web-research workflow is the only one on `sonnet:high>opus:high`, so it is not predictable, and the two Opus-medium workflows predict each other: the fitted ratio is off by 0.35 to 0.47 in log in each token bucket it can predict and by 0.40 in dollars, with the opposite sign for each workflow (the read bucket of the code-mapping workflow is not predictable, because the other workflow's read interval is unbounded). By median |ln error| ratio 1 beats the fitted ratio in every token bucket, and in dollars the fitted ratio beats only the ratio 1 that ignores the Opus-to-Sonnet price difference, not the repriced one. By median relative error the fitted ratio edges ratio 1 in output (49% against 51%) and the two tie in dollars (41% against 40%): with two workflows neither metric settles it. With two workflows on one transition the two dollar errors are mirror images, so the check holds one independent comparison, the same single degree of freedom as τ: it implies τ ≈ 0.28 against 0.30, and a 90% interval for a standard deviation estimated from one degree of freedom runs from about 0.5 to 16 times the estimate (chi-square, one degree of freedom). It neither confirms nor contradicts τ.

`node scripts/priors.mjs` takes no arguments, writes nothing and backtests the cross-family prior against the replays, one workflow at a time. The candidates use only `data/published.json` and `data/prices.json`, so no workflow is in its own fit. Truth for a workflow is its baseline run over its actual run per bucket, and in dollars. The candidates are the old scalar (current), Artificial Analysis token ratios with fresh from the borrowed exponent of the effort steps (A), the same with fresh equal to the total input ratio, as the spec's backtest had it (A2, the one `ratios.json` carries), and the published cost ratio divided by each bucket's own price ratio (B). For each it prints the ln error ln(candidate / truth) by workflow and bucket, the mean absolute ln error over the bucket cases and over dollars, the pick (lowest bucket error; among the candidates within 0.02 of it, the lowest dollar error) and, side by side, every Haiku-to-Opus/Sonnet and Opus/Sonnet-to-Haiku prior at medium, high and xhigh. On the 2026-11-08 replays the backtest is 3 workflows on 2 transitions, all Sonnet to Opus, so it says little. Opus and Sonnet prices differ by 2× in every class, so B equals the old scalar there and the backtest cannot tell them apart; the replays have no Haiku pair, so the Haiku rows are not backtested. Mean absolute ln error over the 9 bucket cases: old scalar and B 0.284, A 0.220, A2 0.216; A is closer in 6 of the 9. In dollars A is further (0.205 against 0.177 for the scalar and 0.161 for A2), closer in 1 of 3 workflows. A2's lead over A on buckets is 0.004, inside the 0.02 tie, and A2 has the lower dollar error, so A2 is the pick: it is closer than the old scalar on both counts.

`data/ratios.json` groups pairs by transition, not by task kind. Its `sonnet:high>opus:medium` entry pools the 18 pairs of both Opus-medium workflows: 90% interval 1.45 to 2.10 on dollars, ratio 1.59.

### Dollars

List prices per million tokens in `data/prices.json` (platform.claude.com pricing, 2026-11-09):

| Model | Row | Input | Output | Cache read | Cache write |
|---|---|---|---|---|---|
| Opus 5.5 | `opus` | 4 | 20 | 0.20 | 5 |
| Opus 5 | `opus-5` | 5 | 25 | 0.50 | 6.25 |
| Sonnet 5.5 | `sonnet` | 2 | 10 | 0.10 | 2.50 |
| Sonnet 5 | `sonnet-5` | 2 | 10 | 0.20 | 2.50 |
| Haiku 5.5 (prompt ≤ 100k) | `haiku` | 0.10 | 0.50 | 0.01 | 0.125 |
| Haiku 5.5 (prompt > 100k) | `haiku` | 0.50 | 2.50 | 0.05 | 0.625 |
| Fable 5.1 | `fable` | 10 | 50 | 0.25 | 12.50 |
| Fable 5.2 | `fable-5-2` | 8 | 40 | 0.20 | 10 |

A model id picks its row by family and version, with or without a date or `[1m]`: `claude-opus-5` is the Opus 5 row and `claude-opus-5-5` the Opus 5.5 row, `claude-sonnet-5` and `claude-sonnet-5-5` likewise, and `claude-fable-5-2` is the Fable 5.2 row while `claude-fable-5-1` stays on the Fable 5.1 row. Ratios stay keyed by family (`opus`, `sonnet`, `haiku`, `fable`): a version has a price row, not ratios of its own.

Cache writes are priced at the 5-minute rate. The `usage` object does split writes into `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`, but ultraguard reads only the flat `cache_creation_input_tokens`. Claude Code defaults to a 5-minute cache for API-key users, the users shown dollars, and workflow agents use 5 minutes even on a subscription, so the 5-minute price is right by default. It is 1.6× too low for the tokens of a user who sets a 1-hour TTL (2× input against 1.25×). Haiku's long-prompt rule applies per request on input plus cache read plus cache write. A model with no row is unknown; it never falls back to Opus. The rows cover Opus 5 and 5.5, Sonnet 5 and 5.5, Haiku 5.5 and Fable 5.1 and 5.2: an older model such as `claude-opus-4-1` is unknown. `claude-fable-5` (Fable 5) is not in the table and resolves to the Fable 5.1 row, although the pricing page charges $1 for its cache reads.

### Limit percentages

The best public reverse-engineering of the meter fits input and output at list-price ratios and cache writes at the input rate. Its cache-read weight is small but not zero: the sources overlap at 0.01 to 0.07 of the input price, and one report says about 0.1. ultraguard calibrates its own rate.

- **Meter units** per request, in list-price dollars: `U = in·p_in + cw·p_in + out·p_out` and `C = cr·p_in`. The weight is `U + w·C`, with `w` unknown in [0, 0.1].
- **Whole percent:** the host reports `percentUsed` in whole percent: 242 of 242 stored rises were integers, and 186 of 200 five-hour intervals were exactly 1. A rise below `MIN_RISE = 0.1` is ignored, which only matters if the host ever sends decimals.
- **Intervals:** every request of the session, main loop and agents, adds to running `U` and `C` per window. When a reading shows `percentUsed` up by Δ with the same `resetsAt` and `0.1 ≤ Δ < 2`, the interval `{Δ, U, C, at}` is stored and the counters restart. A changed `resetsAt` or a drop restarts the counters and stores nothing. So does an interval with `U = 0`.
- **Jumps:** a rise of 2 points or more is not stored, and the counters restart. A rise of exactly 1 is the quantized tick and stays. A rise that large mostly comes from usage this session cannot see: other sessions, claude.ai or another machine. On the 200 five-hour intervals of one machine, 14 were jumps, and dropping them took the pooled rate from 2.68 to 1.49 points per list-price unit at `w = 0.05`. Intervals already stored with a rise of 2 or more are ignored when they are read back.
- **Readings:** a `percentUsed` below 0, above 100 or not a number is treated as no reading for that window: it changes neither the last reading nor the counters.
- **Compaction:** when the main conversation is compacted (`/compact` or automatic), both windows forget their last reading and restart their counters, so no interval spans it. A compaction that is skipped, one in a subagent and a precompute change nothing.
- **Storage:** `$.store` key `meter:<session id>`, at most 200 intervals per window across all keys, intervals older than 30 days dropped. Sessions write separate keys, and all keys are merged on load. On start, keys whose readings are all older than 30 days are deleted.
- **Rate:** `ΣΔ / Σ(U + w·C)` over the stored intervals. Each Monte Carlo draw takes `w` uniform in [0, 0.1] and a bootstrap resample of the intervals.
- **Readiness:** a window's figure shows once it has 5 intervals. Before that the window's row reads `learning 3/5` in place of the saving.
- **Sanity bound:** a run's own tokens, in meter units, times the pooled rate is what the run cost the window in points, and the account cannot have risen by less, since other sessions only add. At launch ultraguard keeps the window readings; at each estimate the rise is the latest reading minus the launch reading, when both are in the same window (same `resetsAt`) and the difference is not negative. In each Monte Carlo draw the run's actual spend is `(ΣU + w·ΣC)` over all its agents times the same resampled rate. If the median of that is more than the rise plus 1 point (the whole-percent quantization), the rate is too high for this run, and the run's figures for that window are scaled down by (rise + 1) ÷ that median, so the run never claims more of the window than the account actually used. The run's per-agent and per-phase 5-hour figures are scaled with it, and the factor is kept in the record (`limits.clamp`) and in the session tally, where the same run's agents are scaled by it in the session total. Dollars, tokens and the other window are not touched. With no rise (no reading at launch, or the window reset since) nothing changes.

Usage from other sessions and claude.ai moves the meter without adding units here, so the figure reads high; the jump rule and the clamp remove the worst of it, not all. Fable's separate weekly limit is not exposed and not shown.

### Phases in the detail

Enter on a run shows the saved block, then the run's phases like Claude Code's own workflow view, then the four checks: each phase is a row you can fold, and the agents that ran in it sit indented below.

```
        agent                       API saves   ran on
  ▾ ○ Collect  2 agents             $0.34
      ✓ grunt: merged PRs           $0.05       haiku high
      ✓ grunt: changelog entries    $0.06       haiku high
  ▸ ○ Investigate  2 agents         $1.09       sonnet 2
  ▾ ○ Decide  running  0 of 1 done  —
      ✓ decide: release version     —           opus high
      Review  not started
  ✓ ran as the gate approved  ✗ did not
```

- **Where phases come from:** the gate reads them from the script (see the gate record's `phases` and each stage's `phase`), and the mod joins each agent to its stage by label, the way it already checks the plan. The running workflow does not expose its phases to plugins, so a script whose phase is only known at run time (a `phase:` value that is not literal text) puts the agent under "phase unknown". So does an agent whose label matches stages that sit in different phases.
- **No phases:** a script with no phases, a run the gate did not approve or an older gate record shows the flat agent table.
- **Columns:** the agent label, then the saved figure, then "ran on" last. The saved column is headed "5h saves" when a 5-hour limit figure shows and "API saves" otherwise. It sits right after the labels so each figure stays near its phase or agent.
- **Phase block:** a phase is a block. Its first row has a caret (▾ open, ▸ folded), a hollow circle (green while every agent in the phase is as approved, red when one is not), the bold title, `running  1 of 2 done` or `2 agents`, `1 red` when an agent broke the plan, and the phase's saved figure in the saved column. A folded phase also shows its models in the "ran on" column: `opus 11  sonnet 10  haiku 12`, in that order, with the name bold in its color and the count dim. When they do not fit they wrap onto lines at the same column. An open phase lists its agents instead. A phase with no agents yet reads `not started`, and `did not run` once the run ended. Those rows are dim and cannot be folded.
- **Agent row:** a green ✓ when the agent is as approved, a red ✗ when not, then the label, what it saved, and the model it ran on with its effort (the model bold in its color, the effort dim). A red agent's reason is on its own line below the row. A dim line under the phases explains the marks: "✓ ran as the gate approved  ✗ did not".
- **No middle dots:** the pane separates items with spaces, never a middle dot: the id after the workflow's name, a passing check's detail, the status of a phase, the counts, the effort, the hints and the run list. The band above the prompt and the saved block follow the same rule.
- **Focus:** the focused run, phase block, "expand all" and "back to the list" are each drawn inside a rounded outline, and the focused run's square fills (■) and the focused phase's circle fills (●). The outline takes a blank row above and below, so phase blocks after the first overlap their neighbour's blank row and nothing moves when the focus does.
- **A phase is done** when the run ended, or when every agent in it is done and a later phase has an agent. Until then it reads `running`, so a loop that runs one agent at a time does not flicker.
- **Folding:** every phase starts folded. Enter on a phase row opens or folds it, `a` opens all or folds all, `b` or Esc goes back. Your choices stay while you look at the run, also when it ends, and reset when you open another run. Focus starts on the first running or red phase. Up and down move between the phases, "expand all" and "back to the list".
- **Saved figure of a phase:** the median of the sum of its agents' savings, not the sum of the agents' medians, so the figures of the agents can add up to a little less or more. It shows a dash when a finished agent in the phase has no figure. When the pane is narrow, the label column gives room to the saved column first, and a phase title that does not fit is cut with an ellipsis.

### Colors

What a run costs runs warm, what it saved runs cool. Colors sit in the characters, never in a fill.

- **Models and efforts:** the model name is bold in its color and the effort word stays dim. Haiku is gold, Sonnet orange and Opus red, each deepening from `low` to `xhigh` (Opus at `xhigh` is the deep crimson, `#d63150`). A count such as `sonnet 32` and the family names in the "more tokens" sentence use the usual shade of the family: Haiku at `xhigh`, Sonnet and Opus at `high`. The model name in the heading of the saved block takes the color of its effort, like the model on an agent row. Fable takes the Opus colors.
- **Saved:** a percentage of the 5-hour limit is bold and runs from cyan at 1% through blue at 10% and violet at 20% to the deep purple `#641aa5` at 40% and above, between those points in even steps of perceived color. Darker means more saved. The same color marks the saving in a bar, the `+N` figure beside it, and the saved figure of an agent and of a phase. On an API key, the cost row's `+$` figure and its saved cells take the gradient too, by the share of the baseline's dollars saved. The dollar figure on the money line and the token count stay plain.
- **Bars:** the used part takes the theme's `text` color, the empty track `subtle` and the limit mark `inactive`, so they follow the terminal's theme.
- **Status:** green and red stay for the squares, the circles and the check marks (hollow, filled on the focused row), and mean only as approved or not.

The colors are tuned for a dark terminal: each one keeps at least 3:1 contrast on a `#262626` background, except the saved colors past 20%. They fall from 3.6:1 at 20% (violet) to about 1.6:1 at 40% and above (the deep purple), so a large saving is faint on a dark terminal. On white the deep purple is 9.4 to 1, but the cyan end of the ramp is about 1.5 to 1, so small savings are faint on a light terminal. Light terminal rendering has not been checked live.

### What the pane shows

The row above the prompt keeps its meaning, with a hollow square: green and red still mean only enforced or evaded.

The list (`/ultraguard`), at width 56:

```
══ overall savings for this session so far  15 workflows ══════
  vs every agent on Sonnet xhigh
  context ━━━──────────────────────│   12%  125k of 1M
  5-hour  ━━━━━━━╸─────────────────│   13%  +17.8
          (2.1 to 52.3)
  weekly  ━━━━━━━━━━━━━╸───────────│   50%  +3.5
          (0.4 to 10.2)
  5-hour counts the 7 workflows of this window

══ workflows  2 running ═══════════════════════════════════════
    workflow                  id       agents          5h saves
  ↑ 3 more
  □ audit the gate            e4f5a6b  sonnet 4         0.8% so far

─ finished this session ───────────────────────────────────────
  □ fan out the docs          c7d8e9f  done 14:02       2.2% (0.9 to 3.8)

  ▸ stopped this session  2 workflows
  ↓ 5 more
```

- **Overall savings:** the list opens with "overall savings for this session" (" so far" while a workflow runs) and the number of workflows. It pools every workflow of the session into one estimate per baseline, with the same context, 5-hour and weekly rows as a run's saved block. It swaps with the session on /clear and /resume.
- **Tally:** the totals live in a session tally of their own, so they count every workflow, past the 20 the list keeps. The tally is mirrored to the plugin store under `tally:<session id>`. At session start the store keeps the 3 newest other sessions' tallies whose newest run is under 30 days old, and a tally over 512 KiB is no longer mirrored. The tally carries its session id, so /clear and /resume swap to the new session's tally. A workflow enters the tally when it launches, an ended run is never overwritten by a running one, and a stored run that was still running counts as ended. The overall estimate always uses 1,000 draws. It is rebuilt when a workflow starts or ends, on load, and when the 5-hour or weekly window rolls over, and at most every 30 seconds while workflows run.
- **Per-window counting:** the 5-hour and weekly rows count only the workflows of the current window. When some workflows ran in an earlier window a dim line says how many count. When none of the session's workflows ran in the current window and that window has 5 or more readings, its row shows a zero saving rather than `learning`.
- **Mixed baselines:** with one baseline the total is that estimate. With several, the low, middle and high ends are added, and the vs line reads "vs your session's model at each launch". A workflow whose agents all ran on the baseline counts as a known zero. When every workflow did, the overall section says "every agent ran on your session's model and effort, so nothing was saved".
- **Workflows section:** it sits in its own window, so the overall section stays in view. Rows take 2 lines, and a run with nothing saved because every agent ran on the session's model and effort reads a dim `same model` in the saved column. The name column shrinks on a narrow pane so the saved cell fits. When the list does not fit, it is drawn one row taller than the pane's body so the host raises scroll events for the arrow keys, and the scroll offset is capped so the overall section stays on top. Finished workflows sit under a thin "finished this session" rule. "↑ N more" and "↓ N more" lines show the hidden rows. With no running workflow the section reads "none running".
- **Stopped:** a workflow stopped with TaskStop goes into a folded "stopped this session" row at the end of the list. Enter on it opens or folds it, and open, its rows read `stopped HH:MM` in the agents column. Their savings count toward the overall total.

A run's view (Enter on a run), at width 56:

```
══ ultraguard saved ═══════════════════════════════════════════
  vs every agent on Opus high
  context ━━━╸─────────────────────│   42%  84k of 200k
  5-hour  ━━━━━━━━━━━━━━───────────│   40%  +15.0
          (11.0 to 19.0)
  weekly  ━━━╸─────────────────────│   10%  +2.4
          (1.5 to 3.3)
  without ultraguard you would have been past half of
  your 5-hour limit already
  $2.32 ($1.73 to $2.91) at API prices
  2.9M fewer tokens
  range = 9 times in 10
```

The agent table gets one more column, "5h saves" (or "API saves" when no limit figure shows), with each agent's median, and each phase row shows the figure of its agents.

- **Width:** the block is at most 56 columns wide and has the same compact layout at every pane width. Text wraps at the block's width.
- **Bars:** one thick-line bar per row: context, 5-hour and weekly. `━` is a full cell, `╸` a half cell and `─` the empty track. `│` marks 100% of the limit. The rows share one scale. The mark sits at the end of the bar until a row's use plus saving passes 100%. Then it moves into the bar on every row, the saving can spill past it, and the scale tops out at 150% of the limit. A `»` caps the last cell when use plus saving passes the end of the bar. That is a little over 150%, and the exact total moves with the pane width: for a 5-hour row with use 100%, the first cap is at a total of 158% at a block width of 56 columns or more and 166% at 44. On a narrow pane the bars shrink down to 4 cells so every line fits the block's width. Below that a row's range moves to its own line under it.
- **Row text:** after the bar, the used percent (context: the share of the window), then the saving as `+M (L to H)` in points of the limit. Context shows the tokens against the window, such as `84k of 200k`. A saving of 0 or less shows without a `+`, and a window still learning shows `learning 3/5`.
- **Saving color:** the saved cells run on the gradient described under [Colors](#colors). The last saved cell and the `+N` figure share one color.
- **Used part:** the used part of a limit bar, drawn in the theme's text color, is the use frozen at the last estimate, from the record's `used`. The gray part of the bar is the empty track. A record with no `used`, or a window with no reading, draws the row without a bar.
- **Context row:** it reads the session's live context window as a status line does: tokens against the model's window, or against the smaller compaction window when auto-compaction is on. Right after a fresh session or a compaction it shows an empty track and a dash until the next response.
- **Running:** the heading reads "ultraguard saved so far". The "vs every agent on ..." line always takes its own line.
- **API key:** the bars are context and cost. The cost bar shows the dollars spent as the used part and `+$2.32 ($1.73 to $2.91)` as the saving. There is no limit row, no limit message and no money line.
- **Limit not calibrated:** the row reads `learning 3/5` instead of the saving, with the readings so far.
- **Limit messages:** they sit under the bars. "without ultraguard you would have blown past your 5-hour limit" when use plus saving would have passed 100%. "... would have had only 2% of your 5-hour limit left" when it comes within 10 points of the limit. "... would have been past half of your 5-hour limit already" when use plus saving passes 50% and use alone stays under it. Rows of the same kind and the same hedge join into one sentence: "5-hour and weekly limits". Rows of one kind with different hedges get a sentence each, and rows of the "only N% left" kind never join, so a kind can give several sentences. For the first two kinds, a saving under 2% is hedged: "would likely have" when the low end of the range still lands in the same band, "might have" when it does not. For the half kind, a margin under 5 points over half is hedged with "likely".
- **Money and tokens:** on a subscription the money line reads `$2.32 ($1.73 to $2.91) at API prices`. The tokens line is "2.9M fewer tokens", or "8.8M more tokens: Sonnet read and wrote more, at a lower price per token". With two or more families it reads "Haiku, Opus and Sonnet read and wrote more…". Each is on its own line.
- **Note:** the dim line "range = 9 times in 10" follows, and under it "this run may have saved nothing" when the range reaches below zero.
- **Coverage:** these dim lines appear only when something is off. When an agent is left out or a price or a ratio is missing, the first line is "from 3 of 4 agents: ultraguard has no price for the model one agent ran on", and "ratio measured on N replayed agents" follows it when some pairs were measured. The source lines print whenever they apply: "ratio measured at high effort, adjusted with published figures for xhigh", "no replay measured sonnet medium against opus high; using published figures, so the range is wide". When every agent counted, was priced and had a ratio, the bare "from N of N agents" line and the "ratio measured on N replayed agents" line are dropped, and only the source lines print.
- **Nothing to estimate:** "every agent ran on your session's model and effort, so nothing was saved"; "ultraguard could not read your session's model or effort, so it has no estimate".

Run list: a dim header row `workflow  id  agents  5h saves` (or `API saves`). Green rows show `1.4% (0.6 to 2.2)`, running rows `0.6% so far`, red rows keep their reason.

Finished this session: ended runs stay in the pane under a thin "finished this session" rule, with `done 14:51` in the agents column, until `/clear` or the session ends. Enter opens them. Cleared runs are not listed. Stopped runs go in the folded "stopped this session" row instead.

Toast at run end (8 seconds; the model never sees it):

- "ultraguard: research-config finished as approved and saved about 1.4% of your 5-hour limit"
- "… saved about $2.32 at API prices" (limit not calibrated) or "… $2.32 off your API bill" (API key)
- "ultraguard: research-config finished as approved; every agent ran on your session's model and effort"
- "ultraguard: research-config finished, but <reason>" for a red run

Percentages have one decimal ("< 0.1%" below that), dollars two, tokens are written `2.9M` or `84k`.

### Calibration results

Replays run 2026-11-08: 22 agents from 3 past all-Opus workflows, replayed with the same prompts on Sonnet at high effort in repo snapshots at the original commits, through an ultraguard-gated workflow. The 22 Sonnet runs in `data/replays.json` cost $11.16 at list price.

| Transition | Task kind | Pairs | Opus ÷ Sonnet cost (90%) | Saved |
|---|---|---|---|---|
| `sonnet:high>opus:high` | web research | 4 | 2.60 (2.19–2.89) | 62% |
| `sonnet:high>opus:medium` | code mapping | 4 | 1.40 (1.23–1.99) | 29% |
| `sonnet:high>opus:medium` | yes/no checks | 14 | 2.08 (1.84–2.35) | 52% |

- Tokens saved can be negative: on code mapping Sonnet at high wrote 1.86× the output of Opus at medium and still cost less.
- Claude Code 2.1.299 transcripts write partial usage on a message's early records, so a transcript reader must take the largest value per message id. The mod reads live events and is not affected.
- ultraguard pins investigation to Sonnet at high, above an Opus-medium session's effort, which shrinks savings there. The policy is unchanged.

### Savings limits

- Smékal's estimator is unproven across models. The replays are the only evidence for this workload, and they measure two transitions directly. No Haiku transition was replay-measured, so Haiku savings use published figures and their range is wide.
- With 3 replayed workflows the per-workflow range is wide (τ = 0.30), close to Smékal's ×1.9.
- Effort labels have cost about 2× more from one Claude Code version to the next (anthropics/claude-code#78320). `data/ratios.json` records the version it was measured on.
- Limit figures carry the meter's unknowns: other usage on the account, the cache-read weight and server-side changes. A change of plan or account leaves readings from the old limit in use for up to 30 days. A request on a model with no price voids the reading it falls in.
- Not included: a user's own ratios file, a replay-building script, a weekly total, per-class ratios.

## Environment checks

The gate denies (`ENV`) when:

- `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` is set to anything other than empty or `inherit`.
- `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is truthy (`1`, `true`, `yes` or `on`, as Claude Code reads it; any other value, such as a model name, leaves it off).
- `CLAUDE_CODE_EFFORT_LEVEL` is set to any non-empty value. This includes `auto` and `unset`, which also override per-agent effort.

Values are compared trimmed and case-insensitively. Each message names the variable, says it may come from the environment or a settings `env` block, and tells Claude to ask the user to remove it and restart Claude Code instead of relaunching.

`CLAUDE_CODE_SUBAGENT_MODEL` is allowed. Since Claude Code 2.1.251 it ranks below the per-call model.

### Not checked: does not override an explicit effort

In Claude Code 2.1.319 these do not override an explicit `agent()` effort:

- `CLAUDE_CODE_SUBAGENT_EFFORT`
- `effortLevel` in settings
- `modelSettings.<model>.effortLevel`
- the session `/effort` level, including ultracode

### Not checked: clamps the effort downward

These clamp an explicit effort downward, so the agent can run lower than declared:

- `maxEffortLevel`
- `modelSettings.<model>.maxEffortLevel`
- an organization per-model max effort

### Not checked: not visible to ultraguard

- `ANTHROPIC_DEFAULT_*` model variables. With `ANTHROPIC_DEFAULT_HAIKU_MODEL` set, `haiku` can resolve to another model, and what it sends for `medium` and `high` is not verified.
- `availableModels`
- a hooks-module request effort override
- the automatic downgrade after an API 400 "Invalid effort level"
- skill or ultrathink effort layers inside an agent's own turns

### Haiku efforts

The policy allows Haiku only at `medium` (`code:`) and `medium` or `high` (`grunt:`). On first-party Anthropic, `haiku` resolves to `claude-haiku-5-5`, which supports `medium`, `high` and `xhigh`. On Bedrock, Vertex, Foundry, Mantle, `anthropic_aws`, `anthropic_google_cloud` and gateway providers, or with `ANTHROPIC_DEFAULT_HAIKU_MODEL` set, `haiku` can resolve to `claude-haiku-4-5`, which has no `xhigh`. Because the policy approves no Haiku stage at `xhigh`, that gap only matters if you add a Haiku `xhigh` pair to your own policy copy: a stage approved at `xhigh` is then sent as `high`. What Claude Code sends there for `medium` and `high` is not verified. The gate does not check any of this. ultraguard-eval does: a request sent at a different effort than approved turns the run red.

To see the effort an agent actually ran at, read `params.output_config.effort` on the `api-request` rows in its `agent-*.jsonl` transcript. `agent-*.meta.json` does not record effort.

## Scope and limits

Only `Workflow` launches are gated. Agent tool calls are not gated.

Not enforceable:

- Whether a class label is honest. The `LABEL` word check catches the common case; a label without those words passes.
- Whether a lower-tier agent really refrains from deciding.
- The window between the gate reading a `scriptPath` file and the runtime reading it.
- Runtime model substitution.
- Whether the declared effort is the effort the agent actually runs at.
- A sibling hook rewriting the tool input.
- How many Opus agents run at once, beyond the static bound. The bound is computed from the script text.

The `scriptPath` read window, runtime model substitution and the effort actually sent are not blocked, but ultraguard-eval observes them while a workflow runs and shows red when they differ from what the gate approved. Label honesty and whether an agent refrains from deciding are carried by the policy text only.

## Threat model

The subject is a cooperative Claude drafting Workflow scripts. The realistic failures are omission, helper patterns such as `.map(agent)`, and launches the gate cannot see. ultraguard is not a sandbox. Deliberate evasion is out of scope. Known residual paths are constructor chains, `Reflect`, `Proxy` and computed keys.

## Failure behavior

The gate fails closed. A bad stdin, a broken policy, a crash or a timeout blocks the launch (exit 2 with a message on stderr, plus `onFailure: "block"`). A clean script produces no output and exit 0. A violation produces a `deny` decision and exit 0. The gate never returns `allow` or `ask`, and never rewrites input.

The gate writes one record file per decision, pass or deny (see [Records](#records)). If the record of a clean launch cannot be written, the gate fails closed: exit 2, with the path and the error on stderr, and the launch is blocked. On a deny, the deny stands and a write error is ignored. Nothing is rotated or deleted. ultraguard makes no model call.

The SessionStart hook never blocks a session, and the commit reminder never blocks a command. If the SessionStart hook fails, it shows a message and exits 0. If the policy does not load, it says every Workflow launch will be blocked until the policy is fixed, and how to disable the gate.

ultraguard-eval failures are logged to the debug log and never affect a workflow. If drawing the pane fails, the pane shows the error instead.

## Changing the policy

Edit `policy/default.json`, then bump the patch version in `package.json`, `.claude-plugin/plugin.json` and the `ultraguard` entry in `.claude-plugin/marketplace.json`. A test checks that the policy is well-formed and that the three versions match. A broken policy is an internal error and blocks every launch. The guidance table at session start is rendered from the policy file, so it follows the change. The prose in `policy/guidance.md` does not, so update it by hand when a rule changes. The session context is clamped to 9,000 characters, and a test keeps the guidance and the table under 8,600, so a longer guidance fails `npm test` before it is cut.

## Development

```
npm test
```

Tests use `node:test` on Node 18, which is also the CI runtime, so use no Node 20 or newer APIs. There are no dependencies and no build step. `acorn` 8.19.0 is vendored in `vendor/acorn.mjs`, copied from its npm `dist/acorn.mjs`.

The ultraguard-eval module is checked with `claude plugin validate .` and `claude plugin test .`.

Keep the version in `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` in sync, and bump only the patch version unless asked otherwise. `CLAUDE.md` in the repository root also requires that a change passes `npm test` and is then verified live: load the plugin from the working copy with `claude --plugin-dir <path-to-this-repo>`, turn on ultracode with `/effort ultracode`, and confirm the behavior with prompts.
