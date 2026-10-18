import { describe, expect, test } from 'bun:test'
import {
  ALT_DOMAIN,
  bandValue,
  darkness,
  coreVsGate,
  fitAltDomain,
  inDomain,
  glowAt,
  gateAt,
  glowBuckets,
  glowCells,
  medianMpsas,
  profileRows,
  tightestIndex,
  type HorizonProfilePoint,
  type SkyglowRose,
} from './sky-panorama-geometry'

const PROFILE: HorizonProfilePoint[] = [
  { azimuthDeg: 0, altitudeDeg: 10, nearAltitudeDeg: 20 },
  { azimuthDeg: 180, altitudeDeg: 30, nearAltitudeDeg: 40 },
]

// Four azimuth columns (90° apart), two altitude rows; brightness rises with altitude.
const ROSE: SkyglowRose = {
  azimuths: [0, 90, 180, 270],
  altitudes: [0, 50],
  mpsas: [
    [20, 20, 20, 20],
    [22, 22, 22, 22],
  ],
}

describe('darkness', () => {
  test('is 0 above −6°, 1 below −18°, linear between', () => {
    expect(darkness(10)).toBe(0)
    expect(darkness(-6)).toBe(0)
    expect(darkness(-12)).toBe(0.5)
    expect(darkness(-18)).toBe(1)
    expect(darkness(-40)).toBe(1)
  })
})

describe('bandValue', () => {
  test('interpolates linearly between profile points', () => {
    expect(bandValue(PROFILE, 'altitudeDeg', 90)).toBe(20)
    expect(bandValue(PROFILE, 'nearAltitudeDeg', 90)).toBe(30)
  })

  test('wraps from the last point back to the first at 360°', () => {
    expect(bandValue(PROFILE, 'altitudeDeg', 270)).toBe(20)
    expect(bandValue(PROFILE, 'altitudeDeg', 360)).toBe(10)
  })

  test('an empty profile is flat zero', () => {
    expect(bandValue([], 'altitudeDeg', 123)).toBe(0)
  })
})

describe('glowAt', () => {
  test('interpolates in altitude', () => {
    expect(glowAt(ROSE, 45, 25)).toBe(21)
  })

  test('clamps below the first altitude row', () => {
    expect(glowAt(ROSE, 0, -10)).toBe(20)
  })
})

describe('gateAt', () => {
  test('is the flat floor where the skyline plus margin is lower', () => {
    expect(gateAt(PROFILE, 8, 2, 0)).toBe(12)
    expect(gateAt(PROFILE, 15, 2, 0)).toBe(15)
  })

  test('is the skyline plus margin where the terrain is higher', () => {
    expect(gateAt(PROFILE, 8, 2, 180)).toBe(32)
  })
})

describe('profileRows', () => {
  test('spans 0° to 360° inclusive every 2°', () => {
    const rows = profileRows(PROFILE, () => 8)
    expect(rows).toHaveLength(181)
    expect(rows[0]?.az).toBe(0)
    expect(rows.at(-1)?.az).toBe(360)
  })

  test('carries skyline, near band and the gate per azimuth', () => {
    const row = profileRows(PROFILE, (az) => az / 10).find((r) => r.az === 90)
    expect(row).toEqual({ az: 90, skyline: 20, near: 30, gate: 9 })
  })
})

describe('glowCells', () => {
  test('tiles the whole azimuth × altitude plot without overshooting the domain', () => {
    const cells = glowCells(ROSE, 52)
    expect(cells).toHaveLength(36 * 13)
    expect(Math.max(...cells.map((c) => c.alt1))).toBe(52)
    expect(Math.max(...cells.map((c) => c.az1))).toBe(360)
  })
})

