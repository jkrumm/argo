import { useState } from 'react'
import {
  Accordion,
  Box,
  Checkbox,
  CloseButton,
  Drawer,
  Group,
  Radio,
  RangeSlider,
  ScrollArea,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  VisuallyHidden,
} from '@mantine/core'
import { VX } from 'basalt-ui/tokens'
import {
  BASE_LAYERS,
  DEFAULT_LP_YEAR,
  formatLpParam,
  HILLSHADE_METHOD_DEFAULT,
  isBaseLayerId,
  isHillshadeMethod,
  isLpResampling,
  LP_OPACITY_DEFAULT,
  LP_PARAM_OFF,
  LP_RANGE_FULL,
  LP_RANGE_MAX,
  LP_RANGE_MIN,
  LP_RANGE_MIN_WIDTH,
  LP_RANGE_STEP,
  LP_RESAMPLING_DEFAULT,
  LP_YEAR_NOTES,
  LP_YEARS,
  parseLpParam,
  TRAILS_DEFAULT_OPACITY,
  TRAILS_DESCRIPTION,
  TRAILS_LABEL,
  WEATHER_LAYERS,
  weatherLayer,
  type LpResampling,
  type MapLayerState,
  type TerrainSelection,
  type WeatherLayerId,
} from '../map-layers'

/**
 * The map's layer controls, rendered ENTIRELY from the catalogue in `map-layers.ts` — no control
 * is written per layer, so adding a source is a new row in the table and nothing here changes.
 *
 * Docked, not overlaid: every control below repaints the map live, so a panel that COVERS the map
 * while it is being configured means configuring blind — the original `Drawer` this component used
 * to be did exactly that, and the fix is structural rather than cosmetic. On a wide viewport
 * `MapSettingsPanel` renders as a fixed-width column (`SETTINGS_PANEL_WIDTH`) docked beside the
 * map — `site-map.tsx` sizes it as a sibling in a flex row, so the map SHRINKS to make room rather
 * than getting covered. Below the `(max-width: 48em)` breakpoint there is no room to dock a 320px
 * column next to a still-usable map, so the exact same `MapLayerSections` markup mounts inside a
 * `Drawer` instead — the one mount that still overlays, because at that width there is no live map
 * underneath worth protecting. Both mounts render the identical section stack; only the chrome
 * around it (docked column vs. overlay) differs, driven by the `narrow` prop `site-map.tsx` already
 * needs for its own layout decision.
 *
 * The base map and the pollution ramp are independent controls — a raster base (Satellite,
 * Topographic) and the ramp can be on together. Readability across that combination is the
 * ramp's own opacity/sensitivity dial (below), not a rule this component enforces; an earlier
 * version silently swung the base back to a vector style the moment a year was picked, which read
 * as the panel fighting its own user rather than reflecting one.
 *
 * The `off` value and the year encoding likewise come from `formatLpParam`/`parseLpParam`, so the
 * radio group and the search param cannot disagree about how a year is spelled.
 */

/** Percent steps — a 1 % opacity slider is a precision nobody wants on a raster wash. */
const OPACITY_STEP = 5

/** The docked column's fixed width — narrow enough to leave the map most of the card, wide enough
 * that the sliders and segmented controls below don't wrap. Below the `(max-width: 48em)` mobile
 * breakpoint this component never renders it; see the module docblock. */
const SETTINGS_PANEL_WIDTH = 320

/** Sections opened by default — the two controls read most often (what's the base, how bright is
 * the sky) stay visible; terrain and the live weather overlays start collapsed. */
const DEFAULT_OPEN_SECTIONS = ['base', 'lp']

export type MapSettingsPanelProps = {
  opened: boolean
  onClose: () => void
  /** Below `(max-width: 48em)` there is no room to dock a column next to a usable map — this
   * component falls back to the overlay `Drawer` it used to always be. Computed once in
   * `site-map.tsx` (which needs the same breakpoint for its own layout) rather than re-queried
   * here, so the two never disagree about which mode is active. */
  narrow: boolean
  state: MapLayerState
  onChange: (next: MapLayerState) => void
}

