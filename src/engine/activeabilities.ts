// Abilities a player may use on their own during their "Attacker Attacks" phase without spending the attack:
// "you may discard a card from your hand to ..." on Masteries, constant powers, drills and attached cards.
import { activeCustom, attackTypeOf, isFocused, permanentSources, typeMatches, type Params } from './abilities'
import { DefenseSchema } from './cards'
import { pickRequest } from './effects/choices'
import { customHandlers } from './effects'
import { def, log, mpDef, schedule, step } from './state'
import type { CardDB } from './cards'
import type { CardInstance, GameState, PlayerId } from './types'

export interface ActiveAbility { key: string; source: string; params: Params }

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
  return out
}

export function useAbility(s: GameState, db: CardDB, p: PlayerId, key: string) {
  const ab = activeAbilities(s, db, p).find(a => a.key === key)!
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
