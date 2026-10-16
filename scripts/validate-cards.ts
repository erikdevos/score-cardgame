// Validates src/data/saiyan-saga/cards.json against the engine card schema.
import { CardSchema } from '../src/engine/cards'
import cards from '../src/data/saiyan-saga/cards.json'

let errors = 0
const ids = new Set<string>()
for (const raw of cards as unknown[]) {
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
console.log(`${cards.length} cards, ${errors} invalid, ${all.filter(c => c.needsReview).length} need review, ${all.filter(c => c.verified).length} verified`)
process.exit(errors ? 1 : 0)
