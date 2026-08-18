/**
 * Iteration 3 — two independent directional estimators, compared.
 *
 *  A) POPULATION KERNEL: GeoNames pop * softened distance^-alpha, Gaussian-spread
 *     in azimuth/altitude. Softening now uses sqrt(d^2 + r_city^2) instead of a
 *     hard 2 km floor, which is what broke the in-city (Munich) case in v1.
 *
 *  B) ATLAS RAY-MARCH: march the Lorenz LPI field outward along each azimuth and
 *     weight the ground brightness by how much of it scatters into a 10 deg line
 *     of sight. Uses NO population data at all — only the atlas we already fetch.
 *
 * If A and B pick the same dominant azimuth, the direction is trustworthy.
 */
import { lpi, mpsas, distanceKm, bearingDeg, loadCities, mod } from './lorenz-lib.ts'

const YEAR = 2025
const ALPHA = 2.1
const C_FIT = 3.198e-4
const H_SCAT_KM = 5.0
const SIGMA_ALT_DEG = 12
const MAX_D = 400

const SITES = [
  { id: 'munich', name: 'Munich', lat: 48.1374, lon: 11.5755 },
  { id: 'alpenvorland', name: 'Alpenvorland (Bad Tölz)', lat: 47.8167, lon: 11.4667 },
  { id: 'bayerischer-wald', name: 'Bayerischer Wald', lat: 48.9333, lon: 13.4167 },
  { id: 'walchensee', name: 'Walchensee', lat: 47.6, lon: 11.33 },
]
const cities = loadCities(500)
const deg = (r: number) => (r * 180) / Math.PI
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
const cityRadiusKm = (pop: number) => Math.sqrt(pop / 1500 / Math.PI)

// ── A: population kernel ────────────────────────────────────────────────
type Con = {
  name: string
  d: number
  dSoft: number
  az: number
  domeAlt: number
  w: number
  sigmaAz: number
}
function contributions(site: { lat: number; lon: number }): Con[] {
  const out: Con[] = []
  for (const c of cities) {
    if (Math.abs(c.lat - site.lat) > 4.5 || Math.abs(c.lon - site.lon) > 6.5) continue
    const d = distanceKm(site, c)
    if (d > MAX_D) continue
    const r = cityRadiusKm(c.pop)
    const dSoft = Math.sqrt(d * d + r * r) // Plummer softening: no point-source blow-up
    out.push({
      name: c.name,
      d,
      dSoft,
      az: bearingDeg(site, c),
      domeAlt: deg(Math.atan2(H_SCAT_KM, dSoft)),
      w: C_FIT * c.pop * Math.pow(dSoft, -ALPHA),
      sigmaAz: Math.max(6, deg(Math.atan2(r, Math.max(d, r)))),
    })
  }
  return out
}
const glowA = (cons: Con[], az: number, alt: number) =>
  cons.reduce((acc, c) => {
    const dAz = Math.abs(mod(az - c.az + 180, 360) - 180)
    return (
      acc +
      c.w *
        Math.exp(-0.5 * (dAz / c.sigmaAz) ** 2) *
        Math.exp(-0.5 * ((alt - c.domeAlt) / SIGMA_ALT_DEG) ** 2)
    )
  }, 0)

// ── B: atlas ray-march ──────────────────────────────────────────────────
/**
 * Ground at distance r contributes to a line of sight at elevation `alt` roughly in
 * proportion to how much scattering volume the ray shares with the air above it.
 * Weight peaks where the ray height equals the scattering scale height and falls off
 * with the usual inverse-square-ish law beyond it.
 */
