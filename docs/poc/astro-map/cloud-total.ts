/** Is the disagreement real forecast uncertainty, or an artefact of how each model defines "low cloud"? */
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
]
const VARS = ['cloud_cover', 'cloud_cover_low', 'relative_humidity_2m', 'visibility'] as const
const median = (a: number[]) => {
  const b = [...a].sort((x, y) => x - y)
  const m = b.length >> 1
  return b.length % 2 ? b[m]! : (b[m - 1]! + b[m]!) / 2
}

for (const s of SITES) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&hourly=${VARS.join(',')}&forecast_days=3&timezone=UTC&models=${MODELS.join(',')}`
  const j: any = await (await fetch(url)).json()
  const h = j.hourly,
    t: string[] = h.time
  console.log(`\n=== ${s.name} (night hours 21-03 UTC, +0..+2d) ===`)
  for (const v of VARS) {
    const spreads: number[] = []
    for (const [i, ts] of t.entries()) {
      const hh = Number(ts.slice(11, 13))
      if (!(hh >= 21 || hh <= 3)) continue
      const vals = MODELS.map((m) => h[`${v}_${m}`]?.[i]).filter(
        (x: any): x is number => typeof x === 'number',
      )
      if (vals.length < 4) continue
      spreads.push(Math.max(...vals) - Math.min(...vals))
    }
    if (!spreads.length) {
      console.log(`  ${v}: no data`)
      continue
    }
    const unit = v === 'visibility' ? 'm' : v === 'relative_humidity_2m' ? '%RH' : '%'
    console.log(
      `  ${v.padEnd(22)} median spread ${median(spreads).toFixed(0).padStart(6)} ${unit}   max ${Math.max(...spreads).toFixed(0)} ${unit}   n=${spreads.length}`,
    )
  }
}
