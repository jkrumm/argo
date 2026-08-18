import { useState } from 'react'
import { Alert, Badge, Button, Drawer, Group, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { EdenFetchError } from '@elysiajs/eden'
import { DeltaBadge, SettingsSection } from 'basalt-ui'
import { LineSparkline } from 'basalt-ui/charts'
import { astroQueries } from '../../../lib/queries/astro'
import { fmtDegrees, fmtMinutes } from '../formulas'
import type { Site } from '../types'

/**
 * Click-anywhere scouting — the map's other half. Light pollution and the skyline load as soon
 * as a coordinate is clicked (cheap, cached hard, `staleTime: Infinity` like every other astro
 * query); the annual budget stays behind an explicit "measure" action because it is a DEM fetch
 * plus a 373 ms integral for THIS exact point, not something to fire on every click
 * (`docs/ASTRO-HORIZON-RESEARCH.md` §4.3, §5).
 *
 * The comparison against the currently selected site is the entire point of this panel — every
 * number rides next to a `DeltaBadge` rather than sitting in a second table.
 */

const SPARK_W = 240
const SPARK_H = 40

export type ScoutPanelProps = {
  opened: boolean
  onClose: () => void
  /** The last clicked coordinate. `null` before the first click. */
  point: { lat: number; lon: number } | null
  /** The currently selected site — undefined only if the site list hasn't resolved it (dead link). */
  compareSite: Site | undefined
}

/** Eden wraps a non-2xx response in this; `.value` is the API's own message string for every
 * documented failure mode here (422 near a pole / incomplete coords, 502 DEM or atlas down) —
 * showing it verbatim is more honest than inventing a paraphrase. */
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof EdenFetchError && typeof error.value === 'string') return error.value
  if (error instanceof Error) return error.message
  return fallback
}

function ScoutError({ error, fallback }: { error: unknown; fallback: string }) {
  return (
    <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={14} />} py="xs">
      <Text size="xs">{errorMessage(error, fallback)}</Text>
    </Alert>
  )
}

function ScoutRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text ff="monospace" size="xs" fw={500} ta="right">
        {value}
      </Text>
    </Group>
  )
}

/** "Provisional" — a partial DEM profile presented as measured would be a fabricated skyline
 * (`docs/ASTRO-HORIZON-RESEARCH.md` §3), so `complete: false` / `horizonComplete: false` gets a
 * visible flag rather than silently blending into the number next to it. */
function ProvisionalBadge() {
  return (
    <Badge color="gray" variant="light" size="sm" tt="none" fw={500} w="fit-content">
      Provisional — a DEM tile failed to resolve
    </Badge>
  )
}

