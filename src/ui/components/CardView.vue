<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CardDef } from '../../engine'
import { hidePreview, showPreview } from '../preview'

const props = defineProps<{
  card?: CardDef
  faceDown?: boolean
  playable?: boolean
  size?: 'xs' | 'sm' | 'table' | 'md' | 'mp' | 'hand' | 'lg' | 'strike'
  label?: string
  count?: number
  /** small label in the top corner, e.g. an ally's stage */
  tag?: string
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

function onClick() {
  if (props.playable) return emit('click')
  if (faceUp.value) showPreview(props.card, true) // touch devices: tap a card to read it
}
</script>

<template>
  <button
    class="card"
    :class="[`size-${size ?? 'md'}`, { playable, back: !faceUp, [`t-${card?.type.replace(/\W/g, '').toLowerCase()}`]: faceUp }]"
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
    <span v-if="count !== undefined" class="count">{{ count }}</span>
    <span v-if="tag" class="tag-corner">{{ tag }}</span>
  </button>
</template>
