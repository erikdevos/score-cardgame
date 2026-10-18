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
      <h3>Saiyan + Frieza: Trunks Saga rules</h3>
      <ul class="help-list">
        <li><b>Hero first</b>, both personalities start at stage 5. A level up starts at full power.</li>
        <li><b>Most Powerful Personality</b>: you win the moment you reach the highest level any main personality in the game has. At your top level, 5 anger powers you up to full instead.</li>
        <li><b>Final Physical Attack</b>: in your attack phase, press <i>Final physical attack</i> and click any card to discard it for a physical attack. Once per combat; afterwards you pass and cannot block for the rest of that combat.</li>
        <li><b>Not attacking</b> (skipping combat) puts the top card of your discard pile back at the bottom of your life deck.</li>
        <li><b>Allies</b> must be on your side (hero or villain) and at least 2 levels below your top level. A higher level replaces your lower one at full power. When you are hit for power stages you choose who takes them: your main personality or an ally (what the ally cannot take comes off your life deck). At 0 or 1 power stages an ally can <i>take over</i> the combat and fight with its own power level until combat ends.</li>
        <li><b>Dragon Balls</b> are never discarded as damage. Completing a set by capture wins at the start of your next turn.</li>
      </ul>
      <button class="btn primary" @click="$emit('close')">Got it</button>
    </article>
  </div>
</template>
