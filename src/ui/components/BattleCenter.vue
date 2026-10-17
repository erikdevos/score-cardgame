<script setup lang="ts">
import { computed } from 'vue'
import { def, type GameState, type PlayerId } from '../../engine'
import { db } from '../cardDb'
import CardView from './CardView.vue'

// The middle of the playmat: the strike in progress, or a big title for the current step.
const props = defineProps<{ state: GameState; actor: PlayerId | null; names: [string, string] }>()

const strike = computed(() => (props.state.winner === null ? props.state.combat?.strike : null))

/** The last strike of this combat, read from the log, so a hit that resolved at once is still visible. */
const lastStrike = computed(() => {
  const s = props.state
  if (!s.combat || strike.value) return null
  const log = s.log
  let i = log.length - 1
  while (i >= 0 && log[i].t !== 'STRIKE' && log[i].t !== 'DECLARE') i--
  if (i < 0 || log[i].t !== 'STRIKE') return null
  const e = log[i]
  const label = e.msg.replace(/^Player \d plays /, '')
  const card = Object.values(db).find(d => d.name === label)
  const after = log.slice(i + 1)
  const stopped = after.find(x => x.t === 'STOPPED')
  const dmg = after.find(x => x.t === 'DAMAGE')
  const defense = after.find(x => x.t === 'DEFEND' && !x.msg.endsWith('takes the attack'))
  const result = stopped ? 'Blocked' : dmg ? dmg.msg.replace(/^Player \d takes /, 'Hit: ').replace('stage(s)', 'stages').replace('life card(s)', 'life cards') : 'Effect resolved'
  return { by: e.player ?? 0, label, card, result, stopped: !!stopped, defense: defense?.msg.replace(/^Player \d defends with /, '') }
})
const title = computed(() => {
  const s = props.state
  const pc = s.pendingChoice
  if (pc?.kind === 'DISCARD_TO_LIMIT') return 'Discard'
  if (pc?.kind === 'WINDOW') return pc.window === 'REACT' ? 'Reaction!' : 'End of turn'
  switch (s.step) {
    case 'NON_COMBAT': return 'Non-Combat'
    case 'DECLARE': return 'Declare'
    case 'COMBAT': return 'Combat!'
    case 'DISCARD': case 'REJUVENATE': return 'Discard'
    default: return ''
  }
})
</script>

<template>
  <section class="battle">
    <div v-if="strike" class="showdown">
      <div class="duel-card attack">
        <CardView v-if="strike.card" :card="def(db, strike.card)" size="strike" />
        <div v-else class="power-card"><span>MP power</span><b>{{ strike.label }}</b></div>
        <span class="duel-label">{{ names[strike.initiator] }} attack{{ names[strike.initiator] === 'You' ? '' : 's' }}</span>
      </div>
      <span class="versus" aria-hidden="true">VS</span>
      <div class="duel-card defense">
        <CardView v-if="strike.defenseCard" :card="def(db, strike.defenseCard)" size="strike" />
        <div v-else class="power-card empty"><span>?</span></div>
        <span class="duel-label">{{ names[1 - strike.initiator] }} defend{{ names[1 - strike.initiator] === 'You' ? '' : 's' }}</span>
      </div>
    </div>
    <div v-else-if="lastStrike" class="last-strike" :class="{ stopped: lastStrike.stopped }">
      <CardView v-if="lastStrike.card" :card="lastStrike.card" size="table" />
      <div class="last-text">
        <span class="eyebrow">Last attack · {{ names[lastStrike.by] }}</span>
        <b>{{ lastStrike.label }}</b>
        <span v-if="lastStrike.defense" class="muted small">Blocked with {{ lastStrike.defense }}</span>
        <span class="result">{{ lastStrike.result }}</span>
      </div>
    </div>
    <h2 v-else :key="title + state.turn" class="phase-title">{{ title }}</h2>
  </section>
</template>
