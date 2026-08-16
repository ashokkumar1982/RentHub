<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/format'
import type { Room, Property } from '../types/models'
import Modal from '../components/Modal.vue'

const router = useRouter()
const rooms = ref<Room[]>([])
const properties = ref<Property[]>([])
const loading = ref(true)
const error = ref('')

const filterPropertyId = ref('') // '' = all properties
const filteredRooms = computed(() =>
  filterPropertyId.value ? rooms.value.filter((r) => r.property_id === filterPropertyId.value) : rooms.value
)

const showModal = ref(false)
const editing = ref<Room | null>(null)
const viewing = ref<Room | null>(null)
const deleting = ref<Room | null>(null)
const deleteError = ref('')
const deleteBusy = ref(false)
const saving = ref(false)
const formError = ref('')

const emptyForm = () => ({
  property_id: '',
  room_number: '',
  monthly_rent: 0,
  electricity_rate: 0,
  water_charge: 0,
  maintenance_charge: 0,
  meter_number: '',
  status: 'vacant' as 'vacant' | 'occupied',
})
const form = reactive(emptyForm())

function propertyName(id: string) {
  return properties.value.find((p) => p.id === id)?.name || '-'
}

async function loadData() {
  loading.value = true
  error.value = ''
  const [{ data: r, error: err1 }, { data: p, error: err2 }] = await Promise.all([
    supabase.from('rooms').select('*').order('room_number'),
    supabase.from('properties').select('*').order('name'),
  ])
  if (err1) error.value = err1.message
  if (err2) error.value = err2.message
  rooms.value = r ?? []
  properties.value = p ?? []
  loading.value = false
}

function openAdd() {
  if (properties.value.length === 0) {
    alert('Add a property first (Properties page) before adding rooms.')
    router.push('/properties')
    return
  }
  editing.value = null
  Object.assign(form, emptyForm())
  form.property_id = filterPropertyId.value || properties.value[0].id
  formError.value = ''
  showModal.value = true
}

function openEdit(room: Room) {
  editing.value = room
  Object.assign(form, {
    property_id: room.property_id,
    room_number: room.room_number,
    monthly_rent: room.monthly_rent,
    electricity_rate: room.electricity_rate,
    water_charge: room.water_charge,
    maintenance_charge: room.maintenance_charge,
    meter_number: room.meter_number ?? '',
    status: room.status,
  })
  formError.value = ''
  showModal.value = true
}

async function handleSave() {
  formError.value = ''
  if (!form.property_id) {
    formError.value = 'Select a property.'
    return
  }
  if (!form.room_number.trim()) {
    formError.value = 'Room number is required.'
    return
  }
  saving.value = true
  const payload = {
    property_id: form.property_id,
    room_number: form.room_number.trim(),
    monthly_rent: Number(form.monthly_rent) || 0,
    electricity_rate: Number(form.electricity_rate) || 0,
    water_charge: Number(form.water_charge) || 0,
    maintenance_charge: Number(form.maintenance_charge) || 0,
    meter_number: form.meter_number.trim() || null,
    status: form.status,
  }
  const query = editing.value
    ? supabase.from('rooms').update(payload).eq('id', editing.value.id)
    : supabase.from('rooms').insert(payload)
  const { error: err } = await query
  saving.value = false
  if (err) {
    formError.value = err.message.includes('duplicate')
      ? 'This room number already exists for the selected property.'
      : err.message
    return
  }
  showModal.value = false
  await loadData()
}

async function openDelete(room: Room) {
  deleteError.value = ''
  const { count } = await supabase.from('bills').select('id', { count: 'exact', head: true }).eq('room_id', room.id)
  if (count && count > 0) {
    deleteError.value = 'This room already has bills and cannot be deleted.'
  }
  deleting.value = room
}

async function handleDelete() {
  if (!deleting.value) return
  deleteBusy.value = true
  const { error: err } = await supabase.from('rooms').delete().eq('id', deleting.value.id)
  deleteBusy.value = false
  if (err) {
    deleteError.value = err.message
    return
  }
  deleting.value = null
  await loadData()
}

