# tierguard delegation policy

The tierguard gate checks every `agent()` in a Workflow script before the workflow runs. This text explicitly supersedes the built-in Workflow guidance that says "omit `model`", "omit effort" and "use 'low' for cheap mechanical stages".

## Tier by who owns the decision

Use Haiku only when two agents would produce the same output and the result is mechanically checkable.

| Class (label prefix) | Owns | Base model | Effort allowed (default) |
|---|---|---|---|
| `decide:` | Open decisions: any choice, approach, software design, design of complex functionality, taste, diagnosing unclear or cross-cutting bugs | opus | medium · high · xhigh (medium/high) |
| `judge:` | Adversarial review, verification, verdicts, and any reading whose output feeds a verdict | opus | medium · high · xhigh (high) |
| `synth:` | Synthesizing complex, distributed, multi-faceted or conflicting work | opus | medium · high · xhigh (medium/high) |
| `design:` | Visual / UI design | opus | medium · high · xhigh (high) |
| `build:` | Decided implementation: well-defined modules, scoped UI implementation, "like this" examples, long build-test-debug loops | sonnet | medium · high · xhigh (high/xhigh) |
| `fix:` | Fixes whose cause or repro is known | sonnet | medium · high · xhigh (medium/high) |
| `combine:` | Merging groundwork toward one stated goal | sonnet | medium · high · xhigh (high/xhigh) |
| `code:` | Very simple, fully specified, mechanically checkable code; blind, well-specified UI implementation | haiku | Haiku: xhigh only (xhigh); Sonnet: medium · high · xhigh |
| `grunt:` | Non-code, zero-decision work: search, extraction, summaries, compaction, repetitive separable groundwork | haiku | Haiku: xhigh only (xhigh); Sonnet: medium · high · xhigh |

## Hard rules

- Every `agent()` names a model and an effort.
- Never `low` and never `max`, on any model. Never Fable or Mythos. Models are the aliases `opus`, `sonnet` and `haiku`.
- A stage may run one tier above its class, never below, except under the session cap.
- Session cap: no stage uses a model above the main session's model (haiku < sonnet < opus; a Fable session counts as Opus). On a Sonnet session, `decide:`, `judge:`, `synth:` and `design:` run on sonnet × {medium, high, xhigh} and Opus is denied. On a Haiku session, every stage runs on haiku × xhigh if the allowed-pairs table lists any haiku pair; if it lists none, no workflow can launch from a Haiku session, so ask the user to switch with `/model sonnet` or `/model opus` instead of drafting one. If the session model cannot be read, the session counts as Sonnet.
- Every Sonnet and Haiku agent's schema has `blocked_on`, so the agent reports an undecided question instead of deciding it.
- The allowed-pairs table below is the authoritative list of (model, effort) pairs per class. Haiku pairs apply only when that table lists them; otherwise `code:` and `grunt:` run on sonnet × {medium, high, xhigh}.

## Judgment

- Unsure → go up a tier if an error would be costly or undetectable.
- Parallelize only work that actually saves time when run in parallel; never force parallelism.
- If `blocked_on` is set, re-run that stage as a `decide:` stage with the question.
- The gate cannot see whether a label's class is honest. Pick the class by who owns the decision.

## Script shape the gate accepts

- Launch with `script` or `scriptPath`, never by `name`, and never both.
- Call `agent` directly with exactly two arguments: a prompt and an object literal of options, with no spread. Never use `agent` as a value (`.map(agent)`, `const run = agent`) and never name anything else `agent`.
- `model` and `effort` are quoted string literals. `label` is a string or template literal that starts with the class prefix, such as `'build: parser'`.
- No `agentType`. The name `workflow` must not appear anywhere (no call, variable, parameter or property shorthand): inline child workflows. No `globalThis`, `eval`, `Function` or `this`.
- Sonnet and Haiku stages carry an inline `schema` object literal whose inline `properties` include `blocked_on` exactly as below. Do not share a schema const. On a Sonnet session, or when the session model cannot be read, `decide:`, `judge:`, `synth:` and `design:` stages run on sonnet too, so they need the same schema.

```js
const r = await agent(`…`, {
  label: 'build: parser module',
  model: 'sonnet',
  effort: 'high',
  schema: {
    type: 'object',
    properties: {
      result: { type: 'string' },
      blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
    },
    required: ['result', 'blocked_on']
  }
})
if (r?.blocked_on) {
  const d = await agent(`Decide: ${r.blocked_on}`, {
    label: 'decide: parser question',
    model: 'opus',
    effort: 'high',
    schema: {
      type: 'object',
      properties: {
        decision: { type: 'string' },
        blocked_on: { type: ['string', 'null'], description: 'An open decision this stage must not make, or null' }
      },
      required: ['decision', 'blocked_on']
    }
  })
}
```
