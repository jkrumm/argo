import { defineConfig, mergeConfig, type Plugin } from 'vite'
import { basaltAppPlugin, basaltViteConfig } from 'basalt-ui/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { createRequire } from 'module'
import { dirname, join, resolve, sep } from 'path'
import { readdirSync, readFileSync } from 'fs'

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

/**
 * pdf.js loads its image decoders, character maps and fallback fonts by URL at run time, so the
 * folders it ships them in are served under `/pdfjs/`: emitted into the build, read from the package
 * by the dev server.
 */
function pdfjsAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const folders = ['wasm', 'cmaps', 'standard_fonts', 'iccs']
  return {
    name: 'argo-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const file = join(root, (req.url ?? '').split('?')[0] ?? '')
        if (!folders.some((folder) => file.startsWith(join(root, folder) + sep))) return next()
        try {
          const body = readFileSync(file)
          if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm')
          res.end(body)
        } catch {
          next()
        }
      })
    },
    generateBundle() {
      for (const folder of folders) {
        for (const name of readdirSync(join(root, folder))) {
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${folder}/${name}`,
            source: readFileSync(join(root, folder, name)),
          })
        }
      }
    },
  }
}

export default defineConfig(
  mergeConfig(basalt, {
    plugins: [
      pdfjsAssets(),
      TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      // Owns the head metadata, site.webmanifest and service worker that used to be
      // hand-written in index.html / public/site.webmanifest / a local VitePWA block.
      // The theme-color pair and the manifest's theme_color/background_color are
      // resolved from basalt's own SURFACE.bg token, so no hex is hand-computed here.
      ...basaltAppPlugin({
        name: 'Argo',
        // Mirrors BasaltProvider's `defaultColorScheme` in main.tsx — the anti-FOUC <style>
        // paints the scheme the app opens on, then disarms itself the moment index.html's boot
        // script writes `data-mantine-color-scheme`.
        colorScheme: 'dark',
        description: 'Personal homelab dashboard — Garmin health, strength training, and M365.',
        serviceWorker: {
          workbox: {
            // Beyond the preset's `/api` denial: the OTel receiver paths must not
            // fall back to the app shell either.
            navigateFallbackDenylist: [/^\/api/, /^\/v1\//],
            // pdf.js's decoder fallbacks are fetched only by the file that needs one.
            globIgnores: ['**/node_modules/**/*', 'pdfjs/**'],
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
