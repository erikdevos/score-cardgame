import { isAttackRole, isDefenseRole, nextRandomForTests as nextRandom, type CardDB, type DeckList } from '../engine'
import { heroMP, testDeck, villainMP } from '../data/test-cards'
import { setOrder } from './cardDb'
import { formatCards, type FormatKey } from './formats'
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
function autoDeck(cards: CardDef[], mp: string[], character: string, seed: number): DeckList {
  const pool = cards.filter(c => c.type !== 'Personality' || c.personality?.level === 1)
    .filter(c => c.type !== 'Personality' || c.personality?.character !== character)
  const combat = pool.filter(c => isAttackRole(c.combatRole) || isDefenseRole(c.combatRole))
  const other = pool.filter(c => !combat.includes(c))
  const life: string[] = []
  const names = new Map<string, number>()
  let s = seed
  const pick = (arr: typeof pool, n: number) => {
    const copy = [...arr]
    while (n > 0 && copy.length) {
      const [r, ns] = nextRandom(s); s = ns
      const [c] = copy.splice(Math.floor(r * copy.length), 1)
      // the copy limit counts cards by title, so reprints in a later set share it
      const left = (c.type === 'Dragon Ball' ? 1 : (c.limitPerDeck ?? 3)) - (names.get(c.name) ?? 0)
      const copies = Math.min(n, left)
      if (copies <= 0) continue
      names.set(c.name, (names.get(c.name) ?? 0) + copies)
      for (let i = 0; i < copies; i++) life.push(c.id)
      n -= copies
    }
  }
  pick(combat, 42)
  pick(other, 60 - life.length)
  return { mp, life }
}

export function deckChoices(format: FormatKey = 'SAIYAN'): DeckChoice[] {
  const cards = formatCards(format)
  // the Saiyan Saga format keeps the original 3-level stacks
  const out: DeckChoice[] = realCharacters(cards, format === 'SAIYAN' ? 3 : 4).map(({ character, mp }) => (
    { key: `auto-${character}`, label: character, mpId: mp[0], build: (seed: number) => autoDeck(cards, mp, character, seed) }))
  out.push(
    { key: 'demo-hero', label: 'Test deck: Hero (fictional, no images)', mpId: heroMP[0], build: () => testDeck(heroMP) },
    { key: 'demo-villain', label: 'Test deck: Villain (fictional, no images)', mpId: villainMP[0], build: () => testDeck(villainMP) },
  )
  return out
}

export function cardCount(db: CardDB) { return Object.keys(db).length }
