import { describe, expect, it } from 'vitest'
import { allCardsOf, applyAction, chooseAction, legalActions, nextRandomForTests, type GameState } from '../src/engine'
import { db } from './fixtures/testCards'
import { newGame } from './helpers'

const MAX_ACTIONS = 5000

function play(seed: number, randomness: number) {
  let s: GameState = newGame(seed)
  const total = [allCardsOf(s, 0).length, allCardsOf(s, 1).length]
  let r = seed
  for (let i = 0; i < MAX_ACTIONS && s.winner === null; i++) {
    const legal = legalActions(s, db)
    expect(legal.length, `no legal actions at step ${s.step}`).toBeGreaterThan(0)
    let action = chooseAction(s, db)!
    const [x, n] = nextRandomForTests(r)
    r = n
    if (x < randomness) action = legal[Math.floor(x / randomness * legal.length)]
    s = applyAction(s, db, action).state
    expect([allCardsOf(s, 0).length, allCardsOf(s, 1).length]).toEqual(total)
  }
  return s
}

describe('AI vs AI fuzz', () => {
  it('every seeded game terminates with a winner and conserves cards', () => {
    const reasons: Record<string, number> = {}
    for (let seed = 1; seed <= 300; seed++) {
      const s = play(seed, seed % 2 ? 0.3 : 0)
      expect(s.winner, `seed ${seed} did not finish`).not.toBeNull()
      reasons[s.winReason!] = (reasons[s.winReason!] ?? 0) + 1
    }
    console.log('win reasons', reasons)
  })

  it('same seed gives an identical log', () => {
    expect(play(7, 0.3).log).toEqual(play(7, 0.3).log)
  })
})
