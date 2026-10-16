import { describe, expect, it } from 'vitest'
import { applyAction, buildCardDB, legalActions, type Action, type GameState, type PlayerId } from '../src/engine'
import realCards from '../src/data/saiyan-saga/cards.json'
import { db as testDb } from './fixtures/testCards'
import { give, inCombat, newGame } from './helpers'

const db = { ...testDb, ...buildCardDB(realCards as unknown[]) }
const act = (s: GameState, a: Action) => applyAction(s, db, a).state
const legal = (s: GameState) => legalActions(s, db)
const canPlay = (s: GameState, iid: string) => legal(s).some(a => 'iid' in a && a.iid === iid && a.type === 'PLAY_CARD')

let n = 0
function place(s: GameState, p: PlayerId, defId: string, zone: 'nonCombat' | 'drills' | 'dragonBalls' | 'discard' | 'lifeDeck' = 'nonCombat') {
  const iid = `x${n++}-${defId}`
  s.players[p][zone].push({ iid, defId, owner: p })
  return iid
}
function ally(s: GameState, p: PlayerId, defId = 'SS-104', stage = 3) {
  const iid = `ally${n++}`
  s.players[p].allies.push({ card: { iid, defId, owner: p }, stage })
  return iid
}

describe('shields and automatic stops', () => {
  it('SS-30 on the table stops the first successful physical attack, then leaves the game', () => {
    let s = inCombat()
    const shield = place(s, 1, 'SS-30')
    expect(canPlay({ ...s, combat: { ...s.combat!, active: 1 } } as GameState, shield)).toBe(false) // nothing to "use"
    const stage = s.players[1].mp.stage
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(s.players[1].mp.stage).toBe(stage)
    expect(s.players[1].removed.map(c => c.iid)).toContain(shield)
    s = act(s, { type: 'PASS', player: 1 })
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(s.players[1].mp.stage).toBeLessThan(stage)
  })

  it('SS-33 stops only the life card damage', () => {
    let s = inCombat()
    place(s, 1, 'SS-33')
    const life = s.players[1].lifeDeck.length
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BIG-BLAST') })
    expect(s.players[1].lifeDeck.length).toBe(life)
    expect(s.players[1].nonCombat).toEqual([])
  })

  it('SS-134 stops the first physical attack each combat without a defend window', () => {
    let s = inCombat()
    place(s, 1, 'SS-134', 'drills')
    give(s, 1, 'TEST-BLOCK')
    const stage = s.players[1].mp.stage
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(s.pendingChoice).toBeNull()
    expect(s.players[1].mp.stage).toBe(stage)
    expect(s.players[1].hand.length).toBe(1) // the block was not needed
    s = act(s, { type: 'PASS', player: 1 })
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(s.pendingChoice?.kind).toBe('DEFEND') // second attack: normal again
  })
})

describe('search, remove and discard requirements', () => {
  it('SS-228 puts a Dragon Ball from the life deck into play', () => {
    let s = newGame()
    const a = s.attacker
    s.players[a].lifeDeck = s.players[a].lifeDeck.filter(c => !c.defId.startsWith('TEST-DB'))
    const ball = place(s, a, 'TEST-DB-3', 'lifeDeck')
    s = act(s, { type: 'PLAY_CARD', player: a, iid: place(s, a, 'SS-228') })
    expect(s.players[a].dragonBalls.map(c => c.iid)).toEqual([ball])
  })

  it('SS-240 moves the foe\'s first Dragon Ball to the bottom of their deck', () => {
    let s = newGame()
    const a = s.attacker
    const foe = (1 - a) as PlayerId
    s.players[foe].lifeDeck = s.players[foe].lifeDeck.filter(c => !c.defId.startsWith('TEST-DB'))
    const ball = { iid: 'ball', defId: 'TEST-DB-1', owner: foe }
    s.players[foe].lifeDeck.splice(2, 0, ball)
    s = act(s, { type: 'PLAY_CARD', player: a, iid: place(s, a, 'SS-240') })
    expect(s.players[foe].lifeDeck.at(-1)?.iid).toBe('ball')
  })

  it('SS-32 removes a chosen drill or ally of the opponent from the game', () => {
    let s = newGame()
    const a = s.attacker
    const foe = (1 - a) as PlayerId
    const drill = place(s, foe, 'TEST-DRILL', 'drills')
    const al = ally(s, foe)
    s = act(s, { type: 'PLAY_CARD', player: a, iid: place(s, a, 'SS-32') })
    expect(s.pendingChoice).toMatchObject({ kind: 'PICK', count: 1 })
    s = act(s, { type: 'PICK', player: a, iid: al })
    expect(s.players[foe].allies).toEqual([])
    expect(s.players[foe].removed.map(c => c.iid)).toContain(al)
    expect(s.players[foe].drills.map(c => c.iid)).toEqual([drill])
  })

  it('SS-41 needs another card in hand and makes you discard it', () => {
    let s = inCombat()
    const block = give(s, 1, 'SS-41')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(legal(s).some(a => a.type === 'DEFEND' && a.iid === block)).toBe(false)

    let t = inCombat()
    const block2 = give(t, 1, 'SS-41')
    const other = give(t, 1, 'TEST-RAGE')
    t = act(t, { type: 'PLAY_CARD', player: 0, iid: give(t, 0, 'TEST-PUNCH') })
    t = act(t, { type: 'DEFEND', player: 1, iid: block2 })
    expect(t.players[1].hand).toEqual([])
    expect(t.players[1].discard.map(c => c.iid)).toContain(other)
  })
})

