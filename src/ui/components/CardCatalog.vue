<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CardDef } from '../../engine'
import { SETS, realCards, setOrder } from '../cardDb'
import { cardPrice, cardPriceValue, priceInfo, type PrintMode } from '../prices'

defineEmits<{ back: [] }>()

const setFilter = ref<string>('all')
const query = ref('')
const typeFilter = ref('all')
const styleFilter = ref('all')
const rarityFilter = ref('all')
const printMode = ref<PrintMode>('both')
const sortBy = ref<'number' | 'price-desc' | 'price-asc'>('number')
const open = ref<CardDef | null>(null)

const sorted = [...realCards].sort((a, b) => setOrder(a.set) - setOrder(b.set) || a.number - b.number)
const counts = computed(() => Object.fromEntries(SETS.map(s => [s.name, sorted.filter(c => c.set === s.name).length])))

const RARITIES = ['Starter', 'Common', 'Uncommon', 'Rare', 'Ultra Rare', 'Promo']
const TYPES = ['Personality', 'Physical Combat', 'Energy Combat', 'Combat', 'Non-Combat', 'Drill', 'Mastery', 'Dragon Ball', 'Location', 'Battleground']
const STYLES = ['Orange', 'Red', 'Black', 'Blue', 'Saiyan', 'Namekian']
const styleOf = (c: CardDef) => (c as CardDef & { style?: string }).style
const inSeries = computed(() => sorted.filter(c => setFilter.value === 'all' || c.set === setFilter.value))
/** Options with counts within the chosen series; only values that occur are offered. */
const facet = (all: string[], get: (c: CardDef) => string | undefined) =>
  computed(() => all.map(v => ({ v, n: inSeries.value.filter(c => get(c) === v).length })).filter(o => o.n))
const typeOpts = facet(TYPES, c => c.type)
const styleOpts = facet(STYLES, styleOf)
const rarityOpts = facet(RARITIES, c => c.rarity)
const filtersOn = computed(() => typeFilter.value !== 'all' || styleFilter.value !== 'all' || rarityFilter.value !== 'all' || setFilter.value !== 'all' || query.value !== '')
function reset() { setFilter.value = typeFilter.value = styleFilter.value = rarityFilter.value = 'all'; query.value = '' }

const list = computed(() => {
  const q = query.value.trim().toLowerCase()
  const out = sorted.filter(c => {
    if (setFilter.value !== 'all' && c.set !== setFilter.value) return false
    if (typeFilter.value !== 'all' && c.type !== typeFilter.value) return false
    if (styleFilter.value !== 'all' && styleOf(c) !== styleFilter.value) return false
    if (rarityFilter.value !== 'all' && c.rarity !== rarityFilter.value) return false
    return !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || String(c.number) === q || c.rawText.toLowerCase().includes(q)
  })
  if (sortBy.value === 'number') return out
  const dir = sortBy.value === 'price-desc' ? -1 : 1
  // unpriced cards always go last
  return out.sort((a, b) => {
    const pa = cardPriceValue(a.id, printMode.value), pb = cardPriceValue(b.id, printMode.value)
    return pa === undefined ? (pb === undefined ? 0 : 1) : pb === undefined ? -1 : dir * (pa - pb)
  })
})

const idx = computed(() => (open.value ? list.value.findIndex(c => c.id === open.value!.id) : -1))
function step(d: number) {
  const n = list.value.length
  if (idx.value < 0 || !n) return
  open.value = list.value[(idx.value + d + n) % n]
}

const fmt = (v: unknown): string => {
  if (v === true) return 'Yes'
  if (Array.isArray(v)) return v.map(fmt).join(', ')
  if (v && typeof v === 'object') return Object.entries(v).filter(([, x]) => x !== 0 && x !== false && x != null).map(([k, x]) => `${k}: ${fmt(x)}`).join(' · ')
  return String(v)
}


const n = (v: number, one: string, many = `${one}s`) => `${v} ${Math.abs(v) === 1 ? one : many}`
const signed = (v: number) => (v > 0 ? `+${v}` : String(v))
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
const ROLES: Record<string, string> = {
  ATTACK_PHYSICAL: 'Physical attack', ATTACK_ENERGY: 'Energy attack', COMBAT_EFFECT: 'Combat effect',
  DEFENSE_PHYSICAL: 'Defense against physical attacks', DEFENSE_ENERGY: 'Defense against energy attacks', DEFENSE_ANY: 'Defense against any attack',
}
const alignmentLabel = (a: string) => `${a}${a.endsWith('s') ? '' : 's'}`

