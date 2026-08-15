<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, formatMonth } from '../lib/format'
import { recordPayment } from '../lib/payments'
import type { Payment, Bill, PaymentMethod } from '../types/models'
import Modal from '../components/Modal.vue'

const payments = ref<Payment[]>([])
const outstandingBills = ref<Bill[]>([])
const loading = ref(true)

const showModal = ref(false)
const selectedBillId = ref('')
const selectedBill = computed(() => outstandingBills.value.find((b) => b.id === selectedBillId.value) || null)
const form = reactive({
  amount: 0,
  payment_date: new Date().toISOString().slice(0, 10),
  payment_method: 'cash' as PaymentMethod,
  reference_number: '',
  notes: '',
})
const formError = ref('')
const saving = ref(false)

// ---- Collect Payment (multiple months at once) ----
const showCollectModal = ref(false)
const collectTenantId = ref('')
const collectRows = ref<{ bill: Bill; amount: number }[]>([])
const collectTotalInput = ref(0)
const collectForm = reactive({
  payment_date: new Date().toISOString().slice(0, 10),
  payment_method: 'cash' as PaymentMethod,
  reference_number: '',
  notes: '',
})
const collectError = ref('')
const collectSaving = ref(false)

const tenantsWithOutstanding = computed(() => {
  const map = new Map<string, { tenant_id: string; name: string; room: string; total: number; count: number }>()
  for (const b of outstandingBills.value) {
    const key = b.tenant_id
    const existing = map.get(key)
    if (existing) {
      existing.total += Number(b.outstanding_amount)
      existing.count += 1
    } else {
      map.set(key, {
        tenant_id: key,
        name: b.tenant?.full_name || 'Unknown tenant',
        room: b.room?.room_number || '-',
        total: Number(b.outstanding_amount),
        count: 1,
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
})

const collectTotalAllocated = computed(() =>
  collectRows.value.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
)
const collectTotalOutstanding = computed(() =>
  collectRows.value.reduce((sum, r) => sum + Number(r.bill.outstanding_amount), 0)
)

async function loadPayments() {
  const { data } = await supabase
    .from('payments')
    .select('*, tenant:tenants(*), room:rooms(*), bill:bills(*)')
    .order('payment_date', { ascending: false })
  payments.value = data ?? []
}

async function loadOutstandingBills() {
  const { data } = await supabase
    .from('bills')
    .select('*, tenant:tenants(*), room:rooms(*)')
    .gt('outstanding_amount', 0)
    .eq('finalized', true)
    .order('billing_month', { ascending: false })
  outstandingBills.value = data ?? []
}

async function loadAll() {
  loading.value = true
  await Promise.all([loadPayments(), loadOutstandingBills()])
  loading.value = false
}

function openModal() {
  selectedBillId.value = ''
  form.amount = 0
  form.payment_date = new Date().toISOString().slice(0, 10)
  form.payment_method = 'cash'
  form.reference_number = ''
  form.notes = ''
  formError.value = ''
  showModal.value = true
}

function onBillChange() {
  if (selectedBill.value) form.amount = selectedBill.value.outstanding_amount
}

async function submitPayment() {
  formError.value = ''
  if (!selectedBill.value) {
    formError.value = 'Select a bill.'
    return
  }
  saving.value = true
  const { error } = await recordPayment(selectedBill.value, { ...form })
  saving.value = false
  if (error) {
    formError.value = error
    return
  }
  showModal.value = false
  await loadAll()
}

function exportCsv() {
  const header = ['Date', 'Tenant', 'Room', 'Bill Number', 'Amount', 'Method', 'Reference']
  const rows = payments.value.map((p) => [
    formatDate(p.payment_date),
    p.tenant?.full_name ?? '',
    p.room?.room_number ?? '',
    p.bill?.bill_number ?? '',
    p.amount,
    p.payment_method,
    p.reference_number ?? '',
  ])
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'payments.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function openCollectModal() {
  collectTenantId.value = ''
  collectRows.value = []
  collectTotalInput.value = 0
  collectForm.payment_date = new Date().toISOString().slice(0, 10)
  collectForm.payment_method = 'cash'
  collectForm.reference_number = ''
  collectForm.notes = ''
  collectError.value = ''
  showCollectModal.value = true
}

function onCollectTenantChange() {
  const bills = outstandingBills.value
    .filter((b) => b.tenant_id === collectTenantId.value)
    .sort((a, b) => a.billing_month.localeCompare(b.billing_month)) // oldest first
  collectRows.value = bills.map((bill) => ({ bill, amount: 0 }))
  collectTotalInput.value = 0
  collectError.value = ''
}

// Fills each unpaid bill's amount oldest-first, up to what it owes, until the entered total runs out.
// Rows stay individually editable afterward for manual adjustment.
function distributeOldestFirst() {
  let remaining = Math.round((Number(collectTotalInput.value) || 0) * 100) / 100
  for (const row of collectRows.value) {
    const owed = Number(row.bill.outstanding_amount)
    const alloc = Math.max(0, Math.min(owed, remaining))
    row.amount = Math.round(alloc * 100) / 100
    remaining = Math.round((remaining - alloc) * 100) / 100
  }
}

async function submitCollectPayment() {
  collectError.value = ''
  const rowsToApply = collectRows.value.filter((r) => Number(r.amount) > 0)
  if (rowsToApply.length === 0) {
    collectError.value = 'Enter an amount against at least one month.'
    return
  }
  for (const row of rowsToApply) {
    if (Number(row.amount) > Number(row.bill.outstanding_amount) + 0.01) {
      collectError.value = `Amount for ${formatMonth(row.bill.billing_month)} exceeds its outstanding balance of ${formatCurrency(row.bill.outstanding_amount)}.`
      return
    }
  }

  collectSaving.value = true
  for (const row of rowsToApply) {
    const { error } = await recordPayment(row.bill, {
      amount: Number(row.amount),
      payment_date: collectForm.payment_date,
      payment_method: collectForm.payment_method,
      reference_number: collectForm.reference_number,
      notes: collectForm.notes,
    })
    if (error) {
      collectError.value = `${formatMonth(row.bill.billing_month)}: ${error}`
      collectSaving.value = false
      await loadAll() // reflect whatever succeeded before the failure
      return
    }
  }
  collectSaving.value = false
  showCollectModal.value = false
  await loadAll()
}

onMounted(loadAll)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h1 class="text-lg font-semibold text-slate-800">Payments</h1>
      <div class="flex gap-2">
        <button class="btn-secondary" @click="exportCsv">Export CSV</button>
        <button class="btn-secondary" @click="openCollectModal">Collect Payment (multi-month)</button>
        <button class="btn-primary" @click="openModal">+ Record Payment</button>
      </div>
    </div>

    <p v-if="loading" class="text-sm text-slate-500">Loading…</p>

    <div v-else class="card overflow-x-auto">
      <table class="table-base">
        <thead>
          <tr><th>Date</th><th>Tenant</th><th>Room</th><th>Bill</th><th>Amount</th><th>Method</th><th>Reference</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in payments" :key="p.id">
            <td>{{ formatDate(p.payment_date) }}</td>
            <td>{{ p.tenant?.full_name }}</td>
            <td>{{ p.room?.room_number }}</td>
            <td>{{ p.bill?.bill_number }}</td>
            <td>{{ formatCurrency(p.amount) }}</td>
            <td class="capitalize">{{ p.payment_method.replace('_', ' ') }}</td>
            <td>{{ p.reference_number || '-' }}</td>
          </tr>
          <tr v-if="payments.length === 0">
            <td colspan="7" class="text-center text-slate-400 py-6">No payments recorded yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="showModal" title="Record Payment" @close="showModal = false">
      <form class="space-y-3" @submit.prevent="submitPayment">
        <div>
          <label class="label">Bill</label>
          <select v-model="selectedBillId" class="input" @change="onBillChange">
            <option value="">-- Select a bill with outstanding balance --</option>
            <option v-for="b in outstandingBills" :key="b.id" :value="b.id">
              {{ b.tenant?.full_name }} — Room {{ b.room?.room_number }} — {{ formatMonth(b.billing_month) }} — Due {{ formatCurrency(b.outstanding_amount) }}
            </option>
          </select>
        </div>
        <div v-if="selectedBill" class="flex justify-between text-sm text-slate-500">
          <span>Outstanding</span><span class="font-medium">{{ formatCurrency(selectedBill.outstanding_amount) }}</span>
        </div>
        <div>
          <label class="label">Amount (₹)</label>
          <input v-model.number="form.amount" type="number" min="0.01" step="0.01" class="input" />
        </div>
        <div>
          <label class="label">Payment Date</label>
          <input v-model="form.payment_date" type="date" class="input" />
        </div>
        <div>
          <label class="label">Payment Method</label>
          <select v-model="form.payment_method" class="input">
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label class="label">Reference Number</label>
          <input v-model="form.reference_number" class="input" placeholder="Optional" />
        </div>
        <div>
          <label class="label">Notes</label>
          <textarea v-model="form.notes" class="input" rows="2"></textarea>
        </div>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="btn-secondary" @click="showModal = false">Cancel</button>
          <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save Payment' }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="showCollectModal" title="Collect Payment (Multiple Months)" @close="showCollectModal = false">
      <form class="space-y-3" @submit.prevent="submitCollectPayment">
        <div>
          <label class="label">Tenant</label>
          <select v-model="collectTenantId" class="input" @change="onCollectTenantChange">
            <option value="">-- Select a tenant with unpaid bills --</option>
            <option v-for="t in tenantsWithOutstanding" :key="t.tenant_id" :value="t.tenant_id">
              {{ t.name }} — Room {{ t.room }} — {{ t.count }} month(s) owed — {{ formatCurrency(t.total) }}
            </option>
          </select>
        </div>

        <template v-if="collectRows.length > 0">
          <div class="flex items-end gap-2">
            <div class="flex-1">
              <label class="label">Total Amount Received (₹)</label>
              <input v-model.number="collectTotalInput" type="number" min="0" step="0.01" class="input" />
            </div>
            <button type="button" class="btn-secondary whitespace-nowrap" @click="distributeOldestFirst">
              Auto-fill oldest first
            </button>
          </div>

          <div class="border border-slate-200 rounded-md divide-y divide-slate-100">
            <div v-for="row in collectRows" :key="row.bill.id" class="flex items-center justify-between gap-3 px-3 py-2">
              <div class="text-sm">
                <p class="font-medium text-slate-700">{{ formatMonth(row.bill.billing_month) }}</p>
                <p class="text-xs text-slate-400">Outstanding {{ formatCurrency(row.bill.outstanding_amount) }}</p>
              </div>
              <input
                v-model.number="row.amount"
                type="number"
                min="0"
                step="0.01"
                class="input w-32 text-right"
              />
            </div>
          </div>

          <div class="flex justify-between text-sm bg-slate-50 rounded-md px-3 py-2">
            <span class="text-slate-500">Allocated / Total Owed</span>
            <span class="font-medium">{{ formatCurrency(collectTotalAllocated) }} / {{ formatCurrency(collectTotalOutstanding) }}</span>
          </div>

          <div>
            <label class="label">Payment Date</label>
            <input v-model="collectForm.payment_date" type="date" class="input" />
          </div>
          <div>
            <label class="label">Payment Method</label>
            <select v-model="collectForm.payment_method" class="input">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label class="label">Reference Number</label>
            <input v-model="collectForm.reference_number" class="input" placeholder="Optional" />
          </div>
          <div>
            <label class="label">Notes</label>
            <textarea v-model="collectForm.notes" class="input" rows="2"></textarea>
          </div>
        </template>

        <p v-if="collectError" class="text-sm text-red-600">{{ collectError }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="btn-secondary" @click="showCollectModal = false">Cancel</button>
          <button type="submit" class="btn-primary" :disabled="collectSaving || collectRows.length === 0">
            {{ collectSaving ? 'Saving…' : 'Save Payment(s)' }}
          </button>
        </div>
      </form>
    </Modal>
  </div>
</template>
