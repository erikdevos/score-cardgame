import type rulesJson from './config/rules.json'
import type { Defense, Effect, StrikeDef } from './cards'

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
  /** how the defense (card or power) affects this strike; null = no defense */
  defense: Defense | null
  lifeCardsDealt: number
  /** power stages the initiator paid as the cost (opens the reaction window) */
  paidStages: number
  /** "change the power stage to the maximum for this attack" (SS-17) */
  tempStage?: number
  /** "may take the first card discarded from the life deck into hand" (SS-112) */
  takeFirstMilled?: PlayerId
}

export type AttackType = 'PHYSICAL' | 'ENERGY' | 'ANY'

/** "cannot make attacks of type X" for a number of that player's attack phases. */
export interface AttackRestriction {
  player: PlayerId
  attackType: AttackType
  phases: number
  /** created during the restricted player's own phase: that phase does not count */
  skipCurrent: boolean
  source: string
}

/** Damage change for attacks on `player` for the rest of this combat. */
export interface CombatDamageMod {
  player: PlayerId
  attackType: AttackType
  stages: number
  lifeCards: number
  source: string
}

export interface CombatState {
  /** whose attack phase it currently is */
  active: PlayerId
  consecutivePasses: number
  strike: StrikeState | null
  usedPowers: string[]
  ended: boolean
  restrictions: AttackRestriction[]
  /** "all the damage you would take this combat destroys one of your allies instead": the chosen ally */
  allyShield: { player: PlayerId; allyIid: string }[]
  /** Multi-Form: the same player attacks again before the phase passes */
  bonusAttack: { player: PlayerId; attackType: AttackType; remaining: number; active: boolean } | null
  /** card definitions used this combat (for "multiples cannot be used together") */
  usedCardIds: string[]
  /** stages and anger at the start of combat ("this battle never happened") */
  startLevels: { stage: number; anger: number }[]
  /** the physical attack each player defended against with a card (for copying it) */
  defended: ({ strike: StrikeDef; label: string } | null)[]
  damageMods: CombatDamageMod[]
  /** cards that stay on the table for N more uses this combat, by iid */
  extraUses: Record<string, number>
  /** once-per-combat effects already used (drills etc.) */
  onceKeys: string[]
  /** result of each player's most recent attack this combat */
  lastAttack: [LastAttack | null, LastAttack | null]
}

export interface LastAttack {
  type: 'PHYSICAL' | 'ENERGY'
  success: boolean
}

export type PickZone = 'discard' | 'dragonBalls' | 'lifeDeck' | 'hand' | 'drills' | 'allies' | 'nonCombat'
export type PickDest =
  | 'HAND' | 'LIFE_TOP' | 'LIFE_BOTTOM' | 'PICKER_DRAGON_BALLS' | 'OWNER_LIFE_BOTTOM'
  | 'DISCARD' | 'REMOVED'
  /** put into play for the picker: Dragon Ball, drill or ally (ally at `allyStage`) */
  | 'PLAY'
  /** an ally gives its power stages to the main personality; the card stays */
  | 'ALLY_TO_MP_STAGES'
  /** the chosen ally will absorb this combat's damage (Ally's Sacrifice); the card stays */
  | 'MARK_ALLY_SHIELD'

/** Choices raised by card effects; they wait until the current action has resolved. */
export type QueuedChoice =
  | { kind: 'PICK'; player: PlayerId; owner: PlayerId; zones: PickZone[]; count: number; dest: PickDest; eligible: string[]; source: string; allyStage?: number }
  | { kind: 'CONFIRM'; player: PlayerId; effects: Effect[]; source: string; prompt: string }
  | { kind: 'OPTION'; player: PlayerId; source: string; prompt: string; options: string[]; purpose: 'honorDuel' | 'transferStages' | 'shuffle' | 'anger' | 'nameCard'; data: Record<string, string | number> }

/** Pending work: what is left to resolve. The top of the stack (last element) runs first. */
export type Frame =
  | { k: 'effects'; user: PlayerId; source: string; card?: CardInstance; triggered?: boolean; effects: Effect[] }
  | { k: 'choice'; q: QueuedChoice }
  | { k: 'step'; name: StepName; player?: PlayerId; iid?: string }
  /** put back a decision that was interrupted by an "at any time" card */
  | { k: 'resume'; pending: PendingChoice }

export type StepName =
  | 'strike.react' | 'strike.attackTrigger' | 'strike.afterSecondaries' | 'strike.resolveHit' | 'strike.afterOnHit' | 'strike.cleanup'
  | 'retire' | 'dbCheck' | 'endOfTurnWindow' | 'endTurn'

export type WindowKind = 'REACT' | 'END_OF_TURN'

export type PendingChoice =
  | { kind: 'DEFEND'; player: PlayerId }
  | { kind: 'DB_STEAL'; player: PlayerId }
  | { kind: 'DISCARD_TO_LIMIT'; player: PlayerId; limit: number }
  | { kind: 'REJUVENATE'; player: PlayerId }
  | (QueuedChoice & { kind: 'PICK' })
  | (QueuedChoice & { kind: 'CONFIRM' })
  | (QueuedChoice & { kind: 'OPTION' })
  /** a timing window: respond with one of these cards, or let it pass */
  | { kind: 'WINDOW'; player: PlayerId; window: WindowKind; iids: string[] }

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
  /** pending work; see Frame */
  stack: Frame[]
  /** cards being used whose effects are still resolving */
  resolving: CardInstance[]
  /** "skip the combat step of your next turn": player and the turn number it applies to */
  skipCombat: { player: PlayerId; turn: number; source: string }[]
  /** once-per-game uses (keys) */
  usedPerGame: string[]
  /** "uses the bottom N cards of the discard pile for the next combat instead of the life deck" */
  discardAsLife: { player: PlayerId; mode: 'DAMAGE' | 'DRAW'; position?: 'top' | 'bottom'; remaining: number; armed: boolean; source: string }[]
  /** "end the very next combat you are forced into" */
  endNextCombat: PlayerId[]
  /** anger cannot rise until this player forces a life card discard */
  angerLock: PlayerId[]
  /** may keep extra cards in the discard step of this turn */
  keepHand: { player: PlayerId; turn: number }[]
  /** effects that happen at the start of a later turn */
  delayed: { player: PlayerId; turn: number; kind: 'plantAlly'; character: string; source: string }[]
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
  | { type: 'DEFEND_POWER'; player: PlayerId }
  | { type: 'PICK'; player: PlayerId; iid: string }
  | { type: 'CONFIRM'; player: PlayerId; accept: boolean }
  | { type: 'CHOOSE'; player: PlayerId; index: number }
  | { type: 'RESPOND'; player: PlayerId; iid: string | null }
  /** use an "at any time" card without spending your attack phase */
  | { type: 'USE_FREE'; player: PlayerId; iid: string }
  /** repeat the physical attack you defended against (SS-133) */
  | { type: 'COPY_ATTACK'; player: PlayerId }
  | { type: 'STEAL_DB'; player: PlayerId; iid: string | null }
  | { type: 'DISCARD'; player: PlayerId; iid: string }
  | { type: 'REJUVENATE'; player: PlayerId; accept: boolean }

export interface DeckList {
  /** Main Personality levels, Level 1 first */
  mp: string[]
  life: string[]
}

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0)
