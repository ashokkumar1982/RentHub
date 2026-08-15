export type RoomStatus = 'vacant' | 'occupied'
export type TenantStatus = 'active' | 'vacated'
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid'
export type PaymentMethod = 'cash' | 'upi' | 'bank_transfer' | 'other'

export interface Property {
  id: string
  name: string
  owner_name: string
  address: string | null
  mobile: string | null
  whatsapp: string | null
  upi_id: string | null
  payment_instructions: string | null
  bill_prefix: string
  due_day: number
  created_at: string
}

export interface Room {
  id: string
  property_id: string
  room_number: string
  monthly_rent: number
  electricity_rate: number
  water_charge: number
  maintenance_charge: number
  meter_number: string | null
  status: RoomStatus
  created_at: string
  // joined
  property?: Property
}

export interface Tenant {
  id: string
  full_name: string
  mobile: string
  whatsapp_number: string
  email: string | null
  id_type: string | null
  id_number: string | null
  address: string | null
  emergency_contact_name: string | null
  emergency_contact_number: string | null
  room_id: string | null
  move_in_date: string | null
  security_deposit: number
  agreed_monthly_rent: number
  status: TenantStatus
  notes: string | null
  id_document_path: string | null
  created_at: string
  // joined
  room?: Room
}

export interface MeterReading {
  id: string
  room_id: string
  tenant_id: string | null
  billing_month: string // 'YYYY-MM-01'
  previous_reading: number
  current_reading: number
  units: number
  rate: number
  amount: number
  created_at: string
}

export interface Bill {
  id: string
  bill_number: string
  billing_month: string
  room_id: string
  tenant_id: string
  rent: number
  previous_reading: number
  current_reading: number
  electricity_units: number
  electricity_rate: number
  electricity_amount: number
  water_charge: number
  maintenance_charge: number
  other_charge: number
  previous_due: number
  discount: number
  total_amount: number
  paid_amount: number
  outstanding_amount: number
  payment_status: PaymentStatus
  // true when this bill was auto-settled because a later, cumulative bill for
  // the same tenant was paid off (see settleEarlierBills in lib/payments.ts)
  settled_via_later_bill: boolean
  whatsapp_shared: boolean
  due_date: string | null
  finalized: boolean
  created_at: string
  // joined
  room?: Room
  tenant?: Tenant
}

export interface Payment {
  id: string
  bill_id: string
  tenant_id: string
  room_id: string
  payment_date: string
  amount: number
  payment_method: PaymentMethod
  reference_number: string | null
  notes: string | null
  created_at: string
  // joined
  bill?: Bill
  tenant?: Tenant
  room?: Room
}


