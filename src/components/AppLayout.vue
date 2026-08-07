<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { signOut } = useAuth()
const mobileOpen = ref(false)

const nav = [
  { to: '/', label: 'Dashboard', icon: '🏠' },
  { to: '/rooms', label: 'Rooms', icon: '🏢' },
  { to: '/tenants', label: 'Tenants', icon: '👤' },
  { to: '/meter-readings', label: 'Meter Readings', icon: '⚡' },
  { to: '/bills', label: 'Bills', icon: '🧾' },
  { to: '/payments', label: 'Payments', icon: '💰' },
  { to: '/reports', label: 'Reports', icon: '📊' },
  { to: '/properties', label: 'Properties', icon: '🏘️' },
]

async function handleLogout() {
  await signOut()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 md:flex">
    <!-- Desktop sidebar -->
    <aside class="hidden md:flex md:w-56 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-200">
      <div class="px-4 py-4 border-b border-slate-200">
        <p class="font-semibold text-slate-800">Rental Manager</p>
      </div>
      <nav class="flex-1 overflow-y-auto py-2">
        <router-link
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-2 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          active-class="bg-brand-50 text-brand-700 font-medium"
          exact-active-class="bg-brand-50 text-brand-700 font-medium"
        >
          <span>{{ item.icon }}</span>{{ item.label }}
        </router-link>
      </nav>
      <button class="m-3 btn-secondary" @click="handleLogout">Logout</button>
    </aside>

    <!-- Mobile top bar -->
    <header class="md:hidden flex items-center justify-between bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
      <p class="font-semibold text-slate-800">Rental Manager</p>
      <button class="btn-secondary px-2 py-1" @click="mobileOpen = !mobileOpen">Menu</button>
    </header>
    <div v-if="mobileOpen" class="md:hidden bg-white border-b border-slate-200 px-2 py-2">
      <router-link
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="block px-3 py-2 rounded text-sm text-slate-600 hover:bg-slate-50"
        active-class="bg-brand-50 text-brand-700 font-medium"
        @click="mobileOpen = false"
      >
        {{ item.icon }} {{ item.label }}
      </router-link>
      <button class="w-full text-left px-3 py-2 rounded text-sm text-red-600 hover:bg-slate-50" @click="handleLogout">
        Logout
      </button>
    </div>

    <main class="flex-1 md:ml-56 p-4 md:p-6">
      <slot />
    </main>
  </div>
</template>
