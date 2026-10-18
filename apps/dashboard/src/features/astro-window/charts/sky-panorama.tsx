import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Box, Group, Slider, Text } from '@mantine/core'
import { areaY } from '@tanstack/charts/area'
import { dot } from '@tanstack/charts/dot'
import { lineY } from '@tanstack/charts/line'
import { rect } from '@tanstack/charts/rect'
import { CartesianChart, ChartCard, type ChartMarks, type ChartSeries } from 'basalt-ui/charts'
import { alpha, VX } from 'basalt-ui/tokens'
import { chartStateOf } from '../../../lib/chart-state'
import { astroQueries } from '../../../lib/queries/astro'
import { SERIES } from '../../../lib/series'
import { LP_RAMP } from '../map-layers'
import { METRIC_TOOLTIPS, PANORAMA_HEIGHT } from '../constants'
import { fmtAzimuth, fmtDegrees, fmtShortDay, withFacts } from '../formulas'
import type { HourlyPoint, Site } from '../types'
import {
  bandValue,
  fitAltDomain,
  inDomain,
  darkness,
  gateAt,
  glowAt,
  glowBuckets,
  glowCells,
  profileRows,
  type HorizonProfilePoint,
  type ProfileRow,
  type SkyglowRose,
} from './sky-panorama-geometry'

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
const COMPASS_TICKS = COMPASS.map((c) => c.az)
const compassLabel = (az: number) => COMPASS.find((c) => c.az === az)?.label ?? ''

const ALT_TICKS = 6

/**
 * The legend and the domain, not the data: the plot is drawn from `marks`, and the sun/moon/core
 * tracks and the skyglow field live on azimuths of their own, so only the three terrain series
 * (skyline, near band, gate) read from the profile rows. The rest are legend-only entries
 * (`getValue` always null) whose keys gate their marks on the legend toggle.
 */
const NEVER = () => null
/**
 * The skyglow field's own opacity ceiling, applied on top of the twilight fade. The `LP.*` ramp's
 * alpha ladder is DESIGN.md-recorded and untouched; the panorama just paints the whole field
 * quieter so the skyline and the gate line lead.
 */
const GLOW_ALPHA = 0.12

const PANORAMA_SERIES: ChartSeries<ProfileRow>[] = [
  {
    key: 'skyline',
    label: 'Skyline (measured terrain)',
    color: VX.neutral,
    mark: 'area',
    getValue: (d) => d.skyline,
  },
  {
    key: 'near',
    label: 'Local ground (≤500 m, advisory)',
    color: alpha(VX.neutral, 0.4),
    mark: 'area',
    getValue: (d) => d.near,
  },
  {
    key: 'gate',
    label: 'Framing gate',
    color: VX.muted,
    mark: 'line',
    dash: 'dashed',
    role: 'reference',
    getValue: (d) => d.gate,
  },
  {
    key: 'glow',
    label: 'Artificial skyglow',
    color: LP_RAMP[2]!.token,
    mark: 'area',
    getValue: NEVER,
  },
  {
    key: 'sun',
    label: 'Sun',
    color: VX.muted,
    mark: 'line',
    dash: 'dashed',
    role: 'reference',
    getValue: NEVER,
  },
  {
    key: 'moon',
    label: 'Moon',
    color: SERIES.moonAltitude,
    mark: 'line',
    dash: 'dashed',
    getValue: NEVER,
  },
  {
    key: 'core',
    label: 'Galactic core',
    color: SERIES.coreAltitude,
    mark: 'line',
    strokeWidth: 2,
    getValue: NEVER,
  },
]

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

/** The moment the core is highest while astronomically dark — the shot, and what a reader wants
 * to see first, not midnight. Falls back to ~45% through the night when the core is never dark. */
