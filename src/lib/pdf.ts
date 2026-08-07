import { jsPDF } from 'jspdf'
import type { Bill, Room, Tenant, Property } from '../types/models'
import { formatDate, formatMonth } from './format'

// jsPDF's built-in fonts don't include the ₹ glyph, so PDFs use "Rs." while
// the on-screen UI and WhatsApp messages use the real ₹ symbol.
function rs(value: number): string {
  return 'Rs. ' + (value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

export function buildBillPdf(bill: Bill, tenant: Tenant, room: Room, property: Property | null): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const marginX = 15
  let y = 18

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('RENT BILL', marginX, y)
  y += 8

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(property?.name || 'Property', marginX, y)
  y += 5
  if (property?.owner_name) {
    doc.text(`Owner: ${property.owner_name}`, marginX, y)
    y += 5
  }
  if (property?.address) {
    doc.text(property.address, marginX, y)
    y += 5
  }

  y += 3
  doc.setDrawColor(200)
  doc.line(marginX, y, 195, y)
  y += 7

  doc.setFont('helvetica', 'bold')
  doc.text(`Bill No: ${bill.bill_number}`, marginX, y)
  doc.text(`Month: ${formatMonth(bill.billing_month)}`, 120, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.text(`Due Date: ${formatDate(bill.due_date)}`, marginX, y)
  doc.text(`Status: ${bill.payment_status.replace('_', ' ').toUpperCase()}`, 120, y)
  y += 8

  doc.setFont('helvetica', 'bold')
  doc.text('Tenant:', marginX, y)
  doc.setFont('helvetica', 'normal')
  doc.text(tenant.full_name, marginX + 20, y)
  doc.setFont('helvetica', 'bold')
  doc.text('Room:', 120, y)
  doc.setFont('helvetica', 'normal')
  doc.text(room.room_number, 140, y)
  y += 10

  const rows: [string, string][] = [
    ['Rent', rs(bill.rent)],
    ['Electricity — Previous Reading', String(bill.previous_reading)],
    ['Electricity — Current Reading', String(bill.current_reading)],
    ['Electricity — Units', String(bill.electricity_units)],
    ['Electricity — Rate', rs(bill.electricity_rate) + ' /unit'],
    ['Electricity Amount', rs(bill.electricity_amount)],
    ['Water Charge', rs(bill.water_charge)],
    ['Maintenance Charge', rs(bill.maintenance_charge)],
  ]
  if (bill.other_charge) rows.push(['Other Charges', rs(bill.other_charge)])
  if (bill.previous_due) rows.push(['Previous Due', rs(bill.previous_due)])
  if (bill.discount) rows.push(['Discount', '- ' + rs(bill.discount)])

  doc.setFontSize(10)
  for (const [label, value] of rows) {
    doc.text(label, marginX, y)
    doc.text(value, 150, y, { align: 'left' })
    y += 6
  }

  y += 2
  doc.setDrawColor(200)
  doc.line(marginX, y, 195, y)
  y += 8

  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('TOTAL AMOUNT', marginX, y)
  doc.text(rs(bill.total_amount), 150, y)
  y += 8

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Paid: ${rs(bill.paid_amount)}`, marginX, y)
  doc.text(`Outstanding: ${rs(bill.outstanding_amount)}`, 150, y)
  y += 12

  if (property?.mobile) {
    doc.text(`Contact: ${property.mobile}`, marginX, y)
    y += 6
  }
  if (property?.upi_id) {
    doc.text(`UPI ID: ${property.upi_id}`, marginX, y)
    y += 6
  }
  if (property?.payment_instructions) {
    doc.setFont('helvetica', 'italic')
    const lines = doc.splitTextToSize(property.payment_instructions, 180)
    doc.text(lines, marginX, y)
  }

  return doc
}

export function downloadBillPdf(bill: Bill, tenant: Tenant, room: Room, property: Property | null) {
  const doc = buildBillPdf(bill, tenant, room, property)
  doc.save(`${bill.bill_number}.pdf`)
}

export function printBillPdf(bill: Bill, tenant: Tenant, room: Room, property: Property | null) {
  const doc = buildBillPdf(bill, tenant, room, property)
  doc.autoPrint()
  window.open(doc.output('bloburl'), '_blank')
}

export function getBillPdfBlob(bill: Bill, tenant: Tenant, room: Room, property: Property | null): Blob {
  const doc = buildBillPdf(bill, tenant, room, property)
  return doc.output('blob')
}
