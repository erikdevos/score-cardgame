// Player choices raised by card effects ("2 cards of your choice", "if you wish").
// They queue up and are asked once the action that raised them has resolved.
import { shuffleInPlace } from '../rng'
import { changeAnger, changeStages, checkDragonBallVictory, def, findCustom, log, millCards, schedule, step } from '../state'
import type { CardDB, Effect } from '../cards'
import type { CardInstance, GameState, PickDest, PickZone, PlayerId, QueuedChoice } from '../types'
export type { QueuedChoice }
import { defaultDamage } from '../damage'
import { registerDamageModifier } from '../damagemods'
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

/** Schedule decisions; they are asked in the order given when resolution reaches them. */
export function queueChoice(s: GameState, ...qs: QueuedChoice[]) {
  schedule(s, ...qs.map(q => ({ k: 'choice' as const, q })))
}

/** Stack driver: ask the decision, or settle it when there is nothing to decide. */
export function runChoiceFrame(s: GameState, db: CardDB, q: QueuedChoice) {
  s.stack.pop()
  if (q.kind === 'PICK' && !needsAsking(s, q)) return pickAll(s, db, q)
  if (q.kind === 'OPTION' && q.options.length === 1) return resolveOptionWith(s, db, q, 0)
  s.pendingChoice = q
}

function needsAsking(s: GameState, q: Pick) {
  q.eligible = q.eligible.filter(i => locatePick(s, q, i))
  return q.eligible.length > q.count
}

