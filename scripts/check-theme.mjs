#!/usr/bin/env bun
/**
 * Theme guard — fails on colors that bypass the central palette.
 *
 * oxlint has no `no-restricted-syntax`, so this is how "all color goes through the
 * Blueprint palette" is actually ENFORCED. It flags, in apps/dashboard/src and
 * packages/charts/src:
 *   1. raw color literals — hex (#rrggbb) and rgb()/rgba()/hsl()/hsla().
 *   2. off-identity Mantine accent props — `color`/`c`/`bg`/`backgroundColor` set to
 *      teal/violet/grape/indigo/pink. theme.ts reskins the WHOLE Mantine palette to
 *      Blueprint, so any accent resolves on-palette — but the identity is blue-anchored and
 *      DESIGN.md (Colors) forbids turquoise/violet/indigo/rose, so those families must not be
 *      USED as chrome accents. Allowed accents: blue (identity), gray (neutral), and the
 *      status hues red/green/orange/yellow. Series/categorical color goes through VX.* tokens,
 *      never a Mantine accent prop.
 *   3. raw spacing/radius numbers that EQUAL a named scale step — a `p`/`m`/`gap`-family prop set
 *      to 10/12/16/20/32 (theme.ts `spacing`), or any numeric `radius`. These should use the token
 *      (`p="md"`, `radius="sm"`). Deliberately NARROW: sub-scale micro-gaps (2/4/6/8) and one-off
 *      layout dims are legitimate and left alone — only an exact token-equals is flagged, so the
 *      guard stays near-zero-noise (drift-proofing, not a px crusade).
 *
 * Allowed: CSS vars (var(--vx-*)), color-mix() / alpha(), and any line carrying a
 * `theme-allow` comment (an explicit, diff-visible exception).
 *
 * Palette-definition files are exempt (they ARE the source of the hexes).
 *
 * Run: bun scripts/check-theme.mjs   (exit 1 on violations)
 */
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

const ROOTS = ['apps/dashboard/src', 'packages/charts/src']
const EXEMPT = new Set([
  'packages/charts/src/palette.ts',
  'packages/charts/src/theme-vars.ts',
  'packages/charts/src/tokens.ts',
  'packages/charts/src/utils/color.ts',
  'apps/dashboard/src/theme.ts',
])
const SKIP = /\.gen\.ts$|\.test\.[tj]sx?$|\.d\.ts$/

const HEX = /#[0-9a-fA-F]{3,8}\b/g
const FUNC = /\b(?:rgba?|hsla?)\(/g
// Off-identity Mantine accent props: color="violet", c='indigo', bg={'teal'}, … (any quote/brace form).
const FORBIDDEN_ACCENT =
  /\b(?:color|c|bg|backgroundColor)\s*=\s*\{?\s*['"](teal|violet|grape|indigo|pink)['"]/g
// Spacing prop whose raw px EQUALS a named scale step (theme.ts spacing 10/12/16/20/32) → use the token.
const SPACING_PROP = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)=\{(?:10|12|16|20|32)\}/g
// Any numeric radius prop → use a radius token (xs/sm/md/lg/xl).
const RADIUS_PROP = /\bradius=(?:\{[0-9]+\}|"[0-9]+")/g

const violations = []

function scanFile(abs, rel) {
  const lines = readFileSync(abs, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes('theme-allow')) continue
    for (const m of line.matchAll(HEX)) {
      violations.push({ rel, line: i + 1, token: m[0], kind: 'raw-hex' })
    }
    for (const m of line.matchAll(FUNC)) {
      void m
      violations.push({ rel, line: i + 1, token: 'rgba()/hsl()', kind: 'raw-color-fn' })
    }
    for (const m of line.matchAll(FORBIDDEN_ACCENT)) {
      violations.push({ rel, line: i + 1, token: m[1], kind: 'off-identity-accent' })
    }
    for (const m of line.matchAll(SPACING_PROP)) {
      violations.push({ rel, line: i + 1, token: m[0], kind: 'raw-spacing' })
    }
    for (const m of line.matchAll(RADIUS_PROP)) {
      violations.push({ rel, line: i + 1, token: m[0], kind: 'raw-radius' })
    }
  }
}

for (const root of ROOTS) {
  const glob = new Glob('**/*.{ts,tsx}')
  for (const f of glob.scanSync({ cwd: root, absolute: true })) {
    const rel = relative(process.cwd(), f)
    if (SKIP.test(rel) || EXEMPT.has(rel)) continue
    scanFile(f, rel)
  }
}

if (violations.length === 0) {
  console.log('✓ Theme guard: no off-palette colors.')
  process.exit(0)
}

const byFile = new Map()
for (const v of violations) {
  if (!byFile.has(v.rel)) byFile.set(v.rel, [])
  byFile.get(v.rel).push(v)
}
console.error(`✖ Theme guard: ${violations.length} off-palette / off-identity violation(s)\n`)
for (const [file, vs] of [...byFile].sort()) {
  console.error(file)
  for (const v of vs.sort((a, b) => a.line - b.line)) {
    console.error(`  ${String(v.line).padStart(4)}  ${v.kind.padEnd(15)} ${v.token}`)
  }
  console.error('')
}
console.error(
  'Fix: route color through VX.* / useVxTheme() / the Mantine theme; for an off-identity accent use ' +
    'blue/gray or a status hue (red/green/orange/yellow), or a VX series token; for raw spacing/radius ' +
    'use the scale token (p="md", gap="sm", radius="sm"). Add a `theme-allow` comment for a deliberate ' +
    'exception.',
)
process.exit(1)
