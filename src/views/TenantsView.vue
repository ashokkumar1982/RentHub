<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate } from '../lib/format'
import type { Tenant, Room, Property } from '../types/models'
import Modal from '../components/Modal.vue'

const tenants = ref<Tenant[]>([])
const rooms = ref<Room[]>([])
const properties = ref<Property[]>([])
const loading = ref(true)
const error = ref('')

const showModal = ref(false)
const editing = ref<Tenant | null>(null)
const viewing = ref<Tenant | null>(null)
const saving = ref(false)
const formError = ref('')
const idFile = ref<File | null>(null)
const rentTouchedManually = ref(false)

const emptyForm = () => ({
  full_name: '',
  mobile: '',
  whatsapp_number: '',
  email: '',
  id_type: '',
  id_number: '',
  address: '',
  emergency_contact_name: '',
  emergency_contact_number: '',
  room_id: '',
  move_in_date: '',
  security_deposit: 0,
  agreed_monthly_rent: 0,
  status: 'active' as 'active' | 'vacated',
  notes: '',
})
const form = reactive(emptyForm())

const selectedRoom = computed(() => rooms.value.find((r) => r.id === form.room_id) || null)

// Rooms available to pick: vacant rooms, plus the tenant's own current room when editing
const availableRooms = computed(() =>
  rooms.value.filter((r) => r.status === 'vacant' || r.id === editing.value?.room_id)
)

function onRoomChange() {
  if (!rentTouchedManually.value && selectedRoom.value) {
    form.agreed_monthly_rent = selectedRoom.value.monthly_rent
  }
}

function propertyName(propertyId: string) {
  return properties.value.find((p) => p.id === propertyId)?.name || ''
}

function roomLabel(room: Room) {
  return properties.value.length > 1 ? `${propertyName(room.property_id)} — ${room.room_number}` : room.room_number
}

async function loadData() {
  loading.value = true
  error.value = ''
  const [{ data: t, error: err1 }, { data: r, error: err2 }, { data: p }] = await Promise.all([
    supabase.from('tenants').select('*, room:rooms(*)').order('created_at', { ascending: false }),
    supabase.from('rooms').select('*').order('room_number'),
    supabase.from('properties').select('*').order('name'),
  ])
  if (err1) error.value = err1.message
  if (err2) error.value = err2.message
  tenants.value = t ?? []
  rooms.value = r ?? []
  properties.value = p ?? []
  loading.value = false
}

function openAdd() {
  editing.value = null
  Object.assign(form, emptyForm())
  rentTouchedManually.value = false
  idFile.value = null
  formError.value = ''
  showModal.value = true
}

function openEdit(tenant: Tenant) {
  editing.value = tenant
  Object.assign(form, {
    full_name: tenant.full_name,
    mobile: tenant.mobile,
    whatsapp_number: tenant.whatsapp_number,
    email: tenant.email ?? '',
    id_type: tenant.id_type ?? '',
    id_number: tenant.id_number ?? '',
    address: tenant.address ?? '',
    emergency_contact_name: tenant.emergency_contact_name ?? '',
    emergency_contact_number: tenant.emergency_contact_number ?? '',
    room_id: tenant.room_id ?? '',
    move_in_date: tenant.move_in_date ?? '',
    security_deposit: tenant.security_deposit,
    agreed_monthly_rent: tenant.agreed_monthly_rent,
    status: tenant.status,
    notes: tenant.notes ?? '',
  })
  rentTouchedManually.value = true // don't overwrite an existing agreed rent on open
  idFile.value = null
  formError.value = ''
  showModal.value = true
}

async function uploadIdDocument(tenantId: string): Promise<string | null> {
  if (!idFile.value) return null
  const ext = idFile.value.name.split('.').pop()
  const path = `${tenantId}/${Date.now()}.${ext}`
  const { error: err } = await supabase.storage.from('tenant-documents').upload(path, idFile.value, { upsert: true })
  if (err) {
    console.warn('ID document upload failed:', err.message)
    return null
  }
  return path
}

