import type { CardDB, CardDef, Effect, Passive } from './cards'
import { shuffleInPlace } from './rng'
import { other, type CardInstance, type DeckList, type Frame, type GameState, type PlayerId, type StepName, type WinReason } from './types'

export function log(s: GameState, t: string, msg: string, player?: PlayerId) {
  s.log.push({ t, msg, player })
}

export function def(db: CardDB, c: CardInstance): CardDef {
  const d = db[c.defId]
  if (!d) throw new Error(`Unknown card ${c.defId}`)
  return d
}

/** Trunks Saga: the ally fighting this combat in place of the main personality, if any. */
export function controllingAlly(s: GameState, p: PlayerId) {
  const c = s.combat?.controllers.find(x => x.player === p)
  return c ? s.players[p].allies.find(a => a.card.iid === c.allyIid) : undefined
}

/** The personality card fighting for p: the main personality, or an ally that took over the combat. */
export function mpDef(s: GameState, db: CardDB, p: PlayerId): CardDef {
  const ally = controllingAlly(s, p)
  if (ally) return def(db, ally.card)
  const mp = s.players[p].mp
  return def(db, mp.stack[mp.levelIndex])
}

/** Power stage of the fighting personality. */
export function fighterStage(s: GameState, p: PlayerId): number {
  return controllingAlly(s, p)?.stage ?? s.players[p].mp.stage
}

export function powerRating(s: GameState, db: CardDB, p: PlayerId): number {
  const d = mpDef(s, db, p)
  const st = s.combat?.strike
  const stage = st && st.initiator === p && st.tempStage !== undefined ? st.tempStage : fighterStage(s, p)
  let bonus = 0
  for (const a of s.attachments) {
    if (a.host.kind !== 'mp' || a.host.player !== p) continue
    for (const e of a.effects) {
      if (e.action !== 'CUSTOM' || e.handler !== 'powerRatingBonus') continue
      if (e.params?.unlessAtStage !== undefined && stage === e.params.unlessAtStage) continue
      bonus += Number(e.params?.amount ?? 0)
    }
  }
  return d.personality!.powerRatings[stage] + bonus
}

export function cardName(db: CardDB, c: CardInstance | null): string {
  return c ? def(db, c).name : 'power'
}

/** All passives that apply to player `p`, from their drills/allies and the location. */
export function activePassives(s: GameState, db: CardDB, p: PlayerId): Passive[] {
  const out: Passive[] = []
  const collect = (c: CardInstance) => {
    for (const ps of def(db, c).passives) {
      const applies = ps.scope === 'ALL' || (ps.scope === 'OWNER') === (c.owner === p)
      if (applies) out.push(ps)
    }
  }
  for (const pl of s.players) pl.drills.forEach(collect)
  if (s.location) collect(s.location)
  // FS-111: a borrowed drill works for the borrower as if it were theirs
  for (const b of s.combat?.borrowedDrills ?? []) if (b.player === p) collect({ iid: `borrowed-${b.defId}`, defId: b.defId, owner: p })
  // FS-77: a passive that only holds while a character is in play
  for (const pl of s.players) {
    for (const c of pl.drills) {
      for (const e of def(db, c).effects.onEnterPlay) {
        if (e.action !== 'CUSTOM' || e.handler !== 'conditionalPassive') continue
        const params = e.params ?? {}
        const ps = params.passive as Passive | undefined
        const need = (params.condition as { inPlay?: string } | undefined)?.inPlay
        const present = !need || s.players.some((x, i) => mpDef(s, db, i as PlayerId).personality!.character === need || x.allies.some(a => def(db, a.card).personality?.character === need))
        if (ps && present && (ps.scope === 'ALL' || (ps.scope === 'OWNER') === (c.owner === p))) out.push(ps)
      }
    }
  }
  return out
}

/**
 * Trunks Saga ally rules: same alignment as the main personality (Vegeta and Piccolo may pick either side),
 * at least 2 levels below the main personality's highest level, never either main personality's character.
 */
