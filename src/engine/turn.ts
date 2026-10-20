import { attachUpkeep, attachmentSources } from './attach'
import { drillsProtected, endAttackPhase, findCustom, newCombat, requirementsMet, tableEffects, timingAllows } from './abilities'
import type { CardDB, StrikeDef } from './cards'
import { autoPowerFrames, triggerFrames } from './effects/triggers'
import { shuffleInPlace } from './rng'
import { attackPowerOption, beginStrike, react, strikeOf } from './sequencer'
import { canUseCard, constantParams, changeStages, checkDragonBallVictory, checkMostPowerful, def, drawCards, win, handLimit, isOnTable, log, mpDef, over, pur, removeFromHand, retire, schedule, step, takeCard, millCards } from './state'
import { other, type Frame, type GameState, type PlayerId } from './types'

// Step 1
export function startTurn(s: GameState, db: CardDB) {
  s.step = 'NON_COMBAT'
  s.noMasteryTurn = []
  s.locationPlayedThisTurn = false
  s.combat = null
  s.combatSkipped = false
  log(s, 'TURN', `Turn ${s.turn}: player ${s.attacker + 1} attacks`, s.attacker)
  // TS-157: a postponed victory is checked again now
  for (const w of s.postponedWins.filter(x => x.player === s.attacker && x.turn <= s.turn)) {
    s.postponedWins = s.postponedWins.filter(x => x !== w)
    const foe = s.players[w.player === 0 ? 1 : 0]
    if (w.reason === 'SURVIVAL' && !foe.lifeDeck.length) win(s, w.player, 'SURVIVAL')
    if (w.reason === 'MPP' && s.players[w.player].mp.levelIndex === s.players[w.player].mp.stack.length - 1) win(s, w.player, 'MPP')
  }
  // BU-111: the player who attacked with it loses now
  for (const l of s.loseAt.filter(x => x.player === other(s.attacker) && x.turn <= s.turn)) {
    s.loseAt = s.loseAt.filter(x => x !== l)
    log(s, 'GAME', `Player ${l.player + 1} loses: the Sacrifice catches up`, l.player)
    win(s, s.attacker, 'SURVIVAL')
  }
  // Trunks Saga: a set of 7 completed by capture wins now, if the player still has it
  // (also catches a win that FS-P1 held back)
  checkDragonBallVictory(s, db, 'turnStart')
  if (s.rules.trunks.mostPowerfulByHighestLevel) checkMostPowerful(s, db, s.attacker)
  if (over(s)) return
  drawCards(s, s.attacker, s.rules.drawPerTurn)
  // BU-127: an attached card makes the host discard life cards at the beginning of the turn
  for (const e of attachUpkeep(s, db, s.attacker)) if (e.action === 'DISCARD_LIFE') millCards(s, s.attacker, e.amount, db)
  runDelayed(s, db)
  // FS-67: drills that act "at the beginning of every turn"
  schedule(s, ...triggerFrames(s, db, { kind: 'turnStart' }))
}

/** "On his next turn, he takes his highest level Saibaimen and puts it into play as an ally." */
function runDelayed(s: GameState, db: CardDB) {
  const due = s.delayed.filter(x => x.turn === s.turn && x.player === s.attacker)
  s.delayed = s.delayed.filter(x => !due.includes(x))
  for (const x of due) {
    // ruling: the Saibaimen comes from the life deck, which is shuffled afterwards
    const pl = s.players[x.player]
    const candidates = pl.lifeDeck.filter(c => def(db, c).personality?.character === x.character)
    if (!candidates.length) {
      log(s, 'NO_EFFECT', `${x.source}: no ${x.character} card in the life deck`, x.player)
      continue
    }
    const best = [...candidates].sort((a, b) => def(db, b).personality!.level - def(db, a).personality!.level)[0]
    pl.lifeDeck.splice(pl.lifeDeck.indexOf(best), 1)
    s.rngSeed = shuffleInPlace(pl.lifeDeck, s.rngSeed)
    pl.allies.push({ card: best, stage: s.rules.allyStartStage })
    log(s, 'PLANT', `${x.source}: ${def(db, best).name} enters play as an ally`, x.player)
  }
}

