// Fictional cards for engine tests and the demo decks. Not real Saiyan Saga cards.
import { buildCardDB, type DeckList } from '../engine'

const ratings = (step: number, start = 0) => Array.from({ length: 11 }, (_, i) => start + i * step)

const mp = (id: string, character: string, level: number, step: number, pur: number, extra: object = {}) => ({
  id, name: `${character} Lv${level}`, set: 'TEST', number: 0, type: 'Personality', rarity: 'Test', rawText: '',
  personality: { character, level, powerRatings: ratings(step), pur, alignment: 'Hero', ...extra },
})

export const testCards = [
  mp('TEST-HERO-1', 'Hero', 1, 100, 2),
  mp('TEST-HERO-2', 'Hero', 2, 300, 3),
  mp('TEST-HERO-3', 'Hero', 3, 1000, 3),
  mp('TEST-VIL-1', 'Villain', 1, 100, 2, { power: { name: 'Eye Beam', text: 'Energy attack, 3 life cards', strike: { combatRole: 'ATTACK_ENERGY', cost: { type: 'NONE', amount: 0 }, damage: { calculation: 'FLAT', lifeCards: 3 } } } }),
  mp('TEST-VIL-2', 'Villain', 2, 300, 3),
  mp('TEST-VIL-3', 'Villain', 3, 1000, 3, { cannotWinMPP: true }),
  mp('TEST-ALLY', 'Sidekick', 1, 50, 1),
  { id: 'TEST-PUNCH', name: 'Test Punch', set: 'TEST', number: 1, type: 'Physical Combat', rarity: 'Test', rawText: '',
    combatRole: 'ATTACK_PHYSICAL', damage: { calculation: 'PAT', modifierStages: 3 },
    effects: { onPlaySecondary: [{ action: 'MODIFY_ANGER', target: 'SELF', amount: 1 }] } },
  { id: 'TEST-BLAST', name: 'Test Blast', set: 'TEST', number: 2, type: 'Energy Combat', rarity: 'Test', rawText: '',
    combatRole: 'ATTACK_ENERGY', effects: { onHit: [{ action: 'MODIFY_ANGER', target: 'OPPONENT', amount: -1 }] } },
  { id: 'TEST-BIG-BLAST', name: 'Test Big Blast', set: 'TEST', number: 3, type: 'Energy Combat', rarity: 'Test', rawText: '',
    combatRole: 'ATTACK_ENERGY', damage: { calculation: 'FLAT', lifeCards: 6 } },
  { id: 'TEST-SLAP', name: 'Test Slap', set: 'TEST', number: 4, type: 'Physical Combat', rarity: 'Test', rawText: '',
    combatRole: 'ATTACK_PHYSICAL', damage: { calculation: 'FLAT', stages: 0 },
    effects: { onHit: [{ action: 'MODIFY_ANGER', target: 'SELF', amount: 1 }] } },
  { id: 'TEST-BLOCK', name: 'Test Block', set: 'TEST', number: 5, type: 'Physical Combat', rarity: 'Test', rawText: '',
    combatRole: 'DEFENSE_PHYSICAL', effects: { onPlaySecondary: [{ action: 'MODIFY_ANGER', target: 'OPPONENT', amount: -1 }] } },
  { id: 'TEST-SHIELD', name: 'Test Shield', set: 'TEST', number: 6, type: 'Energy Combat', rarity: 'Test', rawText: '',
    combatRole: 'DEFENSE_ENERGY' },
  { id: 'TEST-TRUCE', name: 'Test Truce', set: 'TEST', number: 7, type: 'Combat', rarity: 'Test', rawText: '',
    combatRole: 'COMBAT_EFFECT', effects: { onPlaySecondary: [{ action: 'END_COMBAT' }] } },
  { id: 'TEST-DRILL', name: 'Test Hand Drill', set: 'TEST', number: 8, type: 'Drill', rarity: 'Test', rawText: '',
    passives: [{ kind: 'HAND_LIMIT', amount: 1 }] },
  { id: 'TEST-RAGE', name: 'Test Rage', set: 'TEST', number: 9, type: 'Non-Combat', rarity: 'Test', rawText: '',
    effects: { onEnterPlay: [{ action: 'MODIFY_ANGER', target: 'SELF', amount: 2 }] } },
  { id: 'TEST-LOCATION', name: 'Test Arena', set: 'TEST', number: 10, type: 'Location', rarity: 'Test', rawText: '' },
  { id: 'TEST-VILLAIN-PUNCH', name: 'Test Villain Punch', set: 'TEST', number: 18, type: 'Physical Combat', rarity: 'Test', rawText: 'Villains only.',
    combatRole: 'ATTACK_PHYSICAL', usableBy: { alignments: ['Villain'] } },
  { id: 'TEST-HERO-NAMED-PUNCH', name: 'Test Named Punch', set: 'TEST', number: 19, type: 'Physical Combat', rarity: 'Test', rawText: 'Villains and Hero only.',
    combatRole: 'ATTACK_PHYSICAL', usableBy: { alignments: ['Villain'], characters: ['Hero'] } },
  { id: 'TEST-ORANGE-DRILL', name: 'Test Orange Drill', set: 'TEST', number: 20, type: 'Drill', style: 'Orange', rarity: 'Test', rawText: '' },
  { id: 'TEST-ORANGE-SOLO', name: 'Test Orange Solo Drill', set: 'TEST', number: 21, type: 'Drill', style: 'Orange', rarity: 'Test',
    rawText: 'Cannot be used with other Orange drills in play.', exclusiveDrillStyle: 'Orange' },
  { id: 'TEST-NC-KICK', name: 'Test Flying Kick', set: 'TEST', number: 22, type: 'Non-Combat', rarity: 'Test', rawText: 'Physical attack doing 2 power stages.',
    combatRole: 'ATTACK_PHYSICAL', damage: { calculation: 'FLAT', stages: 2 } },
  { id: 'TEST-NC-DODGE', name: 'Test Flight', set: 'TEST', number: 23, type: 'Non-Combat', rarity: 'Test', rawText: 'Stops an attack.',
    combatRole: 'DEFENSE_ANY' },
  { id: 'TEST-DEFEND-TRUCE', name: 'Test Defend Truce', set: 'TEST', number: 24, type: 'Combat', rarity: 'Test', rawText: 'Ends combat.',
    combatRole: 'COMBAT_EFFECT', usePhase: 'DEFEND', effects: { onPlaySecondary: [{ action: 'END_COMBAT' }] } },
  ...[1, 2, 3, 4, 5, 6, 7].map(n => ({
    id: `TEST-DB-${n}`, name: `Test Dragon Ball ${n}`, set: 'TEST', number: 10 + n, type: 'Dragon Ball', rarity: 'Test', rawText: '', dragonBallNumber: n,
  })),
]

export const db = buildCardDB(testCards)

export const heroMP = ['TEST-HERO-1', 'TEST-HERO-2', 'TEST-HERO-3']
export const villainMP = ['TEST-VIL-1', 'TEST-VIL-2', 'TEST-VIL-3']

const filler = ['TEST-PUNCH', 'TEST-BLAST', 'TEST-BLOCK', 'TEST-SHIELD', 'TEST-PUNCH', 'TEST-BIG-BLAST', 'TEST-SLAP', 'TEST-BLOCK', 'TEST-RAGE', 'TEST-DRILL']
export function testDeck(mpIds: string[], size = 60): DeckList {
  const life: string[] = []
  for (let i = 0; life.length < size - 9; i++) life.push(filler[i % filler.length])
  life.push('TEST-TRUCE', 'TEST-LOCATION')
  for (let n = 1; n <= 7; n++) life.push(`TEST-DB-${n}`)
  return { mp: mpIds, life }
}
