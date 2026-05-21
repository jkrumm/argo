---
paths:
  - apps/api/**
---

# Weekly Aggregation

Anything that buckets data "by week" MUST go through the shared helper in
`src/lib/week.ts`. Do not hand-roll week math.

## Rules

- **Calendar weeks, Monday–Sunday.** Bucket via `weekStart(iso)` (Monday, UTC).
  Never anchor on Sunday, never use an ISO week number as the key, and never use
  a trailing 7 days from `now` or from the latest data point.
- **Key by the Monday date** (`YYYY-MM-DD`). It is a real date: sorts naturally,
  renders on `AxisBottomDate`, and reads as "week of May 18". A point keyed
  `2026-05-18` covers Mon 2026-05-18 → Sun 2026-05-24.
- **Zero-fill gaps** with `eachWeekStart(from, to)` so charts render empty weeks
  explicitly rather than collapsing them.
- **Completeness** (PR eligibility, "is this week done yet") via
  `isWeekComplete(anyIsoInWeek, now)` — true once `now` is past the following
  Monday 00:00 UTC.

## Weekly buckets vs. rolling smoothers — keep them distinct

A _weekly aggregation_ (tonnage/week, distance/week, weekly volume breakdown,
ACWR over weekly tonnage) snaps to Mon–Sun via `week.ts`.

A _rolling smoother_ is a different thing. It legitimately uses a trailing window
and stays rolling — but it MUST NOT be labeled "week" / "this week". Label these
"rolling Nd" or "trailing". Current rolling smoothers (do not snap these):

- Per-lift e1RM velocity OLS regression (trailing N days).
- Momentum / composite trailing moving averages (last N sessions).
- Garmin EWMA acute/chronic load — continuous decay; the "7d / 28d" is a
  half-life, not a bucket.
- Walking-pad "sessions in last 7 days" — recency for the streak hero.

## ACWR is weekly-bucketed, then smoothed

`computeAcwrSeries` runs EWMA over the **weekly tonnage series** — N counts
weeks, not days. The bucketing is calendar-week; the EWMA is the smoother. Keep
that split: bucket first (Mon–Sun), then smooth.
