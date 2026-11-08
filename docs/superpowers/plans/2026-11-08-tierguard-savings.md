# tierguard 0.4.9 Savings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, for every workflow tierguard-eval tracks, what tierguard saved against running every agent on the session's model and effort: percent of the 5-hour and weekly limits, dollars at API prices, and tokens, each with a ± margin of error.

**Architecture:** Pure ES modules do all the math (`src/prices.mjs`, `src/stats.mjs`, `src/calibrate.mjs`, `src/savings.mjs`, `src/meter.mjs`, `src/savedText.mjs`), tested with `node:test`. `src/eval.mjs` records per-agent usage, the run's baseline and the meter readings in the existing eval state; `hooks/eval.tsx` feeds it from `turn.step`, `agent.spawn` and `session.measure`, stores each run's estimate when an agent finishes and when the run ends, renders the approved design and raises a toast. Ratios ship precomputed in `data/ratios.json`, built by `scripts/calibrate.mjs` from `data/replays.json` (the 22 measured pairs) and `data/published.json`.

**Tech Stack:** Node 18 ESM, no dependencies, `node --test`; the Claude Code 2.1.319 mod API (`claude plugin test`, `claude plugin validate`).

**Spec:** `docs/superpowers/specs/2026-11-08-tierguard-savings-design.md`. Approved mockup: `.superpowers/brainstorm/481422-1794143604/content/savings-v4.html` (picks 1A, 2A, finished runs in the pane, toast).

## Global Constraints

- Node 18 APIs only (CI runs Node 18); plain ESM JavaScript in `src/` and `scripts/`; no dependencies.
- No model call anywhere in tierguard; nothing on the request path waits on the estimate.
- Comments only where absolutely necessary (user rule).
- A figure tierguard cannot back is shown as unknown, never as 0; nothing is extrapolated to agents left out.
- Green and red keep meaning only enforced or evaded; the row above the prompt does not change.
- UI copy is exactly the spec's "Display" section wording; percentages one decimal ("< 0.1%" below), dollars two decimals, tokens `2.9M` / `84k`.
- Prices never fall back to Opus for an unknown model.
- Version 0.4.9 in `package.json`, `.claude-plugin/plugin.json` and the `tierguard` entry of `.claude-plugin/marketplace.json` (enforced by `tests/version-sync.test.js`).
- After `npm test` passes, live-verify by loading this working copy into Claude Code (`claude --plugin-dir /home/sebastian/versioned-code/ultracost`) with ultracode on (CLAUDE.md hard rule).
- Commit messages end with `Claude-Session: https://claude.ai/code/session_01Df6UEPByr1JvqX6Jdr9owL`.

## Review Focus

1. A workflow agent whose `turn.step` usage arrives before its `agent.spawn` is recorded: its usage must still count (Task 6, `early usage is kept when the spawn arrives later`).
2. The user runs `/effort` mid-session: a run's baseline is the effort in force when it launched, not when the pane draws (Task 6, `baseline effort is frozen at launch`).
3. An effort sent as a number (a thinking budget) or missing: the agent is counted as unknown and nothing throws (Task 4, `a numeric or missing effort makes the agent unknown`).
4. A 5-hour window resets during a run: the open interval is dropped and no negative Δ is ever stored (Task 5, `a reset or a drop stores nothing`).
5. Two sessions write meter intervals at the same time: per-session store keys merge on load and nothing is lost (Task 5, `intervals from several session keys merge, newest 200 kept`).

---

### Task 0: Branch

- [ ] **Step 1:** `git checkout -b savings` from `main` (the spec is uncommitted on `main`; it moves with the branch).
- [ ] **Step 2:** Commit the spec and this plan: `git add docs/superpowers && git commit -m "Spec and plan for tierguard 0.4.9 savings"`.

### Task 1: Prices

**Files:**
- Create: `data/prices.json`, `src/prices.mjs`
- Test: `tests/prices.test.js`

