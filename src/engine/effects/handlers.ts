// CUSTOM effect handlers for card text the atomic DSL cannot express (see docs/dsl-gaps.md).
import { dragonBallsProtected, drillsProtected, inPlayAnywhere, restrictAttacks, type Params } from '../abilities'
import type { Effect } from '../cards'
import { computeDamage, applyDamage } from '../damage'
import { changeAnger, changeStages, def, drawCards, fighterStage, log, millCards, mpDef } from '../state'
import { other, type AttackType, type GameState, type PickZone, type PlayerId } from '../types'
import type { CardDB, CardDef } from '../cards'
import { resolveEffects, type CustomHandler, type EffectContext } from '.'
import { pickRequest, queueChoice, zoneCards } from './choices'
import { nextRandom, shuffleInPlace } from '../rng'

/** SELF / OPPONENT relative to the card user, ATTACKER / DEFENDER relative to this turn. */
export function targetOf(ctx: EffectContext, t: unknown): PlayerId {
  if (t === 'OPPONENT') return other(ctx.user)
  if (t === 'ATTACKER') return ctx.s.attacker
  if (t === 'DEFENDER') return other(ctx.s.attacker)
  return ctx.user
}

const then = (p: Params) => (Array.isArray(p.then) ? (p.then as Effect[]) : [])
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d)
const noop: CustomHandler = () => {}

/** Take cards from the top, bottom or a chosen place in a discard pile. */
function fromDiscard(ctx: EffectContext, p: Params, dest: 'HAND' | 'LIFE_TOP' | 'LIFE_BOTTOM') {
  const who = targetOf(ctx, p.target)
  const pile = ctx.s.players[who].discard
  const n = num(p.amount, 1)
  const position = (p.position ?? p.from ?? 'choice') as string
  // discard pile: last element = top
  const cards = position === 'top' ? pile.slice(-n).reverse() : position === 'bottom' ? pile.slice(0, n) : [...pile]
  queueChoice(ctx.s, pickRequest(who, who, 'discard', cards, n, dest, ctx.source))
}

/** Search filters used by searchDeck. */
function matchesFilter(s: GameState, db: CardDB, user: PlayerId, d: CardDef, filter: string): boolean {
  if (filter.startsWith('Dragon Ball')) {
    if (d.type !== 'Dragon Ball') return false
    const inPlay = s.players.some(p => p.dragonBalls.some(c => def(db, c).dragonBallNumber === d.dragonBallNumber))
    return !(inPlay && (s.rules.uniqueDragonBallNumbers || filter.includes('not in play')))
  }
  if (filter.startsWith('Ally')) {
    const mine = mpDef(s, db, user).personality!.character
    return d.type === 'Personality' && d.personality?.level === 1 && d.personality.character !== mine
  }
  if (filter === 'Drill') {
    if (d.type !== 'Drill') return false
    if (s.rules.uniqueDrillsPerPlayer && s.players[user].drills.some(c => c.defId === d.id)) return false
    return !(d.exclusiveDrillStyle && s.players.some(p => p.drills.some(c => def(db, c).style === d.exclusiveDrillStyle)))
  }
  return false
}

const ZONE_BY_TYPE: Record<string, PickZone> = { Drill: 'drills', Ally: 'allies', 'Non-Combat': 'nonCombat' }

