// Abilities a player may use on their own during their "Attacker Attacks" phase without spending the attack:
// "you may discard a card from your hand to ..." on Masteries, constant powers, drills and attached cards.
import { activeCustom, attackTypeOf, isFocused, permanentSources, typeMatches, type Params } from './abilities'
import { DefenseSchema, type Effect, StrikeSchema, type StrikeDef } from './cards'
import { canPayCost } from './sequencer'
import { pickRequest } from './effects/choices'
import { customHandlers } from './effects'
import { def, log, millCards, mpDef, schedule, step } from './state'
import type { CardDB } from './cards'
import { other, type CardInstance, type GameState, type PlayerId } from './types'

export interface ActiveAbility { key: string; source: string; params: Params; kind?: 'grant' | 'discardPlay' | 'triggered' }

/** Hand cards that may be discarded for this ability. */
export function discardChoices(s: GameState, db: CardDB, p: PlayerId, params: Params): CardInstance[] {
  const f = (params.filter ?? {}) as { style?: string; namedMatchesMainPersonality?: boolean }
  const mp = mpDef(s, db, p).personality!
  return s.players[p].hand.filter(c => {
    const d = def(db, c)
    return (!f.style || d.style === f.style) && (!f.namedMatchesMainPersonality || d.named === mp.character)
  })
}

export function activeAbilities(s: GameState, db: CardDB, p: PlayerId): ActiveAbility[] {
  if (s.step !== 'COMBAT' || !s.combat || s.combat.active !== p || s.combat.lockdown) return []
  const out: ActiveAbility[] = []
  for (const src of permanentSources(s, db, p)) {
    activeCustom(s, db, src.effects, 'discardFromHandThen').forEach((params, i) => {
      if (params.phase !== 'attackerAttacks') return
      const key = `${src.name}#${i}`
      if (params.perCombat && s.combat!.onceKeys.includes(`ability:${p}:${key}`)) return
      if (discardChoices(s, db, p, params).length < Number(params.amount ?? 1)) return
      out.push({ key, source: src.name, params })
    })
  }
  for (const src of permanentSources(s, db, p)) {
    // BU-142: discard a card of yours in play to ...
    activeCustom(s, db, src.effects, 'inPlaceOfAttackDiscard').forEach((params, i) => {
      if (params.phase !== 'attackerAttacks' || params.inPlaceOfAttack !== false) return
      const key = `${src.name}!${i}`
      if (params.perCombat && s.combat!.onceKeys.includes(`ability:${p}:${key}`)) return
      if (!playDiscardChoices(s, db, p, params).length) return
      out.push({ key, source: src.name, params, kind: 'discardPlay' })
    })
    // BU-43: an attached card's "during your Attacker Attacks phase, you may discard a card from your hand to ..."
    activeCustom(s, db, src.effects, 'triggeredEffect').forEach((params, i) => {
      const cost = params.cost as { discardFromHand?: number } | undefined
      if (params.trigger !== 'attackerAttacksPhase' || !cost?.discardFromHand || s.players[p].hand.length < cost.discardFromHand) return
      if (!s.players[other(p)].nonCombat.length && !s.players[other(p)].allies.length && !s.location) return
      out.push({ key: `${src.name}~${i}`, source: src.name, params, kind: 'triggered' })
    })
    activeCustom(s, db, src.effects, 'grantAttack').forEach((params, i) => {
      if (params.phase !== 'attackerAttacks') return
      const key = `${src.name}@${i}`
      if (params.performedBy && mpDef(s, db, p).personality!.character !== params.performedBy) return
      if (params.limit && s.combat!.onceKeys.filter(k => k === `ability:${p}:${key}`).length >= Number((params.limit as { count?: number }).count ?? 1)) return
      if (!grantedStrike(params) || !canPayCost(s, db, p, grantedStrike(params)!)) return
      if (discardCount(params) > s.players[p].hand.length) return
      if (params.cost && (params.cost as { discardTopLifeCard?: number }).discardTopLifeCard && s.players[p].lifeDeck.length < 2) return
      out.push({ key, source: src.name, params, kind: 'grant' })
    })
  }
  return out
}

const discardCount = (params: Params) => Number((params.cost as { discardFromHand?: number } | undefined)?.discardFromHand ?? params.requiresDiscardFromHand ?? 0)

/** The attack a grantAttack effect lets the player perform. */
function grantedStrike(params: Params): StrikeDef | null {
  const energy = params.attackType === 'ENERGY'
  const c = (params.cost ?? {}) as { type?: string; amount?: number; stages?: number }
  const cost = c.type ? { type: c.type, amount: c.amount } : c.stages ? { type: 'POWER_STAGES', amount: c.stages } : undefined
  const parsed = StrikeSchema.safeParse({
    combatRole: energy ? 'ATTACK_ENERGY' : 'ATTACK_PHYSICAL',
    cost,
    damage: params.damage ?? { calculation: 'PAT', modifierStages: 0, modifierLifeCards: 0 },
    effects: { onPlaySecondary: params.focused ? [{ action: 'CUSTOM', handler: 'focused' }] : [], onHit: [], onEnterPlay: [], postResolution: 'DISCARD' },
  })
  return parsed.success ? parsed.data : null
}

