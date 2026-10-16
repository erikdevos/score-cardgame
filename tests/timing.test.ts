import { describe, expect, it } from 'vitest'
import { legalActions, type GameState, type PlayerId } from '../src/engine'
import { db } from './fixtures/testCards'
import { act, give, inCombat, newGame } from './helpers'

const canPlay = (s: GameState, iid: string) => legalActions(s, db).some(a => 'iid' in a && a.iid === iid)
const place = (s: GameState, p: PlayerId, defId: string) => {
  const iid = `nc-${defId}`
  s.players[p].nonCombat.push({ iid, defId, owner: p })
  return iid
}

describe('Non-Combat timing (place, then use)', () => {
  it('places a Non-Combat card face up without resolving it', () => {
    let s = newGame()
    const a = s.attacker
    const iid = give(s, a, 'TEST-RAGE')
    s = act(s, { type: 'PLAY_CARD', player: a, iid })
    expect(s.players[a].nonCombat.map(c => c.iid)).toEqual([iid])
    expect(s.players[a].mp.anger).toBe(0)
  })

  it('uses a placed power later in step 2, then discards it', () => {
    let s = newGame()
    const a = s.attacker
    const iid = give(s, a, 'TEST-RAGE')
    s = act(s, { type: 'PLAY_CARD', player: a, iid })
    s = act(s, { type: 'PLAY_CARD', player: a, iid })
    expect(s.players[a].mp.anger).toBe(2)
    expect(s.players[a].nonCombat).toEqual([])
    expect(s.players[a].discard.map(c => c.iid)).toContain(iid)
  })

  it('keeps unused Non-Combat cards through the discard step', () => {
    let s = inCombat()
    place(s, 0, 'TEST-RAGE')
    s = act(s, { type: 'PASS', player: 0 })
    s = act(s, { type: 'PASS', player: 1 })
    expect(s.players[0].nonCombat.length).toBe(1)
  })

  it('uses a placed power in combat in place of an attack', () => {
    let s = inCombat()
    const iid = place(s, 0, 'TEST-RAGE')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid })
    expect(s.players[0].mp.anger).toBe(2)
    expect(s.combat!.active).toBe(1)
  })

  it('attacks with a placed Non-Combat attack card', () => {
    let s = inCombat()
    const stage = s.players[1].mp.stage
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: place(s, 0, 'TEST-NC-KICK') })
    expect(s.players[1].mp.stage).toBe(stage - 2)
    expect(s.players[0].discard.map(c => c.defId)).toContain('TEST-NC-KICK')
  })

  it('blocks with a placed Non-Combat card, but not from hand', () => {
    let s = inCombat()
    const fromHand = give(s, 1, 'TEST-NC-DODGE')
    const onTable = place(s, 1, 'TEST-NC-DODGE')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(canPlay(s, fromHand)).toBe(false)
    expect(canPlay(s, onTable)).toBe(true)
    const stage = s.players[1].mp.stage
    s = act(s, { type: 'DEFEND', player: 1, iid: onTable })
    expect(s.players[1].mp.stage).toBe(stage)
  })

  it('cannot play a Non-Combat card from hand during combat', () => {
    const s = inCombat()
    expect(canPlay(s, give(s, 0, 'TEST-RAGE'))).toBe(false)
  })
})

describe('usePhase DEFEND combat effects', () => {
  it('are not playable as an attack', () => {
    const s = inCombat()
    expect(canPlay(s, give(s, 0, 'TEST-DEFEND-TRUCE'))).toBe(false)
  })

  it('are played in the defend window and do not stop the attack by themselves', () => {
    let s = inCombat()
    const truce = give(s, 1, 'TEST-DEFEND-TRUCE')
    s.players[0].mp.stage = 10
    const stage = s.players[1].mp.stage
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(canPlay(s, truce)).toBe(true)
    s = act(s, { type: 'DEFEND', player: 1, iid: truce })
    expect(s.players[1].mp.stage).toBeLessThan(stage) // the punch still hits
    expect(s.combat).toBeNull() // and combat ends
  })
})
