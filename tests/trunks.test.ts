import { describe, expect, it } from 'vitest'
import { applyAction, buildCardDB, createGame, defaultRulesConfig, legalActions, validateDeck, type Action, type GameState, type PlayerId, type Rules } from '../src/engine'
import patTrunks from '../src/engine/config/pat-trunks.json'
import saiyan from '../src/data/saiyan-saga/cards.json'
import { db as testDb, heroMP, testDeck, villainMP } from './fixtures/testCards'
import { changeAnger } from '../src/engine/state'
import { give } from './helpers'

// Trunks Saga core rules (2001 rulebook), as the Saiyan + Frieza card pool uses them
const TRUNKS: Partial<Rules> = {
  pat: { brackets: patTrunks.brackets, matrix: patTrunks.matrix },
  trunks: { levelStages: true, mostPowerfulByHighestLevel: true, finalPhysicalAttack: true, skipCombatRecovers: true, heroFirst: true, allyRules: true, dragonBalls: true, tokuiWaza: true },
}
const db = { ...testDb, ...buildCardDB(saiyan as unknown[]) }
const act = (s: GameState, a: Action) => applyAction(s, db, a).state
const legal = (s: GameState) => legalActions(s, db)

function game(seed = 1): GameState {
  // the test personalities are all heroes: player 2 plays the real Vegeta (villain)
  return createGame(db, [testDeck(heroMP), { mp: VEGETA, life: testDeck(villainMP).life }], { seed, rules: TRUNKS })
}
function combat(seed = 1): GameState {
  let s = game(seed)
  s = act(s, { type: 'END_NON_COMBAT', player: s.attacker })
  s = act(s, { type: 'DECLARE_COMBAT', player: s.attacker })
  for (const p of s.players) { p.discard.push(...p.hand); p.hand = [] }
  return s
}
const VEGETA = ['SS-173', 'SS-174', 'SS-175']
/** Raise anger to 5 (a level up, or the top-level effect). */
const rage = (s: GameState, p: PlayerId) => changeAnger(s, db, p, s.rules.maxAnger - s.players[p].mp.anger)

