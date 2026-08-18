/** Iteration 5 — is the core-direction result an artefact of the kernel's free parameters? */
import { lpi, mpsas } from './lorenz-lib.ts'

const YEAR = 2025,
  DR = 2
const SITES = [
  { name: 'Munich', lat: 48.1374, lon: 11.5755 },
  { name: 'Bad Tölz', lat: 47.8167, lon: 11.4667 },
  { name: 'Bayer. Wald', lat: 48.9333, lon: 13.4167 },
  { name: 'Walchensee', lat: 47.6, lon: 11.33 },
]

async function penalty(
  site: { lat: number; lon: number },
  H: number,
  expo: number,
  rMax: number,
  r0: number,
) {
  const W = (r: number, alt: number) =>
    Math.exp(-(r * Math.tan((alt * Math.PI) / 180)) / H) / (1 + (r / r0) ** expo)
  const kmLat = 111.32,
    kmLon = 111.32 * Math.cos((site.lat * Math.PI) / 180)
  const ray = async (az: number, alt: number) => {
    const rad = (az * Math.PI) / 180
    let acc = 0
    for (let r = 0; r <= rMax; r += DR) {
      const v = await lpi(
        YEAR,
        site.lat + (r * Math.cos(rad)) / kmLat,
        site.lon + (r * Math.sin(rad)) / kmLon,
      )
      if (Number.isFinite(v)) acc += v * W(r, alt)
    }
    return acc
  }
  const atlas = await lpi(YEAR, site.lat, site.lon)
  const k = atlas / (await ray(0, 90))
  // mean over the core arc: az 155-207, alt 8-13
  let sum = 0,
    n = 0
  for (let az = 155; az <= 207; az += 6.5) {
    sum += k * (await ray(az, 10.5))
    n++
  }
  const core = sum / n
  return { atlas, core, penalty: mpsas(atlas) - mpsas(core) }
}

const VARIANTS = [
  { label: 'baseline  H=5  e=1.5 R=120 r0=10', H: 5, e: 1.5, R: 120, r0: 10 },
  { label: 'H=2 (aerosol-dominated)         ', H: 2, e: 1.5, R: 120, r0: 10 },
  { label: 'H=8 (Rayleigh scale height)     ', H: 8, e: 1.5, R: 120, r0: 10 },
  { label: 'e=1.0 (flatter falloff)         ', H: 5, e: 1.0, R: 120, r0: 10 },
  { label: 'e=2.5 (Walker-like falloff)     ', H: 5, e: 2.5, R: 120, r0: 10 },
  { label: 'R=60 km horizon                 ', H: 5, e: 1.5, R: 60, r0: 10 },
  { label: 'R=200 km horizon                ', H: 5, e: 1.5, R: 200, r0: 10 },
  { label: 'r0=5 km (tighter core)          ', H: 5, e: 1.5, R: 120, r0: 5 },
  { label: 'r0=20 km (broader core)         ', H: 5, e: 1.5, R: 120, r0: 20 },
]

console.log('variant'.padEnd(34) + SITES.map((s) => s.name.padStart(14)).join(''))
const ranks: string[] = []
for (const v of VARIANTS) {
  const row: string[] = []
  const cores: number[] = []
  for (const s of SITES) {
    const r = await penalty(s, v.H, v.e, v.R, v.r0)
    cores.push(r.core)
    row.push(`${mpsas(r.core).toFixed(2)}/${r.penalty.toFixed(2)}`.padStart(14))
  }
  console.log(v.label.padEnd(34) + row.join(''))
  const order = SITES.map((s, i) => [s.name, cores[i]!] as const)
    .sort((a, b) => a[1] - b[1])
    .map(([n]) => n)
  ranks.push(`${v.label.trim()} -> ${order.join(' > ')}`)
}
console.log('\n(cell = core-direction mag/arcsec² / penalty vs zenith in mag)')
console.log('\nranking (darkest core direction first):')
ranks.forEach((r) => console.log('  ' + r))
