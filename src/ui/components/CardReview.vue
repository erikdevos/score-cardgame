<script setup lang="ts">
import { computed, ref } from 'vue'
import { invalidCards, realCards } from '../cardDb'
import index from '../../data/saiyan-saga/index.json'

defineEmits<{ back: [] }>()
const KEY = 'dbzccg.verified'
const load = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }
const verified = ref(new Set<string>([...load(), ...realCards.filter(c => c.verified).map(c => c.id)]))
const filter = ref<'all' | 'unverified' | 'review'>('unverified')
const query = ref('')

const missing = computed(() => {
  const nums = new Set(realCards.map(c => c.imageUrl))
  return index.filter(e => !nums.has(`/cards/${e.slug}.jpg`))
})
const list = computed(() => realCards.filter(c => {
  if (filter.value === 'unverified' && verified.value.has(c.id)) return false
  if (filter.value === 'review' && !c.needsReview) return false
  const q = query.value.toLowerCase()
  return !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.rawText.toLowerCase().includes(q)
}))

function toggle(id: string) {
  const v = new Set(verified.value)
  v.has(id) ? v.delete(id) : v.add(id)
  verified.value = v
  try { localStorage.setItem(KEY, JSON.stringify([...v])) } catch { /* storage unavailable */ }
}

function download() {
  const merged = realCards.map(c => ({ ...c, verified: verified.value.has(c.id) }))
  const url = URL.createObjectURL(new Blob([JSON.stringify(merged, null, 2) + '\n'], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'cards.json'
  a.click()
  URL.revokeObjectURL(url)
}

const structured = (c: (typeof realCards)[number]) => {
  const { rawText: _r, imageUrl: _i, name: _n, set: _s, ...data } = c
  return JSON.stringify(data, null, 2)
}
</script>

<template>
  <div class="review">
    <header class="bar">
      <button class="link" @click="$emit('back')">Menu</button>
      <h2>Card review</h2>
      <span>{{ realCards.length }} transcribed · {{ verified.size }} verified · {{ invalidCards.length }} invalid · {{ missing.length }} not yet transcribed</span>
    </header>
    <div class="filters">
      <label><input v-model="filter" type="radio" value="unverified" /> Unverified</label>
      <label><input v-model="filter" type="radio" value="review" /> Needs review</label>
      <label><input v-model="filter" type="radio" value="all" /> All</label>
      <input v-model="query" placeholder="Search name, id or text" />
      <button @click="download">Download cards.json with verified flags</button>
    </div>
    <p class="hint">Verified flags are kept in this browser. Download the file and replace <code>src/data/saiyan-saga/cards.json</code> to make them permanent.</p>
    <div v-if="invalidCards.length" class="error">
      <p v-for="c in invalidCards" :key="c.id"><b>{{ c.id }}</b>: {{ c.error }}</p>
    </div>
    <article v-for="c in list" :key="c.id" class="review-card">
      <img :src="c.imageUrl" :alt="c.name" loading="lazy" />
      <div>
        <h3>{{ c.id }} · {{ c.name }} <small>{{ c.type }} · {{ c.rarity }}</small></h3>
        <p class="raw">{{ c.rawText }}</p>
        <p v-if="c.needsReview" class="warn">Needs review: {{ c.needsReview }}</p>
        <label class="verify"><input type="checkbox" :checked="verified.has(c.id)" @change="toggle(c.id)" /> Verified: image and data match</label>
        <details><summary>Structured data</summary><pre>{{ structured(c) }}</pre></details>
      </div>
    </article>
    <p v-if="!list.length" class="hint">Nothing to show for this filter.</p>
  </div>
</template>
