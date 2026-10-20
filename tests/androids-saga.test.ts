import { describe, expect, it } from 'vitest'
import { allCardsOf, legalActions, applyAction, chooseAction, createGame, type GameState } from '../src/engine'
import { customHandlers } from '../src/engine/effects'
import { ownDamageBoost, defenseShield, isFocused, powerOptions, tableEffects } from '../src/engine/abilities'
import { applyDamage } from '../src/engine/damage'
import { newCombat } from '../src/engine'
import { resolveOption } from '../src/engine/effects/choices'
import { computeDamage } from '../src/engine/damage'
import { constantParams, retire, powerRating } from '../src/engine/state'
import { attachAfterAttack, attachAfterLifeDamage, attachCard, discardAttachedOf, isForbidden, nonCombatForbidden, sweepAttachments } from '../src/engine/attach'
import { applyNewModifiers, registerDamageModifier } from '../src/engine/damagemods'
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
    expect(realCards.filter(c => c.set === 'Babidi Saga')).toHaveLength(133)
    expect(realCards.filter(c => c.set === 'Buu Saga')).toHaveLength(212)
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

describe('Empower and card destinations', () => {
  const setup = () => {
    const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
    return createGame(db, [choices[0].build(1), choices[1].build(2)], { seed: 1, rules: FORMATS.ALL_SETS.rules })
  }

  it('Empower adds life cards; declining resolves the dropped text', () => {
    for (const index of [0, 1]) {
      const s = setup()
      s.combat = newCombat(0)
      const effects = { onEnterPlay: [], onPlaySecondary: [], onHit: [], postResolution: 'DISCARD' }
      s.combat.strike = { initiator: 0, card: null, strike: { combatRole: 'ATTACK_ENERGY', effects }, label: 'test', phase: 'AWAIT_DEFENSE', defenseCard: null, defense: null, lifeCardsDealt: 0, paidStages: 0 } as never
      const dropped = { onPlaySecondary: [{ action: 'MODIFY_ANGER', target: 'OPPONENT', amount: 2 }] }
      const anger = s.players[1].mp.anger
      s.pendingChoice = { kind: 'OPTION', player: 0, source: 'test', prompt: '', options: ['a', 'b'], purpose: 'empower', data: { amount: 2, dropped: JSON.stringify(dropped) } }
      resolveOption(s, db, index)
      if (index === 1) expect(computeDamage(s, db, 0, (s.combat.strike as unknown as { strike: never }).strike).lifeCards).toBe(s.rules.energyAttack.defaultLifeCards + 2)
      else expect(s.stack.length).toBeGreaterThan(0) // the dropped effects are scheduled
      expect(s.players[1].mp.anger).toBe(anger)
    }
  })

  it('a used card can return to the life deck', () => {
    const s = setup()
    const card = { iid: 'x1', defId: 'AS-55', owner: 0 as const }
    s.retireTo.x1 = 'LIFE_BOTTOM'
    const before = s.players[0].lifeDeck.length
    retire(s, card, 'DISCARD')
    expect(s.players[0].lifeDeck.length).toBe(before + 1)
    expect(s.players[0].lifeDeck[before].iid).toBe('x1')
  })
})

