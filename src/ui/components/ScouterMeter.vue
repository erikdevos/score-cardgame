<script setup lang="ts">
import { computed } from 'vue'

// Scouter-style power read-out: current power level plus a segmented stage bar.
const props = defineProps<{ ratings: number[]; stage: number; compact?: boolean }>()
const level = computed(() => props.ratings[props.stage] ?? 0)
</script>

<template>
  <div class="scouter" :class="{ compact }" :aria-label="`Power stage ${stage}, power level ${level}`">
    <div class="scouter-read">
      <span class="scouter-label">Power level</span>
      <span class="scouter-value">{{ level.toLocaleString() }}</span>
      <span class="scouter-stage">Stage {{ stage }}</span>
    </div>
    <ol class="scouter-bar">
      <li v-for="(r, i) in ratings" :key="i" :class="{ on: i === stage, fill: i < stage, zero: i === 0 }" :title="`Stage ${i}: ${r.toLocaleString()}`">
        <span>{{ i }}</span>
      </li>
    </ol>
  </div>
</template>
