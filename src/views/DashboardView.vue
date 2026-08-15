<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, formatMonth } from '../lib/format'
import { latestBillPerTenant } from '../lib/billing'
import type { Room, Tenant, Bill, Payment, Property } from '../types/models'

const router = useRouter()
const loading = ref(true)
const filterPropertyId = ref('') // '' = all properties

const rooms = ref<Room[]>([])
const tenants = ref<Tenant[]>([])
const properties = ref<Property[]>([])

// All-time (not period-scoped)
const allOutstandingBills = ref<Bill[]>([])
const overdueBills = ref<Bill[]>([])

// Selected-period data (billing_month based)
const currentMonthBills = ref<Bill[]>([])
// Selected-period data (payment_date based — reflects cash actually received in that period)
const paymentsThisPeriod = ref<Payment[]>([])

// Selected-year data, for the trend chart (raw rows; aggregated via computed below)
const billsYearRaw = ref<{ room_id: string; billing_month: string; total_amount: number }[]>([])
const paymentsYearRaw = ref<{ room_id: string; payment_date: string; amount: number }[]>([])

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthOptions = monthNames.map((label, i) => ({ label, value: i + 1 }))

const now = new Date()
// Selected period — defaults to the current real-world month/year.
const selectedMonthNum = ref(now.getMonth() + 1)
const selectedYear = ref(now.getFullYear())
const availableYears = ref<number[]>([now.getFullYear()])

