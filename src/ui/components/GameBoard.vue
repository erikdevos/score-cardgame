<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { def, other, type PlayerId } from '../../engine'
import { db } from '../cardDb'
import type { Game } from '../useGame'
import BattleCenter from './BattleCenter.vue'
import CardPreview from './CardPreview.vue'
import CardView from './CardView.vue'
import CombatLog from './CombatLog.vue'
import CommandBar from './CommandBar.vue'
import HelpGuide from './HelpGuide.vue'
import PlayerDock from './PlayerDock.vue'
import TableRow from './TableRow.vue'
import { showToast, toast } from '../toast'

const props = defineProps<{ game: Game }>()
defineEmits<{ quit: [] }>()

const g = props.game
const s = computed(() => g.state.value!)
const me = computed(() => g.viewer.value)
const them = computed(() => other(me.value))
const legalForMe = computed(() => (g.myTurn.value && !g.handHidden.value ? g.legal.value : []))
const names = computed<[string, string]>(() => (g.mode.value === 'ai' ? ['You', 'AI'] : ['Player 1', 'Player 2']))
const showHelp = ref(false)
// Final Physical Attack: the next click on a hand card discards it for the attack
const finalMode = ref(false)
watch(() => s.value.log.length, () => (finalMode.value = false))
// announce each new turn
watch(() => s.value.turn, () => {
  const a: PlayerId = s.value.attacker
  showToast(names.value[a] === 'You' ? 'Your turn: you attack this turn' : `${names.value[a]}'s turn`, 2400)
})
const reasons: Record<string, string> = { SURVIVAL: 'Survival victory', MPP: 'Most Powerful Personality victory', DRAGON_BALLS: 'Dragon Ball victory' }
</script>

<template>
  <div class="app-shell">
    <div class="board">
      <header class="topbar">
        <button class="icon-btn" aria-label="Back to menu" @click="$emit('quit')">&larr;</button>
        <span class="brand">Dragon Ball Z <small>CCG</small></span>
        <span class="mode-chip">{{ g.mode.value === 'ai' ? 'You vs AI' : 'Hotseat' }} · {{ s.rules.trunks.allyRules ? 'Trunks Saga rules' : s.rules.mode === 'CRD_3' ? 'CRD 3.0' : 'Pure 2000' }}</span>
        <button class="icon-btn help-btn" aria-label="How to play" @click="showHelp = true">?</button>
        <span v-if="s.location" class="location"><span class="muted">Location</span> <CardView :card="def(db, s.location)" size="xs" /></span>
      </header>

      <PlayerDock :state="s" :p="them" :legal="legalForMe" :mine="false" :acting="g.actor.value === them" @act="g.dispatch" />

      <main class="field">
        <TableRow :state="s" :p="them" :legal="legalForMe" theirs @act="g.dispatch" />
        <BattleCenter :state="s" :actor="g.actor.value" :names="names" :viewer="me" />
        <TableRow :state="s" :p="me" :legal="legalForMe" @act="g.dispatch" />
        <p v-if="g.error.value" class="error">{{ g.error.value }}</p>
      </main>

      <CommandBar :state="s" :legal="legalForMe" :actor="g.actor.value" :my-turn="g.myTurn.value && !g.handHidden.value" :names="names" :final-mode="finalMode" @act="g.dispatch" @final="finalMode = !finalMode" />

      <PlayerDock v-if="!g.handHidden.value" :state="s" :p="me" :legal="legalForMe" :mine="true" :acting="g.actor.value === me" :final-mode="finalMode" @act="g.dispatch" />
      <div v-else class="handoff">
        <p>Pass the device to <b>Player {{ g.actor.value! + 1 }}</b></p>
        <button class="btn primary" @click="g.revealedFor.value = g.actor.value">I'm player {{ g.actor.value! + 1 }}, show my hand</button>
      </div>
    </div>

    <aside class="side">
      <CardPreview />
      <CombatLog :log="s.log" />
    </aside>

    <HelpGuide v-if="showHelp" @close="showHelp = false" />

    <Transition name="toast">
      <div v-if="toast" class="toast" role="status">{{ toast }}</div>
    </Transition>

    <div v-if="s.winner !== null" class="victory" role="dialog" aria-label="Game over">
      <div class="victory-card">
        <span class="eyebrow">{{ reasons[s.winReason ?? ''] ?? 'Victory' }}</span>
        <h2>Player {{ s.winner + 1 }} wins!</h2>
        <p v-if="g.mode.value === 'ai'" class="muted">{{ s.winner === 0 ? 'Your power level is over 9000.' : 'The AI wins this one.' }}</p>
        <div class="actions">
          <button class="btn primary" @click="$emit('quit')">Back to menu</button>
        </div>
      </div>
    </div>
  </div>
</template>
