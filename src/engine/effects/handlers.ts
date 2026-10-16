// CUSTOM effect handlers for card text the atomic DSL cannot express (see docs/dsl-gaps.md).
import { restrictAttacks, type Params } from '../abilities'
import type { Effect } from '../cards'
import { computeDamage, applyDamage } from '../damage'
import { changeAnger, def, log, mpDef } from '../state'
import { other, type AttackType, type PlayerId } from '../types'
import { resolveEffects, type CustomHandler, type EffectContext } from '.'
import { pickRequest, queueChoice } from './choices'

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
  queueChoice(ctx.s, ctx.db, pickRequest(who, who, 'discard', cards, n, dest, ctx.source))
}

export const handlers: Record<string, CustomHandler> = {
  // Read elsewhere (legal actions, defenses, timing), nothing to resolve.
  playTiming: noop,
  usageLimit: noop,
  dualUse: noop,
  powerDefense: noop,

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
    queueChoice(ctx.s, ctx.db, { kind: 'CONFIRM', player: ctx.user, effects, source: ctx.source, prompt })
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
    if (p.searchOwnDeck) {
      const balls = s.players[user].lifeDeck.filter(c => def(db, c).type === 'Dragon Ball')
      queueChoice(s, db, pickRequest(user, user, 'lifeDeck', balls, 1, 'PICKER_DRAGON_BALLS', ctx.source))
    }
    const n = num(p.captureFromFoe ?? p.amount, p.searchOwnDeck ? 0 : 1)
    if (n <= 0) return
    const dest = p.destination === 'bottomOfOpponentLifeDeck' ? 'OWNER_LIFE_BOTTOM' : 'PICKER_DRAGON_BALLS'
    if (!s.players[foe].dragonBalls.length) return log(s, 'NO_EFFECT', `${ctx.source}: player ${foe + 1} has no Dragon Balls`)
    queueChoice(s, db, pickRequest(user, foe, 'dragonBalls', s.players[foe].dragonBalls, n, dest, ctx.source))
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
