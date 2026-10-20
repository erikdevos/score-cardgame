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
  /** Trunks Saga: the single martial arts style this player claims (+1 PUR), or null */
  tokuiWaza: string | null
  /** Trunks Saga: Mastery card placed face up at the start; its power applies all game */
  mastery: CardInstance | null
}

export type Step = 'NON_COMBAT' | 'DECLARE' | 'COMBAT' | 'DISCARD' | 'REJUVENATE' | 'GAME_OVER'

export type StrikePhase = 'AWAIT_DEFENSE' | 'AWAIT_DB_STEAL'

export interface StrikeState {
  initiator: PlayerId
  /** Dragon Balls the attacker may still capture after this hit (FS-P12: 2) */
  captures?: number
  /** the card being played, or null for a personality power */
  card: CardInstance | null
  strike: StrikeDef
  label: string
  phase: StrikePhase
  defenseCard: CardInstance | null
  /** how the defense (card or power) affects this strike; null = no defense */
  defense: Defense | null
  lifeCardsDealt: number
  /** damagemods.ts: modifiers that apply to this attack only */
  mods?: DamageModEntry[]
  seq?: number
  /** power stages the initiator paid as the cost (opens the reaction window) */
  paidStages: number
  /** "change the power stage to the maximum for this attack" (SS-17) */
  tempStage?: number
  /** Trunks Saga: damage waiting for the defender to pick main personality or ally */
  pendingDamage?: { stages: number; lifeCards: number }
  /** the ally the defender chose to take the damage ('' = main personality) */
  damageTo?: string
  /** "may take the first card discarded from the life deck into hand" (SS-112) */
  takeFirstMilled?: PlayerId
  /** TS-127: the defender takes no life cards from this attack, not even overflow */
  noLifeCards?: boolean
  /** BB-87, BB-120, BU-17: damage from this attack cannot be reduced or prevented */
  unpreventable?: boolean
}

/** A card fixed to a personality or another card (attach.ts). */
export interface Attachment {
  card: CardInstance
  host: { player: PlayerId; kind: 'mp' | 'card'; iid?: string }
  until?: string
  effects: Effect[]
  removeWhenDone: boolean
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
  /** FS-58, FS-82: only attack cards are blocked, personality powers still work */
  cardsOnly?: boolean
}

/** Damage change for attacks on `player` for the rest of this combat. */
export interface CombatDamageMod {
  player: PlayerId
  attackType: AttackType
  stages: number
  lifeCards: number
  source: string
  /** TS-22: off the life cards when there are any, else off the stages */
  either?: number
}

/** A damage modifier waiting to apply (see damagemods.ts): `m` are the card's damageModifier params. */
export interface DamageModEntry {
  m: Record<string, unknown>
  owner: PlayerId
  source: string
  /** for "next attack" modifiers: how many more attacks it applies to */
  usesLeft?: number
  /** the strike that created it does not count ("the next attack", "other attacks") */
  exceptSeq?: number
}

export interface CombatState {
  /** whose attack phase it currently is */
  active: PlayerId
  consecutivePasses: number
  strike: StrikeState | null
  /** players who made their Final Physical Attack this combat (Trunks Saga) */
  finalAttack: PlayerId[]
  /** Trunks Saga: an ally fighting in place of a main personality at 0-1 power stages, for this combat */
  controllers: { player: PlayerId; allyIid: string }[]
  /** FS-111: drills whose power a player borrows for this combat */
  borrowedDrills: { player: PlayerId; defId: string }[]
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
  /** TS-93: Constant Combat Powers do nothing for the rest of this combat */
  noConstantPowers?: boolean
  /** damagemods.ts: modifiers that last for this combat or for the next attacks */
  mods: DamageModEntry[]
  /** counts the strikes of this combat (1-based) */
  strikeSeq: number
  /** BB-3, BB-40: "for the remainder of Combat your attacks gain ..." */
  grants: { player: PlayerId; kind: 'onHit' | 'focused'; condition?: unknown; effects: Effect[] }[]
  /** TS-P10: no drills, allies or personality powers this combat */
  lockdown?: boolean
  /** life cards the defender lost to the last successful attack (for "per life card received") */
  lastLifeLost?: number
}

export interface LastAttack {
  type: 'PHYSICAL' | 'ENERGY'
  success: boolean
}

