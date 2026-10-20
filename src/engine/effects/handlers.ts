// CUSTOM effect handlers for card text the atomic DSL cannot express (see docs/dsl-gaps.md).
import { dragonBallsProtected, drillsProtected, inPlayAnywhere, restrictAttacks, type Params } from '../abilities'
import type { Effect } from '../cards'
import { computeDamage, applyDamage, defaultDamage } from '../damage'
import { onMaxAnger, constantParams, constantEffectsOf, changeAnger, changeStages, def, drawCards, fighterStage, log, millCards, mpDef, powerRating, schedule, win } from '../state'
import { other, type AttackType, type GameState, type PickZone, type PlayerId } from '../types'
import type { CardDB, CardDef } from '../cards'
import { resolveEffects, type CustomHandler, type EffectContext } from '.'
import { pickRequest, queueChoice, zoneCards } from './choices'
import { nextRandom, shuffleInPlace } from '../rng'
import { discardChoices } from '../activeabilities'
import { beginStrike } from '../sequencer'
import { attachCard, discardAttachedOf, lookingForbidden } from '../attach'
import { isNewStyle, registerDamageModifier } from '../damagemods'

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
  if (filter === 'any') return true
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

function discardAttachedHandler(ctx: EffectContext, p: Params) {
  const n = discardAttachedOf(ctx.s, ctx.db, targetOf(ctx, p.target ?? 'SELF'))
  log(ctx.s, n ? 'DISCARD' : 'NO_EFFECT', `${ctx.source}: ${n} attached card(s) discarded`, ctx.user)
}

/** Fix the card being played to a personality; its effects (the given ones, else the nested "effect") then work from there. */
function attachFrom(ctx: EffectContext, p: Params, kind: 'mp', player: PlayerId, effects?: Effect[]) {
  if (!ctx.card) return
  const eff = effects ?? (p.effect ? [p.effect as Effect] : [])
  attachCard(ctx.s, ctx.db, ctx.card, { player, kind }, { until: p.until as string | undefined, effects: eff, removeWhenDone: !!p.removeWhenDone })
}

/** The "may discard / remove any number of cards for +N damage each" cards: where the cards are and what counts. */
const PER_CARD: Record<string, { zone: 'discard' | 'nonCombat'; dest: 'REMOVED' | 'DISCARD'; test: (d: CardDef) => boolean; key: 'flatLifeCards' | 'flatStages'; per: number }> = {
  'BB-112': { zone: 'discard', dest: 'REMOVED', test: d => d.name.includes('Sword'), key: 'flatLifeCards', per: 1 },
  'BU-10': { zone: 'nonCombat', dest: 'DISCARD', test: () => true, key: 'flatLifeCards', per: 3 },
  'BU-162': { zone: 'nonCombat', dest: 'DISCARD', test: () => true, key: 'flatLifeCards', per: 4 },
  'BU-183': { zone: 'discard', dest: 'REMOVED', test: d => /focused/i.test(d.rawText), key: 'flatStages', per: 3 },
}

