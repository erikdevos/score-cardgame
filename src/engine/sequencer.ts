// The 8-point battle sequencer for a single strike.
import { allyAbsorbs, applyDefense, attackTypeOf, autoStop, cardDefense, ongoingDamageChanges, powerDefense, requirementsMet, timingAllows, useShield, type DefenseOption } from './abilities'
import { isAttackRole, type CardDB, type StrikeDef } from './cards'
import { applyDamage, computeDamage, strikeCost } from './damage'
import { triggerFrames } from './effects/triggers'
import { canUseCard, checkDragonBallVictory, def, log, millCards, mpDef, over, retire, schedule, step, takeCard } from './state'
import { other, type CardInstance, type Frame, type GameState, type PlayerId } from './types'

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

/** How a card in hand or on the table would answer the current strike, if it can. */
export function defenseFor(s: GameState, db: CardDB, defender: PlayerId, c: CardInstance): DefenseOption | null {
  const attack = attackTypeOf(s.combat?.strike?.strike.combatRole)
  if (!attack) return null
  const d = def(db, c)
  const opt = cardDefense(d, attack)
  if (!opt || !canUseCard(s, db, defender, d) || !canPayCost(s, defender, opt.strike)) return null
  if (d.noStacking && s.combat!.usedCardIds.includes(d.id)) return null
  const effects = opt.strike.effects.onPlaySecondary
  return timingAllows(s, defender, effects, 'DEFEND') && requirementsMet(s, db, defender, effects, c) ? opt : null
}

/**
 * Cards that can answer the current strike: defense cards in hand or among the unused
 * Non-Combat cards on the table, combat effects printed with the defend icon, and
 * attack cards with an "or stops ..." alternative.
 */
export function legalDefenses(s: GameState, db: CardDB, defender: PlayerId): CardInstance[] {
  if (!s.combat?.strike) return []
  const pl = s.players[defender]
  // Non-Combat cards only block from the table, never straight from hand
  return [...pl.hand.filter(c => def(db, c).type !== 'Non-Combat'), ...pl.nonCombat].filter(c => defenseFor(s, db, defender, c))
}

/** The defender's personality power, if it can answer the current strike (once per combat). */
export function legalPowerDefense(s: GameState, db: CardDB, defender: PlayerId): DefenseOption | null {
  const opt = powerDefense(s, db, defender)
  return opt && canPayCost(s, defender, opt.strike) ? opt : null
}

/** Pays the cost; returns the power stages paid. */
function payCost(s: GameState, p: PlayerId, strike: StrikeDef): number {
  const cost = strikeCost(strike, s.rules)
  if (cost.type === 'POWER_STAGES') {
    s.players[p].mp.stage -= cost.amount
    return cost.amount
  }
  if (cost.type === 'LIFE_CARDS') millCards(s, p, cost.amount)
  return 0
}

const effectsFrame = (user: PlayerId, source: string, effects: StrikeDef['effects']['onHit'], card?: CardInstance | null): Frame =>
  ({ k: 'effects', user, source, card: card ?? undefined, effects: [...effects] })

/** Cards printed "play this right after the attacker pays their energy costs" (SS-39). */
export function reactionCards(s: GameState, db: CardDB, p: PlayerId): CardInstance[] {
  const pl = s.players[p]
  return [...pl.hand.filter(c => def(db, c).type !== 'Non-Combat'), ...pl.nonCombat].filter(c => {
    const d = def(db, c)
    const effects = d.effects.onPlaySecondary
    const isReaction = effects.some(e => e.action === 'CUSTOM' && e.handler === 'playTiming' && e.params?.when === 'afterOpponentPaysAttackCost')
    return isReaction && canUseCard(s, db, p, d) && requirementsMet(s, db, p, effects, c) && canPayCost(s, p, strikeOf(db, c))
  })
}

/** A reaction card is used: its effects resolve, then the strike carries on. */
export function react(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  const card = takeCard(s, p, iid)
  s.resolving.push(card)
  const d = def(db, card)
  log(s, 'REACT', `Player ${p + 1} reacts with ${d.name}`, p)
  payCost(s, p, strikeOf(db, card))
  schedule(s, effectsFrame(p, d.name, d.effects.onPlaySecondary, card), step('retire', { iid }))
}

/** Stack step: a card whose effects have resolved leaves play. */
export function retireResolved(s: GameState, db: CardDB, iid: string) {
  const i = s.resolving.findIndex(c => c.iid === iid)
  if (i < 0) return
  const [card] = s.resolving.splice(i, 1)
  retireUsed(s, db, card)
}

// Steps 1-4: declaration, costs, reactions, attacker secondaries, open the defend window.
export function beginStrike(s: GameState, db: CardDB, initiator: PlayerId, card: CardInstance | null, strike: StrikeDef, label: string) {
  const combat = s.combat!
  combat.strike = { initiator, card, strike, label, phase: 'AWAIT_DEFENSE', defenseCard: null, defense: null, lifeCardsDealt: 0, paidStages: 0 }
  if (card) combat.usedCardIds.push(card.defId)
  log(s, 'STRIKE', `Player ${initiator + 1} plays ${label}`, initiator)
  combat.strike.paidStages = payCost(s, initiator, strike)
  if (over(s)) return
  schedule(s,
    step('strike.react'),
    ...(isAttackRole(strike.combatRole) ? [step('strike.attackTrigger')] : []),
    effectsFrame(initiator, label, strike.effects.onPlaySecondary, card),
    step('strike.afterSecondaries'))
}

/** Stack step: after the attacker pays an energy cost, the defender may react. */
export function strikeReact(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  if (!st.paidStages) return
  const defender = other(st.initiator)
  const iids = reactionCards(s, db, defender).map(c => c.iid)
  if (iids.length) s.pendingChoice = { kind: 'WINDOW', player: defender, window: 'REACT', iids }
}

