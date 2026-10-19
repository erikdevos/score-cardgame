<script setup lang="ts">
import { computed } from 'vue'
import type { CardDef } from '../../engine'
import { makeParticles } from '../aura'

// Particle aura around a top-level personality; the effect style and colours are per character (see aura.ts).
const props = defineProps<{ card: CardDef; count?: number }>()
const aura = computed(() => makeParticles(props.card, props.count ?? 22))
</script>

<template>
  <span class="aura" :class="`aura-${aura.theme.style}`" aria-hidden="true">
    <i
      v-for="(p, n) in aura.particles"
      :key="n"
      :style="{ '--x': `${p.x}%`, '--y': `${p.y}%`, '--dx': p.dx, '--dy': p.dy, '--s': `${p.size}px`, '--d': `${p.dur}s`, '--delay': `${p.delay}s`, '--c': p.color, '--r': `${p.rot}deg` }"
    />
  </span>
</template>