export function trunksAllyAllowed(mpCards: CardDef[], foeCharacter: string | undefined, ally: CardDef): boolean {
  const mp = mpCards[0]?.personality
  const a = ally.personality
  if (!mp || !a) return false
  if (a.character === mp.character || a.character === foeCharacter) return false
  if (!['Vegeta', 'Piccolo'].includes(mp.character) && a.alignment !== mp.alignment) return false
  return a.level <= mpCards.length - 2
}

/** Card restriction "X only": the player's MP must match an allowed alignment or character. */
export function canUseCard(s: GameState, db: CardDB, p: PlayerId, d: CardDef): boolean {
  // TS-42/TS-P4: no cards that end combat while the drill is in play; TS-128: the drill owner's opponent plays no allies
  for (const pl of s.players) {
    for (const c of pl.drills) {
      for (const f of findCustom(def(db, c).effects.onEnterPlay, 'forbidCards')) {
        const filter = (f.filter ?? {}) as { effect?: string; cardType?: string }
        if (filter.effect === 'END_COMBAT' && JSON.stringify(d.effects).includes('"END_COMBAT"')) return false
        if (filter.cardType === 'Ally' && pl.id !== p && d.type === 'Personality') return false
      }
    }
  }
  const u = d.usableBy
  if (!u) return true
  const mp = mpDef(s, db, p).personality!
  // "Majin only": every Majin personality (Majin Buu, Majin Vegeta, ...)
  const majin = !!u.characters?.includes('Majin') && (mp.character.startsWith('Majin') || s.attachments.some(a => a.host.kind === 'mp' && a.host.player === p && a.effects.some(e => e.action === 'CUSTOM' && e.handler === 'grantMajin')))
  return !!(u.alignments?.includes(mp.alignment as 'Hero' | 'Villain') || u.characters?.includes(mp.character) || majin)
}

export function handLimit(s: GameState, db: CardDB, p: PlayerId): number {
  return Math.max(0, s.rules.handLimit + sumPassive(s, db, p, 'HAND_LIMIT'))
}

export function pur(s: GameState, db: CardDB, p: PlayerId): number {
  return Math.max(0, mpDef(s, db, p).personality!.pur + sumPassive(s, db, p, 'PUR_MOD') + (s.players[p].tokuiWaza ? 1 : 0))
}

function sumPassive(s: GameState, db: CardDB, p: PlayerId, kind: 'HAND_LIMIT' | 'PUR_MOD') {
  return activePassives(s, db, p).reduce((n, ps) => (ps.kind === kind ? n + ps.amount : n), 0)
}

/** Params of every CUSTOM effect with this handler, including ones nested in `then`. */
export function findCustom(effects: Effect[], handler: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const e of effects) {
    if (e.action !== 'CUSTOM') continue
    const p = e.params ?? {}
    if (e.handler === handler) out.push(p)
    if (Array.isArray(p.then)) out.push(...findCustom(p.then as Effect[], handler))
  }
  return out
}

/** Constant Combat Powers: always-on effects of the main personality's power (off while a card stops them this combat). */
export function constantParams(s: GameState, db: CardDB, p: PlayerId, handler: string): Record<string, unknown>[] {
  const power = mpDef(s, db, p).personality!.power
  if (!power || s.combat?.noConstantPowers || s.powerLocks.some(l => l.player === p)) return []
  return constantEffectsOf(power).flatMap(c => findCustom((c.then ?? []) as Effect[], handler))
}

/** The constantPower effects of a personality power, including a second Constant Combat Power on the card (BU-197..199). */
export function constantEffectsOf(power: { strike: { effects: { onPlaySecondary: Effect[] } } }) {
  const extra = findCustom(power.strike.effects.onPlaySecondary, 'additionalPower').filter(a => a.kind === 'constant')
    .flatMap(a => findCustom(((a.strike as { effects?: { onPlaySecondary?: Effect[] } })?.effects?.onPlaySecondary ?? []), 'constantPower'))
  return [...findCustom(power.strike.effects.onPlaySecondary, 'constantPower'), ...extra]
}

