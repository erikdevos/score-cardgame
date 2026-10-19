import { CardSchema, buildCardDB, type CardDB, type CardDef } from '../engine'
import { testCards } from '../data/test-cards'
import saiyanRaw from '../data/saiyan-saga/cards.json'
import saiyanIndex from '../data/saiyan-saga/index.json'
import friezaRaw from '../data/frieza-saga/cards.json'
import friezaIndex from '../data/frieza-saga/index.json'
import trunksRaw from '../data/trunks-saga/cards.json'
import trunksIndex from '../data/trunks-saga/index.json'
import androidsRaw from '../data/androids-saga/cards.json'
import androidsIndex from '../data/androids-saga/index.json'
import cellRaw from '../data/cell-saga/cards.json'
import cellIndex from '../data/cell-saga/index.json'
import cellGamesRaw from '../data/cell-games-saga/cards.json'
import cellGamesIndex from '../data/cell-games-saga/index.json'
import worldGamesRaw from '../data/world-games-saga/cards.json'
import worldGamesIndex from '../data/world-games-saga/index.json'
import babidiRaw from '../data/babidi-saga/cards.json'
import babidiIndex from '../data/babidi-saga/index.json'
import buuRaw from '../data/buu-saga/cards.json'
import buuIndex from '../data/buu-saga/index.json'

/** The transcribed sets, in release order. */
export const SETS = [
  { key: 'saiyan-saga', name: 'Saiyan Saga', raw: saiyanRaw as unknown[], index: saiyanIndex, imageDir: '/cards/' },
  { key: 'frieza-saga', name: 'Frieza Saga', raw: friezaRaw as unknown[], index: friezaIndex, imageDir: '/cards/frieza-saga/' },
  { key: 'trunks-saga', name: 'Trunks Saga', raw: trunksRaw as unknown[], index: trunksIndex, imageDir: '/cards/trunks-saga/' },
  { key: 'androids-saga', name: 'Androids Saga', raw: androidsRaw as unknown[], index: androidsIndex, imageDir: '/cards/androids-saga/' },
  { key: 'cell-saga', name: 'Cell Saga', raw: cellRaw as unknown[], index: cellIndex, imageDir: '/cards/cell-saga/' },
  { key: 'cell-games-saga', name: 'Cell Games Saga', raw: cellGamesRaw as unknown[], index: cellGamesIndex, imageDir: '/cards/cell-games-saga/' },
  { key: 'world-games-saga', name: 'World Games Saga', raw: worldGamesRaw as unknown[], index: worldGamesIndex, imageDir: '/cards/world-games-saga/' },
  { key: 'babidi-saga', name: 'Babidi Saga', raw: babidiRaw as unknown[], index: babidiIndex, imageDir: '/cards/babidi-saga/' },
  { key: 'buu-saga', name: 'Buu Saga', raw: buuRaw as unknown[], index: buuIndex, imageDir: '/cards/buu-saga/' },
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

