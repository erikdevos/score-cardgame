// Shared rules helpers for card abilities: CUSTOM param lookup, attack restrictions,
// timing gates, defenses (cards, dual-use cards and personality powers) and damage changes.
import { DefenseSchema, isDefenseRole, type CardDB, type CardDef, type CombatRole, type Defense, type Effect, type StrikeDef } from './cards'
import type { Damage } from './damage'
import { def, log, mpDef } from './state'
import type { AttackType, CardInstance, CombatState, GameState, PlayerId } from './types'

export type Params = Record<string, unknown>

export function newCombat(active: PlayerId): CombatState {
  return {
    active, consecutivePasses: 0, strike: null, finalAttack: [], usedPowers: [], ended: false,
    restrictions: [], allyShield: [], bonusAttack: null, usedCardIds: [], startLevels: [], defended: [null, null], damageMods: [], extraUses: {}, onceKeys: [], lastAttack: [null, null],
  }
}

/** Params of every CUSTOM effect with this handler, including ones nested in `then`. */
export function findCustom(effects: Effect[], handler: string): Params[] {
  const out: Params[] = []
  for (const e of effects) {
    if (e.action !== 'CUSTOM') continue
    const p = e.params ?? {}
    if (e.handler === handler) out.push(p)
    if (Array.isArray(p.then)) out.push(...findCustom(p.then as Effect[], handler))
  }
  return out
}

export const allEffects = (e: StrikeDef['effects']) => [...e.onPlaySecondary, ...e.onHit, ...e.onEnterPlay]

export function attackTypeOf(role?: CombatRole): 'PHYSICAL' | 'ENERGY' | null {
  return role === 'ATTACK_PHYSICAL' ? 'PHYSICAL' : role === 'ATTACK_ENERGY' ? 'ENERGY' : null
}
export const typeMatches = (t: unknown, actual: 'PHYSICAL' | 'ENERGY') => t === undefined || t === 'ANY' || t === actual

/** The effect that currently stops player p from making an attack with this role, if any. */
export function attackRestriction(s: GameState, p: PlayerId, role?: CombatRole): string | null {
  const type = attackTypeOf(role)
  if (!s.combat || !type) return null
  return s.combat.restrictions.find(r => r.player === p && !r.skipCurrent && typeMatches(r.attackType, type))?.source ?? null
}

export function restrictAttacks(s: GameState, p: PlayerId, attackType: AttackType, phases: number, source: string) {
  const c = s.combat
  if (!c) return log(s, 'WARN', `${source}: no combat to apply the restriction to`)
  c.restrictions.push({ player: p, attackType, phases, skipCurrent: phases < 99 && c.active === p, source })
  const what = attackType === 'ANY' ? 'attacks' : `${attackType.toLowerCase()} attacks`
  log(s, 'RESTRICT', `${source}: player ${p + 1} cannot make ${what} ${phases >= 99 ? 'for the rest of this combat' : 'in their next attack phase'}`, p)
}

/** Called when player p's attack phase ends. */
export function endAttackPhase(c: CombatState, p: PlayerId) {
  for (const r of c.restrictions) {
    if (r.player !== p) continue
    if (r.skipCurrent) r.skipCurrent = false
    else r.phases--
  }
  c.restrictions = c.restrictions.filter(r => r.phases > 0)
}

/** Timings that resolve automatically (personality powers) instead of being chosen. */
export const AUTO_TIMINGS = new Set(['defenderDraw', 'combatStart', 'ownAttackStart'])
export type Window = 'NON_COMBAT' | 'ATTACK' | 'DEFEND' | 'REACT' | 'END_OF_TURN' | 'FREE'
/** Timings that are only usable in their own window, never as a normal play. */
const WINDOW_TIMINGS: Record<string, Window> = { anyTime: 'FREE', endOfTurn: 'END_OF_TURN', afterOpponentPaysAttackCost: 'REACT' }
export const isAutoOnly = (effects: Effect[]) => findCustom(effects, 'playTiming').some(t => AUTO_TIMINGS.has(t.when as string))

