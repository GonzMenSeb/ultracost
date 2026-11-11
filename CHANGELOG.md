# Changelog

## 0.4.20 - ultraguard

- `code:` is now fully specified implementation on Haiku medium: the prompt names the files, the functions or interfaces and the test commands, and leaves nothing to decide. `build:` takes decided work that leaves details open (modules or ports from a plan, names, ownership, stored state), and `fix:` says a fix spelled out file by file is `code:`. A replay of 14 past Sonnet coding tasks found Haiku medium failing 1 of 33 runs where the prompt left nothing to decide (Sonnet 0 of 22) at 0.05 to 0.9 times the cost, and failing 5 of 8 where names, ownership or state rules were open (Sonnet 2 of 6).
- Haiku xhigh is allowed in no class. `code:` is Haiku medium only and `grunt:` is Haiku medium or high. In the replay Haiku xhigh cost more per acceptable run than Sonnet ($0.675 against $0.580) with no gain.
- The relaunch hint in a `PAIR` deny picks the next lower model in the class's effective pairs, at xhigh if that model lists it and otherwise at its highest listed effort. A Haiku session that names Sonnet for `code:` is told `Relaunch on haiku with effort "medium".`, and one that names Opus for `decide:` is told `Relaunch on haiku with effort "high".`. Sonnet sessions are unchanged.
- `blocked_on` is settled by the orchestrating session, never by the user and never by a new `decide:` stage: it puts a deferred step in its final summary, decides a question and relaunches the stage once with the answer, or checks a contradiction and accepts the result or relaunches with the fix. Haiku set `blocked_on` in 16 of 55 replay runs, and every one of those runs had finished its work.
- The guidance tells Claude to start every Haiku prompt with "You are running inside an automated workflow, not an interactive conversation: no one will answer questions, so finish the task and report anything undecided in `blocked_on`."
- A new PostToolUse hook, `hooks/commit.mjs`, reminds Claude after a `git commit` to check for stray scratch files when the session launched a workflow that passed the gate with a Haiku `code:` stage. Only Haiku left scratch files in the replay. The hook never blocks.
- The SessionStart context clamp rises from 8,000 to 9,000 characters, under the 10,000 that Claude Code documents for one `additionalContext`. The session test keeps the guidance and table under 8,600.

## 0.4.19 - ultraguard

- A prior between two of Opus, Sonnet and Haiku now has a ratio per token type, from Artificial Analysis's token counts of both configurations: output from the output tokens, read and fresh from the total input tokens. Before, one published cost ratio divided by the input-price ratio served all three, which understates a Haiku agent's baseline: Haiku's cache reads cost 10× less than Sonnet's while its other classes cost 20× less. The old ratio stays as the fallback, used for every pair with Fable.
- `node scripts/priors.mjs` backtests four candidate priors against the replayed workflows and picks the lowest error; the shipped prior is its pick. Mean absolute log error: 0.216 over the 9 bucket cases and 0.161 in dollars, against 0.284 and 0.177 for the old prior. The backtest has 3 workflows on 2 Sonnet-to-Opus transitions and no Haiku pair, so the Haiku side rests on token counts and prices, not on a measurement.
- Effect on the replay mix: a Haiku agent's baseline dollars rise 46% to 75% against an Opus or Sonnet baseline (Opus xhigh 57%, Sonnet high 75%), so its savings rise with them; a Sonnet agent's Haiku baseline falls 47%.

## 0.4.18 - ultraguard

- An effort step within one model now has a ratio per token type. The level stays the published multi-source cost ratio; the shape comes from Artificial Analysis's per-effort token counts. On Sonnet 5.5, high to xhigh is now output 2.21, fresh 2.11 and read 3.28 instead of 2.49 for all three. Opus and Haiku take output and input from Artificial Analysis and borrow Sonnet's fresh exponent (0.77), with 0.2 more spread on that bucket; Fable keeps one ratio for all three. On the replay mix dollars and limit figures move about 2% and the tokens-saved figure up to 51%, since most saved tokens are cache reads.
- A step's spread is at least its spread across Artificial Analysis's nine evaluations, and never below 0.25: Opus high to xhigh goes from 0.22 to 0.37 and every step into `max` gets 0.70 or more. Ranges on chained and same-model transitions widen (an Opus xhigh baseline on the replay mix: low end 19% lower, high end 22% higher).
- `node scripts/lowo.mjs` checks the measured ratios and τ by holding out one replayed workflow at a time. Only the two Opus-medium workflows can predict each other, so it holds one independent comparison: it implies τ ≈ 0.28 against 0.30 and neither confirms nor contradicts it.

