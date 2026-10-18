<script setup lang="ts">
import { computed } from 'vue'
import { def, mpDef, type Action, type CardInstance, type GameState, type PlayerId, type Step } from '../../engine'
import { db } from '../cardDb'
import CardView from './CardView.vue'

// Always visible above your hand: the turn step, what to do now, and the buttons to do it.
const props = defineProps<{ state: GameState; legal: Action[]; actor: PlayerId | null; myTurn: boolean; names: [string, string]; finalMode: boolean }>()
const emit = defineEmits<{ act: [Action]; final: [] }>()
/** Trunks Saga: a Final Physical Attack is offered (pick the card to discard in your hand) */
const canFinal = computed(() => props.legal.some(a => a.type === 'FINAL_PHYSICAL_ATTACK'))

const LABELS: Record<string, string> = {
  END_NON_COMBAT: 'Power up & continue',
  DECLARE_COMBAT: 'Declare combat',
  SKIP_COMBAT: 'Skip combat · end turn',
  USE_POWER: 'Use MP power',
  COPY_ATTACK: 'Copy the attack you blocked',
  PASS: 'Pass',
}
const PRIMARY = new Set(['END_NON_COMBAT', 'DECLARE_COMBAT'])

const buttons = computed(() =>
  props.legal.flatMap(a => {
    if (a.type in LABELS) return [{ a, label: LABELS[a.type], primary: PRIMARY.has(a.type) }]
    if (a.type === 'DEFEND' && !a.iid) return [{ a, label: 'Take the hit', primary: false }]
    if (a.type === 'ALLY_TAKEOVER') {
      const ally = props.state.players[a.player].allies.find(x => x.card.iid === a.iid)
      return ally ? [{ a, label: `Let ${def(db, ally.card).name} take over`, primary: false }] : []
    }
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

interface StepInfo { key: Step[]; label: string }
const STEPS: StepInfo[] = [
  { key: ['NON_COMBAT'], label: 'Non-Combat' },
  { key: ['DECLARE'], label: 'Declare' },
  { key: ['COMBAT'], label: 'Combat' },
  { key: ['DISCARD', 'REJUVENATE'], label: 'Discard' },
]

const who = computed(() => (props.actor === null ? '' : props.names[props.actor]))
const you = computed(() => who.value === 'You')

const prompt = computed(() => {
  const s = props.state
  if (s.winner !== null) return ''
  if (!props.myTurn) return `${who.value} is thinking`
  const pc = s.pendingChoice
  const pre = you.value ? '' : `${who.value}: `
  if (pc?.kind === 'DEFEND') return `${pre}Incoming attack! Block with a glowing card, or take the hit.`
  if (pc?.kind === 'DB_STEAL') return `${pre}5+ life cards of damage: click one of the opponent's Dragon Balls to capture it.`
  if (pc?.kind === 'DISCARD_TO_LIMIT') return `${pre}End of turn: discard down to ${pc.limit} card${pc.limit === 1 ? '' : 's'} by clicking cards in your hand. The turn then passes.`
  if (pc?.kind === 'PICK') return `${pre}${pc.source}: choose ${pc.count} card${pc.count === 1 ? '' : 's'} below.`
  if (pc?.kind === 'CONFIRM' || pc?.kind === 'OPTION') return `${pre}${pc.prompt}`
  if (pc?.kind === 'WINDOW' && pc.window === 'REACT') return `${pre}React to the energy cost with a glowing card?`
  if (pc?.kind === 'WINDOW') return `${pre}End of turn: use a glowing card, or end the turn.`
  if (pc?.kind === 'REJUVENATE') return `${pre}Put the top card of your discard pile back under your life deck?`
  if (s.step === 'COMBAT' && props.actor !== null && s.combat?.finalAttack.includes(props.actor) && !pc) return `${pre}You made a Final Physical Attack: you pass for the rest of this combat.`
  if (props.finalMode) return `${pre}Final Physical Attack: click the card in your hand you discard for it. Afterwards you pass for the rest of this combat.`
  switch (s.step) {
    case 'NON_COMBAT': return `${pre}Play glowing cards from your hand if you like (drills, allies, Dragon Balls, Non-Combat cards), then power up to continue.`
    case 'DECLARE': return `${pre}Attack this turn? Declare combat, or skip it to end your turn.`
    case 'COMBAT': return s.combat?.active === s.attacker
      ? `${pre}Your attack: play a glowing attack card, use your MP power, or pass. Combat ends when both players pass in a row.`
      : `${pre}Your counter-attack: play a glowing attack card, use your MP power, or pass. Combat ends when both players pass in a row.`
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
</script>

<template>
  <section class="command" :class="{ waiting: !myTurn, mine: myTurn && you }" aria-live="polite">
    <div class="command-left">
      <span class="whose" :class="{ you }">{{ you ? 'Your move' : `${who}'s move` }}</span>
      <ol class="steps" aria-label="Turn steps">
        <li v-for="st in STEPS" :key="st.label" :class="{ on: st.key.includes(state.step) }">{{ st.label }}</li>
      </ol>
      <span class="turn-badge">Turn {{ state.turn }} · {{ names[state.attacker] === 'You' ? 'you attack' : `${names[state.attacker]} attacks` }}</span>
    </div>
    <p class="prompt">{{ prompt }}<span v-if="!myTurn" class="thinking"><span class="dot" /><span class="dot" /><span class="dot" /></span></p>
    <div v-if="pickCards.length" class="pick-row">
      <CardView v-for="p in pickCards" :key="p.card.iid" :card="def(db, p.card)" size="table" playable @click="emit('act', p.a)" />
    </div>
    <div class="actions">
      <button v-if="canFinal" class="btn final" :class="{ on: finalMode }" :disabled="!myTurn" title="Discard any card for a physical attack; then you pass for the rest of combat" @click="emit('final')">{{ finalMode ? 'Cancel final attack' : 'Final physical attack' }}</button>
      <button v-for="b in buttons" :key="JSON.stringify(b.a)" class="btn" :class="{ primary: b.primary }" :disabled="!myTurn" @click="emit('act', b.a)">{{ b.label }}</button>
    </div>
  </section>
</template>
