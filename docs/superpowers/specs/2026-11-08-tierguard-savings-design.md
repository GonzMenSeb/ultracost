# tierguard 0.4.9: what a workflow saved

## Why

tierguard moves workflow agents off the session model: investigation to Sonnet, mechanical work to Haiku, simpler fan-out agents to Sonnet. Nothing shows what that saves. People want, per workflow:

1. Tokens saved.
2. On a subscription: how much of the 5-hour limit and of the weekly limit was saved, in the same percentages `/usage` shows.
3. On an API key: dollars saved.

All of it is measured against one counterfactual: every agent of the workflow running on the session's model at the session's effort. That is what Claude Code does when a stage pins nothing; 306 of 306 unpinned workflow agents in this machine's transcripts ran on the session model at the session effort.

Anti-goals: no model call in tierguard, no dependency, nothing that slows a workflow. A number tierguard cannot back is shown as unknown, never as zero, and percentages and dollars are never shown without their margin of error (tokens are the median).

## What we can and cannot observe

Observed exactly, by the mod (Claude Code 2.1.319 types):

- Every request: `turn.step` input has `model`, `effort` and `agentId` (absent on the main loop); its result (`yield* next(e)` returns it) has `usage` with `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` and `model`, or `null` when no response arrived.
- Which run an agent belongs to and the session model: `agent.spawn` gives `workflow.runId` and `parentModel`.
- The session effort: the main loop's `turn.step` input `effort`, taken as it was when the workflow launched.
- Subscription limits: `session.measure` (`e.rateLimits`) and `$.session.usage()` give `rateLimits[]` with `kind` (`five_hour`, `seven_day`), `percentUsed` (0 to 100, one decimal) and `resetsAt`. The list is empty off a subscription; that is how tierguard tells subscribers from API users.

Not observable: what the session model would have spent on the same task. No router, tool or paper publishes a counterfactual savings estimate with an error bound (researched 2026-11-08). Pricing the same tokens again at the expensive rate, which the original ultracost did, is wrong in both directions: in tierguard's own replays the real ratio ranged from 1.40× to 2.60× against a flat 2× price ratio.

## The estimator

From Smékal, "probe-calibrated shared shape" (arXiv 2608.25399, Sec 3.4): the cost of a task on configuration B equals its observed cost on configuration A times a ratio between the two configurations, learned from tasks run on both. The observed run is the "probe"; tierguard always has it. With one probe the paper measured a median error of 36% and needed a ×1.9 allowance to cover 90% of cases.