function unpreventable(ctx: EffectContext, p: Params) {
  const st = ctx.s.combat?.strike
  if (!st || p.duration === 'remainderOfCombat') return
  st.unpreventable = true
  log(ctx.s, 'RESTRICT', `${ctx.source}: this attack's damage cannot be prevented`, ctx.user)
}

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
  grantAttack: noop, // attack-phase grants are offered through USE_ABILITY (activeabilities.ts); TS-70's next-phase option is not offered
  beginGrantedAttack(ctx, p) {
    if (!ctx.s.combat) return
    ctx.s.combat.consecutivePasses = 0
    beginStrike(ctx.s, ctx.db, ctx.user, null, p.strike as never, `${ctx.source}: attack`)
    resolveEffects(ctx, then({ then: p.onUse }))
  },

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

  // Cell Games Saga keywords, explained by the Buu Saga rulebook
  endurance: noop, // read in damage.ts / abilities.ts
  grantEndurance: noop, // read in damage.ts / abilities.ts
  focused: noop, // read in damage.ts / abilities.ts
  focusedAttack: noop, // read in damage.ts / abilities.ts
  temporaryPurModifier: noop, // CG-5, not applied yet
  discardFromHandThen(ctx, p) {
    // "you may discard N cards from your hand to ..." (BU-126, BU-130, BU-131, BU-133); the attack-phase ones are used through USE_ABILITY
    if (p.phase === 'attackerAttacks' && !p.activated) return
    const choices = discardChoices(ctx.s, ctx.db, ctx.user, p)
    const n = num(p.amount, 1)
    if (choices.length < n) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: not enough cards to discard`, ctx.user)
    schedule(ctx.s,
      { k: 'choice', q: pickRequest(ctx.user, ctx.user, 'hand', choices, n, 'DISCARD', ctx.source) },
      { k: 'effects', user: ctx.user, source: ctx.source, card: ctx.card, effects: then(p) })
  },
  discardToStopAttack: noop, // activeabilities.discardDefenses
  inPlaceOfAttackDiscard: noop, // activeabilities.activeAbilities
  grantMajin: noop, // state.canUseCard (attached BB-103)
  allyRestriction: noop, // attach.allyRestricted (BU-76)
  allowAllyLevelBonus: noop, // legal.canPlayNonCombat (BU-56)
  allowUsableBy: noop, // state.canUseCard (Hercule's constant powers)
  ignoreEndurance: noop, // damage.millWithEndurance
  disableEndurance(ctx, p) {
    if (p.ongoing || !ctx.s.combat) return
    ;(ctx.s.combat.noEndurance ??= []).push(targetOf(ctx, p.target))
    log(ctx.s, 'RESTRICT', `${ctx.source}: no Endurance for the rest of this combat`, ctx.user)
  },
  enduranceNoRemoval(ctx) {
    if (!ctx.s.combat) return
    ;(ctx.s.combat.keepEndurance ??= []).push(ctx.user)
    log(ctx.s, 'RESTRICT', `${ctx.source}: Endurance cards stay in the discard pile for the rest of this combat`, ctx.user)
  },
  disableMastery(ctx, p) {
    const who = targetOf(ctx, p.target)
    if (p.duration === 'endOfTurn') {
      ctx.s.noMasteryTurn.push(who)
      return log(ctx.s, 'RESTRICT', `${ctx.source}: player ${who + 1} cannot use their Mastery for the rest of this turn`, ctx.user)
    }
    if (!ctx.s.combat) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: no combat`, ctx.user)
    ;(ctx.s.combat.noMastery ??= []).push(who)
    if (p.alsoDrills) (ctx.s.combat.noDrills ??= []).push(who)
    log(ctx.s, 'RESTRICT', `${ctx.source}: player ${who + 1} cannot use ${p.alsoDrills ? 'Mastery and Drills' : 'Mastery'} this combat`, ctx.user)
  },
  replacePostResolution: noop, // sequencer.retireUsed (BB-9, WG-165)
  placeAllyInsteadOfAttack: noop, // legal.ts (CG-100)
  stopsAlso: noop, // sequencer.defenseFor (BU-5)
  stoppedAsAttackType: noop, // sequencer.defenseFor (BU-34)
  allowAllyControl: noop, // turn.canTakeOver
  modifyPowerUpGain: noop, // turn.endNonCombat
  returnToLifeDeckAfterUse: noop, // sequencer.retireUsed
  removeDamageCardsFromGame: noop, // sequencer.dealDamage
  ifFusedPersonality: noop, // no Fusion yet: never a Fused Personality
  preventionBonus(ctx, p) {
    if (typeof p.multiplier !== 'number') return // BB-45 is read in damagemods
    const st = ctx.s.combat?.strike
    if (st) st.preventMult = p.multiplier
  },
  preventAllyControl(ctx, p) {
    if (!ctx.s.combat) return
    ;(ctx.s.combat.noTakeover ??= []).push(targetOf(ctx, p.target))
    log(ctx.s, 'RESTRICT', `${ctx.source}: no Ally can take control of this combat`, ctx.user)
  },
  increaseEmpower(ctx, p) {
    if (!ctx.s.combat) return
    ctx.s.combat.empowerBonus = ctx.s.combat.empowerBonus ?? [0, 0]
    ctx.s.combat.empowerBonus[ctx.user] += num(p.amount, 1)
    log(ctx.s, 'EMPOWER', `${ctx.source}: your Empower cards have +${num(p.amount, 1)} for the rest of this combat`, ctx.user)
  },
  ifOpponentNoConstantPower(ctx, p) {
    const power = mpDef(ctx.s, ctx.db, other(ctx.user)).personality!.power
    if (!power || !constantEffectsOf(power).length) resolveEffects(ctx, then(p))
  },
  additionalPower: noop, // BU-197..199: read as a second Constant Combat Power (state.constantEffectsOf); BU-200's second attack is not selectable yet
  damageCannotBePrevented: unpreventable,
  damageCannotBeModified: unpreventable,
  discardAttached: discardAttachedHandler, // CG-44
  discardAttachedCards: discardAttachedHandler, // CG-67
  attachToMainPersonality(ctx, p) { attachFrom(ctx, p, 'mp', targetOf(ctx, p.target ?? 'SELF')) },
  attachToOpponentMainPersonality(ctx, p) {
    const upkeep = (Array.isArray(p.upkeep) ? p.upkeep : []) as Effect[]
    attachFrom(ctx, { ...p, effect: undefined, until: p.discardWhen === 'opponentMainPersonalityAtHighestStage' ? 'attachedPersonalityAtHighestStage' : p.until }, 'mp', other(ctx.user), upkeep)
  },
  attachToCard(ctx, p) {
    // own drill/Non-Combat by name, or one of the opponent's cards of a type; the first one that fits
    const who = targetOf(ctx, p.target ?? 'SELF')
    const pl = ctx.s.players[who]
    const types = (p.cardTypes ?? []) as string[]
    const pool = [...pl.drills, ...pl.nonCombat, ...pl.allies.map(a => a.card)]
    const host = pool.find(c => (!p.cardName || def(ctx.db, c).name === p.cardName) && (!types.length || types.includes(def(ctx.db, c).type)) && !ctx.s.attachments.some(a => a.host.iid === c.iid))
    if (!host) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: nothing to attach to`, ctx.user)
    const eff = (p.grants ?? p.effect) as Effect | undefined
    attachCard(ctx.s, ctx.db, ctx.card!, { player: who, kind: 'card', iid: host.iid }, { until: p.until as string | undefined, effects: eff ? [eff] : [] })
  },

  ifOwnStages(ctx, p) {
    const n = fighterStage(ctx.s, ctx.user)
    if (n <= num(p.max, 99) && n >= num(p.min, 0)) resolveEffects(ctx, then(p))
  },

  ifPowerRatingGreater(ctx, p) {
    const mine = powerRating(ctx.s, ctx.db, ctx.user)
    const mineWins = mine > powerRating(ctx.s, ctx.db, other(ctx.user))
    resolveEffects(ctx, mineWins ? then(p) : ((p.otherwise ?? []) as Effect[]))
  },

  ifAnger(ctx, p) {
    if (ctx.s.players[targetOf(ctx, p.target)].mp.anger === num(p.equals, -1)) resolveEffects(ctx, then(p))
  },

  ifMainPersonality(ctx, p) {
    const d = mpDef(ctx.s, ctx.db, ctx.user).personality!
    if (d.character === p.character && (p.level === undefined || d.level === p.level)) resolveEffects(ctx, then(p))
  },

  winGame(ctx, p) {
    win(ctx.s, targetOf(ctx, p.target), 'SURVIVAL')
  },

  discardLifeBoth(ctx, p) {
    // CG-55: "up to 4": the most the own life deck allows (the choice is not asked yet)
    const n = Math.min(num(p.max, 1), Math.max(0, ctx.s.players[ctx.user].lifeDeck.length - 1))
    const mine = millCards(ctx.s, ctx.user, n, ctx.db)
    const theirs = millCards(ctx.s, other(ctx.user), mine, ctx.db)
    log(ctx.s, 'MILL', `${ctx.source}: both players discard ${mine} / ${theirs} life card(s)`)
  },

  modifyStagesByAlignment(ctx, p) {
    // CG-56: every hero (main personalities and allies) loses stages
    const { s, db } = ctx
    for (const pl of s.players) {
      if (mpDef(s, db, pl.id).personality!.alignment !== p.alignment) continue
      changeStages(s, pl.id, num(p.amount, 0))
      if (p.includeAllies) for (const a of pl.allies) a.stage = Math.max(0, a.stage + num(p.amount, 0))
      log(s, 'STAGES', `${ctx.source}: player ${pl.id + 1}'s ${String(p.alignment)} personalities lose ${Math.abs(num(p.amount, 0))} power stage(s)`, pl.id)
    }
  },

  modifyCombatDraw: noop,
  loseGameAtAnger: noop, // state.ts changeAnger (CG-99)
  costModifier: noop, // abilities.costFor (BB-35)

  removeFromDiscardThen(ctx, p) {
    // BB-85: "remove 4 Uncommons in your discard pile": a rarity / style filter and an amount
    if (!p.cardName) {
      const pl = ctx.s.players[ctx.user]
      const hits = pl.discard.filter(c => (!p.rarity || def(ctx.db, c).rarity === p.rarity) && (!p.style || def(ctx.db, c).style === p.style))
      const n = num(p.amount, 1)
      if (hits.length < n) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: not enough matching cards in the discard pile`, ctx.user)
      const gone = hits.slice(-n)
      pl.discard = pl.discard.filter(c => !gone.includes(c))
      pl.removed.push(...gone)
      log(ctx.s, 'REMOVE', `${ctx.source}: ${n} card(s) are removed from the game`, ctx.user)
      return resolveEffects(ctx, then(p))
    }
    // "You may remove <card> in your discard pile from the game. If you do, ..." (always taken: it is a benefit)
    const pile = ctx.s.players[ctx.user].discard
    const i = pile.findIndex(c => def(ctx.db, c).name === p.cardName)
    if (i < 0) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: no ${String(p.cardName)} in the discard pile`)
    ctx.s.players[ctx.user].removed.push(...pile.splice(i, 1))
    log(ctx.s, 'REMOVE', `${ctx.source}: ${String(p.cardName)} is removed from the game`, ctx.user)
    resolveEffects(ctx, then(p))
  },

  loseGameAtPhase(ctx) {
    // BU-111: the user loses at the start of the opponent's next turn
    ctx.s.loseAt.push({ player: ctx.user, turn: ctx.s.turn + (ctx.s.attacker === ctx.user ? 1 : 0) })
    log(ctx.s, 'RESTRICT', `${ctx.source}: player ${ctx.user + 1} loses the game in the opponent's next Attacker Attacks phase`, ctx.user)
  },
  ifAttacksPerformedThisCombat(ctx, p) {
    // BU-160: earlier attacks of this combat by the user in the given style
    const done = (ctx.s.combat?.attackStyles ?? []).filter(a => a.player === ctx.user && (!p.style || a.style === p.style)).length
    if (done >= num(p.atLeast, 1)) resolveEffects(ctx, then(p))
  },
  replaceCostWithLifeCard(ctx) {
    if (ctx.s.combat) (ctx.s.combat.lifeForCost ??= []).push(ctx.user)
    log(ctx.s, 'RESTRICT', `${ctx.source}: energy attack costs are paid with a life card for the rest of this combat`, ctx.user)
  },
  revealHandOnce(ctx, p) {
    const who = targetOf(ctx, p.target)
    log(ctx.s, 'REVEAL', `${ctx.source}: player ${who + 1} shows their hand: ${ctx.s.players[who].hand.map(c => def(ctx.db, c).name).join(', ')}`, who)
  },
  forceAttackOrPass: noop, // "must perform an attack or pass": the legal actions of a combat phase already are attacks or passing
  rejuvenationOverride: noop, // turn.rejuvenate (BU-78)
  powerRatingBonus: noop, // state.powerRating (BU-103)
  placeInPlayIfDiscardedFromHand: noop, // choices.movePicked / turn.discardFromHand (WG-57)
  preventEndCombat(ctx) {
    ctx.s.combatCannotEnd = true
    log(ctx.s, 'RESTRICT', `${ctx.source}: card powers cannot end combat for the rest of the game`, ctx.user)
  },
  advancePersonalityLevel(ctx) {
    if (!ctx.s.requirementMet) return
    ctx.s.requirementMet = true
    onMaxAnger(ctx.s, ctx.db, ctx.user)
  },
  payLifeCardsForStages(ctx) {
    if (ctx.s.combat) (ctx.s.combat.lifeForStages ??= []).push(ctx.user)
    log(ctx.s, 'RESTRICT', `${ctx.source}: power stage costs may be paid with life cards for the rest of this combat`, ctx.user)
  },
  repeatOnHitEffects: noop, // sequencer.finishSuccessful (BU-180)
  shuffleUsedCardsIntoLifeDeck(ctx) {
    if (ctx.s.combat) (ctx.s.combat.shuffleUsed ??= []).push(ctx.user)
    log(ctx.s, 'RESTRICT', `${ctx.source}: Styled non-Drill cards are shuffled into the life deck after use this combat`, ctx.user)
  },
  protectDiscardPile: noop, // removeFromGame / removeFromDiscardThen (WG-197)
  ifRemovedCardMatchesMainPersonality(ctx, p) {
    const iid = ctx.s.lastRemoved
    const card = iid ? ctx.s.players[ctx.user].removed.find(c => c.iid === iid) : undefined
    if (card && (!p.named || def(ctx.db, card).named === mpDef(ctx.s, ctx.db, ctx.user).personality!.character)) resolveEffects(ctx, then(p))
  },
  ifMoreCardsInDiscard(ctx, p) {
    const foe = targetOf(ctx, p.than ?? 'OPPONENT')
    if (ctx.s.players[ctx.user].discard.length > ctx.s.players[foe].discard.length) resolveEffects(ctx, then(p))
  },

  ifTopDiscardCard(ctx, p) {
    const pile = ctx.s.players[targetOf(ctx, p.target)].discard
    const top = pile[pile.length - 1]
    if (top && (!p.named || def(ctx.db, top).named === p.named)) resolveEffects(ctx, then(p))
  },

  switchStages(ctx) {
    const [a, b] = [fighterStage(ctx.s, 0), fighterStage(ctx.s, 1)]
    changeStages(ctx.s, 0, b - a)
    changeStages(ctx.s, 1, a - b)
    log(ctx.s, 'STAGES', `${ctx.source}: the main personalities swap their power stages (${a} and ${b})`)
  },

  modifyStagesPerCardInPile(ctx, p) {
    const who = targetOf(ctx, p.target)
    const n = ctx.s.players[who].discard.length * num(p.amountPerCard, 1)
    if (n) changeStages(ctx.s, who, n)
    log(ctx.s, 'STAGES', `${ctx.source}: player ${who + 1} gains ${n} power stage(s) for the cards in the discard pile`, who)
  },

  discardTopLifeCardThen(ctx, p) {
    // WG-186: discard the top card; a matching card may go to the hand
    const pl = ctx.s.players[targetOf(ctx, p.target)]
    if (millCards(ctx.s, targetOf(ctx, p.target), num(p.amount, 1), ctx.db) && p.then === 'hand') {
      const top = pl.discard[pl.discard.length - 1]
      if (top && (!p.filter || def(ctx.db, top).type === p.filter)) pl.hand.push(pl.discard.pop()!)
    }
  },

  removeTopLifeCardThen(ctx, p) {
    // WG-200: remove the opponent's top life card; a matching type triggers the effects
    const foe = targetOf(ctx, p.target)
    const card = ctx.s.players[foe].lifeDeck[0]
    if (!card || def(ctx.db, card).type === 'Dragon Ball') return log(ctx.s, 'NO_EFFECT', `${ctx.source}: nothing to remove`)
    ctx.s.players[foe].removed.push(ctx.s.players[foe].lifeDeck.shift()!)
    log(ctx.s, 'REMOVE', `${ctx.source}: ${def(ctx.db, card).name} is removed from the game`, foe)
    if (!p.filter || def(ctx.db, card).type === p.filter) resolveEffects(ctx, then(p))
  },

  lookAtHand(ctx, p) {
    if (lookingForbidden(ctx.s, targetOf(ctx, p.target), 'hand')) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: an attached card forbids looking at that hand`, ctx.user)
    log(ctx.s, 'LOOK', `${ctx.source}: player ${ctx.user + 1} looks at player ${targetOf(ctx, p.target) + 1}'s hand`, ctx.user)
  },

  lookAtTopCards(ctx, p) {
    // only the order-preserving look (BU-25); the "keep one, remove the rest" variants are not implemented
    if (p.keep) return log(ctx.s, 'WARN', `${ctx.source}: custom effect "lookAtTopCards" with keep is not implemented yet`)
    log(ctx.s, 'LOOK', `${ctx.source}: player ${ctx.user + 1} looks at the top ${num(p.amount, 1)} card(s) of a life deck`, ctx.user)
  },

  empower(ctx, p) {
    // Buu Saga rulebook p. 53: +N life cards of damage, in exchange for the text that follows the Empower
    p = { ...p, amount: num(p.amount, 1) + (ctx.s.combat?.empowerBonus?.[ctx.user] ?? 0) }
    queueChoice(ctx.s, {
      kind: 'OPTION', player: ctx.user, source: ctx.source, purpose: 'empower',
      prompt: `${ctx.source}: Empower ${num(p.amount, 1)}?`,
      options: ['Normal attack (keep the text after Empower)', `Empower ${num(p.amount, 1)}: +${num(p.amount, 1)} life cards, drop that text`],
      data: { amount: num(p.amount, 1), dropped: JSON.stringify(p.dropped ?? {}) },
    })
  },

  grantOnHitEffect(ctx, p) {
    ctx.s.combat?.grants.push({ player: ctx.user, kind: 'onHit', condition: p.condition, effects: (p.effect ?? []) as Effect[] })
  },

  grantFocused(ctx, p) {
    ctx.s.combat?.grants.push({ player: ctx.user, kind: 'focused', condition: p.condition, effects: [] })
  },

  shuffleSelfIntoLifeDeck(ctx) {
    if (ctx.card) ctx.s.retireTo[ctx.card.iid] = 'LIFE_SHUFFLE'
  },

  placeSelfInLifeDeck(ctx, p) {
    if (ctx.card) ctx.s.retireTo[ctx.card.iid] = p.position === 'top' ? 'LIFE_SHUFFLE' : 'LIFE_BOTTOM'
  },

  ifHandStyleCount(ctx, p) {
    const n = ctx.s.players[ctx.user].hand.filter(c => def(ctx.db, c).style === p.style).length
    if (n >= num(p.atLeast, 1)) resolveEffects(ctx, then(p))
  },

  ifUserNameContains(ctx, p) {
    const name = mpDef(ctx.s, ctx.db, ctx.user).name
    if (((p.texts ?? []) as string[]).some(t => name.includes(t))) resolveEffects(ctx, then(p))
  },

  drawFromLifeDeck(ctx, p) {
    const pl = ctx.s.players[ctx.user]
    for (let i = 0; i < num(p.amount, 1) && pl.lifeDeck.length > 1; i++) {
      const c = p.from === 'bottom' ? pl.lifeDeck.pop()! : pl.lifeDeck.shift()!
      pl.hand.push(c)
    }
    log(ctx.s, 'DRAW', `${ctx.source}: player ${ctx.user + 1} takes ${num(p.amount, 1)} card(s) from the ${p.from === 'bottom' ? 'bottom' : 'top'} of the life deck`, ctx.user)
  },

  modifyStagesChosen(ctx, p) {
    // "all": every personality of the target; a single choice is not asked yet (the main personality loses them)
    const who = targetOf(ctx, p.target)
    changeStages(ctx.s, who, num(p.amount, 0))
    if (p.all || p.includeAllies) for (const a of ctx.s.players[who].allies) a.stage = Math.max(0, a.stage + num(p.amount, 0))
    log(ctx.s, 'STAGES', `${ctx.source}: player ${who + 1}'s personalities lose ${Math.abs(num(p.amount, 0))} power stage(s)`, who)
  },
  // World Games Saga
  senseiDeck: noop, // deck-building keyword: the Sensei Deck itself is not modelled, the card works as a normal card in the life deck
  canStopFocused: noop, // abilities.canStopFocused
  stopFocusedAttack: noop,
  stopsFocusedOnly: noop,
  defenseRestriction: noop,

  ifInDiscardPile(ctx, p) {
    const pile = ctx.s.players[targetOf(ctx, p.target)].discard
    if (pile.some(c => def(ctx.db, c).name === p.cardName)) resolveEffects(ctx, then(p))
  },

  ifOpponentTokuiWaza(ctx, p) {
    // "If your opponent declared a <style> Tokui-Waza"
    const t = ctx.s.players[other(ctx.user)].tokuiWaza
    if (t && (!p.style || t === p.style)) resolveEffects(ctx, then(p))
  },

  modifyAngerPerDragonBall(ctx, p) {
    const who = targetOf(ctx, p.target)
    const n = ctx.s.players[targetOf(ctx, p.owner ?? p.target)].dragonBalls.length * num(p.perDragonBall, 1)
    if (n) changeAnger(ctx.s, ctx.db, who, n)
  },
 // turn.ts defenderDraw (CS-176)

  ifOpponentNameContains(ctx, p) {
    if (mpDef(ctx.s, ctx.db, other(ctx.user)).name.includes(String(p.text))) resolveEffects(ctx, then(p))
  },

  ifOpponentMoreStages(ctx, p) {
    if (fighterStage(ctx.s, other(ctx.user)) > fighterStage(ctx.s, ctx.user)) resolveEffects(ctx, then(p))
  },

  ifTopDiscardNotAttack(ctx, p) {
    // CS-143: the top card of the target's discard pile is not a physical attack
    const pile = ctx.s.players[targetOf(ctx, p.target)].discard
    const top = pile[pile.length - 1]
    if (!top || def(ctx.db, top).combatRole !== 'ATTACK_PHYSICAL') resolveEffects(ctx, then(p))
  },

  discardHand(ctx, p) {
    const who = targetOf(ctx, p.target)
    const pl = ctx.s.players[who]
    log(ctx.s, 'DISCARD', `${ctx.source}: player ${who + 1} discards their hand (${pl.hand.length})`, who)
    pl.discard.push(...pl.hand.splice(0))
  },

  setStages(ctx, p) {
    // CS-121, CS-128: every personality (main and allies) of the target goes to a fixed number of stages
    const { s, db } = ctx
    const players = p.target === 'ANY' ? s.players.map(x => x.id) : [targetOf(ctx, p.target)]
    for (const who of players) {
      if (p.titleContains && !mpDef(s, db, who).name.includes(String(p.titleContains))) continue
      changeStages(s, who, num(p.value, 0) - s.players[who].mp.stage)
      if (p.allPersonalities) for (const a of s.players[who].allies) if (!p.titleContains || def(db, a.card).name.includes(String(p.titleContains))) a.stage = num(p.value, 0)
      log(s, 'STAGES', `${ctx.source}: player ${who + 1}'s personalities are set to ${num(p.value, 0)} power stage(s)`, who)
    }
  },

  loseGameIfOpponentSurvives(ctx) {
    // CS-P11: runs after the damage
    if (ctx.s.winner === null) win(ctx.s, other(ctx.user), 'SURVIVAL')
  },

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

  convertStagesToLifeCards(ctx) {
    // BB-19: optional, when the attack is performed
    const st = ctx.s.combat?.strike
    if (!st) return
    queueChoice(ctx.s, { kind: 'CONFIRM', player: ctx.user, source: ctx.source, prompt: `${ctx.source}: turn the power stages of damage into life cards?`, effects: [{ action: 'CUSTOM', handler: 'setConvertStages' }] })
  },
  setConvertStages(ctx) {
    const st = ctx.s.combat?.strike
    if (st) st.convertStages = true
  },
  ignoreCardUseRestrictions(ctx) {
    if (ctx.s.combat) (ctx.s.combat.ignoreRestrictions ??= []).push(ctx.user)
    log(ctx.s, 'PROTECT', `${ctx.source}: the opponent's restrictions on using your cards are ignored this combat`, ctx.user)
  },
  protectLifeDeck(ctx) {
    if (ctx.s.combat) (ctx.s.combat.protectLife ??= []).push(ctx.user)
    log(ctx.s, 'PROTECT', `${ctx.source}: no life cards are discarded by the opponent's card effects this combat (damage still counts)`, ctx.user)
  },
  replaceFinalPhysicalAttack(ctx) {
    if (ctx.s.combat) (ctx.s.combat.freeFinal ??= []).push(ctx.user)
    log(ctx.s, 'RESTRICT', `${ctx.source}: a discarded card makes a physical attack without passing, for this combat`, ctx.user)
  },
  stagesAtAttackPhaseStart(ctx, p) {
    ctx.s.combat?.phaseStages?.push({ player: ctx.user, amount: num(p.amount, 2) })
    if (ctx.s.combat && !ctx.s.combat.phaseStages) ctx.s.combat.phaseStages = [{ player: ctx.user, amount: num(p.amount, 2) }]
  },
  dynamicPur: noop, // BB-70: the X it defines is not used by the text
  preventSurvivalVictory: noop, // state.win (BB-100)
  opponentSplitsDiscard(ctx, p) {
    // WG-187 / BU-179: choose cards in your discard pile; the opponent picks which one goes where
    const pile = ctx.s.players[ctx.user].discard
    const n = Math.min(num(p.choose, 2), pile.length)
    if (n < 1) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: the discard pile is empty`, ctx.user)
    const chosenTo = p.opponentChoosesKept ? 'hand' : 'removed'
    // scheduled first so that it runs after the owner's pick
    schedule(ctx.s, { k: 'effects', user: ctx.user, source: ctx.source, card: ctx.card, effects: [{ action: 'CUSTOM', handler: 'askOpponentSplit', params: { chosenTo } }] })
    queueChoice(ctx.s, pickRequest(ctx.user, ctx.user, 'discard', [...pile], n, 'SPLIT_POOL', ctx.source))
  },
  askOpponentSplit(ctx, p) {
    const pool = ctx.s.splitPool
    if (!pool.length) return
    queueChoice(ctx.s, { kind: 'OPTION', player: other(ctx.user), source: ctx.source, prompt: `${ctx.source}: choose one of these cards (${p.chosenTo === 'hand' ? 'it goes into the hand, the rest leave the game' : 'it leaves the game, the rest go into the hand'})`,
      options: pool.map(c => def(ctx.db, c).name), purpose: 'splitDiscard', data: { owner: ctx.user, chosenTo: String(p.chosenTo) } })
  },
  allyCountModifier: noop, // damagemods (BU-37)
  unlessOpponentPays(ctx, p) {
    // BU-129: the opponent's Main Personality may pay power stages to stop the effect
    const foe = other(ctx.user)
    const n = num(p.stages, 1)
    if (ctx.s.players[foe].mp.stage < n) return resolveEffects(ctx, then(p))
    queueChoice(ctx.s, { kind: 'OPTION', player: foe, source: ctx.source, prompt: `${ctx.source}: pay ${n} power stage(s) to stop the effect?`, options: [`Pay ${n} stage(s)`, 'Let it happen'],
      purpose: 'unlessPays', data: { kind: 'stages', n, user: ctx.user, effects: JSON.stringify(then(p)) } })
  },

  unlessOpponentDiscards(ctx, p) {
    // BB-50: the opponent may discard a card from his hand to stop the "otherwise" effect
    const foe = other(ctx.user)
    const n = num(p.amount, 1)
    const otherwise = (p.otherwise ?? []) as Effect[]
    if (ctx.s.players[foe].hand.length < n) return resolveEffects(ctx, otherwise)
    queueChoice(ctx.s, { kind: 'OPTION', player: foe, source: ctx.source, prompt: `${ctx.source}: discard ${n} card(s) from your hand?`, options: [`Discard ${n} card(s)`, 'Do not discard'],
      purpose: 'unlessPays', data: { kind: 'discard', n, user: ctx.user, effects: JSON.stringify(otherwise) } })
  },

  rearrangeDiscard(ctx, p) {
    const n = num(p.count, 10)
    if (ctx.s.players[ctx.user].discard.length < 2) return
    queueChoice(ctx.s, { kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: `${ctx.source}: rearrange the top or bottom ${n} cards of your discard pile (pick them in the order wanted, the last picked ends up on top / at the bottom)?`,
      options: [`Top ${n}`, `Bottom ${n}`, 'Leave it'], purpose: 'rearrange', data: { count: n } })
  },

  removeAndShuffleFromDiscard(ctx, p) {
    // CG-65: of up to 4 chosen cards, 2 leave the game and the rest are shuffled into the Life Deck (the same as choosing the 2 to remove, then the 2 to shuffle)
    const pile = ctx.s.players[ctx.user].discard
    const rm = Math.min(num(p.remove, 2), pile.length)
    if (!rm) return
    const shuffle = Math.min(num(p.choose, 4) - rm, pile.length - rm)
    // scheduled first so that it runs after the removal pick
    if (shuffle > 0) schedule(ctx.s, { k: 'effects', user: ctx.user, source: ctx.source, card: ctx.card, effects: [{ action: 'CUSTOM', handler: 'pickToShuffleFromDiscard', params: { amount: shuffle } }] })
    queueChoice(ctx.s, pickRequest(ctx.user, ctx.user, 'discard', [...pile], rm, 'REMOVED', ctx.source))
  },

  pickToShuffleFromDiscard(ctx, p) {
    const pile = ctx.s.players[ctx.user].discard
    if (!pile.length) return
    queueChoice(ctx.s, pickRequest(ctx.user, ctx.user, 'discard', [...pile], Math.min(num(p.amount, 2), pile.length), 'LIFE_SHUFFLE', ctx.source))
  },

  revealTopChooseOne(ctx, p) {
    // BB-43: the top cards are shown; the opponent (the owner at personality level 3+) chooses one for the owner's hand; the rest stay on top
    const { s } = ctx
    const owner = ctx.user
    const top = s.players[owner].lifeDeck.slice(0, num(p.amount, 3))
    if (!top.length) return log(s, 'NO_EFFECT', `${ctx.source}: empty life deck`, owner)
    const alt = p.chooserIf as { mainPersonalityLevelAtLeast?: number } | undefined
    const chooser = alt && s.players[owner].mp.levelIndex + 1 >= Number(alt.mainPersonalityLevelAtLeast ?? 99) ? owner : other(owner)
    log(s, 'REVEAL', `${ctx.source}: ${top.map(c => def(ctx.db, c).name).join(', ')}`, owner)
    queueChoice(s, pickRequest(chooser, owner, 'lifeDeck', top, 1, 'OWNER_HAND', ctx.source))
  },

  compareTopCards(ctx) {
    // BB-79: the higher numbered card goes to its owner's hand; the other player (both on a tie) shuffles the card back
    const { s, db } = ctx
    const tops = s.players.map(pl => pl.lifeDeck[0])
    if (tops.some(c => !c)) return log(s, 'NO_EFFECT', `${ctx.source}: a life deck is empty`)
    const [a, b] = tops.map(c => def(db, c).number)
    log(s, 'REVEAL', `${ctx.source}: ${def(db, tops[0]).name} (${a}) against ${def(db, tops[1]).name} (${b})`)
    const winner = a === b ? null : a > b ? 0 : 1
    if (winner !== null) {
      s.players[winner].hand.push(s.players[winner].lifeDeck.shift()!)
      log(s, 'MOVE', `Player ${winner + 1} takes the card into hand`, winner)
    }
    for (const pl of s.players) if (winner === null || pl.id !== winner) s.rngSeed = shuffleInPlace(pl.lifeDeck, s.rngSeed)
  },

  revealCompare(ctx, p) {
    // BB-P3: the player with fewer cards of the type among their top cards discards the top cards of their life deck
    const { s, db } = ctx
    const counts = s.players.map(pl => pl.lifeDeck.slice(0, num(p.amount, 3)).filter(c => def(db, c).type === p.countCardType).length)
    log(s, 'REVEAL', `${ctx.source}: ${p.countCardType} cards in the top cards: ${counts[0]} against ${counts[1]}`)
    if (counts[0] === counts[1]) return log(s, 'NO_EFFECT', `${ctx.source}: a tie, no one discards`)
    const loser: PlayerId = counts[0] < counts[1] ? 0 : 1
    millCards(s, loser, num(p.loserDiscardsLifeCards, 4), db)
  },

  revealForDamage(ctx, p) {
    // BB-116: count the Red Style cards in the top cards of the discard pile or life deck (the better pile is picked) as extra life cards
    const { s, db } = ctx
    const st = s.combat?.strike
    const pl = s.players[ctx.user]
    const foeAnger = s.players[other(ctx.user)].mp.anger
    const rule = (p.byOpponentAnger as { zero: { piles: string[]; amount: number }; nonZero: { piles: string[]; amount: number } })[foeAnger === 0 ? 'zero' : 'nonZero']
    const count = (pile: string) => (pile === 'discard' ? pl.discard.slice(-rule.amount) : pl.lifeDeck.slice(0, rule.amount)).filter(c => def(db, c).style === p.countStyle).length
    const n = Math.max(...rule.piles.map(count))
    log(s, 'REVEAL', `${ctx.source}: ${n} ${p.countStyle} Style card(s) found`, ctx.user)
    if (!st || !n) return
    const d = st.strike.damage ?? defaultDamage(st.strike, s.rules)
    st.strike = { ...st.strike, damage: { ...d, modifierLifeCards: d.modifierLifeCards + n * num(p.lifeCardsPerMatch, 1) } }
  },

  discardHandForDamage(ctx, p) {
    const hand = ctx.s.players[ctx.user].hand.length
    if (!hand) return
    queueChoice(ctx.s, { kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: `${ctx.source}: discard how many cards? (+${num(p.lifeCardsPerCard, 3)} life cards each)`,
      options: Array.from({ length: hand + 1 }, (_, i) => `${i} card${i === 1 ? '' : 's'}`), purpose: 'discardForDamage', data: { per: num(p.lifeCardsPerCard, 3) } })
  },

  revealCardsForBonus(ctx, p) {
    const hand = ctx.s.players[ctx.user].hand.filter(c => def(ctx.db, c).combatRole === 'ATTACK_PHYSICAL').length
    if (!hand) return
    queueChoice(ctx.s, { kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: `${ctx.source}: reveal how many physical attack cards?`,
      options: Array.from({ length: hand + 1 }, (_, i) => `${i} card${i === 1 ? '' : 's'}`), purpose: 'revealBonus', data: { per: num(p.stagesPerCard, 3) } })
  },

  setAsideOpponentHandCard(ctx) {
    // BU-83: look at the opponent's hand, set one card aside until the end of this combat
    const foe = other(ctx.user)
    const hand = ctx.s.players[foe].hand
    if (!hand.length) return log(ctx.s, 'NO_EFFECT', `${ctx.source}: the hand is empty`)
    queueChoice(ctx.s, pickRequest(ctx.user, foe, 'hand', hand, 1, 'SET_ASIDE', ctx.source))
  },

  nameCardsRemoveFromLifeDeck(ctx, p) {
    // BU-89: name a card, all copies leave the opponent's Life Deck (BB-5 / WG-160 need the Sensei Deck and use the same choice)
    const physical = p.namedCardFilter === 'canPerformPhysicalAttack'
    const names = [...new Set(Object.values(ctx.db)
      .filter(d => d.type !== 'Dragon Ball' && !d.id.startsWith('TEST') && (!physical || d.combatRole === 'ATTACK_PHYSICAL')).map(d => d.name))].sort()
    queueChoice(ctx.s, { kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: physical ? 'Name a card that can perform a physical attack' : 'Name a non-Dragon Ball card', options: names, purpose: 'nameCardDiscard', data: { all: p.allCopies ? 1 : 0, to: String(p.to ?? 'removed') } })
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

  skipFightBack(ctx, p) {
    // CG-77: no Fight Back phase, the same player gets another "Attacker Attacks" phase (an attack of that type, or pass)
    const c = ctx.s.combat
    if (!c) return
    c.bonusAttack = { player: ctx.user, attackType: (p.requireAttackType ?? 'ANY') as AttackType, remaining: 1, active: false }
    log(ctx.s, 'EXTRA_ATTACK', `${ctx.source}: the Fight Back phase is skipped`, ctx.user)
  },

  removeFromGame(ctx, p) {
    const { s, db, user } = ctx
    // BU-156: "remove 7 Saiyan Style cards in your discard pile from the game": all or nothing, and the effects after it need it
    if (p.requirement && (p.filter as { style?: string } | undefined)?.style) {
      const pl = s.players[user]
      const hits = pl.discard.filter(c => def(db, c).style === (p.filter as { style: string }).style)
      const n = num(p.amount, 1)
      s.requirementMet = hits.length >= n
      if (!s.requirementMet) return log(s, 'NO_EFFECT', `${ctx.source}: only ${hits.length} of ${n} cards in the discard pile`, user)
      const gone = hits.slice(-n)
      pl.discard = pl.discard.filter(c => !gone.includes(c))
      pl.removed.push(...gone)
      return log(s, 'REMOVE', `${ctx.source}: ${n} cards are removed from the game`, user)
    }
    if (p.zone === 'discard' || p.zone === 'lifeDeck') {
      // FS-14: top 3 of the opponent's discard pile; FS-21: top card of your own life deck
      const who = targetOf(ctx, p.target)
      if (p.zone === 'discard' && constantParams(s, db, who, 'protectDiscardPile').length) return log(s, 'PROTECT', `${ctx.source}: the discard pile cannot be removed from the game`, who)
      const pile = s.players[who][p.zone]
      const n = Math.min(num(p.amount, 1), pile.length)
      const gone = p.zone === 'discard' ? pile.splice(pile.length - n, n) : pile.splice(0, n)
      s.players[who].removed.push(...gone)
      if (p.remember && gone.length) s.lastRemoved = gone[gone.length - 1].iid
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
    if (p.target === 'ALL') return ([ctx.user, other(ctx.user)] as PlayerId[]).forEach(u => handlers.searchDeck({ ...ctx, user: u }, { ...p, target: 'SELF' }))
    const { s, db, user } = ctx
    const owner = p.target === 'OPPONENT' ? other(user) : user
    const VALID = ['discard', 'dragonBalls', 'lifeDeck', 'hand', 'drills', 'allies', 'nonCombat']
    const zones = (Array.isArray(p.from) ? p.from : [p.from ?? 'lifeDeck']).filter(z => VALID.includes(String(z))) as PickZone[]
    if (!zones.length) return log(s, 'NO_EFFECT', `${ctx.source}: search zone ${String(p.from)} is not supported yet`)
    const level = s.players[user].mp.levelIndex + 1
    const cards = zones.flatMap(z => zoneCards(s, owner, z)).filter(c => matchesFilter(s, db, user, def(db, c), String(p.filter ?? '')))
      .filter(c => !p.matchNumberToLevel || def(db, c).dragonBallNumber === level)
    if (!cards.length) return log(s, 'NO_EFFECT', `${ctx.source}: no ${p.filter} found`)
    if (p.which === 'first') {
      // the first one from the top, no choice (SS-240)
      return queueChoice(s, pickRequest(user, owner, zones, [cards[0]], 1, p.to === 'bottomOfLifeDeck' ? 'OWNER_LIFE_BOTTOM' : 'HAND', ctx.source))
    }
    const allyStage = p.setPowerStage === 'MAX' ? s.rules.maxStage : undefined
    queueChoice(s, pickRequest(user, owner, zones, cards, Math.min(num(p.amount, 1), cards.length), p.to === 'play' ? 'PLAY' : 'HAND', ctx.source, { allyStage }))
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
    const per = PER_CARD[ctx.card?.defId ?? mpDef(s, db, ctx.user).id]
    if (per && !p.ongoing) {
      const pool = (per.zone === 'discard' ? s.players[ctx.user].discard : s.players[ctx.user].nonCombat).filter(c => per.test(def(db, c)))
      if (!pool.length) return log(s, 'NO_EFFECT', `${ctx.source}: no cards to ${per.dest === 'REMOVED' ? 'remove' : 'discard'}`, ctx.user)
      const base = { scope: p.scope, attackType: p.attackType, duration: p.duration, excludeUnstoppableOrFocused: p.excludeUnstoppableOrFocused }
      return queueChoice(s, { kind: 'OPTION', player: ctx.user, source: ctx.source, prompt: `${ctx.source}: how many cards do you ${per.dest === 'REMOVED' ? 'remove from the game' : 'discard'}?`,
        options: Array.from({ length: pool.length + 1 }, (_, i) => `${i} card${i === 1 ? '' : 's'}`), purpose: 'perCardBonus',
        data: { base: JSON.stringify(base), key: per.key, per: per.per, zone: per.zone, dest: per.dest, eligible: JSON.stringify(pool.map(c => c.iid)) } })
    }
    if (p.doubleDrillModifiers) {
      const st = s.combat?.strike
      if (st) st.doubleDrills = true
      return log(s, 'DAMAGE_X', `${ctx.source}: damage modifiers from drills count twice for this attack`, ctx.user)
    }
    if (p.duration === 'game') {
      // CS-79: "until the end of the game, all of your successful attacks do +1 power stage of damage"
      const m = { ...p, flatStages: num(p.stages, 0), flatLifeCards: num(p.lifeCards, 0), stages: undefined, lifeCards: undefined }
      s.gameMods.push({ m, owner: ctx.user, source: ctx.source })
      return log(s, 'DAMAGE_X', `${ctx.source}: this lasts for the rest of the game`, ctx.user)
    }
    if (isNewStyle(p)) {
      // damagemods.ts: stored for this attack or for the combat, applied when the damage is dealt
      if (!p.ongoing) registerDamageModifier(s, ctx.user, ctx.source, p)
      return
    }
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
