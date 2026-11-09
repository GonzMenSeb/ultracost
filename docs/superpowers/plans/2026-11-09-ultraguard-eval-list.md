# ultraguard 0.4.15: workflow list redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. At execution start, copy this file to `docs/superpowers/plans/2026-11-09-ultraguard-eval-list.md`.

**Goal:** Redesign the ultraguard-eval pane: an "overall savings for this session" section pinned above a windowed, tighter workflow list, a folded section for stopped workflows, double-rule section heads everywhere, savings shown as low-to-high ranges, and everything collapsible starting collapsed.

**Architecture:** Pure logic stays in `src/*.mjs` (unit-tested with `node --test`), drawing in `hooks/eval.tsx` (tested with `claude-code/testing`). One helper draws every section head; the overall section reuses the run's saved-block body. A new per-session tally atom, mirrored to `$.store`, keeps the totals that the 20-run list prunes away.

**Tech Stack:** plain ESM JavaScript, Node 18 (no Node 20+ APIs), no dependencies, Claude Code plugin hooks API (`.claude-plugin/types/claude-code/index.d.ts` in the main checkout).

**Spec:** the mock https://claude.ai/artifact/JfwQ9rQG2mWPdqzCXpE9LQ (v6, fourth pass), the decisions in this plan's Context, and `docs/superpowers/specs/2026-11-09-ultraguard-saved-bars-design.md` (still in force where not changed here). Task 1 writes the new spec `docs/superpowers/specs/2026-11-09-ultraguard-eval-list-design.md`.

## Context

The user designed the list in the mock above over several passes and decided:
- Section heading `overall savings for this session` (plus ` so far` while a run is going), with `N workflows`, at the **top** of the list. It includes the **context row** "for now". The total **resets on /clear** (new session id).
- List rows take **2 lines** each (`marginTop={-1}` overlap, the ring around the picked row kept).
- Rows sit in their **own window** so the overall section is always visible.
- A **folded-by-default** section for **stopped** workflows only. Their savings **count** toward the total.
- **Double rules** `══ title ═══` on every main section, in the list **and** the run's view. "Consistency is VERY important. DRY is a must."
- Run view order: **saved block first, then phases, then checks**.
- **Every collapsible starts collapsed**, including phases.
- Savings show as **low to high** (`+30.1 (3.0 to 91.6)`), not `±`, everywhere.
- **Not in this plan:** the meter-calibration bias (~3x high, inferred) goes in its own PR next. Runs recorded before 0.4.14 keep drawing limit rows without bars (unchanged).
- Must survive a compaction with correct data. Loss when the session closes is acceptable.

Investigations done this session (results in the conversation): compaction survival is likely but undocumented; a pane has no scrollable sub-region; a workflow stopped with TaskStop gets no task notification (memory note `eval-follow-ups`); totals cannot come from `state.runs` (pruned at `MAX_ENDED = 20`, `src/eval.mjs:10`).

## Global Constraints

- Node 18 runtime, no new dependencies, no build step. `npm test` must pass.
- Comments only where absolutely necessary.
- No middle dots in any drawn text (repo rule). Two spaces separate inline items.
- Section head: `══ ` + bold title + dim `  extra` + ` ` + `═` fill to the width, rule glyphs in theme key `subtle`. Subgroup head: `─ ` + dim label + ` ` + `─` fill, glyphs in `subtle`.
- Saved and overall blocks are capped at `MAX_WIDTH = 56` (`src/bars.mjs:3`). List rows and section heads span the pane width (`e.props.bodyColumns`).
- Range text: `+M (L to H)` for points, `+$M ($L to $H)` for dollars, with one decimal for points and cents for dollars, from `range()` fields `mid`, `lo`, `hi` (`src/savings.mjs:62-68`). The note becomes `range = 9 times in 10` (my pick). `this run may have saved nothing` stays when `lo < 0`.
- Version bump to **0.4.15** in `package.json`, `.claude-plugin/plugin.json` and the `ultraguard` entry of `.claude-plugin/marketplace.json` (`tests/version-sync.test.js`).
- Live verification is mandatory after `npm test` (repo CLAUDE.md): `claude --plugin-dir /home/sebastian/.herdr/worktrees/ultraguard/redesign-workflows-view`, `/effort ultracode`.
- Wording marked "my pick" in the mock (`↑ N more`, `stopped this session`, `5-hour counts the N workflows of this window`, `vs your session's model at each launch`, the range note) is provisional. Keep each string in one constant.

