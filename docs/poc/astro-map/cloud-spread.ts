/**
 * How much do the free NWP models actually disagree about the thing the astro
 * score gates on? Quantifies inter-model spread in low/mid/high cloud over the
 * night hours, per site and per forecast lead time.
 */
const MODELS = [
  'icon_d2',
  'icon_eu',
  'icon_global',
  'ecmwf_ifs025',
  'gfs_seamless',
  'meteofrance_arome_france_hd',
  'knmi_harmonie_arome_europe',
  'ukmo_seamless',
] as const
const SITES = [
  { name: 'Walchensee', lat: 47.6, lon: 11.33 },
  { name: 'Bayer. Wald', lat: 48.9333, lon: 13.4167 },
  { name: 'Hossegor', lat: 43.664, lon: -1.438 },
  { name: 'Peniche', lat: 39.352, lon: -9.363 },
]
const LAYERS = ['low', 'mid', 'high'] as const

const median = (a: number[]) => {
  const b = [...a].sort((x, y) => x - y)
  const m = b.length >> 1
  return b.length % 2 ? b[m]! : (b[m - 1]! + b[m]!) / 2
}
const quant = (a: number[], q: number) => {
  const b = [...a].sort((x, y) => x - y)
  return b[Math.min(b.length - 1, Math.floor(q * b.length))]!
}

for (const s of SITES) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&hourly=${LAYERS.map((l) => `cloud_cover_${l}`).join(',')}&forecast_days=7&timezone=UTC&models=${MODELS.join(',')}`
  const j: any = await (await fetch(url)).json()
  const h = j.hourly
  const t: string[] = h.time
  const day0 = new Date(t[0]!.slice(0, 10) + 'T00:00:00Z').getTime()

  console.log(`\n=== ${s.name} ===`)
  console.log(
    'lead   layer  nModels  medianSpread  p90Spread  %hours spread>50  %hours all agree<20',
  )
  for (const leadDay of [0, 1, 2, 3, 4, 5]) {
    for (const layer of LAYERS) {
      const spreads: number[] = []
      let nModelsSeen = 0
      for (const [i, ts] of t.entries()) {
        const hh = Number(ts.slice(11, 13))
        if (!(hh >= 21 || hh <= 3)) continue
        const dayIdx = Math.floor((new Date(ts + 'Z').getTime() - day0) / 86400000)
        if (dayIdx !== leadDay) continue
        const vals = MODELS.map((m) => h[`cloud_cover_${layer}_${m}`]?.[i]).filter(
          (v: any): v is number => typeof v === 'number',
        )
        if (vals.length < 3) continue
        nModelsSeen = Math.max(nModelsSeen, vals.length)
        spreads.push(Math.max(...vals) - Math.min(...vals))
      }
      if (!spreads.length) continue
      const big = spreads.filter((v) => v > 50).length / spreads.length
      const tight = spreads.filter((v) => v < 20).length / spreads.length
      console.log(
        `+${leadDay}d    ${layer.padEnd(5)}  ${String(nModelsSeen).padStart(4)}     ${median(spreads).toFixed(0).padStart(6)}       ${quant(spreads, 0.9).toFixed(0).padStart(5)}      ${(big * 100).toFixed(0).padStart(6)}%            ${(tight * 100).toFixed(0).padStart(5)}%`,
      )
    }
  }
}
