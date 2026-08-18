import { useState } from 'react'
import { Checkbox, Drawer, Radio, Slider, Stack, Text, VisuallyHidden } from '@mantine/core'
import { SettingsSection } from 'basalt-ui'
import {
  BASE_LAYERS,
  baseLayer,
  DEFAULT_LP_YEAR,
  formatLpParam,
  LP_PARAM_OFF,
  LP_YEAR_NOTES,
  LP_YEARS,
  normaliseLayerState,
  parseLpParam,
  WEATHER_LAYERS,
  weatherLayer,
  type BaseLayerId,
  type MapLayerState,
  type WeatherLayerId,
} from '../map-layers'

/**
 * The map's layer controls, rendered ENTIRELY from the catalogue in `map-layers.ts` — no control
 * is written per layer, so adding a source is a new row in the table and nothing here changes.
 *
 * Even the imagery/pollution exclusion (ASTRO-MAP-RESEARCH §6.2 measured it: both are green/brown
 * and the pair is unreadable) is the catalogue's rule, not this component's — `normaliseLayerState`
 * is the same function the URL decoder runs, so the drawer cannot express a state a shared link
 * could not. The rule is also STATED in the LP section's note, because a control that silently
 * switches another control off reads as a bug.
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
  const imageryBase = baseLayer(state.base).kind === 'imagery'

  const handleBase = (next: string) => {
    // Selecting imagery drops the ramp; the note under the pollution section says so.
    onChange(normaliseLayerState({ ...state, base: next as BaseLayerId }))
  }

  const handleLp = (next: string) => {
    const lpYear = parseLpParam(next)
    // The other half of the same rule, and the half `normaliseLayerState` cannot express: asking
    // for the ramp takes the map off imagery rather than dropping the thing just asked for.
    const base = lpYear !== null && imageryBase ? schemeDefaultBase : state.base
    onChange({ ...state, base, lpYear })
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
            {imageryBase && (
              <Text size="xs" c="dimmed">
                Off while satellite imagery is the base: the atlas ramp and the mosaic are both
                green and brown, so the two together are unreadable. Picking a year switches the
                base back to the map style.
              </Text>
            )}
            <Radio.Group
              value={formatLpParam(state.lpYear)}
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
 * Opacity, committed once per drag.
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
}: {
  label: string
  value: number
  onCommit: (next: number) => void
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
      aria-label={`${label} opacity`}
    />
  )
}