## Review Focus

1. **Pane too short for the fixed sections** (body rows below heads + overall + footer + 3): the window still draws the focused row, and the pane scrolls rather than hiding it. Test in Task 8.
2. **Only stopped runs, or no runs at all:** the list shows "No workflow is running.", the overall section, and the folded stopped row with nothing above it. Test in Task 8.
3. **TaskStop on a task that is not a workflow run, or a denied or failed TaskStop:** no run changes. Test in Task 5.
4. **More than 20 ended runs:** the overall total still counts the pruned ones. Test in Task 6.
5. **/clear while runs are going:** the tally resets, and the next session's store key starts empty. Test in Task 6.

## File Structure

- `src/savedText.mjs`: range text, `sectionHead`, `subHead`, `savedBody` (split from `savedBlock`), `overallBlock`. Holds every drawn string constant.
- `src/tally.mjs` (new): per-session tally: record a run, decide which runs count per window, build the pooled overall estimate.
- `src/listWindow.mjs` (new): pure windowing of list items into the room left by `scroll.bodyRows`.
- `src/eval.mjs`: phase default closed, `stoppedRuns`, `finishedRuns` excluding stopped, list fold state.
- `src/nav.mjs`: the reachable keys include the stopped fold row and, when it is open, its rows.
- `hooks/eval.tsx`: the TaskStop hook, the tally atom and store mirror, list and run view layouts.
- `types/index.d.ts`: tally and new ui fields.
- Tests: `tests/savedText.test.js`, `tests/tally.test.js` (new), `tests/listWindow.test.js` (new), `tests/eval.test.js`, `tests/nav.test.js`, `hooks/eval.test.tsx`, `hooks/savings.test.tsx`.
- Docs: new spec, CHANGELOG, `docs/reference.md` where it describes the pane.

---

### Task 1: Live spikes and the spec

No plugin code is committed in this task. Use a scratch branch or `/tmp` copy for any probe.

**Files:**
- Create: `docs/superpowers/specs/2026-11-09-ultraguard-eval-list-design.md`, `docs/superpowers/plans/2026-11-09-ultraguard-eval-list.md` (this plan)

- [ ] **Step 1: S1, arrow keys when the pane's tree fits.** Probe build: log `ui.scroll` and `ui.focus` events to `$.ui.log(..., { to: 'debug' })`. Open `/ultraguard` with 3 runs in a dock pane, so the tree fits, and press ↓ past the last drawn Button. Record which events fire. The window design (Task 8) keeps one row past the focus drawn (scrolloff 1), so either outcome works. Record it in the spec.
- [ ] **Step 2: S2, `marginTop={-1}` on row-direction list Boxes** with the picked ring. Confirm the round border paints over the shared blank line cleanly, with no gap or doubled line, in dark and light.
- [ ] **Step 3: S3, stop signals.** (a) Stop a running workflow with the TaskStop tool. Confirm `tool.call` with `tool: 'TaskStop'` fires with `e.task_id` equal to the Workflow result's `taskId`. (b) Stop one from the host UI (the tasks list). Record whether any event or `<task-notification>` with status `killed` arrives. If none does, the spec states that UI stops stay "running" until a later fix.
- [ ] **Step 4: S4, compaction.** Start a workflow, note the pane figures, run `/compact` while it runs and again after it ends, and reopen. Confirm the runs, figures and status are unchanged. The ended run must read done.
- [ ] **Step 5: Write the spec** with the decisions in Context, the spike results, and the layout of both views (list and run) as drawn in the mock. Copy this plan in. Commit.

