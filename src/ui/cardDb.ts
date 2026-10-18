import { CardSchema, buildCardDB, type CardDB, type CardDef } from '../engine'
import { testCards } from '../data/test-cards'
import saiyanRaw from '../data/saiyan-saga/cards.json'
import saiyanIndex from '../data/saiyan-saga/index.json'
import friezaRaw from '../data/frieza-saga/cards.json'
import friezaIndex from '../data/frieza-saga/index.json'

/** The transcribed sets, in release order. */
export const SETS = [
  { key: 'saiyan-saga', name: 'Saiyan Saga', raw: saiyanRaw as unknown[], index: saiyanIndex, imageDir: '/cards/' },
  { key: 'frieza-saga', name: 'Frieza Saga', raw: friezaRaw as unknown[], index: friezaIndex, imageDir: '/cards/frieza-saga/' },
] as const
export type SetName = (typeof SETS)[number]['name']

export const invalidCards: { id: string; error: string }[] = []
export const realCards: CardDef[] = []
for (const set of SETS) {
  for (const raw of set.raw) {
    const r = CardSchema.safeParse(raw)
    if (r.success) realCards.push(r.data)
    else invalidCards.push({ id: (raw as { id?: string }).id ?? '?', error: r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') })
  }
}

/** Release order of a set (0 = Saiyan Saga), for "newest printing first" choices. */
export const setOrder = (name: string) => SETS.findIndex(s => s.name === name)

export const db: CardDB = { ...buildCardDB(testCards), ...Object.fromEntries(realCards.map(c => [c.id, c])) }
