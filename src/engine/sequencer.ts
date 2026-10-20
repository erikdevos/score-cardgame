// The 8-point battle sequencer for a single strike.
import { attachAfterAttack, attachAfterLifeDamage } from './attach'
import { canStopFocused, isFocused, allyAbsorbs, applyDefense, currentStrikeBlock, defenseShield, ownDamageBoost, constantPowerEffects, inPlayAnywhere, isConstantPower, strikeDefenseBlock, attackRestriction, attackTypeOf, autoStop, costFor, dragonBallsProtected, findCustom, isAutoOnly, powerOptions, tableEffects, cardDefense, ongoingDamageChanges, powerDefense, requirementsMet, timingAllows, useShield, type DefenseOption } from './abilities'
import { isAttackRole, isDefenseRole, type CardDB, type CardDef, type Effect, type StrikeDef } from './cards'
import { applyDamage, computeDamage, strikeCost } from './damage'
import { applyNewModifiers } from './damagemods'
import { resolveEffects } from './effects'
import { triggerFrames } from './effects/triggers'
import { canUseCard, changeStages, checkDragonBallVictory, controllingAlly, def, fighterStage, log, millCards, mpDef, over, retire, schedule, step, takeCard } from './state'
import { other, type CardInstance, type Frame, type GameState, type PlayerId } from './types'

/** AS-44: named cards cost extra life cards while such a Location is in play. */
function extraPlayCost(s: GameState, db: CardDB, strike: StrikeDef): number {
  if (!(strike as { named?: string }).named || !s.location) return 0
  return findCustom(def(db, s.location).effects.onEnterPlay, 'playCostModifier')
    .filter(m => m.cardFilter === 'named')
    .reduce((n, m) => n + Number((m.cost as { amount?: number } | undefined)?.amount ?? 0), 0)
}

export function canPayCost(s: GameState, db: CardDB, p: PlayerId, strike: StrikeDef, style?: string): boolean {
  const cost = costFor(s, db, p, strikeCost(strike, s.rules), strike.combatRole, style)
  const extra = extraPlayCost(s, db, strike)
  if (extra && s.players[p].lifeDeck.length <= extra + (cost.type === 'LIFE_CARDS' ? cost.amount : 0)) return false
  if (cost.type === 'POWER_STAGES') return fighterStage(s, p) >= cost.amount
  if (cost.type === 'LIFE_CARDS') return s.players[p].lifeDeck.length >= cost.amount
  return true
}

export function strikeOf(db: CardDB, c: CardInstance): StrikeDef {
  const d = def(db, c)
  return { combatRole: d.combatRole!, cost: d.cost, damage: d.damage, effects: d.effects, ...(d.named ? { named: d.named } : {}) } as StrikeDef
}

/** How a card in hand or on the table would answer the current strike, if it can. */
export function defenseFor(s: GameState, db: CardDB, defender: PlayerId, c: CardInstance): DefenseOption | null {
  const attack = attackTypeOf(s.combat?.strike?.strike.combatRole)
  if (!attack) return null
  const d = def(db, c)
  const opt = cardDefense(d, attack) ?? attackAsDefense(s, db, defender, d, attack)
  // focused attacks cannot be stopped by cards that stop both attack types
  if (opt?.strike.combatRole === 'DEFENSE_ANY' && isFocused(s.combat?.strike?.strike) && !canStopFocused(d)) return null
  if (!opt || !canUseCard(s, db, defender, d) || !canPayCost(s, db, defender, opt.strike)) return null
  if (d.noStacking && s.combat!.usedCardIds.includes(d.id)) return null
  const effects = opt.strike.effects.onPlaySecondary
  return timingAllows(s, defender, effects, 'DEFEND') && requirementsMet(s, db, defender, effects, c) ? opt : null
}

