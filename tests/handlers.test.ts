import { describe, expect, it } from 'vitest'
import { applyAction, buildCardDB, legalActions, type Action, type GameState, type PlayerId } from '../src/engine'
import realCards from '../src/data/saiyan-saga/cards.json'
import { db as testDb } from './fixtures/testCards'
import { give, inCombat, newGame } from './helpers'

// Real Saiyan Saga cards next to the fictional test cards.
const db = { ...testDb, ...buildCardDB(realCards as unknown[]) }
const act = (s: GameState, a: Action) => applyAction(s, db, a).state
const legal = (s: GameState) => legalActions(s, db)
const has = (s: GameState, pred: (a: Action) => boolean) => legal(s).some(pred)
const canPlay = (s: GameState, iid: string) => has(s, a => 'iid' in a && a.iid === iid)

function setMP(s: GameState, p: PlayerId, defId: string) {
  s.players[p].mp.stack = [{ iid: `mp-${p}-${defId}`, defId, owner: p }]
  s.players[p].mp.levelIndex = 0
}
function putInDiscard(s: GameState, p: PlayerId, defIds: string[]) {
  s.players[p].discard = defIds.map((defId, i) => ({ iid: `d-${p}-${i}`, defId, owner: p }))
}
function place(s: GameState, p: PlayerId, defId: string, zone: 'nonCombat' | 'drills' | 'dragonBalls' = 'nonCombat') {
  const iid = `${zone}-${p}-${defId}-${s.players[p][zone].length}`
  s.players[p][zone].push({ iid, defId, owner: p })
  return iid
}

describe('defensive personality powers (powerDefense)', () => {
  it('Vegeta Lv1 caps a successful energy attack at 2 life cards', () => {
    let s = inCombat()
    setMP(s, 1, 'SS-173')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BIG-BLAST') })
    expect(s.pendingChoice?.kind).toBe('DEFEND')
    expect(has(s, a => a.type === 'DEFEND_POWER')).toBe(true)
    const life = s.players[1].lifeDeck.length
    s = act(s, { type: 'DEFEND_POWER', player: 1 })
    expect(s.players[1].lifeDeck.length).toBe(life - 2)
    expect(s.combat!.usedPowers).toContain('1:SS-173')
  })

  it('is not offered against physical attacks, nor as an attack', () => {
    let s = inCombat()
    setMP(s, 1, 'SS-173')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(s.pendingChoice).toBeNull() // no defense available: the hit resolved at once
    expect(s.combat!.active).toBe(1)
    expect(has(s, a => a.type === 'USE_POWER')).toBe(false)
  })

  it('Vegeta HT ignores an energy attack completely, once per combat', () => {
    let s = inCombat()
    setMP(s, 1, 'SS-184')
    const life = s.players[1].lifeDeck.length
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BIG-BLAST') })
    s = act(s, { type: 'DEFEND_POWER', player: 1 })
    expect(s.players[1].lifeDeck.length).toBe(life)
    s = act(s, { type: 'PASS', player: 1 })
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BIG-BLAST') })
    expect(s.players[1].lifeDeck.length).toBe(life - 6) // power used up: no defend window
  })
})

describe('preventAttack and skipPhase', () => {
  it('SS-12 stops the foe from making physical attacks in their next phase', () => {
    let s = inCombat()
    s.players[1].mp.stage = 10 // enough left to pay for an energy attack after the hit
    const punch = give(s, 1, 'TEST-PUNCH')
    const blast = give(s, 1, 'TEST-BLAST')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'SS-12') })
    expect(s.combat!.active).toBe(1)
    expect(canPlay(s, punch)).toBe(false)
    expect(canPlay(s, blast)).toBe(true)
    s = act(s, { type: 'PASS', player: 1 })
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-SLAP') })
    expect(canPlay(s, punch)).toBe(true) // only the next phase
  })

  it('SS-95 blocks and stops energy attacks in the attacker\'s next phase, not the current one', () => {
    let s = inCombat()
    setMP(s, 1, 'SS-176') // Nappa: SS-95 is for Villains, Goku and Gohan
    const block = give(s, 1, 'SS-95')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BLAST') })
    s = act(s, { type: 'DEFEND', player: 1, iid: block })
    expect(s.combat!.active).toBe(1)
    s = act(s, { type: 'PASS', player: 1 })
    expect(canPlay(s, give(s, 0, 'TEST-BLAST'))).toBe(false)
    expect(canPlay(s, give(s, 0, 'TEST-PUNCH'))).toBe(true)
  })

  it('SS-192 makes the opponent skip the combat step of their next turn', () => {
    let s = newGame()
    const a = s.attacker
    const iid = place(s, a, 'SS-192')
    s = act(s, { type: 'PLAY_CARD', player: a, iid })
    s = act(s, { type: 'END_NON_COMBAT', player: a })
    expect(has(s, x => x.type === 'DECLARE_COMBAT')).toBe(true) // own turn unaffected
    s = act(s, { type: 'SKIP_COMBAT', player: a })
    while (s.pendingChoice?.kind === 'DISCARD_TO_LIMIT') s = act(s, legal(s)[0])
    const b = s.attacker
    expect(b).not.toBe(a)
    s = act(s, { type: 'END_NON_COMBAT', player: b })
    expect(legal(s)).toEqual([{ type: 'SKIP_COMBAT', player: b }])
  })
})