function pickAll(s: GameState, db: CardDB, q: Pick) {
  for (const iid of [...q.eligible]) movePicked(s, db, q, iid)
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

export function resolveOption(s: GameState, db: CardDB, index: number) {
  const q = s.pendingChoice as QueuedChoice & { kind: 'OPTION' }
  s.pendingChoice = null
  resolveOptionWith(s, db, q, index)
}

function resolveOptionWith(s: GameState, db: CardDB, q: QueuedChoice & { kind: 'OPTION' }, index: number) {
  log(s, 'CHOICE', `Player ${q.player + 1} chooses: ${q.options[index]}`, q.player)
  if (q.purpose === 'honorDuel') {
    s.discardAsLife.push({ player: q.player, mode: index === 0 ? 'DAMAGE' : 'DRAW', remaining: Number(q.data.cards), armed: false, source: q.source })
    return
  }
  if (q.purpose === 'variableCost') {
    const n = index + Number(q.data.min ?? 1)
    millCards(s, q.player, n, db)
    const st = s.combat?.strike
    if (st) st.strike = { ...st.strike, damage: { calculation: 'FLAT', stages: 0, lifeCards: n, modifierStages: 0, modifierLifeCards: 0 } }
    return log(s, 'COST', `${q.source}: player ${q.player + 1} pays ${n} life card(s); the attack does ${n} life cards`, q.player)
  }
  if (q.purpose === 'damageTarget') {
    const st = s.combat?.strike
    if (st) st.damageTo = index === 0 ? '' : String(q.data[String(index)])
    return
  }
  if (q.purpose === 'lifeForDrills') {
    const per = Number(q.data.per ?? 2)
    if (index === 0) return
    const own = s.players[q.player].lifeDeck
    s.players[q.player].removed.push(...own.splice(0, index * per))
    log(s, 'REMOVE', `${q.source}: player ${q.player + 1} removes ${index * per} life cards from the game`, q.player)
    const foe = (1 - q.player) as PlayerId
    return queueChoice(s, pickRequest(q.player, foe, 'drills', s.players[foe].drills, index, 'REMOVED', q.source))
  }
  if (q.purpose === 'borrowDrill') {
    const defId = String(q.data[String(index)])
    s.combat?.borrowedDrills.push({ player: q.player, defId })
    return log(s, 'BORROW', `${q.source}: player ${q.player + 1} uses ${def(db, { iid: '', defId, owner: q.player }).name}'s power this combat`, q.player)
  }
  if (q.purpose === 'shuffle') {
    const pile = index === 0 ? s.players[q.player].lifeDeck : index === 1 ? s.players[q.player].discard : null
    if (pile) s.rngSeed = shuffleInPlace(pile, s.rngSeed)
    return
  }
  if (q.purpose === 'chooseOne') {
    // TS-113 "... or ...": the chosen branch's effects
    const branches = JSON.parse(String(q.data.branches)) as Effect[][]
    return resolveEffects({ s, db, user: q.player, source: q.source }, branches[index] ?? [])
  }
  if (q.purpose === 'anger') {
    const who = (index === 0 ? q.data.first : q.data.second) as PlayerId
    return changeAnger(s, db, who, Number(q.data.amount))
  }
  if (q.purpose === 'empower') {
    // index 0: the normal attack, the text after Empower applies; index 1: +N life cards and that text is gone
    const dropped = JSON.parse(String(q.data.dropped)) as { onPlaySecondary?: Effect[]; onHit?: Effect[] }
    const st = s.combat?.strike
    if (index === 1) {
      if (st) st.strike = { ...st.strike, damage: { ...(st.strike.damage ?? defaultDamage(st.strike, s.rules)), modifierLifeCards: (st.strike.damage ?? defaultDamage(st.strike, s.rules)).modifierLifeCards + Number(q.data.amount) } }
      return log(s, 'EMPOWER', `${q.source}: Empower ${q.data.amount}, +${q.data.amount} life cards of damage`, q.player)
    }
    if (st && dropped.onHit?.length) st.strike = { ...st.strike, effects: { ...st.strike.effects, onHit: [...st.strike.effects.onHit, ...dropped.onHit] } }
    return resolveEffects({ s, db, user: q.player, source: q.source }, dropped.onPlaySecondary ?? [])
  }
  if (q.purpose === 'discardForDamage') {
    // BB-119: each discarded card adds life cards of damage to the attack being performed
    const st = s.combat?.strike
    if (!index || !st) return
    const d = st.strike.damage ?? defaultDamage(st.strike, s.rules)
    st.strike = { ...st.strike, damage: { ...d, modifierLifeCards: d.modifierLifeCards + index * Number(q.data.per) } }
    log(s, 'DAMAGE_X', `${q.source}: ${index} card(s) discarded, +${index * Number(q.data.per)} life cards of damage`, q.player)
    return queueChoice(s, pickRequest(q.player, q.player, 'hand', s.players[q.player].hand, index, 'DISCARD', q.source))
  }
  if (q.purpose === 'unlessPays') {
    // index 0: the opponent pays (stages / a discarded card) and the effect fails; index 1: the effect works for the card user
    const user = Number(q.data.user) as PlayerId
    if (index === 1) return resolveEffects({ s, db, user, source: q.source }, JSON.parse(String(q.data.effects)) as Effect[])
    if (q.data.kind === 'stages') {
      changeStages(s, q.player, -Number(q.data.n))
      return log(s, 'COST', `${q.source}: player ${q.player + 1} pays ${q.data.n} power stage(s) to stop it`, q.player)
    }
    return queueChoice(s, pickRequest(q.player, q.player, 'hand', s.players[q.player].hand, Number(q.data.n), 'DISCARD', q.source))
  }
  if (q.purpose === 'rearrange') {
    // CG-62: 0 = top 10, 1 = bottom 10, 2 = leave it; the cards are then picked in the order they should end up
    if (index === 2) return
    const pile = s.players[q.player].discard
    const n = Math.min(Number(q.data.count), pile.length)
    const cards = index === 0 ? pile.slice(pile.length - n) : pile.slice(0, n)
    return queueChoice(s, pickRequest(q.player, q.player, 'discard', cards, n, index === 0 ? 'DISCARD_TOP' : 'DISCARD_BOTTOM', q.source))
  }
  if (q.purpose === 'revealBonus') {
    // BB-81: show N physical attack cards, +3 power stages per card for the rest of this combat
    if (!index) return
    const bonus = index * Number(q.data.per)
    registerDamageModifier(s, q.player, q.source, { flatStages: bonus, attackType: 'PHYSICAL', duration: 'thisCombat' })
    return log(s, 'REVEAL', `${q.source}: player ${q.player + 1} reveals ${index} physical attack card(s): +${bonus} power stages on physical attacks this combat`, q.player)
  }
  if (q.purpose === 'disableDrill') {
    s.disabledDrills.push(String(q.data[String(index)]))
    return log(s, 'RESTRICT', `${q.source}: ${q.options[index]} can no longer be used`, q.player)
  }
  if (q.purpose === 'loseStages') {
    // AS-13: lose `index` stages, lower the foe's anger 1 level per `per` stages lost
    changeStages(s, q.player, -index)
    const levels = Math.floor(index / Number(q.data.per ?? 2))
    log(s, 'STAGES', `${q.source}: player ${q.player + 1} loses ${index} power stage(s)`, q.player)
    if (levels) changeAnger(s, db, (1 - q.player) as PlayerId, -levels)
    return
  }
  if (q.purpose === 'nameCardDiscard') {
    // AS-52: one copy (BU-89: all copies) of the named card leaves the opponent's life deck
    const foe = (1 - q.player) as PlayerId
    const name = q.options[index]
    const deck = s.players[foe].lifeDeck
    const hits = deck.filter(c => def(db, c).name === name)
    if (!hits.length) return log(s, 'NO_EFFECT', `${q.source}: no ${name} in player ${foe + 1}'s life deck`, foe)
    const gone = q.data.all ? hits : hits.slice(0, 1)
    s.players[foe].lifeDeck = deck.filter(c => !gone.includes(c))
    ;(q.data.to === 'discard' || q.data.to === undefined ? s.players[foe].discard : s.players[foe].removed).push(...gone)
    s.rngSeed = shuffleInPlace(s.players[foe].lifeDeck, s.rngSeed)
    return log(s, 'DISCARD', `${q.source}: ${gone.length} copy/copies of ${name} leave player ${foe + 1}'s life deck`, foe)
  }
  if (q.purpose === 'nameCard') {
    const foe = (1 - q.player) as PlayerId
    const name = q.options[index]
    const deck = s.players[foe].lifeDeck
    const hits = deck.filter(c => def(db, c).name === name)
    s.players[foe].lifeDeck = deck.filter(c => !hits.includes(c))
    s.players[foe].removed.push(...hits)
    return log(s, 'REMOVE', `${q.source}: player ${foe + 1} removes ${hits.length} ${name} from their life deck`, foe)
  }
  // transferStages: the option index is the number of stages
  const pl = s.players[q.player]
  const ally = pl.allies.find(a => a.card.iid === q.data.allyIid)
  if (!ally) return
  const n = Math.min(index, ally.stage, s.rules.maxStage - pl.mp.stage)
  ally.stage -= n
  changeStages(s, q.player, n)
  log(s, 'MOVE', `${q.source}: ${def(db, ally.card).name} gives ${n} power stage(s) to the main personality`, q.player)
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
    // the ally stays; the player picks any amount up to the main personality's highest stage
    const ally = picker.allies.find(a => a.card.iid === iid)!
    const max = Math.min(ally.stage, s.rules.maxStage - picker.mp.stage)
    const options = Array.from({ length: max + 1 }, (_, i) => `${i} stage${i === 1 ? '' : 's'}`)
    return queueChoice(s, { kind: 'OPTION', player: q.player, source: q.source, prompt: `How many stages does ${d.name} give?`, options, purpose: 'transferStages', data: { allyIid: iid } })
  }
  if (q.dest === 'MARK_ALLY_SHIELD') {
    s.combat?.allyShield.push({ player: q.player, allyIid: iid })
    return say(`chooses ${d.name} to take this combat's damage`)
  }

  const card = takeFrom(s, q.owner, found.zone, iid)
  const where: Record<Exclude<PickDest, 'ALLY_TO_MP_STAGES' | 'MARK_ALLY_SHIELD'>, string> = {
    HAND: 'into their hand', LIFE_TOP: 'on top of the life deck', LIFE_BOTTOM: 'at the bottom of the life deck',
    OWNER_LIFE_BOTTOM: `at the bottom of player ${q.owner + 1}'s life deck`, USE_NONCOMBAT: 'and uses it', PICKER_DRAGON_BALLS: 'and captures it',
    DISCARD: 'and discards it', REMOVED: 'and removes it from the game', PLAY: 'and puts it into play',
    LIFE_SHUFFLE: `and shuffles it into player ${q.owner + 1}'s life deck`,
    DISCARD_TOP: 'on top of the discard pile', DISCARD_BOTTOM: 'at the bottom of the discard pile',
    OWNER_HAND: `and gives it to player ${q.owner + 1}'s hand`, SET_ASIDE: 'and sets it aside until the end of combat',
  }
  switch (q.dest) {
    case 'HAND': picker.hand.push(card); break
    case 'OWNER_HAND': owner.hand.push(card); break
    case 'DISCARD_TOP': owner.discard.push(card); break
    case 'DISCARD_BOTTOM': owner.discard.unshift(card); break
    case 'SET_ASIDE': s.setAside.push({ card, to: q.owner }); break
    case 'LIFE_TOP': owner.lifeDeck.unshift(card); break
    case 'LIFE_BOTTOM':
    case 'OWNER_LIFE_BOTTOM': owner.lifeDeck.push(card); break
    case 'PICKER_DRAGON_BALLS': picker.dragonBalls.push(card); break
    case 'DISCARD':
      // WG-57: a Drill with this text goes into play when it is discarded from the hand
      if (found.zone === 'hand' && d.type === 'Drill' && findCustom(d.effects.onEnterPlay, 'placeInPlayIfDiscardedFromHand').length && !owner.drills.some(c => c.defId === card.defId)) {
        owner.drills.push(card)
        log(s, 'PLACE', `${d.name} is placed into play instead of being discarded`, q.owner)
      } else owner.discard.push(card)
      break
    case 'REMOVED': owner.removed.push(card); break
    case 'LIFE_SHUFFLE':
      owner.lifeDeck.push(card)
      s.rngSeed = shuffleInPlace(owner.lifeDeck, s.rngSeed)
      break
    case 'USE_NONCOMBAT':
      s.resolving.push(card)
      schedule(s, { k: 'effects', user: q.player, source: d.name, card, effects: [...d.effects.onEnterPlay] }, step('retire', { iid }))
      break
    case 'PLAY':
      if (d.type === 'Dragon Ball') picker.dragonBalls.push(card)
      else if (d.type === 'Drill') picker.drills.push(card)
      else picker.allies.push({ card, stage: q.allyStage ?? s.rules.allyStartStage })
      break
  }
  say(`takes ${d.name} from ${whose} ${ZONE_NAME[found.zone]} ${where[q.dest]}`)
  // searching the life deck ends with a shuffle, unless the card went to a fixed place in it
  if (found.zone === 'lifeDeck' && !['LIFE_TOP', 'LIFE_BOTTOM', 'OWNER_LIFE_BOTTOM'].includes(q.dest)) s.rngSeed = shuffleInPlace(owner.lifeDeck, s.rngSeed)
  if (q.dest === 'PICKER_DRAGON_BALLS' || (q.dest === 'PLAY' && d.type === 'Dragon Ball')) checkDragonBallVictory(s, db, q.dest === 'PICKER_DRAGON_BALLS' && q.owner !== q.player ? 'capture' : 'play')
}

export function pickRequest(
  player: PlayerId, owner: PlayerId, zones: PickZone | PickZone[], cards: CardInstance[], count: number, dest: PickDest, source: string,
  extra: { allyStage?: number } = {},
): Pick {
  return { kind: 'PICK', player, owner, zones: Array.isArray(zones) ? zones : [zones], count, dest, eligible: cards.map(c => c.iid), source, ...extra }
}
