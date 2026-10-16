import { describe, expect, it } from 'vitest'
import { bracketOf, defaultRulesConfig, patDamage } from '../src/engine'

const rules = defaultRulesConfig()
const spec = [
  [2, 1, 1, 1, 0, 0, 0],
  [3, 2, 2, 1, 1, 0, 0],
  [4, 3, 2, 2, 1, 1, 0],
  [5, 4, 3, 3, 2, 1, 1],
  [6, 5, 4, 3, 3, 2, 2],
  [7, 6, 5, 4, 4, 3, 2],
  [8, 7, 6, 5, 4, 3, 3],
]
const sample = [0, 500, 1000, 2500, 10000, 20000, 50000]

describe('Physical Attack Table', () => {
  it('maps bracket boundaries', () => {
    expect([0, 499, 500, 999, 1000, 2499, 2500, 9999, 10000, 19999, 20000, 49999, 50000, 999999].map(r => bracketOf(r, rules)))
      .toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
  })
  it('matches every cell of the spec matrix', () => {
    for (let a = 0; a < 7; a++) for (let d = 0; d < 7; d++) {
      expect(patDamage(sample[a], sample[d], rules), `att ${a} def ${d}`).toBe(spec[a][d])
      expect(patDamage(sample[a] + 1, sample[d] + 1, rules)).toBe(spec[a][d])
    }
  })
})