export function ScoutPanel({ opened, onClose, point, compareSite }: ScoutPanelProps) {
  const hasPoint = point !== null
  const pointKey = point === null ? null : `${point.lat},${point.lon}`

  // Derived during render, not an effect: a new click changes `pointKey`, which alone makes
  // `measureRequested` false again for the new point — no reset-on-prop-change effect needed.
  const [measuredKey, setMeasuredKey] = useState<string | null>(null)
  const measureRequested = measuredKey !== null && measuredKey === pointKey

  const lightPollutionQuery = useQuery({
    ...astroQueries.lightPollution(point ?? { lat: 0, lon: 0 }),
    enabled: hasPoint,
  })
  const horizonQuery = useQuery({
    ...astroQueries.horizon(point ?? { lat: 0, lon: 0 }),
    enabled: hasPoint,
  })
  // Cheap and deterministic — the site's own committed horizon, no DEM fetch — so it loads
  // alongside the point's own data rather than waiting behind the "measure" button.
  const compareVisibilityQuery = useQuery({
    ...astroQueries.visibility(compareSite ? { site: compareSite.id } : {}),
    enabled: hasPoint && compareSite !== undefined,
  })
  const visibilityQuery = useQuery({
    ...astroQueries.visibility(point ? { lat: point.lat, lon: point.lon, horizon: 'measure' } : {}),
    enabled: measureRequested,
  })

  const horizon = horizonQuery.data
  const southProfile = horizon
    ? horizon.profile
        .filter(
          (p) => p.azimuthDeg >= horizon.southArc.fromDeg && p.azimuthDeg <= horizon.southArc.toDeg,
        )
        .map((p) => p.altitudeDeg)
    : []

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="md" title="Scouted point">
      <Stack gap="sm">
        {point === null ? (
          <Text size="sm" c="dimmed">
            Click anywhere on the map to scout that coordinate.
          </Text>
        ) : (
          <>
            <Text ff="monospace" size="xs" c="dimmed">
              {point.lat.toFixed(4)}, {point.lon.toFixed(4)}
            </Text>

            <SettingsSection
              title="Sky brightness"
              description="Zenith brightness from the Lorenz atlas — the direction the core points can differ."
            >
              {lightPollutionQuery.isLoading ? (
                <Text size="xs" c="dimmed">
                  Loading…
                </Text>
              ) : lightPollutionQuery.isError ? (
                <ScoutError
                  error={lightPollutionQuery.error}
                  fallback="Could not read the light-pollution atlas for this point."
                />
              ) : lightPollutionQuery.data ? (
                <Stack gap={4}>
                  <ScoutRow label="mag/arcsec²" value={lightPollutionQuery.data.mpsas.toFixed(2)} />
                  <ScoutRow label="Lorenz zone" value={lightPollutionQuery.data.zone} />
                  {compareSite && (
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Text size="xs" c="dimmed">
                        vs {compareSite.name}
                      </Text>
                      <DeltaBadge
                        value={lightPollutionQuery.data.mpsas - compareSite.mpsas}
                        format={(v) => `${Math.abs(v).toFixed(2)} mag`}
                      />
                    </Group>
                  )}
                </Stack>
              ) : null}
            </SettingsSection>

            <SettingsSection
              title="Skyline"
              description="Southern-arc terrain profile — the ridge the galactic core actually crosses."
            >
              {horizonQuery.isLoading ? (
                <Text size="xs" c="dimmed">
                  Loading…
                </Text>
              ) : horizonQuery.isError ? (
                <ScoutError
                  error={horizonQuery.error}
                  fallback="Could not fetch a terrain profile for this point."
                />
              ) : horizon ? (
                <Stack gap={6}>
                  {!horizon.complete && <ProvisionalBadge />}
                  {southProfile.length > 0 && (
                    <LineSparkline
                      data={southProfile}
                      width={SPARK_W}
                      height={SPARK_H}
                      ariaLabel="Southern-arc terrain skyline, altitude by azimuth"
                    />
                  )}
                  <ScoutRow label="Ridge max" value={fmtDegrees(horizon.south.maxDeg)} />
                  <ScoutRow label="Ridge mean" value={fmtDegrees(horizon.south.meanDeg)} />
                  {compareSite && (
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Text size="xs" c="dimmed">
                        vs {compareSite.name}
                      </Text>
                      <DeltaBadge
                        value={compareSite.southHorizonDeg - horizon.south.maxDeg}
                        format={(v) => `${Math.abs(v).toFixed(1)}°`}
                      />
                    </Group>
                  )}
                </Stack>
              ) : null}
            </SettingsSection>

            <SettingsSection
              title="Annual budget"
              description="Is this spot worth the drive at all — a deterministic, weather-free year."
            >
              <Stack gap="xs">
                {!measureRequested ? (
                  <>
                    <Button
                      size="xs"
                      variant="default"
                      onClick={() => setMeasuredKey(pointKey)}
                      disabled={!hasPoint}
                    >
                      Measure this spot
                    </Button>
                    <Text size="xs" c="dimmed">
                      Fetches a live terrain profile for this exact point — a DEM tile plus a
                      year-long integral, about a second. Not fetched automatically.
                    </Text>
                  </>
                ) : visibilityQuery.isLoading ? (
                  <Text size="xs" c="dimmed">
                    Measuring…
                  </Text>
                ) : visibilityQuery.isError ? (
                  <ScoutError
                    error={visibilityQuery.error}
                    fallback="Could not measure a terrain profile for this point."
                  />
                ) : visibilityQuery.data ? (
                  <Stack gap={4}>
                    {visibilityQuery.data.horizonComplete === false && <ProvisionalBadge />}
                    <ScoutRow
                      label="Flat gate"
                      value={fmtMinutes(visibilityQuery.data.flat.minutes)}
                    />
                    <ScoutRow
                      label="Terrain gate"
                      value={fmtMinutes(visibilityQuery.data.terrain.minutes)}
                    />
                    <ScoutRow
                      label="+ moon behind terrain"
                      value={fmtMinutes(visibilityQuery.data.terrainMoon.minutes)}
                    />
                    <ScoutRow
                      label="Terrain binds"
                      value={`${Math.round(visibilityQuery.data.terrainBindsFraction * 100)}%`}
                    />
                    {compareSite && compareVisibilityQuery.data && (
                      <Group justify="space-between" wrap="nowrap" gap="xs">
                        <Text size="xs" c="dimmed">
                          vs {compareSite.name} (terrain hours)
                        </Text>
                        <DeltaBadge
                          value={
                            visibilityQuery.data.terrain.minutes -
                            compareVisibilityQuery.data.terrain.minutes
                          }
                          format={(v) => fmtMinutes(Math.abs(v))}
                        />
                      </Group>
                    )}
                  </Stack>
                ) : null}
              </Stack>
            </SettingsSection>
          </>
        )}
      </Stack>
    </Drawer>
  )
}
