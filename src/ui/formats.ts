import type { Rules } from '../engine'
import patTrunks from '../engine/config/pat-trunks.json'
import { realCards, type SetName } from './cardDb'

// Which sets a game draws its cards from. Chosen on the menu, per game.
export const FORMATS = {
  SAIYAN: { label: 'Saiyan Saga', sets: ['Saiyan Saga'] as SetName[], rules: {} as Partial<Rules> },
  // Frieza Saga power levels go far past the Saiyan Saga table: use the Trunks Saga rulebook's table (no Frieza Saga rulebook available)
  SAIYAN_FRIEZA: {
    label: 'Saiyan + Frieza', sets: ['Saiyan Saga', 'Frieza Saga'] as SetName[],
    rules: { pat: { brackets: patTrunks.brackets, matrix: patTrunks.matrix } } as Partial<Rules>,
  },
} as const
export type FormatKey = keyof typeof FORMATS

export const formatCards = (f: FormatKey) => realCards.filter(c => (FORMATS[f].sets as string[]).includes(c.set))
/** A format is playable once all of its sets have cards transcribed. */
export const formatReady = (f: FormatKey) => FORMATS[f].sets.every(s => realCards.some(c => c.set === s))
export const unverifiedIn = (f: FormatKey) => formatCards(f).filter(c => !c.verified).length
