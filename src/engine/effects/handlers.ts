// CUSTOM effect handlers for card text the atomic DSL cannot express (see docs/dsl-gaps.md).
import { restrictAttacks, type Params } from '../abilities'
import type { Effect } from '../cards'
import { computeDamage, applyDamage } from '../damage'
import { changeAnger, def, log, millCards, mpDef } from '../state'
import { other, type AttackType, type GameState, type PickZone, type PlayerId } from '../types'
import type { CardDB, CardDef } from '../cards'
import { resolveEffects, type CustomHandler, type EffectContext } from '.'
import { pickRequest, queueChoice, zoneCards } from './choices'

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
    const zones = ((p.cardTypes ?? []) as string[]).map(t => ZONE_BY_TYPE[t]).filter(Boolean)
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
    if (n > 0 && !s.players[foe].dragonBalls.length) log(s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1} has no Dragon Balls`)
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
