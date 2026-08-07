-- ============================================================
-- MIGRATION: single-property (settings table) -> multi-property
-- Run this ONCE if you already deployed the original V1 schema
-- and have existing data. Safe to run even if `settings` or
-- `properties` don't exist yet (guards included).
-- ============================================================

-- 1. Create the properties table (same shape as schema.sql)
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

alter table properties enable row level security;

drop policy if exists "authenticated full access" on properties;
create policy "authenticated full access" on properties
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 2. Migrate the old single settings row (if it exists) into the first property
do $$
declare
  old_settings record;
  new_property_id uuid;
begin
  if exists (select 1 from information_schema.tables where table_name = 'settings') then
    select * into old_settings from settings where id = 1;
    if old_settings is not null then
      insert into properties (name, owner_name, address, mobile, whatsapp, upi_id, payment_instructions, bill_prefix, due_day)
      values (
        coalesce(old_settings.property_name, 'My Property'),
        coalesce(old_settings.owner_name, ''),
        old_settings.address,
        old_settings.mobile,
        old_settings.whatsapp,
        old_settings.upi_id,
        old_settings.payment_instructions,
        coalesce(old_settings.bill_prefix, 'RENT'),
        coalesce(old_settings.due_day, 10)
      )
      returning id into new_property_id;
    end if;
  end if;

  -- If there was no settings row at all (fresh/never-configured install),
  -- create a placeholder property so existing rooms have somewhere to attach.
  if new_property_id is null then
    insert into properties (name, owner_name)
    values ('My Property', '')
    returning id into new_property_id;
  end if;

  -- 3. Add property_id to rooms and backfill every existing room to this property
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'rooms' and column_name = 'property_id'
  ) then
    alter table rooms add column property_id uuid references properties(id) on delete restrict;
  end if;

  update rooms set property_id = new_property_id where property_id is null;

  alter table rooms alter column property_id set not null;

  -- 4. Room numbers are now unique per-property instead of globally unique
  if exists (
    select 1 from pg_constraint where conname = 'rooms_room_number_key'
  ) then
    alter table rooms drop constraint rooms_room_number_key;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'rooms_property_id_room_number_key'
  ) then
    alter table rooms add constraint rooms_property_id_room_number_key unique (property_id, room_number);
  end if;

  create index if not exists idx_rooms_property_id on rooms(property_id);
end $$;

-- 5. Drop the old settings table once you've confirmed the migration looks right.
-- (Left commented out on purpose — verify your data in `properties` first.)
-- drop table if exists settings;
