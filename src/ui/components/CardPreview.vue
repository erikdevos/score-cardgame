<script setup lang="ts">
import { isTopLevel } from '../formats'
import CardAura from './CardAura.vue'
import { closePreview, previewCard, previewPinned } from '../preview'
</script>

<template>
  <div class="preview panel" :class="{ pinned: previewPinned, empty: !previewCard }" @click.self="closePreview">
    <div v-if="previewCard" class="preview-inner">
      <div v-if="previewCard.imageUrl" :key="previewCard.id" class="preview-art" :class="{ foil: /Rare|Promo/.test(previewCard.rarity), holo: isTopLevel(previewCard) }">
        <img :src="previewCard.imageUrl" :alt="previewCard.name" />
        <span class="shine" aria-hidden="true" />
        <CardAura v-if="isTopLevel(previewCard)" :card="previewCard" :count="70" />
      </div>
      <div class="preview-text">
        <h4>{{ previewCard.name }}</h4>
        <p class="meta">{{ previewCard.type }}<template v-if="previewCard.style"> · {{ previewCard.style }}</template><template v-if="previewCard.rarity"> · {{ previewCard.rarity }}</template></p>
        <p>{{ previewCard.rawText }}</p>
        <button v-if="previewPinned" class="btn" @click="closePreview">Close</button>
      </div>
    </div>
    <div v-else class="preview-empty">
      <span class="ball big"><i>&#9733;</i></span>
      <p>Hover over a card to see it up close</p>
    </div>
  </div>
</template>
