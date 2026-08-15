<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, formatMonth } from '../lib/format'
import { recordPayment } from '../lib/payments'
import { latestBillPerTenant } from '../lib/billing'
import type { Payment, Bill, PaymentMethod } from '../types/models'
import Modal from '../components/Modal.vue'

const payments = ref<Payment[]>([])
// Bill totals are cumulative, so only each tenant's most recent bill reflects
// what's actually still owed — see latestBillPerTenant. This list drives both
// the single "Record Payment" dropdown and the "Collect Payment" tenant picker.
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

// ---- Collect Payment (settle a tenant's full cumulative balance) ----
const showCollectModal = ref(false)
const collectTenantId = ref('')
const collectBill = ref<Bill | null>(null) // the tenant's one true payable (latest) bill
const collectChainBills = ref<Bill[]>([]) // earlier bills already folded into it, for preview
const collectAmount = ref(0)
const collectForm = reactive({
  payment_date: new Date().toISOString().slice(0, 10),
  payment_method: 'cash' as PaymentMethod,
  reference_number: '',
  notes: '',
})
const collectError = ref('')
const collectSaving = ref(false)
const collectLoadingChain = ref(false)

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
  collectBill.value = null
  collectChainBills.value = []
  collectAmount.value = 0
  collectForm.payment_date = new Date().toISOString().slice(0, 10)
  collectForm.payment_method = 'cash'
  collectForm.reference_number = ''
  collectForm.notes = ''
  collectError.value = ''
  showCollectModal.value = true
}

async function onCollectTenantChange() {
  collectError.value = ''
  collectBill.value = outstandingBills.value.find((b) => b.tenant_id === collectTenantId.value) || null
  collectAmount.value = collectBill.value?.outstanding_amount ?? 0
  collectChainBills.value = []
  if (!collectBill.value) return

  // Preview which earlier months are already folded into this balance and will
  // flip to "Paid" once this bill is settled in full.
  collectLoadingChain.value = true
  const { data } = await supabase
    .from('bills')
    .select('*')
    .eq('tenant_id', collectBill.value.tenant_id)
    .lt('billing_month', collectBill.value.billing_month)
    .neq('payment_status', 'paid')
    .order('billing_month', { ascending: true })
  collectChainBills.value = data ?? []
  collectLoadingChain.value = false
}

async function submitCollectPayment() {
  collectError.value = ''
  if (!collectBill.value) {
    collectError.value = 'Select a tenant.'
    return
  }
  if (!collectAmount.value || collectAmount.value <= 0) {
    collectError.value = 'Enter an amount greater than zero.'
    return
  }
  collectSaving.value = true
  const { error } = await recordPayment(collectBill.value, {
    amount: collectAmount.value,
    payment_date: collectForm.payment_date,
    payment_method: collectForm.payment_method,
    reference_number: collectForm.reference_number,
    notes: collectForm.notes,
  })
  collectSaving.value = false
  if (error) {
    collectError.value = error
    return
  }
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
        <button class="btn-secondary" @click="openCollectModal">Collect Payment (settle balance)</button>
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

    <Modal v-if="showCollectModal" title="Collect Payment" @close="showCollectModal = false">
      <form class="space-y-3" @submit.prevent="submitCollectPayment">
        <div>
          <label class="label">Tenant</label>
          <select v-model="collectTenantId" class="input" @change="onCollectTenantChange">
            <option value="">-- Select a tenant with an outstanding balance --</option>
            <option v-for="t in tenantsWithOutstanding" :key="t.tenant_id" :value="t.tenant_id">
              {{ t.name }} — Room {{ t.room }} — {{ formatCurrency(t.total) }} (as of {{ formatMonth(t.billing_month) }})
            </option>
          </select>
        </div>

        <template v-if="collectBill">
          <div class="flex justify-between text-sm bg-slate-50 rounded-md px-3 py-2">
            <span class="text-slate-500">Total Outstanding</span>
            <span class="font-medium">{{ formatCurrency(collectBill.outstanding_amount) }}</span>
          </div>

          <p v-if="collectLoadingChain" class="text-xs text-slate-400">Checking earlier months…</p>
          <div v-else-if="collectChainBills.length > 0" class="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
            This balance already includes carried-forward dues from
            <span class="font-medium">{{ collectChainBills.map(b => formatMonth(b.billing_month)).join(', ') }}</span>.
            Paying it in full will mark those months — and {{ formatMonth(collectBill.billing_month) }} — all as
            <span class="font-medium">Paid</span>.
          </div>

          <div>
            <label class="label">Amount Received (₹)</label>
            <input v-model.number="collectAmount" type="number" min="0.01" step="0.01" class="input" />
            <p class="text-xs text-slate-400 mt-1">
              Defaults to the full balance. A smaller amount will be applied but won't clear earlier months yet.
            </p>
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
          <button type="submit" class="btn-primary" :disabled="collectSaving || !collectBill">
            {{ collectSaving ? 'Saving…' : 'Save Payment' }}
          </button>
        </div>
      </form>
    </Modal>
  </div>
</template>
