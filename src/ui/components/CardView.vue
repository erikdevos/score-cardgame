<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CardDef } from '../../engine'
import { isTopLevel } from '../formats'
import CardAura from './CardAura.vue'
import { hidePreview, showPreview } from '../preview'
import { vTilt } from '../tilt'

const props = defineProps<{
  card?: CardDef
  faceDown?: boolean
  playable?: boolean
  size?: 'xs' | 'sm' | 'opp' | 'table' | 'md' | 'mp' | 'hand' | 'lg' | 'strike'
  label?: string
  count?: number
  /** small label in the top corner, e.g. an ally's stage */
  tag?: string
  /** show what the card does in combat (attack, block, ...) as a badge */
  role?: boolean
}>()
const emit = defineEmits<{ click: [] }>()

const failed = ref(false)
watch(() => props.card?.imageUrl, () => (failed.value = false))
const faceUp = computed(() => !!props.card && !props.faceDown)

const summary = computed(() => {
  const c = props.card
  if (!c) return ''
  if (c.rawText) return c.rawText
  const bits: string[] = []
  if (c.combatRole) bits.push(c.combatRole.replace('_', ' ').toLowerCase())
  if (c.damage?.calculation === 'PAT') bits.push(`PAT${c.damage.modifierStages ? ` +${c.damage.modifierStages}` : ''}`)
  if (c.damage?.calculation === 'FLAT') bits.push(`${c.damage.stages} st / ${c.damage.lifeCards} lc`)
  if (c.dragonBallNumber) bits.push(`Dragon Ball ${c.dragonBallNumber}`)
  for (const e of [...c.effects.onPlaySecondary, ...c.effects.onEnterPlay]) bits.push(e.action.toLowerCase())
  for (const e of c.effects.onHit) bits.push(`if successful: ${e.action.toLowerCase()}`)
  for (const p of c.passives) bits.push(p.kind.toLowerCase())
  return bits.join(' · ')
})

/** What the card is for, as a short badge: attack, block, effect or a Non-Combat card type. */
const badge = computed(() => {
  const c = props.card
  if (!props.role || !c || props.faceDown) return null
  const dual = c.effects.onPlaySecondary.some(e => e.action === 'CUSTOM' && e.handler === 'dualUse')
  switch (c.combatRole) {
    case 'ATTACK_PHYSICAL': return { icon: 'fist', text: dual ? 'Attack / block' : 'Physical attack', cls: 'physical' }
    case 'ATTACK_ENERGY': return { icon: 'ki', text: dual ? 'Attack / block' : 'Energy attack', cls: 'energy' }
    case 'DEFENSE_PHYSICAL': return { icon: 'shield', text: 'Blocks physical', cls: 'block' }
    case 'DEFENSE_ENERGY': return { icon: 'shield', text: 'Blocks energy', cls: 'block' }
    case 'DEFENSE_ANY': return { icon: 'shield', text: 'Block', cls: 'block' }
    case 'COMBAT_EFFECT': return c.usePhase === 'DEFEND' ? { icon: 'shield', text: 'Defend effect', cls: 'block' } : { icon: 'star', text: 'Combat effect', cls: 'effect' }
  }
  if (['Physical Combat', 'Energy Combat', 'Combat'].includes(c.type)) return { icon: 'star', text: 'Combat', cls: 'effect' }
  if (c.type === 'Personality') return null
  return { icon: 'setup', text: c.type === 'Dragon Ball' ? 'Dragon Ball' : c.type, cls: 'setup' }
})

function onClick() {
  if (props.playable) return emit('click')
  if (faceUp.value) showPreview(props.card, true) // touch devices: tap a card to read it
}
</script>

<template>
  <button
    class="card"
    v-tilt="size === 'xs' || size === 'sm' ? 0 : undefined"
    :class="[`size-${size ?? 'md'}`, { playable, back: !faceUp, foil: faceUp && /Rare|Promo/.test(card!.rarity), holo: faceUp && isTopLevel(card), [`t-${card?.type.replace(/\W/g, '').toLowerCase()}`]: faceUp }]"
    :aria-label="faceUp ? `${card!.name}, ${card!.type}` : (label ?? 'Face-down card')"
    @click="onClick"
    @mouseenter="faceUp && showPreview(card)"
    @mouseleave="hidePreview()"
  >
    <template v-if="faceUp">
      <img v-if="card!.imageUrl && !failed" :src="card!.imageUrl" :alt="card!.name" loading="lazy" draggable="false" @error="failed = true" />
      <div v-else class="text-card">
        <strong>{{ card!.name }}</strong>
        <em>{{ card!.type }}</em>
        <span>{{ summary }}</span>
      </div>
    </template>
    <span v-else class="back-art" aria-hidden="true"><span class="ball"><i>&#9733;</i></span><span class="back-label">{{ label ?? 'DBZ' }}</span></span>
    <span v-if="faceUp" class="shine" aria-hidden="true" />
    <CardAura v-if="faceUp && isTopLevel(card) && size !== 'xs' && size !== 'sm'" :card="card!" :count="size === 'lg' || size === 'mp' ? 100 : 34" />
    <span v-if="count !== undefined" class="count">{{ count }}</span>
    <span v-if="tag" class="tag-corner">{{ tag }}</span>
    <span v-if="badge" class="role-badge" :class="badge.cls">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path v-if="badge.icon === 'fist'" d="M6 10V6.5a1.5 1.5 0 0 1 3 0V9V5.5a1.5 1.5 0 0 1 3 0V9V6a1.5 1.5 0 0 1 3 0v3.5V8a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-1a5 5 0 0 1-5-5v-2.5L4.6 11a1.5 1.5 0 0 1 2.2-2L8 10" />
        <g v-else-if="badge.icon === 'ki'"><circle cx="9" cy="12" r="5" /><path d="M14 12h8M14 8.5l7-2M14 15.5l7 2" /></g>
        <path v-else-if="badge.icon === 'shield'" d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
        <path v-else-if="badge.icon === 'star'" d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" />
        <path v-else d="M5 5h14v14H5zM9 9h6v6H9z" />
      </svg>
      <span>{{ badge.text }}</span>
    </span>
  </button>
</template>