function lastAttackWas(s: GameState, p: PlayerId, type: 'PHYSICAL' | 'ENERGY') {
  const l = s.combat?.lastAttack[p]
  return !!l && l.success && l.type === type
}

/** Play timing and requirements printed on a card or power: may p use it now? */
export function timingAllows(s: GameState, p: PlayerId, effects: Effect[], window: Window): boolean {
  for (const t of findCustom(effects, 'playTiming')) {
    const when = t.when as string
    if (AUTO_TIMINGS.has(when)) return false
    if (WINDOW_TIMINGS[when] && WINDOW_TIMINGS[when] !== window) return false
    if (!WINDOW_TIMINGS[when] && (window === 'FREE' || window === 'END_OF_TURN' || window === 'REACT')) return false
    if (when === 'afterOwnSuccessfulEnergyAttack' && !lastAttackWas(s, p, 'ENERGY')) return false
    if (when === 'defendingAgainstEnergyAttack' && (window !== 'DEFEND' || attackTypeOf(s.combat?.strike?.strike.combatRole) !== 'ENERGY')) return false
  }
  for (const d of findCustom(effects, 'stealOrCaptureDragonBall')) {
    if (d.trigger === 'afterSuccessfulPhysicalAttack' && !lastAttackWas(s, p, 'PHYSICAL')) return false
    if (d.trigger === 'afterSuccessfulEnergyAttack' && !lastAttackWas(s, p, 'ENERGY')) return false
  }
  if (window === 'FREE' || window === 'END_OF_TURN' || window === 'REACT') {
    if (!findCustom(effects, 'playTiming').length) return false
  }
  return true
}

/**
 * Requirements that are not timing: "when the Bulma ally is in play", "you have to discard
 * another card", "if there are not enough cards, don't use this ability". `card` is the card
 * being used, so it does not count as one of the other cards in hand.
 */
export function requirementsMet(s: GameState, db: CardDB, p: PlayerId, effects: Effect[], card?: CardInstance): boolean {
  const pl = s.players[p]
  const hasAlly = (who: unknown) =>
    who === true || who === undefined ? pl.allies.length > 0 : pl.allies.some(a => def(db, a.card).personality?.character === who)
  for (const h of ['stealOrCaptureDragonBall', 'searchDeck']) {
    for (const d of findCustom(effects, h)) if (d.requiresAlly && !hasAlly(d.requiresAlly)) return false
  }
  for (const d of findCustom(effects, 'allyEffect')) {
    if ((d.requiresAlly || ['removeFromGame', 'transferStages', 'redirectDamage'].includes(d.action as string)) && !hasAlly(d.requiresAlly)) return false
    if (d.requiresMainPersonality && mpDef(s, db, p).personality!.character !== d.requiresMainPersonality) return false
  }
  for (const d of findCustom(effects, 'discardFromHand')) {
    if (d.requirement && pl.hand.filter(c => c.iid !== card?.iid).length < Number(d.amount ?? 1)) return false
  }
  for (const d of findCustom(effects, 'replaceDrawSource')) {
    if (d.failIfInsufficient && pl.discard.length < s.rules.defenderCombatDraw) return false
  }
  for (const d of findCustom(effects, 'requiresCondition')) {
    // SS-214: "If Gohan is Goku's ally"
    if (d.condition === 'allyInPlay') {
      if (!hasAlly(d.character)) return false
      if (d.mainPersonality && mpDef(s, db, p).personality!.character !== d.mainPersonality) return false
      continue
    }
    if (d.condition !== 'moreThanOneInPlay') continue
    const count = s.players.reduce((n, x, i) =>
      n + (mpDef(s, db, i as PlayerId).personality!.character === d.character ? 1 : 0) + x.allies.filter(a => def(db, a.card).personality?.character === d.character).length, 0)
    if (count < 2) return false
  }
  for (const d of findCustom(effects, 'setLevel')) {
    const foe = s.players[p === 0 ? 1 : 0].mp
    if (foe.levelIndex + 1 !== d.fromLevel) return false
  }
  for (const d of findCustom(effects, 'useDiscardAsLifeDeck')) {
    if (d.requireEnough && pl.discard.length < Number(d.cards ?? 3)) return false
  }
  return true
}

