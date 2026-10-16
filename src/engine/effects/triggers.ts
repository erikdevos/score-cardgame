// Ongoing effects of drills and automatic personality powers that fire on game events.
import { AUTO_TIMINGS, findCustom, typeMatches } from '../abilities'
import type { CardDB, Effect } from '../cards'
import { def, log, mpDef } from '../state'
import { other, type GameState, type PlayerId } from '../types'
import { resolveEffects } from '.'
import { handlers } from './handlers'
import { queueChoice } from './choices'

export type Trigger =
  | { kind: 'combatStart' }
  | { kind: 'attackPhase'; player: PlayerId }
  | { kind: 'afterReceivingSuccessfulAttack'; player: PlayerId; attackType: 'PHYSICAL' | 'ENERGY' }

function roleOk(s: GameState, owner: PlayerId, role: unknown) {
  if (role === 'attacker') return owner === s.attacker
  if (role === 'defender') return owner !== s.attacker
  return true
}

export function fireTrigger(s: GameState, db: CardDB, t: Trigger) {
  for (const pl of s.players) {
    for (const drill of [...pl.drills]) {
      const d = def(db, drill)
      const ctx = { s, db, user: pl.id, source: d.name, card: drill, triggered: true }
      for (const e of d.effects.onEnterPlay) {
        if (e.action !== 'CUSTOM' || !e.params?.ongoing || s.winner !== null) continue
        const p = e.params
        if (e.handler === 'drawFromDiscard' && p.timing === 'startOfEachCombat' && t.kind === 'combatStart') {
          log(s, 'TRIGGER', `${d.name} triggers`, pl.id)
          handlers.drawFromDiscard(ctx, p)
          continue
        }
        if (e.handler !== 'triggeredEffect' || p.trigger !== t.kind || !roleOk(s, pl.id, p.role)) continue
        if (t.kind !== 'combatStart' && t.player !== pl.id) continue
        if (t.kind === 'afterReceivingSuccessfulAttack' && !typeMatches(p.attackType, t.attackType)) continue
        const effects = (p.then ?? []) as Effect[]
        if (p.optional) {
          queueChoice(s, db, { kind: 'CONFIRM', player: pl.id, effects, source: d.name, prompt: `${d.name}: ${effects.map(x => (x.action === 'DRAW' ? `draw ${x.amount}` : x.action.toLowerCase())).join(', ')}?` })
          continue
        }
        log(s, 'TRIGGER', `${d.name} triggers`, pl.id)
        resolveEffects(ctx, effects)
      }
    }
  }
}

/** Powers printed "when starting a battle / when defending, draw ..." resolve on their own. */
export function autoPowers(s: GameState, db: CardDB) {
  const c = s.combat!
  for (const p of [s.attacker, other(s.attacker)] as PlayerId[]) {
    const mp = mpDef(s, db, p)
    const power = mp.personality!.power
    if (!power || s.winner !== null) continue
    const when = findCustom(power.strike.effects.onPlaySecondary, 'playTiming')[0]?.when as string | undefined
    if (!when || !AUTO_TIMINGS.has(when)) continue
    if (when === 'ownAttackStart' && p !== s.attacker) continue
    if (when === 'defenderDraw' && p === s.attacker) continue
    c.usedPowers.push(`${p}:${mp.id}`)
    log(s, 'POWER', `${mp.name}'s power: ${power.name}`, p)
    resolveEffects({ s, db, user: p, source: power.name }, power.strike.effects.onPlaySecondary)
  }
}
