# To do: a cross-session meter ledger

## Why

The 5-hour and weekly savings come from a pooled rate: the account's `percentUsed` rise between two readings, divided by this session's own token units. Other sessions of the same account also raise the percentage, but their units never reach this session, so the rate reads high.

- Before 0.4.17 the rate read about 3.4× the ground truth: 2.68 points per unit, against 0.79 to 0.86.
- 0.4.17 drops readings that jump 2 points or more, which takes the rate to 1.49. That is still about 1.8× high.
- The 0.4.17 clamp only caps a run's own estimated use, not its saving. A cheap agent measured against an expensive baseline can still show an inflated saving.

A ledger fixes the cause: it divides each rise by the units of every local session that ran in that interval. On one replayed window it moved the rate from 1.56 to 0.94, against a ground truth of 0.79. It cannot see claude.ai or other machines, and the pane must say so.

## What

Each session writes its units and readings, numbers only, to its own `ledger:<session id>` key in the plugin store. Raw rows are kept for about 6 hours and derived observations long term. The store is capped at 4 MiB in total. A write takes a cross-process lock, the last write wins, and there is no change event. Every session merges all the keys when it forms an interval.

## Main risk

Coverage. A session that does not run ultraguard, or runs another copy of it, adds no units. The rate then reads high again while looking complete. A coverage guard should flag such intervals: a transcript active in the interval with no ledger entry.

## First step

A replay experiment with no code change. Take every complete 5-hour window of the last 30 days that rose 20 or more points, and compare three rates per window:

- R_own: today's rate, from this session's units only;
- R_ledger: the rise over all local sessions' units in the stored intervals;
- R_window: the rise over all local units in the window, the ground truth.

The ledger is supported if:
- the median R_ledger / R_window is between 0.9 and 1.25,
- its p90 is under 1.5,
- and the median R_own / R_window is above 1.5.

It is falsified if:
- the median R_ledger / R_window is over 1.3,
- or that ratio varies more than 25% between windows.
