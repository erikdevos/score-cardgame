// CUSTOM effect handlers for card text the atomic DSL cannot express (see docs/dsl-gaps.md).
import { dragonBallsProtected, drillsProtected, inPlayAnywhere, restrictAttacks, type Params } from '../abilities'
import type { Effect } from '../cards'
import { computeDamage, applyDamage } from '../damage'
import { changeAnger, changeStages, def, log, millCards, mpDef } from '../state'
import { other, type AttackType, type GameState, type PickZone, type PlayerId } from '../types'
import type { CardDB, CardDef } from '../cards'
import { resolveEffects, type CustomHandler, type EffectContext } from '.'
import { pickRequest, queueChoice, zoneCards } from './choices'
import { nextRandom } from '../rng'

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
  if (filter === 'Ally') {
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

  ifInPlay(ctx, p) {
    if (inPlayAnywhere(ctx.s, ctx.db, p)) resolveEffects(ctx, then(p))
    else log(ctx.s, 'NO_EFFECT', `${ctx.source}: ${String(p.cardName ?? p.character)} is not in play, no extra effect`)
  },

  conditionalDamage(ctx, p) {
    const st = ctx.s.combat?.strike
    if (!st || (p.condition === 'characterInPlay' && !inPlayAnywhere(ctx.s, ctx.db, { character: p.character }))) return
    const d = { stages: num(p.stages, 0), lifeCards: num(p.lifeCards, 0) }
    log(ctx.s, 'DAMAGE', `${ctx.source}: ${String(p.character)} is in play, extra damage`, st.initiator)
    st.lifeCardsDealt += applyDamage(ctx.s, other(st.initiator), d)
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

  sweepCards(ctx) {
    const { s, db, user } = ctx
    const foe = other(user)
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
    const cards = zones.flatMap(z => zoneCards(s, owner, z)).filter(c => matchesFilter(s, db, user, def(db, c), String(p.filter ?? '')))
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
        const done = n > 0 ? millCards(s, foe, n) : 0
        return log(s, 'MILL', `${ctx.source}: player ${foe + 1} discards ${done} life card(s) (${allies.length} allies)`, foe)
      }
      case 'redirectDamage':
        // the owner chooses which ally takes the damage
        log(s, 'PROTECT', `${ctx.source}: the damage player ${user + 1} would take this combat destroys an ally instead`, user)
        return queueChoice(s, pickRequest(user, user, 'allies', allies.map(a => a.card), 1, 'MARK_ALLY_SHIELD', ctx.source))
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
    restrictAttacks(ctx.s, targetOf(ctx, p.target), (p.attackType ?? 'ANY') as AttackType, phases, ctx.source)
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
      st.lifeCardsDealt += applyDamage(s, other(st.initiator), extra)
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
    if (p.maxLifeCards !== undefined || p.maxStages !== undefined) {
      // a defense that lets only part of the damage through
      if (st && ctx.user !== st.initiator) st.defense = { mode: 'CAP', stages: 0, lifeCards: 0, maxLifeCards: p.maxLifeCards as number | undefined, maxStages: p.maxStages as number | undefined }
      return
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
