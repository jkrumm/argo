import { createFileRoute, redirect } from '@tanstack/react-router'
import { navTarget } from 'basalt-ui/router-tanstack'
import { NAV } from '../lib/nav'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // The landing destination and its default search come from the one nav definition — no cast,
    // no restated `window: '30d'`.
    throw redirect(navTarget(NAV, 'garmin'))
  },
})
