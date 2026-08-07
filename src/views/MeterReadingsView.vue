<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatMonth, currentBillingMonth, recentBillingMonths } from '../lib/format'
import type { Room, Tenant, MeterReading, Property } from '../types/models'

const months = recentBillingMonths(12)
const selectedMonth = ref(currentBillingMonth())
const filterPropertyId = ref('')

const rooms = ref<Room[]>([])
const tenants = ref<Tenant[]>([])
const properties = ref<Property[]>([])
const readingsThisMonth = ref<MeterReading[]>([])
const selectedRoomId = ref('')

const previousReading = ref<number | null>(null)
const previousReadingKnown = ref(false)
const currentReading = ref<number>(0)
const rate = ref<number>(0)
const saving = ref(false)
const error = ref('')
const success = ref('')
const loading = ref(true)

const occupiedRooms = computed(() =>
  rooms.value.filter((r) => r.status === 'occupied' && (!filterPropertyId.value || r.property_id === filterPropertyId.value))
)
const selectedRoom = computed(() => rooms.value.find((r) => r.id === selectedRoomId.value) || null)
const selectedTenant = computed(() => tenants.value.find((t) => t.room_id === selectedRoomId.value) || null)

function propertyName(propertyId: string) {
  return properties.value.find((p) => p.id === propertyId)?.name || ''
}
function roomLabel(room: Room) {
  return properties.value.length > 1 ? `${propertyName(room.property_id)} — ${room.room_number}` : room.room_number
}

const units = computed(() => {
  if (previousReading.value === null) return 0
  return Math.max(0, currentReading.value - previousReading.value)
})
const amount = computed(() => units.value * (rate.value || 0))

const existingForRoom = computed(() =>
  readingsThisMonth.value.find((r) => r.room_id === selectedRoomId.value)
)

async function loadStaticData() {
  const [{ data: r }, { data: t }, { data: p }] = await Promise.all([
    supabase.from('rooms').select('*').order('room_number'),
    supabase.from('tenants').select('*').eq('status', 'active'),
    supabase.from('properties').select('*').order('name'),
  ])
  rooms.value = r ?? []
  tenants.value = t ?? []
  properties.value = p ?? []
}

async function loadReadingsForMonth() {
  const { data } = await supabase.from('meter_readings').select('*').eq('billing_month', selectedMonth.value)
  readingsThisMonth.value = data ?? []
}

async function loadPreviousReading() {
  previousReading.value = null
  previousReadingKnown.value = false
  if (!selectedRoomId.value) return

  // If a reading already exists for this room+month, load it for editing.
  if (existingForRoom.value) {
    const rec = existingForRoom.value
    previousReading.value = rec.previous_reading
    currentReading.value = rec.current_reading
    rate.value = rec.rate
    previousReadingKnown.value = true
    return
  }

  // Otherwise fetch the most recent prior reading for this room.
  const { data } = await supabase
    .from('meter_readings')
    .select('*')
    .eq('room_id', selectedRoomId.value)
    .lt('billing_month', selectedMonth.value)
    .order('billing_month', { ascending: false })
    .limit(1)

  if (data && data.length > 0) {
    previousReading.value = data[0].current_reading
    previousReadingKnown.value = true
  } else {
    previousReading.value = 0
    previousReadingKnown.value = false // first-ever reading: admin must confirm starting value
  }
  currentReading.value = previousReading.value ?? 0
  rate.value = selectedRoom.value?.electricity_rate ?? 0
}

watch(selectedRoomId, loadPreviousReading)
watch(selectedMonth, async () => {
  await loadReadingsForMonth()
  await loadPreviousReading()
})

