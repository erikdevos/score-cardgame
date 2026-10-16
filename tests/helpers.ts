import { applyAction, createGame, type Action, type GameState, type PlayerId, type Rules } from '../src/engine'
import { db, heroMP, testDeck, villainMP } from './fixtures/testCards'

export function newGame(seed = 1, rules: Partial<Rules> = {}) {
  return createGame(db, [testDeck(heroMP), testDeck(villainMP)], { seed, rules })
}

let n = 0
/** Put a fresh card instance into a player's hand (unit tests only). */
export function give(s: GameState, p: PlayerId, defId: string): string {
  const iid = `t${n++}`
  s.players[p].hand.push({ iid, defId, owner: p })
  return iid
}

/** A game frozen at the start of player 0's attack phase with empty hands. */
export function inCombat(seed = 1, rules: Partial<Rules> = {}): GameState {
  const s = newGame(seed, rules)
  s.attacker = 0
  s.step = 'COMBAT'
  s.pendingChoice = null
  s.combat = { active: 0, consecutivePasses: 0, strike: null, usedPowers: [], ended: false }
  for (const p of s.players) { p.discard.push(...p.hand); p.hand = [] }
  return s
}

export function act(s: GameState, a: Action): GameState {
  return applyAction(s, db, a).state
}
