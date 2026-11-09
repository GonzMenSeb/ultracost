# ultraguard 0.4.14: bars in the saved block

## Why

The "ultraguard saved" block in ultraguard-eval (0.4.9) is text. A reader has to hold three numbers in their head to see what a saving means: how full the limit was, how much of it the run took, how much ultraguard gave back. A bar shows all three at once, on one scale, and shows when the saving was the difference between staying under a limit and going past it.

Anti-goals: no change to what is estimated (the estimator, the meter and their margins are as in `2026-11-08-ultraguard-savings-design.md`); no new data from the host beyond the context window; the row above the prompt is unchanged.

## Rows

One row per line, label first, a bar, the used figure, then the saved figure with its margin:

```
ultraguard saved so far  vs every agent on Sonnet xhigh
  context ━━━──────────────────────│   12%  125k of 1M
  5-hour  ━━━━━━━╸─────────────────│   13%  +17.8 ±30.7
  weekly  ━━━━━━━━━━━━━╸───────────│   50%  +3.5 ±6.5
  $17.66 ±$30.08 at API prices
  56.7M fewer tokens
  ± = how far off, 9 times in 10
  this run may have saved nothing
```

- **Subscription:** `context`, `5-hour`, `weekly`.
- **API key:** `context`, `cost`. The cost bar is the run's dollars against the dollars the baseline would have cost; the figure is `+$17.66 ±$30.08`.
- **No limit reading yet** (`subscription` is null): the context row, then the money line and the tokens line. No limit or cost bar.
- **Limit not calibrated:** the row keeps its label and the bar for used, and the figure reads `learning 3/5`. It has no saving, so no message.
- **Used unknown** (no reading, a window that already reset, or a record written before 0.4.14): the row has no bar and no used percentage, only the figure.
- **Cost row hidden** when the baseline's dollars are not above zero.
- The statuses `none`, no baseline and not estimated keep their short prose under the heading, as before.

The heading is one line, `ultraguard saved` or `ultraguard saved so far`, then `vs every agent on <Model> <effort>` (dim, with the model name bold in its effort color from the model palette). When that does not fit the width it takes two lines. It replaces the two lines "compared with running every agent on ..., your session's setting".

## Glyphs

One cell holds two halves, so a bar has twice as many steps as it has cells.

| Glyph | Meaning | Theme color |
|---|---|---|
| `━` | full cell, used or saved | `text` for used, the saving gradient for saved |
| `╸` | half cell (left half) | same |
| `─` | track, empty | `subtle` |
| `│` | the limit, at 100 percent | `inactive` |
| `»` | use plus saving passes the end of the bar, a little over 150 percent of the limit | saving color |

The used part is the theme's text color. A cell that holds the end of use and the start of saving keeps the text color.

## Scale

- **Length:** `T = clamp(width - 15 - usedW - figW, 12, 48)` cells, with `usedW` the widest used text (at least 4) and `figW` the widest figure (at least 12).
- **Scale:** the longest use plus saving over the rows, clamped to 100 to 150 percent. Up to 100 the limit mark is the last cell. Past it, `ceil(T * (S - 100) / S)` cells go after the mark and the bar spills over it.
- **Cap:** when use plus saving passes the end of the bar the last cell is `»`. The scale tops out at 150 percent of the limit, so that is a little over 150 percent, and the exact total moves with `T`. For a 5-hour row with use 100, the first cap is at a total of 158 at widths 56 to 110 and 166 at width 44.
- **Saving always shows:** a saving above zero draws at least a half cell, even when it rounds to nothing.
- **Context** has no saving. Its bar is use alone.

## The saving gradient

Darker means more saved. Each saved cell takes `savedColor(saving shown up to the end of that cell)`, in percent of the limit; a half cell is `100 / (2 * L)` points. The last saved cell takes `savedColor(saving)` and the `+N` figure takes the same call, so they match to the digit. The cost row uses the share of the baseline's dollars saved.

Stops in OKLCH, interpolated linearly and clipped to sRGB by lowering chroma:

| Saving | OKLCH | Hex |
|---|---|---|
| 1 percent and below | 0.86 0.10 205 | `#79e4f0` (cyan) |
| 10 | 0.72 0.14 255 | `#65a7fa` (blue) |
| 20 | 0.60 0.18 292 | `#8565e1` (violet) |
| 40 and above | 0.42 0.20 302 | `#641aa5` (deep purple) |

Luminance never rises along the ramp, so darker always means more. The ramp is flat after 40. A saving of 0, below 0 or not a number gets the 1 percent color. The deep purple is the user's pick; it reads poorly on dark terminals (see Limits).

