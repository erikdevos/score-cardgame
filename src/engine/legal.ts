import { attackRestriction, attackTypeOf, findCustom, isAutoOnly, requirementsMet, tableEffects, timingAllows, typeMatches, worksFromTable, type Window } from './abilities'
import { isAttackRole, isDefenseRole, type CardDB, type CardDef } from './cards'
import { attackPowerOption, canPayCost, copyableAttack, legalDefenses, legalPowerDefense, strikeOf } from './sequencer'
import { canUseCard, def, mpDef, trunksAllyAllowed } from './state'
import { mustSkipCombat } from './turn'
import { other, type Action, type CardInstance, type GameState, type PlayerId } from './types'

const NON_COMBAT_TYPES = new Set(['Non-Combat', 'Drill', 'Dragon Ball', 'Location', 'Battleground', 'Personality'])
const COMBAT_TYPES = new Set(['Physical Combat', 'Energy Combat', 'Combat'])

export function legalActions(s: GameState, db: CardDB): Action[] {
  if (s.winner !== null) return []
  return [...baseActions(s, db), ...freeActions(s, db)]
}

/** "At any time" cards on the table: usable whenever their owner has to act. */
function freeActions(s: GameState, db: CardDB): Action[] {
  const p = actingPlayer(s)
  const pc = s.pendingChoice
  if (p === null || s.stack.length || (pc && !['DEFEND', 'DISCARD_TO_LIMIT', 'WINDOW', 'REJUVENATE'].includes(pc.kind))) return []
  return s.players[p].nonCombat.filter(c => usableNow(s, db, p, c, 'FREE')).map(c => ({ type: 'USE_FREE' as const, player: p, iid: c.iid }))
}

function baseActions(s: GameState, db: CardDB): Action[] {
  const pc = s.pendingChoice
  if (pc) {
    const p = pc.player
    const pl = s.players[p]
    switch (pc.kind) {
      case 'DEFEND':
        // a player who made a Final Physical Attack cannot defend for the rest of this combat
        if (s.combat?.finalAttack.includes(p)) return [{ type: 'DEFEND', player: p, iid: null }]
        return [
          { type: 'DEFEND', player: p, iid: null },
          ...legalDefenses(s, db, p).map(c => ({ type: 'DEFEND' as const, player: p, iid: c.iid })),
          ...(legalPowerDefense(s, db, p) ? [{ type: 'DEFEND_POWER' as const, player: p }] : []),
        ]
      case 'PICK':
        return pc.eligible.map(iid => ({ type: 'PICK' as const, player: p, iid }))
      case 'CONFIRM':
        return [{ type: 'CONFIRM', player: p, accept: true }, { type: 'CONFIRM', player: p, accept: false }]
      case 'OPTION':
        return pc.options.map((_, index) => ({ type: 'CHOOSE' as const, player: p, index }))
      case 'WINDOW':
        return [...pc.iids.map(iid => ({ type: 'RESPOND' as const, player: p, iid })), { type: 'RESPOND', player: p, iid: null }]
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
        ...s.players[a].nonCombat.filter(c => !def(db, c).combatRole && usableNow(s, db, a, c, 'NON_COMBAT')).map(c => ({ type: 'PLAY_CARD' as const, player: a, iid: c.iid })),
        { type: 'END_NON_COMBAT', player: a },
      ]
    case 'DECLARE':
      if (mustSkipCombat(s)) return [{ type: 'SKIP_COMBAT', player: a }]
      return [{ type: 'DECLARE_COMBAT', player: a }, { type: 'SKIP_COMBAT', player: a }]
    case 'COMBAT': {
      const p = s.combat!.active
      // after a Final Physical Attack the player passes for the rest of this combat
      if (s.combat!.finalAttack.includes(p)) return [{ type: 'PASS', player: p }]
      const usableAsAttack = (c: CardInstance) => {
        const d = def(db, c)
        if (!d.combatRole) return false
        if (!isAttackRole(d.combatRole) && !(d.combatRole === 'COMBAT_EFFECT' && d.usePhase !== 'DEFEND')) return false
        if (attackRestriction(s, p, d.combatRole)) return false
        return usableNow(s, db, p, c, 'ATTACK') && canPayCost(s, db, p, strikeOf(db, c))
      }
      const pl = s.players[p]
      const out: Action[] = [
        ...pl.hand.filter(c => COMBAT_TYPES.has(def(db, c).type) && usableAsAttack(c)),
        // unused Non-Combat cards on the table: as an attack, or their power in place of an attack
        ...pl.nonCombat.filter(c => !def(db, c).combatRole ? usableNow(s, db, p, c, 'ATTACK') : usableAsAttack(c)),
      ].map(c => ({ type: 'PLAY_CARD' as const, player: p, iid: c.iid }))
      const mp = mpDef(s, db, p)
      const powerOpt = attackPowerOption(s, db, p)
      if (powerOpt) out.push({ type: 'USE_POWER', player: p })
      if (copyableAttack(s, db, p)) out.push({ type: 'COPY_ATTACK', player: p })
      if (s.rules.trunks.finalPhysicalAttack && !attackRestriction(s, p, 'ATTACK_PHYSICAL')) {
        out.push(...pl.hand.map(c => ({ type: 'FINAL_PHYSICAL_ATTACK' as const, player: p, iid: c.iid })))
      }
      out.push({ type: 'PASS', player: p })
      const bonus = s.combat!.bonusAttack
      if (bonus?.active && bonus.player === p) {
        // Multi-Form's extra attack: only an attack of that type, or pass
        const fits = (role?: Parameters<typeof attackTypeOf>[0]) => {
          const t = attackTypeOf(role)
          return !!t && typeMatches(bonus.attackType, t)
        }
        return out.filter(a =>
          a.type === 'PASS' ||
          (a.type === 'USE_POWER' && fits(powerOpt?.strike.combatRole)) ||
          ((a.type === 'COPY_ATTACK' || a.type === 'FINAL_PHYSICAL_ATTACK') && fits('ATTACK_PHYSICAL')) ||
          (a.type === 'PLAY_CARD' && fits(def(db, [...pl.hand, ...pl.nonCombat].find(c => c.iid === a.iid)!).combatRole)))
      }
      return out
    }
    default:
      return []
  }
}

