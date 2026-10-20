import type { CardDB } from './cards'
import defaultRules from './config/rules.json'
import { nextRandom, shuffleInPlace } from './rng'
import { clone, log, mpDef, powerRating, tokuiWazaStyle } from './state'
import { startTurn } from './turn'
import type { CardInstance, DeckList, GameState, PlayerId, PlayerState, Rules } from './types'

export interface GameOptions {
  seed?: number
  rules?: Partial<Rules>
}

export function defaultRulesConfig(): Rules {
  return clone(defaultRules) as Rules
}

export function createGame(db: CardDB, decks: [DeckList, DeckList], opts: GameOptions = {}): GameState {
  const rules = { ...defaultRulesConfig(), ...opts.rules } as Rules
  let iid = 0
  const inst = (defId: string, owner: PlayerId): CardInstance => {
    if (!db[defId]) throw new Error(`Unknown card ${defId} in deck of player ${owner + 1}`)
    return { iid: `c${iid++}`, defId, owner }
  }
  const player = (id: PlayerId): PlayerState => ({
    id,
    mp: { stack: decks[id].mp.map(d => inst(d, id)), levelIndex: 0, stage: rules.startStage, anger: 0 },
    lifeDeck: decks[id].life.map(d => inst(d, id)),
    hand: [], discard: [], removed: [], allies: [], drills: [], dragonBalls: [], nonCombat: [],
    tokuiWaza: rules.trunks.tokuiWaza ? tokuiWazaStyle(db, decks[id]) : null,
    mastery: rules.trunks.tokuiWaza && decks[id].mastery ? inst(decks[id].mastery!, id) : null,
  })

  const s: GameState = {
    rules,
    rngSeed: (opts.seed ?? Date.now()) >>> 0,
    nextIid: 0,
    turn: 1,
    attacker: 0,
    step: 'NON_COMBAT',
    players: [player(0), player(1)],
    location: null,
    locationPlayedThisTurn: false,
    combat: null,
    pendingChoice: null,
    discardQueue: [],
    stack: [],
    resolving: [],
    skipCombat: [],
    usedPerGame: [],
    discardAsLife: [],
    delayed: [],
    endNextCombat: [],
    angerLock: [],
    attachments: [],
    powerLocks: [],
    disabledDrills: [],
    retireTo: {},
    discardMark: [0, 0],
    keepHand: [],
    combatSkipped: false,
    victoryGuards: [],
    postponedWins: [],
    stageLocks: [],
    victoryBlocks: [],
    winner: null,
    winReason: null,
    log: [],
  }
  s.nextIid = iid
  for (const p of s.players) s.rngSeed = shuffleInPlace(p.lifeDeck, s.rngSeed)
  for (const p of s.players) if (p.tokuiWaza) log(s, 'SETUP', `Player ${p.id + 1} claims a ${p.tokuiWaza} Tokui-Waza: +1 PUR`, p.id)
  s.attacker = rollInitiative(s, db)
  startTurn(s, db)
  return s
}

/** Double Power Rule (Cell and Buu Saga rulebooks): a Main Personality with double the other's starting power rating starts at 2 stages, the weaker one at his highest stage and goes first. Not for Z power stages. */
function doublePower(s: GameState, db: CardDB): PlayerId | null {
  const ini = s.rules.initiative
  const mps = ([0, 1] as PlayerId[]).map(p => mpDef(s, db, p).personality!)
  if (!ini.dominanceRatio || mps.some(m => m.zPower)) return null
  const [r0, r1] = [powerRating(s, db, 0), powerRating(s, db, 1)]
  const strong: PlayerId = r0 >= r1 ? 0 : 1
  const [rs, rw] = strong === 0 ? [r0, r1] : [r1, r0]
  if (rw <= 0 || rs < ini.dominanceRatio * rw) return null
  const weak: PlayerId = strong === 0 ? 1 : 0
  s.players[strong].mp.stage = ini.dominantStage
  s.players[weak].mp.stage = ini.weakerStage
  log(s, 'SETUP', `Double Power Rule: player ${strong + 1} starts at stage ${ini.dominantStage}, player ${weak + 1} at stage ${ini.weakerStage} and goes first`, weak)
  return weak
}

function rollInitiative(s: GameState, db: CardDB): PlayerId {
  if (s.rules.trunks.heroFirst) {
    // Cell Saga rulebook onwards
    const dp = s.rules.trunks.doublePower ? doublePower(s, db) : null
    if (dp !== null) return dp
  }
  if (s.rules.trunks.heroFirst) {
    // Trunks Saga: the hero player goes first; with two heroes or two villains, a coin flip
    const heroes = ([0, 1] as PlayerId[]).filter(p => mpDef(s, db, p).personality!.alignment === 'Hero')
    let first: PlayerId
    if (heroes.length === 1) first = heroes[0]
    else {
      const [r, n] = nextRandom(s.rngSeed)
      s.rngSeed = n
      first = r < 0.5 ? 0 : 1
    }
    log(s, 'SETUP', heroes.length === 1 ? `Player ${first + 1} plays the hero and goes first` : `Player ${first + 1} goes first (coin flip)`, first)
    return first
  }
  const [r0, r1] = [powerRating(s, db, 0), powerRating(s, db, 1)]
  const ini = s.rules.initiative
  let first: PlayerId
  if (r0 === r1) {
    const [r, n] = nextRandom(s.rngSeed)
    s.rngSeed = n
    first = r < 0.5 ? 0 : 1
  } else {
    first = r0 < r1 ? 0 : 1
  }
  const strong = first === 0 ? 1 : 0
  const [rs, rw] = [powerRating(s, db, strong), powerRating(s, db, first)]
  if (ini.dominanceRatio > 0 && rw > 0 && rs >= ini.dominanceRatio * rw) {
    s.players[strong].mp.stage = ini.dominantStage
    s.players[first].mp.stage = ini.weakerStage
    log(s, 'SETUP', `Player ${strong + 1} is ${ini.dominanceRatio}x stronger: starts at stage ${ini.dominantStage}, player ${first + 1} at stage ${ini.weakerStage}`)
  }
  log(s, 'SETUP', `Player ${first + 1} goes first (power ${r0} vs ${r1} at stage ${s.rules.startStage})`, first)
  return first
}
