/**
 * A SYNTHETIC `GET /api/efficiency` for tests and fixture-backed shots. Every model, name, slug and number
 * here is invented and deterministic (a seeded generator, no data of any provider): argo is a public repo
 * and the benchmark data behind the real response is for internal use, so it only ever reaches the page
 * through the relay and never a file in this tree. The SHAPE is the real contract's: `lineage` is a slug,
 * the readable name sits in `name` with the effort in a trailing parenthetical (`Quill 4 (Medium)`), the
 * bare slug is the max effort (or whatever its own name says), and the route table has the same structure
 * as a real one (five slots, one with no benchmark row). It is dense on purpose, with the routed
 * variants close together, so the label and frontier logic is stressed.
 */
import type { EfficiencyResponse, EfficiencyVariant, Effort, EfficiencyRoute } from '../api/types'

/** mulberry32: a small deterministic PRNG, so the fixture is the same on every run. */
function prng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface LineageSpec {
  slug: string
  name: string
  creator: string
  release: string
  /** The efforts offered, in ladder order; `default` is a model with no effort setting. */
  efforts: readonly Effort[]
  /** Intelligence at the top effort, the drop per step down, the cost at the top effort and its growth per step. */
  top: number
  step: number
  cost: number
  growth: number
  priceIn: number
  priceOut: number
  tps: number
  cache?: number
  superseded?: string
  /** Nothing on the IU endpoint can call it. */
  uncallable?: true
  legs?: readonly string[]
  /** The bare slug's own effort, when it is not `max`. */
  bareEffort?: Effort
}

