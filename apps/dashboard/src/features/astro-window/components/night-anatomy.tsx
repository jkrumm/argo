import type { CSSProperties, ReactNode } from 'react'
import { Box, Card } from '@mantine/core'
import { CORE_METER_MAX_DEG, SKY_DARK_THRESHOLD, SKY_METER_MAX, SKY_METER_MIN } from '../constants'
import { fmtDegrees, fmtLocalClock, fmtMinutes, moonPhaseLabel } from '../formulas'
import { LP_RAMP, LP_RAMP_MAX, LP_RAMP_MIN } from '../map-layers'
import type { Location, Night } from '../types'
import classes from './night-anatomy.module.css'

const pct = (value: number, min: number, max: number) =>
  `${Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))}%`

function Cell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box className={classes.cell}>
      <span className={classes.title}>{title}</span>
      {children}
    </Box>
  )
}

function Value({ children, unit }: { children: ReactNode; unit?: string | undefined }) {
  return (
    <span className={classes.value}>
      {children}
      {unit !== undefined && <span className={classes.unit}>{unit}</span>}
    </span>
  )
}

/** A neutral fill to `value` on a `min`–`max` track with a tick at `target` — a reading against a limit. */
function Gauge({
  value,
  max,
  target,
  label,
}: {
  value: number | null
  max: number
  target: number | null
  label: string
}) {
  return (
    <Box className={classes.track} role="img" aria-label={label}>
      {value !== null && <Box className={classes.fill} style={{ width: pct(value, 0, max) }} />}
      {target !== null && (
        <Box className={classes.tick} style={{ insetInlineStart: pct(target, 0, max) }} />
      )}
    </Box>
  )
}

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

function CloudLayer({ label, value }: { label: string; value: number | null }) {
  return (
    <Box className={classes.layer}>
      <span>{label}</span>
      <Box className={classes.track}>
        {value !== null && <Box className={classes.fill} style={{ width: pct(value, 0, 100) }} />}
      </Box>
      <span className={classes.layerValue}>{value === null ? '—' : `${Math.round(value)} %`}</span>
    </Box>
  )
}

/**
 * The selected night in five readings — Dark, Core, Moon, Cloud, Sky — in one card divided by
 * hairlines (prototype of `StatGroup variant="strip"`). Every micro-visual is a reading against a
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
    <Card py="sm" px="md" data-shot="night-anatomy">
      <Box className={classes.host}>
        <Box className={classes.grid}>
          <Cell title="Dark">
            <Value>
              {night.darkMinutes > 0
                ? `${fmtLocalClock(night.darkStart, timeZone)}–${fmtLocalClock(night.darkEnd, timeZone)}`
                : 'none'}
            </Value>
            <span className={classes.qualifier}>
              {night.darkMinutes > 0
                ? `${fmtMinutes(night.darkMinutes)} astronomical night`
                : 'no astronomical night'}
            </span>
          </Cell>

          <Cell title="Core">
            <Value unit={reading === null ? undefined : 'at closest to the gate'}>
              {reading === null ? '—' : fmtDegrees(reading)}
            </Value>
            <Gauge
              value={reading}
              max={CORE_METER_MAX_DEG}
              target={gate}
              label={
                gate === null ? 'Core altitude' : `Core altitude against a ${fmtDegrees(gate)} gate`
              }
            />
            <span className={classes.qualifier}>
              {gate === null ? 'no gate' : `gate ${fmtDegrees(gate)}`} · transit{' '}
              {night.localTransit}
            </span>
          </Cell>

          <Cell title="Moon">
            <Value unit="lit">{moonPct} %</Value>
            <Gauge
              value={moonPct}
              max={100}
              target={limitPct}
              label={`Moon ${moonPct} percent against a ${limitPct} percent limit`}
            />
            <span className={classes.qualifier}>
              limit {limitPct} % · {moonPhaseLabel(night.moon.phase)}
              {moonSet === null ? '' : ` · sets ${moonSet}`}
            </span>
          </Cell>

          <Cell title="Cloud">
            <CloudLayer label="low" value={weather.cloudLow} />
            <CloudLayer label="mid" value={weather.cloudMid} />
            <CloudLayer label="high" value={weather.cloudHigh} />
          </Cell>

          <Cell title="Sky">
            <Value unit={sky === null ? undefined : 'mag/arcsec²'}>
              {sky === null ? '—' : sky.toFixed(2)}
            </Value>
            <SkyScale mpsas={sky} />
            <span className={classes.qualifier}>
              {location.domePenaltyMag === null
                ? 'dome —'
                : `dome +${location.domePenaltyMag.toFixed(2)} mag brighter`}
              {' · '}transparency{' '}
              {weather.transparency === null ? '—' : `${weather.transparency}/8, 1 = clearest`}
            </span>
          </Cell>
        </Box>
      </Box>
    </Card>
  )
}