/** Cards that only work while lying on the table (shields, creatures, ...); there is nothing to "use". */
const TABLE_HANDLERS = ['shieldNextAttack', 'damageAbsorber', 'recurringDamage', 'revealHand', 'mirrorAngerReduction']
export const worksFromTable = (d: CardDef) => TABLE_HANDLERS.some(h => findCustom(d.effects.onEnterPlay, h).length > 0)

/** Ongoing effects of a player's drills and table cards with this handler. */
export function tableEffects(s: GameState, db: CardDB, p: PlayerId, handler: string): { card: CardInstance; params: Params }[] {
  const pl = s.players[p]
  return [...pl.drills, ...pl.nonCombat, ...pl.dragonBalls].flatMap(card => findCustom(def(db, card).effects.onEnterPlay, handler).map(params => ({ card, params })))
}

/** "If X is in play" (anywhere): a character as main personality or ally, or a card on the table. "Dragon Ball 6" matches any Dragon Ball numbered 6. */
export function inPlayAnywhere(s: GameState, db: CardDB, what: { character?: unknown; cardName?: unknown }): boolean {
  if (typeof what.character === 'string') {
    return s.players.some((pl, i) => mpDef(s, db, i as PlayerId).personality!.character === what.character || pl.allies.some(a => def(db, a.card).personality?.character === what.character))
  }
  if (typeof what.cardName !== 'string') return false
  const ball = /^Dragon Ball (\d)$/.exec(what.cardName)
  return s.players.some(pl => {
    if (ball) return pl.dragonBalls.some(c => def(db, c).dragonBallNumber === Number(ball[1]))
    return [...pl.drills, ...pl.nonCombat, ...pl.dragonBalls, ...pl.allies.map(a => a.card)].some(c => def(db, c).name === what.cardName)
  })
}

/** FS-114/115/P17 "cannot be defended by ..." and FS-46/47 "cannot be stopped by combat cards" on the current strike. */
export function strikeDefenseBlock(strike: StrikeDef | undefined): { power: boolean; cards: boolean; combatCards: boolean } {
  const effects = strike?.effects.onPlaySecondary ?? []
  const by = findCustom(effects, 'cannotBeDefended').flatMap(p => (p.by ?? ['any']) as string[])
  const any = by.includes('any')
  return { power: any || by.includes('mainPersonalityPower'), cards: any, combatCards: findCustom(effects, 'cannotBeStoppedBy').some(p => p.source === 'combatCards') }
}

/** Constant Combat Powers (FS-P13, FS-P14): always-on effects of the main personality's power. */
export function constantPowerEffects(s: GameState, db: CardDB, p: PlayerId, handler: string): Params[] {
  const power = mpDef(s, db, p).personality!.power
  if (!power) return []
  return findCustom(power.strike.effects.onPlaySecondary, 'constantPower').flatMap(c => findCustom((c.then ?? []) as Effect[], handler))
}
export const isConstantPower = (strike: StrikeDef) => findCustom(strike.effects.onPlaySecondary, 'constantPower').length > 0

export const drillsProtected = (s: GameState, db: CardDB, p: PlayerId) => tableEffects(s, db, p, 'protectDrills').length > 0
export const dragonBallsProtected = (s: GameState, db: CardDB, p: PlayerId) => tableEffects(s, db, p, 'preventDragonBallCapture').length > 0

