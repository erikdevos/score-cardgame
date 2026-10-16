import { describe, expect, it } from 'vitest'
import { createGame, legalActions, validateDeck, defaultRulesConfig } from '../src/engine'
import { db, heroMP, testDeck, villainMP } from './fixtures/testCards'
import { act, give, inCombat, newGame } from './helpers'

describe('setup', () => {
  it('starts both MPs at stage 5, anger 0, attacker draws 3', () => {
    const s = newGame()
    for (const p of s.players) { expect(p.mp.stage).toBe(5); expect(p.mp.anger).toBe(0) }
    expect(s.players[s.attacker].hand.length).toBe(3)
    expect(s.step).toBe('NON_COMBAT')
  })

  it('applies the dominance rule when one MP is 2x stronger', () => {
    const s = createGame(db, [testDeck(['TEST-HERO-2', 'TEST-HERO-3']), testDeck(villainMP)], { seed: 3 })
    expect(s.attacker).toBe(1) // villain is weaker
    expect(s.players[0].mp.stage).toBe(2)
    expect(s.players[1].mp.stage).toBe(10)
  })

  it('is deterministic for a given seed', () => {
    expect(newGame(42)).toEqual(newGame(42))
  })
})

describe('leveling and wins', () => {
  it('levels up at anger 5: anger 0, stage 5, drills discarded', () => {
    const s = inCombat()
    s.players[0].mp.anger = 4
    s.players[0].mp.stage = 9
    s.players[0].drills.push({ iid: 'd1', defId: 'TEST-DRILL', owner: 0 })
    const r = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(r.players[0].mp.levelIndex).toBe(1)
    expect(r.players[0].mp.anger).toBe(0)
    expect(r.players[0].mp.stage).toBe(5)
    expect(r.players[0].drills).toEqual([])
    expect(r.players[0].discard.map(c => c.iid)).toContain('d1')
  })

  it('wins by MPP at the top level', () => {
    const s = inCombat()
    s.players[0].mp.levelIndex = 2
    s.players[0].mp.anger = 4
    const r = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    expect(r.winner).toBe(0)
    expect(r.winReason).toBe('MPP')
    expect(legalActions(r, db)).toEqual([])
  })

  it('caps anger instead when the MP cannot win by MPP', () => {
    const s = inCombat()
    s.combat!.active = 1
    s.players[1].mp.levelIndex = 2
    s.players[1].mp.anger = 4
    const r = act(s, { type: 'PLAY_CARD', player: 1, iid: give(s, 1, 'TEST-PUNCH') })
    expect(r.winner).toBeNull()
    expect(r.players[1].mp.anger).toBe(5)
  })

  it('loses by survival when drawing from an empty life deck', () => {
    let s = newGame()
    const a = s.attacker
    const d = 1 - a
    s.players[d].lifeDeck = []
    s = act(s, { type: 'END_NON_COMBAT', player: a })
    s = act(s, { type: 'DECLARE_COMBAT', player: a })
    expect(s.winner).toBe(a)
    expect(s.winReason).toBe('SURVIVAL')
  })

  it('loses by survival when damage exceeds the life deck', () => {
    const s = inCombat()
    s.players[1].lifeDeck = s.players[1].lifeDeck.slice(0, 2)
    const r = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BLAST') })
    expect(r.winner).toBe(0)
  })

  it('wins by controlling all 7 Dragon Balls', () => {
    const s = newGame()
    const a = s.attacker
    for (let n = 1; n <= 6; n++) s.players[a].dragonBalls.push({ iid: `db${n}`, defId: `TEST-DB-${n}`, owner: a })
    const r = act(s, { type: 'PLAY_CARD', player: a, iid: give(s, a, 'TEST-DB-7') })
    expect(r.winner).toBe(a)
    expect(r.winReason).toBe('DRAGON_BALLS')
  })

  it('does not allow a duplicate Dragon Ball number in play', () => {
    const s = newGame()
    const a = s.attacker
    s.players[1 - a].dragonBalls.push({ iid: 'x', defId: 'TEST-DB-2', owner: 1 - a as 0 | 1 })
    const iid = give(s, a, 'TEST-DB-2')
    expect(legalActions(s, db).some(x => x.type === 'PLAY_CARD' && x.iid === iid)).toBe(false)
  })
})

