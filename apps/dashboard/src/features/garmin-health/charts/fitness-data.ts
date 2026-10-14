import { localDay } from './local-day'
import { movingAverage } from './moving-average'

function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sq = values.reduce((a, v) => a + (v - mean) * (v - mean), 0)
  return Math.sqrt(sq / (values.length - 1))
}

function zScore(v: number | null, mean: number | null, sd: number, flip = false): number | null {
  if (v === null || mean === null) return null
  const raw = (v - mean) / sd
  return flip ? -raw : raw
}

export type SeriesPoint = {
  date: string
  restingHr: number | null
  hrv: number | null
  vo2Max: number | null
}

export type FitnessPoint = {
  day: Date
  rhrMA: number | null
  hrvMA: number | null
  vo2max: number | null
  rhrZ: number | null
  hrvZ: number | null
  vo2Z: number | null
}

export function buildFitnessData(points: SeriesPoint[]): FitnessPoint[] {
  const rhrMA = movingAverage(
    points.map((d) => d.restingHr),
    7,
    { round: true },
  )
  const hrvMA = movingAverage(
    points.map((d) => d.hrv),
    7,
    { round: true },
  )

  const rhrMAVals = rhrMA.filter((v): v is number => v !== null)
  const hrvMAVals = hrvMA.filter((v): v is number => v !== null)
  const vo2Vals = points.map((d) => d.vo2Max).filter((v): v is number => v !== null)

  const rhrMean = rhrMAVals.length ? rhrMAVals.reduce((a, b) => a + b, 0) / rhrMAVals.length : null
  const hrvMean = hrvMAVals.length ? hrvMAVals.reduce((a, b) => a + b, 0) / hrvMAVals.length : null
  const vo2Mean = vo2Vals.length ? vo2Vals.reduce((a, b) => a + b, 0) / vo2Vals.length : null

  const rhrSd = Math.max(sampleStdDev(rhrMAVals) ?? 0, 0.5)
  const hrvSd = Math.max(sampleStdDev(hrvMAVals) ?? 0, 1)
  const vo2Sd = Math.max(sampleStdDev(vo2Vals) ?? 0, 0.2)

  return (
    points
      .map((d, i) => ({
        day: localDay(d.date),
        rhrMA: rhrMA[i] ?? null,
        hrvMA: hrvMA[i] ?? null,
        vo2max: d.vo2Max,
        rhrZ: zScore(rhrMA[i] ?? null, rhrMean, rhrSd, true),
        hrvZ: zScore(hrvMA[i] ?? null, hrvMean, hrvSd),
        vo2Z: zScore(d.vo2Max, vo2Mean, vo2Sd),
      }))
      // A VO2 reading is data in its own right: keep the row even before either average has warmed up.
      .filter((d) => d.rhrMA !== null || d.hrvMA !== null || d.vo2max !== null)
  )
}