/** SS-211 / SS-224: must this player play with their hand face up? */
export function handRevealed(s: GameState, db: CardDB, p: PlayerId): boolean {
  if (mpDef(s, db, p).personality!.alignment !== 'Villain') return false
  const foe: PlayerId = p === 0 ? 1 : 0
  return tableEffects(s, db, foe, 'revealHand').some(({ params }) => {
    const need = (params.condition as { inPlay?: string } | undefined)?.inPlay
    if (!need) return true
    return s.players.some((pl, i) => mpDef(s, db, i as PlayerId).personality!.character === need || pl.allies.some(a => def(db, a.card).personality?.character === need))
  })
}

/** The power(s) a personality can use: its own, or a choice of other levels' powers (SS-172, SS-P2). */
export function powerOptions(s: GameState, db: CardDB, p: PlayerId) {
  const power = mpDef(s, db, p).personality!.power
  if (!power) return []
  const other = findCustom(power.strike.effects.onPlaySecondary, 'useOtherLevelPower')[0]
  if (!other) return [power]
  return ((other.options ?? []) as string[]).map(id => db[id]?.personality?.power).filter((x): x is NonNullable<typeof x> => !!x)
}

/** Cost of a strike for this player, with drills like SS-146 ("pay 1 stage instead of 2"). */
export function costFor(s: GameState, db: CardDB, p: PlayerId, cost: { type: 'NONE' | 'POWER_STAGES' | 'LIFE_CARDS'; amount: number }, role: CombatRole) {
  if (cost.type !== 'POWER_STAGES' || role !== 'ATTACK_ENERGY') return cost
  for (const { params } of tableEffects(s, db, p, 'attackCostModifier')) {
    if (params.attackType !== 'ENERGY' || (params.role === 'attacker' && s.attacker !== p)) continue
    return { ...cost, amount: Math.min(cost.amount, Number(params.costStages)) }
  }
  return cost
}

/** Drill "stop the first physical attack made on you in a combat": the drill that stops this one. */
export function autoStop(s: GameState, db: CardDB, defender: PlayerId, attack: 'PHYSICAL' | 'ENERGY'): string | null {
  const c = s.combat!
  for (const drill of s.players[defender].drills) {
    const d = def(db, drill)
    for (const a of findCustom(d.effects.onEnterPlay, 'autoStopAttack')) {
      if (!typeMatches(a.attackType, attack)) continue
      const key = `${drill.iid}:autoStop`
      const used = c.onceKeys.filter(k => k === key).length
      if (used >= Number(a.count ?? 1)) continue
      c.onceKeys.push(key)
      return d.name
    }
  }
  return null
}

/**
 * Shields on the table ("the first successful physical attack on you is stopped").
 * `lifeCardsOnly` picks the kind that only stops life card damage. Returns the shield used.
 */
export function useShield(s: GameState, db: CardDB, defender: PlayerId, attack: 'PHYSICAL' | 'ENERGY', lifeCardsOnly: boolean): string | null {
  const pl = s.players[defender]
  for (const card of pl.nonCombat) {
    const d = def(db, card)
    const sh = findCustom(d.effects.onEnterPlay, 'shieldNextAttack')[0]
    if (!sh || !typeMatches(sh.attackType, attack)) continue
    if ((sh.trigger === 'successfulAttackLifeCardDamage') !== lifeCardsOnly) continue
    pl.nonCombat = pl.nonCombat.filter(c => c !== card)
    if (sh.removeAfterUse || d.effects.postResolution === 'REMOVE') pl.removed.push(card)
    else pl.discard.push(card)
    return d.name
  }
  return null
}

