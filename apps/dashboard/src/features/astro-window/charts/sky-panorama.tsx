/* theme-allow-file hand-rolled-plot — single plot over a CONTINUOUS azimuth x (basalt #52); no
   cursor/tooltip/legend-toggle, so CartesianChart's job list does not apply. */
import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Box, Group, Slider, Text } from '@mantine/core'
import {
  alpha,
  AxisBottomNumeric,
  AxisLeftNumeric,
  ChartCard,
  ChartFrame,
  ChartLegend,
  curveLinear,
  deriveLegend,
  GridRows,
  Group as SvgGroup,
  Line,
  LinePath,
  scaleLinear,
  VX,
  type SeriesStyle,
} from 'basalt-ui/charts'
import { astroQueries } from '../../../lib/queries/astro'
import { SERIES } from '../../../lib/series'
import { LP_RAMP } from '../map-layers'
import { METRIC_TOOLTIPS, PANORAMA_HEIGHT } from '../constants'
import { fmtDegrees, fmtMinutes } from '../formulas'
import type { HourlyPoint, Site } from '../types'

const MARGIN = VX.margin
const CHART_ID = 'astro-sky-panorama'

/** Fixed domain per the research POC — the core never passes ~13.5° at 48°N, but a walled-in
 * site's northern skyline can reach 34°, so the plot has to hold terrain as well as sky. */
const AZ_DOMAIN: [number, number] = [0, 360]
const ALT_DOMAIN: [number, number] = [-4, 52]

const COMPASS: ReadonlyArray<{ az: number; label: string }> = [
  { az: 0, label: 'N' },
  { az: 45, label: 'NE' },
  { az: 90, label: 'E' },
  { az: 135, label: 'SE' },
  { az: 180, label: 'S' },
  { az: 225, label: 'SW' },
  { az: 270, label: 'W' },
  { az: 315, label: 'NW' },
  { az: 360, label: 'N' },
]

/** Coarse skyglow-field cell size, degrees — "a coarse interpolated grid" per the brief, not a
 * pixel-accurate raster. */
const GLOW_AZ_STEP = 10
const GLOW_ALT_STEP = 4

/** Sample step for the piecewise skyline/gate area paths, degrees. */
const AREA_STEP = 2

const LEGEND_SERIES: readonly SeriesStyle[] = [
  { key: 'skyline', label: 'Skyline (measured terrain)', color: VX.neutral, mark: 'area' },
  {
    key: 'near',
    label: 'Local ground (≤500 m, advisory)',
    color: alpha(VX.neutral, 0.4),
    mark: 'area',
  },
  {
    key: 'gate',
    label: 'Framing gate',
    color: VX.muted,
    mark: 'line',
    dash: 'dashed',
    role: 'reference',
  },
  { key: 'glow', label: 'Artificial skyglow', color: LP_RAMP[2]!.token, mark: 'area' },
  { key: 'sun', label: 'Sun', color: VX.muted, mark: 'line', dash: 'dashed', role: 'reference' },
  { key: 'moon', label: 'Moon', color: SERIES.moonAltitude, mark: 'line', dash: 'dashed' },
  { key: 'core', label: 'Galactic core', color: SERIES.coreAltitude, mark: 'line', strokeWidth: 2 },
]

type SkyglowRose = {
  azimuths: readonly number[]
  altitudes: readonly number[]
  mpsas: readonly (readonly number[])[]
}
type HorizonProfilePoint = { azimuthDeg: number; altitudeDeg: number; nearAltitudeDeg: number }

/**
 * Azimuths come from the API, which already computes them per sample in
 * `astro-night.ts` — this view deliberately does NOT carry its own ephemeris.
 * A second copy of the same maths in the browser is 116 KB of bundle to
 * reproduce a number the server sends, and two independent evaluations of one
 * quantity are free to drift apart.
 */
type PanoramaSample = HourlyPoint

/** 0 = daylight, 1 = astronomical night — the twilight wash and the skyglow field both fade by
 * this. Ramps over sun altitude −6° → −18°, exactly the POC's convention. */
function darkness(sunAltitudeDeg: number): number {
  return Math.max(0, Math.min(1, (-sunAltitudeDeg - 6) / 12))
}

