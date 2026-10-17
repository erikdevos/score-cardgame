<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

const emit = defineEmits<{ close: [] }>()
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close')
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="help-overlay" role="dialog" aria-label="How to play" @click.self="$emit('close')">
    <article class="help panel">
      <header>
        <h2>How to play</h2>
        <button class="icon-btn" aria-label="Close" @click="$emit('close')">&times;</button>
      </header>
      <ol class="help-steps">
        <li><b>Glowing cards</b> are the ones you can play right now. Click one to play it. Hover over any card to see it large on the right.</li>
        <li><b>The bar above your hand</b> always tells you what to do and has the buttons for it. Gold buttons move the turn forward. The middle of the mat shows the attack in progress, or the last attack and its result.</li>
        <li><b>Non-Combat</b>: play drills, allies, Dragon Balls and Non-Combat cards, then press <i>Power up &amp; continue</i>.</li>
        <li><b>Declare</b>: press <i>Declare combat</i> to attack, or <i>Skip combat · end turn</i>.</li>
        <li><b>Combat</b>: you and your opponent take turns. Play a glowing attack card, use your MP power, or <i>Pass</i>. When the opponent attacks, block with a glowing card or <i>Take the hit</i>. Combat ends when both players pass in a row.</li>
        <li><b>Discard</b>: at the end of the turn you keep 1 card. Click the cards you want to discard (they get a red <i>Discard</i> label); the turn then passes to your opponent by itself.</li>
      </ol>
      <h3>Reading the board</h3>
      <ul class="help-list">
        <li><b>Power level</b> (green scouter): your power stage 0 to 10. Physical damage drains stages; at 0, damage spills into life cards.</li>
        <li><b>Life deck</b>: your cards and your health. Run out and you lose.</li>
        <li><b>Anger</b> (flames): at 5 your personality levels up. At the top level, that wins the game.</li>
        <li><b>Dragon Balls</b>: collect all 7 to win. 5+ life cards of damage in one hit lets the attacker capture one.</li>
      </ul>
      <button class="btn primary" @click="$emit('close')">Got it</button>
    </article>
  </div>
</template>