// Step 2
export function playNonCombat(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  const card = removeFromHand(s, p, iid)
  const d = def(db, card)
  const pl = s.players[p]
  if (d.type === 'Non-Combat') {
    // Placed face up; its power stays available until used (now, or later in combat).
    pl.nonCombat.push(card)
    if (findCustom(d.effects.onEnterPlay, 'postponeVictory').length) s.victoryGuards.push(card.iid)
    if (findCustom(d.effects.onEnterPlay, 'preventSurvivalVictory').length) s.rescueCards.push(card.iid)
    return log(s, 'PLACE', `Player ${p + 1} places ${d.name} on the table`, p)
  }
  log(s, 'PLAY', `Player ${p + 1} plays ${d.name}`, p)
  switch (d.type) {
    case 'Personality': {
      // Trunks Saga: a higher level of an ally you have goes on top of it at its highest power stage
      const lower = s.rules.trunks.allyRules ? pl.allies.find(a => def(db, a.card).personality?.character === d.personality?.character) : undefined
      if (lower) {
        pl.discard.push(lower.card)
        lower.card = card
        lower.stage = s.rules.maxStage
        log(s, 'ALLY_UP', `${d.name} replaces the lower level and powers up to full`, p)
      } else pl.allies.push({ card, stage: s.rules.allyStartStage })
      break
    }
    case 'Drill':
      // a new drill of a restricted style knocks out the restricted drills of that style
      for (const other of s.players) {
        if (drillsProtected(s, db, other.id)) continue
        const out = other.drills.filter(c => d.style && def(db, c).exclusiveDrillStyle === d.style)
        if (!out.length) continue
        other.drills = other.drills.filter(c => !out.includes(c))
        other.discard.push(...out)
        out.forEach(c => log(s, 'DISCARD', `${def(db, c).name} is discarded: another ${d.style} drill entered play`, other.id))
      }
      pl.drills.push(card)
      break
    case 'Dragon Ball':
      pl.dragonBalls.push(card)
      // AS-36: the card attached to this player's main personality is discarded
      for (const l of s.powerLocks.filter(x => x.player === p && x.until === 'opponentPlaysDragonBall')) {
        const holder = s.players[other(p)]
        const i = holder.nonCombat.findIndex(c => c.iid === l.cardIid)
        if (i >= 0) holder.discard.push(...holder.nonCombat.splice(i, 1))
        log(s, 'DISCARD', `Player ${p + 1} places a Dragon Ball: the attached card is discarded and the power works again`, p)
      }
      s.powerLocks = s.powerLocks.filter(x => !(x.player === p && x.until === 'opponentPlaysDragonBall'))
      break
    case 'Location':
    case 'Battleground':
      if (s.location) retire(s, s.location, 'DISCARD')
      s.location = card
      s.locationPlayedThisTurn = true
      break
  }
  schedule(s, { k: 'effects', user: p, source: d.name, card, effects: [...d.effects.onEnterPlay] }, ...(d.type === 'Dragon Ball' ? [step('dbCheck')] : []))
}

/**
 * Use the power of an unused Non-Combat card on the table that is not an attack or block.
 * `free`: an "at any time" or end-of-turn use, which does not count as the player's attack phase.
 */
export function useNonCombat(s: GameState, db: CardDB, p: PlayerId, iid: string, free = false) {
  const card = takeCard(s, p, iid)
  s.resolving.push(card)
  const d = def(db, card)
  log(s, 'USE', `Player ${p + 1} uses ${d.name}`, p)
  if (s.combat) {
    if (!free) s.combat.consecutivePasses = 0
    s.combat.usedCardIds.push(d.id)
  }
  schedule(s, { k: 'effects', user: p, source: d.name, card, effects: [...d.effects.onEnterPlay] }, step('retire', { iid }))
}