```bash
git add docs/superpowers/specs/2026-11-09-ultraguard-eval-list-design.md docs/superpowers/plans/2026-11-09-ultraguard-eval-list.md
git commit -m "docs: spec and plan for the 0.4.15 workflow list"
```

### Task 2: Savings as low-to-high ranges

**Files:**
- Modify: `src/savedText.mjs` (limit `fig` at :103-105, `costRow` fig :109-123, `moneyLine` :125-129, `sourceLines` :159 (`so ± is wide` becomes `so the range is wide`, my pick), the ± note :202-206, `listCell` :282-293, `agentColumn` cells if they print a margin)
- Test: `tests/savedText.test.js` (including the pin at :255), `hooks/savings.test.tsx`

**Interfaces:**
- Produces: `rangeText(range, kind) -> string`, exported from `src/savedText.mjs`. `kind` is `'points' | 'usd'`, and the result is ` (L to H)`, with a leading space. Every saving figure uses it.

- [ ] **Step 1: Write failing tests**
  - `rangeText({ mid: 30.06, lo: 3.04, hi: 91.55 }, 'points') === ' (3.0 to 91.6)'`
  - `rangeText({ mid: 12.04, lo: 1.2, hi: 35.21 }, 'usd') === ' ($1.20 to $35.21)'`
  - A negative low end prints with its sign: `rangeText({ mid: 1.4, lo: -0.3, hi: 2.1 }, 'points') === ' (-0.3 to 2.1)'`.
  - In the saved block, the 5-hour row ends with `+30.1 (3.0 to 91.6)`. The money line reads `$12.04 ($1.20 to $35.21) at API prices`. The note line reads `  range = 9 times in 10`. No line contains `±`.
  - `listCell` for a finished 5-hour run gives `4.1% (1.8 to 6.4)`. A running one keeps ` so far`.
  - Every line still fits 56 columns at widths 44 to 110 (extend the test at :153-164).
- [ ] **Step 2: Run `npm test`.** Expected: FAIL on the new assertions.
- [ ] **Step 3: Implement `rangeText` and use it in every place listed above.** `layoutOf` already sizes the bar from the widest fig, so the bars shorten on their own.
- [ ] **Step 4: Run `npm test`.** Expected: PASS. Update `hooks/savings.test.tsx` strings that pinned `±`.
- [ ] **Step 5: Commit** with `feat(eval): show savings as low-to-high ranges`.

### Task 3: One section head for every section

**Files:**
- Modify: `src/savedText.mjs` (`headLines` :74-80 replaced, `savedBlock` :175-209 split)
- Test: `tests/savedText.test.js`, `hooks/savings.test.tsx` (the regexes anchored on `/^ultraguard saved/` at :408, :426, :435; the one-Text match `ultraguard saved\s+vs every agent on Opus high` at :174 splits into two Texts; check :334)

**Interfaces:**
- Produces, from `src/savedText.mjs`:
  - `sectionHead(title, { extra = '', width }) -> Segment[]`
  - `subHead(label, { width }) -> Segment[]`
  - `baselineLine(baseline | null) -> Segment[]`. With a baseline it reads `  vs every agent on <Model> <effort>`. With none it reads `  vs your session's model at each launch`.
  - `savedBody(saved, { width, context, nothing }) -> Segment[][]`: the rows, limit messages, money and token lines, the range note and, when `lo < 0`, the line `nothing`. It is the current `savedBlock` :186-206.
  - `savedBlock(saved, { width, headWidth = width, context })` = `sectionHead(saved.running ? 'ultraguard saved so far' : 'ultraguard saved', { width: headWidth })`, then `baselineLine` (skipped when `!saved.baseline`, so it never contradicts the "could not read your session's model" prose pinned at `tests/savedText.test.js:290`), then `savedBody(..., { width: min(width, 56), nothing: 'this run may have saved nothing' })`, then the coverage lines. The early-return prose (`none`, no baseline, not estimated) moves under the section head.
  - **One head width per view:** every section head in a view uses the same width, `e.props.bodyColumns - 4` (`hooks/eval.tsx:542`). The pane passes it as `headWidth`, and bodies stay capped at 56.
