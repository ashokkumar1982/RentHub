import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { layout: 'bare', public: true } },
  { path: '/reset-password', name: 'reset-password', component: () => import('../views/ResetPasswordView.vue'), meta: { layout: 'bare', public: true } },
  { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/rooms', name: 'rooms', component: () => import('../views/RoomsView.vue') },
  { path: '/tenants', name: 'tenants', component: () => import('../views/TenantsView.vue') },
  { path: '/meter-readings', name: 'meter-readings', component: () => import('../views/MeterReadingsView.vue') },
  { path: '/bills', name: 'bills', component: () => import('../views/BillsView.vue') },
  { path: '/bills/:id', name: 'bill-detail', component: () => import('../views/BillDetailView.vue') },
  { path: '/payments', name: 'payments', component: () => import('../views/PaymentsView.vue') },
  { path: '/reports', name: 'reports', component: () => import('../views/ReportsView.vue') },
  { path: '/properties', name: 'properties', component: () => import('../views/PropertiesView.vue') },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const { session, ready, init } = useAuth()
  if (!ready.value) {
    await init()
  }
  const isPublic = !!to.meta.public
  if (!isPublic && !session.value) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (isPublic && session.value && to.name === 'login') {
    return { name: 'dashboard' }
  }
  return true
})

export default router
