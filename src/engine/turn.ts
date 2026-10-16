import type { CardDB } from './cards'
import { resolveEffects } from './effects'
import { beginStrike, strikeOf } from './sequencer'
import { changeStages, checkDragonBallVictory, def, drawCards, handLimit, isOnTable, log, mpDef, over, pur, removeFromHand, retire, takeCard } from './state'
import { other, type GameState, type PlayerId } from './types'

// Step 1
export function startTurn(s: GameState, db: CardDB) {
  s.step = 'NON_COMBAT'
  s.locationPlayedThisTurn = false
  s.combat = null
  log(s, 'TURN', `Turn ${s.turn}: player ${s.attacker + 1} attacks`, s.attacker)
  drawCards(s, s.attacker, s.rules.drawPerTurn)
}

// Step 2
export function playNonCombat(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  const card = removeFromHand(s, p, iid)
  const d = def(db, card)
  const pl = s.players[p]
  if (d.type === 'Non-Combat') {
    // Placed face up; its power stays available until used (now, or later in combat).
    pl.nonCombat.push(card)
    return log(s, 'PLACE', `Player ${p + 1} places ${d.name} on the table`, p)
  }
  log(s, 'PLAY', `Player ${p + 1} plays ${d.name}`, p)
  switch (d.type) {
    case 'Personality':
      pl.allies.push({ card, stage: s.rules.allyStartStage })
      break
    case 'Drill':
      // a new drill of a restricted style knocks out the restricted drills of that style
      for (const other of s.players) {
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
      break
    case 'Location':
    case 'Battleground':
      if (s.location) retire(s, s.location, 'DISCARD')
      s.location = card
      s.locationPlayedThisTurn = true
      break
  }
  resolveEffects({ s, db, user: p, source: d.name }, d.effects.onEnterPlay)
  if (d.type === 'Dragon Ball') checkDragonBallVictory(s, db)
}

/** Use the power of an unused Non-Combat card on the table that is not an attack or block. */
export function useNonCombat(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  const card = takeCard(s, p, iid)
  const d = def(db, card)
  log(s, 'USE', `Player ${p + 1} uses ${d.name}`, p)
  if (s.combat) s.combat.consecutivePasses = 0
  resolveEffects({ s, db, user: p, source: d.name }, d.effects.onEnterPlay)
  retire(s, card, d.effects.postResolution)
}

/** PLAY_CARD dispatch: place or play from hand, or use a Non-Combat card already on the table. */
export function playCard(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  const onTable = isOnTable(s, p, iid)
  const role = def(db, (onTable ? s.players[p].nonCombat : s.players[p].hand).find(c => c.iid === iid)!).combatRole
  if (s.step === 'COMBAT') return onTable && !role ? useNonCombat(s, db, p, iid) : playCombatCard(s, db, p, iid)
  return onTable ? useNonCombat(s, db, p, iid) : playNonCombat(s, db, p, iid)
}

// Step 3, then step 4 (or straight to discard when a location was played)
export function endNonCombat(s: GameState, db: CardDB) {
  const p = s.attacker
  const gain = pur(s, db, p)
  changeStages(s, p, gain)
  for (const a of s.players[p].allies) a.stage = Math.min(s.rules.maxStage, a.stage + s.rules.allyPowerUp)
  log(s, 'POWER_UP', `Player ${p + 1} powers up ${gain} (stage ${s.players[p].mp.stage})`, p)
  if (s.locationPlayedThisTurn) {
    log(s, 'NO_COMBAT', 'A location was played this turn, combat cannot be declared')
    return beginDiscardStep(s, db)
  }
  s.step = 'DECLARE'
}

export function declareCombat(s: GameState, db: CardDB) {
  const defender = other(s.attacker)
  log(s, 'DECLARE', `Player ${s.attacker + 1} declares combat`, s.attacker)
  s.step = 'COMBAT'
  s.combat = { active: s.attacker, consecutivePasses: 0, strike: null, usedPowers: [], ended: false }
  drawCards(s, defender, s.rules.defenderCombatDraw)
}

export function skipCombat(s: GameState, db: CardDB) {
  log(s, 'PASS_COMBAT', `Player ${s.attacker + 1} does not declare combat`, s.attacker)
  beginDiscardStep(s, db)
}

export function playCombatCard(s: GameState, db: CardDB, p: PlayerId, iid: string) {
  const card = takeCard(s, p, iid)
  s.combat!.consecutivePasses = 0
  beginStrike(s, db, p, card, strikeOf(db, card), def(db, card).name)
}

export function usePower(s: GameState, db: CardDB, p: PlayerId) {
  const d = mpDef(s, db, p)
  const power = d.personality!.power!
  s.combat!.consecutivePasses = 0
  s.combat!.usedPowers.push(`${p}:${d.id}`)
  beginStrike(s, db, p, null, power.strike, `${d.name}'s power: ${power.name}`)
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
    s.combat = null
    return beginDiscardStep(s, db)
  }
  c.active = other(c.active)
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
    if (s.players[p].hand.length > limit) {
      s.pendingChoice = { kind: 'DISCARD_TO_LIMIT', player: p, limit }
      return
    }
    s.discardQueue.shift()
  }
  s.pendingChoice = null
  // Step 7 (CRD only)
  if (s.rules.mode === 'CRD_3' && s.players[s.attacker].discard.length > 0) {
    s.step = 'REJUVENATE'
    s.pendingChoice = { kind: 'REJUVENATE', player: s.attacker }
    return
  }
  endTurn(s, db)
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
    pl.lifeDeck.push(pl.discard.pop()!)
    log(s, 'REJUVENATE', `Player ${s.attacker + 1} rejuvenates 1 card`, s.attacker)
  }
  endTurn(s, db)
}

function endTurn(s: GameState, db: CardDB) {
  s.attacker = other(s.attacker)
  s.turn++
  startTurn(s, db)
}