- **Configuration:** a (model family, effort) pair, such as `sonnet:high`. A **transition** is actual → baseline, such as `sonnet:high → opus:xhigh`.
- **Buckets:** each transition has three token ratios, the same three the limit meter weighs: output tokens (thinking included), fresh input (input and cache write, keeping the actual split between them) and cache reads. A single context ratio overstated the measured dollars by 42%, because cache reads grew 2.3× from Sonnet to Opus while cache writes grew 1.15× and cost 25× more per token.
- **Ratio of totals** (Cochran): `R = Σ baseline tokens / Σ actual tokens` over the paired agents, per bucket.
- **Identical configuration:** an agent already on the baseline configuration saves exactly 0 (LiteLLM's `observed_identical`).
- **Unknown:** an agent with no usage, a model with no price, an effort tierguard cannot read, or a transition with no ratio is left out and counted: "from 5 of 6 agents". Nothing is extrapolated.

### Where ratios come from

In this order, first match wins:

1. **Measured**, from the paired replays below.
2. **Chained:** a measured ratio into the same baseline family at another effort, times a published effort step within that family. Effort steps within one model agree across sources (Opus 5.5 xhigh ÷ high: 1.75, 2.55, 2.98, 2.34 across four sources, log sd 0.22), unlike steps between models.
3. **Prior:** published cost per task for both configurations, converted to a token ratio by dividing by the input-price ratio, applied to all three buckets, log sd = max(0.6, spread between sources). The same model at another effort uses the published effort step for that pair the same way (log sd = spread between sources, 0.4 with one; no between-run τ).

`data/published.json` holds the published figures with their sources; `data/replays.json` holds the measured pairs as numbers only (anonymized task kinds, no prompts, labels or paths). `scripts/calibrate.mjs` turns both into `data/ratios.json`, which ships.

### Margin of error

- **Shared ratio error:** each measured bucket ratio has a 90% Fieller interval with Student t at n − 1 degrees of freedom; its log half-width / 1.645 is the draw's standard deviation. If the interval is unbounded, that transition falls through to chained or prior.
- **Between-workflow error (τ):** the same transition saved 29% on long code mapping and 52% on short checks, so a single workflow carries an error of its own: `τ² = Σ (ln R_workflow − ln R_transition)² / max(1, W − T)` over the replayed workflows, floored at 0.15. Today τ = 0.30.
- **Per-agent error:** the sample sd of the paired agents' log ratios, mean-corrected (`− s²/2`) so its multiplier averages 1.
- **Monte Carlo:** 4,000 draws, seeded from the run key, so the pane shows the same numbers on every draw. Per draw: one deviate per run (τ), one per transition (shared ratio, all buckets), one per agent (all buckets).
- **Shown as ±:** the 90% range is lopsided, so ± uses its wider side (`max(median − 5th, 95th − median)`), which slightly overstates the uncertainty. "± = how far off the estimate can be, 9 times out of 10" is printed under the figures.

### Calibration results (replays run 2026-11-08)

22 agents from 3 past all-Opus workflows, replayed with the same prompts on Sonnet at high effort in repo snapshots at the original commits, through a tierguard-gated workflow. Cost $11.68 at list price.

| Transition | Task kind | Pairs | Opus ÷ Sonnet cost (90%) | Saved |
|---|---|---|---|---|
| sonnet:high → opus:high | web research | 4 | 2.60 (2.19–2.89) | 62% |
| sonnet:high → opus:medium | code mapping | 4 | 1.40 (1.23–1.99) | 29% |
| sonnet:high → opus:medium | yes/no checks | 14 | 2.08 (1.84–2.35) | 52% |

Findings the design relies on:

- Tokens saved can be negative: Sonnet at high wrote up to 1.85× the output of Opus at medium and still cost less.
- Chaining passed its one test: measured medium × published Opus high ÷ medium (1.45) predicted 2.31 for the high transition, inside the measured 2.19–2.89.
- Claude Code 2.1.299 transcripts write partial usage on a message's early records; any transcript reader takes the largest value per message id. The mod reads live events and is not affected.
- tierguard pins investigation to Sonnet at high, above an Opus-medium session's effort, which shrinks savings there. A policy question for later; not changed here.

## Dollars

List prices per million tokens, `data/prices.json` (platform.claude.com pricing, 2026-11-08):

| Family | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| Opus 5.5 | 4 | 20 | 0.20 | 5 |
| Sonnet 5.5 | 2 | 10 | 0.10 | 2.50 |
| Haiku 5.5 (prompt ≤ 100k) | 0.10 | 0.50 | 0.01 | 0.125 |
| Haiku 5.5 (prompt > 100k) | 0.50 | 2.50 | 0.05 | 0.625 |
| Fable 5.1 | 10 | 50 | 0.25 | 12.50 |

Cache writes are priced at the 5-minute rate (`usage` does not split them by TTL). Haiku's long-prompt rule applies per request on input plus cache read plus cache write. A model with no row is unknown; it never falls back to Opus. The rows cover the 5 generation (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1); an older model id is unknown.

## Limit percentages

The best reverse-engineering of the meter (she-llac.com) fits input and output at list-price ratios, cache writes at the input rate and cache reads free; another analysis says cache reads count 0.1×. tierguard calibrates its own rate:

- **Meter units** per request, in list-price dollars: `U = in·p_in + cw·p_in + out·p_out`, `C = cr·p_in`; weight `U + w·C`, `w` unknown in [0, 0.1].
- **Intervals:** every request of the session (main loop and agents) adds to running `U` and `C` per window. When a reading shows `percentUsed` up by Δ ≥ 0.1 with the same `resetsAt`, the interval `{Δ, U, C, at}` is stored and the counters restart. A changed `resetsAt` or a drop restarts the counters and stores nothing; so does an interval with `U = 0`.
- **Storage:** `$.store` key `meter:<session id>`, at most 200 intervals per window across all keys, older than 30 days dropped.
- **Rate:** `ΣΔ / Σ(U + w·C)` over the stored intervals. Each Monte Carlo draw takes `w` uniform in [0, 0.1] and a bootstrap resample of the intervals.
- **Readiness:** a window's figure shows once it has 5 intervals; before that the line reads "learning how fast your limit fills, 3 of 5 readings so far".

Usage from other sessions and claude.ai moves the meter without adding units here, so the figure reads high. Fable's separate weekly limit is not exposed and not shown.

## Display

Approved mockup: `.superpowers/brainstorm/481422-1794143604/content/savings-v4.html`, picks 1A, 2A, finished runs in the pane, toast. The row above the prompt is unchanged: green and red still mean only enforced or evaded.

**Workflow detail** (Enter on a run), after the four checks:

```
tierguard saved
compared with running every agent on Opus at high effort, your session's setting
  1.4% of your 5-hour limit        ± 0.6
  0.2% of your weekly limit        ± 0.1
  $2.32 at API prices              ± $0.59   62% of the $3.77 Opus would cost
  2.9M fewer tokens
  ± = how far off the estimate can be, 9 times out of 10
  from 4 of 4 agents · ratio measured on 22 replayed agents
```

then the agent table with one more column, "saved of 5-hour limit" (or "saved at API prices" when no limit figure shows), each agent's median.

- **Running:** the heading reads "tierguard saved so far".
- **API key:** the first line is "$2.32 off your API bill"; no limit lines.
- **Limit not calibrated:** "5-hour limit: learning how fast your limit fills, 3 of 5 readings so far".
- **More tokens:** "8.8M more tokens: sonnet read and wrote more, at a lower price per token".
- **Range below zero:** the first figure line ends with "this run may have saved nothing".
- **Sources:** "ratio measured on N replayed agents"; "ratio measured at high effort, adjusted with published figures for xhigh"; "no replay measured sonnet · high against opus · xhigh; using published figures, so ± is wide".
- **Coverage:** "from 5 of 6 agents: tierguard has no price for the model one agent ran on".
- **Nothing to estimate:** "every agent ran on your session's model and effort, so nothing was saved"; "tierguard could not read your session's model or effort, so it has no estimate".

**Run list:** a dim header row `workflow · id · agents · saved of 5-hour limit` (or `saved at API prices`). Green rows show `1.4% ± 0.6`, running rows `0.6% so far`, red rows keep their reason.

**Finished this session:** ended runs stay in the pane under "finished this session", with `done 14:51` in the agents column, until `/clear` or the session ends; Enter opens them. Cleared runs are not listed.

**Toast** at run end (8 s, the model never sees it):

- "tierguard: research-config finished as approved and saved about 1.4% of your 5-hour limit"
- "… saved about $2.32 at API prices" (limit not calibrated) or "… $2.32 off your API bill" (API key)
- "tierguard: research-config finished as approved; every agent ran on your session's model and effort"
- "tierguard: research-config finished, but <reason>" for a red run

Formatting: percentages with one decimal ("< 0.1%" below that), dollars with two, tokens as `2.9M` or `84k`.

## Records

`<tool_use_id>.eval.json` gains a `savings` block: per-agent usage by configuration, the baseline configuration, each transition's source and ratio, the seed, and the results. Meter intervals stay in `$.store`.

## Out of scope

A user's own ratios file, a replay-building script, a session or weekly total, per-class ratios, and changing tierguard's effort defaults.

## Limits

- Smékal's estimator is unproven across models; the replays are the only evidence for this workload, and they measure two transitions directly.
- With 3 replayed workflows the per-workflow ± is wide (τ = 0.30), close to Smékal's ×1.9.
- Effort labels have cost about 2× more from one Claude Code version to the next (anthropics/claude-code#78320); `data/ratios.json` records the version it was measured on.
- Limit figures carry the meter's unknowns: other usage on the account, the cache-read weight and server-side changes. A change of plan or account leaves old readings in use for up to 30 days; a request on a model with no price voids the reading it falls in.

## Version

0.4.9 (patch), in `package.json`, `.claude-plugin/plugin.json` and the marketplace entry.
