import './lib/hyperdx'

import 'basalt-ui/styles.css'
// Beyond `basalt-ui/styles.css`, which carries only core, notifications and spotlight: the dates
// and schedule layers must come AFTER it so they land in the `mantine` layer it declares.
import '@mantine/dates/styles.layer.css'
import '@mantine/schedule/styles.layer.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BasaltProvider, createBasaltTheme } from 'basalt-ui'
import { CrashFallback } from './lib/error-boundary'
import { router } from './lib/router'
import { argoPaletteGroups, ARGO_DERIVED } from './lib/series'
import { telemetry } from './lib/telemetry'
// Side-effect import: registers the app's global command registry (lib/commands.tsx's
// defineCommands) before the provider mounts, so Spotlight/ShortcutsHelp see it from boot.
import './lib/commands'
// Side-effect import: registers the app's typed notification kind registry (lib/notifications.ts's
// defineNotifications) before any emit() call, so the runtime registry is populated from boot.
import './lib/notifications'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')

createRoot(rootEl).render(
  <StrictMode>
    <BasaltProvider
      router={router}
      theme={createBasaltTheme()}
      telemetry={telemetry}
      fallback={(error) => <CrashFallback error={error} />}
      paletteOptions={{ groups: argoPaletteGroups, derived: ARGO_DERIVED }}
      defaultColorScheme="dark"
    />
  </StrictMode>,
)
