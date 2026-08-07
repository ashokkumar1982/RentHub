<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, formatMonth, currentBillingMonth, recentBillingMonths } from '../lib/format'
import type { Bill, Payment, Property } from '../types/models'

type Tab = 'monthly-bills' | 'outstanding' | 'payments'
const tab = ref<Tab>('monthly-bills')
const months = recentBillingMonths(12)
const selectedMonth = ref(currentBillingMonth())
const filterPropertyId = ref('') // '' = all properties

const properties = ref<Property[]>([])
const monthlyBills = ref<Bill[]>([])
const outstandingBills = ref<Bill[]>([])
const allPayments = ref<Payment[]>([])
const loading = ref(true)

function matchesProperty(propertyId: string | undefined): boolean {
  return !filterPropertyId.value || propertyId === filterPropertyId.value
}

const filteredMonthlyBills = computed(() => monthlyBills.value.filter((b) => matchesProperty(b.room?.property_id)))
const filteredOutstandingBills = computed(() => outstandingBills.value.filter((b) => matchesProperty(b.room?.property_id)))
const filteredPayments = computed(() => allPayments.value.filter((p) => matchesProperty(p.room?.property_id)))

async function loadMonthlyBills() {
  const { data } = await supabase
    .from('bills')
    .select('*, tenant:tenants(*), room:rooms(*)')
    .eq('billing_month', selectedMonth.value)
    .order('room_id')
  monthlyBills.value = data ?? []
}

async function loadOutstanding() {
  const { data } = await supabase
    .from('bills')
    .select('*, tenant:tenants(*), room:rooms(*)')
    .gt('outstanding_amount', 0)
    .order('outstanding_amount', { ascending: false })
  outstandingBills.value = data ?? []
}

async function loadPayments() {
  const { data } = await supabase
    .from('payments')
    .select('*, tenant:tenants(*), room:rooms(*)')
    .order('payment_date', { ascending: false })
  allPayments.value = data ?? []
}

async function loadProperties() {
  const { data } = await supabase.from('properties').select('*').order('name')
  properties.value = data ?? []
}

async function loadAll() {
  loading.value = true
  await Promise.all([loadMonthlyBills(), loadOutstanding(), loadPayments(), loadProperties()])
  loading.value = false
}

watch(selectedMonth, loadMonthlyBills)
onMounted(loadAll)

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportMonthlyBills() {
  downloadCsv(
    `monthly-bills-${selectedMonth.value}.csv`,
    ['Property', 'Room', 'Tenant', 'Bill Amount', 'Paid', 'Outstanding', 'Status'],
    filteredMonthlyBills.value.map((b) => [
      b.room?.property_id ? properties.value.find((p) => p.id === b.room?.property_id)?.name ?? '' : '',
      b.room?.room_number ?? '',
      b.tenant?.full_name ?? '',
      b.total_amount,
      b.paid_amount,
      b.outstanding_amount,
      b.payment_status,
    ])
  )
}

function exportOutstanding() {
  downloadCsv(
    'outstanding.csv',
    ['Property', 'Room', 'Tenant', 'Total Outstanding'],
    filteredOutstandingBills.value.map((b) => [
      b.room?.property_id ? properties.value.find((p) => p.id === b.room?.property_id)?.name ?? '' : '',
      b.room?.room_number ?? '',
      b.tenant?.full_name ?? '',
      b.outstanding_amount,
    ])
  )
}

