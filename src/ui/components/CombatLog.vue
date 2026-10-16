<script setup lang="ts">
import { computed } from 'vue'
import type { GameEvent } from '../../engine'

const props = defineProps<{ log: GameEvent[] }>()
const recent = computed(() => props.log.slice(-200).reverse())
</script>

<template>
  <aside class="log">
    <h3>Log</h3>
    <ol>
      <li v-for="(e, i) in recent" :key="log.length - i" :class="[`e-${e.t.toLowerCase()}`, e.player !== undefined && `p${e.player}`]">{{ e.msg }}</li>
    </ol>
  </aside>
</template>
