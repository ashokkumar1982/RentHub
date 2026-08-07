import { ref } from 'vue'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const session = ref<Session | null>(null)
const ready = ref(false)

async function init() {
  const { data } = await supabase.auth.getSession()
  session.value = data.session
  ready.value = true
  supabase.auth.onAuthStateChange((_event, s) => {
    session.value = s
  })
}

async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

async function signOut() {
  await supabase.auth.signOut()
}

async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}#/reset-password`,
  })
  if (error) throw error
}

async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

export function useAuth() {
  return {
    session,
    ready,
    init,
    signIn,
    signOut,
    sendPasswordReset,
    updatePassword,
  }
}
