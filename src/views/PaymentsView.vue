<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, formatMonth } from '../lib/format'
import { recordPayment, deletePayment } from '../lib/payments'
import { latestBillPerTenant } from '../lib/billing'
import type { Payment, Bill, PaymentMethod } from '../types/models'
import Modal from '../components/Modal.vue'

const payments = ref<Payment[]>([])
// A tenant's true outstanding balance always lives on their most recent bill
// (every earlier month's own balance is already folded into it) — see
// latestBillPerTenant. This is the only list of "who currently owes what".
const outstandingBills = ref<Bill[]>([])
const loading = ref(true)

const showModal = ref(false)
const selectedTenantId = ref('')
const selectedBill = computed(() => outstandingBills.value.find((b) => b.tenant_id === selectedTenantId.value) || null)
const form = reactive({
  amount: 0,
  payment_date: new Date().toISOString().slice(0, 10),
  payment_method: 'cash' as PaymentMethod,
  reference_number: '',
  notes: '',
})
const formError = ref('')
const saving = ref(false)

const tenantsWithOutstanding = computed(() =>
  [...outstandingBills.value]
    .map((b) => ({
      tenant_id: b.tenant_id,
      name: b.tenant?.full_name || 'Unknown tenant',
      room: b.room?.room_number || '-',
      total: Number(b.outstanding_amount),
      billing_month: b.billing_month,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
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
  outstandingBills.value = latestBillPerTenant(data ?? [])
}

async function loadAll() {
  loading.value = true
  await Promise.all([loadPayments(), loadOutstandingBills()])
  loading.value = false
}

function openModal() {
  selectedTenantId.value = ''
  form.amount = 0
  form.payment_date = new Date().toISOString().slice(0, 10)
  form.payment_method = 'cash'
  form.reference_number = ''
  form.notes = ''
  formError.value = ''
  showModal.value = true
}

function onTenantChange() {
  if (selectedBill.value) form.amount = selectedBill.value.outstanding_amount
}

async function submitPayment() {
  formError.value = ''
  if (!selectedBill.value) {
    formError.value = 'Select a tenant.'
    return
  }
  if (!form.amount || form.amount <= 0) {
    formError.value = 'Enter an amount greater than zero.'
    return
  }
  saving.value = true
  const { error } = await recordPayment(selectedBill.value.tenant_id, selectedBill.value.room_id, { ...form })
  saving.value = false
  if (error) {
    formError.value = error
    return
  }
  showModal.value = false
  await loadAll()
}

// ---- Delete a payment (with recalculation) ----
const deletingPayment = ref<Payment | null>(null)
const deletePaymentBusy = ref(false)
const deletePaymentError = ref('')

async function confirmDeletePayment() {
  if (!deletingPayment.value) return
  deletePaymentBusy.value = true
  deletePaymentError.value = ''
  const { error } = await deletePayment(deletingPayment.value.id, deletingPayment.value.tenant_id)
  deletePaymentBusy.value = false
  if (error) {
    deletePaymentError.value = error
    return
  }
  deletingPayment.value = null
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

onMounted(loadAll)
</script>
<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h1 class="text-lg font-semibold text-slate-800">Payments</h1>
      <div class="flex gap-2">
        <button class="btn-secondary" @click="exportCsv">Export CSV</button>
        <button class="btn-primary" @click="openModal">+ Record Payment</button>
      </div>
    </div>

    <p v-if="loading" class="text-sm text-slate-500">Loading…</p>

    <div v-else class="card overflow-x-auto">
      <table class="table-base">
        <thead>
          <tr><th>Date</th><th>Tenant</th><th>Room</th><th>Bill</th><th>Amount</th><th>Method</th><th>Reference</th><th></th></tr>
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
            <td class="text-right">
              <button class="text-red-600 hover:underline text-xs" @click="deletingPayment = p">Delete</button>
            </td>
          </tr>
          <tr v-if="payments.length === 0">
            <td colspan="8" class="text-center text-slate-400 py-6">No payments recorded yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="showModal" title="Record Payment" @close="showModal = false">
      <form class="space-y-3" @submit.prevent="submitPayment">
        <div>
          <label class="label">Tenant</label>
          <select v-model="selectedTenantId" class="input" @change="onTenantChange">
            <option value="">-- Select a tenant with an outstanding balance --</option>
            <option v-for="t in tenantsWithOutstanding" :key="t.tenant_id" :value="t.tenant_id">
              {{ t.name }} — Room {{ t.room }} — {{ formatCurrency(t.total) }} owed (as of {{ formatMonth(t.billing_month) }})
            </option>
          </select>
        </div>
        <template v-if="selectedBill">
          <div class="flex justify-between text-sm bg-slate-50 rounded-md px-3 py-2">
            <span class="text-slate-500">Total Outstanding</span>
            <span class="font-medium">{{ formatCurrency(selectedBill.outstanding_amount) }}</span>
          </div>
          <p class="text-xs text-slate-400">
            Applied to the oldest unpaid month first. A partial amount will close whichever months it fully covers and
            leave the remainder on the next one — it can't be targeted at a specific month.
          </p>
        </template>
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

    <Modal v-if="deletingPayment" title="Delete Payment" @close="deletingPayment = null">
      <p class="text-sm text-slate-700">
        Delete this {{ formatCurrency(deletingPayment.amount) }} payment from {{ formatDate(deletingPayment.payment_date) }}
        ({{ deletingPayment.tenant?.full_name }})? Every month's balance for this tenant will be recalculated afterward.
      </p>
      <p v-if="deletePaymentError" class="text-sm text-red-600 mt-2">{{ deletePaymentError }}</p>
      <div class="flex justify-end gap-2 pt-4">
        <button type="button" class="btn-secondary" :disabled="deletePaymentBusy" @click="deletingPayment = null">Cancel</button>
        <button type="button" class="btn-danger" :disabled="deletePaymentBusy" @click="confirmDeletePayment">
          {{ deletePaymentBusy ? 'Deleting…' : 'Delete Payment' }}
        </button>
      </div>
    </Modal>
  </div>
</template>
