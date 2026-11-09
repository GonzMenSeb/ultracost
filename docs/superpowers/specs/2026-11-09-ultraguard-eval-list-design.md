# ultraguard 0.4.15: the workflow list

## Why

The ultraguard-eval list showed each run on three lines and no total. A session with many workflows pushed the runs off the pane, and nothing told the reader what ultraguard saved over the whole session. A workflow stopped with TaskStop stayed "running" for ever, because the host sends no task notification for it.

Mock: https://claude.ai/artifact/JfwQ9rQG2mWPdqzCXpE9LQ (v6, fourth pass). Plan: `docs/superpowers/plans/2026-11-09-ultraguard-eval-list.md`.

Anti-goals: no change to the estimator or the meter (the meter's calibration bias, about 3x high by inference, gets its own PR next); runs recorded before 0.4.14 keep drawing limit rows without bars.

## Decisions

- The list opens with `overall savings for this session` (` so far` while a run is going) and `N workflows`. It holds the context row "for now". It resets on /clear, which starts a different session.
- List rows take 2 lines each: a row Box overlaps the one above by one line (`marginTop={-1}`), and the ring around the picked row is kept.
- The rows sit in their own window, so the overall section is always visible.
- A folded section holds the stopped workflows only. Their savings count toward the total.
- Every main section, in the list and in a run's view, starts with a double rule: `══ title  extra ═════`. Subgroups (`finished this session`, the stopped fold) use a thin rule: `─ label ─────`. One function draws every head.
- A run's view: the saved block first, then the phases, then the checks.
- Every collapsible starts collapsed, the phases included.
- Savings read as a low-to-high range, never `±`: `+30.1 (3.0 to 91.6)`, `$12.04 ($1.20 to $35.21) at API prices`. The note reads `range = 9 times in 10`.

## The list

```
ultraguard-eval

══ overall savings for this session so far  15 workflows ══════
  vs every agent on Sonnet xhigh
  context ━━━──────────────────────│   12%  125k of 1M
  5-hour  ━━━━━━━╸─────────────────│   13%  +17.8 (2.1 to 52.3)
  weekly  ━━━━━━━━━━━━━╸───────────│   50%  +3.5 (0.4 to 10.2)
  5-hour counts the 7 workflows of this window

══ workflows  2 running ════════════════════════════════════════
    workflow                  id       agents          5h saves
  ↑ 3 more
╭──────────────────────────────────────────────────────────────╮
│ ■ map the repo              a1b2c3d  opus 2  sonnet 9   4.1% so far │
╰──────────────────────────────────────────────────────────────╯
  □ audit the gate            e4f5a6b  sonnet 4         0.8% so far

─ finished this session ────────────────────────────────────────

  □ fan out the docs          c7d8e9f  done 14:02       2.2% (0.9 to 3.8)

  ▸ stopped this session  2 workflows
  ↓ 5 more

↑↓ choose  enter details  esc close
```

The fold row is a row like the others, with the ring when picked. On it the hint reads `↑↓ choose  enter opens the stopped ones  esc close` (`folds` when open). Open, its rows read `stopped HH:MM` in the agents column.

- The window keeps the focused row and one row on each side drawn (scrolloff 1). The `↑ N more` and `↓ N more` lines are reserved, so the overall section never moves.
- With no running run the workflows section reads `none running` and says `No workflow is running.`.
- The overall total pools every workflow of the session in one estimate per baseline (the session's model and effort at each launch). With one baseline it is that estimate. With several it adds the low, middle and high ends (conservative), and the vs line reads `vs your session's model at each launch`.
- The 5-hour and weekly rows count only the workflows of the current window. When some workflows ran in an earlier window a dim line says how many count.
- The tally lives in its own session atom and is mirrored to the plugin store under `tally:<session id>`, so it outlives the 20-run list and a reload. Keys older than 30 days are removed at session start.

## A run's view

```
ultraguard-eval  ‹ map the repo

══ ultraguard saved so far ═════════════════════════════════════
  vs every agent on Sonnet xhigh
  context ...
  5-hour  ...

══ phases  12 agents ═══════════════════════════════════════════
  ▸ ● Investigate
  ▸ ○ Build
  ✓ ran as the gate approved  ✗ did not

══ checks ══════════════════════════════════════════════════════
  ...
```

A run without phases titles its table `agents`.

## Stopped workflows

A TaskStop whose `task_id` (or `shell_id`) matches a running workflow's task id ends that run with status `killed`, the status the host's own notification uses. The run gets its final estimate, its record and a toast `ultraguard: <title> stopped`, like a finished run. A denied or failed TaskStop, or one for another task, changes nothing.

## Live checks

The results of the live checks are recorded in the plan's Verification status.
