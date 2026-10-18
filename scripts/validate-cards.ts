// Validates a cards.json file against the engine card schema.
// Usage: npx tsx scripts/validate-cards.ts [path]  (default: every src/data/*/cards.json)
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { CardSchema } from '../src/engine/cards'

const paths = process.argv[2] ? [process.argv[2]] : readdirSync('src/data').map(d => `src/data/${d}/cards.json`).filter(existsSync)
let errors = 0
const ids = new Set<string>()
for (const path of paths) {
  const cards = JSON.parse(readFileSync(path, 'utf8')) as unknown[]
  for (const raw of cards) {
    const r = CardSchema.safeParse(raw)
    const id = (raw as { id?: string }).id ?? '?'
    if (!r.success) {
      errors++
      console.error(`${id}: ${r.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`)
      continue
    }
    if (ids.has(id)) { errors++; console.error(`${id}: duplicate id`) }
    ids.add(id)
    const p = r.data.personality
    if (p && p.powerRatings.some((v, i) => i > 0 && v < p.powerRatings[i - 1])) console.warn(`${id}: power ratings not ascending`)
  }
  const all = cards as { verified?: boolean; needsReview?: string }[]
  console.log(`${path}: ${cards.length} cards, ${all.filter(c => c.needsReview).length} need review, ${all.filter(c => c.verified).length} verified`)
}
console.log(`${errors} invalid`)
process.exit(errors ? 1 : 0)
