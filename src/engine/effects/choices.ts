// Player choices raised by card effects ("2 cards of your choice", "if you wish").
// They queue up and are asked once the action that raised them has resolved.
import { shuffleInPlace } from '../rng'
import { changeStages, checkDragonBallVictory, def, log } from '../state'
import type { CardDB } from '../cards'
import type { CardInstance, GameState, PickDest, PickZone, PlayerId, QueuedChoice } from '../types'
import { resolveEffects } from '.'

type Pick = QueuedChoice & { kind: 'PICK' }

/** The cards of one zone of a player; allies are unwrapped to their cards. */
export function zoneCards(s: GameState, owner: PlayerId, zone: PickZone): CardInstance[] {
  const pl = s.players[owner]
  return zone === 'allies' ? pl.allies.map(a => a.card) : pl[zone]
}

/** Find a card in the pick zones, with the zone it is in. */
export function locatePick(s: GameState, q: Pick, iid: string): { card: CardInstance; zone: PickZone } | null {
  for (const zone of q.zones) {
    const card = zoneCards(s, q.owner, zone).find(c => c.iid === iid)
    if (card) return { card, zone }
  }
  return null
}

export function queueChoice(s: GameState, db: CardDB, q: QueuedChoice) {
  if (q.kind === 'PICK' && !needsAsking(s, q)) return pickAll(s, db, q)
  s.choiceQueue.push(q)
}

function needsAsking(s: GameState, q: Pick) {
  q.eligible = q.eligible.filter(i => locatePick(s, q, i))
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

function takeFrom(s: GameState, owner: PlayerId, zone: PickZone, iid: string): CardInstance {
  const pl = s.players[owner]
  if (zone === 'allies') return pl.allies.splice(pl.allies.findIndex(a => a.card.iid === iid), 1)[0].card
  const list = pl[zone]
  return list.splice(list.findIndex(c => c.iid === iid), 1)[0]
}

const ZONE_NAME: Record<PickZone, string> = {
  discard: 'discard pile', dragonBalls: 'Dragon Balls', lifeDeck: 'life deck', hand: 'hand',
  drills: 'drills', allies: 'allies', nonCombat: 'Non-Combat cards',
}

function movePicked(s: GameState, db: CardDB, q: Pick, iid: string) {
  const found = locatePick(s, q, iid)
  if (!found) return
  const picker = s.players[q.player]
  const owner = s.players[q.owner]
  const d = def(db, found.card)
  const whose = q.owner === q.player ? 'their' : `player ${q.owner + 1}'s`
  const say = (what: string) => log(s, 'MOVE', `${q.source}: player ${q.player + 1} ${what}`, q.player)

  if (q.dest === 'ALLY_TO_MP_STAGES') {
    // the ally stays; its stages move to the main personality as far as they fit
    const ally = picker.allies.find(a => a.card.iid === iid)!
    const n = Math.min(ally.stage, s.rules.maxStage - picker.mp.stage)
    ally.stage -= n
    changeStages(s, q.player, n)
    return say(`moves ${n} power stage(s) from ${d.name} to the main personality`)
  }

  const card = takeFrom(s, q.owner, found.zone, iid)
  const where: Record<Exclude<PickDest, 'ALLY_TO_MP_STAGES'>, string> = {
    HAND: 'into their hand', LIFE_TOP: 'on top of the life deck', LIFE_BOTTOM: 'at the bottom of the life deck',
    OWNER_LIFE_BOTTOM: `at the bottom of player ${q.owner + 1}'s life deck`, PICKER_DRAGON_BALLS: 'and captures it',
    DISCARD: 'and discards it', REMOVED: 'and removes it from the game', PLAY: 'and puts it into play',
  }
  switch (q.dest) {
    case 'HAND': picker.hand.push(card); break
    case 'LIFE_TOP': owner.lifeDeck.unshift(card); break
    case 'LIFE_BOTTOM':
    case 'OWNER_LIFE_BOTTOM': owner.lifeDeck.push(card); break
    case 'PICKER_DRAGON_BALLS': picker.dragonBalls.push(card); break
    case 'DISCARD': owner.discard.push(card); break
    case 'REMOVED': owner.removed.push(card); break
    case 'PLAY':
      if (d.type === 'Dragon Ball') picker.dragonBalls.push(card)
      else if (d.type === 'Drill') picker.drills.push(card)
      else picker.allies.push({ card, stage: q.allyStage ?? s.rules.allyStartStage })
      break
  }
  say(`takes ${d.name} from ${whose} ${ZONE_NAME[found.zone]} ${where[q.dest]}`)
  // searching the life deck ends with a shuffle, unless the card went to a fixed place in it
  if (found.zone === 'lifeDeck' && !['LIFE_TOP', 'LIFE_BOTTOM', 'OWNER_LIFE_BOTTOM'].includes(q.dest)) s.rngSeed = shuffleInPlace(owner.lifeDeck, s.rngSeed)
  if (q.dest === 'PICKER_DRAGON_BALLS' || (q.dest === 'PLAY' && d.type === 'Dragon Ball')) checkDragonBallVictory(s, db)
}

export function pickRequest(
  player: PlayerId, owner: PlayerId, zones: PickZone | PickZone[], cards: CardInstance[], count: number, dest: PickDest, source: string,
  extra: { allyStage?: number } = {},
): Pick {
  return { kind: 'PICK', player, owner, zones: Array.isArray(zones) ? zones : [zones], count, dest, eligible: cards.map(c => c.iid), source, ...extra }
}
