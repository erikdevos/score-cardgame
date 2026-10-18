import { realCards, type SetName } from './cardDb'

// Which sets a game draws its cards from. Chosen on the menu, per game.
export const FORMATS = {
  SAIYAN: { label: 'Saiyan Saga', sets: ['Saiyan Saga'] as SetName[] },
  SAIYAN_FRIEZA: { label: 'Saiyan + Frieza', sets: ['Saiyan Saga', 'Frieza Saga'] as SetName[] },
} as const
export type FormatKey = keyof typeof FORMATS

export const formatCards = (f: FormatKey) => realCards.filter(c => (FORMATS[f].sets as string[]).includes(c.set))
/** A format is playable once all of its sets have cards transcribed. */
export const formatReady = (f: FormatKey) => FORMATS[f].sets.every(s => realCards.some(c => c.set === s))
export const unverifiedIn = (f: FormatKey) => formatCards(f).filter(c => !c.verified).length