onMounted(loadData)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h1 class="text-lg font-semibold text-slate-800">Rooms</h1>
      <div class="flex gap-2">
        <select v-model="filterPropertyId" class="input w-auto">
          <option value="">All Properties</option>
          <option v-for="p in properties" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button class="btn-primary" @click="openAdd">+ Add Room</button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <p v-if="loading" class="text-sm text-slate-500">Loading…</p>
    <p v-if="!loading && properties.length === 0" class="text-sm text-amber-600">
      No properties yet. <router-link to="/properties" class="underline">Add one first</router-link>.
    </p>

    <div v-else-if="!loading" class="card overflow-x-auto">
      <table class="table-base">
        <thead>
          <tr>
            <th>Property</th>
            <th>Room #</th>
            <th>Rent</th>
            <th>Electricity Rate</th>
            <th>Water</th>
            <th>Maintenance</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="room in filteredRooms" :key="room.id">
            <td class="text-slate-500">{{ propertyName(room.property_id) }}</td>
            <td class="font-medium">{{ room.room_number }}</td>
            <td>{{ formatCurrency(room.monthly_rent) }}</td>
            <td>{{ formatCurrency(room.electricity_rate) }}/unit</td>
            <td>{{ formatCurrency(room.water_charge) }}</td>
            <td>{{ formatCurrency(room.maintenance_charge) }}</td>
            <td>
              <span
                class="badge"
                :class="room.status === 'occupied' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'"
              >
                {{ room.status }}
              </span>
            </td>
            <td class="text-right space-x-2 whitespace-nowrap">
              <button class="text-brand-600 hover:underline text-xs" @click="viewing = room">View</button>
              <button class="text-brand-600 hover:underline text-xs" @click="openEdit(room)">Edit</button>
              <button class="text-red-600 hover:underline text-xs" @click="openDelete(room)">Delete</button>
            </td>
          </tr>
          <tr v-if="filteredRooms.length === 0">
            <td colspan="8" class="text-center text-slate-400 py-6">No rooms yet. Click "Add Room" to create one.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Add/Edit modal -->
    <Modal v-if="showModal" :title="editing ? 'Edit Room' : 'Add Room'" @close="showModal = false">
      <form class="space-y-3" @submit.prevent="handleSave">
        <div>
          <label class="label">Property</label>
          <select v-model="form.property_id" class="input">
            <option v-for="p in properties" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div>
          <label class="label">Room Number</label>
          <input v-model="form.room_number" class="input" placeholder="101" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Monthly Rent (₹)</label>
            <input v-model.number="form.monthly_rent" type="number" min="0" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Electricity Rate (₹/unit)</label>
            <input v-model.number="form.electricity_rate" type="number" min="0" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Water Charge (₹)</label>
            <input v-model.number="form.water_charge" type="number" min="0" step="0.01" class="input" />
          </div>
          <div>
            <label class="label">Maintenance Charge (₹)</label>
            <input v-model.number="form.maintenance_charge" type="number" min="0" step="0.01" class="input" />
          </div>
        </div>
        <div>
          <label class="label">Electricity Meter Number</label>
          <input v-model="form.meter_number" class="input" placeholder="Optional" />
        </div>
        <div>
          <label class="label">Status</label>
          <select v-model="form.status" class="input">
            <option value="vacant">Vacant</option>
            <option value="occupied">Occupied</option>
          </select>
        </div>
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="btn-secondary" @click="showModal = false">Cancel</button>
          <button type="submit" class="btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
      </form>
    </Modal>

    <!-- View modal -->
    <Modal v-if="viewing" title="Room Details" @close="viewing = null">
      <dl class="text-sm space-y-2">
        <div class="flex justify-between"><dt class="text-slate-500">Property</dt><dd class="font-medium">{{ propertyName(viewing.property_id) }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Room Number</dt><dd class="font-medium">{{ viewing.room_number }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Monthly Rent</dt><dd>{{ formatCurrency(viewing.monthly_rent) }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Electricity Rate</dt><dd>{{ formatCurrency(viewing.electricity_rate) }}/unit</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Water Charge</dt><dd>{{ formatCurrency(viewing.water_charge) }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Maintenance Charge</dt><dd>{{ formatCurrency(viewing.maintenance_charge) }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Meter Number</dt><dd>{{ viewing.meter_number || '-' }}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">Status</dt><dd>{{ viewing.status }}</dd></div>
      </dl>
    </Modal>

    <Modal v-if="deleting" title="Delete Room" @close="deleting = null">
      <p v-if="!deleteError" class="text-sm text-slate-700">
        Are you sure you want to permanently delete room {{ deleting.room_number }}? This cannot be undone.
      </p>
      <p v-if="deleteError" class="text-sm text-red-600">{{ deleteError }}</p>
      <div class="flex justify-end gap-2 pt-4">
        <button type="button" class="btn-secondary" :disabled="deleteBusy" @click="deleting = null">
          {{ deleteError ? 'Close' : 'Cancel' }}
        </button>
        <button v-if="!deleteError" type="button" class="btn-danger" :disabled="deleteBusy" @click="handleDelete">
          {{ deleteBusy ? 'Deleting…' : 'Delete Permanently' }}
        </button>
      </div>
    </Modal>
  </div>
</template>
