import type rulesJson from './config/rules.json'
import type { StrikeDef } from './cards'

export type Rules = typeof rulesJson & { mode: 'PURE_2000' | 'CRD_3' }
export type PlayerId = 0 | 1

export interface CardInstance {
  iid: string
  defId: string
  owner: PlayerId
}

export interface MPState {
  /** Level 1..n personality cards, index 0 = Level 1. */
  stack: CardInstance[]
  levelIndex: number
  stage: number
  anger: number
}

export interface AllyState {
  card: CardInstance
  stage: number
}

export interface PlayerState {
  id: PlayerId
  mp: MPState
  /** index 0 = top of the deck */
  lifeDeck: CardInstance[]
  hand: CardInstance[]
  /** last element = top of the pile */
  discard: CardInstance[]
  removed: CardInstance[]
  allies: AllyState[]
  drills: CardInstance[]
  dragonBalls: CardInstance[]
  /** Non-Combat cards placed face up in step 2 whose power has not been used yet. */
  nonCombat: CardInstance[]
}

export type Step = 'NON_COMBAT' | 'DECLARE' | 'COMBAT' | 'DISCARD' | 'REJUVENATE' | 'GAME_OVER'

export type StrikePhase = 'AWAIT_DEFENSE' | 'AWAIT_DB_STEAL'

export interface StrikeState {
  initiator: PlayerId
  /** the card being played, or null for a personality power */
  card: CardInstance | null
  strike: StrikeDef
  label: string
  phase: StrikePhase
  defenseCard: CardInstance | null
  lifeCardsDealt: number
}

export interface CombatState {
  /** whose attack phase it currently is */
  active: PlayerId
  consecutivePasses: number
  strike: StrikeState | null
  usedPowers: string[]
  ended: boolean
}

export type PendingChoice =
  | { kind: 'DEFEND'; player: PlayerId }
  | { kind: 'DB_STEAL'; player: PlayerId }
  | { kind: 'DISCARD_TO_LIMIT'; player: PlayerId; limit: number }
  | { kind: 'REJUVENATE'; player: PlayerId }

export type WinReason = 'SURVIVAL' | 'MPP' | 'DRAGON_BALLS'

export interface GameEvent {
  t: string
  player?: PlayerId
  msg: string
}

export interface GameState {
  rules: Rules
  rngSeed: number
  nextIid: number
  turn: number
  attacker: PlayerId
  step: Step
  players: [PlayerState, PlayerState]
  location: CardInstance | null
  locationPlayedThisTurn: boolean
  combat: CombatState | null
  pendingChoice: PendingChoice | null
  /** discard step works through attacker, then defender */
  discardQueue: PlayerId[]
  winner: PlayerId | null
  winReason: WinReason | null
  log: GameEvent[]
}

export type Action =
  | { type: 'PLAY_CARD'; player: PlayerId; iid: string }
  | { type: 'END_NON_COMBAT'; player: PlayerId }
  | { type: 'DECLARE_COMBAT'; player: PlayerId }
  | { type: 'SKIP_COMBAT'; player: PlayerId }
  | { type: 'USE_POWER'; player: PlayerId }
  | { type: 'PASS'; player: PlayerId }
  | { type: 'DEFEND'; player: PlayerId; iid: string | null }
  | { type: 'STEAL_DB'; player: PlayerId; iid: string | null }
  | { type: 'DISCARD'; player: PlayerId; iid: string }
  | { type: 'REJUVENATE'; player: PlayerId; accept: boolean }

export interface DeckList {
  /** Main Personality levels, Level 1 first */
  mp: string[]
  life: string[]
}

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0)
