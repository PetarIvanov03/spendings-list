-- spendings-list: migration "parent" role.
--
-- Run ONCE in Supabase -> SQL Editor, on the EXISTING database, BEFORE the matching frontend
-- is deployed (the app reads profiles.is_parent when someone logs in). Safe to run again.
--
-- Roles after this migration (profiles.is_admin / profiles.is_parent; never both true):
--   admin   - unchanged: everything, including the trash and categories.
--   parent  - reads ALL non-deleted expenses and the family reports; inserts, edits and
--             soft-deletes ONLY their own; no trash, no categories.
--   member  - unchanged: sees and changes only their own expenses.
-- Nobody can change a role from the app: profiles can only be updated by an admin.

begin;

-- ---- the role flag ----

alter table public.profiles
  add column if not exists is_parent boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_single_role') then
    alter table public.profiles
      add constraint profiles_single_role check (not (is_admin and is_parent));
  end if;
end
$$;

-- ---- helper for the policies (same shape as is_admin) ----

create or replace function public.is_parent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_parent from public.profiles where id = auth.uid()), false);
$$;

revoke execute on function public.is_parent() from public, anon;
grant  execute on function public.is_parent() to authenticated;

-- ---- policies ----

-- profiles: everyone reads their own row; admin and parents read all (names for filters and
-- the "who" label). Updates stay admin-only (policy "profiles: admin updates", unchanged), so
-- nobody can change their own role. There is no insert or delete policy: both are refused.
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.is_parent());

-- expenses: members see their own non-deleted rows; parents see ALL non-deleted rows;
-- the admin sees everything, including the trash (deleted_at is not null).
drop policy if exists "expenses: read" on public.expenses;
create policy "expenses: read"
  on public.expenses for select to authenticated
  using (
    public.is_admin()
    or (deleted_at is null and (user_id = auth.uid() or public.is_parent()))
  );

-- Not changed, and the reason a parent cannot touch other people's rows:
--   "expenses: insert own"  - with check (user_id = auth.uid() ...)
--   "expenses: update own"  - using / with check (user_id = auth.uid() and deleted_at is null)
--   delete_expense(bigint)  - only the owner or the admin may move a row to the trash
--   "expenses: admin delete", categories write policies - admin only
-- monthly_totals is a security_invoker view, so it follows "expenses: read": a parent gets
-- the family totals of non-deleted rows, a member only their own.

commit;

-- =====================================================================================
-- MAKE THE PARENTS. Fill in the two login names, then run this statement.
-- The login name is profiles.name = the part of the e-mail before "@spendings.app"
-- (what they type on the login screen, lower case). It must match exactly.
-- =====================================================================================
update public.profiles
   set is_parent = true
 where name in ('<MOTHER_LOGIN_NAME>', '<FATHER_LOGIN_NAME>');
-- Should report "UPDATE 2". To undo: set is_parent = false for the same names.
