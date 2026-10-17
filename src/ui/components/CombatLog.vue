<script setup lang="ts">
import { computed } from 'vue'
import type { GameEvent } from '../../engine'

const props = defineProps<{ log: GameEvent[] }>()
const recent = computed(() => props.log.slice(-200).reverse())
</script>

<template>
  <section class="log panel">
    <h3 class="panel-title">Battle log</h3>
    <ol>
      <li v-for="(e, i) in recent" :key="log.length - i" :class="[`e-${e.t.toLowerCase()}`, e.player !== undefined && `p${e.player}`]">{{ e.msg }}</li>
    </ol>
  </section>
</template>
