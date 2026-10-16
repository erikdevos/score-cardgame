<script setup lang="ts">
import { computed } from 'vue'
import { def, type Action, type GameState, type PlayerId } from '../../engine'
import { db } from '../cardDb'

const props = defineProps<{ state: GameState; legal: Action[]; actor: PlayerId | null; myTurn: boolean }>()
const emit = defineEmits<{ act: [Action] }>()

const LABELS: Record<string, string> = {
  END_NON_COMBAT: 'End Non-Combat step (power up)',
  DECLARE_COMBAT: 'Declare combat',
  SKIP_COMBAT: 'Pass (no combat)',
  USE_POWER: 'Use MP power',
  PASS: 'Pass',
}

const buttons = computed(() =>
  props.legal.flatMap(a => {
    if (a.type in LABELS) return [{ a, label: LABELS[a.type] }]
    if (a.type === 'DEFEND' && !a.iid) return [{ a, label: 'Take the hit' }]
    if (a.type === 'STEAL_DB' && !a.iid) return [{ a, label: "Don't capture" }]
    if (a.type === 'REJUVENATE') return [{ a, label: a.accept ? 'Rejuvenate 1 card' : 'Skip rejuvenation' }]
    return []
  }),
)

const prompt = computed(() => {
  const s = props.state
  if (s.winner !== null) return `Player ${s.winner + 1} wins (${s.winReason?.replace('_', ' ').toLowerCase()} victory)`
  const who = `Player ${props.actor! + 1}`
  const pc = s.pendingChoice
  if (pc?.kind === 'DEFEND') return `${who}: defend against ${s.combat?.strike?.label} with a highlighted card, or take the hit`
  if (pc?.kind === 'DB_STEAL') return `${who}: click an opponent's Dragon Ball to capture it`
  if (pc?.kind === 'DISCARD_TO_LIMIT') return `${who}: discard down to ${pc.limit} card(s)`
  if (pc?.kind === 'REJUVENATE') return `${who}: rejuvenate the top card of your discard pile?`
  switch (s.step) {
    case 'NON_COMBAT': return `${who}: Non-Combat step. Place non-combat cards, play drills, allies or Dragon Balls, or use a placed card`
    case 'DECLARE': return `${who}: declare combat?`
    case 'COMBAT': return `${who}: attack phase. Play an attack, use a placed non-combat card, or pass`
    default: return ''
  }
})

const strike = computed(() => (props.state.winner === null ? props.state.combat?.strike : null))
</script>

<template>
  <div class="actionbar">
    <div class="status">
      <span class="turn">Turn {{ state.turn }} · {{ state.step.replace('_', '-').toLowerCase() }}</span>
      <span>{{ prompt }}</span>
    </div>
    <div v-if="strike" class="strike">
      In flight: <b>{{ strike.label }}</b>
      <template v-if="strike.card"> ({{ def(db, strike.card).rawText || def(db, strike.card).type }})</template>
    </div>
    <div class="buttons">
      <button v-for="b in buttons" :key="JSON.stringify(b.a)" :disabled="!myTurn" @click="emit('act', b.a)">{{ b.label }}</button>
      <span v-if="!myTurn && state.winner === null" class="thinking">Opponent is thinking...</span>
    </div>
  </div>
</template>
