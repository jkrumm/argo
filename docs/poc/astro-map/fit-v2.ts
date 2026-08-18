/**
 * Iteration 2 of the propagation fit.
 *   LPI_pred(x) = C * SUM_i  P_i^beta * max(d_i,d0)^(-alpha) * exp(-d_i / H)
 * Grid-searched with 5-fold *spatial block* cross-validation so a flexible
 * kernel cannot win by memorising the grid.
 */
import { lpi, mpsas, distanceKm, loadCities } from './lorenz-lib.ts'

const YEAR = 2025
const BOX = { latMin: 47.0, latMax: 50.5, lonMin: 9.0, lonMax: 14.0 }
const STEP = 0.1
const MARGIN = 4.0
const D0 = 2.0
const MAX_D = 400

const cities = loadCities(500).filter(
  (c) =>
    c.lat > BOX.latMin - MARGIN &&
    c.lat < BOX.latMax + MARGIN &&
    c.lon > BOX.lonMin - MARGIN &&
    c.lon < BOX.lonMax + MARGIN,
)

type S = { lat: number; lon: number; obs: number; d: Float32Array; p: Float32Array; block: number }
const samples: S[] = []
let li = 0
for (let lat = BOX.latMin; lat <= BOX.latMax + 1e-9; lat += STEP) {
  for (let lon = BOX.lonMin; lon <= BOX.lonMax + 1e-9; lon += STEP) {
    const obs = await lpi(YEAR, lat, lon)
    if (!(obs > 0)) continue
    const ds: number[] = [],
      ps: number[] = []
    for (const c of cities) {
      const d = distanceKm({ lat, lon }, c)
      if (d > MAX_D) continue
      ds.push(Math.max(d, D0))
      ps.push(c.pop)
    }
    // 5 spatial blocks: 1-degree lon stripes, so a fold never sits next to its own training cells
    samples.push({
      lat,
      lon,
      obs,
      d: Float32Array.from(ds),
      p: Float32Array.from(ps),
      block: Math.min(4, Math.floor(lon - BOX.lonMin)),
    })
    li++
  }
}
console.log(
  `samples=${samples.length} cities=${cities.length} avg neighbours=${(samples.reduce((s, x) => s + x.d.length, 0) / samples.length).toFixed(0)}`,
)

const kernel = (s: S, alpha: number, beta: number, H: number) => {
  let acc = 0
  const invH = H === Infinity ? 0 : 1 / H
  for (let i = 0; i < s.d.length; i++) {
    const d = s.d[i]!
    acc += Math.pow(s.p[i]!, beta) * Math.pow(d, -alpha) * (invH ? Math.exp(-d * invH) : 1)
  }
  return acc
}

const median = (a: number[]) => {
  const b = [...a].sort((x, y) => x - y)
  return b[Math.floor(b.length / 2)]!
}

type Res = {
  alpha: number
  beta: number
  H: number
  C: number
  cvRms: number
  inRms: number
  r2: number
}
const out: Res[] = []
const ALPHAS = Array.from({ length: 17 }, (_, i) => 1.4 + i * 0.1)
const BETAS = [0.7, 0.8, 0.9, 1.0, 1.1]
const HS = [50, 75, 100, 150, 250, Infinity]

for (const beta of BETAS)
  for (const H of HS)
    for (const alpha of ALPHAS) {
      const raw = samples.map((s) => kernel(s, alpha, beta, H))
      // in-sample C
      const Call = Math.exp(
        median(samples.map((s, i) => Math.log(s.obs) - Math.log(raw[i]!)).filter(Number.isFinite)),
      )
      let se = 0,
        n = 0
      for (const [i, s] of samples.entries()) {
        const dm = mpsas(Call * raw[i]!) - mpsas(s.obs)
        se += dm * dm
        n++
      }
      const inRms = Math.sqrt(se / n)
      // spatial-block CV: C fitted on 4 blocks, scored on the held-out one
      let cvSe = 0,
        cvN = 0
      for (let b = 0; b < 5; b++) {
        const tr = samples
          .map((s, i) => (s.block === b ? null : Math.log(s.obs) - Math.log(raw[i]!)))
          .filter((v): v is number => v !== null && Number.isFinite(v))
        if (!tr.length) continue
        const C = Math.exp(median(tr))
        for (const [i, s] of samples.entries()) {
          if (s.block !== b) continue
          const dm = mpsas(C * raw[i]!) - mpsas(s.obs)
          cvSe += dm * dm
          cvN++
        }
      }
      const obsL = samples.map((s) => Math.log(s.obs))
      const prdL = samples.map((_, i) => Math.log(Call * raw[i]!))
      const mu = obsL.reduce((a, b) => a + b, 0) / obsL.length
      const r2 =
        1 -
        obsL.reduce((a, b, i) => a + (b - prdL[i]!) ** 2, 0) /
          obsL.reduce((a, b) => a + (b - mu) ** 2, 0)
      out.push({ alpha, beta, H, C: Call, cvRms: Math.sqrt(cvSe / cvN), inRms, r2 })
    }

out.sort((a, b) => a.cvRms - b.cvRms)
console.log('\nalpha\tbeta\tH(km)\tC\t\tCV-RMS(mag)\tin-RMS\tR2(logLPI)')
for (const r of out.slice(0, 12))
  console.log(
    `${r.alpha.toFixed(1)}\t${r.beta}\t${r.H === Infinity ? 'inf' : r.H}\t${r.C.toExponential(3)}\t${r.cvRms.toFixed(3)}\t\t${r.inRms.toFixed(3)}\t${r.r2.toFixed(3)}`,
  )
