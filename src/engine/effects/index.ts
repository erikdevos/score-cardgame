import type { CardDB, Effect } from '../cards'
import { changeAnger, changeStages, drawCards, log, millCards, over, recoverCards } from '../state'
import { other, type CardInstance, type GameState, type PlayerId } from '../types'
import { handlers } from './handlers'

export interface EffectContext {
  s: GameState
  db: CardDB
  /** the card user */
  user: PlayerId
  source: string
  /** the card whose effect this is, when it comes from a card */
  card?: CardInstance
  /** resolving an ongoing effect because its trigger happened */
  triggered?: boolean
}

export type CustomHandler = (ctx: EffectContext, params: Record<string, unknown>) => void

/** Card-specific behaviour that the atomic DSL cannot express, keyed by handler name. */
export const customHandlers: Record<string, CustomHandler> = handlers

export function resolveEffects(ctx: EffectContext, effects: Effect[]) {
  for (const e of effects) {
    if (over(ctx.s)) return
    resolveEffect(ctx, e)
  }
}

function resolveEffect(ctx: EffectContext, e: Effect) {
  const { s, db, user } = ctx
  const target = 'target' in e ? (e.target === 'SELF' ? user : other(user)) : user
  switch (e.action) {
    case 'MODIFY_ANGER':
      return changeAnger(s, db, target, e.amount)
    case 'MODIFY_STAGES':
      changeStages(s, target, e.amount)
      return log(s, 'STAGES', `${ctx.source}: player ${target + 1} ${e.amount >= 0 ? 'gains' : 'loses'} ${Math.abs(e.amount)} power stage(s)`, target)
    case 'SET_STAGE': {
      const v = e.value === 'MAX' ? s.rules.maxStage : e.value
      changeStages(s, target, v - s.players[target].mp.stage)
      return log(s, 'STAGES', `${ctx.source}: player ${target + 1} set to stage ${v}`, target)
    }
    case 'DRAW':
      return drawCards(s, target, e.amount)
    case 'DISCARD_LIFE': {
      const n = millCards(s, target, e.amount)
      return log(s, 'MILL', `${ctx.source}: player ${target + 1} discards ${n} life card(s)`, target)
    }
    case 'RECOVER': {
      const n = recoverCards(s, target, e.amount)
      return log(s, 'RECOVER', `${ctx.source}: player ${target + 1} returns ${n} card(s) to the bottom of their life deck`, target)
    }
    case 'END_COMBAT':
      if (s.combat) s.combat.ended = true
      return log(s, 'END_COMBAT', `${ctx.source} ends combat`)
    case 'CUSTOM': {
      const h = customHandlers[e.handler]
      if (!h) return log(s, 'WARN', `${ctx.source}: custom effect "${e.handler}" not implemented yet`)
      return h(ctx, e.params ?? {})
    }
  }
}