/** Bilinear-in-altitude, nearest-column-in-azimuth interpolation over the skyglow rose. */
function glowAt(rose: SkyglowRose, azDeg: number, altDeg: number): number {
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
function bandValue(
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

/** The ramp stop segment `val` (mpsas × 100) falls in, blended by `color-mix` between the two
 * bracketing `LP.*` tokens — the same stops the light-pollution map ramp uses, reused here per
 * DESIGN.md: it is the app's mpsas ramp, and the skyglow rose is the same quantity in the sky
 * rather than on the ground. */
function rampFill(mpsasValue: number): string {
  const first = LP_RAMP[0]!
  const last = LP_RAMP[LP_RAMP.length - 1]!
  const val = Math.min(last.stop, Math.max(first.stop, mpsasValue * 100))
  let i = 0
  while (i < LP_RAMP.length - 2 && val > LP_RAMP[i + 1]!.stop) i++
  const a = LP_RAMP[i]!
  const b = LP_RAMP[i + 1]!
  const span = b.stop - a.stop
  const frac = span === 0 ? 0 : (val - a.stop) / span
  const mixed = `color-mix(in srgb, ${b.token} ${Math.round(frac * 100)}%, ${a.token} ${Math.round((1 - frac) * 100)}%)`
  const opacity = a.alpha + (b.alpha - a.alpha) * frac
  return alpha(mixed, opacity)
}

/** Piecewise-linear area path from `az=0` to `az=360`, closed down to `baselineY`. */
function areaPath(
  fn: (az: number) => number,
  xScale: (v: number) => number,
  yScale: (v: number) => number,
  baselineY: number,
): string {
  let d = `M ${xScale(0)} ${yScale(fn(0))}`
  for (let az = AREA_STEP; az <= 360; az += AREA_STEP) d += ` L ${xScale(az)} ${yScale(fn(az))}`
  d += ` L ${xScale(360)} ${baselineY} L ${xScale(0)} ${baselineY} Z`
  return d
}

/** Piecewise-linear open path (the dashed gate line). */
function linePath(
  fn: (az: number) => number,
  xScale: (v: number) => number,
  yScale: (v: number) => number,
): string {
  let d = `M ${xScale(0)} ${yScale(fn(0))}`
  for (let az = AREA_STEP; az <= 360; az += AREA_STEP) d += ` L ${xScale(az)} ${yScale(fn(az))}`
  return d
}

function stepMinutesOf(samples: readonly { time: string }[]): number {
  const t0Sample = samples[0]
  const t1Sample = samples[1]
  if (!t0Sample || !t1Sample) return 30
  const t0 = new Date(t0Sample.time).getTime()
  const t1 = new Date(t1Sample.time).getTime()
  const diff = Math.round((t1 - t0) / 60_000)
  return diff > 0 ? diff : 30
}

/** The moment the core is highest while astronomically dark — the shot, and what a reader wants
 * to see first, not midnight. Falls back to ~45% through the night when the core is never dark. */
function initialScrubIndex(samples: readonly PanoramaSample[]): number {
  let best = 0
  let bestAlt = -90
  samples.forEach((s, i) => {
    if (s.astroDark && s.coreAltitude > bestAlt) {
      bestAlt = s.coreAltitude
      best = i
    }
  })
  return bestAlt > -90 ? best : Math.floor(samples.length * 0.45)
}

export default function SkyPanorama({
  site,
  detailDate,
  hourly,
  moonIllumination,
}: {
  site: Site
  detailDate: string
  hourly: HourlyPoint[]
  /** Moon illuminated fraction for this night, 0..1 — scales the moon marker. */
  moonIllumination: number
}) {
  const horizonQuery = useSuspenseQuery(astroQueries.horizon({ lat: site.lat, lon: site.lon }))
  const skyglowQuery = useSuspenseQuery(
    astroQueries.skyglow({ lat: site.lat, lon: site.lon, date: detailDate }),
  )
  const visibilityQuery = useSuspenseQuery(astroQueries.visibility({ site: site.id }))

  const samples: PanoramaSample[] = hourly

  const [idx, setIdx] = useState(() => initialScrubIndex(samples))
  const clampedIdx = Math.min(idx, Math.max(0, samples.length - 1))

  if (samples.length === 0) {
    return (
      <ChartCard
        title="Sky Panorama"
        info={METRIC_TOOLTIPS.skyPanorama}
        state={{ empty: 'No hourly data for this night' }}
        placeholderHeight={PANORAMA_HEIGHT}
      />
    )
  }

  return (
    <PanoramaLoaded
      site={site}
      samples={samples}
      moonIllumination={moonIllumination}
      idx={clampedIdx}
      onIdxChange={setIdx}
      horizon={horizonQuery.data}
      skyglow={skyglowQuery.data}
      visibility={visibilityQuery.data}
    />
  )
}

function PanoramaLoaded({
  site,
  samples,
  moonIllumination,
  idx,
  onIdxChange,
  horizon,
  skyglow,
  visibility,
}: {
  site: Site
  samples: PanoramaSample[]
  /** Moon illuminated fraction for this night, 0..1 — scales the moon marker. */
  moonIllumination: number
  idx: number
  onIdxChange: (i: number) => void
  horizon: { profile: HorizonProfilePoint[] }
  skyglow: { profile: SkyglowRose }
  visibility: { atmosphericFloorDeg: number; framingMarginDeg: number }
}) {
  const profile = horizon.profile
  const rose = skyglow.profile
  const { atmosphericFloorDeg, framingMarginDeg } = visibility

  const skyline = (az: number) => bandValue(profile, 'altitudeDeg', az)
  const local = (az: number) => bandValue(profile, 'nearAltitudeDeg', az)
  const gate = (az: number) => Math.max(atmosphericFloorDeg, skyline(az) + framingMarginDeg)

  const stepMinutes = stepMinutesOf(samples)
  const gateMinutes =
    samples.filter((s) => s.astroDark && s.coreAltitude >= gate(s.coreAzimuth)).length * stepMinutes

  const sample = samples[idx] ?? samples[0]!
  const dark = darkness(sample.sunAltitude)
  const ridge = skyline(sample.coreAzimuth)
  const clearance = sample.coreAltitude - ridge
  const clearanceGood = clearance > framingMarginDeg
  const glowBehindCore = glowAt(rose, sample.coreAzimuth, Math.max(5, sample.coreAltitude))
  const moonState: 'down' | 'behind terrain' | 'up' =
    sample.moonAltitude < 0 ? 'down' : sample.moonBehindTerrain ? 'behind terrain' : 'up'
  const moonGood = moonState !== 'up'
  const coreClearsNow = sample.astroDark && sample.coreAltitude >= gate(sample.coreAzimuth)

  return (
    <ChartCard
      title="Sky Panorama"
      subtitle={`${site.name} — where the core, moon and sun sit against the measured skyline`}
      info={METRIC_TOOLTIPS.skyPanorama}
      actions={
        <Box component="span" style={{ fontSize: VX.text.xs }}>
          <Box component="span" style={{ fontWeight: 600, fontSize: VX.text.md }}>
            {fmtMinutes(gateMinutes)}
          </Box>
          <Box component="span" ml={6} style={{ opacity: 0.6 }}>
            above the gate tonight
          </Box>
        </Box>
      }
    >
      <ChartFrame
        series={LEGEND_SERIES}
        chartId={CHART_ID}
        height={PANORAMA_HEIGHT}
        legend={false}
        ariaLabel="Azimuth by altitude panorama of the terrain skyline, artificial skyglow, and the sun, moon and galactic-core tracks across the night"
      >
        {(plot) => (
          <PanoramaInner
            samples={samples}
            rose={rose}
            skyline={skyline}
            local={local}
            gate={gate}
            sample={sample}
            moonIllumination={moonIllumination}
            dark={dark}
            width={plot.width}
            height={plot.height}
          />
        )}
      </ChartFrame>
      <ChartLegend items={deriveLegend(LEGEND_SERIES)} chartId={CHART_ID} />

      <Box mt="sm">
        <Slider
          value={idx}
          onChange={onIdxChange}
          min={0}
          max={Math.max(0, samples.length - 1)}
          step={1}
          label={(v) => samples[v]?.localTime ?? ''}
        />
      </Box>
      <Group gap="md" mt="xs" wrap="wrap">
        <Text size="sm" c="dimmed">
          {sample.localTime}
        </Text>
        <Text size="sm">
          Core <b>{fmtDegrees(sample.coreAltitude)}</b> / {fmtDegrees(sample.coreAzimuth)}
        </Text>
        <Text size="sm">
          Skyline there <b>{fmtDegrees(ridge)}</b>
        </Text>
        <Text size="sm" style={{ color: clearanceGood ? VX.goodSolid : VX.badSolid }}>
          Clearance {clearance >= 0 ? '+' : ''}
          {clearance.toFixed(1)}°
        </Text>
        <Text size="sm">Skyglow there {glowBehindCore.toFixed(2)} mpsas</Text>
        <Text size="sm">Sun {fmtDegrees(sample.sunAltitude)}</Text>
        <Text size="sm" style={{ color: moonGood ? VX.goodSolid : VX.badSolid }}>
          Moon {moonState}
        </Text>
        <Text size="sm" c={coreClearsNow ? 'green' : 'dimmed'}>
          {coreClearsNow ? 'Core clears the gate now' : 'Core does not clear the gate now'}
        </Text>
      </Group>
    </ChartCard>
  )
}

function PanoramaInner({
  samples,
  rose,
  skyline,
  local,
  gate,
  sample,
  moonIllumination,
  dark,
  width,
  height,
}: {
  samples: PanoramaSample[]
  rose: SkyglowRose
  skyline: (az: number) => number
  local: (az: number) => number
  gate: (az: number) => number
  sample: PanoramaSample
  /** Moon illuminated fraction for this night, 0..1 — scales the moon marker. */
  moonIllumination: number
  dark: number
  width: number
  height: number
}) {
  const xMax = width - MARGIN.left - MARGIN.right
  const yMax = height - MARGIN.top - MARGIN.bottom

  const xScale = scaleLinear<number>({ domain: AZ_DOMAIN, range: [0, xMax] })
  const yScale = scaleLinear<number>({ domain: ALT_DOMAIN, range: [yMax, 0] })

  // Static geometry — a plain computation off the profile/rose, independent of the scrub index
  // (`sample`/`dark` below), so the React Compiler never has a reason to recompute it while
  // dragging the slider: the grid, the area fills and the gate path only depend on data that
  // changes on a night/site switch.
  const glowCells: { x: number; y: number; w: number; h: number; fill: string }[] = []
  for (let az = 0; az < 360; az += GLOW_AZ_STEP) {
    for (let alt = 0; alt < 52; alt += GLOW_ALT_STEP) {
      const centerAz = az + GLOW_AZ_STEP / 2
      const topAlt = Math.min(52, alt + GLOW_ALT_STEP)
      const centerAlt = Math.min(52, alt + GLOW_ALT_STEP / 2)
      const fill = rampFill(glowAt(rose, centerAz, centerAlt))
      glowCells.push({
        x: xScale(az),
        y: yScale(topAlt),
        w: xScale(az + GLOW_AZ_STEP) - xScale(az),
        h: yScale(alt) - yScale(topAlt),
        fill,
      })
    }
  }

  const localPath = areaPath(local, xScale, yScale, yMax)
  const skylinePath = areaPath(skyline, xScale, yScale, yMax)
  const gatePath = linePath(gate, xScale, yScale)

  const washFill = `color-mix(in srgb, ${VX.surface.elevated} ${Math.round(dark * 100)}%, ${VX.surface.subtle} ${Math.round((1 - dark) * 100)}%)`

  return (
    <svg width={width} height={height}>
      <SvgGroup left={MARGIN.left} top={MARGIN.top}>
        {/* 1. Twilight wash. */}
        <rect x={0} y={0} width={xMax} height={yMax} fill={washFill} />

        {/* 2. Skyglow field — only visible once darkness has set in. */}
        <SvgGroup opacity={dark}>
          {glowCells.map((cell) => (
            <rect
              key={`${cell.x}-${cell.y}`}
              x={cell.x}
              y={cell.y}
              width={Math.max(0, cell.w)}
              height={Math.max(0, cell.h)}
              fill={cell.fill}
            />
          ))}
        </SvgGroup>

        {/* 3. Grid + axis labels. AxisBottomDate is typed for a string/band domain, so the
            compass grid lines are drawn per azimuth here; the labels themselves come from
            AxisBottomNumeric below, over the same continuous 0–360° scale. */}
        <GridRows scale={yScale} width={xMax} stroke={VX.grid} numTicks={6} />
        {COMPASS.map(({ az }) => (
          <Line
            key={az}
            from={{ x: xScale(az), y: 0 }}
            to={{ x: xScale(az), y: yMax }}
            stroke={az === 180 ? VX.divider : VX.grid}
          />
        ))}
        <AxisLeftNumeric scale={yScale} numTicks={6} tickFormat={(v) => `${v}°`} />
        <AxisBottomNumeric
          scale={xScale}
          top={yMax}
          tickValues={COMPASS.map((c) => c.az)}
          tickFormat={(v) => COMPASS.find((c) => c.az === v)?.label ?? ''}
        />

        {/* 4. The gate — a threshold, not a series: neutral reference treatment. */}
        <path
          d={gatePath}
          fill="none"
          stroke={VX.muted}
          strokeWidth={1.5}
          strokeDasharray={VX.dashArray}
        />

        {/* 5. Advisory near band, then 6. the skyline over it — both neutral (terrain, not data). */}
        <path d={localPath} fill={alpha(VX.neutral, 0.35)} />
        <path d={skylinePath} fill={VX.surface.elevated} stroke={VX.neutral} strokeWidth={1.5} />

        {/* 7. Tracks. */}
        <LinePath<PanoramaSample>
          data={samples}
          x={(d) => xScale(d.sunAzimuth)}
          y={(d) => yScale(d.sunAltitude)}
          defined={(d) => d.sunAltitude >= ALT_DOMAIN[0]}
          stroke={VX.muted}
          strokeWidth={1}
          strokeOpacity={0.6}
          strokeDasharray={VX.dashArray}
          curve={curveLinear}
        />
        <LinePath<PanoramaSample>
          data={samples}
          x={(d) => xScale(d.moonAzimuth)}
          y={(d) => yScale(d.moonAltitude)}
          defined={(d) => d.moonAltitude >= ALT_DOMAIN[0]}
          stroke={SERIES.moonAltitude}
          strokeWidth={1.5}
          strokeOpacity={0.7}
          strokeDasharray={VX.dashArray}
          curve={curveLinear}
        />
        <LinePath<PanoramaSample>
          data={samples}
          x={(d) => xScale(d.coreAzimuth)}
          y={(d) => yScale(d.coreAltitude)}
          defined={(d) => d.coreAltitude >= ALT_DOMAIN[0]}
          stroke={SERIES.coreAltitude}
          strokeWidth={2}
          strokeOpacity={0.4}
          curve={curveLinear}
        />

        {/* 8. The emphasised segment — same hue, more present, never a second colour. */}
        <LinePath<PanoramaSample>
          data={samples}
          x={(d) => xScale(d.coreAzimuth)}
          y={(d) => yScale(d.coreAltitude)}
          defined={(d) => d.astroDark && d.coreAltitude >= gate(d.coreAzimuth)}
          stroke={SERIES.coreAltitude}
          strokeWidth={3.5}
          curve={curveLinear}
        />

        {/* 9. Instant markers. */}
        {sample.sunAltitude >= ALT_DOMAIN[0] && (
          <circle
            cx={xScale(sample.sunAzimuth)}
            cy={yScale(sample.sunAltitude)}
            r={6}
            fill={VX.muted}
            stroke={VX.dotStroke}
            strokeWidth={1}
          />
        )}
        {sample.moonAltitude >= ALT_DOMAIN[0] && (
          <circle
            cx={xScale(sample.moonAzimuth)}
            cy={yScale(sample.moonAltitude)}
            r={5 + 5 * moonIllumination}
            fill={SERIES.moonAltitude}
            stroke={VX.dotStroke}
            strokeWidth={1}
          />
        )}
        {sample.coreAltitude >= ALT_DOMAIN[0] && (
          <circle
            cx={xScale(sample.coreAzimuth)}
            cy={yScale(sample.coreAltitude)}
            r={8}
            fill={SERIES.coreAltitude}
            fillOpacity={
              sample.astroDark && sample.coreAltitude >= gate(sample.coreAzimuth) ? 1 : 0.55
            }
            stroke={VX.dotStroke}
            strokeWidth={1}
          />
        )}
      </SvgGroup>
    </svg>
  )
}