describe('discard pile effects', () => {
  it('SS-25 draws the bottom discard and, used by Goku, stays for one more use this combat', () => {
    let s = inCombat()
    setMP(s, 0, 'SS-158')
    putInDiscard(s, 0, ['TEST-BLOCK', 'TEST-RAGE'])
    const kick = give(s, 0, 'SS-25')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: kick })
    expect(s.players[0].hand.map(c => c.defId)).toContain('TEST-BLOCK')
    expect(s.players[0].nonCombat.map(c => c.iid)).toEqual([kick])
    s = act(s, { type: 'PASS', player: 1 })
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: kick })
    expect(s.players[0].discard.map(c => c.iid)).toContain(kick) // second use: gone
  })

  it('SS-79 lets the player choose 2 discards for the bottom of the life deck', () => {
    let s = newGame()
    const a = s.attacker
    putInDiscard(s, a, ['TEST-PUNCH', 'TEST-BLOCK', 'TEST-RAGE'])
    const iid = place(s, a, 'SS-79')
    s = act(s, { type: 'PLAY_CARD', player: a, iid })
    expect(s.pendingChoice).toMatchObject({ kind: 'PICK', count: 2 })
    expect((s.pendingChoice as { eligible: string[] }).eligible).not.toContain(iid) // the card itself is not eligible
    s = act(s, { type: 'PICK', player: a, iid: `d-${a}-0` })
    s = act(s, { type: 'PICK', player: a, iid: `d-${a}-2` })
    expect(s.pendingChoice).toBeNull()
    expect(s.players[a].lifeDeck.slice(-2).map(c => c.defId)).toEqual(['TEST-PUNCH', 'TEST-RAGE'])
  })
})

describe('choices and conditions', () => {
  it('SS-75 asks whether to draw 3 cards', () => {
    let s = newGame()
    const a = s.attacker
    const hand = s.players[a].hand.length
    s = act(s, { type: 'PLAY_CARD', player: a, iid: give(s, a, 'SS-75') })
    expect(s.pendingChoice?.kind).toBe('CONFIRM')
    s = act(s, { type: 'CONFIRM', player: a, accept: true })
    expect(s.players[a].hand.length).toBe(hand + 3)
  })

  it('SS-13 can block an energy attack instead of attacking (dual use)', () => {
    let s = inCombat()
    const kick = give(s, 1, 'SS-13')
    const life = s.players[1].lifeDeck.length
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BLAST') })
    s = act(s, { type: 'DEFEND', player: 1, iid: kick })
    expect(s.players[1].lifeDeck.length).toBe(life)
    expect(s.players[0].mp.anger).toBe(0) // SS-13's "lower foe's anger" still resolves (floored at 0)
  })

  it('SS-200 sets the defender\'s anger to 0', () => {
    let s = inCombat()
    s.players[1].mp.anger = 3
    const card = give(s, 1, 'SS-200')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BLAST') })
    s = act(s, { type: 'DEFEND', player: 1, iid: card })
    expect(s.players[1].mp.anger).toBe(0)
  })

  it('SS-46 doubles the damage of a successful physical attack', () => {
    let s = inCombat()
    s.players[1].mp.stage = 10
    const before = s.players[1].mp.stage
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'SS-46') })
    let t = inCombat()
    t.players[1].mp.stage = 10
    t = act(t, { type: 'PLAY_CARD', player: 0, iid: give(t, 0, 'SS-25') }) // plain PAT physical attack
    const plain = before - t.players[1].mp.stage
    expect(before - s.players[1].mp.stage).toBe(Math.min(before, plain * 2))
  })
})

describe('drill triggers', () => {
  it('SS-128 lets the attacker draw an extra card at the beginning of combat', () => {
    let s = newGame()
    const a = s.attacker
    place(s, a, 'SS-128', 'drills')
    s = act(s, { type: 'END_NON_COMBAT', player: a })
    const hand = s.players[a].hand.length
    s = act(s, { type: 'DECLARE_COMBAT', player: a })
    expect(s.players[a].hand.length).toBe(hand + 1)
  })
})
