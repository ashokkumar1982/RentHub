<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatMonth, currentBillingMonth, recentBillingMonths } from '../lib/format'
import { computeBillTotal, computePaymentStatus, computeOutstanding, generateBillNumber } from '../lib/billing'
import type { Room, Tenant, MeterReading, Bill, Property } from '../types/models'

const router = useRouter()
const months = recentBillingMonths(12)
const selectedMonth = ref(currentBillingMonth())
const filterPropertyId = ref('') // '' = all properties

const rooms = ref<Room[]>([])
const tenants = ref<Tenant[]>([])
const readings = ref<MeterReading[]>([])
const bills = ref<Bill[]>([])
const properties = ref<Property[]>([])
const loading = ref(true)
const generating = ref<string | null>(null)

function propertyOf(propertyId: string) {
  return properties.value.find((p) => p.id === propertyId) || null
}

// occupied rooms with their active tenant, optionally filtered to one property
const rows = computed(() =>
  rooms.value
    .filter((r) => r.status === 'occupied')
    .filter((r) => !filterPropertyId.value || r.property_id === filterPropertyId.value)
    .map((room) => {
      const tenant = tenants.value.find((t) => t.room_id === room.id && t.status === 'active') || null
      const bill = bills.value.find((b) => b.room_id === room.id && b.tenant_id === tenant?.id) || null
      const reading = readings.value.find((rd) => rd.room_id === room.id) || null
      return { room, tenant, bill, reading }
    })
    .filter((row) => row.tenant)
)

async function loadAll() {
  loading.value = true
  const [{ data: r }, { data: t }, { data: rd }, { data: b }, { data: p }] = await Promise.all([
    supabase.from('rooms').select('*').order('room_number'),
    supabase.from('tenants').select('*').eq('status', 'active'),
    supabase.from('meter_readings').select('*').eq('billing_month', selectedMonth.value),
    supabase.from('bills').select('*').eq('billing_month', selectedMonth.value),
    supabase.from('properties').select('*').order('name'),
  ])
  rooms.value = r ?? []
  tenants.value = t ?? []
  readings.value = rd ?? []
  bills.value = b ?? []
  properties.value = p ?? []
  loading.value = false
}

watch(selectedMonth, loadAll)
onMounted(loadAll)

async function findPreviousDue(tenantId: string): Promise<number> {
  const { data } = await supabase
    .from('bills')
    .select('outstanding_amount')
    .eq('tenant_id', tenantId)
    .lt('billing_month', selectedMonth.value)
    .order('billing_month', { ascending: false })
    .limit(1)
  return data && data.length > 0 ? Number(data[0].outstanding_amount) : 0
}