- Segment for rule glyphs: `{ text, style: 'plain', color: 'subtle' }`. `segmentLook` in `hooks/eval.tsx:71-77` already honours `color`.

- [ ] **Step 1: Write failing tests**
  - `text(sectionHead('workflows', { extra: '2 running', width: 40 }))` is `'══ workflows  2 running ' + '═'.repeat(16)`, with length 40.
  - The title segment is bold, the extra is dim, and the rule segments have `color: 'subtle'`.
  - A title wider than the width still keeps `══ ` plus 2 fill glyphs, and is cut with `…`.
  - `subHead('finished this session', { width: 40 })` starts with `─ ` and is 40 long.
  - `savedBlock(...)[0]` starts with `══ ultraguard saved so far`, and line 1 is `  vs every agent on Sonnet xhigh` at every width. The two-line heading fallback is gone.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Make the rule glyph strings constants (`RULE = '═'`, `SUB_RULE = '─'`).
- [ ] **Step 4: Run `npm test`.** Expected: PASS, with the hook tests' regexes updated to `/^══ ultraguard saved/`.
- [ ] **Step 5: Commit** with `feat(eval): one double-rule section head for every section`.

### Task 4: Run view order, and phases collapsed by default

**Files:**
- Modify: `src/eval.mjs:598` (the phase `open` default), `hooks/eval.tsx` detail view :524-671
- Test: `tests/eval.test.js` (:841-849, :851-862 rewritten; :866-867 `phaseOpen(first, undefined)` becomes `false`), `hooks/eval.test.tsx` (:309-314, :333, :344-347, :473 expect `▸`; :321-329, :474-477, :493-495 flip, because a press now opens and `expand all` shows), `hooks/savings.test.tsx` (:396-397 expect `▸ ● Investigate` with no agent row; :432-439 the saved block now comes before the phase tree)

**Interfaces:**
- Consumes: `sectionHead`, `savedBlock` (Task 3).
- Produces: `phaseView.open === false` for every phase. The `FOLD_ABOVE` constant is removed.