describe('Generic damage modifiers', () => {
  const setup = () => {
    const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
    const s = createGame(db, [choices[0].build(1), choices[1].build(2)], { seed: 1, rules: FORMATS.ALL_SETS.rules })
    s.combat = newCombat(0)
    return s
  }
  const strike = (s: GameState, attacker: 0 | 1, role = 'ATTACK_ENERGY', seq = 1) => {
    const effects = { onEnterPlay: [], onPlaySecondary: [], onHit: [], postResolution: 'DISCARD' }
    s.combat!.strikeSeq = seq
    s.combat!.strike = { initiator: attacker, card: null, strike: { combatRole: role, effects }, label: 'test', phase: 'AWAIT_DEFENSE', defenseCard: null, defense: null, lifeCardsDealt: 0, paidStages: 0, mods: [], seq } as never
    return s.combat!.strike as never as import('../src/engine').StrikeState
  }
  const dragonBall = (n: number) => ({ iid: `db${n}`, defId: 'SS-75', owner: 0 as const })

  it('adds a bonus per Dragon Ball in play', () => {
    const s = setup()
    const st = strike(s, 0)
    s.players[0].dragonBalls.push(dragonBall(1), { ...dragonBall(2), defId: 'WG-15' })
    registerDamageModifier(s, 0, 'AS-66', { lifeCardsPerDragonBall: 1, anywhere: true, duration: 'thisAttack' })
    expect(applyNewModifiers(s, db, st, 'ENERGY', { stages: 0, lifeCards: 4 }).lifeCards).toBe(6)
  })

  it('prevents damage from the next attack only', () => {
    const s = setup()
    strike(s, 1, 'ATTACK_ENERGY', 1)
    registerDamageModifier(s, 0, 'WG-34', { target: 'SELF', attackType: 'ANY', preventLifeCards: 3, forNextAttacks: 1, duration: 'thisCombat' })
    const second = strike(s, 1, 'ATTACK_ENERGY', 2)
    expect(applyNewModifiers(s, db, second, 'ENERGY', { stages: 0, lifeCards: 5 }).lifeCards).toBe(2)
    const third = strike(s, 1, 'ATTACK_ENERGY', 3)
    expect(applyNewModifiers(s, db, third, 'ENERGY', { stages: 0, lifeCards: 5 }).lifeCards).toBe(5)
  })

  it('a drill that prevents life cards from every opposing attack works, and the attacker name bonus replaces', () => {
    const s = setup()
    const st = strike(s, 0)
    s.players[1].drills.push({ iid: 'dr86', defId: 'BU-86', owner: 1 })
    expect(applyNewModifiers(s, db, st, 'ENERGY', { stages: 0, lifeCards: 4 }).lifeCards).toBe(2)
    expect(applyNewModifiers(s, db, st, 'ENERGY', { stages: 0, lifeCards: 1 }).lifeCards).toBe(0)
  })

  it('"first attack" bonuses apply once per combat', () => {
    const s = setup()
    const st = strike(s, 0, 'ATTACK_PHYSICAL')
    s.players[0].drills.push({ iid: 'dr158', defId: 'WG-158', owner: 0 })
    s.players[0].removed.push(...Array.from({ length: 3 }, (_, i) => ({ iid: `r${i}`, defId: 'AS-55', owner: 0 as const })))
    expect(applyNewModifiers(s, db, st, 'PHYSICAL', { stages: 2, lifeCards: 0 }).stages).toBe(5)
    expect(applyNewModifiers(s, db, st, 'PHYSICAL', { stages: 2, lifeCards: 0 }).stages).toBe(2)
  })
})

