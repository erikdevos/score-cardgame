<script setup lang="ts">
import { computed } from 'vue'
import { def, handLimit, handRevealed, mpDef, type Action, type GameState, type PlayerId } from '../../engine'
import { db } from '../cardDb'
import CardView from './CardView.vue'
import ScouterMeter from './ScouterMeter.vue'

// A player's own corner: main personality, power, anger, piles and hand.
const props = defineProps<{ state: GameState; p: PlayerId; legal: Action[]; mine: boolean; acting: boolean }>()
const emit = defineEmits<{ act: [Action] }>()

const pl = computed(() => props.state.players[props.p])
const mp = computed(() => mpDef(props.state, db, props.p))
const per = computed(() => mp.value.personality!)
const revealed = computed(() => !props.mine && handRevealed(props.state, db, props.p))
const topDiscard = computed(() => pl.value.discard.at(-1))

function actionFor(iid: string): Action | undefined {
  return props.legal.find(a => 'iid' in a && a.iid === iid)
}
function click(iid: string) {
  const a = actionFor(iid)
  if (a) emit('act', a)
}

/** Fan the hand: a slight rotation and drop towards the edges. */
function fan(i: number) {
  const n = pl.value.hand.length
  const off = i - (n - 1) / 2
  const spread = n > 6 ? 2.5 : 4
  return { transform: `rotate(${off * spread}deg) translateY(${off * off * 1.1}px)`, zIndex: i }
}
</script>

<template>
  <section class="dock" :class="[mine ? 'mine' : 'theirs', per.alignment === 'Villain' ? 'villain' : 'hero', { acting, attacker: state.attacker === p }]">
    <div class="identity">
      <CardView :card="mp" :size="mine ? 'mp' : 'table'" />
      <div class="id-info">
        <div class="id-name">
          <span class="badge">P{{ p + 1 }}</span>
          <h3>{{ per.character }}</h3>
        </div>
        <div class="chips">
          <span class="chip" :class="per.alignment === 'Villain' ? 'villain' : 'hero'">{{ per.alignment }}</span>
          <span class="chip">Lv {{ pl.mp.levelIndex + 1 }}/{{ pl.mp.stack.length }}</span>
          <span class="chip">PUR {{ per.pur }}</span>
          <span v-if="state.attacker === p" class="chip attack">Attacker</span>
        </div>
        <ScouterMeter :ratings="per.powerRatings" :stage="pl.mp.stage" :compact="!mine" />
        <div class="anger" :aria-label="`Anger ${pl.mp.anger} of ${state.rules.maxAnger}`">
          <span class="lbl">Anger</span>
          <span v-for="i in state.rules.maxAnger" :key="i" class="flame" :class="{ on: pl.mp.anger >= i }" />
        </div>
        <p v-if="mine && per.power" class="power"><b>{{ per.power.name }}</b> {{ per.power.text }}</p>
      </div>
    </div>

    <div v-if="mine" class="hand-area">
      <div class="hand-head">
        <span>Hand <b>{{ pl.hand.length }}</b></span>
        <span class="muted">keep {{ handLimit(state, db, p) }} at end of turn</span>
      </div>
      <div class="hand" :class="{ crowded: pl.hand.length > 6 }">
        <div v-for="(c, i) in pl.hand" :key="c.iid" class="hand-slot" :style="fan(i)">
          <CardView :card="def(db, c)" size="hand" :playable="!!actionFor(c.iid)" @click="click(c.iid)" />
        </div>
        <p v-if="!pl.hand.length" class="empty-zone">No cards in hand</p>
      </div>
    </div>
    <div v-else class="opp-hand" :aria-label="`${pl.hand.length} cards in hand`">
      <div class="opp-fan">
        <template v-if="revealed">
          <CardView v-for="c in pl.hand" :key="c.iid" :card="def(db, c)" size="sm" />
        </template>
        <template v-else>
          <CardView v-for="c in pl.hand" :key="c.iid" face-down size="table" label="" />
        </template>
      </div>
      <span class="muted">{{ pl.hand.length }} in hand{{ revealed ? ' (revealed)' : '' }}</span>
    </div>

    <div class="piles">
      <div class="pile">
        <CardView face-down size="sm" label="Life" :count="pl.lifeDeck.length" />
        <span>Life deck</span>
      </div>
      <div class="pile">
        <CardView v-if="topDiscard" :card="def(db, topDiscard)" size="sm" :count="pl.discard.length" />
        <div v-else class="slot">Empty</div>
        <span>Discard</span>
      </div>
      <span v-if="pl.removed.length" class="muted small">{{ pl.removed.length }} removed</span>
    </div>
  </section>
</template>
