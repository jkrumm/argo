export type WindowParams = {
  spot: string
  days: number
  detailDate?: string
}

export type Verdict = 'excellent' | 'good' | 'marginal' | 'poor' | 'out'

export type WindKind = 'offshore' | 'cross-shore' | 'onshore'

export type Killer = { id: string; label: string; reason: string }

export type Factor = {
  id: string
  label: string
  weight: number
  value: number | null
  weighted: number | null
  detail?: string
}

export type SessionWindow = {
  start: string
  end: string
  localStart: string
  localEnd: string
  minutes: number
  peakTime: string
  localPeakTime: string
  peakScore: number
}

export type Conditions = {
  swellHeight: number | null
  swellPeriod: number | null
  swellDirection: number | null
  waveHeight: number | null
  windSpeed: number | null
  windDirection: number | null
  windKind: WindKind | null
}

export type Day = {
  date: string
  verdict: Verdict
  score: number
  coverage: number
  killers: Killer[]
  factors: Factor[]
  window: SessionWindow | null
  conditions: Conditions
}

export type HourlyPoint = {
  time: string
  localTime: string
  swellHeight: number | null
  swellPeriod: number | null
  swellDirection: number | null
  waveHeight: number | null
  windSpeed: number | null
  windDirection: number | null
  windKind: WindKind | null
  score: number
  gated: boolean
}

export type Location = {
  lat: number
  lon: number
  name: string
  country: string
  timeZone: string
  shoreNormal: number
  spotId: string | null
  driveMinutes: number | null
}

export type Sources = {
  marine: boolean
  wind: boolean
}

export type WindowResponse = {
  location: Location
  generatedAt: string
  days: Day[]
  verdict: Verdict
  score: number
  killers: Killer[]
  bestWindow: SessionWindow | null
  summary: string | null
  detail: { date: string; hourly: HourlyPoint[] }
  sources: Sources
  attribution: string
}

export type MarineSpot = {
  id: string
  name: string
  country: string
  lat: number
  lon: number
  timeZone: string
  shoreNormal: number
  driveMinutes: number
  note: string
}