async function handleSave() {
  formError.value = ''
  if (!form.full_name.trim() || !form.mobile.trim() || !form.whatsapp_number.trim()) {
    formError.value = 'Full name, mobile and WhatsApp number are required.'
    return
  }
  saving.value = true

  const previousRoomId = editing.value?.room_id ?? null
  const payload: Record<string, unknown> = {
    full_name: form.full_name.trim(),
    mobile: form.mobile.trim(),
    whatsapp_number: form.whatsapp_number.trim(),
    email: form.email.trim() || null,
    id_type: form.id_type.trim() || null,
    id_number: form.id_number.trim() || null,
    address: form.address.trim() || null,
    emergency_contact_name: form.emergency_contact_name.trim() || null,
    emergency_contact_number: form.emergency_contact_number.trim() || null,
    room_id: form.room_id || null,
    move_in_date: form.move_in_date || null,
    security_deposit: Number(form.security_deposit) || 0,
    agreed_monthly_rent: Number(form.agreed_monthly_rent) || 0,
    status: form.status,
    notes: form.notes.trim() || null,
  }

  let tenantId = editing.value?.id
  const query = editing.value
    ? supabase.from('tenants').update(payload).eq('id', editing.value.id)
    : supabase.from('tenants').insert(payload).select().single()

  const { data, error: err } = await query
  if (err) {
    formError.value = err.message
    saving.value = false
    return
  }
  if (!editing.value && data) tenantId = (data as Tenant).id

  if (idFile.value && tenantId) {
    const path = await uploadIdDocument(tenantId)
    if (path) await supabase.from('tenants').update({ id_document_path: path }).eq('id', tenantId)
  }

  // Keep room status in sync with assignment
  const newRoomId = (payload.room_id as string) || null
  const isActive = form.status === 'active'
  if (newRoomId && isActive) {
    await supabase.from('rooms').update({ status: 'occupied' }).eq('id', newRoomId)
  }
  if (previousRoomId && previousRoomId !== newRoomId) {
    await supabase.from('rooms').update({ status: 'vacant' }).eq('id', previousRoomId)
  }
  if (previousRoomId && !isActive && previousRoomId === newRoomId) {
    await supabase.from('rooms').update({ status: 'vacant' }).eq('id', previousRoomId)
  }

  saving.value = false
  showModal.value = false
  await loadData()
}

