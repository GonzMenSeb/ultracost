# Changelog

## 0.4.15 - ultraguard

- The ultraguard-eval list opens with "overall savings for this session": every workflow of the session pooled into one estimate per baseline, with the same context, 5-hour and weekly rows as a run's saved block. It says " so far" while a workflow runs, counts the workflows, and resets on /clear. The 5-hour and weekly rows count only the workflows of the current window, and a dim line says so when some ran in an earlier one. With several baselines the vs line reads "vs your session's model at each launch" and the low, middle and high ends are added.
- The totals live in a session tally of their own, so they count every workflow, past the 20 the list keeps. The tally is mirrored to the plugin store under `tally:<session id>`; the store keeps the 3 newest other sessions' tallies for up to 30 days, and stops mirroring a tally over 512 KiB. The overall estimate always uses 1,000 draws: at 4,000 draws 300 pooled agents took about 480 ms.
- The workflows sit under their own section, in a window of their own, so the overall section stays in view. Rows take 2 lines each, finished workflows sit under a thin "finished this session" rule, and "↑ N more" and "↓ N more" lines show hidden rows. The arrow keys move through every row and the window follows, keeping one row past the selection drawn.
- A workflow stopped with TaskStop now ends as stopped instead of running for ever: it gets its final estimate, its record (status `killed`) and a toast "ultraguard: <title> stopped". Stopped workflows go into a folded "stopped this session" row at the end of the list. Their savings count toward the overall total.
- Every main section starts with a double rule: `══ overall savings for this session ══`, `══ workflows ══`, and in a run's view `══ ultraguard saved ══`, `══ phases ══` and `══ checks ══`. A run's view shows the saved block first, then the phases, then the checks.
- Every collapsible starts collapsed: the phases of a run and the stopped workflows.
- Savings read as a low-to-high range instead of ±: `+30.1 (3.0 to 91.6)`, `$12.04 ($1.20 to $35.21) at API prices`, and `4.1% (1.8 to 6.4)` in the list. The note reads "range = 9 times in 10".
- The heading's "vs every agent on ..." always takes its own line.
- On a narrow pane the bars shrink down to 4 cells (it was 12) so every line of the saved block fits its 56 columns; below that a range moves to its own line. A figure just under zero prints as `$0.00`, never `-$0.00`.

## 0.4.14 - ultraguard

- The "ultraguard saved" block in ultraguard-eval now draws bars. One thick-line bar per row: context, 5-hour and weekly (API key users get context and cost). The used part is in the theme's text color, the saving is colored, and the rest is a track. A mark shows 100 percent of the limit. When a row's use plus saving passes 100 percent, the mark moves into the bar on every row and the saving can spill past it. The bar's scale tops out at 150 percent of the limit, and a cap shows when use plus saving passes the end of the bar, a little over 150 percent. The exact total moves with the pane width. The block is at most 56 columns wide, the same compact layout at every pane width.
- The saving is a gradient, darker meaning more saved: cyan at 1 percent, blue at 10, violet at 20 and a deep purple (`#641aa5`) at 40 percent, flat after. The last saved cell and the `+N` figure have the same color.
- Limit messages sit under the bars. They say when use plus saving would have passed the limit ("without ultraguard you would have blown past your 5-hour limit"), come within 10 points of it ("...would have had only 2% of your 5-hour limit left"), or passed half of it while use alone stayed under half ("...would have been past half of your 5-hour limit already"). A saving under 2 percent, or a margin under 5 points over half, is hedged with "likely" or "might".
- The footer puts the money line and the tokens line each on their own line, then the dim note "± = how far off, 9 times in 10", and "this run may have saved nothing" when the range reaches below zero. The coverage lines appear only when something is off. The "from N of M agents" line and the "ratio measured on N replayed agents" line print only when an agent is left out or a price or a ratio is missing. The chained-ratio and published-figure lines print whenever they apply.
- The context row reads the session's live context window the way a status line does: tokens against the model's window, or against the smaller compaction window when auto-compaction is on. Right after a fresh session or a compaction it shows an empty track and a dash until the next response.
- The limit usage drawn as the used part of the bar is frozen at the last estimate and stored on the saved record as `used: { five_hour, seven_day }` (percent or null). Records written before 0.4.14 have no `used` and draw the row without a bar.
- A rejected model gives way to the next lower one at `xhigh`. The `PAIR` denial for a model its class does not allow now says `Relaunch on sonnet with effort "xhigh".` before the allowed list, and the session guidance states the rule: on a Sonnet session the four Opus classes run on `sonnet` at `xhigh`.
- The arrow keys in ultraguard-eval always move the selection, also when the pane has rows to scroll (the host used to turn them into scrolling), and the pane scrolls to keep the selected row in view. At the first or last row an arrow scrolls as before.
- The deep purple end of the gradient (`#641aa5`) has low contrast on dark terminals, about 1.6 to 1 on `#262626`, so a large saving is hard to read there. On white the deep purple is 9.4 to 1, but the cyan end of the ramp is about 1.5 to 1, so small savings are faint on a light terminal. Light terminal rendering has not been checked live.

## 0.4.13 - ultraguard

- The workflow detail in ultraguard-eval has a new layout. The columns are the agent, then what it saved, then "ran on" last, so the saved figure sits right after the labels, near its phase or agent. The approved model and effort are gone from the rows; a dim line under the phases says "✓ ran as the gate approved  ✗ did not".
- Each phase is a block: the caret, a circle, the title, the agent count (or "running  1 of 2 done", plus "1 red" when an agent broke the plan) and the saved figure of its agents. While folded, the phase also shows its models in the "ran on" column ("opus 11  sonnet 10  haiku 12"), wrapping onto more lines when they do not fit. An open phase lists its agents, each with a model in its color and the effort dim.
- The saved column is headed "5h saves" with a 5-hour limit figure and "API saves" otherwise, in the detail and in the run list.
- No more middle dots in the pane: the id next to the workflow's name, a passing check's detail, the status of a phase, the counts, the effort, the hints, the run list, the band above the prompt and the saved block use spaces.
- The focus outline now also wraps a phase block and the "expand all" and "back to the list" buttons, not only a run. The focused run's square and the focused phase's circle fill in (■, ●). Each row's button is now an invisible anchor, so the engine's inverted fill no longer shows, and the phase blocks share the blank row between them.

## 0.4.12 - ultraguard

- `code:` and `grunt:` allow Haiku at `medium`, `high` and `xhigh`, not only `xhigh`. A replay of the 10 latest workflows on Haiku 5.5 matched the recorded answer on all 30 runs of five fixed-shape tasks at `medium` and `xhigh`, at 6 to 11 times less cost per run than Sonnet.
- The guidance steers fixed-shape work to Haiku `medium`: the spec names the inputs, the output fields and how to compute them, and a script can check the result. Discovery, open-ended review, multi-source web extraction and anything that weighs evidence stay on Sonnet or above, and `judge:` has no Haiku pair.
- `grunt:` owns fixed-shape, zero-decision work, and `investigate:` owns reading where the agent decides what the evidence means. A `LABEL` deny now adds that a fixed list, table or count over named inputs is `grunt:`; the new optional `labelCheck.fixed` names that class.
- The Haiku session cap and the Haiku effort check read the efforts from the policy instead of a fixed `xhigh`.
- A policy that lists `haiku` for a class without `sonnet` is rejected: a Sonnet session would drop the Haiku pair and leave the class with no pair.
- The hand-written class table is gone from `policy/guidance.md`, because the generated table carries it, and the session context stays under 7,600 of its 8,000 characters.

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
