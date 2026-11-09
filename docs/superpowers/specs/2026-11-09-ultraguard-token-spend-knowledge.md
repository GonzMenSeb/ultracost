# Knowledge base for the ultraguard estimation engine

Consolidated 2026-11-09 from the eleven extraction notes in `lit/`, the plugin code at 0.4.16, and my own checks (section 0.3). Audience: whoever changes `src/savings.mjs`, `src/meter.mjs`, `src/calibrate.mjs`, `src/prices.mjs`, `data/*.json` and `scripts/calibrate.mjs`. Section 6 is the work list; sections 1 to 5 are the evidence behind it.

The notes (`lit/*`), the scripts (`kn/*`) and `intervals.json` named below were local working files of the extraction and are not in the repository; the numbers they produced are quoted here.

Kinds used on every number:

- MEASURED: the source's own data shows it (table, figure, JSON, trace). Says which.
- MEASURED-BY-ME: I computed it from raw data in this consolidation (script in `kn/`, listed in section 8). It counts as MEASURED for the three-kind contract; the suffix only says who measured.
- REPORTED: a claim in prose, a secondary summary, a third party, or something I could not tie to shown data.
- INFERRED: arithmetic or reading on top of the above; the arithmetic is shown or reproducible.

Step notation follows the plugin: `a>b` for a same-family step means ln(cost of b / cost of a); a transition `A>B` means A ran, B is the baseline, ratio = baseline tokens / actual tokens.

## 0. Scope, inventory, conflicts

### 0.1 Notes read

All eleven notes exist and were read in full (the brief said ten agents but listed eleven keys): `bai.md`, `smekal.md`, `aa-sonnet.md`, `aa-others.md`, `anthropic-docs.md`, `arknill.md`, `limitcast.md`, `cache-quota.md`, `cache-papers.md`, `hal.md`, `gap-sweep.md`. None is missing. (The brief said ten; it listed eleven keys.) Reading depth differs and matters for rigor:

| Note | Primary material actually read by its author |
|---|---|
| bai | Full paper v3 and appendices, released scripts, 170 Sonnet 4.5 trajectories plus the mini archives. Highest rigor of the set. |
| smekal | Full arXiv HTML and PDF text; figures not read (plot-only numbers are excluded). |
| aa-sonnet | Five AA model pages with embedded JSON, methodology page in full. Highest rigor for Sonnet buckets. |
| aa-others | Opus 5.5 and Haiku 5.5 AA pages through a summarizing fetcher; numbers are 3 significant digits and carry extractor risk. |
| anthropic-docs | Many first-party pages, several only summarized or partially read. |
| arknill | Repo markdown in full or in large part; no raw data exists in the repo; scripts re-run. |
| limitcast | Blog and `calibrate.mjs` in full; claude-meter README/article in full. |
| cache-quota | GitHub threads read through `gh api` in full; usage-monitor sources read in the relevant parts. |
| cache-papers | Lumer in full; Quntur main text, S42 and C.4.1 in full (the rest by grep). |
| hal | Paper, harness source, 21 decrypted traces, the cost CSV in full. |
| gap-sweep | Anthropic cost page read raw (I re-fetched it, section 0.3); other items a mix of RAW and summarizer reads, each tagged. |

### 0.2 Where notes disagreed and what I did

| Topic | Disagreement | Resolution |
|---|---|---|
| Are thinking tokens inside `output_tokens`? | arknill reports (no test) that they are not; anthropic-docs (verbatim "Steering thinking" page) and hal (sums match exactly) say they are. | Inside. MEASURED-BY-ME on this machine's transcripts: `output_tokens_details.thinking_tokens` is at most `output_tokens` in 43,369 of 43,370 distinct (output, thinking) pairs; the one exception is `output_tokens` 0 with thinking 285, a streaming placeholder (unverified). The arknill claim is rejected. |
| Window G idle hours | arknill's hour-level fit says w is 0.03 to 0.05; cache-quota's idle-hour test says only w of 0.01 or less fits. | Both reproduce (section 3.2). They use different criteria on the same 31 rows; the regression is dominated by hours where output and cache reads correlate at 0.91. Neither is a clean test. Combined range 0 to 0.07. |
| Does cost per task weight benchmarks? | aa-others: undocumented; aa-sonnet: verified to 4 decimals as the index-weighted mean of per-evaluation costs. | aa-sonnet. Per-task cost is index-weighted, so whole-index token ratios and per-task cost ratios differ by up to 9% (Sonnet high>xhigh 2.288 against 2.501). |
| Cache-read price inside AA Sonnet costs | gap-sweep: unestablished whether $0.10 or the launch $0.20. | $0.10. aa-sonnet's JSON identity (non-cache/2 + read/0.1 + write/2.5 equals the input count to 0 tokens at every effort) only holds at $0.10. |
| Fable 5.2 figures on the 370-task benchmark | anthropic-docs: low $1.05 and high $5.39 unverified; gap-sweep read the page raw. | Verified in the page text I re-fetched: Fable 5.2 low $1.05, medium $1.34, high $5.39 per attempt. The string `2.68` does not occur in the page; `data/published.json` `anthropic-agentic-370.fable.medium = 2.68` has no match (it equals 2 x 1.34, INFERRED). |
| Direction of the read share with effort | gap-sweep: Anthropic cache factors rise with effort, opposite to Quntur. | Factor definition checked in the page: token cost with every input token at the input price and output unchanged, divided by the cost as metered (Opus 5.5: 2.4 low, 3.3 medium, 3.8 high, 5.4 xhigh, one run; Sonnet 5.5: 2.4 medium, 3.1 high). Output share also rises with effort and would lower the factor, so the rising factor understates the rise in read share. Direction confirmed; Quntur is the outlier (section 1.6). |
| Quntur bucket reconstruction | cache-papers (Opus 4.5 prices): creation 0.43M, read 5.66M, output 0.06M; gap-sweep (plugin prices): 0.58M, 5.24M, 0.11M. | Same two inputs (tokens +21%, cost +51%), different price lists and rounding. Both give read at 88 to 95% of tokens. Neither is data; only the prose percentages (output +3%, read +15%, creation about x2) are the paper's. |
| Which sources confirm per-1% cache reads of 1.5 to 2.1M | cache-quota and arknill: reported as three independent datasets. | arknill verified in code: the other two reuse ArkNill's 180M budget constant, so the agreement is circular. Treat as one dataset. |
| Opus and Sonnet limit pools | anthropic-docs: errors doc names Opus-only and Sonnet-only limit messages; help center names only Fable as separate. | Unresolved; no source quantifies either (section 5). |

### 0.3 Checks I ran myself

- Re-fetched Anthropic "Optimizing for cost and intelligence" as markdown (209.8 KB, `kn/opt.md`): cache-factor definition (line 936), "work per task" sentence (line 931), Fable 5.2 low/medium/high on the 370 tasks (lines 408, 979), absence of `2.68`.
- Ran `priceFamily` on model ids: `claude-opus-5`, `claude-sonnet-5` and `claude-fable-5-2` all resolve to a family row (`claude-opus-4-8`, `claude-mythos-5-2` resolve to null). The rows are the 5.5 and 5.1 rows.
- Analysed the untracked `intervals.json` in the working copy (200 five-hour and 42 weekly intervals, 2026-11-08 15:44 to 2026-11-09 16:34 UTC): resolution, rates, weekly/5h ratio, units per tick (section 3). Provenance is assumed, not documented: it has the shape of `storedValue` (`{five_hour: [{d, u, c, at}], seven_day: [...]}`) and 200 equals `MAX_INTERVALS`, which fits an export of the meter's store on this machine; its plan tier and which sessions fed it are unknown.
- Ran `estimateRun` itself (copies of `src/savings.mjs` patched for per-bucket steps and for the w draw, in `kn/`) on the 22 replay agents with `intervals.json` as the meter and a fixed seed, to get displayed deltas instead of point estimates (section 6).
- Scanned the local transcripts under `~/.claude*/projects` for thinking tokens (above).
- Re-ran `arknill-code/wfit.py` and `wfit2.py`: reproduced best w 0.04/0.05 (cache writes ignored) and 0.03/0.04 (writes imputed), bootstrap 5 to 95% of 0.02 to 0.07 and 0.00 to 0.06.
- Recomputed the idle-hour predictions for window G from the hourly rows (0.4, 1.3, 2.7, 3.3, 4.0 pp at w 0, 0.01, 0.05, 0.1, 1).
- Rebuilt every step and bucket table below with `kn/calc.mjs`, `kn/final.mjs`, `kn/gen.mjs` from `data/*.json` and the AA JSON in `lit/`.
- Counted degrees of freedom in `tauOf` (section 4).

### 0.4 Ten findings that drive the work list

