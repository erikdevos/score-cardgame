<script setup lang="ts">
import { computed } from 'vue'
import { def, handLimit, handRevealed, isDefenseRole, mpDef, type Action, type GameState, type PlayerId } from '../../engine'
import { db } from '../cardDb'
import { showToast } from '../toast'
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
  if (a) return emit('act', a)
  if (props.mine) showToast(whyNot(iid))
}

/** Why a card in hand cannot be played right now. */
function whyNot(iid: string): string {
  const s = props.state
  const d = def(db, pl.value.hand.find(c => c.iid === iid)!)
  const combat = ['Physical Combat', 'Energy Combat', 'Combat'].includes(d.type)
  if (!props.legal.length) return 'Wait for your turn.'
  if (s.pendingChoice?.kind === 'DEFEND') return 'Block with a highlighted card, or take the hit.'
  if (s.pendingChoice) return 'Finish the choice in the middle of the board first.'
  if (s.step === 'NON_COMBAT' && combat) return `${d.name} is a combat card: power up, declare combat, then play it in your attack phase.`
  if (s.step === 'DECLARE') return 'Declare combat (or skip it) first.'
  if (s.step === 'COMBAT' && !combat) return `${d.name} is placed in the Non-Combat step, not during combat.`
  if (s.step === 'COMBAT' && (isDefenseRole(d.combatRole) || d.usePhase === 'DEFEND')) return `${d.name} is a block: you can play it when your opponent attacks you.`
  if (s.step === 'COMBAT' && d.combatRole === 'ATTACK_ENERGY') return `${d.name} needs power stages to pay for the energy attack, or energy attacks are blocked this phase.`
  return `${d.name} can't be played right now (cost, timing or a card restriction).`
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
      <CardView :card="mp" :size="mine ? 'mp' : 'opp'" />
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
      <div class="hand" :class="{ crowded: pl.hand.length > 6, discarding: state.pendingChoice?.kind === 'DISCARD_TO_LIMIT' && state.pendingChoice.player === p }">
        <!-- the slot is the click target and stays put; only the card inside lifts on hover -->
        <div v-for="(c, i) in pl.hand" :key="c.iid" class="hand-slot" :class="{ ready: !!actionFor(c.iid) }" :style="fan(i)" @click="click(c.iid)">
          <CardView :card="def(db, c)" size="hand" role :playable="!!actionFor(c.iid)" />
        </div>
        <p v-if="!pl.hand.length" class="empty-zone">No cards in hand</p>
      </div>
    </div>
    <div v-else class="opp-hand" :aria-label="`${pl.hand.length} cards in hand`">
      <div class="opp-fan">
        <template v-if="revealed">
          <CardView v-for="c in pl.hand" :key="c.iid" :card="def(db, c)" size="sm" role />
        </template>
        <template v-else>
          <CardView v-for="c in pl.hand" :key="c.iid" face-down size="opp" label="" />
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
