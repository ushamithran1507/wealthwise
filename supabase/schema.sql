-- WealthWise Register — shared database setup.
-- Paste into Supabase → SQL Editor → Run. Safe to run more than once.

-- 1. Who may use the register. Add one row per family member's email.
create table if not exists public.members (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

-- Kept in a private schema so it isn't callable through the web API.
create schema if not exists private;
grant usage on schema private to authenticated;
create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.email = lower(auth.jwt() ->> 'email'));
$$;
revoke execute on function private.is_member() from public, anon;
grant execute on function private.is_member() to authenticated;

-- 2. Register entries. Rows are never hard-deleted: "deleted" marks removal so
--    the change reaches every phone, and updated_at (ms) lets the newest edit win.
create table if not exists public.entries (
  id text primary key,
  type text not null check (type in ('income', 'expense', 'investment')),
  amount numeric(14, 2) not null check (amount > 0),
  date date not null,
  cat text not null,
  person text not null default '',
  description text not null default '',
  created bigint not null,
  updated_at bigint not null,
  deleted boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_by_email text default lower(auth.jwt() ->> 'email')
);
create index if not exists entries_date_idx on public.entries (date);
create index if not exists entries_created_by_idx on public.entries (created_by);

-- 3. Categories and names the family added beyond the built-in lists.
create table if not exists public.custom_items (
  id text primary key,               -- "<kind>:<type>:<name>"
  kind text not null check (kind in ('cat', 'person')),
  type text not null default '',     -- income / expense / investment for categories, '' for names
  name text not null,
  updated_at bigint not null,
  deleted boolean not null default false
);

-- 3b. Loans, commitments (insurance, fees, …) and amounts to receive (rent, claims, refunds).
create table if not exists public.records (
  id text primary key,
  kind text not null check (kind in ('loan', 'commitment', 'receivable')),
  data jsonb not null,
  updated_at bigint not null,
  deleted boolean not null default false
);

-- 4. Row-level security: only listed members can read or write.
alter table public.members enable row level security;
alter table public.entries enable row level security;
alter table public.custom_items enable row level security;
alter table public.records enable row level security;

drop policy if exists "members see own row" on public.members;
create policy "members see own row" on public.members
  for select to authenticated using (email = lower((select auth.jwt()) ->> 'email'));

drop policy if exists "members read entries" on public.entries;
create policy "members read entries" on public.entries for select to authenticated using ((select private.is_member()));
drop policy if exists "members add entries" on public.entries;
create policy "members add entries" on public.entries for insert to authenticated with check ((select private.is_member()));
drop policy if exists "members change entries" on public.entries;
create policy "members change entries" on public.entries for update to authenticated using ((select private.is_member())) with check ((select private.is_member()));

drop policy if exists "members read items" on public.custom_items;
create policy "members read items" on public.custom_items for select to authenticated using ((select private.is_member()));
drop policy if exists "members add items" on public.custom_items;
create policy "members add items" on public.custom_items for insert to authenticated with check ((select private.is_member()));
drop policy if exists "members change items" on public.custom_items;
create policy "members change items" on public.custom_items for update to authenticated using ((select private.is_member())) with check ((select private.is_member()));

drop policy if exists "members read records" on public.records;
create policy "members read records" on public.records for select to authenticated using ((select private.is_member()));
drop policy if exists "members add records" on public.records;
create policy "members add records" on public.records for insert to authenticated with check ((select private.is_member()));
drop policy if exists "members change records" on public.records;
create policy "members change records" on public.records for update to authenticated using ((select private.is_member())) with check ((select private.is_member()));

-- The author is always set by the database: the signed-in user on insert,
-- and kept unchanged when someone else edits the entry.
create or replace function public.keep_entry_author() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_email := lower(auth.jwt() ->> 'email');
  else
    new.created_by := old.created_by;
    new.created_by_email := old.created_by_email;
  end if;
  return new;
end $$;
drop trigger if exists keep_entry_author on public.entries;
create trigger keep_entry_author before insert or update on public.entries
  for each row execute function public.keep_entry_author();

-- 5. Live updates between phones.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'entries') then
    alter publication supabase_realtime add table public.entries;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'custom_items') then
    alter publication supabase_realtime add table public.custom_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;

-- 6. Add your family here (lower-case emails), then run again whenever someone joins:
-- insert into public.members (email) values ('usha@example.com'), ('venkat@example.com'), ('mithu@example.com')
--   on conflict do nothing;
