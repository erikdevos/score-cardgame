import type { CardDB } from './cards'
import type { DeckList, Rules } from './types'

export function validateDeck(db: CardDB, deck: DeckList, rules: Rules): string[] {
  const errors: string[] = []
  const mps = deck.mp.map(id => db[id])
  if (mps.some(d => !d)) errors.push('Unknown card in Main Personality')
  else {
    if (mps.some(d => d.type !== 'Personality')) errors.push('Main Personality must only contain personality cards')
    const chars = new Set(mps.map(d => d.personality?.character))
    if (chars.size !== 1) errors.push('All Main Personality levels must be the same character')
    mps.forEach((d, i) => { if (d.personality?.level !== i + 1) errors.push(`Main Personality slot ${i + 1} must be level ${i + 1}`) })
  }
  const mpChar = mps[0]?.personality?.character
  const { minLife, maxLife, maxCopies, maxNamedCopies } = rules.deck
  if (deck.life.length < minLife || deck.life.length > maxLife) errors.push(`Life deck must have ${minLife}-${maxLife} cards (has ${deck.life.length})`)
  // copies are counted by title, so a reprint in a later set shares the limit with the original
  const counts = new Map<string, { n: number; id: string }>()
  for (const id of deck.life) {
    const d = db[id]
    if (!d) { errors.push(`Unknown card ${id}`); continue }
    const c = counts.get(d.name) ?? { n: 0, id }
    c.n++
    counts.set(d.name, c)
  }
  for (const [name, { n, id }] of counts) {
    const d = db[id]
    const limit = d.limitPerDeck ?? (d.named && d.named === mpChar ? maxNamedCopies : maxCopies)
    if (n > limit) errors.push(`${name}: ${n} copies (max ${limit})`)
  }
  return errors
}