1. The engine applies one scalar to all three buckets for every same-family effort step (chained and prior paths). AA Sonnet 5.5 shows read growing fastest and fresh slowest at every step (high>xhigh: read 3.01, output 2.03, fresh 1.93, against 2.49 used). Kimi shares, Anthropic cache factors, Bai's turn mechanism and the plugin's own measured cross-model pairs agree on direction. Quntur, the community CSV and one HAL pair disagree, each with a confound.
2. The community `max` rows inflate every step into `max` by a factor of 1.7 to 2.7 (Opus high>max 6.65 against AA 2.90 and ArkNill's Opus 4.7 2.21). Other steps barely change when they are removed.
3. Cross-family priors divide a published cost ratio by the input-price ratio. Where cache-read price ratios differ from the input ratio (Haiku read 0.1x input, Opus and Sonnet 0.05x) this is biased: for Haiku-actual pairs the median ln(AA input tokens / prior) is +0.58 (x1.79). Against the plugin's own two measured transitions, AA token ratios beat the prior in 5 of 6 bucket comparisons (mean absolute log error 0.18 against 0.31).
4. Meter intervals are whole percent: 242 of 242 stored `d` are integers, 186 of 200 five-hour intervals are exactly 1. `MIN_RISE = 0.1`, `round1` and the docs line "one decimal" describe resolution the data does not have.
5. On the local intervals the pooled rate falls 3.5x as w goes from 0 to 0.1 (6.09 to 1.72 percentage points per list-price unit), the same size as the 3.4x over-read. But the displayed saving barely depends on w (within 5% in four `estimateRun` scenarios), because the same w weighs the reads in the session's intervals and in the saved units and cancels. The 3.4x is a denominator problem (unseen usage), not a w problem.
6. Weekly and five-hour rates keep the ratio published sources report: 0.133 to 0.150 locally (w 0 to 0.1) against 0.115 to 0.167 (ArkNill, April) and 0.10 to 0.19 (four October and November reports). The coefficient of variation of units per one-percent tick is lowest at w of about 0.05 in both windows.
7. `tauOf` has one degree of freedom (3 workflow cells, 2 transitions); the outside anchors for run-level spread (0.22 to 0.41) are consistent with 0.296, so it is plausible but unsupported by the plugin's own data.
8. `priceFamily` silently prices Opus 5, Sonnet 5 and Fable 5.2 at the 5.5 and 5.1 rows (Fable 5.2 is 20% cheaper; Sonnet 5 reads cost twice as much). `published.json` carries a Fable medium figure (2.68) the cited page does not contain.
9. October and November 2026 user reports show the tokens-per-percent rate moving 2x to 5x within weeks. No vendor statement; cause unconfirmed. Equal-weight pooling of 30 days of intervals is exposed to it.
10. Nothing predicts a run's token level before it starts (Smekal r 0.08 without a probe; Bai at most 0.39); one observed run lifts that to r 0.72. After-the-fact scaling by measured ratios is the supported design, and its floor error is about 0.22 in log.

## 1. Effort and token-type multipliers

### 1.1 What the engine does today

Read from `src/savings.mjs` (`ratioFor`), `src/calibrate.mjs` (`stepsOf`, `priorsOf`, `measuredOf`, `tauOf`) and `data/ratios.json`:

- Order of resolution: identical (saves 0); measured transition; chained (a measured ratio into the same baseline family at the nearest other effort, times a same-family step); prior (published cost ratio divided by the input-price ratio, one value for all three buckets, sd floor 0.6, no tau); same-family step as a prior (one value for all buckets, no tau); otherwise unknown.
- Measured transitions exist for exactly two: `sonnet:high>opus:high` (4 pairs, 1 workflow: web research) and `sonnet:high>opus:medium` (18 pairs, 2 workflows: code mapping 4, yes/no check 14). Per-bucket ratios: high output 1.066, fresh 1.150, read 2.290; medium output 0.614, fresh 0.899, read 0.789. Dollars 2.60 (90% 2.19 to 2.89) and 1.59 (1.45 to 2.10).
- Chaining adds the same `step.mu` to output, fresh and read (`bucket = {mu: b.mu + step.mu, ...}`). The prior path assigns one `{mu, sd}` to all three buckets.
- `stepsOf`: mean of ln(cost_b / cost_a) over every source that prices both configurations; sd is the sample sd over sources, 0.4 for a single source. `priorsOf`: the same minus ln(input price ratio).
- Sources in `published.json`: AA (index v5.0.1, all four families, five efforts), Anthropic SWE-bench Pro (Opus, four efforts), Anthropic agentic-370 (Opus four efforts, Sonnet medium and high, Fable medium), community CSV (Opus, Sonnet medium/high, Haiku).
- Other fitted quantities: `tau` 0.2965, `pooledAgentSd` output 0.413, fresh 0.222, read 0.667.

### 1.2 Sources and what each can and cannot say

| Source | What it measures | Effort ladder | Cache handling | Rigor / limits |
|---|---|---|---|---|
| Artificial Analysis (AA), Intelligence Index v5.0.1 | 9 benchmarks (agentic and QA), Sonnet/Opus/Haiku 5.5 and Fable 5.1 at five efforts; provider-API token counts; cost = index-weighted mean of per-evaluation costs | low to max | Input total is exact (fresh + read + write). The split is modeled with a "typical cache hit rate" (AA methodology), and non-cache input is flat across efforts (18.8 to 18.9M tokens) | One run per effort, no interval; "Default Fallback" in every page title is undefined and its rate unknown; index version drift (v4.3.2 to v5.0.1 moved Sonnet high>max from 6.85 to 6.11, REPORTED by a blog) |
| Anthropic cost page | SWE-bench Pro subset (478 problems), internal 370-task agentic set, defect search, 134-task Managed Agents run, DeepResearch Bench II | Opus: low to xhigh; Sonnet: medium, high; Fable 5.2: low, medium, high | Costs priced from recorded usage, 5-minute writes | First-party tables with run counts; costs comparable only inside a table; no per-bucket counts except the cache factors and two qualitative sentences |
| Community CSV `JOHNISKING/claude-effort-cost` | One brick-breaker prompt, `claude -p --effort`, Claude Code 2.1.295, 3 runs per cell: output tokens, total tokens, cost | Opus and Haiku low to max; Sonnet medium, high | Not stated whether total includes reads | One short task; the card says Opus max needed permission for an automated test and Haiku max wrote its own test script |
| Quntur, arXiv 2602.04850 v3, Table S42 | Claude Code on Opus 4.5, 17 chemistry tasks, 3 high runs against 2 xhigh runs | high, xhigh | Per-type counts not tabulated, only prose | Authors call it observational; xhigh is documented as unsupported on Opus 4.5 (Claude Code would run it as high), so the contrast may be run order and drift |
| Smekal, arXiv 2608.25399 | Kimi K3, mini-swe-agent, 5 SWE-bench tasks, 2,700 runs | low, high, max | Shares by token type (Table E1) | Not Claude; no cache-write class; transferable only as direction and method |
| ArkNill `16_OPUS-47-ADVISORY` 3.3 | Opus 4.7, Claude Code 2.1.112 print mode, 3 tasks, 1 run per cell | high, xhigh, max | Not split | n = 3 single prompts, fixed context dominates |
| HAL traces | Thinking off against a 4,096-token budget on 2025 models, with four token types per call | none (on/off) | Recomputable from counts | Cannot test the 5.5 ladder; useful as noise floor |
| Bai et al. | 8 models on SWE-bench Verified, 4 runs each; Sonnet 3.7, 4, 4.5 per call | none | Per-call four-type counts, exact | Sets the mechanism for read growth; no effort |

### 1.3 Sonnet 5.5

Per-bucket ratios from AA's dollar components divided by list prices (fresh = non-cache input + cache write, read = cache read, output exact). Output counts are MEASURED (AA JSON); fresh and read are INFERRED from AA's modeled split. Source for the table: `aa-sonnet.md` section 4, recomputed by `kn/gen.mjs`.

| step | AA output tokens | AA fresh (non-cache + write) | AA read | AA $ whole index | AA $ per task | other sources | plugin today: ratio, sd, sources |
|---|---|---|---|---|---|---|---|
| low>medium | 1.377 | 1.225 | 1.553 | 1.360 | 1.527 | - | 1.529, 0.40, 1 |
| low>high | 2.560 | 1.892 | 3.603 | 2.541 | 3.200 | - | 3.216, 0.40, 1 |
| low>xhigh | 5.186 | 3.657 | 10.845 | 5.814 | 8.002 | - | 8.020, 0.40, 1 |
| low>max | 15.702 | 8.453 | 29.681 | 15.987 | 19.597 | - | 19.647, 0.40, 1 |
| medium>high | 1.859 | 1.545 | 2.320 | 1.867 | 2.096 | agentic-370 2.06; SWE-bench Pro 1.69 (REPORTED, "59% of the cost"); community 1.21 | 1.736, 0.32, 3 |
| medium>xhigh | 3.766 | 2.986 | 6.983 | 4.274 | 5.242 | - | 5.244, 0.40, 1 |
| medium>max | 11.403 | 6.902 | 19.112 | 11.751 | 12.836 | - | 12.846, 0.40, 1 |
| high>xhigh | 2.026 | 1.932 | 3.010 | 2.288 | 2.501 | - | 2.494, 0.40, 1 |
| high>max | 6.133 | 4.467 | 8.238 | 6.292 | 6.125 | - | 6.110, 0.40, 1 |
| xhigh>max | 3.028 | 2.312 | 2.737 | 2.750 | 2.449 | - | 2.450, 0.40, 1 |

Observations:

- Order of growth is the same at every step except the last: read above output above fresh. Over the whole ladder (low>max): output 15.7x, fresh 8.5x, read 29.7x. On a log scale fresh grows 0.63 to 0.93 as fast as output (mean 0.77) and read 0.91 to 1.56 as fast (mean 1.31). Exception: xhigh>max, where read (2.74) is below output (3.03).
- The plugin's scalar equals the per-task dollar ratio (2.494 for high>xhigh) and sits between the fresh and read ratios at all ten steps.
- AA cache-read share of input rises with effort: 92.85, 94.28, 96.12, 97.47, 97.86%; cache write share falls 5.41 to 2.08%; read/write token ratio 17.2, 20.6, 28.4, 41.3, 47.0. The mechanism is the one Bai measured (section 2.2): extra thinking and extra turns multiply context re-reads faster than they multiply new content.
- The spread of the step across the nine AA evaluations is large and grows with the span: per-evaluation log sd of the cost ratio is 0.26 (low>medium), 0.37 (medium>high), 0.37 (high>xhigh), 0.70 (xhigh>max), 1.14 (low>max). High>xhigh output-token ratios by evaluation run from 1.41 to 3.10 (log sd 0.25). xhigh>max on AA-Omniscience is 17.9x in output tokens (256 to 15,148 per task), an effort cliff.
- The only other Sonnet point on high>xhigh is a blog quoting Anthropic's Terminal-Bench 4.0 chart ($1.46 high, $4.34 xhigh, ratio 2.97; REPORTED, unverified). Anthropic's first-party Sonnet 5.5 table has medium and high only.

### 1.4 Opus 5.5

AA gives output tokens, total input tokens and cost, no cache split. Values were read through a summarizing fetcher (three significant digits). For Sonnet the input total is 93 to 98% cache read (section 2.1); for Opus aa-others' effective price per input token leaves at most 7.3% (low) to 2.4% (max) that is not cache read, so the input ratio is a read-bucket proxy (INFERRED, assumes the same holds for Haiku, where the bound is 7.8% to 3.3%).

| step | AA $ per task | AA cost to run | AA output tokens | AA input tokens (fresh+read+write) | SWE-bench Pro | agentic-370 | community CSV | plugin today: ratio, sd, sources |
|---|---|---|---|---|---|---|---|---|
| low>medium | 2.50 | 2.07 | 2.01 | 2.78 | 1.91 | 2.40 | 1.47 | 2.026, 0.24, 4 |
| low>high | 3.53 | 2.77 | 2.66 | 4.05 | 2.64 | 3.94 | 2.06 | 2.948, 0.29, 4 |
| low>xhigh | 6.17 | 4.86 | 4.79 | 7.71 | 6.73 | 11.74 | 4.82 | 6.964, 0.38, 4 |
| low>max | 10.24 | 9.09 | 10.33 | 13.33 | - | - | 31.35 | 17.922, 0.79, 2 |
| medium>high | 1.41 | 1.34 | 1.32 | 1.46 | 1.38 | 1.64 | 1.40 | 1.455, 0.08, 4 |
| medium>xhigh | 2.47 | 2.35 | 2.38 | 2.78 | 3.52 | 4.89 | 3.28 | 3.438, 0.28, 4 |
| medium>max | 4.10 | 4.39 | 5.13 | 4.80 | - | - | 21.32 | 9.347, 1.17, 2 |
| high>xhigh | 1.75 | 1.75 | 1.80 | 1.90 | 2.55 | 2.98 | 2.34 | 2.362, 0.22, 4 |
| high>max | 2.90 | 3.28 | 3.89 | 3.29 | - | - | 15.23 | 6.648, 1.17, 2 |
| xhigh>max | 1.66 | 1.87 | 2.16 | 1.73 | - | - | 6.50 | 3.284, 0.97, 2 |

Observations:

- Agreement: medium>high (1.38 to 1.64 across five measures, Anthropic defect search 1.18), low>medium (1.47 to 2.50; Anthropic 134-task Managed Agents run 2.60), the direction of every step.
- Conflict: high>xhigh. Published ratios are 1.75 (AA), 2.55 (SWE-bench Pro), 2.98 (agentic-370), 2.34 (CSV); outside the plugin 1.51 (Quntur, Opus 4.5, confounded) and 1.17 (ArkNill, Opus 4.7 single prompts, n = 3). Why: AA mixes QA and agentic tasks, Anthropic's two tables are long coding loops where effort changes turn count, ArkNill and the CSV are short single prompts dominated by fixed context, Quntur is a different model with doubtful effort support. The plugin uses the geometric mean of the four published (2.36, sd 0.22). Nothing here says that mean is wrong for a long Claude Code workflow; the four Opus numbers behave as a plausible range for it.
- Conflict: every step into `max`. AA xhigh>max 1.66 to 2.16 and high>max 2.90 to 3.89 (cost to tokens); ArkNill 2.21 (cost, high>max) and 2.04 (output, xhigh>max); CSV 6.5 (xhigh>max) to 31 (low>max); plugin 1.7x to 2.3x AA for Opus (Haiku 2.0x to 2.7x). The CSV max cells come from one task that needed permission and extra test runs; AA's is a complete nine-benchmark run. AA's own max runs carry a 4.8% error rate for Opus.
- AA cost per task and cost to run give different ratios (low>medium 2.50 against 2.07; high>max 2.90 against 3.28) because per-task is index-weighted (section 0.2). Spread across AA's own measures for high>xhigh: 1.70 to 1.90.

### 1.5 Haiku 5.5

| step | AA $ per task | AA cost to run | AA output tokens | AA input tokens (fresh+read+write) | SWE-bench Pro | agentic-370 | community CSV | plugin today: ratio, sd, sources |
|---|---|---|---|---|---|---|---|---|
| low>medium | 2.25 | 1.82 | 1.76 | 2.13 | - | - | 1.49 | 1.834, 0.29, 2 |
| low>high | 4.00 | 3.02 | 3.00 | 3.76 | - | - | 2.16 | 2.938, 0.44, 2 |
| low>xhigh | 6.25 | 4.83 | 5.05 | 5.96 | - | - | 4.08 | 5.052, 0.30, 2 |
| low>max | 10.25 | 8.47 | 9.97 | 9.93 | - | - | 39.79 | 20.195, 0.96, 2 |
| medium>high | 1.78 | 1.66 | 1.70 | 1.76 | - | - | 1.44 | 1.602, 0.15, 2 |
| medium>xhigh | 2.78 | 2.64 | 2.87 | 2.80 | - | - | 2.73 | 2.755, 0.01, 2 |
| medium>max | 4.56 | 4.64 | 5.65 | 4.66 | - | - | 26.62 | 11.012, 1.25, 2 |
| high>xhigh | 1.56 | 1.60 | 1.68 | 1.59 | - | - | 1.89 | 1.720, 0.14, 2 |
| high>max | 2.56 | 2.80 | 3.32 | 2.64 | - | - | 18.44 | 6.874, 1.40, 2 |
| xhigh>max | 1.64 | 1.76 | 1.97 | 1.67 | - | - | 9.74 | 3.997, 1.26, 2 |

Observations:

- Agreement between AA and the CSV on medium>xhigh (2.78, 2.73) and the sign of every step; disagreement on low>medium (2.25 against 1.49) and every `max` step (AA xhigh>max 1.64 and high>max 2.56, CSV 9.7 and 18.4; low>max 10.3 against 39.8). Anthropic's Haiku guide reports that low to medium "more than doubled the output tokens for each attempt" (REPORTED); AA's output tokens grow 1.76 (run) to 1.89 (per task).
- AA Haiku low costs $0.04 per task, rounded to the cent (+-12% on the ratio); cost to run or tokens are better there.
- Haiku's cache-read price is 0.1x input (0.05x on Opus and Sonnet), and its prompts above 100,000 tokens move to the long-prompt row; both bear on priors (section 1.7).

### 1.6 Other per-bucket evidence, side by side

Same-family effort steps, token-type view. "Ran" is the lower effort, "baseline" the higher.

| Source (model, step) | Output | Fresh / creation | Read | Total tokens or cost | Kind |
|---|---|---|---|---|---|
| AA Sonnet 5.5 high>xhigh | 2.03 | 1.93 | 3.01 | $2.29 whole index, $2.50 per task | MEASURED output; INFERRED fresh and read |
| AA Opus 5.5 high>xhigh | 1.80 | not split | input 1.90 | $1.75 per task | MEASURED (summarizer values) |
| Quntur Opus 4.5 high>xhigh (3 runs vs 2) | +3% (1.03) | creation "approximately double" | +15% (1.15) | tokens 1.21, cost 1.51 | REPORTED prose; totals MEASURED (Table S42); confounded |
| Community CSV Opus high>xhigh | 2.70 | non-output 2.05 (lumps fresh and read) | | cost 2.33 | MEASURED, one task |
| Community CSV Opus medium>high | 1.57 | non-output 0.93 | | cost 1.38 | MEASURED, one task |
| Community CSV Haiku xhigh>max | 2.69 | non-output 10.1 | | cost 9.7 | MEASURED, one task |
| Kimi K3 low>max (Smekal Table E1 shares x geometric-mean cost 4.795) | 4.5 | 3.0 | cached 6.7 | 4.8 | INFERRED mix of pooled shares and a geometric mean; order of magnitude only |
| ArkNill Opus 4.7 print mode high>xhigh, high>max | 1.22, 2.50 | | | cost 1.17, 2.21 | MEASURED (3 tasks, 1 run), geometric means INFERRED |
| HAL Opus 4.1 SWE-Agent, thinking high against off | 1.01 | fresh x1.35 | read x0.85 | | MEASURED; thinking appeared in 3.3% of calls, harness commit and date differ between the two runs |
| Anthropic Opus 5.5 vs Sonnet 5.5 default, work per task | "a little over half" at low | | "a little over a third" at low | | REPORTED qualitative |
| Anthropic cache factors, Opus 5.5 | | | rises 2.4, 3.3, 3.8, 5.4 (low to xhigh) | | REPORTED numbers, definition checked |

Reading:

- Direction "read grows fastest": AA (three families), Kimi (cached x6.7 against fresh x3.0), Anthropic cache factors, Bai's n x context mechanism (read ~ n^1.61 against write ~ n^0.80, MEASURED-BY-ME), and the plugin's own medium-to-high pair (measured Opus high/medium: output 1.74, fresh 1.28, read 2.90 against the scalar 1.455, INFERRED because the two measured transitions come from different workflows).
- Direction "creation or output leads, read flat": Quntur, HAL's Opus pair, the CSV's medium>high. Each has a specific confound (order and drift, harness change and inert thinking, one short task with a large fixed context). On a long loop with a fixed first-request floor (section 2.2), fresh can look flat or even lead at small agents, which is also what the plugin's measured fresh ratios (0.90 to 1.15) show.
- Conclusion: direction is moderately supported, magnitudes are not. The fresh/read split in AA is partly modeled and Opus/Haiku have no split at all.

### 1.7 Model-to-model ratios (cross-family) and the prior

Same-effort AA token ratios (to / from; INFERRED from AA token totals): Opus/Sonnet output 0.99, 1.45, 1.03, 0.91, 0.65 and input 1.08, 1.95, 1.25, 0.80, 0.51 for low to max; Haiku/Sonnet output 1.40, 1.79, 1.64, 1.36, 0.89 and input 1.35, 1.88, 1.46, 0.78, 0.48. Cost per task Opus/Sonnet 1.92, 3.14, 2.12, 1.48, 1.00. The cross-family ratio is itself effort-dependent: at max Opus and Sonnet cost the same per task.

Backtest of the prior against the two measured transitions (INFERRED, my arithmetic; AA input ratio used for both fresh and read):

| Transition | Bucket | Measured (replays) | Prior in `ratios.json` | AA tokens | |ln| error: prior / AA |
|---|---|---|---|---|---|
| sonnet:high>opus:high | output | 1.066 | 1.489 | 1.026 | 0.33 / 0.04 |
| | fresh | 1.150 | 1.489 | 1.253 | 0.26 / 0.09 |
| | read | 2.290 | 1.489 | 1.253 | 0.43 / 0.60 |
| sonnet:high>opus:medium | output | 0.614 | 1.005 | 0.778 | 0.49 / 0.24 |
| | fresh | 0.899 | 1.005 | 0.859 | 0.11 / 0.05 |
| | read | 0.789 | 1.005 | 0.859 | 0.24 / 0.09 |

Mean absolute log error 0.31 for the prior, 0.18 for AA tokens; AA is closer in 5 of 6, the exception being read on the web-research pair (a 4-pair, single-workflow cell). The prior and AA share a source (AA is one of the prior's inputs), but the replays are independent of both.

Across all 54 priors with a medium, high or xhigh baseline (`kn/prior.mjs`) the median of ln(AA output / prior) is +0.04 and of ln(AA input / prior) is 0.00, so the prior is unbiased on average; the error is structural by direction:

- Haiku-actual to Opus or Sonnet baseline (18 pairs, efforts medium to xhigh): median ln(AA output / prior) +0.32 (x1.37), ln(AA input / prior) +0.58 (x1.79). Example `haiku:high>opus:xhigh`: prior 0.972, AA output 1.125, AA input 1.634. The prior understates the baseline's tokens by about 37% (output) and 79% (input side), which understates savings.
- Sonnet or Opus actual to Haiku baseline: AA input is mostly 0.3 to 0.7 below the prior in log (the exceptions are Sonnet at xhigh and Opus at xhigh, where output is close), so the prior overstates the baseline.
- Mechanism (INFERRED, arithmetic): dividing a cost ratio by the input-price ratio (Haiku 0.1 against Sonnet 2: 20x) assumes every priced token class moves by that ratio. Haiku's cache read is 0.01 against Sonnet's 0.1, a ratio of 10x. With a read-heavy mix (read 53%, write 31%, output 16% of Haiku dollars on the replay token mix) the blended ratio is about 14.7x, and 20/14.7 = 1.36 (ln 0.31), the size of the observed bias.
- Opus and Sonnet are the same ratio in every price class (2x), so their priors fail differently: the read bucket is far larger than the prior when the baseline is Opus at high (measured read 2.29 against prior 1.49), consistent with Bai's turn mechanism (section 2.2).
- `sonnet:high>opus:low` (chained): plugin 0.303 / 0.444 / 0.390 (output / fresh / read). AA: output 0.386, input 0.309. Anthropic: output "a little over half", reads "a little over a third". Read agrees across all three; output is the plugin's lowest (about 0.5x of Anthropic's).
- `sonnet:high>opus:medium`: Anthropic says Opus at medium does "slightly more work per task" than Sonnet at default high and costs about twice as much (SWE-bench Pro $0.21 against $0.11, 1.91x). The plugin's measured dollars 1.59 (1.45 to 2.10) contain 1.91. The measured output ratio 0.614 (90% interval 0.54 to 0.86) is below Anthropic's qualitative statement, AA's 0.778 and the CSV's 1.16; the workloads differ.

### 1.8 Recommended values

Method (INFERRED, fully reproducible with `kn/gen.mjs`):

1. Total step per pair = geometric mean over the sources that price both configurations, as the plugin does today, with two changes: community `max` cells excluded, and three first-party points added (Opus 5.5 low/medium from the 134-task run, $1.84/$4.78; Opus 5.5 medium/high from defect search, $200/$236; Sonnet 5.5 medium = 59% of high on SWE-bench Pro, REPORTED ratio).
2. sd = the larger of the source sd (0.4 for one source, as today) and the log sd of that pair's cost ratio across the nine AA evaluations (Sonnet, measured; used as a proxy for the other families). The second term is the workload spread of a step, which today is absent on purpose-built paths (the same-family prior path has no tau).
3. Per-bucket ratios = total ratio x exp(offset), offset = ln(AA bucket ratio) - ln(AA whole-run dollar ratio). Sonnet: AA's three components. Opus and Haiku: output and input tokens from AA; fresh borrowed from Sonnet as ln(fresh) = 0.77 x ln(output) (Sonnet's mean; range 0.63 to 0.93). This keeps the level of the multi-source total and takes only the shape from AA. At the plugin's replay mix the offsets nearly cancel in dollars (Sonnet high>xhigh: 0.22x2.21 + 0.42x2.11 + 0.36x3.28 = 2.55 against 2.49).

