-- ============================================================
-- Rental Management System — Supabase schema (Version 1)
-- Run this once in Supabase SQL Editor (or via `supabase db push`)
-- ============================================================

-- ---------- PROPERTIES (multi-location support) ----------
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_name text not null default '',
  address text,
  mobile text,
  whatsapp text,
  upi_id text,
  payment_instructions text,
  bill_prefix text not null default 'RENT',
  due_day int not null default 10 check (due_day between 1 and 28),
  created_at timestamptz not null default now()
);

-- ---------- ROOMS ----------
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete restrict,
  room_number text not null,
  monthly_rent numeric(10,2) not null check (monthly_rent >= 0),
  electricity_rate numeric(10,2) not null default 0 check (electricity_rate >= 0),
  water_charge numeric(10,2) not null default 0 check (water_charge >= 0),
  maintenance_charge numeric(10,2) not null default 0 check (maintenance_charge >= 0),
  meter_number text,
  status text not null default 'vacant' check (status in ('vacant','occupied')),
  created_at timestamptz not null default now(),
  unique (property_id, room_number)
);

create index if not exists idx_rooms_property_id on rooms(property_id);

-- ---------- TENANTS ----------
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  mobile text not null,
  whatsapp_number text not null,
  email text,
  id_type text,
  id_number text,
  address text,
  emergency_contact_name text,
  emergency_contact_number text,
  room_id uuid references rooms(id) on delete set null,
  move_in_date date,
  security_deposit numeric(10,2) not null default 0 check (security_deposit >= 0),
  agreed_monthly_rent numeric(10,2) not null default 0 check (agreed_monthly_rent >= 0),
  status text not null default 'active' check (status in ('active','vacated')),
  notes text,
  id_document_path text,
  created_at timestamptz not null default now()
);

create index if not exists idx_tenants_room_id on tenants(room_id);

-- ---------- METER READINGS ----------
create table if not exists meter_readings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete restrict,
  tenant_id uuid references tenants(id) on delete set null,
  billing_month date not null, -- always stored as the 1st of the month
  previous_reading numeric(10,2) not null check (previous_reading >= 0),
  current_reading numeric(10,2) not null check (current_reading >= previous_reading),
  units numeric(10,2) not null check (units >= 0),
  rate numeric(10,2) not null check (rate >= 0),
  amount numeric(10,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (room_id, billing_month)
);

-- ---------- BILLS ----------
create table if not exists bills (
  id uuid primary key default gen_random_uuid(),
  bill_number text not null unique,
  billing_month date not null,
  room_id uuid not null references rooms(id) on delete restrict,
  tenant_id uuid not null references tenants(id) on delete restrict,
  rent numeric(10,2) not null default 0,
  previous_reading numeric(10,2) not null default 0,
  current_reading numeric(10,2) not null default 0,
  electricity_units numeric(10,2) not null default 0,
  electricity_rate numeric(10,2) not null default 0,
  electricity_amount numeric(10,2) not null default 0,
  water_charge numeric(10,2) not null default 0,
  maintenance_charge numeric(10,2) not null default 0,
  other_charge numeric(10,2) not null default 0,
  previous_due numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  total_amount numeric(10,2) not null default 0,
  paid_amount numeric(10,2) not null default 0,
  outstanding_amount numeric(10,2) not null default 0,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid')),
  whatsapp_shared boolean not null default false,
  due_date date,
  finalized boolean not null default false,
  created_at timestamptz not null default now(),
  unique (room_id, tenant_id, billing_month)
);

create index if not exists idx_bills_room_month on bills(room_id, billing_month);
create index if not exists idx_bills_tenant on bills(tenant_id);

-- ---------- PAYMENTS ----------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete restrict,
  room_id uuid not null references rooms(id) on delete restrict,
  payment_date date not null default current_date,
  amount numeric(10,2) not null check (amount > 0),
  payment_method text not null default 'cash' check (payment_method in ('cash','upi','bank_transfer','other')),
  reference_number text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_bill on payments(bill_id);

-- Settings/property details now live per-property in the `properties` table above.

-- ============================================================
-- ROW LEVEL SECURITY
-- Only authenticated users (the admin) can read/write any data.
-- ============================================================

alter table properties enable row level security;
alter table rooms enable row level security;
alter table tenants enable row level security;
alter table meter_readings enable row level security;
alter table bills enable row level security;
alter table payments enable row level security;

create policy "authenticated full access" on properties
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access" on rooms
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access" on tenants
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access" on meter_readings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access" on bills
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated full access" on payments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- STORAGE (optional — for tenant ID document uploads)
-- Run separately or via Dashboard: create a bucket named
-- 'tenant-documents' and mark it private, then apply this policy.
-- ============================================================
-- insert into storage.buckets (id, name, public) values ('tenant-documents', 'tenant-documents', false)
--   on conflict (id) do nothing;
--
-- create policy "authenticated access to tenant documents"
--   on storage.objects for all
--   using (bucket_id = 'tenant-documents' and auth.role() = 'authenticated')
--   with check (bucket_id = 'tenant-documents' and auth.role() = 'authenticated');
