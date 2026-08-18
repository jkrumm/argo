/**
 * Directional light-dome POC.
 *
 * The Lorenz atlas gives ZENITH brightness only. For a 12 mm Milky-Way frame the
 * core sits at 8-14 deg altitude in the S/SSW — exactly where the light domes live —
 * so zenith is the wrong number. This builds a per-site az/alt glow map from the
 * calibrated population kernel, and cross-checks its dominant azimuth against the
 * gradient of the (independent) Lorenz field.
 */
import { lpi, mpsas, distanceKm, bearingDeg, loadCities, mod } from './lorenz-lib.ts'

const YEAR = 2025
const ALPHA = 2.1 // fitted, see fit-walker/fit-v2
const C_FIT = 3.198e-4 // fitted normalisation, LPI units per pop*km^-alpha
const H_SCAT_KM = 5.0 // effective scattering-layer height for dome elevation
const SIGMA_ALT_DEG = 12 // vertical spread of a dome
const MAX_D = 400
const D0 = 2

const SITES = [
  { id: 'munich', name: 'Munich', lat: 48.1374, lon: 11.5755 },
  { id: 'alpenvorland', name: 'Alpenvorland (Bad Tölz)', lat: 47.8167, lon: 11.4667 },
  { id: 'bayerischer-wald', name: 'Bayerischer Wald', lat: 48.9333, lon: 13.4167 },
  { id: 'walchensee', name: 'Walchensee', lat: 47.6, lon: 11.33 },
]

const cities = loadCities(500)
const deg = (r: number) => (r * 180) / Math.PI

type Contribution = {
  name: string
  d: number
  az: number
  domeAlt: number
  w: number
  sigmaAz: number
}

function contributions(site: { lat: number; lon: number }): Contribution[] {
  const out: Contribution[] = []
  for (const c of cities) {
    if (Math.abs(c.lat - site.lat) > 4.5 || Math.abs(c.lon - site.lon) > 6.5) continue
    const d = distanceKm(site, c)
    if (d > MAX_D) continue
    const dd = Math.max(d, D0)
    // effective urban radius from population, assuming ~1500 people/km^2 built-up density
    const rCity = Math.sqrt(c.pop / 1500 / Math.PI)
    out.push({
      name: c.name,
      d,
      az: bearingDeg(site, c),
      domeAlt: deg(Math.atan2(H_SCAT_KM, dd)),
      w: C_FIT * c.pop * Math.pow(dd, -ALPHA),
      sigmaAz: Math.max(6, deg(Math.atan2(rCity, dd))),
    })
  }
  return out
}

/** Glow weight seen toward (az, alt), normalised so the az/alt integral equals the total. */
function glowAt(cons: Contribution[], az: number, alt: number): number {
  let acc = 0
  for (const c of cons) {
    const dAz = Math.abs(mod(az - c.az + 180, 360) - 180)
    const dAlt = alt - c.domeAlt
    acc +=
      c.w * Math.exp(-0.5 * (dAz / c.sigmaAz) ** 2) * Math.exp(-0.5 * (dAlt / SIGMA_ALT_DEG) ** 2)
  }
  return acc
}

/** Independent check: azimuth of steepest increase of the Lorenz LPI field at the site. */
async function atlasGradientAzimuth(site: { lat: number; lon: number }, radiusKm: number) {
  const best = { az: 0, val: -Infinity }
  const kmPerDegLat = 111.32
  const kmPerDegLon = 111.32 * Math.cos((site.lat * Math.PI) / 180)
  for (let az = 0; az < 360; az += 5) {
    const r = (az * Math.PI) / 180
    const lat = site.lat + (radiusKm * Math.cos(r)) / kmPerDegLat
    const lon = site.lon + (radiusKm * Math.sin(r)) / kmPerDegLon
    const v = await lpi(YEAR, lat, lon)
    if (Number.isFinite(v) && v > best.val) {
      best.val = v
      best.az = az
    }
  }
  return best
}

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
]
const compass = (az: number) => COMPASS[Math.round(mod(az, 360) / 22.5) % 16]!

for (const s of SITES) {
  const cons = contributions(s)
  const atlas = await lpi(YEAR, s.lat, s.lon)
  const modelZenith = cons.reduce((a, c) => a + c.w, 0)

  console.log(`\n=== ${s.name} ===`)
  console.log(
    `atlas LPI ${atlas.toFixed(3)} (${mpsas(atlas).toFixed(2)} mag)   model LPI ${modelZenith.toFixed(3)} (${mpsas(modelZenith).toFixed(2)} mag)   err ${(mpsas(modelZenith) - mpsas(atlas)).toFixed(2)} mag`,
  )

  const top = [...cons].sort((a, b) => b.w - a.w).slice(0, 6)
  console.log('top polluters:')
  for (const c of top)
    console.log(
      `   ${c.name.padEnd(22)} ${c.d.toFixed(0).padStart(4)} km  az ${c.az.toFixed(0).padStart(3)}° (${compass(c.az).padEnd(3)})  dome top ~${c.domeAlt.toFixed(1)}°  share ${((c.w / modelZenith) * 100).toFixed(1)}%`,
    )

  // glow along the horizon-ish band the Milky Way core actually occupies
  const bins: { az: number; g10: number }[] = []
  for (let az = 0; az < 360; az += 15) bins.push({ az, g10: glowAt(cons, az, 10) })
  const gMax = Math.max(...bins.map((b) => b.g10))
  const worst = bins.reduce((a, b) => (b.g10 > a.g10 ? b : a))
  const south = bins.filter((b) => b.az >= 135 && b.az <= 225)
  const southAvg = south.reduce((a, b) => a + b.g10, 0) / south.length
  const grad = await atlasGradientAzimuth(s, 25)

  console.log(
    `glow @10° alt:  worst ${worst.az}° (${compass(worst.az)})   S-quadrant mean/worst = ${(southAvg / gMax).toFixed(2)}`,
  )
  console.log(
    `atlas-gradient check @25 km: brightest neighbour az ${grad.az}° (${compass(grad.az)}) LPI ${grad.val.toFixed(2)}  ->  ${Math.abs(mod(grad.az - worst.az + 180, 360) - 180).toFixed(0)}° apart`,
  )
  console.log('horizon glow profile (10° alt, relative):')
  console.log('   ' + bins.map((b) => `${compass(b.az)}:${(b.g10 / gMax).toFixed(2)}`).join(' '))
}