export function checkDragonBalls(s: GameState, db: CardDB) {
  checkDragonBallVictory(s, db)
}

/** PLAY_CARD dispatch: place or play from hand, or use a Non-Combat card already on the table. */
export function playCard(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  const onTable = isOnTable(s, p, iid)
  const role = def(db, (onTable ? s.players[p].nonCombat : s.players[p].hand).find(c => c.iid === iid)!).combatRole
  if (s.step === 'COMBAT' && !onTable && def(db, s.players[p].hand.find(c => c.iid === iid)!).type === 'Non-Combat') {
    // AS-125: once per combat, a Non-Combat card is placed in place of an attack
    s.combat!.onceKeys.push(`instead:${p}`)
    s.combat!.consecutivePasses = 0
    return playNonCombat(s, db, p, iid)
  }
  if (s.step === 'COMBAT' && !onTable && def(db, s.players[p].hand.find(c => c.iid === iid)!).type === 'Personality') {
    // CG-100: in place of an attack, an Ally from the hand is placed at 3 power stages above 0
    s.combat!.onceKeys.push(`ally-instead:${p}`)
    s.combat!.consecutivePasses = 0
    playNonCombat(s, db, p, iid)
    const ally = s.players[p].allies.find(a => a.card.iid === iid)
    if (ally) ally.stage = Math.max(ally.stage, 3)
    return
  }
  if (s.step === 'COMBAT') return onTable && !role ? useNonCombat(s, db, p, iid) : playCombatCard(s, db, p, iid)
  return onTable ? useNonCombat(s, db, p, iid) : playNonCombat(s, db, p, iid)
}

// Step 3, then step 4 (or straight to discard when a location was played)
export function endNonCombat(s: GameState, db: CardDB) {
  const p = s.attacker
  const gain = pur(s, db, p)
  changeStages(s, p, gain)
  // BU-115 (allies gain their PUR instead of 1), BU-130 (+1 per Dragon Ball you control, on top)
  const mods = constantParams(s, db, p, 'modifyPowerUpGain').filter(m => m.scope === 'ALLIES')
  for (const a of s.players[p].allies) {
    let up = s.rules.allyPowerUp
    if (mods.some(m => m.instead && m.amount === 'PUR')) up = def(db, a.card).personality?.pur ?? up
    for (const m of mods) if (m.additional && m.amountPerDragonBall) up += Number(m.amountPerDragonBall) * s.players[p].dragonBalls.length
    a.stage = Math.min(s.rules.maxStage, a.stage + up)
  }
  log(s, 'POWER_UP', `Player ${p + 1} powers up ${gain} (stage ${s.players[p].mp.stage})`, p)
  if (s.locationPlayedThisTurn) {
    log(s, 'NO_COMBAT', 'A location was played this turn, combat cannot be declared')
    s.combatSkipped = true
    return beginDiscardStep(s, db)
  }
  s.step = 'DECLARE'
}

export function declareCombat(s: GameState, db: CardDB) {
  const defender = other(s.attacker)
  log(s, 'DECLARE', `Player ${s.attacker + 1} declares combat`, s.attacker)
  s.step = 'COMBAT'
  s.combat = newCombat(s.attacker)
  s.combat.startLevels = s.players.map(pl => ({ stage: pl.mp.stage, anger: pl.mp.anger }))
  for (const x of s.discardAsLife) x.armed = true
  // SS-76: the very next combat this player is forced into ends before any damage
  if (s.endNextCombat.includes(defender)) {
    s.endNextCombat = s.endNextCombat.filter(x => x !== defender)
    s.combat.ended = true
    return log(s, 'END_COMBAT', `Player ${defender + 1}'s Dragon Ball ends the combat before any damage`, defender)
  }
  defenderDraw(s, db, defender)
  if (over(s)) return
  // SS-227: a creature that hurts the foe in every combat its owner attacks in
  for (const { card, params } of tableEffects(s, db, s.attacker, 'recurringDamage')) {
    const n = millCards(s, defender, Number(params.lifeCards ?? 1), db)
    log(s, 'MILL', `${def(db, card).name}: player ${defender + 1} discards ${n} life card(s)`, defender)
    if (over(s)) return
  }
  const frames: Frame[] = [...autoPowerFrames(s, db), ...triggerFrames(s, db, { kind: 'combatStart' })]
  // SS-149: shuffle a pile before the combat
  for (const p of [s.attacker, defender] as PlayerId[]) {
    for (const { card } of tableEffects(s, db, p, 'optionalShuffle')) {
      frames.unshift({ k: 'choice', q: { kind: 'OPTION', player: p, source: def(db, card).name, prompt: `${def(db, card).name}: shuffle a pile before combat?`, options: ['Shuffle life deck', 'Shuffle discard pile', 'No'], purpose: 'shuffle', data: {} } })
    }
  }
  schedule(s, ...frames)
}

