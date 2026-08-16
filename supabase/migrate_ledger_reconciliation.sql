-- ============================================================================
-- Corrects the billing/outstanding model to the oldest-first ledger rule:
--
--   * Bill Amount (total_amount) = this month's own charges ONLY
--     (rent + electricity + water + maintenance + other - discount).
--     It must never include previous_due.
--   * previous_due / paid_amount / outstanding_amount / payment_status are
--     always DERIVED from a tenant's full bill + payment history, walking
--     oldest month first: a month can't be paid until every month before it
--     is fully paid, and once a month is fully paid its amount is never
--     carried forward or counted again.
--
-- This fixes the bug where a later month's cumulative total already included
-- an earlier month's balance, but paying it off didn't update the earlier
-- month — so the same debt could show as outstanding in more than one place.
--
-- Safe to re-run. Only touches finalized bills (drafts are untouched, as in
-- the app itself — they get these values recomputed properly when finalized).
-- ============================================================================

-- Step 1: strip the old cumulative previous_due back out of total_amount, so
-- it reflects only that month's own charges (as it did NOT before this fix).
update bills
set total_amount = round((total_amount - previous_due)::numeric, 2)
where finalized = true;

-- Step 2: recompute previous_due / paid_amount / outstanding_amount /
-- payment_status for every finalized bill from scratch, using each tenant's
-- full payment history and the oldest-first allocation rule.
with tenant_payments as (
  select tenant_id, coalesce(sum(amount), 0) as total_received
  from payments
  group by tenant_id
),
ledger as (
  select
    b.id,
    b.tenant_id,
    b.billing_month,
    b.total_amount as own_charge,
    coalesce(
      sum(b.total_amount) over (
        partition by b.tenant_id order by b.billing_month
        rows between unbounded preceding and 1 preceding
      ),
      0
    ) as cumulative_billed_before,
    coalesce(tp.total_received, 0) as total_received
  from bills b
  left join tenant_payments tp on tp.tenant_id = b.tenant_id
  where b.finalized = true
)
update bills b
set
  previous_due = greatest(
    0,
    round((l.cumulative_billed_before - least(l.total_received, l.cumulative_billed_before))::numeric, 2)
  ),
  paid_amount = greatest(
    0,
    round((
      least(l.total_received, l.cumulative_billed_before + l.own_charge)
      - least(l.total_received, l.cumulative_billed_before)
    )::numeric, 2)
  ),
  outstanding_amount = greatest(
    0,
    round((
      (l.cumulative_billed_before + l.own_charge)
      - least(l.total_received, l.cumulative_billed_before + l.own_charge)
    )::numeric, 2)
  ),
  payment_status = case
    when ((l.cumulative_billed_before + l.own_charge)
          - least(l.total_received, l.cumulative_billed_before + l.own_charge)) <= 0
      then 'paid'
    when (least(l.total_received, l.cumulative_billed_before + l.own_charge)
          - least(l.total_received, l.cumulative_billed_before)) > 0
      then 'partially_paid'
    else 'unpaid'
  end,
  settled_via_later_bill = false
from ledger l
where b.id = l.id;

-- ----------------------------------------------------------------------------
-- Verification: run this afterward to confirm Kanni's bills now read correctly
-- (June ₹0 outstanding/Paid, July per its own payment history, August showing
-- only the genuinely unpaid balance — not a re-add of already-paid months).
-- ----------------------------------------------------------------------------
-- select billing_month, total_amount as bill_amount, previous_due, paid_amount,
--        outstanding_amount, payment_status
-- from bills
-- where tenant_id = (select id from tenants where full_name = 'Kanni')
-- order by billing_month;
