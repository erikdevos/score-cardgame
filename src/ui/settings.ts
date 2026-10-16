import { reactive, watch } from 'vue'

export interface Settings {
  rulesMode: 'PURE_2000' | 'CRD_3'
  aiDelayMs: number
  hideHandsHotseat: boolean
}

const KEY = 'dbzccg.settings'
function load(): Settings {
  const base: Settings = { rulesMode: 'PURE_2000', aiDelayMs: 600, hideHandsHotseat: true }
  try { return { ...base, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return base }
}

export const settings = reactive<Settings>(load())
watch(settings, v => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* storage unavailable */ } })
