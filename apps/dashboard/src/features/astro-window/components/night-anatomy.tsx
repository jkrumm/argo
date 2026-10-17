import type { CSSProperties, ReactNode } from 'react'
import { Box } from '@mantine/core'
import { Meter, StatGroup, type StatStripRow } from 'basalt-ui'
import { CORE_METER_MAX_DEG, SKY_DARK_THRESHOLD, SKY_METER_MAX, SKY_METER_MIN } from '../constants'
import { fmtDegrees, fmtLocalClock, fmtMinutes, moonPhaseLabel } from '../formulas'
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
  return (
    <Box
      className={classes.track}
      role="img"
      aria-label="Sky brightness on the 18 to 22 mag/arcsec² scale"
    >
      <Box className={classes.ramp} style={rampStyle} />
      <Box
        className={classes.tick}
        style={{ insetInlineStart: pct(SKY_DARK_THRESHOLD, SKY_METER_MIN, SKY_METER_MAX) }}
      />
      {mpsas !== null && (
        <Box
          className={classes.marker}
          style={{ insetInlineStart: pct(mpsas, SKY_METER_MIN, SKY_METER_MAX) }}
        />
      )}
    </Box>
  )
}

function cloudRow(label: string, value: number | null): StatStripRow {
  return {
    key: label,
    label,
    value: value === null ? null : `${Math.round(value)} %`,
    visual:
      value === null ? undefined : (
        <Meter label={`Cloud cover, ${label}`} value={value} max={100} tone="muted" size="row" />
      ),
  }
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

/**
 * The selected night in five readings — Dark, Core, Moon, Cloud, Sky — as a `StatGroup` strip. Every micro-visual is a reading against a
 * target: the core against its gate, the moon against its limit, the sky against the dark threshold.
 */
export function NightAnatomy({
  night,
  location,
  moonLimit,
}: {
  night: Night
  location: Location
  moonLimit: number
}) {
  const { timeZone } = location
  const reading = night.gateCoreAltitude
  const gate = night.coreGateDeg
  const limitPct = Math.round(moonLimit * 100)
  const moonPct = Math.round(night.moon.illumination * 100)
  const sky = location.darknessSource === 'unknown' ? null : location.coreDirectionMpsas
  const moonSet = night.moon.set === null ? null : fmtLocalClock(night.moon.set, timeZone)
  const { weather } = night

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
          {
            key: 'core',
            caption: 'Core',
            value: reading === null ? null : fmtDegrees(reading),
            ...(reading === null ? {} : { unit: 'at closest to the gate' }),
            visual: gauge(
              gate === null ? 'Core altitude' : `Core altitude against a ${fmtDegrees(gate)} gate`,
              reading,
              CORE_METER_MAX_DEG,
              gate,
            ),
            footer: `${gate === null ? 'no gate' : `gate ${fmtDegrees(gate)}`} · transit ${night.localTransit}`,
          },
          {
            key: 'moon',
            caption: 'Moon',
            value: `${moonPct} %`,
            unit: 'lit',
            visual: gauge(
              `Moon ${moonPct} percent against a ${limitPct} percent limit`,
              moonPct,
              100,
              limitPct,
            ),
            footer: `limit ${limitPct} % · ${moonPhaseLabel(night.moon.phase)}${moonSet === null ? '' : ` · sets ${moonSet}`}`,
          },
          {
            key: 'cloud',
            caption: 'Cloud',
            rows: [
              cloudRow('low', weather.cloudLow),
              cloudRow('mid', weather.cloudMid),
              cloudRow('high', weather.cloudHigh),
            ],
          },
          {
            key: 'sky',
            caption: 'Sky',
            value: sky === null ? null : sky.toFixed(2),
            ...(sky === null ? {} : { unit: 'mag/arcsec²' }),
            visual: <SkyScale mpsas={sky} />,
            footer: `${
              location.domePenaltyMag === null
                ? 'dome —'
                : `dome +${location.domePenaltyMag.toFixed(2)} mag brighter`
            } · transparency ${
              weather.transparency === null ? '—' : `${weather.transparency}/8, 1 = clearest`
            }`,
          },
        ]}
      />
    </Box>
  )
}
