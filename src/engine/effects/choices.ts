// Player choices raised by card effects ("2 cards of your choice", "if you wish").
// They queue up and are asked once the action that raised them has resolved.
import { shuffleInPlace } from '../rng'
import { checkDragonBallVictory, def, log } from '../state'
import type { CardDB } from '../cards'
import type { CardInstance, GameState, PlayerId, QueuedChoice } from '../types'
import { resolveEffects } from '.'

type Pick = QueuedChoice & { kind: 'PICK' }

const zoneOf = (s: GameState, q: Pick): CardInstance[] => s.players[q.owner][q.zone]

export function queueChoice(s: GameState, db: CardDB, q: QueuedChoice) {
  if (q.kind === 'PICK' && !needsAsking(s, q)) return pickAll(s, db, q)
  s.choiceQueue.push(q)
}

function needsAsking(s: GameState, q: Pick) {
  const ids = new Set(zoneOf(s, q).map(c => c.iid))
  q.eligible = q.eligible.filter(i => ids.has(i))
  return q.eligible.length > q.count
}

function pickAll(s: GameState, db: CardDB, q: Pick) {
  for (const iid of [...q.eligible]) movePicked(s, db, q, iid)
}

/** Ask the next queued choice when nothing else is pending. */
export function promoteChoice(s: GameState, db: CardDB) {
  while (!s.pendingChoice && s.winner === null && s.choiceQueue.length) {
    const q = s.choiceQueue.shift()!
    if (q.kind === 'PICK' && !needsAsking(s, q)) pickAll(s, db, q)
    else s.pendingChoice = q
  }
}

export function resolvePick(s: GameState, db: CardDB, iid: string) {
  const q = s.pendingChoice as Pick
  movePicked(s, db, q, iid)
  q.count--
  q.eligible = q.eligible.filter(i => i !== iid)
  if (q.count <= 0 || !q.eligible.length || s.winner !== null) s.pendingChoice = null
}

export function resolveConfirm(s: GameState, db: CardDB, accept: boolean) {
  const q = s.pendingChoice as QueuedChoice & { kind: 'CONFIRM' }
  s.pendingChoice = null
  log(s, 'CHOICE', `Player ${q.player + 1} ${accept ? 'uses' : 'declines'}: ${q.prompt}`, q.player)
  if (accept) resolveEffects({ s, db, user: q.player, source: q.source }, q.effects)
}

function movePicked(s: GameState, db: CardDB, q: Pick, iid: string) {
  const from = zoneOf(s, q)
  const i = from.findIndex(c => c.iid === iid)
  if (i < 0) return
  const [card] = from.splice(i, 1)
  const picker = s.players[q.player]
  const owner = s.players[q.owner]
  const name = def(db, card).name
  switch (q.dest) {
    case 'HAND': picker.hand.push(card); break
    case 'LIFE_TOP': owner.lifeDeck.unshift(card); break
    case 'LIFE_BOTTOM':
    case 'OWNER_LIFE_BOTTOM': owner.lifeDeck.push(card); break
    case 'PICKER_DRAGON_BALLS': picker.dragonBalls.push(card); break
  }
  const where: Record<typeof q.dest, string> = {
    HAND: 'into their hand', LIFE_TOP: 'on top of the life deck', LIFE_BOTTOM: 'at the bottom of the life deck',
    OWNER_LIFE_BOTTOM: `at the bottom of player ${q.owner + 1}'s life deck`, PICKER_DRAGON_BALLS: 'and captures it',
  }
  log(s, 'MOVE', `${q.source}: player ${q.player + 1} takes ${name} from ${q.owner === q.player ? 'their' : `player ${q.owner + 1}'s`} ${q.zone === 'lifeDeck' ? 'life deck' : q.zone === 'dragonBalls' ? 'Dragon Balls' : 'discard pile'} ${where[q.dest]}`, q.player)
  if (q.zone === 'lifeDeck') s.rngSeed = shuffleInPlace(owner.lifeDeck, s.rngSeed)
  if (q.dest === 'PICKER_DRAGON_BALLS') checkDragonBallVictory(s, db)
}

export function pickRequest(player: PlayerId, owner: PlayerId, zone: Pick['zone'], cards: CardInstance[], count: number, dest: Pick['dest'], source: string): Pick {
  return { kind: 'PICK', player, owner, zone, count, dest, eligible: cards.map(c => c.iid), source }
}
