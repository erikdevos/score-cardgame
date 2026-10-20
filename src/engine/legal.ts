import { attackRestriction, attackTypeOf, findCustom, isAutoOnly, requirementsMet, tableEffects, timingAllows, typeMatches, worksFromTable, type Window } from './abilities'
import { isAttackRole, isDefenseRole, type CardDB, type CardDef } from './cards'
import { attackPowerOption, defensesNeeded, canPayCost, copyableAttack, legalDefenses, legalPowerDefense, strikeOf } from './sequencer'
import { allyRestricted, attachmentSources } from './attach'
import { activeAbilities, discardDefenses } from './activeabilities'
import { nonCombatForbidden } from './attach'
import { canUseCard, def, mpDef, trunksAllyAllowed } from './state'
import { canTakeOver, mustSkipCombat } from './turn'
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
          ...takeovers(s, p, db),
          { type: 'DEFEND', player: p, iid: null },
          ...legalDefenses(s, db, p).map(c => ({ type: 'DEFEND' as const, player: p, iid: c.iid })),
          ...(defensesNeeded(s) > 1 ? [] : discardDefenses(s, db, p).map(a => ({ type: 'DEFEND_DISCARD' as const, player: p, key: a.key }))),
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
      // AS-125: once per combat, place a Non-Combat card from hand in place of an attack
      if (tableEffects(s, db, p, 'playNonCombatInsteadOfAttack').length && !s.combat!.onceKeys.includes(`instead:${p}`) && !attackRestriction(s, p, 'COMBAT_EFFECT', false)) {
        out.push(...pl.hand.filter(c => def(db, c).type === 'Non-Combat' && canUseCard(s, db, p, def(db, c))).map(c => ({ type: 'PLAY_CARD' as const, player: p, iid: c.iid })))
      }
      // CG-100: in place of an attack, place an Ally from the hand
      if (s.location && p === s.attacker && !s.combat!.onceKeys.includes(`ally-instead:${p}`) && findCustom(def(db, s.location).effects.onEnterPlay, 'placeAllyInsteadOfAttack').length
        && !attackRestriction(s, p, 'COMBAT_EFFECT', false)) {
        out.push(...pl.hand.filter(c => def(db, c).type === 'Personality' && canPlayNonCombat(s, db, c.iid)).map(c => ({ type: 'PLAY_CARD' as const, player: p, iid: c.iid })))
      }
      const mp = mpDef(s, db, p)
      const powerOpt = attackPowerOption(s, db, p)
      if (powerOpt) out.push({ type: 'USE_POWER', player: p })
      // BU-200: the card's second attack power
      if (powerOpt && attackPowerOption(s, db, p, 1)) out.push({ type: 'USE_POWER', player: p, which: 1 })
      out.push(...activeAbilities(s, db, p).map(a => ({ type: 'USE_ABILITY' as const, player: p, key: a.key })))
      if (copyableAttack(s, db, p)) out.push({ type: 'COPY_ATTACK', player: p })
      out.push(...takeovers(s, p, db))
      if (s.rules.trunks.finalPhysicalAttack && !attackRestriction(s, p, 'ATTACK_PHYSICAL', false)) {
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
  if (d.type === 'Non-Combat' && nonCombatForbidden(s, p)) return false
  if (d.noStacking && s.combat?.usedCardIds.includes(d.id)) return false
  const effects = [...d.effects.onPlaySecondary, ...d.effects.onEnterPlay]
  // "for the remainder of this combat" does nothing outside combat
  if (!s.combat && effects.some(e => e.action === 'CUSTOM' && e.params?.duration === 'thisCombat')) return false
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
      // BU-56: an attached Blue Gambit allows allies up to 2 personality levels higher
      const bonus = attachmentSources(s, db, s.attacker).flatMap(a => findCustom(a.effects, 'allowAllyLevelBonus')).reduce((n, x) => n + Number(x.levels ?? 0), 0)
      if (!trunksAllyAllowed(mpCards, mpDef(s, db, other(s.attacker)).personality!.character, d, bonus)) return false
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
  if (d.type === 'Non-Combat' && nonCombatLimitReached(s, db, s.attacker)) return false
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

/** AS-55 "Opponents may only place 1 Non-Combat card in play during their turn": counted from this turn's log. */
function nonCombatLimitReached(s: GameState, db: CardDB, p: PlayerId): boolean {
  const limits = tableEffects(s, db, other(p), 'playLimit').filter(e => e.params.cardType === 'Non-Combat').map(e => Number(e.params.perTurn ?? 1))
  if (!limits.length) return false
  let placed = 0
  for (let i = s.log.length - 1; i >= 0 && s.log[i].t !== 'TURN'; i--) if (s.log[i].t === 'PLACE' && s.log[i].msg.startsWith(`Player ${p + 1} places `)) placed++
  return placed >= Math.min(...limits)
}

/** Trunks Saga: allies that can take over the combat for p right now. */
function takeovers(s: GameState, p: PlayerId, db?: CardDB): Action[] {
  if (s.combat?.lockdown) return []
  if (!canTakeOver(s, p, db)) return []
  return s.players[p].allies.filter(a => a.stage > 0 && !allyRestricted(s, a.card.iid, 'cannotTakeControlOfCombat')).map(a => ({ type: 'ALLY_TAKEOVER' as const, player: p, iid: a.card.iid }))
}

/** The player who must act next. */
export function actingPlayer(s: GameState): PlayerId | null {
  if (s.winner !== null) return null
  if (s.pendingChoice) return s.pendingChoice.player
  if (s.step === 'COMBAT' && s.combat) return s.combat.active
  return s.attacker
}
