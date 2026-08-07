<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)
const mode = ref<'login' | 'forgot'>('login')
const resetSent = ref(false)

const router = useRouter()
const route = useRoute()
const { signIn, sendPasswordReset } = useAuth()

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    await signIn(email.value, password.value)
    const redirect = (route.query.redirect as string) || '/'
    router.push(redirect)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Login failed'
  } finally {
    loading.value = false
  }
}

async function handleForgot() {
  error.value = ''
  loading.value = true
  try {
    await sendPasswordReset(email.value)
    resetSent.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not send reset email'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
    <div class="card w-full max-w-sm">
      <h1 class="text-lg font-semibold text-slate-800 mb-1">Rental Manager</h1>
      <p class="text-sm text-slate-500 mb-4">
        {{ mode === 'login' ? 'Admin login' : 'Reset your password' }}
      </p>

      <form v-if="mode === 'login'" class="space-y-3" @submit.prevent="handleLogin">
        <div>
          <label class="label">Email</label>
          <input v-model="email" type="email" required class="input" placeholder="admin@example.com" />
        </div>
        <div>
          <label class="label">Password</label>
          <input v-model="password" type="password" required class="input" placeholder="••••••••" />
        </div>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <button type="submit" class="btn-primary w-full" :disabled="loading">
          {{ loading ? 'Signing in…' : 'Login' }}
        </button>
        <button type="button" class="text-sm text-brand-600 hover:underline block mx-auto" @click="mode = 'forgot'; error = ''">
          Forgot password?
        </button>
      </form>

      <form v-else class="space-y-3" @submit.prevent="handleForgot">
        <div>
          <label class="label">Email</label>
          <input v-model="email" type="email" required class="input" placeholder="admin@example.com" />
        </div>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <p v-if="resetSent" class="text-sm text-green-600">Reset link sent. Check your inbox.</p>
        <button type="submit" class="btn-primary w-full" :disabled="loading">
          {{ loading ? 'Sending…' : 'Send reset link' }}
        </button>
        <button type="button" class="text-sm text-slate-500 hover:underline block mx-auto" @click="mode = 'login'; error = ''">
          Back to login
        </button>
      </form>
    </div>
  </div>
</template>
