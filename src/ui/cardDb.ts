import { CardSchema, buildCardDB, type CardDB, type CardDef } from '../engine'
import { testCards } from '../data/test-cards'
import realRaw from '../data/saiyan-saga/cards.json'

export const invalidCards: { id: string; error: string }[] = []
export const realCards: CardDef[] = []
for (const raw of realRaw as unknown[]) {
  const r = CardSchema.safeParse(raw)
  if (r.success) realCards.push(r.data)
  else invalidCards.push({ id: (raw as { id?: string }).id ?? '?', error: r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') })
}

export const db: CardDB = { ...buildCardDB(testCards), ...Object.fromEntries(realCards.map(c => [c.id, c])) }
