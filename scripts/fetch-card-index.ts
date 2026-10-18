// Scrapes a set's image listing pages into src/data/<set>/index.json.
// Usage: npx tsx scripts/fetch-card-index.ts [saiyan-saga|frieza-saga]
// Only the listing HTML is fetched here; scripts/download-images.ts caches the images.
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = 'http://retrodbzccgcom.fatcow.com/card-images'
const SETS: Record<string, string[]> = {
  'saiyan-saga': ['starter', 'commons', 'uncommons', 'rares', 'ultra-rares', 'promos'],
  'frieza-saga': ['commons', 'uncommons', 'rares', 'ultra-rares', 'promos', 'wrapper-redemptions'],
}
const set = process.argv[2] ?? 'saiyan-saga'
const folders = SETS[set]
if (!folders) throw new Error(`unknown set ${set}; known: ${Object.keys(SETS).join(', ')}`)

interface IndexEntry {
  number: string
  slug: string
  /** empty when the file name has no title (Frieza Saga): read it from the card */
  title: string
  bucket: string
  variant: 'normal' | 'hi-tech'
  imageUrl: string
}

const entries: IndexEntry[] = []
const seen = new Set<string>()
for (const bucket of folders) {
  const html = await (await fetch(`${BASE}/${set}-${bucket}/`)).text()
  // "25-Gokus-Physical-Attack.jpg" (Saiyan Saga) or "025.jpg" / "P3.jpg" (Frieza Saga); skip resized thumbnails
  const re = /wp-content\/uploads\/(\d{4}\/\d{2})\/((P?\d+)(?:-([^"?&#\s']+?))?)\.(jpg|png)/gi
  for (const m of html.matchAll(re)) {
    const [, ym, file, rawNumber, rest = '', ext] = m
    if (/^\d+x\d+$/.test(rest) || /-\d+x\d+$/.test(rest)) continue
    const key = `${bucket}/${file}`
    if (seen.has(key)) continue
    seen.add(key)
    const hiTech = /-HT$/i.test(rest)
    const title = rest.replace(/-HT$/i, '').replace(/\.+$/, '').replace(/-/g, ' ')
    entries.push({
      number: rawNumber.replace(/^0+(?=\d)/, ''), slug: file, title, bucket, variant: hiTech ? 'hi-tech' : 'normal',
      imageUrl: `https://i0.wp.com/retrodbzccg.com/wp-content/uploads/${ym}/${file}.${ext}`,
    })
  }
  console.log(`${bucket}: ${entries.filter(e => e.bucket === bucket).length}`)
}
const num = (n: string) => (n.startsWith('P') ? 1000 : 0) + parseInt(n.replace('P', ''))
entries.sort((a, b) => num(a.number) - num(b.number) || a.bucket.localeCompare(b.bucket))
mkdirSync(`src/data/${set}`, { recursive: true })
writeFileSync(`src/data/${set}/index.json`, JSON.stringify(entries, null, 2) + '\n')
console.log(`wrote ${entries.length} entries`)