function damageText(d: any): string {
  if (d.calculation === 'NONE') return ''
  const parts: string[] = []
  if (d.calculation === 'PAT') {
    parts.push('Per the PAT')
    if (d.modifierStages) parts.push(`${signed(d.modifierStages)} ${Math.abs(d.modifierStages) === 1 ? 'stage' : 'stages'}`)
    if (d.modifierLifeCards) parts.push(`${signed(d.modifierLifeCards)} life ${Math.abs(d.modifierLifeCards) === 1 ? 'card' : 'cards'}`)
  } else {
    if (d.lifeCards) parts.push(n(d.lifeCards, 'life card'))
    if (d.stages) parts.push(n(d.stages, 'stage'))
    if (!parts.length) parts.push('0')
  }
  return parts.join(', ')
}
function defenseText(d: any): string {
  if (d.mode === 'STOP') return 'Stops the attack'
  if (d.mode === 'CAP') return `Damage capped at ${n(d.maxLifeCards ?? 0, 'life card')}`
  const parts = [d.lifeCards && n(d.lifeCards, 'life card'), d.stages && n(d.stages, 'stage')].filter(Boolean)
  return parts.length ? `Reduces damage by ${parts.join(' and ')}` : 'Reduces damage'
}
function costText(c: any): string {
  if (c.type === 'NONE' || !c.amount) return ''
  return c.type === 'POWER_STAGES' ? n(c.amount, 'power stage') : n(c.amount, 'life card')
}
function usableByText(u: any): string {
  return [...(u.alignments ?? []).map(alignmentLabel), ...(u.characters ?? [])].join(', ') + ' only'
}
function passiveText(p: any): string {
  const who = ({ OWNER: 'you', OPPONENT: 'your opponent', ALL: 'every player' } as Record<string, string>)[p.scope] ?? p.scope
  if (p.kind === 'PUR_MOD') return `${cap(who)} ${p.scope === 'ALL' ? 'get' : 'gets'} ${signed(p.amount)} PUR`
  if (p.kind === 'HAND_LIMIT') return `${signed(p.amount)} hand size for ${who}`
  if (p.kind === 'DAMAGE_MOD') {
    const atk = p.attackType === 'ANY' ? 'any' : p.attackType.toLowerCase()
    const mods = [p.lifeCards && `${signed(p.lifeCards)} life ${Math.abs(p.lifeCards) === 1 ? 'card' : 'cards'}`, p.stages && `${signed(p.stages)} ${Math.abs(p.stages) === 1 ? 'stage' : 'stages'}`].filter(Boolean)
    return `${mods.join(' and ') || 'No change'} damage on ${atk} attacks by ${who}`
  }
  return fmt(p)
}

/** Transcribed fields as label/value rows; empty fields are left out. */
const rows = computed<[string, string][]>(() => {
  const c = open.value as (CardDef & Record<string, any>) | null
  if (!c) return []
  const out: [string, unknown][] = [['Card text', c.rawText], ['Type', c.type], ['Style', c.style], ['Rarity', c.rarity]]
  const p = c.personality
  if (p) {
    out.push(['Character', p.character], ['Level', p.level], ['Alignment', p.alignment], ['PUR', p.pur], ['Power rating', p.zPower ? 'Z power stages (base damage is always 2)' : p.powerRatings?.join(' / ')])
    if (p.power) out.push(['Power', `${p.power.name}: ${p.power.text}`])
  }
  out.push(
    ['Combat role', c.combatRole && (ROLES[c.combatRole] ?? c.combatRole)], ['Cost', c.cost && costText(c.cost)], ['Damage', c.damage && damageText(c.damage)], ['Defense', c.defense && defenseText(c.defense)],
    ['Usable by', c.usableBy && usableByText(c.usableBy)], ['Use phase', c.usePhase && `${cap(c.usePhase)} phase`],
    ['Limit per deck', c.limitPerDeck && `Max ${c.limitPerDeck}`], ['Dragon Ball', c.dragonBallNumber], ['Named', c.named], ['Passives', c.passives?.map(passiveText).join('; ')],
    ['Card', c.id], ['Set', `${c.set} · #${c.number}`],
    // debugging only, not relevant for players
    ['Needs review', c.needsReview], ['Verified', c.verified ? 'Yes' : 'No'],
  )
  return out.map(([k, v]): [string, string] => [k, fmt(v)]).filter(([, v]) => v !== '' && v !== 'undefined' && v !== 'null')
})

