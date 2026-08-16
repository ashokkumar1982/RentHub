import { supabase } from './supabase'
import type { PaymentMethod } from '../types/models'

// Live preview of what a draft bill's previous_due WOULD be if finalized right
// now — used only for display while editing a draft (the authoritative value is
// written by reconcileTenantBills once the bill is actually finalized).
export async function previewPreviousDue(tenantId: string, billingMonth: string): Promise<number> {
  const { data: bills } = await supabase
    .from('bills')
    .select('total_amount')
    .eq('tenant_id', tenantId)
    .eq('finalized', true)
    .lt('billing_month', billingMonth)
  const cumulativeBilled = (bills ?? []).reduce((sum, b) => sum + Number(b.total_amount), 0)

  const { data: paymentRows } = await supabase.from('payments').select('amount').eq('tenant_id', tenantId)
  const totalReceived = (paymentRows ?? []).reduce((sum, p) => sum + Number(p.amount), 0)

  return Math.max(0, Math.round((cumulativeBilled - Math.min(totalReceived, cumulativeBilled)) * 100) / 100)
}

export async function recordPayment(
  tenantId: string,
  roomId: string,
  input: { amount: number; payment_date: string; payment_method: PaymentMethod; reference_number: string; notes: string }
): Promise<{ error?: string }> {
  if (input.amount <= 0) return { error: 'Amount must be greater than zero.' }

  // Anchor the payment to the tenant's latest finalized bill (for receipts/reference).
  // Which specific bill it's tagged to doesn't affect allocation — reconcileTenantBills
  // always re-derives every month's Paid/Outstanding from the full ledger below.
  const { data: latestBill, error: fetchErr } = await supabase
    .from('bills')
    .select('id, outstanding_amount')
    .eq('tenant_id', tenantId)
    .eq('finalized', true)
    .order('billing_month', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (fetchErr) return { error: fetchErr.message }
  if (!latestBill) return { error: 'No finalized bill found for this tenant.' }

  if (input.amount > Number(latestBill.outstanding_amount) + 0.01) {
    return { error: `Payment exceeds the total outstanding balance of ₹${latestBill.outstanding_amount}.` }
  }

  const { error: payError } = await supabase.from('payments').insert({
    bill_id: latestBill.id,
    tenant_id: tenantId,
    room_id: roomId,
    payment_date: input.payment_date,
    amount: input.amount,
    payment_method: input.payment_method,
    reference_number: input.reference_number || null,
    notes: input.notes || null,
  })
  if (payError) return { error: payError.message }

  const reconcileError = await reconcileTenantBills(tenantId)
  if (reconcileError) return { error: reconcileError }

  return {}
}

// Removes a payment (e.g. entered in error) and recalculates everything downstream.
export async function deletePayment(paymentId: string, tenantId: string): Promise<{ error?: string }> {
  const { error: delError } = await supabase.from('payments').delete().eq('id', paymentId)
  if (delError) return { error: delError.message }
  const reconcileError = await reconcileTenantBills(tenantId)
  if (reconcileError) return { error: reconcileError }
  return {}
}

// The single source of truth for a tenant's Bill Amount / Previous Due / Paid /
// Outstanding / Status across every one of their finalized bills.
//
// Rule: payments always fill the oldest unpaid month first. A month can't
// receive anything until every month before it is fully covered, and once a
// month is fully covered it is never touched again — its paid amount is never
// carried forward into a later month's balance a second time.
//
// This is re-run in full after every payment is added or deleted, so historical
// changes automatically ripple forward through every later month (per the
// "dynamic recalculation" requirement) — there's no separate cascade/patch path
// that can drift out of sync with reality.
export async function reconcileTenantBills(tenantId: string): Promise<string | undefined> {
  const { data: bills, error: billErr } = await supabase
    .from('bills')
    .select('id, billing_month, total_amount')
    .eq('tenant_id', tenantId)
    .eq('finalized', true)
    .order('billing_month', { ascending: true })
  if (billErr) return billErr.message

  const { data: paymentRows, error: payErr } = await supabase.from('payments').select('amount').eq('tenant_id', tenantId)
  if (payErr) return payErr.message
  const totalReceived = (paymentRows ?? []).reduce((sum, p) => sum + Number(p.amount), 0)

  let cumulativeBilled = 0 // total own-charges billed through the end of the PREVIOUS month
  let cumulativeAllocated = 0 // total payments allocated through the end of the PREVIOUS month

  const updates = (bills ?? []).map((b) => {
    const ownCharge = Number(b.total_amount)
    const previousDue = Math.round((cumulativeBilled - cumulativeAllocated) * 100) / 100

    const cumulativeBilledThroughThis = Math.round((cumulativeBilled + ownCharge) * 100) / 100
    const cumulativeAllocatedThroughThis = Math.min(totalReceived, cumulativeBilledThroughThis)
    const paidThisMonth = Math.round((cumulativeAllocatedThroughThis - cumulativeAllocated) * 100) / 100
    const outstanding = Math.round((cumulativeBilledThroughThis - cumulativeAllocatedThroughThis) * 100) / 100
    const status = outstanding <= 0 ? 'paid' : paidThisMonth > 0 ? 'partially_paid' : 'unpaid'

    cumulativeBilled = cumulativeBilledThroughThis
    cumulativeAllocated = cumulativeAllocatedThroughThis

    return supabase
      .from('bills')
      .update({
        previous_due: Math.max(0, previousDue),
        paid_amount: Math.max(0, paidThisMonth),
        outstanding_amount: Math.max(0, outstanding),
        payment_status: status,
      })
      .eq('id', b.id)
  })

  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  return failed?.error?.message
}
