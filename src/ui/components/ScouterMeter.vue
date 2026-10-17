<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

// Scouter-style power read-out: current power level plus a segmented stage bar.
const props = defineProps<{ ratings: number[]; stage: number; compact?: boolean }>()
const level = computed(() => props.ratings[props.stage] ?? 0)

// The read-out counts up or down to the new power level, like a scouter locking on.
const shown = ref(level.value)
let frame = 0
watch(level, (to, from) => {
  cancelAnimationFrame(frame)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return void (shown.value = to)
  const start = performance.now()
  const tick = (now: number) => {
    const k = Math.min(1, (now - start) / 600)
    shown.value = Math.round(from + (to - from) * (1 - (1 - k) ** 3))
    if (k < 1) frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
})
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div class="scouter" :class="{ compact }" :aria-label="`Power stage ${stage}, power level ${level}`">
    <div class="scouter-read">
      <span class="scouter-label">Power level</span>
      <span class="scouter-value">{{ shown.toLocaleString() }}</span>
      <span class="scouter-stage">Stage {{ stage }}</span>
    </div>
    <ol class="scouter-bar">
      <li v-for="(r, i) in ratings" :key="i" :class="{ on: i === stage, fill: i < stage, zero: i === 0 }" :title="`Stage ${i}: ${r.toLocaleString()}`">
        <span>{{ i }}</span>
      </li>
    </ol>
  </div>
</template>