**Interfaces:**
- Produces:
  - `priceFamily(modelId: string|null): 'opus'|'sonnet'|'haiku'|'fable'|null` (case-insensitive substring; more than one match or none → null; `mythos` → null)
  - `loadPrices(json: object): Prices` (validates every number is finite and ≥ 0, throws otherwise)
  - `requestCost(prices, family, tokens): number|null` where `tokens = { input, output, cacheRead, cacheWrite }`; null when the family has no row
  - `meterUnits(prices, family, tokens): { u: number, c: number }|null` with `u = (input + cacheWrite)·p_in + output·p_out`, `c = cacheRead·p_in`, all per token (prices are per million)
  - `inputPrice(prices, family): number|null`

`data/prices.json`:
```json
{ "v": 1, "asOf": "2026-11-08", "source": "https://platform.claude.com/docs/en/about-claude/pricing", "unit": "USD per million tokens",
  "families": {
    "opus":   { "input": 4,   "output": 20,  "cacheRead": 0.20, "cacheWrite": 5 },
    "sonnet": { "input": 2,   "output": 10,  "cacheRead": 0.10, "cacheWrite": 2.5 },
    "haiku":  { "input": 0.10, "output": 0.50, "cacheRead": 0.01, "cacheWrite": 0.125,
                "longPrompt": { "above": 100000, "input": 0.50, "output": 2.50, "cacheRead": 0.05, "cacheWrite": 0.625 } },
    "fable":  { "input": 10,  "output": 50,  "cacheRead": 0.25, "cacheWrite": 12.5 } } }
```

- [ ] **Step 1: Write the failing tests** in `tests/prices.test.js`:
  - `priceFamily maps model ids and refuses unknowns`: `claude-opus-5-5`→`opus`, `claude-fable-5-1`→`fable`, `claude-mythos-5-1`→null, `null`→null, `'opus-sonnet'`→null.
  - `request cost prices each bucket`: opus `{input:1e6, output:1e6, cacheRead:1e6, cacheWrite:1e6}` → `29.2`.
  - `haiku long prompts are repriced whole`: input 60k + cacheRead 50k (110k > 100k) prices every bucket at the long row; 50k + 40k does not.
  - `unknown family has no cost`: `requestCost(p, null, t) === null` and `meterUnits(p, 'mythos', t) === null`.
  - `meter units weigh cache writes at the input price and keep cache reads apart`: sonnet `{input:1e6, output:1e6, cacheRead:1e6, cacheWrite:1e6}` → `{ u: 14, c: 2 }`.
  - `loadPrices refuses a negative or missing price`.
