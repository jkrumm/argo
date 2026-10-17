/** Shared by `Meter` and `BarList`: the one place a value becomes a track percentage. Internal. */

/** Clamps to 0–1; a non-finite fraction is 0. */
export const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/** A 0–1 fraction as a percent, rounded so float noise never reaches the DOM. */
export const toPct = (n: number): number => Math.round(clamp01(n) * 10000) / 100

/** A value on a track that ends at `scale`; a non-finite value or an empty scale draws nothing. */
export const barPercent = (value: number, scale: number): number =>
  Number.isFinite(value) && Number.isFinite(scale) && scale > 0 ? toPct(value / scale) : 0

export const asText = (n: number): string => String(n)
