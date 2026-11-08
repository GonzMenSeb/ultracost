# ultraguard delegation policy

The ultraguard gate checks every `agent()` in a Workflow script before the workflow runs. This text explicitly supersedes the built-in Workflow guidance that says "omit `model`", "omit effort" and "use 'low' for cheap mechanical stages".

## Tier by who owns the decision

Default efforts: Haiku medium, Sonnet high, Opus medium or high; xhigh for long build-test-debug loops.

## Haiku first for fixed-shape work

Measured: 5 fixed-shape tasks with a full spec matched the recorded answer in 30 of 30 Haiku 5.5 runs (medium, xhigh), 6-11x cheaper than Sonnet. Open-ended work did not transfer.

- `grunt:` or `code:` on Haiku medium when the spec names the inputs, the output fields and how to compute them, and a script can check the result.
- Leave nothing to decide: inputs by path, fields by name, no interpretation, no mutating flags; anything undetermined goes in `blocked_on`.
- If a plain script can do it, use a script, not an agent.
- Discovery, open-ended review, multi-source web extraction and anything that weighs evidence stay on `investigate:` (Sonnet) or above; `judge:` stays off Haiku.

## Hard rules

- Every `agent()` names a model and an effort. Never `low`, never `max`, never Fable or Mythos. Models are the aliases `opus`, `sonnet` and `haiku`.
- A stage may run one tier above its class (`investigate:` never above Sonnet). It runs below only under the session cap, or where the allowed-pairs table lists Sonnet for the condition.
- At most 3 Opus agents run at once. The gate counts from the script alone: thunks in an array literal add up; `X.map(...)` inside `parallel`, `pipeline` or `Promise.allSettled` counts size(X) × the agents in its body; `Promise.all`, `race` and `any` over more than one Opus agent cannot be counted (the others keep running after the first settles), so use `parallel`; awaited loop iterations run one at a time. It reads sizes of array literals, unmutated `const` arrays, `Array.from({ length: N })`, `.slice(0, N)` and `.slice(i, i + N)`. If it cannot count (unknown size, `args`, an unawaited agent promise, an agent pushed into an array, recursion) the Opus stages involved are denied as `FANOUT`. Sonnet and Haiku fan-outs of any size pass.
- `decide:`, `synth:` and `design:` run on Sonnet only for the simpler agents of a fan-out of more than 3 agents at once (all models counted) or unknown size.
- `judge:` runs on Sonnet only for one yes/no review, and only when `schema.properties` has exactly `pass`, `evidence` and `blocked_on` as below, inline. Findings lists and scores stay on Opus.
- Session cap: no stage uses a model above the session's (haiku < sonnet < opus; Fable counts as Opus; unreadable counts as Sonnet). On a Sonnet session the four Opus classes run on sonnet × {medium, high, xhigh} with no verdict schema or fan-out needed. On a Haiku session every stage runs on haiku at an effort the table lists for haiku; if none, ask the user to `/model sonnet` or `/model opus`.

## Judgment

- Unsure who owns the decision → go up a tier if an error would be costly or undetectable; fixed-shape work a script can check is not unsure.
- Parallelize only work that saves time in parallel.
- If `blocked_on` is set, re-run that stage as a `decide:` stage with the question.
- Pick the class by who owns the decision. A `decide:`, `judge:` or `design:` label (or a fanned-out `synth:` label) containing research, investigate, map, explore, survey, scan, search, find, audit, inventory or readiness is denied as `LABEL`: that work is `investigate:` on Sonnet. A fixed list, table or count over named inputs is `grunt:`.

## Script shape the gate accepts

- Launch with `script` or `scriptPath`, never by `name`, and never both.
- Call `agent` directly with exactly two arguments: a prompt and an object literal of options, with no spread. Never use `agent` as a value (`.map(agent)`, `const run = agent`) and never name anything else `agent`.
- `model` and `effort` are quoted string literals. `label` is a string or template literal starting with the class prefix, such as `'build: parser'`.
- No `agentType`. The name `workflow` must not appear anywhere (no call, variable, parameter or property shorthand): inline child workflows. No `globalThis`, `eval`, `Function` or `this`.
- Every Sonnet and Haiku stage, including the Opus classes when they run on Sonnet, carries an inline `schema` object literal whose inline `properties` include `blocked_on` exactly as below, so the agent reports an undecided question instead of deciding it. No shared schema const.

Verdict schema for `judge:` on Sonnet (exactly these keys, any order). Other Sonnet and Haiku stages use their own properties plus `blocked_on`:

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

The 3 most complex on Opus, the rest on Sonnet:

```js
await parallel([
  ...ranked.slice(0, 3).map(t => () => agent(`…${t.key}`, { label: `design: ${t.key}`, model: 'opus', effort: 'high' })),
  ...ranked.slice(3).map(t => () => agent(`…${t.key}`, { label: `design: ${t.key}`, model: 'sonnet', effort: 'high', schema: { /* with blocked_on */ } }))
])
```

Opus over a list of unknown size, 3 at a time:

```js
for (let i = 0; i < items.length; i += 3)
  await parallel(items.slice(i, i + 3).map(x => () => agent(`…${x}`, { label: `decide: ${x}`, model: 'opus', effort: 'high' })))
```
