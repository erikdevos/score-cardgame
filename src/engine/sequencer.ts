// The 8-point battle sequencer for a single strike.
import { isAttackRole, isDefenseRole, type CardDB, type StrikeDef } from './cards'
import { applyDamage, computeDamage, strikeCost } from './damage'
import { resolveEffects } from './effects'
import { canUseCard, checkDragonBallVictory, def, log, millCards, over, retire, takeCard } from './state'
import { other, type CardInstance, type GameState, type PlayerId } from './types'

export function canPayCost(s: GameState, p: PlayerId, strike: StrikeDef): boolean {
  const cost = strikeCost(strike, s.rules)
  if (cost.type === 'POWER_STAGES') return s.players[p].mp.stage >= cost.amount
  if (cost.type === 'LIFE_CARDS') return s.players[p].lifeDeck.length >= cost.amount
  return true
}

export function strikeOf(db: CardDB, c: CardInstance): StrikeDef {
  const d = def(db, c)
  return { combatRole: d.combatRole!, cost: d.cost, damage: d.damage, effects: d.effects }
}

/**
 * Cards that can answer the current strike: defense cards in hand or among the unused
 * Non-Combat cards on the table, plus combat effects printed with the defend icon.
 */
export function legalDefenses(s: GameState, db: CardDB, defender: PlayerId): CardInstance[] {
  const strike = s.combat?.strike
  if (!strike) return []
  const pl = s.players[defender]
  // Non-Combat cards only block from the table, never straight from hand
  return [...pl.hand.filter(c => def(db, c).type !== 'Non-Combat'), ...pl.nonCombat].filter(c => {
    const d = def(db, c)
    const role = d.combatRole
    const fits =
      role === 'DEFENSE_ANY' ||
      (role === 'DEFENSE_PHYSICAL' && strike.strike.combatRole === 'ATTACK_PHYSICAL') ||
      (role === 'DEFENSE_ENERGY' && strike.strike.combatRole === 'ATTACK_ENERGY') ||
      (role === 'COMBAT_EFFECT' && d.usePhase === 'DEFEND')
    return fits && canUseCard(s, db, defender, def(db, c)) && canPayCost(s, defender, strikeOf(db, c))
  })
}

function payCost(s: GameState, p: PlayerId, strike: StrikeDef) {
  const cost = strikeCost(strike, s.rules)
  if (cost.type === 'POWER_STAGES') s.players[p].mp.stage -= cost.amount
  else if (cost.type === 'LIFE_CARDS') millCards(s, p, cost.amount)
}

// Steps 1-4: declaration, costs, attacker secondaries, open the defend window.
export function beginStrike(s: GameState, db: CardDB, initiator: PlayerId, card: CardInstance | null, strike: StrikeDef, label: string) {
  const combat = s.combat!
  combat.strike = { initiator, card, strike, label, phase: 'AWAIT_DEFENSE', defenseCard: null, lifeCardsDealt: 0 }
  log(s, 'STRIKE', `Player ${initiator + 1} plays ${label}`, initiator)
  payCost(s, initiator, strike)
  if (over(s)) return
  resolveEffects({ s, db, user: initiator, source: label }, strike.effects.onPlaySecondary)
  if (over(s)) return

  if (!isAttackRole(strike.combatRole)) return cleanup(s, db)
  const defender = other(initiator)
  if (legalDefenses(s, db, defender).length > 0) s.pendingChoice = { kind: 'DEFEND', player: defender }
  else resolveHit(s, db)
}

export function defend(s: GameState, db: CardDB, iid: string | null) {
  const st = s.combat!.strike!
  s.pendingChoice = null
  const defender = other(st.initiator)
  const card = iid ? takeCard(s, defender, iid) : null
  st.defenseCard = card
  if (card) {
    const dstrike = strikeOf(db, card)
    log(s, 'DEFEND', `Player ${defender + 1} defends with ${def(db, card).name}`, defender)
    payCost(s, defender, dstrike)
    if (over(s)) return
    // Step 5: defender secondaries
    resolveEffects({ s, db, user: defender, source: def(db, card).name }, dstrike.effects.onPlaySecondary)
    if (over(s)) return
  } else {
    log(s, 'DEFEND', `Player ${defender + 1} takes the attack`, defender)
  }
  resolveHit(s, db)
}

// Steps 6-7: hit check, damage, Dragon Ball capture.
function resolveHit(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  const defender = other(st.initiator)
  // Defense cards stop by default; a defend-phase combat effect only stops when it has a defense field.
  const dd = st.defenseCard ? def(db, st.defenseCard) : null
  const defense = dd ? (dd.defense ?? (isDefenseRole(dd.combatRole) ? { mode: 'STOP' as const, stages: 0, lifeCards: 0 } : null)) : null
  if (defense?.mode === 'STOP') {
    log(s, 'STOPPED', `${st.label} is stopped`)
    return cleanup(s, db)
  }

  const dmg = computeDamage(s, db, st.initiator, st.strike)
  if (defense) {
    dmg.stages = Math.max(0, dmg.stages - defense.stages)
    dmg.lifeCards = Math.max(0, dmg.lifeCards - defense.lifeCards)
  }
  st.lifeCardsDealt = applyDamage(s, defender, dmg)
  if (over(s)) return

  if (st.lifeCardsDealt >= s.rules.dragonBallCaptureLifeCards && s.players[defender].dragonBalls.length > 0) {
    st.phase = 'AWAIT_DB_STEAL'
    s.pendingChoice = { kind: 'DB_STEAL', player: st.initiator }
    return
  }
  finishSuccessful(s, db)
}

export function stealDragonBall(s: GameState, db: CardDB, iid: string | null) {
  const st = s.combat!.strike!
  s.pendingChoice = null
  if (iid) {
    const from = s.players[other(st.initiator)].dragonBalls
    const i = from.findIndex(c => c.iid === iid)
    const [ball] = from.splice(i, 1)
    s.players[st.initiator].dragonBalls.push(ball)
    log(s, 'DB_STEAL', `Player ${st.initiator + 1} captures ${def(db, ball).name}`, st.initiator)
    checkDragonBallVictory(s, db)
    if (over(s)) return
  }
  finishSuccessful(s, db)
}

function finishSuccessful(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  resolveEffects({ s, db, user: st.initiator, source: st.label }, st.strike.effects.onHit)
  if (over(s)) return
  cleanup(s, db)
}

// Step 8
function cleanup(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  if (st.card) retire(s, st.card, def(db, st.card).effects.postResolution)
  if (st.defenseCard) retire(s, st.defenseCard, def(db, st.defenseCard).effects.postResolution)
  s.combat!.strike = null
}
