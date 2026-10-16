// Caches card images from index.json into public/cards/ (gitignored).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import index from '../src/data/saiyan-saga/index.json'

mkdirSync('public/cards', { recursive: true })
let done = 0
for (const e of index) {
  const out = `public/cards/${e.slug}.jpg`
  if (existsSync(out)) continue
  const res = await fetch(e.imageUrl)
  if (!res.ok) { console.warn(`failed ${e.slug}: ${res.status}`); continue }
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
  done++
}
console.log(`downloaded ${done}, total ${index.length}`)
