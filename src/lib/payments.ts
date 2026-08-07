import { supabase } from './supabase'
import { computeOutstanding, computePaymentStatus } from './billing'
import type { Bill, PaymentMethod } from '../types/models'

export async function recordPayment(
  bill: Bill,
  input: { amount: number; payment_date: string; payment_method: PaymentMethod; reference_number: string; notes: string }
): Promise<{ error?: string }> {
  if (input.amount <= 0) return { error: 'Amount must be greater than zero.' }

  const newPaidAmount = Math.round((bill.paid_amount + input.amount) * 100) / 100
  if (newPaidAmount > bill.total_amount + 0.01) {
    return { error: `Payment exceeds outstanding balance of ₹${bill.outstanding_amount}.` }
  }

  const { error: payError } = await supabase.from('payments').insert({
    bill_id: bill.id,
    tenant_id: bill.tenant_id,
    room_id: bill.room_id,
    payment_date: input.payment_date,
    amount: input.amount,
    payment_method: input.payment_method,
    reference_number: input.reference_number || null,
    notes: input.notes || null,
  })
  if (payError) return { error: payError.message }

  const newOutstanding = computeOutstanding(bill.total_amount, newPaidAmount)
  const newStatus = computePaymentStatus(bill.total_amount, newPaidAmount)

  const { error: billError } = await supabase
    .from('bills')
    .update({ paid_amount: newPaidAmount, outstanding_amount: newOutstanding, payment_status: newStatus })
    .eq('id', bill.id)
  if (billError) return { error: billError.message }

  return {}
}
