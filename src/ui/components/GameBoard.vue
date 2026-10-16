<script setup lang="ts">
import { computed } from 'vue'
import { def, other } from '../../engine'
import { db } from '../cardDb'
import type { Game } from '../useGame'
import ActionBar from './ActionBar.vue'
import CardView from './CardView.vue'
import CombatLog from './CombatLog.vue'
import PlayerArea from './PlayerArea.vue'

const props = defineProps<{ game: Game }>()
defineEmits<{ quit: [] }>()

const g = props.game
const s = computed(() => g.state.value!)
const me = computed(() => g.viewer.value)
const legalForMe = computed(() => (g.myTurn.value && !g.handHidden.value ? g.legal.value : []))
</script>

<template>
  <div class="board">
    <div class="main">
      <header class="bar">
        <button class="link" @click="$emit('quit')">Menu</button>
        <span>{{ g.mode.value === 'ai' ? 'You vs AI' : 'Hotseat' }} · {{ s.rules.mode === 'CRD_3' ? 'CRD 3.0' : 'Pure 2000' }}</span>
        <span v-if="s.location" class="location">Location: <CardView :card="def(db, s.location)" small /></span>
      </header>

      <PlayerArea top :state="s" :p="other(me)" :show-hand="false" :legal="legalForMe" @act="g.dispatch" />
      <ActionBar :state="s" :legal="legalForMe" :actor="g.actor.value" :my-turn="g.myTurn.value && !g.handHidden.value" @act="g.dispatch" />
      <p v-if="g.error.value" class="error">{{ g.error.value }}</p>

      <div v-if="g.handHidden.value" class="handoff">
        <p>Pass the device to <b>Player {{ g.actor.value! + 1 }}</b>.</p>
        <button @click="g.revealedFor.value = g.actor.value">I'm player {{ g.actor.value! + 1 }}, show my hand</button>
      </div>
      <PlayerArea v-else :state="s" :p="me" :show-hand="true" :legal="legalForMe" @act="g.dispatch" />
    </div>
    <CombatLog :log="s.log" />
  </div>
</template>
