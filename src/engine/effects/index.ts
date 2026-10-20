import type { CardDB, Effect } from '../cards'
import { changeAnger, changeStages, drawCards, log, millCards, recoverCards, schedule } from '../state'
import { other, type CardInstance, type Frame, type GameState, type PlayerId } from '../types'
import { attachCard } from '../attach'
import { def } from '../state'
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

/** Effects that carry "attached": true when the card is fixed to something while its effect works. */
const ATTACHED_HANDLERS = ['damageModifier', 'forbidCards', 'grantMajin', 'triggeredEffect']

/** Fix the card to its host (see attach.ts); the card's ongoing effects then work from there. */
function attachEffectCard(ctx: EffectContext, e: Effect & { action: 'CUSTOM' }) {
  const { s, db } = ctx
  const p = e.params ?? {}
  const foe = other(ctx.user)
  const restrictive = Number(p.stages ?? 0) < 0 || Number(p.lifeCards ?? 0) < 0 || typeof p.maxStages === 'number'
  const to = String(p.attachTo ?? 'mainPersonality')
  const own = s.players[ctx.user]
  const opp = s.players[foe]
  let host: { player: PlayerId; kind: 'mp' | 'card'; iid?: string } | undefined
  if (to === 'mainPersonality') host = { player: ctx.user, kind: 'mp' }
  else if (to === 'opponentMainPersonality') host = { player: foe, kind: 'mp' }
  else if (to === 'choice') host = { player: restrictive ? foe : ctx.user, kind: 'mp' }
  else if (to === 'opponentNonCombat') {
    const c = opp.nonCombat.find(x => !s.attachments.some(a => a.host.iid === x.iid))
    if (c) host = { player: foe, kind: 'card', iid: c.iid }
  } else if (to === 'drill') {
    const c = own.drills.find(x => (!p.attachToName || def(db, x).name === p.attachToName) && !s.attachments.some(a => a.host.iid === x.iid))
    if (c) host = { player: ctx.user, kind: 'card', iid: c.iid }
  }
  if (!host) return log(s, 'NO_EFFECT', `${ctx.source}: nothing to attach to`, ctx.user)
  const d = def(db, ctx.card!)
  // a Non-Combat card's other ongoing effects go with it; an attack card attaches only for this effect
  const own2 = d.effects.onEnterPlay.includes(e) ? d.effects.onEnterPlay.filter(x => !(x.action === 'CUSTOM' && ['playTiming', 'senseiDeck'].includes(x.handler))) : [e]
  attachCard(s, db, ctx.card!, host, { until: p.until as string | undefined, effects: own2, removeWhenDone: !!p.removeWhenDone })
}

/**
 * Schedule effects on the stack. They resolve in order, before anything scheduled earlier,
 * and resolution pauses whenever one of them needs a player's decision.
 */
export function resolveEffects(ctx: EffectContext, effects: Effect[]) {
  if (!effects.length) return
  schedule(ctx.s, { k: 'effects', user: ctx.user, source: ctx.source, card: ctx.card, triggered: ctx.triggered, effects: [...effects] })
}

/** Stack driver: resolve the next effect of the effects frame on top of the stack. */
export function runEffectsFrame(s: GameState, db: CardDB, f: Frame & { k: 'effects' }) {
  const e = f.effects.shift()
  if (!f.effects.length) s.stack.pop()
  if (!e) return
  resolveEffect({ s, db, user: f.user, source: f.source, card: f.card, triggered: f.triggered }, e)
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
      const n = millCards(s, target, e.amount, ctx.db)
      if (n > 0 && target !== user) s.angerLock = s.angerLock.filter(x => x !== user)
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
      if (e.params?.attached && !ctx.triggered && ATTACHED_HANDLERS.includes(e.handler) && ctx.card) return attachEffectCard(ctx, e)
      const h = customHandlers[e.handler]
      if (!h) return log(s, 'WARN', `${ctx.source}: custom effect "${e.handler}" not implemented yet`)
      return h(ctx, e.params ?? {})
    }
  }
}