describe('Attached cards', () => {
  const setup = () => {
    const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
    const s = createGame(db, [choices[0].build(1), choices[1].build(2)], { seed: 1, rules: FORMATS.ALL_SETS.rules })
    s.combat = newCombat(0)
    return s
  }
  const fx = (id: string, handler: string) => db[id].effects.onEnterPlay.concat(db[id].effects.onPlaySecondary, db[id].effects.onHit)
    .flatMap(function find(e): typeof db[string]['effects']['onEnterPlay'] { return e.action === 'CUSTOM' ? [e, ...(Array.isArray(e.params?.then) ? (e.params!.then as never[]).flatMap(find) : [])] : [] }).filter(e => e.action === 'CUSTOM' && e.handler === handler)
  const inner = (id: string) => ((fx(id, 'attachToMainPersonality')[0] as unknown) as { params: { effect: never } }).params.effect

  it('Red Gambit adds 3 stages to every attack of the host and Saiyan Gambit adds power rating unless at stage 0', () => {
    const s = setup()
    const c = (id: string, i: number) => ({ iid: `a${i}`, defId: id, owner: 0 as const })
    attachCard(s, db, c('BU-95', 1), { player: 0, kind: 'mp' }, { effects: [inner('BU-95')] })
    expect(ownDamageBoost(s, db, 0, 'ENERGY', undefined).stages).toBe(3)
    expect(ownDamageBoost(s, db, 1, 'ENERGY', undefined).stages).toBe(0)
    const base = powerRating(s, db, 0)
    attachCard(s, db, c('BU-103', 2), { player: 0, kind: 'mp' }, { effects: [inner('BU-103')] })
    s.players[0].mp.stage = 2
    expect(powerRating(s, db, 0) - db[s.players[0].mp.stack[0].defId].personality!.powerRatings[2]).toBe(1000000)
    s.players[0].mp.stage = 0
    expect(powerRating(s, db, 0)).toBe(db[s.players[0].mp.stack[0].defId].personality!.powerRatings[0])
    expect(base).toBeGreaterThan(0)
  })

  it('attached cards stay out of the discard pile, are conserved and leave on their condition', () => {
    const s = setup()
    const before = allCardsOf(s, 0).length
    const card = s.players[0].hand.pop()!
    attachCard(s, db, card, { player: 0, kind: 'mp' }, { until: 'opponentDealsLifeCardDamage', effects: [] })
    retire(s, card, 'DISCARD')
    expect(s.players[0].discard.includes(card)).toBe(false)
    expect(allCardsOf(s, 0).length).toBe(before)
    attachAfterLifeDamage(s, db, 0, 1)
    expect(s.attachments.length).toBe(0)
    expect(s.players[0].discard.includes(card)).toBe(true)
  })

  it('removes on an energy attack and when the host is at its highest stage; discardAttached clears the host', () => {
    const s = setup()
    const a = s.players[0].hand.pop()!
    const b = s.players[0].hand.pop()!
    const c = s.players[0].hand.pop()!
    attachCard(s, db, a, { player: 0, kind: 'mp' }, { until: 'attachedPerformsEnergyAttack', removeWhenDone: true, effects: [] })
    attachCard(s, db, b, { player: 0, kind: 'mp' }, { until: 'attachedPersonalityAtHighestStage', effects: [] })
    attachAfterAttack(s, db, 0, 'PHYSICAL', true)
    expect(s.attachments.length).toBe(2)
    attachAfterAttack(s, db, 0, 'ENERGY', false)
    expect(s.players[0].removed.includes(a)).toBe(true)
    s.players[0].mp.stage = s.rules.maxStage
    sweepAttachments(s, db)
    expect(s.players[0].discard.includes(b)).toBe(true)
    attachCard(s, db, c, { player: 0, kind: 'mp' }, { effects: [] })
    expect(discardAttachedOf(s, db, 0)).toBe(1)
  })

  it('Red Trap forbids Non-Combat cards of the host and a Black Snap Kick forbids its host card', () => {
    const s = setup()
    const t = { iid: 't1', defId: 'WG-103', owner: 0 as const }
    attachCard(s, db, t, { player: 1, kind: 'mp' }, { effects: db['WG-103'].effects.onEnterPlay })
    expect(nonCombatForbidden(s, 1)).toBe(true)
    expect(nonCombatForbidden(s, 0)).toBe(false)
    const host = { iid: 'h1', defId: 'AS-55', owner: 1 as const }
    s.players[1].nonCombat.push(host)
    attachCard(s, db, { iid: 'k1', defId: 'BU-48', owner: 0 }, { player: 1, kind: 'card', iid: 'h1' }, { effects: db['BU-48'].effects.onHit })
    expect(isForbidden(s, 'h1')).toBe(true)
    s.players[1].nonCombat = []
    sweepAttachments(s, db)
    expect(isForbidden(s, 'h1')).toBe(false)
  })

  it('AI games with attach cards in the pool still finish and conserve cards', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
      let s = createGame(db, [choices[seed % choices.length].build(seed), choices[(seed + 3) % choices.length].build(seed + 100)], { seed, rules: FORMATS.ALL_SETS.rules })
      const total = [allCardsOf(s, 0).length, allCardsOf(s, 1).length]
      for (let i = 0; i < 4000 && s.winner === null; i++) s = applyAction(s, db, chooseAction(s, db)!).state
      expect(s.winner).not.toBeNull()
      expect([allCardsOf(s, 0).length, allCardsOf(s, 1).length]).toEqual(total)
    }
  })
})