/** TS-74 (drill): an energy attack from hand, costs paid, stops an energy attack; the attacker takes 1 life card. */
function attackAsDefense(s: GameState, db: CardDB, defender: PlayerId, d: CardDef, attack: 'PHYSICAL' | 'ENERGY'): DefenseOption | null {
  if (d.combatRole !== 'ATTACK_ENERGY' || attack !== 'ENERGY') return null
  const drill = tableEffects(s, db, defender, 'attackAsDefense')[0]
  if (!drill) return null
  const base: StrikeDef = { combatRole: d.combatRole, cost: d.cost, damage: d.damage, effects: d.effects }
  const hurt: Effect = { action: 'DISCARD_LIFE', target: 'OPPONENT', amount: Number(drill.params.opponentLifeCards ?? 1) }
  return {
    strike: { ...base, combatRole: 'DEFENSE_ENERGY', cost: strikeCost(base, s.rules), effects: { ...d.effects, onPlaySecondary: [...d.effects.onPlaySecondary, hurt] } },
    defense: { mode: 'STOP', stages: 0, lifeCards: 0 },
  }
}

/** TS-185: "to stop this attack, your opponent must play 2 cards that stop physical attacks" */
export const defensesNeeded = (s: GameState) => Number(findCustom(s.combat?.strike?.strike.effects.onPlaySecondary ?? [], 'requireMultipleDefenses')[0]?.count ?? 1)

/**
 * Cards that can answer the current strike: defense cards in hand or among the unused
 * Non-Combat cards on the table, combat effects printed with the defend icon, and
 * attack cards with an "or stops ..." alternative.
 */
export function legalDefenses(s: GameState, db: CardDB, defender: PlayerId): CardInstance[] {
  if (!s.combat?.strike) return []
  const block = currentStrikeBlock(s, db)
  if (block.cards) return []
  const pl = s.players[defender]
  // Non-Combat cards only block from the table, never straight from hand
  const cards = [...pl.hand.filter(c => def(db, c).type !== 'Non-Combat'), ...pl.nonCombat]
    .filter(c => !(block.combatCards && ['Physical Combat', 'Energy Combat', 'Combat'].includes(def(db, c).type)))
    .filter(c => defenseFor(s, db, defender, c))
  return cards.length >= defensesNeeded(s) ? cards : []
}

/** The defender's personality power, if it can answer the current strike (once per combat). */
export function legalPowerDefense(s: GameState, db: CardDB, defender: PlayerId): DefenseOption | null {
  if (currentStrikeBlock(s, db).power || defensesNeeded(s) > 1 || s.combat?.lockdown) return null
  const opt = powerDefense(s, db, defender)
  if (opt?.strike.combatRole === 'DEFENSE_ANY' && isFocused(s.combat?.strike?.strike)) return null
  return opt && canPayCost(s, db, defender, opt.strike) ? opt : null
}

/** The personality power p can use as an attack (or in place of one) right now, if any. */
export function attackPowerOption(s: GameState, db: CardDB, p: PlayerId) {
  const mp = mpDef(s, db, p)
  if (s.combat!.usedPowers.includes(`${p}:${mp.id}`) || s.combat!.lockdown) return null
  return powerOptions(s, db, p).find(power => {
    const st = power.strike
    const effects = st.effects.onPlaySecondary
    if (isDefenseRole(st.combatRole) || findCustom(effects, 'powerDefense').length || isAutoOnly(effects) || isConstantPower(st)) return false
    if (findCustom(effects, 'usageLimit').some(u => u.per === 'game') && s.usedPerGame.includes(`${p}:${mp.id}`)) return false
    if (attackRestriction(s, p, st.combatRole, false)) return false
    return timingAllows(s, p, effects, 'ATTACK') && requirementsMet(s, db, p, effects) && canPayCost(s, db, p, st)
  }) ?? null
}

/** Pays the cost; returns the power stages paid. */
function payCost(s: GameState, db: CardDB, p: PlayerId, strike: StrikeDef, style?: string): number {
  const cost = costFor(s, db, p, strikeCost(strike, s.rules), strike.combatRole, style)
  const extra = extraPlayCost(s, db, strike)
  if (extra) {
    millCards(s, p, extra, db)
    log(s, 'COST', `Player ${p + 1} pays ${extra} extra life card(s) for a named card`, p)
  }
  if (cost.type === 'POWER_STAGES') {
    changeStages(s, p, -cost.amount)
    return cost.amount
  }
  if (cost.type === 'LIFE_CARDS') millCards(s, p, cost.amount, db)
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
    return isReaction && canUseCard(s, db, p, d) && requirementsMet(s, db, p, effects, c) && canPayCost(s, db, p, strikeOf(db, c))
  })
}

