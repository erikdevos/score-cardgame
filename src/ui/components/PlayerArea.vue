<script setup lang="ts">
import { computed } from 'vue'
import { def, handLimit, handRevealed, mpDef, type Action, type GameState, type PlayerId } from '../../engine'
import { db } from '../cardDb'
import CardView from './CardView.vue'

const props = defineProps<{ state: GameState; p: PlayerId; showHand: boolean; legal: Action[]; top?: boolean; acting?: boolean }>()
const emit = defineEmits<{ act: [Action] }>()

const pl = computed(() => props.state.players[props.p])
const mp = computed(() => mpDef(props.state, db, props.p))
const per = computed(() => mp.value.personality!)
const stages = computed(() => Array.from({ length: props.state.rules.maxStage + 1 }, (_, i) => props.state.rules.maxStage - i))

/** The legal action, if any, that a click on this card instance performs. */
function actionFor(iid: string): Action | undefined {
  return props.legal.find(a => 'iid' in a && a.iid === iid)
}
function click(iid: string) {
  const a = actionFor(iid)
  if (a) emit('act', a)
}
const topDiscard = computed(() => pl.value.discard.at(-1))
const hasTable = computed(() => pl.value.dragonBalls.length + pl.value.nonCombat.length + pl.value.drills.length + pl.value.allies.length > 0)
</script>

<template>
  <section class="player" :class="[per.alignment === 'Villain' ? 'villain' : 'hero', { top, attacker: state.attacker === p, acting }]">
    <div class="hud">
      <div class="who">
        <span class="badge">P{{ p + 1 }}</span>
        <div>
          <h3>{{ per.character }} <small>Level {{ pl.mp.levelIndex + 1 }}/{{ pl.mp.stack.length }}</small></h3>
          <p class="sub">
            <span :class="per.alignment === 'Villain' ? 'tag villain' : 'tag hero'">{{ per.alignment }}</span>
            <span class="tag">PUR {{ per.pur }}</span>
            <span v-if="state.attacker === p" class="tag attack">Attacker</span>
          </p>
        </div>
      </div>
      <div class="anger" :aria-label="`Anger ${pl.mp.anger} of ${state.rules.maxAnger}`">
        <span class="lbl">Anger</span>
        <span v-for="i in state.rules.maxAnger" :key="i" class="pip" :class="{ on: pl.mp.anger >= i }" />
      </div>
      <div v-if="!showHand" class="opp-hand" :aria-label="`${pl.hand.length} cards in hand`">
        <template v-if="handRevealed(state, db, p)">
          <CardView v-for="c in pl.hand" :key="c.iid" :card="def(db, c)" size="sm" />
        </template>
        <template v-else>
          <CardView v-for="c in pl.hand" :key="c.iid" face-down size="xs" label="" />
        </template>
        <span class="muted">{{ pl.hand.length }} in hand</span>
      </div>
    </div>

    <div class="field">
      <div class="mp-col">
        <CardView :card="mp" :size="top ? 'md' : 'lg'" />
        <p v-if="per.power && !top" class="power"><b>{{ per.power.name }}</b> {{ per.power.text }}</p>
      </div>

      <ol class="meter" aria-label="Power stages">
        <li v-for="i in stages" :key="i" :class="{ on: pl.mp.stage === i, below: pl.mp.stage > i, zero: i === 0 }">
          <span class="n">{{ i }}</span><span class="r">{{ per.powerRatings[i].toLocaleString() }}</span>
        </li>
      </ol>

      <div class="table">
        <div v-if="pl.dragonBalls.length" class="zone">
          <h4>Dragon Balls</h4>
          <div class="row"><CardView v-for="c in pl.dragonBalls" :key="c.iid" :card="def(db, c)" size="sm" :playable="!!actionFor(c.iid)" @click="click(c.iid)" /></div>
        </div>
        <div v-if="pl.nonCombat.length" class="zone">
          <h4>Non-Combat (ready)</h4>
          <div class="row"><CardView v-for="c in pl.nonCombat" :key="c.iid" :card="def(db, c)" size="sm" :playable="!!actionFor(c.iid)" @click="click(c.iid)" /></div>
        </div>
        <div v-if="pl.drills.length" class="zone">
          <h4>Drills</h4>
          <div class="row"><CardView v-for="c in pl.drills" :key="c.iid" :card="def(db, c)" size="sm" /></div>
        </div>
        <div v-if="pl.allies.length" class="zone">
          <h4>Allies</h4>
          <div class="row">
            <div v-for="a in pl.allies" :key="a.card.iid" class="ally">
              <CardView :card="def(db, a.card)" size="sm" />
              <span>stage {{ a.stage }}</span>
            </div>
          </div>
        </div>
        <p v-if="!hasTable" class="empty-zone">No cards in play</p>
        <div class="piles">
          <div class="pile">
            <CardView face-down size="sm" label="Life" :count="pl.lifeDeck.length" />
            <span>Life deck</span>
          </div>
          <div class="pile">
            <CardView v-if="topDiscard" :card="def(db, topDiscard)" size="sm" :count="pl.discard.length" />
            <div v-else class="slot">empty</div>
            <span>Discard</span>
          </div>
          <p class="muted small">Removed {{ pl.removed.length }}</p>
        </div>
      </div>

    </div>

    <div v-if="showHand" class="hand-wrap">
      <h4>Your hand <small>{{ pl.hand.length }} cards · keep {{ handLimit(state, db, p) }} at end of turn</small></h4>
      <div class="hand">
        <CardView v-for="c in pl.hand" :key="c.iid" :card="def(db, c)" size="md" :playable="!!actionFor(c.iid)" @click="click(c.iid)" />
        <p v-if="!pl.hand.length" class="empty-zone">Empty hand</p>
      </div>
    </div>
  </section>
</template>