export const handlers: Record<string, CustomHandler> = {
  // Read elsewhere (legal actions, defenses, timing, damage), nothing to resolve.
  playTiming: noop,
  usageLimit: noop,
  dualUse: noop,
  powerDefense: noop,
  shieldNextAttack: noop,
  // ongoing effects read where they matter (damage, costs, legal actions, UI)
  retaliationDrain: noop,
  attackCostModifier: noop,
  copyDefendedAttack: noop,
  revealHand: noop,
  damageAbsorber: noop,
  recurringDamage: noop,
  allowMixedDrills: noop, // the engine has no one-style-per-player limit to lift
  protectDrills: noop,
  preventDragonBallCapture: noop,
  optionalShuffle: noop,
  requiresCondition: noop,
  useOtherLevelPower: noop,
  // Frieza Saga: read where they matter (defenses, hit check, passives, legal plays, damage)
  damageIfStopped: noop,
  cannotBeDefended: noop,
  cannotBeStoppedBy: noop,
  conditionalPassive: noop,
  dragonBallPlayLimit: noop,
  constantPower: noop,
  mirrorAngerReduction: noop, // read in changeAnger
  conditionalPostResolution: noop, // read when the card retires
  // Trunks Saga: read where they matter
  defenseShield: noop, // resolveHit (Defense Shield step)
  angerReductionLimit: noop, // changeAnger
  angerToLevelUp: noop, // changeAnger (Mastery)
  preventLevelUp: noop, // level-up, from the table
  reflectDamage: noop, // after damage, from the table
  attackAsDefense: noop, // defenses
  cardsCannotBeStopped: noop, // defenses
  requireMultipleDefenses: noop, // defenses
  postponeVictory: noop, // win()
  borrowPowerStage: noop, // computeDamage
  // optional "you may" effects: not using them is always allowed
  convertDamageToStages: noop, // TS-13: energy damage as power stages instead
  shuffleInsteadOfBottom: noop, // TS-P3: shuffle instead of the bottom of the life deck
  grantAttack: noop, // TS-70: an extra energy attack option next attack phase (not offered yet)

  // Androids Saga: read where they matter
  ifStopped: noop, // sequencer damageIfStopped

  ifTokuiWaza(ctx, p) {
    // "If you declared Tokui-Waza ..." (assumed: the style bonus claimed at setup)
    if (ctx.s.players[ctx.user].tokuiWaza) {
      const st = ctx.s.combat?.strike
      const r = p.replaceDamage as { stages?: number; lifeCards?: number } | undefined
      if (r && st) st.strike = { ...st.strike, damage: { calculation: 'FLAT', stages: r.stages ?? 0, lifeCards: r.lifeCards ?? 0, modifierStages: 0, modifierLifeCards: 0 } }
      resolveEffects(ctx, then(p))
    } else log(ctx.s, 'NO_EFFECT', `${ctx.source}: Tokui-Waza was not declared`)
  },

  ifOwnAlignment(ctx, p) {
    if (mpDef(ctx.s, ctx.db, ctx.user).personality!.alignment === p.alignment) resolveEffects(ctx, then(p))
  },

  ifBottomDiscardStyle(ctx, p) {
    const bottom = ctx.s.players[ctx.user].discard[0]
    if (bottom && def(ctx.db, bottom).style === p.style) resolveEffects(ctx, then(p))
    else log(ctx.s, 'NO_EFFECT', `${ctx.source}: the bottom card of the discard pile is not a ${String(p.style)} card`)
  },

  discardLifePerAnger(ctx, p) {
    // AS-12: N life cards per anger level above `above`
    const who = targetOf(ctx, p.target)
    const levels = Math.max(0, ctx.s.players[who].mp.anger - num(p.above, 0))
    const n = millCards(ctx.s, who, levels * num(p.perAngerLevel, 1), ctx.db)
    log(ctx.s, 'MILL', `${ctx.source}: player ${who + 1} discards ${n} life card(s)`, who)
  },

  shuffleHandIntoLifeDeck(ctx, p) {
    // AS-12: the hand goes into the life deck, then the same number of cards is drawn
    const { s } = ctx
    const who = targetOf(ctx, p.target)
    const pl = s.players[who]
    const n = pl.hand.length
    pl.lifeDeck.push(...pl.hand.splice(0))
    s.rngSeed = shuffleInPlace(pl.lifeDeck, s.rngSeed)
    if (p.thenDrawSameNumber) drawCards(s, who, n)
    log(s, 'MOVE', `${ctx.source}: player ${who + 1} shuffles ${n} card(s) of their hand into their life deck`, who)
  },

  moveDragonBallsToBottom(ctx, p) {
    // AS-P1: all Dragon Balls leave the life deck, the rest is shuffled, the Dragon Balls go to the bottom (any order: kept as found)
    const { s, db } = ctx
    const foe = targetOf(ctx, p.target ?? 'OPPONENT')
    const pl = s.players[foe]
    const balls = pl.lifeDeck.filter(c => def(db, c).type === 'Dragon Ball')
    const rest = pl.lifeDeck.filter(c => def(db, c).type !== 'Dragon Ball')
    s.rngSeed = shuffleInPlace(rest, s.rngSeed)
    pl.lifeDeck = [...rest, ...balls]
    log(s, 'MOVE', `${ctx.source}: ${balls.length} Dragon Ball(s) go to the bottom of player ${foe + 1}'s life deck`, foe)
  },

  damagePerAnger(ctx) {
    // AS-45: X power stages, X = the anger of all players together
    const st = ctx.s.combat?.strike
    if (!st) return
    const x = ctx.s.players.reduce((n, pl) => n + pl.mp.anger, 0)
    st.strike = { ...st.strike, damage: { calculation: 'FLAT', stages: x, lifeCards: 0, modifierStages: 0, modifierLifeCards: 0 } }
    log(ctx.s, 'DAMAGE_X', `${ctx.source}: the attack does ${x} power stage(s)`, st.initiator)
  },

  endCombatAfterDamage(ctx) {
    // AS-57: the strike still resolves, then combat is over
    if (ctx.s.combat) ctx.s.combat.ended = true
  },

  angerRaiseLimit: noop, // changeAnger (AS-93)
  playLimit: noop, // legal.ts canPlayNonCombat (AS-55)
  playCostModifier: noop, // sequencer extraPlayCost (AS-44)
  removeInsteadOfDiscard: noop, // engine.ts sweepDiscards (AS-96)
  playNonCombatInsteadOfAttack: noop, // legal.ts, turn.ts (AS-125)

  disablePersonalityPower(ctx, p) {
    const who = targetOf(ctx, p.target)
    ctx.s.powerLocks.push({ player: who, until: String(p.until), cardIid: p.attached ? ctx.card?.iid : undefined })
    log(ctx.s, 'RESTRICT', `${ctx.source}: player ${who + 1}'s main personality cannot use its power until ${String(p.until)}`, who)
  },

  disableDrillPower(ctx, p) {
    const foe = targetOf(ctx, p.target ?? 'OPPONENT')
    const drills = ctx.s.players[foe].drills.filter(c => !ctx.s.disabledDrills.includes(c.iid))
    if (!drills.length) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1} has no drills in play`)
    queueChoice(ctx.s, {
      kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: 'Choose a drill of your opponent', purpose: 'disableDrill',
      options: drills.map(c => def(ctx.db, c).name), data: Object.fromEntries(drills.map((c, i) => [String(i), c.iid])),
    })
  },

  loseStagesForAnger(ctx, p) {
    const max = fighterStage(ctx.s, ctx.user)
    queueChoice(ctx.s, {
      kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: 'How many power stages do you lose?', purpose: 'loseStages',
      options: Array.from({ length: max + 1 }, (_, i) => `${i} stage${i === 1 ? '' : 's'}`), data: { per: num(p.stagesPerAngerLevel, 2) },
    })
  },

  discardNamedCardFromDeck(ctx) {
    const names = [...new Set(Object.values(ctx.db).filter(d => d.type !== 'Dragon Ball' && !d.id.startsWith('TEST')).map(d => d.name))].sort()
    queueChoice(ctx.s, { kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: 'Name a non-Dragon Ball card', options: names, purpose: 'nameCardDiscard', data: {} })
  },

  useNonCombatInPlay(ctx, p) {
    const cards = ctx.s.players[ctx.user].nonCombat.filter(c => !def(ctx.db, c).combatRole)
    if (!cards.length) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: no Non-Combat card in play`)
    queueChoice(ctx.s, pickRequest(ctx.user, ctx.user, 'nonCombat', cards, num(p.amount, 1), 'USE_NONCOMBAT', ctx.source))
  },

  drawUntilHandSize(ctx, p) {
    const who = targetOf(ctx, p.target)
    const n = num(p.size, 3) - ctx.s.players[who].hand.length
    if (n > 0) drawCards(ctx.s, who, n)
  },

  preventStageGain(ctx, p) {
    // TS-29: until the beginning of the user's next turn
    const who = targetOf(ctx, p.target)
    const untilTurn = ctx.s.turn + (ctx.s.attacker === ctx.user ? 2 : 1)
    ctx.s.stageLocks.push({ player: who, untilTurn })
    log(ctx.s, 'RESTRICT', `${ctx.source}: player ${who + 1} cannot gain power stages until player ${ctx.user + 1}'s next turn`, who)
  },

  modifyAngerPerCardInPile(ctx, p) {
    const who = targetOf(ctx, p.target)
    const n = ctx.s.players[ctx.user].discard.filter(c => def(ctx.db, c).name === p.cardName).length * num(p.perCard, 1)
    if (n) changeAnger(ctx.s, ctx.db, who, n)
    else log(ctx.s, 'NO_EFFECT', `${ctx.source}: no ${String(p.cardName)} in the discard pile`)
  },

  shuffleHandCardIntoLifeDeck(ctx, p) {
    const hand = ctx.s.players[ctx.user].hand
    if (!hand.length) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: no card in hand`)
    queueChoice(ctx.s, pickRequest(ctx.user, ctx.user, 'hand', hand, num(p.amount, 1), 'LIFE_SHUFFLE', ctx.source))
  },

  shuffleOpponentHandCard(ctx, p) {
    // TS-P2: look at the opponent's hand and shuffle a card of it into their life deck
    const foe = targetOf(ctx, p.target ?? 'OPPONENT')
    const hand = ctx.s.players[foe].hand
    if (!hand.length) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1} has no cards in hand`)
    queueChoice(ctx.s, pickRequest(ctx.user, foe, 'hand', hand, num(p.amount, 1), 'LIFE_SHUFFLE', ctx.source))
  },

  moveHandCardToLifeDeck(ctx, p) {
    // TS-188: a random card from the opponent's hand goes on top of their life deck
    const { s, db } = ctx
    const foe = targetOf(ctx, p.target ?? 'OPPONENT')
    const hand = s.players[foe].hand
    for (let i = 0; i < num(p.amount, 1) && hand.length; i++) {
      const [r, next] = nextRandom(s.rngSeed)
      s.rngSeed = next
      const [card] = hand.splice(Math.floor(r * hand.length), 1)
      if (p.position === 'bottom') s.players[foe].lifeDeck.push(card)
      else s.players[foe].lifeDeck.unshift(card)
      log(s, 'MOVE', `${ctx.source}: player ${foe + 1} puts ${def(db, card).name} from their hand on ${p.position === 'bottom' ? 'the bottom' : 'top'} of their life deck`, foe)
    }
  },

  shuffleIntoLifeDeck(ctx, p) {
    // TS-120: an opponent's Dragon Ball in play goes back into their life deck
    const foe = targetOf(ctx, p.target ?? 'OPPONENT')
    const balls = ctx.s.players[foe].dragonBalls
    if (!balls.length) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1} has no Dragon Balls in play`)
    queueChoice(ctx.s, pickRequest(ctx.user, foe, 'dragonBalls', balls, num(p.amount, 1), 'LIFE_SHUFFLE', ctx.source))
  },

  damagePerStage(ctx, p) {
    // TS-69: 1 life card per power stage above 0, counted after paying the cost
    const st = ctx.s.combat?.strike
    if (!st) return
    const n = fighterStage(ctx.s, st.initiator) * num(p.lifeCardsPerStage, 1)
    st.strike = { ...st.strike, damage: { calculation: 'FLAT', stages: 0, lifeCards: n, modifierStages: 0, modifierLifeCards: 0 } }
    log(ctx.s, 'DAMAGE_X', `${ctx.source}: the attack does ${n} life card(s)`, st.initiator)
  },

  disableConstantPowers(ctx) {
    if (!ctx.s.combat) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: no combat`)
    ctx.s.combat.noConstantPowers = true
    log(ctx.s, 'RESTRICT', `${ctx.source}: Constant Combat Powers stop working for the rest of this combat`)
  },

  forbidCards(ctx, p) {
    // TS-P10: drills, allies and personality powers are off for this combat; the drills (TS-42, TS-128) work from the table
    if (p.duration !== 'thisCombat') return
    if (!ctx.s.combat) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: no combat`)
    ctx.s.combat.lockdown = true
    log(ctx.s, 'RESTRICT', `${ctx.source}: no drills, allies or personality powers this combat`)
  },

  chooseOne(ctx, p) {
    const branches = (p.options ?? []) as Effect[][]
    const options = branches.map(b => b.map(e => (e.action === 'MODIFY_ANGER' ? `${e.target === 'SELF' ? 'raise your' : "lower the opponent's"} anger ${Math.abs(e.amount)}` : e.action.toLowerCase())).join(', '))
    queueChoice(ctx.s, { kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: `${ctx.source}: choose one`, options, purpose: 'chooseOne', data: { branches: JSON.stringify(branches) } })
  },

  ifDrawnCardStyle(ctx, p) {
    // TS-147/148: the card just drawn is the last one in hand
    const hand = ctx.s.players[ctx.user].hand
    const card = hand[hand.length - 1]
    if (card && def(ctx.db, card).style === p.style) {
      log(ctx.s, 'REVEAL', `${ctx.source}: player ${ctx.user + 1} shows ${def(ctx.db, card).name}`, ctx.user)
      resolveEffects(ctx, then(p))
    } else log(ctx.s, 'NO_EFFECT', `${ctx.source}: the card drawn is not a ${String(p.style)} Style card`)
  },

  modifyStagesPerLifeCard(ctx, p) {
    const n = (ctx.s.combat?.lastLifeLost ?? 0) * num(p.perLifeCardReceived, 1)
    if (!n) return
    changeStages(ctx.s, targetOf(ctx, p.target), n)
    log(ctx.s, 'STAGES', `${ctx.source}: player ${ctx.user + 1} gains ${n} power stage(s)`, ctx.user)
  },

  removeTopDiscardForAnger(ctx, p) {
    // TS-144: remove the top discard from the game for 1 anger, 2 if it is a Red Style card
    const pl = ctx.s.players[ctx.user]
    const card = pl.discard.pop()
    if (!card) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: the discard pile is empty`)
    pl.removed.push(card)
    const bonus = p.styleBonus as { style?: string; anger?: number } | undefined
    const n = bonus && def(ctx.db, card).style === bonus.style ? num(bonus.anger, 2) : num(p.anger, 1)
    log(ctx.s, 'REMOVE', `${ctx.source}: player ${ctx.user + 1} removes ${def(ctx.db, card).name} from the game`, ctx.user)
    changeAnger(ctx.s, ctx.db, ctx.user, n)
  },

  rearrangeLifeDeckTop(ctx, p) {
    // TS-P9: look at the top cards; putting them back in the same order is one of the allowed orders
    const foe = targetOf(ctx, p.target ?? 'OPPONENT')
    const top = ctx.s.players[foe].lifeDeck.slice(0, num(p.count, 5))
    log(ctx.s, 'REVEAL', `${ctx.source}: player ${ctx.user + 1} looks at ${top.map(c => def(ctx.db, c).name).join(', ') || 'nothing'}`, ctx.user)
  },

  variableCost(ctx, p) {
    // FS-24: choose 1-7 life cards to pay; that many is the damage if successful
    const min = num(p.min, 1)
    const max = Math.min(num(p.max, 7), ctx.s.players[ctx.user].lifeDeck.length - 1)
    if (max < min) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: not enough life cards to pay`, ctx.user)
    const options = Array.from({ length: max - min + 1 }, (_, i) => `${i + min} life card${i + min === 1 ? '' : 's'}`)
    queueChoice(ctx.s, { kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: `${ctx.source}: how many life cards do you pay?`, options, purpose: 'variableCost', data: { min } })
  },

  useDrillPower(ctx) {
    // FS-111: borrow the power of a drill in play for the rest of this combat
    const own = new Set(ctx.s.players[ctx.user].drills.map(c => c.defId))
    const ids = [...new Set(ctx.s.players.flatMap(pl => pl.drills.map(c => c.defId)))].filter(id => !own.has(id))
    if (!ctx.s.combat || !ids.length) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: no other drill in play to borrow`, ctx.user)
    queueChoice(ctx.s, { kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: `${ctx.source}: whose drill power do you use this combat?`, options: ids.map(id => ctx.db[id].name), purpose: 'borrowDrill', data: Object.fromEntries(ids.map((id, i) => [String(i), id])) })
  },

  counterCard(ctx) {
    // FS-121 (approximation): cancel a lasting card by removing an opponent's non-Dragon Ball card in play from the game
    const { s, db, user } = ctx
    const foe = other(user)
    const zones: PickZone[] = drillsProtected(s, db, foe) ? ['nonCombat'] : ['drills', 'nonCombat']
    const cards = zones.flatMap(z => zoneCards(s, foe, z))
    if (!cards.length) return log(s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1} has no card to stop`)
    queueChoice(s, pickRequest(user, foe, zones, cards, 1, 'REMOVED', ctx.source))
  },

  preventVictory(ctx) {
    // FS-P1: the opponent cannot win by Dragon Balls or Most Powerful Personality during their next 2 turns
    const foe = other(ctx.user)
    const untilTurn = ctx.s.turn + (ctx.s.attacker === foe ? 5 : 4)
    ctx.s.victoryBlocks.push({ player: foe, untilTurn, source: ctx.source })
    log(ctx.s, 'PROTECT', `${ctx.source}: player ${foe + 1} cannot win by Dragon Balls or Most Powerful Personality for their next 2 turns`, ctx.user)
  },

  ifInPlay(ctx, p) {
    if (inPlayAnywhere(ctx.s, ctx.db, p)) resolveEffects(ctx, then(p))
    else log(ctx.s, 'NO_EFFECT', `${ctx.source}: ${String(p.cardName ?? p.character)} is not in play, no extra effect`)
  },

  conditionalDamage(ctx, p) {
    const st = ctx.s.combat?.strike
    if (!st || (p.condition === 'characterInPlay' && !inPlayAnywhere(ctx.s, ctx.db, { character: p.character }))) return
    const d = { stages: num(p.stages, 0), lifeCards: num(p.lifeCards, 0) }
    log(ctx.s, 'DAMAGE', `${ctx.source}: ${String(p.character)} is in play, extra damage`, st.initiator)
    st.lifeCardsDealt += applyDamage(ctx.s, other(st.initiator), d, ctx.db)
  },

  discardFromPlay(ctx, p) {
    const { s, db, user } = ctx
    const foe = targetOf(ctx, p.target ?? 'OPPONENT')
    const zones = ((p.cardTypes ?? ['Drill']) as string[]).map(x => ZONE_BY_TYPE[x]).filter(z => z && !(z === 'drills' && drillsProtected(s, db, foe)))
    const cards = zones.flatMap(z => zoneCards(s, foe, z))
    if (!cards.length) return log(s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1} has nothing to discard`)
    queueChoice(s, pickRequest(user, foe, zones, cards, num(p.amount, 1), 'DISCARD', ctx.source))
  },

  discardFromOpponentHand(ctx, p) {
    const { s, db } = ctx
    const foe = targetOf(ctx, p.target ?? 'OPPONENT')
    const hand = s.players[foe].hand
    for (let i = 0; i < num(p.amount, 1) && hand.length; i++) {
      const [r, next] = nextRandom(s.rngSeed)
      s.rngSeed = next
      const [card] = hand.splice(Math.floor(r * hand.length), 1)
      s.players[foe].discard.push(card)
      log(s, 'DISCARD', `${ctx.source}: player ${foe + 1} discards ${def(db, card).name} from their hand at random`, foe)
    }
  },

  temporaryStage(ctx) {
    const st = ctx.s.combat?.strike
    if (st) st.tempStage = ctx.s.rules.maxStage
  },

  endNextCombat(ctx) {
    ctx.s.endNextCombat.push(ctx.user)
    log(ctx.s, 'PROTECT', `${ctx.source}: the next combat player ${ctx.user + 1} is forced into ends before damage`, ctx.user)
  },

  takeDiscardedLifeCard(ctx) {
    const st = ctx.s.combat?.strike
    if (st) st.takeFirstMilled = ctx.user
  },

  sweepCards(ctx, p) {
    const { s, db, user } = ctx
    const foe = other(user)
    if (p.cardType === 'Ally') {
      // FS-118: all of the opponent's allies are discarded
      const gone = s.players[foe].allies.map(a => a.card)
      s.players[foe].allies = []
      s.players[foe].discard.push(...gone)
      return log(s, 'DISCARD', `${ctx.source}: player ${foe + 1} discards their allies (${gone.length})`, foe)
    }
    if (p.cardType === 'Non-Combat') {
      // FS-67: the owner picks N of the opponent's non-Dragon Ball cards in play (drills included)
      const zones: PickZone[] = drillsProtected(s, db, foe) ? ['nonCombat'] : ['drills', 'nonCombat']
      const cards = zones.flatMap(z => zoneCards(s, foe, z))
      if (!cards.length) return log(s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1} has no card to discard`)
      return queueChoice(s, pickRequest(user, foe, zones, cards, num(p.amount, 1), 'DISCARD', ctx.source))
    }
    if (drillsProtected(s, db, foe)) return log(s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1}'s drills are protected`)
    const gone = s.players[foe].drills
    s.players[foe].drills = []
    s.players[foe].discard.push(...gone)
    log(s, 'DISCARD', `${ctx.source}: player ${foe + 1}'s drills are swept from the table (${gone.length})`, foe)
  },

  replaceDrawSource(ctx, p) {
    const who = targetOf(ctx, p.target)
    ctx.s.discardAsLife.push({ player: who, mode: 'DRAW', position: p.position === 'top' ? 'top' : 'bottom', remaining: ctx.s.rules.defenderCombatDraw, armed: false, source: ctx.source })
    log(ctx.s, 'DRAW', `${ctx.source}: player ${who + 1} draws from the discard pile in the next combat`, who)
  },

  removeNamedCardFromDecks(ctx) {
    const names = [...new Set(Object.values(ctx.db).filter(d => d.type === 'Non-Combat' && !d.id.startsWith('TEST')).map(d => d.name))].sort()
    queueChoice(ctx.s, { kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: 'Name a Non-Combat card', options: names, purpose: 'nameCard', data: {} })
  },

  endTurn(ctx) {
    ctx.s.keepHand.push({ player: ctx.user, turn: ctx.s.turn })
  },

  modifyStagesByRole(ctx, p) {
    const who = targetOf(ctx, p.target)
    changeStages(ctx.s, who, num(p.amount, 0))
    log(ctx.s, 'STAGES', `${ctx.source}: player ${who + 1} ${num(p.amount, 0) >= 0 ? 'gains' : 'loses'} ${Math.abs(num(p.amount, 0))} power stage(s)`, who)
  },

  angerLock(ctx, p) {
    const who = targetOf(ctx, p.target)
    if (!ctx.s.angerLock.includes(who)) ctx.s.angerLock.push(who)
    log(ctx.s, 'ANGER', `${ctx.source}: player ${who + 1}'s anger cannot rise until they force a life card discard`, who)
  },

  modifyAngerFiltered(ctx, p) {
    const levels = (p.personalityLevels ?? []) as number[]
    const ok = [ctx.user, other(ctx.user)].filter(pid => levels.includes(ctx.s.players[pid].mp.levelIndex + 1))
    if (!ok.length) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: no personality at level ${levels.join(' or ')}`)
    const options = ok.map(pid => (pid === ctx.user ? 'Your main personality' : "The opponent's main personality"))
    queueChoice(ctx.s, { kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: `${ctx.source}: whose anger rises ${num(p.amount, 1)}?`, options, purpose: 'anger', data: { first: ok[0], second: ok[1] ?? -1, amount: num(p.amount, 1) } })
  },

  resetBattle(ctx) {
    const { s } = ctx
    const c = s.combat
    if (!c) return
    c.startLevels.forEach((l, i) => {
      s.players[i].mp.stage = l.stage
      s.players[i].mp.anger = l.anger
    })
    c.ended = true
    // the attack in progress never happened either
    if (c.strike) c.strike.defense = { mode: 'STOP', stages: 0, lifeCards: 0 }
    log(s, 'RESET', `${ctx.source}: this battle never happened, stages and anger are back to the start of combat`)
  },

  /** Multi-Form: "two physical attacks, one after another" */
  extraAttack(ctx, p) {
    const c = ctx.s.combat
    if (!c) return
    c.bonusAttack = { player: ctx.user, attackType: (p.attackType ?? 'ANY') as AttackType, remaining: num(p.count, 1), active: false }
  },
  autoStopAttack: noop,

  removeFromGame(ctx, p) {
    const { s, db, user } = ctx
    if (p.zone === 'discard' || p.zone === 'lifeDeck') {
      // FS-14: top 3 of the opponent's discard pile; FS-21: top card of your own life deck
      const who = targetOf(ctx, p.target)
      const pile = s.players[who][p.zone]
      const n = Math.min(num(p.amount, 1), pile.length)
      const gone = p.zone === 'discard' ? pile.splice(pile.length - n, n) : pile.splice(0, n)
      s.players[who].removed.push(...gone)
      return log(s, 'REMOVE', `${ctx.source}: player ${who + 1} removes ${n} card(s) from their ${p.zone === 'discard' ? 'discard pile' : 'life deck'} from the game`, who)
    }
    if (p.perOwnLifeCardsRemoved) {
      // FS-23: pay N life cards per opponent drill removed
      const per = num(p.perOwnLifeCardsRemoved, 2)
      const foe = other(user)
      const max = drillsProtected(s, db, foe) ? 0 : Math.min(s.players[foe].drills.length, Math.floor((s.players[user].lifeDeck.length - 1) / per))
      if (max < 1) return log(s, 'NO_EFFECT', `${ctx.source}: no opponent drill to remove`)
      const options = Array.from({ length: max + 1 }, (_, i) => `${i} drill${i === 1 ? '' : 's'} (${i * per} life cards)`)
      return queueChoice(s, { kind: 'OPTION', player: user, source: ctx.source, prompt: `${ctx.source}: how many opponent drills do you remove?`, options, purpose: 'lifeForDrills', data: { per } })
    }
    if (p.target === 'SELF') {
      // Chiaotzu's Blast: Chiaotzu leaves the game. As an ally that is clear; a main personality stays.
      const ally = s.players[user].allies.find(a => def(db, a.card).personality?.character === p.card)
      // a main personality can never be removed from the game this way: the effect fails
      if (!ally) return log(s, 'NO_EFFECT', `${ctx.source}: ${p.card} is not an ally; a main personality cannot be removed, no effect`)
      return queueChoice(s, pickRequest(user, user, 'allies', [ally.card], 1, 'REMOVED', ctx.source))
    }
    const foe = other(user)
    const zones = ((p.cardTypes ?? []) as string[]).map(t => ZONE_BY_TYPE[t]).filter(z => z && !(z === 'drills' && drillsProtected(s, db, foe)))
    const cards = zones.flatMap(z => zoneCards(s, foe, z))
    if (!cards.length) return log(s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1} has nothing to remove`)
    queueChoice(s, pickRequest(user, foe, zones, cards, num(p.amount, 1), 'REMOVED', ctx.source))
  },

  discardFromHand(ctx, p) {
    const who = targetOf(ctx, p.target)
    queueChoice(ctx.s, pickRequest(who, who, 'hand', ctx.s.players[who].hand, num(p.amount, 1), 'DISCARD', ctx.source))
  },

  searchDeck(ctx, p) {
    const { s, db, user } = ctx
    const owner = p.target === 'OPPONENT' ? other(user) : user
    const zones = (Array.isArray(p.from) ? p.from : [p.from ?? 'lifeDeck']) as PickZone[]
    const level = s.players[user].mp.levelIndex + 1
    const cards = zones.flatMap(z => zoneCards(s, owner, z)).filter(c => matchesFilter(s, db, user, def(db, c), String(p.filter ?? '')))
      .filter(c => !p.matchNumberToLevel || def(db, c).dragonBallNumber === level)
    if (!cards.length) return log(s, 'NO_EFFECT', `${ctx.source}: no ${p.filter} found`)
    if (p.which === 'first') {
      // the first one from the top, no choice (SS-240)
      return queueChoice(s, pickRequest(user, owner, zones, [cards[0]], 1, p.to === 'bottomOfLifeDeck' ? 'OWNER_LIFE_BOTTOM' : 'HAND', ctx.source))
    }
    const allyStage = p.setPowerStage === 'MAX' ? s.rules.maxStage : undefined
    queueChoice(s, pickRequest(user, owner, zones, cards, 1, p.to === 'play' ? 'PLAY' : 'HAND', ctx.source, { allyStage }))
  },

  useDiscardAsLifeDeck(ctx, p) {
    const who = targetOf(ctx, p.target)
    const n = num(p.cards, 3)
    if (p.requireEnough && ctx.s.players[who].discard.length < n) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: not enough cards in the discard pile`)
    // ruling: a modal choice, either the damage or the defender's combat draw comes from the discard pile
    queueChoice(ctx.s, {
      kind: 'OPTION', player: who, source: ctx.source, purpose: 'honorDuel', data: { cards: n },
      prompt: `${ctx.source}: use the bottom ${n} discards for the next combat as`,
      options: [`life card damage (up to ${n})`, `the defender's ${n}-card draw`],
    })
  },

  allyEffect(ctx, p) {
    const { s, db, user } = ctx
    const allies = s.players[user].allies
    switch (p.action) {
      case 'removeFromGame':
        return queueChoice(s, pickRequest(user, user, 'allies', allies.map(a => a.card), num(p.amount, 1), 'REMOVED', ctx.source))
      case 'transferStages':
        return queueChoice(s, pickRequest(user, user, 'allies', allies.map(a => a.card), 1, 'ALLY_TO_MP_STAGES', ctx.source))
      case 'damagePerAlly': {
        const n = allies.length * num(p.lifeCardsPerAlly, 1)
        const foe = targetOf(ctx, p.target)
        const done = n > 0 ? millCards(s, foe, n, ctx.db) : 0
        return log(s, 'MILL', `${ctx.source}: player ${foe + 1} discards ${done} life card(s) (${allies.length} allies)`, foe)
      }
      case 'redirectDamage':
        // the owner chooses which ally takes the damage
        log(s, 'PROTECT', `${ctx.source}: the damage player ${user + 1} would take this combat destroys an ally instead`, user)
        return queueChoice(s, pickRequest(user, user, 'allies', allies.map(a => a.card), 1, 'MARK_ALLY_SHIELD', ctx.source))
      case 'modifyStages': {
        // FS-50, FS-51, FS-97: every ally of the target gains or loses stages
        const who = targetOf(ctx, p.target)
        for (const a of s.players[who].allies) a.stage = Math.max(0, Math.min(s.rules.maxStage, a.stage + num(p.amount, 0)))
        return log(s, 'STAGES', `${ctx.source}: player ${who + 1}'s allies ${num(p.amount, 0) >= 0 ? 'gain' : 'lose'} ${Math.abs(num(p.amount, 0))} power stage(s)`, who)
      }
      case 'toBottomOfLifeDeck': {
        // FS-111: with Black Shadow Drill in play, the opponent's allies go to the bottom of their life deck
        const need = (p.condition as { inPlay?: string } | undefined)?.inPlay
        if (need && !inPlayAnywhere(s, db, { cardName: need })) return
        const who = targetOf(ctx, p.target)
        const gone = s.players[who].allies.map(a => a.card)
        s.players[who].allies = []
        s.players[who].lifeDeck.push(...gone)
        return log(s, 'MOVE', `${ctx.source}: player ${who + 1}'s allies go to the bottom of their life deck`, who)
      }
      case 'plantAlly': {
        if (s.step === 'NON_COMBAT' && s.attacker === user) s.skipCombat.push({ player: user, turn: s.turn, source: ctx.source })
        const turn = s.turn + (s.attacker === user ? 2 : 1)
        s.delayed.push({ player: user, turn, kind: 'plantAlly', character: String(p.character), source: ctx.source })
        return log(s, 'PLANT', `${ctx.source}: ${p.character} will enter play as an ally on player ${user + 1}'s next turn`, user)
      }
      default:
        // a requirement only (checked before the card can be used), then the effect
        return resolveEffects(ctx, then(p))
    }
  },

  preventAttack(ctx, p) {
    const phases = p.duration === 'thisCombat' ? 99 : 1
    // FS-82 "no other physical combat cards" hits everyone; FS-17 protects villains: whoever faces a villain
    let who: PlayerId[] = p.target === 'ALL' ? [0, 1] : [targetOf(ctx, p.target)]
    if (p.protectsAlignment) who = ([0, 1] as PlayerId[]).filter(x => mpDef(ctx.s, ctx.db, other(x)).personality!.alignment === p.protectsAlignment)
    for (const x of who) restrictAttacks(ctx.s, x, (p.attackType ?? 'ANY') as AttackType, phases, ctx.source, !!p.cardsOnly)
  },

  skipPhase(ctx, p) {
    const who = targetOf(ctx, p.target)
    if (p.phase === 'combat') {
      // the next turn of `who` after this one
      const turn = ctx.s.turn + (ctx.s.attacker === who ? 2 : 1)
      ctx.s.skipCombat.push({ player: who, turn, source: ctx.source })
      return log(ctx.s, 'RESTRICT', `${ctx.source}: player ${who + 1} skips the combat step of their next turn`, who)
    }
    restrictAttacks(ctx.s, who, 'ANY', p.phase === 'allRemaining' ? 99 : 1, ctx.source)
  },

  drawFromDiscard(ctx, p) {
    if (p.ongoing && !ctx.triggered) return
    fromDiscard(ctx, p, 'HAND')
  },

  recoverFromDiscard(ctx, p) {
    fromDiscard(ctx, p, p.to === 'top' ? 'LIFE_TOP' : 'LIFE_BOTTOM')
  },

  ifUsedBy(ctx, p) {
    const character = mpDef(ctx.s, ctx.db, ctx.user).personality!.character
    if ((p.characters as string[] | undefined)?.includes(character)) resolveEffects(ctx, then(p))
  },

  ifOpponentAlignment(ctx, p) {
    if (mpDef(ctx.s, ctx.db, other(ctx.user)).personality!.alignment === p.alignment) resolveEffects(ctx, then(p))
    else log(ctx.s, 'NO_EFFECT', `${ctx.source}: the opponent is not a ${p.alignment}, no effect`)
  },

  optional(ctx, p) {
    const effects = then(p)
    const prompt = `${ctx.source}: ${effects.map(e => (e.action === 'DRAW' ? `draw ${e.amount}` : e.action.toLowerCase())).join(', ')}?`
    queueChoice(ctx.s, { kind: 'CONFIRM', player: ctx.user, effects, source: ctx.source, prompt })
  },

  setAnger(ctx, p) {
    const who = targetOf(ctx, p.target)
    changeAnger(ctx.s, ctx.db, who, num(p.value, 0) - ctx.s.players[who].mp.anger)
  },

  setLevel(ctx, p) {
    const who = targetOf(ctx, p.target)
    const mp = ctx.s.players[who].mp
    if (mp.levelIndex + 1 !== p.fromLevel) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: player ${who + 1} is not at level ${p.fromLevel}`)
    mp.levelIndex = num(p.toLevel, 1) - 1
    // Trunks Saga: a dropped personality is set 5 power stages above 0
    if (ctx.s.rules.trunks.levelStages) mp.stage = 5
    log(ctx.s, 'LEVEL_DOWN', `${ctx.source}: player ${who + 1} goes back to level ${p.toLevel}`, who)
  },

  staysForExtraUse(ctx, p) {
    const c = ctx.s.combat
    if (!c || !ctx.card || ctx.card.iid in c.extraUses) return
    c.extraUses[ctx.card.iid] = num(p.uses, 1)
  },

  stealOrCaptureDragonBall(ctx, p) {
    const { s, db, user } = ctx
    const foe = other(user)
    const picks = []
    if (p.searchOwnDeck) {
      const balls = s.players[user].lifeDeck.filter(c => def(db, c).type === 'Dragon Ball')
      picks.push(pickRequest(user, user, 'lifeDeck', balls, 1, 'PICKER_DRAGON_BALLS', ctx.source))
    }
    const n = num(p.captureFromFoe ?? p.amount, p.searchOwnDeck ? 0 : 1)
    const dest = p.destination === 'bottomOfOpponentLifeDeck' ? 'OWNER_LIFE_BOTTOM' : 'PICKER_DRAGON_BALLS'
    if (n > 0 && dragonBallsProtected(s, db, foe)) log(s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1}'s Dragon Balls cannot be captured`)
    else if (n > 0 && !s.players[foe].dragonBalls.length) log(s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1} has no Dragon Balls`)
    else if (n > 0) picks.push(pickRequest(user, foe, 'dragonBalls', s.players[foe].dragonBalls, n, dest, ctx.source))
    queueChoice(s, ...picks)
  },

  damageModifier(ctx, p) {
    const { s, db } = ctx
    if (p.ongoing && !ctx.triggered) return // drills: applied when damage is dealt
    const st = s.combat?.strike
    if (typeof p.multiplier === 'number') {
      // "double the normal damage if successful": deal the extra part on top
      if (!st) return
      const base = computeDamage(s, db, st.initiator, st.strike)
      const extra = { stages: base.stages * (p.multiplier - 1), lifeCards: base.lifeCards * (p.multiplier - 1) }
      log(s, 'DAMAGE_X', `${ctx.source} does ${p.multiplier}x damage`, st.initiator)
      st.lifeCardsDealt += applyDamage(s, other(st.initiator), extra, db)
      return
    }
    if (typeof p.setLifeCards === 'number') {
      // FS-115: more damage while a card of yours is in play
      const need = (p.condition as { inPlay?: string } | undefined)?.inPlay
      const mine = !need || [...s.players[ctx.user].nonCombat, ...s.players[ctx.user].drills].some(c => def(db, c).name === need)
      if (!st || !mine || st.initiator !== ctx.user) return
      st.strike = { ...st.strike, damage: { calculation: 'FLAT', stages: 0, lifeCards: p.setLifeCards, modifierStages: 0, modifierLifeCards: 0 } }
      return log(s, 'DAMAGE_X', `${ctx.source}: ${need} is in play, the attack does ${p.setLifeCards} life cards`, ctx.user)
    }
    if (p.duration === 'thisCombat' && p.maxStages === 0 && p.maxLifeCards === 0 && s.combat) {
      // FS-119: no damage to the user for the rest of combat
      s.combat.damageMods.push({ player: targetOf(ctx, p.target), attackType: 'ANY', stages: -99, lifeCards: -99, source: ctx.source })
      return log(s, 'PROTECT', `${ctx.source}: player ${targetOf(ctx, p.target) + 1} takes no damage for the rest of combat`)
    }
    if (p.duration === 'thisAttack' && p.maxLifeCards === 0 && st && st.initiator === ctx.user) {
      // TS-127: the opponent takes no life cards from this attack
      st.noLifeCards = true
      return
    }
    if (p.maxLifeCards !== undefined || p.maxStages !== undefined) {
      if (st && ctx.user !== st.initiator) st.defense = { mode: 'CAP', stages: 0, lifeCards: 0, maxLifeCards: p.maxLifeCards as number | undefined, maxStages: p.maxStages as number | undefined }
      return
    }
    if (p.duration === 'thisCombat' && typeof p.stagesOrLifeCards === 'number' && s.combat) {
      // TS-22: attacks on the user do N less power stages or N less life cards this combat
      s.combat.damageMods.push({ player: targetOf(ctx, p.target), attackType: (p.attackType ?? 'ANY') as AttackType, stages: 0, lifeCards: 0, either: p.stagesOrLifeCards, source: ctx.source })
      return log(s, 'PROTECT', `${ctx.source}: attacks on player ${targetOf(ctx, p.target) + 1} do less damage this combat`)
    }
    if (p.duration === 'thisCombat' && p.scope === 'OWNER' && s.combat) {
      // TS-132/134: the user's attacks do more damage this combat (TS-132: per Namek Dragon Ball in play)
      const namek = s.players[ctx.user].dragonBalls.filter(c => /Namek/i.test(def(db, c).name)).length
      const stages = typeof p.stagesPerNamekDragonBall === 'number' ? p.stagesPerNamekDragonBall * namek : num(p.stages, 0)
      s.combat.damageMods.push({ player: other(ctx.user), attackType: (p.attackType ?? 'ANY') as AttackType, stages, lifeCards: num(p.lifeCards, 0), source: ctx.source })
      return log(s, 'DAMAGE_X', `${ctx.source}: player ${ctx.user + 1}'s attacks do +${stages} power stage(s) this combat`, ctx.user)
    }
    if (st && st.initiator === ctx.user && !p.scope && (typeof p.stages === 'number' || typeof p.lifeCards === 'number')) {
      // TS-35: this attack does more damage
      const d = st.strike.damage ?? { calculation: 'PAT' as const, stages: 0, lifeCards: 0, modifierStages: 0, modifierLifeCards: 0 }
      st.strike = { ...st.strike, damage: { ...d, modifierStages: d.modifierStages + num(p.stages, 0), modifierLifeCards: d.modifierLifeCards + num(p.lifeCards, 0) } }
      return log(s, 'DAMAGE_X', `${ctx.source}: more damage`, ctx.user)
    }
    if (p.scope === 'HEROES' && s.combat) {
      for (const pid of [0, 1] as PlayerId[]) {
        if (mpDef(s, db, pid).personality!.alignment !== 'Hero') continue
        s.combat.damageMods.push({ player: pid, attackType: 'ANY', stages: 0, lifeCards: num(p.lifeCards, 0), source: ctx.source })
      }
      return log(s, 'PROTECT', `${ctx.source}: heroes lose ${Math.abs(num(p.lifeCards, 0))} life card less per attack this combat`)
    }
    log(s, 'WARN', `${ctx.source}: damage modifier not implemented for these parameters`)
  },

  /** Ongoing drill effects resolve through triggers (see triggers.ts). */
  triggeredEffect(ctx) {
    if (!ctx.triggered) return
  },
}