/** Trunks Saga Mastery card params with this handler. */
export const masteryParams = (s: GameState, db: CardDB, p: PlayerId, handler: string) => {
  const m = s.players[p].mastery
  return m ? findCustom(def(db, m).effects.onEnterPlay, handler) : []
}

/** Anger needed for the next level: 5, or 6 against TS-149 Blue Style Mastery. */
export const maxAngerOf = (s: GameState, db: CardDB, p: PlayerId) =>
  Math.max(s.rules.maxAnger, ...masteryParams(s, db, other(p), 'angerToLevelUp').map(x => Number(x.amount ?? s.rules.maxAnger)))

export function win(s: GameState, p: PlayerId, reason: WinReason) {
  if (s.winner !== null) return
  // TS-157: the loser postpones the victory to the start of the winner's next turn, then it is checked again
  const loser = s.players[other(p)]
  const hope = loser.nonCombat.find(c => s.victoryGuards.includes(c.iid))
  if (hope && !s.postponedWins.some(w => w.player === p)) {
    loser.nonCombat = loser.nonCombat.filter(c => c !== hope)
    loser.removed.push(hope)
    s.postponedWins.push({ player: p, reason, turn: s.turn + (s.attacker === p ? 2 : 1) })
    return log(s, 'PROTECT', `Player ${loser.id + 1} postpones player ${p + 1}'s victory to the start of their next turn`, loser.id)
  }
  const block = reason !== 'SURVIVAL' && s.victoryBlocks.find(b => b.player === p && s.turn < b.untilTurn)
  if (block) return log(s, 'NO_EFFECT', `${block.source}: player ${p + 1} cannot win this way yet`, p)
  s.winner = p
  s.winReason = reason
  s.step = 'GAME_OVER'
  s.pendingChoice = null
  log(s, 'WIN', `Player ${p + 1} wins by ${reason.replace('_', ' ').toLowerCase()} victory`, p)
}

export const over = (s: GameState) => s.winner !== null

/** Draw from the top of the life deck. Running out while drawing is a survival loss. */
export function drawCards(s: GameState, p: PlayerId, n: number) {
  const pl = s.players[p]
  for (let i = 0; i < n; i++) {
    const c = pl.lifeDeck.shift()
    if (!c) return win(s, other(p), 'SURVIVAL')
    pl.hand.push(c)
  }
  log(s, 'DRAW', `Player ${p + 1} draws ${n}`, p)
}

/** Life cards of damage / mill: top of life deck to discard. Returns cards actually discarded. */
/** Earth, Namek and (Cell Saga) Dende Dragon Balls are separate sets of 7, told apart by name. */
export const dragonBallKind = (name: string) => (/Namek/i.test(name) ? 'Namek' : /Dende/i.test(name) ? 'Dende' : 'Earth')

export function millCards(s: GameState, p: PlayerId, n: number, db?: CardDB): number {
  const pl = s.players[p]
  let done = 0
  for (let i = 0; i < n; i++) {
    const c = pl.lifeDeck.shift()
    if (!c) {
      win(s, other(p), 'SURVIVAL')
      return done
    }
    if (db && s.rules.trunks.dragonBalls && def(db, c).type === 'Dragon Ball') {
      // Trunks Saga: a Dragon Ball is never discarded as damage. A copy already in play leaves the game,
      // otherwise it goes to the bottom of the life deck; neither counts as a discard.
      const d = def(db, c)
      const inPlay = s.players.some(x => x.dragonBalls.some(b => def(db, b).name === d.name))
      if (inPlay) pl.removed.push(c)
      else pl.lifeDeck.push(c)
      log(s, 'DB_SAVE', `${d.name} is not discarded: ${inPlay ? 'already in play, removed from the game' : 'put at the bottom of the life deck'}`, p)
      if (pl.lifeDeck.length && pl.lifeDeck.every(x => def(db, x).type === 'Dragon Ball')) {
        win(s, other(p), 'SURVIVAL')
        return done
      }
      i--
      continue
    }
    pl.discard.push(c)
    done++
  }
  return done
}

