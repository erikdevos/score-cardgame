// Scrapes the Saiyan Saga image listing pages into src/data/saiyan-saga/index.json.
// Only the listing HTML is fetched; images stay hotlinked.
import { writeFileSync } from 'node:fs'

const BASE = 'http://retrodbzccgcom.fatcow.com/card-images'
const FOLDERS = ['starter', 'commons', 'uncommons', 'rares', 'ultra-rares', 'promos'] as const

interface IndexEntry {
  number: string
  slug: string
  title: string
  bucket: (typeof FOLDERS)[number]
  variant: 'normal' | 'hi-tech'
  imageUrl: string
}

const entries: IndexEntry[] = []
const seen = new Set<string>()
for (const bucket of FOLDERS) {
  const html = await (await fetch(`${BASE}/saiyan-saga-${bucket}/`)).text()
  const re = /wp-content\/uploads\/(\d{4}\/\d{2})\/((P?\d+)-([^"?&#]+?))\.(jpg|png)/gi
  for (const m of html.matchAll(re)) {
    const [, ym, file, number, rest, ext] = m
    const key = `${bucket}/${file}`
    if (seen.has(key)) continue
    seen.add(key)
    const hiTech = /-HT$/i.test(rest)
    const title = rest.replace(/-HT$/i, '').replace(/\.+$/, '').replace(/-/g, ' ')
    entries.push({
      number, slug: file, title, bucket, variant: hiTech ? 'hi-tech' : 'normal',
      imageUrl: `https://i0.wp.com/retrodbzccg.com/wp-content/uploads/${ym}/${file}.${ext}`,
    })
  }
  console.log(`${bucket}: ${entries.filter(e => e.bucket === bucket).length}`)
}
entries.sort((a, b) => parseInt(a.number.replace('P', '')) - parseInt(b.number.replace('P', '')) || a.bucket.localeCompare(b.bucket))
writeFileSync('src/data/saiyan-saga/index.json', JSON.stringify(entries, null, 2) + '\n')
console.log(`wrote ${entries.length} entries`)
