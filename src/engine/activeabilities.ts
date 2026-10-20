// Abilities a player may use on their own during their "Attacker Attacks" phase without spending the attack:
// "you may discard a card from your hand to ..." on Masteries, constant powers, drills and attached cards.
import { activeCustom, permanentSources, type Params } from './abilities'
import { customHandlers } from './effects'
import { def, log, mpDef } from './state'
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
