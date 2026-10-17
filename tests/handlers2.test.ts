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
    s.discardAsLife.push({ player: foe, mode: 'DAMAGE', remaining: 3, armed: false, source: 'SS-101' })
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
    // the player chooses any amount up to the main personality's highest stage
    expect(s.pendingChoice).toMatchObject({ kind: 'OPTION', purpose: 'transferStages' })
    expect((s.pendingChoice as { options: string[] }).options.length).toBe(6) // 0..5
    s = act(s, { type: 'CHOOSE', player: a, index: 4 })
    expect(s.players[a].mp.stage).toBe(6)
    expect(s.players[a].allies[0].stage).toBe(1)
  })

  it('SS-156: the owner chooses the ally that takes all damage this combat', () => {
    let s = inCombat()
    const keep = ally(s, 1)
    const fall = ally(s, 1, 'SS-86')
    const sac = give(s, 1, 'SS-156')
    const life = s.players[1].lifeDeck.length
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BIG-BLAST') })
    s = act(s, { type: 'DEFEND', player: 1, iid: sac })
    // the decision pauses the strike: no damage yet
    expect(s.pendingChoice).toMatchObject({ kind: 'PICK', dest: 'MARK_ALLY_SHIELD' })
    expect(s.combat!.strike).not.toBeNull()
    s = act(s, { type: 'PICK', player: 1, iid: fall })
    expect(s.players[1].allies.map(a => a.card.iid)).toEqual([keep])
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

function setMP(s: GameState, p: PlayerId, defId: string) {
  s.players[p].mp.stack = [{ iid: `mp-${p}-${defId}`, defId, owner: p }]
  s.players[p].mp.levelIndex = 0
}

describe('resolution stack: decisions in the middle of a strike', () => {
  it('SS-204 pauses the strike while the attacker picks 2 discards, then the strike resolves', () => {
    let s = inCombat()
    s.players[0].discard = ['TEST-PUNCH', 'TEST-BLOCK', 'TEST-RAGE'].map((defId, i) => ({ iid: `pd${i}`, defId, owner: 0 as PlayerId }))
    const pause = give(s, 1, 'SS-204')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BLAST') })
    const life = s.players[1].lifeDeck.length
    s = act(s, { type: 'DEFEND', player: 1, iid: pause })
    expect(s.pendingChoice).toMatchObject({ kind: 'PICK', player: 0, count: 2 })
    expect(s.combat!.strike).not.toBeNull()
    expect(s.players[1].lifeDeck.length).toBe(life) // the hit has not happened yet
    s = act(s, { type: 'PICK', player: 0, iid: 'pd0' })
    s = act(s, { type: 'PICK', player: 0, iid: 'pd2' })
    expect(s.combat!.strike).toBeNull()
    expect(s.players[1].lifeDeck.length).toBe(life - 4)
    expect(s.combat!.active).toBe(1)
  })
})

describe('timing windows', () => {
  it('SS-39 reacts right after the attacker pays an energy cost, and the defend window still follows', () => {
    let s = inCombat()
    s.players[0].mp.stage = 8
    const smash = give(s, 1, 'SS-39')
    give(s, 1, 'TEST-SHIELD')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BLAST') })
    expect(s.pendingChoice).toMatchObject({ kind: 'WINDOW', window: 'REACT', iids: [smash] })
    expect(legal(s).some(a => a.type === 'DEFEND')).toBe(false)
    s = act(s, { type: 'RESPOND', player: 1, iid: smash })
    expect(s.players[0].mp.stage).toBe(8 - 2 - 4)
    expect(s.pendingChoice?.kind).toBe('DEFEND')
  })

  it('SS-39 is not offered against an attack without an energy cost', () => {
    let s = inCombat()
    give(s, 1, 'SS-39')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(s.pendingChoice?.kind).not.toBe('WINDOW')
  })

  it('SS-239 can be used at the end of a turn when the foe is at level 2', () => {
    let s = newGame()
    const a = s.attacker
    const foe = (1 - a) as PlayerId
    s.players[foe].mp.levelIndex = 1
    const calm = place(s, a, 'SS-239')
    expect(canPlay(s, calm)).toBe(false) // not a normal Non-Combat use
    s = act(s, { type: 'END_NON_COMBAT', player: a })
    s = act(s, { type: 'SKIP_COMBAT', player: a })
    while (s.pendingChoice?.kind === 'DISCARD_TO_LIMIT') s = act(s, legal(s).find(x => x.type === 'DISCARD')!)
    expect(s.pendingChoice).toMatchObject({ kind: 'WINDOW', window: 'END_OF_TURN', player: a })
    s = act(s, { type: 'RESPOND', player: a, iid: calm })
    expect(s.players[foe].mp.levelIndex).toBe(0)
    expect(s.attacker).toBe(foe) // the turn passed
  })

  it('SS-225 can be used at any time, even in the defend window, without losing the decision', () => {
    let s = inCombat()
    const blast = place(s, 1, 'SS-225')
    give(s, 1, 'TEST-SHIELD')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BLAST') })
    expect(s.pendingChoice?.kind).toBe('DEFEND')
    const life = s.players[0].lifeDeck.length
    s = act(s, { type: 'USE_FREE', player: 1, iid: blast })
    expect(s.players[0].lifeDeck.length).toBe(life - 3)
    expect(s.pendingChoice?.kind).toBe('DEFEND')
  })
})

describe('Multi-Form and noStacking', () => {
  it('Tien Lv1 attacks twice in a row with physical attacks', () => {
    let s = inCombat()
    setMP(s, 0, 'SS-82')
    const punch = give(s, 0, 'TEST-PUNCH')
    const blast = give(s, 0, 'TEST-BLAST')
    s = act(s, { type: 'USE_POWER', player: 0 })
    expect(s.combat!.active).toBe(0)
    expect(canPlay(s, punch)).toBe(true)
    expect(canPlay(s, blast)).toBe(false)
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: punch })
    expect(s.combat!.active).toBe(1)
  })

  it('SS-250: a second copy cannot be used in the same combat', () => {
    let s = inCombat()
    const first = give(s, 1, 'SS-250')
    const second = give(s, 1, 'SS-250')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    s = act(s, { type: 'DEFEND', player: 1, iid: first })
    s = act(s, { type: 'PASS', player: 1 })
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(legal(s).some(a => a.type === 'DEFEND' && a.iid === second)).toBe(false)
  })
})