/** Top N cards of the discard pile to the bottom of the life deck. */
export function recoverCards(s: GameState, p: PlayerId, n: number): number {
  const pl = s.players[p]
  let done = 0
  while (done < n && pl.discard.length) {
    pl.lifeDeck.push(pl.discard.pop()!)
    done++
  }
  return done
}

export function changeStages(s: GameState, p: PlayerId, delta: number) {
  // TS-29: this player cannot gain power stages for now
  if (delta > 0 && s.stageLocks.some(l => l.player === p && s.turn < l.untilTurn)) return log(s, 'STAGES', `Player ${p + 1} cannot gain power stages yet`, p)
  const ally = controllingAlly(s, p)
  if (ally) return void (ally.stage = Math.max(0, Math.min(s.rules.maxStage, ally.stage + delta)))
  const mp = s.players[p].mp
  mp.stage = Math.max(0, Math.min(s.rules.maxStage, mp.stage + delta))
}

export function changeAnger(s: GameState, db: CardDB, p: PlayerId, delta: number, mirrored = false) {
  if (delta > 0 && s.angerLock.includes(p)) return log(s, 'ANGER', `Player ${p + 1}'s anger cannot rise yet`, p)
  // AS-93: no card or effect raises anger by more than 1 level
  if (delta > 1 && [s.location, ...s.players.flatMap(pl => pl.nonCombat)].some(c => c && def(db, c).effects.onEnterPlay.some(e => e.action === 'CUSTOM' && e.handler === 'angerRaiseLimit'))) delta = 1
  // TS-166 / TS-200: anger lowered by at most N levels per card
  if (delta < 0 && !mirrored) {
    const caps = constantParams(s, db, p, 'angerReductionLimit').map(x => Number(x.maxPerCard ?? 0))
    if (caps.length) delta = Math.max(delta, -Math.min(...caps))
    if (delta === 0) return log(s, 'ANGER', `Player ${p + 1}'s anger cannot be lowered`, p)
  }
  const mp = s.players[p].mp
  const before = mp.anger
  const max = maxAngerOf(s, db, p)
  mp.anger = Math.max(0, Math.min(max, mp.anger + delta))
  if (delta !== 0) log(s, 'ANGER', `Player ${p + 1} anger ${delta > 0 ? '+' : ''}${delta} (now ${mp.anger})`, p)
  // FS-P3: anger you lose on your Warrior Sword (the anger counter) is also lost by your opponents
  const reduced = before - mp.anger
  if (reduced > 0 && !mirrored) {
    const mirror = s.players[p].nonCombat.find(c => def(db, c).effects.onEnterPlay.some(e => e.action === 'CUSTOM' && e.handler === 'mirrorAngerReduction'))
    if (mirror) {
      log(s, 'ANGER', `${def(db, mirror).name}: opponents lose ${reduced} anger as well`, p)
      changeAnger(s, db, other(p), -reduced, true)
    }
  }
  // CG-99: "when you reach 5 anger you lose the game"
  const doom = s.players[p].nonCombat.some(c => findCustom(def(db, c).effects.onEnterPlay, 'loseGameAtAnger').some(x => mp.anger >= Number(x.anger ?? 5)))
  if (doom) return win(s, other(p), 'SURVIVAL')
  if (mp.anger >= max) onMaxAnger(s, db, p)
}

