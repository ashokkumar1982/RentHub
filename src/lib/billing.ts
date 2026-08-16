// Single source of truth for the monthly bill total formula.
// Bill Amount = Rent + Electricity + Water + Maintenance + Other Charge - Discount.
// This is deliberately the CURRENT MONTH'S OWN CHARGES ONLY — it must never include
// previous_due. previous_due and outstanding_amount are tracked separately and are
// always recomputed by reconcileTenantBills (see lib/payments.ts) from the tenant's
// actual bill and payment history, never folded into this number.
export function computeBillTotal(parts: {
  rent: number
  electricity_amount: number
  water_charge: number
  maintenance_charge: number
  other_charge: number
  discount: number
}): number {
  const total =
    (parts.rent || 0) +
    (parts.electricity_amount || 0) +
    (parts.water_charge || 0) +
    (parts.maintenance_charge || 0) +
    (parts.other_charge || 0) -
    (parts.discount || 0)
  return Math.round(total * 100) / 100
}

export function computePaymentStatus(totalAmount: number, paidAmount: number): 'unpaid' | 'partially_paid' | 'paid' {
  const outstanding = Math.round((totalAmount - paidAmount) * 100) / 100
  if (outstanding <= 0) return 'paid'
  if (paidAmount > 0) return 'partially_paid'
  return 'unpaid'
}

export function computeOutstanding(totalAmount: number, paidAmount: number): number {
  const outstanding = Math.round((totalAmount - paidAmount) * 100) / 100
  return outstanding < 0 ? 0 : outstanding
}

// Core ledger rule (oldest-first allocation): given how much of a tenant's bill
// history comes BEFORE this month (cumulativeBilledBefore) and this month's own
// bill amount, returns how much of THIS month's own charge has been covered by a
// given cumulative amount received so far (totalReceivedAsOf). Payments always
// fill the oldest unpaid month first — a month can't receive anything until every
// month before it is fully covered, and a month that's already fully covered
// never receives more (so an already-paid month's amount is never carried
// forward again). Used by reconcileTenantBills (the live/authoritative pass) and
// by the Dashboard (to attribute a period's payments back to specific months).
export function allocatedForMonth(cumulativeBilledBefore: number, ownCharge: number, totalReceivedAsOf: number): number {
  const allocated = Math.min(Math.max(totalReceivedAsOf - cumulativeBilledBefore, 0), ownCharge)
  return Math.round(allocated * 100) / 100
}

// Bill totals are cumulative — each bill's total_amount already folds in every
// earlier unpaid month for that tenant via `previous_due`. So the most recent
// bill per tenant is the only one whose outstanding_amount reflects the real,
// current balance; older bills become redundant once a later bill has captured
// their due. Use this wherever bills are summed/listed as "outstanding", so the
// same rupee of debt is never counted once in an old bill and again in a new one.
export function latestBillPerTenant<T extends { tenant_id: string; billing_month: string }>(bills: T[]): T[] {
  const latest = new Map<string, T>()
  for (const b of bills) {
    const existing = latest.get(b.tenant_id)
    if (!existing || b.billing_month > existing.billing_month) {
      latest.set(b.tenant_id, b)
    }
  }
  return Array.from(latest.values())
}

// e.g. RENT-202608-101
export function generateBillNumber(prefix: string, billingMonth: string, roomNumber: string): string {
  const [yyyy, mm] = billingMonth.split('-')
  const safeRoom = roomNumber.replace(/\s+/g, '')
  return `${prefix}-${yyyy}${mm}-${safeRoom}`
}
