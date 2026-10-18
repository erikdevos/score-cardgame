import { describe, expect, it } from 'vitest'
import { applyAction, buildCardDB, createGame, newCombat, pur, tokuiWazaStyle, type Action, type GameState, type PlayerId, type Rules } from '../src/engine'
import patTrunks from '../src/engine/config/pat-trunks.json'
import saiyan from '../src/data/saiyan-saga/cards.json'
import trunksSaga from '../src/data/trunks-saga/cards.json'
import { db as testDb, heroMP, testDeck, villainMP } from './fixtures/testCards'
import { changeAnger, win } from '../src/engine/state'
import { give } from './helpers'

// Trunks Saga cards on the Trunks Saga rules
const TRUNKS: Partial<Rules> = {
  pat: { brackets: patTrunks.brackets, matrix: patTrunks.matrix },
  trunks: { levelStages: true, mostPowerfulByHighestLevel: true, finalPhysicalAttack: true, skipCombatRecovers: true, heroFirst: true, allyRules: true, dragonBalls: true, tokuiWaza: true },
}
const db = { ...testDb, ...buildCardDB(saiyan as unknown[]), ...buildCardDB(trunksSaga as unknown[]) }
const act = (s: GameState, a: Action) => applyAction(s, db, a).state
const styled = (style: string) => Object.values(db).filter(d => d.style === style && d.type !== 'Mastery').map(d => d.id)

/** Player 0's attack phase with empty hands. */
function combat(): GameState {
  const s = createGame(db, [testDeck(heroMP), testDeck(villainMP)], { seed: 1, rules: TRUNKS })
  s.attacker = 0
  s.step = 'COMBAT'
  s.pendingChoice = null
  s.combat = newCombat(0)
  for (const p of s.players) { p.discard.push(...p.hand); p.hand = [] }
  return s
}
/** Make a personality card the current main personality level. */
const asMP = (s: GameState, p: PlayerId, defId: string) => { s.players[p].mp.stack[s.players[p].mp.levelIndex] = { iid: `mp-${defId}`, defId, owner: p } }
const punch = (s: GameState) => {
  s = act(s, { type: 'PLAY_CARD', player: 0, iid: give(s, 0, 'TEST-PUNCH') })
  return s.pendingChoice?.kind === 'DEFEND' ? act(s, { type: 'DEFEND', player: 1, iid: null }) : s
}

describe('Trunks Saga: Tokui-Waza and Mastery', () => {
  it('a single-style deck claims Tokui-Waza; two styles or a style the character may not claim do not', () => {
    const red = styled('Red')
    expect(tokuiWazaStyle(db, { mp: heroMP, life: [...red, 'TEST-PUNCH'] })).toBe('Red')
    expect(tokuiWazaStyle(db, { mp: heroMP, life: [...red, ...styled('Blue')] })).toBeNull()
    expect(tokuiWazaStyle(db, { mp: heroMP, life: styled('Saiyan') })).toBeNull() // not a Saiyan
    expect(tokuiWazaStyle(db, { mp: heroMP, life: red, mastery: 'TS-145' })).toBeNull() // Black Mastery
  })

  it('Tokui-Waza adds 1 to the PUR', () => {
    const red = Array.from({ length: 50 }, (_, i) => styled('Red')[i % styled('Red').length])
    const s = createGame(db, [{ mp: heroMP, life: red, mastery: 'TS-144' }, testDeck(villainMP)], { seed: 1, rules: TRUNKS })
    expect(s.players[0].tokuiWaza).toBe('Red')
    expect(s.players[0].mastery?.defId).toBe('TS-144')
    expect(pur(s, db, 0)).toBe(db[heroMP[0]].personality!.pur + 1)
  })

  it('TS-145 Black Style Mastery: successful attacks do extra damage', () => {
    let s = combat()
    s.players[0].mastery = { iid: 'm', defId: 'TS-145', owner: 0 }
    s = punch(s)
    expect(s.log.some(e => e.msg.includes('Black Style Mastery: more damage'))).toBe(true)
  })

  it('TS-149 Blue Style Mastery: the opponent needs 6 anger for a level', () => {
    const s = combat()
    s.players[0].mastery = { iid: 'm', defId: 'TS-149', owner: 0 }
    changeAnger(s, db, 1, 5)
    expect(s.players[1].mp.levelIndex).toBe(0)
    changeAnger(s, db, 1, 1)
    expect(s.players[1].mp.levelIndex).toBe(1)
  })
})

describe('Trunks Saga: card rules', () => {
  it('a Defense Shield stops the first unstopped attack each combat', () => {
    let s = combat()
    asMP(s, 1, 'TS-171') // Gohan Lv2: stop the first unstopped attack
    s = punch(s)
    expect(s.combat!.lastAttack[0]?.success).toBe(false)
    expect(s.log.some(e => e.msg.includes('Defense Shield'))).toBe(true)
    s.combat!.active = 0
    s = punch(s)
    expect(s.combat!.lastAttack[0]?.success).toBe(true)
  })

  it('TS-200: the anger of this main personality cannot be lowered', () => {
    const s = combat()
    asMP(s, 1, 'TS-200')
    s.players[1].mp.anger = 3
    changeAnger(s, db, 1, -2)
    expect(s.players[1].mp.anger).toBe(3)
  })

  it('TS-157 on the table postpones a victory to the winner\'s next turn', () => {
    const s = combat()
    s.players[1].nonCombat.push({ iid: 'hope', defId: 'TS-157', owner: 1 })
    s.victoryGuards.push('hope')
    win(s, 0, 'MPP')
    expect(s.winner).toBeNull()
    expect(s.postponedWins).toHaveLength(1)
    expect(s.players[1].removed.some(c => c.iid === 'hope')).toBe(true)
  })
})
