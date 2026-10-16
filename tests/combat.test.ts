import { describe, expect, it } from 'vitest'
import { IllegalActionError, applyAction, legalActions } from '../src/engine'
import { db } from './fixtures/testCards'
import { act, give, inCombat } from './helpers'

describe('battle sequencer', () => {
  it('converts stage damage below 0 into life cards 1:1', () => {
    const s = inCombat()
    s.players[0].mp.stage = 10 // Hero Lv1: 1000 -> bracket 2
    s.players[1].mp.stage = 2 // Villain Lv1: 200 -> bracket 0; PAT 4 + 3 = 7 stages
    const deck = s.players[1].lifeDeck.length
    const r = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(r.players[1].mp.stage).toBe(0)
    expect(r.players[1].lifeDeck.length).toBe(deck - 5)
  })

  it('resolves non-conditional secondaries even when the attack is stopped', () => {
    const s = inCombat()
    s.players[0].mp.anger = 2
    const stage1 = s.players[1].mp.stage
    const block = give(s, 1, 'TEST-BLOCK')
    let r = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(r.players[0].mp.anger).toBe(3) // raised before the defend window
    expect(r.pendingChoice).toEqual({ kind: 'DEFEND', player: 1 })
    r = act(r, { type: 'DEFEND', player: 1, iid: block })
    expect(r.players[0].mp.anger).toBe(2) // block lowers foe's anger
    expect(r.players[1].mp.stage).toBe(stage1)
    expect(r.players[1].discard.map(c => c.defId)).toContain('TEST-BLOCK')
    expect(r.players[0].discard.map(c => c.defId)).toContain('TEST-PUNCH')
  })

  it('skips "if successful" effects when stopped', () => {
    const s = inCombat()
    s.players[1].mp.anger = 3
    const shield = give(s, 1, 'TEST-SHIELD')
    let r = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BLAST') })
    r = act(r, { type: 'DEFEND', player: 1, iid: shield })
    expect(r.players[1].mp.anger).toBe(3)
  })

  it('applies "if successful" effects and default energy cost/damage on a hit', () => {
    const s = inCombat()
    s.players[1].mp.anger = 3
    s.players[0].mp.stage = 5
    const deck = s.players[1].lifeDeck.length
    const r = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BLAST') })
    expect(r.players[0].mp.stage).toBe(3) // cost 2 stages
    expect(r.players[1].lifeDeck.length).toBe(deck - 4)
    expect(r.players[1].mp.anger).toBe(2)
  })

  it('counts a 0-damage unstopped attack as successful', () => {
    const s = inCombat()
    const r = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-SLAP') })
    expect(r.players[0].mp.anger).toBe(1)
  })

  it('does not allow an energy attack without enough power stages', () => {
    const s = inCombat()
    s.players[0].mp.stage = 1
    const iid = give(s, 0, 'TEST-BLAST')
    expect(legalActions(s, db).some(a => a.type === 'PLAY_CARD' && a.iid === iid)).toBe(false)
    expect(() => applyAction(s, db, { type: 'PLAY_CARD', player: 0, iid })).toThrow(IllegalActionError)
  })

  it('lets the attacker capture a Dragon Ball on 5+ life cards of damage', () => {
    const s = inCombat()
    s.players[1].dragonBalls.push({ iid: 'db3', defId: 'TEST-DB-3', owner: 1 })
    let r = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BIG-BLAST') })
    expect(r.pendingChoice).toEqual({ kind: 'DB_STEAL', player: 0 })
    r = act(r, { type: 'STEAL_DB', player: 0, iid: 'db3' })
    expect(r.players[0].dragonBalls.map(c => c.iid)).toEqual(['db3'])
    expect(r.players[1].dragonBalls).toEqual([])
  })

  it('alternates phases and ends combat after two consecutive passes', () => {
    let s = inCombat()
    s = act(s, { type: 'PASS', player: 0 })
    expect(s.combat!.active).toBe(1)
    s = act(s, { type: 'PASS', player: 1 })
    expect(s.combat).toBeNull()
    expect(s.step).not.toBe('COMBAT')
  })

  it('resets the pass count after an action', () => {
    let s = inCombat()
    s = act(s, { type: 'PASS', player: 0 })
    s = act(s, { type: 'PLAY_CARD', player: 1, iid: give(s, 1, 'TEST-SLAP') })
    expect(s.combat!.active).toBe(0)
    s = act(s, { type: 'PASS', player: 0 })
    expect(s.step).toBe('COMBAT')
  })

  it('ends combat via a card effect', () => {
    const s = inCombat()
    const r = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-TRUCE') })
    expect(r.combat).toBeNull()
  })

  it('allows a personality power once per combat', () => {
    let s = inCombat()
    s.combat!.active = 1
    expect(legalActions(s, db).some(a => a.type === 'USE_POWER')).toBe(true)
    s = act(s, { type: 'USE_POWER', player: 1 })
    s = act(s, { type: 'PASS', player: 0 })
    expect(legalActions(s, db).some(a => a.type === 'USE_POWER')).toBe(false)
  })
})
