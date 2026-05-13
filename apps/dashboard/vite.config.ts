import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import babel from 'vite-plugin-babel'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8')) as {
  version: string
}

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
      '/v1/traces': { target: 'http://127.0.0.1:4318', changeOrigin: true },
      '/v1/logs': { target: 'http://127.0.0.1:4318', changeOrigin: true },
      '/api': {
        target: 'http://localhost:4000',
        rewrite: (path) => path.replace(/^\/api/, ''),
        changeOrigin: true,
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
