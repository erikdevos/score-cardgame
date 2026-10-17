<script setup lang="ts">
import { computed } from 'vue'
import { def, mpDef, type Action, type CardInstance, type GameState, type PlayerId, type Step } from '../../engine'
import { db } from '../cardDb'
import CardView from './CardView.vue'

const props = defineProps<{ state: GameState; legal: Action[]; actor: PlayerId | null; myTurn: boolean }>()
const emit = defineEmits<{ act: [Action] }>()

const LABELS: Record<string, string> = {
  END_NON_COMBAT: 'Power up and continue',
  DECLARE_COMBAT: 'Declare combat',
  SKIP_COMBAT: 'Skip combat',
  USE_POWER: 'Use MP power',
  COPY_ATTACK: 'Copy the attack you defended',
  PASS: 'Pass',
}
const PRIMARY = new Set(['END_NON_COMBAT', 'DECLARE_COMBAT'])

const buttons = computed(() =>
  props.legal.flatMap(a => {
    if (a.type in LABELS) return [{ a, label: LABELS[a.type], primary: PRIMARY.has(a.type) }]
    if (a.type === 'DEFEND' && !a.iid) return [{ a, label: 'Take the hit', primary: false }]
    if (a.type === 'DEFEND_POWER') return [{ a, label: `Block with power: ${mpDef(props.state, db, a.player).personality!.power!.name}`, primary: true }]
    if (a.type === 'CONFIRM') return [{ a, label: a.accept ? 'Yes' : 'No', primary: a.accept }]
    if (a.type === 'CHOOSE' && props.state.pendingChoice?.kind === 'OPTION') return [{ a, label: props.state.pendingChoice.options[a.index], primary: false }]
    if (a.type === 'RESPOND' && !a.iid) {
      const w = props.state.pendingChoice?.kind === 'WINDOW' ? props.state.pendingChoice.window : null
      return [{ a, label: w === 'REACT' ? 'No reaction' : 'End the turn', primary: false }]
    }
    if (a.type === 'STEAL_DB' && !a.iid) return [{ a, label: "Don't capture", primary: false }]
    if (a.type === 'REJUVENATE') return [{ a, label: a.accept ? 'Rejuvenate 1 card' : 'Skip rejuvenation', primary: a.accept }]
    return []
  }),
)

const STEPS: { key: Step[]; label: string }[] = [
  { key: ['NON_COMBAT'], label: 'Non-Combat' },
  { key: ['DECLARE'], label: 'Declare' },
  { key: ['COMBAT'], label: 'Combat' },
  { key: ['DISCARD', 'REJUVENATE'], label: 'Discard' },
]

const prompt = computed(() => {
  const s = props.state
  if (s.winner !== null) return ''
  const who = `Player ${props.actor! + 1}`
  const pc = s.pendingChoice
  if (pc?.kind === 'DEFEND') return `${who}: block with a highlighted card, or take the hit`
  if (pc?.kind === 'DB_STEAL') return `${who}: click an opponent's Dragon Ball to capture it`
  if (pc?.kind === 'DISCARD_TO_LIMIT') return `${who}: discard down to ${pc.limit} card(s)`
  if (pc?.kind === 'PICK') return `${who}: ${pc.source}, choose ${pc.count} card(s)`
  if (pc?.kind === 'CONFIRM') return `${who}: ${pc.prompt}`
  if (pc?.kind === 'OPTION') return `${who}: ${pc.prompt}`
  if (pc?.kind === 'WINDOW' && pc.window === 'REACT') return `${who}: react to the energy cost with a highlighted card?`
  if (pc?.kind === 'WINDOW') return `${who}: end of turn. Use a highlighted card?`
  if (pc?.kind === 'REJUVENATE') return `${who}: put the top card of your discard pile back under your life deck?`
  switch (s.step) {
    case 'NON_COMBAT': return `${who}: play drills, allies, Dragon Balls or non-combat cards (highlighted)`
    case 'DECLARE': return `${who}: declare combat?`
    case 'COMBAT': return `${who}: attack with a highlighted card, use your power, or pass`
    default: return ''
  }
})

/** Cards to choose from for a PICK choice (discard pile, Dragon Balls or life deck). */
const pickCards = computed<{ card: CardInstance; a: Action }[]>(() => {
  const pc = props.state.pendingChoice
  if (pc?.kind !== 'PICK') return []
  const pl = props.state.players[pc.owner]
  const zone = pc.zones.flatMap(z => (z === 'allies' ? pl.allies.map(x => x.card) : pl[z]))
  return props.legal.flatMap(a => {
    if (a.type !== 'PICK') return []
    const card = zone.find(c => c.iid === a.iid)
    return card ? [{ card, a }] : []
  })
})

const strike = computed(() => (props.state.winner === null ? props.state.combat?.strike : null))
const phase = computed(() => {
  const pc = props.state.pendingChoice
  if (pc?.kind === 'DEFEND') return 'Defend!'
  if (pc?.kind === 'WINDOW') return pc.window === 'REACT' ? 'Reaction' : 'End of turn'
  if (pc && ['PICK', 'CONFIRM', 'OPTION'].includes(pc.kind)) return 'Your choice'
  return STEPS.find(st => st.key.includes(props.state.step))?.label ?? ''
})
const waiting = computed(() => !props.myTurn && props.state.winner === null)
</script>

<template>
  <section class="battle" :class="{ waiting }">
    <header class="battle-head">
      <span class="turn-badge">Turn {{ state.turn }}</span>
      <ol class="steps" aria-label="Turn steps">
        <li v-for="st in STEPS" :key="st.label" :class="{ on: st.key.includes(state.step) }">{{ st.label }}</li>
      </ol>
    </header>

    <div v-if="strike" class="showdown">
      <div class="duel-card attack">
        <CardView v-if="strike.card" :card="def(db, strike.card)" size="strike" />
        <div v-else class="power-card"><span>MP power</span><b>{{ strike.label }}</b></div>
        <span class="duel-label">Player {{ strike.initiator + 1 }} attacks</span>
      </div>
      <span class="versus" aria-hidden="true">VS</span>
      <div class="duel-card defense">
        <CardView v-if="strike.defenseCard" :card="def(db, strike.defenseCard)" size="strike" />
        <div v-else class="power-card empty"><span>?</span></div>
        <span class="duel-label">Player {{ 2 - strike.initiator }} defends</span>
      </div>
    </div>
    <h2 v-else class="phase-title" :key="phase">{{ phase }}</h2>

    <p class="prompt">{{ prompt }}</p>
    <div v-if="pickCards.length" class="pick-row">
      <CardView v-for="p in pickCards" :key="p.card.iid" :card="def(db, p.card)" size="table" playable @click="emit('act', p.a)" />
    </div>
    <div class="actions">
      <button v-for="b in buttons" :key="JSON.stringify(b.a)" class="btn" :class="{ primary: b.primary }" :disabled="!myTurn" @click="emit('act', b.a)">{{ b.label }}</button>
      <span v-if="waiting" class="thinking"><span class="dot" /><span class="dot" /><span class="dot" />Opponent is thinking</span>
    </div>
  </section>
</template>
