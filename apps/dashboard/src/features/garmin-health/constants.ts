import { VX } from 'basalt-ui/tokens'

/**
 * Hard floor on visible data. Anything before this date is dropped from the
 * page so charts and moving averages start from a known-clean baseline.
 * Earlier history is still fetched (it warms up MAs) but never rendered.
 */
export const VISIBLE_DATE_MIN = '2026-04-15'

/**
 * Most charts hide today until 22:00 local time — daily aggregates (steps,
 * intensity minutes, body battery, stress, ACWR) build up throughout the day,
 * so a partial reading reads as a misleading dip. Fitness Trends (VO2/RHR/HRV)
 * and Sleep Quality lock in overnight, so they keep today.
 */
export const HIDE_TODAY_BEFORE_HOUR = 22

/**
 * Polling interval while a Garmin sync is queued or running (ms).
 */
export const SYNC_POLL_INTERVAL_MS = 5_000

/**
 * Auto-trigger a refresh on mount when the last completed sync is older than this (ms).
 */
export const SYNC_STALE_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour

export const METRIC_TOOLTIPS = {
  activityScore:
    'Daily effort in MET-minutes: 8 × vigorous minutes + 4 × moderate minutes + 0.03 × steps outside those minutes (100 steps per intensity minute are not counted twice). A day at the 600 MET-min target line is a full day. Sustained days above target = durable cardiorespiratory benefit; consistently below = detraining risk.',
  recoveryScore:
    'Composite: HRV vs baseline (40%), Sleep Score (35%), Resting HR vs baseline (25%). Push >= 70: push hard. Normal 40-69: normal. Rest <40: prioritize recovery.',
  trainingLoad:
    'Acute:Chronic Workload Ratio (ACWR) using EWMA (Hulin et al. 2017). Compares your recent 7-day training load to your 28-day baseline. <0.8 = undertrained (detraining risk), 0.8-1.3 = optimal adaptation zone, 1.3-1.5 = elevated injury risk, >1.5 = danger zone. Daily load estimated from intensity minutes (8 × vigorous + 4 × moderate minutes, plus walking steps).',
}

// Hero-card grade colors — the Blueprint STATUS scale (theme-aware traffic-light).
export const ZONE_COLORS = {
  excellent: VX.status.excellent,
  good: VX.status.good,
  warn: VX.status.warn,
  bad: VX.status.bad,
  neutral: VX.status.neutral,
} as const
