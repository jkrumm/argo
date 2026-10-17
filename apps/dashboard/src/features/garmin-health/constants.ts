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
    'Daily effort in MET-minutes. Walking (baseline steps ×1), Moderate (×1), Vigorous (×1.8). Weekly target 600 MET-min (≈86/day) covers the WHO floor. Sustained days above target = durable cardiorespiratory benefit; consistently below = detraining risk.',
  recoveryScore:
    'Composite: HRV vs baseline (40%), Sleep Score (35%), Resting HR vs baseline (25%). Green >= 70: push hard. Yellow 40-69: normal. Red <40: prioritize recovery.',
  trainingLoad:
    'Acute:Chronic Workload Ratio (ACWR) using EWMA (Hulin et al. 2017). Compares your recent 7-day training load to your 28-day baseline. <0.8 = undertrained (detraining risk), 0.8-1.3 = optimal adaptation zone, 1.3-1.5 = elevated injury risk, >1.5 = danger zone. Daily load estimated from intensity minutes (moderate x1.0 + vigorous x1.8).',
}

// Hero-card grade colors — the Blueprint STATUS scale (theme-aware traffic-light).
export const ZONE_COLORS = {
  excellent: VX.status.excellent,
  good: VX.status.good,
  warn: VX.status.warn,
  bad: VX.status.bad,
  neutral: VX.status.neutral,
} as const