describe('rulings', () => {
  it('Honor Duel: the player chooses the draw mode, and the defender draws from the bottom of the discard pile', () => {
    let s = newGame()
    const a = s.attacker
    const foe = (1 - a) as PlayerId
    s.players[foe].discard = ['TEST-PUNCH', 'TEST-BLOCK', 'TEST-RAGE', 'TEST-SLAP'].map((defId, i) => ({ iid: `hd${i}`, defId, owner: foe }))
    // as if the foe had used SS-101 and picked the draw mode
    s.discardAsLife.push({ player: foe, mode: 'DRAW', remaining: 3, armed: false, source: 'SS-101' })
    const deck = s.players[foe].lifeDeck.length
    s = act(s, { type: 'END_NON_COMBAT', player: a })
    s = act(s, { type: 'DECLARE_COMBAT', player: a })
    expect(s.players[foe].hand.map(c => c.iid)).toEqual(['hd0', 'hd1', 'hd2'])
    expect(s.players[foe].lifeDeck.length).toBe(deck)
  })

  it('Honor Duel asks which mode to use', () => {
    let s = newGame()
    const a = s.attacker
    setMP(s, a, 'SS-158')
    s.players[a].discard = ['TEST-PUNCH', 'TEST-BLOCK', 'TEST-RAGE'].map((defId, i) => ({ iid: `h${i}`, defId, owner: a }))
    s = act(s, { type: 'PLAY_CARD', player: a, iid: place(s, a, 'SS-101') })
    expect(s.pendingChoice).toMatchObject({ kind: 'OPTION', purpose: 'honorDuel' })
    s = act(s, { type: 'CHOOSE', player: a, index: 0 })
    expect(s.discardAsLife).toMatchObject([{ player: a, mode: 'DAMAGE', remaining: 3 }])
  })

  it('Chiaotzu as main personality is not removed by his own blast', () => {
    let s = inCombat()
    setMP(s, 0, 'SS-105')
    s = act(s, { type: 'USE_POWER', player: 0 })
    expect(s.players[0].mp.stack.length).toBe(1)
    expect(s.log.some(e => e.msg.includes('cannot be removed'))).toBe(true)
  })

  it('Plant Two Saibaimen takes the highest level Saibaimen from the life deck next turn', () => {
    let s = newGame()
    const a = s.attacker
    setMP(s, a, 'SS-176')
    place(s, a, 'SS-243', 'lifeDeck')
    const best = place(s, a, 'SS-245', 'lifeDeck')
    s = act(s, { type: 'PLAY_CARD', player: a, iid: place(s, a, 'SS-213') })
    s = act(s, { type: 'END_NON_COMBAT', player: a })
    expect(legal(s)).toEqual([{ type: 'SKIP_COMBAT', player: a }])
    s = act(s, { type: 'SKIP_COMBAT', player: a })
    for (let i = 0; i < 20 && !(s.attacker === a && s.turn > 2); i++) {
      const next = legal(s).find(x => x.type === 'DISCARD' || x.type === 'END_NON_COMBAT' || x.type === 'SKIP_COMBAT' || (x.type === 'RESPOND' && !x.iid))
      if (!next) break
      s = act(s, next)
    }
    expect(s.players[a].allies.map(x => x.card.iid)).toEqual([best])
  })
})