export function useAbility(s: GameState, db: CardDB, p: PlayerId, key: string) {
  const ab = activeAbilities(s, db, p).find(a => a.key === key)!
  if (ab.kind === 'grant') return useGrantedAttack(s, db, p, ab)
  if (ab.kind === 'discardPlay') {
    s.combat!.onceKeys.push(`ability:${p}:${key}`)
    log(s, 'ABILITY', `Player ${p + 1} uses ${ab.source}`, p)
    return schedule(s,
      { k: 'choice', q: pickRequest(p, p, 'drills', playDiscardChoices(s, db, p, ab.params), 1, 'DISCARD', ab.source) },
      { k: 'effects', user: p, source: ab.source, effects: (ab.params.then ?? []) as Effect[] })
  }
  if (ab.kind === 'triggered') {
    log(s, 'ABILITY', `Player ${p + 1} uses ${ab.source}`, p)
    const n = Number((ab.params.cost as { discardFromHand: number }).discardFromHand)
    return schedule(s,
      { k: 'choice', q: pickRequest(p, p, 'hand', s.players[p].hand, n, 'DISCARD', ab.source) },
      { k: 'effects', user: p, source: ab.source, effects: (ab.params.then ?? []) as Effect[] })
  }
  s.combat!.onceKeys.push(`ability:${p}:${key}`)
  log(s, 'ABILITY', `Player ${p + 1} uses ${ab.source}`, p)
  customHandlers.discardFromHandThen({ s, db, user: p, source: ab.source }, { ...ab.params, activated: true })
}

/** "You may discard a card (or a table card) to stop an attack" (BB-P10, BU-91, CS-126): the defender's alternatives to a defense card. */
export function discardDefenses(s: GameState, db: CardDB, p: PlayerId): ActiveAbility[] {
  const st = s.combat?.strike
  if (!st || s.combat!.lockdown || st.initiator === p || isFocused(st.strike)) return []
  const type = attackTypeOf(st.strike.combatRole)
  if (!type) return []
  const out: ActiveAbility[] = []
  for (const src of permanentSources(s, db, p)) {
    activeCustom(s, db, src.effects, 'discardToStopAttack').forEach((params, i) => {
      if (!typeMatches(params.attackType, type)) return
      const key = `${src.name}#${i}`
      if (params.perCombat && s.combat!.onceKeys.includes(`stopdiscard:${p}:${key}`)) return
      if (discardCandidates(s, db, p, params).length < Number(params.amount ?? params.discardFromHand ?? 1)) return
      out.push({ key, source: src.name, params })
    })
  }
  return out
}

function discardCandidates(s: GameState, db: CardDB, p: PlayerId, params: Params): CardInstance[] {
  const d = params.discard as { zone?: string; cardTypes?: string[] } | undefined
  const pl = s.players[p]
  if (d?.zone === 'table') return pl.nonCombat.filter(c => !d.cardTypes || d.cardTypes.includes(def(db, c).type))
  return pl.hand
}

export function defendByDiscard(s: GameState, db: CardDB, p: PlayerId, key: string) {
  const ab = discardDefenses(s, db, p).find(a => a.key === key)!
  const st = s.combat!.strike!
  s.pendingChoice = null
  s.combat!.onceKeys.push(`stopdiscard:${p}:${key}`)
  st.defense = DefenseSchema.parse({ mode: 'STOP' })
  const d = ab.params.discard as { zone?: string } | undefined
  log(s, 'DEFEND', `Player ${p + 1} discards a card to stop the attack (${ab.source})`, p)
  // BB-P10: afterwards the player must pass for the rest of the combat
  if (ab.params.thenMustPass) s.combat!.finalAttack.push(p)
  const n = Number(ab.params.amount ?? ab.params.discardFromHand ?? (ab.params.discard as { amount?: number } | undefined)?.amount ?? 1)
  schedule(s,
    { k: 'choice', q: pickRequest(p, p, d?.zone === 'table' ? 'nonCombat' : 'hand', discardCandidates(s, db, p, ab.params), n, 'DISCARD', ab.source) },
    step('strike.resolveHit'))
}

/** "Discard X to have your personality perform an attack" (BB-56, BB-83, BU-167): the attack replaces this phase's attack. */
function useGrantedAttack(s: GameState, db: CardDB, p: PlayerId, ab: ActiveAbility) {
  s.combat!.onceKeys.push(`ability:${p}:${ab.key}`)
  log(s, 'ABILITY', `Player ${p + 1} uses ${ab.source}`, p)
  if ((ab.params.cost as { discardTopLifeCard?: number } | undefined)?.discardTopLifeCard) millCards(s, p, 1, db)
  const strike = grantedStrike(ab.params)!
  const n = discardCount(ab.params)
  const frames = []
  if (n) frames.push({ k: 'choice' as const, q: pickRequest(p, p, 'hand', s.players[p].hand, n, 'DISCARD', ab.source) })
  frames.push({ k: 'effects' as const, user: p, source: ab.source, effects: [{ action: 'CUSTOM' as const, handler: 'beginGrantedAttack', params: { strike, onUse: ab.params.onUse ?? [] } }] })
  schedule(s, ...frames)
}

function playDiscardChoices(s: GameState, db: CardDB, p: PlayerId, params: Params): CardInstance[] {
  const f = (params.discardFromPlay ?? {}) as { cardTypes?: string[]; style?: string }
  return s.players[p].drills.filter(c => (!f.cardTypes || f.cardTypes.includes(def(db, c).type)) && (!f.style || def(db, c).style === f.style))
}
