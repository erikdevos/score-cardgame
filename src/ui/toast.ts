import { shallowRef } from 'vue'

/** A short message at the bottom of the board, e.g. why a card cannot be played now. */
export const toast = shallowRef<string | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

export function showToast(msg: string, ms = 3200) {
  toast.value = msg
  clearTimeout(timer)
  timer = setTimeout(() => (toast.value = null), ms)
}
