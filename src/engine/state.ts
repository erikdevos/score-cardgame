import type { CardDB, CardDef, Passive } from './cards'
import { other, type CardInstance, type Frame, type GameState, type PlayerId, type StepName, type WinReason } from './types'

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
  return d.personality!.powerRatings[stage]
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
  const u = d.usableBy
  if (!u) return true
  const mp = mpDef(s, db, p).personality!
  return !!(u.alignments?.includes(mp.alignment as 'Hero' | 'Villain') || u.characters?.includes(mp.character))
}

export function handLimit(s: GameState, db: CardDB, p: PlayerId): number {
  return Math.max(0, s.rules.handLimit + sumPassive(s, db, p, 'HAND_LIMIT'))
}

export function pur(s: GameState, db: CardDB, p: PlayerId): number {
  return Math.max(0, mpDef(s, db, p).personality!.pur + sumPassive(s, db, p, 'PUR_MOD'))
}

function sumPassive(s: GameState, db: CardDB, p: PlayerId, kind: 'HAND_LIMIT' | 'PUR_MOD') {
  return activePassives(s, db, p).reduce((n, ps) => (ps.kind === kind ? n + ps.amount : n), 0)
}

export function win(s: GameState, p: PlayerId, reason: WinReason) {
  if (s.winner !== null) return
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
export const dragonBallKind = (name: string) => (/Namek/i.test(name) ? 'Namek' : 'Earth')

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
  const ally = controllingAlly(s, p)
  if (ally) return void (ally.stage = Math.max(0, Math.min(s.rules.maxStage, ally.stage + delta)))
  const mp = s.players[p].mp
  mp.stage = Math.max(0, Math.min(s.rules.maxStage, mp.stage + delta))
}

export function changeAnger(s: GameState, db: CardDB, p: PlayerId, delta: number, mirrored = false) {
  if (delta > 0 && s.angerLock.includes(p)) return log(s, 'ANGER', `Player ${p + 1}'s anger cannot rise yet`, p)
  const mp = s.players[p].mp
  const before = mp.anger
  mp.anger = Math.max(0, Math.min(s.rules.maxAnger, mp.anger + delta))
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
  if (mp.anger >= s.rules.maxAnger) onMaxAnger(s, db, p)
}

function onMaxAnger(s: GameState, db: CardDB, p: PlayerId) {
  const pl = s.players[p]
  const mp = pl.mp
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
    const kinds = trunks ? ['Earth', 'Namek'] : ['']
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
  out.push(...s.resolving)
  const st = s.combat?.strike
  if (st?.card) out.push(st.card)
  if (st?.defenseCard) out.push(st.defenseCard)
  return out.filter(c => c.owner === p)
}

/** Send a card to its owner's discard pile, or remove it from the game. */
export function retire(s: GameState, c: CardInstance, mode: 'DISCARD' | 'REMOVE' | 'STAYS') {
  const owner = s.players[c.owner]
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
