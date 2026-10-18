// Caches a set's card images from src/data/<set>/index.json into public/cards/ (gitignored).
// Usage: npx tsx scripts/download-images.ts [saiyan-saga|frieza-saga|trunks-saga]
// Saiyan Saga images live directly in public/cards/ (existing paths); later sets get a subfolder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const set = process.argv[2] ?? 'saiyan-saga'
const index = JSON.parse(readFileSync(`src/data/${set}/index.json`, 'utf8')) as { slug: string; imageUrl: string }[]
const dir = set === 'saiyan-saga' ? 'public/cards' : `public/cards/${set}`
mkdirSync(dir, { recursive: true })
let done = 0
for (const e of index) {
  const out = `${dir}/${e.slug}.jpg`
  if (existsSync(out)) continue
  const res = await fetch(e.imageUrl)
  if (!res.ok) { console.warn(`failed ${e.slug}: ${res.status}`); continue }
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  done++
}
console.log(`downloaded ${done}, total ${index.length}`)
