import type { Bill, Room, Tenant } from '../types/models'
import { formatCurrency, formatMonth } from './format'

export function buildBillMessage(bill: Bill, tenant: Tenant, room: Room): string {
  return [
    `Dear ${tenant.full_name},`,
    ``,
    `Your rent bill for ${formatMonth(bill.billing_month)} is ready.`,
    ``,
    `Room: ${room.room_number}`,
    `Rent: ${formatCurrency(bill.rent)}`,
    `Electricity: ${formatCurrency(bill.electricity_amount)}`,
    `Water: ${formatCurrency(bill.water_charge)}`,
    `Maintenance: ${formatCurrency(bill.maintenance_charge)}`,
    ...(bill.other_charge ? [`Other Charges: ${formatCurrency(bill.other_charge)}`] : []),
    ...(bill.previous_due ? [`Previous Due: ${formatCurrency(bill.previous_due)}`] : []),
    ...(bill.discount ? [`Discount: -${formatCurrency(bill.discount)}`] : []),
    ``,
    `Total: ${formatCurrency(bill.total_amount)}`,
    `Outstanding: ${formatCurrency(bill.outstanding_amount)}`,
    ``,
    `Please find your rent bill attached.`,
    `Thank you.`,
  ].join('\n')
}

// Normalizes a phone number to digits-only with a country code, default +91 (India).
export function normalizeWhatsAppNumber(raw: string, defaultCountryCode = '91'): string {
  let digits = raw.replace(/[^\d]/g, '')
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '')
  if (digits.length === 10) digits = defaultCountryCode + digits
  return digits
}

export function buildWhatsAppUrl(rawNumber: string, message: string): string {
  const number = normalizeWhatsAppNumber(rawNumber)
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}
