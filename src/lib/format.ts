export function formatCurrency(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (Number.isNaN(n)) return '₹0'
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })
}

// Accepts 'YYYY-MM-DD' or Date, returns 'DD-MM-YYYY'
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '-'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}-${mm}-${yyyy}`
}

// 'YYYY-MM-01' -> 'August 2026'
export function formatMonth(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

// Returns 'YYYY-MM-01' for the current month, or offset by `monthOffset`
export function currentBillingMonth(monthOffset = 0): string {
  const now = new Date()
  now.setMonth(now.getMonth() + monthOffset)
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}-01`
}

// Builds a list of the last `count` billing months (most recent first) as 'YYYY-MM-01'
export function recentBillingMonths(count = 12): string[] {
  const months: string[] = []
  for (let i = 0; i < count; i++) {
    months.push(currentBillingMonth(-i))
  }
  return months
}
