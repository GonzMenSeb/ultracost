# ultraguard 0.4.14 Saved Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the "ultraguard saved" block in ultraguard-eval as bars: one thick-line bar per row (context, 5-hour and weekly; context and cost for API keys), a saving gradient, limit messages under the bars, a shorter footer and coverage lines only when something is off.

**Architecture:** Three new pure ES modules do the work, each with its own test file: `src/limitText.mjs` (messages), `src/bars.mjs` (cells, layout, row lines), `src/context.mjs` (context window state). `src/palette.mjs` gains one gradient stop, `src/meter.mjs` gains `usedOf`, and `src/savedText.mjs` `savedBlock(saved, { width, context })` is rewritten on top of them. `hooks/eval.tsx` freezes the limit usage on the saved record, keeps the live context window in an atom of its own, and passes both to the block.

**Tech Stack:** Node 18 ESM, no dependencies, `node --test`; the Claude Code mod API (`claude plugin test`, `claude plugin validate`).

**Spec:** `docs/superpowers/specs/2026-11-09-ultraguard-saved-bars-design.md`. Approved mock: `savings-bars-v3.html` in the session scratchpad, published as a claude.ai artifact (https://claude.ai/artifact/JfwQ9rQG2mWPdqzCXpE9LQ); its checks `check-v4.mjs` and `check-v5.mjs` are the oracle the tests port.

## Global Constraints

- Node 18 APIs only (CI runs Node 18); plain ESM JavaScript in `src/`; no dependencies.
- Comments only where absolutely necessary (user rule).
- No middle dot in new text. Plain, short sentences.
- Used part in the theme text color only; the saving gradient is the only other bar color.
- The last saved cell and the `+N` figure take the same color from one `savedColor` call.
- The block is never wider than 56 columns.
- The context window is live state: it must not reach any persisted run record or `.eval.json`.
- A record without `used` (written before 0.4.14) draws its limit row without a bar and does not throw.
- Version 0.4.14 in `package.json`, `.claude-plugin/plugin.json` and the `ultraguard` entry of `.claude-plugin/marketplace.json` (enforced by `tests/version-sync.test.js`). Patch only.
- After `npm test` passes, live-verify by loading this working copy into Claude Code (`claude --plugin-dir /home/sebastian/versioned-code/ultraguard`) with ultracode on (`/effort ultracode`), per CLAUDE.md. Tests alone do not count.

## Review Focus

1. The gradient and the figure agree: the last saved cell has exactly `savedColor(saving)` when the bar is not capped (Task 3, `the last saved cell is exactly savedColor(saved) when the bar is not capped`).
2. No block line passes 56 columns at 44, 56, 72 and 110 wide, with or without a context row (Task 5, `no line is wider than the block, which is capped at 56 columns`).
3. A saved record with no `used` still renders (Task 5, `a limit with no usage reading draws its figure without a bar`) and `usedOf` returns null after the reset time (Task 4).
4. The half message never beats a stronger one and merges only with the same wording (Task 2, `half band: stronger band wins`, `half band: merging`).
5. The context state is not part of `eval-2` or of any record written by `persist` (Task 6).

---

### Task 0: Branch and docs

- [ ] **Step 1:** Work on the branch `saved-bars`, cut from `main`.
- [ ] **Step 2:** Commit the spec and this plan: `git add docs/superpowers && git commit -m "Spec and plan for ultraguard 0.4.14 saved bars"`.

### Task 1: Palette stop

**Files:**
- Modify: `src/palette.mjs`
- Test: `tests/palette.test.js`

**Interfaces:**
- `savedColor(pct)` gets a fourth stop `[40, [0.42, 0.2, 302]]` in OKLCH. Hex at 1 / 10 / 20 / 40 percent: `#79e4f0`, `#65a7fa`, `#8565e1`, `#641aa5`. Flat after 40. Below 1 and non-finite input give the 1 percent color.

- [ ] **Step 1: Update the tests** in `tests/palette.test.js`:
  - keep the exact values at 1, 10 and 20 and the contrast of at least 3 to 1 on `#262626` up to 20 percent;
  - replace "flat after 20" with: the end color is `#641aa5`, the color is flat after 40, and 0, -3 and NaN equal the 1 percent color;
  - luminance never rises from 1 to 40 percent;
  - no contrast floor past 20 (the deep purple is 1.61 to 1 on `#262626`; the user chose it).
- [ ] **Step 2:** `node --test tests/palette.test.js` -> the new cases FAIL.
- [ ] **Step 3:** Append the stop to `SAVED_STOPS`.
- [ ] **Step 4:** `node --test tests/palette.test.js` -> PASS.

### Task 2: Limit messages

**Files:**
- Create: `src/limitText.mjs`
- Test: `tests/limitText.test.js`

**Interfaces:**
- Produces:
  - constants `NEAR = 10`, `TINY = 2`, `HALF = 50`, `HALF_MARGIN = 5`;
  - `bandOf(total): 'over'|'near'|'far'` (`over` above 100, `near` from 90 to 100, else `far`);
  - `limitMessages(rows): string[]` where a row is `{ label, used, saved, range }`; rows with no range, no saving above zero or a null `used` are skipped. The sentences are the spec's table, with the hedges "likely" and "might" for a saving under 2 points (same band for `used + range.lo` gives "likely") and "likely" for a half margin under 5. Rows with the same kind and hedge merge into "5-hour and weekly limits"; `near` never merges;
  - `wrapText(text, width): string[]`, greedy word wrap.

- [ ] **Step 1: Write the failing tests:**
  - `constants and bandOf`;
  - preset messages for the cases in the spec: over, near, near with under 1 point left, hedged over and near;
  - `used, saved and lo grid`: a sweep of use, saving and low end against an independent recomputation of the band and the hedge;
  - `half band: strict boundaries` (use 50 and total 50 give nothing);
  - `half band: hedge margin` (total 54.9 is "likely", 55 is not);
  - `half band: stronger band wins` (total 95 gives the near sentence only);
  - `half band: merging` (two half rows with the same hedge become one sentence);
  - `near rows never merge`;
  - `null used and null range are skipped`;
  - `half messages never contain might`;
  - `wrapText` on short, exact-fit and long words.
- [ ] **Step 2:** `node --test tests/limitText.test.js` -> FAIL (module missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node --test tests/limitText.test.js` -> PASS.

### Task 3: Bars

**Files:**
- Create: `src/bars.mjs`
- Test: `tests/bars.test.js`

**Interfaces:**
- Consumes: `savedColor` (Task 1).
- Produces (a segment is `{ text, style, color?, pct? }`):
  - `MAX_WIDTH = 56`, `lineLength(segments)`;
  - `barCells(row, T, L): Segment[]` of `T + 1` segments, the limit mark `│` (color `inactive`) after cell `L`. A row is `{ label, used, usedText, saved, fig, range }`. Used cells are `━` or `╸` in `text`; track cells `─` in `subtle` before the mark and blank after; saved cells take `savedColor` of the saving shown up to that cell, the last one `savedColor(saved)`; a saving above zero draws at least half a cell; when use plus saving is past `2 * T + 0.5` halves the last cell is `»` with style `saved` and `pct`;
  - `layoutOf(rows, width): { T, L, usedW }` with `T = clamp(width - 15 - usedW - figW, 12, 48)` and the scale clamped to 100 to 150 percent; rows with `used` null are left out of the scale;
  - `rowLine(row, layout): Segment[]`: label padded to 8 after two spaces, the bar, the used text right-aligned in `usedW` between two spaces on each side, then the figure. A row with `used` null has blanks of the same length in place of the bar and used text.

- [ ] **Step 1: Write the failing tests** (ported from `check-v4.mjs` / `check-v5.mjs`, run against the real module):
  - `bar cells follow the independent recomputation across the sweep` (use 0 to 100 by 5, saving 0 to 60, T 12 to 48);
  - `the last saved cell is exactly savedColor(saved) when the bar is not capped`;
  - `capped bars end in the saved-style cap`;
  - `used cells all use the text color`;
  - `a row with no saving has no hex cell and no cap`;
  - `used above 100 behaves like 100 and below 0 like 0`;
  - `a saved 40 row at T 48 shows at least 6 distinct shades`; luminance does not rise along the saving, within one 8-bit step;
  - `the marker splits the bar at L`;
  - `layoutOf` for the base rows, with the mark placed when the total passes 100, clamping used, ignoring null rows, and `T` kept within 12 and 48;
  - `rowLine` puts label, bar, used text and figure together; a null-used row has no bar glyphs and the same length as a drawn row.
- [ ] **Step 2:** `node --test tests/bars.test.js` -> FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node --test tests/bars.test.js` -> PASS.

### Task 4: Frozen usage and the context state

**Files:**
- Modify: `src/meter.mjs`
- Create: `src/context.mjs`
- Test: `tests/meter.test.js`, `tests/context.test.js`

**Interfaces:**
- `usedOf(last, now): number|null` in `src/meter.mjs`: the reading's percent; null when there is no reading, the percent is not a finite number, or `resetsAt` parses to a time at or before `now`.
- `src/context.mjs`:
  - `createContext()`: `{ tokens: null, window: 0, compact: null, asked: 0, misses: 0 }`;
  - `compactWindowOf(breakdown, window): number|null`: `rawMaxTokens` only when `isAutoCompactEnabled === true`, it is above zero and it is under `window`;
  - `noteContext(state, context): { state, ask }`: records `tokens` (null when absent) and `window`; a new window clears `compact`, `asked` and `misses`; `ask` is true once per window while `misses < WINDOW_TRIES` (3); an unchanged state comes back as the same object; a window that is not a positive number leaves the state alone;
  - `noteBreakdown(state, window, breakdown): State`: ignored unless `asked === window`; a breakdown sets `compact` and clears `misses`; none adds a miss and re-opens asking;
  - `contextFill(state): { tokens, window, pct }|null`: the compaction window when it is smaller than the window, else the window; `pct` null while the tokens are unknown; not clamped.

- [ ] **Step 1: Write the failing tests:**
  - `tests/meter.test.js`: `usedOf` returns the percent; null for no reading and a non-number; null at and after the reset time, the percent just before; a reading with no `resetsAt` string keeps the percent.
  - `tests/context.test.js`: the cases for the functions above, named in the file (`a fresh context knows nothing`, `the same window is not claimed twice`, `three misses and the window is no longer asked for`, `a new window forgets the compaction read and the misses`, `a superseded breakdown is ignored`, `contextFill ignores a compaction window that is not smaller than the window`, and the rest).
- [ ] **Step 2:** `node --test tests/meter.test.js tests/context.test.js` -> FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** both files -> PASS.

### Task 5: The block

**Files:**
- Modify: `src/savedText.mjs`
- Test: `tests/savedText.test.js`

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces `savedBlock(saved, { width = MAX_WIDTH, context = null } = {}): Line[]` as in the spec: heading (one line, two when it does not fit), rows (`context`, limits or `cost`), limit messages, the money line when there is no cost row, the tokens line, the `± = how far off, 9 times in 10` note, `this run may have saved nothing` when the first range reaches below zero, and the coverage lines only when something is off. Rows: a context row only when `context.window > 0`; limit rows only on a subscription with `limits`; a cost row only off a subscription with `baselineDollars > 0`.
- Removes the old row helpers (`limitRows` text version, `dollarRow`, `figure`, `AMOUNT_COLUMN`). `agentColumn`, `listHeader`, `listCell`, `toastText`, `fmtPct`, `fmtUsd`, `fmtTokens` and the phase helpers are unchanged. `saved.used` is the new optional input.

- [ ] **Step 1: Rewrite the block tests** (the index-based block rows in the old file) as:
  - `the block shows both limit bars, the money line, the tokens and one note`;
  - `the context row leads, with its fill and window`; `a context with no reading yet shows an empty track and a dash`; `the context window prints in millions or thousands`;
  - `the header holds one line when it fits and two when it does not`; `the model in the header takes its effort color`;
  - `the bar segments carry the ink, the track, the limit mark and the saving`; `the last saved cell and the figure share one color for a large saving`;
  - `use plus saving over the limit spills the bar past the mark and says so`; `a saving past half of a limit says so, hedged on a small margin`; `long messages wrap inside the width`;
  - `no line is wider than the block, which is capped at 56 columns` at 44, 56, 72 and 110;
  - `an API key shows a cost bar from the bill it avoided`; `an API key with no baseline cost keeps the dollars as a line`; `no limit reading yet reads at API prices without bars`;
  - `a limit with no usage reading draws its figure without a bar`; `an uncalibrated limit says how many readings it has, beside its usage`; `a calibrated window shows next to an uncalibrated one`;
  - `a tiny saving reads below 0.1 and a negative one has no plus`; `negative saved tokens read as more tokens and wrap inside the width`; `a range below zero says the run may have saved nothing`; `without limit bars the money range decides the nothing-saved line`;
  - coverage: nothing prints when every agent counted with measured ratios; an unpriced agent, a missing ratio, a chained ratio and a published-figure prior each print their line.
- [ ] **Step 2:** `node --test tests/savedText.test.js` -> FAIL.
- [ ] **Step 3:** Rewrite `savedBlock`. Check the output by eye with a copy of `smoke.mjs` and `smoke2.mjs` in the session scratchpad (never in the repo): normal at 100 and 44, over the limit, API key, no reading, null `used`, priors.
- [ ] **Step 4:** `node --test tests/savedText.test.js` -> PASS.

### Task 6: Mod wiring

**Files:**
- Modify: `hooks/eval.tsx`, `types/index.d.ts`
- Test: `hooks/savings.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 to 5.
- Wiring:
  - **Frozen usage:** in `estimate()`, after the reading is recorded, `used = { five_hour: usedOf(meter.last.five_hour, at), seven_day: usedOf(meter.last.seven_day, at) }`, stored with `noteSaved(st, key, { ...saved, used })`. `types/index.d.ts` gives `Saved` an optional `used`.
  - **Context atom:** `const ctx = atom({ plugin: 'ultraguard', key: 'context' }, createContext(), { shape: 'context-1' })`, separate from the eval atom `eval-2`. `session.start` reads `$.session.usage().context`; `session.measure` handles `e.context` when it changed; both go through `noteContext`, and when it says to ask, `$.session.usage({ breakdown: 'summary' })` feeds `noteBreakdown`. Every read is wrapped in `guard` so a failure is logged and never reaches the session. `session.compact` on the main loop and `session.end` with reason `clear` set the tokens to null. Nothing from `ctx` is passed to `persist`.
  - **Segments:** `Segment` gains `color?`; `segmentLook` returns `{ weight, color }` when `color` is set; saved lines render with `truncate-end`.
  - **Width:** `const width = e.props.bodyColumns - 4` above the `savedBlock` call, and `savedBlock(open.saved, { width, context: contextFill(await read($, ctx)) })`.

- [ ] **Step 1: Update the plugin tests** in `hooks/savings.test.tsx`: the assertions that expected the old text rows and the "compared with running" line; add `the context row shows the live fill against the window`, `the context row measures against the compaction window when one is set` and `the context row waits with a dash until the first response of a window`; assert that the persisted record carries `savings.saved.used.five_hour` and no context fields.
- [ ] **Step 2:** `claude plugin test .` -> the new cases FAIL.
- [ ] **Step 3:** Implement the wiring and the types.
- [ ] **Step 4:** `claude plugin validate .` and `claude plugin test .` -> PASS.

### Task 7: Docs

**Files:**
- Modify: `README.md`, `docs/reference.md`, `CHANGELOG.md`, `assets/eval-pane.svg`

- [ ] **Step 1:** `CHANGELOG.md`: a 0.4.14 entry; mention the deep purple's contrast on dark terminals.
- [ ] **Step 2:** `README.md` (the "See what it saved" part): the bars, the gradient, the limit messages and the context row, in the README's own words.
- [ ] **Step 3:** `docs/reference.md`: replace the sample block and its bullets in "Savings" with the new block; update the colors paragraph (the ramp now ends at 40 percent in `#641aa5`); add `used` to the record table with the note that older records lack it. Lines that carry the middle dot as a separator in existing text stay as they are.
- [ ] **Step 4:** Rebuild `assets/eval-pane.svg` from a real capture of the detail view, with the svg tool in the session scratchpad.

### Task 8: Version

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

- [ ] **Step 1:** Bump 0.4.13 to 0.4.14 in all three.
- [ ] **Step 2:** `node --test tests/version-sync.test.js` -> PASS.

### Task 9: Verification

- [ ] **Step 1:** `npm test` -> PASS (no Node 20+ APIs; CI runs Node 18).
- [ ] **Step 2:** `claude plugin validate .` and `claude plugin test .` -> PASS.
- [ ] **Step 3: Live verification (pending, not done).** `claude --plugin-dir /home/sebastian/versioned-code/ultraguard`, `/effort ultracode`, run a real workflow, open `ultraguard-eval`, press Enter on the run. Check:
  - the block at 44, 56, 72 and 110 columns, on a dark and a light terminal;
  - the glyphs `─ ━ ╸ │ »` are one cell wide and the bars line up;
  - the gradient reads darker with more saved, and the last saved cell matches the `+N` figure;
  - the context row shows an empty track and a dash on a fresh session, fills after the first response, follows `/compact` and `/clear`, and uses the compaction window when auto-compaction is on;
  - an old record (before 0.4.14) opens without a bar and without an error;
  - limit rows need a subscription with at least 5 readings per window; the API key cost row needs an API key session.
  The over-the-limit, `»` and tiny-saving cases can only be checked in the unit tests.
- [ ] **Step 4:** Commit the work in steps, then push the branch and open a PR to `GonzMenSeb/ultraguard` (`--repo GonzMenSeb/ultraguard`). Merge only when the user says so.

## Risks not verified

- The host engine's width for the ambiguous-width glyphs `─ ━ ╸ │ »`.
- Whether an explicit `color` on a segment wins over `dimColor` on the same text; the mock never needed it, the pane does for the model name in the heading.
- The left offset of the saved block inside the pane; the `- 4` in the width is provisional.
- The deep purple `#641aa5` on dark terminals: 1.61 to 1 on `#262626`, so the bar's end, the `+N` figure, `»` and list figures can be near invisible. The user chose it.
- The bar's saved part is hidden when use is above about 96 percent and use plus saving stays under 100: the bar has no spill room and the saved half cell lands under the used cell.
- Whether the host reports `isAutoCompactEnabled` and `rawMaxTokens` in the summary breakdown on every plan.
- The wording of the limit messages is provisional.