function rayWeight(r: number, altDeg: number): number {
  const h = r * Math.tan((altDeg * Math.PI) / 180) // ray height over ground at range r
  return Math.exp(-h / H_SCAT_KM) / (1 + (r / 10) ** 1.5)
}
async function glowB(site: { lat: number; lon: number }, az: number, alt: number) {
  const kmLat = 111.32,
    kmLon = 111.32 * Math.cos((site.lat * Math.PI) / 180)
  const rad = (az * Math.PI) / 180
  let acc = 0
  for (let r = 2; r <= 120; r += 2) {
    const lat = site.lat + (r * Math.cos(rad)) / kmLat
    const lon = site.lon + (r * Math.sin(rad)) / kmLon
    const v = await lpi(YEAR, lat, lon)
    if (Number.isFinite(v)) acc += v * rayWeight(r, alt) * 2
  }
  return acc
}

const AZ_STEP = 10
for (const s of SITES) {
  const cons = contributions(s)
  const atlas = await lpi(YEAR, s.lat, s.lon)
  const modelZ = cons.reduce((a, c) => a + c.w, 0)
  console.log(`\n=== ${s.name} ===`)
  console.log(
    `zenith: atlas ${mpsas(atlas).toFixed(2)} mag (LPI ${atlas.toFixed(2)})  |  kernel ${mpsas(modelZ).toFixed(2)} mag (LPI ${modelZ.toFixed(2)})  |  err ${(mpsas(modelZ) - mpsas(atlas)).toFixed(2)} mag`,
  )
  for (const c of [...cons].sort((a, b) => b.w - a.w).slice(0, 5))
    console.log(
      `   ${c.name.padEnd(22)} ${c.d.toFixed(0).padStart(4)} km  ${compass(c.az).padEnd(3)} (${c.az.toFixed(0)}°)  dome≲${c.domeAlt.toFixed(0)}°  ${((c.w / modelZ) * 100).toFixed(1)}%`,
    )

  const A: number[] = [],
    B: number[] = [],
    AZ: number[] = []
  for (let az = 0; az < 360; az += AZ_STEP) {
    AZ.push(az)
    A.push(glowA(cons, az, 10))
    B.push(await glowB(s, az, 10))
  }
  const nA = Math.max(...A),
    nB = Math.max(...B)
  const argmax = (a: number[]) => AZ[a.indexOf(Math.max(...a))]!
  const azA = argmax(A),
    azB = argmax(B)
  // circular correlation of the two normalised profiles
  const an = A.map((v) => v / nA),
    bn = B.map((v) => v / nB)
  const mA = an.reduce((x, y) => x + y) / an.length,
    mB = bn.reduce((x, y) => x + y) / bn.length
  const cov = an.reduce((acc, v, i) => acc + (v - mA) * (bn[i]! - mB), 0)
  const sd = Math.sqrt(
    an.reduce((a, v) => a + (v - mA) ** 2, 0) * bn.reduce((a, v) => a + (v - mB) ** 2, 0),
  )
  console.log(
    `dominant dome @10°:  kernel ${azA}° (${compass(azA)})   atlas-raymarch ${azB}° (${compass(azB)})   Δ=${Math.abs(mod(azA - azB + 180, 360) - 180)}°   profile r=${(cov / sd).toFixed(2)}`,
  )
  const sector = (lo: number, hi: number, arr: number[], n: number) => {
    const idx = AZ.map((a, i) => [a, i] as const)
      .filter(([a]) => a >= lo && a <= hi)
      .map(([, i]) => i)
    return idx.reduce((acc, i) => acc + arr[i]!, 0) / idx.length / n
  }
  console.log(
    `  S-quadrant (135-225°) relative load — kernel ${sector(135, 225, A, nA).toFixed(2)}  raymarch ${sector(135, 225, B, nB).toFixed(2)}`,
  )
  console.log(
    '  kernel  : ' +
      AZ.filter((_, i) => i % 3 === 0)
        .map((a, j) => `${compass(a)} ${an[j * 3]!.toFixed(2)}`)
        .join('  '),
  )
  console.log(
    '  raymarch: ' +
      AZ.filter((_, i) => i % 3 === 0)
        .map((a, j) => `${compass(a)} ${bn[j * 3]!.toFixed(2)}`)
        .join('  '),
  )
}
