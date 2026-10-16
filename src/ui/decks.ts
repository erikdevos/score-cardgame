import { isAttackRole, isDefenseRole, nextRandomForTests as nextRandom, type CardDB, type DeckList } from '../engine'
import { heroMP, testDeck, villainMP } from '../data/test-cards'
import { realCards } from './cardDb'

export interface DeckChoice {
  key: string
  label: string
  build: (seed: number) => DeckList
}

/** Characters with a full Level 1-3 stack in the transcribed data. */
function realCharacters(): { character: string; mp: string[] }[] {
  const byChar = new Map<string, Map<number, string>>()
  for (const c of realCards) {
    if (c.type !== 'Personality' || !c.personality || c.id.endsWith('-HT')) continue
    const m = byChar.get(c.personality.character) ?? new Map()
    if (!m.has(c.personality.level)) m.set(c.personality.level, c.id)
    byChar.set(c.personality.character, m)
  }
  return [...byChar]
    .filter(([, m]) => m.has(1) && m.has(2) && m.has(3))
    .map(([character, m]) => ({ character, mp: [m.get(1)!, m.get(2)!, m.get(3)!] }))
}

/** A quick legal 60-card deck: 3 copies of random playable cards, weighted to combat cards. */
function autoDeck(mp: string[], character: string, seed: number): DeckList {
  const pool = realCards.filter(c => c.type !== 'Personality' || c.personality?.level === 1)
    .filter(c => c.type !== 'Personality' || c.personality?.character !== character)
  const combat = pool.filter(c => isAttackRole(c.combatRole) || isDefenseRole(c.combatRole))
  const other = pool.filter(c => !combat.includes(c))
  const life: string[] = []
  let s = seed
  const pick = (arr: typeof pool, n: number) => {
    const copy = [...arr]
    while (n > 0 && copy.length) {
      const [r, ns] = nextRandom(s); s = ns
      const [c] = copy.splice(Math.floor(r * copy.length), 1)
      const copies = Math.min(n, c.type === 'Dragon Ball' ? 1 : (c.limitPerDeck ?? 3))
      for (let i = 0; i < copies; i++) life.push(c.id)
      n -= copies
    }
  }
  pick(combat, 42)
  pick(other, 60 - life.length)
  return { mp, life }
}

export function deckChoices(): DeckChoice[] {
  const out: DeckChoice[] = [
    { key: 'demo-hero', label: 'Demo: Test Hero (fictional cards)', build: () => testDeck(heroMP) },
    { key: 'demo-villain', label: 'Demo: Test Villain (fictional cards)', build: () => testDeck(villainMP) },
  ]
  for (const { character, mp } of realCharacters()) {
    out.push({ key: `auto-${character}`, label: `${character} (auto deck, real cards)`, build: seed => autoDeck(mp, character, seed) })
  }
  return out
}

export function cardCount(db: CardDB) { return Object.keys(db).length }
