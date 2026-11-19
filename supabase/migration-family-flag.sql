-- spendings-list: migration "family" flag on expenses and templates.
--
-- Run ONCE in Supabase -> SQL Editor, on the EXISTING database, BEFORE the matching frontend
-- is deployed (the app reads and writes is_family). Safe to run again.
--
-- is_family is only a label: "this expense is for the family, not for me personally".
-- Default false = "mine", so existing rows and older app versions keep working unchanged.
-- Who can see or change which rows does NOT change: no policy is touched.

begin;

alter table public.expenses
  add column if not exists is_family boolean not null default false;

alter table public.templates
  add column if not exists is_family boolean not null default false;

-- The report view also groups by is_family, so the summary can split personal / family.
-- Dropped and created again (create or replace cannot change the grouping of a view).
drop view if exists public.monthly_totals;

create view public.monthly_totals
with (security_invoker = true) as
select
  user_id,
  category_id,
  is_family,
  date_trunc('month', spent_on)::date as month,
  sum(amount) as total,
  count(*)    as n
from public.expenses
where deleted_at is null
group by user_id, category_id, is_family, date_trunc('month', spent_on)::date;

revoke all on public.monthly_totals from anon;
grant select on public.monthly_totals to authenticated;

commit;

-- Check: should list the new column on both tables.
-- select table_name, column_name, column_default from information_schema.columns
--  where table_schema = 'public' and column_name = 'is_family';
