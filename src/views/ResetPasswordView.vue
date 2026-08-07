<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const password = ref('')
const confirm = ref('')
const error = ref('')
const done = ref(false)
const loading = ref(false)
const { updatePassword } = useAuth()
const router = useRouter()

async function handleSubmit() {
  error.value = ''
  if (password.value.length < 6) {
    error.value = 'Password must be at least 6 characters.'
    return
  }
  if (password.value !== confirm.value) {
    error.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  try {
    await updatePassword(password.value)
    done.value = true
    setTimeout(() => router.push('/'), 1500)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not update password'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
    <div class="card w-full max-w-sm">
      <h1 class="text-lg font-semibold text-slate-800 mb-4">Set a new password</h1>
      <form v-if="!done" class="space-y-3" @submit.prevent="handleSubmit">
        <div>
          <label class="label">New password</label>
          <input v-model="password" type="password" required class="input" />
        </div>
        <div>
          <label class="label">Confirm password</label>
          <input v-model="confirm" type="password" required class="input" />
        </div>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
        <button type="submit" class="btn-primary w-full" :disabled="loading">
          {{ loading ? 'Saving…' : 'Update password' }}
        </button>
      </form>
      <p v-else class="text-sm text-green-600">Password updated. Redirecting…</p>
    </div>
  </div>
</template>
