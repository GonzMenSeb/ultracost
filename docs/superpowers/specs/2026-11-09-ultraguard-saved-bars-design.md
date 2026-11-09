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
| `»` | use plus saving passes 150 percent of the limit | saving color |

The used part is the theme's text color. A cell that holds the end of use and the start of saving keeps the text color.

## Scale

- **Length:** `T = clamp(width - 15 - usedW - figW, 12, 48)` cells, with `usedW` the widest used text (at least 4) and `figW` the widest figure (at least 12).
- **Scale:** the longest use plus saving over the rows, clamped to 100 to 150 percent. Up to 100 the limit mark is the last cell. Past it, `ceil(T * (S - 100) / S)` cells go after the mark and the bar spills over it.
- **Cap:** when use plus saving is past 150 percent the last cell is `»`.
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
- **Hedges:** a saving under 2 points hedges the first two bands. The word is "likely" ("would likely have blown past", "would likely have had only") when use plus the low end of the range stays in the same band, else "might" ("might have hit your 5-hour limit", "might have had only"). The half band hedges on margin: when total is under 5 points over 50 it reads "would likely have been past half". The half band never says "might".
- **Merging:** rows with the same outcome and hedge become one sentence: "... your 5-hour and weekly limits". Two near rows never merge, because each has its own points left.

The wording is provisional; the user will change it. The thresholds sit in `src/limitText.mjs` as `NEAR`, `TINY`, `HALF` and `HALF_MARGIN`.

## Footer

- The money line and the tokens line each on their own line: `$17.66 ±$30.08 at API prices` (or `off your API bill`), `56.7M fewer tokens`. With a cost row the money line is not repeated. More tokens keeps its sentence, wrapped: "46k more tokens: Haiku, Opus and Sonnet read and wrote more, at a lower price per token".
- A dim note: `± = how far off, 9 times in 10`.
- When the first range reaches below zero, a dim `this run may have saved nothing`.
- Heading, rows, messages and footer are no wider than 56 columns. The same compact layout is used at every pane width; a pane narrower than 56 shrinks the bar down to 12 cells and wraps the prose.

## Coverage

Coverage lines are dim and appear only when something is off:

- `from 5 of 6 agents: ultraguard has no price for the model one agent ran on` (unpriced agents, or "has no ratio for sonnet high against opus xhigh");
- the ratio source lines: "ratio measured at high effort, adjusted with published figures for xhigh" and "no replay measured sonnet high against opus xhigh; using published figures, so ± is wide", with "ratio measured on N replayed agents" ahead of them when some pairs were measured.

When every agent counted and every ratio was measured, none of these lines print. They used to print every time.

## Frozen usage

The gray part of a limit bar is the use at the last estimate, so use and saving describe one moment. A finished run keeps the usage from its last estimate; it does not drift as the account keeps filling.

- `usedOf(last, now)` in `src/meter.mjs` returns the last reading's percent, or null when there is no reading, the percent is not a number, or `resetsAt` is already past.
- After the estimate, `hooks/eval.tsx` stores `used: { five_hour, seven_day }` on the saved record. Each is a percent or null.
- Records written before 0.4.14 have no `used`. Their rows draw without a bar and without a used percentage.
- Use above 100 is drawn as 100.

## The context row

Reads the session's live context window the way a status line does.

- **Data flow:** on `session.start` the mod reads `$.session.usage().context`; on every `session.measure` whose change includes `context` it takes `e.context`. Both carry `window` and, when known, `tokens` and `percent`. `noteContext` records them in the context state and says whether to ask for the compaction window.
- **Window:** the model window, or the smaller compaction window when auto-compaction is on and its `rawMaxTokens` is under the model window. The compaction window comes from `$.session.usage({ breakdown: 'summary' })`, a local estimate that sends no request, read once per model window. After 3 missed reads for one window it stops asking. A new model window forgets the read.
- **After a fresh session or a compaction** the host sends no tokens until the next response. `session.compact` on the main loop and `/clear` set the tokens to null. The row shows an empty track and a dash: `context ──────── — — of 1M`.
- **Shown as:** the percent rounded down, then `125k of 1M`. The percent can pass 100 against a compaction window; the bar clamps it, the text does not.
- **Where it lives:** its own atom (`context`, shape `context-1`), apart from the eval atom. Nothing in it reaches `persist`, so no run record or `.eval.json` file carries it; the pane reads it at draw time and passes it to `savedBlock(saved, { width, context })`.
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
- Coverage lines only when something is off, extended to the published-figure ratio lines. That extension is the owner's reading of "only when incomplete".

Dropped:

- **Teal for the used part.** An unchosen toggle in the mock. No `planMode` color either. The text color is the only one.
- **The 60 percent cap rule** (anything past a 60 percent saving shown only as `»`). `»` now means only use plus saving past 150 percent of the limit; a large saving shows as the deep purple.
- **The 30/40 toggle.** The ramp ends at 40.
- The mock's bar-shape and layout toggles.

## Out of scope

A bar for the weekly Fable limit (not exposed), a history of saved percent across runs, per-agent bars, and any change to the estimator, the meter or the list columns.

## Limits

- Not verified in the host: the width of `─ ━ ╸ │ »` (if the terminal treats them as double width, bars overflow), whether an explicit `color` wins over `dimColor` on the same text, and the real left offset of the saved block (the `- 4` in the width is provisional).
- The deep purple has low contrast on dark terminals, about 1.6 to 1 on `#262626`. The bar's end, the `+N` figure, `»` and list figures can be near invisible there. The palette tests keep 3 to 1 up to 20 percent only.
- When use is above about 96 percent and use plus saving stays under 100, the bar has no room to spill, and the saved part can be hidden under the used cell.
- Over-the-limit, `»` and tiny-saving cases need an account at those levels, so only the unit tests exercise them.
- The context row needs a response before it shows tokens, and the compaction window depends on the host reporting `isAutoCompactEnabled` and `rawMaxTokens`.

## Version

0.4.14 (patch), in `package.json`, `.claude-plugin/plugin.json` and the marketplace entry.