function onKey(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') open.value = null
  else if (e.key === 'ArrowRight') step(1)
  else if (e.key === 'ArrowLeft') step(-1)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="catalog">
    <header class="catalog-top">
      <div class="catalog-bar">
        <button class="link-btn" @click="$emit('back')">&larr; Menu</button>
        <h2>Card catalog</h2>
        <span class="muted small">{{ list.length }} of {{ sorted.length }} cards</span>
        <span class="muted small" :title="`Estimated ungraded market value in USD, from ${priceInfo.source}`">Values: {{ priceInfo.source }}, {{ priceInfo.fetched }}</span>
      </div>
      <div class="filter-bar">
        <input v-model="query" class="catalog-search" type="search" placeholder="Search name, text or number" aria-label="Search cards" autofocus />
        <select v-model="typeFilter" class="filter-select" aria-label="Card type" :class="{ on: typeFilter !== 'all' }">
          <option value="all">All types</option>
          <option v-for="o in typeOpts" :key="o.v" :value="o.v">{{ o.v }} ({{ o.n }})</option>
        </select>
        <select v-model="styleFilter" class="filter-select" aria-label="Style" :class="{ on: styleFilter !== 'all' }">
          <option value="all">All styles</option>
          <option v-for="o in styleOpts" :key="o.v" :value="o.v">{{ o.v }} ({{ o.n }})</option>
        </select>
        <select v-model="rarityFilter" class="filter-select" aria-label="Rarity" :class="{ on: rarityFilter !== 'all' }">
          <option value="all">All rarities</option>
          <option v-for="o in rarityOpts" :key="o.v" :value="o.v">{{ o.v }} ({{ o.n }})</option>
        </select>
        <select v-model="sortBy" class="filter-select" aria-label="Sort" :class="{ on: sortBy !== 'number' }">
          <option value="number">Sort: card number</option>
          <option value="price-desc">Sort: value, high to low</option>
          <option value="price-asc">Sort: value, low to high</option>
        </select>
        <button v-if="filtersOn" class="link-btn" @click="reset">Clear</button>
      </div>
      <div class="chips" role="group" aria-label="Series">
        <button :class="{ on: setFilter === 'all' }" @click="setFilter = 'all'">All <small>{{ sorted.length }}</small></button>
        <button v-for="s in SETS" :key="s.key" :class="{ on: setFilter === s.name }" @click="setFilter = s.name">{{ s.name }} <small>{{ counts[s.name] }}</small></button>
        <div class="chips print-toggle" role="group" aria-label="Print">
          <button v-for="m in (['both', 'regular', 'foil'] as const)" :key="m" :class="{ on: printMode === m }" @click="printMode = m">{{ m === 'both' ? 'Both prints' : m === 'regular' ? 'Regular' : 'Foil' }}</button>
        </div>
      </div>
    </header>

    <ul v-if="list.length" class="catalog-grid">
      <li v-for="c in list" :key="c.id">
        <button class="cat-card" :title="c.name" @click="open = c">
          <img :src="c.imageUrl" :alt="c.name" loading="lazy" />
          <span class="cat-num">{{ c.id }}</span>
          <span class="cat-name">{{ c.name }}</span>
          <span class="cat-price" :title="`Estimated value, ${priceInfo.source} ${priceInfo.fetched}`">
            <template v-if="printMode !== 'foil' && cardPrice(c.id).regular"><b>{{ cardPrice(c.id).regular }}</b></template>
            <template v-if="printMode !== 'regular' && cardPrice(c.id).foil">
              <b v-if="printMode === 'foil'">{{ cardPrice(c.id).foil }}</b>
              <small v-else>{{ cardPrice(c.id).regular ? 'foil ' : 'foil only ' }}{{ cardPrice(c.id).foil }}</small>
            </template>
            <small v-if="cardPriceValue(c.id, printMode) === undefined">no {{ printMode === 'both' ? '' : printMode + ' ' }}price</small>
          </span>
        </button>
      </li>
    </ul>
    <p v-else class="muted catalog-empty">No cards match. <button class="link-btn" @click="reset">Clear filters</button></p>

    <div v-if="open" class="cat-modal" role="dialog" aria-modal="true" :aria-label="open.name" @click.self="open = null">
      <button class="cat-close" aria-label="Close" @click="open = null">&times;</button>
      <button class="cat-nav prev" aria-label="Previous card" @click="step(-1)">&lsaquo;</button>
      <button class="cat-nav next" aria-label="Next card" @click="step(1)">&rsaquo;</button>
      <div class="cat-detail">
        <div class="cat-art"><img :src="open.imageUrl" :alt="open.name" /></div>
        <div class="cat-info">
          <h3>{{ open.name }}</h3>
          <table>
            <tbody>
              <tr v-for="[k, v] in rows" :key="k" :class="{ text: k === 'Card text', debug: k === 'Needs review' || k === 'Verified' }"><th>{{ k }}</th><td>{{ v }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
