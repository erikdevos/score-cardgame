// Simple rule-based opponent: scores every legal action and picks the best.
import { isAttackRole, isDefenseRole, type CardDB, type StrikeDef } from '../cards'
import { computeDamage } from '../damage'
import { legalActions } from '../legal'
import { strikeOf } from '../sequencer'
import { def, mpDef } from '../state'
import type { Action, CardInstance, GameState, PlayerId } from '../types'

export function chooseAction(s: GameState, db: CardDB): Action | null {
  const actions = legalActions(s, db)
  if (!actions.length) return null
  let best = actions[0]
  let bestScore = -Infinity
  for (const a of actions) {
    const sc = score(s, db, a)
    if (sc > bestScore) {
      bestScore = sc
      best = a
    }
  }
  return best
}

function find(s: GameState, p: PlayerId, iid: string): CardInstance | undefined {
  const pl = s.players[p]
  return pl.hand.find(c => c.iid === iid) ?? pl.nonCombat.find(c => c.iid === iid)
}

function keepValue(db: CardDB, c: CardInstance): number {
  const d = def(db, c)
  if (d.type === 'Dragon Ball') return 5
  if (isDefenseRole(d.combatRole)) return 4
  if (isAttackRole(d.combatRole)) return 3
  return 1
}

function strikeValue(s: GameState, db: CardDB, p: PlayerId, strike: StrikeDef): number {
  if (!isAttackRole(strike.combatRole)) return 1
  const d = computeDamage(s, db, p, strike)
  const anger = strike.effects.onPlaySecondary.filter(e => e.action === 'MODIFY_ANGER' && e.target === 'SELF').length
  return d.stages + d.lifeCards * 1.5 + anger
}

function hasAttack(s: GameState, db: CardDB, p: PlayerId) {
  const pl = s.players[p]
  return [...pl.hand, ...pl.nonCombat].some(c => isAttackRole(def(db, c).combatRole)) || !!mpDef(s, db, p).personality?.power
}

function score(s: GameState, db: CardDB, a: Action): number {
  switch (a.type) {
    case 'DEFEND': {
      if (!a.iid) return 0
      const d = def(db, find(s, a.player, a.iid)!)
      return isDefenseRole(d.combatRole) || d.defense ? 10 : 3 // prefer real blocks over defend-phase effects
    }
    case 'STEAL_DB':
      return a.iid ? 10 : 0
    case 'REJUVENATE':
      return a.accept ? 1 : 0
    case 'DISCARD':
      return -keepValue(db, find(s, a.player, a.iid)!)
    case 'END_NON_COMBAT':
      return 0
    case 'DECLARE_COMBAT':
      return hasAttack(s, db, a.player) ? 1 : -1
    case 'SKIP_COMBAT':
      return 0
    case 'PASS':
      return 0
    case 'USE_POWER':
      return strikeValue(s, db, a.player, mpDef(s, db, a.player).personality!.power!.strike)
    case 'PLAY_CARD': {
      const c = find(s, a.player, a.iid)!
      const d = def(db, c)
      const onTable = s.players[a.player].nonCombat.includes(c)
      if (s.step === 'COMBAT') return d.combatRole ? strikeValue(s, db, a.player, strikeOf(db, c)) : 0.5
      if (onTable) return 2.5
      switch (d.type) {
        case 'Dragon Ball': return 5
        case 'Drill': return 4
        case 'Personality': return 3
        case 'Non-Combat': return 2
        default: return hasAttack(s, db, a.player) ? -1 : 1 // locations block our own combat
      }
    }
  }
}