/** A reaction card is used: its effects resolve, then the strike carries on. */
export function react(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  const card = takeCard(s, p, iid)
  s.resolving.push(card)
  const d = def(db, card)
  log(s, 'REACT', `Player ${p + 1} reacts with ${d.name}`, p)
  payCost(s, db, p, strikeOf(db, card))
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
  combat.strikeSeq++
  combat.strike = { initiator, card, strike, label, phase: 'AWAIT_DEFENSE', defenseCard: null, defense: null, lifeCardsDealt: 0, paidStages: 0, mods: [], seq: combat.strikeSeq }
  { const t = attackTypeOf(strike.combatRole); if (t) attachAfterAttack(s, db, initiator, t, false) }
  if (card) combat.usedCardIds.push(card.defId)
  log(s, 'STRIKE', `Player ${initiator + 1} plays ${label}`, initiator)
  combat.strike.paidStages = payCost(s, db, initiator, strike, card ? def(db, card).style : undefined)
  // BB-3, BB-40: effects granted to this player's attacks for the rest of the combat
  for (const g of combat.grants.filter(x => x.player === initiator && conditionMet(s, db, initiator, x.condition))) {
    const st = combat.strike
    st.strike = g.kind === 'focused'
      ? { ...st.strike, effects: { ...st.strike.effects, onPlaySecondary: [...st.strike.effects.onPlaySecondary, { action: 'CUSTOM', handler: 'focused' }] } }
      : { ...st.strike, effects: { ...st.strike.effects, onHit: [...st.strike.effects.onHit, ...g.effects] } }
    log(s, 'GRANT', `${label} gains ${g.kind === 'focused' ? 'focused' : 'an "if successful" effect'}`, initiator)
  }
  // AS-24: a personality power that was switched off until its owner performs an energy attack
  if (attackTypeOf(strike.combatRole) === 'ENERGY') s.powerLocks = s.powerLocks.filter(l => !(l.player === initiator && l.until === 'performsEnergyAttack'))
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
  const stopper = autoStop(s, db, defender, attackTypeOf(st.strike.combatRole)!, isFocused(st.strike))
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
    if (st.strike.combatRole === 'ATTACK_PHYSICAL') s.combat!.defended[defender] = { strike: st.strike, label: st.label }
    log(s, 'DEFEND', `Player ${defender + 1} defends with ${def(db, card).name}`, defender)
    // TS-185: the extra stopping cards needed go to the discard pile with it
    for (let i = 1; i < defensesNeeded(s); i++) {
      const extra = legalDefenses(s, db, defender).find(c => s.players[defender].hand.includes(c))
      if (!extra) break
      s.players[defender].discard.push(takeCard(s, defender, extra.iid))
      log(s, 'DEFEND', `Player ${defender + 1} also plays ${def(db, extra).name}`, defender)
    }
    payCost(s, db, defender, opt.strike)
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
  payCost(s, db, defender, opt.strike)
  if (over(s)) return
  // a power used as a defense does not make its attack half ("two physical attacks ... or a defense")
  const secondaries = opt.strike.effects.onPlaySecondary.filter(e => !(e.action === 'CUSTOM' && e.handler === 'extraAttack'))
  schedule(s, effectsFrame(defender, power.name, secondaries), step('strike.resolveHit'))
}

/** An ally takes the power stage damage; what it cannot take, and all life card damage, comes off the life deck. */
function applyDamageToAlly(s: GameState, db: CardDB, p: PlayerId, ally: { card: CardInstance; stage: number }, d: { stages: number; lifeCards: number }): number {
  const paid = Math.min(ally.stage, d.stages)
  ally.stage -= paid
  log(s, 'DAMAGE', `${def(db, ally.card).name} takes ${paid} stage(s) of damage`, p)
  const life = d.lifeCards + d.stages - paid
  return life > 0 ? millCards(s, p, life, db) : 0
}