## Limit messages

Under the bars, one sentence per outcome, wrapped to the block width. They look at limit rows with a saving above zero and a known use.

| When (use + saving = total) | Message |
|---|---|
| total above 100 | without ultraguard you would have blown past your 5-hour limit |
| total from 90 to 100 | without ultraguard you would have had only 2% of your 5-hour limit left |
| use under 50, total above 50, and neither of the above | without ultraguard you would have been past half of your 5-hour limit already |

- **Near** counts the points left (`100 - total`, rounded); under 1 it reads "less than 1%".
- **Half** is the third band. It needs use strictly under 50 and total strictly above 50. A stronger band wins: a row past 90 gets its own message, not the half one.
- **Hedges:** a saving under 2 points hedges the first two bands. The word is "likely" ("would likely have hit your 5-hour limit", "would likely have had only") when use plus the low end of the range stays in the same band, else "might" ("might have hit your 5-hour limit", "might have had only"). The half band hedges on margin: when total is under 5 points over 50 it reads "would likely have been past half". The half band never says "might".
- **Merging:** rows with the same outcome and hedge become one sentence: "... your 5-hour and weekly limits". Two near rows never merge, because each has its own points left.

The wording is provisional; the user will change it. The thresholds sit in `src/limitText.mjs` as `NEAR`, `TINY`, `HALF` and `HALF_MARGIN`.

## Footer

- The money line and the tokens line each on their own line: `$17.66 ±$30.08 at API prices` (or `off your API bill`), `56.7M fewer tokens`. With a cost row the money line is not repeated. More tokens keeps its sentence, wrapped: "46k more tokens: Haiku, Opus and Sonnet read and wrote more, at a lower price per token".
- A dim note: `± = how far off, 9 times in 10`.
- When the first range reaches below zero, a dim `this run may have saved nothing`.
- Heading, rows, messages and footer are no wider than 56 columns. The same compact layout is used at every pane width; a pane narrower than 56 shrinks the bar down to 12 cells and wraps the prose.

## Coverage

Coverage lines are dim and appear only when something is off:

- `from 5 of 6 agents: ultraguard has no price for the model one agent ran on` (unpriced agents, or "has no ratio for sonnet high against opus xhigh"), with "ratio measured on N replayed agents" after it when some pairs were measured;
- the ratio source lines: "ratio measured at high effort, adjusted with published figures for xhigh" and "no replay measured sonnet high against opus xhigh; using published figures, so ± is wide".

When nothing is missing (every agent priced, every ratio found, all agents used), the bare `from N of N agents` line and the measured-on line are dropped, and only the ratio source lines print, when they apply. When there are none either, no coverage line prints. They used to print every time.

## Frozen usage

The used part of a limit bar is the use at the last estimate, so use and saving describe one moment. A finished run keeps the usage from its last estimate; it does not drift as the account keeps filling.

- `usedOf(last, now)` in `src/meter.mjs` returns the last reading's percent, or null when there is no reading, the percent is not a number, or `resetsAt` is already past.
- After the estimate, `hooks/eval.tsx` stores `used: { five_hour, seven_day }` on the saved record. Each is a percent or null.
- Records written before 0.4.14 have no `used`. Their rows draw without a bar and without a used percentage.
- Use above 100 is drawn as 100.

## The context row

Reads the session's live context window the way a status line does.

- **Data flow:** on `session.start` the mod reads `$.session.usage().context`, and on every `session.measure`, whatever its `changed` list says, it takes `e.context`. `noteContext` takes the `tokens` and the `window`, stores them in the context state and says whether to ask for the compaction window. No percent is stored; `contextFill` computes it.
- **Window:** the model window, or the smaller compaction window when auto-compaction is on and its `rawMaxTokens` is under the model window. The compaction window comes from `$.session.usage({ breakdown: 'summary' })`, a local estimate that sends no request. The state claims at most one read per model window, and after 3 missed reads for one window it stops asking. The read is forgotten when the window changes and when the main-loop model changes (`forgetCompactRead` in `src/context.mjs`, called from the `turn.step` handler).
- **Draw time:** the pane reads `$.session.usage()` again for the fill. After `/compact` the host raises no measurement until the next response, so the fill fed by events would stay at the figure from before the compaction. Verified live: the live usage has no tokens right after `/compact`, so the row shows an empty track and a dash. The stored state is only the fallback, if that read fails, and the carrier of the compaction-window read.
- **After a fresh session or a compaction** the host sends no tokens until the next response, and the row shows an empty track and a dash: `context ──────── — — of 1M`. There is no `session.compact` handler, and nothing is reset on `/clear`, because the run list is cleared anyway.
- **Shown as:** the percent rounded to the nearest whole percent, then `125k of 1M`. The percent can pass 100 against a compaction window; the bar clamps it, the text does not.
- **Where it lives:** its own atom (`context`, shape `context-1`), apart from the eval atom. Nothing in it reaches `persist`, so no run record or `.eval.json` file carries it; the pane builds the fill at draw time and passes it to `savedBlock(saved, { width, context })`.
- Reimplemented from the host's typed API (`.claude-plugin/types/claude-code/index.d.ts`); no code was copied from another plugin, so `NOTICE` does not change.

