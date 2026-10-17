import type { CardDB } from './cards'
import defaultRules from './config/rules.json'
import { nextRandom, shuffleInPlace } from './rng'
import { clone, log, powerRating } from './state'
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
    keepHand: [],
    winner: null,
    winReason: null,
    log: [],
  }
  s.nextIid = iid
  for (const p of s.players) s.rngSeed = shuffleInPlace(p.lifeDeck, s.rngSeed)
  s.attacker = rollInitiative(s, db)
  startTurn(s, db)
  return s
}

function rollInitiative(s: GameState, db: CardDB): PlayerId {
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