const LADDER: readonly Effort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
const ALL: readonly Effort[] = LADDER
const NO_NONE: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const LINEAGES: readonly LineageSpec[] = [
  // OpenAI-like: the green series.
  {
    slug: 'gpt-9-1-vega',
    name: 'GPT-9.1 Vega',
    creator: 'OpenAI',
    release: '2026-10-12',
    efforts: ALL,
    top: 53.4,
    step: 4.6,
    cost: 1.04,
    growth: 1.75,
    priceIn: 1.2,
    priceOut: 6,
    tps: 96,
    cache: 0.06,
  },
  {
    slug: 'gpt-9-1-sable',
    name: 'GPT-9.1 Sable',
    creator: 'OpenAI',
    release: '2026-09-18',
    efforts: NO_NONE,
    top: 56.1,
    step: 4.2,
    cost: 1.36,
    growth: 1.8,
    priceIn: 2.2,
    priceOut: 11,
    tps: 52,
    cache: 0.11,
  },
  {
    slug: 'gpt-9-sable',
    name: 'GPT-9 Sable',
    creator: 'OpenAI',
    release: '2026-08-30',
    efforts: ['max'],
    top: 45.7,
    step: 0,
    cost: 2.7,
    growth: 1,
    priceIn: 2.2,
    priceOut: 11,
    tps: 118,
    cache: 0.11,
    superseded: 'gpt-9-1-sable',
  },
  {
    slug: 'gpt-9-1-lyra',
    name: 'GPT-9.1 Lyra',
    creator: 'OpenAI',
    release: '2026-09-02',
    efforts: NO_NONE,
    top: 58.9,
    step: 3.1,
    cost: 6.7,
    growth: 1.7,
    priceIn: 11,
    priceOut: 55,
    tps: 47,
  },
  {
    slug: 'gpt-9-1-pico',
    name: 'GPT-9.1 Pico',
    creator: 'OpenAI',
    release: '2026-09-25',
    efforts: ALL,
    top: 29.2,
    step: 3.9,
    cost: 0.17,
    growth: 1.9,
    priceIn: 0.12,
    priceOut: 0.6,
    tps: 121,
    cache: 0.01,
  },
  // Anthropic-like: the orange series.
  {
    slug: 'claude-marlow-4',
    name: 'Claude Marlow 4',
    creator: 'Anthropic',
    release: '2026-10-09',
    efforts: NO_NONE,
    top: 37.8,
    step: 3.4,
    cost: 0.43,
    growth: 1.9,
    priceIn: 0.11,
    priceOut: 0.55,
    tps: 187,
    cache: 0.011,
    legs: ['openai', 'anthropic'],
  },
  {
    slug: 'claude-ember-4-2',
    name: 'Claude Ember 4.2',
    creator: 'Anthropic',
    release: '2026-09-27',
    efforts: NO_NONE,
    top: 55.2,
    step: 4.5,
    cost: 9.4,
    growth: 1.9,
    priceIn: 2.1,
    priceOut: 10.5,
    tps: 120,
    cache: 0.105,
    legs: ['openai', 'anthropic'],
  },
  {
    slug: 'claude-ember-4',
    name: 'Claude Ember 4',
    creator: 'Anthropic',
    release: '2026-07-20',
    efforts: ['max'],
    top: 43.3,
    step: 0,
    cost: 11.1,
    growth: 1,
    priceIn: 5.2,
    priceOut: 26,
    tps: 51,
    superseded: 'claude-ember-4-2',
    legs: ['openai', 'anthropic'],
  },
  {
    slug: 'claude-quill-4',
    name: 'Claude Quill 4',
    creator: 'Anthropic',
    release: '2026-09-21',
    efforts: NO_NONE,
    top: 59.6,
    step: 4.7,
    cost: 10.4,
    growth: 1.85,
    priceIn: 4.2,
    priceOut: 21,
    tps: 88,
    cache: 0.21,
    legs: ['openai', 'anthropic'],
  },
  {
    slug: 'claude-quill-3',
    name: 'Claude Quill 3',
    creator: 'Anthropic',
    release: '2026-04-11',
    efforts: ['default'],
    top: 7.9,
    step: 0,
    cost: 0.55,
    growth: 1,
    priceIn: 1.1,
    priceOut: 5.5,
    tps: 90,
    superseded: 'claude-marlow-4',
    legs: ['openai', 'anthropic'],
  },
  {
    slug: 'claude-marlow-5',
    name: 'Claude Marlow 5',
    creator: 'Anthropic',
    release: '2026-10-30',
    efforts: ['low', 'medium', 'high'],
    top: 51.0,
    step: 5.3,
    cost: 3.9,
    growth: 1.8,
    priceIn: 5.1,
    priceOut: 25.5,
    tps: 73,
    legs: ['openai', 'anthropic'],
  },
  // Google-like: the blue series. The bare slug is a High.
  {
    slug: 'gemini-prism-5',
    name: 'Gemini Prism 5',
    creator: 'Google',
    release: '2026-09-04',
    efforts: ['low', 'medium', 'high'],
    top: 31.4,
    step: 1.1,
    cost: 8.1,
    growth: 1.25,
    priceIn: 0.8,
    priceOut: 3.9,
    tps: 117,
    legs: ['openai', 'gemini'],
    bareEffort: 'high',
  },
  {
    slug: 'gemini-prism-4-lite',
    name: 'Gemini Prism 4 Lite',
    creator: 'Google',
    release: '2026-07-18',
    efforts: ['default'],
    top: 12.3,
    step: 0,
    cost: 0.71,
    growth: 1,
    priceIn: 0.35,
    priceOut: 2.6,
    tps: 380,
    legs: ['openai', 'gemini'],
  },
  {
    slug: 'gemini-prism-4',
    name: 'Gemini Prism 4',
    creator: 'Google',
    release: '2026-03-02',
    efforts: ['default'],
    top: 6.6,
    step: 0,
    cost: 0.21,
    growth: 1,
    priceIn: 0.3,
    priceOut: 1.5,
    tps: 310,
    superseded: 'gemini-prism-5',
    legs: ['openai', 'gemini'],
  },
  {
    slug: 'gemini-prism-5-pro',
    name: 'Gemini Prism 5 Pro',
    creator: 'Google',
    release: '2026-10-02',
    efforts: NO_NONE,
    top: 50.9,
    step: 4.4,
    cost: 10.3,
    growth: 1.7,
    priceIn: 4.4,
    priceOut: 22,
    tps: 62,
    legs: ['openai', 'gemini'],
  },
  // Everyone else: neutral grey, a spread of cheap and slow models around the field.
  {
    slug: 'arcadia-r2',
    name: 'Arcadia R2',
    creator: 'Arcadia Labs',
    release: '2026-10-18',
    efforts: ['none', 'high', 'max'],
    top: 33.1,
    step: 7,
    cost: 0.64,
    growth: 1.3,
    priceIn: 0.3,
    priceOut: 1.3,
    tps: 158,
  },
  {
    slug: 'arcadia-r2-pro',
    name: 'Arcadia R2 Pro',
    creator: 'Arcadia Labs',
    release: '2026-08-11',
    efforts: ['none', 'max'],
    top: 22.6,
    step: 10,
    cost: 1.8,
    growth: 1.8,
    priceIn: 1.3,
    priceOut: 4,
    tps: 62,
  },
  {
    slug: 'borealis-large',
    name: 'Borealis Large',
    creator: 'Borealis',
    release: '2026-09-09',
    efforts: ['low', 'medium', 'max'],
    top: 18.4,
    step: 4,
    cost: 2.2,
    growth: 1.4,
    priceIn: 0.6,
    priceOut: 3,
    tps: 41,
  },
  {
    slug: 'cinder-7b',
    name: 'Cinder 7B',
    creator: 'Cinder AI',
    release: '2026-08-14',
    efforts: ['none', 'low', 'medium', 'max'],
    top: 19.7,
    step: 2.6,
    cost: 3.4,
    growth: 1.25,
    priceIn: 0.5,
    priceOut: 3,
    tps: 43,
    uncallable: true,
  },
  {
    slug: 'delta-max',
    name: 'Delta Max',
    creator: 'Delta Works',
    release: '2026-09-02',
    efforts: ['default'],
    top: 33.9,
    step: 0,
    cost: 9.6,
    growth: 1,
    priceIn: 1.9,
    priceOut: 6,
    tps: 38,
    legs: ['openai'],
  },
  {
    slug: 'ember-flash',
    name: 'Ember Flash',
    creator: 'Emberline',
    release: '2026-09-21',
    efforts: ['default'],
    top: 29.7,
    step: 0,
    cost: 0.27,
    growth: 1,
    priceIn: 0.43,
    priceOut: 0.87,
    tps: 150,
  },
  {
    slug: 'fathom-3',
    name: 'Fathom 3',
    creator: 'Fathom',
    release: '2026-10-23',
    efforts: ['default'],
    top: 46.1,
    step: 0,
    cost: 3.5,
    growth: 1,
    priceIn: 1.9,
    priceOut: 9.5,
    tps: 27,
  },
  {
    slug: 'granite-s',
    name: 'Granite S',
    creator: 'Granite Co',
    release: '2026-06-01',
    efforts: ['default'],
    top: 18.2,
    step: 0,
    cost: 1.3,
    growth: 1,
    priceIn: 0.3,
    priceOut: 1.2,
    tps: 109,
  },
  {
    slug: 'halcyon-1',
    name: 'Halcyon 1',
    creator: 'Halcyon',
    release: '2026-07-16',
    efforts: ['low', 'high'],
    top: 17.1,
    step: 5,
    cost: 2.4,
    growth: 1.5,
    priceIn: 3,
    priceOut: 15,
    tps: 46,
  },
  {
    slug: 'ibis-mini',
    name: 'Ibis Mini',
    creator: 'Ibis',
    release: '2026-05-02',
    efforts: ['default'],
    top: 4.7,
    step: 0,
    cost: 1.05,
    growth: 1,
    priceIn: 1.5,
    priceOut: 7.5,
    tps: 140,
  },
]