describe('turn structure', () => {
  it('power-up adds PUR (clamped) and +1 to allies', () => {
    let s = newGame()
    const a = s.attacker
    s.players[a].mp.stage = 9
    s = act(s, { type: 'PLAY_CARD', player: a, iid: give(s, a, 'TEST-ALLY') })
    expect(s.players[a].allies[0].stage).toBe(3)
    s = act(s, { type: 'END_NON_COMBAT', player: a })
    expect(s.players[a].mp.stage).toBe(10)
    expect(s.players[a].allies[0].stage).toBe(4)
    expect(s.step).toBe('DECLARE')
  })

  it('gives the attacker the first attack phase after declaring combat', () => {
    let s = newGame()
    const a = s.attacker
    s = act(s, { type: 'END_NON_COMBAT', player: a })
    s = act(s, { type: 'DECLARE_COMBAT', player: a })
    expect(s.combat!.active).toBe(a)
    expect(s.players[1 - a].hand.length).toBe(3)
  })

  it('skips combat when a location was played', () => {
    let s = newGame()
    const a = s.attacker
    s = act(s, { type: 'PLAY_CARD', player: a, iid: give(s, a, 'TEST-LOCATION') })
    s = act(s, { type: 'END_NON_COMBAT', player: a })
    expect(['DISCARD', 'NON_COMBAT']).toContain(s.step)
    expect(s.location?.defId).toBe('TEST-LOCATION')
  })

  it('discards down to the hand limit, attacker first; drills raise it', () => {
    let s = inCombat()
    s.players[0].hand = []
    for (let i = 0; i < 3; i++) give(s, 0, 'TEST-SLAP')
    for (let i = 0; i < 3; i++) give(s, 1, 'TEST-SLAP')
    s.players[1].drills.push({ iid: 'd', defId: 'TEST-DRILL', owner: 1 })
    s = act(s, { type: 'PASS', player: 0 })
    s = act(s, { type: 'PASS', player: 1 })
    expect(s.pendingChoice).toEqual({ kind: 'DISCARD_TO_LIMIT', player: 0, limit: 1 })
    s = act(s, { type: 'DISCARD', player: 0, iid: s.players[0].hand[0].iid })
    s = act(s, { type: 'DISCARD', player: 0, iid: s.players[0].hand[0].iid })
    expect(s.pendingChoice).toEqual({ kind: 'DISCARD_TO_LIMIT', player: 1, limit: 2 })
    s = act(s, { type: 'DISCARD', player: 1, iid: s.players[1].hand[0].iid })
    expect(s.players[1].hand.length).toBe(2 + 3) // kept 2, then drew 3 as the new attacker
    expect(s.attacker).toBe(1)
  })

  it('offers rejuvenation only in CRD mode', () => {
    const run = (mode: 'PURE_2000' | 'CRD_3') => {
      let s = inCombat(1, { mode })
      s.players[0].discard.push({ iid: 'r', defId: 'TEST-SLAP', owner: 0 })
      s = act(s, { type: 'PASS', player: 0 })
      return act(s, { type: 'PASS', player: 1 })
    }
    expect(run('PURE_2000').attacker).toBe(1)
    const crd = run('CRD_3')
    expect(crd.pendingChoice).toEqual({ kind: 'REJUVENATE', player: 0 })
    const bottom = act(crd, { type: 'REJUVENATE', player: 0, accept: true }).players[0].lifeDeck.at(-1)
    expect(bottom?.iid).toBe('r')
  })
})

describe('deck validation', () => {
  const rules = defaultRulesConfig()
  it('accepts a deck within the limits', () => {
    // the fictional pool is too small for 50 cards at 3 copies, so relax the copy limit
    const loose = { ...rules, deck: { ...rules.deck, maxCopies: 20 } }
    expect(validateDeck(db, testDeck(heroMP), loose)).toEqual([])
  })
  it('rejects too few cards and too many copies', () => {
    const errs = validateDeck(db, { mp: heroMP, life: Array(10).fill('TEST-PUNCH') }, rules)
    expect(errs.some(e => e.includes('50-85'))).toBe(true)
    expect(errs.some(e => e.includes('copies'))).toBe(true)
  })
})
