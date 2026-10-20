// Generic damage modifiers: the damageModifier params that the older hand-written paths do not read
// (per-count bonuses, prevention, attack filters, "next attack" and "first attack" limits).
// Old-style params keep their old code paths; a modifier is "new style" when it carries one of NEW_KEYS.
import { activeCustom, permanentSources } from './abilities'
import type { CardDB, CardDef } from './cards'
import { baseDamage, defaultDamage, type Damage } from './damage'
import { def, log, mpDef, powerRating, pur } from './state'
import { other, type CardInstance, type DamageModEntry, type GameState, type PlayerId, type StrikeState } from './types'

type P = Record<string, unknown>

const NEW_KEYS = [
  'bonusIfAttackerNameContains', 'lifeCardsPerDragonBall', 'lifeCardsPerPersonalityLevel', 'bonusLifeCards', 'lifeCardsPerDiscardedCardWithTitle',
  'stagesPerOpponentAlly', 'raiseCardBonusesBy', 'lifeCardsFromPhysicalAttackTable', 'multiplyBaseDamage', 'baseOnly', 'preventStages', 'preventLifeCards',
  'preventAll', 'prevent', 'preventStagesOrLifeCards', 'onlyIfNoDamageModifiersOnCard', 'focusedOnly', 'onlyFocused', 'attackFilter',
  'lifeCardsPerCardInPile', 'lifeCardsPerPersonalityInPlay', 'lifeCardsPerCardDrawnThisTurn', 'lifeCardsPerRemovedCard', 'cardTitleContains', 'lifeCardsX',
  'otherAttacksOnly', 'excludeThisAttack', 'attackStyle', 'styledOrNamed', 'lifeCardsPerDiscardedCard', 'stagesPerRemovedCard', 'lifeCardsPerAlly',
  'patBaseDamage', 'namedOverride', 'stagesPerDragonBallInPlay', 'lifeCardsPerDiscardedCardOfRarity', 'stagesPerDiscardedCardOfType',
  'stagesPerOwnCharacterWithTitle', 'stagesPerDiscardedCardOfRarity', 'stagesPerAllyInPlay', 'lifeCardsPerOwnCharacterWithTitle', 'replaceIf', 'stagesPerOwnAlly',
  'perCount', 'stagesPerOpponentAngerBelow', 'ifRemovedCardStyle', 'stagesPerCardInPile', 'stagesPerCardInPlay', 'lifeCardsPerCardOfType',
  'stagesPerPersonalityInPlay', 'stagesPerNamedCardInDiscard', 'againstOverride', 'stagesPerOpponentCardInPlay', 'againstNameContains',
  'lifeCardsPerCardInOpponentDiscard', 'firstAttackPerCombat', 'firstAttackOnly', 'limit', 'excludeTriggeringAttack', 'startsAfterThisAttack', 'noCost',
  'flatStages', 'flatLifeCards', 'excludeUnstoppableOrFocused', 'nextAttackOnly', 'forNextAttacks', 'filter', 'stagesPerOpponentCardInPlay', 'noModifiers',
]

export const isNewStyle = (m: P) => NEW_KEYS.some(k => k in m)

/** Called when a damageModifier effect resolves: store it for the strike or the combat. Returns true when it was taken. */
export function registerDamageModifier(s: GameState, ownerPlayer: PlayerId, source: string, m: P): boolean {
  if (!isNewStyle(m) || m.ongoing) return false
  const st = s.combat?.strike
  const duration = String(m.duration ?? '')
  const entry: DamageModEntry = { m, owner: ownerPlayer, source, exceptSeq: st?.seq }
  const nextOnly = !!(m.nextAttackOnly || m.firstAttackOnly || m.forNextAttacks || /^next/.test(duration))
  if (nextOnly) entry.usesLeft = Number(typeof m.forNextAttacks === 'number' ? m.forNextAttacks : 1)
  if (duration === 'thisAttack' && st) (st.mods ??= []).push({ ...entry, exceptSeq: undefined })
  else if (s.combat) s.combat.mods.push(entry)
  return true
}