/** Usage restriction, play timing and board requirements of a card at this moment. */
function usableNow(s: GameState, db: CardDB, p: PlayerId, c: CardInstance, window: Window) {
  const d = def(db, c)
  if (worksFromTable(d)) return false
  if (d.noStacking && s.combat?.usedCardIds.includes(d.id)) return false
  const effects = [...d.effects.onPlaySecondary, ...d.effects.onEnterPlay]
  return canUseCard(s, db, p, d) && timingAllows(s, p, effects, window) && requirementsMet(s, db, p, effects, c)
}

function canPlayNonCombat(s: GameState, db: CardDB, iid: string): boolean {
  const pl = s.players[s.attacker]
  const card = pl.hand.find(c => c.iid === iid)!
  const d = def(db, card)
  if (!NON_COMBAT_TYPES.has(d.type)) return false
  if (!canUseCard(s, db, s.attacker, d)) return false
  if (d.type === 'Personality') {
    if (s.rules.trunks.allyRules) {
      const mpCards = pl.mp.stack.map(c => def(db, c))
      if (!trunksAllyAllowed(mpCards, mpDef(s, db, other(s.attacker)).personality!.character, d)) return false
      const p = d.personality!
      // the same ally at the same level only once in the game; a higher level replaces your lower one
      const sameLevel = s.players.some(x => x.allies.some(a => def(db, a.card).personality?.character === p.character && def(db, a.card).personality?.level === p.level))
      const mineHigher = pl.allies.some(a => def(db, a.card).personality?.character === p.character && def(db, a.card).personality!.level > p.level)
      return !sameLevel && !mineHigher
    }
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
  if (d.type === 'Dragon Ball' && dragonBallLimitReached(s, db, s.attacker)) return false
  if (d.type === 'Dragon Ball' && s.rules.uniqueDragonBallNumbers) {
    return !s.players.some(p => p.dragonBalls.some(c => def(db, c).dragonBallNumber === d.dragonBallNumber))
  }
  return true
}

/** FS-101/102 "Opponents can play only 1 dragon ball on their turn": counted from this turn's log. */
function dragonBallLimitReached(s: GameState, db: CardDB, p: PlayerId): boolean {
  const limits = tableEffects(s, db, other(p), 'dragonBallPlayLimit').map(e => Number(e.params.perTurn ?? 1))
  if (!limits.length) return false
  const balls = new Set(Object.values(db).filter(d => d.type === 'Dragon Ball').map(d => `Player ${p + 1} plays ${d.name}`))
  let played = 0
  for (let i = s.log.length - 1; i >= 0 && s.log[i].t !== 'TURN'; i--) if (s.log[i].t === 'PLAY' && balls.has(s.log[i].msg)) played++
  return played >= Math.min(...limits)
}

/** The player who must act next. */
export function actingPlayer(s: GameState): PlayerId | null {
  if (s.winner !== null) return null
  if (s.pendingChoice) return s.pendingChoice.player
  if (s.step === 'COMBAT' && s.combat) return s.combat.active
  return s.attacker
}
