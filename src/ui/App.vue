<script setup lang="ts">
import { computed, ref } from 'vue'
import { defaultRulesConfig, validateDeck } from '../engine'
import { db, realCards } from './cardDb'
import { deckChoices } from './decks'
import { settings } from './settings'
import { useGame, type Mode } from './useGame'
import CardReview from './components/CardReview.vue'
import GameBoard from './components/GameBoard.vue'

const game = useGame()
const screen = ref<'menu' | 'game' | 'review'>('menu')
const choices = computed(() => deckChoices())
const deck1 = ref('demo-hero')
const deck2 = ref('demo-villain')
const seed = ref('')
const warnings = ref<string[]>([])

function start(mode: Mode) {
  const s = seed.value ? Number(seed.value) : Date.now()
  const find = (k: string) => choices.value.find(c => c.key === k)!
  const decks = [find(deck1.value).build(s), find(deck2.value).build(s + 1)] as const
  // Demo decks use fictional cards and ignore copy limits; decks of real cards must be legal.
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
    <h1>Dragon Ball Z CCG <small>Saiyan Saga</small></h1>
    <p class="hint">
      Rules engine for the 2000 Score card game. {{ realCards.length }} real cards transcribed (not yet verified).
      Auto decks use real cards; card effects that the engine cannot run yet are skipped and noted in the log.
    </p>
    <div class="decks">
      <label>Player 1 deck
        <select v-model="deck1"><option v-for="c in choices" :key="c.key" :value="c.key">{{ c.label }}</option></select>
      </label>
      <label>Player 2 deck
        <select v-model="deck2"><option v-for="c in choices" :key="c.key" :value="c.key">{{ c.label }}</option></select>
      </label>
    </div>
    <div class="buttons">
      <button class="primary" @click="start('ai')">Play vs AI</button>
      <button @click="start('hotseat')">Hotseat (2 players)</button>
      <button @click="screen = 'review'">Card review</button>
    </div>
    <fieldset class="settings">
      <legend>Settings</legend>
      <label>Rules
        <select v-model="settings.rulesMode">
          <option value="PURE_2000">Pure 2000 Saiyan Saga</option>
          <option value="CRD_3">CRD 3.0 (rejuvenation step)</option>
        </select>
      </label>
      <label>AI speed <input v-model.number="settings.aiDelayMs" type="range" min="0" max="2000" step="100" /> {{ settings.aiDelayMs }} ms</label>
      <label><input v-model="settings.hideHandsHotseat" type="checkbox" /> Hide hands between players in hotseat</label>
      <label>Seed (optional) <input v-model="seed" inputmode="numeric" placeholder="random" /></label>
    </fieldset>
    <ul v-if="warnings.length" class="warn"><li v-for="w in warnings" :key="w">{{ w }}</li></ul>
  </main>
</template>
