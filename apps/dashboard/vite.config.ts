import { defineConfig, mergeConfig } from 'vite'
import { basaltAppPlugin, basaltViteConfig } from 'basalt-ui/vite'
import react from '@vitejs/plugin-react'
import babel from 'vite-plugin-babel'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8')) as {
  version: string
}

// VITE_API_TARGET lets `bun dev:prod-api` point the local UI at prod for
// debugging against real data. The proxy strips `/api` from the source path
// and prepends the target, so for prod set the target to include `/api`
// (e.g. `https://argo.jkrumm.com/api`). Defaults to the bare local API on
// :4040 which serves routes without a prefix.
const apiTarget = process.env['VITE_API_TARGET'] ?? 'http://localhost:4040'

// The preset owns what every basalt-ui consumer needs: the Mantine
// single-instance dedupe/prebundle set, the __APP_VERSION__ define, the /api dev
// proxy, and the BASALT_LOCAL source-alias path. Argo layers only its own
// concerns on top.
const basalt = basaltViteConfig({
  port: 7715,
  // '.mini.jkrumm.com' (leading dot = that domain and all subdomains) is the
  // Caddy-fronted tailnet door on the Mac mini — see dotfiles
  // scripts/caddy-tailnet.sh. Without it Vite 403s every request whose Host
  // isn't localhost, and the door looks broken at the proxy rather than here.
  allowedHosts: ['argo.test', '.mini.jkrumm.com'],
  apiTarget,
  version: pkg.version,
})

export default defineConfig(
  mergeConfig(basalt, {
    plugins: [
      TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
      babel({ babelConfig: { plugins: ['babel-plugin-react-compiler'] } }),
      react(),
      // Owns the head metadata, site.webmanifest and service worker that used to be
      // hand-written in index.html / public/site.webmanifest / a local VitePWA block.
      // The theme-color pair and the manifest's theme_color/background_color are
      // resolved from basalt's own SURFACE.bg token, so no hex is hand-computed here.
      ...basaltAppPlugin({
        name: 'Argo',
        description: 'Personal homelab dashboard — Garmin health, strength training, and M365.',
        serviceWorker: {
          workbox: {
            // Beyond the preset's `/api` denial: the OTel receiver paths must not
            // fall back to the app shell either.
            navigateFallbackDenylist: [/^\/api/, /^\/v1\//],
          },
        },
      }),
    ],
    server: {
      proxy: {
        '/v1/traces': { target: 'http://127.0.0.1:4319', changeOrigin: true },
        '/v1/logs': { target: 'http://127.0.0.1:4319', changeOrigin: true },
      },
    },
    resolve: {
      alias: {
        '@argo/api': resolve(import.meta.dirname, '../api/src'),
      },
      // Beyond the preset's react/react-dom/@mantine/{core,hooks} set.
      dedupe: ['@mantine/dates', '@mantine/spotlight', '@tanstack/react-hotkeys'],
    },
    optimizeDeps: {
      // Beyond the preset's core/hooks/form/modals/notifications set.
      include: [
        '@mantine/dates',
        '@mantine/schedule',
        '@mantine/spotlight',
        '@tanstack/react-hotkeys',
      ],
    },
  }),
)
