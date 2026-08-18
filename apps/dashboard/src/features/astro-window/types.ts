export type WindowParams = {
  site: string
  nights: number
  detailDate?: string
}

export type Verdict = 'excellent' | 'good' | 'marginal' | 'poor' | 'out'

export type Killer = { id: string; label: string; reason: string }

export type Factor = {
  id: string
  label: string
  weight: number
  value: number | null
  weighted: number | null
  detail?: string
}

export type ShootingWindow = {
  date: string
  start: string
  end: string
  localStart: string
  localEnd: string
  minutes: number
  peakTime: string
  localPeakTime: string
  peakCoreAltitude: number
  peakCoreAzimuth: number
  maxMoonAltitude: number
}

export type Moon = {
  illumination: number
  phase: number
  rise: string | null
  set: string | null
}

export type Weather = {
  cloudLow: number | null
  cloudMid: number | null
  cloudHigh: number | null
  transparency: number | null
}

export type Night = {
  date: string
  verdict: Verdict
  score: number
  coverage: number
  killers: Killer[]
  factors: Factor[]
  window: ShootingWindow | null
  darkStart: string | null
  darkEnd: string | null
  darkMinutes: number
  transit: string
  localTransit: string
  maxCoreAltitude: number
  moon: Moon
  weather: Weather
}

export type HourlyPoint = {
  time: string
  localTime: string
  coreAltitude: number
  coreAzimuth: number
  sunAltitude: number
  moonAltitude: number
  astroDark: boolean
  cloudLow: number | null
  cloudMid: number | null
  cloudHigh: number | null
}

export type Location = {
  lat: number
  lon: number
  name: string
  timeZone: string
  coreDirectionMpsas: number | null
  domePenaltyMag: number | null
  darknessSource: 'site' | 'nearest-site' | 'query' | 'unknown'
  siteId: string | null
  nearestSiteId: string
  nearestSiteKm: number
}

export type Sources = {
  dwdIcon: boolean
  globalForecast: boolean
  sevenTimer: boolean
}

export type WindowResponse = {
  location: Location
  generatedAt: string
  nights: Night[]
  verdict: Verdict
  score: number
  killers: Killer[]
  bestWindow: ShootingWindow | null
  summary: string | null
  detail: { date: string; hourly: HourlyPoint[] }
  sources: Sources
  attribution: string
}

export type Site = {
  id: string
  name: string
  lat: number
  lon: number
  timeZone: string
  driveMinutes: number
  mpsas: number
  lpi: number
  zone: string
  trend10yPercent: number
  coreDirectionMpsas: number
  domePenaltyMag: number
  southHorizonDeg: number
  siteElevationM: number
  note: string
}
