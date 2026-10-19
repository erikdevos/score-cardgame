// Scrapes a set's image listing pages into src/data/<set>/index.json.
// Usage: npx tsx scripts/fetch-card-index.ts [saiyan-saga|frieza-saga|trunks-saga|androids-saga|cell-saga|cell-games-saga|world-games-saga|babidi-saga|buu-saga]
// Only the listing HTML is fetched here; scripts/download-images.ts caches the images.
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = 'http://retrodbzccgcom.fatcow.com/card-images'
const SETS: Record<string, string[]> = {
  'saiyan-saga': ['starter', 'commons', 'uncommons', 'rares', 'ultra-rares', 'promos'],
  'frieza-saga': ['commons', 'uncommons', 'rares', 'ultra-rares', 'promos', 'wrapper-redemptions'],
  'trunks-saga': ['starter', 'commons', 'uncommons', 'rares', 'ultra-rares', 'promos', 'previews'],
  'androids-saga': ['commons', 'uncommons', 'rares', 'ultra-rares', 'promos', 'previews'],
  'cell-games-saga': ['commons', 'uncommons', 'rares', 'ultra-rares', 'promos', 'previews'],
  'world-games-saga': ['starter', 'commons', 'uncommons', 'rares', 'ultra-rares', 'promos', 'previews'],
  'babidi-saga': ['commons', 'uncommons', 'rares', 'ultra-rares', 'promos', 'previews'],
  'buu-saga': ['starter', 'commons', 'uncommons', 'rares', 'ultra-rares', 'promos', 'previews'],
  'cell-saga': ['starter', 'commons', 'uncommons', 'rares', 'ultra-rares', 'promos', 'previews'],
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
// Trunks Saga: WordPress renamed duplicate uploads by appending a suffix ("051-1.jpg" became "0511"),
// so the real number follows from the bucket ranges (commons 1-40, uncommons 41-111, rares 112-156)
if (set === 'androids-saga') {
  // commons 1-10 are clean, the rest carry an upload suffix ("0111.jpg" is card 11, "1242" is card 124)
  for (const e of entries) {
    if (e.bucket === 'promos') e.number = `P${e.number.slice(1, -1)}`
    else if (+e.number > 10) e.number = String(Math.floor(+e.number / 10))
  }
}
if (set === 'cell-saga' || set === 'cell-games-saga' || set === 'world-games-saga' || set === 'babidi-saga' || set === 'buu-saga') {
  // same upload suffix problem: "0011.jpg" is card 1, "1262" is card 126
  for (const e of entries) {
    if (e.slug === '201' || e.slug === '166-alt') continue // uploads without a numeric suffix (World Games 201, Buu alternate 166)
    e.number = e.bucket === 'promos' ? `P${e.number.slice(1, -1)}` : String(Math.floor(+e.number / 10))
  }
}
if (set === 'trunks-saga') {
  const commons: Record<string, number> = { 51: 5, 61: 6, 71: 7, 81: 8, 91: 9, 126: 1, 210: 2, 310: 3, 410: 4, 1010: 10 }
  for (const e of entries) {
    if (e.bucket === 'promos') e.number = `P${e.number.slice(1, -1)}`
    else if (e.bucket === 'commons' && commons[e.number]) e.number = String(commons[e.number])
    else if (/^0\d{3}$/.test(e.slug) || (e.bucket !== 'starter' && +e.number > 1000)) e.number = String(Math.floor(+e.number / 10))
  }
}
const num = (n: string) => (n.startsWith('P') ? 1000 : 0) + parseInt(n.replace('P', ''))
entries.sort((a, b) => num(a.number) - num(b.number) || a.bucket.localeCompare(b.bucket))
mkdirSync(`src/data/${set}`, { recursive: true })
writeFileSync(`src/data/${set}/index.json`, JSON.stringify(entries, null, 2) + '\n')
console.log(`wrote ${entries.length} entries`)
