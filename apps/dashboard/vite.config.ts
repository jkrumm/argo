import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import babel from 'vite-plugin-babel'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8')) as {
  version: string
}

// VITE_API_TARGET lets `bun dev:prod-api` point the local UI at prod for
// debugging against real data. The proxy strips `/api` from the source path
// and prepends the target, so for prod set the target to include `/api`
// (e.g. `https://argo.jkrumm.com/api`). Defaults to the bare local API on
// :4000 which serves routes without a prefix.
const apiTarget = process.env['VITE_API_TARGET'] ?? 'http://localhost:4000'

export default defineConfig({
  define: {
    // Surfaced as `app.version` resource attribute in HyperDX so we can filter
    // by release / diff regressions between deploys.
    __APP_VERSION__: JSON.stringify(process.env['BUILD_VERSION'] ?? pkg.version),
  },
  plugins: [
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    babel({ babelConfig: { plugins: ['babel-plugin-react-compiler'] } }),
    react(),
    VitePWA({
      // New service worker activates in the background; fresh assets are picked
      // up on the next launch/navigation (no forced mid-session reload).
      registerType: 'autoUpdate',
      // Plugin injects the registration script — no app code needed.
      injectRegister: 'auto',
      // Keep the hand-tuned public/site.webmanifest + icon set; don't generate one.
      manifest: false,
      workbox: {
        // App-shell precache only — no /api caching, so health/strength data is
        // always fetched fresh (offline shows the shell with fetch errors).
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/v1\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Some Mantine/charts chunks exceed the 2 MB default; precache them too.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      // SW stays off in dev so it can't cache stale assets during `bun dev`.
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 7715,
    strictPort: true,
    allowedHosts: ['argo.test'],
    proxy: {
      '/v1/traces': { target: 'http://127.0.0.1:4319', changeOrigin: true },
      '/v1/logs': { target: 'http://127.0.0.1:4319', changeOrigin: true },
      '/api': {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/api/, ''),
        changeOrigin: true,
        // Prod sits behind Traefik on HTTPS — must be set or the proxy fails
        // SNI/cert verification chatter shows up as 502s.
        secure: true,
      },
    },
  },
  resolve: {
    alias: {
      '@argo/api': resolve(import.meta.dirname, '../api/src'),
      '@argo/charts': resolve(import.meta.dirname, '../../packages/charts/src'),
    },
    // Force Mantine packages to resolve to a single instance. Without dedupe,
    // Vite's optimizer can stamp a second copy of @mantine/core into
    // @mantine/schedule's pre-bundle, which breaks MantineProvider context.
    dedupe: ['react', 'react-dom', '@mantine/core', '@mantine/hooks', '@mantine/dates'],
  },
  optimizeDeps: {
    // Pre-bundle all Mantine subpackages together so they share one
    // @mantine/core instance (and one MantineProvider context).
    include: [
      '@mantine/core',
      '@mantine/dates',
      '@mantine/hooks',
      '@mantine/form',
      '@mantine/modals',
      '@mantine/notifications',
      '@mantine/schedule',
    ],
  },
})