const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d)

/** Cards of a pile of a player, for the "per card in pile" bonuses. */
function pileCards(s: GameState, owner: PlayerId, pile: string): CardInstance[] {
  const pl = s.players[owner]
  switch (pile) {
    case 'discard': return pl.discard
    case 'removed': return pl.removed
    case 'hand': return pl.hand
    case 'lifeDeck': return pl.lifeDeck
    case 'dragonBalls': return pl.dragonBalls
    case 'play': return [...pl.nonCombat, ...pl.drills, ...pl.dragonBalls, ...pl.allies.map(a => a.card), ...(pl.mastery ? [pl.mastery] : [])]
    default: return []
  }
}

const isNonCombatCard = (d: CardDef) => d.type === 'Non-Combat' || d.type === 'Drill'

/** One "which cards count" test: a string ("Villains only", "Vegeta Named", a title part) or an object. */
function matchesSpec(d: CardDef, spec: unknown): boolean {
  if (!spec) return true
  if (typeof spec === 'string') {
    if (spec === 'Villains only') return !!d.usableBy?.alignments?.includes('Villain')
    if (spec.endsWith(' Named')) return d.named === spec.slice(0, -6)
    return d.name.includes(spec)
  }
  const o = spec as P
  if (o.titleContains && !d.name.includes(String(o.titleContains))) return false
  if (o.named && d.named !== o.named) return false
  if (o.personalityTitleContains && !(d.type === 'Personality' && d.name.includes(String(o.personalityTitleContains)))) return false
  return true
}

function countIn(s: GameState, db: CardDB, owner: PlayerId | 'ALL', pile: string, test: (d: CardDef) => boolean): number {
  const owners: PlayerId[] = owner === 'ALL' ? [0, 1] : [owner]
  return owners.reduce<number>((n, o) => n + pileCards(s, o, pile).filter(c => test(def(db, c))).length, 0)
}

/** Main personalities and allies in play, with their card names. */
function personalitiesInPlay(s: GameState, db: CardDB, owner: PlayerId | 'ALL'): string[] {
  const owners: PlayerId[] = owner === 'ALL' ? [0, 1] : [owner]
  return owners.flatMap(o => [mpDef(s, db, o).name, ...s.players[o].allies.map(a => def(db, a.card).name)])
}

interface Ctx { s: GameState; db: CardDB; attacker: PlayerId; defender: PlayerId; st: StrikeState; type: 'PHYSICAL' | 'ENERGY'; card: CardDef | null }

/** Does this modifier apply to the attack in `c`, from the point of view of its owner? */
function applies(m: P, owner: PlayerId, c: Ctx): boolean {
  const { s, db, attacker, defender, card } = c
  const at = String(m.attackType ?? 'ANY')
  if (at !== 'ANY' && at !== c.type) return false
  if (m.protects) {
    const mp = mpDef(s, db, defender)
    if (defender !== owner || !(m.protects as string[]).some(n => mp.name.includes(n) || mp.personality?.character === n)) return false
  } else if (m.target === 'SELF') {
    if (defender !== owner) return false
  } else if (m.target === 'OPPONENT') {
    if (attacker !== owner) return false
  } else if (m.scope === 'OPPONENT') {
    if (attacker === owner) return false
  } else if (m.scope === 'HEROES' || m.scope === 'VILLAINS') {
    if (mpDef(s, db, defender).personality!.alignment !== (m.scope === 'HEROES' ? 'Hero' : 'Villain')) return false
  } else if (m.scope !== 'ALL') {
    if (attacker !== owner) return false
  }
  if (m.performedBy === 'OPPONENT' && attacker === owner) return false
  if (typeof m.performedBy === 'string' && m.performedBy !== 'OPPONENT' && m.performedBy !== 'OWNER' && mpDef(s, db, attacker).personality?.character !== m.performedBy) return false
  const focused = !!c.st.strike.effects.onPlaySecondary.some(e => e.action === 'CUSTOM' && (e.handler === 'focused' || e.handler === 'focusedAttack'))
    || (c.s.combat?.grants ?? []).some(g => g.kind === 'focused' && g.player === attacker)
  if ((m.focusedOnly || m.onlyFocused || m.attackFilter === 'focused') && !focused) return false
  if (m.attackStyle) {
    const style = card?.style
    if (m.attackStyle === 'Freestyle' ? !!style || !card : style !== m.attackStyle) return false
  }
  if (m.styledOrNamed && !(card && (card.style || card.named))) return false
  if (m.cardTitleContains && !(card && card.name.includes(String(m.cardTitleContains)))) return false
  if (m.againstNameContains && !mpDef(s, db, defender).name.includes(String(m.againstNameContains))) return false
  const spec = m.filter as { usableByHeritage?: string } | undefined
  if (spec?.usableByHeritage && !(card?.usableBy?.characters ?? []).some(n => ['Goku', 'Gohan', 'Vegeta', 'Nappa', 'Raditz', 'Trunks', 'Goten', 'Cell', 'Majin Vegeta', 'Kid Trunks', 'Gotenks'].some(h => n.startsWith(h)))) return false
  if (m.onlyIfNoDamageModifiersOnCard) {
    const dmg = c.st.strike.damage
    if (dmg && (dmg.modifierStages || dmg.modifierLifeCards)) return false
  }
  return true
}