export function strikeAttackTrigger(s: GameState, db: CardDB) {
  schedule(s, ...triggerFrames(s, db, { kind: 'attackPhase', player: s.combat!.strike!.initiator }))
}

/** Stack step: the attacker's secondary effects have resolved. */
export function strikeAfterSecondaries(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  if (!isAttackRole(st.strike.combatRole)) return cleanup(s, db)
  const defender = other(st.initiator)
  const stopper = autoStop(s, db, defender, attackTypeOf(st.strike.combatRole)!)
  if (stopper) {
    log(s, 'AUTO_STOP', `${stopper} stops ${st.label} automatically`, defender)
    st.defense = { mode: 'STOP', stages: 0, lifeCards: 0 }
    return resolveHit(s, db)
  }
  if (legalDefenses(s, db, defender).length > 0 || legalPowerDefense(s, db, defender)) s.pendingChoice = { kind: 'DEFEND', player: defender }
  else resolveHit(s, db)
}

export function defend(s: GameState, db: CardDB, iid: string | null) {
  const st = s.combat!.strike!
  s.pendingChoice = null
  const defender = other(st.initiator)
  const opt = iid ? defenseFor(s, db, defender, [...s.players[defender].hand, ...s.players[defender].nonCombat].find(c => c.iid === iid)!)! : null
  const card = iid ? takeCard(s, defender, iid) : null
  st.defenseCard = card
  if (card && opt) {
    st.defense = opt.defense
    s.combat!.usedCardIds.push(card.defId)
    log(s, 'DEFEND', `Player ${defender + 1} defends with ${def(db, card).name}`, defender)
    payCost(s, defender, opt.strike)
    if (over(s)) return
    // Step 5: defender secondaries (they may still change st.defense, e.g. "prevents all but 1 life card")
    return schedule(s, effectsFrame(defender, def(db, card).name, opt.strike.effects.onPlaySecondary, card), step('strike.resolveHit'))
  }
  log(s, 'DEFEND', `Player ${defender + 1} takes the attack`, defender)
  resolveHit(s, db)
}

/** Block with the defender's personality power instead of a card. */
export function defendWithPower(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  s.pendingChoice = null
  const defender = other(st.initiator)
  const opt = legalPowerDefense(s, db, defender)!
  const mp = mpDef(s, db, defender)
  const power = mp.personality!.power!
  s.combat!.usedPowers.push(`${defender}:${mp.id}`)
  st.defense = opt.defense
  log(s, 'DEFEND', `Player ${defender + 1} defends with ${mp.name}'s power: ${power.name}`, defender)
  payCost(s, defender, opt.strike)
  if (over(s)) return
  // a power used as a defense does not make its attack half ("two physical attacks ... or a defense")
  const secondaries = opt.strike.effects.onPlaySecondary.filter(e => !(e.action === 'CUSTOM' && e.handler === 'extraAttack'))
  schedule(s, effectsFrame(defender, power.name, secondaries), step('strike.resolveHit'))
}

// Steps 6-7: hit check, damage, Dragon Ball capture.
export function resolveHit(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  const defender = other(st.initiator)
  const type = attackTypeOf(st.strike.combatRole)!
  if (st.defense?.mode === 'STOP') {
    log(s, 'STOPPED', `${st.label} is stopped`)
    s.combat!.lastAttack[st.initiator] = { type, success: false }
    return cleanup(s, db)
  }

  // the attack is successful from here on; shields on the table answer that
  const shield = useShield(s, db, defender, type, false)
  if (shield) {
    log(s, 'STOPPED', `${shield} stops the successful ${st.label}`, defender)
    s.combat!.lastAttack[st.initiator] = { type, success: false }
    return cleanup(s, db)
  }

  let dmg = computeDamage(s, db, st.initiator, st.strike)
  if (st.defense) dmg = applyDefense(dmg, st.defense)
  dmg = ongoingDamageChanges(s, db, defender, type, dmg)
  if (dmg.lifeCards > 0) {
    const lc = useShield(s, db, defender, type, true)
    if (lc) {
      log(s, 'PROTECT', `${lc} stops the life card damage`, defender)
      dmg = { ...dmg, lifeCards: 0 }
    }
  }
  if ((dmg.stages > 0 || dmg.lifeCards > 0) && allyAbsorbs(s, db, defender)) dmg = { stages: 0, lifeCards: 0 }
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
  const type = attackTypeOf(st.strike.combatRole)!
  s.combat!.lastAttack[st.initiator] = { type, success: true }
  schedule(s, effectsFrame(st.initiator, st.label, st.strike.effects.onHit, st.card), step('strike.afterOnHit'))
}

/** Stack step: "if successful" effects done; now ongoing effects that answer a successful attack. */
export function strikeAfterOnHit(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  const type = attackTypeOf(st.strike.combatRole)!
  schedule(s, ...triggerFrames(s, db, { kind: 'afterReceivingSuccessfulAttack', player: other(st.initiator), attackType: type }), step('strike.cleanup'))
}

// Step 8
export function cleanup(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  if (st.card) retireUsed(s, db, st.card)
  if (st.defenseCard) retireUsed(s, db, st.defenseCard)
  s.combat!.strike = null
}

/** After use: back on the table if it has uses left this combat, else discarded or removed. */
export function retireUsed(s: GameState, db: CardDB, card: CardInstance) {
  const extra = s.combat?.extraUses
  if (extra && extra[card.iid] > 0) {
    extra[card.iid]--
    s.players[card.owner].nonCombat.push(card)
    return log(s, 'STAYS', `${def(db, card).name} stays on the table for another use this combat`, card.owner)
  }
  retire(s, card, def(db, card).effects.postResolution)
}