describe('glowBuckets', () => {
  const gradient: SkyglowRose = {
    azimuths: [0, 90, 180, 270],
    altitudes: [0, 50],
    mpsas: [
      [18, 19, 20, 21],
      [19, 20, 21, 22],
    ],
  }

  test('collapses ~470 cells to a few dozen buckets without losing a cell', () => {
    const cells = glowCells(gradient)
    const buckets = glowBuckets(cells)
    expect(buckets.length).toBeLessThanOrEqual(41)
    expect(buckets.reduce((n, b) => n + b.cells.length, 0)).toBe(cells.length)
  })

  test('every cell sits within half a bucket of its bucket value', () => {
    for (const b of glowBuckets(glowCells(gradient))) {
      for (const c of b.cells) expect(Math.abs(c.mpsas - b.mpsas)).toBeLessThanOrEqual(0.05 + 1e-9)
    }
  })
})

describe('fitAltDomain', () => {
  const row = (skyline: number, near: number, gate: number) => ({ az: 0, skyline, near, gate })

  test('fits the top to the data with headroom, on a 4° step', () => {
    expect(fitAltDomain([row(8, 8, 8)], [21, 13.5])).toEqual([-4, 24])
  })

  test('the near band counts even when it rises above the far skyline', () => {
    expect(fitAltDomain([row(5, 25, 8)], [])).toEqual([-4, 28])
  })

  test('a moon track high above the terrain is not gapped', () => {
    expect(fitAltDomain([row(5, 5, 8)], [66])).toEqual([-4, 68])
  })

  test('a body above the terrain (the sun) lifts the top', () => {
    expect(fitAltDomain([row(5, 5, 8)], [38])).toEqual([-4, 40])
  })

  test('never goes under the 16° floor or over the widest domain', () => {
    expect(fitAltDomain([row(2, 2, 8)], [3])).toEqual([-4, 16])
    expect(fitAltDomain([row(95, 95, 95)], [])).toEqual([-4, ALT_DOMAIN[1]])
  })
})

describe('inDomain', () => {
  test('is inclusive at both ends', () => {
    expect(inDomain(-4, [-4, 20])).toBe(true)
    expect(inDomain(20, [-4, 20])).toBe(true)
    expect(inDomain(20.1, [-4, 20])).toBe(false)
  })
})

describe('glowCells to a fitted top', () => {
  test('stops at the fitted top', () => {
    expect(Math.max(...glowCells(ROSE, 16).map((c) => c.alt1))).toBe(16)
  })
})

describe('coreVsGate', () => {
  // A low skyline: the gate is the 8° floor, not skyline + margin.
  const LOW = [{ azimuthDeg: 0, altitudeDeg: 1, nearAltitudeDeg: 1 }]
  test('over skyline + margin but under the floor does not clear', () => {
    expect(coreVsGate(LOW, 8, 2, 0, 5)).toEqual({ clearance: 4, clears: false })
  })

  test('above the gate clears; level with it does not (strict, as the API)', () => {
    expect(coreVsGate(LOW, 8, 2, 0, 9).clears).toBe(true)
    expect(coreVsGate(LOW, 8, 2, 0, 8).clears).toBe(false)
  })

  test('a high skyline raises the gate above the floor', () => {
    const high = [{ azimuthDeg: 0, altitudeDeg: 12, nearAltitudeDeg: 12 }]
    expect(coreVsGate(high, 8, 2, 0, 13).clears).toBe(false)
    expect(coreVsGate(high, 8, 2, 0, 15).clears).toBe(true)
  })
})

describe('tightestIndex', () => {
  test('picks the smallest margin over the gate, skipping samples that are not dark', () => {
    expect(tightestIndex([null, 6, 2.5, 9, null])).toBe(2)
    expect(tightestIndex([-3, null, 1])).toBe(0)
  })
  test('null when no sample is dark', () => {
    expect(tightestIndex([null, null])).toBeNull()
    expect(tightestIndex([])).toBeNull()
  })
})

describe('medianMpsas', () => {
  test('the middle value of the whole rose', () => {
    expect(
      medianMpsas({
        azimuths: [0, 90],
        altitudes: [0, 30],
        mpsas: [
          [20, 22],
          [21, 19],
        ],
      }),
    ).toBe(21)
  })
  test('null for an empty rose', () => {
    expect(medianMpsas({ azimuths: [], altitudes: [], mpsas: [] })).toBeNull()
  })
})
