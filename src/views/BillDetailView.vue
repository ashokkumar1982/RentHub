<script setup lang="ts">
import { ref, onMounted, computed, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, formatMonth } from '../lib/format'
import { computeBillTotal, computeOutstanding, computePaymentStatus } from '../lib/billing'
import { recordPayment } from '../lib/payments'
import { buildBillMessage, buildWhatsAppUrl } from '../lib/whatsapp'
import { downloadBillPdf, printBillPdf, getBillPdfBlob } from '../lib/pdf'
import type { Bill, Room, Tenant, Property, Payment, PaymentMethod } from '../types/models'
import Modal from '../components/Modal.vue'

const route = useRoute()
const router = useRouter()
const billId = route.params.id as string

const bill = ref<Bill | null>(null)
const room = ref<Room | null>(null)
const tenant = ref<Tenant | null>(null)
const property = ref<Property | null>(null)
const payments = ref<Payment[]>([])
const loading = ref(true)
const error = ref('')
const saving = ref(false)

const editForm = reactive({
  rent: 0,
  electricity_amount: 0,
  water_charge: 0,
  maintenance_charge: 0,
  other_charge: 0,
  discount: 0,
})

const previewTotal = computed(() =>
  computeBillTotal({
    rent: editForm.rent,
    electricity_amount: editForm.electricity_amount,
    water_charge: editForm.water_charge,
    maintenance_charge: editForm.maintenance_charge,
    other_charge: editForm.other_charge,
    previous_due: bill.value?.previous_due ?? 0,
    discount: editForm.discount,
  })
)

async function load() {
  loading.value = true
  error.value = ''
  const { data, error: err } = await supabase.from('bills').select('*').eq('id', billId).single()
  if (err || !data) {
    error.value = err?.message || 'Bill not found.'
    loading.value = false
    return
  }
  bill.value = data
  Object.assign(editForm, {
    rent: data.rent,
    electricity_amount: data.electricity_amount,
    water_charge: data.water_charge,
    maintenance_charge: data.maintenance_charge,
    other_charge: data.other_charge,
    discount: data.discount,
  })

  const [{ data: r }, { data: t }, { data: p }] = await Promise.all([
    supabase.from('rooms').select('*').eq('id', data.room_id).single(),
    supabase.from('tenants').select('*').eq('id', data.tenant_id).single(),
    supabase.from('payments').select('*').eq('bill_id', billId).order('payment_date', { ascending: false }),
  ])
  room.value = r ?? null
  tenant.value = t ?? null
  payments.value = p ?? []

  if (room.value) {
    const { data: propData } = await supabase.from('properties').select('*').eq('id', room.value.property_id).single()
    property.value = propData ?? null
  }
  loading.value = false
}

onMounted(load)

async function handleSaveDraft() {
  if (!bill.value) return
  saving.value = true
  const total = previewTotal.value
  const payload = {
    rent: editForm.rent,
    electricity_amount: editForm.electricity_amount,
    water_charge: editForm.water_charge,
    maintenance_charge: editForm.maintenance_charge,
    other_charge: editForm.other_charge,
    discount: editForm.discount,
    total_amount: total,
    outstanding_amount: computeOutstanding(total, bill.value.paid_amount),
    payment_status: computePaymentStatus(total, bill.value.paid_amount),
  }
  const { error: err } = await supabase.from('bills').update(payload).eq('id', bill.value.id)
  saving.value = false
  if (err) {
    error.value = err.message
    return
  }
  await load()
}

async function handleFinalize() {
  if (!bill.value) return
  if (!confirm('Finalize this bill? Once finalized, the amounts are locked and will not change even if room or tenant rates change later.')) return
  await handleSaveDraft()
  const { error: err } = await supabase.from('bills').update({ finalized: true }).eq('id', bill.value.id)
  if (err) {
    error.value = err.message
    return
  }
  await load()
}

function handleDownloadPdf() {
  if (!bill.value || !tenant.value || !room.value) return
  downloadBillPdf(bill.value, tenant.value, room.value, property.value)
}

function handlePrintPdf() {
  if (!bill.value || !tenant.value || !room.value) return
  printBillPdf(bill.value, tenant.value, room.value, property.value)
}

