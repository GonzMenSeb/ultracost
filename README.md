# tierguard

tierguard is a Claude Code plugin that checks every `Workflow` launch before it runs. It is a strict-subset static gate: it reads the script, and it denies the launch if any `agent()` call breaks the delegation policy. It also prints the policy text at session start so Claude drafts compliant scripts the first time.

It is a fork of [danielkremen818/ultracost](https://github.com/danielkremen818/ultracost), MIT licensed. The engine was rewritten. The hook wiring pattern, test discipline and attribution were kept.

## Why

Workflow agents inherit the main session's model and effort unless the script pins them. Every stage then runs at top-tier cost and latency. tierguard makes each stage name a model and an effort that fit who owns the decision.

## Install

From the marketplace:

```
/plugin marketplace add GonzMenSeb/ultracost
/plugin install tierguard@ultracost
```

From a local copy:

```
claude --plugin-dir <path-to-this-repo>
```

## Prerequisites

- Claude Code 2.1.295 or later (needed for `onFailure`). The hook input shapes are pinned to 2.1.319.
- Node 18 or later on `PATH`. Hooks run with whatever `node` is found there.
- If `permissions.defaultMode` is `dontAsk`, add a `Workflow` entry to `permissions.allow`. The gate never returns `allow`. On a clean script it returns no decision, and your permission rules decide. Without the rule, `dontAsk` refuses every launch.

## The policy in brief

Every `agent()` label starts with a class prefix such as `build:`. The class decides which (model, effort) pairs are allowed.

- `decide:`, `judge:`, `synth:`, `design:` run on Opus.
- `build:`, `fix:`, `combine:` run on Sonnet or Opus.
- `code:`, `grunt:` run on Sonnet, or on Haiku at `xhigh` only.
- Efforts are `medium`, `high` or `xhigh`. Never `low`, never `max`.
- Models are the aliases `opus`, `sonnet` and `haiku` only. Full ids, Fable and Mythos are denied.
- Every Sonnet and Haiku stage needs an inline `schema` with a `blocked_on` property, so the agent reports an open question instead of deciding it.

The classes and pairs live in `policy/default.json`. The guidance Claude reads lives in `policy/guidance.md`. This README does not repeat the full table.

### Session cap

No stage may use a model above the main session's model (haiku < sonnet < opus). The gate reads the session model from the main thread's `api-request` row written after the last main-thread assistant row. Claude Code writes that row when each request is built, so it names the model of the request in flight, including right after `/model`. If there is no such row, the gate falls back to the last main-thread assistant row, which is normally the previous response. `api-request` rows depend on `tengu_elegant_meadow` (env `CLAUDE_CODE_ELEGANT_MEADOW`, default true). Without them, a `/model` command after the last main-thread assistant row makes the gate use the lower of that row's model and the command's model. If that row is `<synthetic>`, has an ambiguous model name or is absent, the command's model is used as is. A Fable session counts as Opus. Torn or unparsable lines are skipped, and the gate uses the last readable main-thread row. Anything else unreadable counts as Sonnet: an empty `transcript_path`, a diskless or remote session, or a `<synthetic>` row or ambiguous model name with no `api-request` row and no `/model` command. The model name Claude Code reports after a server-side refusal fallback is unverified.

On a Sonnet session, the Opus classes run on Sonnet instead, and Opus pairs are denied. On a Haiku session, only Haiku pairs are allowed. If the policy lists none, every launch is denied.

## Deny codes

| Code | Means |
|---|---|
| `SOURCE` | The script cannot be resolved or seen: no source, mixed sources, launch by name, `workflow` referenced. |
| `PARSE` | Parse error. |
| `SHAPE` | Misused `agent`, `globalThis`, `eval`, `Function` or `this`. Bad `agent()` arguments, options, literals, label, `agentType`, `schema` or `blocked_on`. |
| `PAIR` | Unknown class, model not allowed, effort `low`, `max` or not allowed for the class, model above the session model. |
| `ENV` | A runtime env value overrides the pinned model or effort. |

A deny gives `file:line CODE message` for each failing stage and lists that class's allowed pairs, as long as the reason fits Claude Code's 2,000-character, 20-line limit. A stage with no usable class gets the table of all classes' allowed pairs instead. When the reason is too long, it falls back in this order: one line per stage with the file name on each line; then one line per stage with the file name moved to the header and each line starting with `:line`; then identical problems merged across stages into one line with no stage label, listing every line number or range, first with the file name on each line and then with it in the header; then only the first merged problems, each clipped to 280 characters, followed by `…and N more at lines X (CODES)`. The reason ends with: "If this is your second deny for the same workflow, stop and ask the user."

### Launch by name

Launches by `name` are always denied, because the gate cannot see the script. The message is:

> Launching a workflow by name is not allowed. For a saved workflow, relaunch with scriptPath pointing at its file. For a built-in workflow, write your own compliant workflow for the same job and launch it with script.

Exactly one of `script`, `scriptPath` or `name` may be given. Mixed sources are denied. Claude Code itself rejects an unknown `name` and a bare `resumeFromRunId` before any hook runs.

### Child workflows

Any reference to `workflow` is denied. Inline the child instead. This closes child-file races, aliasing and cycles.

## Environment checks

The gate denies (ENV) when:

- `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` is set to anything other than empty or `inherit`.
- `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is truthy (`1`, `true`, `yes` or `on`, as Claude Code reads it; any other value, such as a model name, leaves it off).
- `CLAUDE_CODE_EFFORT_LEVEL` is set to any non-empty value. This includes `auto` and `unset`, which also override per-agent effort.

Values are compared trimmed and case-insensitively. Each message names the variable, says it may come from the environment or a settings `env` block, and tells Claude to ask the user to remove it and restart Claude Code instead of relaunching.

Not checked. In Claude Code 2.1.319 these do not override an explicit `agent()` effort:

- `CLAUDE_CODE_SUBAGENT_EFFORT`
- `effortLevel` in settings
- `modelSettings.<model>.effortLevel`
- the session `/effort` level, including ultracode

These clamp an explicit effort downward, so the agent can run lower than declared:

- `maxEffortLevel`
- `modelSettings.<model>.maxEffortLevel`
- an organization per-model max effort

Not checked, and not visible to tierguard:

- `ANTHROPIC_DEFAULT_*` model variables. With `ANTHROPIC_DEFAULT_HAIKU_MODEL` set, `haiku` can resolve to a model without `xhigh`.
- `availableModels`
- a hooks-module request effort override
- the automatic downgrade after an API 400 "Invalid effort level"
- skill or ultrathink effort layers inside an agent's own turns

On first-party Anthropic, `haiku` resolves to `claude-haiku-5-5`, which supports `xhigh`. On Bedrock, Vertex, Foundry, Mantle, `anthropic_aws`, `anthropic_google_cloud` and gateway providers, or with `ANTHROPIC_DEFAULT_HAIKU_MODEL` set, `haiku` can resolve to `claude-haiku-4-5`, which has no `xhigh`. Claude Code then sends `high`. tierguard does not check this.

To see the effort an agent actually ran at, read `params.output_config.effort` on the `api-request` rows in its `agent-*.jsonl` transcript. `agent-*.meta.json` does not record effort.

`CLAUDE_CODE_SUBAGENT_MODEL` is allowed. Since Claude Code 2.1.251 it ranks below the per-call model.

## Scope and limits

Only `Workflow` launches are gated. Agent tool calls are not gated.

Not enforceable:

- Whether a class label is honest.
- Whether a lower-tier agent really refrains from deciding.
- The window between the gate reading a `scriptPath` file and the runtime reading it.
- Runtime model substitution.
- Whether the declared effort is the effort the agent actually runs at.
- A sibling hook rewriting the tool input.

Only the `scriptPath` read window and runtime model substitution can be checked, by reading agent transcripts by hand. Label honesty and whether an agent refrains from deciding are carried by the policy text only.

## Threat model

The subject is a cooperative Claude drafting Workflow scripts. The realistic failures are omission, helper patterns such as `.map(agent)`, and launches the gate cannot see. tierguard is not a sandbox. Deliberate evasion is out of scope. Known residual paths are constructor chains, `Reflect`, `Proxy` and computed keys.

## Failure behavior

The gate fails closed. A bad stdin, a broken policy, a crash or a timeout blocks the launch (exit 2 with a message on stderr, plus `onFailure: "block"`). A clean script produces no output and exit 0. A violation produces a `deny` decision and exit 0. The gate never returns `allow` or `ask`, and never rewrites input. It keeps no state and writes no files.

Kill switch: `/plugin disable tierguard`, or set `disableAllHooks`. Both are visible settings changes.

## Changing the policy

Edit `policy/default.json`, then bump the patch version in `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`. A test checks the policy is well-formed and the versions match. A broken policy is an internal error and blocks every launch.

## Development

```
npm test
```

Tests use `node:test` on Node 18, which is also the CI runtime. There are no dependencies. `acorn` is vendored in `vendor/acorn.mjs`.

## License

MIT. See `LICENSE` and `NOTICE`.
