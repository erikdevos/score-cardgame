// Ongoing effects of drills and automatic personality powers that fire on game events.
import { AUTO_TIMINGS, findCustom, typeMatches } from '../abilities'
import type { CardDB, Effect } from '../cards'
import { def, log, mpDef, schedule } from '../state'
import { other, type Frame, type GameState, type PlayerId } from '../types'

export type Trigger =
  | { kind: 'combatStart' }
  | { kind: 'attackPhase'; player: PlayerId }
  | { kind: 'afterReceivingSuccessfulAttack'; player: PlayerId; attackType: 'PHYSICAL' | 'ENERGY' }
  | { kind: 'turnStart' }
  | { kind: 'afterOwnSuccessfulAttack'; player: PlayerId; attackType: 'PHYSICAL' | 'ENERGY' }

function roleOk(s: GameState, owner: PlayerId, role: unknown) {
  if (role === 'attacker') return owner === s.attacker
  if (role === 'defender') return owner !== s.attacker
  return true
}

/** The work a game event sets off: ongoing drill effects, in table order. */
export function triggerFrames(s: GameState, db: CardDB, t: Trigger): Frame[] {
  const out: Frame[] = []
  for (const pl of s.players) {
    for (const drill of pl.drills) {
      const d = def(db, drill)
      const frame = (effects: Effect[]): Frame => ({ k: 'effects', user: pl.id, source: d.name, card: drill, triggered: true, effects })
      for (const e of d.effects.onEnterPlay) {
        if (e.action !== 'CUSTOM' || !e.params?.ongoing) continue
        const p = e.params
        if (e.handler === 'drawFromDiscard' && p.timing === 'startOfEachCombat' && t.kind === 'combatStart') {
          log(s, 'TRIGGER', `${d.name} triggers`, pl.id)
          out.push(frame([e]))
          continue
        }
        if (e.handler !== 'triggeredEffect' || p.trigger !== t.kind || !roleOk(s, pl.id, p.role)) continue
        if (t.kind !== 'combatStart' && t.kind !== 'turnStart' && t.player !== pl.id) continue
        if ((t.kind === 'afterReceivingSuccessfulAttack' || t.kind === 'afterOwnSuccessfulAttack') && !typeMatches(p.attackType, t.attackType)) continue
        // FS-78: only once both a physical and an energy attack of the owner succeeded this combat
        const hits = s.combat?.onceKeys ?? []
        if (p.condition === 'successfulPhysicalAndEnergyThisCombat' && !(hits.includes(`hit:${pl.id}:PHYSICAL`) && hits.includes(`hit:${pl.id}:ENERGY`))) continue
        const limit = p.limit as { count?: number; per?: string } | undefined
        if (limit?.per === 'combat' && s.combat) {
          const key = `${drill.iid}:limit`
          if (hits.filter(k => k === key).length >= (limit.count ?? 1)) continue
          s.combat.onceKeys.push(key)
        }
        const effects = (p.then ?? []) as Effect[]
        if (p.optional) {
          const prompt = `${d.name}: ${effects.map(x => (x.action === 'DRAW' ? `draw ${x.amount}` : x.action.toLowerCase())).join(', ')}?`
          out.push({ k: 'choice', q: { kind: 'CONFIRM', player: pl.id, effects, source: d.name, prompt } })
          continue
        }
        log(s, 'TRIGGER', `${d.name} triggers`, pl.id)
        out.push(frame(effects))
      }
    }
  }
  return out
}

export function fireTrigger(s: GameState, db: CardDB, t: Trigger) {
  schedule(s, ...triggerFrames(s, db, t))
}

/** Powers printed "when starting a battle / when defending, draw ..." resolve on their own. */
export function autoPowerFrames(s: GameState, db: CardDB): Frame[] {
  const c = s.combat!
  const out: Frame[] = []
  for (const p of [s.attacker, other(s.attacker)] as PlayerId[]) {
    const mp = mpDef(s, db, p)
    const power = mp.personality!.power
    if (!power) continue
    const when = findCustom(power.strike.effects.onPlaySecondary, 'playTiming')[0]?.when as string | undefined
    if (!when || !AUTO_TIMINGS.has(when)) continue
    if (when === 'ownAttackStart' && p !== s.attacker) continue
    if (when === 'defenderDraw' && p === s.attacker) continue
    c.usedPowers.push(`${p}:${mp.id}`)
    log(s, 'POWER', `${mp.name}'s power: ${power.name}`, p)
    out.push({ k: 'effects', user: p, source: power.name, effects: [...power.strike.effects.onPlaySecondary] })
  }
  return out
}