- [ ] **Step 1: Write failing tests**
  - Every phase of `phasedRun()` has `open: false`, including a red phase and a running one.
  - In the pane, the run view's Text order is: the crumb, `══ ultraguard saved…`, its rows, `══ phases  N agents`, the phase blocks (all `▸`), the legend `✓ ran as the gate approved  ✗ did not`, `══ checks`, the check lines, the hint, and the `expand all` and `back` buttons.
  - A run without phases titles that section `══ agents  N agents`.
  - Autofocus still lands on the first running or red phase (`focusKey`, :599).
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Set `open: false` at :598. Reorder the detail view: the saved block (`savedBlock` already returns its own head), then `sectionHead('phases', { extra: `${n} agents`, width: bodyColumns - 4 })` with the existing phase blocks and agent header row, then `sectionHead('checks', …)` with the existing `checks` lines. Keep the margin logic and `ring()` unchanged.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(eval): run view saved, phases, checks; phases start collapsed`.

### Task 5: Detect stopped workflows

**Files:**
- Modify: `hooks/eval.tsx` (new `tool.call` hook for `TaskStop`, `toastText` call), `src/eval.mjs` (new `stoppedRuns`; `finishedRuns` :485-489 excludes stopped), `src/savedText.mjs` (`toastText`)
- Test: `tests/eval.test.js`, `hooks/eval.test.tsx`

**Interfaces:**
- Produces:
  - `STOPPED = 'killed'`, exported from `src/eval.mjs`. It is the status the host's own notification uses (`UserMessageTask.status`), so a host `killed` notice and a TaskStop give the same state.
  - `stoppedRuns(state) -> Run[]`: status `killed` and not hidden, newest `endedAt` first.
  - `finishedRuns` now also excludes `killed`.
  - `runView` gets `stoppedClock` (`hhmm(endedAt)` when the status is `killed`).
- A stopped run must stay openable. Add `stoppedRuns(state)` to the three lookups that use `activeRuns` and `finishedRuns`: the open run at `hooks/eval.tsx:504`, `paneNav`'s `all` at `src/nav.mjs:5-6`, and the `ui.close` check at `hooks/eval.tsx:454`.
- Test harness: the `world()` `tool.call` fake (`hooks/eval.test.tsx:61-64`) branches on `e.tool`. For `'TaskStop'` it returns `{ result: { message: 'stopped', task_id: e.task_id, task_type: 'local_workflow' } }` (shape from `claude-code-tools` types, TaskStop result) and leaves the Workflow `toolUseId` alone.
- Hook: `on('tool.call', { tool: 'TaskStop' }, …)`. Run `next(e)` first. If the result has no `deny` and no `isError`, take `e.task_id ?? e.shell_id` and call the existing `endRuns($, [{ toolUseId: null, taskId, status: STOPPED }])`. That gives the final estimate, persist and toast.
- `toastText` for a killed run: `ultraguard: <title> stopped`, plus ` and saved about …` as for a finished run (my pick).

- [ ] **Step 1: Write failing tests**
  - A TaskStop whose `task_id` is `'w1'` (the `world()` fake Workflow result, `hooks/eval.test.tsx:61-64`) ends that run with status `killed`. `stoppedRuns` returns it, `finishedRuns` does not, an estimate runs, and the `.eval.json` is written with `status: 'killed'`.
  - TaskStop on an unknown id changes nothing. TaskStop returning `{ deny }` or `isError: true` changes nothing.
  - A later `<task-notification>` for the same task leaves it `killed`. `noteRunEnd` already ignores runs that are not running (:369).
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(eval): a workflow stopped with TaskStop ends as stopped`.

### Task 6: Session tally that survives pruning and compaction

**Files:**
- Create: `src/tally.mjs`, `tests/tally.test.js`
- Modify: `hooks/eval.tsx` (`estimate()` :176-203, `session.start` :304-318, `session.end` clear :336-346), `types/index.d.ts`

