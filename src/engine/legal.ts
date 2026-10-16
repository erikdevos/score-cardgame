import { isAttackRole, type CardDB } from './cards'
import { canPayCost, legalDefenses, strikeOf } from './sequencer'
import { canUseCard, def, mpDef } from './state'
import { other, type Action, type CardInstance, type GameState, type PlayerId } from './types'

const NON_COMBAT_TYPES = new Set(['Non-Combat', 'Drill', 'Dragon Ball', 'Location', 'Battleground', 'Personality'])
const COMBAT_TYPES = new Set(['Physical Combat', 'Energy Combat', 'Combat'])

export function legalActions(s: GameState, db: CardDB): Action[] {
  if (s.winner !== null) return []
  const pc = s.pendingChoice
  if (pc) {
    const p = pc.player
    const pl = s.players[p]
    switch (pc.kind) {
      case 'DEFEND':
        return [{ type: 'DEFEND', player: p, iid: null }, ...legalDefenses(s, db, p).map(c => ({ type: 'DEFEND' as const, player: p, iid: c.iid }))]
      case 'DB_STEAL':
        return [{ type: 'STEAL_DB', player: p, iid: null }, ...s.players[other(p)].dragonBalls.map(c => ({ type: 'STEAL_DB' as const, player: p, iid: c.iid }))]
      case 'DISCARD_TO_LIMIT':
        return pl.hand.map(c => ({ type: 'DISCARD' as const, player: p, iid: c.iid }))
      case 'REJUVENATE':
        return [{ type: 'REJUVENATE', player: p, accept: true }, { type: 'REJUVENATE', player: p, accept: false }]
    }
  }

  const a = s.attacker
  switch (s.step) {
    case 'NON_COMBAT':
      return [
        ...s.players[a].hand.filter(c => canPlayNonCombat(s, db, c.iid)).map(c => ({ type: 'PLAY_CARD' as const, player: a, iid: c.iid })),
        // unused Non-Combat powers that are not an attack or block can be used right away
        ...s.players[a].nonCombat.filter(c => !def(db, c).combatRole).map(c => ({ type: 'PLAY_CARD' as const, player: a, iid: c.iid })),
        { type: 'END_NON_COMBAT', player: a },
      ]
    case 'DECLARE':
      return [{ type: 'DECLARE_COMBAT', player: a }, { type: 'SKIP_COMBAT', player: a }]
    case 'COMBAT': {
      const p = s.combat!.active
      const usableAsAttack = (c: CardInstance) => {
        const d = def(db, c)
        if (!d.combatRole) return false
        if (!isAttackRole(d.combatRole) && !(d.combatRole === 'COMBAT_EFFECT' && d.usePhase !== 'DEFEND')) return false
        return canUseCard(s, db, p, d) && canPayCost(s, p, strikeOf(db, c))
      }
      const pl = s.players[p]
      const out: Action[] = [
        ...pl.hand.filter(c => COMBAT_TYPES.has(def(db, c).type) && usableAsAttack(c)),
        // unused Non-Combat cards on the table: as an attack, or their power in place of an attack
        ...pl.nonCombat.filter(c => !def(db, c).combatRole ? canUseCard(s, db, p, def(db, c)) : usableAsAttack(c)),
      ].map(c => ({ type: 'PLAY_CARD' as const, player: p, iid: c.iid }))
      const mp = mpDef(s, db, p)
      const power = mp.personality!.power
      if (power && !s.combat!.usedPowers.includes(`${p}:${mp.id}`) && canPayCost(s, p, power.strike)) out.push({ type: 'USE_POWER', player: p })
      out.push({ type: 'PASS', player: p })
      return out
    }
    default:
      return []
  }
}

function canPlayNonCombat(s: GameState, db: CardDB, iid: string): boolean {
  const pl = s.players[s.attacker]
  const card = pl.hand.find(c => c.iid === iid)!
  const d = def(db, card)
  if (!NON_COMBAT_TYPES.has(d.type)) return false
  if (!canUseCard(s, db, s.attacker, d)) return false
  if (d.type === 'Personality') {
    // Allies: level 1 only, not the same character as your MP
    return d.personality?.level === 1 && d.personality.character !== mpDef(s, db, s.attacker).personality!.character
  }
  if (d.type === 'Drill') {
    if (s.rules.uniqueDrillsPerPlayer && pl.drills.some(c => c.defId === d.id)) return false
    // restricted drill: not while another drill of that style is on the table
    const style = d.exclusiveDrillStyle
    if (style && s.players.some(p => p.drills.some(c => def(db, c).style === style))) return false
    return true
  }
  if (d.type === 'Dragon Ball' && s.rules.uniqueDragonBallNumbers) {
    return !s.players.some(p => p.dragonBalls.some(c => def(db, c).dragonBallNumber === d.dragonBallNumber))
  }
  return true
}

/** The player who must act next. */
export function actingPlayer(s: GameState): PlayerId | null {
  if (s.winner !== null) return null
  if (s.pendingChoice) return s.pendingChoice.player
  if (s.step === 'COMBAT' && s.combat) return s.combat.active
  return s.attacker
}
