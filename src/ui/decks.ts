import { isAttackRole, isDefenseRole, isSaiyanHeritage, nextRandomForTests as nextRandom, trunksAllyAllowed, type CardDB, type DeckList } from '../engine'
import { heroMP, testDeck, villainMP } from '../data/test-cards'
import { db, setOrder } from './cardDb'
import { FORMATS, formatCards, type FormatKey } from './formats'
import type { CardDef } from '../engine'

export interface DeckChoice {
  key: string
  label: string
  /** Level 1 Main Personality, for the menu preview */
  mpId: string
  build: (seed: number) => DeckList
}

/** Characters with a full Level 1-3 stack in the pool; per level the newest set's printing is used. */
function realCharacters(pool: CardDef[], maxLevel: number): { character: string; mp: string[] }[] {
  const byChar = new Map<string, Map<number, string>>()
  const newestFirst = [...pool].sort((a, b) => setOrder(b.set) - setOrder(a.set))
  for (const c of newestFirst) {
    if (c.type !== 'Personality' || !c.personality || c.id.endsWith('-HT') || c.rarity === 'Promo') continue
    const m = byChar.get(c.personality.character) ?? new Map()
    if (!m.has(c.personality.level)) m.set(c.personality.level, c.id)
    byChar.set(c.personality.character, m)
  }
  return [...byChar]
    .filter(([, m]) => m.has(1) && m.has(2) && m.has(3))
    // with later sets a level 4 extends the stack when the pool has one
    .map(([character, m]) => ({ character, mp: [1, 2, 3, 4].filter(l => l <= maxLevel && m.has(l)).map(l => m.get(l)!) }))
}

/** A quick legal 60-card deck: 3 copies of random playable cards, weighted to combat cards. */
function autoDeck(cards: CardDef[], mp: string[], character: string, seed: number, trunks: boolean): DeckList {
  // Trunks Saga allies: same side, 2+ levels below the main personality's top level; Pure 2000: any level 1
  const mpCards = mp.map(id => db[id])
  const allyOk = (c: CardDef) => (trunks ? trunksAllyAllowed(mpCards, undefined, c) : c.personality?.level === 1 && c.personality.character !== character)
  let s = seed
  // Trunks Saga: build a Tokui-Waza deck (a single martial arts style, +1 PUR) with a style this character may claim
  let style: string | undefined
  if (trunks) {
    const styles = [...new Set(cards.map(c => c.style).filter((x): x is string => !!x))]
      .filter(st => (st !== 'Saiyan' || isSaiyanHeritage(character)) && (st !== 'Namekian' || /^(Piccolo|Nail)/.test(character)))
    const [r, ns] = nextRandom(s); s = ns
    style = styles[Math.floor(r * styles.length)]
  }
  // cards printed for other characters or the other side are dead cards: leave them out
  const mine = mpCards[0].personality!
  const usable = (c: CardDef) => !c.usableBy || !!(c.usableBy.characters?.includes(character) || c.usableBy.alignments?.includes(mine.alignment as 'Hero' | 'Villain'))
  // Trunks Saga: Earth or Namek Dragon Balls, not both
  let namek: boolean | undefined
  if (trunks) {
    const [r, ns] = nextRandom(s); s = ns
    namek = r < 0.3 && cards.some(c => c.type === 'Dragon Ball' && /Namek/i.test(c.name))
  }
  const pool = cards.filter(c => (c.type !== 'Dragon Ball' || namek === undefined || /Namek/i.test(c.name) === namek) && c.type !== 'Mastery' && usable(c) && (c.type !== 'Personality' || allyOk(c)) && (!style || !c.style || c.style === style))
  // the Mastery card of the deck's style, when the pool has one
  const mastery = style ? cards.find(c => c.type === 'Mastery' && c.style === style)?.id : undefined
  const combat = pool.filter(c => isAttackRole(c.combatRole) || isDefenseRole(c.combatRole))
  const other = pool.filter(c => !combat.includes(c))
  const life: string[] = []
  const names = new Map<string, number>()
  const pick = (arr: typeof pool, n: number) => {
    const copy = [...arr]
    while (n > 0 && copy.length) {
      const [r, ns] = nextRandom(s); s = ns
      const [c] = copy.splice(Math.floor(r * copy.length), 1)
      // the copy limit counts cards by title, so reprints in a later set share it
      const max = c.type === 'Dragon Ball' ? 1 : trunks && c.type === 'Personality' ? (c.personality?.character === 'Saibaimen' ? 3 : 1) : (c.limitPerDeck ?? 3)
      // personalities count per character and level, so a Hi-Tech printing shares the limit
      const key = trunks && c.personality ? `${c.personality.character} Lv${c.personality.level}` : c.name
      const left = max - (names.get(key) ?? 0)
      const copies = Math.min(n, left)
      if (copies <= 0) continue
      names.set(key, (names.get(key) ?? 0) + copies)
      for (let i = 0; i < copies; i++) life.push(c.id)
      n -= copies
    }
  }
  pick(combat, 42)
  pick(other, 60 - life.length)
  return mastery ? { mp, life, mastery } : { mp, life }
}

export function deckChoices(format: FormatKey = 'SAIYAN'): DeckChoice[] {
  const cards = formatCards(format)
  // the Saiyan Saga format keeps the original 3-level stacks
  const out: DeckChoice[] = realCharacters(cards, format === 'SAIYAN' ? 3 : 4).map(({ character, mp }) => (
    { key: `auto-${character}`, label: character, mpId: mp[0], build: (seed: number) => autoDeck(cards, mp, character, seed, !!FORMATS[format].rules.trunks?.allyRules) }))
  out.push(
    { key: 'demo-hero', label: 'Test deck: Hero (fictional, no images)', mpId: heroMP[0], build: () => testDeck(heroMP) },
    { key: 'demo-villain', label: 'Test deck: Villain (fictional, no images)', mpId: villainMP[0], build: () => testDeck(villainMP) },
  )
  return out
}

export function cardCount(db: CardDB) { return Object.keys(db).length }
