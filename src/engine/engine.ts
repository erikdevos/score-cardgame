import type { CardDB } from './cards'
import { runEffectsFrame } from './effects'
import { resolveConfirm, resolveOption, resolvePick, runChoiceFrame } from './effects/choices'
import { legalActions } from './legal'
import {
  cleanup, copyAttack, dealDamage, defend, defendWithPower, resolveHit, retireResolved, stealDragonBall,
  strikeAfterOnHit, strikeAfterSecondaries, strikeAttackTrigger, strikeReact,
} from './sequencer'
import { useAbility } from './activeabilities'
import { sweepAttachments } from './attach'
import { clone, def, log, schedule } from './state'
import {
  advanceCombat, checkDragonBalls, declareCombat, discardFromHand, endNonCombat, endOfTurnWindow, endTurn,
  allyTakeover, finalPhysicalAttack, passCombat, playCard, rejuvenate, respond, skipCombat, useNonCombat, usePower,
} from './turn'
import type { Action, Frame, GameEvent, GameState } from './types'

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
    case 'USE_ABILITY': useAbility(s, db, action.player, action.key); break
    case 'PASS': passCombat(s, db, action.player); break
    case 'DEFEND': defend(s, db, action.iid); break
    case 'DEFEND_POWER': defendWithPower(s, db); break
    case 'PICK': resolvePick(s, db, action.iid); break
    case 'CONFIRM': resolveConfirm(s, db, action.accept); break
    case 'CHOOSE': resolveOption(s, db, action.index); break
    case 'RESPOND': respond(s, db, action.iid); break
    case 'USE_FREE': {
      // an "at any time" card interrupts: resolve it, then put back the decision that was open
      const held = s.pendingChoice
      s.pendingChoice = null
      if (held) schedule(s, { k: 'resume', pending: held })
      useNonCombat(s, db, action.player, action.iid, true)
      break
    }
    case 'COPY_ATTACK': copyAttack(s, db, action.player); break
    case 'FINAL_PHYSICAL_ATTACK': finalPhysicalAttack(s, db, action.player, action.iid); break
    case 'ALLY_TAKEOVER': allyTakeover(s, db, action.player, action.iid); break
    case 'STEAL_DB': stealDragonBall(s, db, action.iid); break
    case 'DISCARD': discardFromHand(s, db, action.player, action.iid); break
    case 'REJUVENATE': rejuvenate(s, db, action.accept); break
  }
  run(s, db)
  // Only actions taken inside combat hand the attack phase over; declaring combat and free uses do not.
  if ((wasInCombat || s.combat?.ended) && action.type !== 'USE_FREE' && action.type !== 'USE_ABILITY' && action.type !== 'ALLY_TAKEOVER' && s.step === 'COMBAT' && !s.stack.length) {
    advanceCombat(s, db)
    run(s, db)
  }
  sweepDiscards(s, db)
  sweepAttachments(s, db)
  return { state: s, events: s.log.slice(before) }
}

/** Resolve pending work until it is done, a player has to decide something, or the game ends. */
function run(s: GameState, db: CardDB) {
  for (let guard = 0; s.stack.length && !s.pendingChoice && s.winner === null; guard++) {
    if (guard > 10000) throw new Error('Resolution stack does not settle')
    const f = s.stack[s.stack.length - 1]
    if (f.k === 'effects') runEffectsFrame(s, db, f)
    else if (f.k === 'choice') runChoiceFrame(s, db, f.q)
    else {
      s.stack.pop()
      runFrame(s, db, f)
    }
  }
  if (s.winner !== null) s.stack = []
}

function runFrame(s: GameState, db: CardDB, f: Exclude<Frame, { k: 'effects' } | { k: 'choice' }>) {
  if (f.k === 'resume') {
    s.pendingChoice = f.pending
    return
  }
  switch (f.name) {
    case 'strike.react': return strikeReact(s, db)
    case 'strike.attackTrigger': return strikeAttackTrigger(s, db)
    case 'strike.afterSecondaries': return strikeAfterSecondaries(s, db)
    case 'strike.resolveHit': return resolveHit(s, db)
    case 'strike.applyDamage': return dealDamage(s, db)
    case 'strike.afterOnHit': return strikeAfterOnHit(s, db)
    case 'strike.cleanup': return cleanup(s, db)
    case 'retire': return retireResolved(s, db, f.iid!)
    case 'dbCheck': return checkDragonBalls(s, db)
    case 'endOfTurnWindow': return endOfTurnWindow(s, db, f.player!)
    case 'endTurn': return endTurn(s, db)
  }
}

/** AS-96: while that Battleground is in play, new non-Dragon Ball cards in a discard pile leave the game instead. */
function sweepDiscards(s: GameState, db: CardDB) {
  const active = !!s.location && def(db, s.location).effects.onEnterPlay.some(e => e.action === 'CUSTOM' && e.handler === 'removeInsteadOfDiscard')
  s.players.forEach((pl, i) => {
    const mark = Math.min(s.discardMark[i], pl.discard.length)
    if (active) {
      const fresh = pl.discard.splice(mark)
      const gone = fresh.filter(c => def(db, c).type !== 'Dragon Ball')
      pl.discard.push(...fresh.filter(c => !gone.includes(c)))
      pl.removed.push(...gone)
      if (gone.length) log(s, 'REMOVE', `${gone.length} card(s) are removed from the game instead of the discard pile`, pl.id)
    }
    s.discardMark[i] = pl.discard.length
  })
}