/** FS-37, FS-96: "even if stopped, the defender takes ..." */
function damageIfStopped(s: GameState, db: CardDB, strike: StrikeDef, defender: PlayerId, label: string) {
  for (const p of findCustom(strike.effects.onPlaySecondary, 'damageIfStopped')) {
    const d = { stages: Number(p.stages ?? 0), lifeCards: Number(p.lifeCards ?? 0) }
    if (!d.stages && !d.lifeCards) continue
    log(s, 'DAMAGE', `Player ${defender + 1} takes ${d.stages} stage(s) and ${d.lifeCards} life card(s) from the stopped ${label}`, defender)
    applyDamage(s, defender, d, db)
  }
  // AS-2: "if this attack is stopped, ..." runs for the attacker
  for (const p of findCustom(strike.effects.onPlaySecondary, 'ifStopped')) {
    resolveEffects({ s, db, user: other(defender), source: label }, (p.then ?? []) as Effect[])
  }
}

// Steps 6-7: hit check, damage, Dragon Ball capture.
export function resolveHit(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  const defender = other(st.initiator)
  const type = attackTypeOf(st.strike.combatRole)!
  const style = st.card ? def(db, st.card).style : undefined
  if (st.defense?.mode === 'STOP') {
    log(s, 'STOPPED', `${st.label} is stopped`)
    s.combat!.lastAttack[st.initiator] = { type, success: false }
    damageIfStopped(s, db, st.strike, defender, st.label)
    schedule(s, ...triggerFrames(s, db, { kind: 'afterOpponentStopsAttack', player: st.initiator, attackType: type }))
    return cleanup(s, db)
  }
  // Step 6 (Trunks Saga): the defender's Defense Shields answer an attack that was not stopped
  const ds = defenseShield(s, db, defender, type, isFocused(st.strike))
  if (ds) {
    log(s, 'STOPPED', `${ds} stops ${st.label}`, defender)
    s.combat!.lastAttack[st.initiator] = { type, success: false }
    damageIfStopped(s, db, st.strike, defender, st.label)
    return cleanup(s, db)
  }

  // the attack is successful from here on; shields on the table answer that
  const shield = useShield(s, db, defender, type, false)
  if (shield) {
    log(s, 'STOPPED', `${shield} stops the successful ${st.label}`, defender)
    s.combat!.lastAttack[st.initiator] = { type, success: false }
    damageIfStopped(s, db, st.strike, defender, st.label)
    return cleanup(s, db)
  }

  let dmg = computeDamage(s, db, st.initiator, st.strike)
  const boost = ownDamageBoost(s, db, st.initiator, type, style)
  if (boost.sources.length) {
    dmg = { stages: dmg.stages + boost.stages, lifeCards: dmg.lifeCards + boost.lifeCards }
    log(s, 'DAMAGE_X', `${[...new Set(boost.sources)].join(', ')}: more damage`, st.initiator)
  }
  const unreduced = dmg
  if (st.defense) dmg = applyDefense(dmg, st.defense)
  dmg = ongoingDamageChanges(s, db, defender, type, dmg)
  dmg = applyNewModifiers(s, db, st, type, dmg)
  if (st.unpreventable) dmg = { stages: Math.max(dmg.stages, unreduced.stages), lifeCards: Math.max(dmg.lifeCards, unreduced.lifeCards) }
  if (dmg.lifeCards > 0) {
    const lc = useShield(s, db, defender, type, true)
    if (lc) {
      log(s, 'PROTECT', `${lc} stops the life card damage`, defender)
      dmg = { ...dmg, lifeCards: 0 }
    }
  }
  if ((dmg.stages > 0 || dmg.lifeCards > 0) && allyAbsorbs(s, db, defender)) dmg = { stages: 0, lifeCards: 0 }
  dmg = creatureOnTable(s, db, defender, type, dmg)
  if (st.noLifeCards) dmg = { ...dmg, lifeCards: 0 }
  st.pendingDamage = dmg
  // Trunks Saga: the defender chooses whether the main personality or an ally takes the power stage damage
  const allies = s.players[defender].allies.filter(a => a.stage > 0)
  if (s.rules.trunks.allyRules && dmg.stages > 0 && allies.length) {
    const options = [`Main personality (stage ${s.players[defender].mp.stage})`, ...allies.map(a => `${def(db, a.card).name} (stage ${a.stage})`)]
    const data = Object.fromEntries(allies.map((a, i) => [String(i + 1), a.card.iid]))
    return schedule(s,
      { k: 'choice', q: { kind: 'OPTION', player: defender, source: st.label, prompt: `${st.label} hits for ${dmg.stages} stage(s): who takes the damage?`, options, purpose: 'damageTarget', data } },
      step('strike.applyDamage'))
  }
  dealDamage(s, db)
}

