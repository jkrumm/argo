import { describe, expect, it, test } from 'bun:test'
import {
  dayDe,
  deltaEurDe,
  eurDe,
  isoDayDe,
  decimalText,
  moneyDe,
  parseDecimal,
  percentDe,
  priceDe,
  priceTrimmed,
  quantityDe,
  signedEurDe,
} from './depot-number'

describe('priceDe', () => {
  test('whole from a thousand, cents from ten, three from one, four below', () => {
    expect(priceDe(95_432.7)).toBe('95.433')
    expect(priceDe(1000)).toBe('1.000')
    expect(priceDe(182.4)).toBe('182,40')
    expect(priceDe(4.8123)).toBe('4,812')
    expect(priceDe(0.3125)).toBe('0,3125')
  })
  test('a negative price keeps a real minus sign', () => {
    expect(priceDe(-12.5)).toBe('−12,50')
  })
})

describe('priceTrimmed and moneyDe', () => {
  test('trailing zeros go, the currency follows', () => {
    expect(priceTrimmed(182)).toBe('182')
    expect(priceTrimmed(182.5)).toBe('182,5')
    expect(moneyDe(182, 'EUR')).toBe('182 €')
    expect(moneyDe(196.56, 'USD')).toBe('196,56 $')
  })
})

describe('percentDe', () => {
  test('one decimal, a real minus, an optional plus', () => {
    expect(percentDe(-0.183)).toBe('−18,3 %')
    expect(percentDe(0.0512, true)).toBe('+5,1 %')
    expect(percentDe(0.0512)).toBe('5,1 %')
  })
  test('zero carries no sign', () => {
    expect(percentDe(0, true)).toBe('0,0 %')
    expect(percentDe(-0.00004, true)).toBe('0,0 %')
  })
})

describe('quantityDe and dayDe', () => {
  test('up to four decimals; a German date', () => {
    expect(quantityDe(12.34567)).toBe('12,3457')
    expect(quantityDe(1500)).toBe('1.500')
    expect(dayDe(Date.UTC(2026, 10, 24) / 1000)).toBe('24.11.2026')
  })
})

describe('parseDecimal', () => {
  test('plain, comma and thousands forms', () => {
    expect(parseDecimal('150')).toBe(150)
    expect(parseDecimal('150,5')).toBe(150.5)
    expect(parseDecimal('95.000')).toBe(95_000)
    expect(parseDecimal('95.000,5')).toBe(95_000.5)
    expect(parseDecimal('1.234.567')).toBe(1_234_567)
  })
  test('a dot that is not a thousands group is a decimal point', () => {
    expect(parseDecimal('150.5')).toBe(150.5)
    expect(parseDecimal('4.81')).toBe(4.81)
    expect(parseDecimal('0.5')).toBe(0.5)
  })
  test('a currency sign and spaces are ignored', () => {
    expect(parseDecimal(' 182,40 € ')).toBe(182.4)
  })
  test('nothing, text, zero, negative and two commas are not a price', () => {
    for (const bad of ['', 'abc', '0', '-5', '1,2,3', ',5']) expect(parseDecimal(bad)).toBeNull()
  })
  test('what decimalText writes reads back', () => {
    for (const value of [150, 150.5, 95_000, 95_000.5, 4.8123]) {
      expect(parseDecimal(decimalText(value))).toBe(value)
    }
  })
})

describe('euro amounts', () => {
  it('whole euros from ten up, cents below or when exact', () => {
    expect(eurDe(123_456)).toBe('1.235 €')
    expect(eurDe(1299)).toBe('13 €')
    expect(eurDe(999)).toBe('9,99 €')
    expect(eurDe(123_456, true)).toBe('1.234,56 €')
    expect(eurDe(-34_000)).toBe('−340 €')
  })
  it('signs a change and puts a glyph on a delta', () => {
    expect(signedEurDe(120_000)).toBe('+1.200 €')
    expect(signedEurDe(-34_000)).toBe('−340 €')
    expect(deltaEurDe(120_000)).toBe('▲ 1.200 €')
    expect(deltaEurDe(0)).toBe('0,00 €')
  })
  it('writes an ISO day German', () => {
    expect(isoDayDe('2026-11-24')).toBe('24.11.2026')
  })
})
