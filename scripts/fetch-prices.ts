// Scrapes ungraded market prices from PriceCharting into src/data/prices.json.
// Usage: npx tsx scripts/fetch-prices.ts
// Prices are PriceCharting's estimate from recent eBay/marketplace sales (USD). Re-run to refresh.
import { readFileSync, writeFileSync } from 'node:fs'

const SETS: { key: string; prefix: string; pc: string }[] = [
  { key: 'saiyan-saga', prefix: 'SS', pc: 'saiyan-saga' },
  { key: 'frieza-saga', prefix: 'FS', pc: 'frieza-saga' },
  { key: 'trunks-saga', prefix: 'TS', pc: 'trunks-saga' },
  { key: 'androids-saga', prefix: 'AS', pc: 'android-saga' },
  { key: 'cell-saga', prefix: 'CS', pc: 'cell-saga' },
  { key: 'cell-games-saga', prefix: 'CG', pc: 'cell-games-saga' },
  { key: 'world-games-saga', prefix: 'WG', pc: 'world-games-saga-2002' },
  { key: 'babidi-saga', prefix: 'BB', pc: 'babidi-saga' },
  { key: 'buu-saga', prefix: 'BU', pc: 'buu-saga' },
]

/** One price per card: `n` normal print, `f` foil print (USD, whole cents rounded to 2 decimals). */
type Price = { n?: number; f?: number }
const out: Record<string, Price> = {}

const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
const money = (s: string) => {
  const v = parseFloat(s.replace(/[$,]/g, ''))
  return Number.isFinite(v) ? v : undefined
}

for (const set of SETS) {
  const ids = new Set((JSON.parse(readFileSync(`src/data/${set.key}/cards.json`, 'utf8')) as { id: string }[]).map(c => c.id))
  const seen = new Set<string>()
  let matched = 0
  for (let cursor = 0; ; cursor += 150) {
    const html = await (await fetch(`https://www.pricecharting.com/console/dragon-ball-z-${set.pc}?cursor=${cursor}`, { headers: { 'user-agent': 'Mozilla/5.0' } })).text()
    const rows = [...html.matchAll(/<tr id="product-(\d+)".*?<td class="title"[^>]*>\s*<a [^>]*>([^<]*)<\/a>.*?used_price">\s*<span class="js-price">([^<]*)/gs)]
    const fresh = rows.filter(r => !seen.has(r[1]))
    fresh.forEach(r => seen.add(r[1]))
    for (const [, , rawTitle, rawPrice] of fresh) {
      const price = money(rawPrice)
      if (price === undefined) continue
      // "Red Reading Drill [Foil] 140", "Goku LEV1 183", "Goku [Promo] P1": trailing token is the card number
      const title = decode(rawTitle).trim()
      const m = title.match(/^(.*?)\s+((?:P)?\d+)$/)
      if (!m) continue
      const id = `${set.prefix}-${m[2]}`
      if (!ids.has(id)) continue
      const foil = /\[Foil\]/i.test(m[1])
      const entry = (out[id] ??= {})
      entry[foil ? 'f' : 'n'] = price
      matched++
    }
    if (fresh.length < 150) break
  }
  console.log(`${set.key}: ${seen.size} listings, ${matched} matched of ${ids.size} cards`)
}

writeFileSync('src/data/prices.json', JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), source: 'PriceCharting', prices: out }, null, 1) + '\n')
console.log(`wrote ${Object.keys(out).length} prices`)