- [ ] **Step 2:** `node --test tests/prices.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement `src/prices.mjs` and `data/prices.json`. Haiku's long-prompt test is per request on `input + cacheRead + cacheWrite`.
- [ ] **Step 4:** `node --test tests/prices.test.js` → PASS.
- [ ] **Step 5:** Commit `feat(savings): prices`.

### Task 2: Statistics

**Files:**
- Create: `src/stats.mjs`
- Test: `tests/stats.test.js`

**Interfaces:**
- Produces:
  - `rng(seed: number): () => number` (mulberry32, uniform [0,1))
  - `seedOf(text: string): number` (32-bit FNV-1a)
  - `normal(rand): number` (Box–Muller)
  - `t90(df: number): number` (two-sided 90% Student t; table df 1–30: 6.314, 2.920, 2.353, 2.132, 2.015, 1.943, 1.895, 1.860, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.740, 1.734, 1.729, 1.725, 1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697; above 30 → 1.645)
  - `quantile(sorted: number[], q: number): number` (linear interpolation)
  - `fieller(x: number[], y: number[]): { r: number, lo: number|null, hi: number|null }` — ratio of means `ȳ/x̄`, 90%, t at `n − 1`; `vxx = s²_x/n`, `vyy = s²_y/n`, `vxy = cov(x,y)/n` (sample, n − 1); `g = t²·vxx/x̄²`; `g ≥ 1` or negative discriminant → `lo = hi = null`; else `(R − g·vxy/vxx ± (t/x̄)·√(vyy − 2R·vxy + R²·vxx − g·(vyy − vxy²/vxx))) / (1 − g)`
  - `logSd(values: number[]): number` (sample sd, n − 1; 0 for fewer than 2)

- [ ] **Step 1: Write the failing tests:**
  - `rng is deterministic per seed` (same seed → same first 5 values; different seeds differ).
  - `normal draws have mean ≈ 0 and sd ≈ 1` (20,000 draws from seed 1: |mean| < 0.03, |sd − 1| < 0.03).
  - `fieller matches a hand-checked case`: `x=[10,12,9]`, `y=[30,33,29]` → `r ≈ 2.968`, `lo ≈ 2.645`, `hi ≈ 3.504` (±0.005).
  - `fieller is unbounded when the denominator is too noisy`: `x=[1,10]`, `y=[5,6]` → `lo === null && hi === null`.
  - `t90 falls back to the normal quantile above 30 df`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5:** Commit `feat(savings): statistics helpers`.

### Task 3: Calibration data and ratios

**Files:**
- Create: `data/published.json`, `data/replays.json`, `src/calibrate.mjs`, `scripts/calibrate.mjs`, `data/ratios.json` (generated, committed)
- Test: `tests/calibrate.test.js`

**Interfaces:**
- Consumes: `fieller`, `logSd`, `t90` (Task 2); `loadPrices`, `requestCost`, `inputPrice` (Task 1).
- Produces: `buildRatios({ replays, published, prices }): Ratios` and the `data/ratios.json` shape:
  ```
  { v: 1, claudeCode: '2.1.319', measuredAt: '2026-11-08', tau: number,
    pooledAgentSd: { output, fresh, read },
    measured: { 'sonnet:high>opus:high': { pairs, workflows,
        output: { r, lo, hi, mu, sigma, agentSd }, fresh: { …same }, read: { …same }, dollars: { r, lo, hi } } },
    steps: { opus: { 'high>xhigh': { mu, sd, sources } , … }, … },
    priors: { 'sonnet:high>opus:xhigh': { mu, sd, sources }, … } }
  ```
  Keys are `from>to`, configs `family:effort`. `mu = ln r`, `sigma = (ln hi − ln lo) / (2·1.645)`.

`data/published.json` (cost per task, USD; one object per source, never compared across sources):
- `aa-2026-11-08` (https://artificialanalysis.ai/providers/anthropic): opus low 0.98, medium 2.45, high 3.46, xhigh 6.05, max 10.04; sonnet 0.51, 0.78, 1.64, 4.09, 10.02; haiku 0.04, 0.09, 0.16, 0.25, 0.41; fable 4.47, 5.56, 7.54, 10.85, 12.99.
- `anthropic-swe-bench-pro` (https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence): opus low 0.11, medium 0.21, high 0.29, xhigh 0.74.
- `anthropic-agentic-370` (same URL): opus low 0.35, medium 0.84, high 1.38, xhigh 4.11; sonnet medium 0.16, high 0.33; fable medium 2.68.
- `community-claude-effort-cost` (https://huggingface.co/datasets/JOHNISKING/claude-effort-cost): opus low 0.17, medium 0.25, high 0.35, xhigh 0.82, max 5.33; sonnet medium 0.097, high 0.117; haiku low 0.0095, medium 0.0142, high 0.0205, xhigh 0.0388, max 0.378.

`data/replays.json`: built once from `/tmp/claude-1000/-home-sebastian-versioned-code-ultracost/f9f13f27-1f36-491f-8162-8f4927636605/scratchpad/replay/pairs.json` (22 rows; usage already merged by max per message id). Anonymize: `wq9m0v29a`→`{workflow:'w1', kind:'web research'}`, `witttj32b`→`{w2, 'code mapping'}`, `wcua90vt3`→`{w3, 'yes/no check'}`. Per pair: `{ workflow, kind, from: 'sonnet:high', to: 'opus:' + oe[0], baseline: {input:o.inp, output:o.out, cacheRead:o.cr, cacheWrite:o.cw}, actual: {…from r} }`. No labels, prompts or paths. Top level: `{ v:1, claudeCode:'2.1.319', measuredAt:'2026-11-08', method: 'same prompts replayed on Sonnet at high in repo snapshots at the original commits', pairs:[…] }`.

Algorithm (`buildRatios`):
- **measured:** group pairs by `from>to`; per bucket (`output` = output; `fresh` = input + cacheWrite; `read` = cacheRead) `fieller(actual, baseline)`; `agentSd = logSd(ln(baseline/actual))` over pairs with both > 0; `dollars` = `fieller` on per-pair costs (`requestCost` with each side's family). A bucket with `lo === null` is dropped; a transition with no bucket left is dropped.
- **tau:** per workflow `R_w` = Σ baseline cost / Σ actual cost; per transition `R_t` the same over all its pairs; `tau = max(0.15, √(Σ (ln R_w − ln R_t)² / max(1, W − T)))`.
- **pooledAgentSd:** `logSd` per bucket over all pairs.
- **steps:** for each family and each ordered effort pair `e1≠e2` (low, medium, high, xhigh, max): per source with both cells `ln(c(e2)/c(e1))`; `mu` = mean; `sd` = `logSd` when ≥ 2 sources, else 0.4.
- **priors:** for every `from` with family opus/sonnet/haiku and effort medium/high/xhigh, every `to` over all four families × five efforts, `from ≠ to`, different family: per source with both cells `ln(c(to)/c(from)) − ln(p_in(to)/p_in(from))`; `mu` = mean; `sd = max(0.6, logSd)` (0.6 with one source). No source → no entry.

`scripts/calibrate.mjs`: reads the three JSON files under `$PLUGIN_ROOT/data` (relative to the script), writes `data/ratios.json` with 2-space JSON and a trailing newline; `--check` exits 1 if the file on disk differs.

- [ ] **Step 1: Write `data/replays.json`** from `pairs.json` as specified (a throwaway `python3 -c` or `node -e`; not committed).
- [ ] **Step 2: Write the failing tests** (`tests/calibrate.test.js`, reading the real data files):
  - `measured web research ratio`: `measured['sonnet:high>opus:high']`: `pairs 4`, `output.r ≈ 1.07`, `fresh.r ≈ 1.15`, `read.r ≈ 2.29`, `dollars.r ≈ 2.60`, `dollars.lo ≈ 2.19`, `dollars.hi ≈ 2.89` (±0.01).
  - `measured medium ratio pools code mapping and checks`: `measured['sonnet:high>opus:medium']`: `pairs 18`, `output.r ≈ 0.61`, `dollars.r ≈ 1.59` (±0.01).
  - `tau comes from the spread between workflows`: `tau ≈ 0.30` (±0.01).
  - `opus effort steps agree across sources`: `exp(steps.opus['high>xhigh'].mu) ≈ 2.36`, `sd ≈ 0.22`; `exp(steps.opus['medium>high'].mu) ≈ 1.455` (±0.01).
  - `priors convert cost to tokens with the input-price ratio`: `exp(priors['sonnet:high>opus:xhigh'].mu) ≈ 3.43`, `sd ≈ 0.61` (±0.01).
  - `an unbounded bucket is dropped` (synthetic replays with 2 noisy pairs).
  - `the shipped ratios file is current`: `buildRatios(...)` deep-equals `data/ratios.json`.
- [ ] **Step 3:** run → FAIL. **Step 4:** implement `src/calibrate.mjs` and `scripts/calibrate.mjs`; run `node scripts/calibrate.mjs` to write `data/ratios.json`. **Step 5:** run → PASS.
- [ ] **Step 6:** Commit `feat(savings): calibration data and ratios`.

### Task 4: The estimator

**Files:**
- Create: `src/savings.mjs`
- Test: `tests/savings.test.js`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `configOf(family: string|null, effort: unknown): string|null` — `null` unless family is a price family and effort is one of `low|medium|high|xhigh|max`.
  - `ratioFor(ratios, from: string, to: string): Ratio|null` where `Ratio = { source: 'identical'|'measured'|'chained'|'prior', output: {mu, sigma}, fresh: {mu, sigma}, read: {mu, sigma}, agentSd: {output, fresh, read}, tau, pairs: number, via?: string }`. Order: identical (from === to, all zeros); measured; chained (measured into the same baseline family at the effort nearest the baseline's, ties to the lower; adds `steps[family]['e'>'eb']` mu to both buckets, `sigma = √(σ² + sd²)`; `via` = the measured effort); prior (`mu` both buckets, `sigma = sd`, `agentSd = pooledAgentSd`, `tau = 0`); else null.
  - `estimateRun({ agents, baseline, ratios, prices, meter, seed, draws = 4000, running }): Saved`
    - `agents: [{ agentId, pieces: [{ family, effort, input, output, cacheRead, cacheWrite }] }]` (one piece per config the agent sent requests on)
    - `baseline: { family, effort }|null`
    - `meter: { subscription: boolean|null, five_hour: Interval[], seven_day: Interval[] }` where `Interval = { d, u, c, at }`
  - `Saved`:
    ```
    { status: 'estimated'|'none'|'unknown', why: 'no-baseline'|'no-agents'|null, running,
      subscription: boolean|null,                                       // null: no limit reading yet → dollars "at API prices", no limit lines
      baseline: { family, effort }|null,
      dollars: Range|null, actualDollars, baselineDollars,              // baselineDollars = median counterfactual
      tokens: { saved: number, outputSaved: number }|null,              // negative = more tokens
      limits: null | { five_hour: Range|null, seven_day: Range|null, readings: { five_hour: number, seven_day: number } },
      agents: [{ agentId, dollars: number|null, five_hour: number|null }],   // per-agent medians
      coverage: { used: number, total: number, unpriced: number, noRatio: string[] },
      sources: { measuredPairs: number, chained: string[], priors: string[] } }
    Range = { mid, lo, hi, pm }   // 50th, 5th, 95th percentile; pm = max(mid − lo, hi − mid)
    ```
  - Draw `k`: `zRun ~ N(0,1)`; per transition `zT ~ N(0,1)`; per agent `eps ~ N(0,1)`; per piece and bucket `m = mu + sigma·zT + tau·zRun − tau²/2 + agentSd·eps − agentSd²/2`; counterfactual tokens = actual × `exp(m)` (fresh scales input and cacheWrite alike; read scales cacheRead); counterfactual cost with the baseline family's prices; saved = counterfactual − actual. Limits: `w ~ U(0, 0.1)`, a bootstrap resample of the window's intervals, `rate = Σd / Σ(u + w·c)`; points = `(meterUnits(cf, baseline) − meterUnits(actual, family))` with that `w`, times `rate`. A window shows only with ≥ 5 intervals; `readings` counts them either way. `limits` is null when `meter.subscription` is not true.
  - `status`: `unknown` with `why` when baseline is null (`no-baseline`) or no piece has a ratio (`no-agents`); `none` when every used piece is identical; else `estimated`.

- [ ] **Step 1: Write the failing tests** (`tests/savings.test.js`, using the real data files):
  - `an agent on the baseline configuration saves exactly 0`: status `none`, `dollars.mid === 0`, `pm === 0`.
  - `a measured transition reproduces the replay ratio`: one agent with the summed actual usage of `w1`'s pairs, baseline opus:high → `baselineDollars / actualDollars` within 2.2–3.1, `dollars.lo > 0`.
  - `the shared error does not shrink as agents are added`: 1 agent vs the same usage split over 10 agents → `pm/mid` of the 10-agent run ≥ 0.6 × the 1-agent run.
  - `same seed, same numbers`; `different run keys give different draws`.
  - `a numeric or missing effort makes the agent unknown` (`effort: 16000`, `effort: null`): coverage `used 0`, status `unknown`, `why 'no-agents'`, no throw.
  - `an unpriced model is counted, not guessed` (`family: null`): `coverage.unpriced === 1`.
  - `sonnet at high can use more tokens and still save money` (pieces from `w2`, baseline opus:medium): `tokens.saved < 0`, `dollars.mid > 0`.
  - `xhigh is chained from the measured high ratio`: `ratioFor(r, 'sonnet:high', 'opus:xhigh').source === 'chained'`, `via === 'high'`.
  - `a fable session falls back to the published prior`: `ratioFor(r, 'sonnet:high', 'fable:high').source === 'prior'`, `tau === 0`.
  - `limits need five readings`: 4 intervals → `limits.five_hour === null`, `readings.five_hour === 4`; 5 → a Range.
  - `limits are absent off a subscription`: `subscription: false` → `limits === null`.
  - `4,000 draws over 50 agents finish in under 250 ms`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5:** Commit `feat(savings): estimator`.

### Task 5: The limit meter

**Files:**
- Create: `src/meter.mjs`
- Test: `tests/meter.test.js`

**Interfaces:**
- Consumes: `meterUnits` (Task 1).
- Produces:
  - `createMeter(): Meter` = `{ subscription: null, acc: { five_hour: Tokens, seven_day: Tokens }, last: { five_hour: Reading|null, seven_day: Reading|null }, mine: { five_hour: Interval[], seven_day: Interval[] }, others: { five_hour: Interval[], seven_day: Interval[] } }`; `Tokens` = token sums per family `{ [family]: { input, output, cacheRead, cacheWrite } }`; `Reading = { pct, resetsAt }`.
  - `noteRequest(meter, family, tokens): Meter` (adds to both windows' `acc`; unknown family ignored).
  - `noteReading(meter, rateLimits, at, prices): Meter` — `rateLimits` as the engine gives them; empty list → `subscription: false`, non-empty → `true`; per window kind `five_hour`/`seven_day`: same `resetsAt` and `pct − last.pct ≥ 0.1` with `u > 0` → push `{ d: round1(pct − last.pct), u, c, at }` to `mine`, reset `acc`; changed `resetsAt` or a drop → reset `acc`, store nothing; always update `last`.
  - `intervalsOf(meter, kind, now): Interval[]` — `others` + `mine`, older than 30 days dropped, newest 200 kept.
  - `mergeStored(meter, stored: Record<string, unknown>, sessionKey: string): Meter` — loads every `meter:*` value except the session's own into `others`, ignoring malformed entries.
  - `storedValue(meter): { v: 1, five_hour: Interval[], seven_day: Interval[] }`.
- [ ] **Step 1: Write the failing tests:**
  - `a rise with usage stores an interval and restarts the counters`.
  - `a reset or a drop stores nothing` (changed `resetsAt`; `pct` 40 → 12).
  - `a rise with no usage of this session stores nothing`.
  - `an empty rate-limit list marks an API session`.
  - `intervals from several session keys merge, newest 200 kept` (3 keys × 90 intervals → 200, newest first by `at`; a malformed key ignored).
  - `intervals older than 30 days are dropped`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** Commit `feat(savings): limit meter`.

### Task 6: Eval state

**Files:**
- Modify: `src/eval.mjs`, `types/index.d.ts`
- Test: `tests/eval.test.js`

**Interfaces:**
- Consumes: `createMeter`, `noteRequest`, `noteReading` (Task 5); `priceFamily` (Task 1).
- Produces:
  - `createState()` gains `main: { model: null, effort: null }` and `meter: createMeter()`; atom shape in `hooks/eval.tsx` becomes `'eval-2'`.
  - `EvalAgent` gains `usage: Record<string, { family, effort, input, output, cacheRead, cacheWrite, requests }>` keyed `family:effort` (family from `priceFamily(usage.model)`, `null` family keyed `?:effort`); `early` entries carry `usage` too and hand it over in `noteSpawn`.
  - `EvalRun` gains `baseline: { model: string|null, effort: string|null }` and `saved: Saved|null`.
  - `noteMainStep(state, { model, effort }): State` (main-loop `turn.step` input).
  - `noteUsage(state, { agentId?: string, effort, usage }): State` — `usage` is the engine's `TurnUsage|null`; null ignored; feeds `state.meter` through `noteRequest` always, and the agent's `usage` when `agentId` belongs to a run (or `early`).
  - `noteMeterReading(state, rateLimits, at, prices): State`.
  - `noteLaunch` copies `state.main` into the new run's `baseline`; `noteSpawn` takes `parentModel` and sets `baseline.model` from it when given.
  - `noteSaved(state, key, saved): State`.
  - `finishedRuns(state): EvalRun[]` — ended, not `cleared`, newest `endedAt` first.
  - `agentPieces(run): Piece[]` for `estimateRun`.
  - `runView` adds `saved: run.saved`, `endedClock` (`HH:MM` of `endedAt`, null while running); `evalRecord` adds `savings: { baseline, saved, usage: per agent }`.
- [ ] **Step 1: Write the failing tests:**
  - `usage is summed per agent and configuration`.
  - `early usage is kept when the spawn arrives later`.
  - `baseline effort is frozen at launch` (`noteMainStep` effort high → launch → `noteMainStep` xhigh → run baseline stays high).
  - `parentModel sets the baseline model`.
  - `main-loop usage reaches the meter but no agent`.
  - `finished runs are listed newest first and cleared runs are not`.
  - `the eval record carries the savings block`.
- [ ] **Step 2:** FAIL. **Step 3:** implement; update `types/index.d.ts` (`EvalUsage`, `EvalMeter`, `Saved`, `SavedRange`, new fields). **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(savings): usage, baseline and meter in eval state`.

