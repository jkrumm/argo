export type WindowParams = {
  site: string
  nights: number
  detailDate?: string
}

export type Verdict = 'excellent' | 'good' | 'marginal' | 'poor' | 'out'

export type Killer = {
  id: string
  label: string
  reason: string
  /** Why the `core-altitude` gate failed (`ridge`, `floor`, `never-rises`); absent on other gates. A value this client does not know is shown by its `reason`. */
  cause?: string | undefined
}

export type Factor = {
  id: string
  label: string
  weight: number
  value: number | null
  weighted: number | null
  detail?: string | undefined
  /** Cloud factors with data only: the cover is at or past the API's ruin level for the layer. A factor, never a gate. */
  ruinous?: boolean | undefined
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
  /** Tightest gap between the core and the ridge inside this window, degrees. Null without a skyline. */
  minCoreClearance: number | null
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
  /** Core altitude at the dark sample closest to clearing the core gate; the gate passes when it is above `coreGateDeg`. Null without a dark stretch. */
  gateCoreAltitude: number | null
  /** The floor at that same sample, degrees: 8° flat, raised by a resolved ridge plus margin. Null without a dark stretch. */
  coreGateDeg: number | null
  /** ISO instant (UTC) of the sample behind `gateCoreAltitude`/`coreGateDeg`. Null without a dark stretch. */
  gateSampleTime: string | null
  moon: Moon
  weather: Weather
}

export type HourlyPoint = {
  time: string
  localTime: string
  coreAltitude: number
  coreAzimuth: number
  sunAltitude: number
  /** Degrees from north through east. */
  sunAzimuth: number
  moonAltitude: number
  /** Degrees from north through east. */
  moonAzimuth: number
  astroDark: boolean
  coreClearance: number | null
  moonBehindTerrain: boolean
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
  /** The night the top-level fields describe; set even when every night is out. */
  bestDate: string | null
  /** Moon-gate limit, 0–1. */
  moonMaxIllumination: number
  /** Cover (percent) at which each cloud layer is ruinous; a scored limit, never a gate. */
  cloudRuinsAt: { low: number; mid: number; high: number }
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