const selectedBillingMonth = computed(() => {
  const mm = String(selectedMonthNum.value).padStart(2, '0')
  return `${selectedYear.value}-${mm}-01`
})
// Calendar-day range for the selected month, used for payment_date-based queries.
const periodStart = computed(() => selectedBillingMonth.value)
const periodEnd = computed(() => {
  const lastDay = new Date(selectedYear.value, selectedMonthNum.value, 0).getDate()
  return `${selectedYear.value}-${String(selectedMonthNum.value).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
})

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

// ---- Period financials ----
const periodBilled = computed(() =>
  currentMonthBills.value.filter((b) => roomMatchesFilter(b.room_id)).reduce((sum, b) => sum + Number(b.total_amount), 0)
)
const periodOutstanding = computed(() =>
  currentMonthBills.value
    .filter((b) => roomMatchesFilter(b.room_id))
    .reduce((sum, b) => sum + Number(b.outstanding_amount), 0)
)
const periodPaymentsFiltered = computed(() => paymentsThisPeriod.value.filter((p) => roomMatchesFilter(p.room_id)))
const periodReceived = computed(() => periodPaymentsFiltered.value.reduce((sum, p) => sum + Number(p.amount), 0))
// Split by which bill each payment actually cleared — a payment can land in this calendar
// month (by payment_date) but pay off a bill from an earlier billing_month (an old due).
const receivedForThisMonthsBills = computed(() =>
  periodPaymentsFiltered.value
    .filter((p) => p.bill?.billing_month === selectedBillingMonth.value)
    .reduce((sum, p) => sum + Number(p.amount), 0)
)
const receivedForOtherDues = computed(() =>
  periodPaymentsFiltered.value
    .filter((p) => p.bill?.billing_month !== selectedBillingMonth.value)
    .reduce((sum, p) => sum + Number(p.amount), 0)
)
const collectionRatePct = computed(() =>
  periodBilled.value > 0 ? Math.round((periodReceived.value / periodBilled.value) * 100) : null
)

const paymentMethodBreakdown = computed(() => {
  const totals: Record<string, number> = {}
  for (const p of periodPaymentsFiltered.value) {
    totals[p.payment_method] = (totals[p.payment_method] ?? 0) + Number(p.amount)
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1])
})

// ---- All-time outstanding (unchanged from before) ----
const totalOutstandingAllTime = computed(() =>
  allOutstandingBills.value.filter((b) => roomMatchesFilter(b.room_id)).reduce((sum, b) => sum + Number(b.outstanding_amount), 0)
)

// ---- Overdue bills ----
const filteredOverdueBills = computed(() => overdueBills.value.filter((b) => roomMatchesFilter(b.room_id)))
function daysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((today.getTime() - due.getTime()) / 86400000))
}

// ---- Year trend (billed vs received per month) ----
const billedByMonth = computed(() => {
  const arr = Array(12).fill(0)
  for (const b of billsYearRaw.value) {
    if (!roomMatchesFilter(b.room_id)) continue
    const m = new Date(b.billing_month).getMonth()
    arr[m] += Number(b.total_amount)
  }
  return arr
})
const receivedByMonth = computed(() => {
  const arr = Array(12).fill(0)
  for (const p of paymentsYearRaw.value) {
    if (!roomMatchesFilter(p.room_id)) continue
    const m = new Date(p.payment_date).getMonth()
    arr[m] += Number(p.amount)
  }
  return arr
})
const trendMax = computed(() => Math.max(1, ...billedByMonth.value, ...receivedByMonth.value))
function barHeight(value: number): number {
  return (value / trendMax.value) * 110
}

// ---- Loaders ----
async function loadStaticData() {
  const [{ data: r }, { data: t }, { data: p }] = await Promise.all([
    supabase.from('rooms').select('*'),
    supabase.from('tenants').select('*').eq('status', 'active'),
    supabase.from('properties').select('*').order('name'),
  ])
  rooms.value = r ?? []
  tenants.value = t ?? []
  properties.value = p ?? []
}

async function loadAllTimeOutstanding() {
  // Bill totals are cumulative (see latestBillPerTenant) — only each tenant's
  // most recent bill reflects their real outstanding balance.
  const { data } = await supabase
    .from('bills')
    .select('room_id, tenant_id, billing_month, outstanding_amount')
    .gt('outstanding_amount', 0)
  allOutstandingBills.value = latestBillPerTenant((data ?? []) as Bill[])
}

async function loadOverdueBills() {
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('bills')
    .select('*, room:rooms(*), tenant:tenants(*)')
    .eq('finalized', true)
    .gt('outstanding_amount', 0)
    .lt('due_date', today)
    .order('due_date', { ascending: true })
  overdueBills.value = latestBillPerTenant((data ?? []) as Bill[])
}

async function loadAvailableYears() {
  const { data } = await supabase.from('bills').select('billing_month')
  const years = new Set<number>([now.getFullYear()])
  ;(data ?? []).forEach((b: { billing_month: string }) => {
    const y = new Date(b.billing_month).getFullYear()
    if (!Number.isNaN(y)) years.add(y)
  })
  availableYears.value = Array.from(years).sort((a, b) => b - a)
}

async function loadBillsForSelectedMonth() {
  const { data } = await supabase
    .from('bills')
    .select('room_id, total_amount, outstanding_amount')
    .eq('billing_month', selectedBillingMonth.value)
  currentMonthBills.value = (data ?? []) as Bill[]
}

async function loadPaymentsForSelectedMonth() {
  const { data } = await supabase
    .from('payments')
    .select('*, tenant:tenants(*), room:rooms(*), bill:bills(billing_month, bill_number)')
    .gte('payment_date', periodStart.value)
    .lte('payment_date', periodEnd.value)
    .order('payment_date', { ascending: false })
  paymentsThisPeriod.value = (data ?? []) as Payment[]
}

async function loadYearTrend() {
  const yearStart = `${selectedYear.value}-01-01`
  const yearEnd = `${selectedYear.value}-12-31`
  const [{ data: b }, { data: p }] = await Promise.all([
    supabase.from('bills').select('room_id, billing_month, total_amount').gte('billing_month', yearStart).lte('billing_month', yearEnd),
    supabase.from('payments').select('room_id, payment_date, amount').gte('payment_date', yearStart).lte('payment_date', yearEnd),
  ])
  billsYearRaw.value = b ?? []
  paymentsYearRaw.value = p ?? []
}

watch(selectedBillingMonth, async () => {
  await Promise.all([loadBillsForSelectedMonth(), loadPaymentsForSelectedMonth()])
})
watch(selectedYear, loadYearTrend)

onMounted(async () => {
  loading.value = true
  await Promise.all([
    loadStaticData(),
    loadAllTimeOutstanding(),
    loadOverdueBills(),
    loadAvailableYears(),
    loadBillsForSelectedMonth(),
    loadPaymentsForSelectedMonth(),
    loadYearTrend(),
  ])
  loading.value = false
})

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
    <div class="flex items-start justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-lg font-semibold text-slate-800">Dashboard — {{ formatMonth(selectedBillingMonth) }}</h1>

        <div class="flex flex-col gap-2 mt-2 max-w-[10rem]">
          <div>
            <label class="label">Month</label>
            <select v-model.number="selectedMonthNum" class="input">
              <option v-for="m in monthOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </div>
          <div>
            <label class="label">Year</label>
            <select v-model.number="selectedYear" class="input">
              <option v-for="y in availableYears" :key="y" :value="y">{{ y }}</option>
            </select>
          </div>
        </div>
      </div>

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
      <!-- Occupancy -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div v-for="s in stats" :key="s.label" class="card">
          <p class="text-xs text-slate-500">{{ s.label }}</p>
          <p class="text-2xl font-semibold mt-1" :class="s.color">{{ s.get() }}</p>
        </div>
      </div>

      <!-- Period financials -->
      <div>
        <h2 class="text-sm font-semibold text-slate-700 mb-2">{{ formatMonth(selectedBillingMonth) }} Summary</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="card">
            <p class="text-xs text-slate-500">Billed Amount</p>
            <p class="text-2xl font-semibold mt-1 text-slate-800">{{ formatCurrency(periodBilled) }}</p>
          </div>
          <div class="card">
            <p class="text-xs text-slate-500">Amount Received</p>
            <p class="text-2xl font-semibold mt-1 text-green-600">{{ formatCurrency(periodReceived) }}</p>
            <p class="text-[11px] text-slate-400 mt-1 leading-snug">
              {{ formatCurrency(receivedForThisMonthsBills) }} for this month's bills
              <template v-if="receivedForOtherDues > 0">
                <br />+ {{ formatCurrency(receivedForOtherDues) }} clearing dues from other months
              </template>
            </p>
          </div>
          <div class="card">
            <p class="text-xs text-slate-500">Outstanding (this period)</p>
            <p class="text-2xl font-semibold mt-1 text-amber-600">{{ formatCurrency(periodOutstanding) }}</p>
          </div>
          <div class="card">
            <p class="text-xs text-slate-500">Collection Rate</p>
            <p class="text-2xl font-semibold mt-1" :class="collectionRatePct !== null && collectionRatePct < 70 ? 'text-red-600' : 'text-slate-800'">
              {{ collectionRatePct !== null ? collectionRatePct + '%' : '—' }}
            </p>
          </div>
        </div>
      </div>

      <!-- All-time outstanding -->
      <div class="card flex items-center justify-between max-w-md">
        <div>
          <p class="text-xs text-slate-500">Total Outstanding (all-time, all months)</p>
          <p class="text-xl font-semibold mt-1 text-red-600">{{ formatCurrency(totalOutstandingAllTime) }}</p>
        </div>
      </div>

      <!-- Overdue bills -->
      <div class="card overflow-x-auto">
        <h2 class="text-sm font-semibold text-slate-700 mb-2">
          Overdue Bills
          <span v-if="filteredOverdueBills.length" class="badge bg-red-100 text-red-700 align-middle ml-1">{{ filteredOverdueBills.length }}</span>
        </h2>
        <table v-if="filteredOverdueBills.length" class="table-base">
          <thead>
            <tr><th>Tenant</th><th>Room</th><th>Bill Month</th><th>Due Date</th><th>Days Overdue</th><th>Outstanding</th></tr>
          </thead>
          <tbody>
            <tr v-for="b in filteredOverdueBills" :key="b.id">
              <td>{{ b.tenant?.full_name || '-' }}</td>
              <td>{{ b.room?.room_number || '-' }}</td>
              <td>{{ formatMonth(b.billing_month) }}</td>
              <td>{{ formatDate(b.due_date) }}</td>
              <td class="text-red-600 font-medium">{{ daysOverdue(b.due_date) }}</td>
              <td>{{ formatCurrency(b.outstanding_amount) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="text-sm text-slate-400">No overdue bills. 🎉</p>
      </div>

      <!-- Trend chart -->
      <div class="card">
        <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 class="text-sm font-semibold text-slate-700">Billed vs Received — {{ selectedYear }}</h2>
          <div class="flex items-center gap-3 text-xs text-slate-500">
            <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:#cbd5e1"></span> Billed</span>
            <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:#3b5bdb"></span> Received</span>
          </div>
        </div>
        <svg viewBox="0 0 700 150" class="w-full h-40">
          <g v-for="(m, i) in monthShort" :key="m">
            <rect
              :x="i * 58 + 8"
              :y="130 - barHeight(billedByMonth[i])"
              width="18"
              :height="barHeight(billedByMonth[i])"
              fill="#cbd5e1"
              rx="2"
            />
            <rect
              :x="i * 58 + 28"
              :y="130 - barHeight(receivedByMonth[i])"
              width="18"
              :height="barHeight(receivedByMonth[i])"
              fill="#3b5bdb"
              rx="2"
            />
            <text :x="i * 58 + 27" y="144" text-anchor="middle" font-size="10" fill="#94a3b8">{{ m }}</text>
          </g>
        </svg>
      </div>

      <!-- Payments received this period -->
      <div class="card overflow-x-auto">
        <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 class="text-sm font-semibold text-slate-700">Payments Received — {{ formatMonth(selectedBillingMonth) }}</h2>
          <div v-if="paymentMethodBreakdown.length" class="flex flex-wrap gap-2 text-xs text-slate-500">
            <span v-for="[method, amt] in paymentMethodBreakdown" :key="method" class="badge bg-slate-100 text-slate-600 capitalize">
              {{ method.replace('_', ' ') }}: {{ formatCurrency(amt) }}
            </span>
          </div>
        </div>
        <table v-if="periodPaymentsFiltered.length" class="table-base">
          <thead>
            <tr><th>Date</th><th>Tenant</th><th>Room</th><th>Bill Month</th><th>Amount</th><th>Method</th><th>Reference</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in periodPaymentsFiltered" :key="p.id">
              <td>{{ formatDate(p.payment_date) }}</td>
              <td>{{ p.tenant?.full_name || '-' }}</td>
              <td>{{ p.room?.room_number || '-' }}</td>
              <td>
                <span
                  class="badge"
                  :class="p.bill?.billing_month === selectedBillingMonth ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'"
                >
                  {{ p.bill?.billing_month ? formatMonth(p.bill.billing_month) : '-' }}
                </span>
              </td>
              <td class="font-medium">{{ formatCurrency(p.amount) }}</td>
              <td class="capitalize">{{ p.payment_method.replace('_', ' ') }}</td>
              <td>{{ p.reference_number || '-' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="text-sm text-slate-400">No payments recorded for this period.</p>
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