async function handleSave() {
  error.value = ''
  success.value = ''
  if (!selectedRoomId.value) {
    error.value = 'Select a room.'
    return
  }
  if (previousReading.value === null) {
    error.value = 'Enter the previous reading.'
    return
  }
  if (currentReading.value < previousReading.value) {
    error.value = 'Current reading cannot be lower than the previous reading.'
    return
  }
  saving.value = true
  const payload = {
    room_id: selectedRoomId.value,
    tenant_id: selectedTenant.value?.id ?? null,
    billing_month: selectedMonth.value,
    previous_reading: previousReading.value,
    current_reading: currentReading.value,
    units: units.value,
    rate: rate.value,
    amount: amount.value,
  }
  const { error: err } = await supabase
    .from('meter_readings')
    .upsert(payload, { onConflict: 'room_id,billing_month' })
  saving.value = false
  if (err) {
    error.value = err.message
    return
  }
  success.value = 'Reading saved.'
  await loadReadingsForMonth()
}

onMounted(async () => {
  loading.value = true
  await loadStaticData()
  await loadReadingsForMonth()
  loading.value = false
})
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-lg font-semibold text-slate-800">Electricity Meter Readings</h1>

    <div class="card space-y-4 max-w-xl">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label">Month</label>
          <select v-model="selectedMonth" class="input">
            <option v-for="m in months" :key="m" :value="m">{{ formatMonth(m) }}</option>
          </select>
        </div>
        <div>
          <label class="label">Property</label>
          <select v-model="filterPropertyId" class="input">
            <option value="">All Properties</option>
            <option v-for="p in properties" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div class="col-span-2">
          <label class="label">Room</label>
          <select v-model="selectedRoomId" class="input">
            <option value="">-- Select occupied room --</option>
            <option v-for="r in occupiedRooms" :key="r.id" :value="r.id">{{ roomLabel(r) }}</option>
          </select>
        </div>
      </div>

      <div v-if="selectedRoomId" class="space-y-3 border-t border-slate-200 pt-3">
        <div class="flex justify-between text-sm">
          <span class="text-slate-500">Tenant</span>
          <span class="font-medium">{{ selectedTenant?.full_name || '-' }}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-slate-500">Meter Number</span>
          <span class="font-medium">{{ selectedRoom?.meter_number || '-' }}</span>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Previous Reading</label>
            <input
              v-model.number="previousReading"
              type="number"
              min="0"
              step="0.01"
              class="input"
              :readonly="previousReadingKnown"
              :class="previousReadingKnown ? 'bg-slate-50 text-slate-500' : ''"
            />
            <p v-if="!previousReadingKnown" class="text-xs text-amber-600 mt-1">
              No prior reading found — enter the starting meter value.
            </p>
          </div>
          <div>
            <label class="label">Current Reading</label>
            <input v-model.number="currentReading" type="number" min="0" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Rate (₹/unit)</label>
            <input v-model.number="rate" type="number" min="0" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Units</label>
            <input :value="units" readonly class="input bg-slate-50 text-slate-500" />
          </div>
        </div>

        <div class="flex justify-between items-center bg-slate-50 rounded-md px-3 py-2">
          <span class="text-sm text-slate-600">Electricity Amount</span>
          <span class="font-semibold text-slate-800">{{ formatCurrency(amount) }}</span>
        </div>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <p v-if="success" class="text-sm text-green-600">{{ success }}</p>

        <button class="btn-primary w-full" :disabled="saving" @click="handleSave">
          {{ saving ? 'Saving…' : existingForRoom ? 'Update Reading' : 'Save Reading' }}
        </button>
      </div>
    </div>

    <div v-if="!loading && readingsThisMonth.length > 0" class="card overflow-x-auto max-w-2xl">
      <h2 class="text-sm font-semibold text-slate-700 mb-2">Readings recorded for {{ formatMonth(selectedMonth) }}</h2>
      <table class="table-base">
        <thead>
          <tr><th>Room</th><th>Previous</th><th>Current</th><th>Units</th><th>Amount</th></tr>
        </thead>
        <tbody>
          <tr v-for="rec in readingsThisMonth" :key="rec.id">
            <td>{{ (() => { const rm = rooms.find((r) => r.id === rec.room_id); return rm ? roomLabel(rm) : '-' })() }}</td>
            <td>{{ rec.previous_reading }}</td>
            <td>{{ rec.current_reading }}</td>
            <td>{{ rec.units }}</td>
            <td>{{ formatCurrency(rec.amount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