/** The defender's combat draw; Honor Duel (draw mode) takes it from the bottom of the discard pile. */
function defenderDraw(s: GameState, db: CardDB, defender: PlayerId) {
  let n = s.rules.defenderCombatDraw
  // CS-176: "when you enter Combat as the attacker, your opponent draws 1 less card"
  if (!s.powerLocks.some(l => l.player === s.attacker)) {
    for (const m of findCustom(mpDef(s, db, s.attacker).personality!.power?.strike.effects.onPlaySecondary ?? [], 'modifyCombatDraw')) n = Math.max(0, n + Number(m.amount ?? 0))
  }
  const sub = s.discardAsLife.find(x => x.player === defender && x.armed && x.mode === 'DRAW' && x.remaining > 0)
  if (sub) {
    const pl = s.players[defender]
    const k = Math.min(sub.remaining, n, pl.discard.length)
    // discard pile: index 0 = bottom, last = top
    pl.hand.push(...(sub.position === 'top' ? pl.discard.splice(pl.discard.length - k, k).reverse() : pl.discard.splice(0, k)))
    sub.remaining -= k
    n -= k
    log(s, 'DRAW', `${sub.source}: player ${defender + 1} draws ${k} from the bottom of the discard pile`, defender)
  }
  if (n > 0) drawCards(s, defender, n)
}

/** "Skip the combat step of your next turn" applies to this turn's attacker. */
export function mustSkipCombat(s: GameState) {
  return s.skipCombat.some(k => k.player === s.attacker && k.turn === s.turn)
}

export function skipCombat(s: GameState, db: CardDB) {
  const forced = s.skipCombat.find(k => k.player === s.attacker && k.turn === s.turn)
  log(s, 'PASS_COMBAT', forced ? `Player ${s.attacker + 1} skips combat (${forced.source})` : `Player ${s.attacker + 1} does not declare combat`, s.attacker)
  s.skipCombat = s.skipCombat.filter(k => k.turn > s.turn)
  s.combatSkipped = true
  beginDiscardStep(s, db)
}

export function playCombatCard(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  const card = takeCard(s, p, iid)
  s.combat!.consecutivePasses = 0
  beginStrike(s, db, p, card, strikeOf(db, card), def(db, card).name)
}

export function usePower(s: GameState, db: CardDB, p: PlayerId, which = 0) {
  const d = mpDef(s, db, p)
  const power = attackPowerOption(s, db, p, which)!
  s.combat!.consecutivePasses = 0
  s.combat!.usedPowers.push(`${p}:${d.id}`)
  if (findCustom(power.strike.effects.onPlaySecondary, 'usageLimit').some(u => u.per === 'game')) s.usedPerGame.push(`${p}:${d.id}`)
  beginStrike(s, db, p, null, power.strike, `${d.name}'s power: ${power.name}`)
}

/** Trunks Saga Final Physical Attack: the discarded card pays for a plain PAT physical attack. */
export const FINAL_PHYSICAL_ATTACK: StrikeDef = {
  combatRole: 'ATTACK_PHYSICAL',
  damage: { calculation: 'PAT', stages: 0, lifeCards: 0, modifierStages: 0, modifierLifeCards: 0 },
  effects: { onPlaySecondary: [], onHit: [], onEnterPlay: [], postResolution: 'DISCARD' },
}

