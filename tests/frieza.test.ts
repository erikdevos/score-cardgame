import { describe, expect, it } from 'vitest'
import { applyAction, buildCardDB, legalActions, type Action, type GameState, type PlayerId } from '../src/engine'
import saiyan from '../src/data/saiyan-saga/cards.json'
import frieza from '../src/data/frieza-saga/cards.json'
import { db as testDb } from './fixtures/testCards'
import { give, inCombat, newGame } from './helpers'

// Frieza Saga handlers (transcribed, not yet verified: these test the engine behaviour, not the card text)
const db = { ...testDb, ...buildCardDB(saiyan as unknown[]), ...buildCardDB(frieza as unknown[]) }
const act = (s: GameState, a: Action) => applyAction(s, db, a).state
const legal = (s: GameState) => legalActions(s, db)

let n = 0
function place(s: GameState, p: PlayerId, defId: string, zone: 'nonCombat' | 'drills' | 'dragonBalls' = 'nonCombat') {
  const iid = `fs${n++}-${defId}`
  s.players[p][zone].push({ iid, defId, owner: p })
  return iid
}
function setMP(s: GameState, p: PlayerId, defId: string) {
  s.players[p].mp.stack = [{ iid: `mp-${p}-${defId}`, defId, owner: p }]
  s.players[p].mp.levelIndex = 0
}

describe('Frieza Saga handlers', () => {
  it('FS-15 raises anger by 2 instead of 1 while a Dragon Ball 6 is in play', () => {
    let s = inCombat()
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'FS-15') })
    const without = s.players[0].mp.anger
    let t = inCombat()
    place(t, 1, 'SS-186', 'dragonBalls')
    t = act(t, { type: 'PLAY_CARD', player: 0, iid: give(t, 0, 'FS-15') })
    expect(t.players[0].mp.anger).toBe(without + 1)
  })

  it('FS-114 cannot be defended by a main personality power, but a card still works', () => {
    let s = inCombat()
    setMP(s, 1, 'SS-173')
    const shield = give(s, 1, 'TEST-SHIELD')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'FS-114') })
    expect(s.pendingChoice?.kind).toBe('DEFEND')
    expect(legal(s).some(a => a.type === 'DEFEND_POWER')).toBe(false)
    expect(legal(s).some(a => a.type === 'DEFEND' && a.iid === shield)).toBe(true)
  })

  it('FS-96 still does 3 life cards when the energy attack is stopped', () => {
    let s = inCombat()
    setMP(s, 0, 'FS-96')
    const shield = give(s, 1, 'TEST-SHIELD')
    const life = s.players[1].lifeDeck.length
    s = act(s, { type: 'USE_POWER', player: 0 })
    s = act(s, { type: 'DEFEND', player: 1, iid: shield })
    expect(s.players[1].lifeDeck.length).toBe(life - 3)
  })

  it('FS-101 lets the opponent play only 1 Dragon Ball per turn', () => {
    let s = newGame()
    s.attacker = 0
    s.step = 'NON_COMBAT'
    s.pendingChoice = null
    place(s, 1, 'FS-101', 'drills')
    const one = give(s, 0, 'SS-15')
    const two = give(s, 0, 'SS-16')
    expect(legal(s).some(a => a.type === 'PLAY_CARD' && a.iid === two)).toBe(true)
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: one })
    while (s.pendingChoice?.kind === 'PICK') s = act(s, legal(s)[0])
    expect(legal(s).some(a => a.type === 'PLAY_CARD' && a.iid === two)).toBe(false)
  })

  it('FS-P11 discards a random card from the opponent\'s hand', () => {
    let s = inCombat()
    for (let i = 0; i < 3; i++) give(s, 1, 'TEST-PUNCH')
    const discard = s.players[1].discard.length
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'FS-P11') })
    expect(s.players[1].hand.length).toBe(2)
    expect(s.players[1].discard.length).toBe(discard + 1)
  })
})
