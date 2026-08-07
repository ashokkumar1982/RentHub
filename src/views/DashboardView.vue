<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { formatCurrency, currentBillingMonth, formatMonth } from '../lib/format'
import type { Room, Tenant, Bill, Property } from '../types/models'

const router = useRouter()
const loading = ref(true)
const filterPropertyId = ref('') // '' = all properties

const rooms = ref<Room[]>([])
const tenants = ref<Tenant[]>([])
const currentMonthBills = ref<Bill[]>([])
const allOutstandingBills = ref<Bill[]>([])
const properties = ref<Property[]>([])

const roomsById = computed(() => new Map(rooms.value.map((r) => [r.id, r])))

function roomMatchesFilter(roomId: string): boolean {
  if (!filterPropertyId.value) return true
  const room = roomsById.value.get(roomId)
  return room?.property_id === filterPropertyId.value
}

const filteredRooms = computed(() =>
  filterPropertyId.value ? rooms.value.filter((r) => r.property_id === filterPropertyId.value) : rooms.value
)
const totalRooms = computed(() => filteredRooms.value.length)
const occupiedRooms = computed(() => filteredRooms.value.filter((r) => r.status === 'occupied').length)
const vacantRooms = computed(() => totalRooms.value - occupiedRooms.value)

const totalTenants = computed(
  () => tenants.value.filter((t) => t.status === 'active' && t.room_id && roomMatchesFilter(t.room_id)).length
)

const currentMonthBillAmount = computed(() =>
  currentMonthBills.value.filter((b) => roomMatchesFilter(b.room_id)).reduce((sum, b) => sum + Number(b.total_amount), 0)
)
const currentMonthCollection = computed(() =>
  currentMonthBills.value.filter((b) => roomMatchesFilter(b.room_id)).reduce((sum, b) => sum + Number(b.paid_amount), 0)
)
const totalOutstanding = computed(() =>
  allOutstandingBills.value.filter((b) => roomMatchesFilter(b.room_id)).reduce((sum, b) => sum + Number(b.outstanding_amount), 0)
)

async function load() {
  loading.value = true
  const month = currentBillingMonth()

  const [{ data: r }, { data: t }, { data: bills }, { data: outstanding }, { data: p }] = await Promise.all([
    supabase.from('rooms').select('*'),
    supabase.from('tenants').select('*').eq('status', 'active'),
    supabase.from('bills').select('room_id, total_amount, paid_amount').eq('billing_month', month),
    supabase.from('bills').select('room_id, outstanding_amount').gt('outstanding_amount', 0),
    supabase.from('properties').select('*').order('name'),
  ])

  rooms.value = r ?? []
  tenants.value = t ?? []
  currentMonthBills.value = (bills ?? []) as Bill[]
  allOutstandingBills.value = (outstanding ?? []) as Bill[]
  properties.value = p ?? []

  loading.value = false
}

onMounted(load)

const stats = [
  { label: 'Total Rooms', get: () => totalRooms.value, color: 'text-slate-800' },
  { label: 'Occupied Rooms', get: () => occupiedRooms.value, color: 'text-green-600' },
  { label: 'Vacant Rooms', get: () => vacantRooms.value, color: 'text-amber-600' },
  { label: 'Total Tenants', get: () => totalTenants.value, color: 'text-slate-800' },
]

const quickActions = [
  { label: 'Add Room', to: '/rooms', icon: '🏢' },
  { label: 'Add Tenant', to: '/tenants', icon: '👤' },
  { label: 'Meter Reading', to: '/meter-readings', icon: '⚡' },
  { label: 'Generate Bills', to: '/bills', icon: '🧾' },
  { label: 'Record Payment', to: '/payments', icon: '💰' },
]
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h1 class="text-lg font-semibold text-slate-800">Dashboard — {{ formatMonth(currentBillingMonth()) }}</h1>
      <select v-if="properties.length > 1" v-model="filterPropertyId" class="input w-auto">
        <option value="">All Properties</option>
        <option v-for="p in properties" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <p v-if="loading" class="text-sm text-slate-500">Loading…</p>
    <p v-else-if="properties.length === 0" class="text-sm text-amber-600">
      No properties yet. <router-link to="/properties" class="underline">Add one first</router-link>.
    </p>

    <template v-else>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div v-for="s in stats" :key="s.label" class="card">
          <p class="text-xs text-slate-500">{{ s.label }}</p>
          <p class="text-2xl font-semibold mt-1" :class="s.color">{{ s.get() }}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="card">
          <p class="text-xs text-slate-500">Current Month Bill Amount</p>
          <p class="text-2xl font-semibold mt-1 text-slate-800">{{ formatCurrency(currentMonthBillAmount) }}</p>
        </div>
        <div class="card">
          <p class="text-xs text-slate-500">Current Month Collection</p>
          <p class="text-2xl font-semibold mt-1 text-green-600">{{ formatCurrency(currentMonthCollection) }}</p>
        </div>
        <div class="card">
          <p class="text-xs text-slate-500">Total Outstanding</p>
          <p class="text-2xl font-semibold mt-1 text-red-600">{{ formatCurrency(totalOutstanding) }}</p>
        </div>
      </div>

      <div>
        <h2 class="text-sm font-semibold text-slate-700 mb-2">Quick Actions</h2>
        <div class="flex flex-wrap gap-2">
          <button v-for="a in quickActions" :key="a.label" class="btn-secondary" @click="router.push(a.to)">
            {{ a.icon }} {{ a.label }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
