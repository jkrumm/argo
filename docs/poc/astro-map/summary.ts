/**
 * Consolidated site table — every measured quantity this session produced,
 * in one reproducible run. Sources: Lorenz atlas 2025 binary tiles, AWS
 * terrarium DEM (via horizon.json), Open-Meteo CAMS AOD, Argo's ephemeris.
 */
import { readFileSync } from 'node:fs'
import { lpi, mpsas } from './lorenz-lib.ts'
import { galacticCorePosition } from '../../../apps/api/src/lib/astro-ephemeris.ts'

const H = JSON.parse(readFileSync(`${import.meta.dir}/.cache/horizon.json`, 'utf8'))
const H_SCAT = 5,
  DR = 2,
  R_MAX = 120
const W = (r: number, alt: number) =>
  Math.exp(-(r * Math.tan((alt * Math.PI) / 180)) / H_SCAT) / (1 + (r / 10) ** 1.5)
const airmass = (a: number) =>
  1 / (Math.sin((a * Math.PI) / 180) + 0.50572 * Math.pow(a + 6.07995, -1.6364))
const vanRhijn = (a: number, h = 90) => {
  const R = 6371,
    z = ((90 - a) * Math.PI) / 180
  return 1 / Math.sqrt(1 - ((R / (R + h)) * Math.sin(z)) ** 2)
}

const SITES = [
  { key: 'Munich', name: 'Munich', lat: 48.1374, lon: 11.5755, drive: 0, bortle: 8 },
  {
    key: 'Alpenvorland (Bad Tolz)',
    name: 'Alpenvorland',
    lat: 47.8167,
    lon: 11.4667,
    drive: 45,
    bortle: 4,
  },
  {
    key: 'Bayerischer Wald',
    name: 'Bayer. Wald',
    lat: 48.9333,
    lon: 13.4167,
    drive: 150,
    bortle: 3,
  },
  { key: 'Walchensee', name: 'Walchensee', lat: 47.6, lon: 11.33, drive: 70, bortle: 4 },
]

async function ray(s: { lat: number; lon: number }, az: number, alt: number) {
  const kmLat = 111.32,
    kmLon = 111.32 * Math.cos((s.lat * Math.PI) / 180),
    rad = (az * Math.PI) / 180
  let acc = 0
  for (let r = 0; r <= R_MAX; r += DR) {
    const v = await lpi(
      2025,
      s.lat + (r * Math.cos(rad)) / kmLat,
      s.lon + (r * Math.sin(rad)) / kmLon,
    )
    if (Number.isFinite(v)) acc += v * W(r, alt)
  }
  return acc
}

const rows: any[] = []
for (const s of SITES) {
  const [a16, a25] = [await lpi(2016, s.lat, s.lon), await lpi(2025, s.lat, s.lon)]
  const k = a25 / (await ray(s, 0, 90))
  let peak = { alt: -90, az: 180 }
  for (let h = -6; h <= 6; h += 0.25) {
    const p = galacticCorePosition(
      { lat: s.lat, lon: s.lon },
      new Date(new Date('2026-07-15T22:00:00Z').getTime() + h * 3600_000),
    )
    if (p.altitude > peak.alt) peak = { alt: p.altitude, az: p.azimuth }
  }
  const artCore = k * (await ray(s, peak.az, peak.alt))
  const j: any = await (
    await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${s.lat}&longitude=${s.lon}&hourly=aerosol_optical_depth&forecast_days=2&timezone=UTC`,
    )
  ).json()
  const aodVals = (j.hourly.aerosol_optical_depth as (number | null)[]).filter(
    (v): v is number => v != null,
  )
  const aod = aodVals.reduce((x, y) => x + y, 0) / aodVals.length
  const prof = H[s.key].prof as Record<string, [number, number, number]>
  const south: number[] = []
  for (let az = 150; az <= 215; az += 5) south.push(prof[String(az)][0])

  const kTot = 0.16 + 1.086 * aod
  const X = airmass(peak.alt)
  const skyLin = (vanRhijn(peak.alt) + artCore) * Math.pow(10, -0.4 * kTot * X * 0.5)
  rows.push({
    name: s.name,
    drive: s.drive,
    bortle: s.bortle,
    zenith: mpsas(a25),
    trend: ((a25 - a16) / a16) * 100,
    coreAlt: peak.alt,
    coreAz: peak.az,
    coreMag: mpsas(artCore + vanRhijn(peak.alt) - 1),
    penalty: mpsas(a25) - mpsas(artCore),
    southHorizon: Math.max(...south),
    southMean: south.reduce((x, y) => x + y) / south.length,
    aod,
    contrast: 22.0 - 2.5 * Math.log10(skyLin) - (21.0 + kTot * X),
  })
}

const f = (n: number, d = 2) => n.toFixed(d)
console.log(
  'site          drive  static  zenith   LP-trend  core   core-dir  dome     S-horizon  AOD    core',
)
console.log(
  '                     Bortle  mag      16→25     alt/az mag       penalty  max/mean   now    contrast',
)
console.log('-'.repeat(108))
for (const r of rows)
  console.log(
    `${r.name.padEnd(13)} ${String(r.drive).padStart(4)}m  ${String(r.bortle).padStart(5)}  ${f(r.zenith)}    ${(r.trend >= 0 ? '+' : '') + f(r.trend, 0)}%     ${f(r.coreAlt, 1)}/${f(r.coreAz, 0)}  ${f(r.coreMag)}     ${f(r.penalty)}     ${f(r.southHorizon, 1)}/${f(r.southMean, 1)}°   ${f(r.aod, 3)}  ${f(r.contrast)}`,
  )

console.log(
  '\nranking by static Bortle (today) : ' +
    [...rows]
      .sort((a, b) => a.bortle - b.bortle)
      .map((r) => r.name)
      .join(' > '),
)
console.log(
  'ranking by zenith darkness       : ' +
    [...rows]
      .sort((a, b) => b.zenith - a.zenith)
      .map((r) => r.name)
      .join(' > '),
)
console.log(
  'ranking by CORE-direction sky    : ' +
    [...rows]
      .sort((a, b) => b.contrast - a.contrast)
      .map((r) => r.name)
      .join(' > '),
)
console.log(
  'ranking by core-contrast / hour  : ' +
    [...rows]
      .sort((a, b) => b.contrast - b.drive / 300 - (a.contrast - a.drive / 300))
      .map((r) => r.name)
      .join(' > '),
)
