<script setup lang="ts">
import { computed, ref } from 'vue'
import { defaultRulesConfig, validateDeck } from '../engine'
import { db, realCards } from './cardDb'
import { deckChoices } from './decks'
import { settings } from './settings'
import { useGame, type Mode } from './useGame'
import CardReview from './components/CardReview.vue'
import CardView from './components/CardView.vue'
import GameBoard from './components/GameBoard.vue'

const game = useGame()
const screen = ref<'menu' | 'game' | 'review'>('menu')
const choices = computed(() => deckChoices())
const pick = (k: string, fallback: number) => (choices.value.some(c => c.key === k) ? k : choices.value[fallback].key)
const deck1 = ref(pick('auto-Goku', 0))
const deck2 = ref(pick('auto-Vegeta', 1))
const seed = ref('')
const warnings = ref<string[]>([])
const find = (k: string) => choices.value.find(c => c.key === k)!

function start(mode: Mode) {
  const s = seed.value ? Number(seed.value) : Date.now()
  const decks = [find(deck1.value).build(s), find(deck2.value).build(s + 1)] as const
  // Test decks use fictional cards and ignore copy limits; decks of real cards must be legal.
  const keys = [deck1.value, deck2.value]
  warnings.value = decks.flatMap((d, i) => (keys[i].startsWith('demo') ? [] : validateDeck(db, d, defaultRulesConfig()).map(e => `Player ${i + 1}: ${e}`)))
  if (warnings.value.length) return
  game.start([decks[0], decks[1]], mode, s)
  screen.value = 'game'
}
</script>

<template>
  <GameBoard v-if="screen === 'game' && game.state.value" :game="game" @quit="game.quit(); screen = 'menu'" />
  <CardReview v-else-if="screen === 'review'" @back="screen = 'menu'" />
  <main v-else class="menu">
    <header class="hero-title">
      <h1>Dragon Ball Z <span>CCG</span></h1>
      <p>Saiyan Saga · Score Entertainment, 2000</p>
    </header>

    <div class="matchup">
      <label v-for="(d, i) in [deck1, deck2]" :key="i" class="pick">
        <span class="eyebrow">Player {{ i + 1 }}{{ i === 1 ? ' / AI' : '' }}</span>
        <CardView :card="db[find(d).mpId]" size="lg" />
        <select :value="d" @change="(e) => (i === 0 ? (deck1 = (e.target as HTMLSelectElement).value) : (deck2 = (e.target as HTMLSelectElement).value))">
          <option v-for="c in choices" :key="c.key" :value="c.key">{{ c.label }}</option>
        </select>
      </label>
      <span class="vs" aria-hidden="true">VS</span>
    </div>

    <div class="buttons center">
      <button class="primary big" @click="start('ai')">Play vs AI</button>
      <button class="big" @click="start('hotseat')">Hotseat (2 players)</button>
      <button class="ghost" @click="screen = 'review'">Card review</button>
    </div>
    <ul v-if="warnings.length" class="warn"><li v-for="w in warnings" :key="w">{{ w }}</li></ul>

    <details class="settings">
      <summary>Settings</summary>
      <label>Rules
        <select v-model="settings.rulesMode">
          <option value="PURE_2000">Pure 2000 Saiyan Saga</option>
          <option value="CRD_3">CRD 3.0 (rejuvenation step)</option>
        </select>
      </label>
      <label>AI speed <input v-model.number="settings.aiDelayMs" type="range" min="0" max="2000" step="100" /> {{ settings.aiDelayMs }} ms</label>
      <label><input v-model="settings.hideHandsHotseat" type="checkbox" /> Hide hands between players in hotseat</label>
      <label>Seed <input v-model="seed" inputmode="numeric" placeholder="random" /></label>
    </details>

    <p class="hint small">
      Decks are built automatically from the {{ realCards.length }} transcribed cards (not yet verified).
      Card effects the engine cannot run yet are skipped and noted in the log.
    </p>
  </main>
</template>
