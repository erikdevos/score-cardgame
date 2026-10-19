import type { CardDef } from '../engine'

/** Particle behaviours: how the particles move around the card. */
export type AuraStyle = 'embers' | 'sparks' | 'wisps' | 'stars'
export interface AuraTheme { style: AuraStyle; colors: string[] }

const gold = ['#ffd45a', '#ffae2b', '#fff3b0', '#ff8a1f']
const blue = ['#8fd8ff', '#4fa8ff', '#ffffff', '#b9a6ff']
const green = ['#9dff8a', '#4fe08a', '#d6ffc2', '#2fbf9a']
const violet = ['#d28bff', '#a24dff', '#ff7ad9', '#f0d0ff']
const red = ['#ff7a6b', '#ff3f4f', '#ffd0a0', '#ffb347']
const ice = ['#bff4ff', '#7fe0ff', '#ffffff', '#9ab8ff']

/** Per-character custom effect, like a card style in a collectible game; unknown characters fall back by alignment. */
const THEMES: Record<string, AuraTheme> = {
  Goku: { style: 'embers', colors: gold },
  Gohan: { style: 'stars', colors: ['#ffe27a', '#c79bff', '#ffffff', '#ffb347'] },
  Krillin: { style: 'stars', colors: ['#ffb347', '#ffe27a', '#ffffff', '#ff8a1f'] },
  Piccolo: { style: 'wisps', colors: green },
  Nail: { style: 'wisps', colors: green },
  Dende: { style: 'wisps', colors: green },
  Vegeta: { style: 'sparks', colors: blue },
  Trunks: { style: 'sparks', colors: ice },
  Tien: { style: 'sparks', colors: ['#fff3b0', '#ffe27a', '#ffffff', '#9dff8a'] },
  Yamcha: { style: 'embers', colors: ['#ffb347', '#ff7a3f', '#ffe27a', '#ffffff'] },
  Raditz: { style: 'sparks', colors: violet },
  Nappa: { style: 'embers', colors: red },
  Frieza: { style: 'wisps', colors: violet },
  'King Cold': { style: 'wisps', colors: ice },
  Cell: { style: 'wisps', colors: green },
  'Captain Ginyu': { style: 'stars', colors: violet },
  'Android 16': { style: 'sparks', colors: green },
  'Android 17': { style: 'sparks', colors: red },
  'Android 18': { style: 'stars', colors: gold },
}

export function auraTheme(card?: CardDef): AuraTheme {
  const p = card?.personality
  if (p && THEMES[p.character]) return THEMES[p.character]
  return p?.alignment === 'Villain' ? { style: 'wisps', colors: violet } : { style: 'embers', colors: gold }
}

export interface Particle { x: number; y: number; dx: number; dy: number; size: number; dur: number; delay: number; color: string; rot: number }

/** Deterministic particles (seeded by card id) so a card keeps the same look across renders. */
export function makeParticles(card: CardDef, count: number): { theme: AuraTheme; particles: Particle[] } {
  const theme = auraTheme(card)
  let h = 2166136261
  for (const ch of card.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const rnd = () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const particles: Particle[] = []
  for (let i = 0; i < count; i++) {
    // start on the card's outline, slightly outside; coordinates in % of the card
    const side = Math.floor(rnd() * 4), along = rnd() * 100, off = -1 - rnd() * 4
    const [x, y] = side === 0 ? [along, off] : side === 1 ? [100 - off, along] : side === 2 ? [along, 100 - off] : [off, along]
    // outward direction from the centre; travel distances are fractions of the card width (--u)
    const ox = x - 50, oy = y - 50, len = Math.hypot(ox, oy) || 1
    const ux = ox / len, uy = oy / len
    let dx: number, dy: number, size: number, dur: number
    switch (theme.style) {
      case 'embers': dx = (rnd() - 0.5) * 0.2; dy = -(0.15 + rnd() * 0.3); size = 2 + rnd() * 2.5; dur = 1.6 + rnd() * 1.6; break
      case 'sparks': dx = ux * (0.12 + rnd() * 0.25) + (rnd() - 0.5) * 0.08; dy = uy * (0.12 + rnd() * 0.25) + (rnd() - 0.5) * 0.08; size = 1.5 + rnd() * 2; dur = 0.7 + rnd() * 0.9; break
      case 'wisps': dx = (rnd() - 0.5) * 0.3 + ux * 0.08; dy = -(0.08 + rnd() * 0.22); size = 5 + rnd() * 6; dur = 2.4 + rnd() * 1.8; break
      default: dx = ux * (0.05 + rnd() * 0.15); dy = uy * (0.05 + rnd() * 0.15) - 0.05; size = 4 + rnd() * 4; dur = 1.2 + rnd() * 1.2
    }
    particles.push({ x, y, dx, dy, size, dur, delay: -rnd() * dur, color: theme.colors[Math.floor(rnd() * theme.colors.length)], rot: rnd() * 90 })
  }
  return { theme, particles }
}