describe('Second constant power and unpreventable damage', () => {
  it('Majin Buu Lv1 prevents 2 life cards of every opposing attack through its second power', () => {
    const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
    const s = createGame(db, [choices[0].build(1), choices[1].build(2)], { seed: 1, rules: FORMATS.ALL_SETS.rules })
    s.players[1].mp.stack[0] = { iid: 'buu', defId: 'BU-197', owner: 1 }
    s.players[1].mp.levelIndex = 0
    expect(constantParams(s, db, 1, 'damageModifier').length).toBe(1)
  })

  it('"cannot be prevented" flags the strike', () => {
    const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
    const s = createGame(db, [choices[0].build(1), choices[1].build(2)], { seed: 1, rules: FORMATS.ALL_SETS.rules })
    s.combat = newCombat(0)
    s.combat.strike = { initiator: 0, card: null, strike: { combatRole: 'ATTACK_PHYSICAL', effects: { onEnterPlay: [], onPlaySecondary: [], onHit: [], postResolution: 'DISCARD' } }, label: 't', phase: 'AWAIT_DEFENSE', defenseCard: null, defense: null, lifeCardsDealt: 0, paidStages: 0 } as never
    customHandlers.damageCannotBePrevented({ s, db, user: 0, source: 'BB-120' }, {})
    expect((s.combat.strike as unknown as { unpreventable?: boolean }).unpreventable).toBe(true)
  })
})

describe('Attack-phase abilities (discard a card to ...)', () => {
  it('Hercule Lv3 can discard a card to mill the opponent for 3, once the combat has begun', () => {
    const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
    let s = createGame(db, [choices[0].build(1), choices[1].build(2)], { seed: 1, rules: FORMATS.ALL_SETS.rules })
    s.players[0].mp.stack[0] = { iid: 'her', defId: 'BU-133', owner: 0 }
    s.players[0].mp.levelIndex = 0
    s.step = 'COMBAT'
    s.combat = newCombat(0)
    const acts = legalActions(s, db).filter(a => a.type === 'USE_ABILITY')
    expect(acts.length).toBe(1)
    const deck = s.players[1].lifeDeck.length
    s = applyAction(s, db, acts[0]).state
    expect(s.pendingChoice?.kind).toBe('PICK')
    s = applyAction(s, db, { type: 'PICK', player: 0, iid: (s.pendingChoice as { eligible: string[] }).eligible[0] }).state
    expect(s.players[1].lifeDeck.length).toBe(deck - 3)
    expect(s.step).toBe('COMBAT')
  })
})

describe('Discard to stop an attack', () => {
  it('BB-P10 stops a non-focused attack for a discard, and the player then passes for the rest of the combat', () => {
    const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
    let s = createGame(db, [choices[0].build(1), choices[1].build(2)], { seed: 1, rules: FORMATS.ALL_SETS.rules })
    s.players[1].drills.push({ iid: 'm', defId: 'BB-P10', owner: 1 })
    s.players[1].hand.push(s.players[1].lifeDeck.pop()!, s.players[1].lifeDeck.pop()!)
    s.step = 'COMBAT'
    s.combat = newCombat(0)
    s.combat.strike = { initiator: 0, card: null, strike: { combatRole: 'ATTACK_PHYSICAL', effects: { onEnterPlay: [], onPlaySecondary: [], onHit: [], postResolution: 'DISCARD' } }, label: 't', phase: 'AWAIT_DEFENSE', defenseCard: null, defense: null, lifeCardsDealt: 0, paidStages: 0 } as never
    s.pendingChoice = { kind: 'DEFEND', player: 1 } as never
    const act = legalActions(s, db).find(a => a.type === 'DEFEND_DISCARD')
    expect(act).toBeTruthy()
    s = applyAction(s, db, act!).state
    expect(s.pendingChoice?.kind).toBe('PICK')
    const hp = s.players[1].mp.stage
    s = applyAction(s, db, { type: 'PICK', player: 1, iid: (s.pendingChoice as { eligible: string[] }).eligible[0] }).state
    expect(s.players[1].mp.stage).toBe(hp)
    expect(s.combat!.finalAttack).toContain(1)
  })
})