describe('discard pile as life deck', () => {
  it('SS-101 takes the next combat\'s life card damage from the bottom of the discard pile', () => {
    let s = newGame()
    const a = s.attacker
    const foe = (1 - a) as PlayerId
    s.players[foe].discard = ['TEST-PUNCH', 'TEST-BLOCK', 'TEST-RAGE'].map((defId, i) => ({ iid: `dd${i}`, defId, owner: foe }))
    // as if the defender had used SS-101 earlier
    s.discardAsLife.push({ player: foe, remaining: 3, armed: false, source: 'SS-101' })
    s = act(s, { type: 'END_NON_COMBAT', player: a })
    s = act(s, { type: 'DECLARE_COMBAT', player: a })
    const life = s.players[foe].lifeDeck.length
    s.players[a].hand.push({ iid: 'bb', defId: 'TEST-BIG-BLAST', owner: a })
    s.players[a].mp.stage = 10
    s = act(s, { type: 'PLAY_CARD', player: a, iid: 'bb' })
    if (s.pendingChoice?.kind === 'DEFEND') s = act(s, { type: 'DEFEND', player: foe, iid: null })
    expect(s.players[foe].lifeDeck.length).toBe(life - 3) // 6 damage: 3 from the discard pile, 3 from the deck
  })

  it('SS-101 cannot be used with fewer than 3 discards', () => {
    const s = newGame()
    const a = s.attacker
    s.players[a].discard = []
    expect(canPlay(s, place(s, a, 'SS-101'))).toBe(false)
  })
})

describe('ally effects', () => {
  it('SS-194 needs an ally and ends combat', () => {
    let s = inCombat()
    const card = place(s, 0, 'SS-194')
    expect(canPlay(s, card)).toBe(false)
    ally(s, 0)
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: card })
    expect(s.step).not.toBe('COMBAT')
  })

  it('SS-229 deals 1 life card per ally', () => {
    let s = inCombat()
    ally(s, 0); ally(s, 0, 'SS-86')
    const life = s.players[1].lifeDeck.length
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'SS-229') })
    expect(s.players[1].lifeDeck.length).toBe(life - 2)
  })

  it('SS-217 needs an ally and removes it from the game', () => {
    let s = inCombat()
    const ribs = give(s, 0, 'SS-217')
    expect(canPlay(s, ribs)).toBe(false)
    const al = ally(s, 0)
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: ribs })
    expect(s.players[0].removed.map(c => c.iid)).toContain(al)
  })

  it('SS-207 moves stages from an ally to the main personality', () => {
    let s = newGame()
    const a = s.attacker
    s.players[a].mp.stage = 2
    ally(s, a, 'SS-104', 5)
    s = act(s, { type: 'PLAY_CARD', player: a, iid: place(s, a, 'SS-207') })
    expect(s.players[a].mp.stage).toBe(7)
    expect(s.players[a].allies[0].stage).toBe(0)
  })

  it('SS-156 lets an ally take all damage this combat', () => {
    let s = inCombat()
    ally(s, 1)
    const sac = give(s, 1, 'SS-156')
    const life = s.players[1].lifeDeck.length
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BIG-BLAST') })
    s = act(s, { type: 'DEFEND', player: 1, iid: sac })
    expect(s.players[1].allies).toEqual([])
    expect(s.players[1].lifeDeck.length).toBe(life)
  })

  it('SS-218 pulls an ally from the discards into play at full power', () => {
    let s = inCombat()
    place(s, 1, 'SS-104', 'discard')
    const card = give(s, 1, 'SS-218')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    s = act(s, { type: 'DEFEND', player: 1, iid: card })
    expect(s.players[1].allies.map(a => [a.card.defId, a.stage])).toEqual([['SS-104', 10]])
  })
})
