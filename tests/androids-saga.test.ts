import { describe, expect, it } from 'vitest'
import { allCardsOf, applyAction, chooseAction, createGame, type GameState } from '../src/engine'
import { db, realCards } from '../src/ui/cardDb'
import { deckChoices } from '../src/ui/decks'
import { FORMATS } from '../src/ui/formats'

const FORMAT = 'SAIYAN_FRIEZA_TRUNKS_ANDROIDS'

describe('Androids Saga pool', () => {
  it('loads 136 cards', () => {
    expect(realCards.filter(c => c.set === 'Androids Saga')).toHaveLength(136)
  })

  it('AI games finish and conserve cards', () => {
    const choices = deckChoices(FORMAT).filter(c => c.key.startsWith('auto-'))
    expect(choices.length).toBeGreaterThan(4)
    const warns = new Map<string, number>()
    for (let seed = 1; seed <= 30; seed++) {
      const a = choices[seed % choices.length]
      const b = choices[(seed * 7 + 1) % choices.length]
      let s: GameState = createGame(db, [a.build(seed), b.build(seed + 1)], { seed, rules: FORMATS[FORMAT].rules })
      const total = [allCardsOf(s, 0).length, allCardsOf(s, 1).length]
      for (let i = 0; i < 5000 && s.winner === null; i++) s = applyAction(s, db, chooseAction(s, db)!).state
      expect(s.winner, `seed ${seed} (${a.label} vs ${b.label}) did not finish`).not.toBeNull()
      expect([allCardsOf(s, 0).length, allCardsOf(s, 1).length]).toEqual(total)
      for (const e of s.log) if (e.t === 'WARN') warns.set(e.msg.replace(/^.*custom effect /, ''), (warns.get(e.msg.replace(/^.*custom effect /, '')) ?? 0) + 1)
    }
    console.log('unimplemented in play:', [...warns].sort((x, y) => y[1] - x[1]).slice(0, 10))
  })
})