/** The additive part of one modifier: stages and life cards (and what it prevents). */
function valueOf(m: P, owner: PlayerId, c: Ctx, base: Damage) {
  const { s, db, attacker, defender } = c
  const foe = other(owner)
  const mine = (key: string) => String(m[key] ?? '')
  let stages = num(m.stages)
  let life = num(m.lifeCards)
  // replacement values
  const named = m.namedOverride as { named?: string; stages?: number } | undefined
  if (named && c.card?.named === named.named) stages = num(named.stages, stages)
  const over = m.styleOverride as { style?: string; stages?: number; lifeCards?: number } | undefined
  if (over && c.card?.style === over.style) { stages = num(over.stages, stages); life = num(over.lifeCards, life) }
  const against = m.againstOverride as { opponentCharacter?: string; stages?: number } | undefined
  if (against && mpDef(s, db, defender).personality?.character === against.opponentCharacter) stages = num(against.stages, stages)
  const nameBonus = m.bonusIfAttackerNameContains as { text?: string; lifeCards?: number } | undefined
  if (nameBonus && mpDef(s, db, attacker).name.includes(String(nameBonus.text))) life = num(nameBonus.lifeCards, life)
  const replace = m.replaceIf as P | undefined
  if (replace && mpDef(s, db, owner).name.includes(String(replace.userTitleContains))) { stages = num(replace.stages); life = num(replace.lifeCards) }

  // per-count bonuses
  const ownerOf = (v: unknown): PlayerId | 'ALL' => (v === 'OPPONENT' ? foe : v === 'SELF' ? owner : v === 'ALL' ? 'ALL' : owner)
  const dragonBalls = (who: PlayerId | 'ALL', type?: string) => countIn(s, db, who, 'dragonBalls', d => !type || d.name.includes(type))
  const addPer = (n: number, unit: number, intoLife: boolean) => { if (intoLife) life += n * unit; else stages += n * unit }
  const cardCount = (spec: P, intoLife: boolean, amount: number) => {
    const piles = (spec.piles as string[] | undefined) ?? [String(spec.pile ?? 'discard')]
    const who = ownerOf(spec.owner)
    const test = (d: CardDef) => matchesSpec(d, spec.filter) && (!spec.cardType || (spec.cardType === 'Non-Combat' ? isNonCombatCard(d) : d.type === spec.cardType)) && (!spec.style || d.style === spec.style)
    addPer(piles.reduce((n, p) => n + countIn(s, db, who, p, test), 0), amount, intoLife)
  }
  if (m.lifeCardsPerDragonBall) life += dragonBalls(m.dragonBallOwner ? ownerOf(m.dragonBallOwner) : 'ALL', m.dragonBallType as string | undefined) * num(m.lifeCardsPerDragonBall)
  if (m.stagesPerDragonBallInPlay) stages += dragonBalls('ALL') * num(m.stagesPerDragonBallInPlay)
  if (m.lifeCardsPerPersonalityLevel) life += (s.players[attacker].mp.levelIndex + 1) * num(m.lifeCardsPerPersonalityLevel)
  if (m.lifeCardsPerDiscardedCardWithTitle) life += countIn(s, db, owner, 'discard', d => d.name.includes(mine('lifeCardsPerDiscardedCardWithTitle'))) * 1
  // BU-37 (West City): every player counts as having +4 Allies for card effects
  const bonus = [s.location, ...s.players.flatMap(pl => pl.nonCombat)].filter((x): x is CardInstance => !!x)
    .flatMap(x => activeCustom(s, db, def(db, x).effects.onEnterPlay, 'allyCountModifier')).reduce((n, x) => n + num(x.amount), 0)
  const allyCount = (who: PlayerId) => s.players[who].allies.length + bonus
  if (m.stagesPerOpponentAlly) stages += allyCount(foe) * num(m.stagesPerOpponentAlly)
  if (m.stagesPerOwnAlly) stages += allyCount(owner) * num(m.stagesPerOwnAlly)
  if (m.stagesPerAllyInPlay) stages += (allyCount(0) + allyCount(1)) * num(m.stagesPerAllyInPlay)
  if (m.lifeCardsPerAlly) life += allyCount(owner) * num(m.lifeCardsPerAlly)
  if (m.lifeCardsPerPersonalityInPlay) {
    const spec = m.lifeCardsPerPersonalityInPlay as { nameContains?: string; amount?: number }
    life += personalitiesInPlay(s, db, 'ALL').filter(n => !spec.nameContains || n.includes(spec.nameContains)).length * num(spec.amount, 1)
  }
  if (m.stagesPerPersonalityInPlay) stages += personalitiesInPlay(s, db, 'ALL').length * num(m.stagesPerPersonalityInPlay)
  for (const key of ['stagesPerOwnCharacterWithTitle', 'lifeCardsPerOwnCharacterWithTitle']) {
    const spec = m[key] as { titleContains?: string; includeMain?: boolean; amount?: number } | undefined
    if (!spec) continue
    const names = [...(spec.includeMain ? [mpDef(s, db, owner).name] : []), ...s.players[owner].allies.map(a => def(db, a.card).name)]
    addPer(names.filter(n => n.includes(String(spec.titleContains))).length, num(spec.amount, 1), key.startsWith('life'))
  }
  if (m.perCount) {
    const spec = m.perCount as P
    const filter = spec.filter as P | undefined
    if (spec.zone === 'play' && filter?.personalityTitleContains) addPer(personalitiesInPlay(s, db, 'ALL').filter(n => n.includes(String(filter.personalityTitleContains))).length, num(spec.lifeCards ?? spec.stages, 1), spec.lifeCards !== undefined)
    else cardCount({ pile: spec.zone, owner: spec.owner, filter }, spec.lifeCards !== undefined, num(spec.lifeCards ?? spec.stages, 1))
  }
  for (const key of ['stagesPerCardInPile', 'lifeCardsPerCardInPile']) {
    const v = m[key]
    if (v === undefined) continue
    const intoLife = key.startsWith('life')
    if (typeof v === 'object') cardCount(v as P, intoLife, num((v as P).amount, 1))
    else cardCount({ pile: m.pile, owner: m.owner, style: m.style }, intoLife, num(v, 1))
  }
  if (m.stagesPerCardInPlay) cardCount({ pile: 'play', owner: m.owner, cardType: (m.cardTypes as string[] | undefined)?.[0] }, false, num(m.stagesPerCardInPlay, 1))
  if (m.lifeCardsPerCardOfType) { const v = m.lifeCardsPerCardOfType as P; cardCount({ piles: v.piles, owner: 'SELF', cardType: v.cardType }, true, num(v.amount, 1)) }
  if (m.stagesPerOpponentCardInPlay) cardCount({ pile: 'play', owner: 'OPPONENT', cardType: m.cardType }, false, num(m.stagesPerOpponentCardInPlay, 1))
  if (m.stagesPerNamedCardInDiscard) stages += countIn(s, db, owner, 'discard', d => !!d.named) * num(m.stagesPerNamedCardInDiscard)
  if (m.lifeCardsPerCardInOpponentDiscard) life += s.players[foe].discard.length * num(m.lifeCardsPerCardInOpponentDiscard)
  for (const key of ['stagesPerDiscardedCardOfRarity', 'lifeCardsPerDiscardedCardOfRarity', 'stagesPerDiscardedCardOfType']) {
    const v = m[key] as P | undefined
    if (!v) continue
    const test = key.endsWith('Type') ? (d: CardDef) => (v.cardType === 'Non-Combat' ? isNonCombatCard(d) : d.type === v.cardType) : (d: CardDef) => d.rarity === v.rarity
    addPer(countIn(s, db, owner, String(v.pile ?? 'discard'), test), num(v.amount, 1), key.startsWith('life'))
  }
  if (m.stagesPerOpponentAngerBelow) stages += Math.max(0, num(m.stagesPerOpponentAngerBelow) - s.players[foe].mp.anger)
  if (m.lifeCardsX === 'ownPur') life += pur(s, db, attacker)
  if (m.lifeCardsFromPhysicalAttackTable) life += baseDamage(s, db, attacker, defender)
  if (m.patBaseDamage && c.type === 'PHYSICAL') stages += num(m.patBaseDamage)
  if (typeof m.multiplyBaseDamage === 'number') { stages += base.stages * (m.multiplyBaseDamage - 1); life += base.lifeCards * (m.multiplyBaseDamage - 1) }
  if (m.baseOnly && typeof m.multiplier === 'number') { stages += base.stages * (m.multiplier - 1); life += base.lifeCards * (m.multiplier - 1) }
  if (m.lifeCardsPerCardDrawnThisTurn) life += s.drawnThisTurn[owner] * num(m.lifeCardsPerCardDrawnThisTurn) // BB-109
  if (m.flatStages) stages += num(m.flatStages)
  if (m.flatLifeCards) life += num(m.flatLifeCards)
  if (m.bonusLifeCards && s.players[owner].lifeDeck.length > 12) life += num(m.bonusLifeCards) // the optional life card cost is always paid when the deck is deep enough
  // a cap on a per-count bonus ("to a maximum of +10")
  const perCount = Object.keys(m).some(k => /PerCard|PerDiscarded|PerOwn|PerAlly|PerPersonality|PerDragonBall|perCount/.test(k))
  if (perCount && typeof m.maxStages === 'number') stages = Math.min(stages, m.maxStages)
  if (perCount && typeof m.maxLifeCards === 'number') life = Math.min(life, m.maxLifeCards)

  // prevention (applied after all additions)
  let preventStages = num(m.preventStages) + (typeof m.preventStagesOrLifeCards === 'number' ? m.preventStagesOrLifeCards : 0)
  let preventLife = num(m.preventLifeCards)
  if (m.prevent && life < 0) { preventLife += -life; life = 0 }
  return { stages, life, preventStages, preventLife, all: !!m.preventAll }
}

