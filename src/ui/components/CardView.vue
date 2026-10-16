<script setup lang="ts">
import { computed } from 'vue'
import type { CardDef } from '../../engine'

const props = defineProps<{ card?: CardDef; faceDown?: boolean; playable?: boolean; small?: boolean; label?: string }>()
defineEmits<{ click: [] }>()

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
</script>

<template>
  <button
    class="card"
    :class="{ small, playable, back: faceDown || !card, [`t-${card?.type.replace(/\W/g, '').toLowerCase()}`]: card && !faceDown }"
    :title="card && !faceDown ? `${card.name}\n${card.type}\n${card.rawText}` : ''"
    :disabled="!playable"
    @click="$emit('click')"
  >
    <template v-if="card && !faceDown">
      <img v-if="card.imageUrl" :src="card.imageUrl" :alt="card.name" loading="lazy" />
      <div v-else class="text-card">
        <strong>{{ card.name }}</strong>
        <em>{{ card.type }}</em>
        <span>{{ summary }}</span>
      </div>
    </template>
    <span v-else class="back-label">{{ label ?? 'DBZ' }}</span>
  </button>
</template>