### Task 7: Display text

**Files:**
- Create: `src/savedText.mjs`
- Test: `tests/savedText.test.js`

**Interfaces:**
- Consumes: `Saved` (Task 4).
- Produces (a segment is `{ text: string, style: 'plain'|'bold'|'dim'|'opus'|'sonnet'|'haiku'|'fable' }`, a line is `Segment[]`):
  - `fmtPct(x)`, `fmtUsd(x)`, `fmtTokens(n)` (`2.9M`, `84k`, `512`; absolute value).
  - `savedBlock(saved: Saved): Line[]` — the spec's detail block exactly: heading `tierguard saved` / `tierguard saved so far` (bold); the `compared with running every agent on <Family> at <effort> effort, your session's setting` line (dim, family styled); figure lines with ± aligned at column 36; `± = how far off the estimate can be, 9 times out of 10`; the sources and coverage lines; every variant from the spec's Display list (API, learning, more tokens, may have saved nothing, unpriced, no replay, chained, nothing saved, no baseline). With `subscription: null` (no limit reading yet) the dollar line reads `at API prices` and no limit lines show.
  - `agentColumn(saved): { header: string, cell(agentId): string }` — `saved of 5-hour limit` with `0.4%`, or `saved at API prices` with `$0.63`, `—` for an unknown agent.
  - `listHeader(views): Line` and `listCell(view): Line` — `1.4% ± 0.6`, `0.6% so far`, `$2.32 ± $1.10`, `—`; a red view returns its reason in the error tone (left to the caller).
  - `toastText(view): string` — the four spec sentences.
- [ ] **Step 1: Write the failing tests** — one per spec variant, asserting the exact strings from the spec's Display section, plus `fmtPct(0.04) === '< 0.1%'`, `fmtTokens(2_900_000) === '2.9M'`, `fmtTokens(84_123) === '84k'`, and `the ± column starts at column 36`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** Commit `feat(savings): display text`.

### Task 8: Mod wiring and pane

**Files:**
- Modify: `hooks/eval.tsx`
- Test: `hooks/eval.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Wiring:
  - `session.start`: load `data/prices.json` and `data/ratios.json` from `$.plugin.root` into module variables; read `$.store.keys()` / `get` for every `meter:*` key into `mergeStored`; take one reading from `$.session.usage()`.
  - `turn.step`: `const result = yield* next(e)`; main loop → `noteMainStep` with the input's `model`/`effort`; every request → `noteUsage(state, { agentId: e.agentId, effort: e.effort, usage: result.usage })`; return `result`.
  - `agent.spawn`: pass `parentModel: e.parentModel` to `noteSpawn`.
  - `session.measure`: on `e.changed` including `rateLimits`, `noteMeterReading(state, e.rateLimits, now, prices)`; when `mine` grew, `$.store.set('meter:' + sessionId, storedValue(meter))`; return `next(e)`.
  - `turn.complete` with an `agentId` (agent done) and run end (`endRuns`): `estimateRun` for that run (agents from `agentPieces(run)`, baseline from `priceFamily(run.baseline.model)` and `run.baseline.effort`, meter `{ subscription: meter.subscription, five_hour: intervalsOf(meter, 'five_hour', now), seven_day: intervalsOf(meter, 'seven_day', now) }`, seed `seedOf(run.key)`, `running` while the run runs) → `noteSaved` → `persist`. At run end also `$.ui.toast(toastText(view), { timeoutMs: 8000 })`.
  - Pane, list view: header row from `listHeader`; running rows end with `listCell`; then, when `finishedRuns` is not empty, a blank line, `finished this session` (dim) and their rows with `done HH:MM` in the agents column; finished rows are Buttons that open the detail like running ones.
  - Pane, detail view: after the checks, `savedBlock(view.saved)` lines rendered segment by segment (`bold` → `weight="bold"`, `dim` → `dimColor`, families → `MODEL_COLORS`); the agent table gets the `agentColumn` header and cells.
  - `ui.close`: swallow Esc while a detail view is open for any listed run (running or finished), not only running ones.