export function finalPhysicalAttack(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  const card = removeFromHand(s, p, iid)
  s.players[p].discard.push(card)
  // BB-53: the attack may be made without passing for the rest of the combat
  if (!s.combat!.freeFinal?.includes(p)) s.combat!.finalAttack.push(p)
  s.combat!.consecutivePasses = 0
  log(s, 'DISCARD', `Player ${p + 1} discards ${def(db, card).name} for a Final Physical Attack`, p)
  beginStrike(s, db, p, null, FINAL_PHYSICAL_ATTACK, 'Final Physical Attack')
}

/** Trunks Saga: allies may fight for a main personality at 0 or 1 power stages, until this combat ends. */
export function canTakeOver(s: GameState, p: PlayerId, db?: CardDB) {
  // BU-120 (constant power) and BU-121 (Dragon Ball): allies may take over at higher stages; BU-112 forbids it for this combat
  const anyStage = !!db && (constantParams(s, db, p, 'allowAllyControl').length > 0 ||
    tableEffects(s, db, p, 'allowAllyControl').some(t => !t.params.whenMainPersonalityStagesAtMost || s.players[p].mp.stage <= Number(t.params.whenMainPersonalityStagesAtMost)))
  return s.rules.trunks.allyRules && !!s.combat && !s.combat.noTakeover?.includes(p) && (anyStage || s.players[p].mp.stage <= 1) && !s.combat.controllers.some(c => c.player === p)
    && s.players[p].allies.some(a => a.stage > 0)
}

export function allyTakeover(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  s.combat!.controllers.push({ player: p, allyIid: iid })
  log(s, 'TAKEOVER', `${mpDef(s, db, p).name} takes over the combat for player ${p + 1}`, p)
}

export function passCombat(s: GameState, db: CardDB, p: PlayerId) {
  log(s, 'PASS', `Player ${p + 1} passes`, p)
  s.combat!.consecutivePasses++
}

/** Called after every combat action once nothing is pending. */
export function advanceCombat(s: GameState, db: CardDB) {
  const c = s.combat
  if (!c || c.strike || s.pendingChoice || over(s)) return
  if (c.ended || c.consecutivePasses >= 2) {
    log(s, 'COMBAT_END', 'Combat ends')
    // cards kept on the table for extra uses leave at the end of combat
    for (const pl of s.players) {
      const extra = pl.nonCombat.filter(x => x.iid in c.extraUses)
      pl.nonCombat = pl.nonCombat.filter(x => !(x.iid in c.extraUses))
      extra.forEach(x => retire(s, x, def(db, x).effects.postResolution))
    }
    for (const x of s.setAside) {
      s.players[x.to].hand.push(x.card)
      log(s, 'MOVE', `${def(db, x.card).name} returns to player ${x.to + 1}'s hand`, x.to)
    }
    s.setAside = []
    s.combat = null
    s.discardAsLife = s.discardAsLife.filter(x => !x.armed)
    return beginDiscardStep(s, db)
  }
  // Multi-Form: the same player makes the extra attack(s) before the phase passes
  const bonus = c.bonusAttack
  if (bonus && bonus.player === c.active && bonus.remaining > 0) {
    bonus.remaining--
    bonus.active = true
    return log(s, 'EXTRA_ATTACK', `Player ${c.active + 1} attacks again`, c.active)
  }
  c.bonusAttack = null
  endAttackPhase(c, c.active)
  c.active = other(c.active)
  // BB-85: stages gained at the beginning of the owner's Attacker Attacks phases
  for (const g of c.phaseStages ?? []) if (g.player === c.active) changeStages(s, c.active, g.amount)
}

// Step 6
function beginDiscardStep(s: GameState, db: CardDB) {
  s.step = 'DISCARD'
  s.discardQueue = [s.attacker, other(s.attacker)]
  nextDiscard(s, db)
}