/** "All the damage you would take this combat destroys one of your allies instead." */
export function allyAbsorbs(s: GameState, db: CardDB, defender: PlayerId): boolean {
  const c = s.combat!
  const shield = c.allyShield.find(x => x.player === defender)
  if (!shield) return false
  const key = `allyShield:${defender}`
  if (c.onceKeys.includes(key)) return true
  // the ally the owner chose when the card was played
  const pl = s.players[defender]
  const ally = pl.allies.find(a => a.card.iid === shield.allyIid)
  if (!ally) return false
  c.onceKeys.push(key)
  pl.allies = pl.allies.filter(a => a !== ally)
  pl.discard.push(ally.card)
  log(s, 'ALLY_DOWN', `${def(db, ally.card).name} takes the damage and is destroyed`, defender)
  return true
}

const STOP: Defense = { mode: 'STOP', stages: 0, lifeCards: 0 }

function roleFits(role: CombatRole | undefined, attack: 'PHYSICAL' | 'ENERGY') {
  return role === 'DEFENSE_ANY' || (role === 'DEFENSE_PHYSICAL' && attack === 'PHYSICAL') || (role === 'DEFENSE_ENERGY' && attack === 'ENERGY')
}

export interface DefenseOption {
  /** the strike used to pay costs and resolve secondaries */
  strike: StrikeDef
  defense: Defense | null
}

/** How a card can answer an attack of this type, or null when it cannot. */
export function cardDefense(d: CardDef, attack: 'PHYSICAL' | 'ENERGY'): DefenseOption | null {
  const strike: StrikeDef = { combatRole: d.combatRole!, cost: d.cost, damage: d.damage, effects: d.effects }
  if (roleFits(d.combatRole, attack)) return { strike, defense: d.defense ?? STOP }
  if (d.combatRole === 'COMBAT_EFFECT' && d.usePhase === 'DEFEND') return { strike, defense: d.defense ?? null }
  return dualUseDefense(strike, attack)
}

/** "Attack ... or stops an energy attack": the alternative defensive use (rulebook p. 20). */
function dualUseDefense(strike: StrikeDef, attack: 'PHYSICAL' | 'ENERGY'): DefenseOption | null {
  const alt = findCustom(strike.effects.onPlaySecondary, 'dualUse')[0]?.alternative as { combatRole?: CombatRole; defense?: unknown } | undefined
  if (!alt || !roleFits(alt.combatRole, attack)) return null
  // the attack's own cost (e.g. the default energy cost) does not apply to the defensive use
  return { strike: { ...strike, combatRole: alt.combatRole!, cost: undefined }, defense: DefenseSchema.parse(alt.defense ?? {}) }
}

/** The defender's personality power as an answer to the current strike, if it can be used. */
export function powerDefense(s: GameState, db: CardDB, defender: PlayerId): DefenseOption | null {
  const c = s.combat
  const attack = attackTypeOf(c?.strike?.strike.combatRole)
  if (!c || !attack) return null
  const mp = mpDef(s, db, defender)
  if (c.usedPowers.includes(`${defender}:${mp.id}`)) return null
  for (const power of powerOptions(s, db, defender)) {
    const opt = powerAsDefense(s, defender, mp.personality!.character, power.strike, attack)
    if (opt) return opt
  }
  return null
}

function powerAsDefense(s: GameState, defender: PlayerId, character: string, strike: StrikeDef, attack: 'PHYSICAL' | 'ENERGY'): DefenseOption | null {
  const pd = findCustom(strike.effects.onPlaySecondary, 'powerDefense')[0]
  if (pd) {
    if (!typeMatches(pd.attackType, attack)) return null
    const protects = pd.protects as string[] | undefined
    if (protects && !protects.includes(character)) return null
    return { strike, defense: DefenseSchema.parse({ mode: pd.mode, stages: pd.stages, lifeCards: pd.lifeCards, maxStages: pd.maxStages, maxLifeCards: pd.maxLifeCards }) }
  }
  if (isDefenseRole(strike.combatRole)) return roleFits(strike.combatRole, attack) ? { strike, defense: STOP } : null
  if (strike.combatRole === 'COMBAT_EFFECT') return timingAllows(s, defender, strike.effects.onPlaySecondary, 'DEFEND') && findCustom(strike.effects.onPlaySecondary, 'playTiming').length ? { strike, defense: null } : null
  return dualUseDefense(strike, attack)
}

