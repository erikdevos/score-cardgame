// Simple rule-based opponent: scores every legal action and picks the best.
import { isAttackRole, isDefenseRole, type CardDB, type StrikeDef } from '../cards'
import { computeDamage } from '../damage'
import { legalActions } from '../legal'
import { attackPowerOption, copyableAttack, legalPowerDefense, strikeOf } from '../sequencer'
import { def, mpDef } from '../state'
import { FINAL_PHYSICAL_ATTACK } from '../turn'
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

/** A card anywhere a pick can reach. */
function findAnywhere(s: GameState, iid: string): CardInstance | undefined {
  for (const pl of s.players) {
    const c = [...pl.discard, ...pl.dragonBalls, ...pl.lifeDeck, ...pl.hand, ...pl.drills, ...pl.nonCombat, ...pl.allies.map(a => a.card)].find(x => x.iid === iid)
    if (c) return c
  }
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
    case 'DEFEND_POWER': {
      const opt = legalPowerDefense(s, db, a.player)
      if (!opt?.defense) return 2
      return opt.defense.mode === 'STOP' ? 11 : 8 // keep cards when the power does the job
    }
    case 'PICK': {
      const pc = s.pendingChoice
      const v = keepValue(db, findAnywhere(s, a.iid)!)
      // losing own cards: give up the least useful one; everything else: take the best
      const own = pc?.kind === 'PICK' && pc.owner === a.player && ['DISCARD', 'REMOVED'].includes(pc.dest)
      if (pc?.kind === 'PICK' && pc.dest === 'ALLY_TO_MP_STAGES') return s.players[a.player].allies.find(x => x.card.iid === a.iid)?.stage ?? 0
      return own ? -v : v
    }
    case 'CHOOSE': {
      const pc = s.pendingChoice
      // Honor Duel: soak damage (first option); stage transfer: as many as possible
      if (pc?.kind === 'OPTION' && pc.purpose === 'honorDuel') return a.index === 0 ? 1 : 0
      // FS-24: a life card paid per life card dealt; 3 is a fair trade
      // damage: an ally with stages to spare soaks it, else the main personality
      if (pc?.kind === 'OPTION' && pc.purpose === 'damageTarget') return a.index === 0 ? 0 : 1 + Number(/stage (\d+)/.exec(pc.options[a.index])?.[1] ?? 0) / 10
      if (pc?.kind === 'OPTION' && pc.purpose === 'variableCost') return -Math.abs(a.index + 1 - 3)
      return a.index
    }
    case 'RESPOND':
      return a.iid ? 3 : 0
    case 'USE_FREE':
      return 4
    case 'CONFIRM':
      // optional draws: decline when the life deck is nearly empty
      return a.accept === s.players[a.player].lifeDeck.length > 8 ? 1 : 0
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
      return strikeValue(s, db, a.player, attackPowerOption(s, db, a.player)!.strike)
    case 'ALLY_TAKEOVER':
      // a fresh ally beats fighting on at 0-1 stages
      return (s.players[a.player].allies.find(x => x.card.iid === a.iid)?.stage ?? 0) >= 3 ? 12 : -1
    case 'FINAL_PHYSICAL_ATTACK':
      // worth it only when the table damage beats losing the card and the rest of this combat
      return strikeValue(s, db, a.player, FINAL_PHYSICAL_ATTACK) - keepValue(db, find(s, a.player, a.iid)!) - 1.5
    case 'COPY_ATTACK':
      return strikeValue(s, db, a.player, copyableAttack(s, db, a.player)!.strike)
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
