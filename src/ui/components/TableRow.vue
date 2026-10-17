<script setup lang="ts">
import { computed } from 'vue'
import { def, type Action, type GameState, type PlayerId } from '../../engine'
import { db } from '../cardDb'
import CardView from './CardView.vue'

// The cards a player has in play: Dragon Balls, placed Non-Combat cards, drills, allies.
const props = defineProps<{ state: GameState; p: PlayerId; legal: Action[]; theirs?: boolean }>()
const emit = defineEmits<{ act: [Action] }>()

const pl = computed(() => props.state.players[props.p])
function actionFor(iid: string): Action | undefined {
  return props.legal.find(a => 'iid' in a && a.iid === iid)
}
function click(iid: string) {
  const a = actionFor(iid)
  if (a) emit('act', a)
}
const empty = computed(() => !pl.value.dragonBalls.length && !pl.value.nonCombat.length && !pl.value.drills.length && !pl.value.allies.length)
</script>

<template>
  <div class="table-row" :class="{ theirs }">
    <div v-if="pl.dragonBalls.length" class="zone db">
      <h4>Dragon Balls</h4>
      <div class="row"><CardView v-for="c in pl.dragonBalls" :key="c.iid" :card="def(db, c)" size="table" :playable="!!actionFor(c.iid)" @click="click(c.iid)" /></div>
    </div>
    <div v-if="pl.allies.length" class="zone">
      <h4>Allies</h4>
      <div class="row"><CardView v-for="a in pl.allies" :key="a.card.iid" :card="def(db, a.card)" size="table" :tag="`Stage ${a.stage}`" :playable="!!actionFor(a.card.iid)" @click="click(a.card.iid)" /></div>
    </div>
    <div v-if="pl.drills.length" class="zone">
      <h4>Drills</h4>
      <div class="row"><CardView v-for="c in pl.drills" :key="c.iid" :card="def(db, c)" size="table" :playable="!!actionFor(c.iid)" @click="click(c.iid)" /></div>
    </div>
    <div v-if="pl.nonCombat.length" class="zone">
      <h4>Non-Combat</h4>
      <div class="row"><CardView v-for="c in pl.nonCombat" :key="c.iid" :card="def(db, c)" size="table" :playable="!!actionFor(c.iid)" @click="click(c.iid)" /></div>
    </div>
    <p v-if="empty" class="empty-zone">{{ theirs ? 'Opponent has' : 'You have' }} no cards in play</p>
  </div>
</template>
