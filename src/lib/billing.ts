// Single source of truth for the monthly bill total formula.
// Total = Rent + Electricity + Water + Maintenance + Other Charge + Previous Due - Discount
export function computeBillTotal(parts: {
  rent: number
  electricity_amount: number
  water_charge: number
  maintenance_charge: number
  other_charge: number
  previous_due: number
  discount: number
}): number {
  const total =
    (parts.rent || 0) +
    (parts.electricity_amount || 0) +
    (parts.water_charge || 0) +
    (parts.maintenance_charge || 0) +
    (parts.other_charge || 0) +
    (parts.previous_due || 0) -
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

// e.g. RENT-202608-101
export function generateBillNumber(prefix: string, billingMonth: string, roomNumber: string): string {
  const [yyyy, mm] = billingMonth.split('-')
  const safeRoom = roomNumber.replace(/\s+/g, '')
  return `${prefix}-${yyyy}${mm}-${safeRoom}`
}
