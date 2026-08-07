<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue'
import { supabase } from '../lib/supabase'
import type { Property } from '../types/models'
import Modal from '../components/Modal.vue'

const properties = ref<Property[]>([])
const loading = ref(true)
const error = ref('')

const showModal = ref(false)
const editing = ref<Property | null>(null)
const saving = ref(false)
const formError = ref('')

const emptyForm = () => ({
  name: '',
  owner_name: '',
  address: '',
  mobile: '',
  whatsapp: '',
  upi_id: '',
  payment_instructions: '',
  bill_prefix: 'RENT',
  due_day: 10,
})
const form = reactive(emptyForm())

async function loadProperties() {
  loading.value = true
  error.value = ''
  const { data, error: err } = await supabase.from('properties').select('*').order('name')
  if (err) error.value = err.message
  properties.value = data ?? []
  loading.value = false
}

function openAdd() {
  editing.value = null
  Object.assign(form, emptyForm())
  formError.value = ''
  showModal.value = true
}

function openEdit(property: Property) {
  editing.value = property
  Object.assign(form, {
    name: property.name,
    owner_name: property.owner_name,
    address: property.address ?? '',
    mobile: property.mobile ?? '',
    whatsapp: property.whatsapp ?? '',
    upi_id: property.upi_id ?? '',
    payment_instructions: property.payment_instructions ?? '',
    bill_prefix: property.bill_prefix,
    due_day: property.due_day,
  })
  formError.value = ''
  showModal.value = true
}

async function handleSave() {
  formError.value = ''
  if (!form.name.trim()) {
    formError.value = 'Property name is required.'
    return
  }
  saving.value = true
  const payload = {
    name: form.name.trim(),
    owner_name: form.owner_name.trim(),
    address: form.address.trim() || null,
    mobile: form.mobile.trim() || null,
    whatsapp: form.whatsapp.trim() || null,
    upi_id: form.upi_id.trim() || null,
    payment_instructions: form.payment_instructions.trim() || null,
    bill_prefix: form.bill_prefix.trim() || 'RENT',
    due_day: Number(form.due_day) || 10,
  }
  const query = editing.value
    ? supabase.from('properties').update(payload).eq('id', editing.value.id)
    : supabase.from('properties').insert(payload)
  const { error: err } = await query
  saving.value = false
  if (err) {
    formError.value = err.message
    return
  }
  showModal.value = false
  await loadProperties()
}

async function handleDelete(property: Property) {
  const { count } = await supabase.from('rooms').select('id', { count: 'exact', head: true }).eq('property_id', property.id)
  if (count && count > 0) {
    alert('This property has rooms and cannot be deleted. Remove or reassign its rooms first.')
    return
  }
  if (!confirm(`Delete property "${property.name}"?`)) return
  const { error: err } = await supabase.from('properties').delete().eq('id', property.id)
  if (err) alert(err.message)
  else await loadProperties()
}

onMounted(loadProperties)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-semibold text-slate-800">Properties</h1>
      <button class="btn-primary" @click="openAdd">+ Add Property</button>
    </div>
    <p class="text-sm text-slate-500">
      Each property is a separate location with its own contact details, UPI ID, bill prefix, and due day. Rooms are assigned to a property on the Rooms page.
    </p>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <p v-if="loading" class="text-sm text-slate-500">Loading…</p>

    <div v-else class="grid gap-3 md:grid-cols-2">
      <div v-for="p in properties" :key="p.id" class="card space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-slate-800">{{ p.name }}</h2>
          <div class="space-x-2">
            <button class="text-brand-600 hover:underline text-xs" @click="openEdit(p)">Edit</button>
            <button class="text-red-600 hover:underline text-xs" @click="handleDelete(p)">Delete</button>
          </div>
        </div>
        <p class="text-sm text-slate-500">Owner: {{ p.owner_name || '-' }}</p>
        <p class="text-sm text-slate-500">{{ p.address || 'No address set' }}</p>
        <p class="text-sm text-slate-500">Mobile: {{ p.mobile || '-' }} · WhatsApp: {{ p.whatsapp || '-' }}</p>
        <p class="text-sm text-slate-500">UPI: {{ p.upi_id || '-' }}</p>
        <p class="text-xs text-slate-400">Bill Prefix: {{ p.bill_prefix }} · Due Day: {{ p.due_day }}</p>
      </div>
      <div v-if="properties.length === 0" class="text-center text-slate-400 py-10 md:col-span-2">
        No properties yet. Click "Add Property" to create your first location.
      </div>
    </div>

    <div class="text-xs text-slate-400">
      Currency: INR (₹) · Country Code: +91 · Date format: DD-MM-YYYY (fixed defaults for all properties)
    </div>

    <Modal v-if="showModal" :title="editing ? 'Edit Property' : 'Add Property'" @close="showModal = false">
      <form class="space-y-3" @submit.prevent="handleSave">
        <div>
          <label class="label">Property Name</label>
          <input v-model="form.name" class="input" placeholder="e.g. Main Street Apartments" />
        </div>
        <div>
          <label class="label">Owner Name</label>
          <input v-model="form.owner_name" class="input" />
        </div>
        <div>
          <label class="label">Address</label>
          <textarea v-model="form.address" class="input" rows="2"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Mobile Number</label>
            <input v-model="form.mobile" class="input" placeholder="+91XXXXXXXXXX" />
          </div>
          <div>
            <label class="label">WhatsApp Number</label>
            <input v-model="form.whatsapp" class="input" placeholder="+91XXXXXXXXXX" />
          </div>
        </div>
        <div>
          <label class="label">UPI ID</label>
          <input v-model="form.upi_id" class="input" placeholder="name@bank" />
        </div>
        <div>
          <label class="label">Payment Instructions</label>
          <textarea v-model="form.payment_instructions" class="input" rows="3" placeholder="e.g. Pay via UPI or cash before the due date." />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Bill Number Prefix</label>
            <input v-model="form.bill_prefix" class="input" placeholder="RENT" />
          </div>
          <div>
            <label class="label">Default Due Day (of month)</label>
            <input v-model.number="form.due_day" type="number" min="1" max="28" class="input" />
          </div>
        </div>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="btn-secondary" @click="showModal = false">Cancel</button>
          <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
      </form>
    </Modal>
  </div>
</template>