export function MapSettingsPanel({
  opened,
  onClose,
  narrow,
  state,
  onChange,
}: MapSettingsPanelProps) {
  if (narrow) {
    return (
      <Drawer opened={opened} onClose={onClose} position="right" size="md" title="Map layers">
        <MapLayerSections state={state} onChange={onChange} />
      </Drawer>
    )
  }

  // Collapsed: render nothing, not a zero-width column — a `width: 0` box still costs a flex
  // sibling and a hairline, and `site-map.tsx`'s map column can't fully reclaim the width.
  if (!opened) return null

  return (
    <Box
      h="100%"
      style={{
        width: SETTINGS_PANEL_WIDTH,
        flexShrink: 0,
        borderLeft: `1px solid ${VX.surface.border}`,
      }}
    >
      <ScrollArea h="100%" type="hover" scrollbars="y" scrollbarSize={9}>
        <Stack gap="sm" p="sm">
          <Group justify="space-between" wrap="nowrap" align="center">
            <Text fw={600} size="sm">
              Map layers
            </Text>
            {/* A second close control: the map-corner toggle that opens this panel is easy to
                lose at 320px once the eye has moved into the controls below it. */}
            <CloseButton aria-label="Hide map layers" onClick={onClose} />
          </Group>
          <MapLayerSections state={state} onChange={onChange} />
        </Stack>
      </ScrollArea>
    </Box>
  )
}

/**
 * The section stack itself — every layer control, shared verbatim between the docked column and
 * the narrow-viewport `Drawer` (see the module docblock). Collapsible via a plain Mantine
 * `Accordion` — `Accordion.Control` carries the section's title (the ONLY visible heading; an
 * earlier version also wrapped each panel's body in `SettingsSection`, whose own title rendered a
 * second, identical heading and whose Card nested a third surface inside the accordion panel
 * inside the docked column). `Accordion.Panel`'s first child is the section's description, plain
 * dimmed text — the same copy `SettingsSection` used to carry, now with nothing wrapping it.
 */
