import type { CardDB } from './cards'
import { tokuiWazaStyle, trunksAllyAllowed } from './state'
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
    if (d.type === 'Mastery') errors.push(`${d.name} is a Mastery card: it goes in play at the start, not in the life deck`)
    const c = counts.get(d.name) ?? { n: 0, id }
    c.n++
    counts.set(d.name, c)
  }
  for (const [name, { n, id }] of counts) {
    const d = db[id]
    const limit = d.limitPerDeck ?? (d.named && d.named === mpChar ? maxNamedCopies : maxCopies)
    if (n > limit) errors.push(`${name}: ${n} copies (max ${limit})`)
  }
  if (deck.mastery && db[deck.mastery]?.type !== 'Mastery') errors.push('The Mastery slot only takes a Mastery card')
  if (deck.mastery && db[deck.mastery]?.style && tokuiWazaStyle(db, { ...deck, mastery: undefined }) && tokuiWazaStyle(db, deck) === null) errors.push('The Mastery card must match the Tokui-Waza style')
  if (rules.trunks.allyRules) errors.push(...trunksDeckErrors(db, deck))
  return errors
}

/** Trunks Saga deck rules: one copy per personality level (Saibaimen 3), legal allies, Earth or Namek Dragon Balls. */
function trunksDeckErrors(db: CardDB, deck: DeckList): string[] {
  const errors: string[] = []
  const mpCards = deck.mp.map(id => db[id]).filter(Boolean)
  const perLevel = new Map<string, number>()
  const kinds = new Set<string>()
  for (const id of deck.life) {
    const d = db[id]
    if (!d) continue
    if (d.type === 'Dragon Ball') kinds.add(/Namek/i.test(d.name) ? 'Namek' : 'Earth')
    if (d.type !== 'Personality' || !d.personality) continue
    const key = `${d.personality.character} Lv${d.personality.level}`
    perLevel.set(key, (perLevel.get(key) ?? 0) + 1)
    if (!trunksAllyAllowed(mpCards, undefined, d)) errors.push(`${d.name} cannot be an ally of this main personality`)
  }
  for (const [key, n] of perLevel) if (n > (key.startsWith('Saibaimen') ? 3 : 1)) errors.push(`${key}: ${n} copies (max ${key.startsWith('Saibaimen') ? 3 : 1})`)
  if (kinds.size > 1) errors.push('A deck may contain Earth or Namek Dragon Balls, not both')
  return [...new Set(errors)]
}