const CAPITAL: Record<Effort, string> = {
  none: 'Non-reasoning',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Xhigh',
  max: 'Max',
  default: '',
}

const SUFFIX: Record<Effort, string> = {
  none: '-non-reasoning',
  low: '-low',
  medium: '-medium',
  high: '-high',
  xhigh: '-xhigh',
  max: '',
  default: '',
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits))

/** The IU id of a lineage: dots where the slug has a version. */
const iuIdOf = (slug: string): string =>
  slug.replace(/-(\d)-(\d)/g, '-$1.$2').replace(/^claude-(\w+)-(\d)-(\d)$/, 'claude-$1-$2.$3')

function variantsOf(spec: LineageSpec, rand: () => number): EfficiencyVariant[] {
  const n = spec.efforts.length
  return spec.efforts.map((effort, index) => {
    const down = n - 1 - index
    const jitter = 0.88 + rand() * 0.24
    const intelligence = round(Math.max(1, spec.top - down * spec.step * (0.85 + rand() * 0.3)), 1)
    const costPerTask = round((spec.cost / spec.growth ** down) * jitter, 4)
    const tokens = Math.round(((costPerTask / spec.priceOut) * 1e6) / 1)
    const tps = round(spec.tps * (0.8 + rand() * 0.4), 2)
    const bare = effort === 'max' || (effort === 'default' && spec.efforts.length === 1)
    // The bare slug carries the lineage's top variant; a lineage with a `bareEffort` names it that effort.
    const isBare = spec.bareEffort === undefined ? bare : effort === spec.bareEffort
    const name =
      effort === 'default'
        ? spec.name
        : `${spec.name} (${CAPITAL[effort]}${index % 3 === 1 && spec.creator === 'Anthropic' ? ', Default Fallback' : ''})`
    const slug = `${spec.slug}${isBare ? '' : SUFFIX[effort]}`
    const accessible = spec.uncallable !== true
    return {
      slug,
      name,
      lineage: spec.slug,
      effort,
      creator: spec.creator,
      releaseDate: spec.release,
      intelligence,
      costPerTask,
      priceIn: spec.priceIn,
      priceOut: spec.priceOut,
      priceCacheRead: spec.cache ?? null,
      tokensPerTaskEst: tokens,
      timePerTaskEstSec: round(tokens / tps, 2),
      e2eSec: round(4 + rand() * 60, 2),
      tps,
      ttfatSec: round(1 + rand() * 20, 2),
      superseded: spec.superseded !== undefined,
      supersededBy: spec.superseded ?? null,
      iu: {
        id: accessible ? iuIdOf(spec.slug) : null,
        listed: accessible,
        accessible,
        legs: accessible ? [...(spec.legs ?? ['openai'])] : [],
      },
    }
  })
}

