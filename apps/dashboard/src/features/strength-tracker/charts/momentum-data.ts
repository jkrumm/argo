import type { StrengthDirection } from '../formulas'

/**
 * Linear regression slope over a trailing window of up to `windowDays` days
 * relative to each point. Returns slope as %/day (slope / mean × 100).
 */
export function rollingVelocityPctPerDay(
  data: readonly { day: Date; e1rm: number | null }[],
  windowDays = 28,
): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < data.length; i++) {
    const anchor = data[i]
    if (!anchor || anchor.e1rm === null) {
      out.push(null)
      continue
    }
    const anchorMs = anchor.day.getTime()
    const cutoffMs = anchorMs - windowDays * 86_400_000
    const pts: { t: number; y: number }[] = []
    for (let j = i; j >= 0; j--) {
      const p = data[j]
      if (!p || p.e1rm === null) continue
      const tMs = p.day.getTime()
      if (tMs < cutoffMs) break
      pts.push({ t: (tMs - anchorMs) / 86_400_000, y: p.e1rm })
    }
    if (pts.length < 3) {
      out.push(null)
      continue
    }
    const n = pts.length
    let sumT = 0
    let sumY = 0
    let sumTT = 0
    let sumTY = 0
    for (const { t, y } of pts) {
      sumT += t
      sumY += y
      sumTT += t * t
      sumTY += t * y
    }
    const meanT = sumT / n
    const meanY = sumY / n
    const denom = sumTT - n * meanT * meanT
    if (denom === 0 || meanY === 0) {
      out.push(null)
      continue
    }
    const slope = (sumTY - n * meanT * meanY) / denom
    out.push((slope / meanY) * 100)
  }
  return out
}

// Mirrors `strengthDirection` in apps/api/src/lib/strength-formulas.ts (>0.1 improving, <-0.05
// declining) so the chart header agrees with the server's verdict on the same velocity.
const IMPROVING_ABOVE = 0.1
const DECLINING_BELOW = -0.05

export function directionFromVelocity(velPctPerDay: number | null): StrengthDirection | null {
  if (velPctPerDay === null) return null
  if (velPctPerDay > IMPROVING_ABOVE) return 'improving'
  if (velPctPerDay < DECLINING_BELOW) return 'declining'
  return 'stable'
}
