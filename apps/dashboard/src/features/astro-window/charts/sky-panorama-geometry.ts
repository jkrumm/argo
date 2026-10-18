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

/** The widest the altitude axis ever gets (a walled-in site's northern skyline can reach 34°); the
 * floor is fixed at −4°, the top is fitted to the data by `fitAltDomain`. */
export const ALT_DOMAIN: readonly [number, number] = [-4, 52]

/** Never fitted tighter than this, so the 8° atmospheric floor and the gate line always sit inside the plot. */
const MIN_ALT_TOP = 16

/** The altitude axis fitted to what is drawn: the highest of the given altitudes (skyline, gate,
 * tracks) plus a little headroom, rounded up to a 4° step, inside `ALT_DOMAIN` and never under `MIN_ALT_TOP`. */
export function fitAltDomain(altitudes: readonly number[]): [number, number] {
  const peak = Math.max(0, ...altitudes)
  const top = Math.ceil((peak + 2) / 4) * 4
  return [ALT_DOMAIN[0], Math.min(ALT_DOMAIN[1], Math.max(MIN_ALT_TOP, top))]
}

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

/** The framing gate at an azimuth: the flat atmospheric floor, or the skyline plus the framing
 * margin where the terrain is higher. */
export function gateAt(
  profile: readonly HorizonProfilePoint[],
  atmosphericFloorDeg: number,
  framingMarginDeg: number,
  azDeg: number,
): number {
  return Math.max(atmosphericFloorDeg, bandValue(profile, 'altitudeDeg', azDeg) + framingMarginDeg)
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
export function glowCells(rose: SkyglowRose, top: number = ALT_DOMAIN[1]): GlowCell[] {
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

/** Brightness resolution of the skyglow field, mag/arcsec². Finer than the eye separates two
 * ramp colours, coarse enough that the field is a few dozen fills instead of one per cell. */
export const GLOW_BUCKET_MPSAS = 0.1

/** Cells grouped by brightness bucket (the quantised mpsas), so a mark per bucket draws the whole
 * field. Each entry's `mpsas` is the bucket's value; its cells keep their own geometry. */
export function glowBuckets(cells: readonly GlowCell[]): { mpsas: number; cells: GlowCell[] }[] {
  const buckets = new Map<number, GlowCell[]>()
  for (const cell of cells) {
    const key = Math.round(cell.mpsas / GLOW_BUCKET_MPSAS)
    buckets.set(key, [...(buckets.get(key) ?? []), cell])
  }
  return [...buckets].map(([key, group]) => ({ mpsas: key * GLOW_BUCKET_MPSAS, cells: group }))
}