Kinds: total ratio and sd are INFERRED pooled from MEASURED costs (REPORTED for the Sonnet 59% point); output is MEASURED-based (AA tokens, pooled level); read is INFERRED (AA modeled split for Sonnet, input as proxy for Opus and Haiku); fresh is INFERRED and weakest (borrowed shape for Opus and Haiku).

Sonnet 5.5

| step | plugin today: ratio (sd, n) | recommended total: ratio (sd, n) | change | output | fresh | read | kinds T/O/F/R |
|---|---|---|---|---|---|---|---|
| low>medium | 1.53 (0.40, 1) | 1.53 (0.40, 1) | 0% | 1.55 | 1.38 | 1.75 | M/I/I/I |
| low>high | 3.22 (0.40, 1) | 3.22 (0.60, 1) | 0% | 3.24 | 2.39 | 4.56 | M/I/I/I |
| low>xhigh | 8.02 (0.40, 1) | 8.02 (0.88, 1) | 0% | 7.15 | 5.04 | 14.96 | M/I/I/I |
| low>max | 19.65 (0.40, 1) | 19.65 (1.14, 1) | 0% | 19.30 | 10.39 | 36.48 | M/I/I/I |
| medium>high | 1.74 (0.32, 3) | 1.73 (0.37, 4) | -1% | 1.72 | 1.43 | 2.14 | I/I/I/I |
| medium>xhigh | 5.24 (0.40, 1) | 5.24 (0.67, 1) | 0% | 4.62 | 3.66 | 8.57 | M/I/I/I |
| medium>max | 12.85 (0.40, 1) | 12.85 (1.03, 1) | 0% | 12.47 | 7.55 | 20.89 | M/I/I/I |
| high>xhigh | 2.49 (0.40, 1) | 2.49 (0.40, 1) | 0% | 2.21 | 2.11 | 3.28 | M/I/I/I |
| high>max | 6.11 (0.40, 1) | 6.11 (0.79, 1) | 0% | 5.96 | 4.34 | 8.00 | M/I/I/I |
| xhigh>max | 2.45 (0.40, 1) | 2.45 (0.70, 1) | 0% | 2.70 | 2.06 | 2.44 | M/I/I/I |