onMounted(loadData)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-semibold text-slate-800">Tenants</h1>
      <button class="btn-primary" @click="openAdd">+ Add Tenant</button>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <p v-if="loading" class="text-sm text-slate-500">Loading…</p>

    <div v-else class="card overflow-x-auto">
      <table class="table-base">
        <thead>
          <tr>
            <th>Name</th>
            <th>Mobile</th>
            <th>Room</th>
            <th>Agreed Rent</th>
            <th>Move-in</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tenant in tenants" :key="tenant.id">
            <td class="font-medium">{{ tenant.full_name }}</td>
            <td>{{ tenant.mobile }}</td>
            <td>{{ tenant.room ? roomLabel(tenant.room) : '-' }}</td>
            <td>{{ formatCurrency(tenant.agreed_monthly_rent) }}</td>
            <td>{{ formatDate(tenant.move_in_date) }}</td>
            <td>
              <span class="badge" :class="tenant.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'">
                {{ tenant.status }}
              </span>
            </td>
            <td class="text-right space-x-2 whitespace-nowrap">
              <button class="text-brand-600 hover:underline text-xs" @click="viewing = tenant">View</button>
              <button class="text-brand-600 hover:underline text-xs" @click="openEdit(tenant)">Edit</button>
            </td>
          </tr>
          <tr v-if="tenants.length === 0">
            <td colspan="7" class="text-center text-slate-400 py-6">No tenants yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="showModal" :title="editing ? 'Edit Tenant' : 'Add Tenant'" @close="showModal = false">
      <form class="space-y-3" @submit.prevent="handleSave">
        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <label class="label">Full Name</label>
            <input v-model="form.full_name" class="input" />
          </div>
          <div>
            <label class="label">Mobile Number</label>
            <input v-model="form.mobile" class="input" />
          </div>
          <div>
            <label class="label">WhatsApp Number</label>
            <input v-model="form.whatsapp_number" class="input" placeholder="+91XXXXXXXXXX" />
          </div>
          <div class="col-span-2">
            <label class="label">Email (optional)</label>
            <input v-model="form.email" type="email" class="input" />
          </div>
          <div>
            <label class="label">ID Type</label>
            <input v-model="form.id_type" class="input" placeholder="Aadhaar / Passport / etc." />
          </div>
          <div>
            <label class="label">ID Number</label>
            <input v-model="form.id_number" class="input" />
          </div>
          <div class="col-span-2">
            <label class="label">Permanent Address</label>
            <textarea v-model="form.address" class="input" rows="2"></textarea>
          </div>
          <div>
            <label class="label">Emergency Contact Name</label>
            <input v-model="form.emergency_contact_name" class="input" />
          </div>
          <div>
            <label class="label">Emergency Contact Number</label>
            <input v-model="form.emergency_contact_number" class="input" />
          </div>
        </div>

        <hr class="border-slate-200" />

        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <label class="label">Room</label>
            <select v-model="form.room_id" class="input" @change="onRoomChange">
              <option value="">-- Unassigned --</option>
              <option v-for="r in availableRooms" :key="r.id" :value="r.id">
                {{ roomLabel(r) }} (default rent {{ formatCurrency(r.monthly_rent) }})
              </option>
            </select>
          </div>
          <div>
            <label class="label">Move-in Date</label>
            <input v-model="form.move_in_date" type="date" class="input" />
          </div>
          <div>
            <label class="label">Security Deposit (₹)</label>
            <input v-model.number="form.security_deposit" type="number" min="0" step="0.01" class="input" />
          </div>
          <div class="col-span-2">
            <label class="label">Agreed Monthly Rent (₹)</label>
            <input
              v-model.number="form.agreed_monthly_rent"
              type="number"
              min="0"
              step="0.01"
              class="input"
              @input="rentTouchedManually = true"
            />
            <p v-if="selectedRoom && form.agreed_monthly_rent !== selectedRoom.monthly_rent" class="text-xs text-amber-600 mt-1">
              Differs from room {{ selectedRoom.room_number }}'s default rent of {{ formatCurrency(selectedRoom.monthly_rent) }}.
              This tenant's bills will use {{ formatCurrency(form.agreed_monthly_rent) }}.
            </p>
          </div>
          <div class="col-span-2">
            <label class="label">Status</label>
            <select v-model="form.status" class="input">
              <option value="active">Active</option>
              <option value="vacated">Vacated</option>
            </select>
          </div>
          <div class="col-span-2">
            <label class="label">Notes</label>
            <textarea v-model="form.notes" class="input" rows="2"></textarea>
          </div>
          <div class="col-span-2">
            <label class="label">ID Proof Document (optional)</label>
            <input type="file" class="input" @change="(e) => (idFile = (e.target as HTMLInputElement).files?.[0] || null)" />
          </div>
        </div>

        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="btn-secondary" @click="showModal = false">Cancel</button>
          <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="viewing" title="Tenant Details" @close="viewing = null">
      <dl class="text-sm space-y-2">
        <div class="flex justify-between"><dt class="text-slate-500">Name</dt><dd class="font-medium">{{ viewing.full_name }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Mobile</dt><dd>{{ viewing.mobile }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">WhatsApp</dt><dd>{{ viewing.whatsapp_number }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Email</dt><dd>{{ viewing.email || '-' }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">ID</dt><dd>{{ viewing.id_type || '-' }} {{ viewing.id_number || '' }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Address</dt><dd class="text-right">{{ viewing.address || '-' }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Emergency Contact</dt><dd>{{ viewing.emergency_contact_name || '-' }} {{ viewing.emergency_contact_number || '' }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Room</dt><dd>{{ viewing.room ? roomLabel(viewing.room) : '-' }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Move-in Date</dt><dd>{{ formatDate(viewing.move_in_date) }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Security Deposit</dt><dd>{{ formatCurrency(viewing.security_deposit) }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Agreed Rent</dt><dd>{{ formatCurrency(viewing.agreed_monthly_rent) }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Status</dt><dd>{{ viewing.status }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Notes</dt><dd class="text-right">{{ viewing.notes || '-' }}</dd></div>
      </dl>
    </Modal>
  </div>
</template>