async function handleWhatsApp() {
  if (!bill.value || !tenant.value || !room.value) return
  const message = buildBillMessage(bill.value, tenant.value, room.value)

  // On Android (Capacitor), share the actual PDF file straight to WhatsApp.
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem')
      const { Share } = await import('@capacitor/share')
      const blob = getBillPdfBlob(bill.value, tenant.value, room.value, property.value)
      const base64 = await blobToBase64(blob)
      const fileName = `${bill.value.bill_number}.pdf`
      await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache })
      const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache })
      await Share.share({ title: 'Rent Bill', text: message, url: uri, dialogTitle: 'Share bill' })
    } catch (e) {
      console.warn('Native share failed, falling back to WhatsApp web link.', e)
      window.open(buildWhatsAppUrl(tenant.value.whatsapp_number, message), '_blank')
    }
  } else {
    // Web: open WhatsApp with the message prefilled. Admin attaches the downloaded PDF manually.
    window.open(buildWhatsAppUrl(tenant.value.whatsapp_number, message), '_blank')
  }

  await supabase.from('bills').update({ whatsapp_shared: true }).eq('id', bill.value.id)
  if (bill.value) bill.value.whatsapp_shared = true
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// -------- Record payment --------
const showPaymentModal = ref(false)
const paymentForm = reactive({
  amount: 0,
  payment_date: new Date().toISOString().slice(0, 10),
  payment_method: 'cash' as PaymentMethod,
  reference_number: '',
  notes: '',
})
const paymentError = ref('')
const payingNow = ref(false)

function openPaymentModal() {
  paymentForm.amount = bill.value?.outstanding_amount ?? 0
  paymentForm.payment_date = new Date().toISOString().slice(0, 10)
  paymentForm.payment_method = 'cash'
  paymentForm.reference_number = ''
  paymentForm.notes = ''
  paymentError.value = ''
  showPaymentModal.value = true
}

async function submitPayment() {
  if (!bill.value) return
  paymentError.value = ''
  payingNow.value = true
  const { error: err } = await recordPayment(bill.value, { ...paymentForm })
  payingNow.value = false
  if (err) {
    paymentError.value = err
    return
  }
  showPaymentModal.value = false
  await load()
}
</script>