**Interfaces:**
- Produces, from `src/tally.mjs`:
  - `createTally() -> { v: 1, runs: {} }`
  - `noteTallyRun(tally, { key, status, baseline, agents, windows, at }) -> tally`. `agents` is `agentPieces(run)` (`src/eval.mjs:491`). `windows` is `{ five_hour, seven_day }`, each the `resetsAt` of `meter.last[kind]` at the estimate, or `null`. A run already present is replaced. There is no cap below 500 runs; at 500 the oldest are dropped with a `log` line (my pick).
  - `countedRuns(tally, kind, current, now) -> TallyRun[]`: for `five_hour` and `seven_day`, the runs whose stamped window equals `current` (the live `meter.last[kind].resetsAt`, an ISO string or `null`, `src/meter.mjs:57`). When either stamp is `null` (the host leaves `resetsAt` optional), a run counts if `now - run.at` is under 5 hours, or under 7 days for weekly (my pick). For `'all'`, every run.
  - `overallInput(tally, current, now) -> { groups: [{ baseline, all, five_hour, seven_day }] }`: per baseline (`family` + `effort`), each scope is a flat list of `{ agentId, pieces }`, the agents of that baseline's runs counted for that scope. This is the shape `estimateRun` takes (`src/savings.mjs:96`, `groups` defaults to `[]`).
  - `combine(estimates, { tally, meter, now }) -> Saved`: groups whose estimate status is not `'estimated'` are left out, and when none remain it returns `{ status: 'unknown', count }`. one saved-like object (Task 7's input). When there is one baseline it is the estimates as they are: `dollars`, `tokens` and `baselineDollars` from the `all` estimate, `limits.five_hour` from the `five_hour` estimate, `limits.seven_day` from the `seven_day` estimate. With several baselines it adds `mid`, `lo` and `hi` across groups, which is conservative (my pick, noted in the spec), and sums `baselineDollars` and `actualDollars`. It also carries `limits.readings` and `actualDollars`, which `limitRows` (`src/savedText.mjs:102`) and `costRow` (:110, :113) read. Extra fields: `count`, `counted: { five_hour, seven_day }`, `running`, `baseline` (null when mixed), `subscription` (from the meter), `used: { five_hour, seven_day }` from `usedOf(meter.last[kind], now)` (`src/meter.mjs:78`), and `transitions: []`. These are all the fields `savedBody` reads.
- In `hooks/eval.tsx`:
  - A new atom `atom({ plugin: 'ultraguard', key: 'tally' }, createTally(), { shape: 'tally-1' })`.
  - After `noteSaved` in `estimate()`, call `noteTallyRun`. Then run `estimateRun` once per group and scope (same `ratios`, `prices` and `meter`, `seed: seedOf('overall')`, `DRAWS_RUNNING` while any counted run is running). Store the combined result as `tally.overall`.
  - Mirror the tally to `$.store.set('tally:<sessionId>', tally)` after each change.
  - `session.start`: if the atom is empty and the store has the own key, load it. Delete `tally:*` keys whose newest run `at` is older than 30 days (same rule as `staleKeys`, `src/meter.mjs:106-110`).
  - `session.end` with reason `clear`: reset the atom to `createTally()`.

- [ ] **Step 1: Write failing tests**, pure, in `tests/tally.test.js`:
  - `noteTallyRun` twice with the same key keeps one entry.
  - `countedRuns` with two runs stamped `five_hour: 'A'` and `'B'` and `current = 'B'` returns only the second. `seven_day` counts both when they share a week stamp.
  - 25 ended runs are all counted in `'all'` (pruning-independent, Review Focus 4).
  - `overallInput` splits by baseline. `combine` of one group matches that group's estimate exactly. With two groups, `mid` is the sum of the mids.
- [ ] **Step 2:** In `hooks/eval.test.tsx`, add a test that the tally is mirrored under `tally:<sid>`, and that it resets after `$.session.end({ reason: 'clear' })` (Review Focus 5).
- [ ] **Step 3: Run `npm test`.** Expected: FAIL.
- [ ] **Step 4: Implement.** Measure `estimateRun` over 300 pooled agents at 4000 draws in a test. If it takes over 250 ms, use `DRAWS_RUNNING` for the overall always and say so in the spec.
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Commit** with `feat(eval): per-session savings tally, mirrored to the plugin store`.

### Task 7: The overall savings block

**Files:**
- Modify: `src/savedText.mjs`
- Test: `tests/savedText.test.js`

**Interfaces:**
- Consumes: `combine()` output (Task 6), and `sectionHead`, `baselineLine`, `savedBody` (Task 3).
- Produces: `overallBlock(overall, { width, context }) -> Segment[][]`. The order:
  1. `sectionHead('overall savings for this session' + (running ? ' so far' : ''), { extra: `${count} workflows`, width })`, at pane width.
  2. `baselineLine(overall.baseline)`.
  3. `savedBody(overall, { width: min(width, 56), context, nothing: 'these workflows may have saved nothing' })` (my pick).
  4. Dim scope lines, only when `counted.five_hour < count`: `  5-hour counts the N workflows of this window`. The weekly line follows the same rule.
- It returns `[]` when `count === 0`. When `status !== 'estimated'`, it draws the head, then one dim prose line, `  no estimate yet` (my pick), with no rows.

- [ ] **Step 1: Write failing tests**
  - Line 0 starts with `══ overall savings for this session so far` and contains `15 workflows`.
  - Line 1 is `  vs every agent on Sonnet xhigh`. With mixed baselines it is `  vs your session's model at each launch`.
  - Rows `context`, `5-hour` and `weekly` appear with bars, built by the same `rowLine` as a run's block. Assert the row strings equal the ones `savedBlock` gives for the same data.
  - The scope line appears with `counted.five_hour: 7, count: 15` and is absent when the counts are equal.
  - On an API key, a cost row appears and there is no money line.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(eval): overall savings block for the session`.

### Task 8: The list view: sections, 2-line rows, window, stopped fold

**Files:**
- Create: `src/listWindow.mjs`, `tests/listWindow.test.js`
- Modify:
  - `src/eval.mjs`: `setStoppedOpen(state, open)` writes `ui.list.stoppedOpen`. Read it as `state.ui.list?.stoppedOpen ?? false`, so old stored state works. Do not add it to `createState`, which would break the `ui` deepEquals at `tests/eval.test.js:875`, :877 and :884. `openRun` and `closeRun` leave it alone.
  - `src/nav.mjs`: the `paneNav` list branch.
  - `types/index.d.ts`: `ui.list?` (:169) and `stoppedClock` on the run view.
  - `hooks/eval.tsx`:
    - List view (:673-714): `all` includes the stopped runs, so the column header, the hint and the widths survive when only stopped runs exist.
    - Context: the context fill (:543-545) moves above `if (open)`, so both views pass it.
    - `ui.scroll` (:471-482): the focus handling described below.
    - `ui.close`: reset `stoppedOpen` only on the path that reaches `next(e)` (:456), not when esc leaves a run's view.
- Test: `tests/nav.test.js`, `hooks/eval.test.tsx` (:362-374 ring props, :174, :510 hint)

**Interfaces:**
- Produces, from `src/listWindow.mjs`: `listWindow({ items, room, focusKey, scrolloff = 1 }) -> { from, to, above, below }`.
  - `items` is `[{ key, lines, row: boolean }]` in draw order. A row is 2 lines, the first row of a group adds 1, and a `subHead` with its blank line is 2.
  - `room` is the rows left for the list.
  - The result covers items `from..to-1`, including the focused item and `scrolloff` rows on each side where they exist. `above` and `below` count the rows hidden on each side.
  - When everything fits, `{ from: 0, to: items.length, above: 0, below: 0 }`.
  - The window anchors on the focused row by moving the least from the previous `from`. The caller passes `prevFrom`, kept in a module-level `Map` in `hooks/eval.tsx` keyed by surface (visual only, lost on reload). `listWindow` clamps `prevFrom` to the items.
  - The first drawn row always gets `marginTop` 0 and counts 3 lines, even mid-group, so it never overlaps the `↑ N more` line.
- `paneNav` list branch: reachable is `run:<key>` for the running runs, then the finished runs, then `fold:stopped` when any run is stopped, then `run:<key>` for each stopped run when `stoppedOpen`. The resting key is unchanged.
- Strings, one constant each: `MORE_ABOVE = (n) => `  ↑ ${n} more``, `MORE_BELOW`, `STOPPED_TITLE = 'stopped this session'`, and `FOLD_HINT` for the open and closed states.

Layout, top to bottom:
1. `ultraguard-eval`.
2. A blank line.
3. `overallBlock` (Task 7).
4. A blank line.
5. `sectionHead('workflows', { extra: 'N running' | 'none running' })`.
6. "No workflow is running." when there are none.
7. The column header row.
8. `MORE_ABOVE` when `above > 0`, or a blank reserved line while windowed.
9. The windowed items.
10. `MORE_BELOW`, or a blank line.
11. A blank line.
12. The hint.

Item details:
- Running rows, then `subHead('finished this session')` with the finished rows, then the stopped fold row: `▸`/`▾` `stopped this session  N workflows` in a ring box like a row. When open, the stopped rows show `stopped HH:MM` in the agents column.
- Rows: `<Box marginTop={firstInGroup ? 0 : -1} {...ring(here)}>`.
- `room = e.props.scroll.bodyRows - fixedAbove - fixedBelow - 2` (the two reserved more-lines), with a minimum of 3.
- `ui.scroll` handler: compute the target with `stepFocus`. Write it with `noteFocus` **before** calling `$.ui.focus`, so the next drawing brings the row into the window. If the focus call comes back `{ deny }`, put the previous focus back.
- The fold row is a Box keyed `box:fold:stopped` (what `boxKeyOf('fold:stopped')` gives, `src/nav.mjs:23`), holding a Button keyed `fold:stopped` whose `onPress` toggles `stoppedOpen`. It is a subgroup item, like `finished this session`, so it is not a `══` section. That is how the mock draws it.

- [ ] **Step 1: Write failing pure tests** in `tests/listWindow.test.js`:
  - 15 rows with room 12: focus on row 0 gives `{ from: 0, above: 0 }` and `below > 0`. Focus on row 14 gives `to === 15` and `below === 0`.
  - Moving focus down one row at a time shifts `from` by at most one row.
  - The focused row always has one row drawn past it when that row exists (scrolloff).
  - Room smaller than one row plus scrolloff still returns the focused row alone (Review Focus 1).
  - Everything fits gives the full range and zero hidden.
- [ ] **Step 2: Write failing nav tests.** The fold key comes after the finished runs. The stopped rows are reachable only when `stoppedOpen`.
- [ ] **Step 3: Write failing pane tests**:
  - Row Boxes after the first in a group have `marginTop: -1`, and the first has 0.
  - The picked row keeps the round outline.
  - With `scroll: { offset: 0, bodyRows: 20 }` and 15 runs, `↓ N more` is drawn, and the overall head is still the first section.
  - Pressing the fold Button shows the stopped rows. Closing the pane folds it again.
  - With only stopped runs, the list shows "No workflow is running.", the overall section and the fold row (Review Focus 2).
  - The hint on the fold row is `↑↓ choose  enter opens the stopped ones  esc close`.
- [ ] **Step 4: Run `npm test`.** Expected: FAIL.
- [ ] **Step 5: Implement.**
- [ ] **Step 6: Run `npm test`.** Expected: PASS.
- [ ] **Step 7: Commit** with `feat(eval): workflow list with pinned overall savings, window and stopped fold`.

### Task 9: Version, docs, live verification

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (0.4.15), `CHANGELOG.md`, `docs/reference.md` (pane description), `docs/superpowers/specs/2026-11-09-ultraguard-saved-bars-design.md` (heading and `±` sections point to the new spec)

- [ ] **Step 1:** Bump the versions and write the CHANGELOG entry: list redesign, stopped detection, ranges, collapsed defaults, tally. Run `npm test`. Expected: PASS, including `tests/version-sync.test.js`.
- [ ] **Step 2: Live check per CLAUDE.md.** Run `claude --plugin-dir /home/sebastian/.herdr/worktrees/ultraguard/redesign-workflows-view`, then `/effort ultracode`. Then:
  - Run 3 or more workflows. Confirm the overall section, the double rules, the 2-line rows, and the ranges in the list and in the run view.
  - Confirm the run view order is saved, then phases (all `▸`), then checks.
  - Stop one workflow with TaskStop. It moves to the folded stopped section, and the total includes it.
  - Shrink the terminal so the list windows. Arrows move through the hidden rows, and the overall section stays visible.
  - Run `/compact` and reopen: the figures are unchanged.
  - Run `/clear`: the total starts over.
  - Check both dark and light themes.
- [ ] **Step 3:** Commit `chore: 0.4.15`. Open the PR when the user asks.

## Verification

- `npm test` on Node 18 after each task.
- The four live spikes (Task 1) before Task 5 and Task 8 are built on.
- The final live pass (Task 9 Step 2), with screenshots compared against the mock at https://claude.ai/artifact/JfwQ9rQG2mWPdqzCXpE9LQ.