/** All new-style modifiers that can apply to the strike, with their owner. */
function collect(c: Ctx): DamageModEntry[] {
  const { s, db } = c
  const out: DamageModEntry[] = [...(c.st.mods ?? []).map(e => ({ ...e })), ...(s.combat?.mods ?? []), ...s.gameMods]
  for (const pl of s.players) {
    for (const src of permanentSources(s, db, pl.id)) {
      for (const m of activeCustom(s, db, src.effects, 'damageModifier')) {
        if (!isNewStyle(m) || (!src.constant && !m.ongoing)) continue
        out.push({ m, owner: pl.id, source: src.name })
      }
    }
  }
  if (s.location) for (const m of activeCustom(s, db, def(db, s.location).effects.onEnterPlay, 'damageModifier')) if (isNewStyle(m) && m.ongoing) out.push({ m, owner: s.location.owner, source: def(db, s.location).name })
  return out
}

/** The new-style damage modifiers, applied after the base damage and the older modifiers. */
export function applyNewModifiers(s: GameState, db: CardDB, st: StrikeState, type: 'PHYSICAL' | 'ENERGY', dmg: Damage): Damage {
  const attacker = st.initiator
  const c: Ctx = { s, db, attacker, defender: other(attacker), st, type, card: st.card ? def(db, st.card) : null }
  let stages = dmg.stages
  let life = dmg.lifeCards
  let prevS = 0
  let prevL = 0
  let all = false
  let minLife: number | undefined
  let minStages: number | undefined
  let noModifiers = false
  const used: string[] = []
  const combat = s.combat!
  for (const e of collect(c)) {
    const m = e.m
    if (e.exceptSeq !== undefined && e.exceptSeq === st.seq) continue
    if (e.usesLeft !== undefined && e.usesLeft <= 0) continue
    if (!applies(m, e.owner, c)) continue
    if (m.noModifiers) { noModifiers = true; used.push(e.source); continue }
    // "the first attack" limits
    const once = m.firstAttackPerCombat || m.firstAttackOnly || (m.limit && (m.limit as P).per === 'combat')
    const key = `dm:${e.source}:${e.owner}`
    if (once && combat.onceKeys.includes(key)) continue
    const v = valueOf(m, e.owner, c, { stages, lifeCards: life })
    if (once) combat.onceKeys.push(key)
    if (e.usesLeft !== undefined) e.usesLeft--
    stages += v.stages
    life += v.life
    prevS += v.preventStages
    prevL += v.preventLife
    all = all || v.all
    if (typeof m.minLifeCards === 'number') minLife = Math.max(minLife ?? 0, m.minLifeCards)
    if (typeof m.minStages === 'number') minStages = Math.max(minStages ?? 0, m.minStages)
    if (v.stages || v.life || v.preventStages || v.preventLife || v.all) used.push(e.source)
  }
  // modifiers that were handed out for "next attacks" live in combat.mods: write the used counts back
  const entries = combat.mods
  for (const e of entries) if (e.usesLeft !== undefined && e.usesLeft <= 0) entries.splice(entries.indexOf(e), 1)
  // BB-45: whenever the defender prevents damage, it may prevent 1 more of that type; BU-163: doubled against this attack
  for (const src of permanentSources(s, db, c.defender)) {
    for (const b of activeCustom(s, db, src.effects, 'preventionBonus')) {
      if (!b.ongoing || typeof b.amount !== 'number') continue
      if (prevS > 0) prevS += b.amount
      if (prevL > 0) prevL += b.amount
    }
  }
  if (st.preventMult) { prevS *= st.preventMult; prevL *= st.preventMult }
  stages = Math.max(0, stages - prevS)
  life = Math.max(0, life - prevL)
  if (all) { stages = 0; life = 0 }
  if (minLife !== undefined) life = Math.max(life, minLife)
  if (minStages !== undefined) stages = Math.max(stages, minStages)
  if (noModifiers) {
    // CS-183: "no modifiers are added": only the base damage of the attack counts
    const d = st.strike.damage ?? defaultDamage(st.strike, s.rules)
    const pat = d.calculation === 'PAT'
    stages = pat ? baseDamage(s, db, attacker, c.defender) : d.calculation === 'FLAT' ? d.stages : 0
    life = d.calculation === 'FLAT' ? d.lifeCards : 0
  }
  if (used.length) log(s, 'DAMAGE_X', `${[...new Set(used)].join(', ')} change the damage`, attacker)
  return { stages, lifeCards: life }
}