- [ ] **Step 1: Write the failing plugin tests** in `hooks/eval.test.tsx`:
  - `the detail shows what a finished run saved, against the session's model and effort` — drive a launch, a spawn with `parentModel: 'claude-opus-5-5'`, main-loop step effort `high`, agent steps on sonnet/high with usage, five `session.measure` readings that rise, agent completion, the completion notice; assert the detail text contains `tierguard saved`, `of your 5-hour limit`, `± = how far off the estimate can be, 9 times out of 10`, `compared with running every agent on Opus at high effort`.
  - `an API session shows dollars and no limit lines` (empty `rateLimits`): `off your API bill`, no `5-hour`.
  - `the run list labels the saved column and keeps red reasons`.
  - `a finished run stays listed under "finished this session" and opens`.
  - `a toast says what the run saved when it ends`.
  - `an agent with no usage leaves the coverage line at "from 1 of 2 agents"`.
- [ ] **Step 2:** `claude plugin test .` → the new tests FAIL. **Step 3:** implement. **Step 4:** `claude plugin validate .` and `claude plugin test .` → PASS; `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(savings): tierguard-eval shows what each workflow saved`.

### Task 9: Docs, version, live verification

**Files:**
- Modify: `README.md`, `docs/reference.md`, `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `assets/eval-pane.svg`

- [ ] **Step 1:** Bump to 0.4.9 in the three files; `node --test tests/version-sync.test.js` → PASS.
- [ ] **Step 2: Live verification** (CLAUDE.md hard rule): with the tmux driver pattern in `/tmp/claude-1000/-home-sebastian-versioned-code-ultracost/f9f13f27-1f36-491f-8162-8f4927636605/scratchpad/live/drive.sh` (answer the trust prompt with Down then Enter), start `claude --plugin-dir /home/sebastian/versioned-code/ultracost --settings '{"enabledPlugins":{"tierguard@ultracost":false}}' --model opus --permission-mode bypassPermissions`, turn on ultracode, launch a compliant two-agent Sonnet workflow (`grunt:` stages, sonnet/medium, with `blocked_on` schemas). Capture: the run list with the saved column while running, the toast at the end, the "finished this session" row, and the detail view with the saved block. Check `actualDollars` in `<tool_use_id>.eval.json` against the two agent transcripts' usage priced by hand.
- [ ] **Step 3:** Regenerate `assets/eval-pane.svg` from the detail capture with `/tmp/claude-1000/-home-sebastian-versioned-code-ultracost/f9f13f27-1f36-491f-8162-8f4927636605/scratchpad/readme/term2svg.mjs`.
- [ ] **Step 4:** README: under "Know it was enforced", a short "See what it saved" part: what it compares against, the three figures and ±, that limit figures need 5 readings, and that the replays measured two transitions (link the spec's results table in `docs/reference.md`). `docs/reference.md`: the estimator, data files, `scripts/calibrate.mjs`, the meter, the record's `savings` block, limits. `CHANGELOG.md`: 0.4.9 entry.
- [ ] **Step 5:** `npm test`, `claude plugin validate .`, `claude plugin test .` → all PASS.
- [ ] **Step 6:** Commit `docs: savings in README and reference (0.4.9)`; push the branch and open a PR to `GonzMenSeb/ultracost` (`--repo GonzMenSeb/ultracost`), body ending with `https://claude.ai/code/session_01Df6UEPByr1JvqX6Jdr9owL`. Merge only when the user says so.
