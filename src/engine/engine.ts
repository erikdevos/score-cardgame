import type { CardDB } from './cards'
import { legalActions } from './legal'
import { clone } from './state'
import { promoteChoice, resolveConfirm, resolvePick } from './effects/choices'
import { defend, defendWithPower, stealDragonBall } from './sequencer'
import { advanceCombat, declareCombat, discardFromHand, endNonCombat, passCombat, playCard, rejuvenate, skipCombat, usePower } from './turn'
import type { Action, GameEvent, GameState } from './types'

export class IllegalActionError extends Error {}

const sameAction = (a: Action, b: Action) => JSON.stringify(a) === JSON.stringify(b)

/** Pure: returns a new state, never mutates the input. */
export function applyAction(state: GameState, db: CardDB, action: Action): { state: GameState; events: GameEvent[] } {
  if (!legalActions(state, db).some(l => sameAction(l, action))) {
    throw new IllegalActionError(`Illegal action ${JSON.stringify(action)} in step ${state.step}`)
  }
  const s = clone(state)
  const before = s.log.length
  const wasInCombat = s.step === 'COMBAT'

  switch (action.type) {
    case 'PLAY_CARD': playCard(s, db, action.player, action.iid); break
    case 'END_NON_COMBAT': endNonCombat(s, db); break
    case 'DECLARE_COMBAT': declareCombat(s, db); break
    case 'SKIP_COMBAT': skipCombat(s, db); break
    case 'USE_POWER': usePower(s, db, action.player); break
    case 'PASS': passCombat(s, db, action.player); break
    case 'DEFEND': defend(s, db, action.iid); break
    case 'DEFEND_POWER': defendWithPower(s, db); break
    case 'PICK': resolvePick(s, db, action.iid); break
    case 'CONFIRM': resolveConfirm(s, db, action.accept); break
    case 'STEAL_DB': stealDragonBall(s, db, action.iid); break
    case 'DISCARD': discardFromHand(s, db, action.player, action.iid); break
    case 'REJUVENATE': rejuvenate(s, db, action.accept); break
  }
  // choices raised by card effects are asked once the action itself has resolved
  promoteChoice(s, db)
  // Only actions taken inside combat hand the attack phase over; declaring combat does not.
  if (wasInCombat && s.step === 'COMBAT') advanceCombat(s, db)
  return { state: s, events: s.log.slice(before) }
}