async function handleGenerate(row: (typeof rows.value)[number]) {
  if (!row.tenant) return
  generating.value = row.room.id
  try {
    const property = propertyOf(row.room.property_id)
    const previousDue = await findPreviousDue(row.tenant.id)
    const electricityAmount = row.reading?.amount ?? 0
    const rent = row.tenant.agreed_monthly_rent
    const water = row.room.water_charge
    const maintenance = row.room.maintenance_charge
    const total = computeBillTotal({
      rent,
      electricity_amount: electricityAmount,
      water_charge: water,
      maintenance_charge: maintenance,
      other_charge: 0,
      previous_due: previousDue,
      discount: 0,
    })
    const prefix = property?.bill_prefix ?? 'RENT'
    const billNumber = generateBillNumber(prefix, selectedMonth.value, row.room.room_number)
    const dueDay = property?.due_day ?? 10
    const [yyyy, mm] = selectedMonth.value.split('-')
    const dueDate = `${yyyy}-${mm}-${String(dueDay).padStart(2, '0')}`

    const payload = {
      bill_number: billNumber,
      billing_month: selectedMonth.value,
      room_id: row.room.id,
      tenant_id: row.tenant.id,
      rent,
      previous_reading: row.reading?.previous_reading ?? 0,
      current_reading: row.reading?.current_reading ?? 0,
      electricity_units: row.reading?.units ?? 0,
      electricity_rate: row.reading?.rate ?? row.room.electricity_rate,
      electricity_amount: electricityAmount,
      water_charge: water,
      maintenance_charge: maintenance,
      other_charge: 0,
      previous_due: previousDue,
      discount: 0,
      total_amount: total,
      paid_amount: 0,
      outstanding_amount: computeOutstanding(total, 0),
      payment_status: computePaymentStatus(total, 0),
      whatsapp_shared: false,
      due_date: dueDate,
      finalized: false,
    }
    const { data, error } = await supabase.from('bills').insert(payload).select().single()
    if (error) {
      alert(error.message.includes('duplicate') ? 'A bill for this tenant/room/month already exists.' : error.message)
      return
    }
    router.push(`/bills/${data.id}`)
  } finally {
    generating.value = null
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h1 class="text-lg font-semibold text-slate-800">Monthly Bills</h1>
      <div class="flex gap-2">
        <select v-model="filterPropertyId" class="input w-auto">
          <option value="">All Properties</option>
          <option v-for="p in properties" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <select v-model="selectedMonth" class="input w-auto">
          <option v-for="m in months" :key="m" :value="m">{{ formatMonth(m) }}</option>
        </select>
      </div>
    </div>

    <p v-if="loading" class="text-sm text-slate-500">Loading…</p>

    <div v-else class="card overflow-x-auto">
      <table class="table-base">
        <thead>
          <tr>
            <th v-if="!filterPropertyId">Property</th>
            <th>Room</th>
            <th>Tenant</th>
            <th>Rent</th>
            <th>Electricity</th>
            <th>Water</th>
            <th>Maintenance</th>
            <th>Previous Due</th>
            <th>Total</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.room.id">
            <td v-if="!filterPropertyId" class="text-slate-500">{{ propertyOf(row.room.property_id)?.name || '-' }}</td>
            <td class="font-medium">{{ row.room.room_number }}</td>
            <td>{{ row.tenant?.full_name }}</td>
            <td>{{ formatCurrency(row.bill?.rent ?? row.tenant?.agreed_monthly_rent ?? 0) }}</td>
            <td>{{ formatCurrency(row.bill?.electricity_amount ?? row.reading?.amount ?? 0) }}</td>
            <td>{{ formatCurrency(row.bill?.water_charge ?? row.room.water_charge) }}</td>
            <td>{{ formatCurrency(row.bill?.maintenance_charge ?? row.room.maintenance_charge) }}</td>
            <td>{{ formatCurrency(row.bill?.previous_due ?? 0) }}</td>
            <td class="font-medium">{{ row.bill ? formatCurrency(row.bill.total_amount) : '-' }}</td>
            <td>
              <span
                v-if="row.bill"
                class="badge"
                :class="{
                  'bg-slate-100 text-slate-500': !row.bill.finalized,
                  'bg-green-100 text-green-700': row.bill.finalized && row.bill.payment_status === 'paid',
                  'bg-amber-100 text-amber-700': row.bill.finalized && row.bill.payment_status === 'partially_paid',
                  'bg-red-100 text-red-700': row.bill.finalized && row.bill.payment_status === 'unpaid',
                }"
                :title="row.bill.settled_via_later_bill ? `Settled automatically via a later month's payment` : ''"
              >
                {{ row.bill.finalized ? row.bill.payment_status.replace('_', ' ') : 'draft' }}{{ row.bill.settled_via_later_bill ? ' *' : '' }}
              </span>
              <span v-else class="badge bg-slate-100 text-slate-400">no bill</span>
            </td>
            <td class="text-right whitespace-nowrap">
              <button
                v-if="!row.bill"
                class="text-brand-600 hover:underline text-xs"
                :disabled="generating === row.room.id"
                @click="handleGenerate(row)"
              >
                {{ generating === row.room.id ? 'Generating…' : 'Generate Bill' }}
              </button>
              <router-link v-else class="text-brand-600 hover:underline text-xs" :to="`/bills/${row.bill.id}`">
                Open
              </router-link>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="10" class="text-center text-slate-400 py-6">No occupied rooms with active tenants.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
