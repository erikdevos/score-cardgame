import { z } from 'zod'

export const Target = z.enum(['SELF', 'OPPONENT'])

export const EffectSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('MODIFY_ANGER'), target: Target, amount: z.number().int() }),
  z.object({ action: z.literal('MODIFY_STAGES'), target: Target, amount: z.number().int() }),
  z.object({ action: z.literal('SET_STAGE'), target: Target, value: z.union([z.number().int(), z.literal('MAX')]) }),
  z.object({ action: z.literal('DRAW'), target: Target, amount: z.number().int().positive() }),
  z.object({ action: z.literal('DISCARD_LIFE'), target: Target, amount: z.number().int().positive() }),
  // Top N cards of the discard pile go to the bottom of the life deck.
  z.object({ action: z.literal('RECOVER'), target: Target, amount: z.number().int().positive() }),
  z.object({ action: z.literal('END_COMBAT') }),
  z.object({ action: z.literal('CUSTOM'), handler: z.string(), params: z.record(z.unknown()).optional() }),
])
export type Effect = z.infer<typeof EffectSchema>

export const PassiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('HAND_LIMIT'), amount: z.number().int(), scope: z.enum(['OWNER', 'OPPONENT', 'ALL']).default('OWNER') }),
  z.object({ kind: z.literal('PUR_MOD'), amount: z.number().int(), scope: z.enum(['OWNER', 'OPPONENT', 'ALL']).default('OWNER') }),
  // scope = whose attacks are modified
  z.object({
    kind: z.literal('DAMAGE_MOD'),
    attackType: z.enum(['PHYSICAL', 'ENERGY', 'ANY']),
    stages: z.number().int().default(0),
    lifeCards: z.number().int().default(0),
    scope: z.enum(['OWNER', 'OPPONENT', 'ALL']).default('OWNER'),
  }),
])
export type Passive = z.infer<typeof PassiveSchema>

export const CombatRole = z.enum([
  'ATTACK_PHYSICAL', 'ATTACK_ENERGY',
  'DEFENSE_PHYSICAL', 'DEFENSE_ENERGY', 'DEFENSE_ANY',
  'COMBAT_EFFECT',
])
export type CombatRole = z.infer<typeof CombatRole>

export const CostSchema = z.object({
  type: z.enum(['NONE', 'POWER_STAGES', 'LIFE_CARDS']),
  amount: z.number().int().nonnegative(),
})

export const DamageSchema = z.object({
  calculation: z.enum(['PAT', 'FLAT', 'NONE']),
  stages: z.number().int().nonnegative().default(0),     // FLAT only
  lifeCards: z.number().int().nonnegative().default(0),  // FLAT only
  modifierStages: z.number().int().default(0),
  modifierLifeCards: z.number().int().default(0),
})

export const DefenseSchema = z.object({
  mode: z.enum(['STOP', 'REDUCE', 'CAP']).default('STOP'),
  stages: z.number().int().nonnegative().default(0),
  lifeCards: z.number().int().nonnegative().default(0),
  /** CAP only: at most this much damage gets through */
  maxStages: z.number().int().nonnegative().optional(),
  maxLifeCards: z.number().int().nonnegative().optional(),
})
export type Defense = z.infer<typeof DefenseSchema>

export const EffectsSchema = z.object({
  onPlaySecondary: z.array(EffectSchema).default([]),
  onHit: z.array(EffectSchema).default([]),
  onEnterPlay: z.array(EffectSchema).default([]),
  postResolution: z.enum(['DISCARD', 'REMOVE', 'STAYS']).default('DISCARD'),
})

// A strike-like action that does not come from a card in hand (e.g. a personality power).
export const StrikeSchema = z.object({
  combatRole: CombatRole,
  cost: CostSchema.optional(),
  damage: DamageSchema.optional(),
  effects: EffectsSchema.default({}),
})

export const PersonalitySchema = z.object({
  character: z.string(),
  level: z.number().int().min(1).max(4),
  powerRatings: z.array(z.number().int().nonnegative()).length(11),
  pur: z.number().int().min(0).max(5),
  alignment: z.enum(['Hero', 'Villain', 'Rogue']),
  cannotWinMPP: z.boolean().default(false),
  /** Z power stages (Buu Saga rulebook p. 60): base damage on the Physical Attack Table is always 2 */
  zPower: z.boolean().default(false),
  power: z.object({ name: z.string(), text: z.string(), strike: StrikeSchema }).optional(),
})

export const CardType = z.enum([
  'Personality', 'Physical Combat', 'Energy Combat', 'Combat',
  'Non-Combat', 'Drill', 'Dragon Ball', 'Location', 'Battleground', 'Mastery',
])
export type CardType = z.infer<typeof CardType>

export const CardSchema = z.object({
  id: z.string(),
  name: z.string(),
  set: z.string(),
  number: z.number().int(),
  type: CardType,
  style: z.string().optional(),
  rarity: z.string(),
  /** Character name for the "named card" copy rule, e.g. "Goku" for "Goku's Physical Attack". */
  named: z.string().optional(),
  limitPerDeck: z.number().int().positive().optional(),
  /** Only playable when the controlling MP matches one of the alignments OR characters. */
  usableBy: z.object({
    alignments: z.array(z.enum(['Hero', 'Villain'])).optional(),
    characters: z.array(z.string()).optional(),
  }).optional(),
  /** Restricted drill: not playable while any drill of this style is in play; discarded when one is played. */
  exclusiveDrillStyle: z.string().optional(),
  /** "Multiples of this card cannot be used together." */
  noStacking: z.boolean().optional(),
  cost: CostSchema.optional(),
  combatRole: CombatRole.optional(),
  /** COMBAT_EFFECT only: the printed icon. ATTACK (sword) = played instead of an attack; DEFEND (starburst) = played in the defend window. */
  usePhase: z.enum(['ATTACK', 'DEFEND']).optional(),
  damage: DamageSchema.optional(),
  defense: DefenseSchema.optional(),
  effects: EffectsSchema.default({}),
  passives: z.array(PassiveSchema).default([]),
  personality: PersonalitySchema.optional(),
  dragonBallNumber: z.number().int().min(1).max(7).optional(),
  rawText: z.string(),
  imageUrl: z.string().optional(),
  verified: z.boolean().default(false),
  needsReview: z.string().optional(),
})
export type CardDef = z.infer<typeof CardSchema>
export type StrikeDef = z.infer<typeof StrikeSchema>

export type CardDB = Record<string, CardDef>

export function buildCardDB(raw: unknown[]): CardDB {
  const db: CardDB = {}
  for (const r of raw) {
    const card = CardSchema.parse(r)
    if (db[card.id]) throw new Error(`Duplicate card id ${card.id}`)
    db[card.id] = card
  }
  return db
}

export const isAttackRole = (r?: CombatRole) => r === 'ATTACK_PHYSICAL' || r === 'ATTACK_ENERGY'
export const isDefenseRole = (r?: CombatRole) => r === 'DEFENSE_PHYSICAL' || r === 'DEFENSE_ENERGY' || r === 'DEFENSE_ANY'
