/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Dev-only bearer token to auto-seed the auth store so the AuthGate never blocks local dev /
   * screenshotting. Resolved by `op run` at runtime (only the `op://` reference lives in the tpl).
   * Guarded by `import.meta.env.DEV` at the seed site — never consumed in a prod build.
   */
  readonly VITE_DEV_API_TOKEN?: string
}
