/** Pure geometry for the sky panorama: terrain, skyglow and twilight as plain numbers, so the
 * chart file only decides how they are drawn. */

export type SkyglowRose = {
  azimuths: readonly number[]
  altitudes: readonly number[]
  mpsas: readonly (readonly number[])[]
}
export type HorizonProfilePoint = {
  azimuthDeg: number
  altitudeDeg: number
  nearAltitudeDeg: number
}

/** Fixed domain per the research POC — the core never passes ~13.5° at 48°N, but a walled-in
 * site's northern skyline can reach 34°, so the plot has to hold terrain as well as sky. */
export const ALT_DOMAIN: readonly [number, number] = [-4, 52]

/** Coarse skyglow-field cell size, degrees — "a coarse interpolated grid", not a pixel-accurate
 * raster. */
const GLOW_AZ_STEP = 10
const GLOW_ALT_STEP = 4

/** Sample step for the skyline/gate series, degrees. */
const PROFILE_STEP = 2

/** 0 = daylight, 1 = astronomical night — the twilight wash and the skyglow field both fade by
 * this. Ramps over sun altitude −6° → −18°, exactly the POC's convention. */
export function darkness(sunAltitudeDeg: number): number {
  return Math.max(0, Math.min(1, (-sunAltitudeDeg - 6) / 12))
}

/** Bilinear-in-altitude, nearest-column-in-azimuth interpolation over the skyglow rose. */
export function glowAt(rose: SkyglowRose, azDeg: number, altDeg: number): number {
  const { altitudes, azimuths, mpsas } = rose
  const firstAlt = altitudes[0] ?? 0
  const alt = altDeg <= firstAlt ? firstAlt : altDeg
  let i = altitudes.length - 2
  for (let k = 0; k < altitudes.length - 1; k++) {
    const lo = altitudes[k] ?? 0
    const hi = altitudes[k + 1] ?? 0
    if (alt >= lo && alt <= hi) {
      i = k
      break
    }
  }
  const j = Math.min(altitudes.length - 1, i + 1)
  const altI = altitudes[i] ?? 0
  const altJ = altitudes[j] ?? altI
  const fa = altJ === altI ? 0 : (Math.min(alt, altJ) - altI) / (altJ - altI)
  const azStep = (azimuths[1] ?? 5) - (azimuths[0] ?? 0)
  const az0 = ((azDeg % 360) + 360) % 360
  const zi = Math.floor(az0 / azStep) % azimuths.length
  const zj = (zi + 1) % azimuths.length
  const fz = (az0 % azStep) / azStep
  const rowI = mpsas[i] ?? []
  const rowJ = mpsas[j] ?? []
  const lo = (rowI[zi] ?? 0) * (1 - fz) + (rowI[zj] ?? 0) * fz
  const hi = (rowJ[zi] ?? 0) * (1 - fz) + (rowJ[zj] ?? 0) * fz
  return lo * (1 - fa) + hi * fa
}

/** Piecewise-linear interpolation across the 72-point horizon profile, wrapping at 360°. */
export function bandValue(
  points: readonly HorizonProfilePoint[],
  key: 'altitudeDeg' | 'nearAltitudeDeg',
  azDeg: number,
): number {
  const n = points.length
  if (n === 0) return 0
  const az = ((azDeg % 360) + 360) % 360
  for (let idx = 0; idx < n; idx++) {
    const a = points[idx]!
    const b = points[(idx + 1) % n]!
    const span = (b.azimuthDeg - a.azimuthDeg + 360) % 360 || 360
    const off = (az - a.azimuthDeg + 360) % 360
    if (off <= span) return a[key] + (b[key] - a[key]) * (off / span)
  }
  return points[0]?.[key] ?? 0
}

export type ProfileRow = { az: number; skyline: number; near: number; gate: number }

/** The skyline, the advisory near band and the framing gate sampled every 2° from 0° to 360°
 * inclusive — the one data array the chart's x scale and area/line series are drawn from. */
export function profileRows(
  profile: readonly HorizonProfilePoint[],
  gate: (az: number) => number,
): ProfileRow[] {
  const rows: ProfileRow[] = []
  for (let az = 0; az <= 360; az += PROFILE_STEP) {
    rows.push({
      az,
      skyline: bandValue(profile, 'altitudeDeg', az),
      near: bandValue(profile, 'nearAltitudeDeg', az),
      gate: gate(az),
    })
  }
  return rows
}

export type GlowCell = { az0: number; az1: number; alt0: number; alt1: number; mpsas: number }

/** The skyglow rose resampled onto a coarse azimuth × altitude cell grid covering the plot. */
export function glowCells(rose: SkyglowRose): GlowCell[] {
  const top = ALT_DOMAIN[1]
  const cells: GlowCell[] = []
  for (let az = 0; az < 360; az += GLOW_AZ_STEP) {
    for (let alt = 0; alt < top; alt += GLOW_ALT_STEP) {
      cells.push({
        az0: az,
        az1: az + GLOW_AZ_STEP,
        alt0: alt,
        alt1: Math.min(top, alt + GLOW_ALT_STEP),
        mpsas: glowAt(rose, az + GLOW_AZ_STEP / 2, Math.min(top, alt + GLOW_ALT_STEP / 2)),
      })
    }
  }
  return cells
}