function onMaxAnger(s: GameState, db: CardDB, p: PlayerId) {
  const pl = s.players[p]
  const mp = pl.mp
  // TS-37 (lying on the opponent's table): back to anger 3 instead of gaining a level, then removed
  const foe = s.players[other(p)]
  const hold = mp.levelIndex < mp.stack.length - 1 && foe.nonCombat.find(c => findCustom(def(db, c).effects.onEnterPlay, 'preventLevelUp').length)
  if (hold) {
    foe.nonCombat = foe.nonCombat.filter(c => c !== hold)
    foe.removed.push(hold)
    mp.anger = Number(findCustom(def(db, hold).effects.onEnterPlay, 'preventLevelUp')[0].setAngerTo ?? 3)
    return log(s, 'ANGER', `${def(db, hold).name}: player ${p + 1} goes back to anger ${mp.anger} instead of gaining a level`, p)
  }
  if (mp.levelIndex < mp.stack.length - 1) {
    mp.anger = 0
    pl.discard.push(...pl.drills)
    pl.drills = []
    mp.levelIndex++
    // Trunks Saga: the new level starts at its highest power stage
    mp.stage = s.rules.trunks.levelStages ? s.rules.maxStage : s.rules.levelUpStage
    log(s, 'LEVEL_UP', `Player ${p + 1}'s ${def(db, mp.stack[mp.levelIndex]).name} enters play (level ${mp.levelIndex + 1}), drills discarded`, p)
    if (s.rules.trunks.mostPowerfulByHighestLevel) checkMostPowerful(s, db, p)
  } else if (s.rules.trunks.mostPowerfulByHighestLevel) {
    // Trunks Saga: at the highest level, 5 anger powers up to full instead
    mp.anger = 0
    mp.stage = s.rules.maxStage
    log(s, 'POWER_UP', `Player ${p + 1} is at their highest level: full power, anger back to 0`, p)
  } else if (!mpDef(s, db, p).personality!.cannotWinMPP) {
    win(s, p, 'MPP')
  }
}

/** Trunks Saga: you win the instant your main personality reaches the highest level any main personality in the game has. */
export function checkMostPowerful(s: GameState, db: CardDB, p: PlayerId) {
  const target = Math.max(...s.players.map(x => x.mp.stack.length))
  if (s.players[p].mp.levelIndex + 1 >= target && !mpDef(s, db, p).personality!.cannotWinMPP) win(s, p, 'MPP')
}

/**
 * Dragon Ball victory: all 7 of one kind. Trunks Saga: Earth and Namek Dragon Balls are separate sets, and
 * completing a set by capture only wins at the start of your next turn (`captured`).
 */
export function checkDragonBallVictory(s: GameState, db: CardDB, how: 'play' | 'capture' | 'turnStart' = 'play') {
  const trunks = s.rules.trunks.dragonBalls
  for (const pl of s.players) {
    if (how === 'turnStart' && pl.id !== s.attacker) continue
    const kinds = trunks ? ['Earth', 'Namek', 'Dende'] : ['']
    const complete = kinds.some(kind => {
      const nums = new Set(pl.dragonBalls.filter(c => !kind || dragonBallKind(def(db, c).name) === kind).map(c => def(db, c).dragonBallNumber))
      return [1, 2, 3, 4, 5, 6, 7].every(n => nums.has(n))
    })
    if (!complete) continue
    if (trunks && how === 'capture') {
      log(s, 'DB_PENDING', `Player ${pl.id + 1} has all 7 Dragon Balls: they win at the start of their next turn if they still have them`, pl.id)
      continue
    }
    win(s, pl.id, 'DRAGON_BALLS')
  }
}

/** Take a card the player is about to use: from hand, or from their unused Non-Combat cards. */
export function takeCard(s: GameState, p: PlayerId, iid: string): CardInstance {
  const pl = s.players[p]
  const i = pl.nonCombat.findIndex(c => c.iid === iid)
  return i >= 0 ? pl.nonCombat.splice(i, 1)[0] : removeFromHand(s, p, iid)
}

export const isOnTable = (s: GameState, p: PlayerId, iid: string) => s.players[p].nonCombat.some(c => c.iid === iid)

export function removeFromHand(s: GameState, p: PlayerId, iid: string): CardInstance {
  const hand = s.players[p].hand
  const i = hand.findIndex(c => c.iid === iid)
  if (i < 0) throw new Error(`Card ${iid} not in hand of player ${p + 1}`)
  return hand.splice(i, 1)[0]
}

