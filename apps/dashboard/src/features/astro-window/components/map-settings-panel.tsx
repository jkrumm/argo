import { useState } from 'react'
import {
  Accordion,
  Checkbox,
  Radio,
  RangeSlider,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  VisuallyHidden,
} from '@mantine/core'
import {
  BASE_LAYERS,
  DEFAULT_LP_YEAR,
  formatLpParam,
  HILLSHADE_METHOD_DEFAULT,
  isBaseLayerId,
  isHillshadeMethod,
  isLpResampling,
  isOmDomainId,
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
  OM_DOMAINS,
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
 * `MapLayerSections` is mounted by `site-map.tsx` inside a `PageAside` — basalt's shell aside
 * region owns the docked-column-vs-overlay chrome (desktop column, phone `Panel` pill) that this
 * module used to hand-roll as `MapSettingsPanel`; every control below still repaints the map
 * live, so configuring never happens with the map covered.
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

/** Sections opened by default — the two controls read most often (what's the base, how bright is
 * the sky) stay visible; terrain and the live weather overlays start collapsed. */
const DEFAULT_OPEN_SECTIONS = ['base', 'lp']

/**
 * `WEATHER_LAYERS` split in two — OBSERVATION rows (radar/lightning/cloud/cloud-ir/cloud-top,
 * "what is the sky doing now") render in the existing "Weather now" section below;
 * `'om-model'` rows (2026-08-20, "what is a model expecting next") get their own "Forecast"
 * section with the domain picker in front of them. Split once at module scope rather than
 * filtering inline in two render paths, so the two lists can never silently drift out of sync
 * with each other.
 */
const OBSERVATION_WEATHER_LAYERS = WEATHER_LAYERS.filter((entry) => entry.source !== 'om-model')
const MODEL_WEATHER_LAYERS = WEATHER_LAYERS.filter((entry) => entry.source === 'om-model')

/**
 * The section stack itself — every layer control, mounted verbatim inside `site-map.tsx`'s
 * `PageAside`. Collapsible via a plain Mantine `Accordion` — `Accordion.Control` carries the
 * section's title (the ONLY visible heading; an earlier version also wrapped each panel's body in
 * `SettingsSection`, whose own title rendered a second, identical heading and whose Card nested a
 * third surface inside the accordion panel inside the aside). `Accordion.Panel`'s first child is
 * the section's description, plain dimmed text — the same copy `SettingsSection` used to carry,
 * now with nothing wrapping it.
 */
export function MapLayerSections({
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

  const handleOmDomain = (next: string) => {
    // Same ignore-rather-than-throw contract as `handleBase`/`handleLpResampling` above — a
    // hand-edited URL or a stray value must not smuggle an unknown domain id into a tile request.
    if (isOmDomainId(next)) onChange({ ...state, omDomain: next })
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
                  description="Shades the slopes so the ground reads as ridges and valleys instead of flat colour — which peak stands between a spot and the southern sky, and where the walk in actually climbs. Drawn ON TOP of the pollution ramp, so it survives with the ramp on."
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
                      Igor: flat-toned, the default — the only one that keeps the ramp&apos;s colour
                      readable underneath it. Standard: one low sun, deeper shadows, slightly
                      flatter over the ramp. Multidirectional: four lights, and over the ramp it
                      crushes the darker slopes to black.
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
                {OBSERVATION_WEATHER_LAYERS.map((entry) => {
                  const selection = state.weather.find((active) => active.id === entry.id)
                  return (
                    <Stack key={entry.id} gap={4}>
                      <Checkbox
                        checked={selection !== undefined}
                        onChange={(event) =>
                          handleWeatherToggle(entry.id, event.currentTarget.checked)
                        }
                        label={entry.label}
                        // One dimmed paragraph, not a separate "Coverage:" line underneath — the
                        // user's own words were that this panel is already overcomplicated.
                        description={`${entry.description} Coverage: ${entry.coverage}`}
                      />
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

        <Accordion.Item value="forecast">
          <Accordion.Control>Forecast (model)</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                Open-Meteo&apos;s own NWP model fields — smooth and forward-looking where the
                satellite mask above is sharp-edged and &quot;now only&quot;. Pick the domain first;
                its own box is where all three rows below stop painting.
              </Text>
              <Radio.Group
                value={state.omDomain}
                onChange={handleOmDomain}
                label={<VisuallyHidden>Forecast domain</VisuallyHidden>}
              >
                <Stack gap="xs">
                  {OM_DOMAINS.map((domain) => (
                    <Radio
                      key={domain.id}
                      value={domain.id}
                      label={`${domain.label} (${domain.resolution})`}
                      description={`${domain.coverage} ${domain.horizon}`}
                    />
                  ))}
                </Stack>
              </Radio.Group>
              <Stack gap="sm">
                {MODEL_WEATHER_LAYERS.map((entry) => {
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