/** Steps 10-13 continued: deal the damage to the chosen personality, then the Dragon Ball capture. */
export function dealDamage(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  const defender = other(st.initiator)
  const type = attackTypeOf(st.strike.combatRole)!
  const dmg = st.pendingDamage ?? { stages: 0, lifeCards: 0 }
  const ally = st.damageTo ? s.players[defender].allies.find(a => a.card.iid === st.damageTo) : controllingAlly(s, defender)
  const stageBefore = ally ? ally.stage : s.players[defender].mp.stage
  st.lifeCardsDealt = ally ? applyDamageToAlly(s, db, defender, ally, dmg) : applyDamage(s, defender, dmg, db, st.noLifeCards)
  s.combat!.lastLifeLost = st.lifeCardsDealt
  if (over(s)) return
  attachAfterLifeDamage(s, db, defender, st.lifeCardsDealt)
  attachAfterAttack(s, db, st.initiator, type, true)
  afterDamage(s, db, defender, stageBefore - (ally ? ally.stage : s.players[defender].mp.stage), st.lifeCardsDealt)
  if (over(s)) return

  if (st.lifeCardsDealt >= s.rules.dragonBallCaptureLifeCards && s.players[defender].dragonBalls.length > 0 && !dragonBallsProtected(s, db, defender)) {
    // FS-P12 (Constant Combat Power): 6+ life cards with an energy attack captures 2 Dragon Balls
    const double = type === 'ENERGY' && constantPowerEffects(s, db, st.initiator, 'stealOrCaptureDragonBall')
      .some(e => st.lifeCardsDealt >= Number((e.condition as { minLifeCards?: number } | undefined)?.minLifeCards ?? 99))
    st.captures = double ? 2 : 1
    st.phase = 'AWAIT_DB_STEAL'
    s.pendingChoice = { kind: 'DB_STEAL', player: st.initiator }
    return
  }
  finishSuccessful(s, db)
}

/** SS-226 takes physical damage for its owner; an energy attack kills it (and still hits). SS-227 dies to energy too. */
function creatureOnTable(s: GameState, db: CardDB, defender: PlayerId, type: 'PHYSICAL' | 'ENERGY', dmg: { stages: number; lifeCards: number }) {
  const pl = s.players[defender]
  for (const h of ['damageAbsorber', 'recurringDamage']) {
    for (const { card } of tableEffects(s, db, defender, h)) {
      if (type === 'ENERGY') {
        pl.nonCombat = pl.nonCombat.filter(c => c !== card)
        retire(s, card, def(db, card).effects.postResolution === 'STAYS' ? 'DISCARD' : def(db, card).effects.postResolution)
        log(s, 'DESTROYED', `${def(db, card).name} is destroyed by the energy attack`, defender)
      } else if (h === 'damageAbsorber') {
        log(s, 'PROTECT', `${def(db, card).name} takes the physical damage`, defender)
        dmg = { stages: 0, lifeCards: 0 }
      }
    }
  }
  return dmg
}

/** Effects of damage taken in combat: retaliation drills, "take the first discarded card", anger locks. */
function afterDamage(s: GameState, db: CardDB, defender: PlayerId, stagesLost: number, lifeLost: number) {
  const st = s.combat!.strike!
  const foe = st.initiator
  for (const { card, params } of tableEffects(s, db, defender, 'retaliationDrain')) {
    const lost = params.per === 'lifeCard' ? lifeLost : stagesLost
    const n = params.per === 'attack'
      ? (stagesLost >= Number(params.minStages ?? 1) ? Math.abs(Number(params.opponentStages ?? -1)) : 0)
      : Math.floor(lost / Number(params.every ?? 1)) * Math.abs(Number(params.opponentStages ?? -1))
    if (n <= 0) continue
    changeStages(s, foe, -n)
    log(s, 'STAGES', `${def(db, card).name}: player ${foe + 1} loses ${n} power stage(s)`, foe)
  }
  // TS-59 (villains): the attacker takes twice the life cards the main personality took
  for (const { card, params } of tableEffects(s, db, defender, 'reflectDamage')) {
    if (lifeLost <= 0 || mpDef(s, db, defender).personality!.alignment !== 'Villain') continue
    const n = millCards(s, foe, lifeLost * Number(params.multiplier ?? 2), db)
    log(s, 'MILL', `${def(db, card).name}: player ${foe + 1} discards ${n} life card(s)`, foe)
    if (over(s)) return
  }
  if (st.takeFirstMilled === defender && lifeLost > 0) {
    const pile = s.players[defender].discard
    const [first] = pile.splice(pile.length - lifeLost, 1)
    s.players[defender].hand.push(first)
    log(s, 'MOVE', `Player ${defender + 1} takes ${def(db, first).name} into their hand`, defender)
  }
  if (lifeLost > 0 && s.angerLock.includes(foe)) {
    s.angerLock = s.angerLock.filter(x => x !== foe)
    log(s, 'ANGER', `Player ${foe + 1}'s anger can rise again`, foe)
  }
}

