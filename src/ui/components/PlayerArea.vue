<script setup lang="ts">
import { computed } from 'vue'
import { def, handLimit, mpDef, type Action, type GameState, type PlayerId } from '../../engine'
import { db } from '../cardDb'
import CardView from './CardView.vue'

const props = defineProps<{ state: GameState; p: PlayerId; showHand: boolean; legal: Action[]; top?: boolean }>()
const emit = defineEmits<{ act: [Action] }>()

const pl = computed(() => props.state.players[props.p])
const mp = computed(() => mpDef(props.state, db, props.p))
const ratings = computed(() => mp.value.personality!.powerRatings)

/** The legal action, if any, that a click on this card instance performs. */
function actionFor(iid: string): Action | undefined {
  return props.legal.find(a => 'iid' in a && a.iid === iid)
}
function click(iid: string) {
  const a = actionFor(iid)
  if (a) emit('act', a)
}
const topDiscard = computed(() => pl.value.discard.at(-1))
</script>

<template>
  <section class="player" :class="{ top, active: state.attacker === p }">
    <div class="mp">
      <CardView :card="mp" />
      <div class="track" aria-label="Power stages">
        <div v-for="i in 11" :key="i" class="stage" :class="{ on: pl.mp.stage === 11 - i }">
          <span>{{ 11 - i }}</span><span>{{ ratings[11 - i].toLocaleString() }}</span>
        </div>
      </div>
      <div class="stats">
        <h3>Player {{ p + 1 }} <small v-if="state.attacker === p">attacker</small></h3>
        <p>{{ mp.personality!.character }} · Level {{ pl.mp.levelIndex + 1 }}/{{ pl.mp.stack.length }}</p>
        <p>PUR {{ mp.personality!.pur }} · {{ mp.personality!.alignment }}</p>
        <div class="anger" aria-label="Anger">
          Anger
          <span v-for="i in state.rules.maxAnger" :key="i" class="pip" :class="{ on: pl.mp.anger >= i }" />
        </div>
        <p class="piles">
          Life deck <b>{{ pl.lifeDeck.length }}</b> · Hand <b>{{ pl.hand.length }}</b> (limit {{ handLimit(state, db, p) }})
          · Discard <b>{{ pl.discard.length }}</b> · Removed <b>{{ pl.removed.length }}</b>
        </p>
        <p v-if="mp.personality!.power" class="power"><b>{{ mp.personality!.power.name }}:</b> {{ mp.personality!.power.text }}</p>
      </div>
      <div class="pile">
        <CardView v-if="topDiscard" :card="def(db, topDiscard)" small />
        <CardView v-else face-down small label="Discard" />
      </div>
    </div>

    <div class="table">
      <div v-if="pl.dragonBalls.length" class="zone">
        <h4>Dragon Balls</h4>
        <CardView v-for="c in pl.dragonBalls" :key="c.iid" :card="def(db, c)" small :playable="!!actionFor(c.iid)" @click="click(c.iid)" />
      </div>
      <div v-if="pl.nonCombat.length" class="zone">
        <h4>Non-Combat (unused)</h4>
        <CardView v-for="c in pl.nonCombat" :key="c.iid" :card="def(db, c)" small :playable="!!actionFor(c.iid)" @click="click(c.iid)" />
      </div>
      <div v-if="pl.drills.length" class="zone">
        <h4>Drills</h4>
        <CardView v-for="c in pl.drills" :key="c.iid" :card="def(db, c)" small />
      </div>
      <div v-if="pl.allies.length" class="zone">
        <h4>Allies</h4>
        <div v-for="a in pl.allies" :key="a.card.iid" class="ally">
          <CardView :card="def(db, a.card)" small />
          <span>stage {{ a.stage }}</span>
        </div>
      </div>
    </div>

    <div class="hand">
      <template v-if="showHand">
        <CardView v-for="c in pl.hand" :key="c.iid" :card="def(db, c)" :playable="!!actionFor(c.iid)" @click="click(c.iid)" />
      </template>
      <template v-else>
        <CardView v-for="c in pl.hand" :key="c.iid" face-down small />
      </template>
    </div>
  </section>
</template>