function initialScrubIndex(samples: readonly HourlyPoint[]): number {
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

type Track = { i: number; az: number; alt: number | null }

/** One body's night as an azimuth × altitude path; a sample outside the plot's altitude domain is a gap. */
function trackOf(
  samples: readonly HourlyPoint[],
  at: (s: HourlyPoint) => { az: number; alt: number },
  domain: readonly [number, number],
  keep: (s: HourlyPoint) => boolean = () => true,
): Track[] {
  return samples.map((s, i) => {
    const { az, alt } = at(s)
    return { i, az, alt: inDomain(alt, domain) && keep(s) ? alt : null }
  })
}

/** An instant marker: one dot at the scrubbed sample. */
function marker(
  id: string,
  az: number,
  alt: number,
  r: number,
  fill: string,
  fillOpacity = 1,
): ChartMarks[number] {
  return dot([{ az, alt }], {
    id,
    x: 'az',
    y: 'alt',
    r,
    fill,
    fillOpacity,
    stroke: VX.dotStroke,
    strokeWidth: 1,
  })
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
  const horizonQuery = useQuery(astroQueries.horizon({ lat: site.lat, lon: site.lon }))
  const skyglowQuery = useQuery(
    astroQueries.skyglow({ lat: site.lat, lon: site.lon, date: detailDate }),
  )
  const visibilityQuery = useQuery(astroQueries.visibility({ site: site.id }))

  const queries = [horizonQuery, skyglowQuery, visibilityQuery]
  const failed = queries.find((q) => q.isError)

  const horizon = horizonQuery.data
  const skyglow = skyglowQuery.data
  const visibility = visibilityQuery.data

  if (
    horizon === undefined ||
    skyglow === undefined ||
    visibility === undefined ||
    hourly.length === 0
  ) {
    return (
      <ChartCard
        title={`Skyline, skyglow and tracks · ${fmtShortDay(detailDate)}`}
        info={METRIC_TOOLTIPS.skyPanorama}
        state={chartStateOf(
          {
            isPending: queries.some((q) => q.isPending),
            isError: failed !== undefined,
            error: failed?.error,
          },
          'No hourly data for this night',
        )}
        placeholderHeight={PANORAMA_HEIGHT}
      />
    )
  }

  return (
    <PanoramaLoaded
      detailDate={detailDate}
      samples={hourly}
      moonIllumination={moonIllumination}
      horizon={horizon}
      skyglow={skyglow}
      visibility={visibility}
    />
  )
}

function PanoramaLoaded({
  detailDate,
  samples,
  moonIllumination,
  horizon,
  skyglow,
  visibility,
}: {
  detailDate: string
  samples: HourlyPoint[]
  /** Moon illuminated fraction for this night, 0..1 — scales the moon marker. */
  moonIllumination: number
  horizon: { profile: HorizonProfilePoint[] }
  skyglow: { profile: SkyglowRose }
  visibility: { atmosphericFloorDeg: number; framingMarginDeg: number }
}) {
  const [scrub, setScrub] = useState(() => initialScrubIndex(samples))
  const idx = Math.min(scrub, Math.max(0, samples.length - 1))

  const profile = horizon.profile
  const rose = skyglow.profile
  const { atmosphericFloorDeg, framingMarginDeg } = visibility

  const skyline = (az: number) => bandValue(profile, 'altitudeDeg', az)
  const gate = (az: number) => gateAt(profile, atmosphericFloorDeg, framingMarginDeg, az)

  const sample = samples[idx] ?? samples[0]!
  const highest = samples[initialScrubIndex(samples)]
  const peak = highest?.astroDark === true ? highest : null
  const dark = darkness(sample.sunAltitude)
  const ridge = skyline(sample.coreAzimuth)
  const clearance = sample.coreAltitude - ridge
  const clearanceGood = clearance > framingMarginDeg
  const glowBehindCore = glowAt(rose, sample.coreAzimuth, Math.max(5, sample.coreAltitude))
  const moonState: 'down' | 'behind terrain' | 'up' =
    sample.moonAltitude < 0 ? 'down' : sample.moonBehindTerrain ? 'behind terrain' : 'up'
  const moonGood = moonState !== 'up'
  const coreClearsNow = sample.astroDark && sample.coreAltitude >= gate(sample.coreAzimuth)

  // Static geometry — depends on the site and night, never on the scrub index, so dragging the
  // slider recomputes none of it.
  const rows = useMemo(
    () => profileRows(profile, (az) => gateAt(profile, atmosphericFloorDeg, framingMarginDeg, az)),
    [profile, atmosphericFloorDeg, framingMarginDeg],
  )
  // The altitude axis fits everything drawn: the terrain rows and all three bodies' tracks.
  const altDomain = useMemo(
    () =>
      fitAltDomain(
        rows,
        samples.flatMap((d) => [d.coreAltitude, d.moonAltitude, d.sunAltitude]),
      ),
    [rows, samples],
  )
  // Cells bucketed by brightness: a rect mark takes one fill and the engine draws a mark per
  // call, so the field is one mark per 0.1 mag bucket rather than one per distinct colour.
  const glowGroups = useMemo(
    () =>
      glowBuckets(glowCells(rose, altDomain[1])).map(({ mpsas, cells }) => ({
        fill: rampFill(mpsas),
        cells,
      })),
    [rose, altDomain],
  )
  const sunTrack = useMemo(
    () => trackOf(samples, (s) => ({ az: s.sunAzimuth, alt: s.sunAltitude }), altDomain),
    [samples, altDomain],
  )
  const moonTrack = useMemo(
    () => trackOf(samples, (s) => ({ az: s.moonAzimuth, alt: s.moonAltitude }), altDomain),
    [samples, altDomain],
  )
  const coreTrack = useMemo(
    () => trackOf(samples, (s) => ({ az: s.coreAzimuth, alt: s.coreAltitude }), altDomain),
    [samples, altDomain],
  )
  // Plain computation: `gate` is a closure over the profile, and ~60 samples are cheap.
  const coreInGate = trackOf(
    samples,
    (s) => ({ az: s.coreAzimuth, alt: s.coreAltitude }),
    altDomain,
    (s) => s.astroDark && s.coreAltitude >= gate(s.coreAzimuth),
  )

  const washFill = `color-mix(in srgb, ${VX.surface.elevated} ${Math.round(dark * 100)}%, ${VX.surface.subtle} ${Math.round((1 - dark) * 100)}%)`

  const marks = (plot: { visible: readonly ChartSeries<ProfileRow>[] }): ChartMarks => {
    const on = (key: string) => plot.visible.some((s) => s.key === key)
    const out: ChartMarks[number][] = [
      // 1. Twilight wash.
      rect([0], {
        x1: () => 0,
        x2: () => 360,
        y1: () => altDomain[0],
        y2: () => altDomain[1],
        fill: washFill,
      }),
    ]

    // 2. Skyglow field — only visible once darkness has set in.
    if (on('glow')) {
      for (const { fill, cells } of glowGroups) {
        out.push(
          rect(cells, {
            x1: 'az0',
            x2: 'az1',
            y1: 'alt0',
            y2: 'alt1',
            fill,
            fillOpacity: dark * GLOW_ALPHA,
            inset: 0,
          }),
        )
      }
    }

    // 3. The gate — a threshold, not a series: neutral reference treatment.
    if (on('gate')) {
      out.push(
        lineY(rows, {
          id: 'gate',
          x: 'az',
          y: 'gate',
          stroke: VX.muted,
          strokeWidth: 1.5,
          strokeDasharray: VX.dashArray,
        }),
      )
    }

    // 4. Advisory near band, then 5. the skyline over it — both neutral (terrain, not data).
    if (on('near')) {
      out.push(
        areaY(rows, {
          id: 'near',
          x: 'az',
          y: 'near',
          y1: altDomain[0],
          fill: alpha(VX.neutral, 0.35),
        }),
      )
    }
    if (on('skyline')) {
      out.push(
        areaY(rows, {
          id: 'skyline',
          x: 'az',
          y: 'skyline',
          y1: altDomain[0],
          fill: VX.surface.elevated,
        }),
        lineY(rows, { id: 'ridge', x: 'az', y: 'skyline', stroke: VX.neutral, strokeWidth: 1.5 }),
      )
    }

    // 6. Tracks.
    if (on('sun')) {
      out.push(
        lineY(sunTrack, {
          id: 'sun',
          x: 'az',
          y: 'alt',
          key: 'i',
          stroke: VX.muted,
          strokeWidth: 1,
          strokeOpacity: 0.6,
          strokeDasharray: VX.dashArray,
        }),
      )
    }
    if (on('moon')) {
      out.push(
        lineY(moonTrack, {
          id: 'moon',
          x: 'az',
          y: 'alt',
          key: 'i',
          stroke: SERIES.moonAltitude,
          strokeWidth: 1.5,
          strokeOpacity: 0.7,
          strokeDasharray: VX.dashArray,
        }),
      )
    }
    if (on('core')) {
      out.push(
        lineY(coreTrack, {
          id: 'core',
          x: 'az',
          y: 'alt',
          key: 'i',
          stroke: SERIES.coreAltitude,
          strokeWidth: 2,
          strokeOpacity: 0.4,
        }),
        // 7. The emphasised segment — same hue, more present, never a second colour.
        lineY(coreInGate, {
          id: 'core-in-gate',
          x: 'az',
          y: 'alt',
          key: 'i',
          stroke: SERIES.coreAltitude,
          strokeWidth: 3.5,
        }),
      )
    }

    // 8. Instant markers.
    if (on('sun') && inDomain(sample.sunAltitude, altDomain)) {
      out.push(marker('sun-now', sample.sunAzimuth, sample.sunAltitude, 6, VX.muted))
    }
    if (on('moon') && inDomain(sample.moonAltitude, altDomain)) {
      out.push(
        marker(
          'moon-now',
          sample.moonAzimuth,
          sample.moonAltitude,
          5 + 5 * moonIllumination,
          SERIES.moonAltitude,
        ),
      )
    }
    if (on('core') && inDomain(sample.coreAltitude, altDomain)) {
      out.push(
        marker(
          'core-now',
          sample.coreAzimuth,
          sample.coreAltitude,
          8,
          SERIES.coreAltitude,
          coreClearsNow ? 1 : 0.55,
        ),
      )
    }
    return out
  }

  return (
    <ChartCard
      title={`Skyline, skyglow and tracks · ${fmtShortDay(detailDate)}`}
      info={METRIC_TOOLTIPS.skyPanorama}
      {...withFacts(
        peak === null
          ? null
          : {
              value: fmtDegrees(peak.coreAltitude),
              unit: 'core at its highest in the dark',
              period: `${peak.localTime} · ${fmtAzimuth(peak.coreAzimuth)}`,
            },
      )}
    >
      <CartesianChart
        ariaLabel="Azimuth by altitude panorama of the terrain skyline, artificial skyglow, and the sun, moon and galactic-core tracks across the night"
        data={rows}
        height={PANORAMA_HEIGHT}
        x={(d) => d.az}
        xTicks={COMPASS_TICKS}
        formatX={compassLabel}
        series={PANORAMA_SERIES}
        y={{ domain: altDomain, ticks: ALT_TICKS, format: (v) => `${v}°` }}
        tooltip={false}
        marks={marks}
      />

      <Box mt="sm">
        <Slider
          aria-label="Scrub the night: time of the instant shown on the panorama"
          value={idx}
          onChange={setScrub}
          min={0}
          max={Math.max(0, samples.length - 1)}
          step={1}
          label={(v) => samples[v]?.localTime ?? ''}
        />
      </Box>
      <Group gap="md" mt="xs" wrap="wrap">
        <Text size="sm" c={VX.muted}>
          {sample.localTime}
        </Text>
        <Text size="sm">
          Core <b>{fmtDegrees(sample.coreAltitude)}</b> · {fmtAzimuth(sample.coreAzimuth)}
        </Text>
        <Text size="sm">
          Skyline there <b>{fmtDegrees(ridge)}</b>
        </Text>
        <Text size="sm" style={{ color: clearanceGood ? VX.goodSolid : VX.badSolid }}>
          Clearance {clearance >= 0 ? '+' : ''}
          {clearance.toFixed(1)}°
        </Text>
        <Text size="sm">
          Skyglow there {glowBehindCore.toFixed(2)} mag/arcsec² (dark sky ≥ 21.6)
        </Text>
        <Text size="sm">Sun {fmtDegrees(sample.sunAltitude)}</Text>
        <Text size="sm" style={{ color: moonGood ? VX.goodSolid : VX.badSolid }}>
          Moon {moonState}
        </Text>
        <Text size="sm" c={coreClearsNow ? VX.goodSolid : VX.muted}>
          {coreClearsNow ? 'Core clears the gate now' : 'Core does not clear the gate now'}
        </Text>
      </Group>
    </ChartCard>
  )
}
