/** Fixtures of the gateway's first day, 2 Nov 2026 16:00 UTC (spec §The headline), for the Flow models' tests. */
import type {
  DemandResponse,
  PacePool,
  PaceResponse,
  RouterResponse,
} from '../../lib/queries/usage'

const iu: PacePool = {
  account: 'iu',
  enabled: true,
  note: null,
  grantUsd: 200,
  cycle: { start: '2026-10-21T00:00:00.000Z', end: '2026-11-21T00:00:00.000Z', status: 'open' },
  spentUsd: 111.57,
  meteredUsd: 55.46,
  reportedUsd: 100,
  outsideUsd: 56.11,
  reportedAt: '2026-11-02T14:45:00.000Z',
  leftUsd: 88.43,
  daysLeft: 18.33,
  requiredUsdPerDay: 4.82,
  evalReserveUsd: 118,
  evalAvailableUsd: 0,
  projection: {
    drawsFrom: '2026-11-02T16:00:00.000Z',
    dryAt: '2026-11-03T17:00:00.000Z',
    unspentAtEndUsd: 0,
  },
  days: [
    { day: '2026-10-21', meteredUsd: 0, reportedUsd: 0, leftUsd: 200 },
    { day: '2026-10-31', meteredUsd: 0, reportedUsd: 56.11, leftUsd: 143.89 },
    { day: '2026-11-01', meteredUsd: 0, reportedUsd: 0, leftUsd: 143.89 },
    { day: '2026-11-02', meteredUsd: 55.46, reportedUsd: 43.5, leftUsd: 88.43 },
  ],
  previous: {
    start: '2026-09-21T00:00:00.000Z',
    end: '2026-10-21T00:00:00.000Z',
    grantUsd: 200,
    reconciledUsd: 0,
    unspentUsd: 200,
  },
}

const me: PacePool = {
  ...iu,
  account: 'me',
  grantUsd: 100,
  cycle: { start: '2026-10-27T00:00:00.000Z', end: '2026-11-27T00:00:00.000Z', status: 'open' },
  spentUsd: 6.91,
  meteredUsd: 6.91,
  reportedUsd: 6.5,
  outsideUsd: 0,
  leftUsd: 93.09,
  daysLeft: 24.33,
  requiredUsdPerDay: 3.83,
  evalReserveUsd: 78.5,
  evalAvailableUsd: 12,
  projection: {
    drawsFrom: '2026-11-03T17:00:00.000Z',
    dryAt: '2026-11-04T19:00:00.000Z',
    unspentAtEndUsd: 0,
  },
  days: [
    { day: '2026-10-27', meteredUsd: 0, reportedUsd: null, leftUsd: 100 },
    { day: '2026-11-02', meteredUsd: 6.91, reportedUsd: 6.5, leftUsd: 93.09 },
  ],
  previous: null,
}

const me2: PacePool = {
  ...iu,
  account: 'me2',
  enabled: false,
  note: 'not enabled',
  grantUsd: 100,
  cycle: { start: '2026-11-02T16:00:00.000Z', end: null, status: 'none' },
  spentUsd: 0,
  meteredUsd: 0,
  reportedUsd: null,
  outsideUsd: 0,
  reportedAt: null,
  leftUsd: null,
  daysLeft: null,
  requiredUsdPerDay: null,
  evalReserveUsd: null,
  evalAvailableUsd: null,
  projection: { drawsFrom: null, dryAt: null, unspentAtEndUsd: null },
  days: [],
  previous: null,
}

export const PACE: PaceResponse = {
  asOf: '2026-11-02T16:00:00.000Z',
  cutover: '2026-11-02T00:26:00.000Z',
  verdict: 'over',
  thin: true,
  rate: { productionUsdPerDay: 85, evalUsdPerDay: 10.6, windowHours: 15.6 },
  pools: [iu, me, me2],
  spill: {
    from: '2026-11-04T19:00:00.000Z',
    until: '2026-11-21T00:00:00.000Z',
    days: 16.2,
    claudeListUsd: 1380,
  },
  claudeOnIuUsd: 0,
  personalKey: {
    rolling30Usd: 577.57,
    capUsd: 500,
    state: 'over',
    underCapOn: '2026-11-12',
    fetchedAt: '2026-11-02T14:00:00.000Z',
  },
}

export const ROUTER: RouterResponse = {
  picks: [
    { day: '2026-11-01', target: 'iu', reason: 'bound', n: 400 },
    { day: '2026-11-02', target: 'iu', reason: 'bound', n: 1258 },
    { day: '2026-11-02', target: 'iu', reason: 'soonest expiry', n: 321 },
    { day: '2026-11-02', target: 'me', reason: 'soonest expiry', n: 723 },
    { day: '2026-11-02', target: 'iu-api', reason: 'claude-code', n: 13 },
    { day: '2026-11-02', target: 'iu-api', reason: 'forced', n: 4 },
  ],
  iu: [
    { day: '2026-11-02', cause: 'design', usd: 2.91, requests: 60 },
    { day: '2026-11-02', cause: 'eval', usd: 0.36, requests: 9 },
    { day: '2026-11-02', cause: 'claude-code', usd: 0.003, requests: 13 },
  ],
  cache: [
    { caller: 'agw direct', target: 'iu-api', requests: 562, hitRate: 0.008 },
    { caller: 'OpenCode', target: 'me', requests: 300, hitRate: 0.79 },
  ],
  picksAvailable: true,
  routeFallbackMeasured: false,
  lastRequestAt: '2026-11-02T15:58:00.000Z',
}

const zero = { prod: 0, eval: 0, verify: 0, other: 0 }

export const DEMAND: DemandResponse = {
  rows: [
    {
      key: 'review',
      usd: 54.91,
      freshTokens: 1_000_000,
      cacheReadTokens: 3_000_000,
      requests: 900,
      runs: 70,
      byPurpose: { ...zero, prod: 54.3, verify: 0.61 },
      byPayer: { 'iu-credit': 54.91 },
    },
    {
      key: 'otel',
      usd: 3.95,
      freshTokens: 100_000,
      cacheReadTokens: 0,
      requests: 40,
      runs: 0,
      byPurpose: { ...zero, prod: 1.15, eval: 2.8 },
      byPayer: { 'me-credit': 3.95 },
    },
  ],
  totals: { usd: 58.86, requests: 940 },
}
