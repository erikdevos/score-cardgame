import data from '../data/prices.json'

/** Estimated market values in USD from PriceCharting (ungraded sales); refresh with `npm run fetch:prices`. */
const prices = data.prices as Record<string, { n?: number; f?: number }>
export const priceInfo = { source: data.source, fetched: data.fetched }

const usd = (v: number) => `$${v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)}`

/** Regular print price, and the foil price when there is one. Both are undefined for unpriced cards. */
export function cardPrice(id: string): { regular?: string; foil?: string } {
  const p = prices[id]
  return { regular: p?.n !== undefined ? usd(p.n) : undefined, foil: p?.f !== undefined ? usd(p.f) : undefined }
}

export type PrintMode = 'both' | 'regular' | 'foil'

/** Sort value for the chosen print; with 'both' the regular price, else the foil price. */
export function cardPriceValue(id: string, mode: PrintMode = 'both'): number | undefined {
  const p = prices[id]
  return mode === 'regular' ? p?.n : mode === 'foil' ? p?.f : p?.n ?? p?.f
}