export function applyDefense(dmg: Damage, d: Defense): Damage {
  if (d.mode === 'REDUCE') return { stages: Math.max(0, dmg.stages - d.stages), lifeCards: Math.max(0, dmg.lifeCards - d.lifeCards) }
  if (d.mode === 'CAP') return { stages: Math.min(dmg.stages, d.maxStages ?? dmg.stages), lifeCards: Math.min(dmg.lifeCards, d.maxLifeCards ?? dmg.lifeCards) }
  return { stages: 0, lifeCards: 0 }
}

/** Ongoing damage changes on attacks against `defender`: combat effects and drills. */
export function ongoingDamageChanges(s: GameState, db: CardDB, defender: PlayerId, attack: 'PHYSICAL' | 'ENERGY', dmg: Damage): Damage {
  const c = s.combat!
  let { stages, lifeCards } = dmg
  for (const m of c.damageMods) {
    if (m.player !== defender || !typeMatches(m.attackType, attack)) continue
    stages += m.stages
    lifeCards += m.lifeCards
    log(s, 'REDUCE', `${m.source} changes the damage`, defender)
  }
  for (const m of constantPowerEffects(s, db, defender, 'damageModifier')) {
    if (!typeMatches(m.attackType, attack)) continue
    if (typeof m.stages === 'number') stages += m.stages
    if (typeof m.lifeCards === 'number') lifeCards += m.lifeCards
    if (typeof m.maxLifeCards === 'number') lifeCards = Math.min(lifeCards, m.maxLifeCards)
    if (typeof m.maxStages === 'number') stages = Math.min(stages, m.maxStages)
    log(s, 'REDUCE', `${mpDef(s, db, defender).personality!.power!.name} changes the damage`, defender)
  }
  // FS-55 (villains take 1 less) and FS-69 (+3 life cards against villains), from any player's drills
  const defenderIsVillain = mpDef(s, db, defender).personality!.alignment === 'Villain'
  for (const pl of s.players) {
    for (const drill of pl.drills) {
      const d = def(db, drill)
      for (const m of findCustom(d.effects.onEnterPlay, 'damageModifier')) {
        if (!m.ongoing || !typeMatches(m.attackType, attack) || !defenderIsVillain) continue
        if (m.scope === 'VILLAINS') {
          // "1 less power stage or life card": take it off the life cards when there are any
          if (lifeCards > 0) lifeCards += Number(m.stagesOrLifeCards ?? -1)
          else stages += Number(m.stagesOrLifeCards ?? -1)
        } else if (m.condition === 'defenderIsVillain' && drill.owner !== defender) {
          lifeCards += Number(m.lifeCards ?? 0)
        } else continue
        log(s, 'REDUCE', `${d.name} changes the damage`, defender)
      }
    }
  }
  for (const drill of s.players[defender].drills) {
    const d = def(db, drill)
    for (const m of findCustom(d.effects.onEnterPlay, 'damageModifier')) {
      if (m.scope === 'VILLAINS' || m.condition === 'defenderIsVillain') continue
      if (!m.ongoing || !typeMatches(m.attackType, attack) || lifeCards <= 0) continue
      if (m.condition === 'foeHasAlly' && !s.players[defender === 0 ? 1 : 0].allies.length) continue
      const key = `${drill.iid}:damageModifier`
      if (m.per === 'combat' && c.onceKeys.includes(key)) continue
      c.onceKeys.push(key)
      stages += Number(m.stages ?? 0)
      lifeCards += Number(m.lifeCards ?? 0)
      log(s, 'REDUCE', `${d.name} changes the damage`, defender)
    }
  }
  return { stages: Math.max(0, stages), lifeCards: Math.max(0, lifeCards) }
}
