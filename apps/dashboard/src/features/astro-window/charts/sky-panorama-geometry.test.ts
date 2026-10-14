import { describe, expect, test } from 'bun:test'
import {
  ALT_DOMAIN,
  bandValue,
  darkness,
  glowAt,
  glowCells,
  profileRows,
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
    const cells = glowCells(ROSE)
    expect(cells).toHaveLength(36 * 13)
    expect(Math.max(...cells.map((c) => c.alt1))).toBe(ALT_DOMAIN[1])
    expect(Math.max(...cells.map((c) => c.az1))).toBe(360)
  })
})