Opus 5.5

| step | plugin today: ratio (sd, n) | recommended total: ratio (sd, n) | change | output | fresh | read | kinds T/O/F/R |
|---|---|---|---|---|---|---|---|
| low>medium | 2.03 (0.24, 4) | 2.13 (0.26, 5) | +5% | 2.07 | 1.76 | 2.85 | I/I/I/I |
| low>high | 2.95 (0.29, 4) | 2.95 (0.60, 4) | 0% | 2.83 | 2.26 | 4.31 | I/I/I/I |
| low>xhigh | 6.96 (0.38, 4) | 6.96 (0.88, 4) | 0% | 6.85 | 4.78 | 11.04 | I/I/I/I |
| low>max | 17.92 (0.79, 2) | 10.24 (1.14, 1) | -43% | 11.64 | 6.80 | 15.02 | M/I/I/I |
| medium>high | 1.46 (0.08, 4) | 1.40 (0.37, 5) | -4% | 1.38 | 1.29 | 1.52 | I/I/I/I |
| medium>xhigh | 3.44 (0.28, 4) | 3.44 (0.67, 4) | 0% | 3.48 | 2.85 | 4.07 | I/I/I/I |
| medium>max | 9.35 (1.17, 2) | 4.10 (1.03, 1) | -56% | 4.79 | 3.29 | 4.48 | M/I/I/I |
| high>xhigh | 2.36 (0.22, 4) | 2.36 (0.37, 4) | 0% | 2.42 | 2.12 | 2.56 | I/I/I/I |
| high>max | 6.65 (1.17, 2) | 2.90 (0.79, 1) | -56% | 3.44 | 2.52 | 2.91 | M/I/I/I |
| xhigh>max | 3.28 (0.97, 2) | 1.66 (0.70, 1) | -49% | 1.92 | 1.61 | 1.54 | M/I/I/I |

Haiku 5.5

| step | plugin today: ratio (sd, n) | recommended total: ratio (sd, n) | change | output | fresh | read | kinds T/O/F/R |
|---|---|---|---|---|---|---|---|
| low>medium | 1.83 (0.29, 2) | 1.83 (0.29, 2) | 0% | 1.77 | 1.55 | 2.14 | I/I/I/I |
| low>high | 2.94 (0.44, 2) | 2.94 (0.60, 2) | 0% | 2.92 | 2.27 | 3.65 | I/I/I/I |
| low>xhigh | 5.05 (0.30, 2) | 5.05 (0.88, 2) | 0% | 5.29 | 3.64 | 6.24 | I/I/I/I |
| low>max | 20.20 (0.96, 2) | 10.25 (1.14, 1) | -49% | 12.05 | 7.10 | 12.01 | M/I/I/I |
| medium>high | 1.60 (0.15, 2) | 1.60 (0.37, 2) | 0% | 1.65 | 1.46 | 1.70 | I/I/I/I |
| medium>xhigh | 2.75 (0.01, 2) | 2.75 (0.67, 2) | 0% | 2.99 | 2.34 | 2.92 | I/I/I/I |
| medium>max | 11.01 (1.25, 2) | 4.56 (1.03, 1) | -59% | 5.55 | 3.72 | 4.58 | M/I/I/I |
| high>xhigh | 1.72 (0.14, 2) | 1.72 (0.37, 2) | 0% | 1.81 | 1.61 | 1.71 | I/I/I/I |
| high>max | 6.87 (1.40, 2) | 2.56 (0.79, 1) | -63% | 3.04 | 2.30 | 2.42 | M/I/I/I |
| xhigh>max | 4.00 (1.26, 2) | 1.64 (0.70, 1) | -59% | 1.84 | 1.58 | 1.56 | M/I/I/I |

Kinds column: M = MEASURED, I = INFERRED, in the order total / output / fresh / read. A total is M only where one source (AA) supplies the pair unchanged; the sd is INFERRED in every row; Sonnet medium>high pools one REPORTED input (the 59% ratio).

Notes on the tables:

- Change column: only steps into `max` and Opus low>medium and medium>high move. Opus low>medium +5% and medium>high -4% come from the added Anthropic points.
- `max` steps lose 43 to 63% in ratio. Their sd stays large (0.70 to 1.14) on the AA per-evaluation spread, which is close to what the plugin shows today for Opus and Haiku (0.8 to 1.4) for a different reason (disagreement with the CSV).
- sd entries above the source sd are the per-evaluation floor. Two independent measurements support a floor of at least 0.25 for adjacent steps: AA's nine-evaluation output-token spread for Sonnet high>xhigh (0.25) and Smekal's five-task log sd of the low-to-max step (0.249, n = 5). AA's cost-ratio spread for adjacent steps is 0.26 to 0.37. Whether to adopt the floor, and whether it belongs in the transition sd or in a run-level term, is a decision (section 6, item 3).
- Fable: AA gives five efforts for Fable 5.1 and Anthropic gives Fable 5.2 low/medium/high on the 370 tasks ($1.05, $1.34, $5.39) and DeepResearch Bench II ($1.49, $2.16, $4.82). Different versions share one `fable` key today. No recommendation is made for Fable steps.

## 2. Cache behaviour in agent loops

### 2.1 Shares by token type

