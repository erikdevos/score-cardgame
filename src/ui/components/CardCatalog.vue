<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CardDef } from '../../engine'
import { SETS, realCards, setOrder } from '../cardDb'

defineEmits<{ back: [] }>()

const setFilter = ref<string>('all')
const query = ref('')
const open = ref<CardDef | null>(null)

const sorted = [...realCards].sort((a, b) => setOrder(a.set) - setOrder(b.set) || a.number - b.number)
const counts = computed(() => Object.fromEntries(SETS.map(s => [s.name, sorted.filter(c => c.set === s.name).length])))

const list = computed(() => {
  const q = query.value.trim().toLowerCase()
  return sorted.filter(c => {
    if (setFilter.value !== 'all' && c.set !== setFilter.value) return false
    return !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || String(c.number) === q || c.rawText.toLowerCase().includes(q)
  })
})

const idx = computed(() => (open.value ? list.value.findIndex(c => c.id === open.value!.id) : -1))
function step(d: number) {
  const n = list.value.length
  if (idx.value < 0 || !n) return
  open.value = list.value[(idx.value + d + n) % n]
}

const fmt = (v: unknown): string => {
  if (v === true) return 'Yes'
  if (Array.isArray(v)) return v.map(fmt).join(', ')
  if (v && typeof v === 'object') return Object.entries(v).filter(([, x]) => x !== 0 && x !== false && x != null).map(([k, x]) => `${k}: ${fmt(x)}`).join(' · ')
  return String(v)
}

/** Transcribed fields as label/value rows; empty fields are left out. */
const rows = computed<[string, string][]>(() => {
  const c = open.value as (CardDef & Record<string, any>) | null
  if (!c) return []
  const out: [string, unknown][] = [['Card text', c.rawText], ['Type', c.type], ['Style', c.style], ['Rarity', c.rarity]]
  const p = c.personality
  if (p) {
    out.push(['Character', p.character], ['Level', p.level], ['Alignment', p.alignment], ['PUR', p.pur], ['Power rating', p.powerRatings?.join(' / ')])
    if (p.power) out.push(['Power', `${p.power.name}: ${p.power.text}`])
  }
  out.push(
    ['Cost', c.cost], ['Damage', c.damage], ['Defense', c.defense], ['Combat role', c.combatRole], ['Usable by', c.usableBy], ['Use phase', c.usePhase],
    ['Limit per deck', c.limitPerDeck], ['Dragon Ball', c.dragonBallNumber], ['Named', c.named], ['Passives', c.passives],
    ['Card', c.id], ['Set', `${c.set} · #${c.number}`],
    // debugging only, not relevant for players
    ['Needs review', c.needsReview], ['Verified', c.verified ? 'Yes' : 'No'],
  )
  return out.map(([k, v]): [string, string] => [k, fmt(v)]).filter(([, v]) => v !== '' && v !== 'undefined' && v !== 'null')
})

function onKey(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') open.value = null
  else if (e.key === 'ArrowRight') step(1)
  else if (e.key === 'ArrowLeft') step(-1)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="catalog">
    <header class="catalog-top">
      <div class="catalog-bar">
        <button class="link-btn" @click="$emit('back')">&larr; Menu</button>
        <h2>Card catalog</h2>
        <span class="muted small">{{ list.length }} of {{ sorted.length }} cards</span>
      </div>
      <input v-model="query" class="catalog-search" type="search" placeholder="Search name, text or number" aria-label="Search cards" autofocus />
      <div class="segmented" role="group" aria-label="Series">
        <button :class="{ on: setFilter === 'all' }" @click="setFilter = 'all'">All<small>{{ sorted.length }}</small></button>
        <button v-for="s in SETS" :key="s.key" :class="{ on: setFilter === s.name }" @click="setFilter = s.name">{{ s.name }}<small>{{ counts[s.name] }}</small></button>
      </div>
    </header>

    <ul v-if="list.length" class="catalog-grid">
      <li v-for="c in list" :key="c.id">
        <button class="cat-card" :title="c.name" @click="open = c">
          <img :src="c.imageUrl" :alt="c.name" loading="lazy" />
          <span class="cat-num">{{ c.id }}</span>
          <span class="cat-name">{{ c.name }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="muted catalog-empty">No cards match.</p>

    <div v-if="open" class="cat-modal" role="dialog" aria-modal="true" :aria-label="open.name" @click.self="open = null">
      <button class="cat-close" aria-label="Close" @click="open = null">&times;</button>
      <button class="cat-nav prev" aria-label="Previous card" @click="step(-1)">&lsaquo;</button>
      <button class="cat-nav next" aria-label="Next card" @click="step(1)">&rsaquo;</button>
      <div class="cat-detail">
        <div class="cat-art"><img :src="open.imageUrl" :alt="open.name" /></div>
        <div class="cat-info">
          <h3>{{ open.name }}</h3>
          <table>
            <tbody>
              <tr v-for="[k, v] in rows" :key="k" :class="{ text: k === 'Card text', debug: k === 'Needs review' || k === 'Verified' }"><th>{{ k }}</th><td>{{ v }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