function MapLayerSections({
  state,
  onChange,
}: {
  state: MapLayerState
  onChange: (next: MapLayerState) => void
}) {
  const handleBase = (next: string) => {
    // A hand-edited URL or a stray value must not smuggle an unknown id into the paint
    // property — ignore the change rather than throw, the same contract every codec in this
    // module already keeps.
    if (!isBaseLayerId(next)) return
    onChange({ ...state, base: next })
  }

  const handleLp = (next: string) => {
    // The radio's own value is always a bare year or `off` — never the
    // `:<percent>[:<smooth|sharp>[:<min>-<max>]]` suffixes `parseLpParam` also understands — so
    // only the decoded year matters here.
    const { year: lpYear } = parseLpParam(next)
    onChange({ ...state, lpYear })
  }

  const handleLpOpacity = (opacity: number) => {
    onChange({ ...state, lpOpacity: opacity })
  }

  const handleLpResampling = (resampling: LpResampling) => {
    onChange({ ...state, lpResampling: resampling })
  }

  const handleLpRange = (range: readonly [number, number]) => {
    onChange({ ...state, lpRange: range })
  }

  const handleWeatherToggle = (id: WeatherLayerId, active: boolean) => {
    const entry = weatherLayer(id)
    if (entry === undefined) return
    const weather = active
      ? [...state.weather, { id, opacity: entry.defaultOpacity }]
      : state.weather.filter((selection) => selection.id !== id)
    onChange({ ...state, weather })
  }

  const handleOpacity = (id: WeatherLayerId, opacity: number) => {
    onChange({
      ...state,
      weather: state.weather.map((selection) =>
        selection.id === id ? { ...selection, opacity } : selection,
      ),
    })
  }

  const handleTerrain = (patch: Partial<TerrainSelection>) => {
    onChange({ ...state, terrain: { ...state.terrain, ...patch } })
  }

  const handleTrailsToggle = (active: boolean) => {
    handleTerrain({ trails: active ? TRAILS_DEFAULT_OPACITY : null })
  }

  const handleHillshadeMethod = (next: string) => {
    handleTerrain({ hillshadeMethod: isHillshadeMethod(next) ? next : HILLSHADE_METHOD_DEFAULT })
  }

  return (
    <Stack gap="sm">
      <Accordion multiple defaultValue={DEFAULT_OPEN_SECTIONS}>
        <Accordion.Item value="base">
          <Accordion.Control>Base map</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                One at a time — the base is the whole style, not an overlay.
              </Text>
              <Radio.Group
                value={state.base}
                onChange={handleBase}
                // `Accordion.Control` above renders the visible "Base map" heading; this label
                // is for the accessibility tree only — Mantine wires it to the group via
                // `aria-labelledby` regardless of whether it is rendered visibly.
                label={<VisuallyHidden>Base map</VisuallyHidden>}
              >
                <Stack gap="xs">
                  {BASE_LAYERS.map((entry) => (
                    <Radio
                      key={entry.id}
                      value={entry.id}
                      label={entry.label}
                      description={entry.description}
                    />
                  ))}
                </Stack>
              </Radio.Group>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="lp">
          <Accordion.Control>Light pollution</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                Lorenz atlas sky brightness, painted in this app&apos;s own ramp. Blue is dark sky.
              </Text>
              <Stack gap="xs">
                <Radio.Group
                  // Always encoded at the default opacity/resampling/range: the radio's own
                  // values are bare years (or `off`), never the
                  // `:<percent>[:<smooth|sharp>[:<min>-<max>]]` suffixes — see `handleLp`.
                  value={formatLpParam({
                    year: state.lpYear,
                    opacity: LP_OPACITY_DEFAULT,
                    resampling: LP_RESAMPLING_DEFAULT,
                    range: LP_RANGE_FULL,
                  })}
                  onChange={handleLp}
                  label={<VisuallyHidden>Light pollution</VisuallyHidden>}
                >
                  <Stack gap="xs">
                    {LP_YEARS.toReversed().map((year) => (
                      <Radio
                        key={year}
                        value={String(year)}
                        label={String(year)}
                        description={LP_YEAR_NOTES[year]}
                      />
                    ))}
                    <Radio value={LP_PARAM_OFF} label="Off" description="Basemap only." />
                  </Stack>
                </Radio.Group>
                {state.lpYear !== null && (
                  <>
                    <OpacitySlider
                      label="Light pollution"
                      value={state.lpOpacity}
                      onCommit={handleLpOpacity}
                    />
                    <SegmentedControl
                      value={state.lpResampling}
                      onChange={(value) => {
                        // Same ignore-rather-than-throw contract as `handleBase` above.
                        if (isLpResampling(value)) handleLpResampling(value)
                      }}
                      data={[
                        { label: 'Smooth', value: 'linear' },
                        { label: 'Sharp', value: 'nearest' },
                      ]}
                      fullWidth
                    />
                    <Text size="xs" c="dimmed">
                      Smooth interpolates between the atlas&apos;s 30 arcsecond samples. Sharp shows
                      their true block size instead — the atlas stops at zoom 9, so anything closer
                      is genuinely how coarse the data is, not a rendering choice.
                    </Text>
                    <LpRangeSlider range={state.lpRange} onCommit={handleLpRange} />
                    <Text size="xs" c="dimmed">
                      Narrowing the range spends the whole ramp on that brightness window — how you
                      tell 21.3 from 21.6.
                    </Text>
                  </>
                )}
              </Stack>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="terrain">
          <Accordion.Control>Terrain</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                The other half of the sky budget the ramp cannot see: which ridge is in the way.
              </Text>
              <Stack gap="xs">
                <Checkbox
                  checked={state.terrain.hillshade}
                  onChange={(event) => handleTerrain({ hillshade: event.currentTarget.checked })}
                  label="Hillshade"
                  description="Flat-toned relief from the same DEM the horizon march reads."
                />
                {state.terrain.hillshade && (
                  <>
                    <SegmentedControl
                      value={state.terrain.hillshadeMethod}
                      onChange={handleHillshadeMethod}
                      data={[
                        { label: 'Standard', value: 'standard' },
                        { label: 'Multidirectional', value: 'multidirectional' },
                        { label: 'Igor', value: 'igor' },
                      ]}
                      fullWidth
                    />
                    <Text size="xs" c="dimmed">
                      Igor: flat-toned, reads best over a coloured base. Standard: one low sun,
                      strongest shadows. Multidirectional: four lights, softest.
                    </Text>
                    <OpacitySlider
                      label="Hillshade"
                      unit="exaggeration"
                      value={state.terrain.hillshadeExaggeration}
                      onCommit={(exaggeration) =>
                        handleTerrain({ hillshadeExaggeration: exaggeration })
                      }
                    />
                  </>
                )}
                <Checkbox
                  checked={state.terrain.extruded}
                  onChange={(event) => handleTerrain({ extruded: event.currentTarget.checked })}
                  label="3D terrain"
                  description="Tilts the map into real relief — heavier to render, off by default."
                />
                <Checkbox
                  checked={state.terrain.contours}
                  onChange={(event) => handleTerrain({ contours: event.currentTarget.checked })}
                  label="Contour lines"
                  description="Elevation isolines generated on the fly from the shared DEM. OpenTopoMap's own base tiles already carry contours of their own — turning this on with that base picked just doubles them up, harmlessly."
                />
                <Checkbox
                  checked={state.terrain.trails !== null}
                  onChange={(event) => handleTrailsToggle(event.currentTarget.checked)}
                  label={TRAILS_LABEL}
                  description={TRAILS_DESCRIPTION}
                />
                {state.terrain.trails !== null && (
                  <OpacitySlider
                    label={TRAILS_LABEL}
                    value={state.terrain.trails}
                    onCommit={(opacity) => handleTerrain({ trails: opacity })}
                  />
                )}
              </Stack>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="weather">
          <Accordion.Control>Weather now</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                Live overlays. Each one is somebody else&apos;s free server — leave on only what you
                are reading.
              </Text>
              <Stack gap="sm">
                {WEATHER_LAYERS.map((entry) => {
                  const selection = state.weather.find((active) => active.id === entry.id)
                  return (
                    <Stack key={entry.id} gap={4}>
                      <Checkbox
                        checked={selection !== undefined}
                        onChange={(event) =>
                          handleWeatherToggle(entry.id, event.currentTarget.checked)
                        }
                        label={entry.label}
                        description={entry.description}
                      />
                      <Text size="xs" c="dimmed">
                        Coverage: {entry.coverage}
                      </Text>
                      {selection !== undefined && (
                        <OpacitySlider
                          label={entry.label}
                          value={selection.opacity}
                          onCommit={(opacity) => handleOpacity(entry.id, opacity)}
                        />
                      )}
                    </Stack>
                  )
                })}
              </Stack>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <Text size="xs" c="dimmed">
        Every choice here is in the URL, so a configured map can be linked and survives a reload.
        The pollution ramp defaults to {DEFAULT_LP_YEAR}, the latest published atlas.
      </Text>
    </Stack>
  )
}

