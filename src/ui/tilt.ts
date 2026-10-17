import type { Directive } from 'vue'

// v-tilt: the element leans towards the pointer in 3D and a glare follows it.
// Sets --rx/--ry (rotation) and --mx/--my (glare position) on the element; CSS does the rest.
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
type El = HTMLElement & { _tilt?: { move: (e: PointerEvent) => void; leave: () => void; frame: number } }

export const vTilt: Directive<El, number | undefined> = {
  mounted(el, binding) {
    if (reduced) return
    const max = binding.value ?? 14
    const state = {
      frame: 0,
      move(e: PointerEvent) {
        if (e.pointerType !== 'mouse') return
        cancelAnimationFrame(state.frame)
        state.frame = requestAnimationFrame(() => {
          const r = el.getBoundingClientRect()
          const x = (e.clientX - r.left) / r.width
          const y = (e.clientY - r.top) / r.height
          el.style.setProperty('--ry', `${((x - 0.5) * 2 * max).toFixed(2)}deg`)
          el.style.setProperty('--rx', `${((0.5 - y) * 2 * max).toFixed(2)}deg`)
          el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`)
          el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`)
          el.classList.add('tilting')
        })
      },
      leave() {
        cancelAnimationFrame(state.frame)
        for (const p of ['--rx', '--ry', '--mx', '--my']) el.style.removeProperty(p)
        el.classList.remove('tilting')
      },
    }
    el._tilt = state
    el.addEventListener('pointermove', state.move)
    el.addEventListener('pointerleave', state.leave)
  },
  unmounted(el) {
    if (!el._tilt) return
    cancelAnimationFrame(el._tilt.frame)
    el.removeEventListener('pointermove', el._tilt.move)
    el.removeEventListener('pointerleave', el._tilt.leave)
  },
}