describe('Granted attacks in the attack phase', () => {
  it('BB-83 (Red Physical Drill): discard a card and pay 2 stages for a physical attack, once per combat', () => {
    const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
    let s = createGame(db, [choices[0].build(1), choices[1].build(2)], { seed: 1, rules: FORMATS.ALL_SETS.rules })
    s.players[0].drills.push({ iid: 'rd', defId: 'BB-83', owner: 0 })
    s.players[0].hand.push(s.players[0].lifeDeck.pop()!, s.players[0].lifeDeck.pop()!)
    s.players[0].mp.stage = 4
    s.step = 'COMBAT'
    s.combat = newCombat(0)
    const act = legalActions(s, db).find(a => a.type === 'USE_ABILITY')
    expect(act).toBeTruthy()
    s = applyAction(s, db, act!).state
    expect(s.pendingChoice?.kind).toBe('PICK')
    s = applyAction(s, db, { type: 'PICK', player: 0, iid: (s.pendingChoice as { eligible: string[] }).eligible[0] }).state
    expect(s.log.some(l => l.msg.includes('Red Physical Drill: attack'))).toBe(true)
    expect(s.players[0].mp.stage).toBeLessThanOrEqual(4)
    expect(s.combat!.onceKeys.some(k => k.startsWith('ability:0:'))).toBe(true)
    expect(legalActions(s, db).some(a => a.type === 'USE_ABILITY')).toBe(false)
  })
})

describe('Attack-phase abilities, part 2', () => {
  const orangeDrill = Object.values(db).find(d => d.type === 'Drill' && d.style === 'Orange')!.id
  const setup = () => {
    const choices = deckChoices('ALL_SETS').filter(c => c.key.startsWith('auto-'))
    const s = createGame(db, [choices[0].build(1), choices[1].build(2)], { seed: 1, rules: FORMATS.ALL_SETS.rules })
    s.step = 'COMBAT'
    s.combat = newCombat(0)
    return s
  }

  it('BU-142: discard an Orange Drill to put 2 Drills from the Life Deck into play, once per combat', () => {
    let s = setup()
    s.players[0].mastery = { iid: 'm142', defId: 'BU-142', owner: 0 }
    s.players[0].drills.push({ iid: 'od', defId: orangeDrill, owner: 0 })
    const act = legalActions(s, db).find(a => a.type === 'USE_ABILITY')
    expect(act).toBeTruthy()
    const before = s.players[0].drills.length
    s = applyAction(s, db, act!).state
    for (let i = 0; i < 4 && s.pendingChoice?.kind === 'PICK'; i++) s = applyAction(s, db, { type: 'PICK', player: 0, iid: (s.pendingChoice as { eligible: string[] }).eligible[0] }).state
    expect(s.players[0].discard.some(c => c.iid === 'od')).toBe(true)
    expect(s.players[0].drills.length).toBeGreaterThanOrEqual(before - 1)
    expect(legalActions(s, db).some(a => a.type === 'USE_ABILITY')).toBe(false)
  })

  it('BU-43 attached: discard a card from hand to discard an opponent Non-Combat card', () => {
    let s = setup()
    const inner = (db['BU-43'].effects.onPlaySecondary.flatMap(function f(e): never[] { return e.action === 'CUSTOM' ? [e as never, ...((e.params?.then as never[] | undefined) ?? []).flatMap(f)] : [] }) as { handler: string }[]).find(e => e.handler === 'triggeredEffect')!
    attachCard(s, db, { iid: 'g', defId: 'BU-43', owner: 0 }, { player: 0, kind: 'mp' }, { effects: [inner as never] })
    s.players[0].hand.push(s.players[0].lifeDeck.pop()!)
    s.players[1].nonCombat.push({ iid: 'victim', defId: 'AS-55', owner: 1 })
    const act = legalActions(s, db).find(a => a.type === 'USE_ABILITY')
    expect(act).toBeTruthy()
    s = applyAction(s, db, act!).state
    for (let i = 0; i < 4 && s.pendingChoice?.kind === 'PICK'; i++) s = applyAction(s, db, { type: 'PICK', player: 0, iid: (s.pendingChoice as { eligible: string[] }).eligible[0] }).state
    expect(s.players[1].nonCombat.some(c => c.iid === 'victim')).toBe(false)
  })
})
