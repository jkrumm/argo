/**
 * The pace chart: credit left per pool on a calendar axis. Per pool the actual burn-down (solid, in the
 * pool's shade), the even pace that would spend it exactly at expiry (thin neutral), the projection at
 * the production rate R (dashed), a dry marker where it hits zero, a rule where the cycle expires and,
 * when the last pool runs dry before the first renewal, the IU spill as a warn band. Composed on
 * `CartesianChart` because no shipped kind draws rules, markers and bands over lines; the data is
 * `pace-model.ts`'s, this file only draws it.
 */
import { dot } from '@tanstack/charts/dot'
import { lineY } from '@tanstack/charts/line'
import { decorative } from '@tanstack/charts/mark/decorative'
import { ruleX } from '@tanstack/charts/rule'
import { text } from '@tanstack/charts/text'
import {
  CartesianChart,
  type ChartMarks,
  type ChartSeries,
  type PlotContext,
} from 'basalt-ui/charts'
import { useSizeClass } from 'basalt-ui'
import { alpha, VX } from 'basalt-ui/tokens'
import type { PaceResponse } from '../../lib/queries/usage'
import { colorForPayer } from './constants'
import { fmtDay, fmtUsd, poolPayer } from './flow-model'
import {
  paceRows,
  paceTicks,
  projectionLabel,
  type LineKind,
  type PaceModel,
  type PaceRow,
} from './pace-model'

/** Under this plot width (px) the band and marker captions shorten and stack. */
const NARROW_PLOT_PX = 520

/** A dry marker past this share of the plot width labels to its left: no room to its right. */
const DRY_LEFTWARD_FROM = 0.7

const poolColor = (account: string) => colorForPayer(poolPayer(account))

/** Strokes per kind: the actual line carries the pool, the even pace stays a whisper, the projection is dashed. */
const STROKE: Record<LineKind, { width: number; opacity: number; dashed: boolean }> = {
  actual: { width: 2, opacity: 1, dashed: false },
  report: { width: 1.25, opacity: 0.7, dashed: false },
  even: { width: 1, opacity: 0.55, dashed: true },
  projection: { width: 1.75, opacity: 1, dashed: true },
}