function exportPayments() {
  downloadCsv(
    'payments.csv',
    ['Date', 'Property', 'Tenant', 'Room', 'Amount', 'Payment Method'],
    filteredPayments.value.map((p) => [
      formatDate(p.payment_date),
      p.room?.property_id ? properties.value.find((pr) => pr.id === p.room?.property_id)?.name ?? '' : '',
      p.tenant?.full_name ?? '',
      p.room?.room_number ?? '',
      p.amount,
      p.payment_method,
    ])
  )
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h1 class="text-lg font-semibold text-slate-800">Reports</h1>
      <select v-if="properties.length > 1" v-model="filterPropertyId" class="input w-auto">
        <option value="">All Properties</option>
        <option v-for="p in properties" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <div class="flex gap-2 border-b border-slate-200">
      <button
        v-for="t in [['monthly-bills','Monthly Bills'],['outstanding','Outstanding'],['payments','Payments']] as const"
        :key="t[0]"
        class="px-3 py-2 text-sm font-medium border-b-2 -mb-px"
        :class="tab === t[0] ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500'"
        @click="tab = t[0] as Tab"
      >
        {{ t[1] }}
      </button>
    </div>

    <p v-if="loading" class="text-sm text-slate-500">Loading…</p>

    <template v-else-if="tab === 'monthly-bills'">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <select v-model="selectedMonth" class="input w-auto">
          <option v-for="m in months" :key="m" :value="m">{{ formatMonth(m) }}</option>
        </select>
        <button class="btn-secondary" @click="exportMonthlyBills">Export CSV</button>
      </div>
      <div class="card overflow-x-auto">
        <table class="table-base">
          <thead><tr><th v-if="!filterPropertyId">Property</th><th>Room</th><th>Tenant</th><th>Bill Amount</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead>
          <tbody>
            <tr v-for="b in filteredMonthlyBills" :key="b.id">
              <td v-if="!filterPropertyId" class="text-slate-500">{{ properties.find((p) => p.id === b.room?.property_id)?.name || '-' }}</td>
              <td>{{ b.room?.room_number }}</td>
              <td>{{ b.tenant?.full_name }}</td>
              <td>{{ formatCurrency(b.total_amount) }}</td>
              <td>{{ formatCurrency(b.paid_amount) }}</td>
              <td>{{ formatCurrency(b.outstanding_amount) }}</td>
              <td class="capitalize">{{ b.payment_status.replace('_', ' ') }}</td>
            </tr>
            <tr v-if="filteredMonthlyBills.length === 0"><td colspan="7" class="text-center text-slate-400 py-6">No bills for this month.</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else-if="tab === 'outstanding'">
      <div class="flex justify-end">
        <button class="btn-secondary" @click="exportOutstanding">Export CSV</button>
      </div>
      <div class="card overflow-x-auto">
        <table class="table-base">
          <thead><tr><th v-if="!filterPropertyId">Property</th><th>Room</th><th>Tenant</th><th>Total Outstanding</th></tr></thead>
          <tbody>
            <tr v-for="b in filteredOutstandingBills" :key="b.id">
              <td v-if="!filterPropertyId" class="text-slate-500">{{ properties.find((p) => p.id === b.room?.property_id)?.name || '-' }}</td>
              <td>{{ b.room?.room_number }}</td>
              <td>{{ b.tenant?.full_name }}</td>
              <td class="text-red-600 font-medium">{{ formatCurrency(b.outstanding_amount) }}</td>
            </tr>
            <tr v-if="filteredOutstandingBills.length === 0"><td colspan="4" class="text-center text-slate-400 py-6">No outstanding dues.</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div class="flex justify-end">
        <button class="btn-secondary" @click="exportPayments">Export CSV</button>
      </div>
      <div class="card overflow-x-auto">
        <table class="table-base">
          <thead><tr><th>Date</th><th v-if="!filterPropertyId">Property</th><th>Tenant</th><th>Room</th><th>Amount</th><th>Method</th></tr></thead>
          <tbody>
            <tr v-for="p in filteredPayments" :key="p.id">
              <td>{{ formatDate(p.payment_date) }}</td>
              <td v-if="!filterPropertyId" class="text-slate-500">{{ properties.find((pr) => pr.id === p.room?.property_id)?.name || '-' }}</td>
              <td>{{ p.tenant?.full_name }}</td>
              <td>{{ p.room?.room_number }}</td>
              <td>{{ formatCurrency(p.amount) }}</td>
              <td class="capitalize">{{ p.payment_method.replace('_', ' ') }}</td>
            </tr>
            <tr v-if="filteredPayments.length === 0"><td colspan="6" class="text-center text-slate-400 py-6">No payments yet.</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