/**
 * A `[0, 1]` value on a percent slider, committed once per drag — opacity's shape, but generic
 * enough for anything on the same domain (`hillshade-exaggeration` is `[0, 1]` too).
 *
 * The slider moves on a local draft and only writes on `onChangeEnd`, because the committed value
 * is a URL search param: writing on every `onChange` would push a router navigation per pixel of
 * travel. The draft re-seeds when the committed value changes underneath it (a shared link opened
 * with a different value already baked in), which is the documented derive-state-during-render
 * pattern rather than an effect.
 */
function OpacitySlider({
  label,
  value,
  onCommit,
  unit = 'opacity',
}: {
  label: string
  value: number
  onCommit: (next: number) => void
  /** The accessible label's unit word — `"opacity"` for every overlay slider except
   * `hillshade-exaggeration`, which reads "Hillshade exaggeration", not "Hillshade opacity". */
  unit?: string
}) {
  const percent = Math.round(value * 100)
  const [draft, setDraft] = useState(percent)
  const [committed, setCommitted] = useState(percent)
  if (committed !== percent) {
    setCommitted(percent)
    setDraft(percent)
  }

  return (
    <Slider
      value={draft}
      onChange={setDraft}
      onChangeEnd={(next) => onCommit(next / 100)}
      min={0}
      max={100}
      step={OPACITY_STEP}
      label={(current) => `${current}%`}
      // Per-layer, not the static "Layer opacity": with two overlays active a
      // shared label would announce two identically-named sliders.
      aria-label={`${label} ${unit}`}
    />
  )
}

/**
 * The ramp's SENSITIVITY control — where `OpacitySlider` above is INTENSITY (the wash's own
 * opacity), this narrows the mag×100 DOMAIN the ramp's eleven stops get remapped onto
 * (`remapLpRampStops`, `map-layers.ts`), so the whole ramp can be spent on a band as narrow as
 * the one an actual scouting trip cares about.
 *
 * Same discipline as `OpacitySlider`: a local draft, committed once on `onChangeEnd` — the range
 * is a URL search param (two numbers, not one), so writing on every drag frame would push a
 * router navigation per pixel of travel. The draft re-seeds from the committed value with the
 * same derive-during-render pattern, not an effect.
 */
function LpRangeSlider({
  range,
  onCommit,
}: {
  range: readonly [number, number]
  onCommit: (next: readonly [number, number]) => void
}) {
  const [draft, setDraft] = useState<[number, number]>([range[0], range[1]])
  const [committed, setCommitted] = useState<readonly [number, number]>(range)
  if (committed[0] !== range[0] || committed[1] !== range[1]) {
    setCommitted(range)
    setDraft([range[0], range[1]])
  }

  return (
    <RangeSlider
      value={draft}
      onChange={setDraft}
      onChangeEnd={(next) => onCommit(next)}
      min={LP_RANGE_MIN}
      max={LP_RANGE_MAX}
      step={LP_RANGE_STEP}
      // Same floor `parseLpRange` enforces (see `LP_RANGE_MIN_WIDTH`'s doc) — the control must
      // not be able to express a window the codec would reject on the next reload.
      minRange={LP_RANGE_MIN_WIDTH}
      label={(value) => (value / 100).toFixed(1)}
      // A bare `aria-label` on `RangeSlider` lands on the outer container, not the two
      // focusable `role="slider"` thumbs — `thumbFromLabel`/`thumbToLabel` are what Mantine
      // actually wires to each thumb (verified against the installed `RangeSlider.d.ts`).
      thumbFromLabel="Minimum sky brightness"
      thumbToLabel="Maximum sky brightness"
    />
  )
}