export function PaceChart({
  pace,
  model,
  height,
  ariaLabel,
  cursorGroup,
}: {
  pace: PaceResponse
  model: PaceModel
  height: number
  ariaLabel: string
  cursorGroup: string
}) {
  const compact = useSizeClass() === 'compact'
  const rows = paceRows(model)
  const single = new Set(model.lines.map((l) => l.account)).size === 1
  const seen = new Set<LineKind>()

  const series: ChartSeries<PaceRow>[] = model.lines.map((line) => {
    // One legend entry per kind of helper line; the pools' own lines are always named.
    const first = !seen.has(line.kind)
    seen.add(line.kind)
    const named = line.kind === 'actual' || first
    const labels: Record<LineKind, string> = {
      actual: single ? 'left (per-day max of meter and report)' : `${line.account} credit left`,
      report: 'left by the report alone',
      even: 'even pace to expiry',
      projection: projectionLabel(pace),
    }
    const kind = STROKE[line.kind]
    return {
      key: line.key,
      label: labels[line.kind],
      color: line.kind === 'report' || line.kind === 'even' ? VX.muted : poolColor(line.account),
      getValue: (d) => d.values[line.key] ?? null,
      gaps: 'connect',
      dash: kind.dashed ? 'dashed' : 'solid',
      strokeWidth: kind.width,
      strokeOpacity: kind.opacity,
      legend: named,
      tooltip: line.kind === 'actual',
      role: line.kind === 'actual' ? 'series' : 'overlay',
    }
  })

  const marks = (plot: PlotContext<PaceRow, Date>): ChartMarks => {
    const out: ChartMarks[number][] = []
    const top = plot.yDomain[1]
    // A phone's plot is too narrow for the full band caption and for two dry labels side by side.
    const narrow = plot.plotWidth < NARROW_PLOT_PX
    const bandPx =
      model.spill === null
        ? 0
        : ((plot.xFraction(new Date(model.spill.until)) ?? 1) -
            (plot.xFraction(new Date(model.spill.from)) ?? 0)) *
          plot.plotWidth

    for (const [i, rule] of model.expiry.entries()) {
      const at = new Date(rule.at)
      out.push(
        decorative(
          ruleX([{ at }], {
            id: `expiry-${rule.account}`,
            x: (d) => d.at,
            stroke: VX.muted,
            strokeOpacity: 0.7,
            strokeWidth: 1,
            strokeDasharray: VX.dashArray,
          }),
        ),
        decorative(
          text([{ at }], {
            id: `expiry-label-${rule.account}`,
            x: (d) => d.at,
            y: () => plot.yDomain[0],
            text: () => rule.label,
            fill: VX.ink2,
            fontSize: VX.text.xs,
            anchor: 'end',
            dx: -4,
            // Stacked on a phone, where two renewals sit a few px apart: one full line apart.
            dy: narrow ? -6 - i * 16 : -6,
          }),
        ),
      )
    }

    const now = new Date(model.now)
    out.push(
      decorative(
        ruleX([{ at: now }], {
          id: 'now',
          x: (d) => d.at,
          stroke: VX.ink2,
          strokeOpacity: 0.7,
          strokeWidth: 1,
        }),
      ),
      decorative(
        text([{ at: now }], {
          id: 'now-label',
          x: (d) => d.at,
          y: () => top,
          text: () => 'now',
          fill: VX.ink2,
          fontSize: VX.text.xs,
          anchor: 'start',
          dx: 4,
          dy: 10,
        }),
      ),
    )

    if (model.spill !== null) {
      const from = new Date(model.spill.from)
      out.push(
        decorative(
          text([{ at: from }], {
            id: 'spill-label',
            x: (d) => d.at,
            y: () => top,
            text: () => (bandPx < NARROW_PLOT_PX ? model.spill?.short : model.spill?.label) ?? '',
            fill: VX.status.warn,
            fontSize: VX.text.xs,
            anchor: 'start',
            dx: 6,
            // Under the "now" caption on a phone, where the band starts right beside the now rule.
            dy: narrow ? 24 : 10,
          }),
        ),
      )
    }

    for (const s of plot.visible) {
      const line = model.lines.find((l) => l.key === s.key)
      if (line === undefined) continue
      const kind = STROKE[line.kind]
      out.push(
        lineY(
          plot.rows(s.key).filter((r) => r.y !== null),
          {
            id: s.key,
            x: (r) => r.x,
            y: 'y',
            z: 'series',
            stroke: s.color,
            strokeWidth: kind.width,
            strokeOpacity: kind.opacity,
            ...(kind.dashed ? { strokeDasharray: VX.dashArray } : {}),
          },
        ),
      )
    }

    // The first pool to run dry labels to the left of its marker, the later ones to the right, so two
    // pools drying within days of each other do not print over one another. A marker in the right part of
    // the plot labels leftwards too, so the date never clips at the edge; on a phone the labels also stack.
    for (const [i, marker] of model.dry.entries()) {
      const point = { at: new Date(marker.at), usd: 0 }
      const leftwards = i === 0 || (plot.xFraction(point.at) ?? 0) > DRY_LEFTWARD_FROM
      out.push(
        dot([point], {
          id: `dry-${marker.account}`,
          x: (d) => d.at,
          y: (d) => d.usd,
          r: 4,
          fill: VX.surface.panel,
          stroke: poolColor(marker.account),
          strokeWidth: 1.5,
        }),
        decorative(
          text([point], {
            id: `dry-label-${marker.account}`,
            x: (d) => d.at,
            y: (d) => d.usd,
            text: () => marker.label,
            fill: VX.ink2,
            fontSize: VX.text.xs,
            anchor: leftwards ? 'end' : 'start',
            dx: leftwards ? -8 : 8,
            dy: narrow ? -8 - i * 16 : -8,
          }),
        ),
      )
    }
    return out
  }

  const spill = model.spill
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(model.maxUsd * f))

  return (
    <CartesianChart<PaceRow, Date>
      ariaLabel={ariaLabel}
      data={rows}
      height={height}
      x={(d) => d.at}
      xDomain={[new Date(model.domain[0]), new Date(model.domain[1])]}
      xTicks={paceTicks(model.domain, compact ? 4 : 6)}
      formatX={(d) => fmtDay(d)}
      cursorGroup={cursorGroup}
      series={series}
      marks={marks}
      y={{ domain: [0, model.maxUsd], ticks, format: fmtUsd }}
      {...(spill === null
        ? {}
        : {
            xZones: [
              {
                from: new Date(spill.from),
                to: new Date(spill.until),
                fill: alpha(VX.status.warn, 0.14),
              },
            ],
          })}
      tooltip={{ formatHeader: (d) => fmtDay(d) }}
    />
  )
}
