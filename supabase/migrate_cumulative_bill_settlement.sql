-- ============================================================================
-- Fixes cumulative-bill double counting.
--
-- Background: every bill's total_amount already folds in all earlier unpaid
-- months via `previous_due` (e.g. August's total = August's own charges +
-- July's outstanding, and July's total already included June's outstanding).
-- So the LATEST bill's outstanding_amount is the true amount a tenant owes —
-- older bills' own outstanding_amount fields become stale once a later bill
-- has captured their balance.
--
-- Previously, paying off the latest bill in full did not update the earlier
-- (now-redundant) bills, so they kept showing "Not Paid" with their own
-- outstanding amounts even though that money had already been collected —
-- causing outstanding totals to be counted twice.
--
-- Run this once against your existing database. It is safe to re-run.
-- ============================================================================

-- 1. Add the tracking column (no-op if it already exists).
alter table bills
  add column if not exists settled_via_later_bill boolean not null default false;

-- 2. One-time reconciliation: for every tenant whose most recent finalized
--    bill is already fully paid (outstanding_amount = 0), mark any earlier
--    bill for that tenant that isn't already 'paid' as settled — its balance
--    was already carried forward and paid off as part of the later bill.
with latest_bill as (
  select distinct on (tenant_id)
    tenant_id, billing_month, outstanding_amount
  from bills
  where finalized = true
  order by tenant_id, billing_month desc
)
update bills b
set
  paid_amount = b.total_amount,
  outstanding_amount = 0,
  payment_status = 'paid',
  settled_via_later_bill = true
from latest_bill lb
where b.tenant_id = lb.tenant_id
  and b.billing_month < lb.billing_month
  and b.payment_status <> 'paid'
  and lb.outstanding_amount = 0;
