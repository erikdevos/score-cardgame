import { shallowRef } from 'vue'
import type { CardDef } from '../engine'

/** The card shown enlarged in the preview panel (hover on desktop, tap on touch). */
export const previewCard = shallowRef<CardDef | null>(null)
export const previewPinned = shallowRef(false)

export function showPreview(c: CardDef | undefined, pin = false) {
  if (!c) return
  previewCard.value = c
  previewPinned.value = pin
}
export function hidePreview() {
  if (!previewPinned.value) previewCard.value = null
}
export function closePreview() {
  previewPinned.value = false
  previewCard.value = null
}