describe('Trunks Saga core rules', () => {
  it('the hero goes first and both start at stage 5', () => {
    for (const seed of [1, 2, 3]) {
      const s = game(seed)
      expect(s.attacker).toBe(0)
      expect(s.players.map(p => p.mp.stage)).toEqual([5, 5])
    }
  })

  it('a level up starts at the highest power stage', () => {
    const s = combat()
    rage(s, 0)
    expect(s.players[0].mp.levelIndex).toBe(1)
    expect(s.players[0].mp.stage).toBe(s.rules.maxStage)
  })

  it('Most Powerful Personality: you win on reaching the highest level in the game, not by anger at the top', () => {
    const s = combat()
    s.players[0].mp.levelIndex = 1
    rage(s, 0)
    expect(s.winner).toBe(0)
    expect(s.winReason).toBe('MPP')
  })

  it('a deeper stack elsewhere raises the bar; at the top, 5 anger means full power instead', () => {
    const s = combat()
    s.players[1].mp.stack.push({ iid: 'extra', defId: 'SS-175', owner: 1 }) // the villain now has 4 levels
    s.players[0].mp.levelIndex = 1
    rage(s, 0)
    expect(s.winner).toBeNull()
    expect(s.players[0].mp.levelIndex).toBe(2)
    s.players[0].mp.stage = 3
    rage(s, 0)
    expect(s.winner).toBeNull()
    expect(s.players[0].mp.stage).toBe(s.rules.maxStage)
    expect(s.players[0].mp.anger).toBe(0)
  })

  it('Final Physical Attack: discard any card, PAT damage, then pass and no defending for the rest of combat', () => {
    let s = combat()
    const junk = give(s, 0, 'TEST-RAGE')
    const fpa = legal(s).find(a => a.type === 'FINAL_PHYSICAL_ATTACK' && a.iid === junk)
    expect(fpa).toBeDefined()
    s = act(s, fpa!)
    expect(s.players[0].discard.some(c => c.iid === junk)).toBe(true)
    if (s.pendingChoice?.kind === 'DEFEND') s = act(s, { type: 'DEFEND', player: 1, iid: null })
    // the opponent attacks back: player 0 may not defend
    s = act(s, { type: 'PLAY_CARD', player: 1, iid: give(s, 1, 'TEST-PUNCH') })
    give(s, 0, 'TEST-BLOCK')
    if (s.pendingChoice?.kind === 'DEFEND') expect(legal(s)).toEqual([{ type: 'DEFEND', player: 0, iid: null }])
    while (s.pendingChoice) s = act(s, legal(s)[0])
    if (s.combat?.active === 0) expect(legal(s).filter(a => a.type !== 'USE_FREE')).toEqual([{ type: 'PASS', player: 0 }])
  })

  it('Step 6: skipping combat puts the top discard at the bottom of the life deck', () => {
    let s = game()
    const top = { iid: 'top', defId: 'TEST-PUNCH', owner: 0 as PlayerId }
    s.players[0].discard.push(...s.players[0].hand) // nothing to discard in step 5, so "top" stays on top
    s.players[0].hand = []
    s.players[0].discard.push(top)
    s = act(s, { type: 'END_NON_COMBAT', player: 0 })
    s = act(s, { type: 'SKIP_COMBAT', player: 0 })
    while (s.pendingChoice && s.turn === 1) s = act(s, legal(s)[0])
    expect(s.players[0].lifeDeck.at(-1)?.iid).toBe('top')
  })

  it('allies: same alignment only, and at least 2 levels below the top main personality level', () => {
    const s = game()
    const hero = give(s, 0, 'SS-104') // Chiaotzu Lv1, hero
    const villain = give(s, 0, 'SS-170') // Raditz Lv1, villain
    const tooHigh = give(s, 0, 'SS-105') // Chiaotzu Lv2: the test MP has 3 levels, so allies go up to level 1
    const plays = legal(s).filter(a => a.type === 'PLAY_CARD').map(a => (a as { iid: string }).iid)
    expect(plays).toContain(hero)
    expect(plays).not.toContain(villain)
    expect(plays).not.toContain(tooHigh)
  })

  it('deck building: one copy per personality level and no allies from the other side', () => {
    const rules = { ...defaultRulesConfig(), ...TRUNKS } as Rules
    const deck = testDeck(heroMP)
    expect(validateDeck(db, { ...deck, life: [...deck.life.slice(2), 'SS-104', 'SS-104'] }, rules).join()).toContain('2 copies')
    expect(validateDeck(db, { ...deck, life: [...deck.life.slice(1), 'SS-170'] }, rules).join()).toContain('cannot be an ally')
  })

  it('a Dragon Ball is never discarded as damage: it goes to the bottom of the life deck', () => {
    let s = combat()
    s.players[1].lifeDeck.unshift({ iid: 'ball', defId: 'SS-15', owner: 1 })
    const before = s.players[1].lifeDeck.length
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-BLAST') })
    if (s.pendingChoice?.kind === 'DEFEND') s = act(s, { type: 'DEFEND', player: 1, iid: null })
    expect(s.players[1].discard.some(c => c.iid === 'ball')).toBe(false)
    expect(s.players[1].lifeDeck.some(c => c.iid === 'ball')).toBe(true)
    expect(s.players[1].lifeDeck.length).toBe(before - 4) // 4 real discards, the Dragon Ball does not count
  })
})

describe('Trunks Saga allies in combat', () => {
  it('the defender chooses an ally to take the power stage damage; the overflow hits the life deck', () => {
    let s = combat()
    s.players[1].allies.push({ card: { iid: 'ally', defId: 'SS-171', owner: 1 }, stage: 1 })
    const [mpStage, life] = [s.players[1].mp.stage, s.players[1].lifeDeck.length]
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
    if (s.pendingChoice?.kind === 'DEFEND') s = act(s, { type: 'DEFEND', player: 1, iid: null })
    expect(s.pendingChoice?.kind).toBe('OPTION')
    s = act(s, { type: 'CHOOSE', player: 1, index: 1 })
    expect(s.players[1].mp.stage).toBe(mpStage)
    expect(s.players[1].allies[0].stage).toBe(0)
    expect(s.players[1].lifeDeck.length).toBeLessThanOrEqual(life)
  })

  it('an ally takes over at 0-1 stages and fights with its own power level and stages', () => {
    let s = combat()
    s.players[0].mp.stage = 1
    s.players[0].allies.push({ card: { iid: 'ally', defId: 'SS-104', owner: 0 }, stage: 6 })
    const take = legal(s).find(a => a.type === 'ALLY_TAKEOVER')
    expect(take).toBeDefined()
    s = act(s, take!)
    const blast = give(s, 0, 'TEST-BLAST')
    s = act(s, { type: 'PLAY_CARD', player: 0, iid: blast }) // energy: 2 stages from the ally
    expect(s.players[0].allies[0].stage).toBe(4)
    expect(s.players[0].mp.stage).toBe(1)
  })
})
