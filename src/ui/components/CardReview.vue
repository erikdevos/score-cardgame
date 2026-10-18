<script setup lang="ts">
import { computed, ref } from 'vue'
import { SETS, invalidCards, realCards } from '../cardDb'

defineEmits<{ back: [] }>()
const KEY = 'dbzccg.verified'
const load = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } }
const verified = ref(new Set<string>([...load(), ...realCards.filter(c => c.verified).map(c => c.id)]))
const filter = ref<'all' | 'unverified' | 'review'>('unverified')
const query = ref('')
const setName = ref<string>(SETS[SETS.length - 1].name)
const inSet = computed(() => realCards.filter(c => c.set === setName.value))

const missing = computed(() => {
  const set = SETS.find(s => s.name === setName.value)!
  const urls = new Set(inSet.value.map(c => c.imageUrl))
  return set.index.filter(e => !urls.has(`${set.imageDir}${e.slug}.jpg`))
})
const list = computed(() => inSet.value.filter(c => {
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
  const merged = inSet.value.map(c => ({ ...c, verified: verified.value.has(c.id) }))
  const url = URL.createObjectURL(new Blob([JSON.stringify(merged, null, 2) + '\n'], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${SETS.find(s => s.name === setName.value)!.key}-cards.json`
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
      <select v-model="setName" aria-label="Set"><option v-for="s in SETS" :key="s.key" :value="s.name">{{ s.name }}</option></select>
      <span>{{ inSet.length }} transcribed · {{ inSet.filter(c => verified.has(c.id)).length }} verified · {{ invalidCards.length }} invalid · {{ missing.length }} not yet transcribed</span>
    </header>
    <div class="filters">
      <label><input v-model="filter" type="radio" value="unverified" /> Unverified</label>
      <label><input v-model="filter" type="radio" value="review" /> Needs review</label>
      <label><input v-model="filter" type="radio" value="all" /> All</label>
      <input v-model="query" placeholder="Search name, id or text" />
      <button @click="download">Download this set's cards.json with verified flags</button>
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
