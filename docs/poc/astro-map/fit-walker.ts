/**
 * Fit a Walker's-Law style light-pollution propagation model
 *     LPI_pred(x) = C * SUM_i  P_i * max(d_i, d0)^(-alpha)
 * against the Lorenz 2025 atlas over a Bavaria-centred grid, and report how
 * well it reproduces the atlas in mag/arcsec^2.
 */
import { lpi, mpsas, distanceKm, loadCities, type City } from './lorenz-lib.ts'

const YEAR = 2025
const BOX = { latMin: 47.0, latMax: 50.5, lonMin: 9.0, lonMax: 14.0 }
const STEP = 0.1
const CITY_MARGIN_DEG = 4.0 // ~300-440 km of surrounding sources
const D0_KM = 2.0 // inner cutoff: a city is not a point at <2 km
const MAX_D_KM = 400

const cities = loadCities(500).filter(
  (c) =>
    c.lat > BOX.latMin - CITY_MARGIN_DEG &&
    c.lat < BOX.latMax + CITY_MARGIN_DEG &&
    c.lon > BOX.lonMin - CITY_MARGIN_DEG &&
    c.lon < BOX.lonMax + CITY_MARGIN_DEG,
)
console.log(
  `cities in fit domain: ${cities.length}  (pop sum ${(cities.reduce((s, c) => s + c.pop, 0) / 1e6).toFixed(1)}M)`,
)

type Sample = { lat: number; lon: number; obs: number }
const samples: Sample[] = []
for (let lat = BOX.latMin; lat <= BOX.latMax + 1e-9; lat += STEP) {
  for (let lon = BOX.lonMin; lon <= BOX.lonMax + 1e-9; lon += STEP) {
    const v = await lpi(YEAR, lat, lon)
    if (Number.isFinite(v)) samples.push({ lat, lon, obs: v })
  }
}
console.log(`atlas samples: ${samples.length}`)

function sumKernel(s: Sample, alpha: number, list: City[]): number {
  let acc = 0
  for (const c of list) {
    const d = distanceKm(s, c)
    if (d > MAX_D_KM) continue
    acc += c.pop * Math.pow(Math.max(d, D0_KM), -alpha)
  }
  return acc
}

// For each alpha: solve C in log space (median offset is robust to outliers), then
// report RMS / MAE of the residual expressed in mag/arcsec^2.
const results: { alpha: number; C: number; rmsMag: number; maeMag: number; r2log: number }[] = []
for (let alpha = 1.4; alpha <= 4.01; alpha += 0.1) {
  const raw = samples.map((s) => sumKernel(s, alpha, cities))
  const logRatios = samples
    .map((s, i) => Math.log(s.obs) - Math.log(raw[i]!))
    .filter(Number.isFinite)
  logRatios.sort((a, b) => a - b)
  const C = Math.exp(logRatios[Math.floor(logRatios.length / 2)]!)
  let se = 0,
    ae = 0,
    n = 0
  const obsLogs: number[] = [],
    predLogs: number[] = []
  for (const [i, s] of samples.entries()) {
    const pred = C * raw[i]!
    if (!(s.obs > 0) || !(pred > 0)) continue
    const dm = mpsas(pred) - mpsas(s.obs)
    se += dm * dm
    ae += Math.abs(dm)
    n++
    obsLogs.push(Math.log(s.obs))
    predLogs.push(Math.log(pred))
  }
  const mean = obsLogs.reduce((a, b) => a + b, 0) / obsLogs.length
  const ssTot = obsLogs.reduce((a, b) => a + (b - mean) ** 2, 0)
  const ssRes = obsLogs.reduce((a, b, i) => a + (b - predLogs[i]!) ** 2, 0)
  results.push({ alpha, C, rmsMag: Math.sqrt(se / n), maeMag: ae / n, r2log: 1 - ssRes / ssTot })
}

results.sort((a, b) => a.rmsMag - b.rmsMag)
console.log('\nalpha\tC\t\tRMS(mag)\tMAE(mag)\tR2(log LPI)')
for (const r of results.slice(0, 8))
  console.log(
    `${r.alpha.toFixed(1)}\t${r.C.toExponential(3)}\t${r.rmsMag.toFixed(3)}\t\t${r.maeMag.toFixed(3)}\t\t${r.r2log.toFixed(3)}`,
  )
console.log('\n(worst)')
for (const r of results.slice(-3))
  console.log(
    `${r.alpha.toFixed(1)}\t${r.C.toExponential(3)}\t${r.rmsMag.toFixed(3)}\t\t${r.maeMag.toFixed(3)}\t\t${r.r2log.toFixed(3)}`,
  )
