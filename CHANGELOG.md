# Changelog

## 0.4.11 - ultraguard

- The workflow detail in ultraguard-eval groups agents under the workflow's phases, like Claude Code's own workflow view: a foldable row per phase (caret, a green or red circle, title, state, model mix, red count and the saved figure of its agents) with the agents indented below, a green ✓ or a red ✗ per agent, and the red reason on its own line. Enter folds a phase, `a` opens or folds all, `b` goes back. Workflows without phases keep the flat table. The tree sits above the saved block.
- The gate reads the phases from the script (the `meta.phases` titles, each agent's literal `phase` option, else the nearest earlier `phase('…')` call) and writes `phases` and each stage's `phase` to the gate record. An agent that cannot be placed goes under "phase unknown". The eval record gains `phases` and each agent's `phase`.
- `estimateRun` takes `groups` and returns per-group medians of per-draw sums, so a phase shows what its agents saved.
- When the pane is narrow, the label column gives room to the saved figure first.
- The tokens line joins families with commas: "Haiku, Opus and Sonnet read and wrote more…".
- The focused run in the ultraguard-eval list is drawn inside a rounded outline with a bold name instead of the engine's inverted fill. The row's button is now only its circle (the engine still inverts that one cell), so Enter on the focused row opens it and a click on the circle does; every row keeps the room of the outline, three lines tall, so the list does not move when the focus does.
- New colors, only in characters: models and efforts run gold, orange and red (Haiku, Sonnet, Opus), deepening with effort, with the model bold and the effort dim; the saved percentage of the 5-hour limit runs from aqua at 1% through azure at 10% to violet at 20%, on the list, the detail, the agent rows and the phase rows. See `src/palette.mjs`.
- Status glyphs are hollow: `□` for a run and `○` for a phase, in green or red. Check marks are unchanged.
- The finish toast stays plain text, because `$.ui.toast` takes only a string.
- The README picture shows a real workflow on a Fable session with an Opus, a Sonnet and a Haiku role, and two more agents, so it shows every agent of a workflow.

## 0.4.10 - ultraguard

- Renamed the project to ultraguard: the plugin, the marketplace, the repository, the `/ultraguard` command, the `ultraguard-eval` module and the record directory `<configDir>/ultraguard/sessions/`. Records written under the previous directory are not read; move them to the new one to keep them.

## 0.4.9 - ultraguard

- ultraguard-eval shows what each tracked run saved against running every agent on the session's model at the session's effort: percent of the 5-hour and weekly limits (subscribers), dollars at API prices (API key users) and tokens; percentages and dollars carry a ± margin of error (90%, 4,000 seeded draws), tokens are a median. A figure it cannot back is shown as unknown, never as 0.
- The estimate is probe-calibrated: the observed run times a ratio between configurations, in three token buckets (output, fresh input, cache reads). Ratios are measured, chained from a measured ratio with a published effort step, or taken from published figures. The error combines the shared ratio (Fieller interval), a between-workflow τ of 0.30 and a per-agent spread.
- `data/ratios.json` comes from 22 agents replayed on Sonnet at high against their Opus runs, measuring `sonnet:high>opus:high` and `sonnet:high>opus:medium`. `data/replays.json`, `data/published.json` and `data/prices.json` hold the inputs; `node scripts/calibrate.mjs` rebuilds the ratios and `--check` fails when they are stale.
- Limit percentages use a meter that learns how fast your limit fills from your own `/usage` readings, stored in `$.store` under `meter:<session id>` (at most 200 intervals per window, 30 days). A window's figure shows after 5 readings.
- The pane gains a "saved" block in the workflow detail, a saved column in the run list, runs kept under "finished this session" until `/clear`, and a toast at run end. The row above the prompt is unchanged.
- The eval record gains a `savings` block.

## 0.4.8 - ultraguard

- The ultraguard-eval pane matches the approved design: aligned columns, Opus, Sonnet and Haiku in their tier colors, passing checks with their detail (gate approval time, agent and request counts, peak Opus), an agent table with approved and ran-on model and effort, and key hints at the bottom.
- README rewritten for people looking to keep ultracode workflows under control: the problem, install, how the rules save tokens, and how to know they were enforced, with new diagrams and real captures in `assets/`. The reference moved to `docs/reference.md`.
- Documented that Claude Code shows one plugin band above the prompt, so another plugin's band can hide ultraguard's; `/ultraguard` still opens the pane.

## 0.4.7 - ultraguard

- At most 3 Opus agents may run at once in a workflow. The gate bounds the concurrency from the script (array literals, `parallel`, `pipeline`, `Promise.allSettled`, `.map` over known sizes, `.slice`, `.then` chains, local helpers; `Promise.all`, `race` and `any` over more than one Opus agent count as unknown) and denies every Opus stage involved with the new code `FANOUT` when the bound is above 3 or cannot be computed. Sonnet and Haiku fan-outs are not limited. `FANOUT` is not checked on a Sonnet or Haiku session.
- New class `investigate:` (web research, code mapping, any reading that reports findings): Sonnet only. `judge:` no longer owns "any reading whose output feeds a verdict".
- New deny code `LABEL`: a `decide:`, `judge:` or `design:` label, or a fanned-out `synth:` label, containing research, investigate, map, explore, survey, scan, search, find, audit, inventory or readiness. That work is `investigate:` on Sonnet. Configured by `labelCheck` in `policy/default.json`.
- `judge:` may run on Sonnet for one yes/no review, with a verdict schema of exactly `pass` (boolean), `evidence` (string) and `blocked_on`.
- `decide:`, `synth:` and `design:` may run on Sonnet in a fan-out of more than 3 agents, or of unknown size.
- `policy/default.json` gains `fanoutPairs`, `verdictPairs`, `limits` (`maxConcurrentOpus`, `bigFanout`) and `labelCheck`.
- The gate now writes a record per launch, pass or deny, to `<configDir>/ultraguard/sessions/<session_id>/<tool_use_id>.gate.json`, with a SHA-256 fingerprint of the script. It fails closed if it cannot write the record of a clean launch. It no longer "keeps no state and writes no files".
- New ultraguard-eval hooks module: a band above the prompt and a pane (`/ultraguard`) that show each running workflow green or red from four checks (approved by the gate, every agent matches the plan, every request as approved, at most 3 Opus at once). It writes `<tool_use_id>.eval.json` per run. It observes only and never denies.
- The guidance teaches the new classes, the cap, the `slice(0, 3)` split and the batching loop.

## 0.4.6 - ultraguard

- Rewrote the fork of ultracost as `ultraguard`, a per-agent delegation gate for Workflow launches.
- New static gate: parses the script with vendored acorn and checks every `agent()` for a class label, a literal model and effort, and a `blocked_on` schema on Sonnet and Haiku stages.
- Allowed (model, effort) pairs live in `policy/default.json`. The session model caps the allowed models.
- Launches by name, mixed sources and `workflow()` children are denied. Runtime env overrides of model and effort are denied.
- SessionStart prints the policy guidance and the rendered pairs table.
- Fails closed on any internal error or timeout.
- Removed the old ultracost engine, commands, docs and assets.
- Probe results on Claude Code 2.1.319: `code:` and `grunt:` allow `haiku` at `xhigh`; the session cap reads the main thread's `api-request` row written after the last main-thread assistant row (the request in flight), falling back to that assistant row and any later `/model` command; the README lists which effort knobs override, clamp or do not touch an explicit `agent()` effort.
