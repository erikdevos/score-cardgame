import { computed } from 'vue'
import type { CardDef, Rules } from '../engine'
import patTrunks from '../engine/config/pat-trunks.json'
import patCell from '../engine/config/pat-cell.json'
import patBuu from '../engine/config/pat-buu.json'
import { realCards, type SetName } from './cardDb'
import { settings } from './settings'

const TRUNKS_CORE = { levelStages: true, mostPowerfulByHighestLevel: true, finalPhysicalAttack: true, skipCombatRecovers: true, heroFirst: true, allyRules: true, dragonBalls: true, tokuiWaza: true }

// Which sets a game draws its cards from. Chosen on the menu, per game.
export const FORMATS = {
  SAIYAN: { label: 'Saiyan Saga', sets: ['Saiyan Saga'] as SetName[], rules: {} as Partial<Rules> },
  // Frieza Saga power levels go far past the Saiyan Saga table: use the Trunks Saga rulebook's table (no Frieza Saga rulebook available)
  SAIYAN_FRIEZA: {
    label: 'Up to Frieza Saga', sets: ['Saiyan Saga', 'Frieza Saga'] as SetName[],
    // Trunks Saga core rules (rulebook 2001) on top of the table; see docs/dsl-gaps.md "Frieza Saga"
    rules: {
      pat: { brackets: patTrunks.brackets, matrix: patTrunks.matrix },
      trunks: TRUNKS_CORE,
    } as Partial<Rules>,
  },
  SAIYAN_FRIEZA_TRUNKS: {
    label: 'Up to Trunks Saga', sets: ['Saiyan Saga', 'Frieza Saga', 'Trunks Saga'] as SetName[],
    rules: { pat: { brackets: patTrunks.brackets, matrix: patTrunks.matrix }, trunks: TRUNKS_CORE } as Partial<Rules>,
  },
  SAIYAN_FRIEZA_TRUNKS_ANDROIDS: {
    label: 'Up to Androids Saga', sets: ['Saiyan Saga', 'Frieza Saga', 'Trunks Saga', 'Androids Saga'] as SetName[],
    rules: { pat: { brackets: patTrunks.brackets, matrix: patTrunks.matrix }, trunks: TRUNKS_CORE } as Partial<Rules>,
  },
  SAIYAN_FRIEZA_TRUNKS_ANDROIDS_CELL: {
    label: 'Up to Cell Saga', sets: ['Saiyan Saga', 'Frieza Saga', 'Trunks Saga', 'Androids Saga', 'Cell Saga'] as SetName[],
    rules: { pat: { brackets: patCell.brackets, matrix: patCell.matrix }, trunks: { ...TRUNKS_CORE, doublePower: true } } as Partial<Rules>,
  },
  ALL_SETS: {
    label: 'All sets', sets: ['Saiyan Saga', 'Frieza Saga', 'Trunks Saga', 'Androids Saga', 'Cell Saga', 'Cell Games Saga', 'World Games Saga', 'Babidi Saga', 'Buu Saga'] as SetName[],
    rules: { pat: { brackets: patBuu.brackets, matrix: patBuu.matrix }, trunks: { ...TRUNKS_CORE, doublePower: true } } as Partial<Rules>,
  },
} as const
export type FormatKey = keyof typeof FORMATS

export const formatCards = (f: FormatKey) => realCards.filter(c => (FORMATS[f].sets as string[]).includes(c.set))
/** A format is playable once all of its sets have cards transcribed. */
export const formatReady = (f: FormatKey) => FORMATS[f].sets.every(s => realCards.some(c => c.set === s))
export const unverifiedIn = (f: FormatKey) => formatCards(f).filter(c => !c.verified).length

/** Highest personality level per character in the chosen card pool (the same stack the decks are built from). */
const topLevels = computed(() => {
  const cap = settings.format === 'SAIYAN' ? 3 : 4
  const m = new Map<string, number>()
  for (const c of formatCards(settings.format)) {
    const p = c.type === 'Personality' ? c.personality : undefined
    if (p && c.rarity !== 'Promo' && p.level <= cap) m.set(p.character, Math.max(m.get(p.character) ?? 0, p.level))
  }
  return m
})
/** True for the highest-level Personality of a character in the current pool (shiny/aura treatment). */
export const isTopLevel = (c?: CardDef) => !!c && c.type === 'Personality' && !!c.personality && topLevels.value.get(c.personality.character) === c.personality.level
