import type { CardDB, StrikeDef } from './cards'
import { tableEffects } from './abilities'
import { activePassives, def, findCustom, log, millCards, powerRating, pur } from './state'
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

export function defaultDamage(strike: StrikeDef, rules: Rules) {
  const base = { stages: 0, lifeCards: 0, modifierStages: 0, modifierLifeCards: 0 }
  if (strike.combatRole === 'ATTACK_ENERGY') return { ...base, calculation: 'FLAT' as const, lifeCards: rules.energyAttack.defaultLifeCards }
  if (strike.combatRole === 'ATTACK_PHYSICAL') return { ...base, calculation: 'PAT' as const }
  return { ...base, calculation: 'NONE' as const }
}

/**
 * Stages first; stages that cannot be paid because the MP would drop below 0
 * overflow 1:1 into life cards. Returns life cards actually discarded.
 */
export function applyDamage(s: GameState, target: PlayerId, d: Damage, db?: CardDB, noLifeCards = false): number {
  const mp = s.players[target].mp
  const paid = Math.min(mp.stage, d.stages)
  mp.stage -= paid
  const overflow = d.stages - paid
  let totalLife = noLifeCards ? 0 : d.lifeCards + overflow
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
  const milled = absorbed + (totalLife > 0 ? millWithEndurance(s, target, totalLife, db) : 0)
  log(s, 'DAMAGE', `Player ${target + 1} takes ${paid} stage(s)${overflow ? ` (+${overflow} overflow)` : ''} and ${milled} life card(s)`, target)
  return milled
}

/** Endurance N of a card: the first Endurance effect of the card, or 1 for Non-Combat cards while a grantEndurance drill is in play (CG-112). */
function enduranceOf(s: GameState, db: CardDB, owner: PlayerId, card: { defId: string }): number {
  const d = def(db, card as never)
  const pl = s.players[owner]
  // Endurance X (Buu Saga rulebook p. 54): X comes from the game, the card says which value
  const value = (p: Record<string, unknown>) => {
    if (p.amount !== 'X') return Number(p.amount ?? 0)
    if (p.x === 'ownAnger') return pl.mp.anger
    if (p.x === 'dragonBallsControlled') return pl.dragonBalls.length
    if (p.x === 'ownPurMinus1') return Math.max(0, pur(s, db, owner) - 1)
    return 0
  }
  const own = Object.values(d.effects).flatMap(v => (Array.isArray(v) ? findCustom(v as never[], 'endurance') : [])).map(value)
  if (own.length) return Math.max(...own)
  const grant = tableEffects(s, db, owner, 'grantEndurance').find(g => g.params.onlyIfNone && (g.params.cardTypes as string[] | undefined)?.includes(d.type))
  return grant ? Number(grant.params.amount ?? 1) : 0
}

/**
 * Life cards of damage from an attack, one card at a time. Buu Saga rulebook (p. 50): a discarded life card with
 * Endurance N may be removed from the game to prevent N more life cards of damage; only in a deck that declared
 * a Tokui-Waza. The engine always uses it (it is nearly always better than keeping the card).
 */
function millWithEndurance(s: GameState, target: PlayerId, n: number, db?: CardDB): number {
  if (!db || !s.players[target].tokuiWaza) return millCards(s, target, n, db)
  const pl = s.players[target]
  let remaining = n
  let done = 0
  while (remaining > 0 && s.winner === null) {
    if (!millCards(s, target, 1, db)) break
    remaining--
    done++
    const card = pl.discard[pl.discard.length - 1]
    const endurance = card ? enduranceOf(s, db, target, card) : 0
    if (endurance > 0 && remaining > 0) {
      pl.removed.push(pl.discard.pop()!)
      log(s, 'ENDURANCE', `${def(db, card).name} is removed from the game: Endurance ${endurance} prevents ${Math.min(endurance, remaining)} life card(s) of damage`, target)
      remaining = Math.max(0, remaining - endurance)
    }
  }
  return done
}