/** Every card a player owns, wherever it is. Used for conservation checks. */
export function allCardsOf(s: GameState, p: PlayerId): CardInstance[] {
  const out: CardInstance[] = []
  for (const pl of s.players) {
    out.push(...pl.mp.stack, ...pl.lifeDeck, ...pl.hand, ...pl.discard, ...pl.removed, ...pl.drills, ...pl.dragonBalls, ...pl.nonCombat, ...pl.allies.map(a => a.card))
  }
  if (s.location) out.push(s.location)
  out.push(...s.resolving, ...s.attachments.map(a => a.card))
  const st = s.combat?.strike
  if (st?.card) out.push(st.card)
  if (st?.defenseCard) out.push(st.defenseCard)
  return out.filter(c => c.owner === p)
}

/** Send a card to its owner's discard pile, or remove it from the game. */
export function retire(s: GameState, c: CardInstance, mode: 'DISCARD' | 'REMOVE' | 'STAYS') {
  if (s.attachments.some(a => a.card.iid === c.iid)) return // attached cards stay on the table
  const owner = s.players[c.owner]
  const to = s.retireTo[c.iid]
  if (to) {
    // "shuffle this card into your Life Deck after use" / "place it at the bottom of your Life Deck"
    delete s.retireTo[c.iid]
    if (mode !== 'REMOVE') {
      owner.lifeDeck.push(c)
      if (to === 'LIFE_SHUFFLE') s.rngSeed = shuffleInPlace(owner.lifeDeck, s.rngSeed)
      return
    }
  }
  if (mode === 'REMOVE') owner.removed.push(c)
  else owner.discard.push(c)
}

/** Schedule work; the frames run in the order given, before anything already scheduled. */
export function schedule(s: GameState, ...frames: Frame[]) {
  for (let i = frames.length - 1; i >= 0; i--) s.stack.push(frames[i])
}
export const step = (name: StepName, extra: { player?: PlayerId; iid?: string } = {}): Frame => ({ k: 'step', name, ...extra })

/** Deep copy of plain game data (available in browsers and Node 17+). */
export const clone: <T>(v: T) => T = (globalThis as { structuredClone?: <T>(v: T) => T }).structuredClone!

const SAIYAN_HERITAGE = ['Goku', 'Gohan', 'Vegeta', 'Nappa', 'Raditz', 'Trunks']
/** "Saiyan Heritage only" cards: Saiyan personalities. */
export const isSaiyanHeritage = (character: string) => SAIYAN_HERITAGE.some(n => character.startsWith(n))

/**
 * Trunks Saga Tokui-Waza: every styled card in the life deck has the same style (at least one).
 * Only Saiyans claim Saiyan, only Piccolo and Nail claim Namekian, and a Mastery card must match.
 */
export function tokuiWazaStyle(db: CardDB, deck: DeckList): string | null {
  const styles = new Set(deck.life.map(id => db[id]?.style).filter((x): x is string => !!x))
  if (styles.size !== 1) return null
  const [style] = styles
  const character = db[deck.mp[0]]?.personality?.character ?? ''
  if (style === 'Saiyan' && !isSaiyanHeritage(character)) return null
  if (style === 'Namekian' && !/^(Piccolo|Nail)/.test(character)) return null
  const mastery = deck.mastery ? db[deck.mastery] : undefined
  if (mastery?.style && mastery.style !== style) return null
  return style
}

/** "If X is in play" (anywhere): a character as main personality or ally, or a card on the table. "Dragon Ball 6" matches any Dragon Ball numbered 6. */
export function inPlayAnywhere(s: GameState, db: CardDB, what: { character?: unknown; cardName?: unknown }): boolean {
  if (typeof what.character === 'string') {
    return s.players.some((pl, i) => mpDef(s, db, i as PlayerId).personality!.character === what.character || pl.allies.some(a => def(db, a.card).personality?.character === what.character))
  }
  if (typeof what.cardName !== 'string') return false
  const ball = /^Dragon Ball (\d)$/.exec(what.cardName)
  return s.players.some(pl => {
    if (ball) return pl.dragonBalls.some(c => def(db, c).dragonBallNumber === Number(ball[1]))
    return [...pl.drills, ...pl.nonCombat, ...pl.dragonBalls, ...pl.allies.map(a => a.card)].some(c => def(db, c).name === what.cardName)
  })
}