const FILLER_CREATORS = [
  'Arcadia Labs',
  'Borealis',
  'Fathom',
  'Granite Co',
  'Halcyon',
  'Ibis',
  'Jasper',
  'Kestrel',
] as const

/** Twelve more mid-field models, so the cloud the routed variants sit in is as dense as a real one. */
function fillerLineages(): LineageSpec[] {
  const r = prng(77)
  return Array.from({ length: 12 }, (_, i) => {
    const creator = FILLER_CREATORS[i % FILLER_CREATORS.length] ?? 'Ibis'
    const n = String(i + 1).padStart(2, '0')
    return {
      slug: `filler-${n}`,
      name: `Filler ${n}`,
      creator,
      release: `2026-0${6 + (i % 4)}-1${i % 9}`,
      efforts: i % 2 === 0 ? ['low', 'medium', 'high', 'max'] : ['none', 'high', 'max'],
      top: round(16 + r() * 32, 1),
      step: round(3 + r() * 4, 1),
      cost: round(0.2 + r() * 6, 2),
      growth: round(1.2 + r() * 0.6, 2),
      priceIn: round(0.2 + r() * 3, 2),
      priceOut: round(1 + r() * 12, 2),
      tps: round(30 + r() * 150, 0),
    }
  })
}

const rand = prng(20261106)
// One filler variant has no speed measure, so it has no time estimate and no efficiency index: the
// footnote and the catalog's missing-value sort have something to show.
const withoutSpeed = (variant: EfficiencyVariant): EfficiencyVariant =>
  variant.slug === 'filler-03-high' ? { ...variant, tps: null, timePerTaskEstSec: null } : variant

const variants = [...LINEAGES, ...fillerLineages()]
  .flatMap((spec) => variantsOf(spec, rand))
  .map(withoutSpeed)

// Five slots, as a real route table has: two Anthropic-like on a quota (one with no benchmark row at
// its effort), one metered OpenAI-like, one metered Google-like with no effort set.
const route = (
  id: string,
  wire: string,
  model: string,
  effort: string | null,
  slug: string | null,
  access: EfficiencyRoute['access'],
): EfficiencyRoute => ({
  route: id,
  wire,
  model,
  effort,
  access,
  variantSlug: slug,
  reason: slug === null ? `no AA row at effort ${effort}` : null,
})

const numbered = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}.${String(i + 1).padStart(2, '0')}`)

const routes: EfficiencyRoute[] = [
  ...numbered('agent.brain', 12).map((id) =>
    route(id, 'anthropic', 'claude-marlow-4', 'high', 'claude-marlow-4-high', 'subscription'),
  ),
  ...numbered('cheap.task', 11).map((id) =>
    route(id, 'anthropic', 'claude-marlow-4', 'none', null, 'subscription'),
  ),
  ...numbered('writer.step', 10).map((id) =>
    route(id, 'anthropic', 'claude-ember-4-2', 'medium', 'claude-ember-4-2-medium', 'subscription'),
  ),
  ...numbered('review.pass', 4).map((id) =>
    route(id, 'iu-openai', 'gpt-9.1-vega', 'medium', 'gpt-9-1-vega-medium', 'metered'),
  ),
  route('eval.label', 'iu-openai', 'gemini-prism-5', null, 'gemini-prism-5', 'metered'),
]

export const EFFICIENCY_FIXTURE: EfficiencyResponse = {
  capturedAt: '2026-11-06 07:17:10',
  generatedAt: '2026-11-06T09:30:00.000Z',
  source: {
    name: 'Artificial Analysis',
    url: 'https://artificialanalysis.ai',
    attribution: 'Source: Artificial Analysis (artificialanalysis.ai)',
  },
  variants,
  routes,
  routesError: null,
}
