// Attached cards: a card lies on the table fixed to a personality or another card, its effects work while it is there
// and it leaves on a condition ("until ..."). Replaces the older one-off powerLocks hack only for the new cards.
import type { CardDB, Effect } from './cards'
import { def, log } from './state'
import { other, type Attachment, type CardInstance, type GameState, type PlayerId } from './types'

type Host = Attachment['host']

export const isAttached = (s: GameState, iid: string) => s.attachments.some(a => a.card.iid === iid)

export function attachCard(s: GameState, db: CardDB, card: CardInstance, host: Host, o: { until?: string; effects: Effect[]; removeWhenDone?: boolean }) {
  if (isAttached(s, card.iid)) return
  s.attachments.push({ card, host, until: o.until, effects: o.effects, removeWhenDone: !!o.removeWhenDone })
  log(s, 'ATTACH', `${def(db, card).name} is attached to ${host.kind === 'mp' ? `player ${host.player + 1}'s main personality` : 'a card'}`, card.owner)
}

/** Effects of the cards attached to this player's main personality (or to cards that player has in play). */
export function attachmentSources(s: GameState, db: CardDB, p: PlayerId) {
  return s.attachments.filter(a => a.host.player === p && a.effects.length).map(a => ({ name: def(db, a.card).name, card: a.card, effects: a.effects }))
}

/** True when an attached card forbids using this table card (BU-48). */
export const isForbidden = (s: GameState, iid: string) => s.attachments.some(a => a.host.kind === 'card' && a.host.iid === iid && a.effects.some(e => e.action === 'CUSTOM' && e.handler === 'forbidCards' && e.params?.targetsAttachedCard))

/** WG-103: an attached card stops its host from using Non-Combat cards. */
export const nonCombatForbidden = (s: GameState, p: PlayerId) => s.attachments.some(a => a.host.kind === 'mp' && a.host.player === p &&
  a.effects.some(e => e.action === 'CUSTOM' && e.handler === 'forbidCards' && (e.params?.filter as { cardTypes?: string[] } | undefined)?.cardTypes?.includes('Non-Combat')))

/** BU-76: an attached card keeps this ally from taking control of combat / absorbing damage. */
export const allyRestricted = (s: GameState, iid: string, what: 'cannotTakeControlOfCombat' | 'cannotAbsorbDamage') =>
  s.attachments.some(a => a.host.kind === 'card' && a.host.iid === iid && a.effects.some(e => e.action === 'CUSTOM' && e.handler === 'allyRestriction' && e.params?.[what]))

/** BU-54: an attached card stops the opponent from looking at this player's hand / Life Deck. */
export const lookingForbidden = (s: GameState, owner: PlayerId, what: 'hand' | 'lifeDeck') =>
  s.attachments.some(a => a.host.kind === 'mp' && a.host.player === owner &&
    a.effects.some(e => e.action === 'CUSTOM' && e.handler === 'forbidCards' && (e.params?.cardsThatLookAt as string[] | undefined)?.includes(what)))

function release(s: GameState, db: CardDB, a: Attachment, why: string) {
  s.attachments = s.attachments.filter(x => x !== a)
  const owner = s.players[a.card.owner]
  if (a.removeWhenDone) owner.removed.push(a.card)
  else owner.discard.push(a.card)
  log(s, a.removeWhenDone ? 'REMOVE' : 'DISCARD', `${def(db, a.card).name} leaves the personality: ${why}`, a.card.owner)
}

/** "Discard any cards attached to your Main Personality" (CG-44, CG-67). */
export function discardAttachedOf(s: GameState, db: CardDB, p: PlayerId) {
  const mine = s.attachments.filter(a => a.host.kind === 'mp' && a.host.player === p)
  mine.forEach(a => release(s, db, a, 'discarded'))
  return mine.length
}

/** After an attack: conditions that depend on what the host personality just did. */
export function attachAfterAttack(s: GameState, db: CardDB, initiator: PlayerId, type: 'PHYSICAL' | 'ENERGY', success: boolean) {
  for (const a of [...s.attachments]) {
    if (a.host.player !== initiator || a.host.kind !== 'mp') continue
    if (a.until === 'attachedPerformsEnergyAttack' && type === 'ENERGY') release(s, db, a, 'it performed an energy attack')
    else if (a.until === 'attachedPerformsSuccessfulAttack' && success) release(s, db, a, 'it performed a successful attack')
  }
}

/** The defender lost life cards: "until your opponent deals at least 1 life card of damage to you" (BU-54). */
export function attachAfterLifeDamage(s: GameState, db: CardDB, defender: PlayerId, lifeCards: number) {
  if (lifeCards < 1) return
  for (const a of [...s.attachments]) if (a.until === 'opponentDealsLifeCardDamage' && a.host.player === defender) release(s, db, a, 'a life card was dealt')
}

/** Run after every action: hosts that left play, personalities at their highest stage. */
export function sweepAttachments(s: GameState, db: CardDB) {
  for (const a of [...s.attachments]) {
    const pl = s.players[a.host.player]
    if (a.host.kind === 'card') {
      const there = [...pl.drills, ...pl.nonCombat, ...pl.allies.map(x => x.card), ...pl.dragonBalls].some(c => c.iid === a.host.iid)
      if (!there) release(s, db, a, 'the card it was attached to left play')
    } else if (a.until === 'attachedPersonalityAtHighestStage' && pl.mp.stage >= s.rules.maxStage) release(s, db, a, 'the personality is at its highest power stage')
  }
}

/** Beginning of a turn: attached upkeep effects of the host (BU-127). */
export function attachUpkeep(s: GameState, db: CardDB, p: PlayerId): Effect[] {
  return s.attachments.filter(a => a.host.kind === 'mp' && a.host.player === p).flatMap(a => a.effects.filter(e => e.action === 'DISCARD_LIFE'))
}
export { other }
