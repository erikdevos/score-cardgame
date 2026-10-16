import type { CardDB, CardDef, Passive } from './cards'
import { other, type CardInstance, type GameState, type PlayerId, type WinReason } from './types'

export function log(s: GameState, t: string, msg: string, player?: PlayerId) {
  s.log.push({ t, msg, player })
}

export function def(db: CardDB, c: CardInstance): CardDef {
  const d = db[c.defId]
  if (!d) throw new Error(`Unknown card ${c.defId}`)
  return d
}

export function mpDef(s: GameState, db: CardDB, p: PlayerId): CardDef {
  const mp = s.players[p].mp
  return def(db, mp.stack[mp.levelIndex])
}

export function powerRating(s: GameState, db: CardDB, p: PlayerId): number {
  const d = mpDef(s, db, p)
  return d.personality!.powerRatings[s.players[p].mp.stage]
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
  return out
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
export function millCards(s: GameState, p: PlayerId, n: number): number {
  const pl = s.players[p]
  let done = 0
  for (let i = 0; i < n; i++) {
    const c = pl.lifeDeck.shift()
    if (!c) {
      win(s, other(p), 'SURVIVAL')
      return done
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
  const mp = s.players[p].mp
  mp.stage = Math.max(0, Math.min(s.rules.maxStage, mp.stage + delta))
}

export function changeAnger(s: GameState, db: CardDB, p: PlayerId, delta: number) {
  const mp = s.players[p].mp
  mp.anger = Math.max(0, Math.min(s.rules.maxAnger, mp.anger + delta))
  if (delta !== 0) log(s, 'ANGER', `Player ${p + 1} anger ${delta > 0 ? '+' : ''}${delta} (now ${mp.anger})`, p)
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
    mp.stage = s.rules.levelUpStage
    log(s, 'LEVEL_UP', `Player ${p + 1}'s ${mpDef(s, db, p).name} enters play (level ${mp.levelIndex + 1}), drills discarded`, p)
  } else if (!mpDef(s, db, p).personality!.cannotWinMPP) {
    win(s, p, 'MPP')
  }
}

export function checkDragonBallVictory(s: GameState, db: CardDB) {
  for (const pl of s.players) {
    const nums = new Set(pl.dragonBalls.map(c => def(db, c).dragonBallNumber))
    if ([1, 2, 3, 4, 5, 6, 7].every(n => nums.has(n))) win(s, pl.id, 'DRAGON_BALLS')
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

/** Deep copy of plain game data (available in browsers and Node 17+). */
export const clone: <T>(v: T) => T = (globalThis as { structuredClone?: <T>(v: T) => T }).structuredClone!
