# tierguard reference

This is the complete reference for tierguard 0.4.9. The [README](../README.md) explains what tierguard is for and why the rules exist. This page lists every rule, code, file and limit, and it is written to match the code in `src/`, `hooks/` and `policy/`.

## Contents

1. [Prerequisites and install](#prerequisites-and-install)
2. [How a launch is checked](#how-a-launch-is-checked)
3. [Policy](#policy)
   - [Classes](#classes)
   - [Models and efforts](#models-and-efforts)
   - [Sonnet exceptions for Opus classes](#sonnet-exceptions-for-opus-classes)
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
8. [tierguard-eval](#tierguard-eval)
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

- Claude Code 2.1.295 or later. The `onFailure` hook field needs it. The hook input shapes are pinned to Claude Code 2.1.319, and so is the tierguard-eval module, which needs a Claude Code with hooks modules.
- Node 18 or later on `PATH`. Hooks run with whatever `node` is found there.
- If `permissions.defaultMode` is `dontAsk`, add a `Workflow` entry to `permissions.allow`. The gate never returns `allow`. On a clean script it returns no decision, and your permission rules decide. Without the rule, `dontAsk` refuses every launch.

The SessionStart hook checks for the `dontAsk` case. It reads `settings.json` in the config directory (`CLAUDE_CONFIG_DIR` or `~/.claude`), then `.claude/settings.json` and `.claude/settings.local.json` in the session's working directory. If the last `permissions.defaultMode` it finds is `dontAsk` and no `permissions.allow` entry is `Workflow`, `Workflow()` or `Workflow(*)`, it shows a warning. The warning says to ignore it when you start Claude Code in another permission mode, such as `bypassPermissions`.

Install from the marketplace:

```
/plugin marketplace add GonzMenSeb/ultracost
/plugin install tierguard@ultracost
```

Install from a local copy:

```
claude --plugin-dir <path-to-this-repo>
```

Kill switch: `/plugin disable tierguard`, or set `disableAllHooks`. Both are visible settings changes.

## How a launch is checked

tierguard has two hooks and one hooks module. The plugin makes no model call anywhere.

| Part | File | When it runs | What it does |
|---|---|---|---|
| SessionStart hook | `hooks/session.mjs` | on `startup`, `resume`, `clear` and `compact` | Adds `policy/guidance.md` and a table of allowed pairs per class (rendered from `policy/default.json`) to the session context, clamped to 8,000 characters and 200 lines. Shows a `systemMessage` warning if the `dontAsk` rule is missing, if the guidance cannot be read, or if the policy fails to load. |
| PreToolUse hook (the gate) | `hooks/gate.mjs` | before every `Workflow` tool call, 15 second timeout, `onFailure: "block"` | Resolves the script, parses it, applies the rules, writes a gate record, and denies the launch or stays silent. |
| tierguard-eval module | `hooks/eval.tsx` | while workflows run | Observes only. Judges each running workflow against the gate record. See [tierguard-eval](#tierguard-eval). |

The gate collects problems from these stages and denies if the list is not empty. It reports all of them together, not only the first.

1. Environment (`ENV`): model and effort overrides in the environment.
2. Source (`SOURCE`): exactly one of `script` or `scriptPath`, and no `name`.
3. Parse and shape (`PARSE`, `SHAPE`, `SOURCE` for `workflow`): the script is parsed with the vendored acorn, and every `agent()` call is read for its label, model, effort and schema.
4. Rules (`PAIR`, `LABEL`): each stage's class, model and effort are checked against the allowed pairs for the session model, and the label word check runs.
5. Fan-out (`FANOUT`): the Opus concurrency bound. It runs only when the session model is Opus.

A clean script produces no output and exit code 0, plus a gate record on disk.

## Policy

The policy is in `policy/default.json`, and it is the only policy. The guidance Claude reads at session start is `policy/guidance.md`. It says it supersedes the built-in Workflow guidance that says to omit `model`, omit effort and use `low` for cheap mechanical stages.

### Classes

Every `agent()` label starts with a class prefix such as `build:`. The class says who owns the decision, and it decides which (model, effort) pairs are allowed. The table shows the pairs on an Opus session. Every listed model allows the efforts `medium`, `high` and `xhigh`, except Haiku, which allows only `xhigh`.

| Class | Owns | Opus session allows |
|---|---|---|
| `investigate:` | Web research, code mapping, and any reading that reports findings | `sonnet` |
| `decide:` | Open decisions: any choice, approach, software design, design of complex functionality, taste, diagnosing unclear or cross-cutting bugs | `opus`; `sonnet` only in a big fan-out |
| `judge:` | Adversarial review, verification and verdicts | `opus`; `sonnet` only with the verdict schema |
| `synth:` | Synthesizing complex, distributed, multi-faceted or conflicting work | `opus`; `sonnet` only in a big fan-out |
| `design:` | Visual and UI design | `opus`; `sonnet` only in a big fan-out |
| `build:` | Decided implementation: well-defined modules, scoped UI implementation, "like this" examples, long build-test-debug loops | `sonnet` or `opus` |
| `fix:` | Fixes whose cause or repro is known | `sonnet` or `opus` |
| `combine:` | Merging groundwork toward one stated goal | `sonnet` or `opus` |
| `code:` | Very simple, fully specified, mechanically checkable code; blind, well-specified UI implementation | `haiku` at `xhigh` only, or `sonnet` |
| `grunt:` | Non-code, zero-decision work: search, extraction, summaries, compaction, repetitive separable groundwork | `haiku` at `xhigh` only, or `sonnet` |

The Opus classes are `decide:`, `judge:`, `synth:` and `design:`. Opus is for design, decisions, synthesis and complex reviews. Haiku is for work where two agents would produce the same output and the result is mechanically checkable.

A label that does not start with a known class prefix is denied (`PAIR`, "Unknown class") with the list of valid classes. A label with no usable prefix at all is denied as `SHAPE`.

### Models and efforts

- Models are the aliases `opus`, `sonnet` and `haiku` only. Full ids, Fable and Mythos are denied (`PAIR`).
- Efforts are `medium`, `high` or `xhigh`. `low` and `max` are denied (`PAIR`).
- `haiku` is allowed only at `xhigh`, and on an Opus or Sonnet session only for classes whose pairs list it. Under the Haiku session cap, a class without its own Haiku pair also gets it; see [Session cap](#session-cap).
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

### Label check

A `decide:`, `judge:` or `design:` label whose name contains any of these words is denied with `LABEL`, on any session model:

`research`, `investigate`, `map`, `explore`, `survey`, `scan`, `search`, `find`, `audit`, `inventory`, `readiness`

The same applies to a `synth:` label, but only when the stage is inside a fan-out. A single `synth:` stage that names its research input, such as `synth: research synthesis`, is allowed, because Opus synthesizing research is the intended use.

How the check reads a label:

- It takes the text after the first `:`, replaces each `${…}` with a space, lowercases it, and splits it on anything that is not a letter.
- Words match as whole words. `finding` does not match `find`, and `mapping` does not match `map`.
- The message names the word it found and tells Claude to run that work as `investigate:` on Sonnet and to name a kept Opus stage by the decision, review, synthesis or design it owns.

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

If `blocked_on` is set in a stage's result, the guidance tells Claude to re-run that stage as a `decide:` stage with the question.

### The policy file

`policy/default.json` has three kinds of keys.

| Key | Content |
|---|---|
| `classes` | One entry per class. `owns` is text for the guidance table. `pairs` maps a model to a list of efforts. Optional `fanoutPairs` and `verdictPairs` have the same shape and add pairs under the two conditions above. |
| `limits` | `maxConcurrentOpus` (3) and `bigFanout` (3). Positive integers. Missing keys default to 3. |
| `labelCheck` | `words` (lowercase letters only), `classes` (checked everywhere), `fanoutClasses` (checked only inside a fan-out), `use` (the class that investigation moves to). |

`loadPolicy` validates the file. Models must be `haiku`, `sonnet` or `opus`. Efforts must be `medium`, `high` or `xhigh`, with no duplicates and no empty lists. `limits` accepts only the two known keys. Every class named in `labelCheck` must exist. A policy that fails validation is an internal error and blocks every launch.

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
| Haiku | Only Haiku pairs are allowed. A class without its own Haiku pair uses `haiku` at `xhigh`, as long as the policy lists a Haiku pair anywhere. If the policy lists none, every launch that has an `agent()` call is denied with one `PAIR` line that only the user can clear: "This session runs Haiku and no Haiku pair is allowed; switch with /model sonnet or /model opus." `FANOUT` is not checked. |

A `model` above the session model is denied as `PAIR`: `model "opus" is above the session model (sonnet).` The reason also says what the session runs, and when the model could not be read it says it is treated as Sonnet.

## Deny codes

| Code | Means |
|---|---|
| `SOURCE` | The script cannot be resolved or seen: no source, mixed sources, launch by name, `workflow` referenced, a source that is not a string, or a `scriptPath` that cannot be read. |
| `PARSE` | Parse error. The message is the parser's, with the line. |
| `SHAPE` | Misused `agent`, `globalThis`, `eval`, `Function` or `this`. Bad `agent()` arguments, options, literals, label, `agentType`, `schema` or `blocked_on`. |
| `PAIR` | Unknown class, model not allowed, effort `low`, `max` or not allowed for the class, `haiku` at a lower effort than `xhigh`, model above the session model, or no pair allowed for the class on this session. |
| `LABEL` | An Opus-class label reads like investigation (see [Label check](#label-check)). |
| `FANOUT` | More than 3 Opus agents can run at once, or the gate cannot count them: unknown list size, `args`, an agent promise that is never awaited, an agent pushed into an array, recursion. |
| `ENV` | A runtime env value overrides the pinned model or effort. See [Environment checks](#environment-checks). |

Example, for a script that fans out four Opus judges over a list of four files:

```
tierguard blocked this Workflow launch (1 problem). Fix and relaunch:
review.js:2 FANOUT [judge: ${…}] Up to 4 opus agents can run at once here; the limit is 3. Keep at most the 3 most complex on opus and run the rest on sonnet (items.slice(0, 3) on opus, items.slice(3) on sonnet), or batch them: for (let i = 0; i < items.length; i += 3) await parallel(items.slice(i, i + 3).map(...)).
judge: opus × {medium, high, xhigh}
Put exactly this in schema.properties of the inline schema object literal in each sonnet and haiku agent() call (a shared schema const is not accepted): blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
If this is your second deny for the same workflow, stop and ask the user.
```

### How a deny reason is built

The reason is addressed to Claude, so it gives what Claude needs to fix the script on the next try.

- **Header.** `tierguard blocked this Workflow launch (N problems)`, then `Fix and relaunch:`. If any problem is an `ENV` line or the Haiku session line, which only the user can clear, the header says so. When every problem is of that kind it says "Only the user can clear this; tell them and do not relaunch until they have:". When the problems are mixed it says to fix the script problems, and that the `ENV` lines and the Haiku session line need the user.
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

For every `Workflow` launch the gate writes one record, and tierguard-eval writes one for every run it saw. Both are small JSON files, one per launch. That keeps every file well under the 4 MiB limit of the mod's file API. Nothing is rotated or deleted.

```
<configDir>/tierguard/sessions/<session_id>/<tool_use_id>.gate.json
<configDir>/tierguard/sessions/<session_id>/<tool_use_id>.eval.json
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
| `stages` | one entry per `agent()` in source order, with `index`, `line`, `label`, `class`, `model`, `effort`, `inFanout`, `bigFanout` and `verdict` |
| `errors` | one entry per problem, with `code`, `line` and `message` |

`label` keeps each `${…}` of a template label as that literal text. `verdict` is true when the stage has a valid verdict schema. The fingerprint is computed by a pure-JS SHA-256 in `src/fingerprint.mjs`, so the mod computes the same value, and a test checks it against `node:crypto`.

If the record of a clean launch cannot be written, the gate fails closed (see [Failure behavior](#failure-behavior)). On a deny, a write error is ignored.

### Eval record

tierguard-eval writes this file for each workflow run it saw, next to the gate's file for the same launch. It is rewritten whole on every change, because the file API has no append. A run seen with no known launch is written as `<run id>.eval.json`. A run that ended stays in its file.

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
| `agents` | one entry per agent, with `agent_id`, `label`, `askedModel`, `ranModel`, `approved` (the matched stage's model and effort), `sent` (each distinct model and effort the agent's requests used), `done`, `ok` and `reason` |
| `savings` | per-agent usage by configuration, the baseline configuration, each transition's source and ratio, the seed, and the results (see [Savings](#savings)) |

## tierguard-eval

tierguard-eval is a hooks module in the same plugin (`hooks/eval.tsx`, with the logic in `src/eval.mjs`). It never denies or rewrites anything. It watches the agents a workflow spawns and the requests they send, and judges each running workflow with four deterministic checks. It uses no model.

### The four checks

A run is green only while all four hold. Otherwise it is red and names the first failure.

| # | Check | Passes when |
|---|---|---|
| 1 | Approved by the gate | A `pass` gate record exists for the launch and its fingerprint equals the one the mod computed from the script that ran. |
| 2 | Every agent matches the plan | Each agent's label matches an approved stage's label (each `${…}` matches any text), and the model family the agent resolved to (`opus`, `sonnet` or `haiku` in the model id) is that stage's model. |
| 3 | Every request as approved | Each distinct request the agent sends has the approved model family and exactly the approved effort. An effort lowered by Claude Code itself (Haiku `xhigh` sent as `high`) counts as a failure. |
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
| a `<task-notification>` for a known launch with status `completed`, `failed` or `killed` | The run ended. The mod also checks the last rows of the session when the main thread completes a turn, in case it missed one. |
| `/clear` | Every running run ends as `cleared`. |

### What it shows

- A band above the prompt, only while at least one workflow run is active: a square (red if any active run is red, else green), the bold title `tierguard-eval` and a dim summary such as `2 running · 1 red`. Selecting it opens the pane. `/tierguard` opens it too. The band yields to a survey.
- A pane with one row per active run, in aligned columns: a square, the workflow's name, a short run id, the Opus, Sonnet and Haiku counts in their tier colors, and either `as approved` or the first failure. Enter on a row shows the four checks with ✓ or ✗ (a passing check adds its detail: the gate's approval time, the agent and request counts, the peak Opus count), then a table of agents with the approved model and effort, what it ran on, and the reason when red. Esc goes back, then closes.

### Limits

- Claude Code draws one plugin band above the prompt. A plugin whose hook draws its own band there without keeping the one beneath it (Cognee's memory row does) hides tierguard's band; `/tierguard` still opens the pane.
- The band counts running workflows. A run that ends leaves the band, stays in its `.eval.json`, and stays in the pane under "finished this session" (see [Savings](#savings)). The mod keeps the 20 most recently ended runs in memory. A launch the gate refused is not a run: it is only in the gate's record. Workflows still being drafted are not shown, because nothing reliably marks when drafting starts or ends.
- If a workflow is running and there is no `tierguard-eval` button, tierguard is not loaded in that session.
- Check 1 compares the script's text at two moments, the gate's read and the mod's read. It cannot tell what a sibling hook or the runtime did to the script after that.
- It sees the models and efforts in requests that Claude Code sends. It does not see what a provider does after receiving them.

## Savings

For each tracked run, tierguard shows what it saved against one counterfactual: every agent of the workflow running on the session's model at the session's effort. That is what Claude Code does when a stage pins nothing. The figures are the percent of the 5-hour and weekly limits (subscribers), dollars at API prices (API key users) and tokens. Percentages and dollars carry a margin of error; the token figure is the median. A figure tierguard cannot back is shown as unknown, never as 0. There is no model call, and nothing on the request path waits on the estimate.

Observed exactly, by the mod:

- Every request an agent sends: its model, effort and agent id, and the usage in the response (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`).
- The run an agent belongs to and the session model, from the agent's spawn.
- The session effort, as it was when the workflow launched.
- On a subscription, the `five_hour` and `seven_day` limits with `percentUsed` (0 to 100, one decimal) and `resetsAt`. The list is empty off a subscription, which is how tierguard tells subscribers from API key users.

What the session model would have spent on the same task is not observable, so it is estimated. Pricing the same tokens again at the expensive rate is wrong in both directions: in the replays the real cost ratio ranged from 1.40 to 2.60 against a flat 2× price ratio.

### The estimator

The cost of a task on configuration B equals its observed cost on configuration A times a ratio between the two, learned from tasks run on both (Smékal, "probe-calibrated shared shape", arXiv 2608.25399, Sec 3.4). The observed run is the probe. With one probe the paper measured a median error of 36% and needed a ×1.9 allowance to cover 90% of cases.

- **Configuration:** a (model family, effort) pair, such as `sonnet:high`. A transition is actual to baseline, such as `sonnet:high>opus:xhigh`.
- **Buckets:** each transition has three token ratios, the same three the limit meter weighs: `output` (thinking included), `fresh` (input plus cache write, keeping the actual split between them) and `read` (cache reads).
- **Why not one context ratio:** a single context ratio overstated the measured dollars by 42%. In the Opus-at-high replays cache reads grew 2.3× from Sonnet to Opus while cache writes grew 1.15× and cost 25× more per token.
- **Ratio of totals:** `R = Σ baseline tokens / Σ actual tokens` over the paired agents, per bucket.
- **Identical configuration:** an agent already on the baseline configuration saves exactly 0.
- **Unknown:** an agent with no usage, a model with no price, an effort tierguard cannot read, or a transition with no ratio is left out and counted, as in "from 5 of 6 agents". Nothing is extrapolated to it.

### Where ratios come from

In this order, first match wins:

1. **Measured**, from the paired replays.
2. **Chained:** a measured ratio into the same baseline family at another effort, times a published effort step within that family. Effort steps within one model agree across sources (Opus 5.5 xhigh ÷ high: 1.75, 2.55, 2.98 and 2.34 across four sources, log sd 0.22), unlike steps between models.
3. **Prior:** published cost per task for both configurations, converted to a token ratio by dividing by the input-price ratio, applied to all three buckets, with log sd = max(0.6, spread between sources). The same model at another effort (an Opus agent at medium in an Opus session at high) uses the published effort step for that pair, applied the same way, with log sd = the spread between sources (0.4 with one source) and no between-run τ.

Chaining passed its one test: measured Opus medium times the published Opus high ÷ medium (1.45) predicted 2.31 for the high transition, inside the measured 2.19 to 2.89.

### Margin of error

- **Shared ratio error:** each measured bucket ratio has a 90% Fieller interval with Student t at n − 1 degrees of freedom. Its log half-width ÷ 1.645 is the draw's standard deviation. If the interval is unbounded, that transition falls through to chained or prior.
- **Between-workflow error (τ):** the same transition saved 29% on long code mapping and 52% on short checks, so a workflow carries an error of its own: `τ² = Σ (ln R_workflow − ln R_transition)² / max(1, W − T)` over the replayed workflows, floored at 0.15. Today τ = 0.30.
- **Per-agent error:** the sample sd of the paired agents' log ratios, mean-corrected (`− s²/2`) so its multiplier averages 1.
- **Monte Carlo:** 4,000 draws, seeded from the run key, so the pane shows the same numbers on every draw. Per draw: one deviate per run (τ), one per transition (shared ratio, all buckets) and one per agent (all buckets).
- **Shown as ±:** the 90% range is lopsided, so ± uses its wider side, `max(median − 5th, 95th − median)`. That slightly overstates the uncertainty. The pane prints "± = how far off the estimate can be, 9 times out of 10" under the figures.

### Data files and calibration

| File | Content |
|---|---|
| `data/replays.json` | The 22 measured pairs, as numbers only: workflow, task kind, `from` and `to` configuration, and the `input`, `output`, `cacheRead` and `cacheWrite` tokens of the actual and baseline run. No prompts, labels or paths. Records the Claude Code version (2.1.319) and the date. |
| `data/published.json` | Published cost per task by family and effort, from four sources, with their URLs. Costs are compared only inside one source, never across sources. |
| `data/prices.json` | List prices per million tokens by family (see [Dollars](#dollars)). |
| `data/ratios.json` | Generated from the three files above. It ships with the plugin: `tau`, `pooledAgentSd`, the `measured` transitions, the effort `steps` and the `priors`. |

```
node scripts/calibrate.mjs
node scripts/calibrate.mjs --check
```

The first rewrites `data/ratios.json` from the other three files. `--check` writes nothing and exits 1 with "data/ratios.json is stale: run node scripts/calibrate.mjs" when the file on disk differs from what the data would produce.

`data/ratios.json` groups pairs by transition, not by task kind. Its `sonnet:high>opus:medium` entry pools the 18 pairs of both Opus-medium workflows: 90% interval 1.45 to 2.10 on dollars, ratio 1.59.

### Dollars

List prices per million tokens in `data/prices.json` (platform.claude.com pricing, 2026-11-08):

| Family | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| Opus 5.5 | 4 | 20 | 0.20 | 5 |
| Sonnet 5.5 | 2 | 10 | 0.10 | 2.50 |
| Haiku 5.5 (prompt ≤ 100k) | 0.10 | 0.50 | 0.01 | 0.125 |
| Haiku 5.5 (prompt > 100k) | 0.50 | 2.50 | 0.05 | 0.625 |
| Fable 5.1 | 10 | 50 | 0.25 | 12.50 |

Cache writes are priced at the 5-minute rate, because `usage` does not split them by TTL. Haiku's long-prompt rule applies per request on input plus cache read plus cache write. A model with no row is unknown; it never falls back to Opus. The rows cover the 5 generation (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1): an older model such as `claude-opus-4-1` is unknown.

### Limit percentages

The best public reverse-engineering of the meter fits input and output at list-price ratios, cache writes at the input rate and cache reads free; another analysis says cache reads count 0.1×. tierguard calibrates its own rate.

- **Meter units** per request, in list-price dollars: `U = in·p_in + cw·p_in + out·p_out` and `C = cr·p_in`. The weight is `U + w·C`, with `w` unknown in [0, 0.1].
- **Intervals:** every request of the session, main loop and agents, adds to running `U` and `C` per window. When a reading shows `percentUsed` up by Δ ≥ 0.1 with the same `resetsAt`, the interval `{Δ, U, C, at}` is stored and the counters restart. A changed `resetsAt` or a drop restarts the counters and stores nothing. So does an interval with `U = 0`.
- **Storage:** `$.store` key `meter:<session id>`, at most 200 intervals per window across all keys, intervals older than 30 days dropped. Sessions write separate keys, and all keys are merged on load. On start, keys whose readings are all older than 30 days are deleted.
- **Rate:** `ΣΔ / Σ(U + w·C)` over the stored intervals. Each Monte Carlo draw takes `w` uniform in [0, 0.1] and a bootstrap resample of the intervals.
- **Readiness:** a window's figure shows once it has 5 intervals. Before that the line reads "learning how fast your limit fills, 3 of 5 readings so far".

Usage from other sessions and claude.ai moves the meter without adding units here, so the figure reads high. Fable's separate weekly limit is not exposed and not shown.

### What the pane shows

The row above the prompt is unchanged: green and red still mean only enforced or evaded.

Workflow detail (Enter on a run), after the four checks:

```
tierguard saved
compared with running every agent on Opus at high effort, your session's setting
  1.4% of your 5-hour limit        ± 0.6
  0.2% of your weekly limit        ± 0.1
  $2.32 at API prices              ± $0.59   62% of the $3.77 Opus would cost
  2.9M fewer tokens
  ± = how far off the estimate can be, 9 times out of 10
  from 4 of 4 agents · ratio measured on 4 replayed agents
```

The agent table gets one more column, "saved of 5-hour limit" (or "saved at API prices" when no limit figure shows), with each agent's median.

- **Running:** the heading reads "tierguard saved so far".
- **API key:** the first line is "$2.32 off your API bill", with no limit lines.
- **Limit not calibrated:** "5-hour limit: learning how fast your limit fills, 3 of 5 readings so far".
- **More tokens:** "8.8M more tokens: sonnet read and wrote more, at a lower price per token".
- **Range below zero:** the first figure line ends with "this run may have saved nothing".
- **Sources:** "ratio measured on N replayed agents"; "ratio measured at high effort, adjusted with published figures for xhigh"; "no replay measured sonnet · medium against opus · high; using published figures, so ± is wide".
- **Coverage:** "from 5 of 6 agents: tierguard has no price for the model one agent ran on".
- **Nothing to estimate:** "every agent ran on your session's model and effort, so nothing was saved"; "tierguard could not read your session's model or effort, so it has no estimate".

Run list: a dim header row `workflow · id · agents · saved of 5-hour limit` (or `saved at API prices`). Green rows show `1.4% ± 0.6`, running rows `0.6% so far`, red rows keep their reason.

Finished this session: ended runs stay in the pane under "finished this session", with `done 14:51` in the agents column, until `/clear` or the session ends. Enter opens them. Cleared runs are not listed.

Toast at run end (8 seconds; the model never sees it):

- "tierguard: research-config finished as approved and saved about 1.4% of your 5-hour limit"
- "… saved about $2.32 at API prices" (limit not calibrated) or "… $2.32 off your API bill" (API key)
- "tierguard: research-config finished as approved; every agent ran on your session's model and effort"
- "tierguard: research-config finished, but <reason>" for a red run

Percentages have one decimal ("< 0.1%" below that), dollars two, tokens are written `2.9M` or `84k`.

### Calibration results

Replays run 2026-11-08: 22 agents from 3 past all-Opus workflows, replayed with the same prompts on Sonnet at high effort in repo snapshots at the original commits, through a tierguard-gated workflow. The 22 Sonnet runs in `data/replays.json` cost $11.16 at list price.

| Transition | Task kind | Pairs | Opus ÷ Sonnet cost (90%) | Saved |
|---|---|---|---|---|
| `sonnet:high>opus:high` | web research | 4 | 2.60 (2.19–2.89) | 62% |
| `sonnet:high>opus:medium` | code mapping | 4 | 1.40 (1.23–1.99) | 29% |
| `sonnet:high>opus:medium` | yes/no checks | 14 | 2.08 (1.84–2.35) | 52% |

- Tokens saved can be negative: on code mapping Sonnet at high wrote 1.86× the output of Opus at medium and still cost less.
- Claude Code 2.1.299 transcripts write partial usage on a message's early records, so a transcript reader must take the largest value per message id. The mod reads live events and is not affected.
- tierguard pins investigation to Sonnet at high, above an Opus-medium session's effort, which shrinks savings there. The policy is unchanged.

### Savings limits

- Smékal's estimator is unproven across models. The replays are the only evidence for this workload, and they measure two transitions directly.
- With 3 replayed workflows the per-workflow ± is wide (τ = 0.30), close to Smékal's ×1.9.
- Effort labels have cost about 2× more from one Claude Code version to the next (anthropics/claude-code#78320). `data/ratios.json` records the version it was measured on.
- Limit figures carry the meter's unknowns: other usage on the account, the cache-read weight and server-side changes. A change of plan or account leaves readings from the old limit in use for up to 30 days. A request on a model with no price voids the reading it falls in.
- Not included: a user's own ratios file, a replay-building script, a session or weekly total, per-class ratios.

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

### Not checked: not visible to tierguard

- `ANTHROPIC_DEFAULT_*` model variables. With `ANTHROPIC_DEFAULT_HAIKU_MODEL` set, `haiku` can resolve to a model without `xhigh`.
- `availableModels`
- a hooks-module request effort override
- the automatic downgrade after an API 400 "Invalid effort level"
- skill or ultrathink effort layers inside an agent's own turns

### Haiku and `xhigh`

On first-party Anthropic, `haiku` resolves to `claude-haiku-5-5`, which supports `xhigh`. On Bedrock, Vertex, Foundry, Mantle, `anthropic_aws`, `anthropic_google_cloud` and gateway providers, or with `ANTHROPIC_DEFAULT_HAIKU_MODEL` set, `haiku` can resolve to `claude-haiku-4-5`, which has no `xhigh`. Claude Code then sends `high`. The gate does not check this. tierguard-eval does: a request sent at a lower effort than approved turns the run red.

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

The `scriptPath` read window, runtime model substitution and the effort actually sent are not blocked, but tierguard-eval observes them while a workflow runs and shows red when they differ from what the gate approved. Label honesty and whether an agent refrains from deciding are carried by the policy text only.

## Threat model

The subject is a cooperative Claude drafting Workflow scripts. The realistic failures are omission, helper patterns such as `.map(agent)`, and launches the gate cannot see. tierguard is not a sandbox. Deliberate evasion is out of scope. Known residual paths are constructor chains, `Reflect`, `Proxy` and computed keys.

## Failure behavior

The gate fails closed. A bad stdin, a broken policy, a crash or a timeout blocks the launch (exit 2 with a message on stderr, plus `onFailure: "block"`). A clean script produces no output and exit 0. A violation produces a `deny` decision and exit 0. The gate never returns `allow` or `ask`, and never rewrites input.

The gate writes one record file per decision, pass or deny (see [Records](#records)). If the record of a clean launch cannot be written, the gate fails closed: exit 2, with the path and the error on stderr, and the launch is blocked. On a deny, the deny stands and a write error is ignored. Nothing is rotated or deleted. tierguard makes no model call.

The SessionStart hook never blocks a session. If it fails, it shows a message and exits 0. If the policy does not load, it says every Workflow launch will be blocked until the policy is fixed, and how to disable the gate.

tierguard-eval failures are logged to the debug log and never affect a workflow. If drawing the pane fails, the pane shows the error instead.

## Changing the policy

Edit `policy/default.json`, then bump the patch version in `package.json`, `.claude-plugin/plugin.json` and the `tierguard` entry in `.claude-plugin/marketplace.json`. A test checks that the policy is well-formed and that the three versions match. A broken policy is an internal error and blocks every launch. The guidance table at session start is rendered from the policy file, so it follows the change. The prose in `policy/guidance.md` does not, so update it by hand when a rule changes.

## Development

```
npm test
```

Tests use `node:test` on Node 18, which is also the CI runtime, so use no Node 20 or newer APIs. There are no dependencies and no build step. `acorn` 8.19.0 is vendored in `vendor/acorn.mjs`, copied from its npm `dist/acorn.mjs`.

The tierguard-eval module is checked with `claude plugin validate .` and `claude plugin test .`.

Keep the version in `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` in sync, and bump only the patch version unless asked otherwise. `CLAUDE.md` in the repository root also requires that a change passes `npm test` and is then verified live: load the plugin from the working copy with `claude --plugin-dir <path-to-this-repo>`, turn on ultracode with `/effort ultracode`, and confirm the behavior with prompts.