## Width

`hooks/eval.tsx` takes `width = e.props.bodyColumns - 4` and passes it to `savedBlock`, which caps it at `MAX_WIDTH = 56`. Saved lines are already wrapped to that width, so the pane renders them with `truncate-end`. A segment may carry an explicit `color`, which the pane uses in place of the style's own.

## Decisions

Made:

- Used part in the theme text color. Thick-line bar shape and the compact layout at every width, block capped at 56.
- Ramp ends at 40 percent in the deep purple `#641aa5`, flat after.
- The half band, with its margin hedge.
- Limit usage frozen at the last estimate.
- A separate context atom, so live state cannot leak into records.
- Coverage lines only when something is off, extended to the published-figure ratio lines. That extension is the owner's reading of "only when incomplete". The bare agent count and the measured-on line print only when something is missing.

Dropped:

- **Teal for the used part.** An unchosen toggle in the mock. No `planMode` color either. The text color is the only one.
- **The 60 percent cap rule** (anything past a 60 percent saving shown only as `»`). `»` now means only use plus saving past the end of the bar, a little over 150 percent of the limit; a large saving shows as the deep purple.
- **The 30/40 toggle.** The ramp ends at 40.
- The mock's bar-shape and layout toggles.

Added beyond the approved plan:

- **The draw-time live context read.** The pane reads `$.session.usage()` when it draws the context row (see The context row), instead of showing only the fill that events carried.
- **The gate's relaunch rule.** A rejected model gives way to the next lower one at `xhigh` (`src/rules.mjs` and `policy/guidance.md`). The `PAIR` denial for a model its class does not allow says `Relaunch on sonnet with effort "xhigh".` before the allowed list.
- **The dropped bare coverage line.** With nothing missing, the bare `from N of N agents` line and the measured-on line no longer print (see Coverage).
- **Arrow keys with a scrolling pane.** When the pane has rows to scroll, the host turns the arrows into scrolling and the selection stays put. A one-row `ui.scroll` by the person with no pointer is an arrow: it moves the focus to the next or previous stop (`src/nav.mjs`), and every focus move scrolls the focused row into view. At the first or last stop the arrow scrolls. Wheel and page keys are untouched.

## Out of scope

A bar for the weekly Fable limit (not exposed), a history of saved percent across runs, per-agent bars, and any change to the estimator, the meter or the list columns.

## Limits

- Checked live: the bar glyphs line up, and the colors apply (text, track, limit mark and the model color in the heading). Not checked in the host: the width of `»`, because the cap was not drawn, and the real left offset of the saved block (the `- 4` in the width is provisional).
- The deep purple has low contrast on dark terminals, about 1.6 to 1 on `#262626`. The bar's end, the `+N` figure, `»` and list figures can be near invisible there. The palette tests keep 3 to 1 up to 20 percent only.
- On white the deep purple is 9.4 to 1, but the cyan end of the ramp is about 1.5 to 1, so small savings are faint on a light terminal. Light terminal rendering has not been checked live.
- When use is above about 96 percent and use plus saving stays under 100, the bar has no room to spill, and the saved part can be hidden under the used cell.
- A total just above 100 percent can show no spill: the mark sits inside the bar, but the bar stops at it.
- The cost row at a block narrower than about 48 columns is cut by the bar's 12-cell minimum.
- Not verified live: bars with a calibrated limit window (a window needs 5 readings), the over, near and half messages and the cap `»` (unit tests only), `/clear` and the cost bar of an API key.
- The context row needs a response before it shows tokens, and the compaction window depends on the host reporting `isAutoCompactEnabled` and `rawMaxTokens`.

## Version

0.4.14 (patch), in `package.json`, `.claude-plugin/plugin.json` and the marketplace entry.
