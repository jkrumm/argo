import { useState } from 'react'
import {
  Checkbox,
  Drawer,
  Radio,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  VisuallyHidden,
} from '@mantine/core'
import { SettingsSection } from 'basalt-ui'
import {
  BASE_LAYERS,
  baseLayer,
  DEFAULT_LP_YEAR,
  formatLpParam,
  LP_OPACITY_DEFAULT,
  LP_PARAM_OFF,
  LP_RESAMPLING_DEFAULT,
  LP_YEAR_NOTES,
  LP_YEARS,
  normaliseLayerState,
  parseLpParam,
  TRAILS_DEFAULT_OPACITY,
  TRAILS_DESCRIPTION,
  TRAILS_LABEL,
  WEATHER_LAYERS,
  weatherLayer,
  type BaseLayerId,
  type LpResampling,
  type MapLayerState,
  type TerrainSelection,
  type WeatherLayerId,
} from '../map-layers'

/**
 * The map's layer controls, rendered ENTIRELY from the catalogue in `map-layers.ts` — no control
 * is written per layer, so adding a source is a new row in the table and nothing here changes.
 *
 * Even the raster/pollution exclusion (ASTRO-MAP-RESEARCH §6.2 measured it for satellite: both are
 * green/brown and the pair is unreadable; OpenTopoMap extends the same rule for its own busy
 * hypsometric tint) is the catalogue's rule, not this component's — `normaliseLayerState` is the
 * same function the URL decoder runs, so the drawer cannot express a state a shared link could
 * not. The rule is also STATED in the LP section's note, because a control that silently switches
 * another control off reads as a bug.
 *
 * The `off` value and the year encoding likewise come from `formatLpParam`/`parseLpParam`, so the
 * radio group and the search param cannot disagree about how a year is spelled.
 */

/** Percent steps — a 1 % opacity slider is a precision nobody wants on a raster wash. */
const OPACITY_STEP = 5

export type MapSettingsDrawerProps = {
  opened: boolean
  onClose: () => void
  state: MapLayerState
  onChange: (next: MapLayerState) => void
  /** The base an untouched URL resolves to — where picking a pollution year sends the base back. */
  schemeDefaultBase: BaseLayerId
}

export function MapSettingsDrawer({
  opened,
  onClose,
  state,
  onChange,
  schemeDefaultBase,
}: MapSettingsDrawerProps) {
  // "Not a vector style" rather than "is imagery": satellite AND OpenTopoMap both carry their own
  // colour, so both trip the same LP exclusion — see `normaliseLayerState` in `map-layers.ts`.
  const rasterBase = baseLayer(state.base).kind !== 'style'

  const handleBase = (next: string) => {
    // Selecting a raster base drops the ramp; the note under the pollution section says so.
    onChange(normaliseLayerState({ ...state, base: next as BaseLayerId }))
  }

  const handleLp = (next: string) => {
    // The radio's own value is always a bare year or `off` — never the `:<percent>[:sharp]`
    // suffixes `parseLpParam` also understands — so only the decoded year matters here.
    const { year: lpYear } = parseLpParam(next)
    // The other half of the same rule, and the half `normaliseLayerState` cannot express: asking
    // for the ramp takes the map off its raster base rather than dropping the thing just asked for.
    const base = lpYear !== null && rasterBase ? schemeDefaultBase : state.base
    onChange({ ...state, base, lpYear })
  }

  const handleLpOpacity = (opacity: number) => {
    onChange({ ...state, lpOpacity: opacity })
  }

  const handleLpResampling = (resampling: LpResampling) => {
    onChange({ ...state, lpResampling: resampling })
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

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="md" title="Map layers">
      <Stack gap="sm">
        <SettingsSection
          title="Base map"
          description="One at a time — the base is the whole style, not an overlay."
        >
          <Radio.Group
            value={state.base}
            onChange={handleBase}
            // `SettingsSection`'s own title above renders the visible "Base map" heading; this
            // label is for the accessibility tree only — Mantine wires it to the group via
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
        </SettingsSection>

        <SettingsSection
          title="Light pollution"
          description="Lorenz atlas sky brightness, painted in this app's own ramp. Blue is dark sky."
        >
          <Stack gap="xs">
            {rasterBase && (
              <Text size="xs" c="dimmed">
                Off while Satellite or Topographic is the base: both carry their own colour — the
                imagery mosaic's green and brown, OpenTopoMap's own hypsometric tint — and the atlas
                ramp on top of either is unreadable. Picking a year switches the base back to a
                vector map style.
              </Text>
            )}
            <Radio.Group
              // Always encoded at the default opacity/resampling: the radio's own values are bare
              // years (or `off`), never the `:<percent>[:sharp]` suffixes — see `handleLp`.
              value={formatLpParam({
                year: state.lpYear,
                opacity: LP_OPACITY_DEFAULT,
                resampling: LP_RESAMPLING_DEFAULT,
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
                  onChange={(value) => handleLpResampling(value as LpResampling)}
                  data={[
                    { label: 'Smooth', value: 'linear' },
                    { label: 'Sharp', value: 'nearest' },
                  ]}
                  fullWidth
                />
                <Text size="xs" c="dimmed">
                  Smooth interpolates between the atlas&apos;s 30 arcsecond samples. Sharp shows
                  their true block size instead — the atlas stops at zoom 9, so anything closer is
                  genuinely how coarse the data is, not a rendering choice.
                </Text>
              </>
            )}
          </Stack>
        </SettingsSection>

        <SettingsSection
          title="Terrain"
          description="The other half of the sky budget the ramp cannot see: which ridge is in the way."
        >
          <Stack gap="xs">
            <Checkbox
              checked={state.terrain.hillshade}
              onChange={(event) => handleTerrain({ hillshade: event.currentTarget.checked })}
              label="Hillshade"
              description="Swiss-style multidirectional relief from the same DEM the horizon march reads."
            />
            {state.terrain.hillshade && (
              <OpacitySlider
                label="Hillshade"
                unit="exaggeration"
                value={state.terrain.hillshadeExaggeration}
                onCommit={(exaggeration) => handleTerrain({ hillshadeExaggeration: exaggeration })}
              />
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
        </SettingsSection>

        <SettingsSection
          title="Weather now"
          description="Live overlays. Each one is somebody else's free server — leave on only what you are reading."
        >
          <Stack gap="sm">
            {WEATHER_LAYERS.map((entry) => {
              const selection = state.weather.find((active) => active.id === entry.id)
              return (
                <Stack key={entry.id} gap={4}>
                  <Checkbox
                    checked={selection !== undefined}
                    onChange={(event) => handleWeatherToggle(entry.id, event.currentTarget.checked)}
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
        </SettingsSection>

        <Text size="xs" c="dimmed">
          Every choice here is in the URL, so a configured map can be linked and survives a reload.
          The pollution ramp defaults to {DEFAULT_LP_YEAR}, the latest published atlas.
        </Text>
      </Stack>
    </Drawer>
  )
}

/**
 * A `[0, 1]` value on a percent slider, committed once per drag — opacity's shape, but generic
 * enough for anything on the same domain (`hillshade-exaggeration` is `[0, 1]` too).
 *
 * The slider moves on a local draft and only writes on `onChangeEnd`, because the committed value
 * is a URL search param: writing on every `onChange` would push a router navigation per pixel of
 * travel. The draft re-seeds when the committed value changes underneath it (a shared link, the
 * other half of an exclusivity flip), which is the documented derive-state-during-render pattern
 * rather than an effect.
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
