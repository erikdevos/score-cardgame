<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { defaultRulesConfig, validateDeck } from '../engine'
import { db, realCards } from './cardDb'
import { deckChoices } from './decks'
import { FORMATS, formatCards, formatReady, unverifiedIn, type FormatKey } from './formats'
import { settings } from './settings'
import { useGame, type Mode } from './useGame'
import CardReview from './components/CardReview.vue'
import CardView from './components/CardView.vue'
import GameBoard from './components/GameBoard.vue'

const game = useGame()
const screen = ref<'menu' | 'game' | 'review'>('menu')
if (!formatReady(settings.format)) settings.format = 'SAIYAN'
const choices = computed(() => deckChoices(settings.format))
const formatKeys = Object.keys(FORMATS) as FormatKey[]
const pick = (k: string, fallback: number) => (choices.value.some(c => c.key === k) ? k : choices.value[fallback].key)
const decks = ref([pick('auto-Goku', 0), pick('auto-Vegeta', 1)])
const seed = ref('')
const warnings = ref<string[]>([])
const showSettings = ref(false)
const find = (k: string) => choices.value.find(c => c.key === k)!
// switching format: keep each player's character when it exists in the new pool
watch(choices, () => { decks.value = [pick(decks.value[0], 0), pick(decks.value[1], 1)] })
const mpOf = (k: string) => db[find(k).mpId]

function start(mode: Mode) {
  const s = seed.value ? Number(seed.value) : Date.now()
  const lists = [find(decks.value[0]).build(s), find(decks.value[1]).build(s + 1)] as const
  // Test decks use fictional cards and ignore copy limits; decks of real cards must be legal.
  warnings.value = lists.flatMap((d, i) => (decks.value[i].startsWith('demo') ? [] : validateDeck(db, d, { ...defaultRulesConfig(), ...FORMATS[settings.format].rules }).map(e => `Player ${i + 1}: ${e}`)))
  if (warnings.value.length) return
  game.start([lists[0], lists[1]], mode, s, FORMATS[settings.format].rules)
  screen.value = 'game'
}
</script>

<template>
  <GameBoard v-if="screen === 'game' && game.state.value" :game="game" @quit="game.quit(); screen = 'menu'" />
  <CardReview v-else-if="screen === 'review'" @back="screen = 'menu'" />
  <main v-else class="menu">
    <header class="logo">
      <span class="logo-ball" aria-hidden="true"><i>&#9733;</i><i>&#9733;</i><i>&#9733;</i><i>&#9733;</i></span>
      <h1><span class="l1">Dragon Ball</span><span class="l2">Z</span></h1>
      <p class="logo-sub">Collectible Card Game · Saiyan Saga</p>
    </header>

    <div class="format-pick" role="radiogroup" aria-label="Card pool">
      <span class="eyebrow">Card pool</span>
      <div class="segmented">
        <button
          v-for="f in formatKeys"
          :key="f"
          role="radio"
          :aria-checked="settings.format === f"
          :class="{ on: settings.format === f }"
          :disabled="!formatReady(f)"
          @click="settings.format = f"
        >
          {{ FORMATS[f].label }}
          <small>{{ formatReady(f) ? `${formatCards(f).length} cards` : 'coming soon' }}</small>
        </button>
      </div>
      <span v-if="formatReady(settings.format) && unverifiedIn(settings.format)" class="muted small">{{ unverifiedIn(settings.format) }} cards not verified yet: text and effects may still contain mistakes</span>
    </div>

    <section class="select">
      <article v-for="(k, i) in decks" :key="i" class="fighter" :class="mpOf(k).personality?.alignment === 'Villain' ? 'villain' : 'hero'">
        <span class="eyebrow">Player {{ i + 1 }}{{ i === 1 ? ' · AI in solo play' : '' }}</span>
        <div class="fighter-main">
          <CardView :card="mpOf(k)" size="lg" />
          <div class="fighter-info">
            <h2>{{ find(k).label.replace(/ \(.*\)$/, '') }}</h2>
            <span class="chip" :class="mpOf(k).personality?.alignment === 'Villain' ? 'villain' : 'hero'">{{ mpOf(k).personality?.alignment }}</span>
            <p v-if="mpOf(k).personality?.power" class="muted small"><b>{{ mpOf(k).personality!.power!.name }}</b></p>
          </div>
        </div>
        <div class="roster" role="radiogroup" :aria-label="`Player ${i + 1} character`">
          <button
            v-for="c in choices"
            :key="c.key"
            class="portrait"
            :class="{ on: c.key === k, test: c.key.startsWith('demo') }"
            role="radio"
            :aria-checked="c.key === k"
            :title="c.label"
            @click="decks[i] = c.key"
          >
            <img v-if="db[c.mpId]?.imageUrl" :src="db[c.mpId].imageUrl" :alt="c.label" loading="lazy" />
            <span v-else class="portrait-text">Test</span>
            <span class="portrait-name">{{ c.label.replace(/^Test deck: /, '').replace(/ \(.*\)$/, '') }}</span>
          </button>
        </div>
      </article>
      <span class="vs-burst" aria-hidden="true">VS</span>
    </section>

    <div class="menu-actions">
      <button class="btn primary huge" @click="start('ai')">Fight the AI</button>
      <button class="btn huge" @click="start('hotseat')">Hotseat duel</button>
    </div>
    <ul v-if="warnings.length" class="warn"><li v-for="w in warnings" :key="w">{{ w }}</li></ul>

    <nav class="menu-links">
      <button class="link-btn" @click="showSettings = !showSettings">Settings</button>
      <button class="link-btn" @click="screen = 'review'">Card review</button>
    </nav>

    <section v-if="showSettings" class="settings panel">
      <label>Rules
        <select v-model="settings.rulesMode">
          <option value="PURE_2000">Pure 2000 Saiyan Saga</option>
          <option value="CRD_3">CRD 3.0 (rejuvenation step)</option>
        </select>
      </label>
      <label>AI speed <input v-model.number="settings.aiDelayMs" type="range" min="0" max="2000" step="100" /> <span class="muted">{{ settings.aiDelayMs }} ms</span></label>
      <label><input v-model="settings.hideHandsHotseat" type="checkbox" /> Hide hands between players in hotseat</label>
      <label>Seed <input v-model="seed" inputmode="numeric" placeholder="random" /></label>
    </section>

    <p class="foot muted small">{{ realCards.length }} cards transcribed. Decks are built automatically per character from the chosen card pool.</p>
  </main>
</template>
