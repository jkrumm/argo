import { useEffect, useRef, useState } from 'react'
import { Box, Card, useMantineColorScheme } from '@mantine/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { AttributionControl, Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl'
// Vite's dependency optimizer rewrites maplibre's ESM entry but cannot follow the sibling import
// its worker makes, so the pre-bundled copy 503s at runtime and the map renders a black canvas
// with no error of its own. Routing the worker through Vite's own worker pipeline (`?worker&url`
// — a plain `?url` breaks the production build instead) and handing maplibre the resulting URL is
// the documented fix. Must run before the first `new MapLibreMap(...)`.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
// The map primitive's own stylesheet — imported here (not globally) so it only ships to the
// bundle when this lazy-loaded component is actually reached.
import 'maplibre-gl/dist/maplibre-gl.css'
import { VX } from 'basalt-ui/tokens'
import { astroQueries } from '../../../lib/queries/astro'
import { SIDE_PANEL_HEIGHT } from '../constants'
import { ChartEmpty } from '../charts/empty'

/**
 * OpenFreeMap ships unauthenticated, self-hostable OpenMapTiles-based styles — no API key, no
 * signup. CARTO's basemaps (the usual alternative) require an Enterprise licence or a grant for
 * an app like this one, so they are not a licensed option here.
 */
const STYLE_URL = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
} as const

/*
 * Attribution is contractually required and comes from the SOURCE, not the style: OpenFreeMap's
 * style JSON has none, but the TileJSON it points at (`/planet`) carries the canonical linked
 * string, which MapLibre renders on its own. Passing `customAttribution` as well printed it twice
 * — so the control is mounted bare and the source supplies the text.
 */

const DEFAULT_CENTER: [number, number] = [11.5, 48.1]
const DEFAULT_ZOOM = 6.2

/**
 * MapLibre's `fitBounds` inset, in MAP pixels — not CSS spacing, so no Mantine
 * spacing token can express it. Hoisted out of the effect so the theme guard's
 * inline-spacing kind (which cannot tell a map API argument from a CSS literal)
 * has nothing to trip on.
 */
setWorkerUrl(maplibreWorkerUrl)

const FIT_BOUNDS_OPTIONS = { padding: 48, duration: 0 } as const // theme-allow

export default function SiteMap({
  siteId,
  onSelectSite,
}: {
  siteId: string
  onSelectSite: (id: string) => void
}) {
  const { data } = useSuspenseQuery(astroQueries.sites())
  const { colorScheme } = useMantineColorScheme()
  const resolvedScheme = colorScheme === 'auto' ? 'dark' : colorScheme

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const initialSchemeRef = useRef(resolvedScheme)
  const isFirstStyleRef = useRef(true)
  const hasFitRef = useRef(false)
  const onSelectSiteRef = useRef(onSelectSite)
  onSelectSiteRef.current = onSelectSite
  const [failed, setFailed] = useState(false)

  // Create/destroy exactly once. React 19 StrictMode double-invokes effects, so the create and
  // the teardown must live in the SAME effect with an empty dep array — never split across two.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL[initialSchemeRef.current],
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    })
    map.addControl(new AttributionControl({ compact: true }))
    map.on('error', () => setFailed(true))
    mapRef.current = map

    // The map sizes its canvas once, from whatever the container measured at construction. This
    // component is lazy-loaded behind Suspense, so it is constructed while the grid column is
    // still settling and the canvas ends up narrower than the card it sits in — a black gutter
    // down the right-hand side. MapLibre has no internal resize observer; wiring one is the
    // documented fix, and it also covers the sidebar collapsing.
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Swap the basemap on a live theme toggle — the initial style is already set above.
  useEffect(() => {
    if (isFirstStyleRef.current) {
      isFirstStyleRef.current = false
      return
    }
    mapRef.current?.setStyle(STYLE_URL[resolvedScheme])
  }, [resolvedScheme])

  // Markers: one per site, the selected one visually distinct. Re-synced whenever the site list
  // or the selection changes; must wait for the style to finish loading at least once.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const addMarkers = () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = data.data.map((site) => {
        const el = document.createElement('button')
        el.type = 'button'
        el.setAttribute('aria-label', `Select ${site.name}`)
        el.style.width = '12px'
        el.style.height = '12px'
        el.style.borderRadius = '50%'
        el.style.cursor = 'pointer'
        el.style.padding = '0'
        el.style.border = `2px solid ${VX.surface.panel}`
        el.style.background = site.id === siteId ? VX.accentFill : VX.muted
        el.addEventListener('click', () => onSelectSiteRef.current(site.id))
        return new Marker({ element: el }).setLngLat([site.lon, site.lat]).addTo(map)
      })
    }

    if (map.isStyleLoaded()) addMarkers()
    else map.once('load', addMarkers)

    return () => {
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
    }
  }, [data, siteId])

  // Fit bounds to every site once, on first load only.
  useEffect(() => {
    const map = mapRef.current
    if (!map || hasFitRef.current || data.data.length === 0) return
    hasFitRef.current = true
    const lons = data.data.map((s) => s.lon)
    const lats = data.data.map((s) => s.lat)
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ]
    const fit = () => map.fitBounds(bounds, FIT_BOUNDS_OPTIONS)
    if (map.isStyleLoaded()) fit()
    else map.once('load', fit)
  }, [data])

  return (
    <Card py={0} px={0} h={SIDE_PANEL_HEIGHT} pos="relative" style={{ overflow: 'hidden' }}>
      <Box ref={containerRef} h="100%" style={{ visibility: failed ? 'hidden' : 'visible' }} />
      {failed && (
        <Box pos="absolute" style={{ inset: 0 }}>
          <ChartEmpty
            height={SIDE_PANEL_HEIGHT}
            message="Map unavailable — could not reach the tile server."
          />
        </Box>
      )}
    </Card>
  )
}
