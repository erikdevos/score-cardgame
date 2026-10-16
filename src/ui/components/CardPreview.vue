<script setup lang="ts">
import { closePreview, previewCard, previewPinned } from '../preview'
</script>

<template>
  <div class="preview" :class="{ pinned: previewPinned, empty: !previewCard }" @click.self="closePreview">
    <div v-if="previewCard" class="preview-inner">
      <img v-if="previewCard.imageUrl" :src="previewCard.imageUrl" :alt="previewCard.name" />
      <div class="preview-text">
        <h4>{{ previewCard.name }}</h4>
        <p class="meta">{{ previewCard.type }}<template v-if="previewCard.style"> · {{ previewCard.style }}</template><template v-if="previewCard.rarity"> · {{ previewCard.rarity }}</template></p>
        <p>{{ previewCard.rawText }}</p>
        <button v-if="previewPinned" class="ghost" @click="closePreview">Close</button>
      </div>
    </div>
    <p v-else class="hint">Hover a card to see it large.</p>
  </div>
</template>