| Source | Setting | Read | Write / creation | Output | Fresh input | Kind |
|---|---|---|---|---|---|---|
| Bai (this note's own count) | Sonnet 4.5, OpenHands, 170 trajectories, 15,620 calls | 97.83% | 1.57% | 0.60% | 0.003% | MEASURED-BY-ME (tokens) |
| Bai, dollars at Sonnet 4.5 list | same | 66.4% | 13.3% | 20.2% | 0.02% | MEASURED-BY-ME |
| Plugin replays | Claude Code 2.1.319, 22 pairs, actual Sonnet:high | 94.94% | 4.48% | 0.58% | 0.00% | MEASURED-BY-ME |
| Plugin replays, dollars at `prices.json` | same | 35.8% | 42.2% (with input) | 22.0% | | MEASURED-BY-ME |
| AA Sonnet 5.5 (modeled split), low to max | of input | 92.85 to 97.86% | 5.41 to 2.08% | output 1.0 to 2.0% of input | 1.74 to 0.06% | INFERRED from AA JSON |
| AA Sonnet 5.5 dollars at high | | 28.7% | 25.3% | 43.1% | 3.0% | INFERRED |
| TraceLab (2,676 Claude sessions) | Oct 2025 to Jun 2026 | 95.5% | append 4.2% (fresh + creation) | 0.34% | | MEASURED (Table 1), shares INFERRED |
| Langfuse case study | Opus 4.7/4.8, 1M context, 31,901 requests | 99.16% | 0.70% | 0.13% | 0.006% | MEASURED (Table VI) |
| SWE-ContextBench | Sonnet 4.5 in Claude Code | more than 97% | | | | MEASURED (text) |
| ArkNill proxy | Opus 4.6, 22 days | 96.96% of visible | | | | MEASURED |
| HAL SWE-Agent | Opus 4.1, 3 runs | 94 to 96% of input side | | | | MEASURED |
| Quntur reconstruction | Opus 4.5 in Claude Code | about 95% | 5 to 7% | about 1% | about 0 | INFERRED |
| Smekal | Kimi K3 | cached 89.9 to 94.4% | not reported | 2.5 to 3.6% | 3.1 to 6.6% | MEASURED shares |
| Anthropic production | agent loops, one day | median 84% of input from cache, top decile 94% or more | | | | REPORTED |
| Anthropic benchmark runs | | 89 to 93% of input from cache | | | | REPORTED |
| netpreme | Opus 4.7, 731 SWE-bench Pro sessions | 97%+ after turn 2, 68.1% on turn 1 | | | | REPORTED (dataset card) |

Every Claude Code and OpenHands source puts cache reads at 94 to 99% of tokens and output at 0.1 to 0.6%. The plugin's replays (read 94.9%, write 4.5%) sit between AA's modeled split and Bai. Cache writes are 4.5% of tokens but 42% of dollars on the replay mix, because they cost 25x a cache read on Opus and Sonnet 5.5 (1.25 against 0.05 of input).

### 2.2 Growth with turns (Bai, MEASURED-BY-ME on 170 Sonnet 4.5 trajectories, 15,397 consecutive call pairs)

- Exact identity: cache read at call k equals the full context of call k-1 (median difference 0 tokens). OpenHands never missed the cache and the 5-minute TTL never lapsed.
- Context grows linearly, 747 tokens per round on average (median 739, p10 to p90 624 to 886). Cache read per call rises from 13.6k (rounds 1 to 10) to 117.5k (rounds 161 to 170); write per call is flat at 650 to 760; output per call flat at about 300.
- Scaling with number of calls n across trajectories (log-log): total read n^1.61 (R2 0.92), write n^0.80, output n^0.91, cost n^1.36, final context n^0.72. Total write is 0.904 of the final context (p10 to p90 0.878 to 0.931). Total read is 0.593 of n x final context.
- Cost fit: `cost = 1.67e-7 x n x C_N + 0.0076 x n` USD at Sonnet 4.5 prices, error 6.3% (sd), so the final call's usage predicts the whole trajectory's cost.
- Cross-model on identical tasks (Sonnet 4.5 against 4, 4 against 3.7, 4.5 against 3.7): rounds x1.29, x1.58, x2.03; final context x1.23, x1.32, x1.62; n x context (read proxy) x1.50, x2.01, x3.01. Read scales as turns times context, write only with context. This is the structural reason the plugin finds cache reads x2.3 and writes x1.15 from Sonnet to Opus.
- Fixed floor in the fresh bucket: the first call of every agent carries system prompt and tools (OpenHands mean 8,722 tokens; Claude Code subagents median first-turn creation 13,358, 279 samples, ArkNill; a blog reports about 39,000 per subagent, REPORTED, low rigor). It does not scale with task size or effort, so fresh ratios between configurations pull toward 1 for small agents.
- Read/write token ratio is 19.6 (baseline) and 21.2 (actual) pooled in the replays against Bai's median 56.5. Reasons are hypotheses only: cold system prompts per Claude Code agent, small trajectories, larger tool results, and OpenHands never missing the cache.
- Claude Code growth: +575 cache-read tokens per turn on a 990-turn session, median context growth 1,845 tokens per minute across 53 sessions (ArkNill 03 section 5, REPORTED from the repo's tables).

### 2.3 TTL and invalidation

| Fact | Value | Kind / source |
|---|---|---|
| TTL | 5 minutes default, refreshed by each hit; starts when the request starts | MEASURED (pricing page) |
| Prices (Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.2 / Fable 5.1) | 5m write 1.25x input; 1h write 2x; read 0.05x, 0.05x, 0.1x, 0.025x, 0.025x | MEASURED (pricing page; two notes agree) |
| Claude Code main conversation | 1 hour on a subscription within plan usage (writes at 2x); 5 minutes with credits, API key or cloud provider | MEASURED (Claude Code doc) |
| Everything else (subagents, workflows, teammates, forks, compaction, titles) | 5 minutes, including on a subscription | MEASURED (Claude Code doc) |
| Billing split | `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` exist in the API usage; the plugin reads four flat fields only | MEASURED (docs) / code read |
| Top-level effort change | invalidates messages-level cache ("treat any thinking or top-level effort change as starting the cache over"); on a 100,000-token conversation 20 to 40x the cost of a per-message change | MEASURED (Anthropic charts described as text) |
| Per-message effort and Claude Code effort change on Fable 5.1+, Opus 5.5, Sonnet 5.5, Haiku 5.5 | keeps the cache | MEASURED (docs) |
| System prompt edit | 25 to 50x; Haiku 5.5 12.5x | MEASURED (Anthropic) |
| Model switch | separate cache; next request has no hits | MEASURED (Claude Code doc) |
| One usage sample | Opus 5.5 effort medium to low on a 3,546-token block: creation 3,546, read 0 | MEASURED (single sample) |
| Subagent first request | does not read the parent's cache | MEASURED (Claude Code doc) |
| Matching fan-out | same model, effort, agent type, tools, schema, cwd share a prefix; Claude Code holds all but the first up to 5,000 ms so siblings read instead of write | MEASURED (workflows doc) |
| TTL regression 2026-10-12 | new interactive sessions wrote only 5m (#101685); labels and lifetime may differ (single probe) | MEASURED by users; REPORTED |
| Breakeven for 1h against 5m | about 3.1 to 3.3% of turns; at 1 pause in 10 the 5-minute setting costs 54% more | MEASURED (Anthropic) |
| Caching value | cost without caching 3.3x (Opus 5.5), 3.1x (Sonnet 5.5), 1.7x (Haiku 5.5, short sessions, median 4 requests) | REPORTED with method stated |

### 2.4 What this means for the three buckets

- Output (thinking included). Thinking is billed as output; `output_tokens_details.thinking_tokens` is a subset (above). In a tool loop the first request after new input carries most of the reasoning; thinking per request falls as the conversation grows (Anthropic). Prior thinking blocks stay in context on Opus 4.5+, Sonnet 4.6+ and Haiku 5.5, so output at turn k becomes creation at k+1 and a read for every later turn. Effort therefore moves all three buckets, read most.
- Fresh (input + creation). A fixed floor per agent plus content growth that is roughly linear in turns. It is the stable bucket (pooled agent sd 0.22). Priced at 1.25x input for 5-minute writes; the plugin prices writes at 5m, correct for workflow agents by default and 1.6x low for anyone who sets a 1h TTL.
- Read. Quadratic in turns; the noisiest bucket (pooled agent sd 0.67; Bai's read proxy has twice the run-to-run sd of the write proxy). A cold cache (TTL lapse, effort change, model change) converts a whole context of reads into creation: read at 0.05x becomes 1.25x, a factor of 25 on those tokens.
- Counterfactual shape. A baseline run puts every agent on one model, effort and tool set, so siblings share a prefix and the 5-second stagger lets later siblings read the first agent's creation. The actual run's heterogeneous agents each build their own prefix. INFERRED, not tested: baseline fresh per agent should be lower and read higher than naive per-agent scaling. The measured Opus-at-high cell (read 2.29, fresh 1.15) is consistent but confounded with model behaviour.
- Mixed-config and effort change: an agent's effort differs from its parent's from its first request, so token counts are unaffected; a session whose user changed effort mid-run pays one rewrite spike (20 to 40x per message) in its own units that the baseline would not.

### 2.5 Material for the compact and clear checks

Raw facts only; no source measures a clear or compact threshold.

- Per-turn cost grows with context: reads per turn are the whole context (Bai identity), so a long session's per-call dollar cost rose from $0.0117 (rounds 1 to 10) to $0.043 (rounds 161 to 170) at Sonnet 4.5 prices (MEASURED-BY-ME).
- Cold restart price: re-creating a context costs 25x the same tokens read warm on Opus and Sonnet 5.5 (1.25 against 0.05), 12.5x on Haiku 5.5 (0.125 against 0.01). A stale 1M-context session was Anthropic's top finding in the April quota investigation (REPORTED, bcherny); a 200,000-token miss was estimated at more than 1% of a five-hour window (limitcast, explicitly an inference).
- Compaction mechanisms bypass `DISABLE_AUTO_COMPACT`: time-based microcompact, cached microcompact (`cache_edits`), session-memory compact (about 40,000 tokens kept) (ArkNill 05, REPORTED). Auto-compact was observed at about 195,000 tokens on v2.1.120 (5 values 194,159 to 196,512) while v2.1.117 reportedly raised Opus 4.7's trigger from about 200,000 to 1,000,000 (REPORTED, ~5x per-turn cost, #52522).
- Compaction appears in 4.5% of Claude sessions (TraceLab, MEASURED). Compaction requests carry the 5-minute TTL and, with advisor tools, tokens appear only in `usage.iterations` (Claude Code costs doc: sum over iterations).
- `context_window.current_usage` is null after `/compact`, and the status line re-runs when `/compact` finishes (statusline doc); intervals for the meter should not straddle it (section 3.5).

## 3. The subscription meter

### 3.1 Header and status-line semantics

| Item | What the sources say | Kind |
|---|---|---|
| Headers | `anthropic-ratelimit-unified-5h-utilization` and `-7d-utilization` (0.0 to 1.0), `-5h-reset`, `-7d-reset` (unix), `-representative-claim`, `-fallback-percentage` 0.5, `-overage-*` | MEASURED (ArkNill proxy captures) |
| Resolution | two decimals of the fraction = 1 percentage point; "+0.03 could be 0.025 to 0.035" | MEASURED statement (ArkNill) |
| Plugin data | 242 of 242 stored `d` are integers; 186 of 200 five-hour intervals and 39 of 42 weekly are exactly 1 | MEASURED-BY-ME (`intervals.json`) |
| Status line | `rate_limits.five_hour.used_percentage`, `seven_day.used_percentage` (0 to 100), `resets_at` epoch seconds; only for Pro, Max, Ultra; appears after the first API response; each window may be absent; a window is dropped after `resets_at` | MEASURED (statusline doc) |
| Refresh | event driven (new assistant message, `/compact`, permission mode, `resets_at`, `refreshInterval`), 300 ms debounce; the doc does not say how the percentage itself is refreshed | MEASURED (doc); lag unspecified |
| Window behaviour | the 5-hour value rises monotonically within one `5h-reset` and drops to 0 to 4% when it changes; idle hours do not decay; reset times fall on whole hours, mostly 5 h apart with irregular 6 h and 11 h gaps; weekly reset fixed | MEASURED (ArkNill grid) |
| Which window binds | `representative-claim` five_hour 77.4%, seven_day 22.6% of 23,374 requests (April); seven_day dominated Apr 9 to 10 | MEASURED |
| Ratio weekly to five-hour rise | 0.115 to 0.167 (6 windows, April, ArkNill); 0.10 to 0.19 (four October and November reports); 0.133 to 0.150 locally at w = 0 to 0.1 | MEASURED / MEASURED-BY-ME |
| Implied weekly budget | about 7.3 five-hour budgets (1 / 0.138, ArkNill); 6.7 locally at w = 0.1 | INFERRED |
| Limit changes | five-hour limits doubled for Pro, Max, Team on 2026-05-06 (REPORTED, Anthropic news); weekly: promotion ended Sept 13, permanent +25% from Sept 14, a net -17% from the promotion (REPORTED, BleepingComputer quoting Anthropic) | REPORTED |
| Pools | usage from claude.ai, Claude Code and Desktop counts against the same limit; Opus-only and Sonnet-only limit messages exist; some plans have a separate Fable weekly limit | REPORTED (help center, errors doc); not reconciled |
| `/usage` | plan bars are "approximate and computed from local session history on this machine", other devices and claude.ai not included | REPORTED (costs doc) |

Corrections to the plugin docs implied: "one decimal" is wrong for the input (whole percent); the weekly figure is a separate meter that moves at about one seventh of the five-hour rate.

### 3.2 Weight per token type, every source

List-price context: output is 5x input for every family in `prices.json`; cache write 1.25x (5m) or 2x (1h); cache read 0.05x on Opus 5.5 and Sonnet 5.5, 0.1x on Haiku 5.5, 0.025x on Fable.

| Source | Output | Cache write | Cache read | Data and caveats | Kind |
|---|---|---|---|---|---|
| Plugin today | list ratio (5x input) | 1.0x input | w in [0, 0.1] x input, uniform | no source supports above 0.1 | design |
| limitcast fit | lumped with input and write ("new") | lumped | 0.0149 of a new token (1/67) and 0.0187 (1/53.5) from two days | 61 observations, one account, 23 to 25 Oct 2026, plan unknown, no standard errors; code forces read > 0 and fresh > read; mapping into plugin w: 0.015 to 0.093 depending on the mix of new tokens (k from 1 to 5, INFERRED) | MEASURED fit |
| claude-meter | assumed 5x | assumed 1.25x | assumed 0.1x | not fitted; Max 20x; median $164 per 5h window (IQR 104 to 272), weekly $1,378 (IQR 1,189 to 1,644); no licence | REPORTED |
| cnighswonger, Apr 10 | fixed 5x | fixed 2x | tested 0, 0.1, 1: CV 34.4%, 101.6%, 123.7% over 6 windows | withdrawn by the author on Apr 23 | MEASURED as posted |
| cnighswonger, Apr 23 | fixed | fixed | "about 0.1x", one window of 806 calls | agreement with ArkNill is weight-free (the per-1% read count does not depend on w) | REPORTED |
| ArkNill hour fit (reproduced) | list ratio | imputed or ignored | best 0.04 (0.05 without the first hour); bootstrap 5 to 95% 0.02 to 0.07; with writes imputed 0.03, 0.00 to 0.06 | 31 hourly rows, 1pp resolution, output and read correlate 0.91 | INFERRED |
| ArkNill window level | | | CV of units per pp falls to w of 0.5 to 1 | 5 windows with near-identical mix; cannot separate | INFERRED |
| Idle-hour test (reproduced) | | | 3 flat hours (7.89M reads, 0 pp) predict 0.4, 1.3, 2.7, 3.3, 4.0 pp at w = 0, 0.01, 0.05, 0.1, 1 | one stretch; biased toward small w if unseen usage exists in the active hours | INFERRED |
| fgrosswig per call | | | 821K cache read raised 5h by about 0.1% | one reported pair, tier scaling assumed: w about 0.05 | REPORTED |
| Local intervals (CV of units per tick) | list ratio | 1.0 | CV minimum at w of about 0.05 in both windows: five-hour 1.11 (w 0), 0.88 (0.01), 0.70 (0.03), 0.67 (0.05), 0.68 (0.07), 0.71 (0.1), 0.88 (1); weekly 1.07, 0.88, 0.73, 0.70, 0.71, 0.74, 0.95 | 186 and 39 one-percent ticks, one day, concurrent sessions in the data, CV never below 0.67 so cnighswonger's own rule (below 0.5 for a clear winner) is not met | MEASURED-BY-ME |
| Usage monitors (ccusage, Claude-Code-Usage-Monitor, par_cc_usage) | 1 | 1 | 1 (par: Opus 5x, other models 1x) | count tokens, not meter weights | design |
| Anthropic | "model and effort change usage"; cached project content "counts less" (claude.ai) | | | no numeric weights anywhere first-party | REPORTED |

Where this leaves w (it matters little for the displayed saving, section 6 item 8, but it sets the meaning of the stored rate): the idle test (at most 0.01), the hour fit (0.03 to 0.05), limitcast (0.015 to 0.093 relative to the mix), the local CV minimum (0.05) and fgrosswig (0.05) overlap in 0.01 to 0.07. Only cnighswonger's one-window "0.1x" sits at the plugin's upper edge; nothing supports w above 0.1 or the "w = 1" hypothesis (ruled out by the idle test and the hour fit). Whether the meter follows billing ratios (0.05 on Opus and Sonnet 5.5) is untested; the local minimum at 0.05 is compatible but cannot separate families. Cache-write weight (1.0 in the plugin, 1.25 or 2.0 elsewhere) is never separated from w in any source.

Plugin docs say "the best public reverse-engineering ... cache reads free; another analysis says 0.1x". Current evidence puts the weight small and non-zero.

### 3.3 How concurrency and other devices distort a per-session estimate

Mechanism: the reading is account-wide, the units are one session's. If the account consumed k times the session's weighted units, every interval's `d` carries k times the session's share and `sum d / sum(u + w c)` reads k times high. All percent-saved figures scale with it. Unseen usage only adds to `d`; it never adds to the session's `u`.

| Distortion | Evidence | Size |
|---|---|---|
| Other sessions on the same account | molu0219: the active session was 22% of cache reads in a 90-minute window (691 calls, 103.9M reads), so session-only units read 4.5x high on reads | 4.5x for one day (INFERRED); the plugin's 3.4x is the same order |
| Subagents and workflow agents | the plugin counts every request in `noteRequest`; ArkNill: subagents were 17.3% of reads, 40.4% of output, 62.0% of creation | counted correctly; limitcast has a possible bug where subagent transcripts get `agent-<id>` session ids (not applicable to the plugin) |
| Other devices, claude.ai chat, Cowork | one user: weekly 60% to 97% in a day with Cowork at 99% of the weekly breakdown; another: full window consumed with no local requests for about 4 hours | not quantified anywhere |
| Unseen usage inside a measured window | ArkNill windows D (8 pp from 2.36M reads) and H (0 pp for 18 requests per hour) | machine-scale version of the same gap |
| Quantization | 1 pp steps; a single interval of d = 1 is +-50% | pooled sums are fine; per-interval statistics are not |
| Timing | reading lags the request that caused it by an unspecified amount; the doc gives no guarantee | unmeasured |
| Rate drift | tokens per percent moved 2x to 5x within weeks in Oct and Nov 2026 reports (shivansh11275: 12.0M, 5.1M, 2.3M weighted tokens per 1%; #106322 weekly ceilings about 230M, 433M, 605M projected, CV 44% over three weeks) | REPORTED, cause unconfirmed (promotion end, plan renaming, new meters, model mix are all candidates) |
| Peak hours | cnighswonger: weekday 13:00 to 19:00 UTC about 25 to 35% more quota per token, never published | REPORTED, preliminary |

Size cross-check (INFERRED, plan tier of this machine unknown): the local session-only budget is 100 / rate = $16 (w 0), $37 (0.05), $58 (0.1) per five-hour window and $123, $255, $388 per week. Published account-wide five-hour budgets in list-price dollars are $74 to $162 (MarcosPeraz, Nov, assumed split), $94 (cnighswonger, Max 5x, w 0.1), $129 (ArkNill window level at plugin prices and w 0.1, Max 20x), $164 (claude-meter median, Max 20x). At w = 0.1 the local five-hour budget is $58, so the published budgets are 1.6x (cnighswonger), 2.2x (ArkNill), 2.8x (MarcosPeraz, claude-meter) of it, and claude-meter's weekly $1,378 is 3.6x the local weekly $388. The over-read is therefore the right order of magnitude. The local rate also moves 3.5x between w = 0 and w = 0.1, the same size as the bias, but that dependence cancels in the displayed saving (section 6, item 8), so w does not explain the 3.4x.

Local units-per-tick distribution (one-percent ticks, `u + w c`, MEASURED-BY-ME): five-hour w 0.05 mean 0.670, median 0.613, p90 1.280, p95 1.509; w 0.1 mean 1.052, p90 1.908, p95 2.606. The ninetieth percentile is 1.8x to 2.0x the mean at both w. If unseen usage can only subtract from a tick's measured units, the upper tail is a less contaminated estimate of the true budget than the mean; this is an untested idea, not a published method, and timing misalignment pushes the other way.

### 3.4 Published methods that could replace or sit beside the pooled rate

| Method | What it does | Data it needs | Handles | Does not handle | Reuse |
|---|---|---|---|---|---|
| limitcast 2x2 least squares, no intercept | fits % per million for "new" (input + write + output) and for cache reads; closed form, 20 lines | consecutive status-line readings of one account with the tokens of every session of that account between them; at least 30 observations (it used 61; its two days differed by 25%) | concurrent local sessions (sums them); fits the read weight instead of drawing it | output separate from input; sessions without status-line samples (headless, SDK, cron); other devices; sub-percent timing | MIT, port needed (style differs, Node 18 compatible); also `claudeAccounts` merge, message-id dedupe, 15% `limitChange` alert |
| claude-meter per-interval ratio | price-weighted ratio per utilization-change interval; median and quartiles over filtered intervals (one model, at most 10 requests, at most 20 minutes) | request-level model and timestamps for all traffic (a local proxy) | short windows lower the chance of foreign usage | claude.ai and other machines; fixed list-price weights | no licence file: reimplement the idea only |
| ArkNill window total / peak | total tokens of a `5h-reset` window divided by its peak percent | complete window totals for all traffic | none of the weights are identifiable; 5 near-collinear windows | | method only |
| cnighswonger coefficient-of-variation test | choose w that minimises the CV of implied 100% quota across windows | at least 6 windows each rising 5 pp or more; fixed side weights | gives a gate (CV below 50% is a clear winner, above 80% the model is wrong) | grid was {0, 0.1, 1} | a finer grid on the plugin's own intervals is cheap (done above, section 3.2) |
| Pooled ratio with w draw (plugin) | `sum d / sum(u + w c)`, bootstrap + w draw | session units only | | unseen usage, w unidentified | current |
| Idle-interval bound | intervals that are almost all cache reads and do not move bound w from above | such intervals, flat readings | w | needs 1 pp resolution care | ArkNill window G is the example |

What each replacement needs from the plugin: all of them need consumption by every session of the account in time order. The plugin can obtain that in two ways: a shared ledger of per-request `{t, u, c}` written under one `$.store` key by every session's plugin instance (covers sessions running ultraguard only), or reading other sessions' transcripts (limitcast's route; key by the event's `sessionId`, not the file name, so subagent files count). Neither sees claude.ai, Cowork or other machines.

### 3.5 Interval hygiene

From the status-line doc and the threads (REPORTED unless noted): do not form an interval across `/compact`, a `resets_at` pass or a long idle gap; reject a `percentUsed` above 100 (Claude-Code-Usage-Monitor guards a known bug, #52326, where the percentage carries the `resets_at` epoch; not read at source); intervals telescope (consecutive intervals share a boundary reading), so a bootstrap over intervals understates the uncertainty of the sum (ArkNill note 4).

## 4. Variance and predictability

### 4.1 Run-to-run spread

| Source | Quantity | Value | Kind |
|---|---|---|---|
| Bai, Sonnet 4.5 / 4 / 3.7, same task, 4 runs (token proxies, MEASURED-BY-ME) | log sd of rounds | 0.165 / 0.234 / 0.299 | MEASURED-BY-ME |
| | final context (write proxy) | 0.118 / 0.211 / 0.264 | |
| | n x context (read proxy) | 0.265 / 0.416 / 0.528 | |
| | approximate total cost | 0.225 / 0.331 / 0.408 | |
| | max/min over 4 runs of one task | mean 1.77 / 2.72 / 3.35; worst single task 4.35 / 127 / 22.8 | |
| Bai paper | same-task spread | "up to 30x" in the abstract has no supporting figure; Fig 2b mean max/min about 1.4 to 3.7 | MEASURED (figure read) |
| Bai | read noise against write noise | 2.0 to 2.2x | MEASURED-BY-ME |
| Smekal, Kimi | geometric sd over 15 repeats | x1.34 (ln 0.293; per-spec medians x1.29 to x1.40), independent of prompt; sd against mean slope 1.08, so constant multiplicative noise | MEASURED |
| HAL, Opus 4.1 SWE-Agent, two runs of one configuration | per-task log-ratio sd | output 0.227, fresh 0.259, read 0.273 (50 tasks; about 0.16 to 0.19 per run if independent) | MEASURED / INFERRED; harness commit and date differ |
| AA | per-evaluation spread of an effort step | cost log sd 0.26 to 1.14 by step; output tokens 0.25 for high>xhigh | MEASURED-BY-ME |

Plugin parameters against this: `tau` 0.2965 (between-workflow, per run), `pooledAgentSd` output 0.413, fresh 0.222, read 0.667 (log sd of the per-agent ratio between two different configurations, so it contains two runs of noise plus the model difference).

- Pair-of-runs floors (the log ratio of two runs of one configuration): HAL measured 0.227 (output), 0.259 (fresh), 0.273 (read); Bai's per-run sds times sqrt(2) give 0.17 to 0.37 for the write proxy, 0.37 to 0.75 for the read proxy, 0.32 to 0.58 for total cost. The plugin's output (0.41) and read (0.67) sit above those floors by roughly the model effect, as expected; fresh (0.22) is at or below HAL's pair figure (0.26) and inside Bai's write-proxy range, so it is the one parameter not clearly above the noise floor (INFERRED, mixed scaffolds and models).
- `tau` is estimated from three workflow cells and two transitions: `sum((ln R_cell - ln R_transition)^2) / max(1, 3 - 2)`, one degree of freedom, floored at 0.15 (INFERRED from `tauOf` and `replays.json`). Outside anchors: Smekal's shape-mismatch floor about 0.22 (INFERRED decomposition: median log errors 0.31, 0.25, 0.22 for 1, 3, 10 probes, level noise 0.197/sqrt(k) subtracted), Bai total-cost sd 0.225 to 0.41, HAL 0.16 to 0.19 per run. 0.30 is consistent with all; its in-sample support is weak.
- Smekal's x1.9 (36% median error with one probe, 29% with 3, 25% with 10; x1.8, x1.7 for 90%) is measured against cell means, within one model, over prompt and effort cells, with the shape from four other tasks. It is a lower bound for the plugin's cross-model transitions (INFERRED). The plugin's probe is every agent of a workflow, so level noise (0.197/sqrt(k)) is small and the shape floor dominates.

### 4.2 What can be predicted before a run, and what only from observed tokens

| Before the run | Evidence | Kind |
|---|---|---|
| Prices, price ratios, read-price ratios, default effort of each model (Claude Code: medium for Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.2; API: high for Sonnet 5.5) | docs | MEASURED |
| Direction of effort effects; order of buckets (read, output, fresh) | section 1 | MEASURED / INFERRED |
| Token level of a task | Smekal without a probe: r 0.08, median error 161%, 25% of settings within +-50%; Bai self-prediction: Pearson at most 0.39, all models underestimate; Scout (open-weight models) finds 71 to 99% of log-length variance between problems | MEASURED |
| Cost of the whole trajectory from the last call | Bai: `1.67e-7 n C_N + 0.0076 n`, 6% error (Sonnet 4.5, OpenHands) | MEASURED-BY-ME |
| Whether a lower effort fails | Smekal: one cell solved 47% at low against 99% at high; Anthropic: 13% of tasks failed at low and re-running them at high came to about $0.17 against $0.29 | MEASURED / REPORTED |

| Only from observed tokens | Evidence |
|---|---|
| The level of each agent's four counts | exact in the usage events |
| The ratio shape (what the baseline would have used) | one probe gives r 0.72 and 36% median error; 3 probes 29%; 10 probes 25% (Smekal, MEASURED) |
| Thinking per request | concentrated in the first request after new input; falls as the conversation lengthens (Anthropic, REPORTED) |
| Per-task monotonicity | not guaranteed: Scramble (Sonnet 5) completion tokens per solved task 13,274 / 9,741 / 11,652 at low / medium / high; HAL thinking on/off cost ratios 0.27 to 3.12 per cell across scaffolds |

## 5. Gaps nobody has measured

1. Per-bucket token counts by effort for Claude 5.5 in Claude Code workflows. AA's split is modeled and covers Sonnet only; Anthropic gives cache factors and two sentences; Quntur is Opus 4.5 and confounded; the CSV has output and total only. A same-model high against xhigh replay with four counts, like `replays.json`, would settle it.
2. Cross-model per-bucket ratios beyond the plugin's two transitions (3 workflows, 22 pairs): Haiku against anything, Opus against Sonnet at xhigh, Fable.
3. Meter weights for the 5.5 family: cache write, cache read per family, output against input, thinking tokens, and whether any weight depends on effort. No first-party statement exists; sources measure Opus 4.6 and 4.7, different months.
4. Size of the share of the account's usage the session sees, per user: the only quantification is one day from one user.
5. Header-to-request timing and refresh of `percentUsed`.
6. Whether the Opus-only and Sonnet-only limit pools enter the five-hour and weekly figures.
7. Cache-hit rate and creation share of workflow agents specifically (all sources are main loops or benchmark agents); the effect of the 5-second sibling stagger on the baseline counterfactual.
8. Quality at equal cost: savings assume the lower-effort or smaller model does the same work; failures and re-runs are not modeled (Anthropic: 13% fail at Opus low; Smekal: 47% against 99% on one cell).
9. What AA's "Default Fallback" is, and how often a fallback model answered in its Sonnet and Opus runs.
10. A verified origin for `published.json` Fable medium 2.68; a first-party Sonnet 5.5 xhigh or max cost; an AA cache split for Opus and Haiku.
11. Whether the October 30 / November regression in tokens per percent is real, and its date. Reports span Oct 12 to Nov 5; no staff reply exists.
12. The origin of the 3.4x over-read: no note reproduces it from public data; section 3.3 only shows it is the right order.
13. Cache TTL actually used by workflow agents in the user's setup (the plugin does not read `cache_creation.ephemeral_*`; whether the mod API passes it is unanswerable from the docs).
14. The claude.ai plan tier of the machine that produced `intervals.json`.

## 6. Corrections the evidence supports

Strength scale: STRONG = first-party, or directly measured and reproduced; MODERATE = several consistent sources, or one rigorous source with caveats; WEAK = reported, single-source, or confounded.

Sizes come from running `estimateRun` (4,000 draws, fixed seed `kn-1`) on the 22 replay agents treated as Sonnet:high agents (replay actual tokens: output 0.58%, read 94.94%, write 4.48% of tokens; actual cost $11.2), with `intervals.json` as the meter, through `kn/variants.mjs` and `kn/prior_sim.mjs`. They are pane-style medians with the 5th to 95th percentile range, in dollars at API prices and percentage points of the 5-hour window, for this one token mix and meter only; they are not a forecast for any real workflow. Variants: A = community `max` cells dropped; B = A plus the three added first-party sources and the sd floor of section 1.8; C = B plus per-bucket offsets; D = C plus w drawn from 0.03 to 0.07. Where a variant leaves a scenario unchanged it is omitted.

### 1. Per-bucket same-family effort steps

- Where: `src/calibrate.mjs` `stepsOf` (emit `{output, fresh, read}` each with `mu`, `sd`, with the scalar kept as fallback); `src/savings.mjs` `ratioFor` (chained branch `bucket = ...step.mu` and the same-family prior branch `bucket` shared by the three names); `data/published.json` (add AA token components next to cost: output tokens, input tokens, and for Sonnet the cache components, with `indexVersion: "v5.0.1"`); `data/ratios.json` regenerated; `scripts/calibrate.mjs` unchanged unless a new data file is added.
- Evidence (MODERATE for direction, WEAK for magnitudes): AA Sonnet per step (section 1.3), AA Opus and Haiku output and input (1.4, 1.5), Kimi shares, Anthropic cache factors, Bai's n x context mechanism, the plugin's chaining test at bucket level (below). Contrary and confounded: Quntur, CSV, HAL pair.
- The one chaining test the docs cite (measured Opus medium x published 1.455 predicted 2.31 dollars for high, measured 2.19 to 2.89) passes in dollars by cancellation: per bucket the prediction errors are output -0.18, fresh +0.13, read -0.69 in log (measured read ratio change 2.90 against 1.455). The two cells are different workflows (1 against 2), so this is INFERRED and weak, but it points the way AA does.
- Size (`estimateRun`, variant C against B, level-preserving offsets): against a Sonnet:xhigh baseline (buckets 2.21, 2.11, 3.28 against the scalar 2.494) baseline dollars 27.3 to 27.9 (+2%), saved dollars 16.2 (2.4 to 45.3) to 16.7 (2.5 to 48.3), 5-hour 40.1 (5.3 to 122.6) to 40.9 (5.7 to 126.7) points, weekly 5.9 to 6.0, and the token figure 57M to 86M saved (+51%, because it is mostly cache-read tokens and the read step grows from 2.49 to 3.28). Against an Opus:xhigh baseline (buckets 2.42, 2.13, 2.56 against 2.36) baseline dollars 77.4 to 78.7 (+2%), 5-hour 159.9 to 162.8 (+2%), tokens saved 168M to 185M (+10%). Dollars and percentages move by about 2%; the token figure moves by tens of percent. Point calculation on the replay mix with the raw AA buckets instead of level-preserving ones (2.03, 1.93, 3.01): baseline dollars -6%, saved dollars -10% (this version changes the level and is not the recommendation).
- Tests: `tests/calibrate.test.js` (steps carry three buckets; fall back to the scalar when a source has no token fields; Sonnet AA identity: non-cache/2 + read/0.1 + write/2.5 equals input; offsets reproduce the multi-source total at AA's mix), `tests/savings.test.js` (chained and same-family paths use bucket-specific steps; a measured plus step equals bucket-wise sum of logs; unknown bucket falls back), `tests/savedText.test.js` and `tests/tally.test.js` pin numbers that will move; `node scripts/calibrate.mjs --check`.
- Risk: medium. Opus and Haiku fresh is borrowed; AA's harness is not Claude Code; level and shape come from different sources. Could worsen a case where the scalar happened to be right for a workflow with a short fixed context.
- Decision for the user: adopt AA's shape for Opus and Haiku fresh (borrowed 0.77 exponent) or only for Sonnet; the extra shape sd to add (candidates 0.15 to 0.25, the spread between the AA and Quntur/CSV shapes).

### 2. Remove community `max` cells from steps and priors

- Where: `data/published.json` (delete the `max` entries of `community-claude-effort-cost`, or add an `exclude` field honored by `stepsOf` and `priorsOf` in `src/calibrate.mjs`); regenerate `data/ratios.json`.
- Evidence (MODERATE: three independent indications, none first-party for Claude Code workflows): AA is a complete nine-benchmark run (Opus xhigh>max 1.66, high>max 2.90); ArkNill Opus 4.7 high>max 2.21 and xhigh>max output 2.04; the CSV card says the max cells needed a permission and self-written tests; the CSV's Opus xhigh>max (6.5) and Haiku (9.7) exceed AA by 3.9x and 5.9x.
- Size: every `max` step ratio falls 43 to 63% (Opus low>max 17.9 to 10.2, high>max 6.65 to 2.90; Haiku low>max 20.2 to 10.3; table 1.8). Sonnet unaffected (the CSV has no Sonnet max). `estimateRun`, variant A against current, Opus:max baseline chained via Opus:high: baseline dollars 213.0 to 94.8 (-55%), saved dollars 201.9 (19.2 to 1,580.7) to 83.7 (28.4 to 213.3), 5-hour 502.6 (47.1 to 4,049.2) to 203.0 (68.6 to 565.5) points, weekly 74.2 to 30.1. The range narrows in A only because a single remaining source gets the 0.4 default sd; with the sd floor of item 3 (variant B) it is 12.4 to 377.6 dollars and 29.3 to 957.6 points. Affects only runs whose session or agents are at `max` (ultracode starts at xhigh); Opus:xhigh and Opus:medium baselines are unchanged by this item.
- Tests: `tests/calibrate.test.js` (assert no `community` max in steps; Opus high>max near 2.90 and sd per rule); `--check`.
- Risk: low on engine, medium on display for max users (large drop).
- Decision for the user: drop or down-weight the cells; keep the wide sd (0.7 to 1.1) that AA's own per-evaluation spread supports, or accept the narrower one.

### 3. Step sd: a workload-spread floor

- Where: `src/calibrate.mjs` (`SINGLE_SOURCE_STEP_SD`, the sample sd in `stepsOf`); optionally a run-level term in `src/savings.mjs` for chained and prior-step paths, since the same-family prior path has `tau: 0`.
- Evidence (MODERATE): AA per-evaluation log sd of the cost ratio 0.26 (low>medium), 0.37 (medium>high, high>xhigh), 0.70 (xhigh>max); output-token spread 0.25 for high>xhigh; Smekal 0.249 over five tasks. Today Opus medium>high carries 0.08 and Haiku medium>xhigh 0.01 from two or four agreeing sources.
- Size (`estimateRun`, variant B against A): Opus:xhigh baseline, saved dollars 65.7 (27.3 to 140.3) to 66.2 (22.1 to 164.5), 5-hour 160.6 (64.5 to 373.1) to 159.9 (52.9 to 437.7) points: medians within 1%, the 90% range 18% lower at the bottom and 17% higher at the top. Sonnet:xhigh baseline unchanged (its sd was already 0.4); Opus:medium unchanged (measured transition, no step). Medians can move on a sum of lognormals when sigma grows; here they moved under 1%.
- Tests: `tests/calibrate.test.js` pins `s.sd` within 0.01 of 0.22 for Opus high>xhigh; update.
- Risk: wider ranges read as less informative.
- Decision for the user: floor value (0.25 adjacent, up to 0.7 across max), and whether it enters the transition sd or the run-level term.

### 4. Source hygiene in `published.json`

- Where: `data/published.json`; `src/calibrate.mjs` only if a ratio-only source is stored.
- Changes (STRONG, first-party text): (a) tag AA with `v5.0.1` in the id (AA re-baselines silently); (b) add Opus 5.5 medium $4.78 / low $1.84 (134 tasks, Managed Agents) as its own source, and defect search medium $200 / high $236 as its own source (a different workload class, so keep separate ids and never mix per-attempt with per-solved bases); (c) Sonnet 5.5 SWE-bench Pro "about 59% of the cost" at medium is REPORTED as a ratio only; (d) correct or remove `anthropic-agentic-370.fable.medium = 2.68`: the page states Fable 5.2 medium $1.34 (low $1.05, high $5.39), and the AA Fable numbers are Fable 5.1, so the `fable` family mixes versions.
- Size: Opus low>medium +5%, medium>high -4%, Sonnet medium>high -0.6%. Priors into `fable:medium` from Opus or Sonnet medium: about -29% when 2.68 becomes 1.34 (for example `opus:medium>fable:medium` 1.076 to 0.762, `sonnet:medium>fable:medium` 2.185 to 1.545; INFERRED arithmetic on the two sources).
- Tests: `tests/calibrate.test.js` (source ids unique, schema); update pinned Opus values.
- Risk: low.
- Decision for the user: include the defect-search point; split `fable` by version or leave Fable out of the displayed set.

### 5. Cross-family prior: stop dividing by the input-price ratio

- Where: `src/calibrate.mjs` `priorsOf`; `src/savings.mjs` prior branch (lines 44 to 48); `docs/reference.md` "Where ratios come from" item 3.
- Evidence (MODERATE): backtest against the two measured transitions (AA tokens beat the prior in 5 of 6 bucket comparisons, mean |ln| 0.18 against 0.31), structural bias for Haiku (read price ratio 10x, others 20x; median ln(AA input / prior) +0.58, x1.79, for Haiku-actual pairs), Opus and Sonnet read bucket under-predicted by the prior. One source (AA tokens) and AA's Haiku sessions are short.
- Options: (A) store per-bucket token ratios from AA and use them as the prior (output from AA output tokens, read from AA input tokens, fresh from the Sonnet-borrowed exponent); (B) keep cost ratios but convert at the agent's own bucket mix: baseline dollars = published cost ratio x actual dollars, distributed over buckets by the actual mix, which removes the price-ratio assumption without new data.
- Size: for Haiku agents against an Opus or Sonnet baseline the baseline tokens rise about 37% (output) to 79% (input side, read-dominated) and saved dollars rise a similar amount; for Sonnet or Opus agents against a Haiku baseline the baseline falls by roughly 25 to 50% on the input side; Opus and Sonnet pairs move by 20% to 85% per bucket in either direction (pair table: `kn/prior.mjs` output). `estimateRun` with the 22 replay agents relabelled Haiku:high (their token mix is Sonnet's, so this is only an illustration of the prior change; AA per-bucket prior from `kn/prior_sim.mjs`, buckets output / fresh / read): against Opus:xhigh (prior 0.972 for all buckets; AA 1.125 / 1.095 / 1.634) baseline dollars 21.3 to 28.2 (+32%), saved dollars 20.5 (7.0 to 59.8) to 27.5 (9.3 to 80.2), 5-hour 51.5 to 69.0 points; against Sonnet:xhigh (1.278; AA 1.233 / 1.175 / 2.035) baseline dollars 14.0 to 16.2 (+16%), 5-hour 33.4 to 38.9; against Opus:high (0.480; AA 0.625 / 0.696 / 0.859) baseline dollars 10.5 to 16.2 (+54%), 5-hour 24.8 to 38.7; against Sonnet:high (0.382; AA 0.609 / 0.682 / 0.685) baseline dollars 4.2 to 7.3 (+74%), 5-hour 9.0 to 16.7. This is the largest change to displayed figures of the list for Haiku-heavy workflows.
- Tests: `tests/calibrate.test.js` ("priors convert cost to tokens with the input-price ratio" pins `sonnet:high>opus:xhigh` 3.43, sd 0.61; replace), `tests/savings.test.js`, snapshots in `tests/savedText.test.js`.
- Risk: high; changes the main figure for the commonest delegation pattern (Haiku and Sonnet agents under an Opus session).
- Decision for the user: option A or B; accept the changed Haiku numbers.

### 6. Meter units: make the denominator account-wide

- Where: `src/meter.mjs` (`noteRequest`, `noteReading`, `mergeStored`, `intervalsOf`) and its consumers in `src/eval.mjs`; storage layout under `$.store`.
- Evidence (STRONG that the bias exists, WEAK on its size): molu0219 4.5x on reads, ArkNill windows D and H, Cowork and chat reports, the help-center sentence that all surfaces share one limit, local budget against five published budgets 1.6x to 3.6x (section 3.3). limitcast's account-level summation is the only published fix; it covers local sessions of the account, not other devices.
- Size: removes the part of the 3.4x that comes from other local sessions; the part from claude.ai and other machines stays. It scales every 5-hour and weekly figure linearly (the rate multiplies the saved units), so the sizes in items 1 to 5 would scale with it; w does not explain it (item 8). Cannot be estimated without the data.
- Tests: `tests/meter.test.js` (two sessions' tokens land in one interval; an interval whose boundary readings are shared by two sessions is formed once; no double count when both instances store it).
- Risk: high. Needs a cross-session ledger or transcript reading (privacy of transcripts, write races on one `$.store` key, clock alignment, sessions that do not run ultraguard).
- Decision for the user: whether to read other sessions' data at all; ledger or transcripts; accept that other devices stay invisible and say so in the pane.

### 7. Whole-percent resolution

- Where: `src/meter.mjs` (`MIN_RISE`, `round1`, the readiness rule), `docs/reference.md` line 503 and the "Limit percentages" section.
- Evidence (STRONG): 242 of 242 stored `d` are integers (MEASURED-BY-ME); ArkNill's two-decimal fractions and limitcast's "whole percentages" say the same.
- Size: none on figures. Documentation becomes accurate; the readiness rule (5 intervals) means at least 5 pp. The quantity to bootstrap is one-percent ticks, and consecutive intervals telescope, so resample blocks of ticks rather than single intervals (INFERRED).
- Tests: `tests/meter.test.js` (a rise of 0.4 is ignored or accepted per the decision).
- Risk: low.
- Decision for the user: keep `MIN_RISE = 0.1` in case the host later sends decimals.

### 8. The cache-read weight prior

- Where: `src/savings.mjs` (`MAX_CACHE_READ_WEIGHT`, the draw `rand() * MAX_CACHE_READ_WEIGHT`), `docs/reference.md` "Limit percentages".
- Evidence (MODERATE for 0.01 to 0.07, WEAK for narrower): section 3.2. Nothing supports above 0.1; the plugin's upper bound is twice the Opus and Sonnet 5.5 billing ratio and equal to Haiku's.
- Size: the pooled rate alone is 6.09, 2.68 and 1.72 percentage points per unit at w = 0, 0.05, 0.1 on the local intervals, so w looks like the dominant uncertainty. The displayed saving says otherwise: the same w weighs reads inside the stored intervals and inside the saved units, so it largely cancels. `estimateRun`, current ratios with w drawn from 0.03 to 0.07 (variant E) against 0 to 0.1: Sonnet:xhigh baseline 5-hour 40.1 (5.3 to 122.6) to 38.7 (5.3 to 119.5); Opus:xhigh 160.6 (64.5 to 373.1) to 161.8 (65.4 to 375.5); Opus:max 502.6 to 503.8; Opus:medium 13.6 (-5.7 to 53.7) to 12.9 (-5.9 to 52.2). Within 5% and no narrower range. This item matters for what the stored rate means, not for the figure on the pane, so it is low priority; the earlier idea that narrowing w would shrink the limit ranges does not hold.
- Tests: `tests/savings.test.js` (draw bounds; family-specific bound if adopted).
- Risk: low. Overconfidence in a narrow prior without a visible gain.
- Decision for the user: keep [0, 0.1] (the evidence overlaps 0.01 to 0.07 and nothing supports above 0.1); a family-specific upper bound of twice the billing ratio (0.1, 0.1, 0.2, 0.05 for Opus, Sonnet, Haiku, Fable); or concentrate on 0.01 to 0.07.

### 9. A cache-write weight parameter

- Where: `src/prices.mjs` `meterUnits` (writes at 1.0 x input), `src/savings.mjs` draw.
- Evidence (WEAK): no source separates write weight from w; cnighswonger fixes 2.0; monitors use 1.25 for cost; limitcast lumps writes with input; the main loop is on a 1h TTL on subscriptions (2x) while workflow agents are on 5m (1.25x).
- Size: bounded by the writes' share of `u`; not computable from `intervals.json`, which stores only `u` and `c`.
- Tests: `tests/meter.test.js`, `tests/prices.test.js`.
- Risk: low if only a sensitivity; medium as a free parameter.
- Decision for the user: sensitivity band only, or a second draw.

### 10. Staleness guard

- Where: `src/meter.mjs` `intervalsOf` (`MAX_AGE_MS` 30 days, equal weights, 200 intervals).
- Evidence (MODERATE that rates drift, WEAK on cause): section 3.3 drift row; limitcast's `limitChange` (median of fits 3 to 30 days before against the newest 3-day fit, alert at 15%); Anthropic limit changes (May 6, Sept 13/14).
- Size: depends on the account; with a recent change the pooled rate is a blend of two regimes. Using the newest 7 days instead of 30 is the minimal guard.
- Tests: `tests/meter.test.js` (age weighting or window; a shifted rate is flagged).
- Risk: low; fewer intervals delays the 5-interval readiness.
- Decision for the user: window length or half-life; whether to show "rate changed".

### 11. Input guards

- Where: `src/meter.mjs` `noteReading` (`finite(entry.percentUsed)` only).
- Evidence (WEAK, REPORTED): known bug where the percentage carries the `resets_at` epoch (#52326, not read at source); cheap.
- Change: reject `percentUsed` outside 0 to 100; do not form an interval across `/compact`.
- Tests: `tests/meter.test.js`.
- Risk: none.
- Decision: none.

### 12. Price rows and model-id mapping

- Where: `src/prices.mjs` `priceFamily` (regex `<family>-5(?!\d)` matches `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5-1`, `claude-fable-5-2`), `data/prices.json`, `docs/reference.md` "Dollars".
- Evidence (STRONG, pricing page seen by three notes; the mapping run by me): Opus 5 is $5/$25 with read $0.50 (priced as 4/20/0.2); Sonnet 5 reads $0.20 (priced 0.1); Fable 5.2 is $8/$40/$0.20/$10 (priced at Fable 5.1's 10/50/0.25/12.5, 25% high). Docs claim the rows cover Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1 only.
- Size: Opus 5 agents and baselines under-priced 20% on input and output, reads 2.5x; Fable 5.2 over-priced 25%. Applies only to those models.
- Tests: `tests/prices.test.js` (ids map to the intended row or to null).
- Risk: low.
- Decision for the user: add rows (and a version key), or make the older and newer ids unknown. Ratios are keyed by family, so a version split also touches `ratios.json` keys.

### 13. Documentation rationale for cache-write pricing

- Where: `docs/reference.md` "Dollars" ("because `usage` does not split them by TTL").
- Evidence (STRONG): the API usage object does split writes into `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`; Claude Code defaults to 5 minutes for API-key users (the only users shown dollars), so the outcome is right; wrong only for users who set 1h TTL (1.6x on those tokens).
- Size: none by default. Whether the mod API passes the nested object is unanswerable here.
- Tests: none.
- Risk: none. Decision: reword, or read the nested field when present.

### 14. `tau` and the agent sd have outside anchors

- Where: `src/calibrate.mjs` `tauOf` (`MIN_TAU 0.15`), `pooledAgentSd`.
- Evidence (MODERATE): section 4.1: one degree of freedom; anchors 0.16 to 0.41. fresh agent sd (0.222) is not clearly above the same-configuration noise floor.
- Change: raise the tau floor to 0.22 (Smekal's shape-mismatch floor) or shrink toward it; add a test that each `pooledAgentSd` bucket is at least the single-run floor.
- Size: none now (0.296 above the floor); protects the next recalibration.
- Tests: `tests/calibrate.test.js`.
- Risk: low.
- Decision for the user: floor value.

### 15. Documentation, validation protocol, version

- `docs/reference.md`: "one decimal" (item 7); "cache reads free, another says 0.1x" (item 8); "Chaining passed its one test" (add the bucket-level result, item 1); the Smekal sentence (state: held-out task, same model, 11 specs x 3 efforts, Kimi K3, 5 tasks, errors against cell means, so x1.9 is a lower bound for cross-model transitions); the cache-write rationale (item 13).
- A leave-one-workflow-out check (Smekal's protocol: median error, share within +-50%, 90% multiplier against a no-probe baseline) is cheap on the 3 workflows of `replays.json` and tests `tau` directly. Optional script under `scripts/`.
- Version: patch bump only, 0.4.15 to 0.4.16, in `package.json`, `.claude-plugin/plugin.json` and the `ultraguard` entry of `.claude-plugin/marketplace.json` (enforced by `tests/version-sync.test.js`); the working copy is on branch `fix-0.4.16` while all three files still say 0.4.15 (checked: `package.json` line 3, `.claude-plugin/plugin.json` line 3, `.claude-plugin/marketplace.json` line 11). `CHANGELOG.md` entry. CLAUDE.md hard rule: after `npm test` passes, live-verify with the plugin loaded from the working copy and `/effort ultracode`.

## 7. Suggested order

1. Data only (items 2, 4, 12): regenerate with `node scripts/calibrate.mjs`, update pinned numbers, `--check`.
2. Engine (items 1, 3, 14, then 5): bucket-wise steps and sd first; priors last because they move the Haiku figures most.
3. Meter, cheap first (items 7, 11, 10, 8, 9), then item 6, which is the largest change in correctness and in risk.
4. Docs, `CHANGELOG.md`, patch bump, `npm test`, live verification.

The compact and clear checks in the pending list are outside this file; section 2.5 holds the facts the notes found for them.

## 8. Files used

- Notes: `lit/bai.md`, `smekal.md`, `aa-sonnet.md`, `aa-others.md`, `anthropic-docs.md`, `arknill.md`, `limitcast.md`, `cache-quota.md`, `cache-papers.md`, `hal.md`, `gap-sweep.md`; AA JSON `lit/sonnet55.json`, `lit/derived.json`.
- Plugin: `src/savings.mjs`, `src/meter.mjs`, `src/calibrate.mjs`, `src/prices.mjs`, `data/published.json`, `data/ratios.json`, `data/prices.json`, `data/replays.json`, `scripts/calibrate.mjs`, `docs/reference.md` lines 485 to 640, `tests/calibrate.test.js` (first 60 lines), untracked `intervals.json`.
- My scripts and downloads, all under `scratchpad/kn/`: `calc.mjs` (step tables, AA cross-family), `final.mjs` and `gen.mjs` (recommended tables), `prior.mjs` (prior against AA tokens), `size.mjs` (point-estimate sizes), `variants.mjs` and `prior_sim.mjs` (`estimateRun` variants, with patched copies `savings_wfull.mjs`, `savings_wnarrow.mjs`, `savings_wprior.mjs` of `src/savings.mjs`), `opt.md` (Anthropic cost page).