<template>
  <div class="space-y-4 max-w-2xl">
    <button class="text-sm text-brand-600 hover:underline" @click="router.push('/bills')">← Back to Bills</button>

    <p v-if="loading" class="text-sm text-slate-500">Loading…</p>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <template v-if="bill && room && tenant">
      <div class="card space-y-1">
        <div class="flex items-center justify-between">
          <h1 class="text-lg font-semibold text-slate-800">{{ bill.bill_number }}</h1>
          <span
            class="badge"
            :class="{
              'bg-slate-100 text-slate-500': !bill.finalized,
              'bg-green-100 text-green-700': bill.finalized && bill.payment_status === 'paid',
              'bg-amber-100 text-amber-700': bill.finalized && bill.payment_status === 'partially_paid',
              'bg-red-100 text-red-700': bill.finalized && bill.payment_status === 'unpaid',
            }"
          >
            {{ bill.finalized ? bill.payment_status.replace('_', ' ') : 'draft' }}
          </span>
        </div>
        <p class="text-sm text-slate-500">
          {{ tenant.full_name }} · Room {{ room.room_number }} · {{ formatMonth(bill.billing_month) }} · Due {{ formatDate(bill.due_date) }}
        </p>
      </div>

      <!-- Editable draft form -->
      <div v-if="!bill.finalized" class="card space-y-3">
        <h2 class="text-sm font-semibold text-slate-700">Edit before finalizing</h2>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Rent (₹)</label>
            <input v-model.number="editForm.rent" type="number" min="0" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Electricity Amount (₹)</label>
            <input v-model.number="editForm.electricity_amount" type="number" min="0" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Water (₹)</label>
            <input v-model.number="editForm.water_charge" type="number" min="0" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Maintenance (₹)</label>
            <input v-model.number="editForm.maintenance_charge" type="number" min="0" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Other Charge (₹)</label>
            <input v-model.number="editForm.other_charge" type="number" min="0" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Discount (₹)</label>
            <input v-model.number="editForm.discount" type="number" min="0" step="0.01" class="input" />
          </div>
        </div>
        <div class="flex justify-between text-sm text-slate-500">
          <span>Previous Due (locked)</span>
          <span>{{ formatCurrency(bill.previous_due) }}</span>
        </div>
        <div class="flex justify-between items-center bg-slate-50 rounded-md px-3 py-2">
          <span class="text-sm text-slate-600">Total</span>
          <span class="font-semibold text-lg text-slate-800">{{ formatCurrency(previewTotal) }}</span>
        </div>
        <div class="flex gap-2 justify-end">
          <button class="btn-secondary" :disabled="saving" @click="handleSaveDraft">Save Draft</button>
          <button class="btn-primary" :disabled="saving" @click="handleFinalize">Finalize</button>
        </div>
      </div>

      <!-- Finalized read-only summary -->
      <div v-else class="card space-y-2 text-sm">
        <div class="flex justify-between"><span class="text-slate-500">Rent</span><span>{{ formatCurrency(bill.rent) }}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Electricity ({{ bill.electricity_units }} units × {{ formatCurrency(bill.electricity_rate) }})</span><span>{{ formatCurrency(bill.electricity_amount) }}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Water</span><span>{{ formatCurrency(bill.water_charge) }}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Maintenance</span><span>{{ formatCurrency(bill.maintenance_charge) }}</span></div>
        <div v-if="bill.other_charge" class="flex justify-between"><span class="text-slate-500">Other Charges</span><span>{{ formatCurrency(bill.other_charge) }}</span></div>
        <div v-if="bill.previous_due" class="flex justify-between"><span class="text-slate-500">Previous Due</span><span>{{ formatCurrency(bill.previous_due) }}</span></div>
        <div v-if="bill.discount" class="flex justify-between"><span class="text-slate-500">Discount</span><span>-{{ formatCurrency(bill.discount) }}</span></div>
        <hr class="border-slate-200" />
        <div class="flex justify-between font-semibold text-base"><span>Total</span><span>{{ formatCurrency(bill.total_amount) }}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Paid</span><span>{{ formatCurrency(bill.paid_amount) }}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Outstanding</span><span>{{ formatCurrency(bill.outstanding_amount) }}</span></div>
      </div>

      <!-- Actions -->
      <div class="card flex flex-wrap gap-2">
        <button class="btn-secondary" @click="handleDownloadPdf">Download PDF</button>
        <button class="btn-secondary" @click="handlePrintPdf">Print</button>
        <button class="btn-secondary" @click="handleWhatsApp">
          Send WhatsApp {{ bill.whatsapp_shared ? '✓' : '' }}
        </button>
        <button v-if="bill.finalized && bill.outstanding_amount > 0" class="btn-primary" @click="openPaymentModal">
          Record Payment
        </button>
      </div>

      <!-- Payment history -->
      <div v-if="payments.length > 0" class="card overflow-x-auto">
        <h2 class="text-sm font-semibold text-slate-700 mb-2">Payments</h2>
        <table class="table-base">
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
          <tbody>
            <tr v-for="p in payments" :key="p.id">
              <td>{{ formatDate(p.payment_date) }}</td>
              <td>{{ formatCurrency(p.amount) }}</td>
              <td class="capitalize">{{ p.payment_method.replace('_', ' ') }}</td>
              <td>{{ p.reference_number || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <Modal v-if="showPaymentModal" title="Record Payment" @close="showPaymentModal = false">
        <form class="space-y-3" @submit.prevent="submitPayment">
          <div class="flex justify-between text-sm text-slate-500">
            <span>Outstanding</span><span class="font-medium">{{ formatCurrency(bill.outstanding_amount) }}</span>
          </div>
          <div>
            <label class="label">Amount (₹)</label>
            <input v-model.number="paymentForm.amount" type="number" min="0.01" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Payment Date</label>
            <input v-model="paymentForm.payment_date" type="date" class="input" />
          </div>
          <div>
            <label class="label">Payment Method</label>
            <select v-model="paymentForm.payment_method" class="input">
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label class="label">Reference Number</label>
            <input v-model="paymentForm.reference_number" class="input" placeholder="Optional" />
          </div>
          <div>
            <label class="label">Notes</label>
            <textarea v-model="paymentForm.notes" class="input" rows="2"></textarea>
          </div>
          <p v-if="paymentError" class="text-sm text-red-600">{{ paymentError }}</p>
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="btn-secondary" @click="showPaymentModal = false">Cancel</button>
            <button type="submit" class="btn-primary" :disabled="payingNow">{{ payingNow ? 'Saving…' : 'Save Payment' }}</button>
          </div>
        </form>
      </Modal>
    </template>
  </div>
</template>
