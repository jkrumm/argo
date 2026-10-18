import type { CSSProperties, ReactNode } from 'react'
import { Box } from '@mantine/core'
import { Meter, StatGroup, type StatStripCell } from 'basalt-ui'
import { CORE_UNIT, SKY_DARK_THRESHOLD, SKY_METER_MAX, SKY_METER_MIN } from '../constants'
import {
  coreGaugeMax,
  coreMeterReading,
  cloudFooter,
  coreTransitFooter,
  fmtPercent,
  fmtDegrees,
  fmtLocalClock,
  fmtMinutes,
  lowCloudStat,
  moonFooter,
  moonPhaseLabel,
  skyCellFooter,
} from '../formulas'
import { LP_RAMP, LP_RAMP_MAX, LP_RAMP_MIN } from '../map-layers'
import type { Location, Night } from '../types'
import classes from './night-anatomy.module.css'

const pct = (value: number, min: number, max: number) =>
  `${Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))}%`

/** The map legend's `LP.*` ramp (same stops, same alphas) as a 18–22 mag/arcsec² track with a reading marker and the dark-threshold tick. */
function SkyScale({ mpsas }: { mpsas: number | null }) {
  const span = LP_RAMP_MAX - LP_RAMP_MIN
  const stops = LP_RAMP.map(
    (s) =>
      `color-mix(in srgb, ${s.token} ${Math.round(s.alpha * 100)}%, transparent) ${((s.stop - LP_RAMP_MIN) / span) * 100}%`,
  ).join(', ')
  const rampStyle: CSSProperties = { background: `linear-gradient(to right, ${stops})` }
  const tickAt = pct(SKY_DARK_THRESHOLD, SKY_METER_MIN, SKY_METER_MAX)
  return (
    <Box className={classes.scale}>
      <Box
        className={classes.track}
        role="img"
        aria-label={`Sky brightness on the ${SKY_METER_MIN} to ${SKY_METER_MAX} mag/arcsec² scale; dark sky from ${SKY_DARK_THRESHOLD}`}
      >
        <Box className={classes.ramp} style={rampStyle} />
        <Box className={classes.tick} style={{ insetInlineStart: tickAt }} />
        {mpsas !== null && (
          <Box
            className={classes.marker}
            style={{ insetInlineStart: pct(mpsas, SKY_METER_MIN, SKY_METER_MAX) }}
          />
        )}
      </Box>
      <Box className={classes.tickLabel} aria-hidden="true" style={{ insetInlineStart: tickAt }}>
        {SKY_DARK_THRESHOLD}
      </Box>
    </Box>
  )
}

/** A reading against a limit: a muted fill with a tick at `target`. A missing reading keeps the track and tick. */
function gauge(label: string, value: number | null, max: number, target: number | null): ReactNode {
  return (
    <Meter
      label={label}
      value={value}
      max={max}
      {...(target === null ? {} : { target })}
      tone="muted"
      size="row"
    />
  )
}

/** The Core cell: the altitude at the sample closest to the gate against a gate tick; the transit time alone when there is no dark stretch. */
function coreCell(night: Night): StatStripCell {
  const core = coreMeterReading(night)
  if (core === null) {
    return {
      key: 'core',
      caption: 'Core',
      value: night.localTransit,
      unit: 'transit',
      footer: coreTransitFooter(night),
    }
  }
  return {
    key: 'core',
    caption: 'Core',
    value: fmtDegrees(core.reading),
    unit: CORE_UNIT,
    visual: gauge(
      `Core ${fmtDegrees(core.reading)} against a gate of ${fmtDegrees(core.gate)}`,
      core.reading,
      coreGaugeMax(core.gate),
      core.gate,
    ),
    footer: `gate ${fmtDegrees(core.gate)} · ${coreTransitFooter(night)}`,
  }
}

/**
 * The selected night in five readings — Dark, Core, Moon, Cloud, Sky — as a `StatGroup` strip. Every micro-visual is a reading against a target: the core and the moon against their gates, low cloud against the engine's ruin level, the sky against the dark threshold.
 */
export function NightAnatomy({
  night,
  location,
  moonLimit,
  cloudLimit,
}: {
  night: Night
  location: Location
  moonLimit: number
  /** Low-cloud cover (percent) at which the engine rates the layer ruinous. */
  cloudLimit: number | undefined
}) {
  const { timeZone } = location
  const limitPct = Math.round(moonLimit * 100)
  const moonPct = Math.round(night.moon.illumination * 100)
  const sky = location.darknessSource === 'unknown' ? null : location.coreDirectionMpsas
  const moonSet = night.moon.set === null ? null : fmtLocalClock(night.moon.set, timeZone)
  const cloud = lowCloudStat(night, cloudLimit)

  return (
    <Box data-shot="night-anatomy">
      <StatGroup
        variant="strip"
        label="Night anatomy"
        cols={5}
        cells={[
          {
            key: 'dark',
            caption: 'Dark',
            value:
              night.darkMinutes > 0
                ? `${fmtLocalClock(night.darkStart, timeZone)}–${fmtLocalClock(night.darkEnd, timeZone)}`
                : 'none',
            footer:
              night.darkMinutes > 0
                ? `${fmtMinutes(night.darkMinutes)} astronomical night`
                : 'no astronomical night',
          },
          coreCell(night),
          {
            key: 'moon',
            caption: 'Moon',
            value: fmtPercent(moonPct),
            unit: 'lit',
            visual: gauge(
              `Moon ${moonPct} percent against a ${limitPct} percent limit`,
              moonPct,
              100,
              limitPct,
            ),
            footer: moonFooter({
              limit: fmtPercent(limitPct),
              phase: moonPhaseLabel(night.moon.phase),
              set: moonSet,
            }),
          },
          {
            key: 'cloud',
            caption: 'Cloud cover',
            value: cloud?.value ?? null,
            ...(cloud === null ? {} : { unit: cloud.unit }),
            // A bar with no limit answers nothing: drawn only against the limit the value is scored on.
            ...(cloud === null || cloud.target === null
              ? {}
              : {
                  visual: gauge(
                    `Low cloud ${cloud.value} against a limit of ${cloud.target} percent`,
                    cloud.reading,
                    100,
                    cloud.target,
                  ),
                }),
            footer: cloud === null ? 'no cloud data' : cloudFooter(cloud),
          },
          {
            key: 'sky',
            caption: 'Sky',
            value: sky === null ? null : sky.toFixed(2),
            ...(sky === null ? {} : { unit: 'mag/arcsec²' }),
            visual: <SkyScale mpsas={sky} />,
            footer: skyCellFooter({
              domePenaltyMag: location.domePenaltyMag,
              transparency: night.weather.transparency,
            }),
          },
        ]}
      />
    </Box>
  )
}
