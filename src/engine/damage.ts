import type { CardDB, StrikeDef } from './cards'
import { activePassives, log, millCards, powerRating } from './state'
import type { GameState, PlayerId, Rules } from './types'

export function bracketOf(rating: number, rules: Rules): number {
  const b = rules.pat.brackets
  let idx = 0
  for (let i = 0; i < b.length; i++) if (rating >= b[i]) idx = i
  return idx
}

export function patDamage(attackerRating: number, defenderRating: number, rules: Rules): number {
  return rules.pat.matrix[bracketOf(attackerRating, rules)][bracketOf(defenderRating, rules)]
}

export interface Damage {
  stages: number
  lifeCards: number
}

/** Cost of a strike, with the energy attack default applied. */
export function strikeCost(strike: StrikeDef, rules: Rules) {
  if (strike.cost) return strike.cost
  if (strike.combatRole === 'ATTACK_ENERGY') return { type: 'POWER_STAGES' as const, amount: rules.energyAttack.defaultCostStages }
  return { type: 'NONE' as const, amount: 0 }
}

/** Base damage + card modifiers + passive modifiers, before defense reductions. */
export function computeDamage(s: GameState, db: CardDB, attacker: PlayerId, strike: StrikeDef): Damage {
  const rules = s.rules
  const defender: PlayerId = attacker === 0 ? 1 : 0
  const dmg = strike.damage ?? defaultDamage(strike, rules)
  let stages = 0
  let lifeCards = 0
  if (dmg.calculation === 'PAT') stages = patDamage(powerRating(s, db, attacker), powerRating(s, db, defender), rules)
  else if (dmg.calculation === 'FLAT') {
    stages = dmg.stages
    lifeCards = dmg.lifeCards
  }
  stages += dmg.modifierStages
  lifeCards += dmg.modifierLifeCards

  const type = strike.combatRole === 'ATTACK_PHYSICAL' ? 'PHYSICAL' : 'ENERGY'
  for (const ps of activePassives(s, db, attacker)) {
    if (ps.kind === 'DAMAGE_MOD' && (ps.attackType === 'ANY' || ps.attackType === type)) {
      stages += ps.stages
      lifeCards += ps.lifeCards
    }
  }
  return { stages: Math.max(0, stages), lifeCards: Math.max(0, lifeCards) }
}

function defaultDamage(strike: StrikeDef, rules: Rules) {
  const base = { stages: 0, lifeCards: 0, modifierStages: 0, modifierLifeCards: 0 }
  if (strike.combatRole === 'ATTACK_ENERGY') return { ...base, calculation: 'FLAT' as const, lifeCards: rules.energyAttack.defaultLifeCards }
  if (strike.combatRole === 'ATTACK_PHYSICAL') return { ...base, calculation: 'PAT' as const }
  return { ...base, calculation: 'NONE' as const }
}

/**
 * Stages first; stages that cannot be paid because the MP would drop below 0
 * overflow 1:1 into life cards. Returns life cards actually discarded.
 */
export function applyDamage(s: GameState, target: PlayerId, d: Damage): number {
  const mp = s.players[target].mp
  const paid = Math.min(mp.stage, d.stages)
  mp.stage -= paid
  const overflow = d.stages - paid
  let totalLife = d.lifeCards + overflow
  // "uses the bottom 3 cards of the discard pile instead of the life deck" for this combat
  let absorbed = 0
  const sub = s.discardAsLife.find(x => x.player === target && x.mode === 'DAMAGE' && x.armed && x.remaining > 0)
  if (sub) {
    const pile = s.players[target].discard
    absorbed = Math.min(sub.remaining, totalLife, pile.length)
    for (let i = 0; i < absorbed; i++) pile.push(pile.shift()!)
    sub.remaining -= absorbed
    totalLife -= absorbed
    if (absorbed) log(s, 'PROTECT', `${sub.source}: ${absorbed} life card(s) of damage taken from the discard pile`, target)
  }
  const milled = absorbed + (totalLife > 0 ? millCards(s, target, totalLife) : 0)
  log(s, 'DAMAGE', `Player ${target + 1} takes ${paid} stage(s)${overflow ? ` (+${overflow} overflow)` : ''} and ${milled} life card(s)`, target)
  return milled
}