function nextDiscard(s: GameState, db: CardDB) {
  while (s.discardQueue.length) {
    const p = s.discardQueue[0]
    const limit = handLimit(s, db, p)
    const keeps = s.keepHand.some(k => k.player === p && k.turn === s.turn)
    if (!keeps && s.players[p].hand.length > limit) {
      s.pendingChoice = { kind: 'DISCARD_TO_LIMIT', player: p, limit }
      return
    }
    s.discardQueue.shift()
  }
  s.pendingChoice = null
  s.keepHand = s.keepHand.filter(k => k.turn > s.turn)
  // Trunks Saga Step 6: not attacking puts the top discard back at the bottom of the life deck
  if (s.rules.trunks.skipCombatRecovers && s.combatSkipped && s.players[s.attacker].discard.length) {
    s.players[s.attacker].lifeDeck.push(s.players[s.attacker].discard.pop()!)
    log(s, 'RECOVER', `Player ${s.attacker + 1} did not attack: the top discard goes to the bottom of the life deck`, s.attacker)
  }
  // Step 7 (CRD only)
  if (s.rules.mode === 'CRD_3' && s.players[s.attacker].discard.length > 0) {
    s.step = 'REJUVENATE'
    s.pendingChoice = { kind: 'REJUVENATE', player: s.attacker }
    return
  }
  finishTurn(s)
}

export function discardFromHand(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  const c = removeFromHand(s, p, iid)
  s.players[p].discard.push(c)
  log(s, 'DISCARD', `Player ${p + 1} discards ${def(db, c).name}`, p)
  nextDiscard(s, db)
}

export function rejuvenate(s: GameState, db: CardDB, accept: boolean) {
  s.pendingChoice = null
  const pl = s.players[s.attacker]
  if (accept) {
    // BU-78: an attached card lets the player return 3 cards instead of 1
    const three = attachmentSources(s, db, s.attacker).some(a => findCustom(a.effects, 'rejuvenationOverride').length)
    const n = Math.min(three ? 3 : 1, pl.discard.length)
    for (let i = 0; i < n; i++) pl.lifeDeck.push(pl.discard.pop()!)
    log(s, 'REJUVENATE', `Player ${s.attacker + 1} rejuvenates ${n} card(s)`, s.attacker)
  }
  finishTurn(s)
}

/** End of the turn: each player may use an "at the end of a turn" card, then the turn passes. */
function finishTurn(s: GameState) {
  schedule(s, step('endOfTurnWindow', { player: s.attacker }), step('endOfTurnWindow', { player: other(s.attacker) }), step('endTurn'))
}

export function endOfTurnCards(s: GameState, db: CardDB, p: PlayerId) {
  return s.players[p].nonCombat.filter(c => {
    const d = def(db, c)
    return canUseCard(s, db, p, d) && timingAllows(s, p, d.effects.onEnterPlay, 'END_OF_TURN') && requirementsMet(s, db, p, d.effects.onEnterPlay, c)
  })
}

/** Stack step: open the end-of-turn window for one player when they have something to use. */
export function endOfTurnWindow(s: GameState, db: CardDB, p: PlayerId) {
  const iids = endOfTurnCards(s, db, p).map(c => c.iid)
  if (iids.length) s.pendingChoice = { kind: 'WINDOW', player: p, window: 'END_OF_TURN', iids }
}

/** Answer to a timing window: a card, or null to let it pass. */
export function respond(s: GameState, db: CardDB, iid: string | null) {
  const pc = s.pendingChoice as { kind: 'WINDOW'; player: PlayerId; window: 'REACT' | 'END_OF_TURN' }
  s.pendingChoice = null
  if (!iid) return
  if (pc.window === 'REACT') react(s, db, pc.player, iid)
  else useNonCombat(s, db, pc.player, iid, true)
}

export function endTurn(s: GameState, db: CardDB) {
  s.attacker = other(s.attacker)
  s.turn++
  startTurn(s, db)
}