export type PickZone = 'discard' | 'dragonBalls' | 'lifeDeck' | 'hand' | 'drills' | 'allies' | 'nonCombat'
export type PickDest =
  | 'HAND' | 'LIFE_TOP' | 'LIFE_BOTTOM' | 'PICKER_DRAGON_BALLS' | 'OWNER_LIFE_BOTTOM'
  | 'DISCARD' | 'REMOVED'
  /** shuffled into the owner's life deck */
  | 'LIFE_SHUFFLE'
  /** put into play for the picker: Dragon Ball, drill or ally (ally at `allyStage`) */
  | 'PLAY'
  /** an ally gives its power stages to the main personality; the card stays */
  | 'ALLY_TO_MP_STAGES'
  /** the chosen ally will absorb this combat's damage (Ally's Sacrifice); the card stays */
  | 'MARK_ALLY_SHIELD'
  /** use the Non-Combat card's power right away (AS-120); the card then retires as usual */
  | 'USE_NONCOMBAT'

/** Choices raised by card effects; they wait until the current action has resolved. */
export type QueuedChoice =
  | { kind: 'PICK'; player: PlayerId; owner: PlayerId; zones: PickZone[]; count: number; dest: PickDest; eligible: string[]; source: string; allyStage?: number }
  | { kind: 'CONFIRM'; player: PlayerId; effects: Effect[]; source: string; prompt: string }
  | { kind: 'OPTION'; player: PlayerId; source: string; prompt: string; options: string[]; purpose: 'honorDuel' | 'transferStages' | 'shuffle' | 'anger' | 'nameCard' | 'variableCost' | 'borrowDrill' | 'lifeForDrills' | 'damageTarget' | 'chooseOne' | 'disableDrill' | 'loseStages' | 'nameCardDiscard' | 'empower'; data: Record<string, string | number> }

/** Pending work: what is left to resolve. The top of the stack (last element) runs first. */
export type Frame =
  | { k: 'effects'; user: PlayerId; source: string; card?: CardInstance; triggered?: boolean; effects: Effect[] }
  | { k: 'choice'; q: QueuedChoice }
  | { k: 'step'; name: StepName; player?: PlayerId; iid?: string }
  /** put back a decision that was interrupted by an "at any time" card */
  | { k: 'resume'; pending: PendingChoice }

export type StepName =
  | 'strike.react' | 'strike.attackTrigger' | 'strike.afterSecondaries' | 'strike.resolveHit' | 'strike.applyDamage' | 'strike.afterOnHit' | 'strike.cleanup'
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
  /** AS-24, AS-36: this player's main personality cannot use its power until the condition is met */
  attachments: Attachment[]
  powerLocks: { player: PlayerId; until: string; cardIid?: string }[]
  /** AS-21: drills (by iid) whose power cannot be used any more */
  disabledDrills: string[]
  /** cards that go to their owner's life deck instead of the discard pile after use, by iid */
  retireTo: Record<string, 'LIFE_SHUFFLE' | 'LIFE_BOTTOM'>
  /** AS-96: length of each discard pile after the last sweep (cards above it are new) */
  discardMark: number[]
  /** may keep extra cards in the discard step of this turn */
  keepHand: { player: PlayerId; turn: number }[]
  /** FS-P1: this player cannot win by Dragon Balls or Most Powerful Personality before `untilTurn` */
  victoryBlocks: { player: PlayerId; untilTurn: number; source: string }[]
  /** this turn's attacker skipped the combat step (Trunks Saga Step 6) */
  combatSkipped: boolean
  /** TS-157 cards on the table that postpone an opponent's victory */
  victoryGuards: string[]
  postponedWins: { player: PlayerId; reason: WinReason; turn: number }[]
  /** TS-29: no power stage gains before this turn */
  stageLocks: { player: PlayerId; untilTurn: number }[]
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
  /** a "discard a card to ..." ability of a Mastery, power or drill during your Attacker Attacks phase (does not use the attack) */
  | { type: 'USE_ABILITY'; player: PlayerId; key: string }
  /** stop the attack by discarding a card (BB-P10, BU-91, CS-126) */
  | { type: 'DEFEND_DISCARD'; player: PlayerId; key: string }
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
  /** Trunks Saga: discard a card from hand for a PAT physical attack; then pass for the rest of combat */
  | { type: 'FINAL_PHYSICAL_ATTACK'; player: PlayerId; iid: string }
  /** Trunks Saga: an ally takes over the combat while the main personality is at 0-1 power stages */
  | { type: 'ALLY_TAKEOVER'; player: PlayerId; iid: string }
  | { type: 'STEAL_DB'; player: PlayerId; iid: string | null }
  | { type: 'DISCARD'; player: PlayerId; iid: string }
  | { type: 'REJUVENATE'; player: PlayerId; accept: boolean }

export interface DeckList {
  /** Main Personality levels, Level 1 first */
  mp: string[]
  life: string[]
  /** Trunks Saga: optional Mastery card, placed in play at the start (not part of the life deck) */
  mastery?: string
}

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0)