## 0.4.17 - ultraguard

- Limit figures read lower and closer to what the account did. A reading that jumps 2 points or more is not stored, since it mostly comes from usage this session cannot see (other sessions, claude.ai, another machine). On the 200 five-hour intervals of one machine 14 were jumps, and dropping them took the pooled rate from 2.68 to 1.49 points per list-price unit, so 5-hour and weekly figures fall about 1.8×. Intervals already stored with such a jump are ignored too.
- A workflow's own estimated use of a window is capped at what the account rose while it ran. ultraguard keeps the window readings at launch; when the run's own spend at the pooled rate is more than the rise plus 1 point, the run's 5-hour or weekly figures are scaled down to it, and the session total scales that run the same way.
- A `percentUsed` outside 0 to 100 is ignored, and a compaction of the main conversation restarts the meter's counters, so no interval spans it.
- A running agent's usage reaches the record and the session tally after each of its steps, at most every 30 seconds per run. Before, it waited for the agent to finish, so a long agent showed no figure and its usage was lost if the process exited.
- Data: the community CSV's `max` cells are left out (its Opus `max` cell needed a permission for an automated test), so every step into `max` falls 43 to 63% (Opus high to max 6.65 to 2.90). The Artificial Analysis source carries its index version, v5.0.1. Anthropic's 134-task Managed Agents run (Opus 5.5 low and medium) is a source of its own. Fable medium in Anthropic's 370-task benchmark is $1.34, as the page says, not $2.68, so priors into `fable:medium` fall about 29%.
- Price rows for Opus 5 ($5 / $25, cache read $0.50), Sonnet 5 (cache read $0.20) and Fable 5.2 ($8 / $40, cache read $0.20, cache write $10): those models were priced at the Opus 5.5, Sonnet 5.5 and Fable 5.1 rows. A version row prices its tokens and keys its ratios and its name by its family.
- τ is floored at 0.22 instead of 0.15 (it stays 0.30), and a test keeps each pooled per-agent sd at or above the single-run noise floor.
- The reference and the README say readings are whole percent, how the jump rule and the clamp work, and correct the cache-read and chaining notes. The knowledge base behind these changes is in `docs/superpowers/specs/2026-11-09-ultraguard-token-spend-knowledge.md`.

## 0.4.16 - ultraguard

- The arrow keys move through every row of a windowed list. The host only raises scroll events while the pane overflows, so a windowed list is drawn one row taller than the body and its scroll offset is capped, which keeps the overall section on top. The focus starts on the drawn row, and going back, reopening the pane and the pane's own focus stops keep the row and the window.
- The overall totals stay current: a `none` baseline counts as a known zero, the vs line follows the baselines of the workflows counted, and the totals rebuild when the 5-hour or weekly window rolls over, on load and at launch. A launched workflow counts from the start, an ended run never reverts to running, and a stored run that was still running when the session ended counts as ended. The overall estimate rebuilds at most every 30 seconds while workflows run.
- The tally belongs to its session: /clear and /resume swap to the tally of the new session, so a cleared session reads "1 workflow" after its first launch, not 9.
- A run whose agents all ran on the session's own model and effort shows a dim `same model` in the list instead of a figure. When every workflow of the session did, the overall section says so in the same words as a run's view.
- A resume that reports a workflow as `stopped` ends the run as stopped, like a TaskStop. When the process restarted (`claude --continue` or `--resume`), the list no longer holds the run, so its record and its entry in the session tally are ended as stopped instead; before, the record said `running` for ever and the tally said `cleared`.
- The list's name column shrinks to leave room for the saved cell on a narrow pane, and the agents column counts the stopped rows only while the stopped fold is open.

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
