import { defineConfig } from 'vite'
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
  },
})