/** SS-133: repeat the physical attack you defended against this combat, once per combat. */
export function copyableAttack(s: GameState, db: CardDB, p: PlayerId) {
  const c = s.combat
  const saved = c?.defended[p]
  if (!c || !saved || c.onceKeys.includes(`copy:${p}`) || !tableEffects(s, db, p, 'copyDefendedAttack').length) return null
  if (attackRestriction(s, p, saved.strike.combatRole, false) || !canPayCost(s, db, p, saved.strike)) return null
  return saved
}

export function copyAttack(s: GameState, db: CardDB, p: PlayerId) {
  const saved = copyableAttack(s, db, p)!
  s.combat!.onceKeys.push(`copy:${p}`)
  s.combat!.consecutivePasses = 0
  beginStrike(s, db, p, null, saved.strike, `Copy of ${saved.label}`)
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
    checkDragonBallVictory(s, db, 'capture')
    if (over(s)) return
    st.captures = (st.captures ?? 1) - 1
    if (st.captures > 0 && s.players[other(st.initiator)].dragonBalls.length) {
      s.pendingChoice = { kind: 'DB_STEAL', player: st.initiator }
      return
    }
  }
  finishSuccessful(s, db)
}

function finishSuccessful(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  const type = attackTypeOf(st.strike.combatRole)!
  s.combat!.lastAttack[st.initiator] = { type, success: true }
  s.combat!.onceKeys.push(`hit:${st.initiator}:${type}`)
  schedule(s, effectsFrame(st.initiator, st.label, st.strike.effects.onHit, st.card), step('strike.afterOnHit'))
}

/** Stack step: "if successful" effects done; now ongoing effects that answer a successful attack. */
export function strikeAfterOnHit(s: GameState, db: CardDB) {
  const st = s.combat!.strike!
  const type = attackTypeOf(st.strike.combatRole)!
  schedule(s,
    ...triggerFrames(s, db, { kind: 'afterOwnSuccessfulAttack', player: st.initiator, attackType: type, style: st.card ? def(db, st.card).style : undefined }),
    ...triggerFrames(s, db, { kind: 'afterReceivingSuccessfulAttack', player: other(st.initiator), attackType: type }),
    step('strike.cleanup'))
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
  // FS-119: "if Dragon Ball 7 is in play, discard instead of removing from game"
  const alt = findCustom(def(db, card).effects.onEnterPlay, 'conditionalPostResolution')[0]
  const condition = alt?.condition as { inPlay?: string } | undefined
  if (alt && condition?.inPlay && inPlayAnywhere(s, db, { cardName: condition.inPlay })) return retire(s, card, alt.postResolution as 'DISCARD' | 'REMOVE' | 'STAYS')
  retire(s, card, def(db, card).effects.postResolution)
}

/** Conditions of granted effects: "opponentNoDrills", { ownDrillsInPlay: { style, min } }; no condition = always. */
function conditionMet(s: GameState, db: CardDB, p: PlayerId, c: unknown): boolean {
  if (!c) return true
  if (c === 'opponentNoDrills') return s.players[other(p)].drills.length === 0
  const own = (c as { ownDrillsInPlay?: { style?: string; min?: number } }).ownDrillsInPlay
  if (own) return s.players[p].drills.filter(d => !own.style || def(db, d).style === own.style).length >= (own.min ?? 1)
  return false
}
