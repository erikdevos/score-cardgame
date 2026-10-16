import { describe, expect, it } from 'vitest'
import { legalActions, type GameState } from '../src/engine'
import { db } from './fixtures/testCards'
import { act, give, inCombat, newGame } from './helpers'

const canPlay = (s: GameState, iid: string) => legalActions(s, db).some(a => 'iid' in a && a.iid === iid)

describe('usableBy', () => {
  it('blocks a card when neither alignment nor character matches', () => {
    const s = inCombat() // player 0 is the Hero MP (alignment Hero)
    expect(canPlay(s, give(s, 0, 'TEST-VILLAIN-PUNCH'))).toBe(false)
  })

  it('allows a card when the character matches', () => {
    const s = inCombat()
    expect(canPlay(s, give(s, 0, 'TEST-HERO-NAMED-PUNCH'))).toBe(true)
  })

  it('allows a card when the alignment matches', () => {
    const s = inCombat()
    s.combat!.active = 1
    // villain fixture MP is printed as Hero alignment, so make it a Villain for this test
    const vil = { ...db['TEST-VIL-1'], id: 'TEST-VIL-1-V', personality: { ...db['TEST-VIL-1'].personality!, alignment: 'Villain' as const } }
    const localDb = { ...db, [vil.id]: vil }
    s.players[1].mp.stack[0].defId = vil.id
    const iid = give(s, 1, 'TEST-VILLAIN-PUNCH')
    expect(legalActions(s, localDb).some(a => 'iid' in a && a.iid === iid)).toBe(true)
  })
})

describe('restricted drills', () => {
  it('cannot be played while a drill of that style is in play', () => {
    const s = newGame()
    const a = s.attacker
    s.players[1 - a].drills.push({ iid: 'od', defId: 'TEST-ORANGE-DRILL', owner: (1 - a) as 0 | 1 })
    expect(canPlay(s, give(s, a, 'TEST-ORANGE-SOLO'))).toBe(false)
  })

  it('is discarded when another drill of that style enters play', () => {
    let s = newGame()
    const a = s.attacker
    s.players[1 - a].drills.push({ iid: 'solo', defId: 'TEST-ORANGE-SOLO', owner: (1 - a) as 0 | 1 })
    s = act(s, { type: 'PLAY_CARD', player: a, iid: give(s, a, 'TEST-ORANGE-DRILL') })
    expect(s.players[1 - a].drills).toEqual([])
    expect(s.players[1 - a].discard.map(c => c.iid)).toContain('solo')
    expect(s.players[a].drills.map(c => c.defId)).toEqual(['TEST-ORANGE-DRILL'])
  })
})
