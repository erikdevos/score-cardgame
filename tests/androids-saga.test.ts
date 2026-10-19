import { describe, expect, it } from 'vitest'
import { allCardsOf, applyAction, chooseAction, createGame, type GameState } from '../src/engine'
import { customHandlers } from '../src/engine/effects'
import { defenseShield, isFocused, powerOptions, tableEffects } from '../src/engine/abilities'
import { applyDamage } from '../src/engine/damage'
import { newCombat } from '../src/engine'
import { db, realCards } from '../src/ui/cardDb'
import { deckChoices } from '../src/ui/decks'
import { FORMATS } from '../src/ui/formats'

const FORMAT = 'SAIYAN_FRIEZA_TRUNKS_ANDROIDS'

describe('Androids Saga pool', () => {
  it('loads 136 cards', () => {
    expect(realCards.filter(c => c.set === 'Androids Saga')).toHaveLength(136)
  })

  it('AI games finish and conserve cards', () => {
    const choices = deckChoices(FORMAT).filter(c => c.key.startsWith('auto-'))
    expect(choices.length).toBeGreaterThan(4)
    const warns = new Map<string, number>()
    for (let seed = 1; seed <= 30; seed++) {
      const a = choices[seed % choices.length]
      const b = choices[(seed * 7 + 1) % choices.length]
      let s: GameState = createGame(db, [a.build(seed), b.build(seed + 1)], { seed, rules: FORMATS[FORMAT].rules })
      const total = [allCardsOf(s, 0).length, allCardsOf(s, 1).length]
      for (let i = 0; i < 5000 && s.winner === null; i++) s = applyAction(s, db, chooseAction(s, db)!).state
      expect(s.winner, `seed ${seed} (${a.label} vs ${b.label}) did not finish`).not.toBeNull()
      expect([allCardsOf(s, 0).length, allCardsOf(s, 1).length]).toEqual(total)
      for (const e of s.log) if (e.t === 'WARN') warns.set(e.msg.replace(/^.*custom effect /, ''), (warns.get(e.msg.replace(/^.*custom effect /, '')) ?? 0) + 1)
    }
    console.log('unimplemented in play:', [...warns].sort((x, y) => y[1] - x[1]).slice(0, 10))
  })

  it('locks and disabled drills switch powers off', () => {
    const choices = deckChoices(FORMAT).filter(c => c.key.startsWith('auto-'))
    const s = createGame(db, [choices[0].build(1), choices[1].build(2)], { seed: 1, rules: FORMATS[FORMAT].rules })
    const ctx = { s, db, user: 0 as const, source: 'test' }
    const before = powerOptions(s, db, 1).length
    customHandlers.disablePersonalityPower(ctx, { target: 'OPPONENT', until: 'performsEnergyAttack' })
    expect(powerOptions(s, db, 1)).toHaveLength(0)
    expect(before).toBeGreaterThan(0)
    // a drill in play, then switched off
    const drill = Object.values(db).find(d => d.id === 'AS-55')!
    s.players[1].drills.push({ iid: 'dr1', defId: drill.id, owner: 1 })
    expect(tableEffects(s, db, 1, 'playLimit')).toHaveLength(1)
    s.disabledDrills.push('dr1')
    expect(tableEffects(s, db, 1, 'playLimit')).toHaveLength(0)
  })
})

describe('Cell Saga pool', () => {
  const CELL = 'SAIYAN_FRIEZA_TRUNKS_ANDROIDS_CELL'
  it('loads 210 cards', () => {
    expect(realCards.filter(c => c.set === 'Cell Saga')).toHaveLength(210)
  })

  it('AI games finish and conserve cards', () => {
    const choices = deckChoices(CELL).filter(c => c.key.startsWith('auto-'))
    const warns = new Map<string, number>()
    for (let seed = 1; seed <= 30; seed++) {
      const a = choices[seed % choices.length]
      const b = choices[(seed * 7 + 1) % choices.length]
      let s: GameState = createGame(db, [a.build(seed), b.build(seed + 1)], { seed, rules: FORMATS[CELL].rules })
      const total = [allCardsOf(s, 0).length, allCardsOf(s, 1).length]
      for (let i = 0; i < 5000 && s.winner === null; i++) s = applyAction(s, db, chooseAction(s, db)!).state
      expect(s.winner, `seed ${seed} (${a.label} vs ${b.label}) did not finish`).not.toBeNull()
      expect([allCardsOf(s, 0).length, allCardsOf(s, 1).length]).toEqual(total)
      for (const e of s.log) if (e.t === 'WARN') { const k = e.msg.replace(/^.*custom effect /, ''); warns.set(k, (warns.get(k) ?? 0) + 1) }
    }
    console.log('unimplemented in play:', [...warns].sort((x, y) => y[1] - x[1]).slice(0, 8))
  })
})

describe('Cell Games Saga pool (all sets)', () => {
  it('loads 135 cards and AI games finish', () => {
    expect(realCards.filter(c => c.set === 'Cell Games Saga')).toHaveLength(135)
    expect(realCards.filter(c => c.set === 'World Games Saga')).toHaveLength(211)
    const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
    for (let seed = 1; seed <= 30; seed++) {
      const a = choices[seed % choices.length]
      const b = choices[(seed * 7 + 1) % choices.length]
      let s: GameState = createGame(db, [a.build(seed), b.build(seed + 1)], { seed, rules: FORMATS.ALL_SETS.rules })
      const total = [allCardsOf(s, 0).length, allCardsOf(s, 1).length]
      for (let i = 0; i < 5000 && s.winner === null; i++) s = applyAction(s, db, chooseAction(s, db)!).state
      expect(s.winner, `seed ${seed} (${a.label} vs ${b.label}) did not finish`).not.toBeNull()
      expect([allCardsOf(s, 0).length, allCardsOf(s, 1).length]).toEqual(total)
    }
  })
})

describe('Buu Saga rulebook keywords', () => {
  const setup = () => {
    const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
    const s = createGame(db, [choices[0].build(1), choices[1].build(2)], { seed: 1, rules: FORMATS.ALL_SETS.rules })
    return s
  }

  it('Endurance prevents life cards of damage, only with a Tokui-Waza', () => {
    const endCard = Object.values(db).find(d => d.id === 'CG-5')!
    for (const tokui of [null, 'Blue']) {
      const s = setup()
      const pl = s.players[1]
      pl.tokuiWaza = tokui
      // top card of the life deck: an Endurance 3 card, then plenty of cards
      pl.lifeDeck.unshift({ iid: 'end1', defId: endCard.id, owner: 1 })
      const before = pl.lifeDeck.length
      applyDamage(s, 1, { stages: 0, lifeCards: 5 }, db)
      expect(before - pl.lifeDeck.length).toBe(tokui ? 1 + 1 : 5)
      if (tokui) expect(pl.removed.some(c => c.iid === 'end1')).toBe(true)
    }
  })

  it('a focused attack is detected and sets off Defense Shields without stopping', () => {
    const focusedCard = Object.values(db).find(d => d.id === 'CG-47')!
    expect(isFocused({ combatRole: focusedCard.combatRole!, cost: focusedCard.cost, damage: focusedCard.damage, effects: focusedCard.effects })).toBe(true)
    const s = setup()
    s.combat = newCombat(0)
    s.players[1].drills.push({ iid: 'sh1', defId: 'AS-32', owner: 1 })
    const shield = (focused: boolean) => defenseShield(s, db, 1, 'PHYSICAL', focused)
    const normal = shield(false)
    expect(normal === null || typeof normal === 'string').toBe(true)
    expect(shield(true)).toBeNull()
  })
})
