import { computed, ref, shallowRef } from 'vue'
import { actingPlayer, applyAction, chooseAction, createGame, legalActions, type Action, type DeckList, type GameState, type PlayerId, type Rules } from '../engine'
import { db } from './cardDb'
import { settings } from './settings'

export type Mode = 'hotseat' | 'ai'
const AI: PlayerId = 1

export function useGame() {
  const state = shallowRef<GameState | null>(null)
  const mode = ref<Mode>('ai')
  const error = ref('')
  /** hotseat: who is currently allowed to look at their hand */
  const revealedFor = ref<PlayerId | null>(null)
  let aiTimer: ReturnType<typeof setTimeout> | undefined
  /** after a strike resolves the AI waits, so the Hit!/Blocked! result stays on screen long enough to read */
  let holdUntil = 0
  const STRIKE_HOLD_MS = 2800

  const legal = computed(() => (state.value ? legalActions(state.value, db) : []))
  const actor = computed(() => (state.value ? actingPlayer(state.value) : null))
  const viewer = computed<PlayerId>(() => (mode.value === 'ai' ? 0 : (actor.value ?? state.value?.winner ?? 0)))
  const handHidden = computed(() =>
    mode.value === 'hotseat' && settings.hideHandsHotseat && state.value?.winner === null && revealedFor.value !== actor.value)
  const myTurn = computed(() => actor.value !== null && (mode.value === 'hotseat' || actor.value !== AI))

  function start(decks: [DeckList, DeckList], m: Mode, seed = Date.now(), extraRules: Partial<Rules> = {}) {
    clearTimeout(aiTimer)
    mode.value = m
    error.value = ''
    revealedFor.value = null
    state.value = createGame(db, decks, { seed, rules: { ...extraRules, mode: settings.rulesMode } })
    scheduleAi()
  }

  function dispatch(a: Action) {
    if (!state.value) return
    try {
      const before = state.value.log.length
      state.value = applyAction(state.value, db, a).state
      if (state.value.log.slice(before).some(e => e.t === 'STOPPED' || e.t === 'DAMAGE')) holdUntil = Date.now() + STRIKE_HOLD_MS
      error.value = ''
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
    scheduleAi()
  }

  function scheduleAi() {
    clearTimeout(aiTimer)
    if (mode.value !== 'ai' || actor.value !== AI || !state.value) return
    aiTimer = setTimeout(() => {
      const a = state.value && chooseAction(state.value, db)
      if (a) dispatch(a)
    }, settings.aiDelayMs && Math.max(settings.aiDelayMs, holdUntil - Date.now()))
  }

  function quit() {
    clearTimeout(aiTimer)
    state.value = null
  }

  return { state, mode, error, legal, actor, viewer, handHidden, revealedFor, myTurn, start, dispatch, quit }
}

export type Game = ReturnType<typeof useGame>
